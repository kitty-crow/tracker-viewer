import './styles.css';
import { canWriteFile, chooseWritableFile, connectFolder, loadConnectedFolder, loadRuntimeLatest, recoverWritableHandle, runtimeManifest, storeWritableHandle, type FolderSelection } from './folder';
import { canDiscard, setTrackers, state } from './state';
import { autosavePreference, restoreDraft, saveDraft, setAutosavePreference } from './storage';
import { exportWorkbook, importWorkbook } from './workbook';
import { preserveWorkbook } from './preserve-xlsx';
import { creationDate, newDatedWeek } from './types';
import { notify, render, setupUI } from './ui';

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
let pendingSave: number | undefined;
let saveRunning: Promise<void> | null = null;
let revision = 0;
let savedRevision = 0;
let fileHandle: FileSystemFileHandle | null = null;
let templateFile: File | null = null;
let baselineSheets: typeof state.sheets = [];
let restoredDraft = false;
let loadedFromRuntime = false;
let checkingRuntime = false;
let saveError = '';
const runtimeButton = $('#runtime-update') as HTMLButtonElement;

function showSaveStatus(): void {
  const status = $('#save-status');
  status.classList.toggle('dirty', state.dirty || Boolean(saveError));
  if (saveError) { status.textContent = `⚠ ${saveError}`; return; }
  if (!state.autosave) { status.textContent = state.dirty ? '● Unsaved Excel changes' : 'Auto-save off'; return; }
  if (state.dirty) {
    status.textContent = state.sourceSignature || fileHandle ? 'Saving Excel…' : '⚠ No writable Excel source';
    return;
  }
  status.textContent = state.sourceSignature || fileHandle ? '✓ Excel file saved' : 'No writable Excel source';
}

async function writeHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  if (!(await canWriteFile(handle))) throw new Error('Excel write permission expired; reopen the workbook to grant access');
  const current = await handle.getFile();
  const baseline = state.sourceRevision;
  if (!baseline || current.lastModified !== baseline.modified || current.size !== baseline.size) {
    throw new Error('Excel file changed outside Tracker Viewer; reopen it before saving');
  }
  const stream = await handle.createWritable();
  try { await stream.write(blob); await stream.close(); }
  catch (error) { await stream.abort().catch(() => undefined); throw error; }
  const updated = await handle.getFile();
  state.sourceRevision = { modified: updated.lastModified, size: updated.size };
}

async function writeBack(blob: Blob): Promise<void> {
  if (fileHandle) { await writeHandle(fileHandle, blob); return; }
  const signature = state.sourceSignature;
  if (!signature) throw new Error('This workbook was opened read-only. Use Open file or Connect folder to grant write access');
  const response = await fetch('./__tracker/save', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-Tracker-Signature': encodeURIComponent(signature) },
    body: blob,
  });
  const result = await response.json() as { signature?: string; error?: string };
  if (!response.ok || !result.signature) throw new Error(result.error ?? `Excel save failed (${response.status})`);
  state.sourceSignature = result.signature;
}

/** Serialize writes and retry with the freshest snapshot if edits arrive in-flight. */
async function flushExcel(): Promise<void> {
  if (saveRunning) return saveRunning;
  saveRunning = (async () => {
    while (state.autosave && savedRevision < revision) {
      const writingRevision = revision;
      if (!fileHandle && !state.sourceSignature) {
        saveError = 'Open a writable Excel workbook';
        break;
      }
      showSaveStatus();
      const sheets = structuredClone(state.sheets);
      if (!templateFile) throw new Error('The original Excel template is unavailable; no file was overwritten.');
      const blob = await preserveWorkbook(templateFile, baselineSheets, sheets);
      await writeBack(blob);
      templateFile = new File([blob], state.tracker.sourceName, { type: blob.type, lastModified: Date.now() });
      baselineSheets = structuredClone(sheets);
      savedRevision = writingRevision;
      state.dirty = savedRevision !== revision;
      saveError = '';
      await saveDraft();
      showSaveStatus();
    }
  })().catch(async error => {
    saveError = error instanceof Error ? error.message : String(error);
    state.dirty = true;
    try { await saveDraft(); } catch { /* Recovery storage may be unavailable. */ }
    showSaveStatus();
    notify(`Excel save failed: ${saveError}`, true);
  }).finally(() => { saveRunning = null; });
  return saveRunning;
}

async function persist(): Promise<void> {
  try { await saveDraft(); }
  catch (error) { notify(`Recovery cache unavailable: ${String(error)}`, true); }
  if (state.autosave) await flushExcel();
}

window.addEventListener('tracker-changed', () => {
  revision++;
  saveError = '';
  if (pendingSave) window.clearTimeout(pendingSave);
  showSaveStatus();
  if (state.autosave) pendingSave = window.setTimeout(() => { void persist(); }, 350);
  else void saveDraft();
});

async function openSelection(selection: FolderSelection | null, checkDiscard = true): Promise<boolean> {
  if (!selection) { notify('No .xlsx tracker was found in that location.', true); return false; }
  if (saveRunning) await saveRunning;
  if (checkDiscard && (restoredDraft ? !window.confirm('Replace your saved browser draft? The current Excel workbook should be saved first.') : !canDiscard())) return false;
  state.busy = true;
  $('#source-title').textContent = `Opening ${selection.file.name}…`;
  try {
    const sheets = await importWorkbook(selection.file);
    fileHandle = selection.handle ?? null;
    await storeWritableHandle(fileHandle).catch(() => undefined);
    const fileRevision = fileHandle ? { modified: selection.file.lastModified, size: selection.file.size } : null;
    setTrackers(sheets, selection.label, sheets.length - 1, selection.signature ?? null, fileRevision);
    templateFile = selection.file;
    baselineSheets = structuredClone(sheets);
    revision = 0;
    savedRevision = 0;
    saveError = '';
    restoredDraft = false;
    loadedFromRuntime = selection.signature !== undefined;
    runtimeButton.hidden = true;
    render();
    await saveDraft();
    showSaveStatus();
    notify(`${state.tracker.projects.length} projects and ${state.tracker.misc.length} miscellaneous items loaded.`);
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), true);
    render();
    return false;
  } finally { state.busy = false; }
}

function handleError(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  notify(error instanceof Error ? error.message : String(error), true);
}

state.autosave = autosavePreference();
setupUI();
showSaveStatus();
const toggle = $('#autosave-toggle') as HTMLInputElement;
toggle.checked = state.autosave;
toggle.addEventListener('change', () => {
  setAutosavePreference(toggle.checked);
  if (state.autosave) void persist();
  showSaveStatus();
});

const quitButton = $('#quit-app') as HTMLButtonElement;
void (async () => {
  try {
    const response = await fetch('./__app/status', { cache: 'no-store' });
    if (!response.ok) return;
    const status = (await response.json()) as { canQuit?: boolean };
    quitButton.hidden = status.canQuit !== true;
  } catch { /* In development no compiled executable is running. */ }
})();
quitButton.onclick = async () => {
  if (!window.confirm('Stop Tracker Viewer? Pending changes will be written to Excel first.')) return;
  await persist();
  if (state.dirty) { notify('Excel still has unsaved changes. Resolve the save error before quitting.', true); return; }
  try {
    const response = await fetch('./__app/quit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!response.ok) throw new Error('Could not stop the local server.');
    document.body.innerHTML = '<main style="font:16px system-ui;padding:3rem;max-width:40rem;margin:auto"><h1>Tracker Viewer stopped</h1><p>You can close this browser tab.</p></main>';
  } catch (error) { handleError(error); }
};

const newSheetButton = $('#new-sheet') as HTMLButtonElement;
newSheetButton.onclick = async () => {
  if (state.busy || newSheetButton.disabled) return;
  if (!state.sourceSignature || fileHandle) {
    notify('Automatic new weekly files require a tracker loaded from TRACKER_FOLDER. Open the tracker through Latest.', true);
    return;
  }
  newSheetButton.disabled = true;
  state.busy = true;
  try {
    if (pendingSave) { clearTimeout(pendingSave); pendingSave = undefined; }
    if (state.dirty && !state.autosave) throw new Error('Save or export pending changes before creating a new weekly file.');
    if (state.dirty) await persist();
    if (state.dirty) throw new Error('The previous workbook has unsaved changes. Resolve its save error first.');
    if (saveRunning) await saveRunning;
    const date = new Date();
    const next = newDatedWeek(state.tracker, date);
    if (!templateFile) throw new Error('Original workbook unavailable; cannot create a layout-preserving copy.');
    const blob = await preserveWorkbook(templateFile, baselineSheets, [next]);
    const reply = await fetch('./__tracker/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'X-Tracker-Signature': encodeURIComponent(state.sourceSignature ?? ''),
        'X-Tracker-Date': creationDate(date),
      },
      body: blob,
    });
    const created = await reply.json() as { filename?: string; signature?: string; modified?: number; error?: string };
    if (!reply.ok || !created.filename || !created.signature) throw new Error(created.error ?? `File creation failed (${reply.status})`);
    const workbook = new File([blob], created.filename, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastModified: created.modified ?? Date.now(),
    });
    const opened = await openSelection({ file: workbook, label: 'live folder: current weekly file', signature: created.signature }, false);
    if (!opened) throw new Error(`Created ${created.filename}, but could not display it. Use Latest to open it.`);
    notify(`Created ${created.filename} in TRACKER_FOLDER.`);
    document.querySelector('#meeting')?.scrollIntoView({ behavior: 'smooth' });
  } catch (error) { handleError(error); }
  finally { state.busy = false; newSheetButton.disabled = false; }
};

$('#open-btn').onclick = async () => {
  try {
    const selected = await chooseWritableFile();
    if (selected) { await openSelection(selected); return; }
    ($('#file-input') as HTMLInputElement).click();
  } catch (error) { handleError(error); }
};
$('#file-input').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (file) {
    await openSelection({ file, label: 'read-only file selection' });
    notify('This file picker cannot save to the original. Use Chrome/Edge Open file or Connect folder for writable access.', true);
  }
});
$('#folder-btn').onclick = async () => {
  try { await openSelection(await connectFolder()); } catch (error) { handleError(error); }
};
async function newestAvailable(): Promise<FolderSelection | null> {
  const live = await loadRuntimeLatest();
  if (live) return live;
  return await loadConnectedFolder(true);
}
$('#refresh-btn').onclick = async () => {
  try { await openSelection(await newestAvailable()); } catch (error) { handleError(error); }
};
runtimeButton.onclick = async () => {
  try { await openSelection(await loadRuntimeLatest()); } catch (error) { handleError(error); }
};

async function checkRuntime(): Promise<void> {
  if (checkingRuntime || state.busy || saveRunning || state.dirty) return;
  checkingRuntime = true;
  try {
    const latest = await runtimeManifest();
    if (!latest || latest.signature === state.sourceSignature) { runtimeButton.hidden = true; return; }
    const empty = !state.tracker.sourceName && !state.tracker.projects.length && !state.tracker.misc.length;
    if (!restoredDraft && (loadedFromRuntime || empty)) {
      await openSelection(await loadRuntimeLatest(latest), false);
      return;
    }
    runtimeButton.textContent = `↻ Newest: ${latest.filename}`;
    runtimeButton.title = `Modified ${new Date(latest.modified).toLocaleString()}. Click to open.`;
    runtimeButton.hidden = false;
  } catch (error) { console.warn('Live tracker lookup failed:', error); }
  finally { checkingRuntime = false; }
}
window.setInterval(() => { void checkRuntime(); }, 30000);

$('#save-btn').onclick = async () => {
  if (!state.sheets.some(sheet => sheet.projects.length || sheet.misc.length || sheet.meeting.length)) { notify('Open a tracker or create an item before exporting.', true); return; }
  const button = $('#save-btn') as HTMLButtonElement;
  button.disabled = true;
  button.textContent = 'Exporting…';
  try {
    const blob = templateFile ? await preserveWorkbook(templateFile, baselineSheets, state.sheets)
      : await exportWorkbook(state.sheets);
    const date = new Date().toISOString().slice(0, 10);
    const base = (state.tracker.sourceName || 'Projects Tracker').replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]/g, '_');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${base} - edited ${date}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify('Workbook copy exported.');
  } catch (error) { handleError(error); }
  finally { button.disabled = false; button.textContent = '↓ Export Excel'; }
};

async function prepareRecoveryTemplate(): Promise<void> {
  try {
    const source = await loadRuntimeLatest();
    if (!source || source.signature !== state.sourceSignature) return;
    templateFile = source.file;
    baselineSheets = structuredClone(await importWorkbook(source.file));
  } catch { /* The original remains required before saving a recovered draft. */ }
}

(async () => {
  // The on-disk workbook is authoritative. IndexedDB is a recovery cache,
  // so only prefer it when there are genuinely unsaved changes to recover.
  const draft = await restoreDraft().catch(() => null);
  const recoverUnsaved = Boolean(draft?.sheets?.length && draft.dirty)
    && window.confirm('An unsaved recovery draft exists. Restore it instead of opening the latest Excel workbook?');
  if (recoverUnsaved && draft) {
    setTrackers(draft.sheets, draft.loadingFrom || 'restored browser draft', draft.activeSheet,
      draft.sourceSignature ?? null, draft.sourceRevision ?? null);
    fileHandle = await recoverWritableHandle(state.tracker.sourceName).catch(() => null);
    state.dirty = true;
    revision = 1;
    savedRevision = 0;
    restoredDraft = true;
    await prepareRecoveryTemplate();
    render();
    showSaveStatus();
    // Never attempt a destructive export when the original template is absent.
    void (state.autosave && templateFile ? persist() : Promise.resolve());
    await checkRuntime();
    return;
  }
  try {
    const runtime = await loadRuntimeLatest();
    if (runtime && await openSelection(runtime, false)) return;
  } catch (error) { console.warn('Live tracker lookup unavailable:', error); }
  try {
    const connected = await loadConnectedFolder();
    if (connected && await openSelection(connected, false)) return;
  } catch { /* Folder permission expired. */ }
  // If neither disk source is available, keep the cached workspace accessible.
  if (draft?.sheets?.length) {
    setTrackers(draft.sheets, draft.loadingFrom || 'recovered browser cache', draft.activeSheet,
      null, null);
    templateFile = null;
    baselineSheets = [];
    state.dirty = Boolean(draft.dirty);
    revision = state.dirty ? 1 : 0;
    savedRevision = 0;
    restoredDraft = true;
    render();
    showSaveStatus();
    notify('No source workbook could be opened. Showing the recovery cache instead.', true);
    return;
  }
  await checkRuntime();
})();

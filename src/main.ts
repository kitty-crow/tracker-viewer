import './styles.css';
import { connectFolder, loadBuiltIn, loadConnectedFolder, loadRuntimeLatest, runtimeManifest, type FolderSelection } from './folder';
import { canDiscard, setTrackers, state } from './state';
import { autosavePreference, restoreDraft, saveDraft, setAutosavePreference } from './storage';
import { exportWorkbook, importWorkbook } from './workbook';
import { notify, render, setSaved, setupUI } from './ui';
const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
let pendingSave: number | undefined;
let restoredDraft = false;
let loadedFromRuntime = false;
let checkingRuntime = false;
const runtimeButton = $('#runtime-update') as HTMLButtonElement;
async function persist(): Promise<void> {
  if (!state.autosave) return;
  try { await saveDraft(); renderSaveStatus(); } catch (error) { notify(`Could not auto-save: ${String(error)}`, true); }
}
function renderSaveStatus(): void {
  $('#save-status').textContent = state.autosave ? 'Draft saved locally' : (state.dirty ? '● Not exported' : 'Ready');
}
window.addEventListener('tracker-changed', () => {
  if (pendingSave) window.clearTimeout(pendingSave);
  if (!state.autosave) { renderSaveStatus(); return; }
  $('#save-status').textContent = 'Saving draft…';
  pendingSave = window.setTimeout(() => { void persist(); }, 450);
});
async function openSelection(selection: FolderSelection | null, checkDiscard = true): Promise<boolean> {
  if (!selection) { notify('No .xlsx tracker was found in that location.', true); return false; }
  if (checkDiscard && (restoredDraft ? !window.confirm('Replace your saved browser draft with another tracker? Export first if needed.') : !canDiscard())) return false;
  state.busy = true; $('#source-title').textContent = `Opening ${selection.file.name}…`;
  try {
    const trackers = await importWorkbook(selection.file);
    setTrackers(trackers, selection.label, trackers.length - 1, selection.signature ?? null);
    restoredDraft = false; loadedFromRuntime = selection.signature !== undefined; runtimeButton.hidden = true;
    render(); await persist(); renderSaveStatus();
    notify(`${state.tracker.projects.length} projects and ${state.tracker.misc.length} miscellaneous items loaded.`);
    return true;
  } catch (error) { notify(error instanceof Error ? error.message : String(error), true); render(); return false; }
  finally { state.busy = false; }
}
function handleError(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  notify(error instanceof Error ? error.message : String(error), true);
}
state.autosave = autosavePreference();
setupUI();
const toggle = $('#autosave-toggle') as HTMLInputElement;
toggle.checked = state.autosave;
toggle.addEventListener('change', () => {
  setAutosavePreference(toggle.checked);
  if (state.autosave) void persist(); else renderSaveStatus();
});
$('#open-btn').onclick = () => ($('#file-input') as HTMLInputElement).click();
$('#file-input').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (file) await openSelection({ file, label: 'local file' });
});
$('#folder-btn').onclick = async () => {
  try { await openSelection(await connectFolder()); } catch (error) { handleError(error); }
};
async function newestAvailable(): Promise<FolderSelection | null> {
  const live = await loadRuntimeLatest();
  if (live) return live;
  return await loadConnectedFolder(true) ?? await loadBuiltIn();
}
$('#refresh-btn').onclick = async () => {
  try { await openSelection(await newestAvailable()); }
  catch (error) { handleError(error); }
};
runtimeButton.onclick = async () => {
  try { await openSelection(await loadRuntimeLatest()); }
  catch (error) { handleError(error); }
};
/** Never overwrite an active or restored draft when a newer file appears. */
async function checkRuntime(): Promise<void> {
  if (checkingRuntime || state.busy) return;
  checkingRuntime = true;
  try {
    const latest = await runtimeManifest();
    if (!latest || latest.signature === state.sourceSignature) { runtimeButton.hidden = true; return; }
    const empty = !state.tracker.sourceName && !state.tracker.projects.length && !state.tracker.misc.length;
    if (!restoredDraft && !state.dirty && (loadedFromRuntime || empty)) {
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
  const saveButton = $('#save-btn') as HTMLButtonElement;
  saveButton.disabled = true; saveButton.textContent = 'Exporting…';
  try {
    const blob = await exportWorkbook(state.sheets);
    const date = new Date().toISOString().slice(0, 10);
    const base = (state.tracker.sourceName || 'Projects Tracker').replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]/g, '_');
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${base} - edited ${date}.xlsx`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    setSaved(); notify('Workbook exported.');
  } catch (error) { handleError(error); }
  finally { saveButton.disabled = false; saveButton.textContent = '↓ Export Excel'; }
};
// Prefer the saved editable workspace over a bundled snapshot to avoid overwriting work on refresh.
(async () => {
  try {
    const draft = await restoreDraft();
    if (draft?.sheets?.length) {
      setTrackers(draft.sheets, draft.loadingFrom || 'restored browser draft', draft.activeSheet, draft.sourceSignature ?? null);
      restoredDraft = true; render(); renderSaveStatus(); await checkRuntime(); return;
    }
  } catch { /* Private browsing or a disabled IndexedDB store. */ }
  try {
    const runtime = await loadRuntimeLatest();
    if (runtime) { await openSelection(runtime, false); return; }
  } catch (error) { console.warn('Live tracker lookup unavailable:', error); }
  try {
    const connected = await loadConnectedFolder();
    if (connected) { await openSelection(connected, false); return; }
  } catch { /* Folder access may no longer be permitted. */ }
  try { const bundled = await loadBuiltIn(); if (bundled) await openSelection(bundled, false); }
  catch { /* No snapshot is a valid starting state. */ }
  await checkRuntime();
})();

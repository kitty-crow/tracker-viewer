import { WorkbookFolderGateway, type FolderSelection } from '../files/WorkbookFolder';
import { TrackerStateController, state } from '../model/TrackerState';
import { TrackerDraftStore } from '../storage/RecoveryStore';
import { WorkbookCodec } from '../workbook/WorkbookCodec';
import { WorkbookPreserver } from '../workbook/WorkbookPreserver';
import { TrackerFactory } from '../model/TrackerTypes';
import { trackerView } from '../ui/TrackerView';
import { createElement } from 'react';
import { replaceChildrenWithReact } from '../ui/reactHelpers';
import { StoppedMessage } from '../ui/views/StoppedMessage';

/**
 * Owns the running application session. All long-lived persistence, workbook and
 * comparison state belongs to this instance, not global variables in main.ts.
 *
 * Each method has one responsibility; browser controls call into these methods
 * rather than building HTML themselves. Excel writes remain revision-checked.
 */
export class TrackerApplication {
  /** Look up a required control, reporting broken shell contracts clearly. */
  private $<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing required Tracker Viewer control: ${selector}`);
    return element;
  }

/** Inject long-lived object-oriented services for each independent concern. */
  private readonly files = new WorkbookFolderGateway();
  private readonly workspace = new TrackerStateController();
  private readonly drafts = new TrackerDraftStore();
  private readonly codec = new WorkbookCodec();
  private readonly xlsx = new WorkbookPreserver();
  private readonly factory = new TrackerFactory();

private pendingSave: number | undefined;
private saveRunning: Promise<void> | null = null;
private revision = 0;
private savedRevision = 0;
private fileHandle: FileSystemFileHandle | null = null;
private templateFile: File | null = null;
private baselineSheets: typeof state.sheets = [];
private restoredDraft = false;
private loadedFromRuntime = false;
private followLatest = true;
private checkingRuntime = false;
private saveError = '';
private diffSequence = 0;
private diffCache = new Map<string, typeof state.sheets>();
private runtimeButton = this.$<HTMLButtonElement>('#runtime-update');

/** Update the save indicator to distinguish dirty changes, pending writes and failures. */
private showSaveStatus(): void {
  const status = this.$('#save-status');
  status.classList.toggle('dirty', state.dirty || Boolean(this.saveError));
  if (this.saveError) { status.textContent = `⚠ ${this.saveError}`; return; }
  if (!state.autosave) { status.textContent = state.dirty ? '● Unsaved Excel changes' : 'Auto-save off'; return; }
  if (state.dirty) {
    status.textContent = state.sourceSignature || this.fileHandle ? 'Saving Excel…' : '⚠ No writable Excel source';
    return;
  }
  status.textContent = state.sourceSignature || this.fileHandle ? '✓ Excel file saved' : 'No writable Excel source';
}

/** Persist a workbook through the browser File System Access API, checking the original revision first. */
private async writeHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  if (!(await this.files.canWrite(handle))) throw new Error('Excel write permission expired; reopen the workbook to grant access');
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

/** Select the correct write target: a browser-granted handle or the local tracker server. */
private async writeBack(blob: Blob): Promise<void> {
  if (this.fileHandle) { await this.writeHandle(this.fileHandle, blob); return; }
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
/** Serialize workbook writes so rapid edits cannot overwrite newer changes. */
private async flushExcel(): Promise<void> {
  if (this.saveRunning) return this.saveRunning;
  this.saveRunning = (async () => {
    while (state.autosave && this.savedRevision < this.revision) {
      const writingRevision = this.revision;
      if (!this.fileHandle && !state.sourceSignature) {
        this.saveError = 'Open a writable Excel workbook';
        break;
      }
      this.showSaveStatus();
      const sheets = structuredClone(state.sheets);
      if (!this.templateFile) throw new Error('The original Excel template is unavailable; no file was overwritten.');
      const blob = await this.xlsx.preserve(this.templateFile, this.baselineSheets, sheets);
      await this.writeBack(blob);
      this.templateFile = new File([blob], state.tracker.sourceName, { type: blob.type, lastModified: Date.now() });
      this.baselineSheets = structuredClone(sheets);
      this.savedRevision = writingRevision;
      state.dirty = this.savedRevision !== this.revision;
      this.saveError = '';
      await this.drafts.save();
      this.showSaveStatus();
    }
  })().catch(async error => {
    this.saveError = error instanceof Error ? error.message : String(error);
    state.dirty = true;
    try { await this.drafts.save(); } catch { /* Recovery storage may be unavailable. */ }
    this.showSaveStatus();
    trackerView.notify(`Excel save failed: ${this.saveError}`, true);
  }).finally(() => { this.saveRunning = null; });
  return this.saveRunning;
}

/** Write a recovery draft before writing to the authoritative Excel workbook. */
private async persist(): Promise<void> {
  try { await this.drafts.save(); }
  catch (error) { trackerView.notify(`Recovery cache unavailable: ${String(error)}`, true); }
  if (state.autosave) await this.flushExcel();
}

/** Called when an editable cell changes; schedules recovery and a debounced Excel save. */
private readonly onTrackerChanged = (): void => {
  this.revision++;
  this.saveError = '';
  if (this.pendingSave) window.clearTimeout(this.pendingSave);
  this.showSaveStatus();
  if (state.autosave) this.pendingSave = window.setTimeout(() => { void this.persist(); }, 350);
  else void this.drafts.save();
};

/** Load a selected workbook into the working model without losing unsaved work. */
private async openSelection(selection: FolderSelection | null, checkDiscard = true): Promise<boolean> {
  if (!selection) { trackerView.notify('No .xlsx tracker was found in that location.', true); return false; }
  if (this.saveRunning) await this.saveRunning;
  if (checkDiscard && (this.restoredDraft ? !window.confirm('Replace your saved browser draft? The current Excel workbook should be saved first.') : !this.workspace.canReplace())) return false;
  state.busy = true;
  this.$('#source-title').textContent = `Opening ${selection.file.name}…`;
  try {
    const sheets = await this.codec.read(selection.file);
    this.fileHandle = selection.handle ?? null;
    await this.files.rememberHandle(this.fileHandle).catch(() => undefined);
    const fileRevision = this.fileHandle ? { modified: selection.file.lastModified, size: selection.file.size } : null;
    this.workspace.open(sheets, selection.label, sheets.length - 1, selection.signature ?? null, fileRevision);
    this.templateFile = selection.file;
    this.baselineSheets = structuredClone(sheets);
    this.revision = 0;
    this.savedRevision = 0;
    this.saveError = '';
    this.restoredDraft = false;
    this.loadedFromRuntime = selection.signature !== undefined;
    this.runtimeButton.hidden = true;
    trackerView.render();
    await this.drafts.save();
    await this.refreshFolderPills();
    this.showSaveStatus();
    trackerView.notify(`${state.tracker.projects.length} projects and ${state.tracker.misc.length} miscellaneous items loaded.`);
    return true;
  } catch (error) {
    trackerView.notify(error instanceof Error ? error.message : String(error), true);
    trackerView.render();
    return false;
  } finally { state.busy = false; }
}

/** Refresh the workbook pills after scanning the configured folder. */
private async refreshFolderPills(): Promise<void> {
  try {
    state.folderFiles = await this.files.list();
    trackerView.renderSheetTabs();
  } catch (error) { console.warn('Workbook list unavailable:', error); }
}

/** Save the active workbook before switching files; never save into the next one. */
/** Change the active weekly file only after protecting outstanding edits. */
private async openFolderPill(filename: string): Promise<void> {
  if (!filename || state.busy || state.tracker.sourceName === filename && Boolean(state.sourceSignature)) return;
  try {
    if (this.pendingSave) { clearTimeout(this.pendingSave); this.pendingSave = undefined; }
    if (this.saveRunning) await this.saveRunning;
    if (state.dirty && !state.autosave) {
      trackerView.notify('Save or export your pending Excel changes before switching files.', true);
      return;
    }
    if (state.dirty) await this.persist();
    if (state.dirty) {
      trackerView.notify('The current Excel file still has unsaved changes; the file was not switched.', true);
      return;
    }
    const file = state.folderFiles.find(item => item.filename === filename);
    if (!file) throw new Error('That workbook is no longer in the folder. Refresh the file list.');
    const loaded = await this.files.load(file);
    const opened = await this.openSelection(loaded, false);
    if (!opened) return;
    this.followLatest = false;
    this.runtimeButton.hidden = true;
  } catch (error) { this.handleError(error); await this.refreshFolderPills(); }
}

/** Show operational failures to the user without swallowing cancellation events. */
private handleError(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  trackerView.notify(error instanceof Error ? error.message : String(error), true);
}

/** Diff workbooks are parsed independently of the active editable sheet. */
/** Load two comparison snapshots independently of the editable workbook. */
private async chooseDiffFile(filename: string): Promise<void> {
  const selected = state.diffSelected;
  const existing = selected.indexOf(filename);
  state.diffSelected = existing >= 0 ? selected.filter(item => item !== filename)
    : selected.length === 2 ? [filename] : [...selected, filename];
  state.diffWorkbooks = [];
  state.diffFromSheet = 0;
  state.diffToSheet = 0;
  state.diffError = '';
  const generation = ++this.diffSequence;
  state.diffLoading = state.diffSelected.length === 2;
  trackerView.render();
  if (!state.diffLoading) return;
  try {
    const entries = await Promise.all(state.diffSelected.map(async name => {
      const manifest = state.folderFiles.find(item => item.filename === name);
      if (!manifest) throw new Error(`Workbook ${name} is no longer in TRACKER_FOLDER.`);
      let sheets = this.diffCache.get(manifest.signature);
      if (!sheets) {
        const source = await this.files.load(manifest);
        sheets = await this.codec.read(source.file);
        this.diffCache.set(manifest.signature, sheets);
      }
      return { filename: name, sheets };
    }));
    if (generation !== this.diffSequence || !state.diffMode) return;
    state.diffWorkbooks = entries;
    state.diffFromSheet = Math.max(0, (entries[0]?.sheets.length ?? 1) - 1);
    state.diffToSheet = Math.max(0, (entries[1]?.sheets.length ?? 1) - 1);
  } catch (error) {
    if (generation !== this.diffSequence || !state.diffMode) return;
    state.diffError = error instanceof Error ? error.message : String(error);
  } finally {
    if (generation === this.diffSequence) {
      state.diffLoading = false;
      trackerView.render();
    }
  }
}
/** Enter or leave read-only comparison mode and reset stale selections. */
private toggleDiffMode(enabled: boolean): void {
  state.diffMode = enabled;
  ++this.diffSequence;
  state.diffSelected = [];
  state.diffWorkbooks = [];
  state.diffLoading = false;
  state.diffError = '';
  trackerView.render();
  if (enabled) void this.refreshFolderPills();
}
/** Change which worksheet participates in the read-only comparison. */
private chooseDiffSheet(side: 'from' | 'to', index: number): void {
  const entry = state.diffWorkbooks[side === 'from' ? 0 : 1];
  if (!entry || !Number.isInteger(index) || index < 0 || index >= entry.sheets.length) return;
  if (side === 'from') state.diffFromSheet = index;
  else state.diffToSheet = index;
  trackerView.render();
}


/** Prefer the configured live tracker folder, then the browser-connected folder. */
private async newestAvailable(): Promise<FolderSelection | null> {
  const live = await this.files.latest();
  if (live) return live;
  return await this.files.connected(true);
}

/** Check whether a new weekly workbook has appeared, respecting unsaved edits. */
private async checkRuntime(): Promise<void> {
  if (this.checkingRuntime || state.busy || this.saveRunning || state.dirty) return;
  this.checkingRuntime = true;
  try {
    const files = await this.files.list();
    state.folderFiles = files;
    trackerView.renderSheetTabs();
    const latest = files[0];
    if (!latest || latest.signature === state.sourceSignature) {
      this.runtimeButton.hidden = true;
      return;
    }
    const empty = !state.tracker.sourceName && !state.tracker.projects.length && !state.tracker.misc.length;
    if (!state.diffMode && !this.restoredDraft && (this.followLatest && this.loadedFromRuntime || empty)) {
      this.followLatest = await this.openSelection(await this.files.load(latest), false);
      return;
    }
    this.runtimeButton.textContent = `↻ Newest: ${latest.filename}`;
    this.runtimeButton.title = `Modified ${new Date(latest.modified).toLocaleString()}. Click to open.`;
    this.runtimeButton.hidden = false;
  } catch (error) { console.warn('Live tracker lookup failed:', error); }
  finally { this.checkingRuntime = false; }
}

/** Recover the original XLSX structure required for non-destructive writes. */
private async prepareRecoveryTemplate(): Promise<void> {
  try {
    const files = await this.files.list();
    const file = files.find(item => item.signature === state.sourceSignature);
    if (!file) return;
    const source = await this.files.load(file);
    this.templateFile = source.file;
    this.baselineSheets = structuredClone(await this.codec.read(source.file));
  } catch { /* The original remains required before saving a recovered draft. */ }
}

/** Attach UI listeners and launch the initial workbook recovery/load sequence. */
public start(): void {
window.addEventListener('tracker-changed', this.onTrackerChanged);
state.autosave = this.drafts.preferredAutosave();
trackerView.setupUI(filename => {
  if (state.diffMode) { void this.chooseDiffFile(filename); return; }
  void this.openFolderPill(filename);
}, enabled => this.toggleDiffMode(enabled), (side, index) => this.chooseDiffSheet(side, index));
this.showSaveStatus();
const toggle = this.$('#autosave-toggle') as HTMLInputElement;
toggle.checked = state.autosave;
toggle.addEventListener('change', () => {
  this.drafts.setAutosave(toggle.checked);
  if (state.autosave) void this.persist();
  this.showSaveStatus();
});

const quitButton = this.$('#quit-app') as HTMLButtonElement;
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
  await this.persist();
  if (state.dirty) { trackerView.notify('Excel still has unsaved changes. Resolve the save error before quitting.', true); return; }
  try {
    const response = await fetch('./__app/quit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!response.ok) throw new Error('Could not stop the local server.');
    replaceChildrenWithReact(document.body, createElement(StoppedMessage));
  } catch (error) { this.handleError(error); }
};

const newSheetButton = this.$('#new-sheet') as HTMLButtonElement;
newSheetButton.onclick = async () => {
  if (state.busy || newSheetButton.disabled) return;
  if (!state.sourceSignature || this.fileHandle) {
    trackerView.notify('Automatic new weekly files require a tracker loaded from TRACKER_FOLDER. Open the tracker through Latest.', true);
    return;
  }
  newSheetButton.disabled = true;
  state.busy = true;
  try {
    if (this.pendingSave) { clearTimeout(this.pendingSave); this.pendingSave = undefined; }
    if (state.dirty && !state.autosave) throw new Error('Save or export pending changes before creating a new weekly file.');
    if (state.dirty) await this.persist();
    if (state.dirty) throw new Error('The previous workbook has unsaved changes. Resolve its save error first.');
    if (this.saveRunning) await this.saveRunning;
    const date = new Date();
    const next = this.factory.nextWeek(state.tracker, date);
    if (!this.templateFile) throw new Error('Original workbook unavailable; cannot create a layout-preserving copy.');
    const blob = await this.xlsx.preserve(this.templateFile, this.baselineSheets, [next]);
    const reply = await fetch('./__tracker/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'X-Tracker-Signature': encodeURIComponent(state.sourceSignature ?? ''),
        'X-Tracker-Date': this.factory.creationDate(date),
      },
      body: blob,
    });
    const created = await reply.json() as { filename?: string; signature?: string; modified?: number; error?: string };
    if (!reply.ok || !created.filename || !created.signature) throw new Error(created.error ?? `File creation failed (${reply.status})`);
    const workbook = new File([blob], created.filename, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastModified: created.modified ?? Date.now(),
    });
    const opened = await this.openSelection({ file: workbook, label: 'live folder: current weekly file', signature: created.signature }, false);
    if (!opened) throw new Error(`Created ${created.filename}, but could not display it. Use Latest to open it.`);
    this.followLatest = true;
    trackerView.notify(`Created ${created.filename} in TRACKER_FOLDER.`);
    document.querySelector('#meeting')?.scrollIntoView({ behavior: 'smooth' });
  } catch (error) { this.handleError(error); }
  finally { state.busy = false; newSheetButton.disabled = false; }
};

this.$('#open-btn').onclick = async () => {
  try {
    const selected = await this.files.chooseWritable();
    if (selected) { await this.openSelection(selected); return; }
    (this.$('#file-input') as HTMLInputElement).click();
  } catch (error) { this.handleError(error); }
};
this.$('#file-input').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (file) {
    await this.openSelection({ file, label: 'read-only file selection' });
    trackerView.notify('This file picker cannot save to the original. Use Chrome/Edge Open file or Connect folder for writable access.', true);
  }
});
this.$('#folder-btn').onclick = async () => {
  try { await this.openSelection(await this.files.connect()); } catch (error) { this.handleError(error); }
};
this.$('#refresh-btn').onclick = async () => {
  try {
    const opened = await this.openSelection(await this.newestAvailable());
    if (opened) this.followLatest = true;
  } catch (error) { this.handleError(error); }
};
this.runtimeButton.onclick = async () => {
  try {
    const opened = await this.openSelection(await this.files.latest());
    if (opened) this.followLatest = true;
  } catch (error) { this.handleError(error); }
};

window.setInterval(() => { void this.checkRuntime(); }, 30000);

this.$('#save-btn').onclick = async () => {
  if (!state.sheets.some(sheet => sheet.projects.length || sheet.misc.length || sheet.meeting.length)) { trackerView.notify('Open a tracker or create an item before exporting.', true); return; }
  const button = this.$('#save-btn') as HTMLButtonElement;
  button.disabled = true;
  button.textContent = 'Exporting…';
  try {
    const blob = this.templateFile ? await this.xlsx.preserve(this.templateFile, this.baselineSheets, state.sheets)
      : await this.codec.write(state.sheets);
    const date = new Date().toISOString().slice(0, 10);
    const base = (state.tracker.sourceName || 'Projects Tracker').replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]/g, '_');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${base} - edited ${date}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    trackerView.notify('Workbook copy exported.');
  } catch (error) { this.handleError(error); }
  finally { button.disabled = false; button.textContent = '↓ Export Excel'; }
};

(async () => {
  // The on-disk workbook is authoritative. IndexedDB is a recovery cache,
  // so only prefer it when there are genuinely unsaved changes to recover.
  const draft = await this.drafts.restore().catch(() => null);
  const recoverUnsaved = Boolean(draft?.sheets?.length && draft.dirty)
    && window.confirm('An unsaved recovery draft exists. Restore it instead of opening the latest Excel workbook?');
  if (recoverUnsaved && draft) {
    this.workspace.open(draft.sheets, draft.loadingFrom || 'restored browser draft', draft.activeSheet,
      draft.sourceSignature ?? null, draft.sourceRevision ?? null);
    this.fileHandle = await this.files.recoverHandle(state.tracker.sourceName).catch(() => null);
    state.dirty = true;
    this.revision = 1;
    this.savedRevision = 0;
    this.restoredDraft = true;
    await this.prepareRecoveryTemplate();
    trackerView.render();
    this.showSaveStatus();
    // Never attempt a destructive export when the original template is absent.
    void (state.autosave && this.templateFile ? this.persist() : Promise.resolve());
    await this.checkRuntime();
    return;
  }
  try {
    const files = await this.files.list();
    state.folderFiles = files;
    trackerView.renderSheetTabs();
    const newest = files[0];
    const runtime = newest ? await this.files.load(newest) : await this.files.latest();
    if (runtime && await this.openSelection(runtime, false)) return;
  } catch (error) { console.warn('Live tracker lookup unavailable:', error); }
  try {
    const connected = await this.files.connected();
    if (connected && await this.openSelection(connected, false)) return;
  } catch { /* Folder permission expired. */ }
  // If neither disk source is available, keep the cached workspace accessible.
  if (draft?.sheets?.length) {
    this.workspace.open(draft.sheets, draft.loadingFrom || 'recovered browser cache', draft.activeSheet,
      null, null);
    this.templateFile = null;
    this.baselineSheets = [];
    state.dirty = Boolean(draft.dirty);
    this.revision = state.dirty ? 1 : 0;
    this.savedRevision = 0;
    this.restoredDraft = true;
    trackerView.render();
    this.showSaveStatus();
    trackerView.notify('No source workbook could be opened. Showing the recovery cache instead.', true);
    return;
  }
  await this.checkRuntime();
})();

}

}

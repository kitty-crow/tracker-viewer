import './styles.css';
import { connectFolder, loadBuiltIn, loadConnectedFolder, type FolderSelection } from './folder';
import { canDiscard, setTrackers, state } from './state';
import { autosavePreference, restoreDraft, saveDraft, setAutosavePreference } from './storage';
import { exportWorkbook, importWorkbook } from './workbook';
import { notify, render, setSaved, setupUI } from './ui';
const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
let pendingSave: number | undefined;
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
  if (checkDiscard && !canDiscard()) return false;
  state.busy = true; $('#source-title').textContent = `Opening ${selection.file.name}…`;
  try {
    const trackers = await importWorkbook(selection.file);
    setTrackers(trackers, selection.label); render(); await persist(); renderSaveStatus();
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
$('#refresh-btn').onclick = async () => {
  try { const connected = await loadConnectedFolder(true); if (connected) await openSelection(connected); else await openSelection(await loadBuiltIn()); }
  catch (error) { handleError(error); }
};
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
      setTrackers(draft.sheets, draft.loadingFrom || 'restored browser draft', draft.activeSheet);
      render(); renderSaveStatus(); return;
    }
  } catch { /* Private browsing or a disabled IndexedDB store. */ }
  try {
    const connected = await loadConnectedFolder();
    if (connected) { await openSelection(connected, false); return; }
  } catch { /* Folder access may no longer be permitted. */ }
  try { const bundled = await loadBuiltIn(); if (bundled) await openSelection(bundled, false); }
  catch { /* No snapshot is a valid starting state. */ }
})();

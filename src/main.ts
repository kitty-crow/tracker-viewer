import './styles.css';
import { connectFolder, loadBuiltIn, loadConnectedFolder, type FolderSelection } from './folder';
import { canDiscard, setTracker, state } from './state';
import { exportWorkbook, importWorkbook } from './workbook';
import { notify, render, setSaved, setupUI } from './ui';
const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
async function openSelection(selection: FolderSelection | null): Promise<boolean> {
  if (!selection) { notify('No .xlsx tracker was found in that location.', true); return false; }
  if (!canDiscard()) return false;
  state.busy = true; $('#source-title').textContent = `Opening ${selection.file.name}…`;
  try {
    const tracker = await importWorkbook(selection.file);
    setTracker(tracker, selection.label); render();
    notify(`${tracker.projects.length} projects and ${tracker.misc.length} miscellaneous items loaded.`);
    return true;
  } catch (error) { notify(error instanceof Error ? error.message : String(error), true); render(); return false; }
  finally { state.busy = false; }
}
function handleError(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  notify(error instanceof Error ? error.message : String(error), true);
}
setupUI();
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
  if (!state.tracker.sourceName && !state.tracker.projects.length && !state.tracker.misc.length) { notify('Open a tracker or create an item before exporting.', true); return; }
  const saveButton = $('#save-btn') as HTMLButtonElement;
  saveButton.disabled = true; saveButton.textContent = 'Exporting…';
  try {
    const blob = await exportWorkbook(state.tracker);
    const date = new Date().toISOString().slice(0, 10);
    const base = (state.tracker.sourceName || 'Projects Tracker').replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]/g, '_');
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${base} - edited ${date}.xlsx`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    setSaved(); notify('Edited workbook exported. Your original file has not been overwritten.');
  } catch (error) { handleError(error); }
  finally { saveButton.disabled = false; saveButton.textContent = '↓ Export Excel'; }
};
// Opening an installed/static site automatically tries a previously authorised browser folder,
// then the newest file copied during the build. Neither requires a server-side API.
(async () => {
  try {
    const connected = await loadConnectedFolder();
    if (connected) { await openSelection(connected); return; }
  } catch { /* The permission may have expired or the browser may not support IDB handles. */ }
  try { const bundled = await loadBuiltIn(); if (bundled) await openSelection(bundled); }
  catch { /* Empty/offline site is a valid starting state. */ }
})();

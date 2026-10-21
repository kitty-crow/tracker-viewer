import { blankTracker, type Field, type Section, type Tracker } from './types';
export interface Filter { id: number; field: Field | 'description' | 'notes' | 'all'; value: string; }
export interface State {
  tracker: Tracker; sheets: Tracker[]; activeSheet: number; section: Section | 'meeting';
  filters: Filter[]; query: string; sort: { field: Field | 'description' | 'notes'; descending: boolean } | null;
  selectedId: string | null; dirty: boolean; busy: boolean; loadingFrom: string; autosave: boolean; sourceSignature: string | null; sourceRevision: { modified: number; size: number } | null;
}
const initial = blankTracker();
export const state: State = { tracker: initial, sheets: [initial], activeSheet: 0, section: 'projects', filters: [], query: '', sort: null, selectedId: null, dirty: false, busy: false, loadingFrom: '', autosave: true, sourceSignature: null, sourceRevision: null };
export function setTrackers(trackers: Tracker[], from: string, activeSheet = trackers.length - 1, signature: string | null = null, sourceRevision: { modified: number; size: number } | null = null): void {
  if (!trackers.length) trackers = [blankTracker()];
  state.sheets = trackers; state.activeSheet = Math.max(0, Math.min(activeSheet, trackers.length - 1));
  state.tracker = trackers[state.activeSheet] ?? trackers[0] ?? blankTracker(); state.section = 'projects';
  state.query = ''; state.filters = []; state.sort = null; state.selectedId = null; state.dirty = false; state.loadingFrom = from; state.sourceSignature = signature; state.sourceRevision = sourceRevision;
}
export function selectSheet(index: number): void {
  if (index < 0 || index >= state.sheets.length) return;
  state.activeSheet = index; state.tracker = state.sheets[index] ?? state.tracker; state.selectedId = null;
}
/** Remove a weekly sheet and select the nearest surviving week. */
export function deleteSheet(index: number): boolean {
  if (state.sheets.length <= 1 || index < 0 || index >= state.sheets.length) return false;
  const previous = state.activeSheet;
  state.sheets.splice(index, 1);
  const selected = previous === index
    ? Math.min(index, state.sheets.length - 1)
    : previous > index ? previous - 1 : previous;
  selectSheet(selected);
  changed();
  return true;
}
export function changed(): void {
  state.dirty = true; window.dispatchEvent(new Event('tracker-changed'));
}
export function canDiscard(): boolean {
  return !state.dirty || window.confirm('Replace this workspace with another tracker? Export first if you need an Excel copy.');
}
window.addEventListener('beforeunload', event => {
  if (state.dirty && !state.autosave) { event.preventDefault(); event.returnValue = ''; }
});

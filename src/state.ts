import { blankTracker, type Field, type Section, type Tracker } from './types';
export interface Filter { id: number; field: Field | 'description' | 'notes' | 'all'; value: string; }
export interface State {
  tracker: Tracker; section: Section | 'meeting'; filters: Filter[]; query: string; sort: { field: Field | 'description' | 'notes'; descending: boolean } | null;
  selectedId: string | null; dirty: boolean; busy: boolean; loadingFrom: string;
}
export const state: State = { tracker: blankTracker(), section: 'projects', filters: [], query: '', sort: null, selectedId: null, dirty: false, busy: false, loadingFrom: '' };
export function setTracker(tracker: Tracker, from: string): void {
  state.tracker = tracker; state.section = 'projects'; state.query = ''; state.filters = []; state.sort = null;
  state.selectedId = null; state.dirty = false; state.loadingFrom = from;
}
export function changed(): void { state.dirty = true; }
export function canDiscard(): boolean { return !state.dirty || window.confirm('You have unsaved edits. Discard them and load another tracker?'); }
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

import { state } from './state';
import type { Tracker } from './types';
const DB = 'tracker-viewer-workspace';
const STORE = 'drafts';
const SNAPSHOT = 'latest';
const OPTION = 'tracker-viewer-autosave';
export interface Snapshot { sheets: Tracker[]; activeSheet: number; loadingFrom: string; sourceSignature?: string | null; sourceRevision?: { modified: number; size: number } | null; dirty?: boolean; }
export function autosavePreference(): boolean {
  try { return localStorage.getItem(OPTION) !== 'false'; } catch { return true; }
}
export function setAutosavePreference(enabled: boolean): void {
  state.autosave = enabled;
  try { localStorage.setItem(OPTION, String(enabled)); } catch { /* Storage may be blocked. */ }
}
async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function restoreDraft(): Promise<Snapshot | null> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(SNAPSHOT);
    request.onsuccess = () => {
      const value = request.result as Snapshot | undefined;
      resolve(value && Array.isArray(value.sheets) && value.sheets.length ? value : null);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => database.close();
  });
}
export async function saveDraft(): Promise<void> {
  const snapshot: Snapshot = structuredClone({ sheets: state.sheets, activeSheet: state.activeSheet, loadingFrom: state.loadingFrom, sourceSignature: state.sourceSignature, sourceRevision: state.sourceRevision, dirty: state.dirty });
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snapshot, SNAPSHOT);
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  });
}

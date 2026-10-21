const DB = 'tracker-viewer-folders';
const STORE = 'settings';
const KEY = 'directory';
const FILE_KEY = 'writable-file';
export interface FolderSelection { file: File; label: string; signature?: string; handle?: FileSystemFileHandle }
export interface RuntimeManifest { filename: string; modified: number; size: number; signature: string; folder: string }
/** Queries the local server afresh, rather than inspecting a build-time snapshot. */
export async function runtimeManifest(): Promise<RuntimeManifest | null> {
  const reply = await fetch('./__tracker/manifest', { cache: 'no-store' });
  if (reply.status === 404) return null;
  if (!reply.ok) throw new Error(`Tracker folder scan failed (${reply.status}).`);
  return await reply.json() as RuntimeManifest;
}
export async function loadRuntimeLatest(manifest?: RuntimeManifest): Promise<FolderSelection | null> {
  const current = manifest ?? await runtimeManifest();
  if (!current) return null;
  const response = await fetch('./__tracker/latest.xlsx', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not open latest workbook (${response.status}).`);
  const bytes = await response.blob();
  return { file: new File([bytes], current.filename, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lastModified: current.modified
  }), label: `live folder: ${current.folder}`, signature: current.signature };
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storedFolder(): Promise<FileSystemDirectoryHandle | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
async function saveFolder(folder: FileSystemDirectoryHandle): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(folder, KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
// Browser permission is explicit. Previously granted handles may work again on reopening the page.
async function canRead(handle: FileSystemDirectoryHandle, prompt: boolean): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & { queryPermission: (options: { mode: 'read' }) => Promise<PermissionState>; requestPermission: (options: { mode: 'read' }) => Promise<PermissionState> };
  if (typeof h.queryPermission !== 'function') return true;
  if (await h.queryPermission({ mode: 'read' }) === 'granted') return true;
  return prompt && (await h.requestPermission({ mode: 'read' })) === 'granted';
}
async function newest(folder: FileSystemDirectoryHandle): Promise<FolderSelection | null> {
  let latest: File | null = null;
  let selectedHandle: FileSystemFileHandle | null = null;
  // Browser File System Access API, Chromium secure contexts only.
  for await (const entry of (folder as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind !== 'file' || !/\.xlsx$/i.test(entry.name) || entry.name.startsWith('~$') || entry.name.toLowerCase() === 'latest-tracker.xlsx') continue;
    const handle = entry as FileSystemFileHandle;
    const file = await handle.getFile();
    if (!latest || file.lastModified > latest.lastModified) { latest = file; selectedHandle = handle; }
  }
  return latest ? { file: latest, label: folder.name, ...(selectedHandle ? { handle: selectedHandle } : {}) } : null;
}
export async function connectFolder(): Promise<FolderSelection | null> {
  const picker = (window as Window & { showDirectoryPicker?: (options?: { mode: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error('Folder access requires a recent Chromium-based browser (Chrome or Edge) on HTTPS or localhost. You can still open an Excel file directly.');
  const folder = await picker({ mode: 'readwrite' });
  if (!(await canRead(folder, true))) throw new Error('Folder read permission was not granted.');
  await saveFolder(folder);
  return newest(folder);
}
export async function loadConnectedFolder(prompt = false): Promise<FolderSelection | null> {
  const folder = await storedFolder();
  if (!folder || !(await canRead(folder, prompt))) return null;
  return newest(folder);
}

/** Use a real filesystem handle: the ordinary file input cannot write to its source. */
export async function chooseWritableFile(): Promise<FolderSelection | null> {
  const picker = (window as Window & {
    showOpenFilePicker?: (options?: { multiple?: boolean; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker;
  if (!picker) return null;
  const [handle] = await picker({ multiple: false, types: [{ description: 'Excel tracker', accept: {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  } }] });
  if (!handle) return null;
  const writable = handle as FileSystemFileHandle & {
    requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  const permission = typeof writable.requestPermission === 'function'
    ? await writable.requestPermission({ mode: 'readwrite' }) : 'granted';
  if (permission !== 'granted') throw new Error('Write access to the Excel workbook was not granted.');
  return { file: await handle.getFile(), handle, label: 'writable local workbook' };
}

export async function storeWritableHandle(handle: FileSystemFileHandle | null): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (handle) tx.objectStore(STORE).put(handle, FILE_KEY);
    else tx.objectStore(STORE).delete(FILE_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function recoverWritableHandle(filename: string): Promise<FileSystemFileHandle | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(FILE_KEY);
    request.onsuccess = () => {
      const handle = request.result as FileSystemFileHandle | undefined;
      resolve(handle?.name === filename ? handle : null);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function canWriteFile(handle: FileSystemFileHandle): Promise<boolean> {
  const file = handle as FileSystemFileHandle & {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  return typeof file.queryPermission !== 'function' || await file.queryPermission({ mode: 'readwrite' }) === 'granted';
}

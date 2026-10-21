import { createWriteStream } from 'node:fs';
import { copyFile, rename, rm, stat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { latestTracker, type ScannerOptions, type TrackerRecord } from './runtime-tracker.mts';

export const SAVE_PATH = '/__tracker/save';
const MAX_BYTES = 100 * 1024 * 1024;
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let writing = false;

/**
 * The browser's Origin must be the configured address or the machine's own
 * LAN IPv4 address, with the same port and request Host. This allows
 * IP=0.0.0.0 without accepting unrelated origins or DNS rebinding hosts.
 */
export function trustedOrigin(
  origin: string | undefined,
  configuredOrigin: string,
  requestHost?: string,
  interfaceAddresses?: readonly string[],
): boolean {
  if (!origin) return false;
  if (origin === configuredOrigin) return true;

  let configured: URL;
  try { configured = new URL(configuredOrigin); }
  catch { return false; }
  if (configured.protocol !== 'http:' || !configured.port) return false;

  // 127.0.0.1 and localhost are interchangeable when opening the app locally.
  if (configured.hostname === '127.0.0.1' && origin === `http://localhost:${configured.port}`) return true;
  if (configured.hostname === 'localhost' && origin === `http://127.0.0.1:${configured.port}`) return true;

  if (!requestHost) return false;
  let requested: URL;
  try { requested = new URL(`http://${requestHost}`); }
  catch { return false; }
  if (requested.port !== configured.port || isIP(requested.hostname) !== 4) return false;
  if (origin !== requested.origin) return false;
  // Only the server's own IPv4 addresses are trusted: not arbitrary private
  // addresses and not hostnames whose DNS might be rebound by another site.
  const addresses = interfaceAddresses ?? Object.values(networkInterfaces())
    .flatMap(devices => devices ?? [])
    .filter(device => device.family === 'IPv4')
    .map(device => device.address);
  return addresses.includes(requested.hostname);
}

function response(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(JSON.stringify({ error: message }));
}

function unchanged(expected: string, options: ScannerOptions): TrackerRecord | null {
  const current = latestTracker(options);
  return current?.signature === expected ? current : null;
}

/**
 * Save the generated workbook back to the actual .xlsx selected by the local
 * runtime scanner. A matching revision is mandatory: external edits are never
 * silently replaced. Each write uses a temporary sibling plus atomic rename.
 */
export async function handleSaveRequest(
  req: IncomingMessage, res: ServerResponse, options: ScannerOptions, allowedOrigin: string,
): Promise<void> {
  if (req.method !== 'PUT') { response(res, 405, 'PUT required'); return; }
  if (!trustedOrigin(req.headers.origin, allowedOrigin, req.headers.host) || req.headers['content-type']?.split(';')[0] !== MIME) {
    response(res, 403, 'Same-origin Excel write required'); return;
  }
  const encoded = req.headers['x-tracker-signature'];
  let expected: string | undefined;
  try { expected = typeof encoded === 'string' ? decodeURIComponent(encoded) : undefined; }
  catch { response(res, 400, 'Invalid source revision'); return; }
  if (!expected || typeof expected !== 'string') { response(res, 400, 'Missing source revision'); return; }
  if (writing) { response(res, 423, 'Another workbook save is in progress'); return; }
  if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES) { response(res, 413, 'Workbook exceeds 100 MB'); return; }
  writing = true;
  let temp = '';
  try {
    const selected = unchanged(expected, options);
    if (!selected) { response(res, 409, 'Source workbook was changed, moved, or superseded; reload before overwriting'); return; }
    temp = `${selected.path}.tracker-${randomUUID()}.tmp`;
    let received = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      callback(received > MAX_BYTES ? new Error('Workbook exceeds 100 MB') : null, chunk);
    } });
    await pipeline(req, limit, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    if (received < 100) { response(res, 400, 'Workbook is empty or too small'); return; }
    const check = await open(temp, 'r');
    try {
      const header = Buffer.alloc(4);
      await check.read(header, 0, 4, 0);
      if (header.toString('binary') !== 'PK\x03\x04') { response(res, 400, 'Invalid XLSX archive'); return; }
    } finally { await check.close(); }
    if (!unchanged(expected, options)) { response(res, 409, 'Source workbook changed during save'); return; }
    // Never overwrite this initial recovery copy on subsequent saves.
    try { await copyFile(selected.path, `${selected.path}.tracker-viewer-original.bak`, constants.COPYFILE_EXCL); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!unchanged(expected, options)) { response(res, 409, 'Source workbook changed during backup'); return; }
    await rename(temp, selected.path);
    temp = '';
    const result = await stat(selected.path);
    const signature = JSON.stringify([selected.filename, result.mtimeMs, result.size]);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ filename: selected.filename, signature, modified: result.mtimeMs, size: result.size }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    response(res, code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' ? 423 : 500,
      error instanceof Error ? error.message : String(error));
  } finally {
    if (temp) await rm(temp, { force: true }).catch(() => undefined);
    writing = false;
  }
}

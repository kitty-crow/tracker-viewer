import { createWriteStream, constants } from 'node:fs';
import { copyFile, open, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { trackerWithSignature, trackerDirectory, type ScannerOptions } from './runtime-tracker.mts';
import { trustedOrigin } from './save-tracker.mts';
import { verifyLayoutPreserved } from './layout-guard.mts';

export const CREATE_PATH = '/__tracker/create';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 100 * 1024 * 1024;

export function datedFilename(source: string, date: string, sequence = 1): string {
  const stem = basename(source).replace(/\.xlsx$/i, '')
    .replace(/\s*\(\d{4}-\d{2}-\d{2}\)(?:\s*\(\d+\))?$/, '');
  return `${stem} (${date})${sequence === 1 ? '' : ` (${sequence})`}.xlsx`;
}

function failure(res: ServerResponse, code: number, error: string): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(JSON.stringify({ error }));
}

/** Add a dated workbook beside the previous file without touching that file. */
export async function handleCreateRequest(
  req: IncomingMessage, res: ServerResponse, options: ScannerOptions, origin: string,
): Promise<void> {
  if (req.method !== 'POST') { failure(res, 405, 'POST required'); return; }
  if (!trustedOrigin(req.headers.origin, origin, req.headers.host) || req.headers['content-type']?.split(';')[0] !== MIME) {
    failure(res, 403, 'Same-origin Excel creation required'); return;
  }
  const isoDate = req.headers['x-tracker-date'];
  const iso = typeof isoDate === 'string' ? isoDate : '';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00.000Z`) : null;
  if (!parsed || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== iso) {
    failure(res, 400, 'Invalid creation date'); return;
  }
  let expected: string;
  try {
    const header = req.headers['x-tracker-signature'];
    expected = typeof header === 'string' ? decodeURIComponent(header) : '';
  } catch { failure(res, 400, 'Invalid source revision'); return; }
  if (!expected) { failure(res, 400, 'Source workbook revision required'); return; }
  if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES) {
    failure(res, 413, 'Workbook exceeds 100 MB'); return;
  }
  const folder = trackerDirectory(options);
  const source = trackerWithSignature(expected, options);
  if (!folder || !source || source.signature !== expected) {
    failure(res, 409, 'Selected workbook changed or moved; reload first'); return;
  }
  const temporary = join(folder, `.${randomUUID()}.tracker-create.tmp`);
  try {
    let received = 0;
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      callback(received > MAX_BYTES ? new Error('Workbook exceeds 100 MB') : null, chunk);
    } });
    await pipeline(req, limiter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (received < 100) { failure(res, 400, 'Workbook is empty'); return; }
    const reader = await open(temporary, 'r');
    try {
      const header = Buffer.alloc(4);
      await reader.read(header, 0, 4, 0);
      if (header.toString('binary') !== 'PK\x03\x04') { failure(res, 400, 'Invalid XLSX archive'); return; }
    } finally { await reader.close(); }
    await verifyLayoutPreserved(source.path, temporary);
    if (trackerWithSignature(expected, options)?.signature !== expected) {
      failure(res, 409, 'Source workbook changed during creation'); return;
    }
    for (let i = 1; i <= 999; i++) {
      const filename = datedFilename(source.filename, iso, i);
      const destination = join(folder, filename);
      try {
        await copyFile(temporary, destination, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      const info = await stat(destination);
      const signature = JSON.stringify([filename, info.mtimeMs, info.size]);
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ filename, signature, modified: info.mtimeMs, size: info.size }));
      return;
    }
    failure(res, 409, 'Too many weekly files created for this date');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const layoutError = error instanceof Error && /(?:layout changed|structure changed|package part)/i.test(error.message);
    failure(res, layoutError ? 409 : code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' ? 423 : 500,
      error instanceof Error ? error.message : String(error));
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

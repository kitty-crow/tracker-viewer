import { expect, test } from 'bun:test';
import JSZip from 'jszip';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { handleSaveRequest, SAVE_PATH, trustedOrigin } from '../scripts/save-tracker.mts';
import { latestTracker } from '../scripts/runtime-tracker.mts';

const ORIGIN = 'http://127.0.0.1:59413';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Use an actual XLSX-like ZIP structure: the writer must reject layout changes.
async function workbook(value: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheet name="Sheet2"/></workbook>');
  zip.file('xl/styles.xml', '<styleSheet><fonts count="1"/></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="D4:D4"/><sheetData><row r="4" ht="42" customHeight="1"><c r="D4" s="2" t="inlineStr"><is><t>${value}</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="D4:E4"/></mergeCells></worksheet>`);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}
const zipped = await workbook('original');

function fixture(): { root: string; workbook: string } {
  const root = mkdtempSync(join(tmpdir(), 'tracker-saving-'));
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, '.env'), 'TRACKER_FOLDER="./public"\n');
  const workbook = join(root, 'public', 'Week.xlsx');
  writeFileSync(workbook, zipped);
  return { root, workbook };
}

async function serve(root: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const app = createServer((req, res) => {
    if (new URL(req.url ?? '/', ORIGIN).pathname !== SAVE_PATH) { res.writeHead(404).end(); return; }
    void handleSaveRequest(req, res, { root, cwd: root, trackerFolder: '' }, ORIGIN);
  });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  const address = app.address();
  if (!address || typeof address === 'string') throw new Error('Test server binding failed');
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => app.close(() => resolve())) };
}

test('real XLSX is atomically updated and one original backup is created', async () => {
  const { root, workbook } = fixture();
  const server = await serve(root);
  try {
    const oldSignature = latestTracker({ root, cwd: root, trackerFolder: '' })?.signature;
    const edited = await workbook('updated');
    const headers = { Origin: 'http://localhost:59413', 'Content-Type': MIME, 'X-Tracker-Signature': encodeURIComponent(oldSignature ?? '') };
    const response = await fetch(`${server.origin}${SAVE_PATH}`, { method: 'PUT', headers, body: edited });
    expect(response.status).toBe(200);
    const saved = await response.json() as { signature: string };
    expect(readFileSync(workbook)).toEqual(edited);
    expect(readFileSync(`${workbook}.tracker-viewer-original.bak`)).toEqual(zipped);
    const rejected = await fetch(`${server.origin}${SAVE_PATH}`, { method: 'PUT', headers, body: edited });
    expect(rejected.status).toBe(409);
    const another = await fetch(`${server.origin}${SAVE_PATH}`, { method: 'PUT', headers: { ...headers, 'X-Tracker-Signature': encodeURIComponent(saved.signature) }, body: zipped });
    expect(another.status).toBe(200);
    expect(readFileSync(`${workbook}.tracker-viewer-original.bak`)).toEqual(zipped);
    expect(readdirSync(join(root, 'public')).some(file => file.endsWith('.tmp'))).toBe(false);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('an upload that changes merged ranges is refused without overwriting the original', async () => {
  const { root, workbook: filename } = fixture();
  const server = await serve(root);
  try {
    const signature = latestTracker({ root, cwd: root, trackerFolder: '' })?.signature ?? '';
    const zip = await JSZip.loadAsync(zipped);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    zip.file('xl/worksheets/sheet1.xml', sheet.replace('D4:E4', 'D4:F4'));
    const altered = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    const headers = { Origin: ORIGIN, 'Content-Type': MIME, 'X-Tracker-Signature': encodeURIComponent(signature) };
    const response = await fetch(`${server.origin}${SAVE_PATH}`, { method: 'PUT', headers, body: altered });
    expect(response.status).toBe(409);
    expect(readFileSync(filename)).toEqual(zipped);
    expect(existsSync(`${filename}.tracker-viewer-original.bak`)).toBe(false);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('cross-origin and malformed content cannot overwrite the workbook', async () => {
  const { root, workbook } = fixture();
  const server = await serve(root);
  try {
    const signature = latestTracker({ root, cwd: root, trackerFolder: '' })?.signature;
    const headers = { Origin: 'https://unrelated.example', 'Content-Type': MIME, 'X-Tracker-Signature': encodeURIComponent(signature ?? '') };
    const denied = await fetch(`${server.origin}${SAVE_PATH}`, { method: 'PUT', headers, body: zipped });
    expect(denied.status).toBe(403);
    const malformed = await fetch(`${server.origin}${SAVE_PATH}`, { method: 'PUT', headers: { ...headers, Origin: ORIGIN }, body: Buffer.alloc(200) });
    expect(malformed.status).toBe(400);
    expect(readFileSync(workbook)).toEqual(zipped);
    expect(existsSync(`${workbook}.tracker-viewer-original.bak`)).toBe(false);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('save origin guard accepts only configured address and its loopback alias on the same port', () => {
  expect(trustedOrigin('http://localhost:59413', ORIGIN)).toBe(true);
  expect(trustedOrigin(ORIGIN, ORIGIN)).toBe(true);
  expect(trustedOrigin('http://127.0.0.1:59413', 'http://localhost:59413')).toBe(true);
  expect(trustedOrigin('http://localhost:59414', ORIGIN)).toBe(false);
  expect(trustedOrigin('http://unrelated.example:59413', ORIGIN)).toBe(false);
  expect(trustedOrigin('https://localhost:59413', ORIGIN)).toBe(false);
  expect(trustedOrigin(undefined, ORIGIN)).toBe(false);
  expect(trustedOrigin('http://localhost:59413', 'http://192.168.1.42:59413')).toBe(false);
});

test('LAN clients may save via a local interface address when the listener binds 0.0.0.0', () => {
  const assigned = ['127.0.0.1', '192.168.50.149', '10.8.0.6'];
  const viaLan = 'http://192.168.50.149:59413';
  expect(trustedOrigin(viaLan, ORIGIN, '192.168.50.149:59413', assigned)).toBe(true);
  expect(trustedOrigin('http://10.8.0.6:59413', ORIGIN, '10.8.0.6:59413', assigned)).toBe(true);
  expect(trustedOrigin(viaLan, ORIGIN, '192.168.50.149:59414', assigned)).toBe(false);
  expect(trustedOrigin(viaLan, ORIGIN, '192.168.50.148:59413', assigned)).toBe(false);
  expect(trustedOrigin('http://192.168.50.148:59413', ORIGIN, '192.168.50.148:59413', assigned)).toBe(false);
  expect(trustedOrigin('http://malicious.example:59413', ORIGIN, 'malicious.example:59413', assigned)).toBe(false);
  expect(trustedOrigin('http://192.168.50.149:59414', ORIGIN, '192.168.50.149:59414', assigned)).toBe(false);
  expect(trustedOrigin('https://192.168.50.149:59413', ORIGIN, '192.168.50.149:59413', assigned)).toBe(false);
  expect(trustedOrigin(undefined, ORIGIN, '192.168.50.149:59413', assigned)).toBe(false);
});

import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { handleSaveRequest, SAVE_PATH, trustedOrigin } from '../scripts/save-tracker.mts';
import { latestTracker } from '../scripts/runtime-tracker.mts';

const ORIGIN = 'http://127.0.0.1:59413';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// The writer validates the PK zip header; XLSX generation itself runs in the browser.
const zipped = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(256, 42)]);

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
    const edited = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(390, 33)]);
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

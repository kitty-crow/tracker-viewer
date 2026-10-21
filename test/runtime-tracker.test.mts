import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createServer } from 'node:http';
import { latestTracker, folderTrackers, trackerDirectory, handleTrackerRequest } from '../scripts/runtime-tracker.mts';

test('discovers a workbook after launch and switches to the latest without rebuilding', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-runtime-'));
  try {
    const folder = join(root, 'public');
    mkdirSync(folder);
    writeFileSync(join(root, '.env'), 'TRACKER_FOLDER="./public"\n');
    expect(latestTracker({ root, cwd: root, trackerFolder: '' })).toBeNull();
    const first = join(folder, 'Weekly Projects Tracker (2026-10-19).xlsx');
    writeFileSync(first, 'week one');
    expect(latestTracker({ root, cwd: root, trackerFolder: '' })?.filename).toBe(basename(first));
    const second = join(folder, 'Weekly Projects Tracker (2026-10-26).xlsx');
    writeFileSync(second, 'week two');
    const later = new Date(Date.now() + 120000);
    utimesSync(second, later, later);
    writeFileSync(join(folder, '~$Temp.xlsx'), 'Excel lock');
    writeFileSync(join(folder, 'latest-tracker.xlsx'), 'old snapshot');
    expect(latestTracker({ root, cwd: root, trackerFolder: '' })?.filename).toBe(basename(second));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolves a relative tracker folder against the location of its .env', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-config-'));
  try {
    mkdirSync(join(root, 'trackers'));
    writeFileSync(join(root, '.env'), 'TRACKER_FOLDER="./trackers"\n');
    expect(trackerDirectory({ root, cwd: root, trackerFolder: '' })).toBe(join(root, 'trackers'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prefers .env beside the executable and supports public beside the EXE', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-exe-'));
  try {
    const exeDir = join(root, 'release');
    mkdirSync(exeDir);
    mkdirSync(join(exeDir, 'public'));
    expect(trackerDirectory({ exeDir, cwd: root, trackerFolder: '' })).toBe(join(exeDir, 'public'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('finds project public workbook when executable runs from release directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-release-'));
  try {
    const exeDir = join(root, 'release');
    const publicDir = join(root, 'public');
    mkdirSync(exeDir);
    mkdirSync(publicDir);
    writeFileSync(join(root, '.env'), 'TRACKER_FOLDER="./public"\n');
    writeFileSync(join(publicDir, 'Weekly.xlsx'), 'workbook');
    expect(latestTracker({ root: exeDir, exeDir, cwd: exeDir, trackerFolder: '' })?.filename)
      .toBe('Weekly.xlsx');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('folder API lists every XLSX and opens the explicitly selected older workbook', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-folder-list-'));
  const server = createServer((req, res) => {
    if (!handleTrackerRequest(req, res, { root, cwd: root, trackerFolder: '' })) res.writeHead(404).end();
  });
  try {
    const dir = join(root, 'public');
    mkdirSync(dir);
    writeFileSync(join(root, '.env'), 'TRACKER_FOLDER="./public"\n');
    writeFileSync(join(dir, 'Week (2026-10-19).xlsx'), 'previous week');
    writeFileSync(join(dir, 'Week (2026-10-21).xlsx'), 'current week');
    writeFileSync(join(dir, '~$Temporary.xlsx'), 'lock');
    const oldDate = new Date('2026-10-19T12:00:00Z');
    const newDate = new Date('2026-10-21T12:00:00Z');
    utimesSync(join(dir, 'Week (2026-10-19).xlsx'), oldDate, oldDate);
    utimesSync(join(dir, 'Week (2026-10-21).xlsx'), newDate, newDate);
    const records = folderTrackers({ root, cwd: root, trackerFolder: '' });
    expect(records.map(item => item.filename)).toEqual([
      'Week (2026-10-21).xlsx', 'Week (2026-10-19).xlsx',
    ]);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test listener not ready');
    const base = `http://127.0.0.1:${address.port}`;
    const listing = await fetch(`${base}/__tracker/files`);
    expect(listing.status).toBe(200);
    const files = await listing.json() as { filename: string; signature: string }[];
    expect(files).toHaveLength(2);
    const previous = files[1]!;
    const params = new URLSearchParams({ name: previous.filename, signature: previous.signature });
    const fetched = await fetch(`${base}/__tracker/file?${params}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe('previous week');
    const stale = await fetch(`${base}/__tracker/file?name=${encodeURIComponent(previous.filename)}&signature=old`);
    expect(stale.status).toBe(409);
    const missing = await fetch(`${base}/__tracker/file?name=${encodeURIComponent('../outside.xlsx')}&signature=old`);
    expect(missing.status).toBe(404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

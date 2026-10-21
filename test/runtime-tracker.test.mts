import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { latestTracker, trackerDirectory } from '../scripts/runtime-tracker.mts';

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
    writeFileSync(join(root, '.env'), 'TRACKER_FOLDER="./public"\\n');
    writeFileSync(join(publicDir, 'Weekly.xlsx'), 'workbook');
    expect(latestTracker({ root: exeDir, exeDir, cwd: exeDir, trackerFolder: '' })?.filename)
      .toBe('Weekly.xlsx');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

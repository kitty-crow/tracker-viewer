import { expect, test } from 'bun:test';
import { shortcutContents, viewerProcessNames } from '../scripts/windows-control.mts';

test('shortcut is a Windows .url file that opens the local tracker URL', () => {
  expect(shortcutContents('http://127.0.0.1:59413/')).toBe('[InternetShortcut]\r\nURL=http://127.0.0.1:59413/\r\n');
});

test('renaming the new build does not prevent replacement of the canonical TrackerViewer.exe', () => {
  expect(viewerProcessNames('/downloads/TrackerViewer-new.exe')).toEqual([
    'trackerviewer.exe', 'trackerviewer-new.exe',
  ]);
  expect(viewerProcessNames('/release/TrackerViewer.exe')).toEqual(['trackerviewer.exe']);
  expect(viewerProcessNames('/release/TRACKERVIEWER-TEST.EXE')).toContain('trackerviewer.exe');
  expect(viewerProcessNames('/release/TRACKERVIEWER-TEST.EXE')).toContain('trackerviewer-test.exe');
});

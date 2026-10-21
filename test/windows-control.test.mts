import { expect, test } from 'bun:test';
import { shortcutContents } from '../scripts/windows-control.mts';

test('shortcut is a Windows .url file that opens the local tracker URL', () => {
  expect(shortcutContents('http://127.0.0.1:59413/')).toBe('[InternetShortcut]\r\nURL=http://127.0.0.1:59413/\r\n');
});

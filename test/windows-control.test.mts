import { expect, test } from 'bun:test';
import { shortcutContents, portTakeoverScript } from '../scripts/windows-control.mts';

test('shortcut is a Windows .url file that opens the local tracker URL', () => {
  expect(shortcutContents('http://127.0.0.1:59413/')).toBe('[InternetShortcut]\r\nURL=http://127.0.0.1:59413/\r\n');
});

test('port takeover stops the actual listener PID regardless of executable filename', () => {
  const script = portTakeoverScript(59413, 123456);
  expect(script).toContain('$port = 59413');
  expect(script).toContain('$ourPid = 123456');
  expect(script).toContain('Get-NetTCPConnection -LocalPort $port -State Listen');
  expect(script).toContain('Stop-Process -Id $ownerPid -Force');
  expect(script).toContain('$ownerPid -eq $ourPid');
  expect(script).toContain('$protected');
  expect(script).not.toContain('$allowedNames');
});

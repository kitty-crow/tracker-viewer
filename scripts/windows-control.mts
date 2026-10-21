import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Identify the PID listening on our local port, then verify its executable name
 * before terminating it. A different service must never be killed by accident.
 */
export function replaceExistingViewer(port: number, executable: string): void {
  if (process.platform !== 'win32' || !Bun.isStandaloneExecutable) return;
  const expected = basename(executable).toLowerCase();
  const script = `
$ErrorActionPreference = 'Stop'
$port = ${port}
$expected = ${psLiteral(expected)}
$ourPid = ${process.pid}
$connections = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
$owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($ownerPid in $owners) {
  if ($ownerPid -eq $ourPid) { continue }
  $processInfo = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction Stop
  if ($null -eq $processInfo) { continue }
  if ($processInfo.Name -ine $expected) {
    [Console]::Error.WriteLine("Port $port belongs to $($processInfo.Name), not TrackerViewer.exe. Refusing to terminate it.")
    exit 3
  }
  Stop-Process -Id $ownerPid -Force -ErrorAction Stop
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $remaining = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if ($remaining.Count -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 200
}
[Console]::Error.WriteLine("Port $port was not released after stopping the old TrackerViewer instance.")
exit 4
`;
  const run = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(run.stderr?.trim() || `Port replacement failed (exit code ${run.status ?? 'unknown'}).`);
}

export function shortcutContents(url: string): string {
  return `[InternetShortcut]\r\nURL=${url}\r\n`;
}

/** Create a real Windows Internet Shortcut, then OPEN THE FILE via ShellExecute. */
export function openShortcut(executable: string, url: string, report: (error: unknown) => void): void {
  if (process.platform !== 'win32') return;
  const home = dirname(executable);
  let filename = join(home, 'TrackerViewer.url');
  try { writeFileSync(filename, shortcutContents(url), 'utf8'); }
  catch (error) {
    report(error);
    const fallbackDir = join(process.env.LOCALAPPDATA ?? tmpdir(), 'TrackerViewer');
    try { mkdirSync(fallbackDir, { recursive: true }); }
    catch (failure) { report(failure); return; }
    filename = join(fallbackDir, 'TrackerViewer.url');
    try { writeFileSync(filename, shortcutContents(url), 'utf8'); }
    catch (failure) { report(failure); return; }
  }

  // Start-Process invokes the .url FILE association, not a command that opens the URL directly.
  const script = `Start-Process -FilePath ${psLiteral(filename)} -ErrorAction Stop`;
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-Command', script,
  ], { windowsHide: true, detached: true, stdio: 'ignore' });
  let triedFallback = false;
  const fallback = (): void => {
    if (triedFallback) return;
    triedFallback = true;
    const explorer = spawn('explorer.exe', [filename], { windowsHide: true, detached: true, stdio: 'ignore' });
    explorer.on('error', report);
    explorer.unref();
  };
  child.on('error', error => { report(error); fallback(); });
  child.on('exit', code => { if (code !== 0) fallback(); });
  child.unref();
}

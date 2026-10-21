import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The configured port belongs to Tracker Viewer, regardless of what the old
 * executable was called. Resolve actual TCP listeners rather than image names.
 * Never terminate our own PID or a core Windows service process.
 */
export function portTakeoverScript(port: number, ownPid: number): string {
  return `
$ErrorActionPreference = 'Stop'
$port = ${port}
$ourPid = ${ownPid}
$protected = @('idle', 'system', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost')
$connections = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
$owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($ownerPid in $owners) {
  if ($ownerPid -eq $ourPid) { continue }
  if ($ownerPid -le 4) {
    [Console]::Error.WriteLine("Port $port belongs to protected Windows PID $ownerPid.")
    exit 3
  }
  $owner = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  if ($null -eq $owner) { continue }
  if ($owner.ProcessName.ToLowerInvariant() -in $protected) {
    [Console]::Error.WriteLine("Port $port belongs to protected Windows process $($owner.ProcessName) (PID $ownerPid).")
    exit 3
  }
  Stop-Process -Id $ownerPid -Force -ErrorAction Stop
  [Console]::Out.WriteLine("Stopped $($owner.ProcessName) (PID $ownerPid) listening on port $port.")
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  $remaining = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -ne $ourPid })
  if ($remaining.Count -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 200
}
[Console]::Error.WriteLine("Port $port remains occupied after stopping its previous listener.")
exit 4
`;
}

/** Reclaim the configured port, not arbitrary processes by filename. */
export function replaceExistingViewer(port: number, _executable: string): void {
  if (process.platform !== 'win32' || !Bun.isStandaloneExecutable) return;
  const run = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    portTakeoverScript(port, process.pid),
  ], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(run.stderr?.trim() || `Unable to release port ${port} (exit ${run.status ?? 'unknown'}).`);
}

/**
 * Stop only a currently running binary whose full path exactly matches the
 * release target. Windows prevents Bun from overwriting an executing EXE.
 */
export function stopRunningRelease(executable: string): void {
  if (process.platform !== 'win32') return;
  const script = `
$ErrorActionPreference = 'Stop'
$target = ${psLiteral(executable)}
$name = ${psLiteral(basename(executable))}
$filter = "Name = '$name'"
$running = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop | Where-Object { $_.ExecutablePath -ieq $target })
foreach ($item in $running) { Stop-Process -Id $item.ProcessId -Force -ErrorAction Stop }
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  $remaining = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop | Where-Object { $_.ExecutablePath -ieq $target })
  if ($remaining.Count -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 150
}
[Console]::Error.WriteLine('The previous Tracker Viewer instance did not exit.')
exit 5
`;
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(
    result.stderr?.trim() || `Unable to stop running release executable (exit ${result.status ?? 'unknown'}).`,
  );
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

import { createServer } from 'node:http';
import { createReadStream, existsSync, appendFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { handleTrackerRequest } from './runtime-tracker.mts';

const hostname = '127.0.0.1';
const port = Number(process.env.PORT ?? 59413);
const executableDir = dirname(process.execPath);
const standalone = Bun.isStandaloneExecutable;
const appRoot = standalone ? executableDir : resolve(import.meta.dir, '..');
const distRoot = standalone ? resolve(import.meta.dir, 'dist') : resolve(appRoot, 'dist');
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function reportFailure(error: unknown): void {
  const message = `${new Date().toISOString()} ${String(error)}\n`;
  try { appendFileSync(join(executableDir, 'TrackerViewer.log'), message); }
  catch { /* The executable might be installed in a read-only directory. */ }
  console.error(message);
}

function fallbackBrowser(url: string): void {
  const child = spawn('explorer.exe', [url], { windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('error', reportFailure);
  child.on('exit', code => { if (code !== 0) reportFailure(new Error(`Explorer browser launch returned ${code}`)); });
  child.unref();
}

function openBrowser(url: string): void {
  if (process.platform !== 'win32') return;
  // Start-Process uses the Windows URL association, so the user's default browser opens.
  // Unlike "cmd /c start", a failed launch provides an exit code for fallback.
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-Command', `Start-Process -FilePath '${url}'`,
  ], { windowsHide: true, detached: true, stdio: 'ignore' });
  let fallbackStarted = false;
  const fallback = (): void => {
    if (fallbackStarted) return;
    fallbackStarted = true;
    fallbackBrowser(url);
  };
  child.on('error', error => { reportFailure(error); fallback(); });
  child.on('exit', code => { if (code !== 0) fallback(); });
  child.unref();
}

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TCP port');

// Only this application's same-origin page may request shutdown.
// JSON-only POST prevents an unrelated website from submitting a form to quit.
function handleAppRequest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  let pathname: string;
  try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; }
  catch { return false; }
  if (pathname === '/__app/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ canQuit: standalone }));
    return true;
  }
  if (pathname !== '/__app/quit') return false;
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return true; }
  const sameOrigin = req.headers.origin === `http://${hostname}:${port}`;
  const json = req.headers['content-type']?.split(';')[0] === 'application/json';
  if (!sameOrigin || !json) { res.writeHead(403).end('Forbidden'); return true; }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end('{"stopping":true}');
  res.once('finish', () => {
    server.close();
    setTimeout(() => process.exit(0), 200).unref();
  });
  return true;
}

const server = createServer((req, res) => {
  if (handleAppRequest(req, res)) return;
  if (handleTrackerRequest(req, res, standalone ? { root: appRoot, exeDir: executableDir } : { root: appRoot })) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', `http://${hostname}`).pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  const target = resolve(distRoot, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
  if (target !== distRoot && !target.startsWith(`${distRoot}${sep}`)) { res.writeHead(403).end(); return; }
  if (!existsSync(target) || !statSync(target).isFile()) { res.writeHead(404).end('Not found'); return; }
  const info = statSync(target);
  res.writeHead(200, { 'Content-Type': mime[extname(target).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target).pipe(res);
});
server.on('error', error => { reportFailure(error); process.exitCode = 1; });
server.listen(port, hostname, () => {
  const url = `http://${hostname}:${port}/`;
  console.log(`Tracker Viewer: ${url}`);
  openBrowser(url);
});

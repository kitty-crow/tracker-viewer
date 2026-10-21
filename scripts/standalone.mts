import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, appendFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { handleTrackerRequest } from './runtime-tracker.mts';
import { openShortcut, replaceExistingViewer } from './windows-control.mts';
import { listenerConfig } from './server-config.mts';
import { handleSaveRequest, SAVE_PATH, trustedOrigin } from './save-tracker.mts';
import { handleCreateRequest, CREATE_PATH } from './create-tracker.mts';

const executableDir = dirname(process.execPath);
const standalone = Bun.isStandaloneExecutable;
const appRoot = standalone ? executableDir : resolve(import.meta.dir, '..');
const settings = listenerConfig(standalone ? { exeDir: executableDir, appRoot } : { appRoot });
const hostname = settings.ip;
const port = settings.port;
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

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TCP port');

// Compile.assets embeds the dist directory. Reading Bun.embeddedFiles is more
// reliable on Windows than guessing a virtual filesystem root for Bun's EXE.
// Bun may type embedded assets as Blob rather than File. Check the filename
// property before treating an asset as a named, addressable website file.
const embeddedFiles = standalone
  ? Bun.embeddedFiles.filter((file): file is Blob & { readonly name: string } =>
      'name' in file && typeof file.name === 'string')
  : [];
function embeddedAsset(name: string): Blob | null {
  const match = embeddedFiles.filter(blob => {
    const path = blob.name.replaceAll('\\', '/').replace(/^\/+/, '');
    return path === name || path === `dist/${name}` || path.endsWith(`/dist/${name}`);
  });
  if (match.length === 1) return match[0] ?? null;
  // Some Bun versions flatten asset names. Only use the basename when unique.
  const filename = name.split('/').at(-1) ?? name;
  const fallback = embeddedFiles.filter(blob => blob.name.split(/[\\/]/).at(-1) === filename);
  return fallback.length === 1 ? fallback[0] ?? null : null;
}

function serveEmbedded(req: IncomingMessage, res: ServerResponse, relative: string): void {
  const asset = embeddedAsset(relative);
  if (!asset) { res.writeHead(404).end('Embedded file not found'); return; }
  res.writeHead(200, {
    'Content-Type': mime[extname(relative).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': asset.size,
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  void asset.arrayBuffer().then(bytes => res.end(Buffer.from(bytes)))
    .catch(error => { reportFailure(error); res.destroy(); });
}

// Only this application's same-origin page may request shutdown.
// JSON-only POST prevents an unrelated website from submitting a form to quit.
function handleAppRequest(req: IncomingMessage, res: ServerResponse): boolean {
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
  const sameOrigin = trustedOrigin(req.headers.origin, new URL(settings.browserUrl).origin, req.headers.host);
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
  if (new URL(req.url ?? '/', settings.browserUrl).pathname === CREATE_PATH) {
    void handleCreateRequest(req, res, standalone ? { root: appRoot, exeDir: executableDir } : { root: appRoot }, new URL(settings.browserUrl).origin);
    return;
  }
  if (new URL(req.url ?? '/', settings.browserUrl).pathname === SAVE_PATH) {
    void handleSaveRequest(req, res, standalone ? { root: appRoot, exeDir: executableDir } : { root: appRoot }, new URL(settings.browserUrl).origin);
    return;
  }
  if (handleAppRequest(req, res)) return;
  if (handleTrackerRequest(req, res, standalone ? { root: appRoot, exeDir: executableDir } : { root: appRoot })) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', `http://${hostname}`).pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  if (pathname.split('/').includes('..')) { res.writeHead(403).end('Forbidden'); return; }
  const resource = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const relative = resource.replace(/^\/+/, '');
  if (standalone) { serveEmbedded(req, res, relative); return; }
  const target = resolve(distRoot, `./${relative}`);
  if (target !== distRoot && !target.startsWith(`${distRoot}${sep}`)) { res.writeHead(403).end(); return; }
  if (!existsSync(target) || !statSync(target).isFile()) { res.writeHead(404).end('Not found'); return; }
  const info = statSync(target);
  res.writeHead(200, { 'Content-Type': mime[extname(target).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target).pipe(res);
});

const maxPortRetries = 3;
let portRetries = 0;

function isPortCollision(error: unknown): boolean {
  const typed = error as { code?: string; message?: string };
  return typed?.code === 'EADDRINUSE' || /port\s*\d+\s+in\s+use|address already in use|failed to start server/i.test(typed?.message ?? String(error));
}

function onStarted(): void {
  const url = settings.browserUrl;
  console.log(`Tracker Viewer: ${url}`);
  if (standalone && !embeddedAsset('index.html')) {
    reportFailure(new Error(`No embedded index.html found. Embedded asset names: ${embeddedFiles.map(file => file.name).join(', ')}`));
  }
  if (standalone) openShortcut(process.execPath, url, reportFailure);
}
function startListening(): void {
  try { server.listen(port, hostname, onStarted); }
  catch (error) { handleListenFailure(error); }
}
function handleListenFailure(error: unknown): void {
  if (!standalone || process.platform !== 'win32' || !isPortCollision(error) || portRetries >= maxPortRetries) {
    reportFailure(new Error(`Unable to start Tracker Viewer at ${hostname}:${port}: ${String(error)}`));
    process.exit(1);
  }
  portRetries++;
  try { replaceExistingViewer(port, process.execPath); }
  catch (replacementError) { reportFailure(replacementError); process.exit(1); }
  setTimeout(startListening, 250);
}
server.on('error', handleListenFailure);
try { replaceExistingViewer(port, process.execPath); }
catch (error) { reportFailure(error); process.exit(1); }
startListening();

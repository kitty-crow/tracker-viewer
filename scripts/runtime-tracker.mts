import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, basename } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const MANIFEST_PATH = '/__tracker/manifest';
export const LATEST_PATH = '/__tracker/latest.xlsx';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ScannerOptions {
  root?: string;
  exeDir?: string;
  cwd?: string;
  trackerFolder?: string;
}
export interface TrackerRecord {
  path: string;
  filename: string;
  modified: number;
  size: number;
  folder: string;
  signature: string;
}

function candidates(options: ScannerOptions): string[] {
  const names = [options.exeDir, options.exeDir ? dirname(options.exeDir) : undefined, options.root, options.cwd ?? process.cwd()];
  return [...new Set(names.filter((name): name is string => Boolean(name)).map(name => resolve(name)))];
}

function readSetting(root: string): string | null {
  const filename = join(root, '.env');
  if (!existsSync(filename)) return null;
  const content = readFileSync(filename, 'utf8');
  const match = content.split(/\r?\n/).map(line => line.match(/^\s*(?:export\s+)?TRACKER_FOLDER\s*=\s*(.*?)\s*$/)).find(Boolean);
  return match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? null;
}

export function trackerDirectory(options: ScannerOptions = {}): string | null {
  const roots = candidates(options);
  const setting = options.trackerFolder ?? process.env.TRACKER_FOLDER;
  if (setting?.trim()) {
    const configuredRoot = roots.find(root => readSetting(root) === setting) ?? options.root ?? roots[0] ?? process.cwd();
    return isAbsolute(setting) ? setting : resolve(configuredRoot, setting);
  }
  const config = roots.map(root => ({ root, setting: readSetting(root) })).find(value => value.setting !== null);
  if (config?.setting?.trim()) return isAbsolute(config.setting) ? config.setting : resolve(config.root, config.setting);
  const fallback = roots.map(root => join(root, 'public')).find(folder => existsSync(folder) && statSync(folder).isDirectory());
  return fallback ?? null;
}

export function latestTracker(options: ScannerOptions = {}): TrackerRecord | null {
  const folder = trackerDirectory(options);
  if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) return null;
  const files = readdirSync(folder, { withFileTypes: true })
    .filter(file => file.isFile() && /\.xlsx$/i.test(file.name) && !file.name.startsWith('~$') && file.name.toLowerCase() !== 'latest-tracker.xlsx')
    .map(file => {
      const path = join(folder, file.name);
      const info = statSync(path);
      return { path, filename: file.name, modified: info.mtimeMs, size: info.size };
    })
    .sort((a, b) => b.modified - a.modified || a.filename.localeCompare(b.filename));
  const latest = files[0];
  if (!latest) return null;
  return { ...latest, folder: basename(folder), signature: JSON.stringify([latest.filename, latest.modified, latest.size]) };
}

export function handleTrackerRequest(req: IncomingMessage, res: ServerResponse, options: ScannerOptions = {}): boolean {
  let pathname: string;
  try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; }
  catch { return false; }
  if (pathname !== MANIFEST_PATH && pathname !== LATEST_PATH) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return true; }
  let tracker: TrackerRecord | null;
  try { tracker = latestTracker(options); }
  catch { res.writeHead(500, { 'Cache-Control': 'no-store' }).end('Unable to scan tracker folder'); return true; }
  if (!tracker) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end('No tracker found'); return true; }
  if (pathname === MANIFEST_PATH) {
    const payload = JSON.stringify(tracker);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : payload);
    return true;
  }
  res.writeHead(200, { 'Content-Type': MIME, 'Content-Length': tracker.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') { res.end(); return true; }
  const stream = createReadStream(tracker.path);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}

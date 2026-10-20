'use strict';
// Shared by the TypeScript server, Vite development server and embedded Windows executable.
const fs = require('node:fs');
const path = require('node:path');

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MANIFEST = '/__tracker/manifest';
const LATEST = '/__tracker/latest.xlsx';

function readSetting(file) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const found = line.match(/^\s*(?:export\s+)?TRACKER_FOLDER\s*=\s*(.*?)\s*$/);
    if (found) return found[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return null;
}

function directories(options = {}) {
  const candidates = [options.root, process.cwd(), options.exeDir, options.exeDir && path.dirname(options.exeDir)]
    .filter(Boolean).map(value => path.resolve(value));
  return [...new Set(candidates)];
}

function configuredFolder(options = {}) {
  const roots = directories(options);
  let configRoot = roots[0];
  let setting = process.env.TRACKER_FOLDER;
  if (setting === undefined) {
    for (const base of roots) {
      const read = readSetting(path.join(base, '.env'));
      if (read !== null) { setting = read; configRoot = base; break; }
    }
  }
  if (setting && setting.trim()) {
    const folder = path.isAbsolute(setting) ? setting : path.resolve(configRoot, setting);
    return { folder, configured: true };
  }
  for (const base of roots) {
    const folder = path.join(base, 'public');
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) return { folder, configured: false };
  }
  return null;
}

function latestTracker(options = {}) {
  const setting = configuredFolder(options);
  if (!setting) return null;
  if (!fs.existsSync(setting.folder) || !fs.statSync(setting.folder).isDirectory()) return null;
  const files = fs.readdirSync(setting.folder, { withFileTypes: true })
    .filter(file => file.isFile() && /\.xlsx$/i.test(file.name) && !file.name.startsWith('~$') && file.name.toLowerCase() !== 'latest-tracker.xlsx')
    .map(file => {
      const filename = path.join(setting.folder, file.name);
      const info = fs.statSync(filename);
      return {filename, name: file.name, modified: info.mtimeMs, size: info.size};
    })
    .sort((a,b) => b.modified-a.modified || a.name.localeCompare(b.name));
  if (!files.length) return null;
  const newest = files[0];
  return {...newest, folder: path.basename(setting.folder), signature: JSON.stringify([newest.name, newest.modified, newest.size])};
}

function handleRequest(request, response, options = {}) {
  let pathname;
  try { pathname = new URL(request.url || '/', 'http://localhost').pathname; }
  catch { return false; }
  if (pathname !== MANIFEST && pathname !== LATEST) return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {'Allow':'GET, HEAD'}).end();
    return true;
  }
  let tracker;
  try { tracker = latestTracker(options); }
  catch (error) {
    response.writeHead(500, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('Could not read tracker folder.');
    console.error('Tracker folder error:', error);
    return true;
  }
  if (!tracker) {
    response.writeHead(404, {'Cache-Control':'no-store'}).end('No .xlsx tracker in the configured folder.');
    return true;
  }
  if (pathname === MANIFEST) {
    const result = JSON.stringify({ filename:tracker.name, modified:tracker.modified, size:tracker.size, signature:tracker.signature, folder:tracker.folder });
    response.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(result),'Cache-Control':'no-store'});
    response.end(request.method === 'HEAD' ? undefined : result);
    return true;
  }
  response.writeHead(200, {'Content-Type':MIME, 'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(tracker.name)}`, 'Content-Length':tracker.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  if (request.method === 'HEAD') response.end();
  else {
    const stream=fs.createReadStream(tracker.filename);
    stream.on('error', error => { console.error('Tracker read error:', error); response.destroy(error); });
    stream.pipe(response);
  }
  return true;
}
module.exports = { configuredFolder, latestTracker, handleRequest };

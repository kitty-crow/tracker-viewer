import { existsSync, readdirSync, readFileSync, copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const publicDir = join(root, 'public');
const destination = join(publicDir, 'latest-tracker.xlsx');
const manifest = join(publicDir, 'tracker-manifest.json');
mkdirSync(publicDir, { recursive: true });
const envPath = join(root, '.env');
if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*?)\s*$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
const setting = process.env.TRACKER_FOLDER?.trim();
if (!setting) { rmSync(destination, { force: true }); rmSync(manifest, { force: true }); console.log('No TRACKER_FOLDER: site will start with an empty workspace or a browser-connected folder.'); process.exit(0); }
const folder = isAbsolute(setting) ? setting : resolve(root, setting);
if (!existsSync(folder) || !statSync(folder).isDirectory()) { console.error(`TRACKER_FOLDER does not exist: ${folder}`); process.exitCode = 1; process.exit(); }
const files = readdirSync(folder).filter(name => /\.xlsx$/i.test(name) && !name.startsWith('~$')).map(name => ({ name, path: join(folder, name) })).filter(item => statSync(item.path).isFile()).sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);
if (!files.length) { rmSync(destination, { force: true }); rmSync(manifest, { force: true }); console.log('No .xlsx trackers found in TRACKER_FOLDER.'); process.exit(0); }
// Read the entire source first so an overlapping source/destination can never be truncated.
const newest = files[0];
if (resolve(newest.path) !== resolve(destination)) copyFileSync(newest.path, destination);
writeFileSync(manifest, JSON.stringify({ filename: newest.name, modified: statSync(newest.path).mtime.toISOString() }));
console.log(`Bundled latest tracker: ${newest.name}`);

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { stopRunningRelease } from './windows-control.mts';

const root = resolve(import.meta.dir, '..');
const dist = resolve(root, 'dist');
const release = resolve(root, 'release');
if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build the frontend before packaging the executable.');
mkdirSync(release, { recursive: true });
const executable = resolve(release, 'TrackerViewer.exe');
// Only Windows locks a running executable. The helper returns immediately on Linux/WSL.
stopRunningRelease(executable);
const result = await Bun.build({
  entrypoints: [resolve(root, 'scripts', 'standalone.mts')],
  compile: {
    // Cross-compile to Windows from native Windows or Linux/WSL.
    target: 'bun-windows-x64',
    outfile: executable,
    assets: [dist],
    windows: process.platform === 'win32'
      ? {
          hideConsole: true,
          title: 'Tracker Viewer',
          description: 'Local weekly project tracker',
          version: '1.0.0',
        }
      : { hideConsole: true },
  },
  // Vite already fingerprints assets. Avoid a second hash on embedded filenames.
  naming: { asset: '[name].[ext]' },
  minify: true,
  target: 'bun',
});
if (!result.success) throw new Error(`Bun executable build failed: ${result.logs.map(log => log.message).join('; ')}`);
console.log('Created release/TrackerViewer.exe, with its Bun runtime and frontend embedded and console hidden.');

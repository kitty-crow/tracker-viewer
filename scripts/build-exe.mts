import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const dist = resolve(root, 'dist');
const release = resolve(root, 'release');
if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build the frontend before packaging the executable.');
if (process.platform !== 'win32') {
  console.log('Standalone Windows executable is packaged on Windows; static frontend build completed.');
  process.exit(0);
}
mkdirSync(release, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(root, 'scripts', 'standalone.mts')],
  compile: {
    outfile: resolve(release, 'TrackerViewer.exe'),
    assets: [dist],
    windows: {
      hideConsole: true,
      title: 'Tracker Viewer',
      description: 'Local weekly project tracker',
      version: '1.0.0',
    },
  },
  // Vite already fingerprints assets. Avoid a second hash on embedded filenames.
  naming: { asset: '[name].[ext]' },
  minify: true,
  target: 'bun',
});
if (!result.success) throw new Error(`Bun executable build failed: ${result.logs.map(log => log.message).join('; ')}`);
console.log('Created release/TrackerViewer.exe, with its Bun runtime and frontend embedded and console hidden.');

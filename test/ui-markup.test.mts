import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('the HTML provides every statically referenced UI element', () => {
  const root = resolve(import.meta.dir, '..');
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const ui = readFileSync(resolve(root, 'src', 'ui.ts'), 'utf8');
  const main = readFileSync(resolve(root, 'src', 'main.ts'), 'utf8');
  const ids = new Set([...html.matchAll(/\\bid="([^"]+)"/g), ...ui.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1]));
  const refs = [...ui.matchAll(/\\$\\(['"]#([a-z][\\w-]*)['"]\\)/gi), ...main.matchAll(/\\$\\(['"]#([a-z][\\w-]*)['"]\\)/gi)];
  const missing = [...new Set(refs.map(match => match[1] ?? '').filter(id => !ids.has(id)))];
  expect(missing).toEqual([]);
  expect(html).toContain('id="delete-sheet"');
});

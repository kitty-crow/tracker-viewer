import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async entry => {
    const filename = join(root, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  }));
  return groups.flat();
}

const errors: string[] = [];
// Only tracked JavaScript source is a repository violation. A previous build may
// leave obsolete, untracked .mjs/.cjs files in the user's working directory.
const tracked = new Set(execFileSync('git', ['ls-files', '--cached', '-z', '--', 'src', 'scripts', 'test', 'vite.config.ts'], { encoding: 'utf8' }).split('\\0').filter(Boolean));
const sources = (await Promise.all(['src', 'scripts', 'test'].map(files))).flat();
sources.push('vite.config.ts');
for (const filename of sources) {
  if (/\.[cm]?jsx?$/.test(filename) && tracked.has(filename.replaceAll('\\\\', '/'))) errors.push(`${filename}: JavaScript source is forbidden`);
  if (!/\.[cm]?ts$/.test(filename) || filename.endsWith('.d.ts')) continue;
  const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node, insideIf: boolean): void {
    const location = source.getLineAndCharacterOfPosition(node.getStart(source));
    const prefix = `${filename}:${location.line + 1}`;
    if (node.kind === ts.SyntaxKind.AnyKeyword) errors.push(`${prefix}: explicit any`);
    if (ts.isIfStatement(node) && insideIf) errors.push(`${prefix}: nested if`);
    const next = ts.isFunctionLike(node) ? false : insideIf || ts.isIfStatement(node);
    ts.forEachChild(node, child => visit(child, next));
  }
  visit(source, false);
}
if (errors.length > 0) throw new Error(errors.join('\n'));
console.log('Strict source guard passed');

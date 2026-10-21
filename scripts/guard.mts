import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Source files must be validated without assuming the checkout contains .git.
// Skip dependencies and generated artefacts, not user-maintained source folders.
const ignoredDirectories = new Set([
  '.git', '.sea', '.vite', 'node_modules', 'dist', 'release', 'coverage',
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async entry => {
    const file = join(directory, entry.name);
    if (!entry.isDirectory()) return [file];
    return ignoredDirectories.has(entry.name) ? [] : sourceFiles(file);
  }));
  return groups.flat();
}

const errors: string[] = [];
const sources = await sourceFiles('.');
for (const filename of sources) {
  if (/\.(?:js|cjs|mjs|jsx)$/i.test(filename)) {
    errors.push(`${filename}: JavaScript source is forbidden; use TypeScript`);
    continue;
  }
  if (!/\.(?:ts|mts|cts|tsx)$/i.test(filename) || filename.endsWith('.d.ts')) continue;

  const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node, insideIf: boolean): void {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    const prefix = `${filename}:${position.line + 1}`;
    if (node.kind === ts.SyntaxKind.AnyKeyword) errors.push(`${prefix}: explicit any`);
    if (ts.isIfStatement(node) && insideIf) errors.push(`${prefix}: nested if`);
    const nested = ts.isFunctionLike(node) ? false : insideIf || ts.isIfStatement(node);
    ts.forEachChild(node, child => visit(child, nested));
  }
  visit(source, false);
}
if (errors.length) throw new Error(errors.join('\n'));
console.log('Strict source guard passed');

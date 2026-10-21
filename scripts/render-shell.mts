import { readFile, writeFile } from 'node:fs/promises';
import { render2Mkup } from '../src/ui/reactHelpers';
import { TrackerShell } from '../src/ui/views/TrackerShell';

/** Builds index.html from a stable document template and the typed TSX shell. */
export class StaticShellBuilder {
  /** This string is the sole insertion point; fail before changing files if missing. */
  private readonly slot = '<!-- TRACKER_SHELL: rendered from src/ui/views/TrackerShell.tsx at build time -->';

  async build(): Promise<void> {
    const template = await readFile('index.template.html', 'utf8');
    if (!template.includes(this.slot)) throw new Error('index.template.html has no shell insertion point');
    const result = template.replace(this.slot, render2Mkup(TrackerShell()));
    await writeFile('index.html', result, 'utf8');
    console.log('[shell] Generated index.html from React TSX');
  }
}

await new StaticShellBuilder().build();

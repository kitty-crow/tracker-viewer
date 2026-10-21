import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { render2Mkup } from '../src/ui/reactHelpers';
import { TrackerShell } from '../src/ui/views/TrackerShell';

/**
 * FNV-1a fingerprints are a compact regression fixture.
 * These constants were measured from the original main-branch HTML shell and
 * the original src/styles.css before this architectural refactor.
 * A failure means a visible structure or legacy CSS changed unintentionally.
 */
class FrontendParityContract {
  /** Convert each character to a deterministic unsigned 32-bit fingerprint. */
  static fingerprint(source: string): string {
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
      hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  /**
   * Compare the exact sequence of rendered tags, element IDs, class names and
   * accessibility roles. These are the foundations of the existing CSS and
   * the event-selector contract, and must stay unchanged.
   */
  static shellSignature(source: string): string {
    const nodes = [...source.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)]
      .filter(match => !['script', 'html', 'head', 'meta', 'title', 'body'].includes(match[1] ?? ''))
      .map(match => ({
        tag: match[1],
        id: match[2]?.match(/\bid="([^"]+)"/)?.[1] ?? null,
        cls: match[2]?.match(/\b(?:class|className)="([^"]+)"/)?.[1] ?? null,
        role: match[2]?.match(/\brole="([^"]+)"/)?.[1] ?? null,
      }));
    expect(nodes).toHaveLength(107);
    return this.fingerprint(JSON.stringify(nodes));
  }

  /**
   * Reassemble the pre-refactor stylesheet byte-for-byte. The only allowed
   * difference is the separate requested table-fix stylesheet plus the new
   * shutdown-message rule, which is appended after the legacy layout rules.
   */
  static legacyStyles(): string {
    const base = readFileSync('styles/base.css', 'utf8').replace(/\r\n/g, '\n');
    const layout = readFileSync('styles/layout.css', 'utf8').replace(/\r\n/g, '\n');
    const addition = '/* Shutdown state is shown only after the local server confirms shutdown. */';
    expect(layout.includes(addition)).toBe(true);
    const oldCss = base + layout.slice(0, layout.indexOf(addition));
    return oldCss.slice(0, -1);
  }
}

test('pre-rendered TSX retains the original DOM layout and CSS selector identities', () => {
  const markup = render2Mkup(TrackerShell());
  expect(FrontendParityContract.shellSignature(markup)).toBe('24c58b31');
});

test('all pre-refactor stylesheet declarations remain unchanged', () => {
  expect(FrontendParityContract.fingerprint(FrontendParityContract.legacyStyles())).toBe('f6a34673');
});

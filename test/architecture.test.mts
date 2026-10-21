import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { TrackerFactory } from '../src/model/TrackerTypes';
import { TrackerDiffEngine } from '../src/comparison/TrackerDiff';
import { NotePreview } from '../src/ui/views/Markup';
import { render2Mkup } from '../src/ui/reactHelpers';

/** Rendering must never interpret data imported from an Excel cell as HTML. */
test('TSX escapes user-provided note contents', () => {
  const markup = render2Mkup(NotePreview({ value: '<img src=x onerror=alert(1)>', urgent: [] }));
  expect(markup).toContain('&lt;img');
  expect(markup).not.toContain('<img');
});

/** Model factories and comparison services expose a reusable class interface. */
test('object model services create a valid empty comparison', () => {
  const factory = new TrackerFactory();
  const diff = new TrackerDiffEngine().compare(factory.emptyTracker(), factory.emptyTracker());
  expect(diff.entries).toHaveLength(0);
  expect(diff.added).toBe(0);
});

/** Styles are grouped by concern and the old src/styles.css is not an entry. */
test('CSS entry imports the table layout fix from the root styles folder', () => {
  const root = readFileSync('styles/styles.css', 'utf8');
  const tables = readFileSync('styles/tables.css', 'utf8');
  expect(root).toContain("@import './tables.css'");
  expect(root).toContain("@import './base.css'");
  expect(root).toContain("@import './layout.css'");
  expect(tables).toContain('min-width: 1160px');
  expect(tables).toContain('col:nth-child(9)');
});

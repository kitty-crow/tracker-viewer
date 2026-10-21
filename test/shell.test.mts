import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { TrackerShell } from '../src/ui/views/TrackerShell';
import { StoppedMessage } from '../src/ui/views/StoppedMessage';
import { render2Mkup } from '../src/ui/reactHelpers';

/** Build-time shell rendering must preserve all interactive mount points. */
test('static TSX shell retains tracker controls', () => {
  const markup = render2Mkup(TrackerShell());
  for (const id of ['app','meeting','projects','regional','misc','sheet-tabs','diff-choices','quit-app','agenda-table']) {
    expect(markup).toContain(`id="${id}"`);
  }
  const template = readFileSync('index.template.html', 'utf8');
  expect(template).toContain('TRACKER_SHELL');
  expect(markup).not.toContain('<script');
});

/** The shutdown screen is escaped TSX, not an inline HTML string. */
test('shutdown state is declarative', () => {
  const markup = render2Mkup(StoppedMessage());
  expect(markup).toContain('Tracker Viewer stopped');
  expect(markup).toContain('You can close this browser tab.');
});

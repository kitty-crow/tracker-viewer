import { expect, test } from 'bun:test';
import { blankTracker, newProject, type AgendaItem, type MiscItem, type Project } from '../src/types';
import { changedLines, compareTrackers } from '../src/diff';

function record(overrides: Partial<Project> = {}): Project {
  return { ...newProject(), client: 'Acme', projectNo: 'P-230', well: 'Well Alpha',
    overview: '• Scope agreed', updates: '• First update\n• Still active', ...overrides };
}
function misc(description: string, notes = ''): MiscItem {
  return { id: 'volatile-' + description, description, notes, urgent: false, urgentLines: [] };
}
function agenda(number: string, topic: string): AgendaItem {
  return { id: 'volatile-' + number, number, topic, attendee: 'Kit', time: '10 min', urgent: false };
}
test('moving a project and replacing generated IDs does not create false differences', () => {
  const before = blankTracker(), after = blankTracker();
  before.projects = [record(), record({ id: 'row-2', client: 'Beta', projectNo: 'P-231' })];
  after.projects = [record({ id: 'new-2', client: 'Beta', projectNo: 'P-231' }), record({ id: 'new-1' })];
  const result = compareTrackers(before, after);
  expect(result.entries).toHaveLength(0);
  expect(result.added).toBe(0);
});
test('project edits show removed and added content, keeping unchanged bullets out of the diff', () => {
  const before = blankTracker(), after = blankTracker();
  before.projects = [record()];
  after.projects = [record({ updates: '• First update\n• New inspection\n• Still active', priority: 'High', urgent: true })];
  const report = compareTrackers(before, after);
  expect(report.changed).toBe(1);
  expect(report.added).toBe(0);
  const lines = report.entries[0]!.lines;
  expect(lines).toContainEqual({ sign: '+', field: 'Updates', value: '• New inspection' });
  expect(lines).not.toContainEqual({ sign: '+', field: 'Updates', value: '• Still active' });
  expect(lines).toContainEqual({ sign: '+', field: 'Priority', value: 'High' });
  expect(lines).toContainEqual({ sign: '+', field: 'Urgent', value: 'Marked urgent' });
});
test('removed projects, new regional entries, notes and agenda are classified by section', () => {
  const before = blankTracker(), after = blankTracker();
  before.projects = [record()];
  after.projects = [record({ section: 'regional', projectNo: 'R-120' })];
  before.misc = [misc('Old task', 'Done')];
  after.misc = [misc('New task', 'Started')];
  before.agenda = [agenda('1', 'Original')];
  after.agenda = [agenda('1', 'Revised')];
  const result = compareTrackers(before, after);
  expect(result.added).toBe(2);
  expect(result.removed).toBe(2);
  expect(result.changed).toBe(1);
  expect(result.entries.some(e => e.section === 'Middle East region' && e.kind === 'added')).toBe(true);
  expect(result.entries.some(e => e.section === 'Projects & enquiries' && e.kind === 'removed')).toBe(true);
  expect(result.entries.some(e => e.section === 'Agenda' && e.kind === 'changed')).toBe(true);
});
test('meeting date changes and individual urgency flags are included without mutating either tracker', () => {
  const before = blankTracker(), after = blankTracker();
  before.meeting = [{ label: 'Meeting date and time', value: '19/10/2026, 14:00' }];
  after.meeting = [{ label: 'Meeting date and time', value: '21/10/2026, 14:00' }];
  before.projects = [record()];
  after.projects = [record({ urgentLines: { overview: [0], updates: [] } })];
  const saved = JSON.stringify(before);
  const result = compareTrackers(before, after);
  expect(result.changed).toBe(2);
  expect(result.entries.some(e => e.section === 'Meeting details')).toBe(true);
  expect(result.entries.some(e => e.lines.some(line => line.field === 'Overview urgency' && line.sign === '+'))).toBe(true);
  expect(JSON.stringify(before)).toBe(saved);
});
test('line diff shows genuine deletions and insertions, not unchanged context', () => {
  expect(changedLines('Notes', 'one\ntwo\nthree', 'one\nchanged\nthree')).toEqual([
    { sign: '-', field: 'Notes', value: 'two' },
    { sign: '+', field: 'Notes', value: 'changed' },
  ]);
});

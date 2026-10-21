/**
 * Compares weekly workbook snapshots using stable row identities instead of array positions.
 *
 * Keep file-system, workbook, comparison and UI concerns separate: callers
 * rely on these interfaces to preserve the existing Excel editing workflow.
 */
import { FIELDS, HEADERS, type AgendaItem, type MeetingItem, type MiscItem, type Project, type Tracker } from '../model/TrackerTypes';

export type DiffSection = 'Projects & enquiries' | 'Middle East region' | 'Miscellaneous' | 'Agenda' | 'Meeting details';
export type DiffKind = 'added' | 'removed' | 'changed';
export interface DiffLine { sign: '+' | '-'; field: string; value: string }
export interface DiffEntry { section: DiffSection; kind: DiffKind; title: string; lines: DiffLine[] }
export interface DiffReport { entries: DiffEntry[]; added: number; removed: number; changed: number }

const clean = (value: string): string => value.replace(/\r\n/g, '\n').trim();
const key = (value: string): string => clean(value).toLocaleLowerCase('en-GB').replace(/\s+/g, ' ');
const stableNumber = (value: string): string => /^(?:enquiry|inquiry|tbc|tbd|n\/?a|none|-)?$/i.test(clean(value)) ? '' : key(value);
const summary = (value: string): string => clean(value).replace(/\n/g, ' / ');

interface Matches<T> { paired: [T, T][]; removed: T[]; added: T[] }

/** Match by unique stable identity, never by generated ids or row positions. */
function matchRows<T>(before: T[], after: T[], identities: ((value: T) => string)[]): Matches<T> {
  const oldRemaining = new Set(before.map((_, i) => i));
  const newRemaining = new Set(after.map((_, i) => i));
  const paired: [T, T][] = [];
  for (const identify of identities) {
    const from = new Map<string, number[]>();
    const to = new Map<string, number[]>();
    for (const index of oldRemaining) {
      const item = before[index];
      if (!item) continue;
      const value = identify(item);
      if (value) from.set(value, [...(from.get(value) ?? []), index]);
    }
    for (const index of newRemaining) {
      const item = after[index];
      if (!item) continue;
      const value = identify(item);
      if (value) to.set(value, [...(to.get(value) ?? []), index]);
    }
    for (const [identity, indices] of from) {
      const candidates = to.get(identity);
      if (indices.length !== 1 || candidates?.length !== 1) continue;
      const oldIndex = indices[0]!, newIndex = candidates[0]!;
      paired.push([before[oldIndex]!, after[newIndex]!]);
      oldRemaining.delete(oldIndex);
      newRemaining.delete(newIndex);
    }
  }
  return {
    paired,
    removed: [...oldRemaining].map(index => before[index]!),
    added: [...newRemaining].map(index => after[index]!),
  };
}

/** LCS-based comparison avoids marking all later bullets as changed when one line is inserted. */
export function changedLines(field: string, original: string, updated: string): DiffLine[] {
  const oldLines = clean(original) ? clean(original).split('\n') : [];
  const newLines = clean(updated) ? clean(updated).split('\n') : [];
  const rows: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(newLines.length + 1).fill(0));
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      rows[i]![j] = oldLines[i] === newLines[j]
        ? 1 + rows[i + 1]![j + 1]!
        : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
    }
  }
  const result: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++; continue;
    }
    if (j < newLines.length && (i === oldLines.length || rows[i]![j + 1]! > rows[i + 1]![j]!)) {
      result.push({ sign: '+', field, value: newLines[j]! }); j++; continue;
    }
    result.push({ sign: '-', field, value: oldLines[i]! }); i++;
  }
  return result;
}

function markFields(fields: [string, string][], sign: '+' | '-'): DiffLine[] {
  return fields.filter(([, value]) => clean(value) !== '')
    .flatMap(([field, value]) => clean(value).split('\n').map(line => ({ sign, field, value: line })));
}
function fieldChanges(fields: [string, string, string][]): DiffLine[] {
  return fields.flatMap(([label, before, after]) => changedLines(label, before, after));
}
function urgentChanges(before: boolean, after: boolean): DiffLine[] {
  return before === after ? [] : [
    { sign: before ? '-' : '+', field: 'Urgent', value: 'Marked urgent' },
  ];
}
function lineUrgencyChanges(field: string, before: number[], after: number[]): DiffLine[] {
  const added = after.filter(index => !before.includes(index)).map(index =>
    ({ sign: '+' as const, field, value: `Line ${index + 1} marked urgent` }));
  const removed = before.filter(index => !after.includes(index)).map(index =>
    ({ sign: '-' as const, field, value: `Line ${index + 1} marked urgent` }));
  return [...removed, ...added];
}
function fieldsForProject(p: Project): [string, string][] {
  return FIELDS.map(field => [HEADERS[field], p[field]]);
}
function projectTitle(p: Project): string {
  return [p.client, p.projectNo, p.well].map(summary).filter(Boolean).join(' · ') || 'Untitled project';
}
function projectKeys(): ((p: Project) => string)[] {
  return [
    p => stableNumber(p.projectNo),
    p => key(p.client) && key(p.well) ? `${key(p.client)}|${key(p.well)}` : '',
    p => key(p.client) && key(p.country) && key(p.lead)
      ? `${key(p.client)}|${key(p.country)}|${key(p.lead)}` : '',
    p => key(p.client),
  ];
}
function diffProjects(before: Project[], after: Project[], section: DiffSection): DiffEntry[] {
  const matches = matchRows(before, after, projectKeys());
  const entries: DiffEntry[] = [];
  for (const item of matches.added) entries.push({ section, kind: 'added',
    title: projectTitle(item), lines: [...markFields(fieldsForProject(item), '+'), ...urgentChanges(false, item.urgent)] });
  for (const item of matches.removed) entries.push({ section, kind: 'removed',
    title: projectTitle(item), lines: [...markFields(fieldsForProject(item), '-'), ...urgentChanges(item.urgent, false)] });
  for (const [old, next] of matches.paired) {
    const lines = fieldChanges(FIELDS.map(field => [HEADERS[field], old[field], next[field]]));
    lines.push(...urgentChanges(old.urgent, next.urgent));
    lines.push(...lineUrgencyChanges('Overview urgency', old.urgentLines.overview, next.urgentLines.overview));
    lines.push(...lineUrgencyChanges('Updates urgency', old.urgentLines.updates, next.urgentLines.updates));
    if (lines.length) entries.push({ section, kind: 'changed', title: projectTitle(next), lines });
  }
  return entries;
}
function diffMisc(before: MiscItem[], after: MiscItem[]): DiffEntry[] {
  const section: DiffSection = 'Miscellaneous';
  const matches = matchRows(before, after, [item => key(item.description), item => key(item.notes)]);
  const entries: DiffEntry[] = [];
  for (const item of matches.added) entries.push({ section, kind: 'added', title: summary(item.description) || 'Untitled note',
    lines: [...markFields([['Description', item.description], ['Notes', item.notes]], '+'), ...urgentChanges(false, item.urgent)] });
  for (const item of matches.removed) entries.push({ section, kind: 'removed', title: summary(item.description) || 'Untitled note',
    lines: [...markFields([['Description', item.description], ['Notes', item.notes]], '-'), ...urgentChanges(item.urgent, false)] });
  for (const [old, next] of matches.paired) {
    const lines = fieldChanges([['Description', old.description, next.description], ['Notes', old.notes, next.notes]]);
    lines.push(...urgentChanges(old.urgent, next.urgent));
    lines.push(...lineUrgencyChanges('Notes urgency', old.urgentLines, next.urgentLines));
    if (lines.length) entries.push({ section, kind: 'changed', title: summary(next.description) || 'Untitled note', lines });
  }
  return entries;
}
function diffAgenda(before: AgendaItem[], after: AgendaItem[]): DiffEntry[] {
  const section: DiffSection = 'Agenda';
  const matches = matchRows(before, after, [item => key(item.topic), item => key(item.number)]);
  const entries: DiffEntry[] = [];
  const fields = (item: AgendaItem): [string, string][] =>
    [['Number', item.number], ['Topic', item.topic], ['Attendee', item.attendee], ['Time', item.time]];
  for (const item of matches.added) entries.push({ section, kind: 'added', title: summary(item.topic) || `Agenda ${item.number}`, lines: markFields(fields(item), '+') });
  for (const item of matches.removed) entries.push({ section, kind: 'removed', title: summary(item.topic) || `Agenda ${item.number}`, lines: markFields(fields(item), '-') });
  for (const [old, next] of matches.paired) {
    const lines = fieldChanges([['Number', old.number, next.number], ['Topic', old.topic, next.topic],
      ['Attendee', old.attendee, next.attendee], ['Time', old.time, next.time]]);
    lines.push(...urgentChanges(old.urgent, next.urgent));
    if (lines.length) entries.push({ section, kind: 'changed', title: summary(next.topic) || `Agenda ${next.number}`, lines });
  }
  return entries;
}
function diffMeeting(before: MeetingItem[], after: MeetingItem[]): DiffEntry[] {
  const section: DiffSection = 'Meeting details';
  const matches = matchRows(before, after, [item => key(item.label)]);
  const entries: DiffEntry[] = [];
  for (const item of matches.added) entries.push({ section, kind: 'added', title: item.label,
    lines: markFields([['Value', item.value]], '+') });
  for (const item of matches.removed) entries.push({ section, kind: 'removed', title: item.label,
    lines: markFields([['Value', item.value]], '-') });
  for (const [old, next] of matches.paired) {
    const lines = changedLines('Value', old.value, next.value);
    if (lines.length) entries.push({ section, kind: 'changed', title: next.label, lines });
  }
  return entries;
}

/** Read-only semantic diff; generated identifiers and row ordering are not significant. */
export function compareTrackers(before: Tracker, after: Tracker): DiffReport {
  const projects = (tracker: Tracker, section: Project['section']) =>
    tracker.projects.filter(item => item.section === section);
  const entries: DiffEntry[] = [
    ...diffProjects(projects(before, 'projects'), projects(after, 'projects'), 'Projects & enquiries'),
    ...diffProjects(projects(before, 'regional'), projects(after, 'regional'), 'Middle East region'),
    ...diffMisc(before.misc, after.misc),
    ...diffAgenda(before.agenda, after.agenda),
    ...diffMeeting(before.meeting, after.meeting),
  ];
  for (const section of ['projects', 'regional', 'misc'] as const) {
    if (before.urgentSections[section] === after.urgentSections[section]) continue;
    const label: DiffSection = section === 'regional' ? 'Middle East region'
      : section === 'misc' ? 'Miscellaneous' : 'Projects & enquiries';
    entries.push({ section: label, kind: 'changed', title: 'Section urgency', lines:
      urgentChanges(before.urgentSections[section], after.urgentSections[section]) });
  }
  return { entries, added: entries.filter(item => item.kind === 'added').length,
    removed: entries.filter(item => item.kind === 'removed').length,
    changed: entries.filter(item => item.kind === 'changed').length };
}


/** Read-only comparison service over two independent weekly tracker models. */
export class TrackerDiffEngine {
  compare(before: Tracker, after: Tracker): DiffReport { return compareTrackers(before, after); }
  changedLines(field: string, before: string, after: string): DiffLine[] {
    return changedLines(field, before, after);
  }
}

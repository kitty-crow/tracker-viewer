/**
 * Defines the shape of the tracker and provides consistent identifiers and date conversions.
 *
 * Keep file-system, workbook, comparison and UI concerns separate: callers
 * rely on these interfaces to preserve the existing Excel editing workflow.
 */
export const FIELDS = ['priority', 'client', 'country', 'projectNo', 'well', 'lead', 'overview', 'updates'] as const;
export type Field = typeof FIELDS[number];
export type NoteField = 'overview' | 'updates';
export type Section = 'projects' | 'regional' | 'misc';
export const HEADERS: Record<Field, string> = {
  priority: 'Priority', client: 'Client', country: 'Country', projectNo: 'Project No', well: 'Well / Project',
  lead: 'Lead', overview: 'Overview', updates: 'Updates'
};
export interface OriginalCells { sheet: string; cells: Record<string, string> }
export interface Project { _original?: OriginalCells;
  id: string; section: 'projects' | 'regional'; urgent: boolean; priority: string; client: string; country: string;
  projectNo: string; well: string; lead: string; overview: string; updates: string;
  urgentLines: Record<NoteField, number[]>;
}
export interface MiscItem { _original?: OriginalCells; id: string; description: string; notes: string; urgent: boolean; urgentLines: number[]; }
export interface MeetingItem { label: string; value: string; _original?: OriginalCells; }
export interface AgendaItem { _original?: OriginalCells; id: string; number: string; topic: string; attendee: string; time: string; urgent: boolean; }
export interface Tracker {
  projects: Project[]; misc: MiscItem[]; meeting: MeetingItem[]; agenda: AgendaItem[];
  urgentSections: Record<Section, boolean>; sourceName: string;
}
let sequence = 0;
export const newId = (): string => `tv-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
export function newProject(section: 'projects' | 'regional' = 'projects'): Project {
  return { id: newId(), section, urgent: false, priority: '', client: '', country: '', projectNo: '', well: '', lead: '', overview: '', updates: '', urgentLines: { overview: [], updates: [] } };
}
export function blankTracker(): Tracker {
  return { projects: [], misc: [], meeting: [], agenda: [], urgentSections: { projects: false, regional: false, misc: false }, sourceName: '' };
}
export function lines(text: string): string[] { return text.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim() !== ''); }
export function bullet(text: string): string { const t = text.trim(); return /^[•·●-]\s*/.test(t) ? t : `• ${t}`; }
export function cleanText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  const obj = v as { text?: string; richText?: { text: string }[]; result?: unknown };
  if (typeof obj.text === 'string') return obj.text;
  if (Array.isArray(obj.richText)) return obj.richText.map(item => item.text).join('');
  if (obj.result !== undefined) return cleanText(obj.result);
  return String(v);
}
/** Date the new weekly workbook for the local calendar day it is created. */
export function creationDate(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Duplicate the previous tracker without advancing to an assumed Monday. */
export function newDatedWeek(previous: Tracker, now = new Date()): Tracker {
  const next: Tracker = structuredClone(previous);
  next.projects.forEach(p => { p.id = newId(); });
  next.misc.forEach(m => { m.id = newId(); });
  next.agenda.forEach(a => { a.id = newId(); });
  const field = next.meeting.find(m => /meeting date( and time)?/i.test(m.label));
  const oldValue = field?.value ?? '';
  const iso = oldValue.match(/^\d{4}-\d{2}-\d{2}(.*)$/);
  const uk = oldValue.match(/^\d{1,2}\/\d{1,2}\/\d{4}(.*)$/);
  const date = creationDate(now);
  const [year, month, day] = date.split('-');
  const value = iso ? `${date}${iso[1] ?? ''}`
    : `${day}/${month}/${year}${uk?.[1] ?? ', 14:00'}`;
  if (field) field.value = value;
  else next.meeting.unshift({ label: 'Meeting date and time', value });
  return next;
}
export function sheetLabel(tracker: Tracker, index: number): string {
  const date = tracker.meeting.find(m => /meeting date( and time)?/i.test(m.label))?.value;
  return date?.split(/[ ,]/)[0] || `Sheet ${index + 1}`;
}


/**
 * Factory for all tracker-domain objects. It centralises defaults and date
 * rules so views, file controllers and tests create identical structures.
 * Standalone functions remain as compatible entry points for existing callers.
 */
export class TrackerFactory {
  newId(): string { return newId(); }
  newProject(section: 'projects' | 'regional' = 'projects'): Project { return newProject(section); }
  emptyTracker(): Tracker { return blankTracker(); }
  nextWeek(previous: Tracker, date = new Date()): Tracker { return newDatedWeek(previous, date); }
  creationDate(date = new Date()): string { return creationDate(date); }
  sheetLabel(tracker: Tracker, index: number): string { return sheetLabel(tracker, index); }
  lines(text: string): string[] { return lines(text); }
  bullet(text: string): string { return bullet(text); }
}

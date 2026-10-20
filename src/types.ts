export const FIELDS = ['priority', 'client', 'country', 'projectNo', 'well', 'lead', 'overview', 'updates'] as const;
export type Field = typeof FIELDS[number];
export type NoteField = 'overview' | 'updates';
export type Section = 'projects' | 'regional' | 'misc';
export const HEADERS: Record<Field, string> = {
  priority: 'Priority', client: 'Client', country: 'Country', projectNo: 'Project No', well: 'Well / Project',
  lead: 'Lead', overview: 'Overview', updates: 'Updates'
};
export interface Project {
  id: string; section: 'projects' | 'regional'; urgent: boolean; priority: string; client: string; country: string;
  projectNo: string; well: string; lead: string; overview: string; updates: string;
  urgentLines: Record<NoteField, number[]>;
}
export interface MiscItem { id: string; description: string; notes: string; urgent: boolean; urgentLines: number[]; }
export interface MeetingItem { label: string; value: string; }
export interface AgendaItem { id: string; number: string; topic: string; attendee: string; time: string; urgent: boolean; }
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
  if (typeof v === 'object') {
    const obj = v as { text?: string; richText?: { text: string }[]; result?: unknown };
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.richText)) return obj.richText.map(item => item.text).join('');
    if (obj.result !== undefined) return cleanText(obj.result);
  }
  return String(v);
}
/** Duplicate a weekly tracker while keeping the previous week's items intact. */
export function nextWeek(previous: Tracker): Tracker {
  const next: Tracker = structuredClone(previous);
  next.projects.forEach(p => { p.id = newId(); });
  next.misc.forEach(m => { m.id = newId(); });
  next.agenda.forEach(a => { a.id = newId(); });
  const field = next.meeting.find(m => /meeting date( and time)?/i.test(m.label));
  const existing = field?.value ?? '';
  const uk = existing.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
  const iso = existing.match(/^(\d{4})-(\d\d)-(\d\d)(.*)$/);
  let date: Date;
  if (uk) date = new Date(Date.UTC(+uk[3], +uk[2] - 1, +uk[1] + 7));
  else if (iso) date = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3] + 7));
  else { date = new Date(); date.setDate(date.getDate() + 7); }
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  const value = iso ? `${yyyy}-${mm}-${dd}${iso[4]}` : `${dd}/${mm}/${yyyy}${uk?.[4] ?? ', 14:00'}`;
  if (field) field.value = value;
  else next.meeting.unshift({ label: 'Meeting date and time', value });
  return next;
}
export function sheetLabel(tracker: Tracker, index: number): string {
  const date = tracker.meeting.find(m => /meeting date( and time)?/i.test(m.label))?.value;
  return date?.split(/[ ,]/)[0] || `Sheet ${index + 1}`;
}

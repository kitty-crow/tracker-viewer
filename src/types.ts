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
export interface Tracker {
  projects: Project[]; misc: MiscItem[]; meeting: MeetingItem[];
  urgentSections: Record<Section, boolean>; sourceName: string;
}
let sequence = 0;
export const newId = (): string => `tv-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
export function newProject(section: 'projects' | 'regional' = 'projects'): Project {
  return { id: newId(), section, urgent: false, priority: '', client: '', country: '', projectNo: '', well: '', lead: '', overview: '', updates: '', urgentLines: { overview: [], updates: [] } };
}
export function blankTracker(): Tracker {
  return { projects: [], misc: [], meeting: [], urgentSections: { projects: false, regional: false, misc: false }, sourceName: '' };
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

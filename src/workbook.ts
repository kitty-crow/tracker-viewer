import type ExcelJS from 'exceljs';
import { blankTracker, cleanText, FIELDS, HEADERS, lines, newId, newProject, type Field, type MiscItem, type NoteField, type Project, type Section, type Tracker } from './types';

// ExcelJS is lazy-loaded: the UI and local browsing stay responsive before a workbook is opened.
const getExcel = async () => { const mod = await import('exceljs/dist/exceljs.min.js'); return mod.default ?? mod; };
const val = (sheet: ExcelJS.Worksheet, row: number, col: number): string => {
  const cell = sheet.getRow(row).getCell(col);
  // ExcelJS resolves a merged slave to its master value. Only the anchor is data.
  if (cell.isMerged && cell.master?.address !== cell.address) return '';
  return cleanText(cell.value);
};
const rowText = (sheet: ExcelJS.Worksheet, row: number): string => {
  const parts: string[] = [];
  sheet.getRow(row).eachCell({ includeEmpty: false }, cell => parts.push(cleanText(cell.value)));
  return parts.join(' ').trim();
};
const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const fieldFor = (header: string): Field | undefined => {
  const h = key(header);
  const lookup: Record<string, Field> = { priority: 'priority', client: 'client', customer: 'client', country: 'country', location: 'country', projectno: 'projectNo', projectnumber: 'projectNo', jobno: 'projectNo', enquiry: 'projectNo', well: 'well', wellproject: 'well', project: 'well', lead: 'lead', owner: 'lead', overview: 'overview', scope: 'overview', updates: 'updates', update: 'updates', notes: 'updates' };
  return lookup[h];
};
function detectHeader(sheet: ExcelJS.Worksheet): { row: number; cols: Partial<Record<Field, number>> } | null {
  for (let r = 1; r <= Math.min(45, sheet.rowCount); r++) {
    const cols: Partial<Record<Field, number>> = {};
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const f = fieldFor(cleanText(cell.value));
      if (f && cols[f] === undefined) cols[f] = col;
    });
    if (cols.client && (cols.projectNo || cols.well) && (cols.overview || cols.updates)) return { row: r, cols };
  }
  return null;
}
function findMarkers(sheet: ExcelJS.Worksheet): { regional: number; misc: number } {
  let regional = 0; let misc = 0;
  for (let r = 1; r <= sheet.rowCount; r++) {
    const t = rowText(sheet, r).toUpperCase();
    if (!regional && /MIDDLE EAST REGION/.test(t)) regional = r;
    if (!misc && /MISCELLANEOUS/.test(t)) misc = r;
  }
  return { regional, misc };
}
function appendNote(obj: Project, field: NoteField, text: string): void {
  if (!text.trim()) return;
  obj[field] = obj[field] ? `${obj[field]}\n${text}` : text;
}
function parseRegional(sheet: ExcelJS.Worksheet, start: number, end: number, dest: Project[]): void {
  let current: Project | null = null;
  let updates = false;
  for (let r = start; r < end; r++) {
    const client = val(sheet, r, 3).trim();
    const g = val(sheet, r, 7).trim();
    if (client && !/^(no\.?|client)$/i.test(client)) {
      current = newProject('regional'); current.client = client;
      current.country = val(sheet, r, 4); current.projectNo = val(sheet, r, 5);
      current.well = val(sheet, r, 6) || g;
      current.lead = val(sheet, r, 8);
      current.priority = val(sheet, r, 2);
      dest.push(current); updates = false;
      if (val(sheet, r, 6) && g) appendNote(current, 'overview', g);
      continue;
    }
    if (!current || !g) continue;
    if (/^updates?:?$/i.test(g)) { updates = true; continue; }
    appendNote(current, updates ? 'updates' : 'overview', g);
  }
}
function parseMisc(sheet: ExcelJS.Worksheet, start: number, end: number, dest: MiscItem[]): void {
  let current: MiscItem | null = null;
  for (let r = start; r < end; r++) {
    const desc = val(sheet, r, 4).trim();
    const index = val(sheet, r, 3).trim();
    if (!desc || /^description$/i.test(desc)) continue;
    if (index && (/^\d+$/.test(index) || /^no\.?$/i.test(index))) {
      if (/^no\.?$/i.test(index)) continue;
      current = { id: newId(), description: desc, notes: '', urgent: false, urgentLines: [] };
      dest.push(current);
    } else if (current) current.notes += `${current.notes ? '\n' : ''}${desc}`;
  }
}
function parseMeeting(sheet: ExcelJS.Worksheet, until: number, tracker: Tracker): void {
  for (let r = 2; r < until; r++) {
    const label = val(sheet, r, 2).trim();
    if (!label || /^(meeting details|agenda|priority)$/i.test(label)) continue;
    if (label.length > 80) continue;
    const v = val(sheet, r, 4).trim();
    tracker.meeting.push({ label, value: v });
  }
  // The source workbook also has a small agenda table above its project header.
  for (let r = 1; r < until; r++) {
    if (!/^no\.?$/i.test(val(sheet, r, 3)) || !/^topic$/i.test(val(sheet, r, 4))) continue;
    for (let agendaRow = r + 1; agendaRow < until; agendaRow++) {
      const number = val(sheet, agendaRow, 3).trim();
      if (!number) continue;
      for (const [col, suffix] of [[4, 'Topic'], [5, 'Attendee'], [7, 'Time']] as const) {
        const value = val(sheet, agendaRow, col);
        if (value) tracker.meeting.push({ label: `Agenda ${number} (${suffix})`, value });
      }
    }
    break;
  }
}
function parseTable(sheet: ExcelJS.Worksheet, head: { row: number; cols: Partial<Record<Field, number>> }, end: number, section: 'projects' | 'regional', dest: Project[]): void {
  for (let r = head.row + 1; r < end; r++) {
    const p = newProject(section);
    for (const f of FIELDS) if (head.cols[f]) p[f] = val(sheet, r, head.cols[f]!);
    if (p.client.trim() || p.projectNo.trim() || p.well.trim()) dest.push(p);
  }
}
function applyMeta(tracker: Tracker, book: ExcelJS.Workbook): void {
  const sheet = book.getWorksheet('_TrackerViewer');
  if (!sheet) return;
  try {
    const data = JSON.parse(val(sheet, 2, 1)) as { urgentSections?: Partial<Record<Section, boolean>>; projects?: { urgent: boolean; urgentLines: Project['urgentLines'] }[]; misc?: { urgent: boolean; urgentLines: number[] }[] };
    tracker.urgentSections = { ...tracker.urgentSections, ...data.urgentSections };
    data.projects?.forEach((v, i) => { if (tracker.projects[i]) { tracker.projects[i].urgent = Boolean(v.urgent); tracker.projects[i].urgentLines = { overview: v.urgentLines?.overview || [], updates: v.urgentLines?.updates || [] }; } });
    data.misc?.forEach((v, i) => { if (tracker.misc[i]) { tracker.misc[i].urgent = Boolean(v.urgent); tracker.misc[i].urgentLines = v.urgentLines || []; } });
  } catch { /* Invalid extra metadata must not stop users opening their tracker. */ }
}
export async function importWorkbook(file: File): Promise<Tracker> {
  const Excel = await getExcel(); const book = new Excel.Workbook();
  await book.xlsx.load(new Uint8Array(await file.arrayBuffer()) as never);
  const tracker = blankTracker(); tracker.sourceName = file.name;
  for (const sheet of book.worksheets) {
    if (sheet.name === '_TrackerViewer') continue;
    if (/^meeting$/i.test(sheet.name)) {
      for (let r = 2; r <= sheet.rowCount; r++) { const label = val(sheet, r, 1); if (label) tracker.meeting.push({ label, value: val(sheet, r, 2) }); }
      continue;
    }
    if (/^misc/i.test(sheet.name)) { parseMiscNormalised(sheet, tracker.misc); continue; }
    const markers = findMarkers(sheet);
    const header = detectHeader(sheet);
    if (header) {
      const end = markers.regional || markers.misc || sheet.rowCount + 1;
      parseTable(sheet, header, end, /middle east|regional/i.test(sheet.name) ? 'regional' : 'projects', tracker.projects);
      if (header.row > 2 && tracker.meeting.length === 0) parseMeeting(sheet, header.row, tracker);
    }
    if (markers.regional) parseRegional(sheet, markers.regional + 1, markers.misc || sheet.rowCount + 1, tracker.projects);
    if (markers.misc) parseMisc(sheet, markers.misc + 1, sheet.rowCount + 1, tracker.misc);
  }
  if (!tracker.projects.length && !tracker.misc.length) throw new Error('No recognisable project/enquiry tables or tracker sections were found in this workbook.');
  applyMeta(tracker, book);
  return tracker;
}
function parseMiscNormalised(sheet: ExcelJS.Worksheet, dest: MiscItem[]): void {
  for (let r = 2; r <= sheet.rowCount; r++) {
    const description = val(sheet, r, 1);
    if (description) dest.push({ id: newId(), description, notes: val(sheet, r, 2), urgent: false, urgentLines: [] });
  }
}
function paintHeader(sheet: ExcelJS.Worksheet, names: string[], widths: number[], urgent = false): void {
  sheet.getRow(1).values = names;
  sheet.getRow(1).height = 29;
  sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: urgent ? 'FFFF566B' : 'FFFFFFFF' }, size: 11 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172A41' } }; cell.alignment = { vertical: 'middle' }; });
  widths.forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: names.length } };
}
function styledNotes(text: string, urgentLines: number[]): ExcelJS.CellRichTextValue | string {
  if (!urgentLines.length) return text;
  let visibleIndex = -1;
  return { richText: text.split('\n').map((line, index, all) => {
    if (line.trim()) visibleIndex++;
    return { text: line + (index === all.length - 1 ? '' : '\n'), font: urgentLines.includes(visibleIndex) && line.trim() ? { color: { argb: 'FFDD3344' }, bold: true } : { color: { argb: 'FF253449' } } };
  }) };
}
function styleDataRow(row: ExcelJS.Row, urgent: boolean, index: number): void {
  row.eachCell({ includeEmpty: true }, cell => {
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFE4EAF0' } } };
    if (index % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7FA' } };
    if (urgent) cell.font = { color: { argb: 'FFDD3344' }, bold: true };
  });
}
function writeProjects(book: ExcelJS.Workbook, title: string, items: Project[], urgent: boolean): void {
  const sheet = book.addWorksheet(title);
  paintHeader(sheet, FIELDS.map(f => HEADERS[f]), [12, 20, 16, 21, 31, 24, 63, 63], urgent);
  for (const p of items) {
    const row = sheet.addRow([p.priority, p.client, p.country, p.projectNo, p.well, p.lead, styledNotes(p.overview, p.urgentLines.overview), styledNotes(p.updates, p.urgentLines.updates)]);
    styleDataRow(row, p.urgent, row.number);
    row.height = 44;
    for (const col of [7, 8] as const) if (!p.urgent && p.urgentLines[col === 7 ? 'overview' : 'updates'].length) row.getCell(col).font = { color: { argb: 'FF253449' } };
  }
}
export async function exportWorkbook(tracker: Tracker): Promise<Blob> {
  const Excel = await getExcel(); const book = new Excel.Workbook();
  book.creator = 'Tracker Viewer'; book.created = new Date();
  writeProjects(book, 'Projects', tracker.projects.filter(p => p.section === 'projects'), tracker.urgentSections.projects);
  writeProjects(book, 'Middle East', tracker.projects.filter(p => p.section === 'regional'), tracker.urgentSections.regional);
  const misc = book.addWorksheet('Miscellaneous');
  paintHeader(misc, ['Description', 'Notes'], [38, 110], tracker.urgentSections.misc);
  tracker.misc.forEach((m, i) => { const row = misc.addRow([m.description, styledNotes(m.notes, m.urgentLines)]); styleDataRow(row, m.urgent, i); row.height = 45; });
  const meeting = book.addWorksheet('Meeting');
  paintHeader(meeting, ['Field', 'Value'], [31, 105]);
  tracker.meeting.forEach(m => meeting.addRow([m.label, m.value]));
  const meta = book.addWorksheet('_TrackerViewer');
  meta.getCell('A1').value = 'Tracker Viewer metadata v1';
  meta.getCell('A2').value = JSON.stringify({ urgentSections: tracker.urgentSections, projects: [...tracker.projects.filter(p => p.section === 'projects'), ...tracker.projects.filter(p => p.section === 'regional')].map(p => ({ urgent: p.urgent, urgentLines: p.urgentLines })), misc: tracker.misc.map(m => ({ urgent: m.urgent, urgentLines: m.urgentLines })) });
  meta.state = 'veryHidden';
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([buffer as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

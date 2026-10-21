import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { FIELDS, type Tracker, type OriginalCells } from './types';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_SPACE = 'http://www.w3.org/XML/1998/namespace';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Patch { sheet: string; address: string; text: string; urgent?: number[]; red?: boolean }
type XmlDoc = NonNullable<ReturnType<DOMParser['parseFromString']>>;
type XmlElement = ReturnType<XmlDoc['createElementNS']>;

function identical(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function recordPatches(
  updates: Patch[], source: OriginalCells | undefined, changed: Record<string, string>,
  urgent: Record<string, number[] | undefined> = {}, red = false,
): void {
  for (const [field, text] of Object.entries(changed)) {
    const address = source?.cells[field];
    if (!source || !address) throw new Error(`The source XLSX has no safe cell mapping for ${field}; the original layout was not changed.`);
    const flags = urgent[field];
    updates.push({ sheet: source.sheet, address, text, ...(flags ? { urgent: flags } : {}), ...(red ? { red: true } : {}) });
  }
}

/** Only update already-mapped cells. Never regenerate, insert or delete worksheet rows. */
export function workbookPatches(previous: Tracker[], current: Tracker[]): Patch[] {
  if (previous.length !== current.length) throw new Error('Adding or deleting worksheets in an existing Excel file is not yet layout-safe; original file preserved.');
  const patches: Patch[] = [];
  for (let week = 0; week < previous.length; week++) {
    const old = previous[week];
    const next = current[week];
    if (!old || !next) throw new Error('Invalid sheet selection');
    if (!identical(old.urgentSections, next.urgentSections)) {
      throw new Error('Section urgency changes cannot be written without altering this template; original file preserved.');
    }
    if (old.meeting.length !== next.meeting.length || old.agenda.length !== next.agenda.length ||
        old.projects.length !== next.projects.length || old.misc.length !== next.misc.length) {
      throw new Error('Adding or deleting rows needs a template-aware layout operation. Excel was not overwritten; keep the recovery draft.');
    }
    old.meeting.forEach((record, i) => {
      const item = next.meeting[i];
      if (!item) throw new Error('Meeting field missing');
      const changed: Record<string, string> = {};
      if (record.label !== item.label) changed.label = item.label;
      if (record.value !== item.value) changed.value = item.value;
      recordPatches(patches, record._original, changed);
    });
    old.agenda.forEach((record, i) => {
      const item = next.agenda[i];
      if (!item) throw new Error('Agenda item missing');
      const changed: Record<string, string> = {};
      for (const field of ['number', 'topic', 'attendee', 'time'] as const) {
        if (record[field] !== item[field]) changed[field] = item[field];
      }
      if (record.urgent !== item.urgent) changed.topic = item.topic;
      recordPatches(patches, record._original, changed, {}, item.urgent);
    });
    old.projects.forEach((record, i) => {
      const item = next.projects[i];
      if (!item) throw new Error('Project missing');
      const changed: Record<string, string> = {};
      for (const field of FIELDS) {
        if (record[field] !== item[field]) changed[field] = item[field];
      }
      if (record.urgent !== item.urgent) {
        for (const field of FIELDS) changed[field] = item[field];
      }
      for (const field of ['overview', 'updates'] as const) {
        if (!identical(record.urgentLines[field], item.urgentLines[field])) changed[field] = item[field];
      }
      const flags = { overview: item.urgentLines.overview, updates: item.urgentLines.updates };
      recordPatches(patches, record._original, changed, flags, item.urgent);
    });
    old.misc.forEach((record, i) => {
      const item = next.misc[i];
      if (!item) throw new Error('Miscellaneous item missing');
      const changed: Record<string, string> = {};
      if (record.description !== item.description || record.urgent !== item.urgent) changed.description = item.description;
      if (record.notes !== item.notes || !identical(record.urgentLines, item.urgentLines)) changed.notes = item.notes;
      recordPatches(patches, record._original, changed, { notes: item.urgentLines }, item.urgent);
    });
  }
  return patches;
}

function xmlDocument(xml: string): ReturnType<DOMParser['parseFromString']> {
  const document = new DOMParser({ errorHandler: { fatalError: message => { throw new Error(message); } } })
    .parseFromString(xml, 'application/xml');
  if (!document) throw new Error('Excel XML could not be read');
  return document;
}

function worksheetTargets(workbook: string, relationships: string): Map<string, string> {
  const book = xmlDocument(workbook);
  const rels = xmlDocument(relationships);
  const targets = new Map<string, string>();
  const byId = new Map<string, string>();
  const elements = rels.getElementsByTagNameNS(PACKAGE_REL, 'Relationship');
  for (let i = 0; i < elements.length; i++) {
    const rel = elements.item(i);
    const id = rel?.getAttribute('Id');
    const target = rel?.getAttribute('Target');
    if (!id || !target) continue;
    const raw = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const parts: string[] = [];
    for (const part of raw.replaceAll('\\', '/').split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.' && part) parts.push(part);
    }
    byId.set(id, parts.join('/'));
  }
  const sheets = book.getElementsByTagNameNS(NS, 'sheet');
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets.item(i);
    const name = sheet?.getAttribute('name');
    const id = sheet?.getAttributeNS(REL, 'id');
    if (name && id && byId.has(id)) targets.set(name, byId.get(id)!);
  }
  return targets;
}

function appendRun(doc: XmlDoc, parent: XmlElement, text: string, red: boolean): void {
  const run = doc.createElementNS(NS, 'r');
  if (red) {
    const props = doc.createElementNS(NS, 'rPr');
    const colour = doc.createElementNS(NS, 'color');
    colour.setAttribute('rgb', 'FFD32842');
    props.appendChild(colour);
    run.appendChild(props);
  }
  const content = doc.createElementNS(NS, 't');
  content.setAttributeNS(XML_SPACE, 'xml:space', 'preserve');
  content.appendChild(doc.createTextNode(text));
  run.appendChild(content);
  parent.appendChild(run);
}

function applyToXml(xml: string, patches: Patch[]): string {
  const doc = xmlDocument(xml);
  const cells = doc.getElementsByTagNameNS(NS, 'c');
  const byAddress = new Map<string, XmlElement>();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells.item(i);
    const address = cell?.getAttribute('r');
    if (address && cell) byAddress.set(address, cell);
  }
  for (const patch of patches) {
    const cell = byAddress.get(patch.address);
    if (!cell) throw new Error(`Cell ${patch.address} is missing from the original sheet; refusing to change the layout.`);
    // Keep all cell style attributes, merged ranges, row/column metadata,
    // tables, printer settings and every non-edited OOXML part untouched.
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    cell.setAttribute('t', 'inlineStr');
    const inline = doc.createElementNS(NS, 'is');
    if (patch.red || patch.urgent?.length) {
      const lines = patch.text.split('\n');
      lines.forEach((line, i) => appendRun(doc, inline, line + (i + 1 < lines.length ? '\n' : ''),
        Boolean(patch.red || patch.urgent?.includes(i))));
    } else {
      const value = doc.createElementNS(NS, 't');
      value.setAttributeNS(XML_SPACE, 'xml:space', 'preserve');
      value.appendChild(doc.createTextNode(patch.text));
      inline.appendChild(value);
    }
    cell.appendChild(inline);
  }
  return new XMLSerializer().serializeToString(doc);
}

export async function preserveWorkbook(
  original: File,
  baseline: Tracker[],
  current: Tracker[],
): Promise<Blob> {
  const changes = workbookPatches(baseline, current);
  if (!changes.length) return original;
  const zip = await JSZip.loadAsync(await original.arrayBuffer());
  const main = zip.file('xl/workbook.xml');
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  if (!main || !rels) throw new Error('Original Excel workbook is missing worksheet mappings');
  const targets = worksheetTargets(await main.async('string'), await rels.async('string'));
  const grouped = new Map<string, Patch[]>();
  for (const patch of changes) {
    const file = targets.get(patch.sheet);
    if (!file || !zip.file(file)) throw new Error(`Original sheet ${patch.sheet} not found; Excel was not overwritten.`);
    grouped.set(file, [...(grouped.get(file) ?? []), patch]);
  }
  for (const [file, patches] of grouped) {
    const entry = zip.file(file);
    if (!entry) throw new Error(`Worksheet ${file} is missing`);
    const updated = applyToXml(await entry.async('string'), patches);
    zip.file(file, updated);
  }
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: MIME });
}

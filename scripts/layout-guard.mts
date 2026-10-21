import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function fingerprint(xml: string): string {
  const doc = new DOMParser({ errorHandler: { fatalError: message => { throw new Error(message); } } })
    .parseFromString(xml, 'application/xml');
  if (!doc) throw new Error('Invalid worksheet XML');
  const named = (name: string, attrs: string[]): string[][] => {
    const nodes = doc.getElementsByTagNameNS(NS, name);
    const lines: string[][] = [];
    for (let i = 0; i < nodes.length; i++) {
      const element = nodes.item(i);
      lines.push(attrs.map(key => element?.getAttribute(key) ?? ''));
    }
    return lines;
  };
  // Compare all structural features, not text and formulas. In particular,
  // never permit an exporter to change merged ranges, table anchors, cell
  // styles, column widths, row heights or freeze-pane settings.
  return JSON.stringify({
    dimensions: named('dimension', ['ref']),
    columns: named('col', ['min', 'max', 'width', 'style', 'hidden', 'customWidth']),
    rows: named('row', ['r', 's', 'ht', 'customHeight', 'hidden', 'spans', 'outlineLevel', 'collapsed']),
    cells: named('c', ['r', 's']),
    merges: named('mergeCell', ['ref']),
    tables: named('tableParts', ['count']),
    tableRefs: named('tablePart', ['id']),
    panes: named('pane', ['xSplit', 'ySplit', 'topLeftCell', 'activePane', 'state']),
    sheetFormat: named('sheetFormatPr', ['defaultRowHeight', 'defaultColWidth', 'customHeight']),
    conditional: named('conditionalFormatting', ['sqref']),
    printOptions: named('printOptions', ['gridLines', 'headings']),
    pageMargins: named('pageMargins', ['left', 'right', 'top', 'bottom', 'header', 'footer']),
  });
}

/** Refuse any file that modifies workbook layout or arbitrary non-worksheet parts. */
export async function verifyLayoutPreserved(originalPath: string, candidatePath: string): Promise<void> {
  const source = await JSZip.loadAsync(await readFile(originalPath));
  const modified = await JSZip.loadAsync(await readFile(candidatePath));
  const paths = (zip: JSZip): string[] => Object.keys(zip.files)
    .filter(name => !zip.files[name]?.dir).sort();
  const before = paths(source);
  const after = paths(modified);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Workbook structure changed; refusing to overwrite the original.');
  for (const name of before) {
    const originalEntry = source.file(name);
    const candidateEntry = modified.file(name);
    if (!originalEntry || !candidateEntry) throw new Error(`Missing Excel package part: ${name}`);
    const original = await originalEntry.async('nodebuffer');
    const candidate = await candidateEntry.async('nodebuffer');
    const worksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
    if (worksheet && fingerprint(original.toString('utf8')) !== fingerprint(candidate.toString('utf8'))) {
      throw new Error(`Worksheet layout changed in ${name}; the original has not been overwritten.`);
    }
    if (!worksheet && !original.equals(candidate)) {
      throw new Error(`Excel package part ${name} changed; refusing to overwrite the original.`);
    }
  }
}

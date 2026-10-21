import { expect, test } from 'bun:test';
import JSZip from 'jszip';
import { blankTracker } from '../src/model/TrackerTypes';
import { preserveWorkbook, workbookPatches } from '../src/workbook/WorkbookPreserver';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REPL = 'http://schemas.openxmlformats.org/package/2006/relationships';

test('changing the date preserves merged ranges, row sizes, column sizes, styles, table XML and original parts', async () => {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Sheet2" sheetId="2" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${REPL}"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
  const sheet = `<worksheet xmlns="${NS}"><dimension ref="B2:I154"/><cols><col min="2" max="2" width="27" customWidth="1"/></cols><sheetData><row r="4" ht="54" customHeight="1"><c r="B4" s="6" t="inlineStr"><is><t>Meeting date and time</t></is></c><c r="D4" s="21" t="inlineStr"><is><t>19/10/2026, 14:00</t></is></c></row></sheetData><mergeCells count="2"><mergeCell ref="B4:C4"/><mergeCell ref="D4:F4"/></mergeCells><tableParts count="1"><tablePart/></tableParts></worksheet>`;
  zip.file('xl/worksheets/sheet1.xml', sheet);
  zip.file('xl/styles.xml', '<styleSheet><fonts count="3"/></styleSheet>');
  zip.file('xl/tables/table1.xml', '<table name="OriginalTable"/>');
  const original = new File([await zip.generateAsync({ type: 'blob' })], 'Weekly Projects Tracker (2026-10-19).xlsx', { type: MIME });
  const old = blankTracker();
  old.meeting = [{ label: 'Meeting date and time', value: '19/10/2026, 14:00',
    _original: { sheet: 'Sheet2', cells: { label: 'B4', value: 'D4' } } }];
  const updated = structuredClone(old);
  updated.meeting[0]!.value = '21/10/2026, 14:00';
  const result = await preserveWorkbook(original, [old], [updated]);
  const output = await JSZip.loadAsync(await result.arrayBuffer());
  const source = await JSZip.loadAsync(await original.arrayBuffer());
  for (const path of ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/tables/table1.xml']) {
    expect(await output.file(path)!.async('string')).toEqual(await source.file(path)!.async('string'));
  }
  const written = await output.file('xl/worksheets/sheet1.xml')!.async('string');
  expect(written).toContain('21/10/2026, 14:00');
  expect(written).toContain('mergeCell ref="D4:F4"');
  expect(written).toContain('ht="54"');
  expect(written).toContain('width="27"');
  expect(written).toContain('s="21"');
  expect(written).toContain('tableParts');
  expect(await source.file('xl/worksheets/sheet1.xml')!.async('string')).toEqual(sheet);
});

test('unsafe structural changes are rejected before the source Excel is touched', () => {
  const old = blankTracker();
  const changed = structuredClone(old);
  changed.projects.push({ id: 'new', section: 'projects', urgent: false, priority: '', client: '', country: '',
    projectNo: '', well: '', lead: '', overview: '', updates: '', urgentLines: { overview: [], updates: [] } });
  expect(() => workbookPatches([old], [changed])).toThrow('template-aware');
});

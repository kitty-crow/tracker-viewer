import { expect, test } from 'bun:test';
import { workbookLabel } from '../src/folder';

test('each weekly workbook gets a date pill label from its filename', () => {
  expect(workbookLabel('Weekly Projects Tracker (2026-10-19).xlsx')).toBe('19/10/2026');
  expect(workbookLabel('Weekly Projects Tracker (2026-10-21) (2).xlsx')).toBe('21/10/2026 (2)');
  expect(workbookLabel('Quarterly tracker.xlsx')).toBe('Quarterly tracker');
});

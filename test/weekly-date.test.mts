import { expect, test } from 'bun:test';
import { datedFilename } from '../scripts/create-tracker.mts';
import { blankTracker, creationDate, newDatedWeek } from '../src/types';

test('creating a week uses the day of creation and keeps a stable filename stem', () => {
  const prior = blankTracker();
  prior.meeting.push({ label: 'Meeting date and time', value: '19/10/2026, 14:00' });
  const now = new Date(2026, 9, 21, 11, 10);
  const next = newDatedWeek(prior, now);
  expect(creationDate(now)).toBe('2026-10-21');
  expect(next.meeting[0]?.value).toBe('21/10/2026, 14:00');
  expect(prior.meeting[0]?.value).toBe('19/10/2026, 14:00');
  expect(datedFilename('Weekly Projects Tracker (2026-10-19).xlsx', '2026-10-21'))
    .toBe('Weekly Projects Tracker (2026-10-21).xlsx');
  expect(datedFilename('Weekly Projects Tracker (2026-10-21).xlsx', '2026-10-21', 2))
    .toBe('Weekly Projects Tracker (2026-10-21) (2).xlsx');
});

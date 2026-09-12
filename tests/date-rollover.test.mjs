import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, millisecondsUntilNextLocalDay, shouldRollToNewDay } from '../date-rollover.js';

test('localDateKey uses the supplied local calendar date', () => {
  const date = new Date(2026, 8, 12, 23, 59, 59, 900);
  assert.equal(localDateKey(date), '2026-09-12');
});

test('midnight delay lands just after the next local day begins', () => {
  const date = new Date(2026, 8, 12, 23, 59, 59, 900);
  const delay = millisecondsUntilNextLocalDay(date, 250);
  assert.equal(delay, 350);
});

test('date boundary detection flips immediately after midnight', () => {
  const previous = '2026-09-12';
  assert.equal(shouldRollToNewDay(previous, new Date(2026, 8, 12, 23, 59, 59)), false);
  assert.equal(shouldRollToNewDay(previous, new Date(2026, 8, 13, 0, 0, 0)), true);
});

test('month and year boundaries are treated as normal day rollovers', () => {
  assert.equal(shouldRollToNewDay('2026-09-30', new Date(2026, 9, 1, 0, 0, 0)), true);
  assert.equal(shouldRollToNewDay('2026-12-31', new Date(2027, 0, 1, 0, 0, 0)), true);
});

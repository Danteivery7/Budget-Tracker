import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDay,
  calculateMonth,
  daysInMonth,
} from '../engine.js';

function state() {
  return {
    version: 1,
    recurringExpenses: [],
    months: {
      '2026-09': {
        income: 15000,
        housing: 4000,
        reinvestment: 7000,
        expenses: [{ id: 'x', name: 'Other fixed', category: 'Bills', amount: 1000 }],
      },
    },
    dailySpending: {},
  };
}

test('30-day month creates $100 base allowance in example', () => {
  const data = state();
  const month = calculateMonth(data, '2026-09');
  assert.equal(month.spendable, 3000);
  assert.equal(month.baseDaily, 100);
});

test('unused money carries into the next day', () => {
  const data = state();
  data.dailySpending['2026-09-01'] = { amount: 0 };
  assert.equal(calculateDay(data, '2026-09-02').availableToday, 200);
  data.dailySpending['2026-09-02'] = { amount: 160 };
  assert.equal(calculateDay(data, '2026-09-03').availableToday, 140);
});

test('month-end underspend carries into next month', () => {
  const data = state();
  data.dailySpending['2026-09-30'] = { amount: 2500 };
  data.months['2026-10'] = {
    income: 15000,
    housing: 4000,
    reinvestment: 7000,
    expenses: [{ id: 'x', name: 'Other fixed', category: 'Bills', amount: 1000 }],
  };
  const september = calculateMonth(data, '2026-09');
  const october = calculateMonth(data, '2026-10');
  assert.equal(september.endingCarry, 500);
  assert.equal(october.carryIn, 500);
  assert.equal(october.spendable, 3500);
});

test('changing next month reinvestment still includes prior carry', () => {
  const data = state();
  data.dailySpending['2026-09-30'] = { amount: 2500 };
  data.months['2026-10'] = {
    income: 15000,
    housing: 4000,
    reinvestment: 8000,
    expenses: [{ id: 'x', name: 'Other fixed', category: 'Bills', amount: 1000 }],
  };
  assert.equal(calculateMonth(data, '2026-10').spendable, 2500);
});

test('large purchase calculates no-spend recovery days', () => {
  const data = state();
  data.dailySpending['2026-09-01'] = { amount: 1100 };
  const day = calculateDay(data, '2026-09-01');
  assert.equal(day.afterTodayBalance, -1000);
  assert.equal(day.recoveryDays, 10);
  assert.equal(day.status, 'red');
});

test('calendar math handles leap years', () => {
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2027-02'), 28);
});

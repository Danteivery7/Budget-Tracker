import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDay, calculateMonth, dailyAmounts, daysInMonth } from '../engine.js';

function state() {
  return {
    version: 2,
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
  const month = calculateMonth(state(), '2026-09');
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
  data.months['2026-10'] = { income: 15000, housing: 4000, reinvestment: 7000, expenses: [{ id: 'x', name: 'Other fixed', category: 'Bills', amount: 1000 }] };
  assert.equal(calculateMonth(data, '2026-09').endingCarry, 500);
  assert.equal(calculateMonth(data, '2026-10').carryIn, 500);
  assert.equal(calculateMonth(data, '2026-10').spendable, 3500);
});

test('changing next month reinvestment still includes prior carry', () => {
  const data = state();
  data.dailySpending['2026-09-30'] = { amount: 2500 };
  data.months['2026-10'] = { income: 15000, housing: 4000, reinvestment: 8000, expenses: [{ id: 'x', name: 'Other fixed', category: 'Bills', amount: 1000 }] };
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

test('90 spent with 80 refunded becomes 10 net spent', () => {
  const data = state();
  data.dailySpending['2026-09-01'] = { amount: 90, refund: 80 };
  assert.deepEqual(dailyAmounts(data.dailySpending['2026-09-01']), { spent: 90, refunded: 80, net: 10 });
  assert.equal(calculateDay(data, '2026-09-02').availableToday, 190);
});

test('20 spent with 80 refunded creates a 60 net gain', () => {
  const data = state();
  data.dailySpending['2026-09-01'] = { amount: 20, refund: 80 };
  const day = calculateDay(data, '2026-09-01');
  assert.equal(day.netToday, -60);
  assert.equal(day.afterTodayBalance, 160);
  assert.equal(calculateDay(data, '2026-09-02').availableToday, 260);
});

test('refund-only day increases future money and month carry', () => {
  const data = state();
  data.dailySpending['2026-09-01'] = { amount: 0, refund: 80 };
  assert.equal(calculateDay(data, '2026-09-02').availableToday, 280);
  const month = calculateMonth(data, '2026-09');
  assert.equal(month.grossSpent, 0);
  assert.equal(month.refunds, 80);
  assert.equal(month.spent, -80);
  assert.equal(month.endingCarry, 3080);
});

test('later refund increases the month when it actually arrives', () => {
  const data = state();
  data.dailySpending['2026-09-15'] = { amount: 80 };
  data.months['2026-10'] = { income: 15000, housing: 4000, reinvestment: 7000, expenses: [{ id: 'x', name: 'Other fixed', category: 'Bills', amount: 1000 }] };
  data.dailySpending['2026-10-05'] = { amount: 20, refund: 80 };
  const october = calculateMonth(data, '2026-10');
  assert.equal(october.carryIn, 2920);
  assert.equal(october.spent, -60);
  assert.equal(october.endingCarry, 5980);
});

test('old entries without refund remain backward compatible', () => {
  const data = state();
  data.dailySpending['2026-09-01'] = { amount: 80 };
  assert.equal(calculateDay(data, '2026-09-02').availableToday, 120);
});

test('calendar math handles leap years', () => {
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2027-02'), 28);
});

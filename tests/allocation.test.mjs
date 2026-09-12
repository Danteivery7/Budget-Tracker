import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationBreakdown, calculateMonth } from '../engine.js';

test('four-week allocation plan matches the 6700 example exactly', () => {
  const plan = allocationBreakdown({
    income: 6700,
    reinvestment: 5000,
    savingsTarget: 1000,
    planningWeeks: 4,
    payoutDaysPerWeek: 5,
  });

  assert.equal(plan.personalFromIncome, 700);
  assert.deepEqual(plan.weekly, {
    income: 1675,
    reinvestment: 1250,
    savingsTarget: 250,
    fixedCosts: 0,
    personalSpending: 175,
  });
  assert.deepEqual(plan.perPayingDay, {
    income: 335,
    reinvestment: 250,
    savingsTarget: 50,
    fixedCosts: 0,
    personalSpending: 35,
  });
});

test('loan or savings target is protected from discretionary spending', () => {
  const state = {
    version: 3,
    recurringExpenses: [],
    months: {
      '2026-09': {
        income: 6700,
        housing: 0,
        reinvestment: 5000,
        savingsTarget: 1000,
        expenses: [],
      },
    },
    dailySpending: {},
  };

  const month = calculateMonth(state, '2026-09');
  assert.equal(month.savingsTarget, 1000);
  assert.equal(month.spendable, 700);
});

test('old month configs remain backward compatible with no savings target', () => {
  const state = {
    version: 3,
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

  const month = calculateMonth(state, '2026-09');
  assert.equal(month.savingsTarget, 0);
  assert.equal(month.spendable, 3000);
});

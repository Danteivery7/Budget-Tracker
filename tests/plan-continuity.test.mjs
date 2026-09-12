import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanRevision, ensureMonthFromPlan, ensurePlanShape, initializePlanFromMonth, resolvePlanForMonth } from '../netlify/lib/plan-core.mjs';

function base() {
  return ensurePlanShape({
    version: 3,
    recurringExpenses: [{ id: 'spotify', name: 'Spotify', category: 'Subscription', amount: 12 }],
    months: {
      '2026-09': {
        income: 6700,
        housing: 0,
        reinvestment: 5000,
        savingsTarget: 1000,
        planningWeeks: 4,
        payoutDaysPerWeek: 5,
        expenses: [{ id: 'spotify', name: 'Spotify', category: 'Subscription', amount: 12 }],
        trackingStartDay: 28,
        trackingStartMode: 'fresh',
        priorNetSpending: 0,
      },
    },
    dailySpending: { '2026-09-28': { amount: 40, refund: 0 } },
  });
}

const sep28 = new Date('2026-09-28T16:00:00Z');

test('initial month becomes the persistent plan and its actual start becomes the fiscal anchor', () => {
  const state = base();
  initializePlanFromMonth(state, '2026-09', sep28);
  assert.equal(state.planRevisions.length, 1);
  assert.equal(state.planRevisions[0].config.income, 6700);
  assert.equal(state.months['2026-09'].trackingStartDay, 28);
  assert.equal(state.planSettings.financialCycleAnchorDate, '2026-09-28');
  assert.equal(state.months['2026-09'].cycleEndDate, '2026-10-27');
});

test('next fiscal cycle inherits approved targets automatically and starts on the anchor day', () => {
  const state = base();
  initializePlanFromMonth(state, '2026-09', sep28);
  ensureMonthFromPlan(state, '2026-10', new Date('2026-10-28T12:00:00Z'));
  const oct = state.months['2026-10'];
  assert.equal(oct.income, 6700);
  assert.equal(oct.reinvestment, 5000);
  assert.equal(oct.savingsTarget, 1000);
  assert.equal(oct.trackingStartDay, 28);
  assert.equal(oct.trackingStartDate, '2026-10-28');
  assert.equal(oct.cycleStartDate, '2026-10-28');
  assert.equal(oct.cycleEndDate, '2026-11-27');
  assert.equal(oct.trackingStartMode, 'fresh');
  assert.equal(oct.expenses[0].name, 'Spotify');
});

test('ensuring a cycle that already exists never resets it', () => {
  const state = base();
  initializePlanFromMonth(state, '2026-09', sep28);
  state.months['2026-09'].reinvestment = 4800;
  ensureMonthFromPlan(state, '2026-09', new Date('2026-09-29T12:00:00Z'));
  assert.equal(state.months['2026-09'].reinvestment, 4800);
  assert.equal(state.months['2026-09'].trackingStartDay, 28);
});

test('mid-cycle plan revision preserves recorded spending and tracking history', () => {
  const state = base();
  initializePlanFromMonth(state, '2026-09', sep28);
  createPlanRevision(state, {
    effectiveMonth: '2026-09',
    effectiveDate: '2026-09-28',
    applyToMonth: true,
    income: 8000,
    reinvestment: 6000,
    savingsTarget: 1000,
    housing: 0,
    expenses: state.recurringExpenses,
    planningWeeks: 4,
    payoutDaysPerWeek: 5,
    balanceMode: 'protected',
    reason: 'Income increased',
  }, sep28);
  assert.equal(state.months['2026-09'].income, 8000);
  assert.equal(state.months['2026-09'].reinvestment, 6000);
  assert.equal(state.months['2026-09'].trackingStartDay, 28);
  assert.equal(state.dailySpending['2026-09-28'].amount, 40);
});

test('next-cycle revision leaves current cycle untouched and takes over at the next fiscal boundary', () => {
  const state = base();
  initializePlanFromMonth(state, '2026-09', sep28);
  createPlanRevision(state, {
    effectiveMonth: '2026-10',
    effectiveDate: '2026-10-28',
    applyToMonth: false,
    income: 8000,
    reinvestment: 6000,
    savingsTarget: 1000,
    housing: 0,
    expenses: state.recurringExpenses,
    planningWeeks: 4,
    payoutDaysPerWeek: 5,
    balanceMode: 'protected',
  }, sep28);
  assert.equal(state.months['2026-09'].income, 6700);
  assert.equal(resolvePlanForMonth(state, '2026-10').config.income, 8000);
  ensureMonthFromPlan(state, '2026-10', new Date('2026-10-28T12:00:00Z'));
  assert.equal(state.months['2026-10'].income, 8000);
  assert.equal(state.months['2026-10'].reinvestment, 6000);
  assert.equal(state.months['2026-10'].cycleStartDate, '2026-10-28');
});

test('personal-spending mode flexes business while keeping loan target protected', () => {
  const state = base();
  initializePlanFromMonth(state, '2026-09', sep28);
  createPlanRevision(state, {
    effectiveMonth: '2026-10',
    effectiveDate: '2026-10-28',
    income: 8000,
    housing: 0,
    expenses: [],
    reinvestment: 5000,
    savingsTarget: 1000,
    desiredPersonal: 1000,
    balanceMode: 'personal',
    planningWeeks: 4,
    payoutDaysPerWeek: 5,
  }, sep28);
  const plan = resolvePlanForMonth(state, '2026-10');
  assert.equal(plan.config.savingsTarget, 1000);
  assert.equal(plan.config.reinvestment, 6000);
  assert.equal(plan.desiredPersonal, 1000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { financialCycleBounds, financialWeekContext } from '../financial-cycle.js';
import { calculateDay, calculateMonth } from '../engine.js';
import { ensureCycleForDate, initializePlanFromMonth } from '../netlify/lib/plan-core.mjs';

test('September 15 anchor keeps October 1 inside the same financial month', () => {
  const bounds = financialCycleBounds('2026-10-01', '2026-09-15');
  assert.equal(bounds.start, '2026-09-15');
  assert.equal(bounds.end, '2026-10-14');
  assert.equal(bounds.nextStart, '2026-10-15');
  assert.equal(bounds.cycleMonth, '2026-09');
});

test('October 15 begins the next financial month', () => {
  const bounds = financialCycleBounds('2026-10-15', '2026-09-15');
  assert.equal(bounds.start, '2026-10-15');
  assert.equal(bounds.end, '2026-11-14');
  assert.equal(bounds.cycleMonth, '2026-10');
});

test('a Wednesday start creates only a partial first paying week then resets Monday', () => {
  const first = financialWeekContext('2026-09-16', '2026-09-16', 5);
  assert.equal(first.isFirstPartialWeek, true);
  assert.deepEqual(first.payingWeekdays, ['2026-09-16', '2026-09-17', '2026-09-18']);
  const next = financialWeekContext('2026-09-21', '2026-09-16', 5);
  assert.equal(next.isFirstPartialWeek, false);
  assert.deepEqual(next.payingWeekdays, ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
});

function anchoredState() {
  const state = {
    version: 3,
    recurringExpenses: [],
    dailySpending: {},
    months: {
      '2026-09': {
        income: 6000,
        housing: 0,
        reinvestment: 0,
        savingsTarget: 0,
        planningWeeks: 4,
        payoutDaysPerWeek: 5,
        expenses: [],
        trackingStartDay: 15,
        trackingStartMode: 'fresh',
        priorNetSpending: 0,
      },
    },
    planRevisions: [],
    planSettings: {},
  };
  initializePlanFromMonth(state, '2026-09', new Date('2026-09-15T12:00:00Z'));
  return state;
}

test('plan bootstrap locks the first tracking date as the fiscal anchor', () => {
  const state = anchoredState();
  assert.equal(state.planSettings.financialCycleAnchorDate, '2026-09-15');
  assert.equal(state.months['2026-09'].cycleStartDate, '2026-09-15');
  assert.equal(state.months['2026-09'].cycleEndDate, '2026-10-14');
});

test('October 1 does not create or switch to an October budget', () => {
  const state = anchoredState();
  ensureCycleForDate(state, '2026-10-01', new Date('2026-10-01T12:00:00Z'));
  assert.ok(state.months['2026-09']);
  assert.equal(state.months['2026-10'], undefined);
  const day = calculateDay(state, '2026-10-01');
  assert.equal(day.monthKey, '2026-09');
  assert.equal(day.day, 17);
  assert.equal(day.cycleStartDate, '2026-09-15');
  assert.equal(day.cycleEndDate, '2026-10-14');
});

test('October 15 automatically inherits the approved plan into the next cycle', () => {
  const state = anchoredState();
  ensureCycleForDate(state, '2026-10-15', new Date('2026-10-15T12:00:00Z'));
  assert.equal(state.months['2026-10'].income, 6000);
  assert.equal(state.months['2026-10'].cycleStartDate, '2026-10-15');
  assert.equal(state.months['2026-10'].cycleEndDate, '2026-11-14');
  const period = calculateMonth(state, '2026-10');
  assert.equal(period.daysInCycle, 31);
  assert.equal(period.cycleStartDate, '2026-10-15');
});

test('spending on both sides of the calendar boundary remains in one fiscal cycle', () => {
  const state = anchoredState();
  state.dailySpending['2026-09-20'] = { amount: 100, refund: 0 };
  state.dailySpending['2026-10-02'] = { amount: 50, refund: 0 };
  const period = calculateMonth(state, '2026-09');
  assert.equal(period.trackedNetSpent, 150);
  assert.equal(period.cycleStartDate, '2026-09-15');
  assert.equal(period.cycleEndDate, '2026-10-14');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantSnapshot, analyzeAssistantPurchase, weekBounds } from '../assistant-core.js';

function state() {
  return {
    version:3,
    createdAt:'2026-09-01T00:00:00.000Z',
    updatedAt:'2026-09-15T12:00:00.000Z',
    recurringExpenses:[],
    months:{
      '2026-09':{
        income:1000,
        housing:0,
        reinvestment:200,
        savingsTarget:300,
        planningWeeks:4,
        payoutDaysPerWeek:5,
        expenses:[],
        trackingStartDay:1,
        trackingStartDate:'2026-09-01',
        trackingStartMode:'fresh',
        priorNetSpending:0,
        cycleStartDate:'2026-09-01',
        cycleEndDate:'2026-09-30',
      },
    },
    dailySpending:{
      '2026-09-15':{ amount:5, refund:0, note:'', refundNote:'' },
    },
  };
}

test('assistant snapshot exposes only derived current budget values', () => {
  const snapshot = buildAssistantSnapshot(state(), '2026-09-15');
  assert.equal(snapshot.ready, true);
  assert.deepEqual(weekBounds('2026-09-15'), { start:'2026-09-14', end:'2026-09-20' });
  assert.equal(snapshot.cycle.remaining, 495);
  assert.equal(snapshot.protected.businessReinvestmentTarget, 200);
  assert.equal(snapshot.protected.loanSavingsTarget, 300);
  assert.equal(snapshot.today.baseAllowance, 16.67);
  assert.equal(snapshot.today.remaining, 245);
  assert.equal(snapshot.week.remaining, 328.33);
  assert.equal('dailySpending' in snapshot, false);
  assert.equal('accounts' in snapshot, false);
});

test('small purchase is approved from current personal money without touching protected targets', () => {
  const result = analyzeAssistantPurchase(state(), { amount:30, item:'Game DLC', dateKey:'2026-09-15' });
  assert.equal(result.recommendation, 'yes');
  assert.equal(result.purchase.status, 'within-spending');
  assert.equal(result.purchase.cycleRemainingAfter, 465);
  assert.equal(result.purchase.businessTargetAfter, 200);
  assert.equal(result.purchase.loanSavingsTargetAfter, 300);
});

test('purchase that requires business money is not presented as an ordinary yes', () => {
  const result = analyzeAssistantPurchase(state(), { amount:600, item:'Large purchase', dateKey:'2026-09-15' });
  assert.equal(result.recommendation, 'wait');
  assert.equal(result.purchase.status, 'business-impact');
  assert.ok(result.purchase.fromBusiness > 0);
  assert.equal(result.purchase.fromLoanSavings, 0);
});

test('purchase that reaches protected loan savings is rejected', () => {
  const result = analyzeAssistantPurchase(state(), { amount:800, item:'Too expensive', dateKey:'2026-09-15' });
  assert.equal(result.recommendation, 'no');
  assert.equal(result.purchase.status, 'loan-risk');
  assert.ok(result.purchase.fromLoanSavings > 0);
});

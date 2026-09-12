import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetupPlan } from '../setup-engine.js';

test('protected targets leave personal spending as the remainder', () => {
  const plan = buildSetupPlan({ income: 6700, reinvestment: 5000, savingsTarget: 1000 });
  assert.equal(plan.businessTarget, 5000);
  assert.equal(plan.savingsTarget, 1000);
  assert.equal(plan.personalAvailable, 700);
  assert.equal(plan.overAllocated, false);
});

test('personal target can rebalance business without touching loan money', () => {
  const plan = buildSetupPlan({
    income: 6700,
    reinvestment: 5000,
    savingsTarget: 1000,
    desiredPersonal: 1000,
    balanceMode: 'personal',
  });
  assert.equal(plan.businessTarget, 4700);
  assert.equal(plan.savingsTarget, 1000);
  assert.equal(plan.personalAvailable, 1000);
});

test('fixed costs are protected before flexible business and spending buckets', () => {
  const plan = buildSetupPlan({
    income: 8000,
    housing: 1000,
    expenses: [{ amount: 500 }],
    reinvestment: 5000,
    savingsTarget: 500,
  });
  assert.equal(plan.fixedTotal, 1500);
  assert.equal(plan.personalAvailable, 1000);
});

test('impossible personal target never reduces protected loan target', () => {
  const plan = buildSetupPlan({
    income: 3000,
    housing: 1000,
    savingsTarget: 1500,
    desiredPersonal: 1000,
    balanceMode: 'personal',
  });
  assert.equal(plan.businessTarget, 0);
  assert.equal(plan.savingsTarget, 1500);
  assert.equal(plan.personalAvailable, 500);
  assert.equal(plan.desiredPersonalImpossible, true);
});

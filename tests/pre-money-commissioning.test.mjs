import test from 'node:test';
import assert from 'node:assert/strict';
import { runSyntheticCommissioning } from '../commissioning-core.js';

test('pre-money commissioning fixture protects economic-impact invariants', () => {
  const result = runSyntheticCommissioning();
  assert.equal(result.passed, true, JSON.stringify(result.checks));
  assert.equal(result.metrics.cardSettlementRows, 2);
  assert.equal(result.metrics.internalTransferRows, 4);
  assert.equal(result.metrics.refunds, 1);
  assert.equal(result.metrics.subscriptions, 1);
  assert.ok(result.metrics.reviewInbox >= 1);
});

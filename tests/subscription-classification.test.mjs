import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyReserveForCadence } from '../subscription-engine.js';
import { classifySubscriptionTransaction, copySubscriptionsForImport, ensureSubscriptionShape } from '../netlify/lib/subscriptions-core.mjs';

test('non-monthly recurring charges produce a monthly planning reserve', () => {
  assert.equal(monthlyReserveForCadence('annual', 120), 10);
  assert.equal(monthlyReserveForCadence('quarterly', 90), 30);
  assert.equal(monthlyReserveForCadence('monthly', 15), 15);
});

test('future transaction sync can identify a confirmed recurring charge before spending logic runs', () => {
  const state = ensureSubscriptionShape({
    subscriptionCandidates: [{
      id: 'spotify-stream',
      status: 'confirmed',
      recurringExpenseId: 'spotify-expense',
      canonicalMerchant: 'SPOTIFY',
      averageAmount: 12.99,
      accountId: 'card-source',
    }],
  });
  assert.deepEqual(
    classifySubscriptionTransaction(state, { merchantName: 'Spotify', amount: 12.99, accountId: 'card-source' }),
    { classification: 'planned_recurring', recurringExpenseId: 'spotify-expense', candidateId: 'spotify-stream' },
  );
  assert.deepEqual(
    classifySubscriptionTransaction(state, { merchantName: 'Target', amount: 12.99, accountId: 'card-source' }),
    { classification: 'unclassified' },
  );
});

test('subscription discovery and review state survives backup restore copying', () => {
  const source = ensureSubscriptionShape({
    subscriptionFeedTransactions: [{ sourceTransactionId: 'a', date: '2026-08-01', merchantName: 'Test', amount: 10 }],
    subscriptionCandidates: [{ id: 'candidate', status: 'ignored', merchantName: 'Test' }],
    subscriptionSettings: { autopayFundingAccountLabel: 'Main Checking' },
    subscriptionReviewLog: [{ id: 'log', action: 'ignored' }],
  });
  const target = ensureSubscriptionShape({});
  copySubscriptionsForImport(source, target);
  assert.equal(target.subscriptionFeedTransactions.length, 1);
  assert.equal(target.subscriptionCandidates[0].status, 'ignored');
  assert.equal(target.subscriptionSettings.autopayFundingAccountLabel, 'Main Checking');
  assert.equal(target.subscriptionReviewLog.length, 1);
});

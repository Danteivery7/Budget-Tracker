import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriptionRoutingSummary, detectRecurringCharges, matchConfirmedRecurring, normalizeMerchant } from '../subscription-engine.js';

test('detects a monthly recurring charge even when date and amount drift slightly', () => {
  const rows = [
    { id: '1', date: '2026-06-05', merchantName: 'Spotify USA', amount: 11.99, accountId: 'card-a', category: 'Streaming subscription' },
    { id: '2', date: '2026-07-06', merchantName: 'SPOTIFY USA', amount: 11.99, accountId: 'card-a', category: 'Streaming subscription' },
    { id: '3', date: '2026-08-05', merchantName: 'Spotify USA', amount: 12.99, accountId: 'card-a', category: 'Streaming subscription' },
  ];
  const [candidate] = detectRecurringCharges(rows);
  assert.equal(candidate.frequency, 'monthly');
  assert.equal(candidate.occurrenceCount, 3);
  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.suggestedType, 'subscription');
  assert.ok(candidate.confidence >= 0.8);
});

test('keeps the same merchant on separate accounts as separate recurring streams', () => {
  const rows = [
    { id: '1', date: '2026-06-01', merchantName: 'Service X', amount: 10, accountId: 'a' },
    { id: '2', date: '2026-07-01', merchantName: 'Service X', amount: 10, accountId: 'a' },
    { id: '3', date: '2026-06-15', merchantName: 'Service X', amount: 20, accountId: 'b' },
    { id: '4', date: '2026-07-15', merchantName: 'Service X', amount: 20, accountId: 'b' },
  ];
  assert.equal(detectRecurringCharges(rows).length, 2);
});

test('preserves ignored review state during a later rescan', () => {
  const rows = [
    { id: '1', date: '2026-06-05', merchantName: 'YouTube Premium', amount: 13.99, accountId: 'a' },
    { id: '2', date: '2026-07-05', merchantName: 'YouTube Premium', amount: 13.99, accountId: 'a' },
  ];
  const first = detectRecurringCharges(rows);
  first[0].status = 'ignored';
  const rescanned = detectRecurringCharges([...rows, { id: '3', date: '2026-08-05', merchantName: 'YouTube Premium', amount: 13.99, accountId: 'a' }], first);
  assert.equal(rescanned[0].status, 'ignored');
});

test('matches a future posted charge to a confirmed recurring obligation', () => {
  const candidates = [{ id: 'c1', status: 'confirmed', recurringExpenseId: 'e1', canonicalMerchant: normalizeMerchant('YouTube Premium'), averageAmount: 13.99, accountId: 'a' }];
  const result = matchConfirmedRecurring({ merchantName: 'YOUTUBE PREMIUM', amount: 14.49, accountId: 'a' }, candidates);
  assert.deepEqual(result, { classification: 'planned_recurring', recurringExpenseId: 'e1', candidateId: 'c1' });
});

test('routing summary treats card payoff cash as settlement and does not add a second expense', () => {
  const state = {
    paymentMethods: [
      { id: 'credit', name: 'NEU', type: 'credit', last4: '1234', autopayDay: 18 },
      { id: 'debit', name: 'Checking Debit', type: 'debit', last4: '9999' },
    ],
    recurringExpenses: [
      { id: 'spotify', name: 'Spotify', amount: 12 },
      { id: 'youtube', name: 'YouTube', amount: 14 },
      { id: 'cloud', name: 'Cloud', amount: 5 },
    ],
    recurringPaymentMeta: {
      spotify: { active: true, paymentMethodId: 'credit' },
      youtube: { active: true, paymentMethodId: 'credit' },
      cloud: { active: true, paymentMethodId: 'debit' },
    },
    subscriptionCandidates: [],
  };
  const summary = buildSubscriptionRoutingSummary(state);
  assert.equal(summary.recurringTotal, 31);
  assert.equal(summary.checkingAutopayRequirement, 26);
  assert.equal(summary.directDebitRequirement, 5);
  assert.equal(summary.unassignedTotal, 0);
});

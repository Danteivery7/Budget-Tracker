import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCardsMutation, ensureCardsShape } from '../netlify/lib/cards-core.mjs';
import { applySubscriptionMutation, ensureSubscriptionShape, subscriptionView } from '../netlify/lib/subscriptions-core.mjs';

const now = new Date(2026, 8, 12, 12, 0, 0);

function base() {
  return ensureSubscriptionShape(ensureCardsShape({
    version: 3,
    recurringExpenses: [],
    months: {
      '2026-09': { income: 6700, housing: 0, reinvestment: 5000, savingsTarget: 1000, expenses: [], trackingStartDay: 1, trackingStartMode: 'fresh', priorNetSpending: 0 },
    },
    dailySpending: {},
  }));
}

function withCards() {
  let state = base();
  state = applyCardsMutation(state, 'savePaymentMethod', { type: 'credit', name: 'NEU', last4: '1234', purpose: 'Flexible recurring', autopayDay: 20 }, now);
  state = applyCardsMutation(state, 'savePaymentMethod', { type: 'credit', name: 'Backup', last4: '5678', purpose: 'Other', autopayDay: 25 }, now);
  return ensureSubscriptionShape(state);
}

function spotifyFeed() {
  return [
    { sourceTransactionId: 'sp1', date: '2026-06-05', merchantName: 'Spotify', amount: 11.99, accountId: 'source-neu', category: 'Streaming subscription' },
    { sourceTransactionId: 'sp2', date: '2026-07-05', merchantName: 'Spotify', amount: 11.99, accountId: 'source-neu', category: 'Streaming subscription' },
    { sourceTransactionId: 'sp3', date: '2026-08-05', merchantName: 'Spotify', amount: 12.99, accountId: 'source-neu', category: 'Streaming subscription' },
  ];
}

test('ingesting posted history creates a pending confirmation instead of changing the budget', () => {
  let state = withCards();
  state = applySubscriptionMutation(state, 'ingestTransactions', { transactions: spotifyFeed() }, now);
  assert.equal(state.subscriptionCandidates.length, 1);
  assert.equal(state.subscriptionCandidates[0].status, 'pending');
  assert.equal(state.recurringExpenses.length, 0);
  assert.equal(state.months['2026-09'].expenses.length, 0);
});

test('confirming a candidate creates one recurring obligation and assigns it to a chosen card', () => {
  let state = withCards();
  const neu = state.paymentMethods.find((card) => card.name === 'NEU');
  state = applySubscriptionMutation(state, 'ingestTransactions', { transactions: spotifyFeed() }, now);
  const candidate = state.subscriptionCandidates[0];
  state = applySubscriptionMutation(state, 'confirmCandidate', {
    candidateId: candidate.id,
    name: 'Spotify Premium',
    amount: 12.99,
    recurringType: 'subscription',
    paymentMethodId: neu.id,
    chargeDay: 5,
    countCurrentMonth: true,
  }, now);
  assert.equal(state.subscriptionCandidates[0].status, 'confirmed');
  assert.equal(state.recurringExpenses.length, 1);
  assert.equal(state.recurringPaymentMeta[state.recurringExpenses[0].id].paymentMethodId, neu.id);
  assert.equal(state.months['2026-09'].expenses.length, 1);
});

test('ignored candidates stay out of the budget and can be reopened', () => {
  let state = withCards();
  state = applySubscriptionMutation(state, 'ingestTransactions', { transactions: spotifyFeed() }, now);
  const id = state.subscriptionCandidates[0].id;
  state = applySubscriptionMutation(state, 'ignoreCandidate', { candidateId: id }, now);
  assert.equal(state.subscriptionCandidates[0].status, 'ignored');
  assert.equal(state.recurringExpenses.length, 0);
  state = applySubscriptionMutation(state, 'reopenCandidate', { candidateId: id }, now);
  assert.equal(state.subscriptionCandidates[0].status, 'pending');
});

test('bulk routing can centralize every active recurring charge on one card', () => {
  let state = withCards();
  const neu = state.paymentMethods.find((card) => card.name === 'NEU');
  const backup = state.paymentMethods.find((card) => card.name === 'Backup');
  state = applyCardsMutation(state, 'saveRecurringPayment', { name: 'YouTube Premium', amount: 14, chargeDay: 10, paymentMethodId: backup.id }, now);
  state = applyCardsMutation(state, 'saveRecurringPayment', { name: 'Spotify', amount: 13, chargeDay: 20, paymentMethodId: backup.id }, now);
  state = ensureSubscriptionShape(state);
  state = applySubscriptionMutation(state, 'bulkAssignSubscriptions', { paymentMethodId: neu.id }, now);
  for (const expense of state.recurringExpenses) assert.equal(state.recurringPaymentMeta[expense.id].paymentMethodId, neu.id);
  const view = subscriptionView(state);
  assert.equal(view.routing.checkingAutopayRequirement, 27);
});

test('ending a confirmed discovered subscription removes future active recurring tracking', () => {
  let state = withCards();
  const neu = state.paymentMethods.find((card) => card.name === 'NEU');
  state = applySubscriptionMutation(state, 'ingestTransactions', { transactions: spotifyFeed() }, now);
  const candidate = state.subscriptionCandidates[0];
  state = applySubscriptionMutation(state, 'confirmCandidate', { candidateId: candidate.id, paymentMethodId: neu.id, chargeDay: 20 }, now);
  const expenseId = state.subscriptionCandidates[0].recurringExpenseId;
  state = applySubscriptionMutation(state, 'endSubscription', { recurringExpenseId: expenseId }, now);
  assert.equal(state.subscriptionCandidates[0].status, 'ended');
  assert.equal(state.recurringExpenses.some((expense) => expense.id === expenseId), false);
});

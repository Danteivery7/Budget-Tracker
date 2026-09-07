import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCardsMutation, ensureCardsShape } from '../netlify/lib/cards-core.mjs';

function base() {
  return ensureCardsShape({
    version: 3,
    recurringExpenses: [],
    months: {
      '2026-09': { income: 15000, housing: 3000, reinvestment: 7000, expenses: [], trackingStartDay: 1, trackingStartMode: 'fresh', priorNetSpending: 0 },
    },
    dailySpending: {},
  });
}
const now = new Date(2026, 8, 7, 12, 0, 0);

function withCard(state = base()) {
  return applyCardsMutation(state, 'savePaymentMethod', { type: 'credit', name: 'Subscriptions', last4: '1234', purpose: 'Subscriptions', autopayDay: 20 }, now);
}

test('stores only last four and card metadata without changing budget', () => {
  const state = withCard();
  assert.equal(state.paymentMethods.length, 1);
  assert.equal(state.paymentMethods[0].last4, '1234');
  assert.equal(state.paymentMethods[0].autopayDay, 20);
  assert.equal(state.months['2026-09'].expenses.length, 0);
});

test('new recurring payment with upcoming charge updates current month and template', () => {
  let state = withCard();
  const cardId = state.paymentMethods[0].id;
  state = applyCardsMutation(state, 'saveRecurringPayment', { name: 'YouTube TV', amount: 75, chargeDay: 15, paymentMethodId: cardId, category: 'Streaming' }, now);
  assert.equal(state.recurringExpenses[0].amount, 75);
  assert.equal(state.months['2026-09'].expenses[0].amount, 75);
  assert.equal(state.recurringPaymentMeta[state.recurringExpenses[0].id].paymentMethodId, cardId);
});

test('new recurring payment whose charge day already passed starts with future template instead of rewriting current month', () => {
  let state = withCard();
  const cardId = state.paymentMethods[0].id;
  state = applyCardsMutation(state, 'saveRecurringPayment', { name: 'Old-cycle charge', amount: 50, chargeDay: 5, paymentMethodId: cardId, countCurrentMonth: false }, now);
  assert.equal(state.recurringExpenses.length, 1);
  assert.equal(state.months['2026-09'].expenses.length, 0);
});

test('cancel upcoming recurring payment removes it from current month but preserves past charged month cost', () => {
  let state = withCard();
  const cardId = state.paymentMethods[0].id;
  state = applyCardsMutation(state, 'saveRecurringPayment', { name: 'Upcoming', amount: 75, chargeDay: 15, paymentMethodId: cardId }, now);
  const upcomingId = state.recurringExpenses[0].id;
  state = applyCardsMutation(state, 'deleteRecurringPayment', { id: upcomingId }, now);
  assert.equal(state.months['2026-09'].expenses.length, 0);

  state = withCard(base());
  const card2 = state.paymentMethods[0].id;
  state.months['2026-09'].expenses.push({ id: 'already', name: 'Already charged', category: 'Bills', amount: 40 });
  state.recurringExpenses.push({ id: 'already', name: 'Already charged', category: 'Bills', amount: 40 });
  state.recurringPaymentMeta.already = { expenseId: 'already', paymentMethodId: card2, chargeDay: 3, active: true };
  state = applyCardsMutation(state, 'deleteRecurringPayment', { id: 'already' }, now);
  assert.equal(state.months['2026-09'].expenses.length, 1);
  assert.equal(state.recurringExpenses.length, 0);
});

test('one-time purchase and refund feed the same daily budget entry', () => {
  let state = withCard();
  const cardId = state.paymentMethods[0].id;
  state = applyCardsMutation(state, 'saveTransaction', { date: '2026-09-07', paymentMethodId: cardId, kind: 'purchase', amount: 100, note: 'Game' }, now);
  state = applyCardsMutation(state, 'saveTransaction', { date: '2026-09-07', paymentMethodId: cardId, kind: 'refund', amount: 30, note: 'Refund' }, now);
  assert.equal(state.dailySpending['2026-09-07'].amount, 100);
  assert.equal(state.dailySpending['2026-09-07'].refund, 30);
  assert.equal(state.cardTransactions.length, 2);
});

test('editing a transaction reverses its old budget impact before applying the new one', () => {
  let state = withCard();
  const cardId = state.paymentMethods[0].id;
  state = applyCardsMutation(state, 'saveTransaction', { date: '2026-09-07', paymentMethodId: cardId, kind: 'purchase', amount: 100, note: 'Game' }, now);
  const id = state.cardTransactions[0].id;
  state = applyCardsMutation(state, 'saveTransaction', { id, date: '2026-09-07', paymentMethodId: cardId, kind: 'purchase', amount: 125, note: 'Game + tax' }, now);
  assert.equal(state.dailySpending['2026-09-07'].amount, 125);
  assert.equal(state.cardTransactions[0].amount, 125);
});

test('deleting a transaction reverses its daily budget impact', () => {
  let state = withCard();
  const cardId = state.paymentMethods[0].id;
  state = applyCardsMutation(state, 'saveTransaction', { date: '2026-09-07', paymentMethodId: cardId, kind: 'purchase', amount: 100 }, now);
  const id = state.cardTransactions[0].id;
  state = applyCardsMutation(state, 'deleteTransaction', { id }, now);
  assert.equal(state.cardTransactions.length, 0);
  assert.equal(state.dailySpending['2026-09-07'], undefined);
});

test('card transactions cannot be logged before tracking begins', () => {
  let state = withCard();
  state.months['2026-09'].trackingStartDay = 7;
  const cardId = state.paymentMethods[0].id;
  assert.throws(() => applyCardsMutation(state, 'saveTransaction', { date: '2026-09-06', paymentMethodId: cardId, kind: 'purchase', amount: 25 }, now), /before this month/);
});

import { copyCardsForImport } from '../netlify/lib/cards-core.mjs';

test('backup restore preserves card metadata and card transactions', () => {
  let source = withCard();
  const cardId = source.paymentMethods[0].id;
  source = applyCardsMutation(source, 'saveRecurringPayment', { name: 'ChatGPT', amount: 20, chargeDay: 7, paymentMethodId: cardId }, now);
  source = applyCardsMutation(source, 'saveTransaction', { date: '2026-09-07', paymentMethodId: cardId, kind: 'purchase', amount: 50, note: 'Headphones' }, now);
  const target = ensureCardsShape({ version: 3, recurringExpenses: source.recurringExpenses, months: source.months, dailySpending: source.dailySpending });
  copyCardsForImport(source, target);
  assert.equal(target.paymentMethods.length, 1);
  assert.equal(target.cardTransactions.length, 1);
  assert.equal(target.recurringPaymentMeta[source.recurringExpenses[0].id].paymentMethodId, cardId);
});

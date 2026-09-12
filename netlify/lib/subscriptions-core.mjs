import { randomUUID } from 'node:crypto';
import { applyCardsMutation, ensureCardsShape } from './cards-core.mjs';
import { buildSubscriptionRoutingSummary, detectRecurringCharges, matchConfirmedRecurring } from '../../subscription-engine.js';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const text = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function money(value, label = 'Amount') {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0 || number > 1_000_000_000) throw new Error(`${label} must be greater than zero.`);
  return roundMoney(number);
}

function validateDate(value) {
  const date = text(value, 10);
  if (!DATE_RE.test(date)) throw new Error('Invalid transaction date.');
  return date;
}

function dayOfMonth(value, fallback = 1) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 31) throw new Error('Charge day must be between 1 and 31.');
  return number;
}

function currentDay(now) {
  return Number(String(now.getDate()).padStart(2, '0'));
}

export function ensureSubscriptionShape(sourceState) {
  const state = ensureCardsShape(sourceState || {});
  state.subscriptionFeedTransactions = Array.isArray(state.subscriptionFeedTransactions) ? state.subscriptionFeedTransactions : [];
  state.subscriptionCandidates = Array.isArray(state.subscriptionCandidates) ? state.subscriptionCandidates : [];
  state.subscriptionFeedSummary = state.subscriptionFeedSummary && typeof state.subscriptionFeedSummary === 'object' && !Array.isArray(state.subscriptionFeedSummary)
    ? state.subscriptionFeedSummary
    : { transactionCount: 0, lastTransactionDate: null, connected: false, updatedAt: null };
  const settings = state.subscriptionSettings && typeof state.subscriptionSettings === 'object' && !Array.isArray(state.subscriptionSettings)
    ? state.subscriptionSettings
    : {};
  state.subscriptionSettings = {
    ...settings,
    discoveryEnabled: settings.discoveryEnabled !== false,
    defaultPaymentMethodId: text(settings.defaultPaymentMethodId, 80),
    autopayFundingAccountId: text(settings.autopayFundingAccountId, 100),
    autopayFundingAccountLabel: text(settings.autopayFundingAccountLabel, 80) || 'Checking',
  };
  state.subscriptionReviewLog = Array.isArray(state.subscriptionReviewLog) ? state.subscriptionReviewLog : [];
  return state;
}

function cleanFeedTransaction(input, nowIso) {
  const merchantName = text(input?.merchantName || input?.name, 120);
  if (!merchantName) throw new Error('Recurring-charge feed transaction needs a merchant name.');
  return {
    id: text(input?.id, 100) || randomUUID(),
    sourceTransactionId: text(input?.sourceTransactionId || input?.id, 140) || randomUUID(),
    date: validateDate(input?.date),
    merchantName,
    amount: money(input?.amount, 'Transaction amount'),
    accountId: text(input?.accountId, 120),
    paymentMethodId: text(input?.paymentMethodId, 80),
    category: text(input?.category, 80),
    kindHint: text(input?.kindHint, 40),
    source: text(input?.source, 40) || 'linked-account',
    posted: input?.posted !== false,
    updatedAt: nowIso,
  };
}

function refreshCandidates(state) {
  if (!state.subscriptionSettings.discoveryEnabled) return state;
  state.subscriptionCandidates = detectRecurringCharges(
    state.subscriptionFeedTransactions.filter((row) => row.posted !== false),
    state.subscriptionCandidates,
  );
  return state;
}

export function refreshSubscriptionCandidatesFromLinkedBankRows(sourceState, rows = [], now = new Date()) {
  const state = ensureSubscriptionShape(sourceState || {});
  const safeRows = (Array.isArray(rows) ? rows : []).filter((row) => row && row.posted !== false && row.date && Number(row.amount) > 0);
  if (state.subscriptionSettings.discoveryEnabled) {
    state.subscriptionCandidates = detectRecurringCharges(safeRows, state.subscriptionCandidates);
  }
  const dates = safeRows.map((row) => String(row.date || '')).filter(Boolean).sort();
  state.subscriptionFeedSummary = {
    transactionCount: safeRows.length,
    lastTransactionDate: dates.at(-1) || null,
    connected: true,
    updatedAt: now.toISOString(),
  };
  state.updatedAt = now.toISOString();
  return state;
}

export function markLinkedBankFeedDisconnected(sourceState, remainingTransactionCount = 0, now = new Date()) {
  const state = ensureSubscriptionShape(sourceState || {});
  state.subscriptionFeedSummary = {
    transactionCount: Math.max(0, Number(remainingTransactionCount || 0)),
    lastTransactionDate: state.subscriptionFeedSummary?.lastTransactionDate || null,
    connected: remainingTransactionCount > 0,
    updatedAt: now.toISOString(),
  };
  state.updatedAt = now.toISOString();
  return state;
}

function candidateById(state, id) {
  const candidate = state.subscriptionCandidates.find((item) => item.id === id);
  if (!candidate) throw new Error('Recurring-charge candidate not found.');
  return candidate;
}

function recurringById(state, id) {
  const expense = state.recurringExpenses.find((item) => item.id === id);
  if (!expense) throw new Error('Recurring payment not found.');
  return expense;
}

function paymentMethodById(state, id) {
  if (!id) return null;
  const card = state.paymentMethods.find((item) => item.id === id && !item.archivedAt);
  if (!card) throw new Error('That payment method is unavailable.');
  return card;
}

function reviewLog(state, action, candidate, nowIso) {
  state.subscriptionReviewLog.push({ id: randomUUID(), action, candidateId: candidate?.id || '', merchantName: candidate?.merchantName || '', at: nowIso });
  if (state.subscriptionReviewLog.length > 250) state.subscriptionReviewLog = state.subscriptionReviewLog.slice(-250);
}

function confirmCandidate(state, payload, now) {
  const nowIso = now.toISOString();
  const candidate = candidateById(state, text(payload?.candidateId, 100));
  const recurringExpenseId = candidate.recurringExpenseId || `sub_${candidate.id}`;
  const paymentMethodId = text(payload?.paymentMethodId || candidate.paymentMethodId || state.subscriptionSettings.defaultPaymentMethodId, 80);
  if (paymentMethodId) paymentMethodById(state, paymentMethodId);
  const chargeDay = dayOfMonth(payload?.chargeDay, candidate.chargeDay || 1);
  const category = payload?.recurringType === 'bill' ? 'Bill' : text(payload?.category, 50) || 'Subscription';
  const countCurrentMonth = payload?.countCurrentMonth !== false;
  const monthlyAmount = payload?.amount != null ? money(payload.amount, 'Monthly recurring reserve') : candidate.monthlyReserveAmount || candidate.averageAmount;
  const next = applyCardsMutation(state, 'saveRecurringPayment', {
    id: recurringExpenseId,
    name: text(payload?.name, 80) || candidate.merchantName,
    amount: monthlyAmount,
    category,
    chargeDay,
    paymentMethodId,
    countCurrentMonth,
  }, now);
  ensureSubscriptionShape(next);
  const saved = next.subscriptionCandidates.find((item) => item.id === candidate.id);
  Object.assign(saved, {
    status: 'confirmed',
    recurringExpenseId,
    suggestedType: payload?.recurringType === 'bill' ? 'bill' : 'subscription',
    paymentMethodId,
    chargeDay,
    monthlyReserveAmount: monthlyAmount,
    reviewedAt: nowIso,
    updatedAt: nowIso,
  });
  next.recurringPaymentMeta[recurringExpenseId] = {
    ...next.recurringPaymentMeta[recurringExpenseId],
    sourceCandidateId: candidate.id,
    detectedFrequency: candidate.frequency,
    occurrenceAmount: candidate.averageAmount,
    monthlyReserveAmount: monthlyAmount,
  };
  reviewLog(next, 'confirmed', saved, nowIso);
  return next;
}

function assignRecurring(state, expenseId, paymentMethodId, now, applyCurrentMonth) {
  const expense = recurringById(state, expenseId);
  const meta = state.recurringPaymentMeta?.[expense.id] || {};
  paymentMethodById(state, paymentMethodId);
  const chargeDay = Number(meta.chargeDay || 1);
  const countCurrentMonth = applyCurrentMonth === true || (applyCurrentMonth !== false && chargeDay >= currentDay(now));
  const preservedMeta = { ...meta };
  const next = applyCardsMutation(state, 'saveRecurringPayment', {
    id: expense.id,
    name: expense.name,
    amount: expense.amount,
    category: expense.category,
    chargeDay,
    paymentMethodId,
    countCurrentMonth,
  }, now);
  ensureSubscriptionShape(next);
  next.recurringPaymentMeta[expense.id] = { ...next.recurringPaymentMeta[expense.id], ...preservedMeta, paymentMethodId, updatedAt: now.toISOString(), active: true, endedAt: null };
  const candidate = next.subscriptionCandidates.find((item) => item.recurringExpenseId === expense.id);
  if (candidate) {
    candidate.paymentMethodId = paymentMethodId;
    candidate.updatedAt = now.toISOString();
  }
  return next;
}

export function classifySubscriptionTransaction(state, transaction) {
  const normalized = ensureSubscriptionShape(structuredClone(state || {}));
  return matchConfirmedRecurring(transaction, normalized.subscriptionCandidates) || { classification: 'unclassified' };
}

export function applySubscriptionMutation(sourceState, action, payload = {}, now = new Date()) {
  let state = ensureSubscriptionShape(structuredClone(sourceState || {}));
  const nowIso = now.toISOString();

  if (action === 'ingestTransactions') {
    const rows = Array.isArray(payload?.transactions) ? payload.transactions : [];
    if (!rows.length) throw new Error('No transactions were provided.');
    const bySourceId = new Map(state.subscriptionFeedTransactions.map((item, index) => [item.sourceTransactionId, index]));
    for (const input of rows.slice(0, 2000)) {
      const cleaned = cleanFeedTransaction(input, nowIso);
      const existingIndex = bySourceId.get(cleaned.sourceTransactionId);
      if (existingIndex == null) {
        bySourceId.set(cleaned.sourceTransactionId, state.subscriptionFeedTransactions.length);
        state.subscriptionFeedTransactions.push(cleaned);
      } else {
        state.subscriptionFeedTransactions[existingIndex] = { ...state.subscriptionFeedTransactions[existingIndex], ...cleaned };
      }
    }
    refreshCandidates(state);
  } else if (action === 'refreshCandidates') {
    refreshCandidates(state);
  } else if (action === 'confirmCandidate') {
    state = confirmCandidate(state, payload, now);
  } else if (action === 'ignoreCandidate') {
    const candidate = candidateById(state, text(payload?.candidateId, 100));
    candidate.status = 'ignored';
    candidate.reviewedAt = nowIso;
    candidate.updatedAt = nowIso;
    reviewLog(state, 'ignored', candidate, nowIso);
  } else if (action === 'reopenCandidate') {
    const candidate = candidateById(state, text(payload?.candidateId, 100));
    candidate.status = 'pending';
    candidate.reviewedAt = null;
    candidate.updatedAt = nowIso;
    reviewLog(state, 'reopened', candidate, nowIso);
  } else if (action === 'endSubscription') {
    const expenseId = text(payload?.recurringExpenseId, 100);
    const candidate = state.subscriptionCandidates.find((item) => item.recurringExpenseId === expenseId);
    state = applyCardsMutation(state, 'deleteRecurringPayment', { id: expenseId }, now);
    ensureSubscriptionShape(state);
    const updatedCandidate = candidate ? state.subscriptionCandidates.find((item) => item.id === candidate.id) : null;
    if (updatedCandidate) {
      updatedCandidate.status = 'ended';
      updatedCandidate.reviewedAt = nowIso;
      updatedCandidate.updatedAt = nowIso;
      reviewLog(state, 'ended', updatedCandidate, nowIso);
    }
  } else if (action === 'assignSubscription') {
    state = assignRecurring(state, text(payload?.recurringExpenseId, 100), text(payload?.paymentMethodId, 80), now, payload?.applyCurrentMonth);
  } else if (action === 'bulkAssignSubscriptions') {
    const paymentMethodId = text(payload?.paymentMethodId, 80);
    paymentMethodById(state, paymentMethodId);
    const ids = Array.isArray(payload?.recurringExpenseIds) && payload.recurringExpenseIds.length
      ? payload.recurringExpenseIds.map((id) => text(id, 100))
      : state.recurringExpenses.filter((expense) => state.recurringPaymentMeta?.[expense.id]?.active !== false).map((expense) => expense.id);
    for (const id of ids) state = assignRecurring(state, id, paymentMethodId, now, payload?.applyCurrentMonth);
  } else if (action === 'saveSubscriptionSettings') {
    const defaultPaymentMethodId = text(payload?.defaultPaymentMethodId, 80);
    if (defaultPaymentMethodId) paymentMethodById(state, defaultPaymentMethodId);
    state.subscriptionSettings = {
      ...state.subscriptionSettings,
      discoveryEnabled: payload?.discoveryEnabled !== false,
      defaultPaymentMethodId,
      autopayFundingAccountId: text(payload?.autopayFundingAccountId, 100),
      autopayFundingAccountLabel: text(payload?.autopayFundingAccountLabel, 80) || 'Checking',
      updatedAt: nowIso,
    };
    if (state.subscriptionSettings.discoveryEnabled) refreshCandidates(state);
  } else {
    throw new Error('Unknown subscription action.');
  }

  state.updatedAt = nowIso;
  return ensureSubscriptionShape(state);
}

export function subscriptionView(state) {
  const normalized = ensureSubscriptionShape(structuredClone(state || {}));
  const manualDates = normalized.subscriptionFeedTransactions.map((item) => item.date).filter(Boolean).sort();
  const manualLinked = normalized.subscriptionFeedTransactions.some((item) => item.source === 'linked-account');
  const summary = normalized.subscriptionFeedSummary || {};
  return {
    candidates: normalized.subscriptionCandidates,
    settings: normalized.subscriptionSettings,
    routing: buildSubscriptionRoutingSummary(normalized),
    feed: {
      transactionCount: Math.max(Number(summary.transactionCount || 0), normalized.subscriptionFeedTransactions.length),
      lastTransactionDate: summary.lastTransactionDate || manualDates.at(-1) || null,
      connected: summary.connected === true || manualLinked,
      updatedAt: summary.updatedAt || null,
    },
  };
}

export function copySubscriptionsForImport(source, target) {
  ensureSubscriptionShape(target);
  const normalized = ensureSubscriptionShape(structuredClone(source || {}));
  target.subscriptionFeedTransactions = normalized.subscriptionFeedTransactions;
  target.subscriptionCandidates = normalized.subscriptionCandidates;
  target.subscriptionFeedSummary = normalized.subscriptionFeedSummary;
  target.subscriptionSettings = normalized.subscriptionSettings;
  target.subscriptionReviewLog = normalized.subscriptionReviewLog;
  return target;
}

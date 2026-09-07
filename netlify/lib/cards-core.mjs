import { randomUUID } from 'node:crypto';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);

function money(value, label = 'Amount') {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) {
    throw new Error(`${label} must be a valid non-negative number.`);
  }
  return roundMoney(number);
}

function integerDay(value, label, allowBlank = false) {
  if ((value === '' || value == null) && allowBlank) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 31) throw new Error(`${label} must be between 1 and 31.`);
  return number;
}

function validateDate(date) {
  const value = text(date, 10);
  if (!DATE_RE.test(value)) throw new Error('Invalid date.');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('Invalid date.');
  return value;
}

function localDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ensureCardsShape(state) {
  state.paymentMethods = Array.isArray(state.paymentMethods) ? state.paymentMethods : [];
  state.recurringPaymentMeta = state.recurringPaymentMeta && typeof state.recurringPaymentMeta === 'object' && !Array.isArray(state.recurringPaymentMeta) ? state.recurringPaymentMeta : {};
  state.recurringPaymentSnapshots = state.recurringPaymentSnapshots && typeof state.recurringPaymentSnapshots === 'object' && !Array.isArray(state.recurringPaymentSnapshots) ? state.recurringPaymentSnapshots : {};
  state.cardTransactions = Array.isArray(state.cardTransactions) ? state.cardTransactions : [];
  state.housingPaymentMeta = state.housingPaymentMeta && typeof state.housingPaymentMeta === 'object' && !Array.isArray(state.housingPaymentMeta) ? state.housingPaymentMeta : {};
  state.housingPaymentSnapshots = state.housingPaymentSnapshots && typeof state.housingPaymentSnapshots === 'object' && !Array.isArray(state.housingPaymentSnapshots) ? state.housingPaymentSnapshots : {};
  state.recurringExpenses = Array.isArray(state.recurringExpenses) ? state.recurringExpenses : [];
  state.months = state.months && typeof state.months === 'object' ? state.months : {};
  state.dailySpending = state.dailySpending && typeof state.dailySpending === 'object' ? state.dailySpending : {};
  return state;
}

function activeCard(state, cardId, allowArchived = false) {
  if (!cardId) return null;
  const card = state.paymentMethods.find((item) => item.id === cardId);
  if (!card || (!allowArchived && card.archivedAt)) throw new Error('That payment method is no longer available.');
  return card;
}

function cleanCard(input, existing, nowIso) {
  const type = input?.type === 'debit' ? 'debit' : 'credit';
  const last4 = text(input?.last4, 4).replace(/\D/g, '');
  if (last4.length !== 4) throw new Error('Enter exactly the last four digits of the card.');
  const name = text(input?.name, 60);
  if (!name) throw new Error('Give the card a name.');
  const autopayDay = type === 'credit' ? integerDay(input?.autopayDay, 'Autopay day', true) : null;
  return {
    id: existing?.id || text(input?.id, 80) || randomUUID(),
    type,
    name,
    last4,
    purpose: text(input?.purpose, 100),
    autopayDay,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    archivedAt: existing?.archivedAt || null,
  };
}

function cleanExpense(input, id) {
  const name = text(input?.name, 80);
  if (!name) throw new Error('Give the recurring payment a name.');
  return {
    id: id || text(input?.id, 80) || randomUUID(),
    name,
    category: text(input?.category, 40) || 'Recurring payment',
    amount: money(input?.amount, 'Recurring payment amount'),
  };
}

function currentMonthContext(state, now) {
  const today = localDateKey(now);
  const month = today.slice(0, 7);
  return { today, month, day: Number(today.slice(-2)), configured: Boolean(state.months?.[month]) };
}

function snapshotRecurring(state, month, expense, meta) {
  state.recurringPaymentSnapshots[month] ||= {};
  state.recurringPaymentSnapshots[month][expense.id] = {
    expenseId: expense.id,
    name: expense.name,
    category: expense.category,
    amount: expense.amount,
    paymentMethodId: meta?.paymentMethodId || '',
    chargeDay: Number(meta?.chargeDay || 1),
    updatedAt: new Date().toISOString(),
  };
}

function upsertMonthExpense(state, month, expense) {
  const cfg = state.months?.[month];
  if (!cfg) return;
  cfg.expenses = Array.isArray(cfg.expenses) ? cfg.expenses : [];
  const index = cfg.expenses.findIndex((item) => item.id === expense.id);
  if (index >= 0) cfg.expenses[index] = { ...expense };
  else cfg.expenses.push({ ...expense });
  cfg.updatedAt = new Date().toISOString();
}

function removeMonthExpense(state, month, expenseId) {
  const cfg = state.months?.[month];
  if (!cfg) return;
  cfg.expenses = (cfg.expenses || []).filter((item) => item.id !== expenseId);
  cfg.updatedAt = new Date().toISOString();
}

function normalizeDailyEntry(entry = {}) {
  return {
    amount: money(entry.amount, 'Daily spending'),
    refund: money(entry.refund, 'Money back / refunds'),
    note: text(entry.note, 200),
    refundNote: text(entry.refundNote, 200),
    updatedAt: text(entry.updatedAt, 40) || new Date().toISOString(),
  };
}

function ensureTransactionDateAllowed(state, date) {
  const month = date.slice(0, 7);
  const cfg = state.months?.[month];
  if (!cfg) throw new Error('Set up that month before adding card activity.');
  if (Number(date.slice(-2)) < Number(cfg.trackingStartDay || 1)) throw new Error('That date is before this month’s tracking start date.');
}

function applyTransactionImpact(state, transaction, direction = 1) {
  const date = transaction.date;
  ensureTransactionDateAllowed(state, date);
  const entry = normalizeDailyEntry(state.dailySpending[date] || {});
  const delta = roundMoney(transaction.amount * direction);
  if (transaction.kind === 'refund') entry.refund = roundMoney(Math.max(0, entry.refund + delta));
  else entry.amount = roundMoney(Math.max(0, entry.amount + delta));
  entry.updatedAt = new Date().toISOString();
  const empty = entry.amount === 0 && entry.refund === 0 && !entry.note && !entry.refundNote;
  if (empty) delete state.dailySpending[date];
  else state.dailySpending[date] = entry;
}

function cleanTransaction(input, existing, nowIso) {
  const kind = input?.kind === 'refund' ? 'refund' : 'purchase';
  const date = validateDate(input?.date);
  const amount = money(input?.amount, kind === 'refund' ? 'Refund amount' : 'Purchase amount');
  if (amount <= 0) throw new Error('Transaction amount must be greater than zero.');
  return {
    id: existing?.id || text(input?.id, 80) || randomUUID(),
    date,
    paymentMethodId: text(input?.paymentMethodId, 80),
    kind,
    amount,
    category: text(input?.category, 60) || (kind === 'refund' ? 'Refund' : 'Other'),
    note: text(input?.note, 200),
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

export function applyCardsMutation(sourceState, action, payload = {}, now = new Date()) {
  const state = ensureCardsShape(structuredClone(sourceState || {}));
  const nowIso = now.toISOString();
  const context = currentMonthContext(state, now);

  if (action === 'savePaymentMethod') {
    const id = text(payload?.id, 80);
    const existingIndex = id ? state.paymentMethods.findIndex((card) => card.id === id) : -1;
    const existing = existingIndex >= 0 ? state.paymentMethods[existingIndex] : null;
    const card = cleanCard(payload, existing, nowIso);
    if (existingIndex >= 0) state.paymentMethods[existingIndex] = card;
    else state.paymentMethods.push(card);
  } else if (action === 'archivePaymentMethod') {
    const id = text(payload?.id, 80);
    const card = activeCard(state, id);
    card.archivedAt = nowIso;
    card.updatedAt = nowIso;
    for (const meta of Object.values(state.recurringPaymentMeta)) {
      if (meta?.paymentMethodId !== id || meta?.active === false) continue;
      const expenseId = meta.expenseId;
      if (context.configured && Number(meta.chargeDay || 1) >= context.day) {
        const snap = state.recurringPaymentSnapshots?.[context.month]?.[expenseId];
        if (snap?.paymentMethodId === id) snap.paymentMethodId = '';
      }
      meta.paymentMethodId = '';
      meta.updatedAt = nowIso;
    }
    if (state.housingPaymentMeta?.paymentMethodId === id) {
      if (context.configured && Number(state.housingPaymentMeta.dueDay || 1) >= context.day) {
        const snap = state.housingPaymentSnapshots?.[context.month];
        if (snap?.paymentMethodId === id) snap.paymentMethodId = '';
      }
      state.housingPaymentMeta.paymentMethodId = '';
      state.housingPaymentMeta.updatedAt = nowIso;
    }
  } else if (action === 'saveRecurringPayment') {
    const id = text(payload?.id, 80) || randomUUID();
    const existingIndex = state.recurringExpenses.findIndex((expense) => expense.id === id);
    const previousExpense = existingIndex >= 0 ? structuredClone(state.recurringExpenses[existingIndex]) : null;
    const previousMeta = structuredClone(state.recurringPaymentMeta[id] || {});
    const expense = cleanExpense(payload, id);
    const paymentMethodId = text(payload?.paymentMethodId, 80);
    if (paymentMethodId) activeCard(state, paymentMethodId);
    const chargeDay = integerDay(payload?.chargeDay, 'Charge day');
    const meta = {
      expenseId: id,
      paymentMethodId,
      chargeDay,
      active: true,
      createdAt: previousMeta.createdAt || nowIso,
      updatedAt: nowIso,
      endedAt: null,
    };
    if (existingIndex >= 0) state.recurringExpenses[existingIndex] = expense;
    else state.recurringExpenses.push(expense);
    state.recurringPaymentMeta[id] = meta;

    if (context.configured) {
      const alreadyInMonth = (state.months[context.month].expenses || []).some((item) => item.id === id);
      const countCurrentMonth = payload?.countCurrentMonth !== false;
      if (countCurrentMonth) {
        upsertMonthExpense(state, context.month, expense);
        snapshotRecurring(state, context.month, expense, meta);
      } else if (alreadyInMonth) {
        const monthExpense = (state.months[context.month].expenses || []).find((item) => item.id === id) || previousExpense || expense;
        const historicalMeta = Object.keys(previousMeta).length ? previousMeta : meta;
        if (!state.recurringPaymentSnapshots[context.month]?.[id]) snapshotRecurring(state, context.month, monthExpense, historicalMeta);
      }
    }
  } else if (action === 'deleteRecurringPayment') {
    const id = text(payload?.id, 80);
    const existing = state.recurringExpenses.find((expense) => expense.id === id);
    if (!existing) throw new Error('Recurring payment not found.');
    const meta = state.recurringPaymentMeta[id] || { expenseId: id, chargeDay: 1, paymentMethodId: '' };
    state.recurringExpenses = state.recurringExpenses.filter((expense) => expense.id !== id);
    state.recurringPaymentMeta[id] = { ...meta, active: false, endedAt: nowIso, updatedAt: nowIso };
    if (context.configured) {
      const chargeDay = Number(meta.chargeDay || 1);
      if (chargeDay >= context.day) {
        removeMonthExpense(state, context.month, id);
        state.recurringPaymentSnapshots[context.month] ||= {};
        delete state.recurringPaymentSnapshots[context.month][id];
      } else {
        const monthExpense = (state.months[context.month].expenses || []).find((item) => item.id === id);
        if (monthExpense && !state.recurringPaymentSnapshots[context.month]?.[id]) snapshotRecurring(state, context.month, monthExpense, meta);
      }
    }
  } else if (action === 'saveHousingPayment') {
    const paymentMethodId = text(payload?.paymentMethodId, 80);
    if (paymentMethodId) activeCard(state, paymentMethodId);
    const dueDay = integerDay(payload?.dueDay, 'Housing due day');
    const previous = structuredClone(state.housingPaymentMeta || {});
    state.housingPaymentMeta = { paymentMethodId, dueDay, updatedAt: nowIso };
    if (context.configured) {
      state.housingPaymentSnapshots[context.month] ||= {};
      const existing = state.housingPaymentSnapshots[context.month];
      if (dueDay >= context.day || !existing.paymentMethodId) {
        state.housingPaymentSnapshots[context.month] = { paymentMethodId, dueDay, updatedAt: nowIso };
      } else if (!existing.paymentMethodId && previous.paymentMethodId) {
        state.housingPaymentSnapshots[context.month] = { ...previous };
      }
    }
  } else if (action === 'saveTransaction') {
    const id = text(payload?.id, 80);
    const existingIndex = id ? state.cardTransactions.findIndex((transaction) => transaction.id === id) : -1;
    const existing = existingIndex >= 0 ? state.cardTransactions[existingIndex] : null;
    const transaction = cleanTransaction(payload, existing, nowIso);
    activeCard(state, transaction.paymentMethodId);
    if (existing) applyTransactionImpact(state, existing, -1);
    applyTransactionImpact(state, transaction, 1);
    if (existingIndex >= 0) state.cardTransactions[existingIndex] = transaction;
    else state.cardTransactions.push(transaction);
  } else if (action === 'deleteTransaction') {
    const id = text(payload?.id, 80);
    const index = state.cardTransactions.findIndex((transaction) => transaction.id === id);
    if (index < 0) throw new Error('Card transaction not found.');
    const transaction = state.cardTransactions[index];
    applyTransactionImpact(state, transaction, -1);
    state.cardTransactions.splice(index, 1);
  } else if (action === 'snapshotMonthPayments') {
    const month = text(payload?.month, 7);
    if (!MONTH_RE.test(month) || !state.months?.[month]) throw new Error('That month is not configured.');
    state.recurringPaymentSnapshots[month] ||= {};
    for (const expense of state.months[month].expenses || []) {
      if (!state.recurringPaymentSnapshots[month][expense.id]) snapshotRecurring(state, month, expense, state.recurringPaymentMeta[expense.id] || {});
    }
    if (!state.housingPaymentSnapshots[month]?.paymentMethodId && state.housingPaymentMeta?.paymentMethodId) {
      state.housingPaymentSnapshots[month] = { ...state.housingPaymentMeta, updatedAt: nowIso };
    }
  } else {
    throw new Error('Unknown cards action.');
  }

  state.updatedAt = nowIso;
  return state;
}

export function copyCardsForImport(imported, target) {
  ensureCardsShape(target);
  const source = ensureCardsShape(structuredClone(imported || {}));
  target.paymentMethods = source.paymentMethods.map((card) => {
    try { return cleanCard(card, card, text(card.updatedAt, 40) || new Date().toISOString()); } catch { return null; }
  }).filter(Boolean);
  const validCardIds = new Set(target.paymentMethods.map((card) => card.id));

  target.recurringPaymentMeta = {};
  for (const [expenseId, meta] of Object.entries(source.recurringPaymentMeta || {})) {
    const id = text(expenseId, 80);
    if (!id) continue;
    const paymentMethodId = validCardIds.has(text(meta?.paymentMethodId, 80)) ? text(meta?.paymentMethodId, 80) : '';
    let chargeDay = 1;
    try { chargeDay = integerDay(meta?.chargeDay || 1, 'Charge day'); } catch { chargeDay = 1; }
    target.recurringPaymentMeta[id] = {
      expenseId: id,
      paymentMethodId,
      chargeDay,
      active: meta?.active !== false,
      createdAt: text(meta?.createdAt, 40),
      updatedAt: text(meta?.updatedAt, 40),
      endedAt: text(meta?.endedAt, 40) || null,
    };
  }

  target.recurringPaymentSnapshots = structuredClone(source.recurringPaymentSnapshots || {});
  target.housingPaymentMeta = structuredClone(source.housingPaymentMeta || {});
  target.housingPaymentSnapshots = structuredClone(source.housingPaymentSnapshots || {});
  target.cardTransactions = [];
  for (const tx of source.cardTransactions || []) {
    try {
      const cardId = text(tx?.paymentMethodId, 80);
      if (!validCardIds.has(cardId)) continue;
      target.cardTransactions.push(cleanTransaction(tx, tx, text(tx.updatedAt, 40) || new Date().toISOString()));
    } catch { }
  }
  return target;
}

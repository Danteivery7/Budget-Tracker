import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { isAuthenticated, json } from '../lib/auth.mjs';

const STORE_NAME = 'budget-tracker';
const STATE_KEY = 'state';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function freshState() {
  const now = new Date().toISOString();
  return { version: 2, createdAt: now, updatedAt: now, recurringExpenses: [], months: {}, dailySpending: {} };
}

function finiteMoney(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) throw new Error(`${label} must be a valid non-negative number.`);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function cleanText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function cleanExpense(item) {
  return {
    id: cleanText(item?.id, 80) || randomUUID(),
    name: cleanText(item?.name, 80) || 'Fixed expense',
    category: cleanText(item?.category, 40) || 'Other',
    amount: finiteMoney(item?.amount, 'Expense amount'),
  };
}

function cleanDailyEntry(entry, preserveTimestamp = false) {
  return {
    amount: finiteMoney(entry?.amount, 'Daily spending'),
    refund: finiteMoney(entry?.refund, 'Money back / refunds'),
    note: cleanText(entry?.note, 200),
    refundNote: cleanText(entry?.refundNote, 200),
    updatedAt: preserveTimestamp ? (cleanText(entry?.updatedAt, 40) || new Date().toISOString()) : new Date().toISOString(),
  };
}

function validateDateKey(date) {
  if (!DATE_RE.test(date)) throw new Error('Invalid date.');
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('Invalid date.');
}

function applyMutation(state, action, payload = {}) {
  const next = structuredClone(state || freshState());
  next.version = 2;
  next.months ||= {};
  next.dailySpending ||= {};
  next.recurringExpenses ||= [];

  if (action === 'saveMonth') {
    const month = cleanText(payload.month, 7);
    if (!MONTH_RE.test(month)) throw new Error('Invalid month.');
    next.months[month] = {
      income: finiteMoney(payload.income, 'Income'),
      housing: finiteMoney(payload.housing, 'Housing'),
      reinvestment: finiteMoney(payload.reinvestment, 'Reinvestment'),
      expenses: Array.isArray(payload.expenses) ? payload.expenses.map(cleanExpense) : [],
      updatedAt: new Date().toISOString(),
    };
  } else if (action === 'saveDaily') {
    const date = cleanText(payload.date, 10);
    validateDateKey(date);
    next.dailySpending[date] = cleanDailyEntry(payload);
  } else if (action === 'deleteDaily') {
    const date = cleanText(payload.date, 10);
    validateDateKey(date);
    delete next.dailySpending[date];
  } else if (action === 'saveRecurring') {
    if (!Array.isArray(payload.expenses)) throw new Error('Expenses must be a list.');
    next.recurringExpenses = payload.expenses.map(cleanExpense);
  } else if (action === 'deleteMonth') {
    const month = cleanText(payload.month, 7);
    if (!MONTH_RE.test(month)) throw new Error('Invalid month.');
    delete next.months[month];
  } else if (action === 'importState') {
    const imported = payload.state;
    if (!imported || typeof imported !== 'object') throw new Error('Invalid backup file.');
    const validated = freshState();
    validated.createdAt = cleanText(imported.createdAt, 40) || validated.createdAt;
    validated.recurringExpenses = Array.isArray(imported.recurringExpenses) ? imported.recurringExpenses.map(cleanExpense) : [];
    for (const [month, cfg] of Object.entries(imported.months || {})) {
      if (!MONTH_RE.test(month)) continue;
      validated.months[month] = {
        income: finiteMoney(cfg?.income, 'Income'),
        housing: finiteMoney(cfg?.housing, 'Housing'),
        reinvestment: finiteMoney(cfg?.reinvestment, 'Reinvestment'),
        expenses: Array.isArray(cfg?.expenses) ? cfg.expenses.map(cleanExpense) : [],
        updatedAt: cleanText(cfg?.updatedAt, 40) || new Date().toISOString(),
      };
    }
    for (const [date, entry] of Object.entries(imported.dailySpending || {})) {
      try { validateDateKey(date); } catch { continue; }
      validated.dailySpending[date] = cleanDailyEntry(entry, true);
    }
    validated.updatedAt = new Date().toISOString();
    return validated;
  } else {
    throw new Error('Unknown action.');
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

async function readState(store) {
  const entry = await store.getWithMetadata(STATE_KEY, { consistency: 'strong', type: 'json' });
  if (!entry) return { state: freshState(), etag: null, exists: false };
  return { state: entry.data, etag: entry.etag, exists: true };
}

async function mutate(store, action, payload) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readState(store);
    const next = applyMutation(current.state, action, payload);
    const options = current.exists ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await store.setJSON(STATE_KEY, next, options);
    if (result.modified) return { state: next, etag: result.etag };
  }
  throw new Error('Your data changed on another device. Please try again.');
}

export default async (request) => {
  if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const { pathname } = new URL(request.url);
  try {
    if (request.method === 'GET' && pathname.endsWith('/state')) {
      const { state, etag } = await readState(store);
      return json({ state, etag });
    }
    if (request.method === 'POST' && pathname.endsWith('/mutate')) {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
      return json(await mutate(store, body?.action, body?.payload || {}));
    }
  } catch (error) {
    return json({ error: error?.message || 'Request failed.' }, 400);
  }
  return json({ error: 'Not found.' }, 404);
};

export const config = { path: '/api/budget/*' };

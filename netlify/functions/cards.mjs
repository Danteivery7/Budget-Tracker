import { getStore } from '@netlify/blobs';
import { isAuthenticated, json } from '../lib/auth.mjs';
import { applyCardsMutation, ensureCardsShape } from '../lib/cards-core.mjs';

const STORE_NAME = 'budget-tracker';
const STATE_KEY = 'state';

function freshState() {
  const now = new Date().toISOString();
  return ensureCardsShape({ version: 3, createdAt: now, updatedAt: now, recurringExpenses: [], months: {}, dailySpending: {} });
}

async function readState(store) {
  const entry = await store.getWithMetadata(STATE_KEY, { consistency: 'strong', type: 'json' });
  if (!entry) return { state: freshState(), etag: null, exists: false };
  return { state: ensureCardsShape(entry.data), etag: entry.etag, exists: true };
}

async function mutate(store, action, payload) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readState(store);
    const next = applyCardsMutation(current.state, action, payload);
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

export const config = { path: '/api/cards/*' };

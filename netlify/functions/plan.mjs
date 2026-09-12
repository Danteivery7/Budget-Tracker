import { getStore } from '@netlify/blobs';
import { isAuthenticated, json } from '../lib/auth.mjs';
import { ensureSubscriptionShape } from '../lib/subscriptions-core.mjs';
import { bootstrapPlanFromHistory, createPlanRevision, ensureMonthFromPlan, ensurePlanShape, resolvePlanForMonth } from '../lib/plan-core.mjs';

const STORE_NAME = 'budget-tracker';
const STATE_KEY = 'state';

function normalize(state = {}) {
  return ensurePlanShape(ensureSubscriptionShape(state));
}

function viewFor(state, month) {
  const revision = resolvePlanForMonth(state, month);
  return {
    month,
    revision,
    revisionCount: state.planRevisions.length,
    monthConfigured: Boolean(state.months?.[month]),
    planSettings: state.planSettings || {},
  };
}

async function readState(store) {
  const entry = await store.getWithMetadata(STATE_KEY, { consistency: 'strong', type: 'json' });
  if (!entry) return { state: normalize({ version: 3, months: {}, recurringExpenses: [], dailySpending: {} }), etag: null, exists: false };
  return { state: normalize(entry.data), etag: entry.etag, exists: true };
}

async function mutate(store, action, payload = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readState(store);
    const next = structuredClone(current.state);
    if (action === 'ensureMonth') ensureMonthFromPlan(next, String(payload.month || ''), new Date());
    else if (action === 'bootstrap') bootstrapPlanFromHistory(next, new Date());
    else if (action === 'saveRevision') createPlanRevision(next, payload, new Date());
    else throw new Error('Unknown plan action.');
    next.updatedAt = new Date().toISOString();
    const options = current.exists ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await store.setJSON(STATE_KEY, next, options);
    if (result.modified) return { state: next, view: viewFor(next, String(payload.month || payload.effectiveMonth || '')), etag: result.etag };
  }
  throw new Error('Your data changed on another device. Please try again.');
}

export default async (request) => {
  if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const { pathname, searchParams } = new URL(request.url);
  try {
    if (request.method === 'GET' && pathname.endsWith('/state')) {
      const { state, etag } = await readState(store);
      const month = searchParams.get('month') || '';
      return json({ state, view: viewFor(state, month), etag });
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

export const config = { path: '/api/plan/*' };

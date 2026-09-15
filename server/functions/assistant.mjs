import { getStore } from '@netlify/blobs';
import { buildAssistantSnapshot, analyzeAssistantPurchase, dateKeyInTimeZone } from '../../assistant-core.js';
import { isAuthenticated, json } from '../lib/auth.mjs';
import { isBankAuthorized, requireSameOrigin } from '../lib/bank-auth.mjs';
import { assistantAccessStatus, createAssistantAccess, revokeAssistantAccess, verifyAssistantBearer } from '../lib/assistant-access.mjs';
import { ensurePlanShape } from '../lib/plan-core.mjs';
import { ensureSubscriptionShape } from '../lib/subscriptions-core.mjs';
import { safeAppendLedgerEvent } from '../lib/ledger.mjs';

const STORE_NAME = 'budget-tracker';
const STATE_KEY = 'state';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function stateStore() {
  return getStore({ name:STORE_NAME, consistency:'strong' });
}

async function readState() {
  const state = await stateStore().get(STATE_KEY, { consistency:'strong', type:'json' });
  return ensurePlanShape(ensureSubscriptionShape(state || { version:3, months:{}, dailySpending:{}, recurringExpenses:[] }));
}

function cleanTimeZone(value) {
  const timeZone = String(value || '').trim().slice(0, 100) || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function requestedDate(value, timeZone) {
  const candidate = String(value || '').trim();
  if (candidate) {
    if (!DATE_RE.test(candidate)) throw new Error('Invalid date.');
    return candidate;
  }
  return dateKeyInTimeZone(timeZone || 'UTC');
}

async function readAuthorization(request) {
  if (isAuthenticated(request)) return { authorized:true, kind:'session', timeZone:null };
  const bearer = await verifyAssistantBearer(request);
  return { authorized:bearer.authorized, kind:bearer.authorized ? 'assistant-token' : null, timeZone:bearer.timeZone };
}

export default async (request) => {
  const { pathname, searchParams } = new URL(request.url);

  if (pathname.endsWith('/status')) {
    if (!isAuthenticated(request)) return json({ error:'Unauthorized.' }, 401);
    return json({ access:await assistantAccessStatus() });
  }

  if (pathname.endsWith('/token/create')) {
    if (!isAuthenticated(request)) return json({ error:'Unauthorized.' }, 401);
    if (request.method !== 'POST') return json({ error:'Method not allowed.' }, 405);
    if (!requireSameOrigin(request)) return json({ error:'Invalid request origin.' }, 403);
    if (!isBankAuthorized(request)) return json({ error:'Unlock protected operations before creating ChatGPT access.' }, 403);
    let body = {};
    try { body = await request.json(); } catch { return json({ error:'Invalid JSON.' }, 400); }
    const created = await createAssistantAccess({ timeZone:cleanTimeZone(body?.timeZone) });
    await safeAppendLedgerEvent({ source:'security', action:'assistant_access_created', entity:'chatgpt-readonly', summary:'Read-only assistant finance access was created.' });
    return json({ access:{ enabled:true, createdAt:created.createdAt, timeZone:created.timeZone }, token:created.token });
  }

  if (pathname.endsWith('/token/revoke')) {
    if (!isAuthenticated(request)) return json({ error:'Unauthorized.' }, 401);
    if (request.method !== 'POST') return json({ error:'Method not allowed.' }, 405);
    if (!requireSameOrigin(request)) return json({ error:'Invalid request origin.' }, 403);
    if (!isBankAuthorized(request)) return json({ error:'Unlock protected operations before revoking ChatGPT access.' }, 403);
    await revokeAssistantAccess();
    await safeAppendLedgerEvent({ source:'security', action:'assistant_access_revoked', entity:'chatgpt-readonly', summary:'Read-only assistant finance access was revoked.' });
    return json({ revoked:true });
  }

  const auth = await readAuthorization(request);
  if (!auth.authorized) return json({ error:'Unauthorized.' }, 401);

  try {
    if (request.method === 'GET' && pathname.endsWith('/context')) {
      const timeZone = auth.timeZone || cleanTimeZone(searchParams.get('timeZone'));
      const date = requestedDate(searchParams.get('date'), timeZone);
      const snapshot = buildAssistantSnapshot(await readState(), date);
      return json({
        snapshot,
        readOnly:true,
        source:'budget-tracker',
        privacy:'Derived budget values only. No bank credentials, provider tokens, raw bank identifiers, or money-movement capability.',
      });
    }

    if (request.method === 'POST' && pathname.endsWith('/purchase')) {
      let body = {};
      try { body = await request.json(); } catch { return json({ error:'Invalid JSON.' }, 400); }
      const timeZone = auth.timeZone || cleanTimeZone(body?.timeZone);
      const dateKey = requestedDate(body?.date, timeZone);
      const analysis = analyzeAssistantPurchase(await readState(), {
        amount:body?.amount,
        item:body?.item,
        dateKey,
      });
      return json({
        analysis,
        readOnly:true,
        source:'budget-tracker',
        privacy:'This is a what-if calculation only and does not modify the budget or move money.',
      });
    }
  } catch (error) {
    return json({ error:error?.message || 'Assistant request failed.' }, 400);
  }

  return json({ error:'Not found.' }, 404);
};

export const config = { path:'/api/assistant/*' };

import { isAuthenticated, json } from '../lib/auth.mjs';
import { isBankAuthorized, requireSameOrigin } from '../lib/bank-auth.mjs';
import { bankEncryptionConfigured } from '../lib/bank-crypto.mjs';
import { intelligenceForTransactions, intelligenceView, removeRule, reviewTransaction, upsertRule } from '../lib/intelligence-service.mjs';
import { safeAppendLedgerEvent } from '../lib/ledger.mjs';

async function readBody(request) {
  try { return await request.json(); } catch { throw new Error('Invalid request.'); }
}

export default async (request) => {
  const { pathname } = new URL(request.url);
  if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
  if (!isBankAuthorized(request)) return json({ error: 'Banking session locked. Unlock Linked Accounts first.' }, 403);
  if (!bankEncryptionConfigured()) return json({ error: 'Secure banking encryption is not configured yet.' }, 503);
  if (request.method === 'POST' && !requireSameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

  try {
    if (request.method === 'GET' && pathname.endsWith('/state')) return json(await intelligenceView());

    if (request.method === 'POST' && pathname.endsWith('/rules/save')) {
      const body = await readBody(request);
      const rule = await upsertRule(body?.rule || {});
      await safeAppendLedgerEvent({ source: 'intelligence', action: 'rule_saved', entity: rule.id, summary: rule.name, payload: rule });
      return json({ rule, view: await intelligenceView() });
    }

    if (request.method === 'POST' && pathname.endsWith('/rules/delete')) {
      const body = await readBody(request);
      const rule = await removeRule(String(body?.id || ''));
      await safeAppendLedgerEvent({ source: 'intelligence', action: 'rule_deleted', entity: rule.id, summary: rule.name, payload: { id: rule.id } });
      return json({ deleted: true, view: await intelligenceView() });
    }

    if (request.method === 'POST' && pathname.endsWith('/review')) {
      const body = await readBody(request);
      const result = await reviewTransaction(body || {});
      await safeAppendLedgerEvent({
        source: 'intelligence',
        action: 'transaction_reviewed',
        entity: String(body?.transactionRef || '').slice(0, 160),
        summary: `${result.transaction.merchantName || 'Transaction'} → ${body?.classification || ''}`,
        payload: { classification: body?.classification, bucket: body?.bucket, createRule: body?.createRule === true },
      });
      return json({ result, view: await intelligenceView() });
    }

    if (request.method === 'POST' && pathname.endsWith('/classify')) {
      const body = await readBody(request);
      const refs = Array.isArray(body?.transactionRefs) ? body.transactionRefs.slice(0, 100).map(String) : [];
      return json({ intelligence: await intelligenceForTransactions(refs) });
    }
  } catch (error) {
    return json({ error: error?.message || 'Financial intelligence request failed.' }, 400);
  }
  return json({ error: 'Not found.' }, 404);
};

export const config = { path: '/api/intelligence/*' };

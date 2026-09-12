import { isAuthenticated, json } from '../lib/auth.mjs';
import { authorizeBankPassword, bankSessionCookie, clearBankSessionCookie, isBankAuthorized, requireSameOrigin, BANK_SESSION_MINUTES } from '../lib/bank-auth.mjs';
import { bankEncryptionConfigured } from '../lib/bank-crypto.mjs';
import { browserTransaction } from '../lib/bank-core.mjs';
import { createPlaidLinkToken, disconnectConnection, exchangePublicToken, listPublicConnections, recentTransactions, syncConnection } from '../lib/bank-service.mjs';
import { plaidConfigured, plaidEnvironment, plaidHistoryDays } from '../lib/plaid-client.mjs';

function setupStatus() {
  let environment = null;
  try { environment = plaidEnvironment(); } catch { /* invalid config */ }
  return {
    configured: plaidConfigured() && bankEncryptionConfigured(),
    plaidConfigured: plaidConfigured(),
    encryptionConfigured: bankEncryptionConfigured(),
    environment,
    historyDays: plaidHistoryDays(),
    bankSessionMinutes: BANK_SESSION_MINUTES,
  };
}

function sensitiveError(error) {
  const code = String(error?.code || '');
  if (code === 'ITEM_LOGIN_REQUIRED') return 'This connection needs to be repaired with your bank.';
  if (code === 'PRODUCT_NOT_READY') return 'The institution is still preparing transaction history. Try syncing again shortly.';
  if (code) return `Bank provider request failed (${code}).`;
  return error?.message || 'Bank request failed.';
}

export default async (request) => {
  const { pathname, searchParams } = new URL(request.url);
  if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);

  if (request.method === 'GET' && pathname.endsWith('/session')) {
    return json({ authorized: isBankAuthorized(request), setup: setupStatus() });
  }

  if (request.method === 'POST' && !requireSameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

  if (request.method === 'POST' && pathname.endsWith('/authorize')) {
    let body = {};
    try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    if (!authorizeBankPassword(body?.password || '')) return json({ error: 'Incorrect access code.' }, 401);
    return json({ authorized: true, setup: setupStatus() }, 200, { 'set-cookie': bankSessionCookie() });
  }

  if (request.method === 'POST' && pathname.endsWith('/lock')) {
    return json({ authorized: false }, 200, { 'set-cookie': clearBankSessionCookie() });
  }

  if (!isBankAuthorized(request)) return json({ error: 'Banking session locked. Re-enter your access code.' }, 403);
  const setup = setupStatus();
  if (!setup.configured && !pathname.endsWith('/status')) return json({ error: 'Secure banking is not configured on the server.' }, 503);

  try {
    if (request.method === 'GET' && pathname.endsWith('/status')) {
      const connections = setup.configured ? await listPublicConnections() : [];
      return json({ setup, connections });
    }

    if (request.method === 'POST' && pathname.endsWith('/link-token')) {
      let body = {};
      try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      const result = await createPlaidLinkToken(request, { connectionId: body?.connectionId || null });
      return json(result);
    }

    if (request.method === 'POST' && pathname.endsWith('/exchange')) {
      let body = {};
      try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      const connection = await exchangePublicToken(body?.publicToken, body?.institutionName || '');
      return json({ connection });
    }

    if (request.method === 'POST' && pathname.endsWith('/sync')) {
      let body = {};
      try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      const connection = await syncConnection(String(body?.connectionId || ''));
      return json({ connection });
    }

    if (request.method === 'GET' && pathname.endsWith('/transactions')) {
      const connectionId = searchParams.get('connectionId') || '';
      const limit = Number(searchParams.get('limit') || 25);
      const rows = await recentTransactions(connectionId, limit);
      return json({ transactions: rows.map(browserTransaction) });
    }

    if (request.method === 'POST' && pathname.endsWith('/disconnect')) {
      let body = {};
      try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      await disconnectConnection(String(body?.connectionId || ''));
      return json({ disconnected: true });
    }
  } catch (error) {
    return json({ error: sensitiveError(error) }, 400);
  }

  return json({ error: 'Not found.' }, 404);
};

export const config = { path: '/api/bank/*' };

import { isAuthenticated, json, sessionCookie } from '../lib/auth.mjs';
import { bankSessionCookie } from '../lib/bank-auth.mjs';
import { safeAppendLedgerEvent } from '../lib/ledger.mjs';
import {
  authenticationOptions,
  challengeCookie,
  passkeySummary,
  registrationOptions,
  removePasskey,
  verifyAndSaveRegistration,
  verifyAuthentication,
} from '../lib/passkeys.mjs';

function sameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try { return new URL(referer).origin === url.origin; } catch { return false; }
}

async function bodyOf(request) {
  try { return await request.json(); } catch { throw new Error('Invalid request.'); }
}

export default async (request) => {
  const { pathname } = new URL(request.url);
  try {
    if (request.method === 'GET' && pathname.endsWith('/status')) {
      const summary = await passkeySummary();
      return json({ available: summary.available, count: summary.count });
    }

    if (request.method === 'GET' && pathname.endsWith('/list')) {
      if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
      return json(await passkeySummary({ includeCredentials: true }));
    }

    if (request.method === 'POST' && !sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);

    if (request.method === 'POST' && pathname.endsWith('/registration/options')) {
      if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
      const options = await registrationOptions(request);
      return json(options, 200, { 'set-cookie': challengeCookie(options.challenge, 'registration') });
    }

    if (request.method === 'POST' && pathname.endsWith('/registration/verify')) {
      if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
      const body = await bodyOf(request);
      const result = await verifyAndSaveRegistration(request, body?.response, body?.name || '');
      await safeAppendLedgerEvent({ source: 'security', action: 'passkey_registered', entity: result.credentialId, summary: body?.name || 'Passkey registered' });
      return json(result);
    }

    if (request.method === 'POST' && pathname.endsWith('/authentication/options')) {
      const body = await bodyOf(request);
      const purpose = body?.purpose === 'bank' ? 'bank' : 'login';
      if (purpose === 'bank' && !isAuthenticated(request)) return json({ error: 'Unlock the tracker first.' }, 401);
      const options = await authenticationOptions(request, purpose);
      return json(options, 200, { 'set-cookie': challengeCookie(options.challenge, purpose) });
    }

    if (request.method === 'POST' && pathname.endsWith('/authentication/verify')) {
      const body = await bodyOf(request);
      const purpose = body?.purpose === 'bank' ? 'bank' : 'login';
      if (purpose === 'bank' && !isAuthenticated(request)) return json({ error: 'Unlock the tracker first.' }, 401);
      const result = await verifyAuthentication(request, body?.response, purpose);
      await safeAppendLedgerEvent({ source: 'security', action: purpose === 'bank' ? 'bank_passkey_unlock' : 'passkey_login', entity: result.credentialId, summary: purpose === 'bank' ? 'Banking unlocked with passkey' : 'Tracker unlocked with passkey' });
      return json({ verified: true }, 200, { 'set-cookie': purpose === 'bank' ? bankSessionCookie() : sessionCookie() });
    }

    if (request.method === 'POST' && pathname.endsWith('/remove')) {
      if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
      const body = await bodyOf(request);
      await removePasskey(body?.id);
      await safeAppendLedgerEvent({ source: 'security', action: 'passkey_removed', entity: String(body?.id || '').slice(0, 160), summary: 'Passkey removed' });
      return json({ removed: true });
    }
  } catch (error) {
    return json({ error: error?.message || 'Passkey request failed.' }, 400);
  }
  return json({ error: 'Not found.' }, 404);
};

export const config = {
  path: '/api/passkeys/*',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip'],
    windowSize: 60,
    windowLimit: 30,
  },
};

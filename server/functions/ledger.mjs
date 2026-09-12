import { isAuthenticated, json } from '../lib/auth.mjs';
import { appendLedgerEvent, ledgerStatus } from '../lib/ledger.mjs';

function sameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try { return new URL(referer).origin === url.origin; } catch { return false; }
}

export default async (request) => {
  if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
  const { pathname, searchParams } = new URL(request.url);
  try {
    if (request.method === 'GET' && pathname.endsWith('/status')) {
      const depth = Math.max(1, Math.min(1000, Number(searchParams.get('depth') || 250)));
      return json(await ledgerStatus({ verifyDepth: depth }));
    }
    if (request.method === 'POST' && pathname.endsWith('/record')) {
      if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
      const event = await appendLedgerEvent({
        source: String(body?.source || 'app').slice(0, 80),
        action: String(body?.action || 'mutation').slice(0, 120),
        entity: String(body?.entity || '').slice(0, 160),
        summary: String(body?.summary || '').slice(0, 220),
        payload: body?.descriptor ?? null,
      });
      return json({ recorded: true, sequence: event.sequence, hash: event.hash });
    }
  } catch (error) {
    return json({ error: error?.message || 'Ledger request failed.' }, 400);
  }
  return json({ error: 'Not found.' }, 404);
};

export const config = { path: '/api/ledger/*' };

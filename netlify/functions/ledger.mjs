import { isAuthenticated, json } from '../lib/auth.mjs';
import { ledgerStatus } from '../lib/ledger.mjs';

export default async (request) => {
  if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, 401);
  const { pathname, searchParams } = new URL(request.url);
  if (request.method === 'GET' && pathname.endsWith('/status')) {
    const depth = Math.max(1, Math.min(1000, Number(searchParams.get('depth') || 250)));
    return json(await ledgerStatus({ verifyDepth: depth }));
  }
  return json({ error: 'Not found.' }, 404);
};

export const config = { path: '/api/ledger/*' };

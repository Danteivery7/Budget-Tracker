import {
  clearSessionCookie,
  comparePassword,
  isAuthenticated,
  isConfigured,
  json,
  sessionCookie,
} from '../lib/auth.mjs';

export default async (request) => {
  const { pathname } = new URL(request.url);

  if (request.method === 'GET' && pathname.endsWith('/status')) {
    return json({ configured: isConfigured(), authenticated: isAuthenticated(request) });
  }

  if (request.method === 'POST' && pathname.endsWith('/login')) {
    if (!isConfigured()) {
      return json({ error: 'Budget Tracker is not configured yet.' }, 503);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }

    if (!comparePassword(body?.password)) {
      return json({ error: 'Incorrect access code.' }, 401);
    }

    return json(
      { ok: true },
      200,
      { 'set-cookie': sessionCookie() },
    );
  }

  if (request.method === 'POST' && pathname.endsWith('/logout')) {
    return json(
      { ok: true },
      200,
      { 'set-cookie': clearSessionCookie() },
    );
  }

  return json({ error: 'Not found.' }, 404);
};

export const config = {
  path: '/api/auth/*',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip'],
    windowSize: 60,
    windowLimit: 30,
  },
};

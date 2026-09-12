import { withCloudflareEnv } from '@netlify/blobs';
import authHandler from '../../server/functions/auth.mjs';
import bankHandler from '../../server/functions/bank.mjs';
import budgetHandler from '../../server/functions/budget.mjs';
import cardsHandler from '../../server/functions/cards.mjs';
import intelligenceHandler from '../../server/functions/intelligence.mjs';
import ledgerHandler from '../../server/functions/ledger.mjs';
import passkeysHandler from '../../server/functions/passkeys.mjs';
import plaidWebhookHandler from '../../server/functions/plaid-webhook.mjs';
import planHandler from '../../server/functions/plan.mjs';
import subscriptionsHandler from '../../server/functions/subscriptions.mjs';
import { enforceRateLimit } from '../../server/lib/rate-limit.mjs';

const API_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type':'application/json; charset=utf-8', ...API_HEADERS, ...extra },
  });
}

function secure(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(API_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
}

function handlerFor(pathname) {
  if (pathname === '/api/plaid/webhook') return plaidWebhookHandler;
  if (pathname.startsWith('/api/auth/')) return authHandler;
  if (pathname.startsWith('/api/bank/')) return bankHandler;
  if (pathname.startsWith('/api/budget/')) return budgetHandler;
  if (pathname.startsWith('/api/cards/')) return cardsHandler;
  if (pathname.startsWith('/api/intelligence/')) return intelligenceHandler;
  if (pathname.startsWith('/api/ledger/')) return ledgerHandler;
  if (pathname.startsWith('/api/passkeys/')) return passkeysHandler;
  if (pathname.startsWith('/api/plan/')) return planHandler;
  if (pathname.startsWith('/api/subscriptions/')) return subscriptionsHandler;
  return null;
}

async function rateLimit(request, pathname) {
  if (pathname === '/api/plaid/webhook') return null;
  const global = await enforceRateLimit(request, { scope:'api-global', limit:300, windowSeconds:60 });
  if (!global.allowed) return global;

  if (pathname === '/api/auth/login' || pathname === '/api/bank/authorize') {
    const sensitive = await enforceRateLimit(request, { scope:`sensitive:${pathname}`, limit:12, windowSeconds:60 });
    if (!sensitive.allowed) return sensitive;
  }
  if (pathname.startsWith('/api/passkeys/')) {
    const passkeys = await enforceRateLimit(request, { scope:'passkeys', limit:40, windowSeconds:60 });
    if (!passkeys.allowed) return passkeys;
  }
  return null;
}

export async function onRequest(context) {
  return withCloudflareEnv(context.env, async () => {
    const request = context.request;
    const { pathname } = new URL(request.url);
    const handler = handlerFor(pathname);
    if (!handler) return json({ error:'Not found.' }, 404);
    if (!context.env.DB) return json({ error:'Cloudflare D1 binding DB is not configured.' }, 503);

    try {
      const limited = await rateLimit(request, pathname);
      if (limited) {
        return json({ error:'Too many requests. Try again shortly.' }, 429, {
          'Retry-After': String(Math.max(1, Math.ceil((limited.resetAt - Date.now()) / 1000))),
          'X-RateLimit-Limit': String(limited.limit),
          'X-RateLimit-Remaining': String(limited.remaining),
        });
      }
      return secure(await handler(request));
    } catch (error) {
      console.error('Budget Tracker API error', { path:pathname, name:error?.name || 'Error' });
      return json({ error:'Server request failed.' }, 500);
    }
  });
}

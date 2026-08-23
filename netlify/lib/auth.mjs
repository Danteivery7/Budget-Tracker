import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'budget_tracker_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function hash(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function isConfigured() {
  return Boolean(process.env.BUDGET_TRACKER_PASSWORD);
}

export function comparePassword(input) {
  const expected = process.env.BUDGET_TRACKER_PASSWORD || '';
  const a = hash(input || '');
  const b = hash(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionToken() {
  const password = process.env.BUDGET_TRACKER_PASSWORD || '';
  const site = process.env.SITE_ID || process.env.URL || 'budget-tracker';
  return createHmac('sha256', password).update(`budget-tracker-session-v1:${site}`).digest('hex');
}

export function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const result = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

export function isAuthenticated(request) {
  if (!isConfigured()) return false;
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return false;
  const expected = sessionToken();
  const a = hash(token);
  const b = hash(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionCookie() {
  return `${COOKIE_NAME}=${encodeURIComponent(sessionToken())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

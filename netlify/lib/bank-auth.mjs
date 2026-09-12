import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { comparePassword, isAuthenticated, parseCookies } from './auth.mjs';

const BANK_COOKIE = 'budget_tracker_bank_session';
const BANK_SESSION_SECONDS = 15 * 60;

function hash(value) {
  return createHash('sha256').update(String(value)).digest();
}

function bankSessionToken() {
  const password = process.env.BUDGET_TRACKER_PASSWORD || '';
  const site = process.env.SITE_ID || process.env.URL || 'budget-tracker';
  return createHmac('sha256', password).update(`budget-tracker-bank-session-v1:${site}`).digest('hex');
}

export function bankSessionCookie() {
  return `${BANK_COOKIE}=${encodeURIComponent(bankSessionToken())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${BANK_SESSION_SECONDS}`;
}

export function clearBankSessionCookie() {
  return `${BANK_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function isBankAuthorized(request) {
  if (!isAuthenticated(request)) return false;
  const token = parseCookies(request)[BANK_COOKIE];
  if (!token) return false;
  const a = hash(token);
  const b = hash(bankSessionToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeBankPassword(input) {
  return comparePassword(input);
}

export function requireSameOrigin(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) return origin === requestUrl.origin;
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try { return new URL(referer).origin === requestUrl.origin; } catch { return false; }
}

export const BANK_SESSION_MINUTES = 15;

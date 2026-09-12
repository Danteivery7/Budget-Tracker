import { createHmac, timingSafeEqual } from 'node:crypto';
import { comparePassword, isAuthenticated, parseCookies } from './auth.mjs';

const BANK_COOKIE = 'budget_tracker_bank_session';
const BANK_SESSION_SECONDS = 15 * 60;

function secret() {
  const password = process.env.BUDGET_TRACKER_PASSWORD || '';
  const site = process.env.SITE_ID || process.env.URL || 'budget-tracker';
  return createHmac('sha256', password).update(`budget-tracker-bank-session-key-v2:${site}`).digest();
}

function signature(issuedAt) {
  return createHmac('sha256', secret()).update(`bank-session:${issuedAt}`).digest('base64url');
}

function issuedAtFromToken(token) {
  const [issuedText] = String(token || '').split('.');
  const issuedAt = Number(issuedText);
  return Number.isInteger(issuedAt) ? issuedAt : null;
}

export function createBankSessionToken(now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  return `${issuedAt}.${signature(issuedAt)}`;
}

export function validateBankSessionToken(token, now = Date.now()) {
  const [issuedText, supplied] = String(token || '').split('.');
  const issuedAt = Number(issuedText);
  if (!Number.isInteger(issuedAt) || !supplied) return false;
  const age = Math.floor(now / 1000) - issuedAt;
  if (age < -60 || age > BANK_SESSION_SECONDS) return false;
  const expected = signature(issuedAt);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function bankSessionCookie(now = Date.now()) {
  return `${BANK_COOKIE}=${encodeURIComponent(createBankSessionToken(now))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${BANK_SESSION_SECONDS}`;
}

export function clearBankSessionCookie() {
  return `${BANK_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function isBankAuthorized(request, now = Date.now()) {
  if (!isAuthenticated(request)) return false;
  return validateBankSessionToken(parseCookies(request)[BANK_COOKIE], now);
}

export function bankSessionExpiresAt(request, now = Date.now()) {
  if (!isAuthenticated(request)) return null;
  const token = parseCookies(request)[BANK_COOKIE];
  if (!validateBankSessionToken(token, now)) return null;
  const issuedAt = issuedAtFromToken(token);
  return issuedAt == null ? null : (issuedAt + BANK_SESSION_SECONDS) * 1000;
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

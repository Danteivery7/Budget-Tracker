import { createHash, timingSafeEqual } from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { plaidRequest } from './plaid-client.mjs';

const KEY_CACHE_MS = 60 * 60 * 1000;
const keyCache = new Map();

function equalHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

async function verificationKey(kid) {
  const cached = keyCache.get(kid);
  if (cached && Date.now() - cached.at < KEY_CACHE_MS) return cached.key;
  const response = await plaidRequest('/webhook_verification_key/get', { key_id: kid });
  if (!response?.key) throw new Error('Webhook verification key unavailable.');
  keyCache.set(kid, { key: response.key, at: Date.now() });
  return response.key;
}

export function plaidWebhookHeader(token) {
  try {
    const header = decodeProtectedHeader(String(token || ''));
    return header && typeof header === 'object' ? header : null;
  } catch {
    return null;
  }
}

export async function verifyPlaidWebhookWithJwk(token, rawBody, jwk, now = Date.now()) {
  const header = plaidWebhookHeader(token);
  if (!header || header.alg !== 'ES256' || !header.kid) return false;
  if (!jwk || (jwk.alg && jwk.alg !== 'ES256') || (jwk.use && jwk.use !== 'sig')) return false;
  if (jwk.kid && jwk.kid !== header.kid) return false;
  if (jwk.expired_at && Number(jwk.expired_at) * 1000 < now) return false;

  try {
    const key = await importJWK(jwk, 'ES256');
    const { payload } = await jwtVerify(String(token), key, {
      algorithms: ['ES256'],
      maxTokenAge: '5 min',
      clockTolerance: 30,
      currentDate: new Date(now),
    });
    const iatMs = Number(payload.iat || 0) * 1000;
    if (!Number.isFinite(iatMs) || now - iatMs > 5 * 60 * 1000 || iatMs - now > 30 * 1000) return false;
    const expectedHash = String(payload.request_body_sha256 || '');
    if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
    const actualHash = createHash('sha256').update(rawBody).digest('hex');
    return equalHex(actualHash, expectedHash);
  } catch {
    return false;
  }
}

export async function verifyPlaidWebhook(request, rawBody, now = Date.now()) {
  const token = request.headers.get('Plaid-Verification') || request.headers.get('plaid-verification') || '';
  const header = plaidWebhookHeader(token);
  if (!header || header.alg !== 'ES256' || !header.kid) return false;
  const jwk = await verificationKey(header.kid);
  return verifyPlaidWebhookWithJwk(token, rawBody, jwk, now);
}

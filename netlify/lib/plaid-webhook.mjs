import { createHash, createPublicKey, verify as verifySignature, timingSafeEqual } from 'node:crypto';
import { plaidRequest } from './plaid-client.mjs';

const KEY_CACHE_MS = 60 * 60 * 1000;
const keyCache = new Map();

function decodeJsonPart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

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
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = decodeJsonPart(parts[0]);
    return { header, parts };
  } catch {
    return null;
  }
}

export function verifyPlaidWebhookWithJwk(token, rawBody, jwk, now = Date.now()) {
  const parsed = plaidWebhookHeader(token);
  if (!parsed) return false;
  const { header, parts } = parsed;
  let payload;
  try { payload = decodeJsonPart(parts[1]); } catch { return false; }
  if (header.alg !== 'ES256' || !header.kid) return false;
  const iat = Number(payload.iat || 0) * 1000;
  if (!Number.isFinite(iat) || Math.abs(now - iat) > 5 * 60 * 1000) return false;
  if (!jwk || (jwk.alg && jwk.alg !== 'ES256') || (jwk.use && jwk.use !== 'sig')) return false;

  let publicKey;
  try { publicKey = createPublicKey({ key: jwk, format: 'jwk' }); } catch { return false; }
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  const signatureOk = verifySignature('sha256', signed, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  if (!signatureOk) return false;

  const expectedHash = String(payload.request_body_sha256 || '');
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actualHash = createHash('sha256').update(rawBody).digest('hex');
  return equalHex(actualHash, expectedHash);
}

export async function verifyPlaidWebhook(request, rawBody, now = Date.now()) {
  const token = request.headers.get('Plaid-Verification') || request.headers.get('plaid-verification') || '';
  const parsed = plaidWebhookHeader(token);
  if (!parsed || parsed.header.alg !== 'ES256' || !parsed.header.kid) return false;
  const jwk = await verificationKey(parsed.header.kid);
  return verifyPlaidWebhookWithJwk(token, rawBody, jwk, now);
}

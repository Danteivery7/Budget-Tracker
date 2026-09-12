import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function keyBytes() {
  const raw = process.env.PLAID_TOKEN_ENCRYPTION_KEY || '';
  let key;
  try { key = Buffer.from(raw, 'base64'); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new Error('Bank encryption is not configured.');
  return key;
}

export function bankEncryptionConfigured() {
  try { return keyBytes().length === 32; } catch { return false; }
}

export function encryptBankValue(value, purpose = 'bank-data') {
  const key = keyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`budget-tracker:${purpose}:v1`));
  const plaintext = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    alg: 'A256GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptBankValue(envelope, purpose = 'bank-data', parseJson = true) {
  if (!envelope || envelope.version !== 1 || envelope.alg !== 'A256GCM') throw new Error('Invalid encrypted bank record.');
  const key = keyBytes();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`budget-tracker:${purpose}:v1`));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  return parseJson ? JSON.parse(plaintext) : plaintext;
}

export function opaqueBankRef(value, namespace = 'ref') {
  const key = keyBytes();
  return createHmac('sha256', key).update(`${namespace}:${String(value || '')}`).digest('base64url').slice(0, 24);
}

export function safeHashEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function decodeKey(name) {
  const raw = process.env[name] || '';
  let key;
  try { key = Buffer.from(raw, 'base64'); } catch { key = Buffer.alloc(0); }
  return key.length === 32 ? key : null;
}

function currentKey() {
  const key = decodeKey('PLAID_TOKEN_ENCRYPTION_KEY');
  if (!key) throw new Error('Bank encryption is not configured.');
  return key;
}

function previousKey() {
  return decodeKey('PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS');
}

function referenceKey() {
  // A dedicated reference key keeps opaque account/transaction IDs stable when
  // the AES data-encryption key rotates. The current encryption key remains a
  // backwards-compatible fallback until BANK_REFERENCE_KEY is configured.
  return decodeKey('BANK_REFERENCE_KEY') || currentKey();
}

export function bankEncryptionStatus() {
  return {
    currentConfigured: Boolean(decodeKey('PLAID_TOKEN_ENCRYPTION_KEY')),
    previousConfigured: Boolean(previousKey()),
    stableReferenceConfigured: Boolean(decodeKey('BANK_REFERENCE_KEY')),
  };
}

export function bankEncryptionConfigured() {
  return bankEncryptionStatus().currentConfigured;
}

function decryptWithKey(envelope, purpose, key, parseJson) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`budget-tracker:${purpose}:v1`));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return parseJson ? JSON.parse(plaintext) : plaintext;
}

export function encryptBankValue(value, purpose = 'bank-data') {
  const key = currentKey();
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

export function decryptBankValueDetailed(envelope, purpose = 'bank-data', parseJson = true) {
  if (!envelope || envelope.version !== 1 || envelope.alg !== 'A256GCM') throw new Error('Invalid encrypted bank record.');
  const candidates = [
    ['current', decodeKey('PLAID_TOKEN_ENCRYPTION_KEY')],
    ['previous', previousKey()],
  ].filter(([, key]) => Boolean(key));
  if (!candidates.length) throw new Error('Bank encryption is not configured.');
  let lastError = null;
  for (const [keySource, key] of candidates) {
    try {
      return { value: decryptWithKey(envelope, purpose, key, parseJson), keySource };
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error('Encrypted bank record could not be decrypted with the configured current or previous key.');
  error.cause = lastError;
  throw error;
}

export function decryptBankValue(envelope, purpose = 'bank-data', parseJson = true) {
  return decryptBankValueDetailed(envelope, purpose, parseJson).value;
}

export function opaqueBankRef(value, namespace = 'ref') {
  const key = referenceKey();
  return createHmac('sha256', key).update(`${namespace}:${String(value || '')}`).digest('base64url').slice(0, 24);
}

export function safeHashEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptBankValueDetailed, encryptBankValue, opaqueBankRef } from '../server/lib/bank-crypto.mjs';

const b64key = () => randomBytes(32).toString('base64');

test('previous AES key remains readable while new writes use current key', () => {
  const oldKey = b64key();
  const newKey = b64key();
  const reference = b64key();
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = oldKey;
  process.env.BANK_REFERENCE_KEY = reference;
  delete process.env.PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS;
  const oldEnvelope = encryptBankValue({ token:'private' }, 'bank-vault');
  const refBefore = opaqueBankRef('provider-account-id', 'account');

  process.env.PLAID_TOKEN_ENCRYPTION_KEY = newKey;
  process.env.PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS = oldKey;
  const decodedOld = decryptBankValueDetailed(oldEnvelope, 'bank-vault');
  assert.equal(decodedOld.keySource, 'previous');
  assert.deepEqual(decodedOld.value, { token:'private' });

  const newEnvelope = encryptBankValue({ token:'next' }, 'bank-vault');
  const decodedNew = decryptBankValueDetailed(newEnvelope, 'bank-vault');
  assert.equal(decodedNew.keySource, 'current');
  assert.deepEqual(decodedNew.value, { token:'next' });
  assert.equal(opaqueBankRef('provider-account-id', 'account'), refBefore);
});

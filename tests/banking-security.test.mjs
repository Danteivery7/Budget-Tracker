import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { bankEncryptionConfigured, decryptBankValue, encryptBankValue, opaqueBankRef } from '../netlify/lib/bank-crypto.mjs';
import { createBankSessionToken, validateBankSessionToken } from '../netlify/lib/bank-auth.mjs';
import { browserTransaction, discoveryTransaction, normalizePlaidTransaction, reconcileSyncedTransactions, sanitizePlaidAccount } from '../netlify/lib/bank-core.mjs';
import { plaidEnvironment, plaidHistoryDays, plaidRedirectUri } from '../netlify/lib/plaid-client.mjs';
import { verifyPlaidWebhookWithJwk } from '../netlify/lib/plaid-webhook.mjs';
import { ensureSubscriptionShape, refreshSubscriptionCandidatesFromLinkedBankRows } from '../netlify/lib/subscriptions-core.mjs';

const savedEnv = { ...process.env };
process.env.BUDGET_TRACKER_PASSWORD = 'unit-test-password';
process.env.SITE_ID = 'unit-test-site';
process.env.PLAID_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

test.after(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test('bank vault encryption round-trips and detects tampering', () => {
  assert.equal(bankEncryptionConfigured(), true);
  const envelope = encryptBankValue({ accessToken: 'secret-token', rows: [1, 2] }, 'test');
  assert.notEqual(envelope.ciphertext.includes('secret-token'), true);
  assert.deepEqual(decryptBankValue(envelope, 'test'), { accessToken: 'secret-token', rows: [1, 2] });
  const tampered = { ...envelope, ciphertext: Buffer.from('tampered').toString('base64') };
  assert.throws(() => decryptBankValue(tampered, 'test'));
});

test('bank re-auth session is cryptographically time-bound', () => {
  const issued = Date.UTC(2026, 8, 12, 15, 0, 0);
  const token = createBankSessionToken(issued);
  assert.equal(validateBankSessionToken(token, issued + 14 * 60 * 1000), true);
  assert.equal(validateBankSessionToken(token, issued + 16 * 60 * 1000), false);
  assert.equal(validateBankSessionToken(`${token}x`, issued + 60_000), false);
});

test('bank browser records expose opaque refs but never Plaid provider ids', () => {
  const rawAccount = { account_id: 'plaid-account-123', name: 'Business Checking', official_name: 'Private Business Checking', mask: '4321', type: 'depository', subtype: 'checking', balances: { current: 5000, available: 4800, iso_currency_code: 'USD' } };
  const account = sanitizePlaidAccount(rawAccount);
  assert.ok(account.accountRef);
  assert.equal('account_id' in account, false);
  assert.equal(JSON.stringify(account).includes('plaid-account-123'), false);

  const stored = normalizePlaidTransaction({ transaction_id: 'plaid-tx-secret', account_id: 'plaid-account-123', date: '2026-09-10', merchant_name: 'Spotify', name: 'SPOTIFY', amount: 12.99, pending: false, personal_finance_category: { primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO' }, payment_channel: 'online' }, { 'plaid-account-123': rawAccount });
  assert.equal(stored.providerTransactionId, 'plaid-tx-secret');
  const browser = browserTransaction(stored);
  assert.equal('providerTransactionId' in browser, false);
  assert.equal('accountId' in browser, false);
  assert.equal(JSON.stringify(browser).includes('plaid-tx-secret'), false);
  assert.equal(JSON.stringify(browser).includes('plaid-account-123'), false);
});

test('transaction sync reconciliation applies add modify and remove deterministically', () => {
  const existing = [
    { providerTransactionId: 'a', transactionRef: opaqueBankRef('a','transaction'), date: '2026-09-01', amount: 10 },
    { providerTransactionId: 'b', transactionRef: opaqueBankRef('b','transaction'), date: '2026-09-02', amount: 20 },
  ];
  const result = reconcileSyncedTransactions(existing, {
    added: [{ providerTransactionId: 'c', transactionRef: opaqueBankRef('c','transaction'), date: '2026-09-04', amount: 30 }],
    modified: [{ providerTransactionId: 'b', transactionRef: opaqueBankRef('b','transaction'), date: '2026-09-03', amount: 25 }],
    removed: [{ transaction_id: 'a' }],
  });
  assert.deepEqual(result.map((row) => row.providerTransactionId), ['c', 'b']);
  assert.equal(result.find((row) => row.providerTransactionId === 'b').amount, 25);
});

test('linked bank subscription discovery stores candidates and summary, not raw feed rows', () => {
  const state = ensureSubscriptionShape({ version: 3, recurringExpenses: [], months: {}, dailySpending: {} });
  const rows = [
    { id: 'opaque-1', sourceTransactionId: 'opaque-1', date: '2026-07-10', merchantName: 'YouTube Premium', amount: 13.99, accountId: 'acct-opaque', category: 'entertainment', kindHint: 'subscription', source: 'linked-account', posted: true },
    { id: 'opaque-2', sourceTransactionId: 'opaque-2', date: '2026-08-10', merchantName: 'YouTube Premium', amount: 13.99, accountId: 'acct-opaque', category: 'entertainment', kindHint: 'subscription', source: 'linked-account', posted: true },
  ];
  refreshSubscriptionCandidatesFromLinkedBankRows(state, rows, new Date('2026-08-11T12:00:00Z'));
  assert.equal(state.subscriptionFeedTransactions.length, 0);
  assert.equal(state.subscriptionFeedSummary.transactionCount, 2);
  assert.equal(state.subscriptionFeedSummary.connected, true);
  assert.equal(state.subscriptionCandidates.length, 1);
  assert.equal(state.dailySpending['2026-08-10'], undefined);
});

test('Plaid environment accepts only sandbox or production and history is bounded', () => {
  process.env.PLAID_ENV = 'development';
  assert.throws(() => plaidEnvironment(), /sandbox or production/);
  process.env.PLAID_ENV = 'sandbox';
  assert.equal(plaidEnvironment(), 'sandbox');
  process.env.PLAID_TRANSACTION_HISTORY_DAYS = '9999';
  assert.equal(plaidHistoryDays(), 730);
  process.env.PLAID_TRANSACTION_HISTORY_DAYS = '1';
  assert.equal(plaidHistoryDays(), 30);
  process.env.PLAID_REDIRECT_URI = 'http://example.com/plaid-oauth.html';
  assert.throws(() => plaidRedirectUri(), /HTTPS/);
  process.env.PLAID_REDIRECT_URI = 'https://example.com/plaid-oauth.html';
  assert.equal(plaidRedirectUri(), 'https://example.com/plaid-oauth.html');
});

test('Plaid webhook JWT verifies signature, freshness, and exact body hash', async () => {
  const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-secret' });
  const now = Date.UTC(2026, 8, 12, 15, 30, 0);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  Object.assign(jwk, { alg: 'ES256', use: 'sig', kid: 'unit-key' });
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'unit-key', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: Math.floor(now / 1000), request_body_sha256: createHash('sha256').update(body).digest('hex') })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const token = `${signingInput}.${signature}`;
  assert.equal(await verifyPlaidWebhookWithJwk(token, body, jwk, now), true);
  assert.equal(await verifyPlaidWebhookWithJwk(token, `${body} `, jwk, now), false);
  assert.equal(await verifyPlaidWebhookWithJwk(token, body, jwk, now + 6 * 60 * 1000), false);
});

test('discovery rows use only opaque account and transaction references', () => {
  const stored = { transactionRef: 'opaque-tx', accountRef: 'opaque-acct', date: '2026-09-12', merchantName: 'Spotify', amount: 12.99, pending: false, primaryCategory: 'entertainment' };
  const row = discoveryTransaction(stored);
  assert.equal(row.sourceTransactionId, 'opaque-tx');
  assert.equal(row.accountId, 'opaque-acct');
  assert.equal(JSON.stringify(row).includes('provider'), false);
});

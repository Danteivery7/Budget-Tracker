import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { challengeCookie, challengeFromRequest } from '../netlify/lib/passkeys.mjs';

const savedPassword = process.env.BUDGET_TRACKER_PASSWORD;
const savedSite = process.env.SITE_ID;
process.env.BUDGET_TRACKER_PASSWORD = 'passkey-test-password';
process.env.SITE_ID = 'passkey-test-site';

test.after(() => {
  if (savedPassword == null) delete process.env.BUDGET_TRACKER_PASSWORD; else process.env.BUDGET_TRACKER_PASSWORD = savedPassword;
  if (savedSite == null) delete process.env.SITE_ID; else process.env.SITE_ID = savedSite;
});

test('signed WebAuthn challenge cookie is purpose-bound and tamper resistant', () => {
  const cookie = challengeCookie('challenge-123', 'login').split(';')[0];
  const request = new Request('https://budget.example/api/passkeys/authentication/verify', { headers:{ cookie } });
  assert.equal(challengeFromRequest(request, 'login'), 'challenge-123');
  assert.equal(challengeFromRequest(request, 'bank'), null);
  const tampered = cookie.replace('challenge', 'changed');
  const badRequest = new Request('https://budget.example/api/passkeys/authentication/verify', { headers:{ cookie:tampered } });
  assert.equal(challengeFromRequest(badRequest, 'login'), null);
});

test('SimpleWebAuthn can generate finance-grade discoverable credential options on Node 22', async () => {
  const options = await generateRegistrationOptions({
    rpName:'Budget Tracker',
    rpID:'budget.example',
    userName:'Budget Tracker Owner',
    userID:new Uint8Array(32).fill(7),
    attestationType:'none',
    authenticatorSelection:{ residentKey:'required', userVerification:'required' },
    supportedAlgorithmIDs:[-7, -257],
  });
  assert.ok(options.challenge);
  assert.equal(options.rp.id, 'budget.example');
  assert.equal(options.authenticatorSelection.residentKey, 'required');
  assert.equal(options.authenticatorSelection.userVerification, 'required');
});

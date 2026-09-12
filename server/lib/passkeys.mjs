import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { parseCookies } from './auth.mjs';

const STORE_NAME = 'budget-tracker-passkeys';
const STORE_KEY = 'owner';
const CHALLENGE_COOKIE = 'budget_tracker_webauthn_challenge';
const CHALLENGE_SECONDS = 5 * 60;

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function text(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function challengeSecret() {
  const password = process.env.BUDGET_TRACKER_PASSWORD || '';
  const site = process.env.SITE_ID || process.env.URL || 'budget-tracker';
  return createHmac('sha256', password).update(`budget-tracker-webauthn-v1:${site}`).digest();
}

function signChallenge(payload) {
  return createHmac('sha256', challengeSecret()).update(payload).digest('base64url');
}

function encodeChallenge(challenge, purpose, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ challenge, purpose, issuedAt: Math.floor(now / 1000) })).toString('base64url');
  return `${payload}.${signChallenge(payload)}`;
}

function decodeChallenge(token, purpose, now = Date.now()) {
  const [payload, supplied] = String(token || '').split('.');
  if (!payload || !supplied) return null;
  const expected = signChallenge(payload);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  const age = Math.floor(now / 1000) - Number(data.issuedAt || 0);
  if (data.purpose !== purpose || age < -60 || age > CHALLENGE_SECONDS || !data.challenge) return null;
  return data.challenge;
}

export function challengeCookie(challenge, purpose) {
  return `${CHALLENGE_COOKIE}=${encodeURIComponent(encodeChallenge(challenge, purpose))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${CHALLENGE_SECONDS}`;
}

export function challengeFromRequest(request, purpose) {
  return decodeChallenge(parseCookies(request)[CHALLENGE_COOKIE], purpose);
}

export function clearChallengeCookie() {
  return `${CHALLENGE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function rpConfig(request) {
  const requestUrl = new URL(request.url);
  const configuredOrigin = text(process.env.PASSKEY_ORIGIN, 240);
  const origin = configuredOrigin || requestUrl.origin;
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.hostname !== 'localhost') throw new Error('Passkeys require HTTPS.');
  const rpID = text(process.env.PASSKEY_RP_ID, 180) || parsedOrigin.hostname;
  if (rpID.includes('://') || rpID.includes('/')) throw new Error('PASSKEY_RP_ID must be a hostname only.');
  return { origin: parsedOrigin.origin, rpID, rpName: 'Budget Tracker' };
}

function userID() {
  const site = process.env.SITE_ID || process.env.URL || 'budget-tracker';
  return new Uint8Array(createHash('sha256').update(`budget-tracker-owner:${site}`).digest().subarray(0, 32));
}

async function readRecord() {
  const entry = await store().getWithMetadata(STORE_KEY, { consistency: 'strong', type: 'json' });
  const data = entry?.data && typeof entry.data === 'object' ? entry.data : {};
  return {
    record: {
      version: 1,
      credentials: Array.isArray(data.credentials) ? data.credentials : [],
      updatedAt: data.updatedAt || null,
    },
    etag: entry?.etag || null,
    exists: Boolean(entry),
  };
}

async function mutateRecord(mutator) {
  const db = store();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readRecord();
    const next = structuredClone(current.record);
    await mutator(next);
    next.updatedAt = new Date().toISOString();
    const options = current.exists ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await db.setJSON(STORE_KEY, next, options);
    if (result.modified) return next;
  }
  throw new Error('Passkey settings changed on another device. Please retry.');
}

export async function passkeySummary({ includeCredentials = false } = {}) {
  const { record } = await readRecord();
  return {
    available: record.credentials.length > 0,
    count: record.credentials.length,
    credentials: includeCredentials ? record.credentials.map((item) => ({
      id: item.id,
      name: item.name,
      createdAt: item.createdAt,
      lastUsedAt: item.lastUsedAt || null,
      deviceType: item.deviceType || '',
      backedUp: item.backedUp === true,
      transports: item.transports || [],
    })) : undefined,
  };
}

export async function registrationOptions(request) {
  const { record } = await readRecord();
  const { rpID, rpName } = rpConfig(request);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: 'Budget Tracker Owner',
    userDisplayName: 'Budget Tracker Owner',
    userID: userID(),
    attestationType: 'none',
    excludeCredentials: record.credentials.map((credential) => ({ id: credential.id, transports: credential.transports || [] })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    supportedAlgorithmIDs: [-7, -257],
  });
  return options;
}

export async function verifyAndSaveRegistration(request, response, name = '') {
  const expectedChallenge = challengeFromRequest(request, 'registration');
  if (!expectedChallenge) throw new Error('Passkey registration expired. Start again.');
  const { origin, rpID } = rpConfig(request);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7, -257],
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error('Passkey registration could not be verified.');
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const transports = Array.isArray(response?.response?.transports) ? response.response.transports : [];
  const now = new Date().toISOString();
  await mutateRecord((record) => {
    const duplicate = record.credentials.find((item) => item.id === credential.id);
    if (duplicate) throw new Error('That passkey is already registered.');
    record.credentials.push({
      id: credential.id,
      name: text(name, 60) || 'Passkey',
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: Number(credential.counter || 0),
      transports,
      deviceType: credentialDeviceType || '',
      backedUp: credentialBackedUp === true,
      createdAt: now,
      lastUsedAt: null,
    });
  });
  return { verified: true, credentialId: credential.id };
}

export async function authenticationOptions(request, purpose = 'login') {
  const { record } = await readRecord();
  if (!record.credentials.length) throw new Error('No passkeys are registered yet.');
  const { rpID } = rpConfig(request);
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: record.credentials.map((credential) => ({ id: credential.id, transports: credential.transports || [] })),
    userVerification: 'required',
  });
}

export async function verifyAuthentication(request, response, purpose = 'login') {
  const expectedChallenge = challengeFromRequest(request, purpose);
  if (!expectedChallenge) throw new Error('Passkey authentication expired. Try again.');
  const { record } = await readRecord();
  const saved = record.credentials.find((item) => item.id === response?.id);
  if (!saved) throw new Error('Passkey is not registered for this tracker.');
  const { origin, rpID } = rpConfig(request);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: saved.id,
      publicKey: new Uint8Array(Buffer.from(saved.publicKey, 'base64url')),
      counter: Number(saved.counter || 0),
      transports: saved.transports || [],
    },
    requireUserVerification: true,
  });
  if (!verification.verified) throw new Error('Passkey authentication failed.');
  await mutateRecord((next) => {
    const credential = next.credentials.find((item) => item.id === saved.id);
    if (!credential) throw new Error('Passkey was removed during authentication.');
    credential.counter = Number(verification.authenticationInfo?.newCounter ?? credential.counter ?? 0);
    credential.lastUsedAt = new Date().toISOString();
  });
  return { verified: true, credentialId: saved.id };
}

export async function removePasskey(id) {
  const credentialId = text(id, 300);
  let removed = false;
  await mutateRecord((record) => {
    const before = record.credentials.length;
    record.credentials = record.credentials.filter((item) => item.id !== credentialId);
    removed = record.credentials.length !== before;
  });
  if (!removed) throw new Error('Passkey not found.');
  return true;
}

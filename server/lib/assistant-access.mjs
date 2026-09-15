import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'budget-tracker-assistant-access';
const TOKEN_KEY = 'primary';

function store() {
  return getStore({ name:STORE_NAME, consistency:'strong' });
}

function hashToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function validTimeZone(value) {
  const timeZone = String(value || '').trim().slice(0, 100) || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export async function assistantAccessStatus() {
  const record = await store().get(TOKEN_KEY, { type:'json' });
  if (!record?.tokenHash) return { enabled:false, createdAt:null, timeZone:null };
  return {
    enabled:true,
    createdAt:record.createdAt || null,
    timeZone:record.timeZone || 'UTC',
  };
}

export async function createAssistantAccess({ timeZone = 'UTC' } = {}) {
  const token = `bt_assist_${randomBytes(32).toString('base64url')}`;
  const record = {
    version:1,
    tokenHash:hashToken(token),
    timeZone:validTimeZone(timeZone),
    createdAt:new Date().toISOString(),
  };
  await store().setJSON(TOKEN_KEY, record);
  return {
    token,
    createdAt:record.createdAt,
    timeZone:record.timeZone,
  };
}

export async function revokeAssistantAccess() {
  await store().delete(TOKEN_KEY);
  return true;
}

export async function verifyAssistantBearer(request) {
  const header = String(request.headers.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { authorized:false, timeZone:null };
  const record = await store().get(TOKEN_KEY, { type:'json' });
  if (!record?.tokenHash) return { authorized:false, timeZone:null };
  const supplied = Buffer.from(hashToken(match[1]));
  const expected = Buffer.from(String(record.tokenHash));
  const authorized = supplied.length === expected.length && timingSafeEqual(supplied, expected);
  return { authorized, timeZone:authorized ? (record.timeZone || 'UTC') : null };
}

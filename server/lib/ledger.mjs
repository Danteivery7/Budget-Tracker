import { createHash, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'budget-tracker-ledger';
const HEAD_KEY = 'head';
const MAX_RECENT = 60;

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function cleanText(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function eventHash(event) {
  return digest({
    id: event.id,
    sequence: event.sequence,
    at: event.at,
    source: event.source,
    action: event.action,
    entity: event.entity,
    summary: event.summary,
    payloadDigest: event.payloadDigest,
    previousHash: event.previousHash,
    previousEventKey: event.previousEventKey,
  });
}

function eventKey(sequence, id) {
  return `event:${String(sequence).padStart(12, '0')}:${id}`;
}

async function readHead() {
  const entry = await store().getWithMetadata(HEAD_KEY, { consistency: 'strong', type: 'json' });
  if (!entry) return { head: { version: 1, sequence: 0, hash: '', eventKey: '', recent: [] }, etag: null, exists: false };
  const head = entry.data && typeof entry.data === 'object' ? entry.data : {};
  return {
    head: {
      version: 1,
      sequence: Number(head.sequence || 0),
      hash: cleanText(head.hash, 80),
      eventKey: cleanText(head.eventKey, 220),
      recent: Array.isArray(head.recent) ? head.recent.slice(0, MAX_RECENT) : [],
    },
    etag: entry.etag,
    exists: true,
  };
}

export async function appendLedgerEvent({ source, action, entity = '', summary = '', payload = null, at = new Date() }) {
  const ledger = store();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readHead();
    const sequence = current.head.sequence + 1;
    const id = randomUUID();
    const event = {
      version: 1,
      id,
      sequence,
      at: at.toISOString(),
      source: cleanText(source, 80) || 'system',
      action: cleanText(action, 120) || 'unknown',
      entity: cleanText(entity, 160),
      summary: cleanText(summary, 220),
      payloadDigest: digest(payload),
      previousHash: current.head.hash || '',
      previousEventKey: current.head.eventKey || '',
    };
    event.hash = eventHash(event);
    const key = eventKey(sequence, id);
    await ledger.setJSON(key, event, { onlyIfNew: true });
    const recentItem = {
      sequence,
      at: event.at,
      source: event.source,
      action: event.action,
      entity: event.entity,
      summary: event.summary,
      hash: event.hash,
    };
    const nextHead = {
      version: 1,
      sequence,
      hash: event.hash,
      eventKey: key,
      recent: [recentItem, ...current.head.recent].slice(0, MAX_RECENT),
      updatedAt: event.at,
    };
    const options = current.exists ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await ledger.setJSON(HEAD_KEY, nextHead, options);
    if (result.modified) return event;
    await ledger.delete(key).catch(() => {});
  }
  throw new Error('Financial ledger is busy. Please retry the operation.');
}

export async function safeAppendLedgerEvent(event) {
  try {
    await appendLedgerEvent(event);
    return true;
  } catch {
    return false;
  }
}

export async function ledgerStatus({ verifyDepth = 250 } = {}) {
  const ledger = store();
  const { head } = await readHead();
  let key = head.eventKey;
  let expectedHash = head.hash;
  let checked = 0;
  let valid = true;
  let error = '';
  while (key && checked < Math.max(1, Math.min(1000, Number(verifyDepth || 250)))) {
    const event = await ledger.get(key, { type: 'json' });
    if (!event) {
      valid = false;
      error = 'Missing ledger event.';
      break;
    }
    if (event.hash !== expectedHash || eventHash(event) !== event.hash) {
      valid = false;
      error = 'Ledger hash-chain verification failed.';
      break;
    }
    expectedHash = event.previousHash || '';
    key = event.previousEventKey || '';
    checked += 1;
  }
  return {
    sequence: head.sequence,
    headHash: head.hash,
    valid,
    checked,
    error,
    recent: head.recent,
  };
}

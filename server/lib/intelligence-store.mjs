import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { decryptBankValue, encryptBankValue } from './bank-crypto.mjs';
import { normalizeFinancialRule } from '../../financial-intelligence.js';

const STORE_NAME = 'budget-tracker-financial-intelligence';
const STORE_KEY = 'state';

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function template() {
  return { version: 1, rules: [], manualDecisions: {}, updatedAt: null };
}

async function readEntry() {
  const entry = await store().getWithMetadata(STORE_KEY, { consistency: 'strong', type: 'json' });
  if (!entry) return { state: template(), etag: null, exists: false };
  const decoded = decryptBankValue(entry.data, 'financial-intelligence');
  return {
    state: {
      version: 1,
      rules: Array.isArray(decoded.rules) ? decoded.rules : [],
      manualDecisions: decoded.manualDecisions && typeof decoded.manualDecisions === 'object' ? decoded.manualDecisions : {},
      updatedAt: decoded.updatedAt || null,
    },
    etag: entry.etag,
    exists: true,
  };
}

export async function readIntelligenceState() {
  return (await readEntry()).state;
}

async function mutate(mutator) {
  const db = store();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readEntry();
    const next = structuredClone(current.state);
    await mutator(next);
    next.updatedAt = new Date().toISOString();
    const envelope = encryptBankValue(next, 'financial-intelligence');
    const options = current.exists ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await db.setJSON(STORE_KEY, envelope, options);
    if (result.modified) return next;
  }
  throw new Error('Financial intelligence settings changed on another device. Please retry.');
}

export async function saveRule(input) {
  let saved;
  await mutate((state) => {
    const existing = state.rules.find((rule) => rule.id === input?.id) || {};
    const now = new Date().toISOString();
    saved = normalizeFinancialRule({ ...input, id: input?.id || randomUUID(), createdAt: existing.createdAt || now, updatedAt: now }, existing);
    const index = state.rules.findIndex((rule) => rule.id === saved.id);
    if (index === -1) state.rules.push(saved);
    else state.rules[index] = saved;
  });
  return saved;
}

export async function deleteRule(id) {
  let removed = null;
  await mutate((state) => {
    const index = state.rules.findIndex((rule) => rule.id === id);
    if (index === -1) throw new Error('Rule not found.');
    [removed] = state.rules.splice(index, 1);
  });
  return removed;
}

export async function saveManualDecision(transactionRef, decision) {
  const ref = String(transactionRef || '').trim().slice(0, 180);
  if (!ref) throw new Error('Transaction reference is required.');
  const classification = String(decision?.classification || '').trim();
  if (!classification || classification === 'unknown') throw new Error('Choose a classification.');
  const saved = {
    classification,
    bucket: String(decision?.bucket || '').trim().slice(0, 50),
    note: String(decision?.note || '').trim().slice(0, 160),
    reviewedAt: new Date().toISOString(),
  };
  await mutate((state) => { state.manualDecisions[ref] = saved; });
  return saved;
}

export async function clearManualDecision(transactionRef) {
  const ref = String(transactionRef || '').trim().slice(0, 180);
  await mutate((state) => { delete state.manualDecisions[ref]; });
  return true;
}

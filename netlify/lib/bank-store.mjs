import { getStore } from '@netlify/blobs';
import { decryptBankValue, encryptBankValue } from './bank-crypto.mjs';
import { bankDataTemplate } from './bank-core.mjs';

const VAULT_STORE = 'budget-tracker-bank-vault';
const DATA_STORE = 'budget-tracker-bank-data';
const VAULT_KEY = 'connections';

function vaultStore() {
  return getStore({ name: VAULT_STORE, consistency: 'strong' });
}

function dataStore() {
  return getStore({ name: DATA_STORE, consistency: 'strong' });
}

function cleanVault(value = {}) {
  return { version: 1, connections: Array.isArray(value?.connections) ? value.connections : [] };
}

async function readVaultEntry() {
  const entry = await vaultStore().getWithMetadata(VAULT_KEY, { consistency: 'strong', type: 'json' });
  if (!entry) return { value: cleanVault(), etag: null, exists: false };
  return { value: cleanVault(decryptBankValue(entry.data, 'bank-vault')), etag: entry.etag, exists: true };
}

export async function readVault() {
  return (await readVaultEntry()).value;
}

export async function writeVault(vault) {
  const value = cleanVault(vault);
  await vaultStore().setJSON(VAULT_KEY, encryptBankValue(value, 'bank-vault'));
  return value;
}

export async function mutateVault(mutator) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readVaultEntry();
    const draft = structuredClone(current.value);
    const maybeNext = await mutator(draft);
    const next = cleanVault(maybeNext || draft);
    const options = current.exists ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await vaultStore().setJSON(VAULT_KEY, encryptBankValue(next, 'bank-vault'), options);
    if (result.modified) return next;
  }
  throw new Error('Bank connection data changed concurrently. Please try again.');
}

export async function readBankData(connectionId) {
  const envelope = await dataStore().get(`connection:${connectionId}`, { type: 'json' });
  if (!envelope) return bankDataTemplate(connectionId);
  return decryptBankValue(envelope, `bank-data:${connectionId}`);
}

export async function writeBankData(connectionId, value) {
  const next = { ...bankDataTemplate(connectionId), ...(value || {}), connectionId };
  await dataStore().setJSON(`connection:${connectionId}`, encryptBankValue(next, `bank-data:${connectionId}`));
  return next;
}

export async function deleteBankData(connectionId) {
  await dataStore().delete(`connection:${connectionId}`);
}

export function connectionById(vault, connectionId) {
  return (vault?.connections || []).find((item) => item.connectionId === connectionId) || null;
}

export function connectionByItemId(vault, itemId) {
  return (vault?.connections || []).find((item) => item.itemId === itemId) || null;
}

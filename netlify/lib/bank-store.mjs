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

export async function readVault() {
  const envelope = await vaultStore().get(VAULT_KEY, { type: 'json' });
  if (!envelope) return { version: 1, connections: [] };
  const value = decryptBankValue(envelope, 'bank-vault');
  value.connections = Array.isArray(value.connections) ? value.connections : [];
  return value;
}

export async function writeVault(vault) {
  const value = { version: 1, connections: Array.isArray(vault?.connections) ? vault.connections : [] };
  await vaultStore().setJSON(VAULT_KEY, encryptBankValue(value, 'bank-vault'));
  return value;
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

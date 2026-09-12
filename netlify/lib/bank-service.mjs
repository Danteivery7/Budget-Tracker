import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { browserTransaction, discoveryTransaction, normalizePlaidTransaction, publicConnectionSummary, reconcileSyncedTransactions, sanitizePlaidAccount } from './bank-core.mjs';
import { opaqueBankRef } from './bank-crypto.mjs';
import { readBankData, readVault, writeBankData, writeVault, deleteBankData, connectionById, connectionByItemId } from './bank-store.mjs';
import { plaidHistoryDays, plaidRedirectUri, plaidRequest, plaidWebhookUrl } from './plaid-client.mjs';
import { ensureSubscriptionShape, markLinkedBankFeedDisconnected, refreshSubscriptionCandidatesFromLinkedBankRows } from './subscriptions-core.mjs';

const BUDGET_STORE = 'budget-tracker';
const BUDGET_KEY = 'state';
const text = (value, max = 160) => String(value ?? '').trim().slice(0, max);

function budgetStore() {
  return getStore({ name: BUDGET_STORE, consistency: 'strong' });
}

function retentionCutoff(days = plaidHistoryDays(), now = new Date()) {
  const date = new Date(now.getTime());
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function updateBudgetSubscriptionDiscovery(vault, now = new Date()) {
  const discoveryRows = [];
  for (const connection of vault.connections || []) {
    if (connection.status === 'disconnected') continue;
    const data = await readBankData(connection.connectionId);
    for (const row of data.transactions || []) {
      const candidate = discoveryTransaction(row);
      if (candidate) discoveryRows.push(candidate);
    }
  }

  const store = budgetStore();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entry = await store.getWithMetadata(BUDGET_KEY, { consistency: 'strong', type: 'json' });
    if (!entry) return;
    const state = ensureSubscriptionShape(entry.data);
    if (discoveryRows.length) refreshSubscriptionCandidatesFromLinkedBankRows(state, discoveryRows, now);
    else markLinkedBankFeedDisconnected(state, 0, now);
    const result = await store.setJSON(BUDGET_KEY, state, { onlyIfMatch: entry.etag });
    if (result.modified) return;
  }
  throw new Error('Budget state changed while bank discovery was updating.');
}

export async function createPlaidLinkToken(request, { connectionId = null } = {}) {
  const body = {
    client_name: 'Budget Tracker',
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: opaqueBankRef('single-private-user', 'plaid-user') },
  };
  const redirectUri = plaidRedirectUri();
  if (redirectUri) body.redirect_uri = redirectUri;

  if (connectionId) {
    const vault = await readVault();
    const connection = connectionById(vault, connectionId);
    if (!connection) throw new Error('Bank connection not found.');
    body.access_token = connection.accessToken;
  } else {
    body.products = ['transactions'];
    body.webhook = plaidWebhookUrl(request);
    body.transactions = { days_requested: plaidHistoryDays() };
  }

  const data = await plaidRequest('/link/token/create', body);
  return { linkToken: data.link_token, expiration: data.expiration || null, redirectEnabled: Boolean(redirectUri) };
}

async function fetchTransactionDelta(accessToken, startingCursor, accountLookup) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let cursor = startingCursor || undefined;
    let hasMore = true;
    const added = [];
    const modified = [];
    const removed = [];
    try {
      while (hasMore) {
        const response = await plaidRequest('/transactions/sync', {
          access_token: accessToken,
          ...(cursor ? { cursor } : {}),
          options: { include_personal_finance_category: true },
          count: 500,
        }, { timeoutMs: 25_000 });
        for (const row of response.added || []) added.push(normalizePlaidTransaction(row, accountLookup));
        for (const row of response.modified || []) modified.push(normalizePlaidTransaction(row, accountLookup));
        for (const row of response.removed || []) removed.push(row);
        cursor = response.next_cursor || cursor || null;
        hasMore = response.has_more === true;
      }
      return { cursor: cursor || null, added, modified, removed };
    } catch (error) {
      if (error.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || attempt === 1) throw error;
    }
  }
  throw new Error('Transaction sync could not stabilize.');
}

async function syncOneConnection(connection, { webhook = false } = {}) {
  const data = await readBankData(connection.connectionId);
  const accountsResponse = await plaidRequest('/accounts/get', { access_token: connection.accessToken });
  const rawAccounts = Array.isArray(accountsResponse.accounts) ? accountsResponse.accounts : [];
  const accountLookup = Object.fromEntries(rawAccounts.map((account) => [account.account_id, account]));
  const delta = await fetchTransactionDelta(connection.accessToken, data.cursor, accountLookup);
  const cutoff = retentionCutoff();
  const reconciled = reconcileSyncedTransactions(data.transactions, delta).filter((row) => !row.date || row.date >= cutoff);

  const next = {
    ...data,
    cursor: delta.cursor,
    accounts: rawAccounts.map(sanitizePlaidAccount),
    transactions: reconciled,
    retentionDays: plaidHistoryDays(),
    lastSyncedAt: new Date().toISOString(),
    lastWebhookAt: webhook ? new Date().toISOString() : data.lastWebhookAt || null,
    syncStatus: 'synced',
    errorCode: null,
  };
  await writeBankData(connection.connectionId, next);
  return next;
}

async function markConnectionIssue(connectionId, code = 'CONNECTION_ERROR') {
  const vault = await readVault();
  const connection = connectionById(vault, connectionId);
  if (connection) {
    connection.status = 'needs_repair';
    connection.updatedAt = new Date().toISOString();
    connection.lastErrorCode = text(code, 80);
    await writeVault(vault);
  }
  const data = await readBankData(connectionId);
  data.syncStatus = 'needs_repair';
  data.errorCode = text(code, 80);
  await writeBankData(connectionId, data);
}

export async function exchangePublicToken(publicToken, institutionName = '') {
  const token = text(publicToken, 500);
  if (!token) throw new Error('Plaid did not return a public token.');
  const exchanged = await plaidRequest('/item/public_token/exchange', { public_token: token });
  const vault = await readVault();
  const existing = connectionByItemId(vault, exchanged.item_id);
  const nowIso = new Date().toISOString();
  const connection = existing || {
    connectionId: randomUUID(),
    itemId: exchanged.item_id,
    createdAt: nowIso,
  };
  connection.accessToken = exchanged.access_token;
  connection.institutionName = text(institutionName, 100) || connection.institutionName || 'Financial institution';
  connection.status = 'connected';
  connection.updatedAt = nowIso;
  connection.lastErrorCode = null;
  if (!existing) vault.connections.push(connection);
  await writeVault(vault);

  let bankData;
  try {
    bankData = await syncOneConnection(connection);
  } catch (error) {
    await markConnectionIssue(connection.connectionId, error.code || 'INITIAL_SYNC_FAILED');
    throw new Error('The account was connected, but the first transaction sync needs attention.');
  }
  await updateBudgetSubscriptionDiscovery(await readVault());
  return publicConnectionSummary(connection, bankData);
}

export async function syncConnection(connectionId, options = {}) {
  const vault = await readVault();
  const connection = connectionById(vault, connectionId);
  if (!connection) throw new Error('Bank connection not found.');
  try {
    const data = await syncOneConnection(connection, options);
    connection.status = 'connected';
    connection.updatedAt = new Date().toISOString();
    connection.lastErrorCode = null;
    await writeVault(vault);
    await updateBudgetSubscriptionDiscovery(vault);
    return publicConnectionSummary(connection, data);
  } catch (error) {
    await markConnectionIssue(connectionId, error.code || 'SYNC_FAILED');
    throw error;
  }
}

export async function syncConnectionByItemId(itemId, options = {}) {
  const vault = await readVault();
  const connection = connectionByItemId(vault, itemId);
  if (!connection) return null;
  return syncConnection(connection.connectionId, options);
}

export async function markConnectionRepairByItemId(itemId, code = 'ITEM_ERROR') {
  const vault = await readVault();
  const connection = connectionByItemId(vault, itemId);
  if (!connection) return false;
  await markConnectionIssue(connection.connectionId, code);
  return true;
}

export async function clearRevokedItemData(itemId, code = 'USER_PERMISSION_REVOKED') {
  const vault = await readVault();
  const connection = connectionByItemId(vault, itemId);
  if (!connection) return false;
  const data = await readBankData(connection.connectionId);
  await writeBankData(connection.connectionId, {
    ...data,
    cursor: null,
    accounts: [],
    transactions: [],
    syncStatus: 'needs_repair',
    errorCode: text(code, 80),
    lastSyncedAt: new Date().toISOString(),
  });
  await markConnectionIssue(connection.connectionId, code);
  await updateBudgetSubscriptionDiscovery(await readVault());
  return true;
}

export async function removeRevokedAccountData(itemId, accountId) {
  const vault = await readVault();
  const connection = connectionByItemId(vault, itemId);
  if (!connection) return false;
  const data = await readBankData(connection.connectionId);
  const accountRef = opaqueBankRef(accountId, 'account');
  data.accounts = (data.accounts || []).filter((account) => account.accountRef !== accountRef);
  data.transactions = (data.transactions || []).filter((row) => row.accountId !== accountId);
  data.syncStatus = 'needs_repair';
  data.errorCode = 'USER_ACCOUNT_REVOKED';
  await writeBankData(connection.connectionId, data);
  await markConnectionIssue(connection.connectionId, 'USER_ACCOUNT_REVOKED');
  await updateBudgetSubscriptionDiscovery(await readVault());
  return true;
}

export async function listPublicConnections() {
  const vault = await readVault();
  const results = [];
  for (const connection of vault.connections || []) {
    if (connection.status === 'disconnected') continue;
    const data = await readBankData(connection.connectionId);
    results.push(publicConnectionSummary(connection, data));
  }
  return results;
}

export async function recentTransactions(connectionId, limit = 25) {
  const vault = await readVault();
  if (!connectionById(vault, connectionId)) throw new Error('Bank connection not found.');
  const data = await readBankData(connectionId);
  return (data.transactions || []).slice(0, Math.max(1, Math.min(50, Number(limit || 25)))).map(browserTransaction);
}

export async function disconnectConnection(connectionId) {
  const vault = await readVault();
  const connection = connectionById(vault, connectionId);
  if (!connection) throw new Error('Bank connection not found.');
  try { await plaidRequest('/item/remove', { access_token: connection.accessToken }); } catch (error) {
    if (error.code !== 'ITEM_NOT_FOUND') throw error;
  }
  vault.connections = vault.connections.filter((item) => item.connectionId !== connectionId);
  await writeVault(vault);
  await deleteBankData(connectionId);
  await updateBudgetSubscriptionDiscovery(vault);
  return true;
}

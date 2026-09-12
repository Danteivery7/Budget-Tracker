import { opaqueBankRef } from './bank-crypto.mjs';

const text = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function sanitizePlaidAccount(account = {}) {
  const balances = account.balances || {};
  return {
    accountRef: opaqueBankRef(account.account_id, 'account'),
    name: text(account.name, 80) || 'Account',
    officialName: text(account.official_name, 120),
    mask: text(account.mask, 8),
    type: text(account.type, 32),
    subtype: text(account.subtype, 48),
    current: Number.isFinite(Number(balances.current)) ? roundMoney(balances.current) : null,
    available: Number.isFinite(Number(balances.available)) ? roundMoney(balances.available) : null,
    limit: Number.isFinite(Number(balances.limit)) ? roundMoney(balances.limit) : null,
    currency: text(balances.iso_currency_code, 8) || 'USD',
  };
}

export function normalizePlaidTransaction(transaction = {}, accountLookup = {}) {
  const amount = Number(transaction.amount || 0);
  const accountId = text(transaction.account_id, 160);
  const account = accountLookup[accountId] || {};
  return {
    providerTransactionId: text(transaction.transaction_id, 180),
    accountId,
    accountRef: opaqueBankRef(accountId, 'account'),
    transactionRef: opaqueBankRef(transaction.transaction_id, 'transaction'),
    date: text(transaction.date || transaction.authorized_date, 10),
    authorizedDate: text(transaction.authorized_date, 10),
    merchantName: text(transaction.merchant_name || transaction.name, 120),
    name: text(transaction.name, 160),
    amount: Number.isFinite(amount) ? roundMoney(amount) : 0,
    pending: transaction.pending === true,
    primaryCategory: text(transaction.personal_finance_category?.primary, 80).toLowerCase(),
    detailedCategory: text(transaction.personal_finance_category?.detailed, 100).toLowerCase(),
    paymentChannel: text(transaction.payment_channel, 30),
    accountType: text(account.type, 32),
    accountSubtype: text(account.subtype, 48),
  };
}

export function discoveryTransaction(row = {}) {
  if (row.pending || !(Number(row.amount) > 0) || !row.date) return null;
  return {
    id: row.transactionRef,
    sourceTransactionId: row.transactionRef,
    date: row.date,
    merchantName: row.merchantName || row.name,
    amount: row.amount,
    accountId: row.accountRef,
    paymentMethodId: '',
    category: row.primaryCategory || row.detailedCategory || '',
    kindHint: row.detailedCategory || row.primaryCategory || '',
    source: 'linked-account',
    posted: true,
  };
}

export function reconcileSyncedTransactions(existing = [], delta = {}) {
  const map = new Map((existing || []).map((row) => [row.providerTransactionId, row]));
  for (const row of delta.removed || []) {
    const id = text(row.transaction_id, 180);
    if (id) map.delete(id);
  }
  for (const row of [...(delta.added || []), ...(delta.modified || [])]) {
    if (!row?.providerTransactionId) continue;
    map.set(row.providerTransactionId, row);
  }
  return [...map.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.providerTransactionId || '').localeCompare(String(a.providerTransactionId || '')));
}

export function browserTransaction(row = {}) {
  return {
    transactionRef: row.transactionRef,
    accountRef: row.accountRef,
    date: row.date,
    authorizedDate: row.authorizedDate || '',
    merchantName: row.merchantName || row.name || 'Transaction',
    amount: row.amount,
    pending: row.pending === true,
    primaryCategory: row.primaryCategory || '',
    detailedCategory: row.detailedCategory || '',
    paymentChannel: row.paymentChannel || '',
  };
}

export function bankDataTemplate(connectionId) {
  return {
    version: 1,
    connectionId,
    cursor: null,
    accounts: [],
    transactions: [],
    lastSyncedAt: null,
    lastWebhookAt: null,
    syncStatus: 'new',
    errorCode: null,
  };
}

export function publicConnectionSummary(vaultConnection = {}, bankData = null) {
  return {
    connectionId: vaultConnection.connectionId,
    institutionName: text(vaultConnection.institutionName, 100) || 'Financial institution',
    status: text(vaultConnection.status, 30) || 'connected',
    createdAt: vaultConnection.createdAt || null,
    updatedAt: vaultConnection.updatedAt || null,
    lastSyncedAt: bankData?.lastSyncedAt || null,
    syncStatus: bankData?.syncStatus || 'new',
    needsRepair: vaultConnection.status === 'needs_repair' || bankData?.syncStatus === 'needs_repair',
    accounts: Array.isArray(bankData?.accounts) ? bankData.accounts : [],
    transactionCount: Array.isArray(bankData?.transactions) ? bankData.transactions.length : 0,
  };
}

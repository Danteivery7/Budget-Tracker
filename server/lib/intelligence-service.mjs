import { getStore } from '@netlify/blobs';
import { analyzeFinancialTransactions } from '../../financial-intelligence.js';
import { browserTransaction } from './bank-core.mjs';
import { readBankData, readVault } from './bank-store.mjs';
import { deleteRule, readIntelligenceState, saveManualDecision, saveRule } from './intelligence-store.mjs';
import { ensureSubscriptionShape } from './subscriptions-core.mjs';

async function budgetCandidates() {
  const store = getStore({ name: 'budget-tracker', consistency: 'strong' });
  const entry = await store.get('state', { consistency: 'strong', type: 'json' });
  if (!entry) return [];
  return ensureSubscriptionShape(entry).subscriptionCandidates || [];
}

async function bankRowsAndAccounts() {
  const vault = await readVault();
  const transactions = [];
  const accounts = [];
  for (const connection of vault.connections || []) {
    if (connection.status === 'disconnected') continue;
    const data = await readBankData(connection.connectionId);
    for (const row of data.transactions || []) transactions.push(row);
    for (const account of data.accounts || []) {
      accounts.push({
        accountRef: account.accountRef,
        name: account.name,
        mask: account.mask || '',
        type: account.type || '',
        subtype: account.subtype || '',
        institutionName: connection.institutionName || 'Financial institution',
      });
    }
  }
  return { transactions, accounts };
}

export async function intelligenceView() {
  const [settings, bank, candidates] = await Promise.all([
    readIntelligenceState(),
    bankRowsAndAccounts(),
    budgetCandidates(),
  ]);
  const analysis = analyzeFinancialTransactions(bank.transactions, {
    rules: settings.rules,
    recurringCandidates: candidates,
    manualDecisions: settings.manualDecisions,
  });
  const classified = analysis.results.filter((item) => !item.intelligence.needsReview && item.intelligence.classification !== 'unknown').length;
  const reconciled = analysis.results.filter((item) => item.intelligence.evidence?.includes('matched_counterparty') || item.intelligence.evidence?.includes('refund_match')).length;
  return {
    rules: settings.rules,
    accounts: bank.accounts,
    reviewInbox: analysis.reviewInbox,
    classificationCounts: analysis.classificationCounts,
    health: {
      transactionCount: bank.transactions.length,
      ruleCount: settings.rules.length,
      reviewCount: analysis.reviewInbox.length,
      classifiedCount: classified,
      reconciledCount: reconciled,
      coverage: bank.transactions.length ? classified / bank.transactions.length : 0,
      updatedAt: settings.updatedAt,
    },
  };
}

export async function intelligenceForTransactions(transactionRefs = []) {
  const refs = new Set(transactionRefs.map(String));
  const [settings, bank, candidates] = await Promise.all([
    readIntelligenceState(),
    bankRowsAndAccounts(),
    budgetCandidates(),
  ]);
  const analysis = analyzeFinancialTransactions(bank.transactions, {
    rules: settings.rules,
    recurringCandidates: candidates,
    manualDecisions: settings.manualDecisions,
  });
  return Object.fromEntries(analysis.results
    .filter((item) => refs.has(item.transaction.transactionRef))
    .map((item) => [item.transaction.transactionRef, item.intelligence]));
}

export async function reviewTransaction({ transactionRef, classification, bucket = '', note = '', createRule = false }) {
  const bank = await bankRowsAndAccounts();
  const transaction = bank.transactions.find((row) => row.transactionRef === transactionRef);
  if (!transaction) throw new Error('Transaction not found.');
  const decision = await saveManualDecision(transactionRef, { classification, bucket, note });
  let rule = null;
  if (createRule) {
    rule = await saveRule({
      name: `${transaction.merchantName || transaction.name || 'Merchant'} → ${classification}`,
      merchantEquals: transaction.merchantName || transaction.name || '',
      accountRef: transaction.accountRef || '',
      direction: Number(transaction.amount || 0) < 0 ? 'inflow' : 'outflow',
      classification,
      bucket,
      priority: 700,
      note: 'Created from Review Inbox',
    });
  }
  return { decision, rule, transaction: browserTransaction(transaction) };
}

export async function upsertRule(rule) {
  return saveRule(rule);
}

export async function removeRule(id) {
  return deleteRule(id);
}

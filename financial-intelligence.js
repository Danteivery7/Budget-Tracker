const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const text = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const dateMs = (value) => {
  const ms = Date.parse(`${String(value || '').slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
};
const dayDistance = (a, b) => Math.abs(dateMs(a) - dateMs(b)) / 86_400_000;

export function normalizeFinancialMerchant(value) {
  return text(value, 180)
    .toUpperCase()
    .replace(/\b(POS|DEBIT|CREDIT|PURCHASE|PAYMENT|ACH|ONLINE|PENDING|CHECKCARD|VISA|MASTERCARD)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const FINANCIAL_CLASSIFICATIONS = [
  'business',
  'personal',
  'subscription',
  'bill',
  'income',
  'internal_transfer',
  'card_payment',
  'refund',
  'loan_payment',
  'savings',
  'unknown',
];

function validClassification(value) {
  return FINANCIAL_CLASSIFICATIONS.includes(value) ? value : 'unknown';
}

export function normalizeFinancialRule(input = {}, existing = {}) {
  const classification = validClassification(input.classification || existing.classification);
  if (classification === 'unknown') throw new Error('Choose what this rule should classify.');
  const min = input.minAmount === '' || input.minAmount == null ? null : roundMoney(input.minAmount);
  const max = input.maxAmount === '' || input.maxAmount == null ? null : roundMoney(input.maxAmount);
  if (min != null && (!Number.isFinite(min) || min < 0)) throw new Error('Minimum amount is invalid.');
  if (max != null && (!Number.isFinite(max) || max < 0)) throw new Error('Maximum amount is invalid.');
  if (min != null && max != null && min > max) throw new Error('Minimum amount cannot be greater than maximum amount.');
  const merchantContains = text(input.merchantContains ?? existing.merchantContains, 100);
  const merchantEquals = text(input.merchantEquals ?? existing.merchantEquals, 120);
  const accountRef = text(input.accountRef ?? existing.accountRef, 160);
  const categoryContains = text(input.categoryContains ?? existing.categoryContains, 100);
  const direction = ['inflow', 'outflow', 'any'].includes(input.direction) ? input.direction : (existing.direction || 'any');
  if (!merchantContains && !merchantEquals && !accountRef && !categoryContains && min == null && max == null && direction === 'any') {
    throw new Error('A rule needs at least one condition.');
  }
  return {
    id: text(input.id || existing.id, 100),
    name: text(input.name || existing.name, 80) || `${classification.replaceAll('_', ' ')} rule`,
    enabled: input.enabled !== false,
    priority: Math.max(0, Math.min(1000, Math.trunc(Number(input.priority ?? existing.priority ?? 500)))),
    merchantContains,
    merchantEquals,
    accountRef,
    categoryContains,
    minAmount: min,
    maxAmount: max,
    direction,
    classification,
    bucket: text(input.bucket ?? existing.bucket, 50),
    note: text(input.note ?? existing.note, 160),
    createdAt: existing.createdAt || input.createdAt || null,
    updatedAt: input.updatedAt || existing.updatedAt || null,
  };
}

function transactionDirection(transaction) {
  return Number(transaction.amount || 0) < 0 ? 'inflow' : 'outflow';
}

function categoryText(transaction) {
  return `${transaction.primaryCategory || ''} ${transaction.detailedCategory || ''}`.toUpperCase();
}

export function ruleMatches(transaction, rule) {
  if (!rule?.enabled) return false;
  const merchant = normalizeFinancialMerchant(transaction.merchantName || transaction.name);
  const equals = normalizeFinancialMerchant(rule.merchantEquals);
  const contains = normalizeFinancialMerchant(rule.merchantContains);
  if (equals && merchant !== equals) return false;
  if (contains && !merchant.includes(contains)) return false;
  if (rule.accountRef && transaction.accountRef !== rule.accountRef) return false;
  if (rule.categoryContains && !categoryText(transaction).includes(rule.categoryContains.toUpperCase())) return false;
  const absolute = Math.abs(Number(transaction.amount || 0));
  if (rule.minAmount != null && absolute < Number(rule.minAmount)) return false;
  if (rule.maxAmount != null && absolute > Number(rule.maxAmount)) return false;
  if (rule.direction && rule.direction !== 'any' && transactionDirection(transaction) !== rule.direction) return false;
  return true;
}

export function applyFinancialRules(transaction, rules = []) {
  const ordered = [...rules].filter((rule) => rule?.enabled !== false).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.id).localeCompare(String(b.id)));
  const rule = ordered.find((candidate) => ruleMatches(transaction, candidate));
  if (!rule) return null;
  return {
    classification: validClassification(rule.classification),
    bucket: rule.bucket || '',
    confidence: 1,
    reason: `Matched rule: ${rule.name}`,
    evidence: ['user_rule'],
    ruleId: rule.id,
    needsReview: false,
  };
}

function recurringMatch(transaction, candidates = []) {
  const merchant = normalizeFinancialMerchant(transaction.merchantName || transaction.name);
  if (!merchant || Number(transaction.amount || 0) <= 0) return null;
  for (const candidate of candidates) {
    if (candidate?.status !== 'confirmed') continue;
    const candidateMerchant = normalizeFinancialMerchant(candidate.merchantName);
    if (!candidateMerchant || candidateMerchant !== merchant) continue;
    if (candidate.accountId && transaction.accountRef && candidate.accountId !== transaction.accountRef) continue;
    const expected = Number(candidate.averageAmount || candidate.monthlyReserveAmount || 0);
    const amount = Math.abs(Number(transaction.amount || 0));
    const tolerance = Math.max(2, expected * 0.2);
    if (expected > 0 && Math.abs(amount - expected) > tolerance) continue;
    return {
      classification: candidate.suggestedType === 'bill' ? 'bill' : 'subscription',
      bucket: 'fixed',
      confidence: 0.99,
      reason: `Matched confirmed recurring charge: ${candidate.merchantName}`,
      evidence: ['confirmed_recurring'],
      recurringExpenseId: candidate.recurringExpenseId || '',
      needsReview: false,
    };
  }
  return null;
}

function transferPairs(transactions) {
  const results = new Map();
  const posted = transactions.filter((row) => !row.pending && row.accountRef && Number(row.amount || 0) !== 0);
  for (let i = 0; i < posted.length; i += 1) {
    const a = posted[i];
    if (results.has(a.transactionRef)) continue;
    for (let j = i + 1; j < posted.length; j += 1) {
      const b = posted[j];
      if (a.accountRef === b.accountRef || results.has(b.transactionRef)) continue;
      if (Math.sign(Number(a.amount)) === Math.sign(Number(b.amount))) continue;
      if (dayDistance(a.date, b.date) > 3) continue;
      const aa = Math.abs(Number(a.amount));
      const bb = Math.abs(Number(b.amount));
      if (Math.abs(aa - bb) > Math.max(0.02, Math.max(aa, bb) * 0.01)) continue;
      const aCredit = a.accountType === 'credit';
      const bCredit = b.accountType === 'credit';
      const classification = aCredit !== bCredit ? 'card_payment' : 'internal_transfer';
      const reason = classification === 'card_payment'
        ? 'Matched equal and opposite checking/credit-card settlement.'
        : 'Matched equal and opposite activity across two owned accounts.';
      const pair = { classification, bucket: 'transfer', confidence: 0.99, reason, evidence: ['matched_counterparty'], needsReview: false };
      results.set(a.transactionRef, { ...pair, pairRef: b.transactionRef });
      results.set(b.transactionRef, { ...pair, pairRef: a.transactionRef });
      break;
    }
  }
  return results;
}

function refundMatches(transactions) {
  const results = new Map();
  const spent = transactions.filter((row) => !row.pending && Number(row.amount || 0) > 0);
  const credits = transactions.filter((row) => !row.pending && Number(row.amount || 0) < 0);
  for (const credit of credits) {
    const merchant = normalizeFinancialMerchant(credit.merchantName || credit.name);
    let best = null;
    for (const purchase of spent) {
      if (purchase.accountRef !== credit.accountRef) continue;
      const days = (dateMs(credit.date) - dateMs(purchase.date)) / 86_400_000;
      if (days < 0 || days > 90) continue;
      const sameMerchant = merchant && merchant === normalizeFinancialMerchant(purchase.merchantName || purchase.name);
      const sameAmount = Math.abs(Math.abs(Number(credit.amount)) - Math.abs(Number(purchase.amount))) <= 0.02;
      if (!sameMerchant && !sameAmount) continue;
      const score = (sameMerchant ? 2 : 0) + (sameAmount ? 2 : 0) - days / 100;
      if (!best || score > best.score) best = { purchase, score, sameMerchant, sameAmount };
    }
    if (best) {
      results.set(credit.transactionRef, {
        classification: 'refund',
        bucket: '',
        confidence: best.sameMerchant && best.sameAmount ? 0.98 : 0.9,
        reason: `Matched refund to ${best.purchase.merchantName || best.purchase.name || 'earlier purchase'}.`,
        evidence: ['refund_match'],
        pairRef: best.purchase.transactionRef,
        needsReview: false,
      });
    }
  }
  return results;
}

function heuristic(transaction) {
  const cat = categoryText(transaction);
  const merchant = normalizeFinancialMerchant(transaction.merchantName || transaction.name);
  const amount = Number(transaction.amount || 0);
  if (transaction.pending) return { classification: 'unknown', bucket: '', confidence: 0, reason: 'Pending transaction; waiting for it to post.', evidence: ['pending'], needsReview: false };
  if (amount < 0 && transaction.accountType !== 'credit' && (/INCOME|PAYROLL|WAGES|DIRECT DEPOSIT/.test(cat) || /PAYROLL|PAYCHECK|SALARY/.test(merchant))) {
    return { classification: 'income', bucket: 'income', confidence: 0.92, reason: 'Recognized an incoming payroll/income pattern.', evidence: ['income_heuristic'], needsReview: false };
  }
  if (amount > 0 && /LOAN|STUDENT_LOAN|MORTGAGE/.test(cat)) {
    return { classification: 'loan_payment', bucket: 'loan', confidence: 0.9, reason: 'Institution category indicates a loan payment.', evidence: ['institution_category'], needsReview: false };
  }
  if (/TRANSFER/.test(cat)) {
    return { classification: 'unknown', bucket: '', confidence: 0.55, reason: 'Looks like a transfer but no matching owned-account counterparty was found.', evidence: ['transfer_category'], needsReview: true };
  }
  if (amount < 0) {
    return { classification: 'unknown', bucket: '', confidence: 0.45, reason: 'Incoming money was not confidently identified as income, refund, or transfer.', evidence: ['unclassified_inflow'], needsReview: true };
  }
  return { classification: 'unknown', bucket: '', confidence: 0.25, reason: 'No trusted rule or reconciliation match exists yet.', evidence: ['unclassified_outflow'], needsReview: true };
}

export function analyzeFinancialTransactions(transactions = [], { rules = [], recurringCandidates = [], manualDecisions = {} } = {}) {
  const rows = [...transactions].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.transactionRef || '').localeCompare(String(b.transactionRef || '')));
  const pairs = transferPairs(rows);
  const refunds = refundMatches(rows);
  const results = rows.map((transaction) => {
    const manual = manualDecisions?.[transaction.transactionRef];
    let intelligence;
    if (manual) {
      intelligence = {
        classification: validClassification(manual.classification),
        bucket: text(manual.bucket, 50),
        confidence: 1,
        reason: manual.note ? `Manual review: ${text(manual.note, 160)}` : 'Manually reviewed and confirmed.',
        evidence: ['manual_review'],
        needsReview: false,
      };
    } else {
      intelligence = applyFinancialRules(transaction, rules)
        || recurringMatch(transaction, recurringCandidates)
        || pairs.get(transaction.transactionRef)
        || refunds.get(transaction.transactionRef)
        || heuristic(transaction);
    }
    return { transaction, intelligence };
  });
  const reviewInbox = results
    .filter((item) => item.intelligence.needsReview)
    .sort((a, b) => String(b.transaction.date || '').localeCompare(String(a.transaction.date || '')))
    .map((item) => ({
      transactionRef: item.transaction.transactionRef,
      accountRef: item.transaction.accountRef,
      date: item.transaction.date,
      merchantName: item.transaction.merchantName || item.transaction.name || 'Transaction',
      amount: roundMoney(item.transaction.amount),
      primaryCategory: item.transaction.primaryCategory || '',
      reason: item.intelligence.reason,
      confidence: item.intelligence.confidence,
      suggestedClassification: item.intelligence.classification,
      evidence: item.intelligence.evidence,
    }));
  const classificationCounts = {};
  for (const item of results) classificationCounts[item.intelligence.classification] = (classificationCounts[item.intelligence.classification] || 0) + 1;
  return { results, reviewInbox, classificationCounts };
}

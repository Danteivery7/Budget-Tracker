import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFinancialTransactions, applyFinancialRules, normalizeFinancialRule } from '../financial-intelligence.js';

const tx = (overrides = {}) => ({
  transactionRef: overrides.transactionRef || 'tx',
  accountRef: overrides.accountRef || 'checking',
  date: overrides.date || '2026-09-12',
  merchantName: overrides.merchantName || 'Merchant',
  name: overrides.name || overrides.merchantName || 'Merchant',
  amount: overrides.amount ?? 10,
  pending: overrides.pending === true,
  primaryCategory: overrides.primaryCategory || '',
  detailedCategory: overrides.detailedCategory || '',
  accountType: overrides.accountType || 'depository',
  accountSubtype: overrides.accountSubtype || 'checking',
});

test('explicit user rules classify before automatic heuristics', () => {
  const rule = normalizeFinancialRule({ id:'r1', name:'Adobe business', merchantContains:'Adobe', direction:'outflow', classification:'business', bucket:'business', priority:900 });
  const result = applyFinancialRules(tx({ merchantName:'ADOBE CREATIVE CLOUD', amount:59.99 }), [rule]);
  assert.equal(result.classification, 'business');
  assert.equal(result.bucket, 'business');
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.evidence, ['user_rule']);
});

test('equal and opposite checking to credit activity reconciles as one card payment settlement', () => {
  const analysis = analyzeFinancialTransactions([
    tx({ transactionRef:'checking-out', accountRef:'checking', accountType:'depository', amount:400, date:'2026-09-10', merchantName:'CARD PAYMENT' }),
    tx({ transactionRef:'card-in', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:-400, date:'2026-09-11', merchantName:'PAYMENT RECEIVED' }),
  ]);
  const a = analysis.results.find((item) => item.transaction.transactionRef === 'checking-out').intelligence;
  const b = analysis.results.find((item) => item.transaction.transactionRef === 'card-in').intelligence;
  assert.equal(a.classification, 'card_payment');
  assert.equal(b.classification, 'card_payment');
  assert.equal(a.needsReview, false);
  assert.equal(a.pairRef, 'card-in');
  assert.equal(analysis.reviewInbox.length, 0);
});

test('owned depository accounts reconcile as internal transfers instead of spending', () => {
  const analysis = analyzeFinancialTransactions([
    tx({ transactionRef:'a', accountRef:'business-checking', amount:250, date:'2026-09-08' }),
    tx({ transactionRef:'b', accountRef:'personal-checking', amount:-250, date:'2026-09-08' }),
  ]);
  assert.equal(analysis.results[0].intelligence.classification, 'internal_transfer');
  assert.equal(analysis.results[1].intelligence.classification, 'internal_transfer');
  assert.equal(analysis.reviewInbox.length, 0);
});

test('matching merchant credit is identified as a refund', () => {
  const analysis = analyzeFinancialTransactions([
    tx({ transactionRef:'purchase', accountRef:'card', accountType:'credit', merchantName:'Best Buy', amount:199.99, date:'2026-08-20' }),
    tx({ transactionRef:'refund', accountRef:'card', accountType:'credit', merchantName:'BEST BUY', amount:-199.99, date:'2026-08-24' }),
  ]);
  const refund = analysis.results.find((item) => item.transaction.transactionRef === 'refund').intelligence;
  assert.equal(refund.classification, 'refund');
  assert.equal(refund.pairRef, 'purchase');
  assert.ok(refund.confidence >= 0.9);
});

test('confirmed recurring charges classify before generic spending', () => {
  const analysis = analyzeFinancialTransactions([
    tx({ transactionRef:'spotify', accountRef:'card', merchantName:'Spotify', amount:12.99 }),
  ], {
    recurringCandidates:[{ status:'confirmed', merchantName:'Spotify', accountId:'card', averageAmount:12.99, suggestedType:'subscription', recurringExpenseId:'spotify-recurring' }],
  });
  const result = analysis.results[0].intelligence;
  assert.equal(result.classification, 'subscription');
  assert.equal(result.recurringExpenseId, 'spotify-recurring');
  assert.equal(result.needsReview, false);
});

test('manual review beats a conflicting rule', () => {
  const rule = normalizeFinancialRule({ id:'rule', name:'Games personal', merchantContains:'Steam', direction:'outflow', classification:'personal', priority:900 });
  const analysis = analyzeFinancialTransactions([
    tx({ transactionRef:'steam', merchantName:'Steam', amount:80 }),
  ], {
    rules:[rule],
    manualDecisions:{ steam:{ classification:'business', bucket:'business', note:'Work-related purchase' } },
  });
  assert.equal(analysis.results[0].intelligence.classification, 'business');
  assert.deepEqual(analysis.results[0].intelligence.evidence, ['manual_review']);
});

test('ambiguous spending is deliberately sent to review instead of guessed', () => {
  const analysis = analyzeFinancialTransactions([
    tx({ transactionRef:'mystery', merchantName:'Unknown Merchant', amount:73.42 }),
  ]);
  assert.equal(analysis.results[0].intelligence.classification, 'unknown');
  assert.equal(analysis.results[0].intelligence.needsReview, true);
  assert.equal(analysis.reviewInbox.length, 1);
  assert.equal(analysis.reviewInbox[0].transactionRef, 'mystery');
});

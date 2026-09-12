import { analyzeFinancialTransactions, normalizeFinancialRule } from './financial-intelligence.js';

const tx = (overrides = {}) => ({
  transactionRef: overrides.transactionRef,
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

export function commissioningFixture() {
  const transactions = [
    tx({ transactionRef:'payroll', amount:-1675, merchantName:'ACME PAYROLL', primaryCategory:'INCOME', detailedCategory:'INCOME_WAGES' }),
    tx({ transactionRef:'business-out', accountRef:'checking', amount:1250, merchantName:'TRANSFER TO BUSINESS', primaryCategory:'TRANSFER_OUT' }),
    tx({ transactionRef:'business-in', accountRef:'business', amount:-1250, merchantName:'TRANSFER FROM CHECKING', primaryCategory:'TRANSFER_IN' }),
    tx({ transactionRef:'savings-out', accountRef:'checking', amount:250, merchantName:'TRANSFER TO SAVINGS', primaryCategory:'TRANSFER_OUT' }),
    tx({ transactionRef:'savings-in', accountRef:'savings', amount:-250, merchantName:'TRANSFER FROM CHECKING', primaryCategory:'TRANSFER_IN' }),
    tx({ transactionRef:'spotify', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:12.99, merchantName:'Spotify' }),
    tx({ transactionRef:'target', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:82.17, merchantName:'Target' }),
    tx({ transactionRef:'card-pay-checking', accountRef:'checking', amount:400, merchantName:'CARD PAYMENT', date:'2026-09-12' }),
    tx({ transactionRef:'card-pay-credit', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:-400, merchantName:'PAYMENT RECEIVED', date:'2026-09-13' }),
    tx({ transactionRef:'bestbuy-purchase', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:199.99, merchantName:'Best Buy', date:'2026-08-20' }),
    tx({ transactionRef:'bestbuy-refund', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:-199.99, merchantName:'BEST BUY', date:'2026-08-24' }),
    tx({ transactionRef:'pending-food', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:27.50, merchantName:'Pending Cafe', pending:true }),
    tx({ transactionRef:'ambiguous', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:73.42, merchantName:'Unknown Merchant' }),
    tx({ transactionRef:'steam-reviewed', accountRef:'credit', accountType:'credit', accountSubtype:'credit card', amount:80, merchantName:'Steam' }),
  ];
  const recurringCandidates = [
    { status:'confirmed', merchantName:'Spotify', accountId:'credit', averageAmount:12.99, suggestedType:'subscription', recurringExpenseId:'spotify-recurring' },
  ];
  const rules = [normalizeFinancialRule({ id:'steam-rule', name:'Steam personal', merchantContains:'Steam', direction:'outflow', classification:'personal', priority:900 })];
  const manualDecisions = { 'steam-reviewed':{ classification:'business', bucket:'business', note:'Commissioning override test' } };
  return { transactions, recurringCandidates, rules, manualDecisions };
}

export function runSyntheticCommissioning() {
  const fixture = commissioningFixture();
  const analysis = analyzeFinancialTransactions(fixture.transactions, fixture);
  const byRef = Object.fromEntries(analysis.results.map((item) => [item.transaction.transactionRef, item.intelligence]));
  const checks = [
    ['income', byRef.payroll?.classification === 'income'],
    ['business_transfer', byRef['business-out']?.classification === 'internal_transfer' && byRef['business-in']?.classification === 'internal_transfer'],
    ['savings_transfer', byRef['savings-out']?.classification === 'internal_transfer' && byRef['savings-in']?.classification === 'internal_transfer'],
    ['subscription', byRef.spotify?.classification === 'subscription'],
    ['card_payment', byRef['card-pay-checking']?.classification === 'card_payment' && byRef['card-pay-credit']?.classification === 'card_payment'],
    ['refund', byRef['bestbuy-refund']?.classification === 'refund' && byRef['bestbuy-refund']?.pairRef === 'bestbuy-purchase'],
    ['pending_held', byRef['pending-food']?.evidence?.includes('pending') && byRef['pending-food']?.needsReview === false],
    ['ambiguous_review', byRef.ambiguous?.needsReview === true && analysis.reviewInbox.some((row) => row.transactionRef === 'ambiguous')],
    ['manual_override', byRef['steam-reviewed']?.classification === 'business' && byRef['steam-reviewed']?.evidence?.includes('manual_review')],
  ].map(([name, passed]) => ({ name, passed:Boolean(passed) }));
  const passed = checks.every((check) => check.passed);
  const cardSettlementRows = analysis.results.filter((item) => item.intelligence.classification === 'card_payment').length;
  const internalTransferRows = analysis.results.filter((item) => item.intelligence.classification === 'internal_transfer').length;
  return {
    passed,
    checks,
    metrics: {
      transactions: fixture.transactions.length,
      reviewInbox: analysis.reviewInbox.length,
      cardSettlementRows,
      internalTransferRows,
      refunds: analysis.classificationCounts.refund || 0,
      subscriptions: analysis.classificationCounts.subscription || 0,
    },
    classificationCounts: analysis.classificationCounts,
  };
}

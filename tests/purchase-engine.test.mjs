import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePurchase } from '../purchase-engine.js';

test('purchase uses personal spending before touching business money', () => {
  const result = analyzePurchase({ price: 150, personalAvailable: 200, reinvestmentTarget: 5000, savingsTarget: 1000 });
  assert.equal(result.status, 'within-spending');
  assert.equal(result.fromPersonal, 150);
  assert.equal(result.fromBusiness, 0);
  assert.equal(result.fromSavings, 0);
  assert.equal(result.personalAfter, 50);
});

test('400 purchase with 200 personal left pulls only 200 from business', () => {
  const result = analyzePurchase({ price: 400, personalAvailable: 200, reinvestmentTarget: 5000, savingsTarget: 1000 });
  assert.equal(result.status, 'business-impact');
  assert.equal(result.fromPersonal, 200);
  assert.equal(result.fromBusiness, 200);
  assert.equal(result.fromSavings, 0);
  assert.equal(result.personalShortfall, 200);
  assert.equal(result.businessAfter, 4800);
  assert.equal(result.savingsAfter, 1000);
});

test('loan bucket is only used after personal and business are exhausted', () => {
  const result = analyzePurchase({ price: 5600, personalAvailable: 200, reinvestmentTarget: 5000, savingsTarget: 700 });
  assert.equal(result.status, 'loan-risk');
  assert.equal(result.fromPersonal, 200);
  assert.equal(result.fromBusiness, 5000);
  assert.equal(result.fromSavings, 400);
  assert.equal(result.savingsAfter, 300);
});

test('purchase is marked unfunded if all three buckets are insufficient', () => {
  const result = analyzePurchase({ price: 7000, personalAvailable: 200, reinvestmentTarget: 5000, savingsTarget: 700 });
  assert.equal(result.status, 'unfunded');
  assert.equal(result.unfunded, 1100);
  assert.equal(result.fullyFunded, false);
});

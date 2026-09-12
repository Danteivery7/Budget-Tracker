export function roundPurchaseMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function analyzePurchase({ price = 0, personalAvailable = 0, reinvestmentTarget = 0, savingsTarget = 0 } = {}) {
  const cost = Math.max(0, roundPurchaseMoney(price));
  const personal = Math.max(0, roundPurchaseMoney(personalAvailable));
  const business = Math.max(0, roundPurchaseMoney(reinvestmentTarget));
  const savings = Math.max(0, roundPurchaseMoney(savingsTarget));

  const fromPersonal = Math.min(cost, personal);
  let remaining = roundPurchaseMoney(cost - fromPersonal);
  const fromBusiness = Math.min(remaining, business);
  remaining = roundPurchaseMoney(remaining - fromBusiness);
  const fromSavings = Math.min(remaining, savings);
  remaining = roundPurchaseMoney(remaining - fromSavings);

  const personalAfter = roundPurchaseMoney(personal - fromPersonal);
  const businessAfter = roundPurchaseMoney(business - fromBusiness);
  const savingsAfter = roundPurchaseMoney(savings - fromSavings);
  const personalShortfall = roundPurchaseMoney(Math.max(0, cost - personal));

  let status = 'within-spending';
  if (remaining > 0.005) status = 'unfunded';
  else if (fromSavings > 0.005) status = 'loan-risk';
  else if (fromBusiness > 0.005) status = 'business-impact';

  return {
    cost,
    personalAvailable: personal,
    reinvestmentTarget: business,
    savingsTarget: savings,
    fromPersonal: roundPurchaseMoney(fromPersonal),
    fromBusiness: roundPurchaseMoney(fromBusiness),
    fromSavings: roundPurchaseMoney(fromSavings),
    unfunded: roundPurchaseMoney(remaining),
    personalShortfall,
    personalAfter,
    businessAfter,
    savingsAfter,
    status,
    touchesBusiness: fromBusiness > 0.005,
    touchesLoanSavings: fromSavings > 0.005,
    fullyFunded: remaining <= 0.005,
  };
}

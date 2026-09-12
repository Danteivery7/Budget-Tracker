export function roundSetupMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function fixedCostTotal(housing = 0, expenses = []) {
  return roundSetupMoney(Number(housing || 0) + expenses.reduce((sum, item) => sum + Number(item?.amount || 0), 0));
}

export function buildSetupPlan({
  income = 0,
  housing = 0,
  expenses = [],
  reinvestment = 0,
  savingsTarget = 0,
  desiredPersonal = null,
  balanceMode = 'protected',
} = {}) {
  const cleanIncome = roundSetupMoney(Math.max(0, Number(income || 0)));
  const fixedTotal = fixedCostTotal(housing, expenses);
  const cleanSavings = roundSetupMoney(Math.max(0, Number(savingsTarget || 0)));
  const requestedBusiness = roundSetupMoney(Math.max(0, Number(reinvestment || 0)));
  const maxAfterProtected = roundSetupMoney(cleanIncome - fixedTotal - cleanSavings);
  const requestedPersonal = desiredPersonal == null || desiredPersonal === ''
    ? null
    : roundSetupMoney(Math.max(0, Number(desiredPersonal || 0)));

  let businessTarget = requestedBusiness;
  if (balanceMode === 'personal' && requestedPersonal != null) {
    businessTarget = roundSetupMoney(Math.max(0, maxAfterProtected - requestedPersonal));
  }

  const personalAvailable = roundSetupMoney(cleanIncome - fixedTotal - cleanSavings - businessTarget);
  const overAllocated = personalAvailable < -0.005;
  const personalGoalGap = requestedPersonal == null ? 0 : roundSetupMoney(personalAvailable - requestedPersonal);
  const desiredPersonalImpossible = requestedPersonal != null && requestedPersonal > Math.max(0, maxAfterProtected) + 0.005;

  return {
    income: cleanIncome,
    fixedTotal,
    savingsTarget: cleanSavings,
    requestedBusiness,
    businessTarget,
    desiredPersonal: requestedPersonal,
    personalAvailable,
    maxAfterProtected,
    overAllocated,
    desiredPersonalImpossible,
    personalGoalGap,
  };
}

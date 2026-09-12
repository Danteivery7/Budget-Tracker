import { randomUUID } from 'node:crypto';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const text = (value, max = 160) => String(value ?? '').trim().slice(0, max);

function money(value, label = 'Amount') {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) throw new Error(`${label} must be a valid non-negative number.`);
  return roundMoney(number);
}

function boundedInt(value, fallback, min, max, label) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return number;
}

function cleanExpenses(expenses = []) {
  return (Array.isArray(expenses) ? expenses : []).map((item) => ({
    id: text(item?.id, 80) || randomUUID(),
    name: text(item?.name, 80) || 'Fixed expense',
    category: text(item?.category, 40) || 'Other',
    amount: money(item?.amount, 'Expense amount'),
  }));
}

function configFrom(input = {}, expenseFallback = []) {
  return {
    income: money(input?.income, 'Income'),
    housing: money(input?.housing, 'Housing'),
    reinvestment: money(input?.reinvestment, 'Reinvestment'),
    savingsTarget: money(input?.savingsTarget, 'Loan / savings target'),
    planningWeeks: boundedInt(input?.planningWeeks, 4, 1, 8, 'Planning weeks'),
    payoutDaysPerWeek: boundedInt(input?.payoutDaysPerWeek, 5, 1, 7, 'Paying days per week'),
    expenses: cleanExpenses(Array.isArray(input?.expenses) ? input.expenses : expenseFallback),
  };
}

function fixedTotal(config) {
  return roundMoney(Number(config.housing || 0) + (config.expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0));
}

function validateAllocation(config) {
  const personal = roundMoney(config.income - fixedTotal(config) - config.reinvestment - config.savingsTarget);
  if (personal < -0.005) throw new Error(`This plan is over-allocated by $${Math.abs(personal).toFixed(2)}. Lower a target or increase expected income.`);
  return personal;
}

export function ensurePlanShape(state = {}) {
  state.planRevisions = Array.isArray(state.planRevisions) ? state.planRevisions : [];
  state.planSettings = state.planSettings && typeof state.planSettings === 'object' && !Array.isArray(state.planSettings) ? state.planSettings : {};
  return state;
}

export function initializePlanFromMonth(state, month, now = new Date()) {
  ensurePlanShape(state);
  if (state.planRevisions.length || !state.months?.[month]) return state;
  const config = configFrom(state.months[month], state.recurringExpenses || state.months[month].expenses || []);
  validateAllocation(config);
  state.planRevisions.push({
    id: randomUUID(),
    effectiveMonth: month,
    effectiveDate: `${month}-01`,
    source: 'initial-setup',
    reason: 'Initial budget plan',
    config,
    desiredPersonal: roundMoney(config.income - fixedTotal(config) - config.reinvestment - config.savingsTarget),
    balanceMode: 'protected',
    createdAt: now.toISOString(),
  });
  state.planSettings.activeRevisionId = state.planRevisions[0].id;
  state.planSettings.updatedAt = now.toISOString();
  return state;
}

export function bootstrapPlanFromHistory(state, now = new Date()) {
  ensurePlanShape(state);
  if (state.planRevisions.length) return state;
  const keys = Object.keys(state.months || {}).sort();
  if (!keys.length) return state;
  return initializePlanFromMonth(state, keys.at(-1), now);
}

export function resolvePlanForMonth(state, month) {
  ensurePlanShape(state);
  const eligible = state.planRevisions
    .filter((revision) => MONTH_RE.test(revision?.effectiveMonth || '') && revision.effectiveMonth <= month)
    .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return eligible.at(-1) || null;
}

export function ensureMonthFromPlan(state, month, now = new Date()) {
  ensurePlanShape(state);
  if (!MONTH_RE.test(month)) throw new Error('Invalid month.');
  if (state.months?.[month]) return state;
  bootstrapPlanFromHistory(state, now);
  const revision = resolvePlanForMonth(state, month);
  if (!revision) return state;
  state.months ||= {};
  const recurring = Array.isArray(state.recurringExpenses) && state.recurringExpenses.length ? state.recurringExpenses : revision.config.expenses;
  const config = configFrom(revision.config, recurring);
  config.expenses = cleanExpenses(recurring);
  validateAllocation(config);
  state.months[month] = {
    ...config,
    trackingStartDay: 1,
    trackingStartMode: 'fresh',
    priorNetSpending: 0,
    planRevisionId: revision.id,
    inheritedPlan: true,
    updatedAt: now.toISOString(),
  };
  state.planSettings.activeRevisionId = revision.id;
  state.planSettings.updatedAt = now.toISOString();
  return state;
}

export function createPlanRevision(state, payload = {}, now = new Date()) {
  ensurePlanShape(state);
  bootstrapPlanFromHistory(state, now);
  const effectiveMonth = text(payload?.effectiveMonth, 7);
  if (!MONTH_RE.test(effectiveMonth)) throw new Error('Choose a valid effective month.');

  const baseRevision = resolvePlanForMonth(state, effectiveMonth) || state.planRevisions.at(-1);
  const baseConfig = baseRevision?.config || {};
  const expenses = Array.isArray(payload?.expenses)
    ? payload.expenses
    : (state.months?.[effectiveMonth]?.expenses || state.recurringExpenses || baseConfig.expenses || []);

  let config = configFrom({ ...baseConfig, ...payload, expenses }, expenses);
  const balanceMode = payload?.balanceMode === 'personal' ? 'personal' : 'protected';
  const desiredPersonal = money(payload?.desiredPersonal ?? Math.max(0, config.income - fixedTotal(config) - config.reinvestment - config.savingsTarget), 'Personal spending target');

  if (balanceMode === 'personal') {
    const flexibleBusiness = roundMoney(config.income - fixedTotal(config) - config.savingsTarget - desiredPersonal);
    if (flexibleBusiness < -0.005) throw new Error('That personal-spending target cannot fit without reducing protected loan/savings money or fixed obligations.');
    config.reinvestment = Math.max(0, flexibleBusiness);
  }
  const personal = validateAllocation(config);
  const revision = {
    id: randomUUID(),
    effectiveMonth,
    effectiveDate: text(payload?.effectiveDate, 10) || `${effectiveMonth}-01`,
    source: 'plan-change-wizard',
    reason: text(payload?.reason, 200) || 'Plan updated',
    previousRevisionId: baseRevision?.id || null,
    config,
    desiredPersonal: balanceMode === 'personal' ? desiredPersonal : personal,
    balanceMode,
    createdAt: now.toISOString(),
  };
  state.planRevisions.push(revision);
  state.planSettings.activeRevisionId = revision.id;
  state.planSettings.updatedAt = now.toISOString();

  if (payload?.applyToMonth === true) {
    if (!state.months?.[effectiveMonth]) ensureMonthFromPlan(state, effectiveMonth, now);
    const existing = state.months[effectiveMonth] || {};
    state.months[effectiveMonth] = {
      ...existing,
      ...config,
      expenses: cleanExpenses(existing.expenses?.length ? existing.expenses : config.expenses),
      trackingStartDay: Number(existing.trackingStartDay || 1),
      trackingStartMode: existing.trackingStartMode === 'actual' ? 'actual' : 'fresh',
      priorNetSpending: Number(existing.priorNetSpending || 0),
      planRevisionId: revision.id,
      inheritedPlan: false,
      revisedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  return state;
}

export function copyPlanForImport(source, target) {
  ensurePlanShape(target);
  const input = ensurePlanShape(structuredClone(source || {}));
  target.planRevisions = input.planRevisions.filter((revision) => MONTH_RE.test(revision?.effectiveMonth || '')).map((revision) => ({
    id: text(revision.id, 100) || randomUUID(),
    effectiveMonth: revision.effectiveMonth,
    effectiveDate: text(revision.effectiveDate, 10) || `${revision.effectiveMonth}-01`,
    source: text(revision.source, 40) || 'imported',
    reason: text(revision.reason, 200),
    previousRevisionId: text(revision.previousRevisionId, 100) || null,
    config: configFrom(revision.config || {}, revision.config?.expenses || []),
    desiredPersonal: money(revision.desiredPersonal, 'Personal spending target'),
    balanceMode: revision.balanceMode === 'personal' ? 'personal' : 'protected',
    createdAt: text(revision.createdAt, 40) || new Date().toISOString(),
  }));
  target.planSettings = { ...input.planSettings };
  return target;
}

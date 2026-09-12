import { randomUUID } from 'node:crypto';
import { anchorDateForMonth, financialCycleBounds, financialCycleBoundsForMonth } from '../../financial-cycle.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
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

function dateFromMonthDay(month, day) {
  const [year, monthNumber] = month.split('-').map(Number);
  return anchorDateForMonth(year, monthNumber, day);
}

function establishCycleAnchor(state, month) {
  ensurePlanShape(state);
  if (DATE_RE.test(state.planSettings.financialCycleAnchorDate || '')) return state.planSettings.financialCycleAnchorDate;
  const config = state.months?.[month] || {};
  const startDay = Math.max(1, Number(config.trackingStartDay || 1));
  const anchorDate = dateFromMonthDay(month, startDay);
  state.planSettings.financialCycleAnchorDate = anchorDate;
  state.planSettings.financialCycleAnchorDay = Number(anchorDate.slice(-2));
  state.planSettings.weekStartsOn = 1;
  state.planSettings.updatedAt = new Date().toISOString();
  return anchorDate;
}

export function ensurePlanShape(state = {}) {
  state.planRevisions = Array.isArray(state.planRevisions) ? state.planRevisions : [];
  state.planSettings = state.planSettings && typeof state.planSettings === 'object' && !Array.isArray(state.planSettings) ? state.planSettings : {};
  state.planSettings.weekStartsOn = 1;
  if (DATE_RE.test(state.planSettings.financialCycleAnchorDate || '')) {
    state.planSettings.financialCycleAnchorDay = Number(state.planSettings.financialCycleAnchorDate.slice(-2));
  }
  return state;
}

export function initializePlanFromMonth(state, month, now = new Date()) {
  ensurePlanShape(state);
  if (state.planRevisions.length || !state.months?.[month]) return state;
  const config = configFrom(state.months[month], state.recurringExpenses || state.months[month].expenses || []);
  validateAllocation(config);
  const anchorDate = establishCycleAnchor(state, month);
  state.planRevisions.push({
    id: randomUUID(),
    effectiveMonth: month,
    effectiveDate: anchorDate,
    source: 'initial-setup',
    reason: 'Initial budget plan',
    config,
    desiredPersonal: roundMoney(config.income - fixedTotal(config) - config.reinvestment - config.savingsTarget),
    balanceMode: 'protected',
    createdAt: now.toISOString(),
  });
  const bounds = financialCycleBoundsForMonth(month, anchorDate);
  if (bounds) {
    state.months[month].cycleStartDate = bounds.start;
    state.months[month].cycleEndDate = bounds.end;
    state.months[month].trackingStartDate = state.months[month].trackingStartDate || anchorDate;
  }
  state.planSettings.activeRevisionId = state.planRevisions[0].id;
  state.planSettings.updatedAt = now.toISOString();
  return state;
}

export function bootstrapPlanFromHistory(state, now = new Date()) {
  ensurePlanShape(state);
  if (state.planRevisions.length) {
    if (!DATE_RE.test(state.planSettings.financialCycleAnchorDate || '')) {
      const first = [...state.planRevisions].sort((a, b) => String(a.effectiveDate || '').localeCompare(String(b.effectiveDate || '')))[0];
      if (DATE_RE.test(first?.effectiveDate || '')) {
        state.planSettings.financialCycleAnchorDate = first.effectiveDate;
        state.planSettings.financialCycleAnchorDay = Number(first.effectiveDate.slice(-2));
      }
    }
    return state;
  }
  const keys = Object.keys(state.months || {}).sort();
  if (!keys.length) return state;
  return initializePlanFromMonth(state, keys[0], now);
}

export function resolvePlanForMonth(state, month) {
  ensurePlanShape(state);
  const eligible = state.planRevisions
    .filter((revision) => MONTH_RE.test(revision?.effectiveMonth || '') && revision.effectiveMonth <= month)
    .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return eligible.at(-1) || null;
}

export function cycleForDate(state, date) {
  bootstrapPlanFromHistory(state);
  const anchorDate = state.planSettings.financialCycleAnchorDate;
  if (!DATE_RE.test(anchorDate || '')) return null;
  return financialCycleBounds(date, anchorDate);
}

export function ensureMonthFromPlan(state, month, now = new Date()) {
  ensurePlanShape(state);
  if (!MONTH_RE.test(month)) throw new Error('Invalid month.');
  bootstrapPlanFromHistory(state, now);
  const anchorDate = state.planSettings.financialCycleAnchorDate || `${month}-01`;
  const bounds = financialCycleBoundsForMonth(month, anchorDate);
  if (!bounds) return state;
  if (state.months?.[month]) {
    state.months[month].cycleStartDate ||= bounds.start;
    state.months[month].cycleEndDate ||= bounds.end;
    state.months[month].trackingStartDate ||= state.months[month].cycleStartDate;
    return state;
  }
  const revision = resolvePlanForMonth(state, month);
  if (!revision) return state;
  state.months ||= {};
  const recurring = Array.isArray(state.recurringExpenses) && state.recurringExpenses.length ? state.recurringExpenses : revision.config.expenses;
  const config = configFrom(revision.config, recurring);
  config.expenses = cleanExpenses(recurring);
  validateAllocation(config);
  state.months[month] = {
    ...config,
    cycleStartDate: bounds.start,
    cycleEndDate: bounds.end,
    trackingStartDate: bounds.start,
    trackingStartDay: Number(bounds.start.slice(-2)),
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

export function ensureCycleForDate(state, date, now = new Date()) {
  bootstrapPlanFromHistory(state, now);
  const bounds = cycleForDate(state, date);
  if (!bounds) return state;
  return ensureMonthFromPlan(state, bounds.cycleMonth, now);
}

export function createPlanRevision(state, payload = {}, now = new Date()) {
  ensurePlanShape(state);
  bootstrapPlanFromHistory(state, now);
  const effectiveMonth = text(payload?.effectiveMonth, 7);
  if (!MONTH_RE.test(effectiveMonth)) throw new Error('Choose a valid effective financial cycle.');

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
  const anchorDate = state.planSettings.financialCycleAnchorDate || `${effectiveMonth}-01`;
  const bounds = financialCycleBoundsForMonth(effectiveMonth, anchorDate);
  const revision = {
    id: randomUUID(),
    effectiveMonth,
    effectiveDate: text(payload?.effectiveDate, 10) || bounds?.start || `${effectiveMonth}-01`,
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
      cycleStartDate: existing.cycleStartDate || bounds?.start,
      cycleEndDate: existing.cycleEndDate || bounds?.end,
      trackingStartDate: existing.trackingStartDate || existing.cycleStartDate || bounds?.start,
      trackingStartDay: Number(existing.trackingStartDay || bounds?.start?.slice(-2) || 1),
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
  target.planSettings = { ...input.planSettings, weekStartsOn: 1 };
  return target;
}

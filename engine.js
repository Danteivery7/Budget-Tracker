import { cycleDayNumber, dateInRange, daysInclusive, financialCycleBounds, financialCycleBoundsForMonth } from './financial-cycle.js';

export const DEFAULT_STATE = {
  version: 3,
  createdAt: null,
  updatedAt: null,
  recurringExpenses: [],
  months: {},
  dailySpending: {},
};

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function monthKeyFromDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function dateKeyFromDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysInMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function previousMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return monthKeyFromDate(new Date(year, month - 2, 1));
}

export function nextMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return monthKeyFromDate(new Date(year, month, 1));
}

export function monthLabel(monthKey, locale = 'en-US') {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

export function sumExpenses(expenses = []) {
  return roundMoney(expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0));
}

export function dailyAmounts(entry = {}) {
  const spent = roundMoney(Math.max(0, Number(entry?.amount || 0)));
  const refunded = roundMoney(Math.max(0, Number(entry?.refund || 0)));
  return { spent, refunded, net: roundMoney(spent - refunded) };
}

export function allocationBreakdown(cfg = {}, carryIn = 0) {
  const income = roundMoney(Number(cfg?.income || 0));
  const housing = roundMoney(Number(cfg?.housing || 0));
  const recurringTotal = sumExpenses(cfg?.expenses || []);
  const fixedTotal = roundMoney(housing + recurringTotal);
  const reinvestment = roundMoney(Number(cfg?.reinvestment || 0));
  const savingsTarget = roundMoney(Number(cfg?.savingsTarget || 0));
  const planningWeeksRaw = Number(cfg?.planningWeeks || 4);
  const payoutDaysRaw = Number(cfg?.payoutDaysPerWeek || 5);
  const planningWeeks = Number.isInteger(planningWeeksRaw) && planningWeeksRaw > 0 ? planningWeeksRaw : 4;
  const payoutDaysPerWeek = Number.isInteger(payoutDaysRaw) && payoutDaysRaw > 0 ? payoutDaysRaw : 5;
  const payoutDays = planningWeeks * payoutDaysPerWeek;
  const personalFromIncome = roundMoney(income - fixedTotal - reinvestment - savingsTarget);
  const spendable = roundMoney(personalFromIncome + Number(carryIn || 0));
  const weekly = {
    income: roundMoney(income / planningWeeks),
    reinvestment: roundMoney(reinvestment / planningWeeks),
    savingsTarget: roundMoney(savingsTarget / planningWeeks),
    fixedCosts: roundMoney(fixedTotal / planningWeeks),
    personalSpending: roundMoney(personalFromIncome / planningWeeks),
  };
  const perPayingDay = {
    income: roundMoney(income / payoutDays),
    reinvestment: roundMoney(reinvestment / payoutDays),
    savingsTarget: roundMoney(savingsTarget / payoutDays),
    fixedCosts: roundMoney(fixedTotal / payoutDays),
    personalSpending: roundMoney(personalFromIncome / payoutDays),
  };
  return {
    income,
    housing,
    recurringTotal,
    fixedTotal,
    reinvestment,
    savingsTarget,
    planningWeeks,
    payoutDaysPerWeek,
    payoutDays,
    personalFromIncome,
    carryIn: roundMoney(carryIn),
    spendable,
    weekly,
    perPayingDay,
    overAllocated: personalFromIncome < -0.005,
  };
}

function anchorDate(data = {}) {
  const value = String(data?.planSettings?.financialCycleAnchorDate || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function cycleBoundsForMonth(data, monthKey) {
  const anchor = anchorDate(data);
  if (anchor) return financialCycleBoundsForMonth(monthKey, anchor);
  return { start: `${monthKey}-01`, end: `${monthKey}-${String(daysInMonth(monthKey)).padStart(2, '0')}`, nextStart: `${nextMonthKey(monthKey)}-01`, cycleMonth: monthKey, anchorDay: 1 };
}

export function cycleBoundsForDate(data, dateKey) {
  const anchor = anchorDate(data);
  if (anchor) return financialCycleBounds(dateKey, anchor);
  const monthKey = dateKey.slice(0, 7);
  return cycleBoundsForMonth(data, monthKey);
}

export function trackingSettings(cfg = {}, monthKey, spendable = 0) {
  const dim = daysInMonth(monthKey);
  const parsedDay = Number(cfg?.trackingStartDay || 1);
  const startDay = Math.min(dim, Math.max(1, Number.isFinite(parsedDay) ? Math.trunc(parsedDay) : 1));
  const startMode = cfg?.trackingStartMode === 'actual' ? 'actual' : 'fresh';
  const priorNetSpending = roundMoney(Number(cfg?.priorNetSpending || 0));
  const baseExact = Number(spendable || 0) / dim;
  const openingAdjustment = startDay <= 1
    ? 0
    : startMode === 'actual'
      ? priorNetSpending
      : roundMoney(baseExact * (startDay - 1));
  return { startDay, startMode, priorNetSpending, openingAdjustment };
}

function cycleTrackingSettings(cfg = {}, bounds, spendable = 0) {
  const dim = daysInclusive(bounds.start, bounds.end);
  let startDate = String(cfg?.trackingStartDate || '');
  if (!dateInRange(startDate, bounds.start, bounds.end)) {
    const legacyDay = Number(cfg?.trackingStartDay || 0);
    const legacyDate = legacyDay > 0 ? `${bounds.cycleMonth}-${String(legacyDay).padStart(2, '0')}` : '';
    startDate = dateInRange(legacyDate, bounds.start, bounds.end) ? legacyDate : bounds.start;
  }
  const startIndex = daysInclusive(bounds.start, startDate);
  const startMode = cfg?.trackingStartMode === 'actual' ? 'actual' : 'fresh';
  const priorNetSpending = roundMoney(Number(cfg?.priorNetSpending || 0));
  const baseExact = Number(spendable || 0) / Math.max(1, dim);
  const openingAdjustment = startIndex <= 1
    ? 0
    : startMode === 'actual'
      ? priorNetSpending
      : roundMoney(baseExact * (startIndex - 1));
  return { startDate, startIndex, startMode, priorNetSpending, openingAdjustment };
}

function trackedEntryTotalsRange(data, startDate, endDate) {
  let grossSpent = 0;
  let refunds = 0;
  for (const [date, entry] of Object.entries(data.dailySpending || {})) {
    if (!dateInRange(date, startDate, endDate)) continue;
    const amounts = dailyAmounts(entry);
    grossSpent += amounts.spent;
    refunds += amounts.refunded;
  }
  return {
    grossSpent: roundMoney(grossSpent),
    refunds: roundMoney(refunds),
    netSpent: roundMoney(grossSpent - refunds),
  };
}

function trackedEntryTotals(data, monthKey, startDay = 1) {
  let grossSpent = 0;
  let refunds = 0;
  for (const [date, entry] of Object.entries(data.dailySpending || {})) {
    if (!date.startsWith(`${monthKey}-`) || Number(date.slice(-2)) < startDay) continue;
    const amounts = dailyAmounts(entry);
    grossSpent += amounts.spent;
    refunds += amounts.refunded;
  }
  return {
    grossSpent: roundMoney(grossSpent),
    refunds: roundMoney(refunds),
    netSpent: roundMoney(grossSpent - refunds),
  };
}

export function calculateCarryInto(data, targetMonthKey) {
  const keys = Object.keys(data.months || {}).filter((key) => key < targetMonthKey).sort();
  let carry = 0;
  for (const key of keys) {
    const cfg = data.months[key];
    const bounds = cfg?.cycleStartDate && cfg?.cycleEndDate
      ? { start: cfg.cycleStartDate, end: cfg.cycleEndDate, cycleMonth: key }
      : cycleBoundsForMonth(data, key);
    if (!bounds) continue;
    const allocation = allocationBreakdown(cfg, carry);
    const tracking = cycleTrackingSettings(cfg, bounds, allocation.spendable);
    const totals = trackedEntryTotalsRange(data, tracking.startDate, bounds.end);
    carry = roundMoney(allocation.spendable - tracking.openingAdjustment - totals.netSpent);
  }
  return roundMoney(carry);
}

export function getDayNumber(dateKey) {
  return Number(dateKey.slice(-2));
}

export function spendBeforeDay(data, monthKey, dayNumber, startDay = 1) {
  let total = 0;
  for (let day = startDay; day < dayNumber; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`;
    total += dailyAmounts(data.dailySpending?.[key]).net;
  }
  return roundMoney(total);
}

export function spendThroughDay(data, monthKey, dayNumber, startDay = 1) {
  let total = 0;
  for (let day = startDay; day <= dayNumber; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`;
    total += dailyAmounts(data.dailySpending?.[key]).net;
  }
  return roundMoney(total);
}

export function dailyStatus(availableBefore, netSpent, afterBalance) {
  if (afterBalance < -0.005 || netSpent > Math.max(0, availableBefore) + 0.005) return 'red';
  if (netSpent > 0 && availableBefore > 0 && netSpent >= availableBefore * 0.9) return 'yellow';
  return 'green';
}

export function calculateDay(data, dateKey) {
  const bounds = cycleBoundsForDate(data, dateKey);
  if (!bounds) return null;
  const monthKey = bounds.cycleMonth;
  const cfg = data.months?.[monthKey];
  if (!cfg) return null;

  const day = cycleDayNumber(dateKey, bounds);
  const dim = daysInclusive(bounds.start, bounds.end);
  if (day < 1 || day > dim) return null;

  const carryIn = calculateCarryInto(data, monthKey);
  const allocation = allocationBreakdown(cfg, carryIn);
  const { recurringTotal, fixedTotal, spendable } = allocation;
  const baseExact = spendable / Math.max(1, dim);
  const baseDaily = roundMoney(baseExact);
  const tracking = cycleTrackingSettings(cfg, bounds, spendable);

  if (dateKey < tracking.startDate) {
    return {
      monthKey,
      cycleStartDate: bounds.start,
      cycleEndDate: bounds.end,
      day,
      daysInMonth: dim,
      daysInCycle: dim,
      carryIn,
      recurringTotal,
      fixedTotal,
      savingsTarget: allocation.savingsTarget,
      spendable,
      baseDaily,
      trackingStarted: false,
      trackingStartDay: tracking.startIndex,
      trackingStartDate: tracking.startDate,
      trackingStartMode: tracking.startMode,
      openingAdjustment: tracking.openingAdjustment,
      beforeSpend: tracking.openingAdjustment,
      rawAvailable: 0,
      availableToday: 0,
      spentToday: 0,
      refundedToday: 0,
      netToday: 0,
      afterTodayBalance: 0,
      recoveryDays: 0,
      tomorrowRaw: null,
      tomorrowAvailable: null,
      status: 'neutral',
    };
  }

  const dayBefore = new Date(`${dateKey}T12:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const dayBeforeKey = dayBefore.toISOString().slice(0, 10);
  const trackedBefore = dayBeforeKey >= tracking.startDate ? trackedEntryTotalsRange(data, tracking.startDate, dayBeforeKey).netSpent : 0;
  const beforeSpend = roundMoney(tracking.openingAdjustment + trackedBefore);
  const availableBefore = roundMoney(baseExact * day - beforeSpend);
  const amounts = dailyAmounts(data.dailySpending?.[dateKey]);
  const afterBalance = roundMoney(availableBefore - amounts.net);
  const recoveryDays = baseExact > 0 && afterBalance < 0 ? Math.ceil(Math.abs(afterBalance) / baseExact) : 0;
  const trackedThrough = trackedEntryTotalsRange(data, tracking.startDate, dateKey).netSpent;
  const tomorrowRaw = dateKey < bounds.end
    ? roundMoney(baseExact * (day + 1) - tracking.openingAdjustment - trackedThrough)
    : null;

  return {
    monthKey,
    cycleStartDate: bounds.start,
    cycleEndDate: bounds.end,
    day,
    daysInMonth: dim,
    daysInCycle: dim,
    carryIn,
    recurringTotal,
    fixedTotal,
    savingsTarget: allocation.savingsTarget,
    spendable,
    baseDaily,
    trackingStarted: true,
    trackingStartDay: tracking.startIndex,
    trackingStartDate: tracking.startDate,
    trackingStartMode: tracking.startMode,
    openingAdjustment: tracking.openingAdjustment,
    beforeSpend,
    rawAvailable: availableBefore,
    availableToday: Math.max(0, availableBefore),
    spentToday: amounts.spent,
    refundedToday: amounts.refunded,
    netToday: amounts.net,
    afterTodayBalance: afterBalance,
    recoveryDays,
    tomorrowRaw,
    tomorrowAvailable: tomorrowRaw == null ? null : Math.max(0, tomorrowRaw),
    status: dailyStatus(availableBefore, amounts.net, afterBalance),
  };
}

export function calculateMonth(data, monthKey) {
  const cfg = data.months?.[monthKey];
  const carryIn = calculateCarryInto(data, monthKey);
  const bounds = cfg?.cycleStartDate && cfg?.cycleEndDate
    ? { start: cfg.cycleStartDate, end: cfg.cycleEndDate, cycleMonth: monthKey }
    : cycleBoundsForMonth(data, monthKey);
  const dim = bounds ? daysInclusive(bounds.start, bounds.end) : daysInMonth(monthKey);
  if (!cfg) {
    const totals = trackedEntryTotals(data, monthKey, 1);
    return {
      configured: false,
      monthKey,
      cycleStartDate: bounds?.start || `${monthKey}-01`,
      cycleEndDate: bounds?.end || `${monthKey}-${String(daysInMonth(monthKey)).padStart(2, '0')}`,
      carryIn,
      income: 0,
      housing: 0,
      recurringTotal: 0,
      fixedTotal: 0,
      reinvestment: 0,
      savingsTarget: 0,
      spendable: carryIn,
      spent: totals.netSpent,
      grossSpent: totals.grossSpent,
      refunds: totals.refunds,
      trackedNetSpent: totals.netSpent,
      openingAdjustment: 0,
      remaining: roundMoney(carryIn - totals.netSpent),
      endingCarry: roundMoney(carryIn - totals.netSpent),
      baseDaily: 0,
      daysInMonth: dim,
      daysInCycle: dim,
      trackingStartDay: 1,
      trackingStartMode: 'fresh',
      allocation: allocationBreakdown({}, carryIn),
    };
  }

  const allocation = allocationBreakdown(cfg, carryIn);
  const { recurringTotal, housing, fixedTotal, income, reinvestment, savingsTarget, spendable } = allocation;
  const tracking = cycleTrackingSettings(cfg, bounds, spendable);
  const totals = trackedEntryTotalsRange(data, tracking.startDate, bounds.end);
  const effectiveUsed = roundMoney(tracking.openingAdjustment + totals.netSpent);

  return {
    configured: true,
    monthKey,
    cycleStartDate: bounds.start,
    cycleEndDate: bounds.end,
    carryIn,
    income,
    housing,
    recurringTotal,
    fixedTotal,
    reinvestment,
    savingsTarget,
    spendable,
    spent: effectiveUsed,
    grossSpent: totals.grossSpent,
    refunds: totals.refunds,
    trackedNetSpent: totals.netSpent,
    openingAdjustment: tracking.openingAdjustment,
    remaining: roundMoney(spendable - effectiveUsed),
    endingCarry: roundMoney(spendable - effectiveUsed),
    baseDaily: roundMoney(spendable / Math.max(1, dim)),
    daysInMonth: dim,
    daysInCycle: dim,
    trackingStartDay: tracking.startIndex,
    trackingStartDate: tracking.startDate,
    trackingStartMode: tracking.startMode,
    priorNetSpending: tracking.priorNetSpending,
    expenses: cfg.expenses || [],
    allocation,
  };
}

export function suggestedMonthValues(data, monthKey) {
  const existing = data.months?.[monthKey];
  if (existing) return structuredClone(existing);
  const previousKeys = Object.keys(data.months || {}).filter((key) => key < monthKey).sort();
  const previous = previousKeys.length ? data.months[previousKeys.at(-1)] : null;
  const bounds = cycleBoundsForMonth(data, monthKey);
  return {
    income: Number(previous?.income || 0),
    housing: Number(previous?.housing || 0),
    reinvestment: Number(previous?.reinvestment || 0),
    savingsTarget: Number(previous?.savingsTarget || 0),
    planningWeeks: Number(previous?.planningWeeks || 4),
    payoutDaysPerWeek: Number(previous?.payoutDaysPerWeek || 5),
    expenses: structuredClone((data.recurringExpenses?.length ? data.recurringExpenses : previous?.expenses) || []),
    cycleStartDate: bounds?.start,
    cycleEndDate: bounds?.end,
    trackingStartDate: bounds?.start,
    trackingStartDay: Number(bounds?.start?.slice(-2) || 1),
    trackingStartMode: 'fresh',
    priorNetSpending: 0,
  };
}

export function calendarCells(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const dim = daysInMonth(monthKey);
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= dim; day += 1) cells.push(`${monthKey}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

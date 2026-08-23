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
    const fixed = Number(cfg.housing || 0) + sumExpenses(cfg.expenses || []);
    const spendable = roundMoney(Number(cfg.income || 0) - fixed - Number(cfg.reinvestment || 0) + carry);
    const tracking = trackingSettings(cfg, key, spendable);
    const totals = trackedEntryTotals(data, key, tracking.startDay);
    carry = roundMoney(spendable - tracking.openingAdjustment - totals.netSpent);
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
  const monthKey = dateKey.slice(0, 7);
  const cfg = data.months?.[monthKey];
  if (!cfg) return null;

  const day = getDayNumber(dateKey);
  const dim = daysInMonth(monthKey);
  if (day < 1 || day > dim) return null;

  const carryIn = calculateCarryInto(data, monthKey);
  const recurringTotal = sumExpenses(cfg.expenses || []);
  const fixedTotal = roundMoney(Number(cfg.housing || 0) + recurringTotal);
  const spendable = roundMoney(Number(cfg.income || 0) - fixedTotal - Number(cfg.reinvestment || 0) + carryIn);
  const baseExact = spendable / dim;
  const baseDaily = roundMoney(baseExact);
  const tracking = trackingSettings(cfg, monthKey, spendable);

  if (day < tracking.startDay) {
    return {
      monthKey,
      day,
      daysInMonth: dim,
      carryIn,
      recurringTotal,
      fixedTotal,
      spendable,
      baseDaily,
      trackingStarted: false,
      trackingStartDay: tracking.startDay,
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

  const trackedBefore = spendBeforeDay(data, monthKey, day, tracking.startDay);
  const beforeSpend = roundMoney(tracking.openingAdjustment + trackedBefore);
  const availableBefore = roundMoney(baseExact * day - beforeSpend);
  const amounts = dailyAmounts(data.dailySpending?.[dateKey]);
  const afterBalance = roundMoney(availableBefore - amounts.net);
  const recoveryDays = baseExact > 0 && afterBalance < 0 ? Math.ceil(Math.abs(afterBalance) / baseExact) : 0;
  const trackedThrough = spendThroughDay(data, monthKey, day, tracking.startDay);
  const tomorrowRaw = day < dim
    ? roundMoney(baseExact * (day + 1) - tracking.openingAdjustment - trackedThrough)
    : null;

  return {
    monthKey,
    day,
    daysInMonth: dim,
    carryIn,
    recurringTotal,
    fixedTotal,
    spendable,
    baseDaily,
    trackingStarted: true,
    trackingStartDay: tracking.startDay,
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
  const dim = daysInMonth(monthKey);
  if (!cfg) {
    const totals = trackedEntryTotals(data, monthKey, 1);
    return {
      configured: false,
      monthKey,
      carryIn,
      income: 0,
      housing: 0,
      recurringTotal: 0,
      fixedTotal: 0,
      reinvestment: 0,
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
      trackingStartDay: 1,
      trackingStartMode: 'fresh',
    };
  }

  const recurringTotal = sumExpenses(cfg.expenses || []);
  const housing = roundMoney(Number(cfg.housing || 0));
  const fixedTotal = roundMoney(housing + recurringTotal);
  const income = roundMoney(Number(cfg.income || 0));
  const reinvestment = roundMoney(Number(cfg.reinvestment || 0));
  const spendable = roundMoney(income - fixedTotal - reinvestment + carryIn);
  const tracking = trackingSettings(cfg, monthKey, spendable);
  const totals = trackedEntryTotals(data, monthKey, tracking.startDay);
  const effectiveUsed = roundMoney(tracking.openingAdjustment + totals.netSpent);

  return {
    configured: true,
    monthKey,
    carryIn,
    income,
    housing,
    recurringTotal,
    fixedTotal,
    reinvestment,
    spendable,
    spent: effectiveUsed,
    grossSpent: totals.grossSpent,
    refunds: totals.refunds,
    trackedNetSpent: totals.netSpent,
    openingAdjustment: tracking.openingAdjustment,
    remaining: roundMoney(spendable - effectiveUsed),
    endingCarry: roundMoney(spendable - effectiveUsed),
    baseDaily: roundMoney(spendable / dim),
    daysInMonth: dim,
    trackingStartDay: tracking.startDay,
    trackingStartMode: tracking.startMode,
    priorNetSpending: tracking.priorNetSpending,
    expenses: cfg.expenses || [],
  };
}

export function suggestedMonthValues(data, monthKey) {
  const existing = data.months?.[monthKey];
  if (existing) return structuredClone(existing);
  const previousKeys = Object.keys(data.months || {}).filter((key) => key < monthKey).sort();
  const previous = previousKeys.length ? data.months[previousKeys.at(-1)] : null;
  return {
    income: Number(previous?.income || 0),
    housing: Number(previous?.housing || 0),
    reinvestment: Number(previous?.reinvestment || 0),
    expenses: structuredClone((data.recurringExpenses?.length ? data.recurringExpenses : previous?.expenses) || []),
    trackingStartDay: 1,
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

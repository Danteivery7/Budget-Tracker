import { calculateDay, calculateMonth, roundMoney } from './engine.js';
import { analyzePurchase } from './purchase-engine.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateFromKey(key) {
  if (!DATE_RE.test(String(key || ''))) throw new Error('A valid date is required.');
  const [year, month, day] = key.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) throw new Error('A valid date is required.');
  return value;
}

function keyFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(key, days) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return keyFromDate(date);
}

function daysBetween(start, end) {
  return Math.max(0, Math.round((dateFromKey(end) - dateFromKey(start)) / 86_400_000));
}

function minDate(a, b) {
  return String(a) <= String(b) ? String(a) : String(b);
}

export function dateKeyInTimeZone(timeZone = 'UTC', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function weekBounds(dateKey) {
  const date = dateFromKey(dateKey);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = addDays(dateKey, mondayOffset);
  return { start, end:addDays(start, 6) };
}

export function buildAssistantSnapshot(state, dateKey) {
  const day = calculateDay(state, dateKey);
  if (!day) {
    return {
      ready:false,
      date:dateKey,
      reason:'The active financial cycle has not been configured for this date.',
    };
  }
  const cycle = calculateMonth(state, day.monthKey);
  if (!cycle?.configured) {
    return {
      ready:false,
      date:dateKey,
      reason:'The active financial cycle has not been configured for this date.',
    };
  }

  const week = weekBounds(dateKey);
  const effectiveWeekEnd = minDate(week.end, day.cycleEndDate);
  const futureWeekDays = daysBetween(dateKey, effectiveWeekEnd);
  const todayRemaining = roundMoney(Math.max(0, day.afterTodayBalance));
  const cycleRemaining = roundMoney(Math.max(0, cycle.remaining));
  const exactDailyRate = Number(cycle.spendable || 0) / Math.max(1, Number(day.daysInCycle || cycle.daysInCycle || 1));
  const weekRemaining = roundMoney(Math.min(cycleRemaining, Math.max(0, todayRemaining + exactDailyRate * futureWeekDays)));

  return {
    ready:true,
    date:dateKey,
    cycleMonth:day.monthKey,
    cycleStartDate:day.cycleStartDate,
    cycleEndDate:day.cycleEndDate,
    dayNumber:day.day,
    daysInCycle:day.daysInCycle,
    today:{
      baseAllowance:roundMoney(day.baseDaily),
      spent:roundMoney(day.spentToday),
      refunds:roundMoney(day.refundedToday),
      netSpent:roundMoney(day.netToday),
      remaining:todayRemaining,
      status:day.status,
    },
    week:{
      start:week.start,
      end:effectiveWeekEnd,
      remaining:weekRemaining,
    },
    cycle:{
      spendable:roundMoney(cycle.spendable),
      spent:roundMoney(cycle.spent),
      remaining:cycleRemaining,
      income:roundMoney(cycle.income),
      fixedCosts:roundMoney(cycle.fixedTotal),
    },
    protected:{
      businessReinvestmentTarget:roundMoney(cycle.reinvestment),
      loanSavingsTarget:roundMoney(cycle.savingsTarget),
    },
  };
}

function recommendationFor(result, snapshot) {
  if (result.status === 'unfunded' || result.status === 'loan-risk') return 'no';
  if (result.status === 'business-impact') return 'wait';
  if (result.cost <= snapshot.today.remaining + 0.005) return 'yes';
  if (result.cost <= snapshot.week.remaining + 0.005) return 'yes_with_week_impact';
  return 'wait';
}

export function analyzeAssistantPurchase(state, { amount = 0, item = '', dateKey } = {}) {
  const price = roundMoney(Math.max(0, Number(amount || 0)));
  if (!Number.isFinite(price) || price <= 0) throw new Error('Purchase amount must be greater than zero.');
  const snapshot = buildAssistantSnapshot(state, dateKey);
  if (!snapshot.ready) return { snapshot, purchase:null, recommendation:'not_ready' };

  const result = analyzePurchase({
    price,
    personalAvailable:snapshot.cycle.remaining,
    reinvestmentTarget:snapshot.protected.businessReinvestmentTarget,
    savingsTarget:snapshot.protected.loanSavingsTarget,
  });
  const personalImpact = result.fromPersonal;
  return {
    snapshot,
    purchase:{
      item:String(item || '').trim().slice(0, 200) || 'Purchase',
      amount:price,
      status:result.status,
      fullyFunded:result.fullyFunded,
      fromPersonal:result.fromPersonal,
      fromBusiness:result.fromBusiness,
      fromLoanSavings:result.fromSavings,
      todayRemainingAfter:roundMoney(snapshot.today.remaining - personalImpact),
      weekRemainingAfter:roundMoney(snapshot.week.remaining - personalImpact),
      cycleRemainingAfter:roundMoney(result.personalAfter),
      businessTargetAfter:roundMoney(result.businessAfter),
      loanSavingsTargetAfter:roundMoney(result.savingsAfter),
    },
    recommendation:recommendationFor(result, snapshot),
  };
}

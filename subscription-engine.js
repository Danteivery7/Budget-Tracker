const DAY_MS = 86_400_000;

export const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function normalizeMerchant(value = '') {
  return String(value)
    .toUpperCase()
    .replace(/\b(PAYPAL|SQ|TST)\s*\*\s*/g, '')
    .replace(/\b(WWW\.|\.COM\b)/g, ' ')
    .replace(/[#*_]/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function monthlyReserveForCadence(frequency, occurrenceAmount) {
  const amount = Number(occurrenceAmount || 0);
  if (!(amount > 0)) return 0;
  if (frequency === 'weekly') return roundMoney(amount * 52 / 12);
  if (frequency === 'biweekly') return roundMoney(amount * 26 / 12);
  if (frequency === 'quarterly') return roundMoney(amount / 3);
  if (frequency === 'annual') return roundMoney(amount / 12);
  return roundMoney(amount);
}

function hashKey(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function dateMs(value) {
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function frequencyFromGaps(gaps) {
  const gap = median(gaps);
  if (gap >= 6 && gap <= 9) return { frequency: 'weekly', days: 7 };
  if (gap >= 12 && gap <= 17) return { frequency: 'biweekly', days: 14 };
  if (gap >= 25 && gap <= 35) return { frequency: 'monthly', days: 30 };
  if (gap >= 80 && gap <= 100) return { frequency: 'quarterly', days: 91 };
  if (gap >= 330 && gap <= 400) return { frequency: 'annual', days: 365 };
  return null;
}

function nextDate(lastDate, frequency) {
  const [year, month, day] = String(lastDate).split('-').map(Number);
  if (!year || !month || !day) return '';
  if (frequency === 'monthly') {
    const lastOfNext = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, lastOfNext))).toISOString().slice(0, 10);
  }
  const days = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : frequency === 'quarterly' ? 91 : 365;
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function candidateType(rows) {
  const hints = rows.map((row) => `${row.kindHint || ''} ${row.category || ''}`.toLowerCase()).join(' ');
  if (/subscription|stream|software|membership|digital/.test(hints)) return 'subscription';
  if (/utility|insurance|rent|mortgage|phone|internet|bill/.test(hints)) return 'bill';
  return 'subscription';
}

export function detectRecurringCharges(transactions = [], previousCandidates = []) {
  const groups = new Map();
  for (const row of transactions) {
    const amount = Number(row?.amount || 0);
    const date = String(row?.date || '');
    const merchant = String(row?.merchantName || row?.name || '').trim();
    const canonical = normalizeMerchant(merchant);
    if (!canonical || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dateMs(date))) continue;
    const sourceAccount = String(row?.accountId || row?.paymentMethodId || 'unassigned');
    const key = `${canonical}|${sourceAccount}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, merchantName: merchant, amount: roundMoney(amount), date });
  }

  const previous = new Map(previousCandidates.map((item) => [item.matchKey, item]));
  const found = [];
  for (const [baseKey, rows] of groups.entries()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = [];
    for (let i = 1; i < rows.length; i += 1) gaps.push(Math.round((dateMs(rows[i].date) - dateMs(rows[i - 1].date)) / DAY_MS));
    const cadence = frequencyFromGaps(gaps);
    if (!cadence) continue;

    const amounts = rows.map((row) => row.amount);
    const averageAmount = roundMoney(amounts.reduce((sum, value) => sum + value, 0) / amounts.length);
    const maxDeviation = Math.max(...amounts.map((value) => Math.abs(value - averageAmount)));
    const allowedDeviation = Math.max(2, averageAmount * 0.2);
    if (maxDeviation > allowedDeviation) continue;

    const matchKey = `${baseKey}|${cadence.frequency}`;
    const prior = previous.get(matchKey);
    const last = rows.at(-1);
    const first = rows[0];
    const dayValues = rows.map((row) => Number(row.date.slice(-2)));
    const daySpread = Math.max(...dayValues) - Math.min(...dayValues);
    const amountStability = averageAmount ? Math.max(0, 1 - maxDeviation / averageAmount) : 0;
    const cadenceBonus = rows.length >= 3 ? 0.12 : 0;
    const dateBonus = cadence.frequency === 'monthly' && daySpread <= 4 ? 0.08 : 0;
    const confidence = Math.min(0.99, roundMoney(0.68 + cadenceBonus + dateBonus + amountStability * 0.1));

    found.push({
      id: prior?.id || `rc_${hashKey(matchKey)}`,
      matchKey,
      status: prior?.status || 'pending',
      recurringExpenseId: prior?.recurringExpenseId || '',
      merchantName: last.merchantName || first.merchantName,
      canonicalMerchant: normalizeMerchant(last.merchantName || first.merchantName),
      suggestedType: prior?.suggestedType || candidateType(rows),
      frequency: cadence.frequency,
      averageAmount,
      monthlyReserveAmount: monthlyReserveForCadence(cadence.frequency, averageAmount),
      lastAmount: last.amount,
      firstDate: first.date,
      lastDate: last.date,
      predictedNextDate: nextDate(last.date, cadence.frequency),
      chargeDay: Number(last.date.slice(-2)),
      confidence,
      occurrenceCount: rows.length,
      transactionIds: rows.map((row) => String(row.sourceTransactionId || row.id || '')).filter(Boolean),
      accountId: String(last.accountId || ''),
      paymentMethodId: String(last.paymentMethodId || prior?.paymentMethodId || ''),
      category: String(last.category || prior?.category || ''),
      reviewedAt: prior?.reviewedAt || null,
      createdAt: prior?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  for (const prior of previousCandidates) {
    if (!found.some((item) => item.id === prior.id) && prior.status !== 'pending') found.push({ ...prior });
  }
  return found.sort((a, b) => b.confidence - a.confidence || b.lastDate.localeCompare(a.lastDate));
}

export function matchConfirmedRecurring(transaction, candidates = []) {
  const canonical = normalizeMerchant(transaction?.merchantName || transaction?.name || '');
  const accountId = String(transaction?.accountId || transaction?.paymentMethodId || '');
  const amount = Number(transaction?.amount || 0);
  const matches = candidates.filter((candidate) => {
    if (candidate.status !== 'confirmed' || !candidate.recurringExpenseId) return false;
    if (candidate.canonicalMerchant !== canonical) return false;
    if (candidate.accountId && accountId && candidate.accountId !== accountId) return false;
    const tolerance = Math.max(3, Number(candidate.averageAmount || 0) * 0.25);
    return Math.abs(amount - Number(candidate.averageAmount || 0)) <= tolerance;
  });
  if (!matches.length) return null;
  matches.sort((a, b) => Math.abs(amount - a.averageAmount) - Math.abs(amount - b.averageAmount));
  return { classification: 'planned_recurring', recurringExpenseId: matches[0].recurringExpenseId, candidateId: matches[0].id };
}

export function buildSubscriptionRoutingSummary(state = {}) {
  const cards = Array.isArray(state.paymentMethods) ? state.paymentMethods : [];
  const expenses = Array.isArray(state.recurringExpenses) ? state.recurringExpenses : [];
  const meta = state.recurringPaymentMeta || {};
  const cardMap = new Map(cards.map((card) => [card.id, card]));
  const byPaymentMethod = new Map();
  let recurringTotal = 0;
  let unassignedTotal = 0;
  let checkingAutopayRequirement = 0;
  let directDebitRequirement = 0;

  for (const expense of expenses) {
    const payment = meta[expense.id] || {};
    if (payment.active === false) continue;
    const amount = roundMoney(expense.amount);
    recurringTotal += amount;
    const card = cardMap.get(payment.paymentMethodId);
    if (!card) {
      unassignedTotal += amount;
      continue;
    }
    const current = byPaymentMethod.get(card.id) || { paymentMethodId: card.id, name: card.name, type: card.type, last4: card.last4, autopayDay: card.autopayDay, total: 0, count: 0 };
    current.total = roundMoney(current.total + amount);
    current.count += 1;
    byPaymentMethod.set(card.id, current);
    if (card.type === 'credit') checkingAutopayRequirement += amount;
    else directDebitRequirement += amount;
  }

  return {
    recurringTotal: roundMoney(recurringTotal),
    unassignedTotal: roundMoney(unassignedTotal),
    checkingAutopayRequirement: roundMoney(checkingAutopayRequirement),
    directDebitRequirement: roundMoney(directDebitRequirement),
    paymentMethods: [...byPaymentMethod.values()].sort((a, b) => b.total - a.total),
    pendingCandidates: (state.subscriptionCandidates || []).filter((item) => item.status === 'pending').length,
    confirmedCandidates: (state.subscriptionCandidates || []).filter((item) => item.status === 'confirmed').length,
  };
}

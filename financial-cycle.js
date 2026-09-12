const DAY_MS = 86_400_000;

const pad = (value) => String(value).padStart(2, '0');

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, date };
}

export function dateKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function daysInCalendarMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function anchorDateForMonth(year, month, anchorDay) {
  const safeDay = Math.min(Math.max(1, Number(anchorDay || 1)), daysInCalendarMonth(year, month));
  return `${year}-${pad(month)}-${pad(safeDay)}`;
}

export function addMonthsAnchor(startDate, months, anchorDay) {
  const parsed = parseDateKey(startDate);
  if (!parsed) throw new Error('Invalid cycle start date.');
  const serial = parsed.year * 12 + (parsed.month - 1) + Number(months || 0);
  const year = Math.floor(serial / 12);
  const month = (serial % 12 + 12) % 12 + 1;
  return anchorDateForMonth(year, month, anchorDay);
}

export function previousDate(value) {
  const parsed = parseDateKey(value);
  if (!parsed) throw new Error('Invalid date.');
  parsed.date.setUTCDate(parsed.date.getUTCDate() - 1);
  return dateKey(parsed.date);
}

export function nextDate(value) {
  const parsed = parseDateKey(value);
  if (!parsed) throw new Error('Invalid date.');
  parsed.date.setUTCDate(parsed.date.getUTCDate() + 1);
  return dateKey(parsed.date);
}

export function financialCycleStartForDate(value, anchorDate) {
  const target = parseDateKey(value);
  const anchor = parseDateKey(anchorDate);
  if (!target || !anchor) return null;
  if (value < anchorDate) return null;
  const candidate = anchorDateForMonth(target.year, target.month, anchor.day);
  if (value >= candidate) return candidate < anchorDate ? anchorDate : candidate;
  const serial = target.year * 12 + (target.month - 1) - 1;
  const year = Math.floor(serial / 12);
  const month = (serial % 12 + 12) % 12 + 1;
  const previous = anchorDateForMonth(year, month, anchor.day);
  return previous < anchorDate ? anchorDate : previous;
}

export function financialCycleBounds(value, anchorDate) {
  const start = financialCycleStartForDate(value, anchorDate);
  if (!start) return null;
  const anchor = parseDateKey(anchorDate);
  const nextStart = addMonthsAnchor(start, 1, anchor.day);
  return {
    start,
    end: previousDate(nextStart),
    nextStart,
    cycleMonth: start.slice(0, 7),
    anchorDay: anchor.day,
  };
}

export function financialCycleBoundsForMonth(monthKey, anchorDate) {
  const anchor = parseDateKey(anchorDate);
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!anchor || !match) return null;
  const start = anchorDateForMonth(Number(match[1]), Number(match[2]), anchor.day);
  if (start < anchorDate) return null;
  const nextStart = addMonthsAnchor(start, 1, anchor.day);
  return { start, end: previousDate(nextStart), nextStart, cycleMonth: monthKey, anchorDay: anchor.day };
}

export function daysInclusive(start, end) {
  const a = parseDateKey(start);
  const b = parseDateKey(end);
  if (!a || !b) return 0;
  return Math.floor((b.date - a.date) / DAY_MS) + 1;
}

export function cycleDayNumber(value, bounds) {
  if (!bounds || value < bounds.start || value > bounds.end) return 0;
  return daysInclusive(bounds.start, value);
}

export function dateInRange(value, start, end) {
  return Boolean(value && start && end && value >= start && value <= end);
}

export function mondayWeekStart(value) {
  const parsed = parseDateKey(value);
  if (!parsed) return null;
  const dow = parsed.date.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  parsed.date.setUTCDate(parsed.date.getUTCDate() - back);
  return dateKey(parsed.date);
}

export function financialWeekContext(value, anchorDate, payoutDaysPerWeek = 5) {
  const parsed = parseDateKey(value);
  const anchor = parseDateKey(anchorDate);
  if (!parsed || !anchor || value < anchorDate) return null;
  const monday = mondayWeekStart(value);
  const firstMonday = mondayWeekStart(anchorDate);
  const isFirstPartialWeek = monday === firstMonday && anchorDate > monday;
  const weekStart = isFirstPartialWeek ? anchorDate : monday;
  const weekEndDate = parseDateKey(monday).date;
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  const weekEnd = dateKey(weekEndDate);
  const payingWeekdays = [];
  let cursor = parseDateKey(weekStart).date;
  const end = parseDateKey(weekEnd).date;
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow >= 1 && dow <= Math.min(5, Number(payoutDaysPerWeek || 5))) payingWeekdays.push(dateKey(cursor));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return { weekStart, weekEnd, isFirstPartialWeek, payingWeekdays, payingDayCount: payingWeekdays.length };
}

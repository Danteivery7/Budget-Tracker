export function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function millisecondsUntilNextLocalDay(date = new Date(), graceMs = 250) {
  const next = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
    0,
    0,
    0,
    Math.max(0, Number(graceMs) || 0),
  );
  return Math.max(50, next.getTime() - date.getTime());
}

export function shouldRollToNewDay(previousDateKey, date = new Date()) {
  return String(previousDateKey || '') !== localDateKey(date);
}

export function startDateRollover({
  now = () => new Date(),
  reload = () => window.location.reload(),
  windowRef = typeof window === 'undefined' ? null : window,
  documentRef = typeof document === 'undefined' ? null : document,
} = {}) {
  if (!windowRef || !documentRef) return () => {};

  let activeDateKey = localDateKey(now());
  let timer = null;
  let reloading = false;

  const clearTimer = () => {
    if (timer != null) windowRef.clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clearTimer();
    if (reloading) return;
    const delay = Math.min(millisecondsUntilNextLocalDay(now()), 2_147_000_000);
    timer = windowRef.setTimeout(checkDate, delay);
  };

  const checkDate = () => {
    if (reloading) return true;
    const current = now();
    if (shouldRollToNewDay(activeDateKey, current)) {
      reloading = true;
      activeDateKey = localDateKey(current);
      clearTimer();
      reload();
      return true;
    }
    schedule();
    return false;
  };

  const onVisible = () => {
    if (documentRef.visibilityState === 'visible') checkDate();
  };

  windowRef.addEventListener('pageshow', checkDate);
  windowRef.addEventListener('focus', checkDate);
  windowRef.addEventListener('online', checkDate);
  documentRef.addEventListener('visibilitychange', onVisible);
  schedule();

  return () => {
    clearTimer();
    windowRef.removeEventListener('pageshow', checkDate);
    windowRef.removeEventListener('focus', checkDate);
    windowRef.removeEventListener('online', checkDate);
    documentRef.removeEventListener('visibilitychange', onVisible);
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') startDateRollover();

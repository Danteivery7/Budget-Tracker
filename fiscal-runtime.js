import { calculateDay, calculateMonth } from './engine.js';
import { financialCycleBounds, financialWeekContext, nextDate } from './financial-cycle.js';

const nativeFetch = window.fetch.bind(window);
const pad = (value) => String(value).padStart(2, '0');
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const money = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const pretty = (dateKey) => {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(y, m - 1, d));
};

function getState() {
  try { return JSON.parse(localStorage.getItem('budget_tracker_last_state') || 'null'); } catch { return null; }
}

function cycle(state = getState(), date = localDate()) {
  const anchor = state?.planSettings?.financialCycleAnchorDate;
  return anchor ? financialCycleBounds(date, anchor) : null;
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  let nextInit = init;
  if (typeof init?.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      const state = getState();
      const today = localDate();
      if (url.includes('/api/budget/mutate') && body?.action === 'saveMonth' && !state?.planSettings?.financialCycleAnchorDate && !state?.planRevisions?.length && body?.payload?.month === today.slice(0, 7)) {
        body.payload.trackingStartDay = Number(today.slice(-2));
        body.payload.trackingStartDate = today;
        body.payload.cycleStartDate = today;
        body.payload.trackingStartMode = 'fresh';
        body.payload.priorNetSpending = 0;
        nextInit = { ...init, body: JSON.stringify(body) };
      }
      if (url.includes('/api/plan/mutate') && body?.action === 'saveRevision' && state?.planSettings?.financialCycleAnchorDate) {
        const current = financialCycleBounds(today, state.planSettings.financialCycleAnchorDate);
        if (current) {
          if (body.payload?.applyToMonth === true) {
            body.payload.effectiveMonth = current.cycleMonth;
            body.payload.effectiveDate = today;
          } else {
            body.payload.effectiveMonth = current.nextStart.slice(0, 7);
            body.payload.effectiveDate = current.nextStart;
          }
          nextInit = { ...init, body: JSON.stringify(body) };
        }
      }
    } catch { /* leave unchanged */ }
  }
  return nativeFetch(input, nextInit);
};

async function saveToday(amount, note) {
  const response = await window.fetch('/api/budget/mutate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'saveDaily', payload: { date: localDate(), amount, note } }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not save spending.');
  localStorage.setItem('budget_tracker_last_state', JSON.stringify(body.state));
  return body.state;
}

function weeklyCopy(state, today) {
  const anchor = state?.planSettings?.financialCycleAnchorDate;
  if (!anchor) return '';
  const week = financialWeekContext(today, anchor, 5);
  if (!week) return '';
  if (week.isFirstPartialWeek) {
    return `Your first week is intentionally partial: ${pretty(week.weekStart)} through ${pretty(week.weekEnd)}, with ${week.payingDayCount} paying weekday${week.payingDayCount === 1 ? '' : 's'}. Normal Monday–Friday routing begins ${pretty(nextDate(week.weekEnd))}.`;
  }
  return 'Weekly routing resets every Monday. After the initial partial week, each normal planning week uses Monday–Friday again.';
}

function renderBridgeOverview(state, bounds) {
  const view = document.querySelector('#view');
  if (!view) return;
  const today = localDate();
  const day = calculateDay(state, today);
  const period = calculateMonth(state, bounds.cycleMonth);
  if (!day || !period.configured) return;
  const entry = state.dailySpending?.[today] || {};
  const pct = period.spendable > 0 ? Math.max(0, period.spent / period.spendable * 100) : 0;
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === 'today'));
  const eyebrow = document.querySelector('#pageEyebrow');
  const title = document.querySelector('#pageTitle');
  if (eyebrow) eyebrow.textContent = 'ACTIVE FINANCIAL CYCLE';
  if (title) title.textContent = 'Your financial position';
  view.innerHTML = `
    <article id="fiscalBridgeOverview" class="card section-card" style="margin-top:0"><div class="section-head"><div><h2>${esc(pretty(bounds.start))} → ${esc(pretty(bounds.end))}</h2><p>This is one financial month. The calendar changing to ${esc(today.slice(0, 7))} does not reset income, targets, spending, or carry.</p></div><span class="status-badge neutral">Day ${day.day} of ${day.daysInCycle}</span></div><div class="callout"><span class="callout-dot"></span><div><strong>Weekly cadence</strong><span>${esc(weeklyCopy(state, today))}</span></div></div></article>
    <div class="hero-grid">
      <article class="card hero-card"><div><div class="hero-label">You can spend today</div><div class="hero-amount">${money(day.availableToday)}</div><div class="hero-sub">Base pace: <strong>${money(day.baseDaily)}/day</strong> · Financial cycle ends ${esc(pretty(bounds.end))}</div></div><div><div class="callout"><span class="callout-dot"></span><div><strong>Cycle does not reset on the 1st</strong><span>Your approved income and targets remain active until ${esc(pretty(bounds.end))}. The next cycle begins ${esc(pretty(bounds.nextStart))}.</span></div></div></div></article>
      <article class="card entry-card"><h2>${entry.amount != null ? 'Update today' : 'Log today'}</h2><p>Daily spending stays attached to this financial cycle even though it crosses a calendar-month boundary.</p><form id="fiscalTodayForm"><div class="money-input"><span>$</span><input id="fiscalTodayAmount" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(entry.amount || 0) || ''}" placeholder="0.00" required /></div><input id="fiscalTodayNote" class="entry-note" maxlength="200" value="${esc(entry.note || '')}" placeholder="Optional note"/><button class="button primary wide" type="submit">Save today</button></form></article>
    </div>
    <div class="summary-grid"><article class="card metric-card"><div class="metric-label">Cycle income target</div><div class="metric-value">${money(period.income)}</div><div class="metric-foot">${esc(pretty(bounds.start))}–${esc(pretty(bounds.end))}</div></article><article class="card metric-card"><div class="metric-label">Business reinvestment</div><div class="metric-value">${money(period.reinvestment)}</div></article><article class="card metric-card"><div class="metric-label">Loan / savings</div><div class="metric-value">${money(period.savingsTarget)}</div></article><article class="card metric-card"><div class="metric-label">Personal remaining</div><div class="metric-value">${money(period.remaining)}</div><div class="metric-foot">${money(period.spent)} used in this cycle</div></article></div>
    <article class="card section-card"><div class="section-head"><div><h2>Financial-cycle spending</h2><p>${money(period.spendable)} available across this anchored cycle.</p></div><strong>${pct.toFixed(0)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, pct)}%"></div></div></article>`;
  document.querySelector('#fiscalTodayForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const next = await saveToday(Number(document.querySelector('#fiscalTodayAmount')?.value || 0), document.querySelector('#fiscalTodayNote')?.value || '');
      renderBridgeOverview(next, cycle(next, today));
    } catch (error) {
      const toast = document.querySelector('#toast');
      if (toast) { toast.textContent = error.message; toast.className = 'toast show error'; }
    } finally { button.disabled = false; }
  });
}

function enhanceFiscalUi() {
  const state = getState();
  const today = localDate();
  const bounds = cycle(state, today);
  if (!state || !bounds) return;

  const picker = document.querySelector('#stableMonthPicker');
  if (picker && today.slice(0, 7) !== bounds.cycleMonth && picker.value === today.slice(0, 7) && !picker.dataset.fiscalAdjusted) {
    picker.dataset.fiscalAdjusted = 'true';
    picker.value = bounds.cycleMonth;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  document.querySelectorAll('[data-plan-change-nav]').forEach((button) => { button.title = `Current cycle: ${pretty(bounds.start)} – ${pretty(bounds.end)}`; });
  const timing = document.querySelectorAll('.change-choice[data-timing]');
  if (timing.length === 2) {
    timing[0].querySelector('strong')?.replaceChildren(document.createTextNode('Apply to current financial cycle'));
    timing[0].querySelector('span')?.replaceChildren(document.createTextNode(`Preserve everything already recorded in ${pretty(bounds.start)}–${pretty(bounds.end)} and recalculate the rest of this cycle.`));
    timing[1].querySelector('strong')?.replaceChildren(document.createTextNode(`Start ${pretty(bounds.nextStart)}`));
    timing[1].querySelector('span')?.replaceChildren(document.createTextNode('Leave the current cycle untouched. The new plan starts on your next fiscal boundary, not on the 1st.'));
  }

  const overviewActive = document.querySelector('[data-view="today"].active');
  if (overviewActive && today.slice(0, 7) !== bounds.cycleMonth && !document.querySelector('#fiscalBridgeOverview')) renderBridgeOverview(state, bounds);
}

const observer = new MutationObserver(() => queueMicrotask(enhanceFiscalUi));
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pageshow', enhanceFiscalUi);
setTimeout(enhanceFiscalUi, 80);

(() => {
  const nativeFetch = window.fetch.bind(window);
  let latestState = (() => {
    try { return JSON.parse(localStorage.getItem('budget_tracker_last_state') || 'null'); } catch { return null; }
  })();
  let monthPageSelected = null;
  let monthPageOpen = false;

  const pad = (n) => String(n).padStart(2, '0');
  const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  const currentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  const currentDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const daysInMonth = (monthKey) => {
    const [y, m] = String(monthKey || '').split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return 30;
    return new Date(y, m, 0).getDate();
  };
  const dateFor = (monthKey, day) => `${monthKey}-${pad(day)}`;
  const monthLabel = (monthKey) => {
    const [y, m] = String(monthKey || '').split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return String(monthKey || 'Month');
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  };
  const money = (value, sign = false) => {
    const n = Number(value || 0);
    const abs = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
    if (!sign) return n < 0 ? `-${abs}` : abs;
    if (n > 0) return `+${abs}`;
    if (n < 0) return `-${abs}`;
    return abs;
  };
  const moneyInput = (value) => {
    const n = Number(value || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  };
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const uid = () => globalThis.crypto?.randomUUID?.() || `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function saveLocalState(state) {
    latestState = state;
    try { localStorage.setItem('budget_tracker_last_state', JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  window.fetch = async (input, init = {}) => {
    const response = await nativeFetch(input, init);
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('/api/budget/state') || url.includes('/api/budget/mutate')) {
      try {
        const body = await response.clone().json();
        if (body?.state) saveLocalState(body.state);
      } catch { /* non-json or unavailable */ }
      setTimeout(enhanceNonMonthViews, 0);
    }
    return response;
  };

  function toast(message, isError = false) {
    const el = document.querySelector('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast show${isError ? ' error' : ''}`;
    setTimeout(() => { if (el.textContent === message) el.className = 'toast'; }, 3200);
  }

  function setSync(mode, text) {
    const dot = document.querySelector('#syncDot');
    const label = document.querySelector('#syncText');
    if (dot) dot.className = `sync-dot${mode === 'busy' ? ' busy' : mode === 'error' ? ' error' : ''}`;
    if (label) label.textContent = text || (mode === 'busy' ? 'Saving…' : mode === 'error' ? 'Sync issue' : 'Synced');
  }

  async function ensureState() {
    if (latestState?.months && latestState?.dailySpending && latestState?.recurringExpenses) return latestState;
    const response = await nativeFetch('/api/budget/state', { credentials: 'same-origin', cache: 'no-store' });
    let body = {};
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok || !body?.state) throw new Error(body?.error || 'Could not load your budget data.');
    saveLocalState(body.state);
    return latestState;
  }

  async function mutation(action, payload) {
    setSync('busy', 'Saving…');
    try {
      const response = await nativeFetch('/api/budget/mutate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
      let body = {};
      try { body = await response.json(); } catch { /* handled below */ }
      if (response.status === 401) throw new Error('Your session expired. Refresh and unlock the tracker again.');
      if (!response.ok || !body?.state) throw new Error(body?.error || 'Could not save the month.');
      saveLocalState(body.state);
      setSync('idle', 'Synced');
      return body.state;
    } catch (error) {
      setSync('error', 'Sync issue');
      throw error;
    }
  }

  function sumExpenses(expenses = []) {
    return round(expenses.reduce((sum, item) => sum + Number(item?.amount || 0), 0));
  }

  function dailyAmounts(entry = {}) {
    const spent = Math.max(0, Number(entry?.amount || 0));
    const refunded = Math.max(0, Number(entry?.refund || 0));
    return { spent: round(spent), refunded: round(refunded), net: round(spent - refunded) };
  }

  function trackingSettings(cfg = {}, monthKey, spendable = 0) {
    const dim = daysInMonth(monthKey);
    const raw = Number(cfg?.trackingStartDay || 1);
    const startDay = Math.min(dim, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 1));
    const startMode = cfg?.trackingStartMode === 'actual' ? 'actual' : 'fresh';
    const prior = round(Number(cfg?.priorNetSpending || 0));
    const base = Number(spendable || 0) / dim;
    const openingAdjustment = startDay <= 1 ? 0 : startMode === 'actual' ? prior : round(base * (startDay - 1));
    return { startDay, startMode, priorNetSpending: prior, openingAdjustment };
  }

  function trackedTotals(state, monthKey, startDay = 1) {
    let gross = 0;
    let refunds = 0;
    for (const [date, entry] of Object.entries(state?.dailySpending || {})) {
      if (!date.startsWith(`${monthKey}-`) || Number(date.slice(-2)) < startDay) continue;
      const a = dailyAmounts(entry);
      gross += a.spent;
      refunds += a.refunded;
    }
    return { grossSpent: round(gross), refunds: round(refunds), netSpent: round(gross - refunds) };
  }

  function carryInto(state, targetMonthKey) {
    const keys = Object.keys(state?.months || {}).filter((key) => key < targetMonthKey).sort();
    let carry = 0;
    for (const key of keys) {
      const cfg = state.months[key] || {};
      const fixed = Number(cfg.housing || 0) + sumExpenses(cfg.expenses || []);
      const spendable = round(Number(cfg.income || 0) - fixed - Number(cfg.reinvestment || 0) + carry);
      const tracking = trackingSettings(cfg, key, spendable);
      const totals = trackedTotals(state, key, tracking.startDay);
      carry = round(spendable - tracking.openingAdjustment - totals.netSpent);
    }
    return round(carry);
  }

  function suggestedMonth(state, monthKey) {
    const existing = state?.months?.[monthKey];
    if (existing) return JSON.parse(JSON.stringify(existing));
    const keys = Object.keys(state?.months || {}).filter((key) => key < monthKey).sort();
    const previous = keys.length ? state.months[keys.at(-1)] : null;
    const expenses = state?.recurringExpenses?.length ? state.recurringExpenses : (previous?.expenses || []);
    return {
      income: Number(previous?.income || 0),
      housing: Number(previous?.housing || 0),
      reinvestment: Number(previous?.reinvestment || 0),
      expenses: JSON.parse(JSON.stringify(expenses)),
      trackingStartDay: null,
      trackingStartMode: 'fresh',
      priorNetSpending: 0,
    };
  }

  function defaultStartDay(state, monthKey, cfg) {
    if (Number(cfg?.trackingStartDay) >= 1) return Number(cfg.trackingStartDay);
    const hasEntry = Object.keys(state?.dailySpending || {}).some((date) => date.startsWith(`${monthKey}-`));
    if (hasEntry) return 1;
    return monthKey === currentMonth() ? new Date().getDate() : 1;
  }

  function setMonthChrome() {
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === 'month'));
    const eyebrow = document.querySelector('#pageEyebrow');
    const title = document.querySelector('#pageTitle');
    if (eyebrow) eyebrow.textContent = 'MONTH';
    if (title) title.textContent = 'Monthly setup';
  }

  function expenseRowsHtml(expenses = []) {
    return expenses.map((item) => `
      <div class="expense-row" data-expense-id="${esc(item?.id || uid())}">
        <input data-field="name" type="text" maxlength="80" value="${esc(item?.name || '')}" placeholder="Expense name" aria-label="Expense name" />
        <input data-field="category" type="text" maxlength="40" value="${esc(item?.category || '')}" placeholder="Category" aria-label="Expense category" />
        <input data-field="amount" type="number" inputmode="decimal" min="0" step="0.01" value="${moneyInput(item?.amount)}" placeholder="0.00" aria-label="Expense amount" />
        <button class="remove-expense" type="button" aria-label="Remove expense">×</button>
      </div>`).join('');
  }

  function readExpenseRows(root) {
    return [...root.querySelectorAll('.expense-row')].map((row) => ({
      id: row.dataset.expenseId || uid(),
      name: row.querySelector('[data-field="name"]')?.value.trim() || 'Fixed expense',
      category: row.querySelector('[data-field="category"]')?.value.trim() || 'Other',
      amount: Number(row.querySelector('[data-field="amount"]')?.value || 0),
    }));
  }

  function appendExpense(root, expense = {}) {
    const holder = document.createElement('div');
    holder.innerHTML = expenseRowsHtml([{ id: uid(), name: '', category: '', amount: 0, ...expense }]);
    root.appendChild(holder.firstElementChild);
  }

  function trackingValues(monthKey) {
    const date = document.querySelector('#stableTrackingStartDate')?.value || `${monthKey}-01`;
    const day = date.startsWith(`${monthKey}-`) ? Number(date.slice(-2)) : 1;
    const modeEl = document.querySelector('#stableTrackingMode');
    const mode = day <= 1 ? 'fresh' : (modeEl?.value === 'actual' ? 'actual' : 'fresh');
    const prior = mode === 'actual' ? Number(document.querySelector('#stablePriorNet')?.value || 0) : 0;
    return { trackingStartDay: day, trackingStartMode: mode, priorNetSpending: prior };
  }

  function refreshTrackingUi(monthKey) {
    const date = document.querySelector('#stableTrackingStartDate');
    const mode = document.querySelector('#stableTrackingMode');
    const priorWrap = document.querySelector('#stablePriorWrap');
    const explanation = document.querySelector('#stableTrackingExplanation');
    if (!date || !mode || !priorWrap || !explanation) return;
    const day = Number(date.value.slice(-2) || 1);
    if (day <= 1) mode.value = 'fresh';
    mode.disabled = day <= 1;
    const actual = day > 1 && mode.value === 'actual';
    priorWrap.hidden = !actual;
    if (day <= 1) explanation.textContent = 'Tracking begins on day 1, so the month works normally from the beginning.';
    else if (actual) explanation.textContent = 'Exact start: enter your net discretionary spending from earlier in the month so the tracker reconstructs the real buffer or deficit.';
    else explanation.textContent = `Fresh start: days 1–${day - 1} are not counted as $0-spend days. Your first tracked day starts with one normal daily allowance.`;
    updateMonthPreview(monthKey);
  }

  function updateMonthPreview(monthKey) {
    const expensesEl = document.querySelector('#stableMonthExpenses');
    const preview = document.querySelector('#stableMonthPreview');
    if (!expensesEl || !preview || !latestState) return;
    const income = Number(document.querySelector('#stableIncome')?.value || 0);
    const housing = Number(document.querySelector('#stableHousing')?.value || 0);
    const reinvestment = Number(document.querySelector('#stableReinvestment')?.value || 0);
    const expenses = readExpenseRows(expensesEl);
    const other = sumExpenses(expenses);
    const carry = carryInto(latestState, monthKey);
    const spendable = round(income - housing - other - reinvestment + carry);
    const tracking = trackingSettings(trackingValues(monthKey), monthKey, spendable);
    const availableFromStart = round(spendable - tracking.openingAdjustment);
    const total = document.querySelector('#stableExpenseTotal');
    if (total) total.textContent = money(other);
    preview.innerHTML = `
      <div class="preview-cell"><span>CARRY IN</span><strong>${money(carry, true)}</strong></div>
      <div class="preview-cell"><span>FIXED COSTS</span><strong>${money(housing + other)}</strong></div>
      <div class="preview-cell"><span>AVAILABLE FROM START</span><strong>${money(availableFromStart)}</strong></div>
      <div class="preview-cell"><span>BASE DAILY LIMIT</span><strong>${money(spendable / daysInMonth(monthKey))}</strong></div>`;
  }

  function bindMonthPage(monthKey) {
    const picker = document.querySelector('#stableMonthPicker');
    const form = document.querySelector('#stableMonthForm');
    const expensesEl = document.querySelector('#stableMonthExpenses');
    const startDate = document.querySelector('#stableTrackingStartDate');
    const mode = document.querySelector('#stableTrackingMode');
    if (!picker || !form || !expensesEl || !startDate || !mode) return;

    picker.addEventListener('change', () => openMonth(picker.value));
    startDate.addEventListener('change', () => refreshTrackingUi(monthKey));
    mode.addEventListener('change', () => refreshTrackingUi(monthKey));
    document.querySelector('#stablePriorNet')?.addEventListener('input', () => updateMonthPreview(monthKey));
    ['#stableIncome', '#stableHousing', '#stableReinvestment'].forEach((selector) => {
      document.querySelector(selector)?.addEventListener('input', () => updateMonthPreview(monthKey));
    });
    expensesEl.addEventListener('input', () => updateMonthPreview(monthKey));
    expensesEl.addEventListener('click', (event) => {
      const remove = event.target.closest('.remove-expense');
      if (!remove) return;
      remove.closest('.expense-row')?.remove();
      updateMonthPreview(monthKey);
    });
    document.querySelector('#stableAddExpense')?.addEventListener('click', () => {
      appendExpense(expensesEl);
      updateMonthPreview(monthKey);
      expensesEl.querySelector('.expense-row:last-child [data-field="name"]')?.focus();
    });
    document.querySelector('#stableUseRecurring')?.addEventListener('click', () => {
      expensesEl.innerHTML = expenseRowsHtml(latestState?.recurringExpenses || []);
      updateMonthPreview(monthKey);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        month: monthKey,
        income: Number(document.querySelector('#stableIncome')?.value || 0),
        housing: Number(document.querySelector('#stableHousing')?.value || 0),
        reinvestment: Number(document.querySelector('#stableReinvestment')?.value || 0),
        expenses: readExpenseRows(expensesEl),
        ...trackingValues(monthKey),
      };
      try {
        await mutation('saveMonth', payload);
        toast(`${monthLabel(monthKey)} is set up.`);
        setTimeout(() => window.location.reload(), 120);
      } catch (error) {
        toast(error.message, true);
      }
    });

    document.querySelector('#stableDeleteMonth')?.addEventListener('click', async () => {
      if (!confirm(`Delete the setup for ${monthLabel(monthKey)}? Daily entries will remain.`)) return;
      try {
        await mutation('deleteMonth', { month: monthKey });
        toast('Month setup deleted.');
        setTimeout(() => window.location.reload(), 120);
      } catch (error) {
        toast(error.message, true);
      }
    });

    refreshTrackingUi(monthKey);
  }

  async function openMonth(monthHint) {
    if (monthPageOpen && monthHint === monthPageSelected && document.querySelector('#stableMonthForm')) return;
    monthPageOpen = true;
    monthPageSelected = /^\d{4}-\d{2}$/.test(monthHint || '') ? monthHint : currentMonth();
    setMonthChrome();
    const view = document.querySelector('#view');
    if (!view) return;
    view.innerHTML = '<article class="card empty-state"><h2>Loading monthly setup…</h2></article>';

    try {
      const state = await ensureState();
      const monthKey = monthPageSelected;
      const values = suggestedMonth(state, monthKey);
      const cfg = state.months?.[monthKey];
      const startDay = Math.min(daysInMonth(monthKey), Math.max(1, defaultStartDay(state, monthKey, values)));
      const startMode = values?.trackingStartMode === 'actual' ? 'actual' : 'fresh';
      const startDateMax = monthKey === currentMonth() ? currentDate() : dateFor(monthKey, daysInMonth(monthKey));
      const expenses = values.expenses || [];

      view.innerHTML = `
        <article class="card form-card">
          <div class="section-head">
            <div><h2>Plan the month</h2><p>Set income, protected costs, reinvestment, and when tracking begins.</p></div>
            <input id="stableMonthPicker" type="month" value="${esc(monthKey)}" aria-label="Select month" />
          </div>
          <form id="stableMonthForm">
            <div class="form-grid">
              <div class="field"><label for="stableIncome">Monthly income</label><div class="money-input"><span>$</span><input id="stableIncome" type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(values.income)}" required /></div><small>What you expect to bring in this month.</small></div>
              <div class="field"><label for="stableHousing">Housing / mortgage</label><div class="money-input"><span>$</span><input id="stableHousing" type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(values.housing)}" required /></div><small>Protected housing cost for this month.</small></div>
              <div class="field"><label for="stableReinvestment">Reinvestment target</label><div class="money-input"><span>$</span><input id="stableReinvestment" type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(values.reinvestment)}" required /></div><small>Money kept out of discretionary spending.</small></div>
            </div>

            <div class="section-head"><div><h2>When should tracking begin?</h2><p>If you start mid-month, earlier untracked days will not be mistaken for $0-spend days.</p></div></div>
            <div class="form-grid">
              <div class="field"><label for="stableTrackingStartDate">Tracking start date</label><input id="stableTrackingStartDate" type="date" min="${dateFor(monthKey, 1)}" max="${startDateMax}" value="${dateFor(monthKey, startDay)}" /></div>
              <div class="field"><label for="stableTrackingMode">Earlier days</label><select id="stableTrackingMode"><option value="fresh">Start fresh on this date</option><option value="actual">Use my actual earlier net spending</option></select></div>
            </div>
            <div id="stablePriorWrap" class="field" hidden><label for="stablePriorNet">Earlier net discretionary spending</label><div class="money-input"><span>$</span><input id="stablePriorNet" type="number" step="0.01" inputmode="decimal" value="${moneyInput(values.priorNetSpending || 0)}" /></div><small>Spending minus refunds before the start date. Negative is allowed if refunds exceeded spending.</small></div>
            <div class="callout"><span class="callout-dot"></span><div><strong>Start-date handling</strong><span id="stableTrackingExplanation"></span></div></div>

            <div class="section-head"><div><h2>Fixed costs this month</h2><p>This snapshot stays attached to ${esc(monthLabel(monthKey))} even if your recurring list changes later.</p></div><button id="stableUseRecurring" class="button ghost" type="button">Use current recurring list</button></div>
            <div id="stableMonthExpenses" class="expense-list">${expenseRowsHtml(expenses)}</div>
            <button id="stableAddExpense" class="button ghost" type="button">+ Add fixed cost</button>
            <div class="expense-total"><span>Other fixed costs</span><strong id="stableExpenseTotal">${money(sumExpenses(expenses))}</strong></div>

            <div id="stableMonthPreview" class="preview-strip"></div>
            <div class="form-actions">
              ${cfg ? '<button id="stableDeleteMonth" class="button danger ghost" type="button">Delete month setup</button>' : ''}
              <button class="button primary" type="submit">Save ${esc(monthLabel(monthKey))}</button>
            </div>
          </form>
        </article>`;
      const modeEl = document.querySelector('#stableTrackingMode');
      if (modeEl) modeEl.value = startDay === 1 ? 'fresh' : startMode;
      bindMonthPage(monthKey);
    } catch (error) {
      view.innerHTML = `<article class="card empty-state"><h2>Month could not load</h2><p>${esc(error.message)}</p><button id="stableMonthRetry" class="button primary" type="button">Try again</button></article>`;
      document.querySelector('#stableMonthRetry')?.addEventListener('click', () => { monthPageOpen = false; openMonth(monthPageSelected); });
      toast(error.message, true);
    }
  }

  function knownNetSpending(month, cfg) {
    let tracked = 0;
    const startDay = Number(cfg?.trackingStartDay || 1);
    for (const [date, entry] of Object.entries(latestState?.dailySpending || {})) {
      if (!date.startsWith(`${month}-`) || Number(date.slice(-2)) < startDay) continue;
      tracked += Number(entry?.amount || 0) - Number(entry?.refund || 0);
    }
    if (cfg?.trackingStartMode === 'actual') tracked += Number(cfg?.priorNetSpending || 0);
    return round(tracked);
  }

  function missingPastEntries() {
    if (!latestState) return [];
    const today = currentDate();
    const current = currentMonth();
    const missing = [];
    for (const [month, cfg] of Object.entries(latestState.months || {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (month > current) continue;
      const startDay = Number(cfg?.trackingStartDay || 1);
      const endDay = month === current ? new Date().getDate() - 1 : daysInMonth(month);
      for (let day = startDay; day <= endDay; day += 1) {
        const date = dateFor(month, day);
        if (date >= today) break;
        if (!latestState.dailySpending?.[date]) missing.push(date);
      }
    }
    return missing;
  }

  function enhanceToday() {
    if (monthPageOpen || document.querySelector('#pageEyebrow')?.textContent.trim() !== 'TODAY' || !latestState) return;
    document.querySelectorAll('#view .callout span').forEach((span) => {
      if (span.textContent.includes(' ahead of your earned spending pace.')) {
        span.textContent = span.textContent.replace(' ahead of your earned spending pace.', ' over your earned spending pace.');
      }
    });

    const current = currentMonth();
    const cfg = latestState.months?.[current];
    if (cfg && Number(cfg.trackingStartDay || 1) > 1) {
      const net = knownNetSpending(current, cfg);
      const labels = [...document.querySelectorAll('#view .summary-grid .metric-label')];
      const remaining = labels.find((el) => el.textContent.trim() === 'Money remaining');
      const foot = remaining?.closest('.metric-card')?.querySelector('.metric-foot');
      if (foot) foot.textContent = net < 0 ? `${money(Math.abs(net))} net gain since tracking began` : `${money(net)} net spending since tracking began`;
      const progress = document.querySelector('#view .section-card .progress-meta span:first-child');
      if (progress) progress.textContent = net < 0 ? `${money(Math.abs(net))} net gain since tracking began` : `${money(net)} net spending since tracking began`;
    }

    const old = document.querySelector('#stableMissingWarning');
    const missing = missingPastEntries();
    if (!missing.length) { old?.remove(); return; }
    if (old) return;
    const hero = document.querySelector('#view .hero-grid');
    if (!hero) return;
    const warning = document.createElement('article');
    warning.id = 'stableMissingWarning';
    warning.className = 'card section-card';
    const sample = missing.slice(0, 3).join(', ');
    warning.innerHTML = `<div class="callout warn"><span class="callout-dot"></span><div><strong>${missing.length} past tracked day${missing.length === 1 ? '' : 's'} still need an entry</strong><span>Your allowance temporarily assumes $0 spent on ${sample}${missing.length > 3 ? ' and more' : ''}. Enter $0 for a true no-spend day or enter the real amount in History.</span></div></div>`;
    hero.insertAdjacentElement('beforebegin', warning);
  }

  function enhanceHistory() {
    if (monthPageOpen || document.querySelector('#pageEyebrow')?.textContent.trim() !== 'HISTORY' || !latestState) return;
    const month = document.querySelector('#historyMonthPicker')?.value;
    const cfg = month ? latestState.months?.[month] : null;
    if (!month || !cfg || Number(cfg.trackingStartDay || 1) <= 1) return;
    const net = knownNetSpending(month, cfg);
    const labels = [...document.querySelectorAll('#view .summary-grid .metric-label')];
    const spending = labels.find((el) => ['Spent', 'Net spending', 'Net gain'].includes(el.textContent.trim()));
    const card = spending?.closest('.metric-card');
    if (spending) spending.textContent = net < 0 ? 'Net gain' : 'Net spending';
    const value = card?.querySelector('.metric-value');
    if (value) value.textContent = money(Math.abs(net));
    const foot = card?.querySelector('.metric-foot');
    if (foot) foot.textContent = cfg.trackingStartMode === 'actual' ? 'Known net spending including your pre-start total' : `Recorded since tracking began on day ${cfg.trackingStartDay}`;
  }

  function enhanceNonMonthViews() {
    if (monthPageOpen && document.querySelector('#stableMonthForm')) return;
    enhanceToday();
    enhanceHistory();
  }

  document.addEventListener('click', (event) => {
    const monthTarget = event.target.closest('[data-view="month"], #startMonthButton');
    if (monthTarget) {
      const historyPicker = document.querySelector('#historyMonthPicker');
      const hint = historyPicker?.value || monthPageSelected || currentMonth();
      event.preventDefault();
      event.stopImmediatePropagation();
      monthPageOpen = false;
      setTimeout(() => openMonth(hint), 0);
      return;
    }

    const calendarDay = event.target.closest('.calendar-day[data-date]');
    if (calendarDay && latestState) {
      const date = calendarDay.dataset.date;
      const cfg = latestState.months?.[date.slice(0, 7)];
      const beforeStart = cfg && Number(date.slice(-2)) < Number(cfg.trackingStartDay || 1);
      const future = date > currentDate();
      if (beforeStart || future) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toast(beforeStart ? 'That date is before tracking began for this month.' : 'Future days cannot be logged yet.', true);
        return;
      }
    }

    const nav = event.target.closest('[data-view]');
    if (nav && nav.dataset.view !== 'month') {
      const leavingMonth = monthPageOpen;
      const chosenMonth = monthPageSelected;
      monthPageOpen = false;
      setTimeout(() => {
        if (nav.dataset.view === 'history' && leavingMonth && chosenMonth) {
          const picker = document.querySelector('#historyMonthPicker');
          if (picker && picker.value !== chosenMonth) {
            picker.value = chosenMonth;
            picker.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        enhanceNonMonthViews();
      }, 0);
    }
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target.matches('#historyMonthPicker')) setTimeout(enhanceHistory, 0);
  }, true);

  setTimeout(enhanceNonMonthViews, 50);
})();

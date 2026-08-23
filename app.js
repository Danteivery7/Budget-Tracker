import {
  calculateCarryInto,
  calculateDay,
  calculateMonth,
  calendarCells,
  dateKeyFromDate,
  monthKeyFromDate,
  monthLabel,
  roundMoney,
  suggestedMonthValues,
  sumExpenses,
} from './engine.js';

let state = null;
let activeView = 'today';
let selectedMonth = monthKeyFromDate();
let toastTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const loginScreen = $('#loginScreen');
const appShell = $('#appShell');
const loginForm = $('#loginForm');
const notConfigured = $('#notConfigured');
const view = $('#view');
const dayDialog = $('#dayDialog');

function money(value, sign = false) {
  const n = Number(value || 0);
  const abs = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  if (!sign) return n < 0 ? `-${abs}` : abs;
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

function moneyInput(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function prettyDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function prettyDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(y, m - 1, d));
}

function setSync(mode, text) {
  const dot = $('#syncDot');
  const label = $('#syncText');
  if (!dot || !label) return;
  dot.className = `sync-dot${mode === 'busy' ? ' busy' : mode === 'error' ? ' error' : ''}`;
  label.textContent = text || (mode === 'busy' ? 'Saving…' : mode === 'error' ? 'Sync issue' : 'Synced');
}

function showToast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (response.status === 401) {
    showLogin(true);
    throw new Error('Your session expired. Unlock the tracker again.');
  }
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

async function loadState() {
  setSync('busy', 'Loading…');
  try {
    const body = await api('/api/budget/state');
    state = body.state;
    localStorage.setItem('budget_tracker_last_state', JSON.stringify(state));
    setSync('idle', 'Synced');
  } catch (error) {
    const cached = localStorage.getItem('budget_tracker_last_state');
    if (cached) {
      state = JSON.parse(cached);
      setSync('error', 'Offline copy');
      showToast('Showing your last synced copy. Reconnect to save changes.', true);
      return;
    }
    setSync('error');
    throw error;
  }
}

async function mutate(action, payload, successMessage) {
  if (!navigator.onLine) {
    showToast('Reconnect to the internet before saving.', true);
    return false;
  }
  setSync('busy', 'Saving…');
  try {
    const body = await api('/api/budget/mutate', {
      method: 'POST',
      body: JSON.stringify({ action, payload }),
    });
    state = body.state;
    localStorage.setItem('budget_tracker_last_state', JSON.stringify(state));
    setSync('idle', 'Synced');
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    setSync('error');
    showToast(error.message, true);
    return false;
  }
}

function showLogin(visible) {
  loginScreen.hidden = !visible;
  appShell.hidden = visible;
  if (visible) setTimeout(() => $('#passwordInput')?.focus(), 0);
}

async function initialize() {
  $('#todayLabel').textContent = prettyDate();

  try {
    const response = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
    const auth = await response.json();
    if (!auth.configured) {
      notConfigured.hidden = false;
      loginForm.hidden = true;
      showLogin(true);
      return;
    }
    if (!auth.authenticated) {
      showLogin(true);
      return;
    }
    showLogin(false);
    await loadState();
    render();
  } catch (error) {
    notConfigured.hidden = false;
    notConfigured.innerHTML = `<strong>Unable to reach the tracker API.</strong><span>${escapeHtml(error.message)}</span>`;
    loginForm.hidden = true;
    showLogin(true);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('#passwordInput').value;
  const button = $('button[type="submit"]', loginForm);
  button.disabled = true;
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
    $('#passwordInput').value = '';
    showLogin(false);
    await loadState();
    render();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch { /* noop */ }
  showLogin(true);
});

function setView(next) {
  activeView = next;
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === next));
  render();
}

$$('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

function pageMeta(eyebrow, title) {
  $('#pageEyebrow').textContent = eyebrow;
  $('#pageTitle').textContent = title;
}

function render() {
  if (!state) return;
  if (activeView === 'today') renderToday();
  else if (activeView === 'month') renderMonth();
  else if (activeView === 'fixed') renderFixed();
  else renderHistory();
}

function statusBadge(status, label) {
  const text = label || ({ green: 'On track', yellow: 'Be cautious', red: 'Over pace', neutral: 'No entry' }[status] || 'On track');
  return `<span class="status-badge ${status}">${escapeHtml(text)}</span>`;
}

function metricCard(label, value, foot = '', tone = '') {
  return `<article class="card metric-card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value ${tone}">${value}</div>${foot ? `<div class="metric-foot">${escapeHtml(foot)}</div>` : ''}</article>`;
}

function renderToday() {
  const now = new Date();
  const dateKey = dateKeyFromDate(now);
  const monthKey = monthKeyFromDate(now);
  const month = calculateMonth(state, monthKey);
  pageMeta('TODAY', 'Your spending limit');

  if (!month.configured) {
    view.innerHTML = `
      <article class="card empty-state">
        <div class="empty-icon">$</div>
        <h2>Set up ${escapeHtml(monthLabel(monthKey))}</h2>
        <p>Enter this month’s income, housing, fixed expenses, and reinvestment target. After that, the tracker will calculate your daily spending allowance automatically.</p>
        <button id="startMonthButton" class="button primary">Set up this month</button>
      </article>`;
    $('#startMonthButton').addEventListener('click', () => { selectedMonth = monthKey; setView('month'); });
    return;
  }

  const day = calculateDay(state, dateKey);
  const entry = state.dailySpending?.[dateKey];
  const monthProgress = month.spendable > 0 ? Math.max(0, (month.spent / month.spendable) * 100) : 100;
  const progressTone = monthProgress > 100 ? 'red' : monthProgress >= 90 ? 'yellow' : '';
  const afterTone = day.afterTodayBalance < 0 ? 'bad' : day.afterTodayBalance < day.baseDaily * .1 ? 'warn' : 'good';
  const tomorrowCopy = day.tomorrowAvailable == null
    ? 'This is the final day of the month.'
    : day.tomorrowRaw < 0
      ? `Tomorrow starts with a ${money(Math.abs(day.tomorrowRaw))} deficit, so recommended discretionary spending is $0.00.`
      : `If you spend nothing else today, tomorrow opens at ${money(day.tomorrowAvailable)}.`;

  let outcome = '';
  if (entry) {
    if (day.afterTodayBalance > 0.005) outcome = `${money(day.afterTodayBalance)} remains from your earned allowance after today’s spending.`;
    else if (day.afterTodayBalance < -0.005) outcome = `You are ${money(Math.abs(day.afterTodayBalance))} ahead of your earned spending pace.`;
    else outcome = 'You landed exactly on your earned spending limit.';
  }

  view.innerHTML = `
    <div class="hero-grid">
      <article class="card hero-card">
        <div>
          <div class="hero-label">You can spend today</div>
          <div class="hero-amount">${money(day.availableToday)}</div>
          <div class="hero-sub">Base allowance: <strong>${money(day.baseDaily)}/day</strong> · Day ${day.day} of ${day.daysInMonth}</div>
          <div class="status-row">
            ${statusBadge(day.rawAvailable < 0 ? 'red' : day.status, day.rawAvailable < 0 ? 'Recovery mode' : undefined)}
            <span class="inline-note">Carry into today: ${money(roundMoney(day.rawAvailable - day.baseDaily), true)}</span>
          </div>
        </div>
        <div>
          ${day.recoveryDays > 0 ? `<div class="callout bad"><span class="callout-dot"></span><div><strong>${day.recoveryDays} no-spend day${day.recoveryDays === 1 ? '' : 's'} recommended</strong><span>At your current base rate, that is approximately how long it takes to fully erase the deficit.</span></div></div>` : ''}
          <div class="callout ${day.tomorrowRaw < 0 ? 'warn' : ''}"><span class="callout-dot"></span><div><strong>Tomorrow projection</strong><span>${escapeHtml(tomorrowCopy)}</span></div></div>
        </div>
      </article>

      <article class="card entry-card">
        <h2>${entry ? 'Update today' : 'Log today'}</h2>
        <p>Enter your total discretionary spending for today. You can come back and edit it at any time.</p>
        <form id="todayForm">
          <div class="money-input"><span>$</span><input id="todayAmount" type="number" inputmode="decimal" min="0" step="0.01" value="${entry ? moneyInput(entry.amount) : ''}" placeholder="0.00" required /></div>
          <input id="todayNote" class="entry-note" type="text" maxlength="200" value="${escapeHtml(entry?.note || '')}" placeholder="Optional note" />
          <button class="button primary wide" type="submit">${entry ? 'Update spending' : 'Save today'}</button>
        </form>
        ${entry ? `<div class="callout ${day.status === 'red' ? 'bad' : day.status === 'yellow' ? 'warn' : ''}" style="margin-top:14px"><span class="callout-dot"></span><div><strong>Today: ${money(entry.amount)} spent</strong><span>${escapeHtml(outcome)}</span></div></div>` : ''}
      </article>
    </div>

    <div class="summary-grid">
      ${metricCard('Monthly income', money(month.income), monthLabel(monthKey))}
      ${metricCard('Fixed monthly costs', money(month.fixedTotal), `${money(month.housing)} housing + ${money(month.recurringTotal)} other`)}
      ${metricCard('Reinvestment', money(month.reinvestment), 'Protected before discretionary spending')}
      ${metricCard('Money remaining', money(month.remaining), `${money(month.spent)} spent this month`, afterTone)}
    </div>

    <article class="card section-card">
      <div class="section-head"><div><h2>Monthly discretionary budget</h2><p>${money(month.spendable)} available after fixed costs, reinvestment, and carryover.</p></div><strong>${Math.max(0, monthProgress).toFixed(0)}%</strong></div>
      <div class="progress-track"><div class="progress-fill ${progressTone}" style="width:${Math.min(100, Math.max(0, monthProgress))}%"></div></div>
      <div class="progress-meta"><span>${money(month.spent)} spent</span><span>${money(month.endingCarry)} projected carry if the month ended now</span></div>
    </article>`;

  $('#todayForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number($('#todayAmount').value);
    const note = $('#todayNote').value;
    if (await mutate('saveDaily', { date: dateKey, amount, note }, 'Today’s spending is saved.')) renderToday();
  });
}

function expenseRowsHtml(expenses) {
  return expenses.map((item) => `
    <div class="expense-row" data-expense-id="${escapeHtml(item.id || crypto.randomUUID())}">
      <input data-field="name" type="text" maxlength="80" value="${escapeHtml(item.name || '')}" placeholder="Expense name" aria-label="Expense name" />
      <input data-field="category" type="text" maxlength="40" value="${escapeHtml(item.category || '')}" placeholder="Category" aria-label="Expense category" />
      <input data-field="amount" type="number" inputmode="decimal" min="0" step="0.01" value="${moneyInput(item.amount)}" placeholder="0.00" aria-label="Expense amount" />
      <button class="remove-expense" type="button" aria-label="Remove expense">×</button>
    </div>`).join('');
}

function readExpenseRows(container) {
  return $$('.expense-row', container).map((row) => ({
    id: row.dataset.expenseId || crypto.randomUUID(),
    name: $('[data-field="name"]', row).value.trim() || 'Fixed expense',
    category: $('[data-field="category"]', row).value.trim() || 'Other',
    amount: Number($('[data-field="amount"]', row).value || 0),
  }));
}

function attachExpenseRowHandlers(container, onChange) {
  $$('.remove-expense', container).forEach((button) => button.addEventListener('click', () => {
    button.closest('.expense-row').remove();
    onChange?.();
  }));
  $$('input', container).forEach((input) => input.addEventListener('input', () => onChange?.()));
}

function appendExpenseRow(container, onChange, expense = {}) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = expenseRowsHtml([{ id: crypto.randomUUID(), name: '', category: '', amount: 0, ...expense }]);
  const row = wrapper.firstElementChild;
  container.appendChild(row);
  attachExpenseRowHandlers(row, onChange);
  $('[data-field="name"]', row).focus();
  onChange?.();
}

function renderMonth() {
  pageMeta('MONTH', 'Monthly setup');
  const values = suggestedMonthValues(state, selectedMonth);
  const carryIn = calculateCarryInto(state, selectedMonth);
  const currentCalc = calculateMonth(state, selectedMonth);

  view.innerHTML = `
    <article class="card form-card">
      <div class="section-head">
        <div><h2>Plan the month</h2><p>Set the income and protected costs that determine your discretionary spending pool.</p></div>
        <input id="monthPicker" type="month" value="${selectedMonth}" aria-label="Select month" style="width:165px" />
      </div>

      <form id="monthForm">
        <div class="form-grid">
          <div class="field"><label for="incomeInput">Monthly income</label><div class="money-input"><span>$</span><input id="incomeInput" type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(values.income)}" required /></div><small>What you expect to bring in this month.</small></div>
          <div class="field"><label for="housingInput">Housing / mortgage</label><div class="money-input"><span>$</span><input id="housingInput" type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(values.housing)}" required /></div><small>Protected housing cost for this month.</small></div>
          <div class="field"><label for="reinvestInput">Reinvestment target</label><div class="money-input"><span>$</span><input id="reinvestInput" type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(values.reinvestment)}" required /></div><small>Money you do not want available for spending.</small></div>
        </div>

        <div class="section-head" style="margin-top:28px"><div><h2>Fixed costs this month</h2><p>This snapshot stays attached to ${escapeHtml(monthLabel(selectedMonth))}, even if future subscriptions change.</p></div><button id="useRecurringButton" class="button ghost" type="button">Use current recurring list</button></div>
        <div id="monthExpenses" class="expense-list">${expenseRowsHtml(values.expenses || [])}</div>
        <button id="addMonthExpense" class="button ghost" type="button" style="margin-top:10px">+ Add fixed cost</button>
        <div class="expense-total"><span>Other fixed costs</span><strong id="monthExpenseTotal">${money(sumExpenses(values.expenses || []))}</strong></div>

        <div id="monthPreview" class="preview-strip"></div>
        <div class="form-actions">
          ${currentCalc.configured ? `<button id="deleteMonthButton" class="button danger ghost" type="button">Delete month setup</button>` : ''}
          <button class="button primary" type="submit">Save ${escapeHtml(monthLabel(selectedMonth))}</button>
        </div>
      </form>
    </article>`;

  const expensesEl = $('#monthExpenses');
  const updatePreview = () => {
    const income = Number($('#incomeInput').value || 0);
    const housing = Number($('#housingInput').value || 0);
    const reinvestment = Number($('#reinvestInput').value || 0);
    const expenses = readExpenseRows(expensesEl);
    const other = sumExpenses(expenses);
    const spendable = roundMoney(income - housing - other - reinvestment + carryIn);
    const dim = currentCalc.daysInMonth;
    $('#monthExpenseTotal').textContent = money(other);
    $('#monthPreview').innerHTML = `
      <div class="preview-cell"><span>CARRY IN</span><strong>${money(carryIn, true)}</strong></div>
      <div class="preview-cell"><span>FIXED COSTS</span><strong>${money(housing + other)}</strong></div>
      <div class="preview-cell"><span>SPENDABLE THIS MONTH</span><strong>${money(spendable)}</strong></div>
      <div class="preview-cell"><span>BASE DAILY LIMIT</span><strong>${money(spendable / dim)}</strong></div>`;
  };

  attachExpenseRowHandlers(expensesEl, updatePreview);
  ['#incomeInput', '#housingInput', '#reinvestInput'].forEach((sel) => $(sel).addEventListener('input', updatePreview));
  $('#addMonthExpense').addEventListener('click', () => appendExpenseRow(expensesEl, updatePreview));
  $('#useRecurringButton').addEventListener('click', () => {
    expensesEl.innerHTML = expenseRowsHtml(state.recurringExpenses || []);
    attachExpenseRowHandlers(expensesEl, updatePreview);
    updatePreview();
  });
  $('#monthPicker').addEventListener('change', (event) => { selectedMonth = event.target.value; renderMonth(); });
  updatePreview();

  $('#monthForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      month: selectedMonth,
      income: Number($('#incomeInput').value || 0),
      housing: Number($('#housingInput').value || 0),
      reinvestment: Number($('#reinvestInput').value || 0),
      expenses: readExpenseRows(expensesEl),
    };
    if (await mutate('saveMonth', payload, `${monthLabel(selectedMonth)} is set up.`)) renderMonth();
  });

  $('#deleteMonthButton')?.addEventListener('click', async () => {
    if (!confirm(`Delete the setup for ${monthLabel(selectedMonth)}? Daily entries will remain but will not calculate until the month is set up again.`)) return;
    if (await mutate('deleteMonth', { month: selectedMonth }, 'Month setup deleted.')) renderMonth();
  });
}

function renderFixed() {
  pageMeta('FIXED COSTS', 'Recurring expenses');
  const expenses = state.recurringExpenses || [];
  const total = sumExpenses(expenses);
  view.innerHTML = `
    <div class="two-col">
      <article class="card form-card">
        <div class="section-head"><div><h2>Recurring fixed costs</h2><p>Keep subscriptions, bills, and recurring expenses here. New months can copy this list instantly.</p></div></div>
        <form id="recurringForm">
          <div id="recurringExpenses" class="expense-list">${expenseRowsHtml(expenses)}</div>
          <button id="addRecurringExpense" class="button ghost" type="button" style="margin-top:10px">+ Add recurring cost</button>
          <div class="expense-total"><span>Recurring total</span><strong id="recurringTotal">${money(total)}</strong></div>
          <div class="form-actions"><button class="button primary" type="submit">Save recurring costs</button></div>
        </form>
      </article>

      <div>
        <article class="card section-card" style="margin-top:0">
          <div class="section-head"><div><h2>How these work</h2><p>Your history never changes accidentally.</p></div></div>
          <div class="callout"><span class="callout-dot"></span><div><strong>Future-month template</strong><span>This list is used when you open a month that has not been configured yet.</span></div></div>
          <div class="callout"><span class="callout-dot"></span><div><strong>Historical snapshots stay fixed</strong><span>Changing a subscription here will not silently rewrite an older month’s budget.</span></div></div>
        </article>

        <article class="card section-card">
          <div class="section-head"><div><h2>Backup & portability</h2><p>Your data can leave this app whenever you want.</p></div></div>
          <div class="data-actions">
            <button id="exportJson" class="button secondary" type="button">Export JSON backup</button>
            <button id="exportCsv" class="button secondary" type="button">Export spending CSV</button>
            <button id="importButton" class="button ghost" type="button">Restore JSON backup</button>
            <input id="importFile" class="file-input" type="file" accept="application/json,.json" />
          </div>
        </article>
      </div>
    </div>`;

  const expensesEl = $('#recurringExpenses');
  const updateTotal = () => { $('#recurringTotal').textContent = money(sumExpenses(readExpenseRows(expensesEl))); };
  attachExpenseRowHandlers(expensesEl, updateTotal);
  $('#addRecurringExpense').addEventListener('click', () => appendExpenseRow(expensesEl, updateTotal));
  $('#recurringForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await mutate('saveRecurring', { expenses: readExpenseRows(expensesEl) }, 'Recurring costs saved.')) renderFixed();
  });

  $('#exportJson').addEventListener('click', exportJson);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#importButton').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', importJson);
}

function renderHistory() {
  pageMeta('HISTORY', 'Monthly history');
  const calc = calculateMonth(state, selectedMonth);
  const cells = calendarCells(selectedMonth);
  const todayKey = dateKeyFromDate();
  const hasConfig = calc.configured;

  const dayButtons = cells.map((dateKey) => {
    if (!dateKey) return '<div class="calendar-day blank"></div>';
    const entry = state.dailySpending?.[dateKey];
    const day = hasConfig ? calculateDay(state, dateKey) : null;
    const status = entry && day ? day.status : '';
    return `<button class="calendar-day ${status} ${dateKey === todayKey ? 'today' : ''}" data-date="${dateKey}" type="button">
      <span class="day-number">${Number(dateKey.slice(-2))}</span>
      ${entry ? `<span class="day-spent">${money(entry.amount)}</span><span class="day-caption">${day?.afterTodayBalance < 0 ? `${money(Math.abs(day.afterTodayBalance))} deficit` : `${money(day?.afterTodayBalance || 0)} buffer`}</span>` : `<span class="day-caption" style="margin-top:auto">No entry</span>`}
    </button>`;
  }).join('');

  view.innerHTML = `
    <article class="card form-card">
      <div class="section-head">
        <div><h2>${escapeHtml(monthLabel(selectedMonth))}</h2><p>${hasConfig ? `${money(calc.spent)} spent · ${money(calc.endingCarry)} current month-end carry` : 'This month has not been configured yet.'}</p></div>
        <div class="history-controls"><button id="prevMonth" class="button ghost" type="button">‹</button><input id="historyMonthPicker" type="month" value="${selectedMonth}" /><button id="nextMonth" class="button ghost" type="button">›</button></div>
      </div>
      <div class="summary-grid" style="margin-top:0">
        ${metricCard('Discretionary budget', money(calc.spendable), `Carry in ${money(calc.carryIn, true)}`)}
        ${metricCard('Spent', money(calc.spent), 'Daily entries in this month')}
        ${metricCard('Month-end balance', money(calc.endingCarry), calc.endingCarry >= 0 ? 'Carries forward as extra money' : 'Carries forward as a deficit', calc.endingCarry < 0 ? 'bad' : 'good')}
        ${metricCard('Base daily limit', money(calc.baseDaily), hasConfig ? `${calc.daysInMonth} days` : 'Set up this month first')}
      </div>
    </article>

    <article class="card calendar-card">
      <div class="calendar-weekdays"><div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div></div>
      <div class="calendar-grid">${dayButtons}</div>
    </article>`;

  $('#historyMonthPicker').addEventListener('change', (event) => { selectedMonth = event.target.value; renderHistory(); });
  $('#prevMonth').addEventListener('click', () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    selectedMonth = monthKeyFromDate(new Date(y, m - 2, 1));
    renderHistory();
  });
  $('#nextMonth').addEventListener('click', () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    selectedMonth = monthKeyFromDate(new Date(y, m, 1));
    renderHistory();
  });
  $$('.calendar-day[data-date]').forEach((button) => button.addEventListener('click', () => openDayDialog(button.dataset.date)));
}

function openDayDialog(dateKey) {
  if (!state.months?.[dateKey.slice(0, 7)]) {
    showToast('Set up that month before logging daily spending.', true);
    return;
  }
  const entry = state.dailySpending?.[dateKey];
  $('#dayDialogTitle').textContent = prettyDateKey(dateKey);
  $('#dayDialogDate').value = dateKey;
  $('#dayDialogAmount').value = entry ? moneyInput(entry.amount) : '';
  $('#dayDialogNote').value = entry?.note || '';
  $('#deleteDayButton').hidden = !entry;
  dayDialog.showModal();
  setTimeout(() => $('#dayDialogAmount').focus(), 0);
}

$('#closeDayDialog').addEventListener('click', () => dayDialog.close());
$('#dayDialogForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const date = $('#dayDialogDate').value;
  const amount = Number($('#dayDialogAmount').value || 0);
  const note = $('#dayDialogNote').value;
  if (await mutate('saveDaily', { date, amount, note }, 'Daily spending saved.')) {
    dayDialog.close();
    renderHistory();
  }
});
$('#deleteDayButton').addEventListener('click', async () => {
  const date = $('#dayDialogDate').value;
  if (!confirm(`Delete the spending entry for ${prettyDateKey(date)}?`)) return;
  if (await mutate('deleteDaily', { date }, 'Daily entry deleted.')) {
    dayDialog.close();
    renderHistory();
  }
});

dayDialog.addEventListener('click', (event) => {
  if (event.target === dayDialog) dayDialog.close();
});

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJson() {
  download(`budget-tracker-backup-${dateKeyFromDate()}.json`, JSON.stringify(state, null, 2), 'application/json');
  showToast('JSON backup exported.');
}

function exportCsv() {
  const rows = [['Date', 'Amount', 'Note', 'Month']];
  Object.entries(state.dailySpending || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, entry]) => {
    rows.push([date, Number(entry.amount || 0).toFixed(2), entry.note || '', date.slice(0, 7)]);
  });
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  download(`budget-tracker-spending-${dateKeyFromDate()}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('Spending CSV exported.');
}

async function importJson(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!confirm('Restore this backup? It will replace the current tracker data after validation.')) return;
    if (await mutate('importState', { state: imported }, 'Backup restored successfully.')) renderFixed();
  } catch (error) {
    showToast(`Could not restore backup: ${error.message}`, true);
  }
}

window.addEventListener('online', async () => {
  if (!appShell.hidden) {
    try { await loadState(); render(); showToast('Back online and synced.'); } catch { /* handled */ }
  }
});
window.addEventListener('offline', () => setSync('error', 'Offline copy'));

initialize();

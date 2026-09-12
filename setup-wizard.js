import { buildSetupPlan } from './setup-engine.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, '0');
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const currentDay = () => new Date().getDate();
const money = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const moneyInput = (value) => {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const uid = () => globalThis.crypto?.randomUUID?.() || `setup-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const stepNames = ['Start', 'Income', 'Priorities', 'Essentials', 'Spending', 'Review'];
let wizardOpen = false;
let step = 0;
let draft = null;

function getState() {
  try { return JSON.parse(localStorage.getItem('budget_tracker_last_state') || 'null'); } catch { return null; }
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function suggestedDraft(monthKey) {
  const state = getState();
  const existing = state?.months?.[monthKey];
  const olderKeys = Object.keys(state?.months || {}).filter((key) => key < monthKey).sort();
  const previous = olderKeys.length ? state.months[olderKeys.at(-1)] : null;
  const base = existing || previous || {};
  const expenses = (existing?.expenses || state?.recurringExpenses || previous?.expenses || []).map((item) => ({
    id: item.id || uid(),
    name: item.name || '',
    category: item.category || 'Fixed',
    amount: Number(item.amount || 0),
  }));
  const income = Number(base.income || 0);
  const housing = Number(base.housing || 0);
  const reinvestment = Number(base.reinvestment || 0);
  const savingsTarget = Number(base.savingsTarget || 0);
  const fixed = housing + expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const personal = Math.max(0, income - fixed - reinvestment - savingsTarget);
  const isCurrent = monthKey === currentMonth();
  const today = currentDay();
  return {
    month: monthKey,
    income,
    reinvestment,
    savingsTarget,
    housing,
    expenses,
    desiredPersonal: personal,
    balanceMode: 'protected',
    trackingChoice: existing?.trackingStartDay > 1
      ? (existing.trackingStartMode === 'actual' ? 'actual' : 'today')
      : (isCurrent && today > 1 ? 'today' : 'month-start'),
    priorNetSpending: Number(existing?.priorNetSpending || 0),
  };
}

function setChrome() {
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === 'setup'));
  const eyebrow = $('#pageEyebrow');
  const title = $('#pageTitle');
  if (eyebrow) eyebrow.textContent = 'SETUP';
  if (title) title.textContent = 'Guided budget setup';
}

function plan() {
  return buildSetupPlan(draft || {});
}

function fixedExpensesTotal() {
  return (draft?.expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function agentMessage() {
  const p = plan();
  if (p.overAllocated) {
    return `<strong>The plan is over-allocated.</strong> Your protected targets are ${money(Math.abs(p.personalAvailable))} higher than the income available after fixed costs. Reduce business reinvestment, lower another target, or increase expected income before saving.`;
  }
  if (draft.balanceMode === 'personal' && p.desiredPersonal != null) {
    if (p.desiredPersonalImpossible) {
      return `<strong>That spending target cannot fit without touching protected loan money.</strong> After fixed costs and your ${money(p.savingsTarget)} loan/savings target, the most that can remain for business plus personal spending is ${money(Math.max(0, p.maxAfterProtected))}.`;
    }
    return `<strong>I balanced the flexible business bucket around your spending target.</strong> To leave ${money(p.desiredPersonal)} for personal spending while keeping loan/savings protected, the business reinvestment target becomes ${money(p.businessTarget)}.`;
  }
  return `<strong>Your protected targets stay in control.</strong> With the current numbers, ${money(Math.max(0, p.personalAvailable))} remains for personal spending after housing, fixed costs, business reinvestment, and loan/savings.`;
}

function railHtml() {
  return `
    <aside class="setup-rail">
      <p class="eyebrow">PRIVATE FINANCE SETUP</p>
      <h2>Build the plan once.</h2>
      <p>I’ll walk through the money in the same order the tracker will use it later. Nothing saves until the final review.</p>
      <div class="setup-step-list">
        ${stepNames.map((name, index) => `
          <div class="setup-step-item ${index === step ? 'active' : index < step ? 'done' : ''}">
            <span class="setup-step-number">${index < step ? '✓' : index + 1}</span><span>${name}</span>
          </div>`).join('')}
      </div>
    </aside>`;
}

function shell(content) {
  const pct = ((step + 1) / stepNames.length) * 100;
  return `<article class="card setup-shell">${railHtml()}<section class="setup-main"><div class="setup-progress"><span style="width:${pct}%"></span></div>${content}</section></article>`;
}

function fieldMoney(id, label, value, help = '') {
  return `<div class="field"><label for="${id}">${label}</label><div class="money-input"><span>$</span><input id="${id}" type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(value)}" /></div>${help ? `<small>${help}</small>` : ''}</div>`;
}

function actions({ back = true, next = true, nextLabel = 'Continue', disabled = false } = {}) {
  return `<div class="setup-actions">${back ? '<button id="setupBack" class="button ghost" type="button">Back</button>' : '<span></span>'}<div class="setup-actions-right">${next ? `<button id="setupNext" class="button primary" type="button" ${disabled ? 'disabled' : ''}>${nextLabel}</button>` : ''}</div></div>`;
}

function renderStart() {
  const state = getState();
  const existing = Boolean(state?.months?.[draft.month]);
  return shell(`
    <div class="setup-copy">
      <span class="setup-kicker">Step 1 · Foundation</span>
      <h2 class="setup-title">Set up your money like a system, not a spreadsheet.</h2>
      <p class="setup-lead">We’ll establish the month’s income, protected loan target, business reinvestment, essential costs, and personal spending. The result feeds the same calculations already used by your dashboard and purchase planner.</p>
      <div class="setup-form-grid single">
        <div class="field"><label for="setupMonth">Budget month</label><input id="setupMonth" type="month" value="${esc(draft.month)}" /></div>
      </div>
      <div class="setup-panel"><h3>${existing ? 'Editing an existing month' : 'Starting from a clean month'}</h3><p>${existing ? `I loaded the current ${esc(monthLabel(draft.month))} plan so you can revise it without rebuilding everything from memory.` : 'This setup creates the month plan. Card routing, subscription allocation, and bank connections remain separate so we can build those carefully next.'}</p></div>
      <div class="agent-note"><strong>Priority rule:</strong> loan/savings is protected first, business reinvestment is the flexible second layer, and personal spending is what remains. The purchase planner will continue using checking first, business second, and loan money only as a last-resort warning.</div>
      ${actions({ back: false, nextLabel: existing ? 'Review this month' : 'Start setup' })}
    </div>`);
}

function renderIncome() {
  return shell(`
    <div class="setup-copy">
      <span class="setup-kicker">Step 2 · Income</span>
      <h2 class="setup-title">What is this month actually working with?</h2>
      <p class="setup-lead">Use the amount you realistically expect to receive for the month. This can change every month; the tracker does not assume one permanent income level.</p>
      <div class="setup-form-grid">${fieldMoney('setupIncome', 'Expected monthly income', draft.income, 'The full amount expected to come in this month.')}</div>
      <div class="agent-note">If next month jumps from ${money(draft.income || 0)} to a higher amount, you simply set up that month with the new income and new targets. Nothing here hard-codes the current example.</div>
      ${actions()}
    </div>`);
}

function renderPriorities() {
  return shell(`
    <div class="setup-copy">
      <span class="setup-kicker">Step 3 · Priorities</span>
      <h2 class="setup-title">Protect the money that has a job before you spend it.</h2>
      <p class="setup-lead">Tell me how much should go back into the business and how much must be reserved for loan payoff or savings. Loan money remains the highest-priority protected bucket.</p>
      <div class="setup-form-grid">
        ${fieldMoney('setupReinvestment', 'Business reinvestment target', draft.reinvestment, 'Important, but allowed to flex before the loan bucket if a real-life purchase forces a tradeoff.')}
        ${fieldMoney('setupSavings', 'Loan / savings target', draft.savingsTarget, 'Highest-priority protected money. The purchase planner will warn before touching this.')}
      </div>
      <div class="agent-note">The site will never silently treat loan money as ordinary spending money. If a purchase reaches this bucket, it will be shown as a deliberate priority change.</div>
      ${actions()}
    </div>`);
}

function expenseRows() {
  return (draft.expenses || []).map((item) => `<div class="setup-cost-row" data-id="${esc(item.id)}"><input data-name type="text" maxlength="80" value="${esc(item.name)}" placeholder="Fixed cost name" /><input data-amount type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(item.amount)}" placeholder="0.00" /><button class="setup-remove" type="button" aria-label="Remove fixed cost">×</button></div>`).join('');
}

function renderEssentials() {
  return shell(`
    <div class="setup-copy">
      <span class="setup-kicker">Step 4 · Essentials</span>
      <h2 class="setup-title">What has to be paid before lifestyle spending?</h2>
      <p class="setup-lead">Housing and fixed costs stay outside the purchase-funding order. They are protected obligations, not extra cash that the planner can borrow from.</p>
      <div class="setup-form-grid">${fieldMoney('setupHousing', 'Housing / mortgage', draft.housing, 'Enter 0 if housing is not part of this budget.')}</div>
      <div class="setup-panel">
        <h3>Other fixed monthly costs</h3><p>Add bills you already know belong in the month. We are not assigning subscriptions to credit cards yet; that will be its own setup phase.</p>
        <div id="setupCosts" class="setup-cost-list">${expenseRows()}</div>
        <button id="setupAddCost" class="button ghost" type="button" style="margin-top:10px">+ Add fixed cost</button>
      </div>
      <div class="agent-note"><strong>Current essentials:</strong> ${money(Number(draft.housing || 0) + fixedExpensesTotal())} reserved before business, loan, or spending allocations.</div>
      ${actions()}
    </div>`);
}

function renderSpending() {
  const p = plan();
  const current = draft.month === currentMonth();
  const today = currentDay();
  return shell(`
    <div class="setup-copy">
      <span class="setup-kicker">Step 5 · Spending & tracking</span>
      <h2 class="setup-title">Choose how strict the month should be.</h2>
      <p class="setup-lead">Right now your protected targets leave ${money(Math.max(0, p.personalAvailable))} for personal spending. You can keep those targets exactly, or tell me the personal amount you want and let the flexible business target rebalance around it.</p>
      <div class="setup-form-grid">${fieldMoney('setupDesiredPersonal', 'Preferred personal spending', draft.desiredPersonal, 'Used only if you choose to balance the business target around your spending goal.')}</div>
      <div class="setup-choice-grid">
        <label class="setup-choice"><input type="radio" name="balanceMode" value="protected" ${draft.balanceMode === 'protected' ? 'checked' : ''} /><strong>Keep my protected targets</strong><span>Business and loan targets stay exactly as entered. Personal spending becomes the remainder.</span></label>
        <label class="setup-choice"><input type="radio" name="balanceMode" value="personal" ${draft.balanceMode === 'personal' ? 'checked' : ''} /><strong>Balance around my spending target</strong><span>Loan/savings stays protected. The business target flexes to leave the personal amount you entered.</span></label>
      </div>
      <div class="setup-panel">
        <h3>When should spending tracking begin?</h3>
        <div class="setup-choice-grid">
          <label class="setup-choice"><input type="radio" name="trackingChoice" value="month-start" ${draft.trackingChoice === 'month-start' ? 'checked' : ''} /><strong>From day 1</strong><span>Use the entire month as the tracking period.</span></label>
          ${current && today > 1 ? `<label class="setup-choice"><input type="radio" name="trackingChoice" value="today" ${draft.trackingChoice === 'today' ? 'checked' : ''} /><strong>Start fresh today</strong><span>Earlier days will not create a fake accumulated spending windfall.</span></label>` : ''}
          ${current && today > 1 ? `<label class="setup-choice"><input type="radio" name="trackingChoice" value="actual" ${draft.trackingChoice === 'actual' ? 'checked' : ''} /><strong>Reconstruct this month</strong><span>Enter your actual earlier net discretionary spending so today starts from the real position.</span></label>` : ''}
        </div>
        ${draft.trackingChoice === 'actual' ? `<div class="setup-form-grid" style="margin-top:14px">${fieldMoney('setupPriorNet', 'Earlier net discretionary spending', draft.priorNetSpending, 'Spending minus refunds before today.')}</div>` : ''}
      </div>
      <div class="agent-note">${agentMessage()}</div>
      ${actions({ disabled: p.overAllocated || p.desiredPersonalImpossible })}
    </div>`);
}

function reviewTracking() {
  const today = currentDay();
  if (draft.trackingChoice === 'month-start') return { startDay: 1, mode: 'fresh', prior: 0, label: 'Tracking from day 1' };
  if (draft.trackingChoice === 'actual') return { startDay: today, mode: 'actual', prior: Number(draft.priorNetSpending || 0), label: `Actual month reconstructed through day ${today - 1}` };
  return { startDay: today, mode: 'fresh', prior: 0, label: `Fresh tracking from day ${today}` };
}

function renderReview() {
  const p = plan();
  const tracking = reviewTracking();
  const fixedOther = fixedExpensesTotal();
  const monthlyTotal = p.fixedTotal + p.businessTarget + p.savingsTarget + Math.max(0, p.personalAvailable);
  const disabled = p.overAllocated || p.desiredPersonalImpossible;
  return shell(`
    <div class="setup-copy">
      <span class="setup-kicker">Step 6 · Review</span>
      <h2 class="setup-title">Here is the month before I commit it.</h2>
      <p class="setup-lead">This is the financial operating plan the rest of the site will use. Review the split now; bank accounts and credit-card routing will be connected in the next phase, not guessed here.</p>
      <div class="setup-review-grid">
        <div class="setup-review-card"><span>Monthly income</span><strong>${money(p.income)}</strong><small>${esc(monthLabel(draft.month))}</small></div>
        <div class="setup-review-card"><span>Fixed obligations</span><strong>${money(p.fixedTotal)}</strong><small>${money(draft.housing)} housing + ${money(fixedOther)} other</small></div>
        <div class="setup-review-card"><span>Business reinvestment</span><strong>${money(p.businessTarget)}</strong><small>${draft.balanceMode === 'personal' ? 'Balanced around your personal target' : 'Protected target as entered'}</small></div>
        <div class="setup-review-card"><span>Loan / savings</span><strong>${money(p.savingsTarget)}</strong><small>Highest-priority protected bucket</small></div>
        <div class="setup-review-card"><span>Personal spending</span><strong>${money(Math.max(0, p.personalAvailable))}</strong><small>Available after protected allocations</small></div>
        <div class="setup-review-card"><span>Accounting check</span><strong>${money(monthlyTotal)}</strong><small>${Math.abs(monthlyTotal - p.income) < .01 ? 'Every dollar is accounted for' : 'Review the allocation before saving'}</small></div>
      </div>
      <div class="agent-note"><strong>${esc(tracking.label)}.</strong> ${agentMessage()} After setup, Overview will show the live spending position, Monthly Plan will let you revise targets, and Purchase Planner will run purchases through the priority order.</div>
      ${disabled ? '<div class="setup-panel"><h3 class="setup-warning-inline">This plan cannot be saved yet</h3><p>Go back and resolve the over-allocation before committing the month.</p></div>' : ''}
      ${actions({ nextLabel: 'Create this budget', disabled })}
    </div>`);
}

function render() {
  if (!wizardOpen || !draft) return;
  setChrome();
  const view = $('#view');
  if (!view) return;
  view.innerHTML = [renderStart, renderIncome, renderPriorities, renderEssentials, renderSpending, renderReview][step]();
  bindStep();
}

function readCurrentStep() {
  if (step === 0) {
    const month = $('#setupMonth')?.value;
    if (month && month !== draft.month) draft = suggestedDraft(month);
  } else if (step === 1) {
    draft.income = Number($('#setupIncome')?.value || 0);
  } else if (step === 2) {
    draft.reinvestment = Number($('#setupReinvestment')?.value || 0);
    draft.savingsTarget = Number($('#setupSavings')?.value || 0);
  } else if (step === 3) {
    draft.housing = Number($('#setupHousing')?.value || 0);
    draft.expenses = $$('.setup-cost-row').map((row) => ({
      id: row.dataset.id || uid(),
      name: $('[data-name]', row)?.value.trim() || 'Fixed cost',
      category: 'Fixed',
      amount: Number($('[data-amount]', row)?.value || 0),
    }));
  } else if (step === 4) {
    draft.desiredPersonal = Number($('#setupDesiredPersonal')?.value || 0);
    draft.balanceMode = $('input[name="balanceMode"]:checked')?.value || 'protected';
    draft.trackingChoice = $('input[name="trackingChoice"]:checked')?.value || 'month-start';
    if (draft.trackingChoice === 'actual') draft.priorNetSpending = Number($('#setupPriorNet')?.value || 0);
  }
}

async function mutate(action, payload) {
  const response = await fetch('/api/budget/mutate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok || !body?.state) throw new Error(body?.error || 'Could not save the budget.');
  localStorage.setItem('budget_tracker_last_state', JSON.stringify(body.state));
  return body.state;
}

async function saveSetup() {
  readCurrentStep();
  const p = plan();
  if (p.overAllocated || p.desiredPersonalImpossible) return;
  const tracking = reviewTracking();
  const button = $('#setupNext');
  if (button) { button.disabled = true; button.textContent = 'Creating budget…'; }
  try {
    await mutate('saveMonth', {
      month: draft.month,
      income: p.income,
      housing: Number(draft.housing || 0),
      reinvestment: p.businessTarget,
      savingsTarget: p.savingsTarget,
      planningWeeks: 4,
      payoutDaysPerWeek: 5,
      expenses: draft.expenses,
      trackingStartDay: tracking.startDay,
      trackingStartMode: tracking.mode,
      priorNetSpending: tracking.prior,
    });
    location.reload();
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = 'Create this budget'; }
    const note = $('.agent-note');
    if (note) note.innerHTML = `<strong>Setup could not be saved.</strong> ${esc(error.message)}`;
  }
}

function bindStep() {
  $('#setupBack')?.addEventListener('click', () => { readCurrentStep(); step = Math.max(0, step - 1); render(); });
  $('#setupNext')?.addEventListener('click', () => {
    readCurrentStep();
    if (step === stepNames.length - 1) { saveSetup(); return; }
    step = Math.min(stepNames.length - 1, step + 1);
    render();
  });
  $('#setupMonth')?.addEventListener('change', (event) => {
    draft = suggestedDraft(event.target.value);
    render();
  });
  $('#setupAddCost')?.addEventListener('click', () => {
    readCurrentStep();
    draft.expenses.push({ id: uid(), name: '', category: 'Fixed', amount: 0 });
    render();
    $$('.setup-cost-row').at(-1)?.querySelector('[data-name]')?.focus();
  });
  $$('.setup-remove').forEach((button) => button.addEventListener('click', () => {
    readCurrentStep();
    const id = button.closest('.setup-cost-row')?.dataset.id;
    draft.expenses = draft.expenses.filter((item) => item.id !== id);
    render();
  }));
  $$('input[name="balanceMode"], input[name="trackingChoice"]').forEach((input) => input.addEventListener('change', () => { readCurrentStep(); render(); }));
}

function openSetup(monthKey = currentMonth()) {
  wizardOpen = true;
  step = 0;
  draft = suggestedDraft(monthKey);
  render();
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-view="setup"]');
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openSetup();
}, true);

let checks = 0;
const autoStart = setInterval(() => {
  checks += 1;
  const shell = $('#appShell');
  const state = getState();
  if (shell && !shell.hidden && state?.months) {
    clearInterval(autoStart);
    if (!Object.keys(state.months).length) openSetup();
  } else if (checks > 40) clearInterval(autoStart);
}, 250);

import { buildSetupPlan } from './setup-engine.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, '0');
const monthKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const dateKey = (date = new Date()) => `${monthKey(date)}-${pad(date.getDate())}`;
const nextMonth = (key) => {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(year, month, 1));
};
const money = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const monthLabel = (key) => {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
};

let pageOpen = false;
let step = 0;
let state = null;
let baseRevision = null;
let draft = null;
const stepNames = ['Timing', 'Income', 'Priorities', 'Spending', 'Review'];

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function activeExpenses(config = {}) {
  return (state?.recurringExpenses?.length ? state.recurringExpenses : config.expenses || []).map((item) => ({ ...item, amount: Number(item.amount || 0) }));
}

function makeDraft(revision, targetMonth) {
  const config = revision?.config || state?.months?.[targetMonth] || state?.months?.[currentMonth()] || {};
  const expenses = activeExpenses(config);
  const fixed = Number(config.housing || 0) + expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const personal = Math.max(0, Number(config.income || 0) - fixed - Number(config.reinvestment || 0) - Number(config.savingsTarget || 0));
  return {
    effectiveMonth: targetMonth,
    timing: targetMonth === currentMonth() ? 'now' : 'next',
    income: Number(config.income || 0),
    housing: Number(config.housing || 0),
    expenses,
    reinvestment: Number(config.reinvestment || 0),
    savingsTarget: Number(config.savingsTarget || 0),
    desiredPersonal: Number(revision?.desiredPersonal ?? personal),
    balanceMode: revision?.balanceMode === 'personal' ? 'personal' : 'protected',
    planningWeeks: Number(config.planningWeeks || 4),
    payoutDaysPerWeek: Number(config.payoutDaysPerWeek || 5),
    reason: '',
  };
}

function currentMonth() { return monthKey(); }

async function loadBase(targetMonth = currentMonth()) {
  let body = await api(`/api/plan/state?month=${encodeURIComponent(targetMonth)}`, { cache: 'no-store' });
  state = body.state;
  if (!body.view?.revision && Object.keys(state?.months || {}).length) {
    const boot = await api('/api/plan/mutate', { method: 'POST', body: JSON.stringify({ action: 'bootstrap', payload: { month: targetMonth } }) });
    state = boot.state;
    body = await api(`/api/plan/state?month=${encodeURIComponent(targetMonth)}`, { cache: 'no-store' });
    state = body.state;
  }
  baseRevision = body.view?.revision || null;
  draft = makeDraft(baseRevision, targetMonth);
}

function setChrome() {
  $$('[data-plan-change-nav]').forEach((button) => button.classList.add('active'));
  $$('[data-view], [data-cards-nav], [data-subscriptions-nav]').forEach((button) => button.classList.remove('active'));
  if ($('#pageEyebrow')) $('#pageEyebrow').textContent = 'PLAN MANAGEMENT';
  if ($('#pageTitle')) $('#pageTitle').textContent = 'Change financial plan';
}

function injectNavigation() {
  if ($('[data-plan-change-nav="desktop"]')) return;
  const desktop = $('.desktop-nav');
  const mobile = $('.mobile-nav');
  if (desktop) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.planChangeNav = 'desktop';
    button.innerHTML = '<span>Change Plan</span>';
    desktop.appendChild(button);
    button.addEventListener('click', openPage);
  }
  if (mobile) {
    const button = document.createElement('button');
    button.className = 'mobile-nav-item';
    button.dataset.planChangeNav = 'mobile';
    button.textContent = 'Change';
    mobile.appendChild(button);
    button.addEventListener('click', openPage);
  }
}

function plan() {
  return buildSetupPlan({
    income: draft.income,
    housing: draft.housing,
    expenses: draft.expenses,
    reinvestment: draft.reinvestment,
    savingsTarget: draft.savingsTarget,
    desiredPersonal: draft.desiredPersonal,
    balanceMode: draft.balanceMode,
  });
}

function beforePlan() {
  const config = baseRevision?.config || {};
  return buildSetupPlan({
    income: config.income,
    housing: config.housing,
    expenses: activeExpenses(config),
    reinvestment: config.reinvestment,
    savingsTarget: config.savingsTarget,
    desiredPersonal: baseRevision?.desiredPersonal,
    balanceMode: baseRevision?.balanceMode || 'protected',
  });
}

function shell(content) {
  return `<article class="card change-plan-shell">
    <aside class="change-plan-rail"><p class="eyebrow">PLAN REVISION</p><h2>Change the rules, not the history.</h2><p>The active plan carries forward until you deliberately replace it.</p><div class="change-plan-steps">${stepNames.map((name, index) => `<div class="change-plan-step ${index === step ? 'active' : index < step ? 'done' : ''}"><span>${index < step ? '✓' : index + 1}</span>${esc(name)}</div>`).join('')}</div></aside>
    <section class="change-plan-main"><div class="change-plan-progress"><span style="width:${((step + 1) / stepNames.length) * 100}%"></span></div>${content}</section>
  </article>`;
}

function moneyField(id, label, value, help = '') {
  return `<div class="field"><label for="${id}">${esc(label)}</label><div class="money-input"><span>$</span><input id="${id}" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(value || 0)}" /></div>${help ? `<small>${esc(help)}</small>` : ''}</div>`;
}

function buttons({ back = true, next = true, nextLabel = 'Continue', disabled = false } = {}) {
  return `<div class="change-plan-actions">${back ? '<button class="button ghost" id="planBack" type="button">Back</button>' : '<span></span>'}${next ? `<button class="button primary" id="planNext" type="button" ${disabled ? 'disabled' : ''}>${esc(nextLabel)}</button>` : ''}</div>`;
}

function renderTiming() {
  const now = currentMonth();
  const following = nextMonth(now);
  return shell(`<span class="setup-kicker">Step 1 · Effective timing</span><h2 class="setup-title">When should the new plan take control?</h2><p class="setup-lead">A calendar change never forces a reset. Choose whether this revision changes the current month from today forward or becomes the plan when the next month begins.</p>
    <div class="change-timing-grid">
      <button class="change-choice ${draft.timing === 'now' ? 'active' : ''}" data-timing="now" type="button"><strong>Apply now</strong><span>Keep all spending/history already recorded in ${esc(monthLabel(now))}, but recalculate the remaining month around the new monthly targets.</span></button>
      <button class="change-choice ${draft.timing === 'next' ? 'active' : ''}" data-timing="next" type="button"><strong>Start ${esc(monthLabel(following))}</strong><span>Leave the current month untouched. The new plan takes over automatically on the first without another setup prompt.</span></button>
    </div>
    <div class="agent-note"><strong>Current rule:</strong> your approved plan continues indefinitely until another revision replaces it. Weeks and months do not create new assumptions by themselves.</div>${buttons({ back: false })}`);
}

function renderIncome() {
  return shell(`<span class="setup-kicker">Step 2 · Income</span><h2 class="setup-title">Has the amount coming in changed?</h2><p class="setup-lead">Enter the monthly income you now expect. It can go up, down, or stay exactly the same.</p><div class="setup-form-grid">${moneyField('changeIncome', 'Expected monthly income', draft.income, 'This replaces the income assumption for the new plan revision.')}</div>${buttons()}`);
}

function renderPriorities() {
  return shell(`<span class="setup-kicker">Step 3 · Protected priorities</span><h2 class="setup-title">What should the new income do?</h2><p class="setup-lead">Set the loan/savings target explicitly, then decide how much you want going back into the business. Nothing here changes automatically just because income changed.</p><div class="setup-form-grid">${moneyField('changeBusiness', 'Business reinvestment target', draft.reinvestment)}${moneyField('changeSavings', 'Loan / savings target', draft.savingsTarget, 'Highest-priority protected bucket.')}</div>${buttons()}`);
}

function renderSpending() {
  const p = plan();
  return shell(`<span class="setup-kicker">Step 4 · Spending strategy</span><h2 class="setup-title">Choose what should flex.</h2><p class="setup-lead">With the current entries, ${money(Math.max(0, p.personalAvailable))} is available for personal spending. You can keep business and loan targets exact, or choose a personal-spending target and let business reinvestment flex around it while the loan target stays protected.</p>
    <div class="setup-form-grid">${moneyField('changePersonal', 'Preferred personal spending', draft.desiredPersonal)}</div>
    <div class="setup-choice-grid"><label class="setup-choice"><input type="radio" name="changeBalanceMode" value="protected" ${draft.balanceMode === 'protected' ? 'checked' : ''}/><strong>Keep business + loan targets exact</strong><span>Personal spending becomes whatever remains.</span></label><label class="setup-choice"><input type="radio" name="changeBalanceMode" value="personal" ${draft.balanceMode === 'personal' ? 'checked' : ''}/><strong>Protect loan + target personal spending</strong><span>Business reinvestment becomes the flexible bucket.</span></label></div>
    <div class="agent-note">${p.desiredPersonalImpossible ? '<strong>This does not fit.</strong> The requested personal spending would require using protected loan money.' : p.overAllocated ? '<strong>This plan is over-allocated.</strong> Reduce a target or increase income.' : draft.balanceMode === 'personal' ? `<strong>Result:</strong> business reinvestment becomes ${money(p.businessTarget)} and loan/savings remains ${money(p.savingsTarget)}.` : `<strong>Result:</strong> business stays ${money(p.businessTarget)}, loan/savings stays ${money(p.savingsTarget)}, and personal spending becomes ${money(p.personalAvailable)}.`}</div>${buttons({ disabled: p.overAllocated || p.desiredPersonalImpossible })}`);
}

function delta(label, before, after) {
  const diff = Number(after || 0) - Number(before || 0);
  return `<div class="change-review-row"><span>${esc(label)}</span><strong>${money(before)} → ${money(after)}</strong><small class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff === 0 ? 'No change' : `${diff > 0 ? '+' : ''}${money(diff)}`}</small></div>`;
}

function renderReview() {
  const before = beforePlan();
  const after = plan();
  const effective = draft.timing === 'now' ? `Today, ${dateKey()}` : `${draft.effectiveMonth}-01`;
  return shell(`<span class="setup-kicker">Step 5 · Review</span><h2 class="setup-title">Approve the new operating plan.</h2><p class="setup-lead">Past transactions stay exactly where they are. This revision only changes the monthly assumptions used from the effective point forward.</p>
    <div class="change-review">${delta('Monthly income', before.income, after.income)}${delta('Business reinvestment', before.businessTarget, after.businessTarget)}${delta('Loan / savings', before.savingsTarget, after.savingsTarget)}${delta('Personal spending', before.personalAvailable, after.personalAvailable)}</div>
    <div class="setup-form-grid single"><div class="field"><label for="changeReason">Why are you changing the plan? <span class="muted">optional</span></label><input id="changeReason" maxlength="200" value="${esc(draft.reason)}" placeholder="Income increased, lowering loan target this month, increasing reinvestment…" /></div></div>
    <div class="agent-note"><strong>Effective:</strong> ${esc(effective)}. ${draft.timing === 'now' ? `Already-recorded ${esc(monthLabel(currentMonth()))} spending is preserved and the remaining month recalculates against these new targets.` : `${esc(monthLabel(currentMonth()))} remains untouched. ${esc(monthLabel(draft.effectiveMonth))} will inherit this plan automatically.`}</div>${buttons({ nextLabel: 'Approve plan change' })}`);
}

function readStep() {
  if (!draft) return;
  if (step === 1) draft.income = Number($('#changeIncome')?.value || 0);
  if (step === 2) {
    draft.reinvestment = Number($('#changeBusiness')?.value || 0);
    draft.savingsTarget = Number($('#changeSavings')?.value || 0);
  }
  if (step === 3) {
    draft.desiredPersonal = Number($('#changePersonal')?.value || 0);
    draft.balanceMode = $('input[name="changeBalanceMode"]:checked')?.value === 'personal' ? 'personal' : 'protected';
  }
  if (step === 4) draft.reason = $('#changeReason')?.value || '';
}

async function chooseTiming(value) {
  const target = value === 'next' ? nextMonth(currentMonth()) : currentMonth();
  await loadBase(target);
  draft.timing = value === 'next' ? 'next' : 'now';
  draft.effectiveMonth = target;
  render();
}

async function saveRevision() {
  readStep();
  const p = plan();
  const payload = {
    effectiveMonth: draft.effectiveMonth,
    effectiveDate: draft.timing === 'now' ? dateKey() : `${draft.effectiveMonth}-01`,
    applyToMonth: draft.timing === 'now',
    income: p.income,
    housing: draft.housing,
    expenses: draft.expenses,
    reinvestment: p.businessTarget,
    savingsTarget: p.savingsTarget,
    desiredPersonal: draft.desiredPersonal,
    balanceMode: draft.balanceMode,
    planningWeeks: draft.planningWeeks,
    payoutDaysPerWeek: draft.payoutDaysPerWeek,
    reason: draft.reason,
  };
  await api('/api/plan/mutate', { method: 'POST', body: JSON.stringify({ action: 'saveRevision', payload }) });
  window.location.reload();
}

function bind() {
  $$('[data-timing]').forEach((button) => button.addEventListener('click', () => chooseTiming(button.dataset.timing).catch((error) => alert(error.message))));
  $('#planBack')?.addEventListener('click', () => { readStep(); step = Math.max(0, step - 1); render(); });
  $('#planNext')?.addEventListener('click', async () => {
    readStep();
    if (step < stepNames.length - 1) { step += 1; render(); return; }
    try { await saveRevision(); } catch (error) { alert(error.message); }
  });
  $$('input[name="changeBalanceMode"]').forEach((input) => input.addEventListener('change', () => { readStep(); render(); }));
}

function render() {
  if (!pageOpen || !draft) return;
  setChrome();
  const view = $('#view');
  if (!view) return;
  view.innerHTML = step === 0 ? renderTiming() : step === 1 ? renderIncome() : step === 2 ? renderPriorities() : step === 3 ? renderSpending() : renderReview();
  bind();
}

async function openPage() {
  pageOpen = true;
  step = 0;
  try {
    await loadBase(currentMonth());
    render();
  } catch (error) {
    const view = $('#view');
    if (view) view.innerHTML = `<article class="card empty-state"><h2>Set up a budget first</h2><p>${esc(error.message)}</p></article>`;
  }
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-view], [data-cards-nav], [data-subscriptions-nav]')) {
    pageOpen = false;
    $$('[data-plan-change-nav]').forEach((button) => button.classList.remove('active'));
  }
}, true);

function boot() {
  injectNavigation();
  window.addEventListener('pageshow', injectNavigation);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

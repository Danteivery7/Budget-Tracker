import { calculateMonth, monthLabel } from './engine.js';
import { analyzePurchase } from './purchase-engine.js';

const pad = (n) => String(n).padStart(2, '0');
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const money = (value) => {
  const n = Number(value || 0);
  const abs = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  return n < 0 ? `-${abs}` : abs;
};
const moneyInput = (value) => {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

function getState() {
  try { return JSON.parse(localStorage.getItem('budget_tracker_last_state') || 'null'); } catch { return null; }
}

function cloneState(state) {
  return typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state));
}

function parsePriceFromText(text) {
  const match = String(text || '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  return match ? Number(match[1].replaceAll(',', '')) : 0;
}

function setPlannerChrome() {
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === 'planner'));
  const eyebrow = $('#pageEyebrow');
  const title = $('#pageTitle');
  if (eyebrow) eyebrow.textContent = 'PLANNER';
  if (title) title.textContent = 'What-if purchase planner';
}

function explanation(item, result, month) {
  const name = item.trim() || 'this purchase';
  const fixedNote = month.fixedTotal > 0 ? ` Your ${money(month.fixedTotal)} in fixed costs stays protected and is not treated as purchase money.` : '';

  if (result.status === 'within-spending') {
    return `${name} costs ${money(result.cost)} and fits inside the ${money(result.personalAvailable)} you currently have available for personal spending. Pay it from your regular checking/spending money. After the purchase, you would have ${money(result.personalAfter)} left for discretionary spending this month. Your business reinvestment stays at ${money(result.businessAfter)}, and your loan/savings target stays fully protected at ${money(result.savingsAfter)}.${fixedNote}`;
  }

  if (result.status === 'business-impact') {
    return `${name} costs ${money(result.cost)}. Your personal spending bucket can cover ${money(result.fromPersonal)}, leaving a ${money(result.personalShortfall)} checking-budget shortfall. To keep the loan payoff fully protected, transfer ${money(result.fromBusiness)} from the business/reinvestment bucket into checking before buying it. That would lower this month’s reinvestment from ${money(result.reinvestmentTarget)} to ${money(result.businessAfter)}. Your personal discretionary balance would then be ${money(result.personalAfter)}, so I would treat additional non-essential spending as off-limits unless you deliberately lower the business target again. Your loan/savings target remains untouched at ${money(result.savingsAfter)}.${fixedNote}`;
  }

  if (result.status === 'loan-risk') {
    return `${name} costs ${money(result.cost)}. It would use all ${money(result.fromPersonal)} available personal spending and ${money(result.fromBusiness)} from the business/reinvestment bucket, and it would still require ${money(result.fromSavings)} from the money reserved for the loan. That would reduce the loan/savings target from ${money(result.savingsTarget)} to ${money(result.savingsAfter)}. Because the loan is your highest-priority bucket, I would not treat this purchase as affordable under the current plan. The safer move is to wait, raise income, lower the purchase cost, or intentionally change the monthly targets before spending.${fixedNote}`;
  }

  return `${name} costs ${money(result.cost)}, which is more than your current personal, business/reinvestment, and loan/savings buckets can cover together. After exhausting those buckets, you would still be short ${money(result.unfunded)}. This purchase does not fit the current month and should not be made from the planned cash flow.${fixedNote}`;
}

function scenarioState(baseState, monthKey) {
  const next = cloneState(baseState);
  const cfg = next.months?.[monthKey];
  if (!cfg) return next;
  cfg.income = Number($('#plannerIncome')?.value || cfg.income || 0);
  cfg.reinvestment = Number($('#plannerReinvestment')?.value || cfg.reinvestment || 0);
  cfg.savingsTarget = Number($('#plannerSavings')?.value || cfg.savingsTarget || 0);
  return next;
}

function renderScenarioSummary(baseState, monthKey) {
  const holder = $('#plannerScenarioSummary');
  if (!holder) return null;
  const scenario = scenarioState(baseState, monthKey);
  const month = calculateMonth(scenario, monthKey);
  const allocation = month.allocation;
  holder.innerHTML = `
    <div class="preview-cell"><span>MONTHLY INCOME</span><strong>${money(month.income)}</strong></div>
    <div class="preview-cell"><span>BUSINESS TARGET</span><strong>${money(month.reinvestment)}</strong></div>
    <div class="preview-cell"><span>LOAN / SAVINGS</span><strong>${money(month.savingsTarget)}</strong></div>
    <div class="preview-cell"><span>PERSONAL TARGET</span><strong>${money(allocation.personalFromIncome)}</strong></div>
    <div class="preview-cell"><span>PERSONAL LEFT NOW</span><strong>${money(Math.max(0, month.remaining))}</strong></div>`;
  return month;
}

function analyzeCurrent(baseState, monthKey) {
  const month = renderScenarioSummary(baseState, monthKey);
  const resultHolder = $('#plannerResult');
  if (!month || !resultHolder) return;
  const item = $('#plannerItem')?.value || '';
  let price = Number($('#plannerPrice')?.value || 0);
  if (price <= 0) {
    price = parsePriceFromText(item);
    if (price > 0 && $('#plannerPrice')) $('#plannerPrice').value = moneyInput(price);
  }
  if (price <= 0) {
    resultHolder.innerHTML = '<div class="callout"><span class="callout-dot"></span><div><strong>Ready for a what-if</strong><span>Enter the item and its price. You can also type the price directly in the description, like “G923 setup for $400.”</span></div></div>';
    return;
  }

  const result = analyzePurchase({
    price,
    personalAvailable: Math.max(0, month.remaining),
    reinvestmentTarget: month.reinvestment,
    savingsTarget: month.savingsTarget,
  });

  const tone = result.status === 'within-spending' ? '' : result.status === 'business-impact' ? 'warn' : 'bad';
  const label = result.status === 'within-spending'
    ? 'Fits personal spending'
    : result.status === 'business-impact'
      ? 'Requires business money'
      : result.status === 'loan-risk'
        ? 'Touches protected loan money'
        : 'Not fundable';

  resultHolder.innerHTML = `
    <div class="callout ${tone}"><span class="callout-dot"></span><div><strong>${label}</strong><span>${esc(explanation(item, result, month))}</span></div></div>
    <div class="preview-strip" style="margin-top:14px">
      <div class="preview-cell"><span>FROM CHECKING</span><strong>${money(result.fromPersonal)}</strong></div>
      <div class="preview-cell"><span>FROM BUSINESS</span><strong>${money(result.fromBusiness)}</strong></div>
      <div class="preview-cell"><span>FROM LOAN / SAVINGS</span><strong>${money(result.fromSavings)}</strong></div>
      <div class="preview-cell"><span>BUSINESS AFTER</span><strong>${money(result.businessAfter)}</strong></div>
      <div class="preview-cell"><span>LOAN / SAVINGS AFTER</span><strong>${money(result.savingsAfter)}</strong></div>
    </div>`;
}

function renderPlanner(monthKey = currentMonth()) {
  setPlannerChrome();
  const state = getState();
  const view = $('#view');
  if (!view) return;
  const cfg = state?.months?.[monthKey];

  if (!state || !cfg) {
    view.innerHTML = `<article class="card empty-state"><h2>Set up ${esc(monthLabel(monthKey))} first</h2><p>The planner needs that month’s income and protected targets before it can tell you where a purchase should come from.</p><button class="button primary" type="button" data-view="month">Set up month</button></article>`;
    return;
  }

  const saved = calculateMonth(state, monthKey);
  view.innerHTML = `
    <article class="card form-card">
      <div class="section-head"><div><h2>Run a purchase through your money priorities</h2><p>Checking first, business/reinvestment second, loan/savings last. Nothing here changes your saved budget; this is a what-if workspace.</p></div><input id="plannerMonth" type="month" value="${esc(monthKey)}" aria-label="Planner month" /></div>
      <form id="purchasePlannerForm">
        <div class="form-grid">
          <div class="field"><label for="plannerItem">What are you thinking about buying?</label><input id="plannerItem" type="text" maxlength="300" placeholder="G923 + chair for $400, or paste a product link" /><small>Name, link, or a normal sentence is fine.</small></div>
          <div class="field"><label for="plannerPrice">Purchase price</label><div class="money-input"><span>$</span><input id="plannerPrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" /></div><small>If you put a $ price in the description, the planner can pick it up.</small></div>
        </div>

        <div class="section-head" style="margin-top:28px"><div><h2>Scenario targets</h2><p>Change these to test a different month or a mid-month decision without rewriting the saved plan.</p></div></div>
        <div class="form-grid">
          <div class="field"><label for="plannerIncome">Monthly income</label><div class="money-input"><span>$</span><input id="plannerIncome" type="number" min="0" step="0.01" value="${moneyInput(saved.income)}" /></div></div>
          <div class="field"><label for="plannerReinvestment">Business reinvestment target</label><div class="money-input"><span>$</span><input id="plannerReinvestment" type="number" min="0" step="0.01" value="${moneyInput(saved.reinvestment)}" /></div></div>
          <div class="field"><label for="plannerSavings">Loan / savings target</label><div class="money-input"><span>$</span><input id="plannerSavings" type="number" min="0" step="0.01" value="${moneyInput(saved.savingsTarget)}" /></div></div>
        </div>

        <div id="plannerScenarioSummary" class="preview-strip" style="margin-top:18px"></div>
        <div class="form-actions"><button class="button primary" type="submit">Analyze purchase</button></div>
      </form>
      <div id="plannerResult" style="margin-top:18px"></div>
    </article>`;

  $('#plannerMonth')?.addEventListener('change', (event) => renderPlanner(event.target.value));
  ['#plannerIncome', '#plannerReinvestment', '#plannerSavings'].forEach((selector) => {
    $(selector)?.addEventListener('input', () => {
      renderScenarioSummary(state, monthKey);
      if (Number($('#plannerPrice')?.value || 0) > 0) analyzeCurrent(state, monthKey);
    });
  });
  $('#purchasePlannerForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    analyzeCurrent(state, monthKey);
  });
  renderScenarioSummary(state, monthKey);
  analyzeCurrent(state, monthKey);
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-view="planner"]');
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  renderPlanner();
}, true);

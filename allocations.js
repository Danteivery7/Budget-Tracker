(() => {
  const previousFetch = window.fetch.bind(window);
  const pad = (n) => String(n).padStart(2, '0');
  const currentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
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

  function getState() {
    try { return JSON.parse(localStorage.getItem('budget_tracker_last_state') || 'null'); } catch { return null; }
  }

  function daysInMonth(monthKey) {
    const [y, m] = String(monthKey || '').split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function sumExpenses(expenses = []) {
    return round(expenses.reduce((sum, item) => sum + Number(item?.amount || 0), 0));
  }

  function dailyNet(entry = {}) {
    return round(Math.max(0, Number(entry?.amount || 0)) - Math.max(0, Number(entry?.refund || 0)));
  }

  function trackedTotals(state, monthKey, startDay = 1) {
    let net = 0;
    for (const [date, entry] of Object.entries(state?.dailySpending || {})) {
      if (!date.startsWith(`${monthKey}-`) || Number(date.slice(-2)) < startDay) continue;
      net += dailyNet(entry);
    }
    return round(net);
  }

  function trackingSettings(cfg = {}, monthKey, spendable = 0) {
    const dim = daysInMonth(monthKey);
    const raw = Number(cfg?.trackingStartDay || 1);
    const startDay = Math.min(dim, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 1));
    const startMode = cfg?.trackingStartMode === 'actual' ? 'actual' : 'fresh';
    const priorNetSpending = round(Number(cfg?.priorNetSpending || 0));
    const base = Number(spendable || 0) / dim;
    const openingAdjustment = startDay <= 1 ? 0 : startMode === 'actual' ? priorNetSpending : round(base * (startDay - 1));
    return { startDay, startMode, priorNetSpending, openingAdjustment };
  }

  function monthAllocation(cfg = {}, carryIn = 0) {
    const income = round(Number(cfg?.income || 0));
    const housing = round(Number(cfg?.housing || 0));
    const fixedCosts = round(housing + sumExpenses(cfg?.expenses || []));
    const reinvestment = round(Number(cfg?.reinvestment || 0));
    const savingsTarget = round(Number(cfg?.savingsTarget || 0));
    const planningWeeks = Math.max(1, Number(cfg?.planningWeeks || 4));
    const payoutDaysPerWeek = Math.max(1, Number(cfg?.payoutDaysPerWeek || 5));
    const payoutDays = planningWeeks * payoutDaysPerWeek;
    const personalFromIncome = round(income - fixedCosts - reinvestment - savingsTarget);
    return {
      income,
      housing,
      fixedCosts,
      reinvestment,
      savingsTarget,
      planningWeeks,
      payoutDaysPerWeek,
      payoutDays,
      personalFromIncome,
      carryIn: round(carryIn),
      spendable: round(personalFromIncome + carryIn),
      weekly: {
        income: round(income / planningWeeks),
        reinvestment: round(reinvestment / planningWeeks),
        savingsTarget: round(savingsTarget / planningWeeks),
        fixedCosts: round(fixedCosts / planningWeeks),
        personalSpending: round(personalFromIncome / planningWeeks),
      },
      perPayingDay: {
        income: round(income / payoutDays),
        reinvestment: round(reinvestment / payoutDays),
        savingsTarget: round(savingsTarget / payoutDays),
        fixedCosts: round(fixedCosts / payoutDays),
        personalSpending: round(personalFromIncome / payoutDays),
      },
      overAllocated: personalFromIncome < -0.005,
    };
  }

  function carryInto(state, targetMonthKey) {
    const keys = Object.keys(state?.months || {}).filter((key) => key < targetMonthKey).sort();
    let carry = 0;
    for (const key of keys) {
      const cfg = state.months[key] || {};
      const allocation = monthAllocation(cfg, carry);
      const tracking = trackingSettings(cfg, key, allocation.spendable);
      carry = round(allocation.spendable - tracking.openingAdjustment - trackedTotals(state, key, tracking.startDay));
    }
    return round(carry);
  }

  function suggestedSavings(state, monthKey) {
    if (state?.months?.[monthKey]) return Number(state.months[monthKey].savingsTarget || 0);
    const keys = Object.keys(state?.months || {}).filter((key) => key < monthKey).sort();
    return Number(keys.length ? state.months[keys.at(-1)]?.savingsTarget || 0 : 0);
  }

  function readMonthExpenses() {
    return [...document.querySelectorAll('#stableMonthExpenses .expense-row')].map((row) => ({
      amount: Number(row.querySelector('[data-field="amount"]')?.value || 0),
    }));
  }

  function readMonthAllocation(monthKey) {
    const state = getState();
    const carry = state ? carryInto(state, monthKey) : 0;
    const cfg = {
      income: Number(document.querySelector('#stableIncome')?.value || 0),
      housing: Number(document.querySelector('#stableHousing')?.value || 0),
      reinvestment: Number(document.querySelector('#stableReinvestment')?.value || 0),
      savingsTarget: Number(document.querySelector('#stableSavingsTarget')?.value || 0),
      planningWeeks: 4,
      payoutDaysPerWeek: 5,
      expenses: readMonthExpenses(),
    };
    return { state, cfg, allocation: monthAllocation(cfg, carry) };
  }

  function currentTrackingOpening(monthKey, spendable) {
    const date = document.querySelector('#stableTrackingStartDate')?.value || `${monthKey}-01`;
    const day = date.startsWith(`${monthKey}-`) ? Number(date.slice(-2)) : 1;
    const mode = day <= 1 ? 'fresh' : (document.querySelector('#stableTrackingMode')?.value === 'actual' ? 'actual' : 'fresh');
    const prior = mode === 'actual' ? Number(document.querySelector('#stablePriorNet')?.value || 0) : 0;
    return trackingSettings({ trackingStartDay: day, trackingStartMode: mode, priorNetSpending: prior }, monthKey, spendable).openingAdjustment;
  }

  function setHtmlIfChanged(element, html) {
    if (element && element.innerHTML !== html) element.innerHTML = html;
  }

  function routeCells(allocation, period = 'weekly') {
    const set = period === 'daily' ? allocation.perPayingDay : allocation.weekly;
    const fixed = allocation.fixedCosts > 0
      ? `<div class="preview-cell"><span>FIXED-COST RESERVE</span><strong>${money(set.fixedCosts)}</strong></div>`
      : '';
    return `
      <div class="preview-cell"><span>${period === 'daily' ? 'INCOME / PAYING DAY' : 'FRIDAY INCOME'}</span><strong>${money(set.income)}</strong></div>
      <div class="preview-cell"><span>BUSINESS ACCOUNT</span><strong>${money(set.reinvestment)}</strong></div>
      <div class="preview-cell"><span>SAVINGS / LOAN</span><strong>${money(set.savingsTarget)}</strong></div>
      ${fixed}
      <div class="preview-cell"><span>REGULAR SPENDING</span><strong>${money(set.personalSpending)}</strong></div>`;
  }

  function renderMonthPlanner() {
    const form = document.querySelector('#stableMonthForm');
    const picker = document.querySelector('#stableMonthPicker');
    const preview = document.querySelector('#stableMonthPreview');
    const planner = document.querySelector('#stableAllocationPlanner');
    if (!form || !picker || !preview || !planner) return;
    const monthKey = picker.value;
    const { allocation } = readMonthAllocation(monthKey);
    const opening = currentTrackingOpening(monthKey, allocation.spendable);
    const availableFromStart = round(allocation.spendable - opening);

    const previewHtml = `
      <div class="preview-cell"><span>CARRY IN</span><strong>${money(allocation.carryIn, true)}</strong></div>
      <div class="preview-cell"><span>FIXED COSTS</span><strong>${money(allocation.fixedCosts)}</strong></div>
      <div class="preview-cell"><span>AVAILABLE FROM START</span><strong>${money(availableFromStart)}</strong></div>
      <div class="preview-cell"><span>BASE DAILY LIMIT</span><strong>${money(allocation.spendable / daysInMonth(monthKey))}</strong></div>`;
    setHtmlIfChanged(preview, previewHtml);

    const plannerHtml = `
      <div class="section-head"><div><h2>Friday money routing</h2><p>Your monthly targets automatically become four Friday transfers and 20 weekday earning slices.</p></div></div>
      ${allocation.overAllocated ? '<div class="callout bad"><span class="callout-dot"></span><div><strong>Your targets exceed your income</strong><span>Lower reinvestment, savings / loan, or fixed costs before relying on the spending figure.</span></div></div>' : ''}
      <div class="preview-strip">${routeCells(allocation, 'weekly')}</div>
      <div class="section-head" style="margin-top:18px"><div><h2>Per paying weekday</h2><p>This is the same plan divided across Monday–Friday for a four-week planning cycle.</p></div></div>
      <div class="preview-strip">${routeCells(allocation, 'daily')}</div>
      <div class="callout"><span class="callout-dot"></span><div><strong>Carryover stays separate</strong><span>Unused spending money from an earlier month increases your available balance, but it is not routed back through the next Friday split.</span></div></div>`;
    setHtmlIfChanged(planner, plannerHtml);
  }

  function enhanceMonth() {
    const form = document.querySelector('#stableMonthForm');
    const picker = document.querySelector('#stableMonthPicker');
    const reinvest = document.querySelector('#stableReinvestment');
    if (!form || !picker || !reinvest) return;

    if (!document.querySelector('#stableSavingsTarget')) {
      const state = getState();
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = `<label for="stableSavingsTarget">Loan / savings target</label><div class="money-input"><span>$</span><input id="stableSavingsTarget" type="number" min="0" step="0.01" inputmode="decimal" value="${moneyInput(suggestedSavings(state, picker.value))}" required /></div><small>Protected money sent to savings or used toward debt payoff.</small>`;
      reinvest.closest('.form-grid')?.appendChild(field);
    }

    if (!document.querySelector('#stableAllocationPlanner')) {
      const planner = document.createElement('div');
      planner.id = 'stableAllocationPlanner';
      planner.style.marginTop = '28px';
      document.querySelector('#stableMonthPreview')?.insertAdjacentElement('beforebegin', planner);
    }

    if (!form.dataset.allocationBound) {
      form.dataset.allocationBound = 'true';
      form.addEventListener('input', () => queueMicrotask(renderMonthPlanner));
      form.addEventListener('change', () => queueMicrotask(renderMonthPlanner));
      form.addEventListener('click', () => setTimeout(renderMonthPlanner, 0));
    }
    renderMonthPlanner();
  }

  function enhanceToday() {
    if (document.querySelector('#pageEyebrow')?.textContent.trim() !== 'TODAY') return;
    const state = getState();
    const cfg = state?.months?.[currentMonth()];
    if (!cfg) {
      const emptyCopy = document.querySelector('#view .empty-state p');
      if (emptyCopy && emptyCopy.textContent.includes('reinvestment target')) {
        emptyCopy.textContent = 'Enter this month’s income, housing, fixed expenses, reinvestment target, and loan / savings target. After that, the tracker will calculate your daily spending allowance and Friday routing plan automatically.';
      }
      return;
    }
    const allocation = monthAllocation(cfg, carryInto(state, currentMonth()));
    const summary = document.querySelector('#view .summary-grid');
    if (summary && !document.querySelector('#allocationSavingsMetric')) {
      const card = document.createElement('article');
      card.id = 'allocationSavingsMetric';
      card.className = 'card metric-card';
      card.innerHTML = `<div class="metric-label">Savings / loan</div><div class="metric-value">${money(allocation.savingsTarget)}</div><div class="metric-foot">Protected before discretionary spending</div>`;
      summary.insertBefore(card, summary.lastElementChild || null);
    }

    const monthlySection = [...document.querySelectorAll('#view .section-card')].find((el) => el.textContent.includes('Monthly discretionary budget'));
    const monthlyCopy = monthlySection?.querySelector('.section-head p');
    if (monthlyCopy) monthlyCopy.textContent = `${money(allocation.spendable)} available after fixed costs, reinvestment, savings / loan, and carryover.`;

    let panel = document.querySelector('#allocationTodayPanel');
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'allocationTodayPanel';
      panel.className = 'card section-card';
      if (monthlySection) monthlySection.insertAdjacentElement('beforebegin', panel);
      else document.querySelector('#view')?.appendChild(panel);
    }
    const panelHtml = `
      <div class="section-head"><div><h2>This Friday’s routing plan</h2><p>Four-week plan: paid on five weekdays, then split the week’s income on Friday.</p></div><strong>${money(allocation.weekly.income)}</strong></div>
      <div class="preview-strip">${routeCells(allocation, 'weekly')}</div>
      <div class="callout"><span class="callout-dot"></span><div><strong>Each paying weekday: ${money(allocation.perPayingDay.income)} total</strong><span>${money(allocation.perPayingDay.reinvestment)} business · ${money(allocation.perPayingDay.savingsTarget)} savings / loan${allocation.fixedCosts > 0 ? ` · ${money(allocation.perPayingDay.fixedCosts)} fixed-cost reserve` : ''} · ${money(allocation.perPayingDay.personalSpending)} personal spending.</span></div></div>`;
    setHtmlIfChanged(panel, panelHtml);
  }

  function enhanceAll() {
    enhanceMonth();
    enhanceToday();
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    let nextInit = init;
    if (url.includes('/api/budget/mutate') && typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (body?.action === 'saveMonth') {
          body.payload ||= {};
          const savings = document.querySelector('#stableSavingsTarget');
          if (savings) body.payload.savingsTarget = Number(savings.value || 0);
          body.payload.planningWeeks = 4;
          body.payload.payoutDaysPerWeek = 5;
          nextInit = { ...init, body: JSON.stringify(body) };
        }
      } catch { /* leave request unchanged */ }
    }
    const response = await previousFetch(input, nextInit);
    if (url.includes('/api/budget/state') || url.includes('/api/budget/mutate')) setTimeout(enhanceAll, 0);
    return response;
  };

  const observer = new MutationObserver(() => queueMicrotask(enhanceAll));
  const view = document.querySelector('#view');
  if (view) observer.observe(view, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(enhanceAll, 0), true);
  document.addEventListener('change', () => setTimeout(enhanceAll, 0), true);
  setTimeout(enhanceAll, 80);
})();

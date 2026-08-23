(() => {
  const originalFetch = window.fetch.bind(window);
  let latestState = null;

  const pad = (n) => String(n).padStart(2, '0');
  const currentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  const currentDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const dim = (monthKey) => {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  };
  const dateFor = (monthKey, day) => `${monthKey}-${pad(day)}`;

  function settingsFromUi(month) {
    const date = document.querySelector('#trackingStartDate')?.value;
    const startDay = date?.startsWith(`${month}-`) ? Number(date.slice(-2)) : 1;
    const mode = startDay === 1 ? 'fresh' : (document.querySelector('#trackingStartMode')?.value === 'actual' ? 'actual' : 'fresh');
    const prior = mode === 'actual' ? Number(document.querySelector('#priorNetSpending')?.value || 0) : 0;
    return { trackingStartDay: startDay, trackingStartMode: mode, priorNetSpending: prior };
  }

  window.fetch = async (input, init = {}) => {
    let nextInit = init;
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('/api/budget/mutate') && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (body?.action === 'saveMonth' && body?.payload?.month) {
          body.payload = { ...body.payload, ...settingsFromUi(body.payload.month) };
          nextInit = { ...init, body: JSON.stringify(body) };
        }
      } catch { /* keep original request */ }
    }
    const response = await originalFetch(input, nextInit);
    if (url.includes('/api/budget/state') || url.includes('/api/budget/mutate')) {
      try {
        const data = await response.clone().json();
        if (data?.state) latestState = data.state;
      } catch { /* ignore */ }
    }
    return response;
  };

  function injectStyle() {
    if (document.querySelector('#trackingStartStyles')) return;
    const style = document.createElement('style');
    style.id = 'trackingStartStyles';
    style.textContent = `
      .tracking-start-panel{margin-top:22px;padding:18px;border:1px solid rgba(148,163,184,.16);border-radius:18px;background:rgba(15,23,42,.35)}
      .tracking-start-panel h3{margin:0 0 5px;font-size:1rem}.tracking-start-panel>p{margin:0 0 16px;color:var(--muted,#8f99ad);font-size:.82rem;line-height:1.45}
      .tracking-start-grid{display:grid;grid-template-columns:1fr 1.3fr;gap:14px}.tracking-start-panel select{width:100%;min-height:46px;border-radius:12px;padding:0 12px;background:rgba(15,23,42,.65);color:inherit;border:1px solid rgba(148,163,184,.18)}
      .tracking-explain{margin-top:12px;padding:11px 12px;border-radius:12px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.16);font-size:.78rem;line-height:1.45;color:var(--muted,#a7b0c0)}
      .pretrack-day{opacity:.35!important;cursor:not-allowed!important}.future-day{opacity:.42!important;cursor:not-allowed!important}
      @media(max-width:700px){.tracking-start-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function hasEarlierEntries(month) {
    return Object.keys(latestState?.dailySpending || {}).some((date) => date.startsWith(`${month}-`));
  }

  function defaultDay(month, cfg) {
    if (cfg?.trackingStartDay) return Number(cfg.trackingStartDay);
    if (cfg && hasEarlierEntries(month)) return 1;
    if (month === currentMonth()) return new Date().getDate();
    return 1;
  }

  function enhanceMonth() {
    const form = document.querySelector('#monthForm');
    const picker = document.querySelector('#monthPicker');
    if (!form || !picker || document.querySelector('#trackingStartPanel')) return;
    injectStyle();
    const month = picker.value;
    if (!month) return;
    const cfg = latestState?.months?.[month];
    const startDay = Math.min(dim(month), Math.max(1, defaultDay(month, cfg)));
    const mode = cfg?.trackingStartMode === 'actual' ? 'actual' : 'fresh';
    const firstGrid = form.querySelector('.form-grid');
    if (!firstGrid) return;

    const panel = document.createElement('section');
    panel.id = 'trackingStartPanel';
    panel.className = 'tracking-start-panel';
    panel.innerHTML = `
      <h3>When should tracking begin?</h3>
      <p>This matters only if your first month starts after day 1. It prevents untracked earlier days from being mistaken for $0-spend days.</p>
      <div class="tracking-start-grid">
        <div class="field"><label for="trackingStartDate">Tracking start date</label><input id="trackingStartDate" type="date" /></div>
        <div class="field"><label for="trackingStartMode">Earlier days</label><select id="trackingStartMode"><option value="fresh">Start fresh on this date (recommended)</option><option value="actual">Use my actual earlier net spending</option></select></div>
      </div>
      <div id="priorNetField" class="field" style="margin-top:12px;display:none"><label for="priorNetSpending">Earlier net discretionary spending</label><div class="money-input"><span>$</span><input id="priorNetSpending" type="number" step="0.01" inputmode="decimal" value="0" /></div><small>Spending minus refunds before the tracking start date. A negative number means refunds exceeded spending.</small></div>
      <div id="trackingExplanation" class="tracking-explain"></div>`;
    firstGrid.insertAdjacentElement('afterend', panel);

    const dateInput = document.querySelector('#trackingStartDate');
    dateInput.min = dateFor(month, 1);
    dateInput.max = month === currentMonth() ? currentDate() : dateFor(month, dim(month));
    dateInput.value = dateFor(month, startDay);
    document.querySelector('#trackingStartMode').value = startDay === 1 ? 'fresh' : mode;
    document.querySelector('#priorNetSpending').value = Number(cfg?.priorNetSpending || 0);

    const update = () => {
      const day = Number(dateInput.value.slice(-2) || 1);
      const select = document.querySelector('#trackingStartMode');
      if (day === 1) select.value = 'fresh';
      select.disabled = day === 1;
      const actual = day > 1 && select.value === 'actual';
      document.querySelector('#priorNetField').style.display = actual ? '' : 'none';
      const explain = document.querySelector('#trackingExplanation');
      if (day === 1) {
        explain.textContent = 'Day 1 start: the tracker behaves normally from the beginning of the month.';
      } else if (actual) {
        explain.textContent = 'Exact mode: the tracker uses the earlier net spending you enter to reconstruct your true cumulative buffer or deficit on the start date.';
      } else {
        explain.textContent = `Fresh-start mode: days 1–${day - 1} are treated as already on pace, not as $0-spend days. Your first tracked day starts with one normal daily allowance, then unused money rolls forward from there.`;
      }
    };
    dateInput.addEventListener('change', update);
    document.querySelector('#trackingStartMode').addEventListener('change', update);
    update();
  }

  function enhanceCalendarGuards() {
    const picker = document.querySelector('#historyMonthPicker');
    if (!picker || !latestState) return;
    const month = picker.value;
    const cfg = latestState.months?.[month];
    const startDay = Number(cfg?.trackingStartDay || 1);
    const today = currentDate();
    document.querySelectorAll('.calendar-day[data-date]').forEach((button) => {
      const date = button.dataset.date;
      const day = Number(date.slice(-2));
      button.classList.toggle('pretrack-day', Boolean(cfg && day < startDay));
      button.classList.toggle('future-day', date > today);
      if (cfg && day < startDay) button.title = 'Before tracking began';
      else if (date > today) button.title = 'Future days cannot be logged yet';
    });
  }

  const money = (value) => Math.abs(Number(value || 0)).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  });

  function knownNetSpending(month, cfg) {
    let tracked = 0;
    const startDay = Number(cfg?.trackingStartDay || 1);
    Object.entries(latestState?.dailySpending || {}).forEach(([date, entry]) => {
      if (!date.startsWith(`${month}-`) || Number(date.slice(-2)) < startDay) return;
      tracked += Number(entry?.amount || 0) - Number(entry?.refund || 0);
    });
    const earlier = cfg?.trackingStartMode === 'actual' ? Number(cfg?.priorNetSpending || 0) : 0;
    return Math.round((tracked + earlier + Number.EPSILON) * 100) / 100;
  }

  function enhanceMidMonthLabels() {
    if (!latestState) return;
    const current = currentMonth();
    const todayCfg = latestState.months?.[current];
    if (todayCfg && Number(todayCfg.trackingStartDay || 1) > 1 && document.querySelector('#pageEyebrow')?.textContent.trim() === 'TODAY') {
      const net = knownNetSpending(current, todayCfg);
      const summaryLabels = [...document.querySelectorAll('#view .summary-grid .metric-label')];
      const remaining = summaryLabels.find((el) => el.textContent.trim() === 'Money remaining');
      const foot = remaining?.closest('.metric-card')?.querySelector('.metric-foot');
      const startDate = dateFor(current, Number(todayCfg.trackingStartDay));
      if (foot) {
        const next = net < 0 ? `${money(net)} net gain since ${startDate}` : `${money(net)} net spending since ${startDate}`;
        if (foot.textContent !== next) foot.textContent = next;
      }
      const progress = document.querySelector('#view .section-card .progress-meta span:first-child');
      if (progress) {
        const next = net < 0 ? `${money(net)} net gain since tracking began` : `${money(net)} net spending since tracking began`;
        if (progress.textContent !== next) progress.textContent = next;
      }
    }

    const historyMonth = document.querySelector('#historyMonthPicker')?.value;
    const historyCfg = historyMonth ? latestState.months?.[historyMonth] : null;
    if (historyCfg && Number(historyCfg.trackingStartDay || 1) > 1) {
      const net = knownNetSpending(historyMonth, historyCfg);
      const labels = [...document.querySelectorAll('#view .summary-grid .metric-label')];
      const spending = labels.find((el) => ['Spent', 'Net spending'].includes(el.textContent.trim()));
      const card = spending?.closest('.metric-card');
      const value = card?.querySelector('.metric-value');
      const foot = card?.querySelector('.metric-foot');
      if (spending) {
        const nextLabel = net < 0 ? 'Net gain' : 'Net spending';
        if (spending.textContent !== nextLabel) spending.textContent = nextLabel;
      }
      if (value) {
        const next = money(net);
        if (value.textContent !== next) value.textContent = next;
      }
      if (foot) {
        const next = historyCfg.trackingStartMode === 'actual'
          ? 'Known net spending, including your pre-start total'
          : `Recorded since tracking began on day ${historyCfg.trackingStartDay}`;
        if (foot.textContent !== next) foot.textContent = next;
      }
    }
  }

  function enhance() {
    enhanceMonth();
    enhanceCalendarGuards();
    enhanceMidMonthLabels();
  }

  const observer = new MutationObserver(() => queueMicrotask(enhance));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', (event) => {
    const dayButton = event.target.closest('.calendar-day[data-date]');
    if (!dayButton) return;
    const date = dayButton.dataset.date;
    const cfg = latestState?.months?.[date.slice(0, 7)];
    const beforeStart = cfg && Number(date.slice(-2)) < Number(cfg.trackingStartDay || 1);
    const future = date > currentDate();
    if (beforeStart || future) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();

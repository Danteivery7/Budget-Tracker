(() => {
  let state = null;
  let engine = null;
  let cardsOpen = false;
  let selectedMonth = monthKey();
  let editingCardId = '';
  let editingRecurringId = '';
  let editingTransactionId = '';
  let baseSyncNeeded = false;
  let internalSync = false;
  let toastTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const pad = (value) => String(value).padStart(2, '0');

  function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function money(value, signed = false) {
    const n = Number(value || 0);
    const abs = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
    if (!signed) return n < 0 ? `-${abs}` : abs;
    if (n > 0) return `+${abs}`;
    if (n < 0) return `-${abs}`;
    return abs;
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function monthLabel(value) {
    const [year, month] = String(value).split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  }

  function ordinal(day) {
    const n = Number(day || 0);
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    if (n % 10 === 1) return `${n}st`;
    if (n % 10 === 2) return `${n}nd`;
    if (n % 10 === 3) return `${n}rd`;
    return `${n}th`;
  }

  function toast(message, error = false) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let body = {};
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok) throw new Error(body.error || 'Request failed.');
    return body;
  }

  function normalizeState(next) {
    next ||= {};
    next.paymentMethods = Array.isArray(next.paymentMethods) ? next.paymentMethods : [];
    next.recurringPaymentMeta = next.recurringPaymentMeta || {};
    next.recurringPaymentSnapshots = next.recurringPaymentSnapshots || {};
    next.cardTransactions = Array.isArray(next.cardTransactions) ? next.cardTransactions : [];
    next.housingPaymentMeta = next.housingPaymentMeta || {};
    next.housingPaymentSnapshots = next.housingPaymentSnapshots || {};
    next.recurringExpenses = Array.isArray(next.recurringExpenses) ? next.recurringExpenses : [];
    next.months = next.months || {};
    next.dailySpending = next.dailySpending || {};
    return next;
  }

  async function loadState() {
    const body = await api('/api/budget/state', { cache: 'no-store' });
    state = normalizeState(body.state);
    try { localStorage.setItem('budget_tracker_last_state', JSON.stringify(state)); } catch { /* noop */ }
    return state;
  }

  async function syncBaseApp() {
    if ($('#appShell')?.hidden) return;
    internalSync = true;
    const syncText = $('#syncText');
    const view = $('#view');
    const previousVisibility = view?.style.visibility || '';
    if (view) view.style.visibility = 'hidden';
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserver(() => {
        const value = syncText?.textContent || '';
        if (value === 'Synced' || value === 'Offline copy' || value === 'Sync issue') finish();
      });
      if (syncText) observer.observe(syncText, { childList: true, subtree: true, characterData: true });
      window.dispatchEvent(new Event('online'));
      setTimeout(finish, 2200);
    });
    if (view) view.style.visibility = previousVisibility;
    internalSync = false;
  }

  async function mutate(action, payload, successMessage) {
    try {
      const body = await api('/api/cards/mutate', { method: 'POST', body: JSON.stringify({ action, payload }) });
      state = normalizeState(body.state);
      try { localStorage.setItem('budget_tracker_last_state', JSON.stringify(state)); } catch { /* noop */ }
      baseSyncNeeded = true;
      await loadState();
      if (cardsOpen) {
        await syncBaseApp();
        baseSyncNeeded = false;
        await loadState();
        renderCards();
      }
      if (successMessage) toast(successMessage);
      return true;
    } catch (error) {
      toast(error.message, true);
      return false;
    }
  }

  function injectStyles() {
    if ($('#cardsStyles')) return;
    const style = document.createElement('style');
    style.id = 'cardsStyles';
    style.textContent = `
      .cards-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}.cards-toolbar input{width:170px}
      .cards-note{padding:15px 17px;border:1px solid rgba(124,167,255,.2);background:rgba(124,167,255,.07);border-radius:15px;color:#aebbd0;font-size:12px;line-height:1.55;margin-bottom:18px}
      .cards-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.cards-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
      .payment-card{padding:20px;position:relative;overflow:hidden}.payment-card.archived{opacity:.55}.payment-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.payment-card h3{margin:0;font-size:17px}.payment-card .last4{color:#8fa0bb;font-size:12px;margin-top:4px}.payment-card .purpose{color:#71809a;font-size:11px;line-height:1.45;margin-top:8px;min-height:16px}
      .card-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:17px}.card-stat{padding:11px;border:1px solid var(--border);border-radius:12px;background:#0b1425}.card-stat span{display:block;color:#74829a;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:800}.card-stat strong{display:block;margin-top:5px;font-size:14px}
      .cards-badge{display:inline-flex;padding:5px 8px;border-radius:999px;border:1px solid var(--border);color:#9aabc3;font-size:9px;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.cards-badge.credit{color:#a9c4ff;background:rgba(124,167,255,.08)}.cards-badge.debit{color:#7ce7bd;background:rgba(78,226,168,.08)}
      .cards-actions{display:flex;gap:7px;margin-top:14px}.cards-actions .button{min-height:36px;padding:0 11px}.cards-x{width:34px;height:34px;border:1px solid var(--border);border-radius:10px;background:transparent;color:#8290a8;font-size:18px}.cards-x:hover{color:var(--red);border-color:rgba(255,125,134,.35)}
      .cards-form{padding:21px}.cards-form h2{margin:0 0 5px;font-size:18px}.cards-form>p{margin:0 0 17px;color:var(--muted);font-size:11px;line-height:1.5}.cards-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cards-form .field{gap:6px}.cards-form .field.full{grid-column:1/-1}.cards-form .form-actions{margin-top:16px}
      .cards-list{display:grid;gap:8px}.cards-row{display:grid;grid-template-columns:minmax(180px,1.4fr) minmax(120px,.8fr) minmax(110px,.6fr) auto;gap:12px;align-items:center;padding:13px 14px;border:1px solid var(--border);background:#0c1627;border-radius:13px}.cards-row-main strong{display:block;font-size:13px}.cards-row-main span,.cards-row-meta{display:block;color:#78879f;font-size:10px;margin-top:3px}.cards-row-amount{font-weight:820;text-align:right}.cards-row-controls{display:flex;gap:6px;justify-content:flex-end}
      .cards-empty{padding:22px;text-align:center;color:#7c8ba4;border:1px dashed var(--border);border-radius:14px;font-size:12px}
      .cards-section{margin-top:18px}.cards-section .section-head{margin-bottom:14px}.cards-section .section-head p{max-width:720px}
      .autopay-strip{display:flex;flex-wrap:wrap;gap:8px}.autopay-chip{padding:9px 11px;border:1px solid var(--border);background:#0b1425;border-radius:11px;font-size:10px;color:#9eabc0}.autopay-chip strong{color:#e5ebf6;margin-right:4px}
      .cards-positive{color:var(--green)}.cards-negative{color:var(--red)}
      @media(max-width:980px){.cards-grid.three{grid-template-columns:1fr 1fr}.cards-row{grid-template-columns:1fr 1fr auto}.cards-row-meta{display:none}}
      @media(max-width:760px){.mobile-nav{grid-template-columns:repeat(5,1fr)!important}.mobile-nav-item{font-size:10px}.cards-grid,.cards-grid.three{grid-template-columns:1fr}.cards-form-grid{grid-template-columns:1fr}.cards-form .field.full{grid-column:auto}.cards-toolbar{align-items:flex-start;flex-direction:column}.cards-toolbar input{width:100%}.card-stats{grid-template-columns:1fr 1fr 1fr}.cards-row{grid-template-columns:1fr auto}.cards-row-amount{grid-column:1;text-align:left}.cards-row-controls{grid-column:2;grid-row:1/3}.cards-row-meta{display:block}}
      @media(max-width:420px){.card-stats{grid-template-columns:1fr}.cards-row{padding:11px}.payment-card,.cards-form{padding:17px}}
    `;
    document.head.appendChild(style);
  }

  function injectNavigation() {
    if ($('[data-cards-nav="desktop"]')) return;
    const desktop = $('.desktop-nav');
    const mobile = $('.mobile-nav');
    if (desktop) {
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.cardsNav = 'desktop';
      button.innerHTML = '<span>Cards</span>';
      const history = desktop.querySelector('[data-view="history"]');
      desktop.insertBefore(button, history || null);
      button.addEventListener('click', openCards);
    }
    if (mobile) {
      const button = document.createElement('button');
      button.className = 'mobile-nav-item';
      button.dataset.cardsNav = 'mobile';
      button.textContent = 'Cards';
      const history = mobile.querySelector('[data-view="history"]');
      mobile.insertBefore(button, history || null);
      button.addEventListener('click', openCards);
    }
  }

  function setCardsActive(active) {
    $$('[data-cards-nav]').forEach((button) => button.classList.toggle('active', active));
    if (active) $$('[data-view]').forEach((button) => button.classList.remove('active'));
  }

  function activeCards() {
    return state.paymentMethods.filter((card) => !card.archivedAt);
  }

  function displayCards() {
    const active = activeCards();
    const activeIds = new Set(active.map((card) => card.id));
    const historical = state.paymentMethods.filter((card) => {
      if (activeIds.has(card.id)) return false;
      const totals = cardTotals(card.id);
      return Math.abs(totals.total) > 0.005 || transactionsForMonth().some((tx) => tx.paymentMethodId === card.id);
    });
    return [...active, ...historical];
  }

  function cardById(id) {
    return state.paymentMethods.find((card) => card.id === id) || null;
  }

  function cardLabel(id) {
    const card = cardById(id);
    return card ? `${card.name} •••• ${card.last4}` : 'Unassigned';
  }

  function recurringMeta(expenseId, month = selectedMonth) {
    return state.recurringPaymentSnapshots?.[month]?.[expenseId] || state.recurringPaymentMeta?.[expenseId] || {};
  }

  function housingMeta(month = selectedMonth) {
    return state.housingPaymentSnapshots?.[month]?.paymentMethodId ? state.housingPaymentSnapshots[month] : state.housingPaymentMeta || {};
  }

  function monthExpenses(month = selectedMonth) {
    return state.months?.[month]?.expenses || state.recurringExpenses || [];
  }

  function transactionsForMonth(month = selectedMonth) {
    return state.cardTransactions.filter((tx) => tx.date?.startsWith(`${month}-`));
  }

  function cardTotals(cardId, month = selectedMonth) {
    let recurring = 0;
    for (const expense of monthExpenses(month)) {
      if (recurringMeta(expense.id, month).paymentMethodId === cardId) recurring += Number(expense.amount || 0);
    }
    const cfg = state.months?.[month];
    if (cfg && housingMeta(month).paymentMethodId === cardId) recurring += Number(cfg.housing || 0);
    let purchases = 0;
    let refunds = 0;
    for (const tx of transactionsForMonth(month)) {
      if (tx.paymentMethodId !== cardId) continue;
      if (tx.kind === 'refund') refunds += Number(tx.amount || 0);
      else purchases += Number(tx.amount || 0);
    }
    return { recurring, purchases, refunds, oneTimeNet: purchases - refunds, total: recurring + purchases - refunds };
  }

  function recurringTotal(month = selectedMonth) {
    let total = 0;
    for (const expense of monthExpenses(month)) {
      if (recurringMeta(expense.id, month).paymentMethodId) total += Number(expense.amount || 0);
    }
    const cfg = state.months?.[month];
    if (cfg && housingMeta(month).paymentMethodId) total += Number(cfg.housing || 0);
    return total;
  }

  function oneTimeNet(month = selectedMonth) {
    return transactionsForMonth(month).reduce((sum, tx) => sum + (tx.kind === 'refund' ? -Number(tx.amount || 0) : Number(tx.amount || 0)), 0);
  }

  function cardOptions(selected = '', includeBlank = true) {
    const options = activeCards().map((card) => `<option value="${esc(card.id)}" ${card.id === selected ? 'selected' : ''}>${esc(card.name)} •••• ${esc(card.last4)} (${card.type})</option>`).join('');
    return `${includeBlank ? `<option value="" ${selected ? '' : 'selected'}>Unassigned / other</option>` : ''}${options}`;
  }

  function nextAutopayText(card) {
    if (card.type !== 'credit' || !card.autopayDay) return 'No autopay day set';
    return `Autopay ${ordinal(card.autopayDay)} monthly`;
  }

  async function budgetSnapshot() {
    if (!engine) engine = await import('/engine.js');
    const calc = engine.calculateMonth(state, selectedMonth);
    let today = null;
    if (selectedMonth === monthKey() && calc.configured) today = engine.calculateDay(state, dateKey());
    return { calc, today };
  }

  function paymentCardHtml(card) {
    const totals = cardTotals(card.id);
    return `
      <article class="card payment-card ${card.archivedAt ? 'archived' : ''}">
        <div class="payment-card-head">
          <div><span class="cards-badge ${esc(card.type)}">${esc(card.type)}</span>${card.archivedAt ? '<span class="cards-badge" style="margin-left:5px">archived</span>' : ''}<h3 style="margin-top:10px">${esc(card.name)}</h3><div class="last4">•••• ${esc(card.last4)}</div></div>
          ${card.archivedAt ? '' : `<button class="cards-x" type="button" data-card-remove="${esc(card.id)}" aria-label="Remove ${esc(card.name)}">×</button>`}
        </div>
        <div class="purpose">${card.purpose ? esc(card.purpose) : 'No dedicated purpose set yet.'}</div>
        <div class="card-stats">
          <div class="card-stat"><span>Recurring</span><strong>${money(totals.recurring)}</strong></div>
          <div class="card-stat"><span>One-time net</span><strong>${money(totals.oneTimeNet)}</strong></div>
          <div class="card-stat"><span>Tracked month</span><strong>${money(totals.total)}</strong></div>
        </div>
        <div class="cards-row-meta" style="margin-top:11px">${esc(card.archivedAt ? 'Historical card · no new charges can be assigned' : nextAutopayText(card))}</div>
        ${card.archivedAt ? '' : `<div class="cards-actions"><button class="button ghost" type="button" data-card-edit="${esc(card.id)}">Edit card</button></div>`}
      </article>`;
  }

  function recurringRowsHtml() {
    const expenses = monthExpenses(selectedMonth);
    if (!expenses.length) return '<div class="cards-empty">No recurring monthly payments yet.</div>';
    return `<div class="cards-list">${expenses.slice().sort((a, b) => Number(recurringMeta(a.id).chargeDay || 32) - Number(recurringMeta(b.id).chargeDay || 32)).map((expense) => {
      const meta = recurringMeta(expense.id);
      const editable = state.recurringExpenses.some((item) => item.id === expense.id);
      return `<div class="cards-row">
        <div class="cards-row-main"><strong>${esc(expense.name)}</strong><span>${esc(expense.category || 'Recurring payment')} · ${meta.chargeDay ? `charges on the ${ordinal(meta.chargeDay)}` : 'charge day not set'}${editable ? '' : ' · historical'}</span></div>
        <div class="cards-row-meta">${esc(cardLabel(meta.paymentMethodId))}</div>
        <div class="cards-row-amount">${money(expense.amount)}</div>
        <div class="cards-row-controls">${editable ? `<button class="button ghost" type="button" data-recurring-edit="${esc(expense.id)}">Edit</button><button class="cards-x" type="button" data-recurring-remove="${esc(expense.id)}" aria-label="Remove ${esc(expense.name)}">×</button>` : '<span class="cards-badge">Past</span>'}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function transactionRowsHtml() {
    const rows = transactionsForMonth(selectedMonth).slice().sort((a, b) => b.date.localeCompare(a.date) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (!rows.length) return '<div class="cards-empty">No one-time card activity logged for this month.</div>';
    return `<div class="cards-list">${rows.map((tx) => `<div class="cards-row">
      <div class="cards-row-main"><strong>${esc(tx.note || tx.category || (tx.kind === 'refund' ? 'Refund' : 'Purchase'))}</strong><span>${esc(tx.date)} · ${esc(tx.category || 'Other')}</span></div>
      <div class="cards-row-meta">${esc(cardLabel(tx.paymentMethodId))}</div>
      <div class="cards-row-amount ${tx.kind === 'refund' ? 'cards-positive' : ''}">${tx.kind === 'refund' ? '+' : ''}${money(tx.amount)}</div>
      <div class="cards-row-controls"><button class="button ghost" type="button" data-transaction-edit="${esc(tx.id)}">Edit</button><button class="cards-x" type="button" data-transaction-remove="${esc(tx.id)}" aria-label="Delete transaction">×</button></div>
    </div>`).join('')}</div>`;
  }

  function autopayHtml() {
    const cards = activeCards().filter((card) => card.type === 'credit' && card.autopayDay).sort((a, b) => a.autopayDay - b.autopayDay);
    if (!cards.length) return '<div class="cards-empty">Add an autopay day to a credit card and it will appear here.</div>';
    return `<div class="autopay-strip">${cards.map((card) => `<div class="autopay-chip"><strong>${ordinal(card.autopayDay)}</strong>${esc(card.name)} •••• ${esc(card.last4)} · ${money(cardTotals(card.id).total)} tracked this month</div>`).join('')}</div>`;
  }

  async function renderCards() {
    if (!cardsOpen || !state) return;
    injectStyles();
    const view = $('#view');
    if (!view) return;
    $('#pageEyebrow').textContent = 'CARDS';
    $('#pageTitle').textContent = 'Cards & payments';
    setCardsActive(true);
    const { calc, today } = await budgetSnapshot();
    const unassigned = monthExpenses(selectedMonth).filter((expense) => !recurringMeta(expense.id).paymentMethodId).length;
    const cfg = state.months?.[selectedMonth];
    const housing = cfg ? Number(cfg.housing || 0) : 0;
    const housingAssignment = housingMeta(selectedMonth);
    const housingCard = housingAssignment.paymentMethodId || '';

    view.innerHTML = `
      <div class="cards-toolbar"><div><h2 style="margin:0;font-size:20px">Payment map</h2><p style="margin:5px 0 0;color:var(--muted);font-size:12px">Track where recurring charges and one-time purchases land without counting credit-card payoff twice.</p></div><input id="cardsMonthPicker" type="month" value="${esc(selectedMonth)}" aria-label="Cards month" /></div>
      <div class="cards-note"><strong style="color:#e7edf8">How this works:</strong> a subscription or purchase reduces your budget when the charge happens. A later credit-card autopay is only paying off charges already counted, so it is never subtracted a second time.</div>

      <div class="summary-grid" style="margin-top:0">
        <article class="card metric-card"><div class="metric-label">ACTIVE CARDS</div><div class="metric-value">${activeCards().length}</div><div class="metric-foot">Credit and debit payment methods</div></article>
        <article class="card metric-card"><div class="metric-label">CARD-ASSIGNED RECURRING</div><div class="metric-value">${money(recurringTotal())}</div><div class="metric-foot">${unassigned ? `${unassigned} recurring payment${unassigned === 1 ? '' : 's'} still unassigned` : 'Everything assigned'}</div></article>
        <article class="card metric-card"><div class="metric-label">ONE-TIME CARD ACTIVITY</div><div class="metric-value">${money(oneTimeNet())}</div><div class="metric-foot">Purchases minus refunds in ${esc(monthLabel(selectedMonth))}</div></article>
        <article class="card metric-card"><div class="metric-label">${selectedMonth === monthKey() ? 'SAFE TO SPEND TODAY' : 'MONTHLY SPENDABLE'}</div><div class="metric-value ${today?.rawAvailable < 0 ? 'bad' : ''}">${money(today ? today.availableToday : calc.spendable)}</div><div class="metric-foot">${calc.configured ? 'Updates from the same budget engine' : 'Set up this month first'}</div></article>
      </div>

      <section class="cards-section">
        <div class="section-head"><div><h2>Your cards</h2><p>Only the last four digits are stored. Use the purpose field for things like subscriptions, DoorDash, games, large purchases, or everyday debit spending.</p></div></div>
        ${displayCards().length ? `<div class="cards-grid">${displayCards().map(paymentCardHtml).join('')}</div>` : '<div class="cards-empty">No cards yet. Add your first credit or debit card below.</div>'}
      </section>

      <section class="cards-section card section-card">
        <div class="section-head"><div><h2>Credit-card autopay schedule</h2><p>The amount shown is tracked card activity for the selected calendar month, not a second budget deduction.</p></div></div>
        ${autopayHtml()}
      </section>

      <section class="cards-section card section-card">
        <div class="section-head"><div><h2>Housing payment assignment</h2><p>Your rent/mortgage remains the dedicated housing number in Month. This only tells the card tracker where that payment goes and when it is due.</p></div></div>
        <form id="housingCardForm" class="cards-form-grid">
          <div class="field"><label for="housingCardSelect">Paid with</label><select id="housingCardSelect">${cardOptions(housingCard, true)}</select></div>
          <div class="field"><label for="housingDueDay">Due day</label><input id="housingDueDay" type="number" min="1" max="31" value="${esc(housingAssignment.dueDay || 1)}" /></div>
          <div class="field full"><small>${cfg ? `${money(housing)} housing is currently configured for ${esc(monthLabel(selectedMonth))}.` : `Set up ${esc(monthLabel(selectedMonth))} in Month to attach a housing amount.`}</small></div>
          <div class="form-actions field full"><button class="button primary" type="submit">Save housing assignment</button></div>
        </form>
      </section>

      <section class="cards-section">
        <div class="section-head"><div><h2>Recurring payments & subscriptions</h2><p>Name, amount, monthly charge day, and payment method. Changes update the recurring template, while past charged months stay intact.</p></div></div>
        ${recurringRowsHtml()}
      </section>

      <div class="cards-grid three cards-section">
        <form id="cardForm" class="card cards-form">
          <h2>${editingCardId ? 'Edit card' : 'Add a card'}</h2><p>Store only a nickname and the final four digits.</p>
          <input id="cardId" type="hidden" value="${esc(editingCardId)}" />
          <div class="cards-form-grid">
            <div class="field"><label for="cardType">Type</label><select id="cardType"><option value="credit">Credit</option><option value="debit">Debit</option></select></div>
            <div class="field"><label for="cardLast4">Last four digits</label><input id="cardLast4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" required /></div>
            <div class="field full"><label for="cardName">Card name</label><input id="cardName" maxlength="60" placeholder="Example: Amex Gold" required /></div>
            <div class="field full"><label for="cardPurpose">Dedicated purpose</label><input id="cardPurpose" maxlength="100" placeholder="Subscriptions, DoorDash, games, large purchases..." /></div>
            <div class="field full"><label for="cardAutopay">Credit-card autopay day</label><input id="cardAutopay" type="number" min="1" max="31" placeholder="Example: 18" /></div>
          </div>
          <div class="form-actions"><button id="cancelCardEdit" class="button ghost" type="button" ${editingCardId ? '' : 'hidden'}>Cancel</button><button class="button primary" type="submit">${editingCardId ? 'Save card' : 'Add card'}</button></div>
        </form>

        <form id="recurringCardForm" class="card cards-form">
          <h2>${editingRecurringId ? 'Edit recurring payment' : 'Add recurring payment'}</h2><p>These count as fixed monthly obligations, not daily purchases.</p>
          <input id="recurringId" type="hidden" value="${esc(editingRecurringId)}" />
          <div class="cards-form-grid">
            <div class="field full"><label for="recurringName">Name</label><input id="recurringName" maxlength="80" placeholder="YouTube TV" required /></div>
            <div class="field"><label for="recurringAmount">Monthly amount</label><input id="recurringAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="75.00" required /></div>
            <div class="field"><label for="recurringChargeDay">Charge day</label><input id="recurringChargeDay" type="number" min="1" max="31" placeholder="15" required /></div>
            <div class="field full"><label for="recurringCard">Paid with</label><select id="recurringCard">${cardOptions('', true)}</select></div>
            <div class="field full"><label for="recurringCategory">Category</label><input id="recurringCategory" maxlength="40" placeholder="Streaming, Internet, Financing..." /></div>
            <div class="field full"><label for="recurringCurrentMonth">Budget timing</label><select id="recurringCurrentMonth"><option value="yes">Count it in ${esc(monthLabel(monthKey()))}</option><option value="no">Start counting next month</option></select><small>Use “count it” for subscriptions/payments you already have. Use “next month” if this is brand-new and its first charge has not happened yet.</small></div>
          </div>
          <div class="form-actions"><button id="cancelRecurringEdit" class="button ghost" type="button" ${editingRecurringId ? '' : 'hidden'}>Cancel</button><button class="button primary" type="submit">${editingRecurringId ? 'Save payment' : 'Add payment'}</button></div>
        </form>

        <form id="cardTransactionForm" class="card cards-form">
          <h2>${editingTransactionId ? 'Edit card activity' : 'Add one-time card activity'}</h2><p>A purchase is added to that day’s discretionary spending. A refund adds money back.</p>
          <input id="transactionId" type="hidden" value="${esc(editingTransactionId)}" />
          <div class="cards-form-grid">
            <div class="field"><label for="transactionDate">Date</label><input id="transactionDate" type="date" max="${dateKey()}" value="${dateKey()}" required /></div>
            <div class="field"><label for="transactionKind">Type</label><select id="transactionKind"><option value="purchase">Purchase</option><option value="refund">Refund / money back</option></select></div>
            <div class="field full"><label for="transactionCard">Card</label><select id="transactionCard" required>${cardOptions('', false)}</select></div>
            <div class="field"><label for="transactionAmount">Amount</label><input id="transactionAmount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="100.00" required /></div>
            <div class="field"><label for="transactionCategory">Category</label><input id="transactionCategory" maxlength="60" placeholder="Games, Food, Headphones..." /></div>
            <div class="field full"><label for="transactionNote">Note</label><input id="transactionNote" maxlength="200" placeholder="What was it for?" /></div>
          </div>
          <div class="form-actions"><button id="cancelTransactionEdit" class="button ghost" type="button" ${editingTransactionId ? '' : 'hidden'}>Cancel</button><button class="button primary" type="submit">${editingTransactionId ? 'Save activity' : 'Add activity'}</button></div>
        </form>
      </div>

      <section class="cards-section">
        <div class="section-head"><div><h2>One-time card activity · ${esc(monthLabel(selectedMonth))}</h2><p>Card-linked purchases and refunds. These are already reflected in your daily budget totals.</p></div></div>
        ${transactionRowsHtml()}
      </section>`;

    bindCardsPage();
    populateEditors();
  }

  function populateEditors() {
    if (editingCardId) {
      const card = cardById(editingCardId);
      if (card) {
        $('#cardType').value = card.type;
        $('#cardLast4').value = card.last4;
        $('#cardName').value = card.name;
        $('#cardPurpose').value = card.purpose || '';
        $('#cardAutopay').value = card.autopayDay || '';
      }
    }
    if (editingRecurringId) {
      const expense = state.recurringExpenses.find((item) => item.id === editingRecurringId) || monthExpenses(selectedMonth).find((item) => item.id === editingRecurringId);
      const meta = recurringMeta(editingRecurringId);
      if (expense) {
        $('#recurringName').value = expense.name || '';
        $('#recurringAmount').value = Number(expense.amount || 0);
        $('#recurringChargeDay').value = meta.chargeDay || '';
        $('#recurringCard').value = meta.paymentMethodId || '';
        $('#recurringCategory').value = expense.category || '';
        const currentMonthExpense = (state.months?.[monthKey()]?.expenses || []).some((item) => item.id === editingRecurringId);
        $('#recurringCurrentMonth').value = currentMonthExpense ? 'yes' : 'no';
      }
    }
    if (editingTransactionId) {
      const tx = state.cardTransactions.find((item) => item.id === editingTransactionId);
      if (tx) {
        $('#transactionDate').value = tx.date;
        $('#transactionKind').value = tx.kind;
        $('#transactionCard').value = tx.paymentMethodId;
        $('#transactionAmount').value = Number(tx.amount || 0);
        $('#transactionCategory').value = tx.category || '';
        $('#transactionNote').value = tx.note || '';
      }
    }
    toggleAutopayField();
  }

  function toggleAutopayField() {
    const type = $('#cardType')?.value;
    const input = $('#cardAutopay');
    if (!input) return;
    input.disabled = type !== 'credit';
    if (type !== 'credit') input.value = '';
  }

  function bindCardsPage() {
    $('#cardsMonthPicker')?.addEventListener('change', async (event) => {
      selectedMonth = event.target.value;
      editingRecurringId = '';
      editingTransactionId = '';
      if (state.months?.[selectedMonth]) await mutate('snapshotMonthPayments', { month: selectedMonth });
      else renderCards();
    });

    $('#housingCardForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await mutate('saveHousingPayment', { paymentMethodId: $('#housingCardSelect').value, dueDay: Number($('#housingDueDay').value) }, 'Housing payment assignment saved.');
    });

    $('#cardType')?.addEventListener('change', toggleAutopayField);
    $('#cardForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await mutate('savePaymentMethod', {
        id: $('#cardId').value || undefined,
        type: $('#cardType').value,
        name: $('#cardName').value,
        last4: $('#cardLast4').value,
        purpose: $('#cardPurpose').value,
        autopayDay: $('#cardAutopay').value || null,
      }, editingCardId ? 'Card updated.' : 'Card added.');
      if (ok) editingCardId = '';
    });

    $('#recurringCardForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await mutate('saveRecurringPayment', {
        id: $('#recurringId').value || undefined,
        name: $('#recurringName').value,
        amount: Number($('#recurringAmount').value),
        chargeDay: Number($('#recurringChargeDay').value),
        paymentMethodId: $('#recurringCard').value,
        category: $('#recurringCategory').value,
        countCurrentMonth: $('#recurringCurrentMonth').value !== 'no',
      }, editingRecurringId ? 'Recurring payment updated.' : 'Recurring payment added.');
      if (ok) editingRecurringId = '';
    });

    $('#cardTransactionForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await mutate('saveTransaction', {
        id: $('#transactionId').value || undefined,
        date: $('#transactionDate').value,
        paymentMethodId: $('#transactionCard').value,
        kind: $('#transactionKind').value,
        amount: Number($('#transactionAmount').value),
        category: $('#transactionCategory').value,
        note: $('#transactionNote').value,
      }, editingTransactionId ? 'Card activity updated.' : 'Card activity added to your budget.');
      if (ok) editingTransactionId = '';
    });

    $('#cancelCardEdit')?.addEventListener('click', () => { editingCardId = ''; renderCards(); });
    $('#cancelRecurringEdit')?.addEventListener('click', () => { editingRecurringId = ''; renderCards(); });
    $('#cancelTransactionEdit')?.addEventListener('click', () => { editingTransactionId = ''; renderCards(); });

    $$('[data-card-edit]').forEach((button) => button.addEventListener('click', () => { editingCardId = button.dataset.cardEdit; renderCards(); setTimeout(() => $('#cardForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }));
    $$('[data-card-remove]').forEach((button) => button.addEventListener('click', async () => {
      const card = cardById(button.dataset.cardRemove);
      if (!card || !confirm(`Remove ${card.name} •••• ${card.last4} from active cards? Historical card activity will remain. Recurring payments assigned to it will become unassigned.`)) return;
      editingCardId = editingCardId === card.id ? '' : editingCardId;
      await mutate('archivePaymentMethod', { id: card.id }, 'Card removed from active cards.');
    }));

    $$('[data-recurring-edit]').forEach((button) => button.addEventListener('click', () => { editingRecurringId = button.dataset.recurringEdit; renderCards(); setTimeout(() => $('#recurringCardForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }));
    $$('[data-recurring-remove]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.recurringRemove;
      const expense = monthExpenses(selectedMonth).find((item) => item.id === id) || state.recurringExpenses.find((item) => item.id === id);
      if (!expense || !confirm(`Remove ${expense.name} from recurring payments? Past months stay unchanged. If this month’s charge date already passed, this month stays counted; otherwise the remaining budget updates immediately.`)) return;
      editingRecurringId = editingRecurringId === id ? '' : editingRecurringId;
      await mutate('deleteRecurringPayment', { id }, 'Recurring payment removed.');
    }));

    $$('[data-transaction-edit]').forEach((button) => button.addEventListener('click', () => { editingTransactionId = button.dataset.transactionEdit; renderCards(); setTimeout(() => $('#cardTransactionForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }));
    $$('[data-transaction-remove]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.transactionRemove;
      const tx = state.cardTransactions.find((item) => item.id === id);
      if (!tx || !confirm(`Delete this ${tx.kind === 'refund' ? 'refund' : 'purchase'} of ${money(tx.amount)}? Its impact will also be reversed from that day’s budget.`)) return;
      editingTransactionId = editingTransactionId === id ? '' : editingTransactionId;
      await mutate('deleteTransaction', { id }, 'Card activity deleted and budget adjusted.');
    }));
  }

  async function openCards(event) {
    event?.preventDefault?.();
    cardsOpen = true;
    selectedMonth ||= monthKey();
    editingCardId = '';
    editingRecurringId = '';
    editingTransactionId = '';
    setCardsActive(true);
    const view = $('#view');
    if (view) view.innerHTML = '<article class="card empty-state"><h2>Loading cards…</h2><p>Pulling your payment map and monthly activity.</p></article>';
    try {
      await loadState();
      if (state.months?.[selectedMonth] && !state.recurringPaymentSnapshots?.[selectedMonth]) {
        const body = await api('/api/cards/mutate', { method: 'POST', body: JSON.stringify({ action: 'snapshotMonthPayments', payload: { month: selectedMonth } }) });
        state = normalizeState(body.state);
      }
      await renderCards();
    } catch (error) {
      if (view) view.innerHTML = `<article class="card empty-state"><h2>Cards could not load</h2><p>${esc(error.message)}</p><button id="retryCards" class="button primary">Try again</button></article>`;
      $('#retryCards')?.addEventListener('click', openCards);
      toast(error.message, true);
    }
  }

  function cachedCardState() {
    if (state) return state;
    try { return normalizeState(JSON.parse(localStorage.getItem('budget_tracker_last_state') || 'null')); } catch { return null; }
  }

  function enhanceTodayCardLink() {
    if (cardsOpen || $('#pageEyebrow')?.textContent?.trim() !== 'TODAY') return;
    const form = $('#todayForm');
    if (!form || $('#cardLinkedToday')) return;
    const snapshot = cachedCardState();
    if (!snapshot) return;
    const today = dateKey();
    const linked = (snapshot.cardTransactions || []).filter((tx) => tx.date === today);
    if (!linked.length) return;
    const purchases = linked.filter((tx) => tx.kind !== 'refund').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const refunds = linked.filter((tx) => tx.kind === 'refund').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const note = document.createElement('div');
    note.id = 'cardLinkedToday';
    note.className = 'callout';
    note.style.marginBottom = '12px';
    note.innerHTML = `<span class="callout-dot"></span><div><strong>Card-linked activity already included</strong><span>${purchases ? `${money(purchases)} purchases` : 'No card purchases'}${refunds ? ` · ${money(refunds)} refunds` : ''}. If you edit today’s totals here, keep at least those linked amounts included.</span></div>`;
    form.insertAdjacentElement('beforebegin', note);
  }

  function observeNavigation() {
    document.addEventListener('click', (event) => {
      const baseNav = event.target.closest('[data-view]');
      if (!baseNav || !cardsOpen) return;
      cardsOpen = false;
      $$('[data-cards-nav]').forEach((button) => button.classList.remove('active'));
      if (baseSyncNeeded && baseNav.dataset.view !== 'month') {
        setTimeout(() => {
          window.dispatchEvent(new Event('online'));
          baseSyncNeeded = false;
        }, 40);
      }
    }, true);

    const observer = new MutationObserver(() => {
      const eyebrow = $('#pageEyebrow')?.textContent?.trim();
      if (cardsOpen && !internalSync && eyebrow && eyebrow !== 'CARDS') {
        cardsOpen = false;
        $$('[data-cards-nav]').forEach((button) => button.classList.remove('active'));
      }
    });
    const eyebrow = $('#pageEyebrow');
    if (eyebrow) observer.observe(eyebrow, { childList: true, subtree: true, characterData: true });
    const viewObserver = new MutationObserver(() => setTimeout(enhanceTodayCardLink, 0));
    const view = $('#view');
    if (view) viewObserver.observe(view, { childList: true, subtree: true });
  }

  function boot() {
    injectStyles();
    injectNavigation();
    observeNavigation();
    setTimeout(enhanceTodayCardLink, 80);
    window.addEventListener('pageshow', injectNavigation);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
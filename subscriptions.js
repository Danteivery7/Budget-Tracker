import { buildSubscriptionRoutingSummary } from './subscription-engine.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
let pageOpen = false;
let currentState = null;
let currentView = null;
let toastTimer = null;

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
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function activeCards() {
  return (currentState?.paymentMethods || []).filter((card) => !card.archivedAt);
}

function cardOptions(selected = '', includeBlank = true) {
  const blank = includeBlank ? '<option value="">Unassigned</option>' : '';
  return blank + activeCards().map((card) => `<option value="${esc(card.id)}" ${card.id === selected ? 'selected' : ''}>${esc(card.name)} •••• ${esc(card.last4)} (${esc(card.type)})</option>`).join('');
}

function injectNavigation() {
  if ($('[data-subscriptions-nav="desktop"]')) return;
  const desktop = $('.desktop-nav');
  const mobile = $('.mobile-nav');
  if (desktop) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.subscriptionsNav = 'desktop';
    button.innerHTML = '<span>Subscriptions</span>';
    const cards = desktop.querySelector('[data-cards-nav="desktop"]');
    const history = desktop.querySelector('[data-view="history"]');
    desktop.insertBefore(button, cards || history || null);
    button.addEventListener('click', openSubscriptions);
  }
  if (mobile) {
    const button = document.createElement('button');
    button.className = 'mobile-nav-item';
    button.dataset.subscriptionsNav = 'mobile';
    button.textContent = 'Subs';
    const cards = mobile.querySelector('[data-cards-nav="mobile"]');
    const history = mobile.querySelector('[data-view="history"]');
    mobile.insertBefore(button, cards || history || null);
    button.addEventListener('click', openSubscriptions);
  }
}

function setActive(active) {
  $$('[data-subscriptions-nav]').forEach((button) => button.classList.toggle('active', active));
  if (active) {
    $$('[data-view]').forEach((button) => button.classList.remove('active'));
    $$('[data-cards-nav]').forEach((button) => button.classList.remove('active'));
  }
}

function setChrome() {
  setActive(true);
  if ($('#pageEyebrow')) $('#pageEyebrow').textContent = 'RECURRING MONEY';
  if ($('#pageTitle')) $('#pageTitle').textContent = 'Subscriptions & routing';
}

async function load() {
  const body = await api('/api/subscriptions/state', { cache: 'no-store' });
  currentState = body.state;
  currentView = body.view;
  try { localStorage.setItem('budget_tracker_last_state', JSON.stringify(currentState)); } catch { /* noop */ }
  return body;
}

async function mutate(action, payload = {}, successMessage = '') {
  try {
    const body = await api('/api/subscriptions/mutate', { method: 'POST', body: JSON.stringify({ action, payload }) });
    currentState = body.state;
    currentView = body.view;
    try { localStorage.setItem('budget_tracker_last_state', JSON.stringify(currentState)); } catch { /* noop */ }
    if (successMessage) toast(successMessage);
    render();
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  }
}

function frequencyLabel(value) {
  return value === 'biweekly' ? 'Every 2 weeks' : value === 'quarterly' ? 'Quarterly' : value === 'annual' ? 'Annual' : value ? `${value[0].toUpperCase()}${value.slice(1)}` : 'Recurring';
}

function pendingMarkup(candidates) {
  if (!candidates.length) return '<div class="empty-review">Nothing is waiting for review. When the future account feed sees a repeating charge, it will appear here before it is allowed to change your budget.</div>';
  return `<div class="candidate-list">${candidates.map((candidate) => `
    <div class="candidate-card" data-candidate="${esc(candidate.id)}">
      <div class="candidate-top">
        <div><div class="candidate-name">${esc(candidate.merchantName)}</div><div class="candidate-meta">${frequencyLabel(candidate.frequency)} · ${candidate.occurrenceCount} matching charges · ${esc(candidate.firstDate)} → ${esc(candidate.lastDate)}${candidate.predictedNextDate ? ` · next likely ${esc(candidate.predictedNextDate)}` : ''}</div></div>
        <span class="confidence-pill">${Math.round(Number(candidate.confidence || 0) * 100)}% confidence</span>
      </div>
      <div class="candidate-grid">
        <div class="field"><label>Name to use</label><input data-candidate-name value="${esc(candidate.merchantName)}" maxlength="80" /></div>
        <div class="field"><label>Monthly amount</label><input data-candidate-amount type="number" min="0" step="0.01" value="${Number(candidate.averageAmount || 0).toFixed(2)}" /></div>
        <div class="field"><label>Pay with</label><select data-candidate-card>${cardOptions(candidate.paymentMethodId || currentView?.settings?.defaultPaymentMethodId || '')}</select></div>
      </div>
      <div class="candidate-grid">
        <div class="field"><label>Recurring type</label><select data-candidate-type><option value="subscription" ${candidate.suggestedType !== 'bill' ? 'selected' : ''}>Subscription</option><option value="bill" ${candidate.suggestedType === 'bill' ? 'selected' : ''}>Recurring bill</option></select></div>
        <div class="field"><label>Charge day</label><input data-candidate-day type="number" min="1" max="31" value="${Number(candidate.chargeDay || 1)}" /></div>
        <div class="field"><label>Detected amount range</label><input disabled value="Last ${money(candidate.lastAmount)} · Avg ${money(candidate.averageAmount)}" /></div>
      </div>
      <div class="candidate-actions"><button class="button ghost" type="button" data-ignore-candidate="${esc(candidate.id)}">Not recurring</button><button class="button primary" type="button" data-confirm-candidate="${esc(candidate.id)}">Confirm recurring charge</button></div>
    </div>`).join('')}</div>`;
}

function recurringRows() {
  const expenses = currentState?.recurringExpenses || [];
  const meta = currentState?.recurringPaymentMeta || {};
  const active = expenses.filter((expense) => meta[expense.id]?.active !== false);
  if (!active.length) return '<div class="empty-review">No confirmed recurring charges yet. You can still add one manually from Cards, or let future transaction history discover them.</div>';
  return `<div class="routing-list">${active.map((expense) => {
    const payment = meta[expense.id] || {};
    const candidate = (currentState.subscriptionCandidates || []).find((item) => item.recurringExpenseId === expense.id);
    return `<div class="subscription-row">
      <div><strong>${esc(expense.name)}</strong><small>${esc(expense.category || 'Recurring')} ${candidate ? '· discovered from transaction history' : '· manually tracked'}</small></div>
      <div class="subscription-amount">${money(expense.amount)}</div>
      <div class="subscription-day"><strong>Day ${Number(payment.chargeDay || 1)}</strong><small>Expected charge</small></div>
      <div><select data-route-expense="${esc(expense.id)}">${cardOptions(payment.paymentMethodId || '')}</select></div>
      <div class="subscription-actions"><button class="button ghost" type="button" data-end-expense="${esc(expense.id)}">End</button></div>
    </div>`;
  }).join('')}</div>`;
}

function ignoredMarkup() {
  const ignored = (currentState?.subscriptionCandidates || []).filter((item) => item.status === 'ignored');
  if (!ignored.length) return '';
  return `<div class="subscription-muted-list">${ignored.map((item) => `<button type="button" data-reopen-candidate="${esc(item.id)}">Reopen ${esc(item.merchantName)}</button>`).join('')}</div>`;
}

function render() {
  if (!pageOpen) return;
  setChrome();
  const view = $('#view');
  if (!view || !currentState || !currentView) return;
  const routing = currentView.routing || buildSubscriptionRoutingSummary(currentState);
  const pending = (currentState.subscriptionCandidates || []).filter((item) => item.status === 'pending');
  const feed = currentView.feed || {};
  const feedReady = Number(feed.transactionCount || 0) > 0;
  const defaultCard = currentView.settings?.defaultPaymentMethodId || '';
  const fundingLabel = currentView.settings?.autopayFundingAccountLabel || 'Checking';

  view.innerHTML = `<div class="subscriptions-shell">
    <div class="subscriptions-summary">
      <article class="card subscription-metric"><span>Recurring commitments</span><strong>${money(routing.recurringTotal)}</strong><small>Planned monthly subscriptions and recurring bills.</small></article>
      <article class="card subscription-metric"><span>${esc(fundingLabel)} needed for card autopay</span><strong>${money(routing.checkingAutopayRequirement)}</strong><small>Cash needed to settle recurring credit-card charges. Not counted as a second expense.</small></article>
      <article class="card subscription-metric"><span>Unassigned recurring</span><strong>${money(routing.unassignedTotal)}</strong><small>Recurring money that still needs a payment destination.</small></article>
      <article class="card subscription-metric"><span>Needs review</span><strong>${Number(routing.pendingCandidates || 0)}</strong><small>Detected patterns waiting for your confirmation.</small></article>
    </div>

    <article class="card subscription-panel">
      <div class="subscription-panel-head"><div><h2>Recurring-charge discovery</h2><p>The future bank/card connection sends posted transactions into this engine. Repeating merchants are proposed here first; nothing becomes a budget obligation until you confirm it.</p></div><button class="button ghost" type="button" id="refreshSubscriptionCandidates">Rescan</button></div>
      <div class="feed-status"><span class="feed-status-dot"></span><div><strong>${feedReady ? 'Transaction history available to the discovery engine' : 'Discovery engine ready for account connection'}</strong><span>${feedReady ? `${Number(feed.transactionCount)} normalized posted transactions are available${feed.lastTransactionDate ? ` through ${esc(feed.lastTransactionDate)}` : ''}.` : 'No linked-account transaction feed has been connected yet. The review, routing, and accounting logic is already active and will use the same endpoint when bank linking is added.'}</span></div></div>
    </article>

    <article class="card subscription-panel">
      <div class="subscription-panel-head"><div><h2>Confirmation queue</h2><p>Confirm only true subscriptions or recurring bills. Dates can drift and amounts can change slightly; the detector does not require an identical calendar date or penny-perfect amount.</p></div></div>
      ${pendingMarkup(pending)}
      ${ignoredMarkup()}
    </article>

    <article class="card subscription-panel">
      <div class="subscription-panel-head"><div><h2>Card routing</h2><p>Each recurring charge can use any card. You can centralize everything on one card or distribute charges across several cards; the budget still counts the underlying subscription once.</p></div></div>
      ${recurringRows()}
    </article>

    <article class="card subscription-panel">
      <div class="subscription-panel-head"><div><h2>Routing policy</h2><p>Set a default destination for newly confirmed subscriptions or move all active recurring charges to one card in a single operation.</p></div></div>
      <div class="subscription-controls">
        <div class="field"><label for="defaultSubscriptionCard">Default card for new confirmations</label><select id="defaultSubscriptionCard">${cardOptions(defaultCard)}</select></div>
        <div class="field"><label for="autopayFundingLabel">Autopay funding account label</label><input id="autopayFundingLabel" maxlength="80" value="${esc(fundingLabel)}" placeholder="Checking" /></div>
        <button class="button secondary" type="button" id="saveSubscriptionSettings">Save policy</button>
      </div>
      <div class="subscription-controls" style="margin-top:12px">
        <div class="field"><label for="bulkSubscriptionCard">Move all active recurring charges to</label><select id="bulkSubscriptionCard">${cardOptions(defaultCard, false)}</select></div><div></div><button class="button ghost" type="button" id="bulkAssignSubscriptions">Move all</button>
      </div>
      <div class="routing-policy" style="margin-top:16px">
        ${(routing.paymentMethods || []).map((item) => `<div class="routing-card"><span>${esc(item.name)} •••• ${esc(item.last4)}</span><strong>${money(item.total)}</strong><small>${item.count} recurring charge${item.count === 1 ? '' : 's'}${item.type === 'credit' && item.autopayDay ? ` · autopay day ${item.autopayDay}` : ''}</small></div>`).join('') || '<div class="routing-card"><span>No assigned cards yet</span><strong>$0.00</strong></div>'}
      </div>
      <div class="settlement-note"><strong>Accounting rule:</strong> a subscription charged to a credit card is spending when the subscription charge occurs. The later payment from ${esc(fundingLabel)} to that card is a settlement/transfer and must not be counted as spending again. The dashboard still reserves enough cash for that payoff so the card can be cleared.</div>
    </article>
  </div>`;

  bindPageEvents();
}

function bindPageEvents() {
  $('#refreshSubscriptionCandidates')?.addEventListener('click', () => mutate('refreshCandidates', {}, 'Recurring-charge scan refreshed.'));
  $$('[data-confirm-candidate]').forEach((button) => button.addEventListener('click', () => {
    const card = button.closest('[data-candidate]');
    mutate('confirmCandidate', {
      candidateId: button.dataset.confirmCandidate,
      name: $('[data-candidate-name]', card)?.value,
      amount: $('[data-candidate-amount]', card)?.value,
      paymentMethodId: $('[data-candidate-card]', card)?.value,
      recurringType: $('[data-candidate-type]', card)?.value,
      chargeDay: $('[data-candidate-day]', card)?.value,
      countCurrentMonth: true,
    }, 'Recurring charge confirmed.');
  }));
  $$('[data-ignore-candidate]').forEach((button) => button.addEventListener('click', () => mutate('ignoreCandidate', { candidateId: button.dataset.ignoreCandidate }, 'Removed from the recurring review queue.')));
  $$('[data-reopen-candidate]').forEach((button) => button.addEventListener('click', () => mutate('reopenCandidate', { candidateId: button.dataset.reopenCandidate }, 'Candidate reopened.')));
  $$('[data-route-expense]').forEach((select) => select.addEventListener('change', () => {
    if (!select.value) return toast('Choose a card before assigning this recurring charge.', true);
    mutate('assignSubscription', { recurringExpenseId: select.dataset.routeExpense, paymentMethodId: select.value }, 'Recurring charge routing updated.');
  }));
  $$('[data-end-expense]').forEach((button) => button.addEventListener('click', () => mutate('endSubscription', { recurringExpenseId: button.dataset.endExpense }, 'Recurring charge ended.')));
  $('#saveSubscriptionSettings')?.addEventListener('click', () => mutate('saveSubscriptionSettings', {
    defaultPaymentMethodId: $('#defaultSubscriptionCard')?.value || '',
    autopayFundingAccountLabel: $('#autopayFundingLabel')?.value || 'Checking',
    discoveryEnabled: true,
  }, 'Subscription routing policy saved.'));
  $('#bulkAssignSubscriptions')?.addEventListener('click', () => {
    const paymentMethodId = $('#bulkSubscriptionCard')?.value || '';
    if (!paymentMethodId) return toast('Choose a card first.', true);
    mutate('bulkAssignSubscriptions', { paymentMethodId }, 'All active recurring charges moved to that card.');
  });
}

async function openSubscriptions(event) {
  event?.preventDefault?.();
  event?.stopImmediatePropagation?.();
  pageOpen = true;
  setChrome();
  const view = $('#view');
  if (view) view.innerHTML = '<article class="card subscription-panel"><h2>Loading recurring money…</h2></article>';
  try {
    await load();
    render();
  } catch (error) {
    if (view) view.innerHTML = `<article class="card empty-state"><h2>Could not load subscriptions</h2><p>${esc(error.message)}</p></article>`;
  }
}

function observeNavigation() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-subscriptions-nav]')) return;
    if (event.target.closest('[data-view], [data-cards-nav]')) {
      pageOpen = false;
      setActive(false);
    }
  }, true);
}

function boot() {
  injectNavigation();
  observeNavigation();
  window.addEventListener('pageshow', injectNavigation);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

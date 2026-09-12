import { authenticateWithPasskey, passkeysSupported } from './passkey-client.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const money = (value) => Number(value || 0).toLocaleString('en-US', { style:'currency', currency:'USD', minimumFractionDigits:2 });
const classes = ['business','personal','subscription','bill','income','internal_transfer','card_payment','refund','loan_payment','savings'];
let pageOpen = false;
let viewState = null;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', headers:{ 'content-type':'application/json', ...(options.headers || {}) }, ...options });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok) { const error = new Error(body.error || 'Request failed.'); error.status = response.status; throw error; }
  return body;
}

function toast(message, error = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

function optionMarkup(selected = 'personal') {
  return classes.map((value) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${esc(value.replaceAll('_',' '))}</option>`).join('');
}

function injectNavigation() {
  if ($('[data-intelligence-nav="desktop"]')) return;
  const desktop = $('.desktop-nav');
  const mobile = $('.mobile-nav');
  if (desktop) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.intelligenceNav = 'desktop';
    button.innerHTML = '<span>Review & Rules</span>';
    const system = [...desktop.querySelectorAll('.nav-section-label')].find((node) => node.textContent.trim() === 'System');
    desktop.insertBefore(button, system || null);
    button.addEventListener('click', openPage);
  }
  if (mobile) {
    const button = document.createElement('button');
    button.className = 'mobile-nav-item';
    button.dataset.intelligenceNav = 'mobile';
    button.textContent = 'Review';
    mobile.appendChild(button);
    button.addEventListener('click', openPage);
  }
}

function setChrome() {
  $$('[data-intelligence-nav]').forEach((button) => button.classList.add('active'));
  $$('[data-view], [data-cards-nav], [data-subscriptions-nav], [data-plan-change-nav], [data-bank-nav], [data-security-nav]').forEach((button) => button.classList.remove('active'));
  if ($('#pageEyebrow')) $('#pageEyebrow').textContent = 'FINANCIAL INTELLIGENCE';
  if ($('#pageTitle')) $('#pageTitle').textContent = 'Review & rules';
}

function renderLocked(message = 'Banking is locked.') {
  setChrome();
  const view = $('#view');
  view.innerHTML = `<div class="advanced-shell"><article class="card advanced-panel"><p class="eyebrow">PROTECTED REVIEW DATA</p><h2>Unlock banking intelligence</h2><p>${esc(message)} Rules and transaction review are protected by the same short-lived banking session as balances and bank activity.</p><form id="intelligenceUnlockForm" class="advanced-form"><div class="field"><label for="intelligencePassword">Access code</label><input id="intelligencePassword" type="password" autocomplete="current-password" required /></div><button class="button primary" type="submit">Unlock for 15 minutes</button></form>${passkeysSupported() ? '<button id="intelligencePasskey" class="button ghost wide" type="button">Use Face ID / Windows Hello / passkey</button>' : ''}</article></div>`;
  $('#intelligenceUnlockForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await api('/api/bank/authorize', { method:'POST', body:JSON.stringify({ password:$('#intelligencePassword')?.value || '' }) });
      await load(); render();
    } catch (error) { toast(error.message, true); button.disabled = false; }
  });
  $('#intelligencePasskey')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try { await authenticateWithPasskey('bank'); await load(); render(); }
    catch (error) { toast(error.message, true); event.currentTarget.disabled = false; }
  });
}

function reviewMarkup(item) {
  const inflow = Number(item.amount || 0) < 0;
  return `<article class="advanced-review" data-review="${esc(item.transactionRef)}"><div class="advanced-review-main"><div><strong>${esc(item.merchantName)}</strong><span>${esc(item.date)} · ${inflow ? 'inflow' : 'outflow'} · ${esc(item.primaryCategory?.replaceAll('_',' ') || 'uncategorized')}</span></div><strong class="${inflow ? 'positive' : ''}">${inflow ? '+' : '-'}${money(Math.abs(item.amount))}</strong></div><p>${esc(item.reason)}</p><div class="review-controls"><select data-review-class>${optionMarkup(item.suggestedClassification === 'unknown' ? (inflow ? 'income' : 'personal') : item.suggestedClassification)}</select><input data-review-bucket placeholder="Bucket (optional)" /><label class="review-checkbox"><input data-review-rule type="checkbox" /> Teach this as a merchant rule</label><button class="button primary" data-review-save type="button">Confirm</button></div></article>`;
}

function ruleMarkup(rule) {
  const conditions = [rule.merchantEquals && `merchant = ${rule.merchantEquals}`, rule.merchantContains && `merchant contains ${rule.merchantContains}`, rule.accountRef && 'specific account', rule.direction && rule.direction !== 'any' && rule.direction, rule.minAmount != null && `≥ ${money(rule.minAmount)}`, rule.maxAmount != null && `≤ ${money(rule.maxAmount)}`].filter(Boolean).join(' · ');
  return `<div class="advanced-row" data-rule="${esc(rule.id)}"><div><strong>${esc(rule.name)}</strong><span>${esc(conditions || 'custom conditions')} → ${esc(rule.classification.replaceAll('_',' '))}${rule.bucket ? ` / ${esc(rule.bucket)}` : ''} · priority ${Number(rule.priority || 0)}</span></div><button class="button ghost danger" data-rule-delete type="button">Delete</button></div>`;
}

function render() {
  if (!pageOpen || !viewState) return;
  setChrome();
  const health = viewState.health || {};
  const inbox = viewState.reviewInbox || [];
  const rules = viewState.rules || [];
  const accounts = viewState.accounts || [];
  const view = $('#view');
  view.innerHTML = `<div class="advanced-shell"><div class="advanced-metrics four"><div><span>Analyzed</span><strong>${Number(health.transactionCount || 0)}</strong></div><div><span>Auto-classified</span><strong>${Number(health.classifiedCount || 0)}</strong></div><div><span>Reconciled pairs</span><strong>${Number(health.reconciledCount || 0)}</strong></div><div><span>Needs review</span><strong>${Number(health.reviewCount || 0)}</strong></div></div><article class="card advanced-panel"><div class="advanced-panel-head"><div><p class="eyebrow">REVIEW INBOX</p><h2>Only ask when confidence is not high enough</h2><p>Rules, confirmed subscriptions and reconciled transfer/refund pairs are handled first. These are the transactions the engine intentionally refused to guess.</p></div><span class="status-badge ${inbox.length ? 'yellow' : 'green'}">${inbox.length ? `${inbox.length} to review` : 'Clear'}</span></div><div class="review-list">${inbox.length ? inbox.slice(0,100).map(reviewMarkup).join('') : '<div class="advanced-empty">Nothing needs your attention.</div>'}</div></article><article class="card advanced-panel"><div class="advanced-panel-head"><div><p class="eyebrow">RULES ENGINE</p><h2>Your deterministic financial rules</h2><p>Rules run before heuristic classification. Higher priority wins when more than one rule matches.</p></div><span class="status-badge neutral">${rules.length} rules</span></div><form id="ruleForm" class="rule-grid"><input id="ruleName" placeholder="Rule name" required /><input id="ruleMerchant" placeholder="Merchant contains" /><select id="ruleAccount"><option value="">Any account</option>${accounts.map((account) => `<option value="${esc(account.accountRef)}">${esc(account.institutionName)} · ${esc(account.name)}${account.mask ? ` •••• ${esc(account.mask)}` : ''}</option>`).join('')}</select><select id="ruleDirection"><option value="any">Any direction</option><option value="outflow">Outflow</option><option value="inflow">Inflow</option></select><select id="ruleClass">${optionMarkup('personal')}</select><input id="ruleBucket" placeholder="Bucket (optional)" /><input id="ruleMin" type="number" min="0" step="0.01" placeholder="Min amount" /><input id="ruleMax" type="number" min="0" step="0.01" placeholder="Max amount" /><input id="rulePriority" type="number" min="0" max="1000" value="500" placeholder="Priority" /><button class="button primary" type="submit">Add rule</button></form><div class="advanced-list">${rules.length ? rules.sort((a,b)=>Number(b.priority||0)-Number(a.priority||0)).map(ruleMarkup).join('') : '<div class="advanced-empty">No custom rules yet. The reconciliation engine still handles confirmed recurring charges, card payments, internal transfers and refunds.</div>'}</div></article></div>`;

  $$('[data-review]').forEach((root) => $('[data-review-save]', root)?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const body = await api('/api/intelligence/review', { method:'POST', body:JSON.stringify({ transactionRef:root.dataset.review, classification:$('[data-review-class]', root)?.value, bucket:$('[data-review-bucket]', root)?.value || '', createRule:$('[data-review-rule]', root)?.checked === true }) });
      viewState = body.view;
      toast('Transaction reviewed.');
      render();
    } catch (error) { toast(error.message, true); event.currentTarget.disabled = false; }
  }));

  $('#ruleForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const body = await api('/api/intelligence/rules/save', { method:'POST', body:JSON.stringify({ rule:{ name:$('#ruleName').value, merchantContains:$('#ruleMerchant').value, accountRef:$('#ruleAccount').value, direction:$('#ruleDirection').value, classification:$('#ruleClass').value, bucket:$('#ruleBucket').value, minAmount:$('#ruleMin').value, maxAmount:$('#ruleMax').value, priority:Number($('#rulePriority').value || 500) } }) });
      viewState = body.view;
      toast('Rule saved.');
      render();
    } catch (error) { toast(error.message, true); button.disabled = false; }
  });

  $$('[data-rule]').forEach((root) => $('[data-rule-delete]', root)?.addEventListener('click', async () => {
    if (!confirm('Delete this financial rule? Existing manual reviews remain intact.')) return;
    try {
      const body = await api('/api/intelligence/rules/delete', { method:'POST', body:JSON.stringify({ id:root.dataset.rule }) });
      viewState = body.view;
      toast('Rule deleted.');
      render();
    } catch (error) { toast(error.message, true); }
  }));
}

async function load() {
  viewState = await api('/api/intelligence/state', { cache:'no-store' });
}

async function openPage() {
  pageOpen = true;
  setChrome();
  if ($('#view')) $('#view').innerHTML = '<article class="card advanced-panel">Analyzing financial activity…</article>';
  try { await load(); render(); }
  catch (error) { if (error.status === 403) renderLocked(error.message); else { toast(error.message, true); renderLocked(error.message); } }
}

function boot() {
  injectNavigation();
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-intelligence-nav]')) return;
    if (event.target.closest('[data-view], [data-cards-nav], [data-subscriptions-nav], [data-plan-change-nav], [data-bank-nav], [data-security-nav]')) {
      pageOpen = false;
      $$('[data-intelligence-nav]').forEach((button) => button.classList.remove('active'));
    }
  }, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
else boot();

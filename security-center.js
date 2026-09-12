import { passkeysSupported, registerPasskey } from './passkey-client.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
let pageOpen = false;
let passkeys = null;
let ledger = null;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function toast(message, error = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

function injectNavigation() {
  if ($('[data-security-nav="desktop"]')) return;
  const desktop = $('.desktop-nav');
  const mobile = $('.mobile-nav');
  if (desktop) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.securityNav = 'desktop';
    button.innerHTML = '<span>Security & Audit</span>';
    desktop.appendChild(button);
    button.addEventListener('click', openPage);
  }
  if (mobile) {
    const button = document.createElement('button');
    button.className = 'mobile-nav-item';
    button.dataset.securityNav = 'mobile';
    button.textContent = 'Security';
    mobile.appendChild(button);
    button.addEventListener('click', openPage);
  }
}

function setChrome() {
  $$('[data-security-nav]').forEach((button) => button.classList.add('active'));
  $$('[data-view], [data-cards-nav], [data-subscriptions-nav], [data-plan-change-nav], [data-bank-nav], [data-intelligence-nav]').forEach((button) => button.classList.remove('active'));
  if ($('#pageEyebrow')) $('#pageEyebrow').textContent = 'SECURITY & INTEGRITY';
  if ($('#pageTitle')) $('#pageTitle').textContent = 'Security & audit';
}

function time(value) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value));
}

function passkeyMarkup(item) {
  return `<div class="advanced-row"><div><strong>${esc(item.name || 'Passkey')}</strong><span>${esc(item.deviceType || 'passkey')}${item.backedUp ? ' · synced/backup capable' : ''} · added ${esc(time(item.createdAt))}${item.lastUsedAt ? ` · last used ${esc(time(item.lastUsedAt))}` : ''}</span></div><button class="button ghost danger" data-remove-passkey="${esc(item.id)}" type="button">Remove</button></div>`;
}

function ledgerMarkup() {
  const valid = ledger?.valid !== false;
  const recent = ledger?.recent || [];
  return `<article class="card advanced-panel"><div class="advanced-panel-head"><div><p class="eyebrow">IMMUTABLE HISTORY</p><h2>Financial audit ledger</h2><p>Every tracked mutation can be sealed into an append-only SHA-256 hash chain. Sensitive payloads are represented by digests, not duplicated raw data.</p></div><span class="status-badge ${valid ? 'green' : 'red'}">${valid ? 'Verified' : 'Integrity issue'}</span></div><div class="advanced-metrics"><div><span>Events</span><strong>${Number(ledger?.sequence || 0).toLocaleString()}</strong></div><div><span>Chain checked</span><strong>${Number(ledger?.checked || 0).toLocaleString()}</strong></div><div><span>Head</span><strong class="hash-value">${esc((ledger?.headHash || 'empty').slice(0, 16))}</strong></div></div>${ledger?.error ? `<div class="bank-warning">${esc(ledger.error)}</div>` : ''}<div class="audit-list">${recent.length ? recent.slice(0, 20).map((event) => `<div class="audit-event"><div><strong>${esc(event.action.replaceAll('_',' '))}</strong><span>${esc(event.source)}${event.summary ? ` · ${esc(event.summary)}` : ''}</span></div><time>${esc(time(event.at))}</time></div>`).join('') : '<div class="advanced-empty">The ledger will populate as you use the tracker.</div>'}</div></article>`;
}

function render() {
  if (!pageOpen) return;
  setChrome();
  const view = $('#view');
  const credentials = passkeys?.credentials || [];
  view.innerHTML = `<div class="advanced-shell"><article class="card advanced-panel"><div class="advanced-panel-head"><div><p class="eyebrow">PASSKEYS</p><h2>Face ID, Windows Hello & security keys</h2><p>Passkeys are phishing-resistant WebAuthn credentials. Your private key stays on your device or credential provider; Budget Tracker stores only the public credential needed to verify you.</p></div><span class="status-badge ${credentials.length ? 'green' : 'neutral'}">${credentials.length ? `${credentials.length} registered` : 'Password fallback only'}</span></div>${passkeysSupported() ? `<form id="addPasskeyForm" class="advanced-form"><div class="field"><label for="passkeyName">Passkey name</label><input id="passkeyName" maxlength="60" placeholder="Example: iPhone Face ID or Windows Hello" /></div><button class="button primary" type="submit">Add passkey</button></form>` : '<div class="bank-warning">This browser does not expose WebAuthn/passkeys in the current context.</div>'}<div class="advanced-list">${credentials.length ? credentials.map(passkeyMarkup).join('') : '<div class="advanced-empty">Add your first passkey while signed in with your existing access code. Your password remains available as recovery.</div>'}</div><div class="bank-private-note"><div><strong>Banking unlock</strong><span>Any registered passkey can also satisfy the separate 15-minute banking re-authentication requirement.</span></div></div></article>${ledgerMarkup()}</div>`;

  $('#addPasskeyForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await registerPasskey($('#passkeyName')?.value || '');
      toast('Passkey registered.');
      await load();
      render();
    } catch (error) { toast(error.message, true); button.disabled = false; }
  });
  $$('[data-remove-passkey]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Remove this passkey? Your normal access code will still work.')) return;
    button.disabled = true;
    try {
      await api('/api/passkeys/remove', { method:'POST', body:JSON.stringify({ id:button.dataset.removePasskey }) });
      toast('Passkey removed.');
      await load();
      render();
    } catch (error) { toast(error.message, true); button.disabled = false; }
  }));
}

async function load() {
  [passkeys, ledger] = await Promise.all([
    api('/api/passkeys/list', { cache:'no-store' }),
    api('/api/ledger/status?depth=500', { cache:'no-store' }),
  ]);
}

async function openPage() {
  pageOpen = true;
  setChrome();
  if ($('#view')) $('#view').innerHTML = '<article class="card advanced-panel">Loading security state…</article>';
  try { await load(); render(); } catch (error) { toast(error.message, true); }
}

function boot() {
  injectNavigation();
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-security-nav]')) return;
    if (event.target.closest('[data-view], [data-cards-nav], [data-subscriptions-nav], [data-plan-change-nav], [data-bank-nav], [data-intelligence-nav]')) {
      pageOpen = false;
      $$('[data-security-nav]').forEach((button) => button.classList.remove('active'));
    }
  }, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
else boot();

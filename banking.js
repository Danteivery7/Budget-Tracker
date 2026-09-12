const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const money = (value) => value == null ? '—' : Number(value).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2});
const time = (value) => value ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) : 'Not synced yet';
let pageOpen = false;
let session = null;
let connections = [];
const txCache = new Map();
let toastTimer = null;
let bankLockTimer = null;

function toast(message, error = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function clearBankLockTimer() {
  clearTimeout(bankLockTimer);
  bankLockTimer = null;
}

function lockBankingClient(showNotice = false) {
  clearBankLockTimer();
  session = { ...(session || {}), authorized:false, expiresAt:null };
  connections = [];
  txCache.clear();
  if (pageOpen) renderLocked();
  if (showNotice) toast('Banking locked after 15 minutes. Re-enter your access code to continue.');
}

function scheduleBankAutoLock() {
  clearBankLockTimer();
  const expiresAt = Number(session?.expiresAt || 0);
  if (!session?.authorized || !Number.isFinite(expiresAt) || expiresAt <= 0) return;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    lockBankingClient(true);
    return;
  }
  bankLockTimer = setTimeout(() => lockBankingClient(true), remaining + 25);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok) {
    if (response.status === 403 && String(body.error || '').includes('Banking session locked')) lockBankingClient(false);
    const error = new Error(body.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return body;
}

function injectNavigation() {
  if ($('[data-bank-nav="desktop"]')) return;
  const desktop = $('.desktop-nav');
  const mobile = $('.mobile-nav');
  if (desktop) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.bankNav = 'desktop';
    button.innerHTML = '<span>Linked Accounts</span>';
    const system = [...desktop.querySelectorAll('.nav-section-label')].find((node) => node.textContent.trim() === 'System');
    desktop.insertBefore(button, system || null);
    button.addEventListener('click', openPage);
  }
  if (mobile) {
    const button = document.createElement('button');
    button.className = 'mobile-nav-item';
    button.dataset.bankNav = 'mobile';
    button.textContent = 'Accounts';
    mobile.appendChild(button);
    button.addEventListener('click', openPage);
  }
}

function setChrome() {
  $$('[data-bank-nav]').forEach((button) => button.classList.add('active'));
  $$('[data-view], [data-cards-nav], [data-subscriptions-nav], [data-plan-change-nav]').forEach((button) => button.classList.remove('active'));
  if ($('#pageEyebrow')) $('#pageEyebrow').textContent = 'PRIVATE BANKING';
  if ($('#pageTitle')) $('#pageTitle').textContent = 'Linked financial accounts';
}

function securityCards() {
  return `<div class="bank-security-grid">
    <article class="card bank-security-card"><span>Bank credentials</span><strong>Never stored here</strong><small>Authentication happens inside Plaid or your bank's OAuth flow.</small></article>
    <article class="card bank-security-card"><span>Permission scope</span><strong>Transactions only</strong><small>No ACH routing/account numbers, identity product, or money movement permissions.</small></article>
    <article class="card bank-security-card"><span>Server storage</span><strong>AES-256-GCM</strong><small>Provider tokens and the private transaction cache are encrypted separately from your budget data.</small></article>
    <article class="card bank-security-card"><span>Banking session</span><strong>15-minute re-auth</strong><small>Balances and transaction screens require a separate short-lived unlock.</small></article>
  </div>`;
}

function renderLocked() {
  setChrome();
  const view = $('#view');
  view.innerHTML = `<div class="bank-shell">${securityCards()}<article class="card bank-lock"><p class="eyebrow">BANKING LOCKED</p><h2>Re-enter your access code.</h2><p>Your normal Budget Tracker session is intentionally not enough to reveal bank balances or transactions. Banking gets a separate, cryptographically expiring 15-minute session.</p><form id="bankUnlockForm"><div class="field"><label for="bankPassword">Access code</label><input id="bankPassword" type="password" autocomplete="current-password" required /></div><div class="bank-lock-actions"><button class="button primary" type="submit">Unlock banking</button></div></form></article></div>`;
  $('#bankUnlockForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const password = $('#bankPassword')?.value || '';
    button.disabled = true;
    try {
      session = await api('/api/bank/authorize', { method:'POST', body:JSON.stringify({ password }) });
      $('#bankPassword').value = '';
      scheduleBankAutoLock();
      await loadStatus();
      render();
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  });
}

function renderSetupNeeded() {
  setChrome();
  const setup = session?.setup || {};
  const view = $('#view');
  view.innerHTML = `<div class="bank-shell">${securityCards()}<article class="card bank-panel"><div class="bank-panel-head"><div><h2>Secure Plaid server configuration</h2><p>The banking code is installed, but no live financial account can be connected until the required secrets exist in Netlify. Do not paste any of these secret values into the website or chat.</p></div><button class="button ghost" id="bankLockButton" type="button">Lock banking</button></div><div class="bank-warning"><strong>Server configuration incomplete.</strong> Add the values directly in Netlify environment variables, then redeploy. The encryption key must be a fresh random 32-byte value encoded as Base64.</div><div class="bank-env"><code>PLAID_CLIENT_ID</code><code>PLAID_SECRET</code><code>PLAID_ENV = sandbox or production</code><code>PLAID_TOKEN_ENCRYPTION_KEY = 32 random bytes, Base64</code><code>PLAID_TRANSACTION_HISTORY_DAYS = 180 (optional, 30–730)</code><code>PLAID_REDIRECT_URI = https://your-site/plaid-oauth.html (optional, recommended for mobile OAuth)</code><code>PLAID_WEBHOOK_URL (optional; otherwise derived automatically)</code></div><div class="bank-private-note" style="margin-top:16px"><div><strong>Current readiness</strong><span>Plaid credentials: ${setup.plaidConfigured ? 'ready' : 'missing'} · encrypted vault: ${setup.encryptionConfigured ? 'ready' : 'missing'}.</span></div></div></article></div>`;
  bindLock();
}

function accountMarkup(account) {
  return `<div class="bank-account"><span class="bank-account-label">${esc(account.type || 'account')} · ${esc(account.subtype || '')}</span><strong>${esc(account.name)}${account.mask ? ` •••• ${esc(account.mask)}` : ''}</strong>${account.officialName ? `<small>${esc(account.officialName)}</small>` : ''}<div class="bank-account-balance"><div><span>Current</span><strong>${money(account.current)}</strong></div><div><span>Available</span><strong>${money(account.available)}</strong></div></div></div>`;
}

function txMarkup(rows = []) {
  if (!rows.length) return '<div class="bank-private-note"><div><strong>No recent transactions returned yet.</strong><span>Plaid may still be preparing history after a new connection.</span></div></div>';
  return rows.map((row) => {
    const outflow = Number(row.amount || 0) >= 0;
    const amount = outflow ? `-${money(Math.abs(row.amount))}` : `+${money(Math.abs(row.amount))}`;
    return `<div class="bank-transaction"><div class="bank-transaction-name"><strong>${esc(row.merchantName || 'Transaction')}</strong><span>${esc(row.date || '')}${row.primaryCategory ? ` · ${esc(row.primaryCategory.replaceAll('_',' '))}` : ''}${row.pending ? ' · pending' : ''}</span></div><div class="bank-transaction-amount ${outflow ? '' : 'inflow'}">${amount}</div></div>`;
  }).join('');
}

function connectionMarkup(connection) {
  const repair = connection.needsRepair === true;
  const cached = txCache.get(connection.connectionId);
  return `<section class="bank-connection" data-bank-connection="${esc(connection.connectionId)}"><div class="bank-connection-head"><div class="bank-connection-title"><strong>${esc(connection.institutionName)}</strong><span>Last sync: ${esc(time(connection.lastSyncedAt))} · ${Number(connection.transactionCount || 0)} encrypted transaction records</span></div><div class="bank-connection-actions"><span class="bank-status ${repair ? 'repair' : ''}">${repair ? 'Needs repair' : 'Connected'}</span><button class="button ghost" data-bank-transactions type="button">${cached ? 'Hide activity' : 'Recent activity'}</button><button class="button ghost" data-bank-sync type="button">Sync</button>${repair ? '<button class="button secondary" data-bank-repair type="button">Repair</button>' : ''}<button class="button ghost bank-danger" data-bank-disconnect type="button">Disconnect</button></div></div><div class="bank-account-grid">${(connection.accounts || []).map(accountMarkup).join('') || '<div class="bank-account"><strong>Account details are still syncing.</strong></div>'}</div>${cached ? `<div class="bank-transactions"><div class="bank-transactions-head"><strong>Recent posted and pending activity</strong><span class="muted">Kept in memory only while this page is open</span></div>${txMarkup(cached)}</div>` : ''}</section>`;
}

function renderReady() {
  setChrome();
  const setup = session?.setup || {};
  const view = $('#view');
  view.innerHTML = `<div class="bank-shell">${securityCards()}<article class="card bank-panel"><div class="bank-panel-head"><div><h2>Financial connections</h2><p>Plaid ${esc((setup.environment || 'sandbox').toUpperCase())} · ${Number(setup.historyDays || 180)} days requested and retained for new transaction connections. Your budget receives classifications and summaries, not this private bank feed.</p></div><div class="bank-connection-actions"><button class="button primary" id="connectBankButton" type="button">Connect financial account</button><button class="button ghost" id="bankLockButton" type="button">Lock banking</button></div></div><div class="bank-private-note"><div><strong>Read-only by design</strong><span>This integration requests the Transactions product only. It has no code path for ACH credentials, bank transfers, or moving money.</span></div></div></article>${connections.length ? `<div class="bank-connection-list">${connections.map(connectionMarkup).join('')}</div>` : `<article class="card bank-empty"><h3>No financial accounts connected yet.</h3><p>Connect through Plaid Link. Your bank credentials stay in the institution/Plaid authorization flow and never pass through Budget Tracker.</p><button class="button primary" id="connectBankEmpty" type="button">Connect your first account</button></article>`}</div>`;
  bindLock();
  $('#connectBankButton')?.addEventListener('click', () => launchPlaid());
  $('#connectBankEmpty')?.addEventListener('click', () => launchPlaid());
  bindConnections();
}

function bindLock() {
  $('#bankLockButton')?.addEventListener('click', async () => {
    try { await api('/api/bank/lock', { method:'POST', body:'{}' }); } catch { /* still clear UI */ }
    lockBankingClient(false);
  });
}

async function loadStatus() {
  const body = await api('/api/bank/status', { cache:'no-store' });
  session = { ...(session || {}), authorized:true, setup:body.setup };
  connections = body.connections || [];
  scheduleBankAutoLock();
}

async function launchPlaid(connectionId = null) {
  if (!window.Plaid?.create) return toast('Plaid Link did not load. Refresh the page and try again.', true);
  let token;
  try {
    token = await api('/api/bank/link-token', { method:'POST', body:JSON.stringify({ connectionId }) });
  } catch (error) { return toast(error.message, true); }

  if (token.redirectEnabled) sessionStorage.setItem('budget_plaid_oauth', JSON.stringify({ linkToken:token.linkToken, connectionId, createdAt:Date.now() }));
  const handler = window.Plaid.create({
    token: token.linkToken,
    onSuccess: async (publicToken, metadata) => {
      try {
        if (connectionId) {
          await api('/api/bank/sync', { method:'POST', body:JSON.stringify({ connectionId }) });
          toast('Bank connection repaired and synced.');
        } else {
          await api('/api/bank/exchange', { method:'POST', body:JSON.stringify({ publicToken, institutionName:metadata?.institution?.name || 'Financial institution' }) });
          toast('Financial account connected securely.');
        }
        sessionStorage.removeItem('budget_plaid_oauth');
        txCache.clear();
        await loadStatus();
        renderReady();
      } catch (error) { toast(error.message, true); }
      finally { handler.destroy?.(); }
    },
    onExit: (error) => {
      if (error) toast('The bank connection flow was not completed.', true);
      handler.destroy?.();
    },
  });
  handler.open();
}

function bindConnections() {
  $$('[data-bank-connection]').forEach((root) => {
    const connectionId = root.dataset.bankConnection;
    $('[data-bank-transactions]', root)?.addEventListener('click', async () => {
      if (txCache.has(connectionId)) {
        txCache.delete(connectionId);
        renderReady();
        return;
      }
      try {
        const body = await api(`/api/bank/transactions?connectionId=${encodeURIComponent(connectionId)}&limit=25`, { cache:'no-store' });
        txCache.set(connectionId, body.transactions || []);
        renderReady();
      } catch (error) { toast(error.message, true); }
    });
    $('[data-bank-sync]', root)?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        await api('/api/bank/sync', { method:'POST', body:JSON.stringify({ connectionId }) });
        txCache.delete(connectionId);
        await loadStatus();
        renderReady();
        toast('Account activity synced.');
      } catch (error) { toast(error.message, true); event.currentTarget.disabled = false; }
    });
    $('[data-bank-repair]', root)?.addEventListener('click', () => launchPlaid(connectionId));
    $('[data-bank-disconnect]', root)?.addEventListener('click', async () => {
      const connection = connections.find((item) => item.connectionId === connectionId);
      if (!confirm(`Disconnect ${connection?.institutionName || 'this financial institution'}? Budget history stays intact, but future bank syncing stops.`)) return;
      try {
        await api('/api/bank/disconnect', { method:'POST', body:JSON.stringify({ connectionId }) });
        txCache.delete(connectionId);
        await loadStatus();
        renderReady();
        toast('Financial account disconnected and its private bank cache was removed.');
      } catch (error) { toast(error.message, true); }
    });
  });
}

function render() {
  if (!pageOpen) return;
  if (!session?.authorized) return renderLocked();
  if (!session?.setup?.configured) return renderSetupNeeded();
  renderReady();
}

async function openPage() {
  pageOpen = true;
  setChrome();
  const view = $('#view');
  if (view) view.innerHTML = '<article class="card bank-panel"><div class="bank-private-note"><div><strong>Opening secure banking…</strong><span>Checking the short-lived banking session.</span></div></div></article>';
  try {
    session = await api('/api/bank/session', { cache:'no-store' });
    scheduleBankAutoLock();
    if (session.authorized && session.setup?.configured) await loadStatus();
  } catch (error) {
    session = { authorized:false, expiresAt:null, setup:null };
    clearBankLockTimer();
    toast(error.message, true);
  }
  render();
}

function observeNavigation() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-bank-nav]')) return;
    if (event.target.closest('[data-view], [data-cards-nav], [data-subscriptions-nav], [data-plan-change-nav]')) {
      pageOpen = false;
      $$('[data-bank-nav]').forEach((button) => button.classList.remove('active'));
      txCache.clear();
    }
  }, true);
}

function boot() {
  injectNavigation();
  observeNavigation();
  window.addEventListener('pageshow', injectNavigation);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !session?.authorized) return;
    if (Number(session.expiresAt || 0) <= Date.now()) lockBankingClient(pageOpen);
    else scheduleBankAutoLock();
  });
  if (sessionStorage.getItem('budget_open_bank') === '1') {
    sessionStorage.removeItem('budget_open_bank');
    setTimeout(openPage, 180);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
else boot();

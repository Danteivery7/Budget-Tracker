const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
let pageOpen = false;
let health = null;
let protectedUnlocked = false;
let sandboxConnections = [];
let recoveryPackage = null;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', headers:{ 'content-type':'application/json', ...(options.headers || {}) }, ...options });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok) {
    const error = new Error(body.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return body;
}

function toast(message, error = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  setTimeout(() => { el.className = 'toast'; }, 3200);
}

function statusBadge(status) {
  const label = status === 'ok' ? 'Ready' : status === 'blocked' ? 'Blocked' : 'Attention';
  return `<span class="status-badge ${status === 'ok' ? 'green' : status === 'blocked' ? 'red' : 'neutral'}">${label}</span>`;
}

function injectNavigation() {
  if ($('[data-system-health-nav="desktop"]')) return;
  const desktop = $('.desktop-nav');
  const mobile = $('.mobile-nav');
  if (desktop) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.systemHealthNav = 'desktop';
    button.innerHTML = '<span>System Health</span>';
    desktop.appendChild(button);
    button.addEventListener('click', openPage);
  }
  if (mobile) {
    const button = document.createElement('button');
    button.className = 'mobile-nav-item';
    button.dataset.systemHealthNav = 'mobile';
    button.textContent = 'Health';
    mobile.appendChild(button);
    button.addEventListener('click', openPage);
  }
}

function setChrome() {
  $$('[data-system-health-nav]').forEach((button) => button.classList.add('active'));
  $$('[data-view], [data-cards-nav], [data-subscriptions-nav], [data-plan-change-nav], [data-bank-nav], [data-intelligence-nav], [data-security-nav]').forEach((button) => button.classList.remove('active'));
  if ($('#pageEyebrow')) $('#pageEyebrow').textContent = 'COMMISSIONING & RESILIENCE';
  if ($('#pageTitle')) $('#pageTitle').textContent = 'System health';
}

function bytesToB64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function b64ToBytes(text) {
  const binary = atob(String(text || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function recoveryKey(passphrase, salt, usages) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:310000, hash:'SHA-256' }, material, { name:'AES-GCM', length:256 }, false, usages);
}

async function encryptRecovery(pkg, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await recoveryKey(passphrase, salt, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(pkg));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, plaintext));
  return {
    format:'budget-tracker-recovery-encrypted', version:1, createdAt:new Date().toISOString(),
    kdf:{ name:'PBKDF2-SHA256', iterations:310000, salt:bytesToB64(salt) },
    cipher:{ name:'AES-256-GCM', iv:bytesToB64(iv), ciphertext:bytesToB64(ciphertext) },
  };
}

async function decryptRecovery(envelope, passphrase) {
  if (envelope?.format !== 'budget-tracker-recovery-encrypted' || envelope?.version !== 1) throw new Error('Unsupported encrypted recovery file.');
  const salt = b64ToBytes(envelope.kdf?.salt);
  const iv = b64ToBytes(envelope.cipher?.iv);
  const key = await recoveryKey(passphrase, salt, ['decrypt']);
  let plaintext;
  try { plaintext = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, b64ToBytes(envelope.cipher?.ciphertext)); }
  catch { throw new Error('Recovery passphrase is incorrect or the file is damaged.'); }
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function checkMarkup(check) {
  return `<div class="system-check ${esc(check.status)}"><span class="system-check-dot"></span><div><strong>${esc(check.label)}</strong><span>${esc(check.detail)}</span></div></div>`;
}

function resultBox(id, text = '', good = true) {
  const el = $(`#${id}`);
  if (!el) return;
  el.hidden = !text;
  el.className = `system-result ${good ? 'good' : 'bad'}`;
  el.textContent = text;
}

function connectionOptions() {
  if (!sandboxConnections.length) return '<option value="">No unlocked Sandbox connection</option>';
  return sandboxConnections.map((item) => `<option value="${esc(item.connectionId)}">${esc(item.institutionName || 'Sandbox')} · ${Number(item.transactionCount || 0)} tx</option>`).join('');
}

function render() {
  if (!pageOpen || !health) return;
  setChrome();
  const view = $('#view');
  const sandbox = health.plaid?.environment === 'sandbox';
  const rotation = health.encryption || {};
  view.innerHTML = `<div class="system-shell">
    <article class="card advanced-panel"><div class="system-section-title"><div><p class="eyebrow">SYSTEM HEALTH</p><h2>Commissioning status</h2><p>One view of the storage, security, banking, audit, and classification boundaries that must be healthy before real money is trusted.</p></div>${statusBadge(health.coreReady ? 'ok' : 'blocked')}</div><div class="system-grid" style="margin-top:16px">${(health.checks || []).map(checkMarkup).join('')}</div></article>

    <article class="card advanced-panel"><div class="system-section-title"><div><p class="eyebrow">STRESS TEST</p><h2>Deterministic finance test</h2><p>Runs the same classification/reconciliation engine against payroll, transfers, subscriptions, card settlement, refund, pending, ambiguous, and manual-review cases.</p></div></div><div class="system-actions" style="margin-top:14px"><button id="runSynthetic" class="button primary" type="button">Run synthetic stress test</button><button id="refreshHealth" class="button ghost" type="button">Refresh health</button></div><div id="syntheticResult" class="system-result" hidden></div></article>

    <article class="card advanced-panel"><div class="system-section-title"><div><p class="eyebrow">PROTECTED OPERATIONS</p><h2>Recovery, key rotation & Sandbox</h2><p>These actions require the separate 15-minute protected banking session even when no real bank is connected.</p></div><span class="status-badge ${protectedUnlocked ? 'green' : 'neutral'}">${protectedUnlocked ? 'Unlocked' : 'Locked'}</span></div>${protectedUnlocked ? '<div class="bank-private-note" style="margin-top:14px"><div><strong>Protected operations unlocked</strong><span>This expires automatically with the normal 15-minute banking lock.</span></div></div>' : `<form id="systemUnlockForm" class="advanced-form" style="margin-top:14px"><div class="field"><label for="systemUnlockPassword">Access code</label><input id="systemUnlockPassword" type="password" autocomplete="current-password" required /></div><button class="button primary" type="submit">Unlock protected operations</button></form>`}</article>

    <article class="card advanced-panel"><div class="system-section-title"><div><p class="eyebrow">DISASTER RECOVERY</p><h2>Encrypted recovery package</h2><p>The server exports application records, then your browser encrypts the package with a passphrase before it is saved. The passphrase never reaches Budget Tracker.</p></div></div><div class="system-fields" style="margin-top:14px"><div class="field"><label for="recoveryPassphrase">Recovery passphrase</label><input id="recoveryPassphrase" type="password" autocomplete="new-password" placeholder="Use a strong unique passphrase" /></div><div class="field"><label for="recoveryFile">Encrypted recovery file</label><input id="recoveryFile" class="system-file" type="file" accept="application/json,.json" /></div></div><div class="system-actions" style="margin-top:12px"><button id="exportRecovery" class="button primary" type="button" ${protectedUnlocked ? '' : 'disabled'}>Export encrypted recovery</button><button id="validateRecovery" class="button ghost" type="button" ${protectedUnlocked ? '' : 'disabled'}>Validate file</button></div><div class="field" style="margin-top:12px"><label for="restoreConfirm">Restore confirmation</label><input id="restoreConfirm" placeholder="Type RESTORE to enable import" /></div><button id="restoreRecovery" class="button danger ghost" type="button" style="margin-top:10px" ${protectedUnlocked ? '' : 'disabled'}>Restore recovery package</button><div id="recoveryResult" class="system-result" hidden></div><p class="system-note">Recovery packages never contain your Cloudflare/Plaid secrets or the AES bank-encryption key. Cloudflare D1 Time Travel remains the point-in-time rollback layer.</p></article>

    <article class="card advanced-panel"><div class="system-section-title"><div><p class="eyebrow">KEY ROTATION</p><h2>Bank encryption lifecycle</h2><p>Current-key records: ${Number(rotation.currentRecords || 0)} · previous-key records: ${Number(rotation.previousRecords || 0)} · unreadable: ${Number(rotation.unreadableRecords || 0)}.</p></div>${statusBadge(rotation.unreadableRecords ? 'blocked' : rotation.previousRecords ? 'warn' : 'ok')}</div><div class="bank-private-note" style="margin-top:14px"><div><strong>Stable references</strong><span>${rotation.stableReferenceConfigured ? 'Dedicated BANK_REFERENCE_KEY is configured, so AES rotation cannot change account/transaction IDs.' : 'BANK_REFERENCE_KEY must be configured before linking accounts or rotating encryption.'}</span></div></div><button id="rotateEncryption" class="button primary" type="button" style="margin-top:12px" ${protectedUnlocked && rotation.previousConfigured && rotation.stableReferenceConfigured ? '' : 'disabled'}>Re-encrypt previous-key records</button><div id="rotationResult" class="system-result" hidden></div></article>

    <article class="card advanced-panel"><div class="system-section-title"><div><p class="eyebrow">PLAID SANDBOX</p><h2>Integration commissioning</h2><p>${sandbox ? 'Sandbox mode is selected. Once Plaid secrets, AES encryption, and the stable reference key are configured, these controls exercise the same encrypted sync path used later in Production.' : 'Sandbox controls are disabled because the current Plaid environment is not Sandbox.'}</p></div>${statusBadge(health.sandboxReady ? 'ok' : 'warn')}</div>${sandbox ? `<div class="system-actions" style="margin-top:14px"><button id="createSandbox" class="button primary" type="button" ${protectedUnlocked && health.sandboxReady ? '' : 'disabled'}>Create dynamic Sandbox account</button><select id="sandboxConnection" ${protectedUnlocked ? '' : 'disabled'}>${connectionOptions()}</select><button id="seedSandbox" class="button ghost" type="button" ${protectedUnlocked && sandboxConnections.length ? '' : 'disabled'}>Seed + sync test activity</button><button id="fireSandboxWebhook" class="button ghost" type="button" ${protectedUnlocked && sandboxConnections.length ? '' : 'disabled'}>Fire sync webhook</button></div><div id="sandboxResult" class="system-result" hidden></div>` : ''}<p class="system-note">Production endpoints cannot call these Sandbox-only operations. No access token or provider ID is returned to this page.</p></article>

    <article class="card advanced-panel"><div class="system-section-title"><div><p class="eyebrow">REAL-MONEY GATE</p><h2>Automatic bank posting remains intentionally off</h2><p>Bank feeds stay read-only for budgeting until real history has been reviewed. Forecasting, advanced safe-to-spend, sinking-fund recommendations, and automatic bank-to-budget posting remain data-dependent follow-on work rather than fake-data assumptions.</p></div></div></article>
  </div>`;
  bind();
}

async function refreshConnections() {
  if (!protectedUnlocked) return;
  try {
    const status = await api('/api/bank/status', { cache:'no-store' });
    sandboxConnections = status.connections || [];
  } catch { sandboxConnections = []; }
}

async function refresh() {
  health = await api('/api/system/health', { cache:'no-store' });
  if (protectedUnlocked) await refreshConnections();
  render();
}

async function readEncryptedRecovery() {
  const file = $('#recoveryFile')?.files?.[0];
  const passphrase = $('#recoveryPassphrase')?.value || '';
  if (!file) throw new Error('Choose an encrypted recovery file first.');
  if (passphrase.length < 12) throw new Error('Enter the recovery passphrase.');
  const envelope = JSON.parse(await file.text());
  recoveryPackage = await decryptRecovery(envelope, passphrase);
  return recoveryPackage;
}

function bind() {
  $('#refreshHealth')?.addEventListener('click', () => refresh().catch((error) => toast(error.message, true)));
  $('#runSynthetic')?.addEventListener('click', async () => {
    try {
      const result = await api('/api/system/commissioning/synthetic', { cache:'no-store' });
      const lines = result.checks.map((check) => `${check.passed ? '✓' : '✕'} ${check.name.replaceAll('_',' ')}`);
      resultBox('syntheticResult', `${result.passed ? 'PASS' : 'FAIL'}\n${lines.join('\n')}\n\n${result.metrics.transactions} transactions · ${result.metrics.reviewInbox} review items`, result.passed);
    } catch (error) { resultBox('syntheticResult', error.message, false); }
  });
  $('#systemUnlockForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/bank/authorize', { method:'POST', body:JSON.stringify({ password:$('#systemUnlockPassword')?.value || '' }) });
      protectedUnlocked = true;
      await refreshConnections();
      render();
      toast('Protected system operations unlocked.');
    } catch (error) { toast(error.message, true); }
  });
  $('#exportRecovery')?.addEventListener('click', async () => {
    try {
      const passphrase = $('#recoveryPassphrase')?.value || '';
      if (passphrase.length < 12) throw new Error('Use a recovery passphrase of at least 12 characters.');
      const body = await api('/api/system/recovery/export', { method:'POST', body:'{}' });
      const encrypted = await encryptRecovery(body.package, passphrase);
      downloadJson(encrypted, `budget-tracker-recovery-${new Date().toISOString().slice(0,10)}.json`);
      resultBox('recoveryResult', `Exported and encrypted ${body.package.rows.length} application records locally.`, true);
    } catch (error) { resultBox('recoveryResult', error.message, false); }
  });
  $('#validateRecovery')?.addEventListener('click', async () => {
    try {
      const pkg = await readEncryptedRecovery();
      const result = await api('/api/system/recovery/validate', { method:'POST', body:JSON.stringify({ package:pkg }) });
      resultBox('recoveryResult', `Valid recovery package · ${result.records} records · created ${result.createdAt || 'unknown'}`, true);
    } catch (error) { resultBox('recoveryResult', error.message, false); }
  });
  $('#restoreRecovery')?.addEventListener('click', async () => {
    try {
      if ($('#restoreConfirm')?.value !== 'RESTORE') throw new Error('Type RESTORE before importing a recovery package.');
      const pkg = recoveryPackage || await readEncryptedRecovery();
      if (!confirm('Merge this recovery package into the current D1 application state? Existing keys with the same name will be replaced.')) return;
      const result = await api('/api/system/recovery/restore', { method:'POST', body:JSON.stringify({ package:pkg, confirmation:'RESTORE' }) });
      resultBox('recoveryResult', `Restored ${result.restored} application records. Reload the site before relying on restored state.`, true);
      await refresh();
    } catch (error) { resultBox('recoveryResult', error.message, false); }
  });
  $('#rotateEncryption')?.addEventListener('click', async () => {
    try {
      if (!confirm('Re-encrypt every record that still uses the previous bank-encryption key?')) return;
      const result = await api('/api/system/encryption/rotate', { method:'POST', body:'{}' });
      resultBox('rotationResult', `Rotated ${result.rotated} protected records. Previous-key records remaining: ${result.status.previousRecords}.`, result.status.unreadableRecords === 0);
      await refresh();
    } catch (error) { resultBox('rotationResult', error.message, false); }
  });
  $('#createSandbox')?.addEventListener('click', async () => {
    try {
      const body = await api('/api/system/sandbox/create', { method:'POST', body:'{}' });
      resultBox('sandboxResult', `Created dynamic Sandbox connection: ${body.connection.institutionName}. Initial encrypted sync completed.`, true);
      await refreshConnections();
      await refresh();
    } catch (error) { resultBox('sandboxResult', error.message, false); }
  });
  $('#seedSandbox')?.addEventListener('click', async () => {
    try {
      const connectionId = $('#sandboxConnection')?.value || '';
      if (!connectionId) throw new Error('Create or select a Sandbox connection first.');
      const body = await api('/api/system/sandbox/seed', { method:'POST', body:JSON.stringify({ connectionId }) });
      resultBox('sandboxResult', `Seeded ${body.seeded} custom Sandbox transactions and requested a sync.`, true);
      await refresh();
    } catch (error) { resultBox('sandboxResult', error.message, false); }
  });
  $('#fireSandboxWebhook')?.addEventListener('click', async () => {
    try {
      const connectionId = $('#sandboxConnection')?.value || '';
      if (!connectionId) throw new Error('Create or select a Sandbox connection first.');
      await api('/api/system/sandbox/fire-webhook', { method:'POST', body:JSON.stringify({ connectionId }) });
      resultBox('sandboxResult', 'Plaid accepted the SYNC_UPDATES_AVAILABLE Sandbox webhook request. Check health/ledger after it is delivered.', true);
    } catch (error) { resultBox('sandboxResult', error.message, false); }
  });
}

async function openPage() {
  pageOpen = true;
  setChrome();
  if ($('#view')) $('#view').innerHTML = '<article class="card advanced-panel">Loading system health…</article>';
  try { await refresh(); } catch (error) { toast(error.message, true); }
}

function boot() {
  injectNavigation();
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-system-health-nav]')) return;
    if (event.target.closest('[data-view], [data-cards-nav], [data-subscriptions-nav], [data-plan-change-nav], [data-bank-nav], [data-intelligence-nav], [data-security-nav]')) {
      pageOpen = false;
      $$('[data-system-health-nav]').forEach((button) => button.classList.remove('active'));
    }
  }, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
else boot();

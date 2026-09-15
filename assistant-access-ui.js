const $ = (selector, root = document) => root.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials:'same-origin',
    headers:{ 'content-type':'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function toast(message, error = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  setTimeout(() => { el.className = 'toast'; }, 3200);
}

function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

async function status() {
  try { return (await api('/api/assistant/status', { cache:'no-store' })).access || { enabled:false }; }
  catch { return { enabled:false, unavailable:true }; }
}

async function protectedUnlocked() {
  try { return Boolean((await api('/api/bank/session', { cache:'no-store' })).authorized); }
  catch { return false; }
}

async function renderPanel() {
  const shell = $('.system-shell');
  if (!shell || $('#assistantAccessPanel')) return;

  const [access, unlocked] = await Promise.all([status(), protectedUnlocked()]);
  const panel = document.createElement('article');
  panel.id = 'assistantAccessPanel';
  panel.className = 'card advanced-panel';
  panel.innerHTML = `
    <div class="system-section-title">
      <div>
        <p class="eyebrow">CHATGPT READ-ONLY ACCESS</p>
        <h2>Assistant finance snapshot</h2>
        <p>Lets an approved ChatGPT connection ask Budget Tracker for current derived budget numbers and run purchase what-ifs. It cannot edit the budget, move money, or read bank credentials and provider tokens.</p>
      </div>
      <span class="status-badge ${access.enabled ? 'green' : 'neutral'}">${access.enabled ? 'Enabled' : 'Off'}</span>
    </div>
    <div class="system-fields" style="margin-top:14px">
      <div class="field">
        <label for="assistantTimeZone">Budget date timezone</label>
        <input id="assistantTimeZone" value="${escapeHtml(access.timeZone || localTimeZone())}" autocomplete="off" />
      </div>
      <div class="field">
        <label>Access created</label>
        <input value="${escapeHtml(access.createdAt || 'Not created')}" disabled />
      </div>
    </div>
    <div class="system-actions" style="margin-top:12px">
      <button id="assistantCreateAccess" class="button primary" type="button" ${unlocked ? '' : 'disabled'}>${access.enabled ? 'Replace access key' : 'Create access key'}</button>
      <button id="assistantRevokeAccess" class="button danger ghost" type="button" ${unlocked && access.enabled ? '' : 'disabled'}>Revoke access</button>
    </div>
    <div id="assistantTokenBox" class="system-result" hidden></div>
    <p class="system-note">Creating or revoking access requires Protected Operations to be unlocked. An access key is shown only when it is created. Do not paste that key into a normal chat; use it only in an approved Budget Tracker connection setup.</p>
  `;
  shell.appendChild(panel);

  $('#assistantCreateAccess')?.addEventListener('click', async () => {
    try {
      const timeZone = $('#assistantTimeZone')?.value || localTimeZone();
      const body = await api('/api/assistant/token/create', { method:'POST', body:JSON.stringify({ timeZone }) });
      const box = $('#assistantTokenBox');
      if (box) {
        box.hidden = false;
        box.className = 'system-result good';
        box.innerHTML = `<strong>Access key created. Copy it now; it will not be shown again.</strong><div class="system-code" style="margin-top:8px;user-select:all">${escapeHtml(body.token)}</div><button id="assistantCopyToken" class="button ghost" type="button" style="margin-top:10px">Copy access key</button>`;
        $('#assistantCopyToken')?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(body.token); toast('Assistant access key copied.'); }
          catch { toast('Could not copy automatically.', true); }
        });
      }
      toast('Read-only assistant access created.');
    } catch (error) { toast(error.message, true); }
  });

  $('#assistantRevokeAccess')?.addEventListener('click', async () => {
    try {
      await api('/api/assistant/token/revoke', { method:'POST', body:'{}' });
      panel.remove();
      await renderPanel();
      toast('Read-only assistant access revoked.');
    } catch (error) { toast(error.message, true); }
  });
}

const observer = new MutationObserver(() => {
  if ($('.system-shell') && !$('#assistantAccessPanel')) renderPanel().catch(() => {});
});
observer.observe(document.documentElement, { childList:true, subtree:true });

document.addEventListener('DOMContentLoaded', () => renderPanel().catch(() => {}));

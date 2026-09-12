const status = document.querySelector('#oauthStatus');
const button = document.querySelector('#oauthReturn');
const OAUTH_RESUME_MAX_MS = 15 * 60 * 1000;

function finish(message, error = false) {
  status.textContent = message;
  status.style.color = error ? '#d78b8b' : '#98948c';
  button.hidden = false;
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

function returnHome() {
  sessionStorage.setItem('budget_open_bank', '1');
  location.replace('/');
}
button.addEventListener('click', returnHome);

let saved = null;
try { saved = JSON.parse(sessionStorage.getItem('budget_plaid_oauth') || 'null'); } catch { /* noop */ }
const createdAt = Number(saved?.createdAt || 0);
if (!Number.isFinite(createdAt) || createdAt <= 0 || Date.now() - createdAt > OAUTH_RESUME_MAX_MS) {
  sessionStorage.removeItem('budget_plaid_oauth');
  saved = null;
}

if (!saved?.linkToken || !window.Plaid?.create) {
  finish('The secure connection session could not be resumed. Return to Budget Tracker and start the bank connection again.', true);
} else {
  const handler = window.Plaid.create({
    token: saved.linkToken,
    receivedRedirectUri: window.location.href,
    onSuccess: async (publicToken, metadata) => {
      try {
        if (saved.connectionId) {
          await api('/api/bank/sync', { method:'POST', body:JSON.stringify({ connectionId:saved.connectionId }) });
        } else {
          await api('/api/bank/exchange', { method:'POST', body:JSON.stringify({ publicToken, institutionName:metadata?.institution?.name || 'Financial institution' }) });
        }
        sessionStorage.removeItem('budget_plaid_oauth');
        status.textContent = 'Connection complete. Returning to Budget Tracker…';
        setTimeout(returnHome, 250);
      } catch (error) {
        sessionStorage.removeItem('budget_plaid_oauth');
        finish(error.message, true);
      } finally {
        handler.destroy?.();
      }
    },
    onExit: (error) => {
      sessionStorage.removeItem('budget_plaid_oauth');
      if (error) finish('The bank connection could not be completed. Return to Budget Tracker and try again.', true);
      else finish('The bank connection flow was closed.', false);
      handler.destroy?.();
    },
  });
  handler.open();
}

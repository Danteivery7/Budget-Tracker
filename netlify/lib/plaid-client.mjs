const HOSTS = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};
const DEFAULT_API_VERSION = '2020-09-14';

export function plaidEnvironment() {
  const value = String(process.env.PLAID_ENV || 'sandbox').trim().toLowerCase();
  if (!HOSTS[value]) throw new Error('Plaid environment must be sandbox or production.');
  return value;
}

export function plaidConfigured() {
  try {
    return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && HOSTS[plaidEnvironment()]);
  } catch {
    return false;
  }
}

export function plaidHistoryDays() {
  const raw = Number(process.env.PLAID_TRANSACTION_HISTORY_DAYS || 180);
  if (!Number.isFinite(raw)) return 180;
  return Math.max(30, Math.min(730, Math.trunc(raw)));
}

export function plaidRedirectUri() {
  const raw = String(process.env.PLAID_REDIRECT_URI || '').trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Plaid redirect URI must use HTTPS.');
  if (url.search || url.hash) throw new Error('Plaid redirect URI cannot contain query parameters or a fragment.');
  return url.toString();
}

export async function plaidRequest(path, body = {}, { timeoutMs = 15_000 } = {}) {
  if (!plaidConfigured()) throw new Error('Plaid is not configured on the server.');
  const env = plaidEnvironment();
  const response = await fetch(`${HOSTS[env]}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
      'Plaid-Version': String(process.env.PLAID_API_VERSION || DEFAULT_API_VERSION),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || data?.error_code) {
    const error = new Error('Plaid request failed.');
    error.code = String(data?.error_code || 'PLAID_REQUEST_FAILED');
    error.type = String(data?.error_type || '');
    throw error;
  }
  return data;
}

export function plaidWebhookUrl(request) {
  const configured = String(process.env.PLAID_WEBHOOK_URL || '').trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:') throw new Error('Plaid webhook URL must use HTTPS.');
    return url.toString();
  }
  const url = new URL(request.url);
  return `${url.origin}/api/plaid/webhook`;
}

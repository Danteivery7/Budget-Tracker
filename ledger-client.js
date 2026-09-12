const underlyingFetch = window.fetch.bind(window);

function safeDescriptor(pathname, body = {}) {
  const payload = body?.payload || body || {};
  const descriptor = {};
  for (const key of ['date','month','effectiveMonth','connectionId','id','candidateId','recurringExpenseId','paymentMethodId']) {
    if (payload?.[key] != null) descriptor[key] = String(payload[key]).slice(0, 160);
  }
  return descriptor;
}

function eventFor(url, init = {}) {
  if (String(init.method || 'GET').toUpperCase() !== 'POST') return null;
  let parsed;
  try { parsed = new URL(url, location.origin); } catch { return null; }
  if (parsed.origin !== location.origin) return null;
  const path = parsed.pathname;
  if (!/^\/api\/(budget|cards|subscriptions|plan|bank)\//.test(path)) return null;
  if (/\/api\/subscriptions\/(classify|state)$/.test(path)) return null;
  if (/\/api\/bank\/(authorize|lock|link-token|transactions|status|session)$/.test(path)) return null;
  let body = {};
  if (typeof init.body === 'string') {
    try { body = JSON.parse(init.body); } catch { body = {}; }
  }
  const source = path.split('/')[2] || 'app';
  let action = body?.action || path.split('/').at(-1) || 'mutation';
  if (source === 'subscriptions' && path.endsWith('/ingest')) action = 'ingest_transactions';
  if (source === 'bank' && path.endsWith('/exchange')) action = 'bank_connected';
  if (source === 'bank' && path.endsWith('/sync')) action = 'bank_synced';
  if (source === 'bank' && path.endsWith('/disconnect')) action = 'bank_disconnected';
  const descriptor = safeDescriptor(path, body);
  const entity = descriptor.date || descriptor.month || descriptor.effectiveMonth || descriptor.connectionId || descriptor.id || descriptor.candidateId || '';
  return {
    source,
    action: String(action).slice(0, 120),
    entity,
    summary: `${source} · ${String(action).replaceAll('_',' ')}`.slice(0, 220),
    descriptor,
  };
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const event = eventFor(url, init);
  const response = await underlyingFetch(input, init);
  if (event && response.ok) {
    queueMicrotask(() => {
      underlyingFetch('/api/ledger/record', {
        method:'POST',
        credentials:'same-origin',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify(event),
        keepalive:true,
      }).catch(() => {});
    });
  }
  return response;
};

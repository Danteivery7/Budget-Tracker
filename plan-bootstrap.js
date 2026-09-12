(() => {
  const nativeFetch = window.fetch.bind(window);
  const pad = (value) => String(value).padStart(2, '0');
  const currentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const response = await nativeFetch(input, init);
    const method = String(init?.method || 'GET').toUpperCase();
    if (method !== 'GET' || !url.includes('/api/budget/state') || !response.ok) return response;

    try {
      const body = await response.clone().json();
      const month = currentMonth();
      const months = body?.state?.months || {};
      if (months[month] || !Object.keys(months).length) return response;

      const ensured = await nativeFetch('/api/plan/mutate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ensureMonth', payload: { month } }),
      });
      if (!ensured.ok) return response;
      const ensuredBody = await ensured.json();
      if (!ensuredBody?.state?.months?.[month]) return response;
      return new Response(JSON.stringify({ state: ensuredBody.state, etag: ensuredBody.etag || null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch {
      return response;
    }
  };
})();

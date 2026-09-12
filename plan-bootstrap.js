(() => {
  const nativeFetch = window.fetch.bind(window);
  const pad = (value) => String(value).padStart(2, '0');
  const currentDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const response = await nativeFetch(input, init);
    const method = String(init?.method || 'GET').toUpperCase();
    if (method !== 'GET' || !url.includes('/api/budget/state') || !response.ok) return response;

    try {
      const body = await response.clone().json();
      const months = body?.state?.months || {};
      if (!Object.keys(months).length) return response;
      const date = currentDate();
      const ensured = await nativeFetch('/api/plan/mutate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ensureCycle', payload: { date } }),
      });
      if (!ensured.ok) return response;
      const ensuredBody = await ensured.json();
      if (!ensuredBody?.state) return response;
      return new Response(JSON.stringify({ state: ensuredBody.state, etag: ensuredBody.etag || null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch {
      return response;
    }
  };
})();

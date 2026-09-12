const CACHE = 'budget-tracker-v12';
const STATIC = ['/', '/index.html', '/styles.css', '/purchase-planner.css', '/professional.css', '/subscriptions.css', '/plan-change.css', '/banking.css', '/advanced-core.css', '/plan-bootstrap.js', '/financial-cycle.js', '/fiscal-runtime.js', '/app.js', '/engine.js', '/refunds.js', '/start.js', '/allocations.js', '/cards.js', '/subscription-engine.js', '/subscriptions.js', '/purchase-engine.js', '/purchase-planner.js', '/setup-engine.js', '/setup-wizard.js', '/plan-change.js', '/banking.js', '/passkey-client.js', '/passkey-login.js', '/bank-passkey-enhancement.js', '/ledger-client.js', '/financial-intelligence.js', '/intelligence.js', '/security-center.js', '/ui-polish.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC))); self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => { const clone = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, clone)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html'))));
});

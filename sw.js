const CACHE = 'budget-tracker-v2';
const STATIC = ['/', '/index.html', '/styles.css', '/app.js', '/engine.js', '/refunds.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC))); self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => { const clone = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, clone)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html'))));
});

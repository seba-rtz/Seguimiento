/* Service worker: la app funciona sin conexión. Con conexión, usa siempre la versión más nueva. */
var V = 'seguimiento-v6';
var FILES = ['./', 'index.html', 'styles.css?v=5', 'core.js?v=5', 'sync.js?v=6', 'app.js?v=6', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return; // lo de Supabase nunca pasa por la caché
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(function (r) {
    var copy = r.clone();
    caches.open(V).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () { return caches.match(e.request).then(function (m) { return m || caches.match('index.html'); }); }));
});

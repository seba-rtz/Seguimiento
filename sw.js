/* Service worker: la app funciona sin conexión. Con conexión, usa siempre la versión más nueva. */
var V = 'seguimiento-v29';
var FILES = ['./', 'index.html', 'styles.css?v=29', 'core.js?v=29', 'sync.js?v=29', 'app.js?v=29', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

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
  // Red primero (para ver siempre la última versión), pero si tarda más de 4 s se usa la copia guardada: así la app abre rápido con mala cobertura.
  var net = fetch(e.request, { cache: 'no-cache' }).then(function (r) {
    if (r.ok) { var copy = r.clone(); caches.open(V).then(function (c) { c.put(e.request, copy); }); } // nunca se guardan respuestas de error
    return r;
  });
  var cached = function () {
    return caches.match(e.request).then(function (m) { return m || (e.request.mode === 'navigate' ? caches.match('index.html') : null); });
  };
  var slow = new Promise(function (res) { setTimeout(res, 4000); }).then(cached).then(function (m) { return m || net; });
  e.respondWith(Promise.race([net.catch(cached), slow]).then(function (r) { return r || Response.error(); }, function () { return Response.error(); }));
});

/* Avisos: llegan del servidor aunque la app esté cerrada. */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.titulo || 'Seguimiento', {
    body: d.cuerpo || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: (d.titulo || '') + '|' + (d.cuerpo || '')
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) if ('focus' in cs[i]) return cs[i].focus();
    return self.clients.openWindow('./');
  }));
});

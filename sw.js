// Service worker de Monitor — estrategia network-first
// (siempre intenta la red para que los deploys se vean al instante; usa caché solo sin conexión)
const CACHE = "monitor-v1";
const SHELL = ["/", "/index.html", "/css/styles.css", "/js/app.js", "/assets/dp-logo.png"];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  // Solo GET del mismo origen; deja pasar PeerJS, WebRTC y terceros sin tocar
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy).catch(function () {}); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match("/index.html"); });
    })
  );
});

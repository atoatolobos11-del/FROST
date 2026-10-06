/* Frost Breakout service worker — offline-first cache */
const CACHE = 'frost-breakout-v1';
const CORE = [
  './',
  './index.html',
  './style.css',
  './extras.css',
  './script.js',
  './extras.js',
  './manifest.webmanifest',
  './editor.html',
  './games/shell.html',
  './games/shared/arcade.css',
  './games/shared/frost-shared.js',
  './games/shared/gameshell.js'
];
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

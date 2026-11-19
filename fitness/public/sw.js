// Service worker: app shell offline-first, exercise images cached on first view, API always network.
const VERSION = 'fit-v1.1.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'data/exercises.json',
  'js/app.js', 'js/ui.js', 'js/api.js', 'js/store.js', 'js/generator.js', 'js/timer.js', 'js/chart.js', 'js/components.js',
  'js/views/auth.js', 'js/views/home.js', 'js/views/builder.js', 'js/views/workout.js', 'js/views/templates.js',
  'js/views/results.js', 'js/views/stats.js', 'js/views/analysis.js', 'js/views/library.js', 'js/views/body.js', 'js/views/settings.js',
  'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'fit-img').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return; // never cache private data in the SW

  if (url.pathname.includes('/img/ex/')) {
    e.respondWith(caches.open('fit-img').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // Shell: network first (so updates arrive quickly), cache as fallback when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./#/workout'))));
});

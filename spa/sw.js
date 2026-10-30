/* NT Scripting service worker — offline support for the static build.
   The cache name carries a build stamp, so every deploy replaces stale assets. */
const CACHE = 'nt-scripting-__VERSION__';
const PRECACHE = [
  './',
  './index.html',
  './404.html',
  './assets/app.js',
  './assets/app.css',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './login/',
  './register/',
  './connect/',
  './settings/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(PRECACHE.map((entry) => cache.add(new Request(entry, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** The app shell, for navigations that cannot reach the network or hit a 404. */
async function shell() {
  const cache = await caches.open(CACHE);
  return (
    (await cache.match('./index.html')) ??
    (await cache.match('./404.html')) ??
    (await cache.match('./')) ??
    Response.error()
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve the API or a gist from the cache.
  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // GitHub Pages answers unknown paths with 404.html; hand the route to
          // the SPA so a deep link still renders (and returns 200 here).
          if (response.status === 404) return (await shell()) ?? response;
          return response;
        } catch {
          return shell();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && (/\/(assets|icons)\//.test(url.pathname) || url.pathname.endsWith('.webmanifest'))) {
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});

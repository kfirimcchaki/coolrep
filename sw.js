/* NT Scripting service worker — offline support for the static build.
   The cache name carries a build stamp, so every deploy replaces stale assets. */
const CACHE = 'nt-scripting-20261030134356';
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
  './import/',
];


/* ------------------------------------------------------------------ */
/* Invite content endpoint                                             */
/* ------------------------------------------------------------------ */
/*
 * GitHub Pages has no server, so `/api/scripts/<uuid>/content?token=…` cannot
 * exist as a file. The service worker answers it instead: it reads the database
 * out of IndexedDB and verifies the HS256 invite token exactly like the server
 * build does, so an installed copy of this site can hand its scripts to anything
 * that speaks the invite format.
 */
const DB_NAME = 'nt-scripting';
const DB_STORE = 'kv';
const DB_KEY = 'nts.db.v1';
const CONTENT_SECRET = 'nt-scripting-local-content-secret';

function b64uToBytes(input) {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64uToJson(input) {
  return JSON.parse(new TextDecoder().decode(b64uToBytes(input)));
}

function readDatabase() {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onerror = () => resolve(null);
    request.onupgradeneeded = () => {
      try {
        request.result.createObjectStore(DB_STORE);
      } catch {
        /* exists already */
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      try {
        const get = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
        get.onsuccess = () => {
          db.close();
          try {
            resolve(get.result ? JSON.parse(get.result) : null);
          } catch {
            resolve(null);
          }
        };
        get.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}

async function verifyContentToken(token) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return { error: 'Invalid token', status: 401 };
  let header;
  try {
    header = b64uToJson(parts[0]);
  } catch {
    return { error: 'Invalid token', status: 401 };
  }
  if (header.alg !== 'HS256') return { error: 'Unsupported token algorithm', status: 401 };

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(CONTENT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64uToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { error: 'Invalid token signature', status: 401 };

  let claims;
  try {
    claims = b64uToJson(parts[1]);
  } catch {
    return { error: 'Invalid token payload', status: 401 };
  }
  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
    return { error: 'Token expired', status: 401 };
  }
  return { claims };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function contentResponse(url, scriptId) {
  if (!url.searchParams.get('token')) {
    return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const verified = await verifyContentToken(url.searchParams.get('token'));
  if (verified.error) return jsonResponse({ error: verified.error }, verified.status);
  if (verified.claims.script_id !== scriptId) {
    return jsonResponse({ error: 'Token does not match this script' }, 403);
  }

  const data = await readDatabase();
  if (!data) return jsonResponse({ error: 'This browser has no database yet' }, 404);

  const script = (data.scripts || []).find((row) => row.script_id === scriptId);
  if (!script || !script.published_at) return jsonResponse({ error: 'Script not found' }, 404);
  const release = (data.releases || []).find(
    (row) => row.id === verified.claims.revision_id && row.script_id === scriptId,
  );
  if (!release) return jsonResponse({ error: 'Revision not found' }, 404);

  if (url.searchParams.get('format') === 'json') {
    return jsonResponse({
      script_id: script.script_id,
      revision_id: release.id,
      name: script.name,
      description: script.description,
      content: release.code,
      created_at: release.created_at,
      expires_at: new Date(verified.claims.exp * 1000).toISOString(),
    });
  }

  return new Response(release.code, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
      'X-Script-Id': script.script_id,
      'X-Revision-Id': String(release.id),
    },
  });
}

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

  // The invite content endpoint is answered here (there is no server on Pages).
  const contentMatch = url.pathname.match(/\/api\/scripts\/([0-9a-f-]{36})\/content$/i);
  if (contentMatch) {
    event.respondWith(contentResponse(url, contentMatch[1]));
    return;
  }

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

#!/usr/bin/env node
/**
 * Tests for the GitHub Pages build.
 *
 *   1. contract tests  — the in-browser backend must answer exactly like the
 *                        Next.js route handlers (same paths, statuses, bodies).
 *   2. render tests    — the SPA is mounted in jsdom at every route and must
 *                        render the expected screen without throwing.
 *
 *   node scripts/test-static.mjs
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const tmp = path.join(root, '.tmp');

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function bundle(entry, outfile, extra = {}) {
  await mkdir(tmp, { recursive: true });
  const { ntApi = '', ...esbuildOptions } = extra;
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    write: true,
    outfile: path.join(tmp, outfile),
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    define: {
      'process.env.NEXT_PUBLIC_STATIC_MODE': '"1"',
      'process.env.NODE_ENV': '"production"',
      'process.env.NT_API': JSON.stringify(ntApi),
    },
    logLevel: 'error',
    ...esbuildOptions,
  });
  return path.join(tmp, outfile);
}

/* ------------------------------------------------------------------ */
/* 1. Backend contract                                                 */
/* ------------------------------------------------------------------ */

async function contractTests() {
  console.log('\nIn-browser backend contract\n');
  const file = await bundle('spa/test-entry.tsx', 'backend.mjs');
  const { VirtualServer, VirtualDatabase, MemoryStorage } = await import(pathToUrl(file));

  const server = new VirtualServer(new VirtualDatabase(new MemoryStorage()));
  let token = null;

  const call = async (method, path, body) => {
    const response = await server.handle(method, path, { body, token });
    const payload = response.body;
    if (payload && typeof payload === 'object' && typeof payload.session_id === 'string') {
      token = payload.session_id;
    }
    return response;
  };

  const health = await call('GET', '/api/health');
  check('GET /api/health → 200', health.status === 200 && health.body.status === 'ok');

  const anonList = await server.handle('GET', '/api/scripts', {});
  check('GET /api/scripts anonymous → 401 with an empty body',
    anonList.status === 401 && anonList.body === null,
    `got ${anonList.status} ${JSON.stringify(anonList.body)}`);

  const suffix = Math.random().toString(36).slice(2, 8);
  const register = await call('POST', '/api/auth/register', {
    name: 'Static Tester',
    username: `static_${suffix}`,
    password: 'static-pass-123',
  });
  check('POST /api/auth/register → 201', register.status === 201, `got ${register.status}`);
  const userId = register.body.user.user_id;
  check('register issues a session token', typeof token === 'string' && token.length > 10);

  const duplicate = await call('POST', '/api/auth/register', {
    name: 'x',
    username: `static_${suffix}`,
    password: 'static-pass-123',
  });
  check('duplicate username → 409', duplicate.status === 409);

  const badLogin = await call('POST', '/api/auth/login', { username: `static_${suffix}`, password: 'nope' });
  check('wrong password → 401', badLogin.status === 401);

  const created = await call('POST', '/api/scripts', {
    name: 'Static Script',
    description: 'created in the browser backend',
    code: 'function tick() end\n',
    publish: false,
  });
  check('POST /api/scripts → 201', created.status === 201, `got ${created.status}`);
  const scriptId = created.body.script_id;
  check('script id is UUIDv7', /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scriptId));
  check('microsecond timestamps', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(created.body.created_at), created.body.created_at);

  const hidden = await server.handle('GET', `/api/scripts/${scriptId}`, {});
  check('draft hidden from anonymous → 404', hidden.status === 404);

  const publish = await call('POST', `/api/scripts/${scriptId}/publish`, {});
  check('POST publish → 200 with a release', publish.status === 200 && Number.isInteger(publish.body.release.id));

  const detail = await call('GET', `/api/scripts/${scriptId}`);
  const expected = ['script_id', 'name', 'description', 'user_map_id', 'user_map_internal_id',
    'created_at', 'updated_at', 'published_at', 'author_uuid', 'author_name', 'is_favorite'];
  check('detail exposes exactly the upstream fields',
    expected.every((key) => key in detail.body) && Object.keys(detail.body).length === expected.length,
    Object.keys(detail.body).join(','));

  const releases = await call('GET', `/api/scripts/${scriptId}/releases`);
  check('releases envelope + 3 keys',
    releases.status === 200 &&
    releases.body.releases.every((row) => Object.keys(row).sort().join(',') === 'created_at,description,id'));

  const user = await call('GET', `/api/users/${userId}`);
  check('GET /api/users/{id} → 3 public fields',
    user.status === 200 && Object.keys(user.body).sort().join(',') === 'name,user_id,username');

  const userScripts = await call('GET', `/api/users/${userId}/scripts`);
  check('user scripts list omits map ids',
    userScripts.status === 200 &&
    userScripts.body.scripts.every((row) => !('user_map_id' in row) && !('user_map_internal_id' in row)));

  const fav = await call('POST', `/api/scripts/${scriptId}/favorite`, {});
  check('favorite → is_favorite true', fav.status === 200 && fav.body.is_favorite === true);
  const favList = await call('GET', `/api/users/${userId}/favorites`);
  check('favorite appears in the profile favorites', favList.body.scripts.some((row) => row.script_id === scriptId));
  const unfav = await call('DELETE', `/api/scripts/${scriptId}/favorite`);
  check('unfavorite → is_favorite false', unfav.status === 200 && unfav.body.is_favorite === false);

  const share = await call('POST', `/api/scripts/${scriptId}/share`, {});
  check('share → 201 with url + token', share.status === 201 && typeof share.body.url === 'string' && typeof share.body.token === 'string');
  const shareGet = await call('GET', `/api/scripts/${scriptId}/share`);
  check('GET share → 405 with empty body', shareGet.status === 405 && shareGet.body === null);
  const resolved = await call('GET', `/api/share/${share.body.token}`);
  check('GET /api/share/{token} resolves script + release',
    resolved.status === 200 && resolved.body.script.script_id === scriptId);

  const code = await call('PUT', `/api/scripts/${scriptId}/code`, { code: 'function tick() log("x") end' });
  check('PUT code → 200', code.status === 200 && code.body.code.includes('log'));

  const password = await call('POST', '/api/auth/password', {
    current_password: 'static-pass-123',
    new_password: 'static-pass-456',
  });
  check('password change → 200', password.status === 200);
  const relogin = await call('POST', '/api/auth/login', {
    username: `static_${suffix}`,
    password: 'static-pass-456',
  });
  check('login with the new password', relogin.status === 200);

  const removed = await call('DELETE', `/api/scripts/${scriptId}`);
  check('DELETE script → 200', removed.status === 200);
  check('deleted script → 404', (await call('GET', `/api/scripts/${scriptId}`)).status === 404);

  const missing = await call('GET', '/api/users/00000000-0000-7000-8000-000000000000');
  check('unknown user → 404', missing.status === 404);

  /* Connect (id_token) flow */
  const { claimsForEmail, signIdToken } = await import(pathToUrl(file.replace('backend.mjs', 'crypto.mjs')));
  const claims = await claimsForEmail('connect@example.com', '9', 'http://localhost');
  const idToken = await signIdToken(claims);
  const connect = await call('POST', '/api/auth/connect', { id_token: idToken, return_to: '/settings' });
  check('POST /api/auth/connect → 200 with a session', connect.status === 200 && typeof token === 'string');
  const second = await call('POST', '/api/auth/connect', { id_token: idToken, return_to: '/' });
  check('same id_token reuses the account',
    second.status === 200 && second.body.user.user_id === connect.body.user.user_id);

  const tampered = await call('POST', '/api/auth/connect', { id_token: `${idToken}x`, return_to: '/' });
  check('tampered id_token rejected', tampered.status >= 400, `got ${tampered.status}`);

  const seedFirst = await server.seed();
  const seedSecond = await server.seed();
  check('seed populates an empty instance', seedFirst.created === true);
  check('seed is idempotent', seedSecond.created === false);
}

/* ------------------------------------------------------------------ */
/* 2. Render tests (jsdom)                                             */
/* ------------------------------------------------------------------ */

function pathToUrl(file) {
  return `file://${file}`;
}

function setupDom(html = '<!doctype html><html><body><div id="root"></div></body></html>') {
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.CustomEvent = dom.window.CustomEvent;
  for (const [key, value] of Object.entries({
    localStorage: dom.window.localStorage,
    history: dom.window.history,
    location: dom.window.location,
    getComputedStyle: dom.window.getComputedStyle,
    scrollTo: () => {},
  })) {
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    } catch {
      /* already defined and not configurable */
    }
  }
  try {
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  } catch {
    /* ignore */
  }
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  return dom;
}

async function flush(times = 45) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function renderRoute(route, { token = null, localStorageSeed = {} } = {}) {
  setupDom();
  for (const [key, value] of Object.entries(localStorageSeed)) {
    window.localStorage.setItem(key, value);
  }
  if (token) window.localStorage.setItem('nts.session', token);
  window.history.replaceState({}, '', route);

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => {
    const message = args.map(String).join(' ');
    if (!message.includes('Not implemented')) errors.push(message);
    else return;
    originalError(...args);
  };

  try {
    const file = await bundle('spa/main.tsx', 'spa.mjs');
    await import(`${pathToUrl(file)}?t=${Date.now()}`);
    await flush();
  } finally {
    console.error = originalError;
  }

  const normalize = (value) => value.replace(/[’‘]/g, "'");
  return { text: normalize(document.body.textContent ?? ''), html: document.body.innerHTML, errors };
}

async function renderTests() {
  console.log('\nStatic SPA render tests\n');

  const home = await renderRoute('/');
  check('GET / renders the landing headline', home.text.includes('Heeeey, scripting is here!'), home.text.slice(0, 90));
  check('GET / renders the Connect CTA', home.text.includes("Continue with Null's Connect") || home.text.includes('Continue with Null’s Connect'));

  const login = await renderRoute('/login');
  check('GET /login renders the login form',
    login.text.includes('Log In') && login.text.includes('Username') && login.text.includes('Password'));

  const register = await renderRoute('/register');
  check('GET /register renders the register form',
    register.text.includes('Create Account') && register.text.includes('Display Name'));

  const connect = await renderRoute('/connect');
  check('GET /connect renders the provider screen',
    connect.text.includes("Null's Connect") && connect.text.includes('Email address'));

  const settingsAnon = await renderRoute('/settings');
  check('GET /settings anonymously redirects to /login', settingsAnon.text.includes('Log In'));

  const unknown = await renderRoute('/does-not-exist');
  check('unknown route renders the 404 page', unknown.text.includes('Page not found'));

  const scriptsAnon = await renderRoute('/scripts');
  check('GET /scripts anonymously redirects to /login', scriptsAnon.text.includes('Log In'));

  const detailAnon = await renderRoute('/scripts/01a18307-1527-7454-9557-e96cac0d2448');
  check('unknown script id renders 404', detailAnon.text.includes('Page not found'));

  check('no runtime errors on any route', [...home.errors, ...login.errors, ...register.errors,
    ...connect.errors, ...settingsAnon.errors, ...unknown.errors].length === 0,
    [...home.errors, ...login.errors].slice(0, 2).join(' | '));

  /* ---- signed-in surfaces, against the seeded in-browser backend ---- */
  const backend = await import(pathToUrl(await bundle('spa/test-entry.tsx', 'backend2.mjs')));
  const storage = new backend.MemoryStorage();
  const server = new backend.VirtualServer(new backend.VirtualDatabase(storage));
  await server.seed();
  const login2 = await server.handle('POST', '/api/auth/login', { body: { username: 'demo', password: 'demo1234' } });
  const token = login2.body.session_id;
  const demoId = login2.body.user.user_id;
  const scripts = server.db?.read?.() ?? null;

  // Persist the seeded database into jsdom's localStorage so the SPA sees it.
  const dbJson = storage.getItem('nts.db.v1');
  const seedStorage = { 'nts.db.v1': dbJson, 'nts.seeded': '1' };

  const list = await renderRoute('/scripts', { token, localStorageSeed: seedStorage });
  check('signed-in /scripts renders script cards',
    list.text.includes('Hello Tick') && list.text.includes('Damage Announcer'),
    list.text.slice(0, 120));

  const profile = await renderRoute(`/users/${demoId}`, { token, localStorageSeed: seedStorage });
  check('profile renders name, handle and both sections',
    profile.text.includes('Demo Author') && profile.text.includes('@demo') &&
    profile.text.includes('Favorites') && profile.text.includes('Scripts'));

  const scriptDetail = await renderRoute(`/scripts/${server.db.read().scripts[0].script_id}`, {
    token,
    localStorageSeed: seedStorage,
  });
  check('script page renders the hero, action and releases',
    scriptDetail.text.includes('Hello Tick') &&
    scriptDetail.text.includes('Start friendly battle') &&
    scriptDetail.text.includes('Releases'));

  const settings = await renderRoute('/settings', { token, localStorageSeed: seedStorage });
  check('settings exposes the shared-database panel',
    settings.text.includes('Backend') && settings.text.includes('Shared database (no server needed)') &&
    settings.text.includes('GitHub token'));
  check('settings renders sign-in methods',
    settings.text.includes('Settings') && settings.text.includes('Sign in methods') &&
    settings.text.includes("Null's Connect"));

  const editor = await renderRoute('/scripts/new', { token, localStorageSeed: seedStorage });
  check('editor renders for a signed-in user',
    editor.text.includes('New script') && editor.text.includes('Save & publish'));

  check('no runtime errors on signed-in routes',
    [...list.errors, ...profile.errors, ...settings.errors, ...editor.errors].length === 0,
    [...list.errors, ...profile.errors].slice(0, 2).join(' | '));
}


/* ------------------------------------------------------------------ */
/* 4. Shared gist transport (static build without a server)            */
/* ------------------------------------------------------------------ */

async function gistTests() {
  console.log('\nShared gist transport\n');
  const file = await bundle('spa/test-entry.tsx', 'gist.mjs');
  const gist = await import(pathToUrl(file));

  // The module reads localStorage; give it a Map-backed stand-in.
  const mem = new gist.MemoryStorage();
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = mem;

  const previousFetch = globalThis.fetch;
  const calls = [];
  let gistFiles = {};
  let rawContent = '';
  const gistId = 'abc123def4567890';

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, method: init.method ?? 'GET', body: init.body });
    if (href.startsWith('https://api.github.com/gists') && (init.method ?? 'GET') === 'POST') {
      const payload = JSON.parse(init.body);
      gistFiles = payload.files;
      return new Response(JSON.stringify({ id: gistId, files: payload.files }), { status: 201 });
    }
    if (href.includes('api.github.com/gists/') && init.method === 'PATCH') {
      const payload = JSON.parse(init.body);
      gistFiles = payload.files;
      return new Response(JSON.stringify({ id: gistId, files: payload.files }), { status: 200 });
    }
    if (href.includes('api.github.com/gists/')) {
      if (href.includes('missing000000000')) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ id: gistId, files: gistFiles }), { status: 200 });
    }
    if (href.startsWith('https://gist.githubusercontent.com/')) {
      return new Response(rawContent, { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  try {
    check('parseGistId accepts a bare id',
      gist.parseGistId('abc123def4567890') === 'abc123def4567890');
    check('parseGistId accepts a gist URL',
      gist.parseGistId('https://gist.github.com/someone/abc123def4567890') === 'abc123def4567890');
    check('parseGistId rejects junk', gist.parseGistId('../etc/passwd') === null);

    const doc = gist.emptyDocument();
    doc.scripts.push({
      script_id: '01a18cf5-a631-74f8-8ecf-b1871b29c343',
      name: 'Shared script',
      description: null,
      user_map_id: '01a18cf5-a631-74f8-8ecf-b1871b29c344',
      user_map_internal_id: 'CRPJR2C0U:9YGC8UV9RCJ',
      author_uuid: '01a18cf5-a631-74f8-8ecf-b1871b29c345',
      created_at: '2026-10-30T12:00:00.000000Z',
      updated_at: '2026-10-30T12:00:00.000000Z',
      published_at: '2026-10-30T12:00:00.000000Z',
      code: '-- hi',
      favorites: [],
    });

    const created = await gist.pushGistDocument({ token: 'ghp_testtoken1234567890', gistId: null }, doc);
    check('pushGistDocument creates a gist and returns its id',
      created.gistId === gistId && calls[0].method === 'POST' && calls[0].href.endsWith('/gists'),
      JSON.stringify(calls[0]));
    check('the gist is created secret (public:false)',
      JSON.parse(calls[0].body).public === false);

    const updated = await gist.pushGistDocument(created, doc);
    const patch = calls.find((call) => call.method === 'PATCH');
    check('a second push PATCHes the existing gist', Boolean(patch) && updated.gistId === gistId);
    check('the document lives in nt-scripting-db.json',
      Boolean(JSON.parse(calls[0].body).files['nt-scripting-db.json']));

    const pulled = await gist.fetchGistDocument(gistId);
    check('fetchGistDocument returns the stored scripts',
      pulled?.scripts.length === 1 && pulled.scripts[0].name === 'Shared script',
      JSON.stringify(pulled?.scripts?.length));

    // Truncated payloads must be re-read from raw_url.
    rawContent = JSON.stringify(doc);
    gistFiles = {
      'nt-scripting-db.json': {
        truncated: true,
        content: '',
        raw_url: 'https://gist.githubusercontent.com/u/abc/raw/nt-scripting-db.json',
      },
    };
    const fromRaw = await gist.fetchGistDocument(gistId);
    check('truncated gists are re-read from raw_url',
      fromRaw?.scripts.length === 1 && fromRaw.scripts[0].name === 'Shared script');

    const missing = await gist.fetchGistDocument('missing000000000').catch((error) => error);
    check('a missing gist surfaces a readable error',
      missing instanceof Error && missing.status === 404, String(missing?.message));

    // Config round-trip + storage facade wiring.
    gist.writeGistConfig({ token: 'ghp_testtoken1234567890', gistId: null });
    gistFiles = {};
    const base = new gist.MemoryStorage();
    const synced = gist.createGistStorage(base);
    synced.setItem('nts.db.v1', JSON.stringify(doc));
    gist.flushGistSync();

    let attempts = 0;
    while (!gist.readGistConfig()?.gistId && attempts < 40) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      attempts += 1;
    }
    check('writes queue to the gist without blocking the UI',
      gist.readGistConfig()?.gistId === gistId, JSON.stringify(gist.readGistConfig()));
    check('the local copy is written synchronously',
      JSON.parse(base.getItem('nts.db.v1')).scripts.length === 1);

    // Hydration from a ?gist= link, with no token configured.
    gist.writeGistConfig(null);
    const linkStore = new gist.MemoryStorage();
    const hydration = await gist.hydrateFromSharedStore(linkStore, new URLSearchParams(`gist=${gistId}`));
    check('?gist=ID hydrates the local database',
      hydration.source === 'link' && JSON.parse(linkStore.getItem('nts.db.v1')).scripts.length === 1,
      JSON.stringify(hydration));

    const none = await gist.hydrateFromSharedStore(new gist.MemoryStorage(), new URLSearchParams(''));
    check('no gist configured → nothing to hydrate',
      none.source === null && none.error === null);

    check('gistStatus reports the sync state',
      typeof gist.gistStatus().configured === 'boolean' &&
      typeof gist.gistStatus().lastError !== 'undefined');
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousLocalStorage;
    gist.writeGistConfig(null);
  }
}

/* ------------------------------------------------------------------ */
/* 5. Published artifact: PWA shell + real documents for routes        */
/* ------------------------------------------------------------------ */

async function artifactTests() {
  console.log('\nPublished artifact\n');

  const sw = await readFile(path.join(root, 'sw.js'), 'utf8').catch(() => null);
  check('the published root ships sw.js', Boolean(sw));
  check('the service worker version is stamped',
    Boolean(sw) && !sw.includes('__VERSION__') && /nt-scripting-[a-z0-9]+/i.test(sw));
  check('the service worker caches the shell and assets',
    Boolean(sw) && sw.includes('/assets/app.js') && sw.includes('index.html'));

  const manifest = await readFile(path.join(root, 'manifest.webmanifest'), 'utf8').catch(() => null);
  let parsedManifest = null;
  try {
    parsedManifest = JSON.parse(manifest);
  } catch {
    parsedManifest = null;
  }
  check('the published root ships a web manifest', Boolean(parsedManifest));
  const iconSizes = (parsedManifest?.icons ?? []).map((icon) => icon.sizes);
  check('the manifest is standalone with base-relative URLs',
    parsedManifest?.display === 'standalone' && parsedManifest?.start_url === './' &&
    parsedManifest?.scope === './',
    `${parsedManifest?.display} ${parsedManifest?.start_url}`);
  check('the manifest declares 192px and 512px raster icons',
    iconSizes.includes('192x192') && iconSizes.includes('512x512') &&
    (parsedManifest?.icons ?? []).some((icon) => icon.purpose === 'maskable'),
    iconSizes.join(','));
  for (const icon of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']) {
    const bytes = await readFile(path.join(root, icon)).catch(() => null);
    check(`${icon} is a real PNG`,
      Boolean(bytes) && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes.subarray(12, 16).toString() === 'IHDR');
  }
  check('an apple-touch-icon is published',
    await readFile(path.join(root, 'icons/apple-touch-icon.png')).then(() => true).catch(() => false));

  for (const route of ['login', 'register', 'connect', 'settings']) {
    const html = await readFile(path.join(root, route, 'index.html'), 'utf8').catch(() => null);
    check(`/${route}/ is published as a real document (HTTP 200, no 404 shell)`,
      Boolean(html) && html.includes('assets/app.js'));
  }

  const index = await readFile(path.join(root, 'index.html'), 'utf8');
  check('the shell links the manifest', index.includes('manifest.webmanifest'));
  check('the shell links the apple-touch-icon', index.includes('apple-touch-icon'));
  const notFound = await readFile(path.join(root, '404.html'), 'utf8');
  check('the 404 shell links the manifest too', notFound.includes('manifest.webmanifest'));
  check('/scripts stays a tooling folder (no shadowing index.html)',
    await readFile(path.join(root, 'scripts/index.html'), 'utf8').then(() => false).catch(() => true));
}


/* ------------------------------------------------------------------ */
/* 6. Backend resolution chain                                         */
/* ------------------------------------------------------------------ */

async function backendSelectionTests() {
  console.log('\nBackend selection\n');
  const { MemoryStorage } = await import(pathToUrl(await bundle('spa/test-entry.tsx', 'api.mjs')));
  const plain = await import(pathToUrl(await bundle('spa/test-entry.tsx', 'api.mjs')));
  void plain;
  const baked = await import(
    pathToUrl(
      await bundle('spa/test-entry.tsx', 'api-baked.mjs', { ntApi: 'https://baked.example' }),
    )
  );

  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const mem = new MemoryStorage();
  globalThis.localStorage = mem;
  globalThis.window = { location: { search: '' }, __NT_API__: undefined };
  baked.useLocalBackend();

  try {
    check('no configuration → the in-browser backend', baked.backendMode() === 'local');
    check('"use this browser" opts out of a build-time default API',
      baked.resolveApiBase() === '', baked.resolveApiBase());

    baked.setStoredApiBase('https://mine.example/');
    check('a stored server URL wins over the in-browser backend',
      baked.resolveApiBase() === 'https://mine.example', baked.resolveApiBase());
    check('the mode flips to remote', baked.backendMode() === 'remote');

    globalThis.window.location.search = '?api=https://query.example';
    check('?api= overrides everything',
      baked.resolveApiBase() === 'https://query.example', baked.resolveApiBase());
    check('?api= is remembered for the session',
      baked.backendMode() === 'remote' && localStorage.getItem('nts.apiBase') === 'https://query.example');

    globalThis.window.location.search = '';
    baked.setStoredApiBase('');
    baked.setStoredApiBase('not a url');
    check('junk URLs are ignored — the build-time default comes back',
      baked.resolveApiBase() === 'https://baked.example', baked.resolveApiBase());
    baked.useLocalBackend();
    check('"use this browser" returns to the in-browser backend for good',
      baked.resolveApiBase() === '' && baked.backendMode() === 'local', baked.resolveApiBase());
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousLocalStorage;
  }
}

/* ------------------------------------------------------------------ */
/* 3. Deployment loader (index.html + 404.html)                        */
/* ------------------------------------------------------------------ */

async function loaderTests() {
  console.log('\nGitHub Pages loader\n');
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const notFound = await readFile(path.join(root, '404.html'), 'utf8');

  const cases = [
    { url: 'https://user.github.io/coolrep/', expected: '/coolrep', label: 'project page root' },
    { url: 'https://user.github.io/coolrep/scripts/01a1', expected: '/coolrep', label: 'project page deep link' },
    { url: 'https://scripting.example.com/', expected: '', label: 'custom domain root' },
    { url: 'https://scripting.example.com/scripts/01a1', expected: '', label: 'custom domain deep link' },
    { url: 'http://localhost:4173/scripts/abc', expected: '', label: 'local preview' },
  ];

  for (const testCase of cases) {
    const dom = new JSDOM(html, { url: testCase.url, runScripts: 'dangerously', pretendToBeVisual: true });
    const base = dom.window.__NT_BASE__;
    const scriptSrc = dom.window.document.querySelector('script[src]')?.getAttribute('src');
    const cssHref = dom.window.document.querySelector('link[rel="stylesheet"]')?.getAttribute('href');
    check(`loader resolves ${testCase.label} → base "${testCase.expected}"`, base === testCase.expected, `got "${base}"`);
    check(`  assets use the resolved base (${testCase.label})`,
      scriptSrc === `${testCase.expected}/assets/app.js` && cssHref === `${testCase.expected}/assets/app.css`,
      `${scriptSrc} / ${cssHref}`);
  }

  check('404.html carries the same loader', notFound.includes('__NT_BASE__') && notFound.includes('/assets/app.js'));
  check('the published root ships .nojekyll', await readFile(path.join(root, '.nojekyll'), 'utf8').then(() => true).catch(() => false));
  check('the published root ships the bundle', await readFile(path.join(root, 'assets/app.js'), 'utf8').then(() => true).catch(() => false));
}

async function main() {
  await writeFile(path.join(tmp, '.keep'), '', 'utf8').catch(async () => {
    await mkdir(tmp, { recursive: true });
  });

  // crypto helpers export bundle (used by the connect flow test)
  await build({
    entryPoints: [path.join(root, 'lib/virtual/crypto.ts')],
    bundle: true,
    write: true,
    outfile: path.join(tmp, 'crypto.mjs'),
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    logLevel: 'error',
  });

  await contractTests();
  await renderTests();
  await loaderTests();
  await gistTests();
  await artifactTests();
  await backendSelectionTests();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nSuite crashed:', error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Contract tests for the recreated API. Everything goes over real HTTP so the
 * suite also covers middleware (CORS), cookies and status codes.
 *
 *   node scripts/smoke.mjs [baseUrl]
 */
const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

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

async function call(path, { method = 'GET', body, cookie, headers = {}, raw = false } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  if (!raw && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json, text, headers: response.headers };
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

async function main() {
  console.log(`\nNT Scripting API contract tests → ${BASE}\n`);
  const suffix = Math.random().toString(36).slice(2, 8);

  /* ---------- health ---------- */
  const health = await call('/api/health');
  check('GET /api/health → 200', health.status === 200, `got ${health.status}`);
  check('health payload has status ok', health.json?.status === 'ok');

  /* ---------- unauthenticated behaviour ---------- */
  const list = await call('/api/scripts');
  check('GET /api/scripts anonymous → 401', list.status === 401, `got ${list.status}`);
  check('401 body is empty (matches upstream)', list.text === '', `body: ${list.text.slice(0, 40)}`);

  const session = await call('/api/auth/session');
  check('GET /api/auth/session anonymous → 200 { user: null }', session.status === 200 && session.json?.user === null);

  /* ---------- registration + login ---------- */
  const username = `smoke_${suffix}`;
  const register = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'Smoke Tester', username, password: 'smoke-pass-123' },
  });
  check('POST /api/auth/register → 201', register.status === 201, `got ${register.status} ${register.text.slice(0, 80)}`);
  check('register returns public user shape', Boolean(register.json?.user?.user_id && register.json?.user?.username === username));
  const userId = register.json?.user?.user_id;
  let cookie = cookieFrom(register);
  check('register sets a session cookie', Boolean(cookie));

  const duplicate = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'Smoke Tester', username, password: 'smoke-pass-123' },
  });
  check('duplicate username → 409', duplicate.status === 409, `got ${duplicate.status}`);

  const badLogin = await call('/api/auth/login', {
    method: 'POST',
    body: { username, password: 'wrong-password' },
  });
  check('wrong password → 401', badLogin.status === 401, `got ${badLogin.status}`);

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { username, password: 'smoke-pass-123' },
  });
  check('POST /api/auth/login → 200', login.status === 200);
  cookie = cookieFrom(login) ?? cookie;

  /* ---------- users ---------- */
  const userGet = await call(`/api/users/${userId}`);
  check('GET /api/users/{id} → 200 { user_id, name, username }',
    userGet.status === 200 && userGet.json?.user_id === userId && typeof userGet.json?.name === 'string' && 'username' in userGet.json);
  check('GET /api/users/{id} leaks no private fields',
    userGet.json && !('password_hash' in userGet.json) && !('email' in userGet.json));

  const userMissing = await call('/api/users/00000000-0000-7000-8000-000000000000');
  check('GET unknown user → 404', userMissing.status === 404, `got ${userMissing.status}`);

  /* ---------- scripts CRUD ---------- */
  const created = await call('/api/scripts', {
    method: 'POST',
    cookie,
    body: {
      name: 'Smoke Script',
      description: 'created by smoke test',
      code: 'function tick() end\n',
      publish: false,
    },
  });
  check('POST /api/scripts → 201', created.status === 201, `got ${created.status} ${created.text.slice(0, 100)}`);
  const scriptId = created.json?.script_id;
  check('script id looks like a UUIDv7', /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scriptId ?? ''),
    `got ${scriptId}`);
  check('new draft has published_at = null', created.json?.published_at === null);
  check('script detail carries map ids', Boolean(created.json?.user_map_id && created.json?.user_map_internal_id));

  const draftAnonymous = await call(`/api/scripts/${scriptId}`);
  check('draft is hidden from anonymous viewers → 404', draftAnonymous.status === 404, `got ${draftAnonymous.status}`);

  const pub = await call(`/api/scripts/${scriptId}/publish`, { method: 'POST', cookie, body: {} });
  check('POST /api/scripts/{id}/publish → 200', pub.status === 200, `got ${pub.status} ${pub.text.slice(0, 80)}`);
  check('publish returns a release', Number.isInteger(pub.json?.release?.id));

  const detail = await call(`/api/scripts/${scriptId}`);
  check('GET /api/scripts/{id} after publish → 200', detail.status === 200);
  const expectedKeys = ['script_id', 'name', 'description', 'user_map_id', 'user_map_internal_id',
    'created_at', 'updated_at', 'published_at', 'author_uuid', 'author_name', 'is_favorite'];
  check('script detail exposes exactly the upstream fields',
    expectedKeys.every((key) => key in (detail.json ?? {})) &&
    Object.keys(detail.json ?? {}).length === expectedKeys.length,
    `keys: ${Object.keys(detail.json ?? {}).join(',')}`);
  check('timestamps use microsecond ISO format',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(detail.json?.created_at ?? ''), detail.json?.created_at);

  const releases = await call(`/api/scripts/${scriptId}/releases`);
  check('GET /api/scripts/{id}/releases → { releases: [...] }', releases.status === 200 && Array.isArray(releases.json?.releases));
  check('releases expose id/description/created_at only',
    releases.json?.releases?.every((row) => Object.keys(row).sort().join(',') === 'created_at,description,id'));

  const codeGet = await call(`/api/scripts/${scriptId}/code`, { cookie });
  check('GET /api/scripts/{id}/code (owner) → 200', codeGet.status === 200 && typeof codeGet.json?.code === 'string');
  const codeAnon = await call(`/api/scripts/${scriptId}/code`);
  check('GET /api/scripts/{id}/code anonymous → 401', codeAnon.status === 401, `got ${codeAnon.status}`);
  const codePut = await call(`/api/scripts/${scriptId}/code`, {
    method: 'PUT',
    cookie,
    body: { code: 'function tick() log("hi") end\n' },
  });
  check('PUT /api/scripts/{id}/code → 200', codePut.status === 200 && codePut.json?.code?.includes('hi'));

  const patch = await call(`/api/scripts/${scriptId}`, {
    method: 'PATCH',
    cookie,
    body: { name: 'Smoke Script v2' },
  });
  check('PATCH /api/scripts/{id} → 200', patch.status === 200 && patch.json?.name === 'Smoke Script v2');

  const foreignPatch = await call(`/api/scripts/${scriptId}`, { method: 'PATCH', body: { name: 'nope' } });
  check('PATCH without session → 401', foreignPatch.status === 401, `got ${foreignPatch.status}`);

  /* ---------- favorites ---------- */
  const fav = await call(`/api/scripts/${scriptId}/favorite`, { method: 'POST', cookie });
  check('POST /api/scripts/{id}/favorite → is_favorite true', fav.status === 200 && fav.json?.is_favorite === true);
  const favList = await call(`/api/users/${userId}/favorites`, { cookie });
  check('favorited script appears in /users/{id}/favorites',
    favList.json?.scripts?.some((row) => row.script_id === scriptId));
  const unfav = await call(`/api/scripts/${scriptId}/favorite`, { method: 'DELETE', cookie });
  check('DELETE /api/scripts/{id}/favorite → is_favorite false', unfav.status === 200 && unfav.json?.is_favorite === false);

  /* ---------- share / launch links ---------- */
  const shared = await call(`/api/scripts/${scriptId}/share`, { method: 'POST', cookie, body: {} });
  check('POST /api/scripts/{id}/share → 201', shared.status === 201, `got ${shared.status} ${shared.text.slice(0, 80)}`);
  check('share returns a launch url + token', typeof shared.json?.url === 'string' && typeof shared.json?.token === 'string');
  const shareGet = await call(`/api/scripts/${scriptId}/share`);
  check('GET /api/scripts/{id}/share → 405', shareGet.status === 405, `got ${shareGet.status}`);

  const resolved = await call(`/api/share/${shared.json?.token}`);
  check('GET /api/share/{token} → 200 with script + release',
    resolved.status === 200 && resolved.json?.script?.script_id === scriptId && Number.isInteger(resolved.json?.release?.id));
  const shareMissing = await call('/api/share/does-not-exist');
  check('GET /api/share/{unknown} → 404', shareMissing.status === 404, `got ${shareMissing.status}`);

  /* ---------- profile listings ---------- */
  const mine = await call(`/api/users/${userId}/scripts`, { cookie });
  check('GET /api/users/{id}/scripts → { scripts: [...] }', mine.status === 200 && Array.isArray(mine.json?.scripts));
  check('list items omit map ids (like upstream)',
    mine.json?.scripts?.every((row) => !('user_map_id' in row) && !('user_map_internal_id' in row)));

  /* ---------- CORS ---------- */
  const preflight = await call('/api/scripts', {
    raw: true,
    method: 'OPTIONS',
    headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' },
  });
  check('OPTIONS /api/* → 204', preflight.status === 204, `got ${preflight.status}`);
  check('CORS credentials header present', preflight.headers.get('access-control-allow-credentials') === 'true');
  check('CORS vary header matches upstream',
    (preflight.headers.get('vary') ?? '').includes('Access-Control-Request-Method'));

  /* ---------- connect redirect ---------- */
  const connect = await call('/connect?return_to=%2Fscripts');
  check('GET /connect → 302 to the authorize endpoint', connect.status === 302, `got ${connect.status}`);
  const location = connect.headers.get('location') ?? '';
  check('authorize URL carries scope/response_type/redirect_uri/client_id',
    location.includes('scope=openid') && location.includes('response_type=id_token') &&
    location.includes('redirect_uri=') && location.includes('client_id='), location);

  /* ---------- password ---------- */
  const password = await call('/api/auth/password', {
    method: 'POST',
    cookie,
    body: { current_password: 'smoke-pass-123', new_password: 'smoke-pass-456' },
  });
  check('POST /api/auth/password → 200', password.status === 200, `got ${password.status} ${password.text.slice(0, 80)}`);
  const relogin = await call('/api/auth/login', {
    method: 'POST',
    body: { username, password: 'smoke-pass-456' },
  });
  check('login with the new password works', relogin.status === 200);

  /* ---------- delete ---------- */
  const removed = await call(`/api/scripts/${scriptId}`, { method: 'DELETE', cookie });
  check('DELETE /api/scripts/{id} → 200', removed.status === 200, `got ${removed.status}`);
  const gone = await call(`/api/scripts/${scriptId}`);
  check('deleted script → 404', gone.status === 404, `got ${gone.status}`);

  const logout = await call('/api/auth/logout', { method: 'POST', cookie });
  check('POST /api/auth/logout → 200', logout.status === 200);

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

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

  /* ---------- invites: content tokens + cross-site borrowing ---------- */
  const invite = await call(`/api/scripts/${scriptId}/invite`, { method: 'POST', cookie, body: {} });
  check('POST /api/scripts/{id}/invite → 201', invite.status === 201, `got ${invite.status} ${invite.text.slice(0, 90)}`);
  check('invite document has realm/script/bp',
    invite.json?.realm === 'experiment:scripts' &&
    typeof invite.json?.script === 'string' &&
    Array.isArray(invite.json?.bp) && invite.json.bp.length === 32);
  check('invite.script points at this deployment\'s content endpoint',
    invite.json?.script?.includes(`/api/scripts/${scriptId}/content?token=`),
    invite.json?.script?.slice(0, 110));
  check('invite payload round-trips to the same document',
    (() => {
      try {
        const parsed = JSON.parse(invite.json?.payload ?? '');
        return parsed.realm === invite.json.realm && parsed.script === invite.json.script &&
          JSON.stringify(parsed.bp) === JSON.stringify(invite.json.bp);
      } catch {
        return false;
      }
    })());
  const tokenParts = String(invite.json?.token ?? '').split('.');
  check('content token is a three-part JWT', tokenParts.length === 3);
  check('token header is {"typ":"JWT","alg":"HS256"}',
    Buffer.from(tokenParts[0] ?? '', 'base64').toString() === '{"typ":"JWT","alg":"HS256"}',
    Buffer.from(tokenParts[0] ?? '', 'base64').toString());
  const claims = (() => {
    try {
      return JSON.parse(Buffer.from(tokenParts[1] ?? '', 'base64').toString());
    } catch {
      return null;
    }
  })();
  check('token claims are { script_id, revision_id, exp }',
    claims?.script_id === scriptId && Number.isInteger(claims?.revision_id) && Number.isInteger(claims?.exp),
    JSON.stringify(claims));
  check('bp matches the observed battle-parameter vector',
    invite.json?.bp?.[6] === 254 && invite.json?.bp?.[9] === -600 && invite.json?.bp?.at(-1) === 1);
  check('invite default lifetime is 15 minutes', claims?.exp - claims?.iat === 900, String(claims?.exp - claims?.iat));

  const content = await call(`/api/scripts/${scriptId}/content?token=${invite.json.token}`, { raw: true });
  check('GET content with the invite token → 200 text/plain',
    content.status === 200 && (content.headers.get('content-type') ?? '').includes('text/plain'),
    `${content.status} ${content.headers.get('content-type')}`);
  check('content is the published revision source', content.text === 'function tick() end\n', JSON.stringify(content.text));
  check('content carries the revision headers',
    content.headers.get('x-script-id') === scriptId && content.headers.get('x-revision-id') === String(claims?.revision_id));

  const contentJson = await call(`/api/scripts/${scriptId}/content?format=json&token=${invite.json.token}`);
  check('content?format=json → 200 with the same source',
    contentJson.status === 200 && contentJson.json?.content === 'function tick() end\n' &&
    contentJson.json?.script_id === scriptId);
  const contentHead = await call(`/api/scripts/${scriptId}/content?token=${invite.json.token}`, { method: 'HEAD' });
  check('HEAD content with a valid token → 200', contentHead.status === 200, `got ${contentHead.status}`);

  const contentAnon = await call(`/api/scripts/${scriptId}/content`, { raw: true });
  check('content without a token → 401 with an empty body', contentAnon.status === 401 && contentAnon.text === '',
    `${contentAnon.status} "${contentAnon.text}"`);

  const tampered = `${tokenParts[0]}.${tokenParts[1]}.${(tokenParts[2] ?? '').slice(0, -2)}AA`;
  const contentBad = await call(`/api/scripts/${scriptId}/content?token=${tampered}`);
  check('content with a forged signature → 401', contentBad.status === 401, `got ${contentBad.status}`);

  const listed = await call('/api/scripts?limit=10', { cookie });
  const otherId = listed.json?.scripts?.map((row) => row.script_id).find((id) => id !== scriptId);
  if (otherId) {
    const mismatched = await call(`/api/scripts/${otherId}/content?token=${invite.json.token}`);
    check('a token is bound to its own script → 403', mismatched.status === 403, `got ${mismatched.status}`);
  }

  const inviteAnon = await call(`/api/scripts/${scriptId}/invite`, { method: 'POST', body: {} });
  check('POST invite without a session → 401', inviteAnon.status === 401, `got ${inviteAnon.status}`);
  const inviteGet = await call(`/api/scripts/${scriptId}/invite`);
  check('GET invite → 405', inviteGet.status === 405, `got ${inviteGet.status}`);

  /* ---------- borrowing a script from another site ---------- */
  const inspected = await call('/api/import/inspect', {
    method: 'POST',
    cookie,
    body: { invite: invite.json.payload },
  });
  check('POST /api/import/inspect reads the invite payload', inspected.status === 200,
    `got ${inspected.status} ${inspected.text.slice(0, 90)}`);
  check('inspect returns the source it fetched',
    inspected.json?.content === 'function tick() end\n' && inspected.json?.script_id === scriptId);
  check('inspect reports the revision and expiry',
    inspected.json?.revision_id === claims?.revision_id && typeof inspected.json?.expires_at === 'string');

  const inspectedLink = await call('/api/import/inspect', {
    method: 'POST',
    cookie,
    body: { invite: invite.json.deep_link },
  });
  check('inspect also accepts the deep link form', inspectedLink.status === 200 && inspectedLink.json?.content === 'function tick() end\n');

  const inspectedBase64 = await call('/api/import/inspect', {
    method: 'POST',
    cookie,
    body: { invite: invite.json.invite_b64 },
  });
  check('inspect also accepts the base64 form', inspectedBase64.status === 200);

  const inspectedBad = await call('/api/import/inspect', { method: 'POST', cookie, body: { invite: 'hello there' } });
  check('inspect rejects a non-invite → 400', inspectedBad.status === 400, `got ${inspectedBad.status}`);
  const inspectGet = await call('/api/import/inspect');
  check('GET /api/import/inspect → 405', inspectGet.status === 405, `got ${inspectGet.status}`);

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

# API reference

Two things are called “the API” around this platform, and this repository covers both:

1. **Platform REST API** — `https://scripting.nulls.gg/api/*`, reimplemented here
   endpoint-for-endpoint (this document).
2. **In-game scripting API (Lua/Luau)** — `server`, `tick()`, `lookup()`, `createObject()`,
   event listeners… documented by the community at
   [`nulls-mods-community/scripting-docs`](https://github.com/nulls-mods-community/scripting-docs).
   This clone *does not* run battles, so it implements the platform side only.

Legend: **verified** = observed against the live service on 2026-10-30 (status + headers
+ body). **inferred** = designed here to complete the workflow; shape is documented and
stable, but not confirmed upstream. See `docs/RESEARCH.md` for the method.

Base URL in this repo: `http://localhost:3000` (or `APP_URL`).
All JSON responses are `Cache-Control: no-store`.

---

## 0. Conventions

| Topic | Behaviour |
| --- | --- |
| Ids | UUIDv7 (`01a18307-1527-7454-9557-e96cac0d2448`), time ordered |
| Timestamps | ISO-8601 with **microseconds**, `2026-10-30T12:05:50.203568Z` |
| Errors | `{"error": "human readable message"}`, except `401` which has an **empty body** (verified) |
| Auth | http-only session cookie `nts_session` (signed) or `Authorization: Bearer <session>` |
| CORS | `access-control-allow-credentials: true`, `vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`, origin echoed for allow-listed hosts |
| Visibility | drafts are only visible to their author; anonymous callers get `404` for them |

Standard statuses: `200` ok, `201` created, `204` preflight, `400` validation,
`401` unauthenticated, `403` not the owner, `404` unknown/hidden resource,
`405` wrong method, `409` conflict/state, `410` expired link, `413` too large,
`429` rate limited, `500` unexpected.

---

## 1. Session & auth

### `GET /api/auth/session` — inferred
```json
{"user": {"user_id": "…", "name": "Demo Author", "username": "demo"}}
```
Anonymous: `200 {"user": null}`.

### `POST /api/auth/register` — inferred
Body: `{"name": "Demo Author", "username": "demo", "password": "…"}`
- `201` + `Set-Cookie` + `{"user": {…}}`
- `400` invalid username/password (`[a-z0-9_]{3,24}`, password ≥ 8)
- `409` `{"error":"Username already taken"}`

### `POST /api/auth/login` — inferred
Body: `{"username": "demo", "password": "…"}` → `200 {"user": {…}}` + cookie,
`401 {"error":"Invalid username or password"}` (identical for unknown user / bad password).

### `POST /api/auth/logout` — inferred
`200 {"ok": true}`, clears the cookie and deletes the session row.

### `GET /api/auth/password` — inferred
`{"password_configured": true|false}` (drives the *Configured* / *Not configured* pill).

### `POST /api/auth/password` — inferred
`{"current_password": "…", "new_password": "…"}` — `current_password` only required when
one is already set. `400`/`403` on validation failure, `200 {"ok":true}` otherwise.

### `POST /api/auth/connect` — inferred (flow verified)
Exchanges a Null’s Connect `id_token` (arrives in the URL fragment of `/connect`) for a
first-party session.

```json
// request
{"id_token": "eyJhbGciOi…", "return_to": "/scripts"}
// 200
{"user": {"user_id":"…","name":"…","username":"…"}, "return_to": "/scripts", "token_verified": true}
```
Verification order: `CONNECT_JWT_SECRET` (HS256, bundled provider) →
`CONNECT_JWKS_URL` (RS256/ES256, real provider) → `CONNECT_ALLOW_UNVERIFIED=1` (dev only).
`exp`, `iss` and `aud` are always checked when present.

---

## 2. Users

| Endpoint | Status | Shape |
| --- | --- | --- |
| `GET /api/users/{uuid}` | **verified** | `{user_id, name, username}` (no email/password ever) |
| `GET /api/users/{uuid}/scripts` | **verified** | `{scripts: [ScriptListItem]}` |
| `GET /api/users/{uuid}/favorites` | **verified** | `{scripts: [ScriptListItem]}` |
| `GET /api/users/me` | inferred | public user + `password_configured` |

`ScriptListItem` (**verified** field set):
```json
{
  "script_id": "…", "name": "…", "description": null,
  "created_at": "…", "updated_at": "…", "published_at": "…",
  "author_uuid": "…", "author_name": "…", "is_favorite": false
}
```
Query: `limit` (1-200, default 100), `offset` (≥ 0). Owners additionally see their drafts
in `/users/{uuid}/scripts`.

Unknown / non-UUID id → `404 {"error":"User not found"}`.

---

## 3. Scripts

### `GET /api/scripts` — **verified** (anonymous → `401`, empty body)
Authenticated:
```json
{"scripts": [ScriptListItem], "total": 42, "limit": 24, "offset": 0}
```
Query: `limit` (1-100, default 24), `offset`, `sort` = `recent|updated|name`,
`search` (also accepted as `q`), `author` (uuid).

### `POST /api/scripts` — inferred
```json
{"name": "Smoke Script", "description": "…", "code": "function tick() end", "publish": false}
```
`201` with the **full detail object** (`ScriptDetail`, below). `publish: true` also cuts
release `#1`.

### `GET /api/scripts/{uuid}` — **verified**
`ScriptDetail` — exactly these eleven fields:
```json
{
  "script_id": "…", "name": "…", "description": "…|null",
  "user_map_id": "…", "user_map_internal_id": "CRPJR2C0U:9YGC8UV9RCJ",
  "created_at": "…", "updated_at": "…", "published_at": "…|null",
  "author_uuid": "…", "author_name": "…", "is_favorite": false
}
```

### `PATCH /api/scripts/{uuid}` — inferred (owner)
Any of `name`, `description`, `code`, `user_map_id`, `user_map_internal_id`.
`200` detail; `403` if not the author.

### `DELETE /api/scripts/{uuid}` — inferred (owner)
`200 {"ok": true}` — cascades releases, shares and favorites.

### `GET /api/scripts/{uuid}/code` — inferred (owner)
`{"script_id":"…","code":"…","updated_at":"…"}` — the draft source.

### `PUT /api/scripts/{uuid}/code` — inferred (owner)
`{"code": "…"}` (≤ 512 KiB) → `200 {"script_id","code","updated_at","published_at"}`.

### `POST /api/scripts/{uuid}/publish` — inferred
Optional `{"description": "release notes"}`. Publishes the draft and snapshots a release.
```json
{"script_id": "…", "published_at": "…", "release": {"id": 16311, "description": null, "created_at": "…"}}
```
`409` if the script is not publishable yet, `403` if not the owner.

### `POST /api/scripts/{uuid}/share` — inferred (upstream bug reproduced in the issue tracker)
Creates the **“Start friendly battle”** launch token.
Body (optional): `{"expires_in": 86400, "release_id": 16310}`.

```json
// 201
{
  "token": "…", "url": "https://host/b/…", "share_url": "https://host/b/…",
  "link": "https://host/b/…", "deep_link": "nullsbrawl://script/…",
  "script_id": "…", "release_id": 16310,
  "expires_at": "…", "created_at": "…"
}
```
`url` / `share_url` / `link` are aliases on purpose: the upstream field name is not
observable without an account, so clients expecting any of them keep working.
`409` when the script is not published, `403` when not the owner, `405` on `GET`.

### `GET /api/scripts/{uuid}/releases` — **verified**
```json
{"releases": [{"id": 15862, "description": null, "created_at": "2026-10-28T15:00:41.895585Z"}]}
```
Newest first, exactly those three keys per row.

### `GET /api/scripts/{uuid}/releases/{releaseId}` — inferred
`{id, description, created_at, script_id, author_uuid}` plus `code` for the author only.

### `POST|DELETE /api/scripts/{uuid}/favorite` — inferred
`200 {"script_id":"…","is_favorite":true|false,"favorites":3}`

### `GET /api/share/{token}` — inferred
Resolves a launch link: `{token, script_id, release_id, created_at, expires_at, uses,
script: ScriptDetail, release: {id, description, created_at, code}}`.
Unknown token → `404`, expired → `410`.

### `GET /api/health` — inferred
`{"status":"ok","time":"…","version":1,"counts":{…}}`.

---

## 4. CORS preflight

```
OPTIONS /api/scripts
Origin: https://example.com
Access-Control-Request-Method: GET
```
→ `204`, `access-control-allow-credentials: true`,
`access-control-allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS`,
`access-control-allow-headers: <echo>`, `access-control-max-age: 600`,
`vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`.
`access-control-allow-origin` is echoed only for `CORS_ORIGINS`, `APP_URL`, localhost and
`*.e2b.app` preview hosts.

---

## 5. Compatibility matrix (upstream ↔ clone)

| # | Upstream | Clone | Evidence |
| --- | --- | --- | --- |
| 1 | `GET /api/scripts` (401 anon, empty) | same | verified |
| 2 | `GET /api/scripts/{uuid}` | same field set/order-independent | verified |
| 3 | `GET /api/scripts/{uuid}/releases` | same envelope + 3 keys | verified |
| 4 | `GET /api/users/{uuid}` | same 3 fields | verified |
| 5 | `GET /api/users/{uuid}/scripts` | same envelope, map ids omitted | verified |
| 6 | `GET /api/users/{uuid}/favorites` | same | verified |
| 7 | `GET /connect` → 302 authorize | same query params, 302, fragment return | verified |
| 8 | Pages `/`, `/login`, `/register`, `/settings`, `/scripts`, `/scripts/{uuid}`, `/users/{uuid}`, `/users/{uuid}/scripts`, 404 | same routes & copy | verified |
| 9 | `POST /api/scripts/{uuid}/share` | implemented (upstream currently 404s — bug #12) | issue report |
| 10 | Editor / draft / publish workflow | implemented | issue #12 description |

Run `node scripts/smoke.mjs` to assert 51 of these behaviours over real HTTP.


---

## Invites (reconstructed from invite payloads)

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/scripts/{uuid}/invite` | signed-in; returns `{realm, script, bp}` + token + deep link |
| `GET` | `/api/scripts/{uuid}/content?token=…` | invite-token authorised source, `text/plain` (`?format=json` for an object) |
| `HEAD` | `/api/scripts/{uuid}/content?token=…` | liveness probe for an invite |
| `POST` | `/api/import/inspect` | read a foreign invite and preview its source |

The token is `HS256({script_id, revision_id, exp})`, header `{"typ":"JWT","alg":"HS256"}` —
byte-identical to the tokens observed inside real invites. See
[`INVITES.md`](INVITES.md) for the full contract.

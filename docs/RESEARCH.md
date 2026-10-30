# Research log — how the upstream platform was analysed

Target: `https://scripting.nulls.gg` (“NT Scripting”, the script-sharing platform for
Null’s Brawl).
Date of analysis: **2026-10-30**.

> Scope note: this document records the *behaviour* of a public web service so that an
> independent implementation can be written. No source code, bundle, stylesheet, asset,
> database dump or user content was copied from the upstream service. Everything in this
> repository is original code written for this project.

## 1. Constraints of the analysis environment

The sandbox used for this work has an egress allow-list (GitHub, npm, PyPI only), so
`curl` against the target fails with `SSL_ERROR_SYSCALL`. All traffic therefore went
through two web tools:

| Tool | What it yields | What it cannot yield |
| --- | --- | --- |
| a rendering fetch proxy (headless browser → markdown) | page text, DOM-derived structure, JSON bodies | status codes, headers, raw JS bundles, CSS |
| a public header-echo service (`api.hackertarget.com/httpheaders`) | status line + response headers | bodies |

Combining both gave **status code + headers + body** for every endpoint probed, which is
enough to reconstruct the request/response contract. It is *not* enough to byte-clone the
CSS or read the client bundle, which is why the UI in this repo is a faithful
**reconstruction** rather than a pixel copy (see §6).

## 2. Stack fingerprint

| Observation | Conclusion |
| --- | --- |
| HTML responses: `Content-Type: text/html`, `Transfer-Encoding: chunked`, `Cache-Control: max-age=0, no-store, no-cache`, `cf-cache-status: BYPASS` | Next.js-style SSR/SPA front end behind Cloudflare |
| `/api/*` responses: `access-control-allow-credentials: true`, `vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`, `cf-cache-status: DYNAMIC`, `Content-Length: 0` on 401 | Spring Security-style CORS filter on a separate API service, path-routed through the same host |
| Resource ids `01a18307-1527-7454-9557-e96cac0d2448` | **UUIDv7** (time-ordered), produced by a ULID-ish generator |
| Timestamps `2026-10-28T15:00:41.895585Z` | ISO-8601 with **6-digit microseconds** (Java `Instant`/`LocalDateTime` + `Z`) |
| Release ids `15862, 15887, …` | monotonically increasing integer sequence |
| Auth | `connect.nulls.gg` OIDC-style provider, `response_type=id_token`, plus optional password login |

## 3. Pages discovered (GET)

| Route | Result | Notes |
| --- | --- | --- |
| `/` | 200 | landing: “Heeeey, scripting is here!” + “Continue with Null’s Connect” |
| `/login` | 200 | `Log In` / Username / Password / `Log In` / *or* / Connect / “Don’t have an account? Register” |
| `/register` | 200 | `Create Account` / Display Name / Username / Password / `Register` / Connect / “Already have an account? Log In” |
| `/connect` | 302 | redirects to the provider authorize endpoint (see §5) |
| `/scripts` | 200 | client-rendered list, initial text `Loading...` |
| `/scripts/{uuid}` | 200 | script page: title, author, description, **Start friendly battle**, **Releases** |
| `/scripts/{uuid}/releases` | 404 | releases are rendered inside the script page, not as a route |
| `/scripts/new` | soft-404 | renders the script layout with “Page not found” (editor is client-gated) |
| `/users/{uuid}` | 200 | profile: name, `@handle`, **Favorites** list, **Scripts** list |
| `/users/{uuid}/scripts` | 200 | same cards, scripts only |
| `/settings` | 200 | `Settings` → `Sign in methods` → **Password** (`Not configured` / `Change password`), **Null’s Connect** (`Connect`) |
| `/search`, `/docs`, `/terms`, `/favorites`, `/editor`, `/api/me` | 404 | do not exist |

Page-not-found template: heading `Page not found`, body `The page you are looking for does
not exist or has been moved.`, link `Go to homepage`, footer code `404`.

## 4. REST endpoints (verified)

`✓` = observed directly. Every JSON sample below was captured from the live service
(personal data of third parties removed).

### `GET /api/scripts/{uuid}` — 200 `application/json`

```json
{
  "script_id": "01a18307-1527-7454-9557-e96cac0d2448",
  "name": "Among Us MODDED",
  "description": "Among us v3.0.0, but with Sheriff, Jester, …",
  "user_map_id": "ef521933-9e64-4408-be9f-aa0888d8dbeb",
  "user_map_internal_id": "CRPJR2C0U:9YGC8UV9RCJ",
  "created_at": "2026-10-28T15:00:41.895585Z",
  "updated_at": "2026-10-30T12:05:50.203568Z",
  "published_at": "2026-10-30T12:05:57.363992Z",
  "author_uuid": "4572854d-b1b1-406b-82e8-b483998ae0c6",
  "author_name": "ReareKit",
  "is_favorite": false
}
```

### `GET /api/scripts/{uuid}/releases` — 200

```json
{"releases":[{"id":15862,"description":null,"created_at":"2026-10-28T15:00:41.895585Z"}, …]}
```

Newest first. `description` is nullable.

### `GET /api/users/{uuid}` — 200

```json
{"user_id":"4572854d-b1b1-406b-82e8-b483998ae0c6","name":"ReareKit","username":"rearekit"}
```

No email, password or provider fields are exposed.

### `GET /api/users/{uuid}/scripts` — 200

```json
{"scripts":[{"script_id":"…","name":"Spawn Box On Pin","description":null,
"created_at":"…","updated_at":"…","published_at":"…","author_uuid":"…",
"author_name":"ReareKit","is_favorite":false}, …]}
```

List items are a **subset** of the detail object: no `user_map_id`,
no `user_map_internal_id`. Author name is denormalised into every row.

### `GET /api/users/{uuid}/favorites` — 200

Same `{ "scripts": [...] }` envelope as above.

### `GET /api/scripts` — **401** (anonymous)

Status line `HTTP/1.1 401 Unauthorized`, `Content-Length: 0` — the 401 has an **empty
body**, so clients must not expect JSON on error.

### `GET /api/me` — 404 (does not exist)

### `POST /api/scripts/{uuid}/share` — the “Start friendly battle” call

- `GET` on the route returns an empty non-200 (405/404) — it is POST-only.
- Community issue *nulls-mods-community/scripting-docs#12* documents a real request:
  after publishing, `POST /api/scripts/<uuid>/share` answered `HTTP 404` with body
  `{"error":"Script not found"}`. That reproduces an upstream bug (the handler rejects
  published scripts of freshly registered accounts).
- Error envelope therefore is `{"error": "<message>"}`.

### CORS preflight shape

`access-control-allow-credentials: true` + `vary: Origin, Access-Control-Request-Method,
Access-Control-Request-Headers` on every `/api/*` response, including errors.
`Access-Control-Allow-Origin` is only ever echoed for trusted origins (credentials +
`*` is illegal), which matches the `vary: Origin` header.

## 5. Null’s Connect flow

A plain visit to `/connect` answers:

```
HTTP/1.1 302 Found
location: https://connect.nulls.gg/authorize?scope=openid+email&response_type=id_token
          &redirect_uri=https%3A%2F%2Fscripting.nulls.gg%2Fconnect&client_id=9#sign_up
```

Key facts:

1. `response_type=id_token` → implicit flow, the token arrives in the **URL fragment**
   of `https://scripting.nulls.gg/connect`.
2. `client_id=9`, `scope="openid email"`, `redirect_uri` fixed to `/connect`.
3. The provider screen brands itself “Null’s Connect”, with a single
   “Enter your email address → Proceed” step, a login-code step, a rules/terms step and
   an account picker; the outer app is offered as an “External authentication” client.

The clone reproduces this shape 1:1 (302, same query parameters, fragment return) and
ships a local provider at `/mock-connect/authorize` so the flow works offline.

## 6. What is *reconstructed* rather than copied

| Area | Upstream | Here |
| --- | --- | --- |
| Visual design | unknown CSS bundle | original dark design system written from the observed information architecture and copy |
| Brand assets | `nulls-connect-32.png`, logo | original CSS marks (`NT`, `NC`) |
| Script content | users’ Lua scripts | original demo scripts written for this repo |
| In-game Lua API | documented in `nulls-mods-community/scripting-docs` | linked, not vendored |
| Editor/layout internals | not observable without a session | implemented to match the documented workflow (“+ / upload .lua / save / publish”) |
| Unknown response fields | not observable unauthenticated | designed as a documented superset (`docs/API.md` §4) |

Because status codes and bodies are verified but arbitrary authenticated responses are
not observable without an account, every endpoint in `docs/API.md` is tagged
**verified** or **inferred**. Nothing verified is invented; nothing inferred is claimed
as fact.

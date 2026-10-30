# NT Scripting — full-stack recreation

A working, from-scratch recreation of the **scripting.nulls.gg** platform
(“NT Scripting”): the website, its REST API, its authentication flow, its editor and its
“start friendly battle” launch links.

Everything here is **original code** written against the *observed behaviour* of the
public service — same routes, same endpoints, same response shapes, same auth dance.
No upstream source, bundle, stylesheet, asset or user content was copied. The research
that backs every decision is in [`docs/RESEARCH.md`](docs/RESEARCH.md), and the full
endpoint contract (verified vs. inferred) is in [`docs/API.md`](docs/API.md).

```
Next.js 15 (App Router, React 19, TypeScript)  ·  26 server routes  ·  zero native deps
78 HTTP contract tests  ·  132 static-build tests  ·  JSON-file database with atomic writes
OIDC-style id_token login with a bundled identity provider  ·  UUIDv7 ids, µs timestamps
```

**Two deployables, one codebase:**

| | Server build | Static build (GitHub Pages) |
| --- | --- | --- |
| Run / build | `npm run dev` · `npm run build && npm start` | `npm run build:static` |
| Backend | Next.js route handlers in `app/api/**` | the same 21 endpoints in the browser (`lib/virtual/server.ts`) |
| Data | `.data/db.json` | IndexedDB, optionally shared through a GitHub Gist or a server build |
| Extra | — | installable PWA, offline shell, deep links |
| Best for | real multi-user hosting | a live site on GitHub Pages — sharing included |

See [`docs/STATIC.md`](docs/STATIC.md) for the static build in detail, and
[`docs/INVITES.md`](docs/INVITES.md) for friendly-battle invites and cross-site script
borrowing (`{ realm, script, bp }` → signed content URL).

### Three ways to store the data of the static build

| Mode | Setup | Shared between devices? |
| --- | --- | --- |
| **This browser** | none (default) | no — IndexedDB per profile |
| **GitHub Gist** | paste a token with the `gist` scope in *Settings → Backend* | **yes** — the document lives in the gist, `?gist=<id>` opens it anywhere |
| **Server build** | deploy `deploy/render.yaml` (or Fly/Railway/Compose), then paste the URL | **yes** — real multi-user API with Bearer sessions |

```bash
# bake a default backend into the static bundle
NT_API=https://nt-scripting.onrender.com npm run build:static
```

The gist transport needs no infrastructure at all: local writes hit IndexedDB first, then
flush to `api.github.com/gists` (1.2 s debounce, queued while offline), and the token never
leaves the browser.

---

## Friendly-battle invites (cross-site scripts)

A Null's Brawl script-room invite decodes to `{ realm, script, bp }`, where `script` is a
**content URL that carries its own access token**. This repository speaks that format in both
directions:

| Direction | Endpoint | What it does |
| --- | --- | --- |
| out | `POST /api/scripts/{id}/invite` | mints an HS256 `{script_id, revision_id, exp}` token and returns the invite document, payload, base64 form, deep link and import link |
| out | `GET /api/scripts/{id}/content?token=…` | serves the published revision as `text/plain` (or JSON with `?format=json`) — no account needed |
| in | `POST /api/import/inspect` | reads an invite from *any* site, fetches the source and previews it |
| in (UI) | `/import` | paste the JSON / base64 / `nullsbrawl://` link, then copy the script into your account |

Because the invite only names a URL, the same document works when the `script` field points at
*this* deployment — that is how another site (or the game) can borrow a script from here.
Details: [`docs/INVITES.md`](docs/INVITES.md).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

In a second shell, seed demo content **through the public API** and run the contract tests:

```bash
node scripts/seed.mjs
node scripts/smoke.mjs
```

Demo accounts created by the seed:

| Username | Password | Role |
| --- | --- | --- |
| `demo` | `demo1234` | author of 3 demo scripts |
| `arena` | `demo1234` | author of 3 more |

You can also just press **Continue with Null’s Connect** on the landing page — the bundled
provider at `/mock-connect/authorize` issues a real HS256 `id_token` and returns it in the
URL fragment exactly like `connect.nulls.gg` does.

Production build:

```bash
npm run build && npm start
```

GitHub Pages build (no server at all):

```bash
npm run build:static          # → site-dist/
node scripts/serve-static.mjs 4173
```

Reset all data:

```bash
npm run reset
```

---

## What was recreated

### Pages

| Route | What it does |
| --- | --- |
| `/` | landing gate — “Heeeey, scripting is here!” + Continue with Null’s Connect (redirects to `/scripts` once signed in) |
| `/login` | password login + “or” + Connect, links to Register |
| `/register` | Display Name / Username / Password registration |
| `/connect` | 302 to the provider’s `authorize`, then exchanges the returned `id_token` for a session |
| `/scripts` | script browser: search, sort, favorite stars, “＋ New script” |
| `/scripts/new` | editor — paste code or upload `.lua`, save draft, save & publish |
| `/scripts/{id}` | script page: author, description, map ids, **Start friendly battle**, **Releases**, owner draft source |
| `/scripts/{id}/edit` | editor for an existing draft |
| `/scripts/{id}/releases/{rid}` | release page (source + download for the author) |
| `/users/{id}` | profile: handle, **Favorites**, **Scripts** |
| `/users/{id}/scripts` | scripts-only tab |
| `/settings` | Sign in methods — Password (Configured / Not configured, change), Null’s Connect (Connect) |
| `/b/{token}` | friendly-battle launch page with deep link + copy buttons |
| `not-found` | “Page not found / The page you are looking for does not exist or has been moved. / Go to homepage / 404” |
| `/mock-connect/authorize` | bundled Null’s Connect-compatible identity provider |
| `/api/*` | 21 REST endpoints — see below |

### REST API

Full request/response documentation: [`docs/API.md`](docs/API.md).

```
GET    /api/health
GET    /api/auth/session
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/password
POST   /api/auth/password
POST   /api/auth/connect

GET    /api/users/{uuid}
GET    /api/users/{uuid}/scripts
GET    /api/users/{uuid}/favorites
GET    /api/users/me

GET    /api/scripts
POST   /api/scripts
GET    /api/scripts/{uuid}
PATCH  /api/scripts/{uuid}
DELETE /api/scripts/{uuid}
GET    /api/scripts/{uuid}/code
PUT    /api/scripts/{uuid}/code
POST   /api/scripts/{uuid}/publish
POST   /api/scripts/{uuid}/share
GET    /api/scripts/{uuid}/releases
GET    /api/scripts/{uuid}/releases/{releaseId}
POST   /api/scripts/{uuid}/favorite
DELETE /api/scripts/{uuid}/favorite

GET    /api/share/{token}
```

Verified-upstream behaviours that are deliberately preserved:

* `GET /api/scripts` for anonymous callers is `401` **with an empty body**.
* `GET /api/scripts/{uuid}` returns exactly the eleven upstream fields, including the
  denormalised `author_name` and `is_favorite`.
* List endpoints (`/users/{uuid}/scripts`, `/users/{uuid}/favorites`) use
  `{"scripts": [...]}` and **omit** `user_map_id` / `user_map_internal_id`.
* `/api/scripts/{uuid}/releases` returns `{"releases":[{id, description, created_at}]}`,
  newest first.
* `GET /api/users/{uuid}` returns only `user_id`, `name`, `username`.
* ids are UUIDv7 and timestamps carry microseconds: `2026-10-30T12:05:50.203568Z`.
* `/api/*` answers with `access-control-allow-credentials: true` and the exact
  `vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers` trio.
* `GET /connect` is a `302` to
  `…/authorize?scope=openid+email&response_type=id_token&redirect_uri=…%2Fconnect&client_id=9`
  with the post-login destination in the URL fragment.

---

## Architecture

```
app/
  api/…                     route handlers (the REST API)
  components/               client islands (editor, browser, buttons, forms)
  scripts/…                 browser, editor, script page, release page
  users/…                   profile + scripts tab
  login|register|settings   account screens
  connect/                  OAuth callback page
  mock-connect/authorize/   bundled Null’s Connect-compatible provider
  b/[token]/                friendly-battle launch page
  layout.tsx globals.css    shell + design system
lib/
  store.ts                  typed JSON database, atomic writes, all queries/mutations
  auth.ts                   scrypt passwords, signed cookies, id_token verification
  connect-url.ts            isomorphic authorize-URL builder (used by middleware)
  connect-secret.ts         shared HS256 secret for the bundled provider
  mock-connect.ts           id_token minting for the bundled provider
  http.ts                   JSON/empty responses, validation, rate limiting
  api-helpers.ts            session guards, ownership checks, visibility rules
  ids.ts                    UUIDv7 + microsecond timestamps
  types.ts                  the API's data shapes
static/                     GitHub Pages SPA (entry, router, views, html shells)
lib/virtual/                in-browser backend: crypto, storage, 21 endpoints
lib/api-client.ts           transport switch + fetch-shaped helper used by every component
lib/app-router.tsx          navigation/link abstraction shared by both builds
middleware.ts               CORS, /connect 302, OAuth state cookie
docs/                       research log, API reference, static-build guide
scripts/                    seed (via HTTP), smoke tests, static build/tests/server
docs/                       research log, API reference, static-build guide
index.html 404.html assets/ the published GitHub Pages artifact (generated)
deploy/pages.yml            optional GitHub Actions deployment workflow
```

**Storage.** A single JSON document (`.data/db.json`) with write-through persistence and
atomic `rename`, serialised through a promise chain so concurrent requests cannot
interleave. The whole data layer sits behind `lib/store.ts`, so swapping in Postgres is a
single-file change. No native modules, no external services.

**Auth.** scrypt password hashes; sessions are UUIDv7 rows referenced by an HMAC-signed,
`httpOnly`, `sameSite=lax` cookie (30 days) — `secure` is set from `x-forwarded-proto`, so
it behaves correctly behind the preview proxy and in production. `Authorization: Bearer`
also works for scripts and CLIs.

**Null’s Connect.** `/connect` issues the 302 with a random `state` (stored in a cookie and
verified client-side), the provider returns `#id_token=…&state=…`, the page posts the token
to `/api/auth/connect`, which verifies signature/`exp`/`iss`/`aud` and mints a session.
Switch to the real provider with `CONNECT_MOCK=0` + `CONNECT_JWKS_URL`.

---

## Configuration

Copy [`.env.example`](.env.example) to `.env.local`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | request origin | public origin used in `redirect_uri` and share links |
| `DATA_DIR` | `./.data` | where `db.json` + the generated session secret live |
| `SESSION_SECRET` | generated, persisted | HMAC key for session cookies |
| `CORS_ORIGINS` | localhost + `*.e2b.app` | comma-separated allow-list, `*` to allow all |
| `CONNECT_MOCK` | `1` | `0` → talk to the real `connect.nulls.gg` |
| `CONNECT_AUTHORIZE_URL` | `${APP_URL}/mock-connect/authorize` | provider authorize endpoint |
| `CONNECT_CLIENT_ID` | `9` | matches the upstream `client_id` |
| `CONNECT_ISSUER` | unset | required `iss` when set |
| `CONNECT_JWT_SECRET` | bundled secret | HS256 key for the bundled provider |
| `CONNECT_JWKS_URL` | unset | JWKS for RS256/ES256 verification of the real provider |
| `CONNECT_ALLOW_UNVERIFIED` | `0` | dev-only: accept unsigned tokens |

---

## Tests

`scripts/smoke.mjs` boots nothing itself — point it at a running instance and it asserts
the contract over real HTTP (cookies, CORS preflight, redirects, empty 401 bodies,
microsecond timestamps, UUIDv7 shape, ownership rules, share links, publish flow):

```bash
npm run build && npm start &
node scripts/smoke.mjs            # 78 assertions against the real HTTP API

node scripts/test-static.mjs      # 132 assertions: in-browser backend, jsdom render of every
                                  # SPA route, and the GitHub Pages loader
```

`scripts/seed.mjs` creates the demo accounts and six demo scripts **through the public
API**, so a green seed also means every write endpoint works.

---

## Deployment

### GitHub Pages (static, no backend)

The built site is committed at the **repository root**, so Pages serves it with no workflow
and no extra permissions:

**Settings → Pages → Deploy from a branch → Branch `main`, folder `/` (root)** → Save →
open `https://<user>.github.io/<repository>/`.

The published entries are `index.html`, `404.html` (SPA fallback for every deep link),
`assets/`, `favicon.svg`, `robots.txt` and `.nojekyll`. Rebuild after changes with
`npm run build:pages`.

Prefer Actions? `deploy/pages.yml` is a drop-in workflow that runs the static test suite,
builds the artifact and publishes it with `actions/deploy-pages` — copy it to
`.github/workflows/pages.yml` and set **Source: GitHub Actions**.

The artifact resolves its own base path at runtime, so project pages (`/repo/…`), user pages
and custom domains all work from the same build.

The deployed site is fully functional — accounts, login (password *and* Null’s Connect),
script creation with the `.lua` editor, publishing, releases, favorites, profiles, settings
and working “start friendly battle” launch links. It talks to an in-browser implementation
of the exact same 21 endpoints; data lives in your browser’s `localStorage`.

> Static hosting cannot run a shared database. For multi-user persistence use the server
> build below, or swap `lib/store.ts` for Postgres.

### Server build

* **Vercel / any Node host** — push the repo, set `APP_URL` and `SESSION_SECRET`.
* **Docker** — `docker build -t nt-scripting . && docker run -p 3000:3000 -v $PWD/.data:/app/.data nt-scripting`
* **Persistent data** — mount `.data` (or set `DATA_DIR`) so scripts survive restarts.

---

## Notes on faithfulness and scope

* The front end is a **reconstruction**, not a pixel copy: the research harness could read
  text/DOM structure and headers but not the CSS bundle. The information architecture,
  copy, routes and flows match what was observed; colours, spacing and iconography are
  original.
* No upstream branding asset (logo, “Null’s Connect” artwork) is bundled — the marks are
  CSS. The in-game Lua API documentation is **linked**, not vendored.
* The clone never proxies or scrapes the real service at runtime, and ships no third-party
  user content; everything is local data you create.
* Upstream bug [#12](https://github.com/nulls-mods-community/scripting-docs/issues/12)
  (`POST /share` → `404` for a fresh account’s published script) is **not** reproduced —
  the launch link works here.
* This project is unaffiliated with Null’s Brawl / NT Scripting and is meant for learning,
  self-hosting and API-compatibility work.

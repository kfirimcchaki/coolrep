# GitHub Pages build (client-side deployment)

GitHub Pages is static hosting: it cannot run Next.js route handlers, middleware,
`httpOnly` cookies or a filesystem database. So this repository ships **two builds from one
codebase**:

| | Server build | Static build (GitHub Pages) |
| --- | --- | --- |
| Command | `npm run build && npm start` | `npm run build:static` |
| Output | `.next/` + Node server | `site-dist/` (HTML + JS + CSS) |
| Backend | 21 Next.js route handlers (`app/api/**`) | the same 21 endpoints in `lib/virtual/server.ts`, running **in the browser** |
| Storage | `.data/db.json` (atomic writes) | IndexedDB (`nt-scripting`/`nts.db.v1`), mirrored to `localStorage`, optionally shared through a GitHub Gist |
| Session | signed `httpOnly` cookie | session id kept in `localStorage`, sent as `Authorization: Bearer` |
| Passwords | scrypt (node:crypto) | PBKDF2-SHA256 (Web Crypto) |
| Null’s Connect | 302 → provider, `id_token` in the fragment | provider screen rendered inline, HS256 `id_token` minted with Web Crypto |
| Routing | Next.js App Router (SSR) | client router over `history.pushState` |

Both are exercised by tests: `scripts/smoke.mjs` drives the HTTP API (78 assertions) and
`scripts/test-static.mjs` drives the in-browser backend, the gist transport, renders every SPA
route in jsdom and verifies the published artifact — loader, manifest, icons, service worker
(132 assertions).

---

## How the static site keeps real URLs

GitHub Pages answers unknown paths with the repository’s `404.html`. That file is a copy of
the SPA shell, so:

```
/coolrep/                                  → index.html          → HomeView
/coolrep/scripts/                          → scripts/index.html  → ScriptsView
/coolrep/scripts/<uuid>                    → 404.html + SPA      → ScriptDetailView
/coolrep/scripts/<uuid>/edit               → 404.html + SPA      → ScriptEditView
/coolrep/scripts/<uuid>/releases/<id>      → 404.html + SPA      → ReleaseView
/coolrep/users/<uuid>[/scripts]            → 404.html + SPA      → UserView
/coolrep/b/<token>                         → 404.html + SPA      → BattleView
```

The SPA strips the base path from `location.pathname` and renders the matching screen, so a
link to `/scripts/<uuid>` works when pasted into a new tab, not just via in-app navigation.

Static routes are also emitted as real `index.html` files so they answer **200** instead of
404: `login/`, `register/`, `connect/`, `settings/`, `scripts/`, `scripts/new/`.

---

## Deploying

This repository serves Pages from the **branch root**, without any workflow:

```
Settings → Pages → Build and deployment
  Source:  Deploy from a branch
  Branch:  main        Folder: / (root)
```

The site artifact is committed at the root so that configuration just works:

| File | Purpose |
| --- | --- |
| `index.html` | SPA shell |
| `404.html` | SPA shell served for every deep link (`/scripts/<uuid>`, `/users/<uuid>`, `/b/<token>`, …) |
| `assets/app.js`, `assets/app.css` | the bundle |
| `favicon.svg`, `robots.txt` | icons / keep crawlers out |
| `.nojekyll` | serve files verbatim instead of running Jekyll |

Regenerate after changing the app:

```bash
npm run build:pages        # build-static + publish-pages
git add index.html 404.html assets .nojekyll && git commit -m "Rebuild Pages site"
```

`scripts/publish-pages.mjs` only replaces those generated entries; sources, `docs/`
(Markdown) and tooling are untouched.

### Optional: deploy with GitHub Actions instead

`deploy/pages.yml` is a ready-made workflow that runs the static test suite, builds the
artifact and publishes it with `actions/deploy-pages`:

```bash
mkdir -p .github/workflows && cp deploy/pages.yml .github/workflows/pages.yml
```

Then set **Source: GitHub Actions**. This is optional: the root artifact already works.

### Caveat of root hosting

Because the artifact lives at the repository root, the site's `/scripts/…` route shares its
name with the `scripts/` tooling folder. Deep links therefore rely on `404.html` — the
standard GitHub Pages fallback — rather than a per-route `index.html`. Functionally
identical: the SPA boots and renders the right screen, only the HTTP status of a deep link
is `404` while the page renders normally.

### No base path to configure

The artifact resolves its own root at runtime: on a project page (`/coolrep/…`) it loads
`/coolrep/assets/app.js`, while on a custom domain or user page it loads `/assets/app.js`.
Nothing needs rebuilding when you attach a domain.

### Local check

```bash
npm run build:static
node scripts/serve-static.mjs 4173   # mimics GitHub Pages, incl. the 404 fallback
# → http://localhost:4173
```

---

## What the in-browser backend implements

`lib/virtual/server.ts` is a faithful port of the HTTP contract — same paths, statuses,
bodies, error messages and validation:

```
GET  /api/health
GET  /api/auth/session              POST /api/auth/register
POST /api/auth/login                POST /api/auth/logout
GET  /api/auth/password             POST /api/auth/password
POST /api/auth/connect

GET  /api/users/{uuid}              GET  /api/users/{uuid}/scripts
GET  /api/users/{uuid}/favorites    GET  /api/users/me

GET  /api/scripts                   POST /api/scripts
GET  /api/scripts/{uuid}            PATCH/DELETE /api/scripts/{uuid}
GET  /api/scripts/{uuid}/code       PUT  /api/scripts/{uuid}/code
POST /api/scripts/{uuid}/publish    POST /api/scripts/{uuid}/share
GET  /api/scripts/{uuid}/releases   GET  /api/scripts/{uuid}/releases/{id}
POST /api/scripts/{uuid}/favorite   DELETE /api/scripts/{uuid}/favorite

GET  /api/share/{token}
```

Details that are preserved on purpose: UUIDv7 ids, microsecond ISO timestamps,
`401` with an empty body for anonymous `/api/scripts`, the exact eleven-field script
detail object, `{scripts:[…]}` / `{releases:[…]}` envelopes, map ids omitted from list
items, `{"error": …}` for every other failure, `405` with an empty body on wrong methods.

### Seeding

The first visit seeds six demo scripts and two accounts (`demo` / `demo1234`,
`arena` / `demo1234`) into `localStorage` — the deployed site is never empty. Settings →
**Local data → Reset** wipes it and re-seeds.

## Sharing one database

The static build has three storage strategies; pick one in **Settings → Backend**.

### 1. This browser (default, zero setup)

`lib/virtual/server.ts` runs in the page and writes to IndexedDB. Everything works offline and
survives reloads, but each browser profile has its own data.

### 2. A GitHub Gist (shared, still zero infrastructure)

`lib/virtual/gist-sync.ts` mirrors the whole database document to a secret gist owned by the
signed-in user:

* paste a token with the `gist` scope → **Create shared gist** (first write is `POST /gists`,
  later ones `PATCH /gists/{id}`);
* local writes land in IndexedDB immediately, then flush 1.2 s later (and on `pagehide` /
  `online`), so the UI never waits for GitHub and offline edits are queued;
* any device opens `...?gist=<id>` (or pastes the id) and boots from that document — public
  gists are readable anonymously, rate-limited at 60 requests/hour, or 5 000/hour with the
  token;
* the token never leaves the browser: it lives in `localStorage['nts.gist']` and is only sent
  to `api.github.com` over HTTPS;
* `Settings → Backend → Export` still produces a JSON backup at any time.

This is the way to get one shared database on GitHub Pages **without** running a server.

### 3. Any deployment of the server build (real multi-user)

Point the site at a running server build — `?api=https://host`, **Settings → Backend → Server
URL**, or bake it in with `window.__NT_API__`:

```bash
NEXT_PUBLIC_STATIC_MODE=1 NT_API=https://nt-scripting.onrender.com npm run build:static
```

Requests go to that origin with `Authorization: Bearer <session_id>`, and the bundled
middleware answers the CORS preflight for `*.github.io` plus anything in `CORS_ORIGINS`. Ready
configs live in [`deploy/`](../deploy): `render.yaml`, `fly.toml`, `railway.json`,
`docker-compose.yml` and a `Dockerfile`.

---

## Installable + offline (PWA)

| File | Purpose |
| --- | --- |
| `manifest.webmanifest` | standalone display, theme colours, shortcuts (New script / Browse / Settings), 192·512·maskable PNG icons |
| `icons/*.png` | generated by `scripts/make-icons.mjs` (no image toolchain needed) |
| `sw.js` | caches the shell, assets and icon set; navigations fall back to the cached shell; answers `/api/scripts/<uuid>/content?token=…` from IndexedDB (verified invite tokens) so invites work without a server; `__VERSION__` is stamped per build so a deploy invalidates the old cache |

With the service worker installed, deep links render from the cache *and* answer `200`, the
app opens with no network, and browsers offer “Install app”.

---

## Remaining limits (and why they are limits)

* **Deep links without the service worker** still return HTTP `404` — that is GitHub Pages
  itself answering for an unknown path; the page renders normally from `404.html`. Real
  `index.html` files exist for `/login/`, `/register/`, `/connect/`, `/settings/`.
  `/scripts/` cannot get one at the repository root because that name belongs to the tooling
  folder.
* **Sessions in the static build** live in `localStorage` rather than `httpOnly` cookies.
  Use the server build if you need cookie-backed sessions.
* **The upstream platform's private assets/CSS and authenticated API shapes** were observed
  only through public pages, so the UI is a faithful reconstruction, not a byte copy.
* **Battle execution / matchmaking** is server-side on the real platform and out of scope in
  both builds; accounts, scripts, releases, favourites and share links are complete.

# GitHub Pages build (client-side deployment)

GitHub Pages is static hosting: it cannot run Next.js route handlers, middleware,
`httpOnly` cookies or a filesystem database. So this repository ships **two builds from one
codebase**:

| | Server build | Static build (GitHub Pages) |
| --- | --- | --- |
| Command | `npm run build && npm start` | `npm run build:static` |
| Output | `.next/` + Node server | `site-dist/` (HTML + JS + CSS) |
| Backend | 21 Next.js route handlers (`app/api/**`) | the same 21 endpoints in `lib/virtual/server.ts`, running **in the browser** |
| Storage | `.data/db.json` (atomic writes) | `localStorage` (`nts.db.v1`) |
| Session | signed `httpOnly` cookie | session id kept in `localStorage`, sent as `Authorization: Bearer` |
| Passwords | scrypt (node:crypto) | PBKDF2-SHA256 (Web Crypto) |
| Null’s Connect | 302 → provider, `id_token` in the fragment | provider screen rendered inline, HS256 `id_token` minted with Web Crypto |
| Routing | Next.js App Router (SSR) | client router over `history.pushState` |

Both are exercised by tests: `scripts/smoke.mjs` drives the HTTP API (51 assertions) and
`scripts/test-static.mjs` drives the in-browser backend, renders every SPA route in jsdom and
verifies the Pages loader for project pages, custom domains and local previews
(61 assertions).

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

The built site is committed to **`docs/`**, so Pages needs no workflow and no special
permissions:

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: _Deploy from a branch_.**
3. **Branch: `main` · Folder: `/docs`** → *Save*.
4. Open `https://<user>.github.io/<repository>/` (first publish takes ~30 s).

Regenerate the artifact after changing the app:

```bash
npm run build:pages        # build-static + publish-docs
git add docs && git commit -m "Rebuild Pages site"
```

`docs/` also keeps the Markdown documentation; `scripts/publish-docs.mjs` only replaces the
generated files (`index.html`, `404.html`, `assets/`, per-route folders…).

### Optional: deploy with GitHub Actions instead

`deploy/pages.yml` is a ready-made workflow that runs the static test suite, builds the
artifact and publishes it with `actions/deploy-pages`:

```bash
mkdir -p .github/workflows && cp deploy/pages.yml .github/workflows/pages.yml
```

Then set **Source: GitHub Actions**. (This path is optional — the copy to `docs/` works
without it.)

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

### Honest limits of the static build

* Data is per-browser. Two devices do not share scripts, and clearing site data loses them.
  This is inherent to static hosting; use the server build (or point it at a database) when
  you need real multi-user persistence.
* Sessions are `localStorage`-backed instead of `httpOnly` cookies, so they are readable by
  scripts on the page. That is acceptable for a demo, not for production auth.
* The dynamic backend of the live platform (battle execution, matchmaking) is out of scope
  in both builds — the platform side (accounts, scripts, releases, launch links) is complete.

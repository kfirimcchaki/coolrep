# Friendly-battle invites and cross-site script borrowing

A Null's Brawl **script-room invite** is a small encrypted blob inside a deep link. Decrypted,
it is plain JSON:

```json
{
  "realm": "experiment:scripts",
  "script": "https://scripting.nulls.gg/api/scripts/01a1796b-7367-7d34-8f74-a49118c053cb/content?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzY3JpcHRfaWQiOiIwMWExNzk2Yi03MzY3LTdkMzQtOGY3NC1hNDkxMThjMDUzY2IiLCJyZXZpc2lvbl9pZCI6MTU0ODAsImV4cCI6MTc5MzM2NzQ2Nn0.BNja9iuGefxEAj2B3UUJ0Ycj_94-UHbbCWNqOWBanEI",
  "bp": [0, 0, 0, 0, 0, 0, 254, 1, 1, -600, 1000, -20, 20, 1, 3, 0, 1, 1, 1, 1000, 1, 0, 0, 0, 100, 0, 0, 1, 1000, 1000, 1000, 1]
}
```

| Field    | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| `realm`  | Game realm the room belongs to (`experiment:scripts` in every invite seen) |
| `script` | **A URL to the script source, with its own proof of access**             |
| `bp`     | 32 battle-parameter integers the room is created with                   |

Because `script` is an absolute URL, the document is not tied to `scripting.nulls.gg`: any host
that answers the same path with the same token format can hand a script to the game. That is
what this repository implements.

## The content token

The URL carries an HS256 JWT — no account, no cookie — with exactly three claims:

```json
{ "script_id": "01a1796b-…-a49118c053cb", "revision_id": 15480, "exp": 1793367466 }
```

* header: `{"typ":"JWT","alg":"HS256"}` (byte-identical to the tokens seen in the wild);
* `revision_id` pins a published release, so an invite keeps serving the code it was made for;
* `exp` is a unix timestamp; observed tokens lived ~15 minutes (`lib/invite.ts` defaults to 900
  seconds). The secret is `NTS_CONTENT_SECRET` (default
  `nt-scripting-local-content-secret` — fine for a demo, set your own for a real deployment).

Anyone can mint a token for *their own* site with their own secret: the client never calls home
to verify it, it only needs the code.

## Endpoints in this repository

```
POST /api/scripts/{uuid}/invite       → mint an invite (signed-in users; drafts stay with their author)
GET  /api/scripts/{uuid}/content?token=…  → 200 text/plain Lua/Luau source
GET  /api/scripts/{uuid}/content?token=…&format=json
                                          → 200 { script_id, revision_id, name, description,
                                                  content, created_at, expires_at }
POST /api/import/inspect              → read an invite from anywhere and preview the source
```

`POST /api/scripts/{uuid}/invite` answers with the document **plus** convenience mirrors:

```json
{
  "realm": "experiment:scripts",
  "script": "https://host/api/scripts/<id>/content?token=<jwt>",
  "bp": [ … ],
  "invite":      { "realm": "…", "script": "…", "bp": [ … ] },
  "payload":     "<pretty JSON, copy-paste ready>",
  "invite_b64":  "<base64url of the pretty JSON>",
  "deep_link":   "nullsbrawl://script?data=<base64url>",
  "invite_url":  "https://host/import?invite=<base64url>",
  "token": "…", "content_url": "…", "script_id": "…", "revision_id": 15480,
  "expires_at": "2026-10-30T13:37:46.000000Z"
}
```

Optional body: `{ release_id?, expires_in?, bp?, realm? }` — `bp` defaults to the observed
battle-parameter vector, `expires_in` to 900 s (max 30 days).

### Status codes on `/content`

| Situation                     | Answer                                  |
| ----------------------------- | --------------------------------------- |
| no `token`                    | `401` with an empty body                |
| bad signature / expired       | `401` `{"error":"…"}`                   |
| token for another script      | `403` `{"error":"Token does not match this script"}` |
| unknown script / draft / release | `404` `{"error":"…"}`                |
| valid                         | `200` `text/plain; charset=utf-8` (+ `X-Script-Id`, `X-Revision-Id`, `X-Token-Expires`) |

`?download=1` adds a `Content-Disposition` filename, `HEAD` answers without a body, and every
response is CORS-readable (`Access-Control-Allow-Origin: *`) so another site can fetch it from
a browser.

## Borrowing a script from another site

**UI:** `/import` (also linked as *Import* in the header). Paste the JSON, its base64 form or a
`nullsbrawl://…` link; the source is fetched from the URL inside it and previewed. Signed-in
visitors can copy it into their own scripts with one click.

**API:** `POST /api/import/inspect` with `{ "invite": "…" }` or `{ "url": "https://…/content?token=…" }`.

Guards (`lib/import-fetch.ts`): http(s) only, no loopback/private/link-local/metadata hosts
(loopback is allowed when the caller itself is local, so `localhost` development works),
redirects re-checked, 8 s timeout, 1 MiB cap. JSON answers containing `content`/`code`/`source`
are unwrapped, so sites that only speak JSON still import.

## The static build (GitHub Pages)

There is no server on Pages, so the **service worker** answers
`/api/scripts/<uuid>/content?token=…`: it reads the database from IndexedDB, verifies the HS256
token with Web Crypto and returns the release source with the same headers and status codes.
Invites therefore work for anything that talks to the same origin (the installed app, other
devices with the shared gist database, the game client on a device that has the PWA). For
third-party consumers, point the site at a real server build (see `docs/STATIC.md`) — the
server route is the same code path.

## Worked example

```bash
# 1. sign in and mint an invite
curl -s -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"demo","password":"demo1234"}' | jq -r .session_id > /tmp/sid

curl -s -X POST localhost:3000/api/scripts/<uuid>/invite \
  -H "Authorization: Bearer $(cat /tmp/sid)" -H 'content-type: application/json' -d '{}' > /tmp/invite.json

# 2. read the source with nothing but the URL from that invite
curl -s "$(jq -r .script /tmp/invite.json)"

# 3. borrow it back through the import endpoint
curl -s -X POST localhost:3000/api/import/inspect -H 'content-type: application/json' \
  -d "$(jq -c '{invite: .payload}' /tmp/invite.json)" | jq -r .content
```

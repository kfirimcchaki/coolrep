# Deploying the shared backend

The GitHub Pages build needs no infrastructure (a GitHub Gist can hold the shared
database — see Settings → Backend). A hosted Node process is the other way to get
one database for everyone, and it is the same code as the Next.js build.

| Target                          | File                    | Command                                              |
| ------------------------------- | ----------------------- | ---------------------------------------------------- |
| Docker / any VPS                | `Dockerfile`            | `docker run -p 3000:3000 -v $PWD/.data:/app/.data nt-scripting` |
| Docker Compose                  | `deploy/docker-compose.yml` | `docker compose -f deploy/docker-compose.yml up -d --build` |
| Render                          | `deploy/render.yaml`    | New → Blueprint → this repo → Apply                  |
| Fly.io                          | `deploy/fly.toml`       | `fly launch --copy-config` → `fly deploy`            |
| Railway                         | `deploy/railway.json`   | New project → Deploy from repo                       |
| Plain Node host (pm2/systemd)   | —                       | `npm ci && npm run build && npm start`               |

## Environment

| Variable        | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `APP_URL`       | Public origin of the deployment (connect redirects, share links)     |
| `DATA_DIR`      | Folder holding `db.json` + the generated session secret (mount it)   |
| `SESSION_SECRET`| HMAC key for session cookies (auto-generated into `DATA_DIR` if empty)|
| `CORS_ORIGINS`  | Comma-separated allow-list; `*.github.io` is always allowed          |
| `CONNECT_MOCK`  | `1` uses the bundled Null's Connect stand-in, `0` proxies the real one |

Point the static site at the deployment with **Settings → Backend → Server URL**, or
link it directly: `https://<user>.github.io/<repo>/?api=https://your-service.onrender.com`.

Sessions travel as `Authorization: Bearer <session_id>` from the static build, so no
third-party cookies are involved and `access-control-allow-credentials` stays opt-in.

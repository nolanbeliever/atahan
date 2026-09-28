# Deployment

GetRich Tycoon needs a **long-running Node.js process that accepts WebSockets**, plus a **PostgreSQL** database.
The client is served by the same Node process, so a single URL gives you HTTPS for the page and WSS for the game
with no CORS setup.

Static hosts cannot run the game server: GitHub Pages and Netlify can't at all, and Vercel only offers short-lived
functions. See the research below.

## Free hosting research (as of 28 Sep 2026)

This comes from the providers' pricing and docs pages, reached through search results because direct page fetches were blocked
from the build environment. Items marked *(unverified)* could not be confirmed from an official page. Check the provider
before relying on them. Free tiers change often.

| Provider | Free tier for new users | Long-running Node + WebSockets | Sleeps? | Free Postgres | Notes |
| --- | --- | --- | --- | --- | --- |
| **Render** (web service) | Yes, no card for web services *(Blueprint deploys may ask for a card, unverified)* | Yes | **Spins down after 15 min** without inbound HTTP or WebSocket traffic; ~1 min cold start; may be restarted at any time | Yes, but **deleted 30 days after creation** (+14-day grace) | 512 MB / 0.1 CPU, 750 instance-hours per month. Supports a sub-directory Root Directory, `rootDir` in Blueprints and a custom Blueprint path. Automatic HTTPS/WSS. |
| **Neon** (Postgres only) | Yes, no card, no expiry | n/a | Compute scales to zero after 5 min idle; resumes in ~0.5 s | 0.5 GB per project, 100 CU-hours/month | Requires TLS (`DATABASE_SSL=true`). |
| Northflank (Developer Sandbox) | Yes, but a **card is required** for verification (not charged) | Yes | **Always on** | 1 free database addon | 2 services. Exact CPU/RAM limits unpublished *(unverified)*. Deploys from the Dockerfile in a sub-directory. |
| Oracle Cloud Always Free | Yes, card required | Yes (you run a VM) | Always on; idle VMs may be reclaimed | Self-hosted | Most powerful option, but you manage the server, TLS and updates yourself. |
| Koyeb | **Free plan closed to new users** in 2026 | n/a | n/a | n/a | Existing accounts keep their plan. |
| Fly.io | Trial only (2 machine-hours / 7 days) | Yes | n/a | n/a | Not free for new organizations. |
| Railway | $5 one-time trial, then $1/month credit | Yes | Optional sleep | Uses the credit | $1/month is not enough for Node + Postgres all month. |
| Google Cloud Run | Card required | WebSockets capped at 60 min per connection | Scales to zero | No | Needs max-instances=1 and client reconnects. Not recommended. |
| Vercel / Netlify / Deno Deploy / Zeabur (free) | n/a | **No persistent shared process** | n/a | n/a | Not suitable for this server. |
| Glitch | Project hosting ended July 2025 | n/a | n/a | n/a | Not available. |

### Recommendation

- **Default (no credit card): Render free web service + Neon free Postgres.**
  - Honest limitation: the Render server **is not 24/7**. It spins down after ~15 minutes with no players and the next visitor waits about a minute while it cold-starts.
  - While anyone is connected, Socket.IO heartbeat traffic keeps it awake. This is inferred from Render's statement that inbound WebSocket messages count as activity.
  - All progress is stored in Neon, so sleeping or restarting loses nothing except players' live positions from the last few seconds.
- **Always-on alternative (card needed for verification): Northflank Developer Sandbox**, using the included `Dockerfile` and Neon or Northflank's free database. Northflank states the sandbox is not intended for production.
- Avoid Render's free Postgres for real data: it is deleted after 30 days.

Provider-specific configuration lives only in `deploy/` (Render Blueprint) and `Dockerfile` (generic container). The
application itself is provider-agnostic and only reads environment variables.

---

## Option A: Render (web service) + Neon (database)

### 1. Create the database on Neon

1. Sign up at <https://neon.tech> and create a project (any region close to your Render region).
2. Copy the **connection string** from the dashboard. It looks like
   `postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`.
   Keep it secret and never commit it.

### 2. Create the web service on Render

Either use the Blueprint:

1. Push this repository to GitHub (already done if you are reading this there).
2. Render dashboard → **New → Blueprint** → choose the repository.
3. Set **Blueprint file path** to `getrich-tycoon/deploy/render.yaml` (the repository root `render.yaml` belongs to another app).
4. When prompted, paste the Neon connection string into `DATABASE_URL`, then apply.

Or create it manually (equivalent):

1. Render dashboard → **New → Web Service** → connect the repository.
2. Settings:

   | Setting | Value |
   | --- | --- |
   | Root Directory | `getrich-tycoon` |
   | Runtime | Node |
   | Build Command | `npm ci --include=dev && npm run build` |
   | Start Command | `npm start` |
   | Instance Type | Free |
   | Health Check Path | `/healthz` |

   `--include=dev` matters: Render sets `NODE_ENV=production`, and the build tools (Vite, esbuild, TypeScript) are dev dependencies.

3. Environment variables:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22` |
   | `DATABASE_URL` | *(Neon connection string)* |
   | `DATABASE_SSL` | `true` |
   | `TRUST_PROXY` | `true` |
   | `LOG_LEVEL` | `info` |

   Do **not** set `PORT`; Render injects it.
4. Click **Create Web Service**. The first deploy takes a few minutes.
5. Open `https://<your-service>.onrender.com`. The page is served over HTTPS and the game connects over **WSS** automatically,
   because the client uses the page origin.
6. Verify `https://<your-service>.onrender.com/healthz` returns `{"ok":true,...,"db":"postgres"}`.

### 3. Custom domain (optional)

Render → your service → **Settings → Custom Domains** → add `game.example.com`, then create the CNAME record it shows.
Render issues the TLS certificate automatically. No application change is needed.

## Option B: any Docker host (Northflank, Oracle VM, Fly.io, a VPS...)

```bash
cd getrich-tycoon
docker build -t getrich-tycoon .
# Behind a reverse proxy on the same host: publish only on localhost and trust the proxy.
docker run -d --name getrich -p 127.0.0.1:3000:3000 \
  -e DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DB' -e DATABASE_SSL=true \
  -e TRUST_PROXY=true getrich-tycoon
```

Only set `TRUST_PROXY=true` when clients cannot reach the container port directly. Otherwise they could spoof
`X-Forwarded-For` and bypass the per-IP limits.

- **Northflank:** create a *Combined service* from the repository with build context `getrich-tycoon` and Dockerfile
  `getrich-tycoon/Dockerfile`. Expose port 3000 over HTTP (TLS is automatic on `*.code.run`) and add the environment variables above.
- **VPS / Oracle Cloud:** run the container and put a TLS reverse proxy in front of it. For example, a Caddyfile with
  `game.example.com { reverse_proxy localhost:3000 }` handles HTTPS and WebSocket upgrades automatically.

## Hosting the client separately (optional)

The recommended setup serves the client from the game server. To host `dist/client` on a static CDN instead:

- build with `VITE_SERVER_URL=https://api.example.com npm run build:client`;
- set `CORS_ORIGINS=https://your-cdn-domain` on the server.

## Production checklist

- [ ] `DATABASE_URL` points to a managed PostgreSQL database. SQLite on an ephemeral free-tier disk would lose data on every restart.
- [ ] `DATABASE_SSL=true` for Neon, Supabase or Render external URLs.
- [ ] `TRUST_PROXY=true` only behind Render/Northflank/Caddy, where clients can't reach the port directly, so per-IP limits see real client IPs.
- [ ] `/healthz` is healthy and reports `"db":"postgres"`.
- [ ] Two browsers with different accounts can see each other (multiplayer).
- [ ] No secrets are committed: `npm run check:secrets`.

## Operations

- **Logs** are human-readable, one line per event: connections, transactions, errors. They never contain passwords, tokens or connection strings.
- **Backups:** use your Postgres provider's backup/branching feature. Neon supports point-in-time restore within its free history window.
- **Shutdown:** SIGTERM triggers a graceful shutdown that flushes driving state and saves every player's position.
- **Resetting the world:** `npm run db:reset -- --yes` with the production `DATABASE_URL` in the environment. Destructive.

## What was verified from this environment

- The production build (`npm run build`) and `npm start` were run locally against both SQLite and PostgreSQL 16, and the full automated suites passed.
- The Dockerfile and the Render Blueprint could **not** be exercised here: there is no Docker daemon and no Render account in the build
  environment. They use only standard, documented settings. Treat the first deploy as a smoke test using the checklist above.

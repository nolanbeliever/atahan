# GetRich Tycoon

A multiplayer 3D browser game about trading used vehicles and building a dealership empire.
It runs in Chrome (and other WebGL browsers) with a real, server-authoritative Node.js backend and a database.

> Start with **$25,000**. Buy worn cars at the Used Vehicle Market, haggle with NPC sellers, repair,
> wash and customize them, then sell them from your own dealership to NPC customers or to other players.
> Reinvest to grow from a small lot into a Mega Dealership and climb the net-worth leaderboard.

All code, models, brands (Norda, Voltara, Velora, Granforge, Apexon, Solenne, Harlan & Finch), the city, the UI and the
sounds are original. 3D models are generated procedurally at runtime and sounds are synthesized with WebAudio, so there are no third-party assets.

---

## Features

| Area | What is implemented |
| --- | --- |
| **Multiplayer** | Socket.IO WebSockets. Movement is server-authoritative with client-side prediction and reconciliation. Remote players are interpolated. Vehicles, listings, dealerships, auctions, NPC customers and chat all sync in real time. |
| **World** | A procedural 3D city with 9 districts: Dealership Row (8 plots), Used Vehicle Market, Hammerfall Auction House, Wrench Bros Repair & Parts Depot, Sparkle Wash & fuel station, GetRich Bank, Chroma Customs, parking lots and Fortune Plaza (spawn). |
| **Player** | Account (name + password), money, bank, XP/levels, reputation, stats, 17 achievements, settings, appearance, parts inventory. |
| **Vehicles** | 15 fictional models in 8 categories. Each vehicle tracks mileage, fuel, 6 condition parts, cleanliness, mods, owner and sale status. Condition affects value, driving performance and repair cost. |
| **Driving** | Enter or exit with **E**. Driving has acceleration, braking, reverse, handbrake, steering, collisions (with body damage), fuel use, mileage and dirt. |
| **Buying** | Browse, filter, sort and inspect listings; buy or negotiate with data-driven NPC seller personalities. You can also buy from other players. |
| **Repair / wash / fuel** | Per-part repairs with cost, time and a new-condition preview; parts kits; a dealership repair-bay discount; 2 wash tiers; refuelling. |
| **Customization** | Paint, wheels, window tint, body kits, headlights and accessories. Changes are visible on the 3D model and affect value (capped). |
| **Dealership** | Buy a plot, upgrade through 6 levels (each looks different), place and rotate vehicles on up to 12 display slots, and set prices. |
| **NPC customers** | Customers with 7 archetypes (budget, categories, condition and mileage limits, willingness, negotiation) walk into dealerships, buy or make offers, and also buy from the classifieds, even while you are offline. |
| **Economy** | Everything is set in `shared/economy.config.ts`. Values depend on category demand (volatile, mean-reverting), condition, mileage, rarity and mods. Fees and taxes prevent arbitrage. |
| **Auctions** | Player and NPC consignments, escrowed bids, minimum increments, anti-sniping, NPC bidders and automatic settlement. |
| **Chat** | Global, nearby (45 m) and system messages, with rate limiting, mutes and duplicate suppression. |
| **UI** | HUD (money, bank, level/XP, reputation, minimap, prompts, speedometer, fuel), dock, and 17 panels, including a full map, settings and a profile with leaderboard and transaction history. |
| **Persistence** | PostgreSQL in production, with a SQLite fallback for local development. Every transaction is written atomically; positions and driving stats are autosaved. |
| **Audio** | Synthesized engine, UI, purchase, notification and ambient city sounds. |

## Quick start (local)

Requirements: **Node.js 20.11+** (22 recommended) and npm. PostgreSQL is optional locally.

```bash
cd getrich-tycoon
npm install
npm run build        # builds the client (Vite) and the server bundle (esbuild)
npm start            # http://localhost:3000
```

Open <http://localhost:3000> in Chrome, create an account and play. Open a second browser window (or an
incognito window) with another account to see multiplayer.

### Development mode (hot reload)

```bash
npm run dev          # game server on :3000 (tsx watch) + Vite on :5173 (proxying /api and /socket.io)
```

Open <http://localhost:5173>.

### Using PostgreSQL locally

```bash
cp .env.example .env
# set DATABASE_URL=postgres://user:password@localhost:5432/getrich
npm start
```

The schema (`database/schema.sql`) is applied automatically on startup. When `DATABASE_URL` is empty the server uses
`./data/getrich.db` (SQLite) and logs a warning. That mode is for development only.

## Controls

| Key | Action |
| --- | --- |
| **W A S D** / arrows | Walk, or drive when in a vehicle |
| **Shift** | Sprint |
| **Space** | Handbrake (driving) |
| **Mouse** (click to lock) / right-drag | Camera |
| **E** | Interact / enter / exit vehicle |
| **F** | Use the fuel station or car wash while driving |
| **Enter** / **T** | Chat |
| **B** / **I** / **J** / **K** / **M** / **O** | Marketplace / Garage / Dealership / Auctions / Map / Profile |
| **Esc** | Close panel / game menu |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Server + Vite dev servers |
| `npm run build` | Production build into `dist/` |
| `npm start` | Run the production server (`dist/server/index.js`) |
| `npm run typecheck` | Strict TypeScript checks (client, server, tests) |
| `npm test` | Unit + integration tests (Vitest; real sockets and a real database) |
| `npm run test:e2e` | Playwright tests in Chromium, including the two-client test (needs `npm run build` first) |
| `npm run test:all` | Everything above |
| `npm run check:secrets` | Scans tracked files for leaked credentials |
| `npm run db:reset -- --yes` | Wipe the configured database |

See [TESTING.md](TESTING.md) for details, including running the suites against PostgreSQL.

## Project structure

```
getrich-tycoon/
├── client/            Browser game (Vite + TypeScript + Three.js)
│   ├── index.html
│   └── src/
│       ├── game/      Game loop, prediction/reconciliation, input, camera, entity views
│       ├── render/    Renderer, procedural city, vehicles, characters, dealerships, effects
│       ├── ui/        HUD, chat, minimap, panels (marketplace, garage, dealership, ...)
│       ├── net/       HTTP auth + Socket.IO RPC client
│       ├── state/     Client mirror of server state
│       └── audio/     WebAudio synthesizer
├── server/            Node.js game server (Express + Socket.IO)
│   ├── game/          GameServer, simulation, state/unit-of-work, services/*
│   ├── db/            PostgreSQL + SQLite adapters, repository
│   └── http/          Express app (security headers, auth API, static files)
├── shared/            Types, economy config, vehicle catalog, world layout, physics, protocol
├── database/          schema.sql (portable PostgreSQL/SQLite)
├── scripts/           Build, dev, secret scan, DB reset
├── tests/             unit/, integration/ (Vitest), e2e/ (Playwright), helpers/
└── deploy/            Provider-specific config (Render blueprint)
```

## Environment variables

See [`.env.example`](.env.example). The important ones:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | 3000 | HTTP + WebSocket port (hosts usually inject this) |
| `DATABASE_URL` | *(empty)* | PostgreSQL connection string. Empty means local SQLite |
| `DATABASE_SSL` | false | `true` for managed Postgres that requires TLS (Neon, Supabase, ...) |
| `SQLITE_PATH` | ./data/getrich.db | SQLite file for local development |
| `CORS_ORIGINS` | *(empty)* | Only needed if the client is hosted on another origin |
| `TRUST_PROXY` | false | Set `true` only when the server is reachable exclusively through one reverse proxy (Render, Northflank, Caddy) |
| `AUTH_RATE_PER_MINUTE` | 10 | Login/register attempts per IP per minute |
| `TICK_RATE` | 20 | Server simulation/snapshot rate (Hz) |
| `AUTOSAVE_SECONDS` | 30 | Position/driving autosave interval |
| `LOG_LEVEL` | info | debug / info / warn / error |
| `VITE_SERVER_URL` | *(empty)* | Build-time: game server URL if the client is hosted elsewhere |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how the client, server, multiplayer and database fit together
- [DEPLOYMENT.md](DEPLOYMENT.md): free hosting research and exact deployment steps
- [TESTING.md](TESTING.md): test suites and how to run them
- [ECONOMY.md](ECONOMY.md): the economy model and balancing
- [SECURITY.md](SECURITY.md): threat model and protections

## Known limitations

- **Single server instance.** The authoritative world state lives in one Node process, with write-through to the database.
  This fits a free-tier deployment and hundreds of concurrent players, but it does not scale horizontally
  (see ARCHITECTURE.md).
- **Simple arcade physics.** Vehicles use a 2D bicycle model with circle colliders. There are no ramps or multi-level roads,
  and players can walk through each other.
- **No AI traffic.** NPCs are dealership customers. There is no ambient traffic on the roads.
- **Software rendering is slow.** Without a GPU (CI containers, some VMs) Chrome falls back to SwiftShader and the game runs at a
  few FPS. It still works, and the automated tests run that way, but real play needs hardware acceleration.
- **Free hosting sleeps.** The recommended free host spins the server down after ~15 minutes without traffic. The first visitor then
  waits about a minute. See DEPLOYMENT.md.
- **Accounts are name + password only.** There is no e-mail, so a forgotten password cannot be recovered.

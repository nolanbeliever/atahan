# GetRich Tycoon

A multiplayer 3D browser game about trading used vehicles and building a dealership empire.
It runs in Chrome (and other WebGL browsers) with a real, server-authoritative Node.js backend and a database.

> Start with **$25,000**. Buy worn cars at the Used Vehicle Market, haggle with NPC sellers, repair,
> wash and customize them, then sell them from your own dealership to NPC customers or to other players.
> Reinvest to grow from a small lot into a Mega Dealership and climb the net-worth leaderboard.

All code, the regular catalogue's brands (Norda, Voltara, Velora, Granforge, Apexon, Solenne, Harlan & Finch), the city, the UI and
the sounds are original. 3D models are generated procedurally at runtime and sounds are synthesized with WebAudio, so there are no
third-party assets. The 10 exclusive Rare Dealer vehicles are real cars (BMW, Mercedes-Benz, Audi), named at the owner's request;
their names live in `shared/specialVehicles.ts`, and no logos or photos are included. High-detail `.glb` models can be added for any
vehicle (see [High-detail vehicle models](#high-detail-vehicle-models)); none are shipped.

---

## Features

| Area | What is implemented |
| --- | --- |
| **Multiplayer** | Socket.IO WebSockets. Movement is server-authoritative with client-side prediction and reconciliation. Remote players are interpolated. Vehicles, listings, dealerships, auctions, NPC customers and chat all sync in real time. |
| **World** | A procedural 3D city with 9 districts: Dealership Row (8 plots), Used Vehicle Market, Hammerfall Auction House, Wrench Bros Repair & Parts Depot, Sparkle Wash & fuel station, GetRich Bank, Chroma Customs, parking lots and Fortune Plaza (spawn). A green belt with trees surrounds the city, then the highway. A shared 24-minute day/night cycle (server clock) brings dusk, stars and a moon, lit windows, street lights and headlights. |
| **Highway (No Hesi)** | The GetRich Expressway rings the city: 4 lanes each way (8 in total), white dashed lane lines and yellow edge lines, W-beam guardrails, a concrete median with crossovers, three junctions (connector roads with on/off-ramps) to the city, three road bridges over it, green sign gantries and median street lights that light up the road at night. |
| **Traffic** | 116 server-driven vehicles: cars, box trucks, coaches and TIR semis (tractor + 13.6 m trailer that bends through the corners). Lane speeds of about 120 km/h on the left down to 80 km/h for trucks on the right; drivers follow at a safe distance (IDM), blink before they change lanes (MOBIL-style), keep right, brake for stopped cars and people, and move over when you come up fast behind them or use the horn / headlight flash (**H**). Brake lights, indicators and headlights are all visible. |
| **Near misses** | Above 150 km/h, passing traffic within 1.2 m without touching pays **NEAR MISS / MAKAS +$100** and XP. Consecutive near misses build a combo (x2 from 3, x3 from 6, x5 from 10); the combo meter shows the combo's cash and XP and runs out after 6 s without a near miss. Any crash (or touching traffic) resets it. Near-miss cash is capped per hour. |
| **Drag racing** | An eighth-mile drag strip in the west belt with grandstand, start/finish gantries and a Christmas tree. Pay $250 and race a bot matched to your car's performance, or wait for another player; the winner takes the $500 pool. Three red lights, then green after a random delay; moving before green is a FALSE START and loses. Reaction time, elapsed time and trap speed are measured on the server; the cars run on their tuned physics, and 0-100 / top speed come from the tuning stats. |
| **Player** | Account (name + password), money, bank, XP/levels, reputation, stats, 17 achievements, settings, appearance, parts inventory. |
| **Vehicles** | 15 fictional models in 8 categories plus 10 real exclusive models (9 cars and a motorcycle you ride visibly) from the Rare Dealer, each with its own detailed 3D body modelled after a real type of car (city hatch, EV, sedans, off-roader, luxury SUV, crew-cab and single-cab pickups, van, rear-engine coupe, supercar, GT, '60s cruiser with fins, roadster): curved panels, glass, wheel arches, lamps, grilles, bumpers and 6 rim styles, with small differences and no real brand names or logos. Each vehicle tracks mileage, fuel, 6 condition parts, cleanliness, mods, owner and sale status. Condition affects value, driving performance and repair cost. |
| **Driving** | Enter or exit with **E**. Driving has acceleration, braking, reverse, handbrake, steering, collisions (with body damage), fuel use, mileage and dirt. |
| **Buying** | Browse, filter, sort and inspect listings; buy or negotiate with data-driven NPC seller personalities. You can also buy from other players. |
| **Repair / wash / fuel** | Per-part repairs with cost, time and a new-condition preview; parts kits; a dealership repair-bay discount; 2 wash tiers; refuelling. |
| **Tuning garage** | At Chroma Customs, with a live 3D preview (turntable, drag to rotate). **Performance:** ECU Stage 1/2/3 (+15/+30/+60% hp, +10/+20/+40% top speed), cold air intake, single/twin/twin-scroll/big turbo and supercharger kits, intercoolers (heat soak), forged pistons & rods, cams, injectors & HPFP, cat-back/Varex/downpipe/straight-pipe exhausts, sport springs and coilovers, semi-slick and slick tyres, big brake kit and carbon ceramics. Stages need their prerequisites (Stage 2: downpipe or straight pipe; Stage 3: turbo/supercharger, forged internals, fuel system), and missing ones are added for you. **Visual:** gloss, metallic, matte and chameleon (colour-shift) paint with presets or any HEX colour, front/rear bumpers, side skirts, carbon hood, ducktail/GT/swan-neck wings, BBS-, Rays- and Rotiform-style wheels in 7 finishes, camber and drop sliders, window tint, headlights and accessories. **Dyno:** hp and Nm curves against rpm (stock vs build), a live dyno pull with engine sound, heat-soak and wheelspin figures. Everything shows live on the car and in the stats (hp, Nm, 0-100, top speed, handling, braking, grip, resale value). |
| **Performance & sound** | Parts change the real driving physics (top speed, acceleration, braking, grip) on the server. Every model has real-world figures (hp, Nm, weight, 0-100, top speed, redline), shown on the speedometer too. The engine sound follows the build: exhaust tone, turbo whistle and blow-off valve, supercharger whine, intake roar, lumpy race cams, electric whine, and pops & bangs (with flames at the exhaust tips) on a throttle lift. Tuned engines wear faster unless you fit forged internals. |
| **Rare Dealer** | A Marketplace tab with 6 special offers that change every 120 seconds for everyone, with a visible countdown that survives reloads (server clock). Offer odds: common/uncommon 70%, rare/epic 25%, legendary 5% (weighted random). The legendary pool holds 10 real cars (BMW i7, M3 Competition, X7 M60i, 5 Series, F 900 GS motorcycle, M8 Competition, Mercedes-AMG GT, E-Class, G 63, Audi RS5), each showing up in at most 5% of rotations. Some offers come pre-tuned. Each offer can be bought once. |
| **Dealership** | Buy a plot, upgrade through 6 levels (each looks different), place and rotate vehicles on up to 12 display slots, and set prices. |
| **NPC customers** | Customers with 7 archetypes (budget, categories, condition and mileage limits, willingness, negotiation) walk into dealerships, buy or make offers, and also buy from the classifieds, even while you are offline. |
| **Economy** | Everything is set in `shared/economy.config.ts` (tuning parts in `shared/modificationsData.ts`). Values depend on category demand (volatile, mean-reverting), condition, mileage, rarity and mods. A full Stage 3 build is worth 150-200% of the stock car. Part prices scale with the car's value and always cost more than the value they add, so tuning pays off only through customers. Fees and taxes prevent arbitrage. |
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
| **F** | Use the fuel station or car wash while driving; open the drag strip at the staging lane |
| **H** | Horn and headlight flash (slower traffic ahead moves over) |
| **Enter** / **T** | Chat |
| **B** / **I** / **J** / **K** / **M** / **O** | Marketplace / Garage / Dealership / Auctions / Map / Profile |
| **Esc** | Close panel / game menu |

**Touch screens (iPad, tablets, phones in landscape)** get on-screen controls automatically:

| Control | Action |
| --- | --- |
| Left stick | Walk or drive (push it all the way to run) |
| Drag anywhere on the 3D view | Camera |
| **E** button, or tap the prompt | Interact / enter / exit vehicle |
| **F** button | Fuel station, car wash or drag strip while driving |
| **HORN** button (hold, while driving) | Horn and headlight flash |
| **RUN** / **BRAKE** button (hold) | Sprint on foot, handbrake while driving |
| Bottom bar | Marketplace, Garage, Dealership, Auctions, Map, Profile, Chat, Menu |

`?touch=1` or `?touch=0` in the URL forces the touch controls on or off. `?hour=22` fixes the time of day (screenshots),
`?hq=0` turns high-detail models off.

## High-detail vehicle models

Every vehicle has a built-in procedural 3D body. To use a high-detail model instead:

1. Get a `.glb` (Sketchfab "Downloadable" models, Poly Pizza, CGTrader...). Check the licence: CC BY needs a credit, many models
   are for personal use only, and car brands are trademarks. Draco compression is supported and recommended, for example
   `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp`.
2. Put it in `client/public/assets/models/` with the file name used in `client/src/data/highDetailVehicles.ts` (for example
   `m3_g80_hq.glb`), or add an entry there: `vehicleId`, `modelUrl`, `scale`, `rotationOffset`, `castShadow`, `receiveShadow`
   and `paintMaterials` (material names that take the car's paint colour).
3. Rebuild (`npm run build`; Render does this on deploy). Only files that exist are loaded (checked at build time).

Models are loaded lazily with three.js `GLTFLoader` + `DRACOLoader`, fitted to the vehicle's real length, stood on the ground and
recoloured. If the car faces backwards, change `rotationOffset.y` (0 or `Math.PI`). The procedural body stays as the fallback for
vehicles without a file (and while a model downloads); distant highway traffic uses a light instanced version.

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
| `DATABASE_SSL` | false | `true` for managed Postgres that requires TLS when the URL has no `sslmode` (Supabase, ...) |
| `SQLITE_PATH` | ./data/getrich.db | SQLite file for local development |
| `CORS_ORIGINS` | *(empty)* | Only needed if the client is hosted on another origin |
| `TRUST_PROXY` | false (true on Render) | Set `true` only when the server is reachable exclusively through a reverse proxy (Northflank, Caddy). Render is detected automatically |
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
- **Simple arcade physics.** Vehicles use a 2D bicycle model with circle colliders. There are no multi-level roads (the highway
  bridges are scenery), and players can walk through each other. Speeds are scaled to the small map; the speedometer shows real
  km/h figures.
- **Traffic stays on the highway.** City streets have no ambient traffic, and highway traffic does not use the ramps.
- **High-detail models are not included.** The loader is ready (see above), but no `.glb` files ship with the game, because
  real-car models need a licence. HQ models replace the whole body, so tuning body parts and rim designs only show on the
  procedural body.
- **Software rendering is slow.** Without a GPU (CI containers, some VMs) Chrome falls back to SwiftShader and the game runs at a
  few FPS. It still works, and the automated tests run that way, but real play needs hardware acceleration.
- **Free hosting sleeps.** The recommended free host spins the server down after ~15 minutes without traffic. The first visitor then
  waits about a minute. See DEPLOYMENT.md.
- **Accounts are name + password only.** There is no e-mail, so a forgotten password cannot be recovered.

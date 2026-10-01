# GetRich Tycoon

A multiplayer 3D browser game about trading used vehicles and building a dealership empire.
It runs in Chrome (and other WebGL browsers) with a real, server-authoritative Node.js backend and a database.

> Start with **$25,000**. Buy worn cars at the Used Vehicle Market, haggle with NPC sellers, repair,
> wash and customize them, then sell them from your own dealership to NPC customers or to other players.
> Reinvest to grow from a small lot into a Mega Dealership and climb the net-worth leaderboard.

All code, the regular catalogue's brands (Norda, Voltara, Velora, Granforge, Apexon, Solenne, Harlan & Finch), the city, the UI and
the sounds are original. Every vehicle is a `.glb` model (Draco-compressed, loaded with `GLTFLoader` + `DRACOLoader`); the default
models that ship with the game are original, made for it, and sounds are synthesized with WebAudio, so there are no third-party
assets. The 10 exclusive Rare Dealer vehicles are real cars (BMW, Mercedes-Benz, Audi), named at the owner's request; their names
live in `shared/specialVehicles.ts`, and no logos or photos are included. Licensed models of the real cars can be dropped in for
any vehicle (see [Vehicle models](#vehicle-models)).

---

## Features

| Area | What is implemented |
| --- | --- |
| **Multiplayer** | Socket.IO WebSockets. Movement is server-authoritative with client-side prediction and reconciliation. Remote players are interpolated. Vehicles, listings, dealerships, auctions, NPC customers and chat all sync in real time. |
| **World** | A procedural 3D city with 9 districts: Dealership Row (8 plots), Used Vehicle Market, Hammerfall Auction House, Wrench Bros Repair & Parts Depot, Sparkle Wash & fuel station, GetRich Bank, Chroma Customs, parking lots and Fortune Plaza (spawn). A green belt with trees surrounds the city, then the highway. A shared **10-minute day** (server clock) with an orange sunset, stars and a moon, lit windows, neon shop signs, street and highway lights, and headlights / brake lights on every car at night. **Rain** comes in random spells for everyone: falling rain, darker skies, wet glossy roads that take a minute to dry, and **20% less tyre grip**. |
| **Highway (No Hesi)** | The GetRich Expressway rings the city: 4 lanes each way (8 in total), white dashed lane lines and yellow edge lines, W-beam guardrails, a concrete median with crossovers, three junctions (connector roads with on/off-ramps) to the city, three road bridges over it, green sign gantries and median street lights that light up the road at night. |
| **Traffic** | 116 server-driven vehicles: cars, box trucks, coaches and TIR semis (tractor + 13.6 m trailer that bends through the corners). Lane speeds of about 120 km/h on the left down to 80 km/h for trucks on the right; drivers follow at a safe distance (IDM), blink before they change lanes (MOBIL-style), keep right, brake for stopped cars and people, and move over when you come up fast behind them or use the horn / headlight flash (**H**). Brake lights, indicators and headlights are all visible. |
| **Near misses** | Above 150 km/h, passing traffic within **50 cm** (measured between the real body outlines) without touching pays **NEAR MISS / MAKAS +$100** and XP, x1.5 for a hair's-breadth pass under 20 cm; the popup shows the gap in cm. Consecutive near misses build a combo (x2 from 3, x3 from 6, x5 from 10); the combo meter shows the combo's cash and XP and runs out after 6 s without a near miss. Any crash (or touching traffic) resets it. Near-miss cash is capped per hour. |
| **Drag racing** | An eighth-mile drag strip in the west belt with grandstand, start/finish gantries and a Christmas tree. Pay $250 and race a bot matched to your car's performance, or wait for another player; the winner takes the $500 pool. Three red lights, then green after a random delay; moving before green is a FALSE START and loses. Reaction time, elapsed time and trap speed are measured on the server; the cars run on their tuned physics, and 0-100 / top speed come from the tuning stats. |
| **Player** | Account (name + password), money, bank, XP/levels, reputation, stats, 17 achievements, settings, appearance, parts inventory. |
| **Vehicles** | 15 fictional models in 8 categories plus 10 real exclusive models (9 cars and a motorcycle you ride visibly) from the Rare Dealer, each with its own detailed 3D body modelled after a real type of car (city hatch, EV, sedans, off-roader, luxury SUV, crew-cab and single-cab pickups, van, rear-engine coupe, supercar, GT, '60s cruiser with fins, roadster): curved panels, glass, wheel arches, lamps, grilles, bumpers and 6 rim styles, with small differences and no real brand names or logos. Each vehicle tracks mileage, fuel, 6 condition parts, cleanliness, mods, owner and sale status. Condition affects value, driving performance and repair cost. |
| **Driving physics** | Real longitudinal physics per car: torque curve, gearbox with shift times, clutch slip at launch, turbo spool, traction limits and weight transfer, rolling resistance and aerodynamic drag that grows with the square of speed, ABS braking (lock-up on classics). 0-100, 100-200 and 200-300 km/h match the real figures (a stock supercar needs ~25 s for 0-300). Smoothed steering, yaw inertia and speed-sensitive lock (no instant direction changes at 200+ km/h), body roll and pitch, handbrake slides. Tight body-shaped (OBB) collision boxes for every car, truck, bus and semi. |
| **Driving** | **F** gets in and out: the character walks to the driver's door (around the car if needed), the door opens, they sit down and the door shuts; drivers are visible in their seats. **C** switches between the chase camera and a **first-person cockpit** with live rev counter and speedometer needles, a steering wheel that turns 540-1080 degrees lock to lock, a gear lever that moves through the gate, pedals that go down and a gear display. A cockpit gauge (bottom right) shows speed, gear, rpm with a shift light, turbo boost (psi), the ECU stage and ABS / TCS lights. Fuel use, mileage, dirt and body damage. |
| **Driving bonus** | Every 10 seconds of real driving pays a bonus scaled by the car's value ($50 for a $50k car, about $350 for a $300k G 63 or M8), shown as a small "+$150 (Driving Bonus)". |
| **Missions (Görevler)** | **L** opens the missions panel on the right: a daily set per player, for example 10 near misses without crashing ($2,500), hold 250 km/h for 5 s (a free Stage 1 ECU remap coupon), sell 2 cars within 120 s ($5,000 + 100 XP), plus extra daily goals. Rewards are paid automatically. |
| **Car theft (Araba çalma)** | A hidden **Black Market** tab in the Marketplace (and the Esc menu) sells the **Lockpick & Testere Seti** for $2,500 from a stock of 5 shared by the whole city that is full again every 10 real minutes (countdown on screen). Cars are parked at city kerbs and broken down (hazard lights on) on the highway shoulder: next to one, **Lockpick Et (E)** opens the lock mini-game: set the pick's angle (mouse, A/D, drag), turn it (W / Space / click); 3 picks (3 HAK); off the sweet spot the cylinder stops short, the pick strains and snaps. Three snapped picks lose the set, the car alarm wails and flashes and the police come at **2 stars**. An opened car is yours to drive (stolen: it can't be stored, sold or listed). Drive it to the **Sanayi / Izgara Garajı** south of the city (🔧 on the map), stop between a lift's posts and press **Aracı Lifte Kaldır (F)**: the car goes up. Walk to the glowing markers and strip the side mirrors, doors, steering wheel, seats and exhaust & catalytic converter; at the front the **engine bay** opens a diagram of the engine block, gearbox, turbo / supercharger, ECU, radiator, alternator and battery to click. Every part disappears from the car and goes into the inventory as a **Sökülmüş Parça**; the bare shell is scrapped. The **Pawn Shop** next door pays a random $10,000-$15,000 per part ("Parçalar Pawn Shop'a satıldı: +$13,400"). |
| **Police** | Near misses above 180 km/h and hitting traffic raise a **wanted level of 1-5 stars**. From 2 stars police interceptors with flashing light bars and sirens chase you (real physics cars, along the highway lanes and through the city streets). Lose them for 30 s: **ESCAPED! +$1,000 & XP**. Stopped with a police car beside you for 3 s: **BUSTED!** cutscene (the police car pulls up, hands up, handcuffs), a fine of 10% of your cash (at least $1,500), the car is towed to your garage and you walk out of the nearest garage. |
| **Reputation unlocks** | Levels open more garage slots, more cars on the street at once, market discounts (up to 10%) and underglow neon kits (rainbow at level 15). |
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
| **Audio** | Synthesized engine following the real rpm and gear changes, intake roar with an open air filter, turbo whistle and blow-off valve (with compressor flutter on Stage 2/3 builds), pops & bangs on upshifts and throttle lifts with a Varex or straight pipe, tyre screech, police sirens, rain, UI, purchase, notification and ambient city sounds. |

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
| **E** | Interact (also enters / exits a vehicle); **Lockpick Et** next to a parked car; strip a part / open the engine bay at a car on a Sanayi lift |
| **F** | Get into the nearest own car / get out (animated); **Aracı Lifte Kaldır** with a stolen car between a Sanayi lift's posts |
| **G** | Use the fuel station or car wash while driving; open the drag strip at the staging lane |
| **C** | Chase camera / first-person cockpit |
| **L** | Missions panel |
| **H** | Horn and headlight flash (slower traffic ahead moves over) |
| **Enter** / **T** | Chat |
| **B** / **I** / **J** / **K** / **M** / **O** | Marketplace / Garage / Dealership / Auctions / Map / Profile |
| **Esc** | Close panel / game menu |
| Lockpick screen | Mouse / **A D** (Shift: fine) set the pick's angle; **W** / **Space** / click turns it; **Esc** gives up (the set is lost) |

**Touch screens (iPad, tablets, phones in landscape)** get on-screen controls automatically:

| Control | Action |
| --- | --- |
| Left stick | Walk or drive (push it all the way to run) |
| Drag anywhere on the 3D view | Camera |
| **E** button, or tap the prompt | Interact / enter / exit vehicle |
| **G** button | Fuel station, car wash or drag strip while driving |
| **CAM** button (while driving) | Chase camera / first-person cockpit |
| **HORN** button (hold, while driving) | Horn and headlight flash |
| **RUN** / **BRAKE** button (hold) | Sprint on foot, handbrake while driving |
| Bottom bar | Marketplace, Garage, Dealership, Auctions, Map, Profile, Chat, Menu |

`?touch=1` or `?touch=0` in the URL forces the touch controls on or off. `?hour=22` fixes the time of day and `?rain=1` the
weather (screenshots; the grip follows), `?cockpit=1` starts in the cockpit view, `?hq=0` ignores dropped-in custom models.

## Vehicle models

Every vehicle, highway truck, coach, semi and the police car is a `.glb` file; there are no built-in shapes in the code. The
default models (original, made for the game, about 3.4 MB in total with a simplified far-away copy each) are in
`client/public/assets/models/vehicles/`, and the registry is `client/src/data/highDetailVehicles.ts` (`modelUrl`, `lodUrl`,
`scale`, `rotationOffset`, `castShadow`, `receiveShadow`, `paintMaterials`, `nodes`, `interior`, `autoFit`, `credit`).

To use a real model of a car (for example a licensed BMW M3 G80 or Mercedes-AMG G 63):

1. Get a `.glb` whose licence allows use in your game (Sketchfab, CGTrader, TurboSquid...; CC BY needs a credit, many models are
   for personal use only, and car brands are trademarks). Draco compression is recommended:
   `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp`.
2. Put it in `client/public/assets/models/` named after the vehicle id, e.g. `bmw_m3_g80.glb` or `mercedes_g_class.glb` (the ids
   are in `shared/vehicles.ts` and `shared/specialVehicles.ts`). It replaces the default model automatically. Or point `modelUrl`
   of that vehicle at the file (a path under `client/public` or a full `https://` URL).
3. Rebuild (`npm run build`; Render does this on deploy).

Dropped-in models are fitted automatically: turned to face forward (`rotationOffset` if it comes in backwards or sideways), scaled
to the car's real length (`scale` fine-tunes), centred, and stood on its tyres so the wheels touch the road. Wheels named like
`wheel_fl` / `Wheel_FL` / "wheel front left" spin and steer; a `door_fl` node opens when you get in and out (`door_fr`,
`mirror_l` and `mirror_r` come off at the Sanayi); `seat_driver` puts the
cockpit camera at the driver's eyes; materials named "paint" (or listed in `paintMaterials`) take the car's colour. See the comment
at the top of `highDetailVehicles.ts` for the full naming convention. Distant highway traffic is drawn instanced from the same
models (the `.lod.glb` copies).

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
- **Physics is 2D.** Vehicles drive on a flat plane with real longitudinal physics and a simplified lateral (yaw / slip) model;
  there are no multi-level roads (the highway bridges are scenery), and players can walk through each other. Speeds are scaled
  to the small map (`SPEED_SCALE` 2.1); the speedometer and all figures are real km/h.
- **Traffic stays on the highway.** City streets have no ambient traffic, and highway traffic does not use the ramps.
- **The real cars ship with original stand-in models.** The loader and the drop-in folder are ready (see above), but no models of
  the real BMW / Mercedes / Audi cars are included, because they need a licence. A dropped-in model replaces the whole body, so
  body-kit parts only show on models that have them (named `kits > kit_*`), and aftermarket rims on models whose wheels are
  named.
- **Software rendering is slow.** Without a GPU (CI containers, some VMs) Chrome falls back to SwiftShader and the game runs at a
  few FPS. It still works, and the automated tests run that way, but real play needs hardware acceleration.
- **Free hosting sleeps.** The recommended free host spins the server down after ~15 minutes without traffic. The first visitor then
  waits about a minute. See DEPLOYMENT.md.
- **Accounts are name + password only.** There is no e-mail, so a forgotten password cannot be recovered.

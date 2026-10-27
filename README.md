# Dead District

A first-person 3D zombie-survival game for mobile browsers (iPad/iPhone Safari) and
desktop. It's built with three.js and Vite, and has an authoritative Node WebSocket
server for online co-op.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173 (also on your LAN: use the "Network" URL on your iPad)
npm run build          # production build in dist/
npm run preview        # serve dist/ on :4173
```

Multiplayer server (also serves the built client, so one process hosts everything):

```bash
npm run build
cd server && npm install && cd ..
node server/server.js  # http://localhost:8787 (game) + ws://localhost:8787 (multiplayer)
```

In the game choose **Multiplayer**, enter the server address (prefilled when the page
is served by the server itself), then **Create session** (you get a 5-letter room code)
or join one by code or from the public session list. Singleplayer never needs the server.

### Hosting the multiplayer server

Any Node 18+ host that supports WebSockets works (Render, Railway, Fly.io, a VPS…):

1. Deploy the whole repository. The server imports the shared simulation from `src/shared/`.
2. Build command: `npm install && npm run build && cd server && npm install`
3. Start command: `node server/server.js` (honours `PORT`).
4. Players open `https://your-host/` and multiplayer connects to `wss://your-host`.

Behind HTTPS you must use `wss://`. A reverse proxy (nginx, Caddy) needs the usual
`Upgrade`/`Connection` headers.

## Deploy on Render with Neon cloud saves

One Render web service hosts everything: the game page, multiplayer (WebSocket) and
the cloud-save API. Saves are stored in Neon Postgres.

1. **Neon:** create a project at https://neon.tech and copy its connection string
   (`postgresql://user:password@ep-....neon.tech/neondb?sslmode=require`).
   The server creates its table (`dd_saves`) automatically on first start.
2. **GitHub:** push this repository to a GitHub repo.
3. **Render:** New → Blueprint → pick the repo. Render reads `render.yaml`, then asks
   for `DATABASE_URL`: paste the Neon connection string there (in the dashboard,
   never in code).
4. Open `https://<your-service>.onrender.com`. Singleplayer, multiplayer and cloud saves
   all use that one address. `/health` shows `"saves":"postgres"` when Neon is connected.

Free Render services sleep after ~15 minutes without traffic, so the first visit after
that takes up to a minute to wake up. Without `DATABASE_URL` the server still runs and
keeps cloud saves in memory only.

### How cloud saves work

* Each device gets a save code such as `K7QX-9MZD-2HPA` (Settings → Gameplay → Cloud save).
* Singleplayer autosaves the whole game to the device and to the server (slot `sp`).
* Multiplayer saves your character (backpack, health, stats) to slot `mp` and restores it
  when you join any room.
* To continue on another device, enter your code under "Use this code". The newest save
  (device or cloud) is used. Anyone who has the code can load or overwrite that save,
  so keep it private.
* API: `GET|PUT /api/save/<code>/<sp|mp>` (JSON, 1 MB limit, 30 writes per minute per IP).

## Controls

* **Desktop:** WASD move · mouse look (click to capture) · Shift sprint · Space jump/handbrake · C crouch ·
  LMB attack/fire · R reload · 1–4/Q/wheel weapons · E interact/enter/exit · F flashlight/headlights ·
  V first/third person · I/Tab inventory · M map · X quick-heal · H horn · Esc pause.
* **Touch:** floating joystick on the left (push to the edge to sprint) · drag anywhere on the right to look ·
  ATTACK (drag across it to aim while firing) · JUMP · CROUCH · USE · RELOAD · WEAPON · LIGHT · VIEW · BAG · MAP.
  While driving: joystick = throttle/steer, BRAKE = handbrake, USE = exit.

## What's in the game

* **City:** a 5×5-block district (~376 m square) generated from a seed. It has apartments with
  stairwells, balconies and rooftops; houses with yards; shop rows (pharmacy, diner, pawn shop…);
  a supermarket; St. Mercy Hospital (2 floors plus a helipad roof); a police station
  safehouse with a sandbagged compound; a petrol station; a 3-deck parking garage with ramps;
  warehouses; a container yard; offices with a plaza; a relief-camp park; and a quarantine wall.
  Every building has real door and window openings and furnished interiors.
* **Rendering:** procedural PBR textures; merged per-material meshes per block; GPU instancing
  for props and wrecks; Web Worker block streaming with GPU disposal; LOD for interior detail;
  a day/night cycle with sun and moon shadows; fog, rain with wet surfaces, lightning, ash
  particles, a pooled street/interior light system, flashlight and headlights; optional bloom.
* **Zombies:** walker, runner and brute. Each has a state machine (idle → wander → investigate →
  chase → attack → search, plus stagger and death), vision cones with line of sight, hearing
  (gunshots, footsteps, doors, engines), A* navigation, door bashing, and tiered AI update
  rates by distance. Skinned characters are animated procedurally.
* **Survival:** health, stamina, hunger, thirst, bleeding, infection from bites, a
  flashlight battery, inventory, 1,500+ lootable containers with loot tables, item use, a
  safe zone, sleeping and saving at the safehouse, autosave, death and respawn (your gear
  stays where you fell), and a seven-step mission chain ending in an evacuation.
* **Combat:** melee (fists, knife, crowbar, bat, axe) and firearms (Glock 19, pump shotgun,
  M4A1 carbine, hunting rifle) with hitscan, headshots, recoil, reloads and touch aim assist.
* **Vehicles:** sedan, pickup (Toyota Hilux model), police cruiser and van. Physics uses a
  bicycle model with engine, brake and drag forces, tyre grip, handbrake slides, multi-circle
  collisions, fuel, damage and running over zombies. There are chase and in-car cameras,
  headlights and brake lights, a synthesised engine sound, fuel pumps and fuel cans.
* **Multiplayer:** server-authoritative zombies, loot, doors, pickups, vehicles and hit
  resolution. It has room codes plus a public session browser, interest-managed 15 Hz
  snapshots with client interpolation, movement and teleport validation, a flood guard, and
  disconnect cleanup.

## Tests

```bash
npm run test:world               # headless world generation + navigation sanity check
node tools/test-sim.js           # zombie population / AI / loot in Node
node tools/test-chase.js         # hearing → chase → attack → melee kill
npm run build && npm run preview &
node tools/smoke.cjs [--mobile]  # boots the game in headless Chromium, screenshots in tools/shots/
node tools/gameplay.cjs          # touch joystick/look/multitouch, combat, loot, doors, driving, saving
DD_TRUST_CLIENT_POS=1 node server/server.js &   # dev flag: lets the test teleport players
node tools/mp-test.cjs           # two browsers: rooms, sync, shared doors/loot/zombies, kills, disconnect
npm run test:db                  # cloud-save store + API against a real Postgres wire server (PGlite)
node server/pg-dev.js &          # local Postgres for development
DATABASE_URL="postgres://postgres@127.0.0.1:55432/postgres?sslmode=disable" node server/server.js &
URL=http://localhost:8787/ node tools/gameplay.cjs
node tools/cloud-test.cjs        # device A saves, device B enters A's code and continues
```

`DD_TRUST_CLIENT_POS=1` disables the server's movement validation and is for automated
tests only. Never set it in production.

## Architecture

```
src/shared/   (no three.js; runs in browser and Node)
  world.js      city layout, roads, lots, registries (doors, loot, spawns, lights)
  buildings.js  modular architecture: walls with openings, stair cores, slabs, building types
  props.js      furniture & street props
  builder.js    geometry/collider recorder → typed arrays per material
  physics.js    AABB spatial hash, character movement, raycasts
  nav.js        1 m navigation grid, A*, line of sight
  sim.js        authoritative simulation (zombies, loot, doors, vehicles, time, weather)
  vehicle.js    vehicle dynamics
  items.js      items and loot tables
src/client/
  game.js       orchestration, render loop, events, saves
  worldView.js  block streaming (Web Worker), instancing, doors, LOD
  player.js     controller, cameras, weapons, viewmodel, driving
  rig.js        procedural skinned humanoids + animation
  session.js    LocalSession (singleplayer) / RemoteSession (WebSocket)
  input.js, hud.js, audio.js, sky.js, effects.js, materials.js, models.js, assets.js, missions.js
server/server.js  rooms, validation, snapshots, static hosting
server/db.js      cloud-save store (Postgres/Neon or in-memory) + /api/save HTTP API
src/client/cloud.js  save codes, cloud load/save with local fallback
render.yaml       Render blueprint
```

## Known limitations

* Inventory and player vitals are client-side in multiplayer. The server validates
  movement, hits, fire rate, loot ranges and vehicle teleports, but it does not own your
  backpack.
* Zombies stay at ground level (they gather below you if you go upstairs). This is intentional.
* The Hilux model is a single mesh, so its wheels don't turn. Procedural vehicles have spinning, steering wheels.
* Performance was verified with headless Chromium software rendering, which is far slower than a
  real GPU. It has not been profiled on a physical iPhone/iPad from this environment.

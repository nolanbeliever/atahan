# Architecture

```
 Browser (Chrome)                                   Node.js game server (single process)
 ┌────────────────────────────┐   HTTPS  /api/auth  ┌──────────────────────────────────────────┐
 │ Login (fetch)              │ ──────────────────▶ │ Express: security headers, auth API,     │
 │                            │                     │ /healthz, static client (dist/client)     │
 │ Game loop (requestAnimFrm) │   WSS  socket.io    │                                          │
 │  ├ Input → InputCmd @30Hz  │ ── input (batched) ▶│ Simulation (shared physics, anti-cheat)  │
 │  ├ Prediction (shared      │ ◀─ snapshot @20Hz ──│   tick: NPC movement, snapshots          │
 │  │   physics) + reconcile  │                     │                                          │
 │  ├ Interpolated remotes    │ ── rpc {id,method} ▶│ RPC dispatcher → Services               │
 │  ├ Three.js renderer       │ ◀─ ack {ok,result} ─│   (market, vehicles, dealership, garage, │
 │  └ UI (DOM panels, HUD)    │ ◀─ events ──────────│    bank, auctions, customers, chat)      │
 └────────────────────────────┘  (self, vehicle.*,  │ GameState (memory) + UnitOfWork          │
                                  market.update...) │          │ one ACID transaction per action│
                                                    └──────────┼───────────────────────────────┘
                                                               ▼
                                                PostgreSQL (prod) / SQLite (dev fallback)
```

## Code layout

- **`shared/`** is imported by both the client and the server, so there is one source of truth:
  - `types.ts`: domain types (`Player*`, `Vehicle`, `MarketListing`, `Auction`, `Dealership`, `Transaction`, `WorldInit`, snapshots)
  - `economy.config.ts`: every tunable number in the game
  - `vehicles.ts`, `customization.ts`: catalogs
  - `valuation.ts`: market value, repair quotes, fuel and quick-sell prices
  - `negotiation.ts`: seller negotiation state machine
  - `progression.ts`: XP curve and achievements
  - `world.ts`: city layout, colliders, plots, display slots, interactables
  - `highway.ts`: the ring highway as a rounded-square centreline (straights + circular corners) in `(s, offset)` coordinates:
    lanes, analytic barriers with gaps (junctions, median crossovers), bridges, sign gantries, street lights, the drag strip,
    belt trees and the drag strip
  - `environment.ts`: the shared 10-minute day (`gameHour`, `nightFactor`, `sunsetFactor`) and the weather (`rainAt`,
    `wetnessAt`, `surfaceGrip`: rain spells per 150 s slot, derived from the server clock, so nothing is sent over the network)
  - `traffic.ts`: traffic vehicle kinds, the deterministic line-up (`trafficSpec(id)`: kind, model, colours, cruising speed,
    home lane), lane speed limits, poses and segment boxes (a semi is a tractor box + a trailer box)
  - `drag.ts`: drag race views, results and timing
  - `drivetrain.ts`: real longitudinal vehicle dynamics in SI units (torque curve, turbo spool, gearbox and shift times, clutch
    slip, traction and weight transfer, rolling resistance, aero drag, ABS / lock-up brakes), calibrated per model to its real
    0-100 and top speed; `performanceFigures` simulates 0-100 / 0-200 / 0-300, the quarter mile and 100-0 braking
  - `obb.ts`: oriented-box geometry (SAT overlap with contact normal and depth, box-circle, box-box distance)
  - `physics.ts`: deterministic character and vehicle stepping (drivetrain + smoothed steering, yaw lag, slip angle), OBB
    collisions with impulse response, analytic highway barriers
  - `passengers.ts`: passenger seats per vehicle (none on a bike, one in a coupe, three otherwise), where they sit and which
    side they get out on (the server keeps riders with the car: `Simulation.startRiding` / `stopRiding`)
  - `theft.ts` (+ `sanayiLayout.ts`): car theft: Black Market stock windows, the lock (`lockTurn`, tolerances), strip parts
    and where to stand for each, Pawn Shop prices, the Sanayi lifts (`bayAt`) and colliders, street parking spots
  - `missions.ts`, `reputation.ts`, `police.ts`: daily missions, level unlocks (garage slots, cars out, market discount,
    underglow) and the wanted-level types
  - `rewards.ts`: the 7-day login streak and playtime milestones (pure rules: next box, streak reset, views, countdowns)
  - `plates.ts`: number plates (registration from the car id, custom text rules); air ride heights live in
    `modificationsData.ts` (`AIR_PART`, `airDropCm`); the nitrous timer is part of the drivetrain state (`DriveState.nitro`,
    the 15th number of `DynTuple`)
  - `cctv.ts`: CCTV cameras whose sweep is a pure function of the server clock (`cameraYaw`, `cameraSees`), so server and
    clients agree without messages; the stolen-car tracking view
  - `streetRace.ts`: street race routes on the road grid, checkpoints, grid slots, poses along a route (bots), standings
  - `weapons.ts` (+ `compounds.ts` for the hospital and Ammu-Nation): guns, ammo, damage stages of a car, and the ray maths
    (boxes, rotated boxes, people) used by the server to decide hits and by the client to aim
  - `collision.ts`: builds the same collision world on both sides
  - `protocol.ts`: typed RPC map, events and validation helpers
- **`server/`**:
  - `main.ts` creates the HTTP server, Socket.IO, DB, state, `GameServer`.
  - `game/GameServer.ts` handles connections, authentication, RPC dispatch (rate limiting, request-id dedupe, error mapping), change propagation, tick loops and autosave.
  - `game/state.ts` holds `GameState` (authoritative in-memory world) and `UnitOfWork` (transactions).
  - `game/simulation.ts` is the movement simulation, speed-hack protection and snapshot building.
  - `game/services/*` contains one module per gameplay system (`tuning.ts`: the tuning garage, `rareMarket.ts`: the Rare Dealer rotation,
    `highway.ts`: near-miss detection, combos, batched payouts and traffic yielding, `drag.ts`: drag strip queue, bot matching,
    lights, false starts, timing and the pool, `driving.ts`: the driving bonus every 10 s, `missions.ts`: daily mission
    progress and rewards, `police.ts`: heat and stars, police interceptors (physics cars routed over the city road grid and the
    highway lanes), escapes and arrests, `theft.ts`: the Black Market stock, street-parked cars (solid for the simulation),
    lockpick sessions with the sweet spot kept on the server, the alarm and police heat, the Sanayi lifts and timed
    stripping, the Pawn Shop and clean-up of abandoned stolen cars).
  - `game/traffic.ts` is the traffic driver model (IDM car following + MOBIL-style lane changes with indicators, keep-right,
    yielding; players, walkers and parked cars are obstacles).
  - Newer services: `rewards.ts` (streak and playtime, state in `player_rewards`, claims paid in one transaction),
    `pursuit.ts` (CCTV sightings, the 3-minute stolen-car countdown, the car becoming the thief's), `streetRace.ts` (the race
    schedule, grid, checkpoints, bots, payouts and police), `combat.ts` (Ammu-Nation, shots traced on the server against
    buildings, cars and people, car body HP and blow-outs, pedestrians, police officers on foot, health, WASTED and the
    hospital). Shots come in as a `fire` socket event; fired rounds are taken out of the saved inventory every 2 s.
  - `db/` holds the PostgreSQL and SQLite adapters behind one small `Database` interface, plus the repository (row mapping, parameterized SQL).
- **`client/`**:
  - `game/Game.ts` runs the loop, fixed-step prediction, reconciliation and interactions.
  - `game/EntityViews.ts` owns all dynamic scene objects.
  - `render/*` builds the city, characters and dealership levels procedurally; every vehicle is a `.glb` model. `render/batch.ts` merges static meshes per material to keep draw calls low.
  - Tuning: `shared/modificationsData.ts` (parts data) and `shared/tuningSystem.ts` (pure `calculateVehicleStats`, dyno curves, prices, `quoteTuning`) are used by both the server (authoritative pricing/validation, physics) and the client (`ui/panels/garage.ts`, `ui/DynoChart.ts`, `render/Studio.ts` for the 3D preview and Rare Dealer pictures, `audio/Audio.ts` for the engine voice).
  - Vehicle models: `data/highDetailVehicles.ts` is the registry (one `.glb` + far-away `.lod.glb` per vehicle, traffic kind and
    the police car); `render/ModelLibrary.ts` loads them with `GLTFLoader` + `DRACOLoader`, fits dropped-in models (orientation,
    real length, centre, tyres on the road), finds wheels / door / seat / exhausts / lamps / kit parts by name and caches a
    template per model. `render/VehicleMesh.ts` clones it per vehicle and dresses it (paint, dirt, damage, tint, lamps, rims,
    kits, stance, underglow), animates wheels, body roll / pitch, brake / reverse / head lights, the driver's door and exhaust
    flames, and merges parked vehicles into a few meshes. `BikeView` leans into corners and carries the rider.
  - Interior and cutscenes: `render/Cockpit.ts` fits the shared `cockpit.glb` at the driver's seat with live needles, steering
    wheel, gear lever, pedals and a gear screen; it is drawn in a second pass (`Renderer.overlay`, layer 1) so the outer body
    never hides it. `game/EntityViews.ts` animates getting in and out (walk to the door, door, sit) and seats the drivers;
    `game/Busted.ts` plays the arrest cutscene; `game/Police.ts` renders police cars with wig-wag light bars.
  - Car theft: `game/Theft.ts` (street cars with hazard / alarm lights, the alarm sound, lockpick and lift prompts, work
    markers and the timed strip job), `render/Sanayi.ts` (yard, hall with a roof that fades while you are inside, two-post
    lifts whose arms rise with the car, Pawn Shop with its neon), `render/StripRig.ts` (engine bay, exhaust, seats and
    steering wheel of a car on a lift; parts vanish as they are stripped, mirrors and doors are model nodes hidden in
    `VehicleMesh.ts`), `ui/panels/lockpick.ts` (the canvas mini-game), `ui/panels/engineBay.ts` (clickable engine bay) and
    `ui/panels/theft.ts` (Black Market tab, Pawn Shop, Sanayi office).
  - Weather: `render/Weather.ts` (rain streaks around the camera, wet-road materials); `Renderer#setTime(hour, rain)` runs the
    sky (orange at sunset, grey in the rain), sun / moon, image-based light and fog.
  - HUD: `ui/Gauge.ts` (canvas rev counter, speed, gear, boost, stage, ABS / TCS, driving bonus pop-up), `ui/WantedHud.ts`
    (stars, escape countdown, arrest meter, BUSTED / ESCAPED / mission banners), `ui/MissionsHud.ts` (the missions drawer).
  - Highway: `render/Highway.ts` sweeps the carriageways, markings, guardrails, median, ramps, bridges, gantries, lights and
    the drag strip from `shared/highway.ts`. `game/Traffic.ts` extrapolates the traffic between updates (errors fade out) and
    feeds its boxes to local prediction; `render/TrafficView.ts` draws it with instancing (each vehicle's GLB baked into two
    geometries near the camera, the LOD copy far away) plus instanced brake lights, indicators and night glows.
  - Custom models: the Vite plugin `vite-plugin-hq-models.ts` provides `virtual:hq-models` (the files dropped into
    `client/public/assets/models/` at build time), so a `<vehicleId>.glb` there replaces the default model without any request
    for missing files. The Draco decoder is bundled by three.js; the CSP allows it (`'wasm-unsafe-eval'`, `worker-src blob:`,
    `connect-src blob:` for embedded textures).
  - `ui/*` is a DOM UI. `ui/dom.ts` only ever inserts text via `textContent`.

## Multiplayer model

**Server-authoritative movement.** The client samples input every fixed step (1/30 s) and produces an
`InputCmd {seq, dt, keys, yaw}`. It applies the command locally with the shared physics (prediction) and sends it to the server
in batches of two. The server validates each command:

- the sequence number must increase;
- `dt` must be in (0, 0.1];
- `keys` must be a valid bitmask;
- the command must fit a per-player **time budget**. The budget refills in real time and is capped at 1 s, so sending
  commands faster than real time (speed hacking) simply gets them dropped.

Accepted commands are applied with the same physics code.

Every tick (20 Hz) the server sends each client a compact snapshot. It contains all players
`[id,x,z,rot,anim,vehicle]`, the vehicles being driven, the NPC customers, the last processed input `ack`, and the client's own
authoritative state. The client drops acknowledged commands, resets to the server state, and replays the unacknowledged ones
(reconciliation). The remaining visual error is smoothed out over about 100 ms. Remote entities are rendered 110 ms in the past and
interpolated between snapshots.

Collision uses static building AABBs plus circles for fountains, pumps, trees and every parked, displayed, market or driven vehicle,
and the highway barriers analytically (distance from the centreline, with gaps). Barriers push a body back to the side it came
from, and vehicle steps are split into sub-steps of at most 1 m, so fast cars cannot tunnel through them. Traffic near a player
adds a row of circles along each vehicle. The client builds the same collision world from the data it receives (traffic from its
extrapolated copy), so predictions rarely need correcting.

**Traffic** runs on the server (116 vehicles, about 0.2 ms per tick) and rides along in the snapshot as
`tr: [id, s, offset, targetOffset, speed, flags]` tuples: cars within 150 m ten times a second, everything within 330 m twice
a second. The client knows each vehicle's type and colours from its id (`trafficSpec`), so nothing else is sent.
Snapshots are sent before the tick's game logic runs: they are *volatile* (dropped while the socket is still busy), so any
other message emitted just before them in the same tick would starve them.

**Drag races** are run by `DragService` from the tick: staging (vehicles placed at the line and held), three red lights and a
randomly delayed green, false-start and lane checks, interpolated finish times, then the payout in one unit of work. The
bot drives with the same `stepVehicle` physics as players, using a car whose simulated eighth-mile time is within a few
percent of yours.

**Everything else is an RPC.** A single `rpc` channel carries `{id, method, params}` and receives an acknowledgement with `{ok, result}` or
`{ok:false, error, code}`. Handlers validate every parameter (`server/validate.ts`). The request `id` is cached for
de-duplication, so a network retry can never execute a purchase twice. RPCs are rate limited with a token bucket per socket.

**State propagation.** Services never broadcast directly. Every commit returns a `CommitResult`, which lists the changed
players, vehicles, dealerships, listings and auctions. `GameServer.onCommit` translates it into events:

| Event | Contents |
| --- | --- |
| `self` | Private player state, sent to the owner only |
| `vehicle.upsert` / `vehicle.remove` | Public vehicles (parked and displayed) |
| `dealership.upsert` | Dealership changes |
| `market.update` | NPC listings |
| `listings.changed` | Player listings changed |
| `auction.update` | Auction state |
| `player.upsert` | Public player info |
| `notify` | Toasts |
| `highway.nearmiss` / `highway.combo` | Near-miss payouts and combo end (crash or timeout) |
| `drag.update` | Drag race state (lights, results); bot positions ride in the snapshot (`dr`) |

Private data (money, bank, purchase prices, the hidden negotiation minimum, the NPC bidder cap) never leaves the server.

## Transactions and persistence

`GameState` keeps the whole world in memory: players, vehicles, dealerships, listings and auctions, loaded at start-up.
Every economic action runs like this:

1. It takes **keyed locks** (`KeyedMutex`) for every entity it touches, such as `p:<player>`, `v:<vehicle>`, `l:<listing>` or `a:<auction>`.
   Keys are acquired in sorted order, so actions cannot deadlock.
2. It creates a `UnitOfWork`. Drafts are deep clones of the live records.
3. It validates and mutates the drafts. `uow.debit()` refuses to overdraw; it also records a `transactions` row.
4. `commit()` writes all drafts, transactions and notices in **one database transaction**. The schema adds `CHECK (money >= 0)`
   and a unique `(plot_id, slot)` index as last-line invariants.
5. Only after the database commit succeeds are the drafts applied to memory, and events emitted.

If the database write fails, memory is untouched, so memory and the database cannot diverge on money or ownership.

High-frequency data (positions, driving distance, fuel, mileage, dirt, collision damage) is accumulated in the simulation.
It is flushed under the same locks every 3 s while driving, on exit and on disconnect. Player positions are saved every
`AUTOSAVE_SECONDS` and on disconnect/shutdown (SIGTERM triggers a final save).

**Schema.** `database/schema.sql` is portable SQL: TEXT/BIGINT/DOUBLE PRECISION, JSON stored as TEXT, `ON CONFLICT` upserts and a
partial unique index. It runs unchanged on PostgreSQL and SQLite. The SQLite adapter converts `$n` placeholders and serializes all
access through one queue, so async transactions stay isolated.

## Server loops

| Loop | Rate | Work |
| --- | --- | --- |
| tick | 20 Hz (`TICK_RATE`) | NPC customer movement, dynamic colliders, highway traffic, near-miss detection, drag races, police, stolen-car tracking, street races, fights (pedestrians, officers, health), snapshots |
| slow tick | 1 Hz | customer spawns and decisions, auction NPC bids and settlement, near-miss payouts, driving flush, playtime counting (saved every 30 s) |
| market refresh | 10 s | expire and replenish NPC listings (keeps 16 cars in the lot) |
| demand trends | 90 s | category demand random walk with mean reversion |
| bank interest | 60 s | pay accrued interest to online players (offline players catch up on login) |
| autosave | 30 s | positions and driving state |

## Scaling notes

A single instance can handle hundreds of concurrent players. Snapshots are small tuples with 2-decimal precision, sent as volatile
emits. To scale further:

- shard by city instance (multiple worlds);
- move to binary snapshots with interest management;
- keep PostgreSQL as the source of truth, with a Redis adapter for Socket.IO.

Horizontal scaling of one shared world would need the locks and the in-memory state to move into the database (`SELECT ... FOR UPDATE`)
or into a dedicated state service.

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
  - `physics.ts`: deterministic character and vehicle stepping, collision
  - `collision.ts`: builds the same collision world on both sides
  - `protocol.ts`: typed RPC map, events and validation helpers
- **`server/`**:
  - `main.ts` creates the HTTP server, Socket.IO, DB, state, `GameServer`.
  - `game/GameServer.ts` handles connections, authentication, RPC dispatch (rate limiting, request-id dedupe, error mapping), change propagation, tick loops and autosave.
  - `game/state.ts` holds `GameState` (authoritative in-memory world) and `UnitOfWork` (transactions).
  - `game/simulation.ts` is the movement simulation, speed-hack protection and snapshot building.
  - `game/services/*` contains one module per gameplay system (`tuning.ts`: the tuning garage, `rareMarket.ts`: the Rare Dealer rotation).
  - `db/` holds the PostgreSQL and SQLite adapters behind one small `Database` interface, plus the repository (row mapping, parameterized SQL).
- **`client/`**:
  - `game/Game.ts` runs the loop, fixed-step prediction, reconciliation and interactions.
  - `game/EntityViews.ts` owns all dynamic scene objects.
  - `render/*` generates everything procedurally: city, vehicles, characters, dealership levels. `render/batch.ts` merges static meshes per material to keep draw calls low.
  - Tuning: `shared/modificationsData.ts` (parts data) and `shared/tuningSystem.ts` (pure `calculateVehicleStats`, dyno curves, prices, `quoteTuning`) are used by both the server (authoritative pricing/validation, physics) and the client (`ui/panels/garage.ts`, `ui/DynoChart.ts`, `render/Studio.ts` for the 3D preview and Rare Dealer pictures, `audio/Audio.ts` for the engine voice).
  - Motorcycles: `render/bikeBody.ts` builds the bike; `BikeView` leans into corners and carries the rider.
  - Vehicle bodies: `render/carDesigns.ts` describes each model with numbers (side profile, plan shape, greenhouse, axles, lamps, grille, bumpers, rims). `render/carBody.ts` lofts the body from superellipse cross-sections with wheel-arch cut-outs, adds a glass greenhouse and conforms lamps, grilles and plates to the surface. The result is merged into a few material slots (trim and lamps use vertex colours) and cached per model. `render/VehicleMesh.ts` adds per-vehicle paint, dirt, damage and mods on top; parked cars use one merged wheel mesh and switch to animated wheels only while moving.
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

Collision uses static building AABBs plus circles for fountains, pumps and every parked, displayed, market or driven vehicle. The
client builds the same collision world from the data it receives, so predictions rarely need correcting.

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
| tick | 20 Hz (`TICK_RATE`) | NPC customer movement, dynamic colliders, snapshots |
| slow tick | 1 Hz | customer spawns and decisions, auction NPC bids and settlement, driving flush |
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

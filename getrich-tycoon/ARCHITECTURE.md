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
  - `strait.ts`: the strait east of the city and the two suspension bridges over it. `WORLD_BOX` replaces the old square
    world edge; `WATER` is the strait (banks are walls). Each bridge is a raised **deck** (level 1 = north, 2 = south) with
    ramps at both ends: `nextDeck` is the one rule for getting on (only at an end, from the ramp) and staying on (inside the
    footprint), `deckHeight` / `surfaceHeight` give the height, `deckAt` guesses the level for a spawn. Piers, anchorages and
    the ramps' low walls are colliders for ground-level bodies; rails for deck-level ones. Also the speed radars and the
    far-shore roads (the VIP Otoban north-south, `bridgeEnds` for the police).
  - `farShore.ts`: the far shore: the hill (`terrainHeight`, `standHeight` for guns, `rayHitsHill`), the touge (a smoothed
    switchback path, guardrails as thin OBB walls in a grid: `wallsNear`, `crossesWall`), the Galeri Bulvarı, the docks
    road, gate and container yard (stacks, cranes, flood-light towers, fences).
  - `roadGraph.ts`: the police road graph (city grid, the bridges, the VIP Otoban stops, the boulevard, the docks and the
    touge as a chain): `NAV_NODES`, `NAV_EDGES`, Dijkstra in the police service, `navRoadPoints` for spike strips.
  - `showrooms.ts` (+ `showroomModels.ts`): the eight themed showrooms (building, door, forecourt turntable, two turntables
    inside, test-drive bay, theme colours, stock), new-car and Black Market prices (`showroomPrice`, `blackMarketPrice`),
    offer ids and the test-drive view; `showroomModels.ts` holds the 12 showroom-only real cars.
  - `tolls.ts`: the toll plazas (lanes, booth islands as colliders, the eastbound toll line), the ANPR cameras (deck or
    ground, crossing tests), what a camera reads off a car (`plateRead`), checkpoint plans (`checkpointPlan`: four cars
    in a V and a strip on a bridge deck near its far end) and the toll history event type.
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
    progress and rewards, `heists.ts`: heists (shared/heists.ts: the crew, the police response delay, work at the door,
    cover, the loot held until the police are lost, the showroom car to the docks), `crime.ts`: dirty money per player
    (one JSON document in `player_crime`, edited through a unit of work: `UnitOfWork.setCrimeState`), `realestate.ts`:
    the estate agent (businesses bought with clean money, dirty money paid in, `launder` cycles every slow tick),
    `telegram.ts`: Telegram dealing (the supplier's and customers' deal cars, solid and broadcast as `deal.cars`, the
    channel's orders, dead drops, the cockpit handover timed on the server; the client plays it in `game/DealScene.ts`),
    `security.ts`: security gear bought at Chroma Customs and the hidden compartment's Z (the arrest's search of the
    car is `DealService.search` in telegram.ts, the armour `CombatService.armorOf`/`damageCar`, the run-flats in
    police.ts' `checkSpikes`/`burstTyres`; the compartment is left out of `toPublicVehicle`; the client draws the
    run-flat rings, cracked glass and the garage x-ray in `render/SecurityLook.ts`),
    `mechanic.ts`: the Sanayi's part-time mechanic (shifts, customers' cars on free lifts broadcast as `mech.cars`,
    `TheftService.bayBusy` keeps stolen cars off them, the jobs timed per tick, $1,000 per car; the client draws the cars
    in `render/RepairCars.ts` and the shift card in `ui/MechanicHud.ts`),
    `police.ts`: heat and stars, the **response time** (an offence is a call: `police.radio`, the estimate by stars
    in `ECONOMY.police.response`; the cars leave the nearest station of `POLICE_STATIONS` (shared/compounds.ts) when they
    can make it in time, otherwise a patrol out on the roads, and drive to the scene with `mode: 'respond'`; a car or the
    helicopter keeping the player in sight starts a pursuit (`engage`); nobody on the scene after a look round closes the
    call (`calledOff`): no stars, a crime scene for a crime, the cars `mode: 'return'` drive back to the station),
    `crimeScene.ts` (the taped-off scenes: `planCordon` in shared/police.ts, two officer NPCs `csi_*` walking with
    torches and kneeling at the evidence, tampering checks five times a second, 3 minutes then cleared; combat can
    shoot them), police interceptors (physics cars routed over the city road grid and the
    highway lanes), line of sight five times a second per car (`policeSees` in shared/sight.ts against the solid colliders
    minus the see-through fences and toll islands), the back alleys (shared/alleys.ts: the cars right behind follow the
    player in and crash into the bollards, the rest go round to the far end; `CAR_GATES` in shared/physics.ts stop every
    four-wheeled vehicle on the bollard line, `render/Alleys.ts` draws the alleys), the last sighting, searching cars (`PF.SEARCH`), the hidden countdown,
    staggered spawns and spacing, escapes and arrests, spike strips thrown ahead of 3-star drivers (`spikePlacement` in
    shared/policeGear.ts; a car over one gets the `blown` mod: tyres at 0, grip down in `vehicleParams`) and the police
    helicopter (orbits the last place it saw you, searchlight, spots you like a car does, loses you under
    cover: `isCovered`), `theft.ts`: the Black Market stock, street-parked cars (solid for the simulation),
    lockpick sessions with the sweet spot kept on the server, the alarm and police heat, the Sanayi lifts and timed
    stripping, the Pawn Shop and clean-up of abandoned stolen cars),
    `trafficStops.ts`: police checkpoints (shared/trafficStops.ts sites and cone layout; two parked units per stop fed
    to the police snapshots through `PoliceService.unitSources`, officers `stp_*` and the K9 dog `k9_*` as NPCs, the
    warn / check / verdict state machine per driver, `police.engageWith` hands the stop's cars over to a pursuit;
    `render/TrafficStops.ts`, `render/Dog.ts`, `ui/StopHud.ts` on the client),
    `burglary.ts`: night burglaries (shared/burglary.ts: the eight places, their front doors and their rooms; the rooms
    are built far south of the world in `INTERIOR_ZONE`, where `resolveCircle` in shared/physics.ts only looks at
    `INTERIOR_BOXES` (the walls and furniture) and other people, so client prediction and the server agree and nobody
    outside can walk in; the door and safe locks reuse shared/theft.ts `lockTurn`/`lockHint` with the sweet spot kept on
    the server; the noise meter, lasers and blinking motion sensors (`cycleOn` on the server clock, the same on the
    client) checked every tick; the alarm calls `police.raiseHeat(..., etaSec 30)` and `PoliceService.hideouts` makes the
    police treat the burglar as standing at the front door, unseen and unarrestable; the bag is paid clean on a quiet
    exit or kept hot until `clearedListeners`; `render/Interiors.ts` draws a room the first time you're in it plus the
    outdoor alarm flashers, `render/Villas.ts` the two villas, `ui/BurglaryHud.ts` the noise meter, `game/Burglary.ts`
    the prompts, and the lockpick panel has `door` and `safe` modes),
    `gangs.ts`: gang territories (shared/gangs.ts zones, hangouts as `BUILDINGS`, the roads the gang cars come in on;
    members `gng_*` are NPCs fed to combat through `CombatService.hostileSources` (shot without police heat) and shoot
    back with `CombatService.npcFire`; a bullet in a building in a zone (`wallHitListeners`) or a hit on a member starts a
    war; the gang cars are kinematic along their lanes, solid through `sim.setExtraObstacles('gangs')`, sent as
    `gang.cars` five times a second; waves, capture, protection money, retaliation, all saved in the world state
    `gangs`; the client draws the cars and the hangouts' neon and flags in `render/GangView.ts`, the zones and dominance
    bars on the maps in `ui/Minimap.ts`, the banner / war card / attack alert in `ui/GangHud.ts`, the cash box in the
    Emlak Dünyası panel),
    `docks.ts`: the docks at night (shared/docks.ts containers are `STATIC_BOXES`; the cut session with a minimum time,
    the loot, import orders and the crane / depot, the trap: barricades through `Simulation.setExtraBoxes('docks')`
    (the client adds them to its own boxes from `docks.state`), SWAT vans via `PoliceService.standingUnit` +
    `engageWith`, SWAT officers `cop_dk*` fed to combat as `officerSources` and shooting with `npcFire`, ramming checked
    per tick; the client draws containers, sparks, crane, loads, barricades and floodlights in `render/Docks.ts`, the
    grinder mini-game is `ui/panels/grinder.ts`, the phone's Toplu İthalat tab in `ui/panels/phone.ts`; C4 and body
    armour are in `combat.ts` (`plantC4`, `wearArmor`, the armour soak in `hurtPlayer`)).
  - `game/traffic.ts` is the traffic driver model (IDM car following + MOBIL-style lane changes with indicators, keep-right,
    yielding; players, walkers and parked cars are obstacles).
  - Newer services: `rewards.ts` (streak and playtime, state in `player_rewards`, claims paid in one transaction),
    `pursuit.ts` (CCTV sightings, the 3-minute stolen-car countdown, the car becoming the thief's), `streetRace.ts` (the race
    schedule, grid, checkpoints, bots, payouts and police), `combat.ts` (Ammu-Nation, shots traced on the server against
    buildings, cars and people, car body HP and blow-outs, pedestrians, police officers on foot, health, WASTED and the
    hospital; any passenger may shoot from a vehicle, a bike rider only with a one-handed gun; the trace skips the
    shooter's own vehicle; kill and wall-hit listeners feed the hitman contracts; the helicopter is a cylinder target),
    `hitman.ts` (the alley contact NPC, one contract per player: drive-by hits counted from wall hits by a crew member in a
    moving vehicle, or a mark NPC spawned in a search area; payout in one transaction, expiry, the crew is everyone in
    the vehicle), `moto.ts` (Moto Gear helmets and visors, and bike crashes:
    the simulation reports a flipped wheelie or a hard hit through `bikeCrashListeners`, the riders come off and are hurt
    by `helmets.crashDamage`). Shots come in as a `fire` socket event; fired rounds are taken out of the saved inventory
    every 2 s. The wheelie itself is shared physics (`stepWheelie` in physics.ts, part of the predicted `DynTuple`).
  - Map expansion: `radar.ts` (a car passing under a bridge radar gantry at speed: flash, personal best in the player's
    stats, the server record) and `showrooms.ts` (the themed showrooms: new cars at the showroom price in a factory
    colour; the Black Market's rotating one-of-a-kind used cars with a theft record (`mods.hot`), rolled from a server
    secret and the epoch like the Rare Dealer's, sold cars saved; test drives: a temporary car with status `testdrive`
    in the showroom's bay, ended when the time is up, the driver gets out, is arrested or logs off; body damage is billed;
    a test car can't be stored, sold, tuned, raced, earn the driving bonus or count towards the garage; leftovers are
    removed at startup), `tolls.ts` (each tick every driven car's move is tested against the toll line and the camera
    lines: toll or evasion fine in one transaction, camera hits add police heat; a per-player session history with
    `toll.event` pushes) and the checkpoints inside `police.ts` (set up when a 2-star driver goes from the ground onto a
    deck, braked parked units that are also obstacles and in the snapshot, a shove on a fast hit, the breakthrough pay).
    Plate gear: `showrooms.plateGear` (Black Market door) and `vehicles.flipPlate` (P).
  - `db/` holds the PostgreSQL and SQLite adapters behind one small `Database` interface, plus the repository (row mapping, parameterized SQL).
- **`client/`**:
  - `game/Game.ts` runs the loop, fixed-step prediction, reconciliation and interactions.
  - `game/EntityViews.ts` owns all dynamic scene objects.
  - `render/PostFx.ts` (medium/high graphics): the world into an HDR multisampled target with its depth, screen-space reflections on flat wet surfaces (high, in the rain; the normal comes from the depth), the first-person interior on top, `UnrealBloomPass` (stronger and lower-threshold at night), a radial speed blur and `OutputPass` (tone mapping, sRGB). `Renderer.render()` uses it unless the quality is low; soft shadows are the sun's PCF filter with a wider `shadow.radius` (3.5 on high, 2.5 on medium).
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
    never hides it. `render/GunView.ts` is the first-person gun drawn in the same pass when a gun is out on foot: each gun is
    built so its rear and front sights line up on the middle of the screen (no crosshair), with hands, walk bob, the kick
    and muzzle flash; `Game.recoilKick` moves the view by `recoilKick()` (shared/weapons.ts) and lets it settle.
    `ui/TouchControls.ts` adds the touch look area (right half of the screen, behind the HUD), the gun button and
    **ATEŞ ET**. `game/EntityViews.ts` animates getting in and out (walk to the door, door, sit) and seats the drivers;
    `game/Busted.ts` plays the arrest cutscene; `BikeView` (render/VehicleMesh.ts) also draws the quad (four wheels, no
    lean), the pillion seat and the wheelie pose (pivoting on the rear tyre); characters wear their helmet on bikes; `game/Police.ts` renders police cars with wig-wag light bars (the SWAT van
    with a roof bar; `PF.QUIET` at a crime scene: lights, no siren; no flags: lights off on the way home),
    `render/CrimeScene.ts` the cones, tape, flares and evidence of a crime scene, `render/PoliceStations.ts` the stations'
    beacons and bays, `ui/ScannerHud.ts` the police radio panel (waveform, lines, the yellow call strip, the scanner's
    live countdown; `AudioSystem.radio` plays the squelch, static and a Turkish speech-synthesis voice), spike strips
    (instanced spikes, blinking lamps) and helicopters (`render/Helicopter.ts`: rotors, beacons, searchlight cone and pool,
    HP bar); `VehicleMesh.flat` drops a car with burst tyres onto its rims. Hitman: `ui/panels/hitman.ts` (the contact),
    `ui/HitmanHud.ts` (the contract card), the minimap search circle, mark labels only for the contract holder, and the
    alley props in `render/City.ts`. In a vehicle the sights camera sits at the passenger's seat, the pillion or the rider.
  - Car theft: `game/Theft.ts` (street cars with hazard / alarm lights, the alarm sound, lockpick and lift prompts, work
    markers and the timed strip job), `render/Sanayi.ts` (yard, hall with a roof that fades while you are inside, two-post
    lifts whose arms rise with the car, Pawn Shop with its neon), `render/StripRig.ts` (engine bay, exhaust, seats and
    steering wheel of a car on a lift; parts vanish as they are stripped, mirrors and doors are model nodes hidden in
    `VehicleMesh.ts`), `ui/panels/lockpick.ts` (the canvas mini-game), `ui/panels/engineBay.ts` (clickable engine bay) and
    `ui/panels/theft.ts` (Black Market tab, Pawn Shop, Sanayi office).
  - Map expansion: `render/Strait.ts` (the water, quays, the far shore's ground and roads, both bridges: decks, girders,
    piers, towers, main cables and hangers with LED lights at night, anchorages, lamps, the radar gantries and their
    flash), `render/FarShore.ts` (the hill mesh, the touge ribbon with markings, guardrails, trees and the start banner, the
    boulevard and its lamps, the docks with instanced containers, cranes and flood lights), `render/Showrooms.ts` (the
    eight showroom buildings: glass fronts, signs, neon, themed props, turntables with stock cars loaded near the player),
    `ui/panels/showroom.ts` (the stock, the turntable preview in `render/Studio.ts`'s turntable mode, colours, test drive,
    buy) and `ui/TestDriveHud.ts` (the clock and **Teslim Et**). Heights on the far shore come from `City.groundHeight` /
    `surfaceY` (terrain and decks) and `surfaceTilt` (pitch and roll on slopes and ramps).
  - Tolls: `render/Tolls.ts` (plaza canopy, booths, barrier arms that lift or fly up red, ANPR gantries and their flash),
    `ui/TollFeed.ts` (the live feed and the fine notice), `ui/panels/tolls.ts` (history), the Black Market plate gear in
    `ui/panels/showroom.ts`, a flipped plate's bare back in `VehicleMesh.ts`, checkpoint banners in `ui/WantedHud.ts`.
  - Weather: `render/Weather.ts` (rain streaks around the camera, wet-road materials); `Renderer#setTime(hour, rain)` runs the
    sky (orange at sunset, grey in the rain), sun / moon, image-based light and fog.
  - HUD: `ui/Gauge.ts` (canvas rev counter, speed, gear, boost, stage, ABS / TCS, driving bonus pop-up), `ui/WantedHud.ts`
    (stars, the blue HIDDEN countdown and the "being seen" meter, arrest meter, BUSTED / ESCAPED / mission banners), `ui/MissionsHud.ts` (the missions drawer).
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
| tick | 20 Hz (`TICK_RATE`) | NPC customer movement, dynamic colliders, highway traffic, near-miss detection, drag races, police (cars, spike strips, helicopters), stolen-car tracking, street races, fights (pedestrians, officers, health), hitman contract expiry, snapshots |
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

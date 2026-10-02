# Testing

Three layers, all automated:

| Layer | Tool | Location | What it proves |
| --- | --- | --- | --- |
| Unit | Vitest | `tests/unit` | Valuation, repair pricing, negotiation (randomized), physics (determinism, OBB collisions, anti-teleport, real 0-100 / 0-200 / 0-300 figures, aero drag, braking distances, steering and yaw lag at speed, wet grip), progression, economy invariants (arbitrage-free), locks, rate limits, validators, password hashing, client IP resolution behind proxies, touch joystick mapping, vehicle models (every vehicle, traffic kind and the police car has a Draco GLB; each default model matches the catalogue size with its tyres on the road and has wheels, seat, lamps, kit parts and exhausts (none on EVs); the cockpit has needles, wheel, shifter and pedals; fitting a centimetre-scale backwards downloaded model to size), day/night and weather (10-minute day, sunset, ~30% rain, wet roads drying, grip down to 80%), missions (daily set, rewards, saved progress, timed missions), reputation unlocks, the driving bonus curve and police stars / fines, tuning engine (stock figures, Stage 1/2/3 gains, power caps, each part category, traction, stance, exhaust sounds, fitment rules for EVs/bikes/prerequisites, `quoteTuning` pricing, dyno curves matching the headline figures, physics scaling, 150-200% value of a Stage 3 build, **arbitrage-free part prices** for every part on every model), Rare Dealer (70/25/5 odds and **each legendary in ≤ 5% of rotations** by simulation, no repeats, rotation clock, seeds, strict offer ids, special vehicle data), highway (the centreline loop and its projection, 4+4 lanes and directions, junction and crossover gaps, belt trees kept off the roads, **guardrails and median stop a car at 70 m/s**, the day/night clock), traffic (a 4-minute simulation: **no two vehicles ever overlap**, every lane change is signalled first, lane speeds fast-left/slow-right, heavy vehicles off the fast lane, yielding, braking for a stopped car), combo tiers, tuning shortens the drag time, daily login streak and playtime rules (next box, reset after a missed day or day 7, saved state, countdowns), nitrous (more torque, past the limiter, on the wire), air ride heights, number plates (registration, text rules), CCTV cameras (placement, sweep, cone), street race routes (on the road grid, poses, grid slots, standings), motorcycles (the Moto & ATV models, the pillion seat, wheelies: no lift below 65 km/h, lift with the throttle, coming down, the brake, a held balance and the flip, the wheelie on the wire), helmets and crash damage (fatal without a helmet from 60 km/h, 60% less with one), weapons (catalogue, car damage stages, ray maths incl. the helicopter cylinder, recoil: pistol straight up, shotgun hard, rifle spray that climbs), police gear (spike placement across the highway carriageway and city streets, none off the road, the strip and tyre hit test, burst tyres: 90% less side grip and less traction, cover under overpasses, the car wash and the Sanayi hall), nothing on the roads (street lamps on the sidewalks, camera poles off the road, highway lights in the median, no collider on a road, lane or ramp) and the highway ramps (smooth S-curve, never steeper than ~27°, guardrail open along them) |
| Integration | Vitest + real server + socket.io-client | `tests/integration` | End-to-end game logic over real WebSockets and a real database: auth, movement, anti speed-hack, market purchase, **race-condition double purchase**, invalid/manipulated requests, request de-duplication, negotiation, classifieds and player-to-player sale, quick sell, chat and anti-spam, dealership purchase and upgrade and display, NPC customer sale, repair/wash/fuel/customization/parts, bank, escrowed auctions, **persistence across a full server restart**, tuning garage (location check, 10 kinds of invalid requests, exact server pricing, workshop lock, prerequisites on removal, tuned server physics, engine wear, free return to stock), Rare Dealer (same stock for everyone and after a service restart, unlocks/funds/price/expired checks, one sale per offer broadcast to others, saved sold slots, legendary announcement), highway (traffic in snapshots, a **real near miss** past a traffic car paying $100, a crash into traffic resetting the combo, horn key accepted / bad keys rejected), drag strip (car/location/funds checks, **false start loses the entry**, a full race against a matched bot with all four lights, times and the pool paid to the winner), lifestyle (the market charges the level discount, the driving bonus pays while driving and not while parked, the 10-near-miss / hold-250 (ECU coupon) / timed sell-2 missions, a police pursuit by two cars that is escaped for 2 × $1,000 and an arrest with the fixed $3,000 fine, impound and respawn), car theft (Black Market, lockpick, Sanayi, Pawn Shop, forged papers), passengers (and partners in crime: a passenger's crime makes the driver just as wanted), rewards (day 1 once a day and saved, streak days 2/6/7 with the legendary car, missed-day reset, playtime counting only active time, milestones once, the 3-hour choice, reconnect, Pawn +50% and rim & paint coupons, Plazma Neon unlock), nitro / air ride / plates, CCTV tracking (lockpick start, camera reset, waiting out of the car, the car becoming yours, seized on arrest), street races (join, grid and hold, checkpoints in order, $20,000 and the police, DNF, nobody joining), motorcycles (a pillion shoots from the back of a moving bike but not from where they got on; the rider only with a pistol, not a shotgun; one seat on the back, a flipped wheelie throws you off and is WASTED without a helmet, Moto Gear sells helmets and visors only at the shop and a helmet takes 60% off), fights (Ammu-Nation cash and VIP Coin prices, ammo use and fire rate, a car shot to an engine blow-out (the gunfire alone calls a patrol: 2 stars), no PvP but 3 stars, pedestrians, officers shooting back, WASTED and the hospital), police gear (3 stars bring a spike strip down the street ahead, driving over it bursts the tyres until the tyres are repaired; the helicopter comes at 3 stars, sees you, loses you under an overpass and is shot down), hitman contracts (only at the contact and one at a time; a hit: the mark walks in the search area and shooting them pays $1,000; a drive-by: shots from a parked car don't count, six from a moving car's passenger pay the driver who took the job) |
| Browser E2E | Playwright (Chromium) | `tests/e2e` | Production build in real Chrome: the 14 required scenarios, driving, the touch controls on an iPad-sized screen, the tuning garage and the Rare Dealer, highway traffic streaming, night, the near-miss/combo HUD and the drag strip panel and Christmas tree, getting in and out with **F** (animated), the cockpit camera (**C**), the gauge and the missions panel (**L**), the theft screens, and the daily reward panel (claiming day 1), gift box countdown, health bar, Ammu-Nation catalogue and the Marketplace sell tab |

## Running

```bash
cd getrich-tycoon
npm install
npm run typecheck          # strict TS: client, server, tests
npm test                   # unit + integration (in-memory SQLite by default)
npm run build              # E2E runs against the production build
npm run test:e2e           # Playwright + Chromium, starts its own server on :3310
npm run test:all           # all of the above
```

### Against PostgreSQL

The integration and E2E suites also run against PostgreSQL. Use a **dedicated empty test database**: the integration
suite drops and recreates the tables.

```bash
createdb getrich_test
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/getrich_test npm run test:integration
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/getrich_test npm run test:e2e
```

### Chromium / GPU

Playwright launches Chromium with `--use-angle=swiftshader` (software WebGL), so the tests also run in containers
without a GPU. With the URL parameter `?gfx=low` the tests use the low graphics preset. Software rendering is slow
(1-5 FPS), which is why the E2E timeouts are generous. With a GPU the game runs at 60 FPS. If Playwright's bundled
Chromium is missing, run `npx playwright install chromium`.

## Required scenarios (tests/e2e/game.spec.ts)

| # | Scenario | Test |
| --- | --- | --- |
| 1 | Server starts | `1. server starts and reports healthy` (`/healthz`) |
| 2 | Client loads | `2-3` checks the page title, login screen, WebGL canvas, HUD and absence of console errors |
| 3 | Player can connect | `2-3` registers through the UI and checks the socket is connected and snapshots are flowing |
| 4 | Player can move | `4-9`: holding **W** moves the server-reconciled position |
| 5 | Marketplace opens | `4-9`: the dock button opens the Marketplace panel |
| 6 | Vehicle can be purchased | `4-9`: clicks **Buy** on the cheapest unlocked listing |
| 7 | Money changes correctly | `4-9`: HUD shows `25,000 − price + first-purchase reward` |
| 8 | Vehicle appears in inventory | `4-9`: Garage panel shows the vehicle card |
| 9 | Vehicle can be listed | `4-9`: **List for sale → Confirm**; status `listed`, $150 fee charged |
| 10 | Second client can connect | `10-12` opens a second browser context |
| 11 | Two clients see each other | `10-12`: each client's world contains the other player |
| 12 | Multiplayer state synchronizes | `10-12`: A walks and B sees A move; A buys and B's market updates; A lists and B sees the listing in the Marketplace UI; chat is delivered |
| 13 | Invalid transaction is rejected | `4-9`: forged RPCs (fake listing, negative deposit, someone else's vehicle, non-numeric price) are all rejected and money is unchanged |
| 14 | Save/load works | `4-9`: page reload restores money and the listed vehicle from the database. The integration suite additionally restarts the whole server. |
| + | Vehicles are drivable | `vehicles are drivable`: garage → spawn → prompt → **E** → hold **W** → exit |
| + | Driving controls | `F gets in and out...`: **F** enters (the boarding animation finishes), the gauge is visible, **C** turns the first-person cockpit pass on and off, **L** shows the three headline missions, no wanted stars, **F** exits |
| + | Tuning & Rare Dealer | `tuning.spec.ts`: garage opened remotely, Stage 2 auto-adds its downpipe and raises the hp figure, install disabled away from Chroma Customs, HEX paint input syncs the colour picker, wheels, locked stance on stock suspension, dyno chart and a live dyno pull; Rare Dealer countdown ticking, 6 offers with pictures, buying the cheapest affordable offer marks it sold. |
| + | Highway & drag strip | `highway.spec.ts`: traffic streams in, night can fall, the near-miss popup ("NEAR MISS · MAKAS +$200") and combo meter, a crash popup, the drag panel asking for a car, the Christmas tree lamps (reds, green, foul) and the horn key. |
| + | Passengers | `tests/integration/passengers.test.ts`: a second player gets into a car someone else drives (too far / own car / moving car refused), both see it in the snapshots, the passenger moves with the car and can't steer it, gets out on the right-hand side; the seats fill up (then "full"), and when the driver gets out everyone is let out. |
| + | Car theft | `theft.spec.ts`: parked cars are drawn, the Black Market tab shows the stock and countdown and sells a set (in the garage afterwards, also reachable from the Esc menu), the lockpick screen draws and closes when the server refuses a lock, the Pawn Shop with nothing to sell. The whole loop (lockpick success and failure with the alarm and 2 stars, lift, stripping every part, scrapping, selling) runs against a real server in `tests/integration/theft.test.ts`; lock maths, prices, parts per car, the restock clock, lift bays and the layout are unit-tested in `tests/unit/theft.test.ts`. |
| + | iPad / touch | `touch.spec.ts` (1180×820, touch enabled): the stick walks, a finger drag turns the camera, dock/panel taps, chat via the dock and **Send** button, entering a car with the **E** button, driving with the stick, exiting by tapping the prompt. Real touch events are sent through the Chrome DevTools Protocol. |

The **two-client multiplayer test** (`10-12`) is the critical one:

1. Client A connects, enters the world and moves.
2. Client B connects and sees A.
3. A buys a vehicle, and B observes the listing vanishing from the market.
4. A lists the vehicle, and B finds it in the player listings.

## Results from the build environment

Recorded on 2026-10-02 (Ubuntu 24.04, Node 22.22, Playwright 1.56 headless Chromium via SwiftShader, PostgreSQL 16).

| Suite | SQLite | PostgreSQL |
| --- | --- | --- |
| `npm run typecheck` (client, server, tests) | pass | n/a |
| Unit (Vitest) | 212 / 212 passed | n/a (no database) |
| Integration (Vitest, real sockets) | 76 / 76 passed | 76 / 76 passed |
| E2E (Playwright, Chromium, production build) | 11 / 11 passed (about 10 min; the tuning and touch specs re-run after making them pick a car, not a motorcycle) | 5 / 5 passed (2026-09-28; before the touch, tuning, highway, driving-controls, theft and features tests) |
| `npm run check:secrets` | no secrets in 305 tracked files | n/a |

Under SwiftShader the game renders at 1-2 FPS, and the client caps a frame at 0.1 s of simulated time, so the game runs
several times slower than real time there. With real acceleration a worn starter car needs a few seconds of simulated time
to move, so the driving checks keep the throttle (or the touch stick) held until the car has moved, and back out if it was
parked nose-up to a bench. Animations that must match the server (getting in and out, the arrest cutscene) run on the real
clock.

Note on flakiness: an early flake in the two-client test came from picking a listing the level-1 test account was
not allowed to buy (category lock). The test now filters to unlocked categories. The main source of slowness is
software rendering. The tests use generous polls rather than fixed sleeps wherever possible.
Two theft-era flakes were fixed: the drag race money check now counts a "Christmas Tree" mission reward when that mission
happens to be in the player's daily set, and the Sanayi test no longer asks an electric car for its exhaust. The tuning
e2e test now picks an untuned market car and expects the car's own power figure (NPC cars sometimes come pre-tuned).
Two more time/random-dependent cases were made deterministic: the customization charge test now starts from stock mods
(NPC cars sometimes come with custom paint or wheels), and the Rare Dealer tests wait for a fresh 120-second rotation
instead of starting in its last seconds.
With the highway, the second page of the two-client test needs up to about two minutes to start under SwiftShader (the
previous build already took over a minute measured the same way): two pages share one software GPU. The login wait and
that test's timeout allow for it; with a real GPU a page starts in a few seconds.

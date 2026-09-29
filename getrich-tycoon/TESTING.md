# Testing

Three layers, all automated:

| Layer | Tool | Location | What it proves |
| --- | --- | --- | --- |
| Unit | Vitest | `tests/unit` | Valuation, repair pricing, negotiation (randomized), physics (determinism, collisions, anti-teleport), progression, economy invariants (arbitrage-free), locks, rate limits, validators, password hashing, client IP resolution behind proxies, touch joystick mapping, procedural vehicle models (every model builds, matches its collision size, has head and tail lamps, stays within a triangle budget) |
| Integration | Vitest + real server + socket.io-client | `tests/integration` | End-to-end game logic over real WebSockets and a real database: auth, movement, anti speed-hack, market purchase, **race-condition double purchase**, invalid/manipulated requests, request de-duplication, negotiation, classifieds and player-to-player sale, quick sell, chat and anti-spam, dealership purchase and upgrade and display, NPC customer sale, repair/wash/fuel/customization/parts, bank, escrowed auctions, **persistence across a full server restart** |
| Browser E2E | Playwright (Chromium) | `tests/e2e` | Production build in real Chrome: the 14 required scenarios, driving, and the touch controls on an iPad-sized screen |

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
| + | iPad / touch | `touch.spec.ts` (1180×820, touch enabled): the stick walks, a finger drag turns the camera, dock/panel taps, chat via the dock and **Send** button, entering a car with the **E** button, driving with the stick, exiting by tapping the prompt. Real touch events are sent through the Chrome DevTools Protocol. |

The **two-client multiplayer test** (`10-12`) is the critical one:

1. Client A connects, enters the world and moves.
2. Client B connects and sees A.
3. A buys a vehicle, and B observes the listing vanishing from the market.
4. A lists the vehicle, and B finds it in the player listings.

## Results from the build environment

Recorded on 2026-09-29 (Ubuntu 24.04, Node 22.22, Playwright 1.56 headless Chromium via SwiftShader, PostgreSQL 16.13):

| Suite | SQLite | PostgreSQL |
| --- | --- | --- |
| `npm run typecheck` (client, server, tests) | pass | n/a |
| Unit (Vitest) | 76 / 76 passed | n/a (no database) |
| Integration (Vitest, real sockets) | 20 / 20 passed | 20 / 20 passed (2026-09-28) |
| E2E (Playwright, Chromium, production build) | 6 / 6 passed (about 6 min) | 5 / 5 passed (2026-09-28, about 2.7 min; before the touch test was added) |
| `npm run check:secrets` | no secrets in 126 tracked files | n/a |

Note on flakiness: an early flake in the two-client test came from picking a listing the level-1 test account was
not allowed to buy (category lock). The test now filters to unlocked categories. The main source of slowness is
software rendering. The tests use generous polls rather than fixed sleeps wherever possible.

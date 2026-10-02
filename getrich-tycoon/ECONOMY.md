# Economy

All numbers live in [`shared/economy.config.ts`](shared/economy.config.ts). The server uses them for every
authoritative calculation. The client uses the same file only to show previews (repair quotes, value estimates,
deal badges). Change a value there and both sides pick it up.

## Core loop

```
$25,000 start → buy a worn car at the market (or auction) → negotiate the price down
             → repair / wash / customize (value rises faster than cost when done well)
             → sell: dealership display (NPC customers, even offline), classifieds, auction, players, or wholesaler
             → buy a dealership plot ($12,000) → upgrade (more slots, more customers, price premium, repair bay)
             → level up → unlock SUVs/trucks (lvl 2), classics (3), sports (4), luxury (6) → bigger margins
```

## Vehicle value

```
base  = basePrice × demand[category] × rarityFactor × conditionFactor × mileageFactor
value = base × (1 + tuning bonus) + classic mods bonus
```

| Factor | Formula / range |
| --- | --- |
| `conditionFactor` | `0.2 + 0.8 × (overall/100)^1.3`. Overall is weighted: engine 24%, body 20%, transmission 14%, interior 12%, brakes 10%, tires 10%, cleanliness 10%. |
| `mileageFactor` | `max(0.35, 1 − km/300,000 × 0.6)`. Classics depreciate with mileage at 40% of that rate. |
| `rarityFactor` | `1 + (rarity − 1) × 0.1`, a small collector premium. |
| `demand` | Per category, drifts ±3.5% every 90 s with 8% mean reversion, clamped to [0.85, 1.20]. |
| tuning bonus | Sum of the installed parts' `value` shares (see "Tuning" below), capped at +100%: a car is worth at most 2× stock. |
| classic mods bonus | Tint, headlights, accessories and older one-click options: `min(12% of value, 60% of their catalogue price)`. |

The curve is convex, so damage hurts progressively. Restoring a car from 80% to 100% gains more value per dollar
than going from 0% to 20%. That makes "which car to fix" a real decision.

Real outputs of the formulas (demand 1.0, repair all parts plus deluxe wash):

| Vehicle | State | Value | Full repair | Value after |
| --- | --- | --- | --- | --- |
| Norda Arlo (sedan, base $16k) | 40%, 120k km | $5,388 | $4,772 | $12,160 |
| Norda Pixi (compact, $9.5k) | 30%, 150k km | $2,442 | $3,306 | $6,650 |
| Apexon Strix (sports, $58k) | 55%, 60k km | $29,848 | $12,973 | $52,571 |
| Solenne Monarch (luxury, $142k) | 70%, 30k km | $102,307 | $21,173 | $145,493 |

Cheap cars give thin margins, and expensive cars need capital and levels. That is the progression curve.

## Buying

- **NPC sellers:** 16 listings in the Used Vehicle Market lot, replaced as they sell or expire (6-20 min).
  Condition 12-96%, mileage 4k-260k km, category weights favour compacts and sedans.
- **Negotiation** is driven by personality data:

  | Personality | Asking (× value) | Hidden minimum (× value) | Patience | Flexibility |
  | --- | --- | --- | --- | --- |
  | Friendly | 0.98-1.12 | 0.84-0.92 | 5 | 0.45 |
  | Stubborn | 1.05-1.20 | 0.93-1.00 | 3 | 0.20 |
  | Desperate | 0.90-1.02 | 0.76-0.84 | 6 | 0.60 |
  | Shrewd | 1.02-1.16 | 0.88-0.96 | 4 | 0.30 |
  | Collector | 1.10-1.25 | 0.97-1.05 | 3 | 0.15 |

  - Each offer costs patience; offers far below the minimum ("insults") cost double.
  - The counter-offer moves toward your offer by the flexibility factor and never below the hidden minimum.
  - When patience runs out, the seller stops negotiating and the **full asking price** stands. Sessions persist for 5 minutes per player, so walking away and coming back doesn't reset patience.
- **Category unlocks:** compact/sedan/utility at level 1, SUV/truck 2, classic 3, sports 4, luxury 6.

## Services

| Service | Price |
| --- | --- |
| Repair | Per point: `max(minPerPoint, basePrice × rate)`. Rates: engine 0.13%, body 0.11%, transmission 0.078%, interior 0.067%, brakes/tires 0.056% of base price. Restoring every part from 0 to 100 costs about 50% of the base price. 55% of the cost is labour. |
| Parts kits | $260-900 at the Parts Depot. Each kit removes the parts share of one job, up to 3× the kit price. |
| Repair bay | Owning a level 4+ dealership gives 25-35% off labour at your own lot. |
| Repair time | 0.12 s per point, 3-25 s. The car is locked while in the shop. |
| Wash | Express $45 (to 80% clean) or Deluxe $140 (100% clean, +6 interior). Dirt builds up at 1.2 points per game km. |
| Fuel | $2.20 per % of tank. Cars use 1.6% per game km (1 world metre = 0.004 game km). |
| Customization | Tint, headlights, accessories: $0-900 per option. |
| Tuning | See "Tuning" below. Fitting takes 3-40 s of workshop time; the car is locked meanwhile. Back to stock is free. |

Money spent on repairs, washes and mods is added to the car's cost basis, so the profit stats reflect true margins.

## Tuning

All parts are data in `shared/modificationsData.ts`; `shared/tuningSystem.ts` turns them into figures with
`calculateVehicleStats(baseCar, installedMods)`.

- **Power:** `hp = stock × (1 + ECU stage) × induction × (1 + Σ bolt-ons)`, capped at 2× stock. Stages: +15/+30/+60% hp and
  +10/+20/+40% top speed. Turbo and supercharger kits give +28-45% over a naturally aspirated engine; on a factory
  turbo engine they only add the difference (at least +6%). Top speed is capped at +45%.
- **0-100 km/h:** scales with power-to-weight (`^0.7`), launch traction (hp per tonne the driven wheels can use: FWD 170,
  RWD 225, AWD 430, more with semi-slicks/slicks) and acceleration bonuses (intake +5%, supercharger +4%...).
- **Handling / braking:** suspension +12% / +25%, tyres, brakes, wings; a little camber (up to 2.5°) and drop (up to 5 cm)
  help, extreme stance costs grip and braking.
- **Heat soak:** forced induction without an intercooler loses power pull after pull (kits: 86% on the 3rd pull).
- **Engine stress:** tunes multiply engine wear while driving (`0.12 × (stress − 1)` condition points per game km);
  forged internals (×0.55) keep it in check.
- **Physics:** the drivetrain simulation (`shared/drivetrain.ts`) runs on the tuned engine (torque curve, boost, redline),
  gearbox, tyres, aero and brakes, on the server and for client prediction alike; the shown 0-100 / 0-200 / 0-300, quarter
  mile and 100-0 braking figures are simulated from the same model.

**Prices and value.** `price = base + basePrice × max(rate, value × 1.25)`. So a part always costs more than it adds to the
resale value, even with maximum demand and rarity (at an auction: 0.93 × 0.93 of value; wholesaler: 0.68). A unit test
checks this for every part, paint finish and wheel on every model. Examples on a $16k Norda Arlo: Stage 1 $1,650,
Stage 2 $3,700, Stage 3 $8,000, coilovers $2,900, chameleon paint $5,200. A full Stage 3 build adds about +85% of value
(150-200% of stock, as designed).

## Rare Dealer

- Stock of 6 offers, replaced every 120 s (`epoch = floor(serverTime / 120 s)`), the same for all players. Offers are generated
  from a server secret and the epoch, so they survive restarts and can't be predicted. Sold offers are saved with the purchase.
- Odds per offer: common 40% + uncommon 30% = **70%**, rare 17% + epic 8% = **25%**, legendary **5%**. A legendary offer picks
  one of the 10 legendary models weighted by its `dropChance` (5% each), so each legendary model shows up in about 3% of
  rotations (never more than 5%, checked by simulation). Rare+ models don't repeat within a rotation.
- Prices: 0.94-1.10 × value (legendary 1.00-1.08 × value; a new legendary is worth its list price), always above what an
  auction or the wholesaler pays. 25% of non-legendary offers come with a performance package. Category unlocks still apply.

## Highway near misses

- A near miss is a pass (overtaking, or being overtaken) with less than **0.5 m** between the two bodies (oriented boxes of the
  real outlines; a semi is a tractor box and a trailer box), no contact, at 150 km/h or more on the speedometer. Under 0.2 m it
  is a hair's-breadth pass paying x1.5. Each traffic vehicle counts once per 4 s.
- Pays **$100 and 5 XP** times the combo multiplier: x1 for the first two, **x2** from the 3rd, **x3** from the 6th, **x5**
  from the 10th near miss in a row. The combo ends 6 s after the last near miss, or at once on a crash (an impact over 3 m/s
  or touching traffic).
- Cash is paid in one transaction per second (`near_miss`). It is capped at **$75,000 per rolling hour** per player (XP keeps
  counting), so the highway is a fun side income rather than a replacement for trading. Values are in
  `ECONOMY.highway`.

## Drag strip

- Entry **$250** per racer (`drag_entry`), taken when the race starts. The winner receives the **$500** pool (`drag_win`) and
  40 XP; the loser gets 10 XP. Against a bot the house covers the bot's entry.
- A false start, leaving your lane, leaving the car or not finishing within 30 s loses. A dead heat refunds both entries.
- The bot is matched to your car (simulated eighth-mile time within about 4.5%), so racing bots is roughly a coin flip that a
  better build and a quicker reaction tip your way. Values are in `ECONOMY.drag`.

## Driving bonus

- Every 10 s of real driving (average above 20 km/h) pays `50 × (value / $50k) ^ 1.086` (`drive_bonus`): $50 for a $50k
  car, about $350 for a $300k G 63 or M8, $1 minimum. Parked cars, idling and creeping earn nothing. Values are in
  `ECONOMY.driving`.

## Missions

- A daily set per player (new at 00:00 UTC, `ECONOMY.missions.dailyCount` = 5): the three headline missions plus two picked
  for the player from the pool. Rewards are paid automatically (`mission`), saved before they are paid.

| Mission | Goal | Reward |
| --- | --- | --- |
| Clean Sweep | 10 near misses on the highway without crashing | $2,500 |
| Flat Out | Hold 250 km/h for 5 s | Stage 1 ECU coupon (the next Stage 1 remap is free) |
| Rush Sale | Sell 2 vehicles within 120 s of pressing Start (5 min cooldown after running out of time) | $5,000 + 100 XP |
| Road Trip | Drive 20 km | $1,000 + 30 XP |
| Getaway Driver | Escape a police pursuit | $2,000 + 60 XP |
| Christmas Tree | Win a drag race | $1,500 + 40 XP |
| Hair-Raiser | 5 near misses above 200 km/h | $2,000 + 50 XP |
| Unstoppable | A combo of 20 near misses | $6,000 + 120 XP |

## Police

- Heat: +40 per near miss above 180 km/h, +90 per crash into traffic, +150 for ramming a police car (max 500); any gunshot
  raises it to at least 150 (2 stars: the shot is heard and the nearest patrol comes, witnesses or not,
  `ECONOMY.combat.heatGunshot`); it cools after 30 s without offences. Stars = heat / 100 rounded up (1-5).
- **Shared wanted level:** heat from anyone in a car (driver or passenger) goes to everyone in that car.
- From 2 stars police cars chase you (1-4 units by stars). Keep every unit 90 m away for 30 s: **escape**, **$1,000 for each
  police car that took part in the chase** (`police_escape`) and 60 XP.
- Stopped (under 15 km/h) with a police car within 2.5 m for 3 s: **arrest**. Fine: always **$3,000** (`ECONOMY.police.fine`),
  from the cash first, then the bank (never below zero) (`police_fine`); "POLİSE YAKALANDIN! - $3,000 Ceza Ödendi"; the car is
  towed to the garage (no fee); you respawn at the nearest garage. Values are in `ECONOMY.police`.

## Car theft

All values are in `ECONOMY.theft`.

- **Black Market:** Lockpick & Testere Seti, $2,500 (`black_market`). One stock of 5 for the whole city, full again at the start
  of every 10-minute window of the server clock (the count survives restarts in `world_state`).
- **Lockpick:** starting on a car uses one set (3 picks). Each turn either opens the lock (pick within the sweet spot's
  tolerance: 14° on cars under $20k, 11° under $60k, 9° under $150k, 7° above) or snaps a pick. A snapped pick tells which
  way the sweet spot is and how far (under 15°, 15-30°, 30-50° or more), drawn as a green zone and an arrow on the dial,
  so a careful player opens most locks with the second pick. Three snapped picks: the alarm sounds for 30 s and the
  player's heat rises to at least 180 (**2 stars**). 90 s to finish; walking away loses the set. +25 XP per car.
- **Street cars:** 12 at city kerbs and 4 on the highway shoulder, generated like NPC cars (no motorcycles or exclusives); a
  new one parks 2 minutes after one is taken.
- **Stolen cars** (`stolen`): drivable, never stored, sold, listed, displayed or counted in net worth or garage slots. Busted in
  one: the car is seized. Left alone for 10 minutes: recovered by the police. Left on a lift for 30 minutes: scrapped.
- **Sanayi:** 2 lifts. Parts and work time: side mirrors 2.5 s, doors 5 s, steering wheel 3 s, seats 4 s, exhaust & catalytic
  converter 4 s (not on electric cars), and from the engine bay: engine block 8 s, gearbox 6 s, turbo / supercharger 4 s
  (forced-induction engines only), ECU 2.5 s, radiator 3 s, alternator 3 s (not on electric cars), battery 2 s. +5 XP per part;
  the server times every job. When the last part is off the shell is scrapped.
- **Pawn Shop** (`pawn_sale`): all the parts of one car together fetch **$25,000 per car** (araç başı). Each part fetches
  its share of that, by weight: engine block 1, gearbox 0.85, exhaust 0.8, turbo 0.75, ECU 0.55, doors 0.45, seats 0.4,
  steering wheel and radiator 0.3, alternator 0.25, battery 0.2, mirrors 0.15 (a car without an exhaust, alternator or
  turbo shares the $25,000 among the parts it has). Selling a car's parts one by one adds up to the same. Net of the $2,500
  set, a car is worth $22,500 for a few minutes' work and the risk of the police. To make the price vary with the car's
  value and luck, set `pawnMin` below `pawnMax` (`min + (max - min) × (car value tier × 0.15 + luck × 0.55)`).

- **Forged papers** (`papers`): a complete stolen car parked in the Sanayi yard, papered at the Sanayi office for 15% of its
  market value (at least $3,000), becomes an ordinary owned car (it needs a free garage slot).

## Stolen-car tracking (CCTV)

`ECONOMY.pursuit`. Picking a lock, or driving a stolen car into the cone of one of the ten CCTV cameras (34 m, ±20°), starts a
3-minute countdown and raises the heat to 150 (2 stars). A camera or a police car within 70 m seeing the car starts the
countdown over; it waits while the thief is out of the car. When it runs out the car becomes the thief's own (+60 XP; a
full garage leaves it stolen). An arrest seizes it.

## Daily login and playtime rewards

`shared/rewards.ts`, `ECONOMY.rewards`; one row per player in `player_rewards`, paid in the same transaction as the claim.

| Day | Reward |
| --- | --- |
| 1 | $5,000 |
| 2 | Lockpick & Testere Seti |
| 3 | $15,000 |
| 4 | Stage 1 ECU coupon |
| 5 | $30,000 |
| 6 | 3 sets + 3 Special Nitro |
| 7 | A legendary car (Rare Dealer pool, condition 92-100, in the garage) + $50,000 + 10 VIP Coins |

A box can be claimed once per day (UTC, like the missions); claiming it the day after the last one continues the streak,
otherwise it starts over at day 1, and after day 7 it starts over too. Playtime counts only while the player is active (a
key, the camera or a menu in the last 2 minutes, or riding in a moving car), at most 3 hours a day:

| Active time | Reward |
| --- | --- |
| 15 min | $2,500 |
| 30 min | Lockpick & Testere Seti |
| 1 h | $15,000 + 200 XP |
| 2 h | $35,000 + Plazma Neon (underglow unlock) |
| 3 h | $100,000 + 5 VIP Coins + Pawn Shop +50% coupon **or** rims & paint coupon |

Over a full week of maximum play a player earns about $1.5M from rewards; a 7-day streak alone is $100,000 and a car.

## Street races

`ECONOMY.streetRace`: one every 7 minutes (75 s to join, 4 s countdown, 4 minutes to finish), up to 6 players plus bots to
make 4 cars. The winner gets $20,000 (`race`) and 150 XP, other finishers 60 XP. Every racer still out there 8 s after the
green light gets 150 heat (2 stars).

## Guns and fights

`shared/weapons.ts`, `ECONOMY.combat`. Prices: Pistol $5,000, Pump Shotgun $18,000, AK-47 / M4 $45,000 (`weapon`), each with
24 rounds; Golden Desert Eagle 20, Laser-Guided RPG 35, Minigun 45 VIP Coins. Ammo boxes $400-$2,500. Heat: shots near
witnesses 100, hitting a person 300 (3 stars), a police officer or car 400. From 3 stars up to two officers per nearby
stopped police car get out and shoot (5-9 damage, less accurate at range and at a moving car). Players have 100 HP, regain
3 HP/s after 8 s without a hit, and the hospital patches them up for $500 (`hospital`). WASTED: lockpick sets, stripped
parts and stolen cars are lost, the wanted level is cleared, no fine. Cars have 100 body HP; at zero the engine blows (an
owned car's engine and body drop to 0 until repaired).

## Reputation unlocks (by level)

| Unlock | Rule |
| --- | --- |
| Garage slots | 30, +2 every 3 levels, max 64 |
| Cars out on the street | 2, 3 from level 8, 4 from level 18 |
| Used Vehicle Market discount | 2% at level 5, 4% at 10, 7% at 20, 10% at 30 |
| Underglow neon | Level 5 (rainbow cycle at level 15), at Chroma Customs |

## Selling

| Channel | Price | Fee | Notes |
| --- | --- | --- | --- |
| Dealership display | You set it (0.68-2.5 × value) | 5% commission | NPC customers visit about every 45 s ÷ (level traffic × reputation factor). Offline owners get 40% of the traffic. |
| Classifieds | You set it (0.68-2.5 × value) | $150 listing + 5% | A remote buyer checks each listing every 60 s (18% chance × reputation). |
| Auction | Highest bid | $250 + 7% | NPC bidders bid up to 70-93% of value. |
| Players | Agreed price | 5% | Other players (level 3+) buy your listings directly. Earns money, not XP. |
| Wholesaler (quick sell) | 68% of value | none | Instant liquidity. |

**NPC customers** come in 7 archetypes (student, family, tradesperson, enthusiast, executive, collector, bargain hunter).
Each has preferred categories, a budget, a minimum condition, a maximum mileage and a willingness to pay of 0.82-1.20 × value.
Willingness is modified by:

- +0 to 7% dealership-level premium;
- ±5% reputation;
- −8% if the car is outside the customer's preferred categories.

A customer buys if `price ≤ min(budget, value × willingness × modifiers)`. If the price is up to 15% too high, they may make an offer, which an online owner can accept or decline within 30 s.

**Reputation (0-100, start 50):**

| Event | Change |
| --- | --- |
| Sale at or below market value | +1 |
| Sale above 1.12 × value | −2 |
| Selling a wreck (average condition < 35) to a customer | −1 |

Reputation changes customer traffic by ±30% and willingness by ±5%.

## Dealership levels

| Lvl | Name | Price | Slots | Player level | Traffic | Premium | Repair bay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Small Lot | $12,000 | 4 | 1 | ×1.00 | 0% | none |
| 2 | Expanded Lot | $30,000 | 6 | 3 | ×1.15 | 1% | none |
| 3 | Showroom | $65,000 | 8 | 5 | ×1.30 | 2% | none |
| 4 | Showroom + Repair Bay | $110,000 | 8 | 7 | ×1.40 | 3% | −25% labour |
| 5 | Luxury Showroom | $190,000 | 10 | 10 | ×1.60 | 5% | −25% labour |
| 6 | Mega Dealership | $320,000 | 12 | 14 | ×1.85 | 7% | −35% labour |

## Progression

- **XP:**
  - market buy 15, sale 25 + 1 per $100 profit (max 500);
  - repair 8 per part, wash 4, customization 6 per option;
  - auction win or sale 30, negotiation win 10, dealership purchase or upgrade 100.
- **Levels:** XP to the next level is `120 × level^1.45`, up to level 50.
- **Achievements:** 17, each with a cash reward ($250 to $25,000).

## Bank

Cash is used for all purchases. Savings earn 0.4% every 10 minutes, capped at $2,500 per payout. Offline time is paid on login, capped at 24 payouts (4 hours).

## Anti-exploit rules

- **No arbitrage.** The wholesaler pays 68% of value, below the lowest possible seller minimum (76%). A unit test checks this on 500 random vehicles.
  Tuning parts always cost more than the value they add, and Rare Dealer prices start above auction and wholesale payouts (unit tests).
- **Alternate-account farming is limited:**
  - Asking prices must be between the wholesale price (0.68 × value) and 2.5 × value, and auction bids are capped at 2.5 × value.
  - Auction starting bids must be within 50-150% of value.
  - Every player-to-player sale pays a 5% commission.
  - Buying from other players, or bidding on their auctions, requires player level 3.
  - Sales to other players earn money only: no XP, reputation, profit stats or sales achievements. Trading a car back and forth therefore can't farm progression.
  - New accounts are rate-limited per IP and globally.
- **All prices are recomputed on the server.** Clients send `expectedPrice`, and a mismatch is rejected ("price changed"), so a client can never choose a price.
- **Escrowed auctions.** Bids are debited immediately and refunded when outbid, so a winner always has the money.
- **Negotiation state is server-side** and the minimum price is hidden. The counter never goes below the minimum, never rises, and never exceeds the asking price (randomized unit test).
- **Bounded time budgets.** Movement, repairs and wash timers use server clocks only.

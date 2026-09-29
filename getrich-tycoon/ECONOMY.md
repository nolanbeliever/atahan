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
- **Physics:** the game-scale physics (`vehicleParams`) is scaled by the same ratios as the real figures, on the server and
  for client prediction alike.

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

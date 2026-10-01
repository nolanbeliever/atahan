// ============================================================================
//  GetRich Tycoon - central economy configuration
// ----------------------------------------------------------------------------
//  Every price, fee, multiplier and probability used by the game lives here.
//  The server reads these values to validate/perform transactions; the client
//  reads them only to display estimates. Tweak values here, never inline.
//  See ECONOMY.md for the reasoning behind the numbers.
// ============================================================================

import type { RepairPart, SellerPersonalityId, VehicleCategory } from './types';
import type { RarityTier } from './vehicles';

export interface DealershipLevelConfig {
  level: number;
  name: string;
  /** Price to buy (level 1) or upgrade to this level. */
  price: number;
  /** Number of display slots. */
  slots: number;
  minPlayerLevel: number;
  /** Multiplier on NPC customer arrival rate. */
  customerRate: number;
  /** Extra willingness-to-pay for customers visiting this dealership (fraction of value). */
  premium: number;
  /** Discount on repairs (repair bay) as a fraction of labour cost. */
  repairDiscount: number;
}

export interface SellerPersonalityConfig {
  id: SellerPersonalityId;
  label: string;
  weight: number;
  /** Asking price range as fraction of market value. */
  askRange: [number, number];
  /** Minimum acceptable price range as fraction of market value. */
  minRange: [number, number];
  /** Number of offers they tolerate before getting annoyed. */
  patience: number;
  /** How far toward the player's offer the seller moves each round (0-1). */
  flexibility: number;
  /** Offers below this fraction of min price insult the seller (lose extra patience). */
  insultThreshold: number;
  lines: { greet: string; counter: string; accept: string; reject: string; insulted: string };
}

export interface CustomerArchetypeConfig {
  id: string;
  label: string;
  weight: number;
  categories: VehicleCategory[];
  /** Budget range in dollars. */
  budget: [number, number];
  /** Minimum average condition (0-100) they will consider. */
  minCondition: number;
  /** Maximum mileage (km) they will consider. */
  maxMileage: number;
  /** Willingness to pay as a fraction of market value. */
  willingness: [number, number];
  /** Chance (0-1) that they make an offer instead of walking away when price is too high. */
  negotiateChance: number;
}

export const ECONOMY = {
  version: 1,
  currencySymbol: '$',

  player: {
    startingMoney: 25_000,
    startingBank: 0,
    startingReputation: 50,
    maxOwnedVehicles: 30,
    maxMoney: 9_000_000_000,
  },

  levels: {
    maxLevel: 50,
    /** XP needed to go from level n to n+1 = base * n ^ exponent */
    xpBase: 120,
    xpExponent: 1.45,
  },

  /** Player level needed to buy each category. */
  categoryUnlockLevel: {
    compact: 1,
    sedan: 1,
    utility: 1,
    suv: 2,
    truck: 2,
    classic: 3,
    sports: 4,
    luxury: 6,
  } satisfies Record<VehicleCategory, number>,

  xp: {
    marketBuy: 15,
    playerBuy: 10,
    sale: 25,
    /** Extra XP per $100 of profit on a sale, capped. */
    profitPer100: 1,
    maxProfitXp: 500,
    repairPerPart: 8,
    wash: 4,
    customize: 6,
    auctionWin: 30,
    auctionSale: 30,
    dealershipUpgrade: 100,
    negotiationWin: 10,
  },

  reputation: {
    min: 0,
    max: 100,
    /** Selling at or below market value builds reputation. */
    fairSaleBonus: 1,
    /** Selling far above market value (ratio above threshold) costs reputation. */
    overpricedThreshold: 1.12,
    overpricedPenalty: 2,
    /** Selling a vehicle in poor shape (avg condition below) to a customer costs reputation. */
    poorConditionThreshold: 35,
    poorConditionPenalty: 1,
  },

  valuation: {
    /** Weights of each condition part in the overall condition score (sum = 1 with cleanliness). */
    conditionWeights: {
      engine: 0.24,
      transmission: 0.14,
      brakes: 0.1,
      tires: 0.1,
      body: 0.2,
      interior: 0.12,
    } satisfies Record<RepairPart, number>,
    cleanlinessWeight: 0.1,
    /** Value factor of a vehicle with 0 condition (scrap value). */
    conditionFloor: 0.2,
    /** Curve exponent: >1 means damage hurts value progressively. */
    conditionCurve: 1.3,
    /** Mileage depreciation: factor = max(floor, 1 - mileage / refKm * depreciation). */
    mileageRefKm: 300_000,
    mileageDepreciation: 0.6,
    mileageFloor: 0.35,
    /** Classics depreciate less with mileage. */
    classicMileageMultiplier: 0.4,
    /** Rarity adds a small collector premium: factor = 1 + (rarity - 1) * rarityValueScale. */
    rarityValueScale: 0.1,
    /** Maximum total value bonus from modifications (fraction). */
    maxModsBonus: 0.12,
  },

  demand: {
    /** Category demand multipliers drift inside [min, max]. */
    min: 0.85,
    max: 1.2,
    /** Max change per update step. */
    volatility: 0.035,
    /** Pull back toward 1.0 each step (mean reversion). */
    meanReversion: 0.08,
    updateIntervalSec: 90,
  },

  marketplace: {
    /** Concurrent NPC listings (the market lot has this many parking slots). */
    npcListingCount: 16,
    listingLifetimeSec: [360, 1200] as [number, number],
    refreshIntervalSec: 10,
    /** Condition range for freshly generated NPC vehicles. */
    conditionRange: [12, 96] as [number, number],
    /** Mileage range (km). */
    mileageRange: [4_000, 260_000] as [number, number],
    /** Relative spawn weights of categories on the market (multiplied by model rarity). */
    categoryWeights: {
      compact: 18,
      sedan: 18,
      utility: 12,
      suv: 12,
      truck: 10,
      classic: 6,
      sports: 8,
      luxury: 5,
    } satisfies Record<VehicleCategory, number>,
    /** Negotiation session lifetime (seconds). */
    negotiationTtlSec: 300,
  },

  sellerPersonalities: [
    {
      id: 'friendly',
      label: 'Friendly',
      weight: 30,
      askRange: [0.98, 1.12],
      minRange: [0.84, 0.92],
      patience: 5,
      flexibility: 0.45,
      insultThreshold: 0.7,
      lines: {
        greet: "Hey there! She's a good one, take a look around.",
        counter: 'I like you. How about we meet somewhere in the middle?',
        accept: "Deal! Treat her well, okay?",
        reject: "Sorry friend, I can't go that low.",
        insulted: "Ouch. Come on, that's not a serious offer.",
      },
    },
    {
      id: 'stubborn',
      label: 'Stubborn',
      weight: 20,
      askRange: [1.05, 1.2],
      minRange: [0.93, 1.0],
      patience: 3,
      flexibility: 0.2,
      insultThreshold: 0.85,
      lines: {
        greet: 'Price is on the windshield. I know what I have.',
        counter: "I'll shave off a little. That's it.",
        accept: 'Fine. Sold.',
        reject: 'No. Not happening.',
        insulted: "Are you wasting my time? Leave.",
      },
    },
    {
      id: 'desperate',
      label: 'Desperate',
      weight: 15,
      askRange: [0.9, 1.02],
      minRange: [0.76, 0.84],
      patience: 6,
      flexibility: 0.6,
      insultThreshold: 0.6,
      lines: {
        greet: 'I really need to sell this quickly... make me an offer?',
        counter: 'Please, I can do this... is that okay?',
        accept: 'Oh thank you! It is yours.',
        reject: "I... I can't, I'd lose too much.",
        insulted: "That's... that's way too low, sorry.",
      },
    },
    {
      id: 'shrewd',
      label: 'Shrewd',
      weight: 25,
      askRange: [1.02, 1.16],
      minRange: [0.88, 0.96],
      patience: 4,
      flexibility: 0.3,
      insultThreshold: 0.8,
      lines: {
        greet: 'Market is hot right now. This one will not last.',
        counter: 'I can work with you, but you have to work with me.',
        accept: 'You drive a hard bargain. Deal.',
        reject: "We're too far apart. Try again.",
        insulted: "You're not the only buyer, you know.",
      },
    },
    {
      id: 'collector',
      label: 'Collector',
      weight: 10,
      askRange: [1.1, 1.25],
      minRange: [0.97, 1.05],
      patience: 3,
      flexibility: 0.15,
      insultThreshold: 0.9,
      lines: {
        greet: 'A piece of history. Only serious buyers, please.',
        counter: 'For a true enthusiast, perhaps a small concession.',
        accept: 'I trust you will appreciate her.',
        reject: 'I would rather keep her.',
        insulted: 'This is an insult to the craftsmanship.',
      },
    },
  ] as SellerPersonalityConfig[],

  fees: {
    /** Flat fee to put a vehicle on the online classifieds. */
    classifiedListingFee: 150,
    /** Commission taken from the seller on player-to-player and customer sales. */
    saleFeeRate: 0.05,
    /** Instant sale to a wholesaler pays this fraction of market value. */
    quickSellRate: 0.68,
    /** Auction consignment fee (flat) + commission. */
    auctionListingFee: 250,
    auctionFeeRate: 0.07,
  },

  repair: {
    /** Cost per condition point as a fraction of the model's base price. */
    costPerPointRate: {
      engine: 0.0013,
      transmission: 0.00078,
      brakes: 0.00056,
      tires: 0.00056,
      body: 0.0011,
      interior: 0.00067,
    } satisfies Record<RepairPart, number>,
    /** Minimum cost per point (cheap cars still cost something to fix). */
    minCostPerPoint: {
      engine: 10,
      transmission: 7,
      brakes: 5,
      tires: 5,
      body: 8,
      interior: 5,
    } satisfies Record<RepairPart, number>,
    /** Fraction of the repair cost that is labour; owning the matching parts kit removes the rest. */
    laborShare: 0.55,
    /** A parts kit covers the parts share of one job up to kit price * this multiplier. */
    kitCoverageMultiplier: 3,
    /** Seconds of shop time per repaired point, and the cap. */
    secondsPerPoint: 0.12,
    maxSeconds: 25,
    minSeconds: 3,
  },

  parts: [
    { id: 'kit_engine', label: 'Engine Rebuild Kit', part: 'engine', price: 900, description: 'Covers parts for one engine repair job.' },
    { id: 'kit_transmission', label: 'Gearbox Kit', part: 'transmission', price: 700, description: 'Covers parts for one transmission job.' },
    { id: 'kit_brakes', label: 'Brake Pads & Discs', part: 'brakes', price: 260, description: 'Covers parts for one brake job.' },
    { id: 'kit_tires', label: 'Tire Set', part: 'tires', price: 320, description: 'Covers parts for one tire job.' },
    { id: 'kit_body', label: 'Body Panel Kit', part: 'body', price: 600, description: 'Covers parts for one body job.' },
    { id: 'kit_interior', label: 'Upholstery Kit', part: 'interior', price: 380, description: 'Covers parts for one interior job.' },
  ] as { id: string; label: string; part: RepairPart; price: number; description: string }[],

  wash: {
    tiers: [
      { id: 'basic', label: 'Express Wash', price: 45, cleanTo: 80, interiorBonus: 0, seconds: 3 },
      { id: 'deluxe', label: 'Deluxe Detail', price: 140, cleanTo: 100, interiorBonus: 6, seconds: 6 },
    ],
  },

  fuel: {
    /** Price to add one percent of tank. Full tank from empty = 100 * price. */
    pricePerPercent: 2.2,
    /** Tank percent used per km driven (see world.mileageScale). */
    consumptionPerKm: 1.6,
  },

  bank: {
    /** Interest paid on bank balance every payout interval. */
    interestRate: 0.004,
    payoutIntervalSec: 600,
    maxInterestPerPayout: 2_500,
  },

  dealership: {
    levels: [
      { level: 1, name: 'Small Lot', price: 12_000, slots: 4, minPlayerLevel: 1, customerRate: 1.0, premium: 0.0, repairDiscount: 0 },
      { level: 2, name: 'Expanded Lot', price: 30_000, slots: 6, minPlayerLevel: 3, customerRate: 1.15, premium: 0.01, repairDiscount: 0 },
      { level: 3, name: 'Showroom', price: 65_000, slots: 8, minPlayerLevel: 5, customerRate: 1.3, premium: 0.02, repairDiscount: 0 },
      { level: 4, name: 'Showroom + Repair Bay', price: 110_000, slots: 8, minPlayerLevel: 7, customerRate: 1.4, premium: 0.03, repairDiscount: 0.25 },
      { level: 5, name: 'Luxury Showroom', price: 190_000, slots: 10, minPlayerLevel: 10, customerRate: 1.6, premium: 0.05, repairDiscount: 0.25 },
      { level: 6, name: 'Mega Dealership', price: 320_000, slots: 12, minPlayerLevel: 14, customerRate: 1.85, premium: 0.07, repairDiscount: 0.35 },
    ] as DealershipLevelConfig[],
    nameMaxLength: 24,
    /** Max distance (m) from the plot to manage it. */
    manageRadius: 30,
  },

  customers: {
    /** Average seconds between customer visits for one dealership with vehicles for sale. */
    baseIntervalSec: 45,
    /** Randomisation of the interval (+/- fraction). */
    intervalJitter: 0.35,
    /** Customers visiting while the owner is offline arrive this much less often. */
    offlineRateMultiplier: 0.4,
    /** Classifieds get a customer check every N seconds (per listing chance below). */
    classifiedsIntervalSec: 60,
    classifiedsBuyChance: 0.18,
    maxGlobal: 16,
    offerTimeoutSec: 30,
    /** Reputation effect on arrival rate: rate *= 1 + (rep - 50) / 100 * repRateScale */
    repRateScale: 0.6,
    /** Reputation effect on willingness: +/- up to this fraction. */
    repWillingnessScale: 0.05,
    browseSeconds: [6, 12] as [number, number],
    walkSpeed: 2.2,
    archetypes: [
      { id: 'student', label: 'Student', weight: 20, categories: ['compact', 'sedan', 'utility'], budget: [4_000, 16_000], minCondition: 30, maxMileage: 250_000, willingness: [0.9, 1.06], negotiateChance: 0.7 },
      { id: 'family', label: 'Family Buyer', weight: 22, categories: ['sedan', 'suv', 'compact'], budget: [12_000, 45_000], minCondition: 55, maxMileage: 180_000, willingness: [0.95, 1.1], negotiateChance: 0.5 },
      { id: 'tradie', label: 'Tradesperson', weight: 16, categories: ['truck', 'utility', 'suv'], budget: [10_000, 42_000], minCondition: 40, maxMileage: 240_000, willingness: [0.94, 1.1], negotiateChance: 0.55 },
      { id: 'enthusiast', label: 'Enthusiast', weight: 12, categories: ['sports', 'classic'], budget: [30_000, 110_000], minCondition: 60, maxMileage: 150_000, willingness: [0.98, 1.16], negotiateChance: 0.45 },
      { id: 'executive', label: 'Executive', weight: 10, categories: ['luxury', 'sedan', 'suv'], budget: [40_000, 180_000], minCondition: 70, maxMileage: 90_000, willingness: [1.0, 1.18], negotiateChance: 0.35 },
      { id: 'collector', label: 'Collector', weight: 6, categories: ['classic', 'luxury', 'sports'], budget: [40_000, 200_000], minCondition: 50, maxMileage: 400_000, willingness: [1.02, 1.2], negotiateChance: 0.3 },
      { id: 'bargain', label: 'Bargain Hunter', weight: 14, categories: ['compact', 'sedan', 'utility', 'truck', 'suv'], budget: [3_000, 25_000], minCondition: 15, maxMileage: 400_000, willingness: [0.82, 0.98], negotiateChance: 0.85 },
    ] as CustomerArchetypeConfig[],
  },

  auction: {
    minDurationSec: 60,
    maxDurationSec: 900,
    defaultDurationSec: 180,
    /** Minimum bid increment = max(minIncrement, current * minIncrementRate). */
    minIncrement: 100,
    minIncrementRate: 0.03,
    /** A bid in the last N seconds extends the auction to N seconds (anti-sniping). */
    antiSnipeSec: 15,
    /** Starting bid must be between these fractions of market value (anti-manipulation). */
    startingBidRange: [0.5, 1.5] as [number, number],
    /** NPC bidders participate in player auctions up to this fraction of market value. */
    npcBidChancePerTick: 0.02,
    npcMaxBidRate: [0.7, 0.93] as [number, number],
    /** Always keep this many NPC consignment auctions running. */
    npcAuctionCount: 2,
    npcAuctionDurationSec: [180, 420] as [number, number],
  },

  customization: {
    /** Fraction of the paid customization cost that is recognised in market value (capped by valuation.maxModsBonus). */
    valueRetention: 0.6,
  },

  /** Tuning garage. Part prices and value bonuses live in modificationsData.ts. */
  tuning: {
    /** Engine condition lost per game km for each point of engine stress above 1 (tuned engines wear faster). */
    engineWearPerKm: 0.12,
    xpPerPart: 8,
  },

  /** Rare Dealer: a rotating stock of special vehicles (see rareMarket.ts). */
  rareMarket: {
    /** The whole stock is replaced every N seconds (aligned to the server clock). */
    rotationSec: 120,
    /** Offers per rotation. */
    slots: 6,
    /**
     * Chance (%) that one offer is from each tier. Common + uncommon = 70, rare + epic = 25,
     * legendary = 5. A legendary slot picks one legendary model weighted by its drop chance, so
     * each legendary model shows up in well under 5% of rotations.
     */
    tierWeights: { common: 40, uncommon: 30, rare: 17, epic: 8, legendary: 5 } satisfies Record<RarityTier, number>,
    /** Price as a fraction of market value (never below what auctions or the wholesaler pay). */
    priceRange: {
      common: [0.94, 1.06],
      uncommon: [0.94, 1.06],
      rare: [0.96, 1.08],
      epic: [0.97, 1.1],
      legendary: [1.0, 1.08],
    } satisfies Record<RarityTier, [number, number]>,
    /** Condition quality (see generator.generateCondition) and mileage ranges per tier. */
    quality: {
      common: [55, 90],
      uncommon: [60, 92],
      rare: [70, 96],
      epic: [75, 97],
      legendary: [92, 100],
    } satisfies Record<RarityTier, [number, number]>,
    mileage: {
      common: [8_000, 140_000],
      uncommon: [6_000, 110_000],
      rare: [3_000, 80_000],
      epic: [2_000, 60_000],
      legendary: [0, 6_000],
    } satisfies Record<RarityTier, [number, number]>,
    /** Chance that a non-legendary offer comes with a performance package already fitted. */
    tunedChance: 0.25,
  },

  /** No Hesi highway: near misses at speed pay cash and XP, with a combo multiplier. */
  highway: {
    /** Speedometer (km/h) needed for a near miss to count. */
    nearMissMinKmh: 150,
    nearMissReward: 100,
    nearMissXp: 5,
    /**
     * A pass counts when the gap between the two bodies (exact box-to-box distance) stayed under
     * this (m) without touching: a real 20-50 cm "makas".
     */
    nearMissClearance: 0.5,
    /** Closer than this (m) is a "hair's breadth" pass: the reward is multiplied by closeBonus. */
    nearMissCloseClearance: 0.2,
    closeBonus: 1.5,
    /** The combo ends when no near miss happens for this long (s). */
    comboWindowSec: 6,
    /** Multiplier by combo length (the highest tier reached applies). */
    comboTiers: [
      { from: 10, mult: 5 },
      { from: 6, mult: 3 },
      { from: 3, mult: 2 },
    ],
    /** A collision this hard (m/s) - or any contact with traffic - resets the combo. */
    crashImpact: 3,
    /** Near-miss cash is capped per rolling hour (keeps the dealership economy meaningful). */
    hourlyCap: 75_000,
  },

  /**
   * Passive income while driving: every `everySec` seconds of driving (moving, not parked) the
   * driver earns cash scaled by the car's current market value:
   *   amount = perTenSecondsAt50k * (value / 50,000) ^ exponent
   * e.g. a $50,000 car pays $50, a $300,000 G 63 / M8 about $350 per 10 s.
   */
  driving: {
    everySec: 10,
    perTenSecondsAt50k: 50,
    exponent: 1.086,
    /** The car must average at least this (km/h) over the interval (no idling or pushing a car). */
    minAvgKmh: 20,
    minAmount: 1,
  },

  /** Wanted level and police pursuits. */
  police: {
    /** Heat per offence; stars = ceil(heat / 100), up to 5. */
    heatNearMissFast: 40,
    /** Near misses this fast (km/h) count as reckless driving. */
    fastNearMissKmh: 180,
    heatTrafficCrash: 90,
    heatHitPolice: 150,
    maxHeat: 500,
    /** Stars needed before police cars come after you. */
    pursuitStars: 2,
    /** Police cars in pursuit by wanted level (index = stars). */
    unitsByStars: [0, 0, 1, 2, 3, 4],
    /** Seconds without a police car near you (m) to lose them. */
    escapeSec: 30,
    escapeRadius: 90,
    escapeReward: 1_000,
    escapeXp: 60,
    /** At 1 star (no pursuit) the heat simply fades after this long without an offence (s). */
    calmSec: 30,
    /** A police car this close (box gap, m) while you are this slow (km/h) for bustSec: busted. */
    bustGap: 2.5,
    bustKmh: 15,
    bustSec: 3,
    /** Fine: this share of your cash, at least minFine (never more than you have). */
    fineShare: 0.1,
    minFine: 1_500,
    /** Length of the arrest cutscene before you respawn (s). */
    cutsceneSec: 6.5,
  },

  /**
   * Car theft: Black Market lockpick sets, the lockpick mini-game on street-parked cars, stripping
   * stolen cars on a lift at the Sanayi garage, and selling the parts at the Pawn Shop.
   */
  theft: {
    /** Lockpick & saw set at the Black Market. */
    lockpickPrice: 2_500,
    /** Shared stock: at most this many sets, back to full every restockSec (real time). */
    stockMax: 5,
    restockSec: 600,
    /** Picks in a set: each wrong turn snaps one; all gone = the set is lost and the alarm goes off. */
    picks: 3,
    /** A set is used up on a successful break-in too (it stays in the ignition). */
    consumeOnSuccess: true,
    /** A lockpick session times out after this long (s). */
    sessionSec: 90,
    /** Minimum time between two turns of the pick (ms, the cylinder animation). */
    tryCooldownMs: 600,
    /** Sweet-spot tolerance (degrees either side) by the car's value: dearer cars, finer locks. */
    tolerance: [
      { maxValue: 20_000, deg: 14 },
      { maxValue: 60_000, deg: 11 },
      { maxValue: 150_000, deg: 9 },
      { maxValue: Number.POSITIVE_INFINITY, deg: 7 },
    ],
    /** Beyond this many degrees off, the cylinder doesn't move at all. */
    turnRange: 90,
    /** After a snapped pick the lock tells which way the sweet spot is and how far: under 15°, 15-30°, 30-50°, more. */
    hintBands: [15, 30, 50],
    /** How close to the car body you must stand (m). */
    pickReach: 2.6,
    /** Failing a lock: car alarm and police heat for 2 stars. */
    failHeat: 180,
    alarmSec: 30,
    /** Street-parked cars (city kerbs) and broken-down cars on the highway shoulder. */
    streetCars: 12,
    highwayCars: 4,
    /** A stolen spot gets a new car after this long (s). */
    respawnSec: 120,
    /** A stolen car left alone (not on a lift) is recovered by the police after this long (s). */
    abandonSec: 600,
    /** A car on a lift that nobody works on for this long is scrapped (s). */
    liftIdleSec: 1_800,
    /** Pawn Shop pays $45,000-$55,000 for all the parts of one stripped car (the car's value and luck); each part
     *  fetches its share of that (shared/theft.ts pawnPrice). */
    pawnMin: 45_000,
    pawnMax: 55_000,
    /** Stand within this many metres of a strip point to work on it. */
    stripReach: 1.7,
    xpPerTheft: 25,
    xpPerPart: 5,
  },

  /** Missions: daily set (resets at 00:00 UTC) with automatic rewards. */
  missions: {
    dailyCount: 5,
    /** The timed sell mission can be restarted after this long (s). */
    timedCooldownSec: 300,
  },

  /** Level (reputation track) unlocks. */
  unlocks: {
    /** Garage capacity: base + perStep for every `levelsPerStep` levels above 1, up to max. */
    garage: { base: 30, perStep: 2, levelsPerStep: 3, max: 64 },
    /** Vehicles you can have out on the street at once. */
    spawnSlots: [
      { level: 1, slots: 2 },
      { level: 8, slots: 3 },
      { level: 18, slots: 4 },
    ],
    /** Discount on the used vehicle market (share), per level reached. */
    marketDiscount: [
      { level: 5, discount: 0.02 },
      { level: 10, discount: 0.04 },
      { level: 20, discount: 0.07 },
      { level: 30, discount: 0.1 },
    ],
    /** Level needed for underglow neon (colours) and the animated rainbow kit. */
    underglowLevel: 5,
    rainbowUnderglowLevel: 15,
  },

  /** Drag strip: each racer pays the entry, the winner takes the pool. */
  drag: {
    entryFee: 250,
    prize: 500,
    /** Waiting for another player to accept before the queue entry expires (s). */
    queueTimeoutSec: 90,
    xpWin: 40,
    xpRace: 10,
  },

  /** Player-to-player trading guards (limit money/XP farming with alternate accounts). */
  trading: {
    /** Asking prices and auction bids are capped at this multiple of market value. */
    maxPriceRate: 2.5,
    /** Player level required to buy from other players or bid on their auctions. */
    minLevelToBuyFromPlayers: 3,
  },

  world: {
    /** Game kilometres per world metre (the city is small; this makes mileage & fuel meaningful). */
    mileageScale: 0.004,
    /** Body damage per m/s of impact speed above the threshold. */
    impactDamageThreshold: 6,
    impactDamagePerMs: 0.6,
    /** Vehicles on the road lose cleanliness per km driven. */
    dirtPerKm: 1.2,
  },

  limits: {
    maxPrice: 5_000_000,
    minPrice: 100,
    maxBankTransfer: 1_000_000_000,
  },
};

export type EconomyConfig = typeof ECONOMY;

export function dealershipLevel(level: number): DealershipLevelConfig {
  const levels = ECONOMY.dealership.levels;
  const idx = Math.max(1, Math.min(levels.length, Math.floor(level))) - 1;
  return levels[idx]!;
}

export const MAX_DEALERSHIP_LEVEL = ECONOMY.dealership.levels.length;

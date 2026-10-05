import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import {
  RARE_ROTATION_MS,
  appearanceChance,
  modelsOfTier,
  offerId,
  parseOfferId,
  rareEpoch,
  rareEpochEnd,
  rollModel,
  rollTier,
  rotationSeed,
  tierChance,
} from '../../shared/rareMarket';
import { LEGENDARY_RARITY, SPECIAL_MODELS, specialVehicles } from '../../shared/specialVehicles';
import { mulberry32 } from '../../shared/util';
import { marketValue } from '../../shared/valuation';
import { CATALOG_MODELS, RARITY_TIERS, type RarityTier } from '../../shared/vehicles';
import { DEFAULT_MODS } from '../../shared/customization';
import { generateNpcVehicle } from '../../server/game/generator';

/** One rotation, exactly as the server rolls it (tier, then model without repeats). */
function rollRotation(rng: () => number): { tier: RarityTier; model: string }[] {
  const taken = new Set<string>();
  const out: { tier: RarityTier; model: string }[] = [];
  for (let s = 0; s < ECONOMY.rareMarket.slots; s++) {
    const m = rollModel(rng, rollTier(rng), taken);
    taken.add(m.id);
    out.push({ tier: m.tier, model: m.id });
  }
  return out;
}

describe('rare dealer odds', () => {
  it('uses 70% common/uncommon, 25% rare/epic and 5% legendary per offer', () => {
    expect(tierChance('common') + tierChance('uncommon')).toBeCloseTo(0.7, 10);
    expect(tierChance('rare') + tierChance('epic')).toBeCloseTo(0.25, 10);
    expect(tierChance('legendary')).toBeCloseTo(0.05, 10);
    const rng = mulberry32(1234);
    const n = 200_000;
    const count: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const t = rollTier(rng);
      count[t] = (count[t] ?? 0) + 1;
    }
    expect(((count.common ?? 0) + (count.uncommon ?? 0)) / n).toBeCloseTo(0.7, 2);
    expect(((count.rare ?? 0) + (count.epic ?? 0)) / n).toBeCloseTo(0.25, 2);
    expect((count.legendary ?? 0) / n).toBeCloseTo(0.05, 2);
  });

  it('shows each legendary vehicle in at most 5% of rotations (weighted random)', () => {
    const rng = mulberry32(99);
    const rotations = 60_000;
    const seen = new Map<string, number>();
    for (let i = 0; i < rotations; i++) {
      for (const id of new Set(rollRotation(rng).filter((o) => o.tier === 'legendary').map((o) => o.model))) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const sv of specialVehicles) {
      const rate = (seen.get(sv.id) ?? 0) / rotations;
      expect(rate, sv.id).toBeGreaterThan(0.015);
      expect(rate, sv.id).toBeLessThanOrEqual(sv.dropChance);
      expect(appearanceChance(sv.id)).toBeLessThanOrEqual(sv.dropChance);
      expect(Math.abs(appearanceChance(sv.id) - rate)).toBeLessThan(0.005);
    }
  });

  it('never repeats a rare, epic or legendary model within one rotation', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 5_000; i++) {
      const special = rollRotation(rng).filter((o) => o.tier !== 'common' && o.tier !== 'uncommon').map((o) => o.model);
      expect(new Set(special).size).toBe(special.length);
    }
  });

  it('has vehicles in every tier', () => {
    for (const t of RARITY_TIERS) expect(modelsOfTier(t).length, t).toBeGreaterThan(0);
    expect(modelsOfTier('legendary').map((m) => m.id).sort()).toEqual(specialVehicles.map((s) => s.id).sort());
  });
});

describe('rare dealer rotation clock', () => {
  it('rotates every 120 seconds on the server clock', () => {
    expect(RARE_ROTATION_MS).toBe(120_000);
    const t = Date.UTC(2026, 8, 29, 12, 0, 30);
    const e = rareEpoch(t);
    expect(rareEpochEnd(e) - t).toBe(90_000);
    expect(rareEpoch(rareEpochEnd(e))).toBe(e + 1);
    expect(rareEpoch(rareEpochEnd(e) - 1)).toBe(e);
  });

  it('seeds are deterministic per secret and epoch', () => {
    expect(rotationSeed('abc', 5)).toBe(rotationSeed('abc', 5));
    expect(rotationSeed('abc', 5)).not.toBe(rotationSeed('abc', 6));
    expect(rotationSeed('abc', 5)).not.toBe(rotationSeed('abd', 5));
    const a = rollRotation(mulberry32(rotationSeed('s', 42)));
    const b = rollRotation(mulberry32(rotationSeed('s', 42)));
    expect(a).toEqual(b);
  });

  it('parses offer ids strictly', () => {
    expect(parseOfferId(offerId(123456, 5))).toEqual({ epoch: 123456, slot: 5 });
    for (const bad of ['', '12', '12:', ':3', '1:2:3', 'a:1', '1:100', '1 :2']) expect(parseOfferId(bad), bad).toBeNull();
  });
});

describe('special vehicles', () => {
  it('match the source list and are exclusive to the Rare Dealer', () => {
    expect(SPECIAL_MODELS).toHaveLength(10);
    for (const sv of specialVehicles) {
      const m = SPECIAL_MODELS.find((x) => x.id === sv.id)!;
      expect(m.tier).toBe('legendary');
      expect(m.exclusive).toBe(true);
      expect(sv.rarity).toBe('Legendary');
      expect(sv.dropChance).toBeLessThanOrEqual(0.05);
      expect(m.specs.hp).toBe(sv.baseStats.hp);
      expect(m.specs.topSpeed).toBe(sv.baseStats.topSpeed);
      expect(m.specs.accel).toBe(sv.baseStats.accel);
      // A new one is worth its list price.
      const value = marketValue({ modelId: m.id, mileage: 0, condition: { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 }, mods: { ...DEFAULT_MODS } });
      expect(Math.abs(value - sv.price) / sv.price).toBeLessThan(0.002);
    }
    expect(1 + (LEGENDARY_RARITY - 1) * ECONOMY.valuation.rarityValueScale).toBeCloseTo(1.15, 10);
    expect(CATALOG_MODELS.some((m) => m.exclusive)).toBe(false);
    const rng = mulberry32(3);
    for (let i = 0; i < 2_000; i++) expect(SPECIAL_MODELS.some((m) => m.id === generateNpcVehicle(rng).modelId)).toBe(false);
  });

  it('prices every offer tier above what an auction or the wholesaler would pay', () => {
    const auctionNet = Math.max(...ECONOMY.auction.npcMaxBidRate) * (1 - ECONOMY.fees.auctionFeeRate);
    for (const t of RARITY_TIERS) {
      expect(ECONOMY.rareMarket.priceRange[t][0]).toBeGreaterThan(auctionNet);
      expect(ECONOMY.rareMarket.priceRange[t][0]).toBeGreaterThan(ECONOMY.fees.quickSellRate);
    }
  });
});

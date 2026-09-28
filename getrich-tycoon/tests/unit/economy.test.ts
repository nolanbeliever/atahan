import { describe, expect, it } from 'vitest';
import { ECONOMY, dealershipLevel } from '../../shared/economy.config';
import { ACHIEVEMENTS, levelFromXp, totalXpForLevel, xpToNext } from '../../shared/progression';
import { marketValue, quickSellPrice } from '../../shared/valuation';
import { VEHICLE_MODELS } from '../../shared/vehicles';
import { MAX_SLOTS, PLOTS, MARKET_LOT_SLOTS } from '../../shared/world';
import { generateNpcVehicle } from '../../server/game/generator';
import { mulberry32 } from '../../shared/util';

describe('economy configuration', () => {
  it('has at least 12 vehicle models across all 8 categories with fictional brands', () => {
    expect(VEHICLE_MODELS.length).toBeGreaterThanOrEqual(12);
    const cats = new Set(VEHICLE_MODELS.map((m) => m.category));
    expect(cats.size).toBe(8);
    const ids = new Set(VEHICLE_MODELS.map((m) => m.id));
    expect(ids.size).toBe(VEHICLE_MODELS.length);
  });

  it('dealership levels get more expensive and more capable', () => {
    const levels = ECONOMY.dealership.levels;
    expect(levels.length).toBe(6);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!.price).toBeGreaterThan(levels[i - 1]!.price);
      expect(levels[i]!.slots).toBeGreaterThanOrEqual(levels[i - 1]!.slots);
      expect(levels[i]!.minPlayerLevel).toBeGreaterThanOrEqual(levels[i - 1]!.minPlayerLevel);
    }
    expect(dealershipLevel(6).slots).toBeLessThanOrEqual(MAX_SLOTS);
    expect(dealershipLevel(99).level).toBe(6);
    expect(ECONOMY.player.startingMoney).toBeGreaterThan(dealershipLevel(1).price);
    expect(PLOTS.length).toBe(8);
    expect(MARKET_LOT_SLOTS.length).toBeGreaterThanOrEqual(ECONOMY.marketplace.npcListingCount);
  });

  it('seller personalities never have a minimum above their asking range', () => {
    for (const p of ECONOMY.sellerPersonalities) {
      expect(p.minRange[0]).toBeLessThanOrEqual(p.minRange[1]);
      expect(p.askRange[0]).toBeLessThanOrEqual(p.askRange[1]);
      expect(p.minRange[1]).toBeLessThanOrEqual(p.askRange[1]);
    }
  });

  it('is arbitrage-free: buying from NPCs at their lowest price and quick-selling always loses money', () => {
    const lowestMin = Math.min(...ECONOMY.sellerPersonalities.map((p) => p.minRange[0]));
    expect(ECONOMY.fees.quickSellRate).toBeLessThan(lowestMin);
    const rng = mulberry32(42);
    for (let i = 0; i < 500; i++) {
      const v = generateNpcVehicle(rng);
      const value = marketValue(v);
      expect(quickSellPrice(v)).toBeLessThan(Math.round(value * lowestMin));
    }
  });

  it('customer willingness keeps retail margins bounded', () => {
    for (const a of ECONOMY.customers.archetypes) {
      expect(a.willingness[1]).toBeLessThanOrEqual(1.25);
      expect(a.willingness[0]).toBeGreaterThan(0.75);
      expect(a.budget[0]).toBeLessThan(a.budget[1]);
    }
  });

  it('XP levels are consistent', () => {
    for (let l = 1; l < 30; l++) {
      expect(levelFromXp(totalXpForLevel(l))).toBe(l);
      expect(levelFromXp(totalXpForLevel(l + 1) - 1)).toBe(l);
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    }
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('generates plausible NPC vehicles', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      const v = generateNpcVehicle(rng);
      for (const k of Object.keys(v.condition) as (keyof typeof v.condition)[]) {
        expect(v.condition[k]).toBeGreaterThanOrEqual(0);
        expect(v.condition[k]).toBeLessThanOrEqual(100);
      }
      expect(v.mileage).toBeGreaterThan(0);
      expect(marketValue(v)).toBeGreaterThan(0);
    }
  });
});

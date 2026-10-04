import { describe, expect, it } from 'vitest';
import { DEFAULT_MODS } from '../../shared/customization';
import type { Vehicle, VehicleCondition } from '../../shared/types';
import { fuelCost, marketValue, overallCondition, quickSellPrice, repairQuote } from '../../shared/valuation';

function cond(v: number, cleanliness = v): VehicleCondition {
  return { engine: v, transmission: v, brakes: v, tires: v, body: v, interior: v, cleanliness };
}

function veh(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v',
    modelId: 'norda_arlo',
    ownerId: null,
    color: '#fff',
    mileage: 50_000,
    fuel: 50,
    condition: cond(60),
    mods: { ...DEFAULT_MODS },
    status: 'stored',
    purchasePrice: 0,
    salePrice: null,
    plotId: null,
    slot: null,
    rotation: 0,
    x: 0,
    z: 0,
    serviceUntil: 0,
    createdAt: 0,
    ...overrides,
  };
}

describe('valuation', () => {
  it('computes a weighted overall condition', () => {
    expect(overallCondition(cond(100))).toBeCloseTo(100);
    expect(overallCondition(cond(0))).toBeCloseTo(0);
    expect(overallCondition(cond(50))).toBeCloseTo(50);
  });

  it('values better condition, lower mileage and cleaner vehicles higher', () => {
    expect(marketValue(veh({ condition: cond(90) }))).toBeGreaterThan(marketValue(veh({ condition: cond(40) })));
    expect(marketValue(veh({ mileage: 10_000 }))).toBeGreaterThan(marketValue(veh({ mileage: 200_000 })));
    expect(marketValue(veh({ condition: cond(80, 100) }))).toBeGreaterThan(marketValue(veh({ condition: cond(80, 10) })));
  });

  it('adds a capped premium for modifications', () => {
    const stock = marketValue(veh());
    const modded = marketValue(veh({ mods: { ...DEFAULT_MODS, paint: 'paint_gold', wheels: 'wheel_gold', bodyKit: 'kit_full' } }));
    expect(modded).toBeGreaterThan(stock);
    expect(modded).toBeLessThanOrEqual(Math.round(stock * 1.12) + 1);
  });

  it('never returns a negative or zero value', () => {
    expect(marketValue(veh({ condition: cond(0), mileage: 10_000_000 }))).toBeGreaterThan(0);
  });

  it('prices repairs per point and restores parts to 100', () => {
    const v = veh({ condition: cond(40) });
    const q = repairQuote(v, ['engine', 'body']);
    expect(q.total).toBeGreaterThan(0);
    expect(q.after.engine).toBe(100);
    expect(q.after.body).toBe(100);
    expect(q.valueAfter).toBeGreaterThan(q.valueBefore);
    const perfect = repairQuote(veh({ condition: cond(100) }), ['engine']);
    expect(perfect.total).toBe(0);
  });

  it('parts kits and repair bay discounts reduce the price', () => {
    const v = veh({ condition: cond(20) });
    const base = repairQuote(v, ['tires']).total;
    const kit = repairQuote(v, ['tires'], { inventory: { kit_tires: 1 }, useKits: true }).total;
    const bay = repairQuote(v, ['tires'], { laborDiscount: 0.25 }).total;
    expect(kit).toBeLessThan(base);
    expect(bay).toBeLessThan(base);
    // Kits are only applied when owned.
    expect(repairQuote(v, ['tires'], { inventory: {}, useKits: true }).total).toBe(base);
  });

  it('full restoration of a worn car is profitable but not a money printer', () => {
    const v = veh({ condition: cond(40) });
    const q = repairQuote(v, ['engine', 'transmission', 'brakes', 'tires', 'body', 'interior']);
    const gain = q.valueAfter - q.valueBefore;
    expect(gain).toBeGreaterThan(q.total);
    expect(gain / q.total).toBeLessThan(3);
  });

  it('charges fuel for the missing tank percentage only', () => {
    expect(fuelCost(100)).toBe(0);
    expect(fuelCost(0)).toBeGreaterThan(fuelCost(50));
  });

  it('quick-sell pays less than market value', () => {
    const v = veh();
    expect(quickSellPrice(v)).toBeLessThan(marketValue(v));
  });
});

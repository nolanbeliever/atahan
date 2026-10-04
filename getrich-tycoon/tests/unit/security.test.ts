// Security gear: the prices, the armour lasting at least 30 bullets (a blast takes more off), the
// glass cracking in three steps, the patch-up price and the armour's weight on the car.

import { describe, expect, it } from 'vitest';
import { vehicleParams } from '../../shared/physics';
import { SECURITY, SECURITY_DEFS, armorCost, armorRepairPrice, crackLevel } from '../../shared/security';
import { CATALOG_MODELS } from '../../shared/vehicles';

const NEW = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
const MODS = { paint: null, wheels: 'wheel_stock', tint: 'tint_none', bodyKit: 'kit_none', headlights: 'lights_stock', accessory: 'acc_none' };

describe('security gear', () => {
  it('prices: compartment $15k, run-flats $25k, level-3 armour $40k', () => {
    expect(SECURITY_DEFS.stash.price).toBe(15_000);
    expect(SECURITY_DEFS.runflat.price).toBe(25_000);
    expect(SECURITY_DEFS.armor.price).toBe(40_000);
    expect(SECURITY_DEFS.armor.carsOnly).toBe(true);
    expect(SECURITY.stashFindChance).toBeCloseTo(0.1);
  });

  it('armour lasts at least 30 bullets of any gun; a rocket takes much more off', () => {
    let a = 100;
    let hits = 0;
    while (a > 0) {
      a -= armorCost('bullet', 62);
      hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(30);
    expect(armorCost('bullet', 3)).toBe(armorCost('bullet', 62));
    expect(armorCost('blast', 220)).toBeGreaterThan(armorCost('bullet', 62) * 20);
  });

  it('the glass cracks in three steps as the armour wears', () => {
    expect([100, 90, 60, 20, 0].map(crackLevel)).toEqual([0, 1, 2, 3, 3]);
  });

  it('patching up worn armour: $120 per % missing', () => {
    expect(armorRepairPrice(100)).toBe(0);
    expect(armorRepairPrice(75)).toBe(3_000);
    expect(armorRepairPrice(0)).toBe(12_000);
  });

  it('the armour weighs: the same car is heavier', () => {
    const car = CATALOG_MODELS.find((m) => m.specs.kind === 'car')!;
    const plain = vehicleParams(car, NEW, 100, MODS);
    const armored = vehicleParams(car, NEW, 100, { ...MODS, armor: true });
    expect(armored.pt.mass - plain.pt.mass).toBe(SECURITY.armorKg);
    // Run-flats and a compartment change nothing on the road.
    expect(vehicleParams(car, NEW, 100, { ...MODS, runflat: true, stash: true }).pt.mass).toBe(plain.pt.mass);
  });
});

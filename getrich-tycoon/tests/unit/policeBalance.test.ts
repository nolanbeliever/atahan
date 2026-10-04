// The police chase, toned down by 40%: a slower pursuit car, less look-ahead, gentler officers.

import { describe, expect, it } from 'vitest';
import { performanceFigures } from '../../shared/drivetrain';
import { ECONOMY } from '../../shared/economy.config';
import { POLICE_MODEL } from '../../shared/vehicles';
import { PURSUIT_MODEL } from '../../server/game/services/police';

describe('police balance', () => {
  it('the pursuit car has 60% of the interceptor’s power and top speed', () => {
    expect(PURSUIT_MODEL.specs.hp).toBe(Math.round(POLICE_MODEL.specs.hp * 0.6));
    expect(PURSUIT_MODEL.specs.topSpeed).toBe(Math.round(POLICE_MODEL.specs.topSpeed * 0.6));
    const slow = performanceFigures(PURSUIT_MODEL);
    const fast = performanceFigures(POLICE_MODEL);
    expect(slow.topKmh).toBeLessThan(fast.topKmh * 0.65);
    expect(slow.t100).toBeGreaterThan(fast.t100 * 1.4);
  });

  it('officers hit 40% softer, cars aim less far ahead and come back from further away', () => {
    const [lo, hi] = ECONOMY.combat.officerDamage;
    expect(lo).toBeCloseTo(5 * 0.6, 5);
    expect(hi).toBeCloseTo(9 * 0.6, 5);
    expect(ECONOMY.police.chase.lead).toBeCloseTo(1.4 * 0.6, 5);
    expect(ECONOMY.police.chase.spawnDist).toBeGreaterThan(125);
    expect(ECONOMY.police.chase.respawnDist).toBeGreaterThan(320);
  });
});

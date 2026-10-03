// The heist targets: where you stand is open ground right at a building's wall, the loot and the
// work time are in the asked-for ranges, and police cars can't get near the doors (the forecourts'
// bollards stop them; a motorcycle gets through).

import { describe, expect, it } from 'vitest';
import { KMH_PER_MS } from '../../shared/drivetrain';
import { CASINO_BOX, HEISTS, HEIST_CAR_SPAWN, HEIST_DROP, SECURITY_BOLLARDS, SECURITY_FORECOURTS, rollLoot } from '../../shared/heists';
import { KEY, newVehicleDyn, stepVehicle, vehicleParams, type CollisionWorld } from '../../shared/physics';
import { getModel } from '../../shared/vehicles';
import { STATIC_BOXES, STATIC_CIRCLES } from '../../shared/world';

const WORLD: CollisionWorld = { boxes: STATIC_BOXES, circles: STATIC_CIRCLES, dynamic: [], vehicles: [] };
const GOOD = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
const inside = (x: number, z: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;

describe('heist targets', () => {
  it('seven targets, 1-2 minutes of work, $20,000-$80,000 of loot', () => {
    expect(HEISTS.map((h) => h.id).sort()).toEqual(['bank', 'casino', 'dealership', 'jeweler', 'office', 'realestate', 'supermarket']);
    for (const h of HEISTS) {
      expect(h.workSec).toBeGreaterThanOrEqual(60);
      expect(h.workSec).toBeLessThanOrEqual(120);
      expect(h.loot[0]).toBeGreaterThanOrEqual(20_000);
      expect(h.loot[1]).toBeLessThanOrEqual(80_000);
      expect(rollLoot(h, 0)).toBe(h.loot[0]);
      expect(rollLoot(h, 1)).toBe(h.loot[1]);
      expect(rollLoot(h, 0.5) % 100).toBe(0);
      expect(h.stars).toBeGreaterThanOrEqual(2);
    }
  });

  it('you stand on open ground facing a building wall', () => {
    for (const h of HEISTS) {
      for (const b of STATIC_BOXES) expect(inside(h.stand.x, h.stand.z, b, 0.45)).toBe(false);
      for (const c of STATIC_CIRCLES) expect(Math.hypot(c.x - h.stand.x, c.z - h.stand.z)).toBeGreaterThan(c.r + 0.45);
      // The door is on the face of a building, straight ahead.
      expect(STATIC_BOXES.some((b) => inside(h.door.x, h.door.z, b, 0.05))).toBe(true);
      const ahead = { x: h.stand.x + Math.sin(h.stand.rot) * 1.4, z: h.stand.z + Math.cos(h.stand.rot) * 1.4 };
      expect(STATIC_BOXES.some((b) => inside(ahead.x, ahead.z, b))).toBe(true);
    }
  });

  it('the casino stands clear of everything else; the getaway car and the docks drop are open', () => {
    for (const b of STATIC_BOXES) if (b !== CASINO_BOX) expect(b.minX < CASINO_BOX.maxX && CASINO_BOX.minX < b.maxX && b.minZ < CASINO_BOX.maxZ && CASINO_BOX.minZ < b.maxZ).toBe(false);
    for (const p of [HEIST_CAR_SPAWN, HEIST_DROP]) {
      for (const b of STATIC_BOXES) expect(inside(p.x, p.z, b, 3)).toBe(false);
    }
    expect(SECURITY_BOLLARDS.length).toBeGreaterThan(30);
  });

  it('a police car can’t reach a forecourt door; a motorcycle gets through the bollards', () => {
    for (const h of HEISTS.filter((x) => SECURITY_FORECOURTS.some((f) => inside(x.stand.x, x.stand.z, f)))) {
      const f = SECURITY_FORECOURTS.find((x) => inside(h.stand.x, h.stand.z, x))!;
      // From 20 m out in front, straight at the door, at 60 km/h.
      const back = { x: h.stand.x - Math.sin(h.stand.rot) * 20, z: h.stand.z - Math.cos(h.stand.rot) * 20 };
      const run = (modelId: string) => {
        const p = vehicleParams(getModel(modelId), GOOD, 100);
        const v = newVehicleDyn(back.x, back.z, h.stand.rot);
        v.speed = 60 / KMH_PER_MS;
        for (let t = 0; t < 4; t += 1 / 30) stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, WORLD);
        return Math.hypot(v.x - h.stand.x, v.z - h.stand.z);
      };
      expect(run('police')).toBeGreaterThan(6);
      expect(inside(back.x, back.z, f)).toBe(false);
      expect(run('ktm_duke390')).toBeLessThan(5);
    }
  });
});

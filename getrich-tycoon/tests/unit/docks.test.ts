// The docks data (shared/docks.ts): the robbable containers stand clear in the yard's lanes with room
// at their doors and for the hypercar to roll out; the night window; the barricades shut the gates;
// SWAT cover and the depot are open ground; the imports cost $100,000 and more.

import { describe, expect, it } from 'vitest';
import { DEPOT, DOCK_CONTAINERS, IMPORTS, SWAT_COVER, containerCarSpot, containerDoor, docksOpen, gateBarricades } from '../../shared/docks';
import { DOCKS } from '../../shared/farShore';
import { GANG_ZONES } from '../../shared/gangs';
import { CHAR_RADIUS, resolveCircle, type CollisionWorld } from '../../shared/physics';
import { STATIC_BOXES, STATIC_CIRCLES } from '../../shared/world';

const world: CollisionWorld = { boxes: STATIC_BOXES, circles: STATIC_CIRCLES, dynamic: [], vehicles: [] };
const free = (x: number, z: number, r = CHAR_RADIUS) => {
  const p = resolveCircle(x, z, r, world);
  return Math.hypot(p.x - x, p.z - z) < 0.05;
};

describe('the docks: data', () => {
  it('open from 23:00 to 05:00', () => {
    for (const h of [23, 0, 2, 4.9]) expect(docksOpen(0, h)).toBe(true);
    for (const h of [5, 12, 18, 22.9]) expect(docksOpen(0, h)).toBe(false);
  });

  it('the containers stand in the yard, clear of the stacks, with room at the doors and for a car to roll out', () => {
    for (const k of DOCK_CONTAINERS) {
      const b = k.box;
      expect(b.minX).toBeGreaterThan(DOCKS.minX);
      expect(b.maxX).toBeLessThan(DOCKS.maxX);
      expect(b.minZ).toBeGreaterThan(DOCKS.minZ);
      const others = STATIC_BOXES.filter((o) => o !== b && !(o.minX === b.minX && o.maxX === b.maxX && o.minZ === b.minZ && o.maxZ === b.maxZ));
      for (const o of others) expect(b.maxX <= o.minX || b.minX >= o.maxX || b.maxZ <= o.minZ || b.minZ >= o.maxZ, `${k.id} overlaps`).toBe(true);
      const d = containerDoor(k);
      expect(free(d.stand.x, d.stand.z), `${k.id} door`).toBe(true);
      const car = containerCarSpot(k);
      expect(free(car.x, car.z, 1.6), `${k.id} car spot`).toBe(true);
      // Not on a gang car's road end at the docks.
      for (const lane of GANG_ZONES.find((z) => z.id === 'docks')!.lanes) {
        const end = lane[lane.length - 1]!;
        expect(end.x < b.minX - 2 || end.x > b.maxX + 2 || end.z < b.minZ - 2 || end.z > b.maxZ + 2, `${k.id} on a gang lane`).toBe(true);
      }
    }
  });

  it('the barricades close both gates; SWAT cover and the depot are open ground', () => {
    const b = gateBarricades();
    expect(b.some((x) => x.id.startsWith('west'))).toBe(true);
    expect(b.some((x) => x.id.startsWith('north'))).toBe(true);
    for (const s of SWAT_COVER) expect(free(s.x, s.z), `cover ${s.x},${s.z}`).toBe(true);
    expect(free(DEPOT.x, DEPOT.z, 2)).toBe(true);
  });

  it('the imports', () => {
    for (const i of IMPORTS) expect(i.price).toBeGreaterThanOrEqual(100_000);
  });
});

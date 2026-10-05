// The showrooms' layout on the Galeri Bulvarı and their prices.

import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { BOULEVARD, DOCKS, DOCKS_ROAD, TOUGE_RAIL, distToTouge, terrainHeight } from '../../shared/farShore';
import { resolveCircle, type CollisionWorld } from '../../shared/physics';
import { SHOWROOMS, blackMarketPrice, newShowroomCar, parseShowroomOffer, showroomAtDoor, showroomPrice } from '../../shared/showrooms';
import { FAR_ROADS, WORLD_BOX } from '../../shared/strait';
import { marketValue, neutralTrends, quickSellPrice } from '../../shared/valuation';
import { getModel } from '../../shared/vehicles';
import { INTERACTABLES, STATIC_BOXES, STATIC_CIRCLES, type AABB } from '../../shared/world';

const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const inside = (x: number, z: number, b: AABB, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
const world: CollisionWorld = { boxes: STATIC_BOXES, circles: STATIC_CIRCLES, dynamic: [], vehicles: [] };

describe('showroom layout', () => {
  it('eight showrooms, every model they sell exists, nothing sold twice', () => {
    expect(SHOWROOMS).toHaveLength(8);
    const all = SHOWROOMS.flatMap((s) => s.models);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(getModel(id).id).toBe(id);
    for (const s of SHOWROOMS) if (s.id !== 'blackmarket') expect(s.models.length).toBeGreaterThanOrEqual(3);
  });

  it('the buildings and forecourts sit beside the boulevard, clear of roads, the touge, the docks and each other', () => {
    const plots = SHOWROOMS.map((s) => {
      const north = s.side === 'north';
      return { s, plot: { minX: s.box.minX, maxX: s.box.maxX, minZ: north ? s.box.minZ : BOULEVARD.maxZ + 4, maxZ: north ? BOULEVARD.minZ - 4 : s.box.maxZ } };
    });
    for (const { s, plot } of plots) {
      for (const r of [...FAR_ROADS, BOULEVARD, DOCKS_ROAD, DOCKS]) expect(overlaps(plot, r), `${s.id} vs road`).toBe(false);
      for (const x of [plot.minX, plot.maxX]) for (const z of [plot.minZ, plot.maxZ]) {
        expect(distToTouge(x, z)).toBeGreaterThan(TOUGE_RAIL + 4);
        expect(terrainHeight(x, z)).toBe(0);
        expect(inside(x, z, WORLD_BOX)).toBe(true);
      }
      for (const o of plots) if (o.s !== s) expect(overlaps(plot, o.plot), `${s.id} vs ${o.s.id}`).toBe(false);
    }
  });

  it('the door prompt is outside the building and reachable on foot; the test-drive bay is clear', () => {
    for (const s of SHOWROOMS) {
      expect(inside(s.door.x, s.door.z, s.box)).toBe(false);
      const p = resolveCircle(s.door.x, s.door.z, 0.4, world);
      expect(Math.hypot(p.x - s.door.x, p.z - s.door.z)).toBeLessThan(0.01);
      expect(showroomAtDoor(s.door.x, s.door.z)?.id).toBe(s.id);
      expect(INTERACTABLES.some((i) => i.kind === 'showroom' && i.showroomId === s.id)).toBe(true);
      // A car-sized circle fits in the bay without touching anything.
      const bay = resolveCircle(s.testDrive.x, s.testDrive.z, 2.6, world);
      expect(Math.hypot(bay.x - s.testDrive.x, bay.z - s.testDrive.z)).toBeLessThan(0.01);
      // Nose to the boulevard, nothing between the bay and the road.
      const toRoad = s.side === 'north' ? 1 : -1;
      expect(Math.cos(s.testDrive.rot)).toBeCloseTo(toRoad, 5);
      for (let k = 0; k < 14; k++) {
        const z = s.testDrive.z + toRoad * k;
        const q = resolveCircle(s.testDrive.x, z, 1.2, world);
        expect(Math.hypot(q.x - s.testDrive.x, q.z - z), `${s.id} lane ${k}`).toBeLessThan(0.01);
      }
    }
  });
});

describe('showroom prices', () => {
  it('a new car costs its value plus the margin, never less than neutral demand', () => {
    const trends = neutralTrends();
    const value = marketValue(newShowroomCar('bugatti_chiron', '#fff'));
    expect(showroomPrice('bugatti_chiron', trends)).toBe(Math.round((value * ECONOMY.showrooms.markup) / 100) * 100);
    const slump = { ...trends, sports: 0.7 };
    expect(showroomPrice('bugatti_chiron', slump)).toBe(showroomPrice('bugatti_chiron', trends));
    expect(showroomPrice('bugatti_chiron', trends)).toBeLessThanOrEqual(ECONOMY.limits.maxPrice);
  });

  it('the Black Market never sells below what a quick sale pays back', () => {
    const car = { ...newShowroomCar('norda_arlo', '#fff'), condition: { engine: 30, transmission: 30, brakes: 30, tires: 30, body: 30, interior: 30, cleanliness: 20 }, mileage: 300_000 };
    expect(blackMarketPrice(car, 0.1)).toBeGreaterThan(quickSellPrice(car));
  });

  it('parses offer ids', () => {
    expect(parseShowroomOffer('new:toyota_supra_a80')).toEqual({ kind: 'new', modelId: 'toyota_supra_a80' });
    expect(parseShowroomOffer('bm:123:4')).toEqual({ kind: 'bm', epoch: 123, slot: 4 });
    expect(parseShowroomOffer('new:../../x')).toBeNull();
    expect(parseShowroomOffer('bm:1:999')).toBeNull();
  });
});

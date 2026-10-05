// Gang territories data (shared/gangs.ts): every zone holds its hangout, the hangouts stand clear of
// everything else, their doors and the places the members stand are free, the gang cars' roads end
// where there's room, the waves grow.

import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { GANG_ZONES, distToZone, findZone, hangoutSpots, waveMix, waveSize, zoneOf } from '../../shared/gangs';
import { CHAR_RADIUS, resolveCircle, type CollisionWorld } from '../../shared/physics';
import { BUILDINGS, STATIC_BOXES, STATIC_CIRCLES } from '../../shared/world';

const world: CollisionWorld = { boxes: STATIC_BOXES, circles: STATIC_CIRCLES, dynamic: [], vehicles: [] };
const free = (x: number, z: number) => {
  const r = resolveCircle(x, z, CHAR_RADIUS, world);
  return Math.hypot(r.x - x, r.z - z) < 0.05;
};

describe('gang territories: data', () => {
  it('four zones with the right protection money and waves', () => {
    expect(GANG_ZONES.map((z) => z.id)).toEqual(['sanayi', 'docks', 'downtown', 'touge']);
    expect(findZone('sanayi')!.income).toBe(12_000);
    expect(findZone('docks')!.income).toBe(18_000);
    expect(findZone('downtown')!.income).toBe(25_000);
    expect(findZone('touge')!.income).toBe(15_000);
    for (const z of GANG_ZONES) {
      expect(z.waves).toBeGreaterThanOrEqual(2);
      expect(z.waves).toBeLessThanOrEqual(3);
    }
  });

  it('each hangout is a building inside its zone, clear of everything else; its door and the posts round it are free', () => {
    for (const z of GANG_ZONES) {
      const b = z.venue.box;
      expect(zoneOf((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)?.id).toBe(z.id);
      expect(BUILDINGS.some((x) => x.id === `gang_${z.id}`)).toBe(true);
      const others = STATIC_BOXES.filter((o) => !(o.minX === b.minX && o.maxX === b.maxX && o.minZ === b.minZ && o.maxZ === b.maxZ));
      for (const o of others) expect(b.maxX <= o.minX || b.minX >= o.maxX || b.maxZ <= o.minZ || b.minZ >= o.maxZ, `${z.id} overlaps`).toBe(true);
      expect(free(z.venue.door.x, z.venue.door.z), `${z.id} door`).toBe(true);
      for (const s of hangoutSpots(z)) expect(free(s.x, s.z), `${z.id} post`).toBe(true);
    }
  });

  it('the gang cars come in along open roads and stop where there is room, in or by the zone', () => {
    for (const z of GANG_ZONES) {
      expect(z.lanes.length).toBeGreaterThan(0);
      for (const lane of z.lanes) {
        const end = lane[lane.length - 1]!;
        expect(distToZone(z, end.x, end.z), `${z.id} lane end`).toBeLessThan(20);
        for (const p of lane) expect(free(p.x, p.z), `${z.id} lane point ${p.x},${p.z}`).toBe(true);
      }
    }
  });

  it('the waves grow', () => {
    expect(waveSize(0)).toBe(waveMix(0).cars * 2 + waveMix(0).bikes);
    expect(waveSize(2)).toBeGreaterThan(waveSize(0));
    expect(waveSize(9)).toBe(waveSize(ECONOMY.gangs.waveMix.length - 1));
  });
});

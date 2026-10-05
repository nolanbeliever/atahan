// Night burglary data (shared/burglary.ts): the night window, the blinking lasers and sensors, the
// rooms (every loot spot reachable, nothing stuck in the furniture, rooms apart from each other and
// from the world), the doors on open pavement, the indoor collisions.

import { describe, expect, it } from 'vitest';
import {
  BURGLARY_TARGETS,
  INTERIOR_ZONE,
  LOOT_ITEM_IDS,
  LOOT_REACH,
  burglaryOpen,
  cycleOn,
  inInteriorZone,
  isLootItem,
  layoutOf,
  lootPawnRange,
  roomAt,
  roomBoxes,
  roomEntry,
  roomPoint,
  segDist,
} from '../../shared/burglary';
import { DAY_LENGTH_MS } from '../../shared/environment';
import { CHAR_RADIUS, resolveCircle, stepCharacter, KEY, type CollisionWorld } from '../../shared/physics';
import { STATIC_BOXES, STATIC_CIRCLES } from '../../shared/world';
import { WORLD_BOX } from '../../shared/strait';

const at = (hour: number) => (hour / 24) * DAY_LENGTH_MS + 5 * DAY_LENGTH_MS;
const world: CollisionWorld = { boxes: STATIC_BOXES, circles: STATIC_CIRCLES, dynamic: [], vehicles: [] };

describe('night burglaries: data', () => {
  it('open from 22:00 to 06:00 only', () => {
    for (const h of [22, 23, 0, 3, 5.9]) expect(burglaryOpen(at(h))).toBe(true);
    for (const h of [6, 9, 12, 18, 21.9]) expect(burglaryOpen(at(h))).toBe(false);
  });

  it('lasers and sensors blink on their cycle', () => {
    const c = { period: 4, on: 1.5, phase: 0 };
    expect(cycleOn(c, 0)).toBe(true);
    expect(cycleOn(c, 1400)).toBe(true);
    expect(cycleOn(c, 1600)).toBe(false);
    expect(cycleOn(c, 4100)).toBe(true);
    expect(cycleOn({ period: 0, on: 0, phase: 0 }, 123)).toBe(true);
    expect(segDist(0, 1, { x: -1, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(1);
    expect(segDist(3, 0, { x: -1, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(2);
  });

  it('every room is far from the world and from the other rooms', () => {
    for (const t of BURGLARY_TARGETS) {
      const e = roomEntry(t);
      expect(inInteriorZone(e.x, e.z)).toBe(true);
      expect(e.z).toBeLessThan(WORLD_BOX.minZ - 1000);
      expect(roomAt(e.x, e.z)?.id).toBe(t.id);
      const l = layoutOf(t);
      expect(t.room.x - l.w / 2).toBeGreaterThan(INTERIOR_ZONE.minX);
      expect(t.room.x + l.w / 2).toBeLessThan(INTERIOR_ZONE.maxX);
    }
    const ids = new Set(BURGLARY_TARGETS.map((t) => `${t.room.x},${t.room.z}`));
    expect(ids.size).toBe(BURGLARY_TARGETS.length);
  });

  it('the loot can be reached: every stand point is free and close to its loot; the entry is free', () => {
    for (const t of BURGLARY_TARGETS) {
      const boxes = roomBoxes(t);
      const free = (x: number, z: number) => boxes.every((b) => x + CHAR_RADIUS <= b.minX || x - CHAR_RADIUS >= b.maxX || z + CHAR_RADIUS <= b.minZ || z - CHAR_RADIUS >= b.maxZ);
      const e = roomEntry(t);
      expect(free(e.x, e.z), `${t.id} entry`).toBe(true);
      const l = layoutOf(t);
      expect(l.loot.filter((x) => x.kind === 'safe')).toHaveLength(1);
      for (const spot of l.loot) {
        const s = roomPoint(t, spot.stand.x, spot.stand.z);
        expect(free(s.x, s.z), `${t.id} ${spot.id} stand`).toBe(true);
        expect(Math.hypot(spot.stand.x - spot.x, spot.stand.z - spot.z), `${t.id} ${spot.id} reach`).toBeLessThanOrEqual(LOOT_REACH + 0.2);
        // Not standing in a laser or right on a knockable.
        for (const lz of l.lasers) expect(segDist(spot.stand.x, spot.stand.z, lz.a, lz.b)).toBeGreaterThan(0.6);
      }
    }
  });

  it('walls hold you in: walking at a wall stops at it (indoor collisions)', () => {
    const t = BURGLARY_TARGETS[0]!;
    const e = roomEntry(t);
    const c = { x: e.x, z: e.z, rot: 0, gait: 0 };
    // Walk backwards (out through the front wall) for two seconds.
    for (let i = 0; i < 60; i++) stepCharacter(c, { keys: KEY.BACK, yaw: 0, dt: 1 / 30 }, world);
    expect(c.z).toBeGreaterThan(t.room.z);
    expect(inInteriorZone(c.x, c.z)).toBe(true);
    // A point inside the counter is pushed out.
    const l = layoutOf(t);
    const b = l.boxes[0]!;
    const p = roomPoint(t, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    const r = resolveCircle(p.x, p.z, CHAR_RADIUS, world);
    expect(r.hit).toBe(true);
  });

  it('the front doors stand on open pavement (nothing solid there) next to their building', () => {
    for (const t of BURGLARY_TARGETS) {
      const r = resolveCircle(t.stand.x, t.stand.z, CHAR_RADIUS, world);
      expect(Math.hypot(r.x - t.stand.x, r.z - t.stand.z), t.id).toBeLessThan(0.3);
      // The door is on a solid wall.
      const inside = resolveCircle(t.door.x + (t.door.x - t.stand.x) * 0.5, t.door.z + (t.door.z - t.stand.z) * 0.5, CHAR_RADIUS, world);
      expect(inside.hit, `${t.id} wall`).toBe(true);
    }
  });

  it('loot items and their Pawn Shop prices', () => {
    for (const id of LOOT_ITEM_IDS) {
      expect(isLootItem(id)).toBe(true);
      const [lo, hi] = lootPawnRange(id);
      expect(hi).toBeGreaterThanOrEqual(lo);
    }
    expect(isLootItem('lockpick_set')).toBe(false);
    for (const t of BURGLARY_TARGETS) {
      expect(t.cash[0]).toBeGreaterThanOrEqual(15_000);
      expect(t.cash[1]).toBeLessThanOrEqual(35_000);
    }
  });
});

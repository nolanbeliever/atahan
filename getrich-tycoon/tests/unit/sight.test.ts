// Police line of sight: buildings, ramps and piers block it, the car only sees ahead (within its
// cone and range) or right next to it, and decks don't see the ground.

import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { inFieldOfView, lineOfSight, policeSees, segmentHitsAabb, SIGHT_MIN_RADIUS, type SightWorld } from '../../shared/sight';
import { RAMP_BLOCKS } from '../../shared/strait';
import { BUILDINGS, STATIC_BOXES, STATIC_CIRCLES } from '../../shared/world';

const WORLD: SightWorld = { boxes: STATIC_BOXES, circles: STATIC_CIRCLES };
const bank = BUILDINGS.find((b) => b.id === 'bank')!.box;

describe('police line of sight', () => {
  it('segment-box test', () => {
    const b = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    expect(segmentHitsAabb(-5, 5, 15, 5, b)).toBe(true);
    expect(segmentHitsAabb(-5, -1, 15, -1, b)).toBe(false);
    expect(segmentHitsAabb(-5, -5, 15, 15, b)).toBe(true);
    expect(segmentHitsAabb(-5, 5, -1, 5, b)).toBe(false);
    // Vertical segment beside the box.
    expect(segmentHitsAabb(11, -5, 11, 15, b)).toBe(false);
    expect(segmentHitsAabb(5, -5, 5, 15, b)).toBe(true);
  });

  it('a building between the police car and the player blocks the view', () => {
    const z = (bank.minZ + bank.maxZ) / 2;
    expect(lineOfSight(bank.minX - 5, z, 0, bank.maxX + 6, z, 0, WORLD)).toBe(false);
    // Along the side of the building: clear.
    expect(lineOfSight(bank.minX - 5, z, 0, bank.minX - 5, bank.minZ - 14, 0, WORLD)).toBe(true);
    expect(policeSees(bank.minX - 5, bank.minZ - 14, 0, 0, bank.minX - 5, z, 0, WORLD)).toBe(true);
    expect(policeSees(bank.maxX + 6, z, 0, -Math.PI / 2, bank.minX - 5, z, 0, WORLD)).toBe(false);
  });

  it('the car sees ahead within its cone and range, behind it only right next to it', () => {
    const s = ECONOMY.police.sight;
    // Facing +z.
    expect(inFieldOfView(0, 0, 0, 0, 50)).toBe(true);
    expect(inFieldOfView(0, 0, 0, 0, s.range + 5)).toBe(false);
    expect(inFieldOfView(0, 0, 0, 0, -40)).toBe(false);
    expect(inFieldOfView(0, 0, 0, 0, -(s.nearSense - 1))).toBe(true);
    // At the edge of the cone.
    const half = ((s.fovDeg / 2) * Math.PI) / 180;
    expect(inFieldOfView(0, 0, 0, Math.sin(half - 0.05) * 60, Math.cos(half - 0.05) * 60)).toBe(true);
    expect(inFieldOfView(0, 0, 0, Math.sin(half + 0.05) * 60, Math.cos(half + 0.05) * 60)).toBe(false);
  });

  it('up on a deck and down below never see each other; the ramp embankments block the view', () => {
    expect(lineOfSight(300, -50, 1, 300, -40, 0, WORLD)).toBe(false);
    expect(lineOfSight(300, -50, 1, 400, -50, 1, WORLD)).toBe(true);
    const r = RAMP_BLOCKS[0]!;
    const z = (r.minZ + r.maxZ) / 2;
    const x = (r.minX + r.maxX) / 2;
    expect(lineOfSight(x, r.minZ - 15, 0, x, r.maxZ + 15, 0, WORLD)).toBe(false);
    expect(lineOfSight(x, z - 40, 0, x + 1, z - 30, 0, WORLD)).toBe(true);
  });

  it('thick columns block the view, thin ones (trees, lamp posts) do not', () => {
    const w: SightWorld = { boxes: [], circles: [{ x: 0, z: 10, r: SIGHT_MIN_RADIUS + 0.5 }, { x: 20, z: 10, r: 0.3 }] };
    expect(lineOfSight(0, 0, 0, 0, 20, 0, w)).toBe(false);
    expect(lineOfSight(20, 0, 0, 20, 20, 0, w)).toBe(true);
  });
});

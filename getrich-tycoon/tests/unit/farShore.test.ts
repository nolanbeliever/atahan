// The far shore: the hill, the touge and its guardrails, the docks yard, the road graph over it.

import { describe, expect, it } from 'vitest';
import {
  BOULEVARD,
  CONTAINER_STACKS,
  DOCKS,
  DOCKS_GATE,
  DOCKS_ROAD,
  FAR_WALLS,
  HILL,
  HILL_TREES,
  TOUGE_HALF,
  TOUGE_PATH,
  TOUGE_RAIL,
  crossesWall,
  distToTouge,
  rayHitsHill,
  standHeight,
  terrainHeight,
} from '../../shared/farShore';
import { KEY, newVehicleDyn, stepVehicle, vehicleParams, type CollisionWorld } from '../../shared/physics';
import { NAV_NODES } from '../../shared/roadGraph';
import { BRIDGES, VIP_HALF, VIP_X, WATER, WORLD_BOX } from '../../shared/strait';
import { getModel } from '../../shared/vehicles';

const empty: CollisionWorld = { boxes: [], circles: [], dynamic: [], vehicles: [] };
const good = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

describe('the hill', () => {
  it('rises to its top in the middle and is flat beyond it', () => {
    expect(terrainHeight(HILL.x, HILL.z)).toBeCloseTo(HILL.top, 5);
    expect(terrainHeight(HILL.x + HILL.rx + 1, HILL.z)).toBe(0);
    expect(terrainHeight(VIP_X, 0)).toBe(0);
    // Up on a bridge deck the deck's height counts, on the ground the hill's.
    expect(standHeight(BRIDGES[0]!.n, 420, BRIDGES[0]!.z)).toBeGreaterThan(9);
    expect(standHeight(0, HILL.x, HILL.z)).toBeCloseTo(HILL.top, 5);
  });

  it('a shot fired along the ground into the hill hits it', () => {
    const t = rayHitsHill(HILL.x - HILL.rx - 20, 1.4, HILL.z, 1, 0, 0, 300);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(20);
    expect(t!).toBeLessThan(80);
    // Shooting up into the sky from its top: nothing.
    expect(rayHitsHill(HILL.x, HILL.top + 1.4, HILL.z, 1, 0, 0.5, 200)).toBeNull();
  });
});

describe('the touge', () => {
  it('runs from the VIP Otoban over the hill to the boulevard, climbing it', () => {
    const a = TOUGE_PATH[0]!;
    const b = TOUGE_PATH[TOUGE_PATH.length - 1]!;
    expect(a.x).toBeCloseTo(VIP_X + VIP_HALF, 0);
    expect(b.z).toBeCloseTo(BOULEVARD.minZ, 0);
    const top = Math.max(...TOUGE_PATH.map((p) => terrainHeight(p.x, p.z)));
    expect(top).toBeGreaterThan(HILL.top * 0.8);
    // Every point is in the world and on the far shore.
    for (const p of TOUGE_PATH) {
      expect(p.x).toBeGreaterThan(WATER.east);
      expect(p.x).toBeLessThan(WORLD_BOX.maxX - TOUGE_RAIL);
      expect(p.z).toBeGreaterThan(WORLD_BOX.minZ + TOUGE_RAIL);
    }
  });

  it('never runs into itself: parts of the road far apart along it are at least a road and two rails apart', () => {
    const p = TOUGE_PATH;
    const along: number[] = [0];
    for (let i = 1; i < p.length; i++) along.push(along[i - 1]! + Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.z - p[i - 1]!.z));
    let min = Infinity;
    for (let i = 0; i < p.length; i += 2) {
      for (let j = i + 2; j < p.length; j += 2) {
        if (along[j]! - along[i]! < 45) continue;
        min = Math.min(min, Math.hypot(p[i]!.x - p[j]!.x, p[i]!.z - p[j]!.z));
      }
    }
    expect(min).toBeGreaterThan(TOUGE_RAIL * 2 + 2);
  });

  it('the guardrails keep a car on the road (it cannot cut across a hairpin)', () => {
    expect(FAR_WALLS.length).toBeGreaterThan(200);
    // At the first leg, heading north (across the road) at speed.
    const v = newVehicleDyn(800, -236, 0);
    v.speed = 20;
    const p = vehicleParams(getModel('norda_arlo'), good, 100);
    for (let i = 0; i < 60; i++) stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, empty);
    expect(distToTouge(v.x, v.z)).toBeLessThan(TOUGE_RAIL);
    // A straight line between two legs crosses a rail; one along the road does not.
    expect(crossesWall(800, -236, 800, -214)).toBe(true);
    expect(crossesWall(760, -236, 840, -236)).toBe(false);
  });

  it('trees stand clear of the road', () => {
    for (const t of HILL_TREES) expect(distToTouge(t.x, t.z)).toBeGreaterThan(TOUGE_HALF + 4);
  });
});

describe('the docks and the road graph', () => {
  it('container stacks leave the roads and gates open', () => {
    const overlaps = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
    for (const c of CONTAINER_STACKS) {
      expect(c.minX).toBeGreaterThan(DOCKS.minX);
      expect(c.maxX).toBeLessThan(DOCKS.maxX);
      expect(overlaps(c, DOCKS_ROAD)).toBe(false);
      expect(overlaps(c, DOCKS_GATE)).toBe(false);
      // The docks road's lane carries on into the yard.
      expect(c.maxX <= DOCKS_ROAD.minX - 3 || c.minX >= DOCKS_ROAD.maxX + 3 || c.maxZ < 180).toBe(true);
    }
  });

  it('the far shore is on the police map: the touge, the boulevard and the docks', () => {
    const near = (x: number, z: number) => NAV_NODES.some((n) => Math.hypot(n.x - x, n.z - z) < 12);
    expect(near(HILL.x, -148)).toBe(true);
    expect(near(875, 214)).toBe(true);
    expect(near(1030, 40)).toBe(true);
  });
});

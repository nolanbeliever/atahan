// The back alleys: only bikes and ATVs fit between the bollards, cars stop dead at them, the
// apartment rows hide you from the police outside, and the steps behind Wrench Bros rise and fall.

import { describe, expect, it } from 'vitest';
import { ALLEY_BUILDINGS, ALLEY_HALF, ALLEYS, BOLLARD_R, BOLLARDS, alleyAt, alleyBox, alleyPoint, alleyRise } from '../../shared/alleys';
import { modelBoxHalfExtents } from '../../shared/collision';
import { KMH_PER_MS } from '../../shared/drivetrain';
import { KEY, newVehicleDyn, stepVehicle, vehicleParams, type CollisionWorld } from '../../shared/physics';
import { policeSees } from '../../shared/sight';
import { VEHICLE_MODELS, getModel } from '../../shared/vehicles';
import { INTERACTABLES, PLOTS, PLOT_HALF, ROADS, STATIC_BOXES, STATIC_CIRCLES } from '../../shared/world';

const WORLD: CollisionWorld = { boxes: STATIC_BOXES, circles: STATIC_CIRCLES, dynamic: [], vehicles: [] };
const GOOD = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
const overlaps = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

/** Ride / drive straight along an alley from outside one end; how far along it got. */
function run(modelId: string, a: (typeof ALLEYS)[number], sec = 9): { along: number; startKmh: number } {
  const p = vehicleParams(getModel(modelId), GOOD, 100);
  // From the street just outside the end.
  const start = alleyPoint(a, a.from - 12, 0);
  const rot = a.axis === 'x' ? Math.PI / 2 : 0;
  const v = newVehicleDyn(start.x, start.z, rot);
  v.speed = 85 / KMH_PER_MS;
  v.gear = 3;
  for (let t = 0; t < sec; t += 1 / 30) stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, WORLD);
  return { along: a.axis === 'x' ? v.x : v.z, startKmh: 85 };
}

describe('back alleys', () => {
  it('the bollard gaps let every bike and ATV through and stop every car', () => {
    const widths = VEHICLE_MODELS.map((m) => ({ kind: m.specs.kind, w: modelBoxHalfExtents(m.id)!.hw * 2 }));
    const widestBike = Math.max(...widths.filter((x) => x.kind === 'bike').map((x) => x.w));
    const narrowestCar = Math.min(...widths.filter((x) => x.kind !== 'bike').map((x) => x.w));
    const third = (ALLEY_HALF * 2) / 3;
    const gaps = [third - BOLLARD_R, third - 2 * BOLLARD_R];
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(widestBike + 0.2);
      expect(gap).toBeLessThan(narrowestCar);
    }
    expect(BOLLARDS).toHaveLength(ALLEYS.length * 4);
  });

  it('the passages are open and the apartment rows stay off roads, plots and service points', () => {
    for (const a of ALLEYS) {
      const pass = alleyBox(a);
      for (const b of STATIC_BOXES) expect(overlaps(pass, b)).toBe(false);
    }
    for (const b of ALLEY_BUILDINGS) {
      for (const r of ROADS) expect(overlaps(b.box, r)).toBe(false);
      for (const p of PLOTS) expect(overlaps(b.box, { minX: p.cx - PLOT_HALF, maxX: p.cx + PLOT_HALF, minZ: p.cz - PLOT_HALF, maxZ: p.cz + PLOT_HALF })).toBe(false);
      for (const i of INTERACTABLES) expect(i.x > b.box.minX - i.radius && i.x < b.box.maxX + i.radius && i.z > b.box.minZ - i.radius && i.z < b.box.maxZ + i.radius).toBe(false);
    }
  });

  it('a car at speed stops dead at the bollards; a motorcycle and an ATV ride the whole alley', () => {
    for (const a of ALLEYS) {
      const car = run('norda_pixi', a);
      expect(car.along).toBeLessThan(a.from + 1);
      const bike = run('ktm_duke390', a);
      expect(bike.along).toBeGreaterThan(a.to);
      const atv = run('granforge_mudhog', a);
      expect(atv.along).toBeGreaterThan(a.to);
    }
  });

  it('the steps behind Wrench Bros climb to a raised courtyard and come back down', () => {
    const a = ALLEYS.find((x) => x.stairs)!;
    const s = a.stairs!;
    const h = (t: number) => alleyRise(...(Object.values(alleyPoint(a, t, 0)) as [number, number]));
    expect(h(s.up - 1)).toBe(0);
    expect(h((s.up + s.top) / 2)).toBeCloseTo(s.rise / 2, 5);
    expect(h((s.top + s.down) / 2)).toBe(s.rise);
    expect(h(s.end + 1)).toBe(0);
    // Outside the alley there are no steps.
    expect(alleyRise(alleyPoint(a, (s.top + s.down) / 2, ALLEY_HALF + 3).x, alleyPoint(a, (s.top + s.down) / 2, ALLEY_HALF + 3).z)).toBe(0);
    expect(alleyAt(alleyPoint(a, s.top, 0).x, alleyPoint(a, s.top, 0).z)?.id).toBe(a.id);
  });

  it('police outside the block can’t see into an alley; looking down it from the end they can', () => {
    const sight = { boxes: STATIC_BOXES, circles: STATIC_CIRCLES };
    for (const a of ALLEYS) {
      const inside = alleyPoint(a, (a.from + a.to) / 2, 0);
      const beside = alleyPoint(a, (a.from + a.to) / 2, ALLEY_HALF + 30);
      const end = alleyPoint(a, a.from - 6, 0);
      const toIn = Math.atan2(inside.x - beside.x, inside.z - beside.z);
      expect(policeSees(beside.x, beside.z, 0, toIn, inside.x, inside.z, 0, sight)).toBe(false);
      const down = Math.atan2(inside.x - end.x, inside.z - end.z);
      expect(policeSees(end.x, end.z, 0, down, inside.x, inside.z, 0, sight)).toBe(true);
    }
  });
});

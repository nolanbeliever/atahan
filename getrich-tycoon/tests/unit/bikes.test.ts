// Motorcycles and the quad: wheelies (lift, balance, flip), the pillion seat, crash damage and the
// helmet catalogue.

import { describe, expect, it } from 'vitest';
import { KMH_PER_MS } from '../../shared/drivetrain';
import { ECONOMY } from '../../shared/economy.config';
import { HELMETS, VISORS, crashDamage, ownedVisors } from '../../shared/helmets';
import { passengerSeats } from '../../shared/passengers';
import { KEY, newVehicleDyn, stepVehicle, vehicleParams, type CollisionWorld, type VehicleDyn } from '../../shared/physics';
import { CATALOG_MODELS, getModel } from '../../shared/vehicles';

const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
const empty: CollisionWorld = { boxes: [], circles: [], dynamic: [], vehicles: [] };
const B = ECONOMY.bikes;

function ride(id: string, kmh: number): { d: VehicleDyn; step: (keys: number, sec: number) => boolean } {
  const p = vehicleParams(getModel(id), PERFECT, 100);
  const d = newVehicleDyn(0, 0, 0);
  d.speed = kmh / KMH_PER_MS;
  d.gear = 3;
  return {
    d,
    step: (keys, sec) => {
      let flipped = false;
      for (let t = 0; t < sec; t += 1 / 60) flipped ||= !!stepVehicle(d, { keys, dt: 1 / 60 }, p, empty).flipped;
      return flipped;
    },
  };
}

describe('motorcycles', () => {
  it('five new rides in the Moto & ATV category, all with a pillion seat', () => {
    const moto = CATALOG_MODELS.filter((m) => m.category === 'moto');
    expect(moto).toHaveLength(5);
    for (const m of moto) {
      expect(m.specs.kind).toBe('bike');
      expect(passengerSeats(m)).toBe(1);
    }
    expect(getModel('granforge_mudhog').shape.style).toBe('atv');
    expect(vehicleParams(getModel('granforge_mudhog'), PERFECT, 100).wheelie).toBe(false);
    expect(vehicleParams(getModel('yamaha_mt09'), PERFECT, 100).wheelie).toBe(true);
  });

  it('no wheelie below the minimum speed, the front comes up above it', () => {
    // (Briefly: the MT-09 gets to the minimum speed quickly.)
    const slow = ride('yamaha_mt09', B.wheelieMinKmh - 25);
    slow.step(KEY.FORWARD | KEY.SPRINT, 0.25);
    expect(slow.d.wheelie ?? 0).toBe(0);
    const fast = ride('yamaha_mt09', 75);
    fast.step(KEY.FORWARD | KEY.SPRINT, 0.5);
    expect(fast.d.wheelie!).toBeGreaterThan(0.1);
    // Without the throttle there is no lift.
    const coast = ride('yamaha_mt09', 75);
    coast.step(KEY.SPRINT, 0.6);
    expect(coast.d.wheelie ?? 0).toBe(0);
  });

  it('let go and the front comes back down; the brake drops it faster', () => {
    const a = ride('yamaha_mt09', 80);
    a.step(KEY.FORWARD | KEY.SPRINT, 0.45);
    const up = a.d.wheelie!;
    expect(up).toBeGreaterThan(0.1);
    expect(up).toBeLessThan(B.wheelieBalance);
    a.step(KEY.FORWARD, 2.5);
    expect(a.d.wheelie).toBe(0);
    const b = ride('yamaha_mt09', 80);
    b.step(KEY.FORWARD | KEY.SPRINT, 0.45);
    let tFree = 0;
    const c = ride('yamaha_mt09', 80);
    c.step(KEY.FORWARD | KEY.SPRINT, 0.45);
    while ((c.d.wheelie ?? 0) > 0 && tFree < 5) {
      c.step(KEY.FORWARD, 0.05);
      tFree += 0.05;
    }
    let tBrake = 0;
    while ((b.d.wheelie ?? 0) > 0 && tBrake < 5) {
      b.step(KEY.BACK, 0.05);
      tBrake += 0.05;
    }
    expect(tBrake).toBeLessThan(tFree);
  });

  it('feathering the key holds a wheelie; holding it too long flips the bike', () => {
    const f = ride('yamaha_mt09', 85);
    let maxA = 0;
    let flipped = false;
    // Hold while low, let go while high: a balanced wheelie for 4 s.
    for (let i = 0; i < 240; i++) {
      const keys = KEY.FORWARD | ((f.d.wheelie ?? 0) < 0.5 ? KEY.SPRINT : 0);
      flipped ||= f.step(keys, 1 / 60);
      maxA = Math.max(maxA, f.d.wheelie ?? 0);
    }
    expect(flipped).toBe(false);
    expect(f.d.wheelie!).toBeGreaterThan(0.2);
    expect(maxA).toBeLessThan(B.wheelieFlip);
    const g = ride('yamaha_mt09', 85);
    const before = g.d.speed;
    expect(g.step(KEY.FORWARD | KEY.SPRINT, 4)).toBe(true);
    expect(g.d.wheelie).toBe(0);
    expect(g.d.speed).toBeLessThan(before * 0.5);
  });

  it('a wheelie travels in the wire state', async () => {
    const { dynToTuple, dynFromTuple } = await import('../../shared/physics');
    const r = ride('yamaha_mt09', 80);
    r.step(KEY.FORWARD | KEY.SPRINT, 0.4);
    const back = dynFromTuple(dynToTuple(r.d));
    expect(back.wheelie).toBeCloseTo(r.d.wheelie!, 3);
    expect(back.wheelieV).toBeCloseTo(r.d.wheelieV!, 3);
  });
});

describe('helmets and crashes', () => {
  it('sells four shells and four visors; the clear visor is free', () => {
    expect(HELMETS.map((h) => h.id)).toEqual(['sport', 'premium', 'cross', 'custom']);
    expect(VISORS.map((v) => v.id)).toEqual(['clear', 'dark', 'iridium', 'gold']);
    expect(VISORS[0]!.price).toBe(0);
    expect(ownedVisors({}).map((v) => v.id)).toEqual(['clear']);
    expect(ownedVisors({ visor_gold: 1 }).map((v) => v.id)).toEqual(['clear', 'gold']);
  });

  it('crash damage: nothing slow, fatal fast without a helmet, 60% less with one', () => {
    expect(crashDamage(B.safeKmh - 1, false, 100)).toBe(0);
    expect(crashDamage(B.fatalKmh, false, 100)).toBe(100);
    expect(crashDamage(140, false, 73)).toBe(73);
    const bare = crashDamage(B.fatalKmh - 5, false, 100);
    const lid = crashDamage(B.fatalKmh - 5, true, 100);
    expect(bare).toBeGreaterThan(0);
    expect(lid).toBe(Math.round(bare * 0.4));
    // A helmet saves you even at speed.
    expect(crashDamage(140, true, 100)).toBeLessThan(100);
  });
});

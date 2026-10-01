// Car theft rules and layout: the lock, the parts and their prices, the Black Market's restock
// clock, the lifts, and where the street cars and the Sanayi sit in the world.

import { describe, expect, it } from 'vitest';
import { worldBoxes } from '../../shared/collision';
import { ECONOMY } from '../../shared/economy.config';
import { DRAG_STRIP, nearHighway, projectToHighway } from '../../shared/highway';
import {
  LIFT_BAYS,
  LIFT_POST_X,
  SANAYI,
  SANAYI_BOXES,
  STREET_SPOTS,
  STRIP_PARTS,
  bayAt,
  blackMarketEpoch,
  inSanayi,
  lockDifficulty,
  lockTolerance,
  lockTurn,
  nextRestockAt,
  parsePartItem,
  partItemId,
  partLabelTr,
  partProfile,
  partShare,
  partsFor,
  pawnCarPrice,
  pawnPrice,
  stealable,
  stockLeft,
  valueTier,
} from '../../shared/theft';
import { VEHICLE_MODELS, getModel } from '../../shared/vehicles';
import { INTERACTABLES, ROADS, isOnRoad, type AABB } from '../../shared/world';

const T = ECONOMY.theft;
const inBox = (b: AABB, x: number, z: number, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

describe('the lock', () => {
  it('opens only inside the tolerance and turns less the further off the pick is', () => {
    expect(lockTurn(0, 5)).toBe(1);
    expect(lockTurn(-5, 5)).toBe(1);
    expect(lockTurn(5.01, 5)).toBeLessThan(1);
    expect(lockTurn(6, 5)).toBeLessThanOrEqual(0.92);
    let prev = 1;
    for (let d = 6; d <= 70; d += 4) {
      const t = lockTurn(d, 5);
      expect(t).toBeLessThanOrEqual(prev);
      prev = t;
    }
    expect(lockTurn(5 + T.turnRange, 5)).toBe(0);
    expect(lockTurn(-(5 + T.turnRange + 10), 5)).toBe(0);
  });

  it('dearer cars have tighter locks', () => {
    const byPrice = [...VEHICLE_MODELS].sort((a, b) => a.basePrice - b.basePrice);
    const cheap = byPrice[0]!;
    const dear = byPrice[byPrice.length - 1]!;
    expect(lockTolerance(cheap)).toBeGreaterThan(lockTolerance(dear));
    expect(lockDifficulty(cheap)).toBe('easy');
    expect(lockDifficulty(dear)).toBe('extreme');
  });
});

describe('parts and the Pawn Shop', () => {
  it('pays $10,000-$15,000 for a whole car (araç başı), more for a dearer car', () => {
    expect(pawnCarPrice(0, 0)).toBe(T.pawnMin);
    expect(pawnCarPrice(3, 1)).toBe(T.pawnMax);
    for (let tier = 0; tier <= 3; tier++) {
      for (const r of [0, 0.25, 0.5, 0.75, 1]) {
        const car = pawnCarPrice(tier, r);
        expect(car).toBeGreaterThanOrEqual(T.pawnMin);
        expect(car).toBeLessThanOrEqual(T.pawnMax);
        if (tier > 0) expect(car).toBeGreaterThan(pawnCarPrice(tier - 1, r));
        if (r > 0) expect(car).toBeGreaterThan(pawnCarPrice(tier, r - 0.25));
      }
    }
  });

  it('splits a car\u2019s price over its parts: every car\u2019s parts add up to its price', () => {
    for (const m of VEHICLE_MODELS.filter((v) => stealable(v.id))) {
      const profile = partProfile(m);
      const parts = partsFor(m);
      expect(parts.reduce((a, p) => a + partShare(p, profile), 0)).toBeCloseTo(1, 9);
      for (let tier = 0; tier <= 3; tier++) {
        for (const r of [0, 0.5, 1]) {
          const sum = parts.reduce((a, p) => a + pawnPrice(p, tier, r, profile), 0);
          expect(sum).toBeCloseTo(pawnCarPrice(tier, r), 6);
          expect(sum).toBeGreaterThanOrEqual(T.pawnMin - 1e-6);
          expect(sum).toBeLessThanOrEqual(T.pawnMax + 1e-6);
        }
      }
    }
    // Big parts are worth more than small ones; a part a car doesn't have is worth nothing.
    expect(pawnPrice('engine', 0, 0.5)).toBeGreaterThan(pawnPrice('mirrors', 0, 0.5));
    expect(pawnPrice('seats', 3, 0.5)).toBeGreaterThan(pawnPrice('seats', 0, 0.5));
    expect(partShare('exhaust', 'e')).toBe(0);
    expect(partShare('turbo', 'n')).toBe(0);
  });

  it('every car has the body and engine parts it should', () => {
    for (const m of VEHICLE_MODELS.filter((v) => stealable(v.id))) {
      const parts = partsFor(m);
      for (const always of ['mirrors', 'doors', 'seats', 'steering', 'engine', 'gearbox', 'radiator', 'battery', 'ecu'] as const) expect(parts).toContain(always);
      const asp = m.specs.aspiration;
      expect(parts.includes('exhaust')).toBe(asp !== 'electric');
      expect(parts.includes('alternator')).toBe(asp !== 'electric');
      expect(parts.includes('turbo')).toBe(asp === 'turbo' || asp === 'twin_turbo' || asp === 'supercharged');
    }
  });

  it('names an electric car’s engine its motor', () => {
    const ev = VEHICLE_MODELS.find((m) => m.specs.aspiration === 'electric')!;
    expect(partLabelTr('engine', ev)).toBe('Elektrik Motoru');
    expect(partLabelTr('engine')).toBe('Motor Bloğu');
  });

  it('round-trips inventory ids and rejects anything else', () => {
    for (const p of STRIP_PARTS) {
      for (let tier = 0; tier <= 3; tier++) {
        for (const profile of ['e', 'n', 't'] as const) expect(parsePartItem(partItemId(p.id, tier, profile))).toEqual({ part: p.id, tier, profile });
      }
    }
    expect(partItemId('engine', 9, 'n')).toBe('stolen_part:engine:3:n');
    // Ids from before the car profile was added count as forced-induction cars.
    expect(parsePartItem('stolen_part:seats:2')).toEqual({ part: 'seats', tier: 2, profile: 't' });
    for (const bad of ['stolen_part:wheels:1:t', 'stolen_part:engine:4:t', 'stolen_part:engine:1:x', 'stolen_part:engine', 'engine_kit', 'lockpick_set']) expect(parsePartItem(bad)).toBeNull();
  });

  it('values cars in four tiers', () => {
    const tiers = new Set(VEHICLE_MODELS.map((m) => valueTier(m)));
    expect([...tiers].every((t) => t >= 0 && t <= 3)).toBe(true);
    expect(tiers.size).toBeGreaterThanOrEqual(3);
  });

  it('only cars from the catalogue are parked to be stolen (no bikes, no exclusives)', () => {
    for (const m of VEHICLE_MODELS) expect(stealable(m.id)).toBe(m.specs.kind !== 'bike' && !m.exclusive);
  });
});

describe('Black Market stock', () => {
  it('refills to five at the start of every ten-minute window', () => {
    const w = T.restockSec * 1000;
    const t = 1_700_000_123_456;
    expect(nextRestockAt(t)).toBe((Math.floor(t / w) + 1) * w);
    expect(blackMarketEpoch(nextRestockAt(t))).toBe(blackMarketEpoch(t) + 1);
    expect(blackMarketEpoch(nextRestockAt(t) - 1)).toBe(blackMarketEpoch(t));
    expect(stockLeft(0)).toBe(5);
    expect(stockLeft(3)).toBe(2);
    expect(stockLeft(9)).toBe(0);
  });
});

describe('Sanayi and the lifts', () => {
  it('knows which bay a car is lined up in', () => {
    LIFT_BAYS.forEach((b, i) => {
      expect(bayAt(b.x, b.z, b.yaw)).toBe(i);
      expect(bayAt(b.x + 0.6, b.z - 2, b.yaw + 0.3)).toBe(i);
      // Driven in backwards is fine too.
      expect(bayAt(b.x, b.z, b.yaw + Math.PI)).toBe(i);
      expect(bayAt(b.x + 2, b.z, b.yaw)).toBe(-1);
      expect(bayAt(b.x, b.z + 4, b.yaw)).toBe(-1);
      expect(bayAt(b.x, b.z, b.yaw + Math.PI / 2)).toBe(-1);
    });
  });

  it('puts every work spot inside the hall, clear of the lift posts and walls', () => {
    const hall = SANAYI.hall;
    for (const m of VEHICLE_MODELS.filter((v) => stealable(v.id))) {
      for (const b of LIFT_BAYS) {
        for (const rot of [b.yaw, b.yaw + Math.PI]) {
          for (const p of STRIP_PARTS) {
            const local = p.point(m.shape.length, m.shape.width);
            const x = b.x + Math.cos(rot) * local.x + Math.sin(rot) * local.z;
            const z = b.z - Math.sin(rot) * local.x + Math.cos(rot) * local.z;
            expect(x > hall.minX + 0.6 && x < hall.maxX - 0.6 && z > hall.minZ && z < hall.maxZ - 0.6, `${m.id} ${p.id}`).toBe(true);
            for (const s of [-1, 1]) expect(Math.hypot(x - (b.x + s * LIFT_POST_X), z - b.z), `${m.id} ${p.id}`).toBeGreaterThan(0.75);
          }
        }
      }
    }
  });

  it('keeps the work spots apart: standing at one, the server refuses the others', () => {
    for (const m of VEHICLE_MODELS.filter((v) => stealable(v.id))) {
      const spots = new Map<string, { x: number; z: number }>();
      for (const p of STRIP_PARTS) spots.set(p.group === 'engine' ? 'bay' : p.id, p.point(m.shape.length, m.shape.width));
      const list = [...spots.entries()];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const [a, pa] = list[i]!;
          const [b, pb] = list[j]!;
          expect(Math.hypot(pa.x - pb.x, pa.z - pb.z), `${m.id} ${a}-${b}`).toBeGreaterThan(T.stripReach + 0.5);
        }
      }
    }
  });

  it('keeps the lifts far enough apart for two cars and the work spots between them', () => {
    const [a, b] = LIFT_BAYS;
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(2 * (LIFT_POST_X + 2.5));
  });

  it('sits between the city and the highway, off the roads, with a clear driveway', () => {
    const y = SANAYI.yard;
    for (const [x, z] of [
      [y.minX, y.maxZ],
      [y.maxX, y.maxZ],
    ]) expect(Math.abs(projectToHighway(x!, z!).offset)).toBeGreaterThan(20);
    for (const box of SANAYI_BOXES) for (const r of ROADS) expect(overlaps(box, r)).toBe(false);
    for (const x of [SANAYI.entry.x - SANAYI.entry.width / 2 + 1, SANAYI.entry.x, SANAYI.entry.x + SANAYI.entry.width / 2 - 1]) {
      for (let z = 150; z <= SANAYI.hall.minZ; z += 1) expect(worldBoxes(new Map()).some((b) => inBox(b, x, z, 0.5)), `driveway ${x},${z}`).toBe(false);
    }
    const pawn = INTERACTABLES.find((i) => i.kind === 'pawn')!;
    const office = INTERACTABLES.find((i) => i.kind === 'sanayi')!;
    expect(inSanayi(pawn.x, pawn.z)).toBe(true);
    expect(inSanayi(office.x, office.z)).toBe(true);
    expect(worldBoxes(new Map()).some((b) => inBox(b, pawn.x, pawn.z))).toBe(false);
  });
});

describe('street-parked cars', () => {
  const boxes = worldBoxes(new Map());
  it('park at the kerb in the city and on the highway shoulder, clear of buildings', () => {
    const city = STREET_SPOTS.filter((s) => !s.highway);
    const hw = STREET_SPOTS.filter((s) => s.highway);
    expect(city.length).toBeGreaterThanOrEqual(T.streetCars);
    expect(hw.length).toBeGreaterThanOrEqual(T.highwayCars);
    for (const s of city) {
      expect(isOnRoad(s.x, s.z), `${s.x},${s.z}`).toBe(true);
      expect(boxes.some((b) => inBox(b, s.x, s.z, 2.6))).toBe(false);
    }
    for (const s of hw) {
      expect(nearHighway(s.x, s.z)).toBe(true);
      const h = projectToHighway(s.x, s.z);
      // On the shoulder: beyond the outer lane, inside the guardrail.
      expect(Math.abs(h.offset)).toBeGreaterThan(1.8 + 4 * 3.6);
      expect(Math.abs(h.offset)).toBeLessThan(19);
      expect(Math.hypot(s.x - DRAG_STRIP.stage.x, s.z - DRAG_STRIP.stage.z)).toBeGreaterThan(30);
    }
  });

  it('are spread out (no two spots closer than a car length or two)', () => {
    for (let i = 0; i < STREET_SPOTS.length; i++) {
      for (let j = i + 1; j < STREET_SPOTS.length; j++) {
        const a = STREET_SPOTS[i]!;
        const b = STREET_SPOTS[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(9);
      }
    }
  });

  it('every stealable model fits its kerb spot without touching a building', () => {
    const longest = Math.max(...VEHICLE_MODELS.filter((m) => stealable(m.id)).map((m) => getModel(m.id).shape.length));
    for (const s of STREET_SPOTS.filter((x) => !x.highway)) {
      const fx = Math.sin(s.rot);
      const fz = Math.cos(s.rot);
      for (const k of [-0.5, 0.5]) expect(boxes.some((b) => inBox(b, s.x + fx * longest * k, s.z + fz * longest * k, 1))).toBe(false);
    }
  });
});

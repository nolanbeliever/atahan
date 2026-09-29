import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import {
  BELT_TREES,
  CROSSOVERS,
  DAY_LENGTH_MS,
  DRAG_STRIP,
  GUARDRAIL_OFFSET,
  HIGHWAY_BARRIERS,
  JUNCTIONS,
  LOOP_LEN,
  deltaS,
  gameHour,
  inGap,
  inJunctionArea,
  laneOffset,
  nightFactor,
  pathPoint,
  pathYaw,
  projectToHighway,
  wrapS,
} from '../../shared/highway';
import { KEY, resolveCircle, stepVehicle, vehicleParams, type CollisionWorld } from '../../shared/physics';
import { LANE_MAX_KMH, TRAFFIC_COUNT, TRAFFIC_KMH_PER_MS, homeLaneFor, trafficCircles, trafficSpec } from '../../shared/traffic';
import { getModel } from '../../shared/vehicles';
import { WORLD_BOUNDS } from '../../shared/world';
import { TrafficSystem } from '../../server/game/traffic';
import { comboMultiplier } from '../../server/game/services/highway';
import { simulateEt } from '../../server/game/services/drag';
import { emptyTuning } from '../../shared/modificationsData';

const EMPTY: CollisionWorld = { boxes: [], circles: [], dynamic: [] };
const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe('highway geometry', () => {
  it('is a closed loop and projection inverts pathPoint', () => {
    const a = pathPoint(0);
    const b = pathPoint(LOOP_LEN);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-6);
    for (let s = 3; s < LOOP_LEN; s += 37.3) {
      for (const off of [-14.4, -3.6, 0, 7.2, 18]) {
        const p = pathPoint(s, off);
        const q = projectToHighway(p.x, p.z);
        expect(Math.abs(deltaS(s, q.s))).toBeLessThan(1e-6);
        expect(q.offset).toBeCloseTo(off, 6);
      }
    }
  });

  it('has 4 lanes each way, inner clockwise and outer anticlockwise, and stays inside the world', () => {
    expect(laneOffset(0, 0)).toBeCloseTo(-3.6);
    expect(laneOffset(0, 3)).toBeCloseTo(-14.4);
    expect(laneOffset(1, 0)).toBeCloseTo(3.6);
    expect(laneOffset(1, 3)).toBeCloseTo(14.4);
    // North side: inner carriageway heads east (+x).
    const p = pathPoint(100, laneOffset(0, 1));
    expect(Math.sin(pathYaw(p, false))).toBeCloseTo(1);
    expect(Math.sin(pathYaw(p, true))).toBeCloseTo(-1);
    for (let s = 0; s < LOOP_LEN; s += 10) {
      const q = pathPoint(s, GUARDRAIL_OFFSET + 1);
      expect(Math.max(Math.abs(q.x), Math.abs(q.z))).toBeLessThan(WORLD_BOUNDS);
      const inner = pathPoint(s, -GUARDRAIL_OFFSET - 1);
      expect(Math.max(Math.abs(inner.x), Math.abs(inner.z))).toBeGreaterThan(165);
    }
  });

  it('junctions open the inner guardrail; crossovers open the median', () => {
    const [inner, median, outer] = HIGHWAY_BARRIERS;
    for (const j of JUNCTIONS) {
      expect(inGap(inner!, j.s)).toBe(true);
      expect(inGap(inner!, j.s + 200)).toBe(false);
      // The connector reaches the city's outer road.
      expect(Math.max(Math.abs(j.cityX), Math.abs(j.cityZ))).toBeCloseTo(156, 0);
      expect(inJunctionArea(pathPoint(j.s, -40).x, pathPoint(j.s, -40).z)).toBe(true);
    }
    for (const c of CROSSOVERS) expect(inGap(median!, c)).toBe(true);
    expect(outer!.gaps).toHaveLength(0);
  });

  it('keeps belt trees off the roads and the drag strip', () => {
    expect(BELT_TREES.length).toBeGreaterThan(60);
    for (const t of BELT_TREES) {
      expect(projectToHighway(t.x, t.z).offset).toBeLessThan(-GUARDRAIL_OFFSET - 3);
      expect(inJunctionArea(t.x, t.z)).toBe(false);
      expect(t.x > DRAG_STRIP.wallX[0] - 5 && t.x < DRAG_STRIP.wallX[1] + 5 && t.z > DRAG_STRIP.wallZ[0] && t.z < DRAG_STRIP.wallZ[1]).toBe(false);
    }
  });

  it('runs a 24-minute day with smooth dusk and dawn', () => {
    expect(gameHour(0)).toBe(0);
    expect(gameHour(DAY_LENGTH_MS / 2)).toBeCloseTo(12);
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(23)).toBe(1);
    expect(nightFactor(2)).toBe(1);
    expect(nightFactor(19)).toBeGreaterThan(0.2);
    expect(nightFactor(19)).toBeLessThan(0.8);
    expect(nightFactor(6)).toBeGreaterThan(0.2);
  });
});

describe('highway collisions', () => {
  it('guardrails and the median stop cars, even very fast ones', () => {
    const p = vehicleParams(getModel('apexon_vanta'), PERFECT, 100);
    for (const [start, heading] of [
      [-12.6, -1],
      [-5.4, 1],
      [12.6, 1],
    ] as const) {
      // Aim straight at a barrier from a lane at an absurd speed.
      const s = 150;
      const a = pathPoint(s, start);
      const dir = { x: a.nx * heading, z: a.nz * heading };
      const v = { x: a.x, z: a.z, rot: Math.atan2(dir.x, dir.z), speed: 70, steer: 0 };
      for (let i = 0; i < 60; i++) stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, EMPTY);
      const off = projectToHighway(v.x, v.z).offset;
      if (start < 0 && heading < 0) expect(off).toBeGreaterThan(-GUARDRAIL_OFFSET);
      if (start < 0 && heading > 0) expect(off).toBeLessThan(0);
      if (start > 0) expect(off).toBeLessThan(GUARDRAIL_OFFSET);
    }
  });

  it('lets cars through the junction gaps', () => {
    const j = JUNCTIONS[0]!;
    const a = pathPoint(j.s, -10);
    const res = resolveCircle(pathPoint(j.s, -GUARDRAIL_OFFSET).x, pathPoint(j.s, -GUARDRAIL_OFFSET).z, 1, EMPTY, undefined, a);
    expect(res.hit).toBe(false);
  });
});

describe('traffic', () => {
  it('has cars, trucks, buses and semis with deterministic specs', () => {
    const kinds = new Set<string>();
    for (let id = 0; id < TRAFFIC_COUNT; id++) {
      const s = trafficSpec(id);
      expect(trafficSpec(id)).toBe(s);
      kinds.add(s.kind);
      if (s.kind !== 'car') expect(s.homeLane).toBeGreaterThanOrEqual(1);
      expect(trafficCircles(s, 100, laneOffset(s.cw, s.homeLane)).length).toBe(s.circles);
    }
    expect([...kinds].sort()).toEqual(['bus', 'car', 'semi', 'truck']);
    expect(homeLaneFor(130, [0, 3])).toBe(0);
    expect(homeLaneFor(80, [0, 3])).toBe(3);
  });

  it('keeps lane speeds (fast left, trucks right), never overlaps, and changes lanes now and then', () => {
    const t = new TrafficSystem(seeded(3));
    let changes = 0;
    let signalledFirst = 0;
    const lane = new Map(t.cars.map((c) => [c.spec.id, c.lane]));
    for (let i = 0; i < 20 * 240; i++) {
      const before = new Map(t.cars.map((c) => [c.spec.id, c.signal]));
      t.step(0.05);
      for (const c of t.cars) {
        if (lane.get(c.spec.id) !== c.lane) {
          changes++;
          if (before.get(c.spec.id)) signalledFirst++;
          lane.set(c.spec.id, c.lane);
        }
      }
      if (i % 10 === 0) {
        for (const a of t.cars)
          for (const b of t.cars) {
            if (a === b || a.spec.cw !== b.spec.cw) continue;
            if (Math.abs(a.off - b.off) >= (a.spec.width + b.spec.width) / 2) continue;
            const d = Math.abs(deltaS(a.s, b.s));
            expect(d, `overlap ${a.spec.id}/${b.spec.id}`).toBeGreaterThan((a.spec.length + b.spec.length) / 2 - 0.2);
          }
      }
    }
    expect(changes).toBeGreaterThan(40);
    expect(signalledFirst).toBe(changes);
    const avg = (l: number) => {
      const v = t.cars.filter((c) => c.lane === l).map((c) => c.v * TRAFFIC_KMH_PER_MS);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    expect(avg(0)).toBeGreaterThan(110);
    expect(avg(0)).toBeLessThanOrEqual(LANE_MAX_KMH[0]!);
    expect(avg(3)).toBeLessThan(90);
    expect(avg(0)).toBeGreaterThan(avg(3) + 25);
    for (const c of t.cars) if (c.spec.kind !== 'car') expect(c.lane).toBeGreaterThanOrEqual(1);
  });

  it('moves over for a car flashing behind it', () => {
    const t = new TrafficSystem(seeded(11));
    for (let i = 0; i < 40; i++) t.step(0.05);
    const car = t.cars.find((c) => c.lane === 0 && c.pendingLane === null && c.off === c.toff)!;
    expect(car).toBeDefined();
    t.requestYield(car);
    let moved = false;
    for (let i = 0; i < 20 * 12 && !moved; i++) {
      t.step(0.05);
      moved = car.lane === 1;
    }
    expect(moved).toBe(true);
  });

  it('brakes for a stopped car in its lane', () => {
    const t = new TrafficSystem(seeded(5));
    const car = t.cars.find((c) => c.spec.cw === 0 && c.lane === 3)!;
    const ahead = pathPoint(wrapS(car.s + 60), car.off);
    const body = { id: 'p', x: ahead.x, z: ahead.z, rot: pathYaw(ahead, false), speed: 0, halfLength: 2.3, halfWidth: 0.95 };
    const bs = projectToHighway(body.x, body.z).s;
    let minGap = Infinity;
    for (let i = 0; i < 20 * 30; i++) {
      t.step(0.05, [body]);
      // While it is in the stopped car's lane and behind it, it must keep a gap (stop, or go around).
      const d = deltaS(car.s, bs);
      if (Math.abs(car.off - laneOffset(0, 3)) < 2 && d > 0 && d < 40) minGap = Math.min(minGap, d - car.spec.length / 2 - 2.3);
    }
    expect(minGap).toBeGreaterThan(0.3);
  });
});

describe('near misses and drag racing', () => {
  it('combo multiplier tiers', () => {
    expect([1, 2, 3, 5, 6, 9, 10, 40].map(comboMultiplier)).toEqual([1, 1, 2, 2, 3, 3, 5, 5]);
    expect(ECONOMY.highway.nearMissReward).toBe(100);
    expect(ECONOMY.drag.entryFee * 2).toBe(ECONOMY.drag.prize);
  });

  it('tuning makes a car quicker down the strip', () => {
    const m = getModel('bmw_m3_g80');
    const stock = simulateEt(vehicleParams(m, PERFECT, 100));
    const t = emptyTuning();
    t.perf.ecu = 'ecu_stage2';
    t.perf.exhaust = 'exh_downpipe';
    t.perf.intake = 'intake_cai';
    const tuned = simulateEt(vehicleParams(m, PERFECT, 100, { paint: null, wheels: 'stock', tint: 'none', bodyKit: 'none', headlights: 'stock', accessory: 'none', tuning: t }));
    expect(stock).toBeGreaterThan(5);
    expect(stock).toBeLessThan(12);
    expect(tuned).toBeLessThan(stock);
  });
});

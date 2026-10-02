import { describe, expect, it } from 'vitest';
import { KMH_PER_MS, SPEED_SCALE, performanceFigures, powertrainFor, simulateRun } from '../../shared/drivetrain';
import { surfaceGrip } from '../../shared/environment';
import { obbDistance, obbVsObb } from '../../shared/obb';
import { KEY, RUN_SPEED, WALK_SPEED, dynFromTuple, dynToTuple, newVehicleDyn, stepCharacter, stepVehicle, vehicleBox, vehicleParams, type CollisionWorld, type VehicleDyn } from '../../shared/physics';
import { CATALOG_MODELS, VEHICLE_MODELS, getModel } from '../../shared/vehicles';
import { WATER, WORLD_BOX } from '../../shared/strait';

const empty: CollisionWorld = { boxes: [], circles: [], dynamic: [], vehicles: [] };
const wall: CollisionWorld = { boxes: [{ minX: -10, maxX: 10, minZ: 5, maxZ: 6 }], circles: [], dynamic: [], vehicles: [] };
const good = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

describe('character physics', () => {
  it('walks and runs at the configured speeds relative to the camera yaw', () => {
    const s = { x: 0, z: 0, rot: 0, gait: 0 };
    for (let i = 0; i < 30; i++) stepCharacter(s, { keys: KEY.FORWARD, yaw: 0, dt: 1 / 30 }, empty);
    expect(s.z).toBeCloseTo(WALK_SPEED, 1);
    const r = { x: 0, z: 0, rot: 0, gait: 0 };
    for (let i = 0; i < 30; i++) stepCharacter(r, { keys: KEY.FORWARD | KEY.SPRINT, yaw: Math.PI / 2, dt: 1 / 30 }, empty);
    expect(r.x).toBeCloseTo(RUN_SPEED, 1);
  });

  it('cannot walk through buildings or out of the world', () => {
    const s = { x: 0, z: 0, rot: 0, gait: 0 };
    for (let i = 0; i < 120; i++) stepCharacter(s, { keys: KEY.FORWARD, yaw: 0, dt: 1 / 30 }, wall);
    expect(s.z).toBeLessThan(5);
    // East: the strait's bank stops you; west: the edge of the world.
    const t = { x: WATER.west - 3, z: 0, rot: 0, gait: 0 };
    for (let i = 0; i < 120; i++) stepCharacter(t, { keys: KEY.FORWARD, yaw: Math.PI / 2, dt: 1 / 30 }, empty);
    expect(t.x).toBeLessThanOrEqual(WATER.west);
    const u = { x: WORLD_BOX.minX + 1, z: 0, rot: 0, gait: 0 };
    for (let i = 0; i < 120; i++) stepCharacter(u, { keys: KEY.FORWARD, yaw: -Math.PI / 2, dt: 1 / 30 }, empty);
    expect(u.x).toBeGreaterThanOrEqual(WORLD_BOX.minX);
  });

  it('is deterministic (client prediction == server simulation)', () => {
    const run = () => {
      const s = { x: 1, z: 2, rot: 0, gait: 0 };
      for (let i = 0; i < 200; i++) stepCharacter(s, { keys: (i % 7) & 15, yaw: i * 0.01, dt: 1 / 30 }, wall);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it('clamps dt so huge time steps cannot teleport', () => {
    const s = { x: 0, z: 0, rot: 0, gait: 0 };
    stepCharacter(s, { keys: KEY.FORWARD | KEY.SPRINT, yaw: 0, dt: 100 }, empty);
    expect(s.z).toBeLessThan(1);
  });
});

/** Drive with fixed keys for `sec` seconds (30 Hz commands), staying inside the city. */
function drive(v: VehicleDyn, keys: number, sec: number, p = vehicleParams(getModel('norda_arlo'), good, 100), world = empty): number {
  let impact = 0;
  for (let i = 0; i < Math.round(sec * 30); i++) {
    impact = Math.max(impact, stepVehicle(v, { keys, dt: 1 / 30 }, p, world).impact);
    if (world === empty && Math.abs(v.z) > 140) v.z -= Math.sign(v.z) * 280;
    if (world === empty && Math.abs(v.x) > 140) v.x -= Math.sign(v.x) * 280;
  }
  return impact;
}

const kmh = (v: VehicleDyn) => v.speed * KMH_PER_MS;

describe('drivetrain: realistic acceleration, drag and braking', () => {
  it('reproduces every factory 0-100 km/h time and top speed', () => {
    for (const m of VEHICLE_MODELS) {
      const f = performanceFigures(m);
      expect(f.t100, m.id).toBeCloseTo(m.specs.accel, 1);
      expect(Math.abs(f.topKmh - m.specs.topSpeed), m.id).toBeLessThan(m.specs.topSpeed * 0.02);
    }
  });

  it('no stock car gets from 0 to 300 km/h in anything like 10 seconds: drag grows with speed', () => {
    for (const m of VEHICLE_MODELS) {
      const f = performanceFigures(m);
      if (f.t300 !== null) expect(f.t100 + f.t200 + f.t300, m.id).toBeGreaterThan(20);
      // 100-200 always takes longer than 0-100, and 200-300 longer again.
      if (f.t200 < 99) expect(f.t200, m.id).toBeGreaterThan(f.t100);
      if (f.t300 !== null) expect(f.t300, m.id).toBeGreaterThan(f.t200 * 1.5);
    }
  });

  it('the in-game car matches the garage figures (same simulation)', () => {
    const m = getModel('apexon_vanta');
    const v = newVehicleDyn(0, -130, 0);
    const p = vehicleParams(m, good, 100);
    let t100 = 0;
    for (let t = 0; t < 8 && t100 === 0; t += 1 / 30) {
      drive(v, KEY.FORWARD, 1 / 30, p);
      if (kmh(v) >= 100) t100 = t + 1 / 30;
    }
    // The pedal takes a moment to reach the floor, so the game is a touch slower than launch control.
    expect(t100).toBeGreaterThan(m.specs.accel);
    expect(t100).toBeLessThan(m.specs.accel + 0.5);
  });

  it('shifts gears and the engine revs between idle and the redline', () => {
    const p = vehicleParams(getModel('bmw_m8_comp'), good, 100);
    const v = newVehicleDyn(0, -130, 0);
    const gears = new Set<number>();
    for (let i = 0; i < 20 * 30; i++) {
      drive(v, KEY.FORWARD, 1 / 30, p);
      gears.add(v.gear);
      expect(v.rpm).toBeLessThanOrEqual(p.pt.redline * 1.02 + 1);
    }
    expect(gears.size).toBeGreaterThanOrEqual(5);
  });

  it('turbo boost builds up, and drops when the throttle closes', () => {
    const p = vehicleParams(getModel('velora_serene'), good, 100);
    const v = newVehicleDyn(0, -130, 0);
    drive(v, KEY.FORWARD, 4, p);
    expect(v.boost).toBeGreaterThan(0.6);
    drive(v, 0, 0.5, p);
    expect(v.boost).toBeLessThan(0.1);
  });

  it('brakes need real distance: ~35-50 m from 100 km/h, much more from 200', () => {
    for (const id of ['norda_arlo', 'apexon_vanta', 'mercedes_g_class']) {
      const p = vehicleParams(getModel(id), good, 100);
      const stop = (from: number) => {
        const v = newVehicleDyn(0, -130, 0);
        v.speed = from / KMH_PER_MS;
        v.gear = 4;
        let d = 0;
        for (let i = 0; i < 30 * 20 && v.speed > 0; i++) {
          const z0 = v.z;
          stepVehicle(v, { keys: KEY.BACK, dt: 1 / 30 }, p, empty);
          d += v.z - z0;
        }
        return d * SPEED_SCALE;
      };
      const d100 = stop(100);
      const d200 = stop(200);
      expect(d100, id).toBeGreaterThan(30);
      expect(d100, id).toBeLessThan(55);
      expect(d200 / d100, id).toBeGreaterThan(3.3);
    }
  });

  it('ABS keeps the wheels turning; a classic without ABS locks up and stops longer', () => {
    const modern = powertrainFor(getModel('norda_arlo'));
    const classic = powertrainFor(getModel('harlan_duchess'));
    expect(modern.abs).toBe(true);
    expect(classic.abs).toBe(false);
    expect(performanceFigures(getModel('harlan_duchess')).brake100).toBeGreaterThan(performanceFigures(getModel('norda_arlo')).brake100);
  });

  it('rain costs up to 20% grip: longer stops and wider corners', () => {
    const wet: CollisionWorld = { ...empty, grip: 0.8 };
    const p = vehicleParams(getModel('apexon_strix'), good, 100);
    const radius = (world: CollisionWorld) => {
      const v = newVehicleDyn(0, 0, 0);
      v.speed = 150 / KMH_PER_MS;
      v.gear = 5;
      drive(v, KEY.LEFT | KEY.FORWARD, 3, p, world);
      return v.speed / Math.abs(v.yaw);
    };
    expect(radius(wet)).toBeGreaterThan(radius(empty) * 1.15);
    const dry = simulateRun(powertrainFor(getModel('apexon_strix')), { maxT: 10, grip: 1 }).t100;
    const soaked = simulateRun(powertrainFor(getModel('apexon_strix')), { maxT: 10, grip: 0.8 }).t100;
    expect(soaked).toBeGreaterThan(dry);
    expect(Math.min(...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => surfaceGrip(k * 3_600_000 + 12345)))).toBeGreaterThanOrEqual(0.8);
  });
});

describe('vehicle handling', () => {
  const model = getModel('norda_arlo');

  it('steering is lazy at speed (inertia) and the car cannot turn sharply at 250 km/h', () => {
    const p = vehicleParams(getModel('apexon_vanta'), good, 100);
    const v = newVehicleDyn(0, 0, 0);
    v.speed = 250 / KMH_PER_MS;
    v.gear = 6;
    drive(v, KEY.LEFT | KEY.FORWARD, 0.2, p);
    const early = Math.abs(v.yaw);
    drive(v, KEY.LEFT | KEY.FORWARD, 2, p);
    expect(early).toBeLessThan(Math.abs(v.yaw) * 0.45);
    // Lateral grip limits the corner radius (game metres) at this speed.
    expect(v.speed / Math.abs(v.yaw)).toBeGreaterThan(80);
    // At parking speed the same car turns tightly.
    const slow = newVehicleDyn(0, 0, 0);
    slow.speed = 15 / KMH_PER_MS;
    drive(slow, KEY.LEFT, 1, p);
    expect(slow.speed / Math.abs(slow.yaw)).toBeLessThan(12);
  });

  it('the handbrake breaks the rear loose into a slide', () => {
    const p = vehicleParams(model, good, 100);
    const v = newVehicleDyn(0, 0, 0);
    v.speed = 70 / KMH_PER_MS;
    v.gear = 3;
    let maxSlip = 0;
    for (let i = 0; i < 30; i++) {
      drive(v, KEY.LEFT | KEY.BRAKE, 1 / 30, p);
      maxSlip = Math.max(maxSlip, Math.abs(v.slip));
    }
    expect(maxSlip).toBeGreaterThan(0.12);
  });

  it('reverses, and worn engines are slower', () => {
    const p = vehicleParams(model, good, 100);
    const v = newVehicleDyn(0, 0, 0);
    drive(v, KEY.BACK, 3, p);
    expect(v.speed).toBeLessThan(0);
    expect(v.gear).toBe(-1);
    expect(-kmh(v)).toBeLessThan(40);
    const worn = vehicleParams(model, { ...good, engine: 10 }, 100);
    expect(worn.topSpeed).toBeLessThan(p.topSpeed);
    expect(worn.pt.eff).toBeLessThan(p.pt.eff);
  });

  it('cannot accelerate without fuel', () => {
    const p = vehicleParams(model, good, 0);
    const v = newVehicleDyn(0, 0, 0);
    drive(v, KEY.FORWARD, 2, p);
    expect(v.speed).toBe(0);
  });

  it('collides with buildings and reports the impact', () => {
    const p = vehicleParams(model, good, 100);
    const v = newVehicleDyn(0, -10, 0);
    v.speed = 20;
    v.gear = 3;
    const impact = drive(v, KEY.FORWARD, 2, p, wall);
    expect(v.z + p.halfLength).toBeLessThan(5.01);
    expect(impact).toBeGreaterThan(5);
  });

  it('is deterministic and survives the wire format (client prediction == server)', () => {
    const run = () => {
      const v = newVehicleDyn(0, 0, 0.3);
      const p = vehicleParams(model, good, 100);
      for (let i = 0; i < 300; i++) stepVehicle(v, { keys: [KEY.FORWARD, KEY.FORWARD | KEY.LEFT, KEY.BRAKE | KEY.RIGHT, KEY.BACK][(i >> 5) & 3]!, dt: 1 / 30 }, p, wall);
      return v;
    };
    expect(run()).toEqual(run());
    const v = run();
    const back = dynFromTuple(dynToTuple(v));
    expect(back.x).toBeCloseTo(v.x, 2);
    expect(back.gear).toBe(v.gear);
  });
});

describe('tight hitboxes (OBB)', () => {
  it('measures the real gap between two car bodies', () => {
    const a = vehicleBox('a', 0, 0, 0, 2.3, 0.95);
    // Side by side, 30 cm apart.
    expect(obbDistance(a, vehicleBox('b', 2.2, 0, 0, 2.3, 0.95))).toBeCloseTo(0.3, 5);
    // Corner to corner diagonally.
    expect(obbDistance(a, vehicleBox('b', 3, 6, 0, 2.3, 0.95))).toBeCloseTo(Math.hypot(3 - 1.9, 6 - 4.6), 5);
    expect(obbVsObb(a, vehicleBox('b', 1.8, 0, 0.1, 2.3, 0.95))).not.toBeNull();
    expect(obbDistance(a, vehicleBox('b', 1.8, 0, 0.1, 2.3, 0.95))).toBe(0);
  });

  it('cars can pass 25 cm apart without touching (no invisible bubble)', () => {
    const p = vehicleParams(getModel('norda_arlo'), good, 100);
    const other = vehicleBox('other', p.halfWidth + 0.95 + 0.25, 0, 0, 2.3, 0.95);
    const world: CollisionWorld = { ...empty, vehicles: [other] };
    const v = newVehicleDyn(0, -20, 0);
    v.speed = 12;
    v.gear = 3;
    let hit = false;
    for (let i = 0; i < 90; i++) hit ||= !!stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, world).hitId;
    expect(hit).toBe(false);
    // Drove all the way past it.
    expect(v.z).toBeGreaterThan(10);
  });

  it('every catalogue model gets a box that fits its body', () => {
    for (const m of CATALOG_MODELS) {
      const p = vehicleParams(m, good, 100);
      expect(p.halfLength * 2, m.id).toBeGreaterThan(m.shape.length - 0.1);
      expect(p.halfLength * 2, m.id).toBeLessThanOrEqual(m.shape.length);
      expect(p.halfWidth * 2, m.id).toBeLessThanOrEqual(m.shape.width);
    }
  });
});

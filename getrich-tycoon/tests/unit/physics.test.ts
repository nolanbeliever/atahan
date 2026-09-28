import { describe, expect, it } from 'vitest';
import { KEY, RUN_SPEED, WALK_SPEED, stepCharacter, stepVehicle, vehicleParams, type CollisionWorld } from '../../shared/physics';
import { getModel } from '../../shared/vehicles';
import { WORLD_BOUNDS } from '../../shared/world';

const empty: CollisionWorld = { boxes: [], circles: [], dynamic: [] };
const wall: CollisionWorld = { boxes: [{ minX: -10, maxX: 10, minZ: 5, maxZ: 6 }], circles: [], dynamic: [] };
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
    const t = { x: WORLD_BOUNDS - 1, z: 0, rot: 0, gait: 0 };
    for (let i = 0; i < 120; i++) stepCharacter(t, { keys: KEY.FORWARD, yaw: Math.PI / 2, dt: 1 / 30 }, empty);
    expect(t.x).toBeLessThanOrEqual(WORLD_BOUNDS);
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

describe('vehicle physics', () => {
  const model = getModel('norda_arlo');

  it('accelerates, respects top speed, brakes and reverses', () => {
    const p = vehicleParams(model, good, 100);
    // Start near one edge so the run never reaches the world boundary.
    const v = { x: 0, z: -140, rot: 0, speed: 0, steer: 0 };
    for (let i = 0; i < 30 * 7; i++) stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, empty);
    expect(v.speed).toBeGreaterThan(p.topSpeed * 0.8);
    expect(v.speed).toBeLessThanOrEqual(p.topSpeed + 0.01);
    for (let i = 0; i < 30 * 5; i++) stepVehicle(v, { keys: KEY.BRAKE, dt: 1 / 30 }, p, empty);
    expect(v.speed).toBe(0);
    for (let i = 0; i < 30 * 3; i++) stepVehicle(v, { keys: KEY.BACK, dt: 1 / 30 }, p, empty);
    expect(v.speed).toBeLessThan(0);
  });

  it('steers and worn engines are slower', () => {
    const p = vehicleParams(model, good, 100);
    const v = { x: 0, z: 0, rot: 0, speed: 10, steer: 0 };
    for (let i = 0; i < 30; i++) stepVehicle(v, { keys: KEY.FORWARD | KEY.LEFT, dt: 1 / 30 }, p, empty);
    expect(v.rot).toBeGreaterThan(0.1);
    const worn = vehicleParams(model, { ...good, engine: 10 }, 100);
    expect(worn.topSpeed).toBeLessThan(p.topSpeed);
    expect(worn.accel).toBeLessThan(p.accel);
  });

  it('cannot accelerate without fuel', () => {
    const p = vehicleParams(model, good, 0);
    const v = { x: 0, z: 0, rot: 0, speed: 0, steer: 0 };
    for (let i = 0; i < 60; i++) stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, empty);
    expect(v.speed).toBe(0);
  });

  it('collides with buildings and reports the impact', () => {
    const p = vehicleParams(model, good, 100);
    const v = { x: 0, z: 0, rot: 0, speed: 20, steer: 0 };
    let impact = 0;
    for (let i = 0; i < 60; i++) impact = Math.max(impact, stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, wall).impact);
    expect(v.z).toBeLessThan(5);
    expect(impact).toBeGreaterThan(5);
  });
});

// Nitrous, air ride and number plates (shared rules).

import { describe, expect, it } from 'vitest';
import { SPEED_SCALE, driveStep, newDriveState, powertrainFor } from '../../shared/drivetrain';
import { ECONOMY } from '../../shared/economy.config';
import { AIR_LEVELS, AIR_PART, airDropCm, findPart, hasAirRide } from '../../shared/modificationsData';
import { suspensionLimits } from '../../shared/tuningSystem';
import { KEY, dynFromTuple, dynToTuple, newVehicleDyn, stepVehicle, vehicleParams, type CollisionWorld, type VehicleDyn } from '../../shared/physics';
import { PLATE_MAX, defaultPlate, normalizePlate, plateProblem, plateText } from '../../shared/plates';
import { DEFAULT_MODS } from '../../shared/customization';
import { getModel } from '../../shared/vehicles';

const empty: CollisionWorld = { boxes: [], circles: [], dynamic: [], vehicles: [] };
const good = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

function run(v: VehicleDyn, sec: number, p: ReturnType<typeof vehicleParams>): void {
  for (let t = 0; t < sec; t += 1 / 30) stepVehicle(v, { keys: KEY.FORWARD, dt: 1 / 30 }, p, empty);
}

describe('nitrous', () => {
  it('pulls harder while it burns, then runs out', () => {
    const p = vehicleParams(getModel('bmw_m8_comp'), good, 100);
    const plain = newVehicleDyn(0, -400, 0);
    const nos = newVehicleDyn(0, -400, 0);
    run(plain, 3, p);
    run(nos, 3, p);
    expect(nos.speed).toBeCloseTo(plain.speed, 5);
    nos.nitro = ECONOMY.nitro.seconds;
    const a0 = plain.speed;
    run(plain, 2, p);
    run(nos, 2, p);
    expect(nos.speed - a0).toBeGreaterThan((plain.speed - a0) * 1.15);
    expect(nos.nitro).toBeCloseTo(ECONOMY.nitro.seconds - 2, 1);
    run(nos, ECONOMY.nitro.seconds, p);
    expect(nos.nitro).toBe(0);
  });

  it('runs past a speed limiter while it burns', () => {
    const pt = powertrainFor(getModel('bmw_m8_comp'));
    expect(Number.isFinite(pt.limiter)).toBe(true);
    const st = newDriveState();
    const inp = { throttle: 1, brake: 0, reverse: false, handbrake: false, grip: 1 };
    for (let t = 0; t < 90; t += 1 / 30) driveStep(pt, st, inp, 1 / 30);
    const top = st.speed * SPEED_SCALE;
    expect(top).toBeLessThanOrEqual(pt.limiter + 0.5);
    st.nitro = ECONOMY.nitro.seconds;
    for (let t = 0; t < ECONOMY.nitro.seconds; t += 1 / 30) driveStep(pt, st, inp, 1 / 30);
    expect(st.speed * SPEED_SCALE).toBeGreaterThan(top + 1);
  });

  it('travels in the vehicle state on the wire', () => {
    const v = newVehicleDyn(1, 2, 0.3);
    v.nitro = 3.21;
    expect(dynFromTuple(dynToTuple(v)).nitro).toBeCloseTo(3.21, 2);
    // Older 14-number states read as no nitro.
    expect(dynFromTuple(dynToTuple(v).slice(0, 14)).nitro).toBe(0);
  });
});

describe('air ride', () => {
  it('is a suspension part with three heights', () => {
    const part = findPart(AIR_PART)!;
    expect(part.slot).toBe('suspension');
    expect(part.only?.kind).toEqual(['car']);
    const tuning = { perf: { suspension: AIR_PART }, body: {}, paint: null, rim: null, camber: 0, drop: 2 };
    expect(hasAirRide(tuning)).toBe(true);
    expect(hasAirRide(undefined)).toBe(false);
    expect(suspensionLimits(tuning).maxDrop).toBeGreaterThanOrEqual(6);
    expect(AIR_LEVELS).toHaveLength(3);
    expect(airDropCm(0, 2)).toBe(2);
    expect(airDropCm(1, 2)).toBeGreaterThan(airDropCm(0, 2));
    expect(airDropCm(2, 2)).toBeGreaterThan(airDropCm(1, 2));
    expect(airDropCm(1, 8)).toBe(8);
  });
});

describe('number plates', () => {
  it('gives every car a stable Turkish-style registration', () => {
    const a = defaultPlate('veh_abc123');
    expect(a).toBe(defaultPlate('veh_abc123'));
    expect(a).toMatch(/^\d{2} [A-Z]{2} \d{3,4}$/);
    expect(new Set(['veh_1', 'veh_2', 'veh_3', 'veh_4', 'veh_5'].map(defaultPlate)).size).toBeGreaterThan(1);
    expect(plateText('veh_abc123', { ...DEFAULT_MODS })).toBe(a);
    expect(plateText('veh_abc123', { ...DEFAULT_MODS, plate: 'ATAHAN' })).toBe('ATAHAN');
  });

  it('cleans up typed text and refuses bad plates', () => {
    expect(normalizePlate('  34 abc   123 ')).toBe('34 ABC 123');
    expect(normalizePlate('çiğdem')).toBe('CIGDEM');
    expect(normalizePlate('ışık!')).toBe('ISIK');
    expect(normalizePlate('<b>x</b>')).toBe('BXB');
    expect(plateProblem('GETRICH')).toBeNull();
    expect(plateProblem('A')).not.toBeNull();
    expect(plateProblem('X'.repeat(PLATE_MAX + 1))).not.toBeNull();
    expect(plateProblem('---')).not.toBeNull();
    expect(plateProblem('34 AMK 34')).not.toBeNull();
  });
});

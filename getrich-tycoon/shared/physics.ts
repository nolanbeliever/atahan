// Deterministic movement & collision shared by server (authoritative) and
// client (prediction). Keep this file free of DOM/Node APIs.

import { performanceFactors } from './tuningSystem';
import type { VehicleCondition, VehicleMods } from './types';
import { angleDiff, clamp } from './util';
import type { VehicleModel } from './vehicles';
import { WORLD_BOUNDS, type AABB, type Circle } from './world';

export const KEY = {
  FORWARD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  SPRINT: 16,
  BRAKE: 32,
} as const;

export interface InputCmd {
  seq: number;
  /** Seconds simulated by this command. */
  dt: number;
  keys: number;
  /** Camera yaw (radians) used to orient walking input. */
  yaw: number;
}

export const SIM_DT = 1 / 30;
export const MAX_CMD_DT = 0.1;

export interface DynamicCircle extends Circle {
  /** Owner entity id (so an entity does not collide with itself). */
  id: string;
}

export interface CollisionWorld {
  boxes: readonly AABB[];
  circles: readonly Circle[];
  dynamic: readonly DynamicCircle[];
}

export const CHAR_RADIUS = 0.45;
export const WALK_SPEED = 4.2;
export const RUN_SPEED = 7.8;
export const CHAR_TURN_RATE = 12;

export interface CharacterState {
  x: number;
  z: number;
  rot: number;
  /** 0 idle, 1 walk, 2 run */
  gait: number;
}

interface Push {
  x: number;
  z: number;
  hit: boolean;
  nx: number;
  nz: number;
}

/** Push a circle out of all colliders. */
export function resolveCircle(x: number, z: number, r: number, world: CollisionWorld, ignoreId?: string): Push {
  let px = x;
  let pz = z;
  let hit = false;
  let nx = 0;
  let nz = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of world.boxes) {
      if (px + r < b.minX || px - r > b.maxX || pz + r < b.minZ || pz - r > b.maxZ) continue;
      const cx = clamp(px, b.minX, b.maxX);
      const cz = clamp(pz, b.minZ, b.maxZ);
      let dx = px - cx;
      let dz = pz - cz;
      let d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 < 1e-8) {
        // Centre inside the box: push out along the shortest axis.
        const left = px - b.minX;
        const right = b.maxX - px;
        const top = pz - b.minZ;
        const bottom = b.maxZ - pz;
        const m = Math.min(left, right, top, bottom);
        if (m === left) {
          px = b.minX - r;
          dx = -1;
          dz = 0;
        } else if (m === right) {
          px = b.maxX + r;
          dx = 1;
          dz = 0;
        } else if (m === top) {
          pz = b.minZ - r;
          dx = 0;
          dz = -1;
        } else {
          pz = b.maxZ + r;
          dx = 0;
          dz = 1;
        }
        nx += dx;
        nz += dz;
        continue;
      }
      const d = Math.sqrt(d2);
      dx /= d;
      dz /= d;
      px = cx + dx * r;
      pz = cz + dz * r;
      nx += dx;
      nz += dz;
      d2 = 0;
    }
    const circleSets: (readonly Circle[])[] = [world.circles, world.dynamic];
    for (const set of circleSets) {
      for (const c of set) {
        if (ignoreId !== undefined && (c as DynamicCircle).id === ignoreId) continue;
        const rr = r + c.r;
        const dx = px - c.x;
        const dz = pz - c.z;
        if (dx > rr || dx < -rr || dz > rr || dz < -rr) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        hit = true;
        const d = Math.sqrt(d2) || 1e-4;
        const ux = d2 < 1e-8 ? 1 : dx / d;
        const uz = d2 < 1e-8 ? 0 : dz / d;
        px = c.x + ux * rr;
        pz = c.z + uz * rr;
        nx += ux;
        nz += uz;
      }
    }
    if (!hit) break;
  }
  const nl = Math.hypot(nx, nz) || 1;
  const lim = WORLD_BOUNDS - r;
  if (px < -lim || px > lim || pz < -lim || pz > lim) {
    hit = true;
    if (px < -lim) nx += 1;
    if (px > lim) nx -= 1;
    if (pz < -lim) nz += 1;
    if (pz > lim) nz -= 1;
    px = clamp(px, -lim, lim);
    pz = clamp(pz, -lim, lim);
  }
  return { x: px, z: pz, hit, nx: nx / nl, nz: nz / nl };
}

/** Walking direction for a key mask relative to the camera yaw, or null if no movement. */
export function moveDirection(keys: number, yaw: number): { x: number; z: number } | null {
  const f = (keys & KEY.FORWARD ? 1 : 0) - (keys & KEY.BACK ? 1 : 0);
  const s = (keys & KEY.RIGHT ? 1 : 0) - (keys & KEY.LEFT ? 1 : 0);
  if (f === 0 && s === 0) return null;
  // forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw)
  let x = Math.sin(yaw) * f - Math.cos(yaw) * s;
  let z = Math.cos(yaw) * f + Math.sin(yaw) * s;
  const l = Math.hypot(x, z) || 1;
  x /= l;
  z /= l;
  return { x, z };
}

export function stepCharacter(s: CharacterState, cmd: Pick<InputCmd, 'keys' | 'yaw' | 'dt'>, world: CollisionWorld, selfId?: string): void {
  const dt = clamp(cmd.dt, 0, MAX_CMD_DT);
  const dir = moveDirection(cmd.keys, cmd.yaw);
  if (!dir) {
    s.gait = 0;
    return;
  }
  const running = (cmd.keys & KEY.SPRINT) !== 0;
  const speed = running ? RUN_SPEED : WALK_SPEED;
  s.gait = running ? 2 : 1;
  const target = Math.atan2(dir.x, dir.z);
  s.rot += angleDiff(s.rot, target) * Math.min(1, CHAR_TURN_RATE * dt);
  const res = resolveCircle(s.x + dir.x * speed * dt, s.z + dir.z * speed * dt, CHAR_RADIUS, world, selfId);
  s.x = res.x;
  s.z = res.z;
}

// ----------------------------------------------------------------------------
// Vehicles
// ----------------------------------------------------------------------------

export interface VehicleDyn {
  x: number;
  z: number;
  rot: number;
  speed: number;
  steer: number;
}

export interface VehicleParams {
  topSpeed: number;
  reverseSpeed: number;
  accel: number;
  brake: number;
  grip: number;
  maxSteer: number;
  wheelbase: number;
  halfLength: number;
  halfWidth: number;
  hasFuel: boolean;
}

export function vehicleParams(model: VehicleModel, condition: VehicleCondition, fuel: number, mods?: VehicleMods): VehicleParams {
  const eng = clamp(condition.engine, 0, 100) / 100;
  const trans = clamp(condition.transmission, 0, 100) / 100;
  const brakes = clamp(condition.brakes, 0, 100) / 100;
  const tires = clamp(condition.tires, 0, 100) / 100;
  // Installed performance parts scale the game-scale figures (see tuningSystem.performanceFactors).
  const tuned = performanceFactors(model, mods?.tuning);
  return {
    topSpeed: model.perf.topSpeed * tuned.topSpeed * (0.55 + 0.45 * eng),
    reverseSpeed: 7,
    accel: model.perf.accel * tuned.accel * (0.45 + 0.55 * eng) * (0.6 + 0.4 * trans),
    brake: model.perf.brake * tuned.brake * (0.35 + 0.65 * brakes),
    grip: model.perf.handling * tuned.grip * (0.55 + 0.45 * tires),
    maxSteer: 0.6,
    wheelbase: model.shape.length * 0.62,
    halfLength: model.shape.length / 2,
    halfWidth: model.shape.width / 2,
    hasFuel: fuel > 0.05,
  };
}

/** Collision circles for a vehicle body (front and rear). */
export function vehicleCircles(x: number, z: number, rot: number, halfLength: number, halfWidth: number): Circle[] {
  const off = Math.max(0, halfLength - halfWidth);
  const sx = Math.sin(rot) * off;
  const sz = Math.cos(rot) * off;
  const r = halfWidth + 0.05;
  return [
    { x: x + sx, z: z + sz, r },
    { x: x - sx, z: z - sz, r },
  ];
}

export interface VehicleStepResult {
  /** Impact speed (m/s) if the vehicle hit something this step. */
  impact: number;
  /** Distance travelled (m). */
  distance: number;
}

export function stepVehicle(
  v: VehicleDyn,
  cmd: Pick<InputCmd, 'keys' | 'dt'>,
  p: VehicleParams,
  world: CollisionWorld,
  selfId?: string,
): VehicleStepResult {
  const dt = clamp(cmd.dt, 0, MAX_CMD_DT);
  const keys = cmd.keys;
  const fwd = (keys & KEY.FORWARD) !== 0;
  const back = (keys & KEY.BACK) !== 0;
  let throttle = 0;
  let braking = 0;
  if (fwd) {
    if (v.speed < -0.3) braking = 1;
    else if (p.hasFuel) throttle = 1;
  }
  if (back) {
    if (v.speed > 0.3) braking = 1;
    else if (p.hasFuel) throttle = -1;
  }
  const handbrake = (keys & KEY.BRAKE) !== 0;

  if (throttle > 0) {
    const f = 1 - Math.pow(Math.max(0, v.speed) / p.topSpeed, 2);
    v.speed += p.accel * Math.max(0, f) * dt;
  } else if (throttle < 0) {
    const f = 1 - Math.pow(Math.max(0, -v.speed) / p.reverseSpeed, 2);
    v.speed -= p.accel * 0.6 * Math.max(0, f) * dt;
  }
  const decel = braking * p.brake + (handbrake ? p.brake * 1.2 : 0) + (throttle === 0 ? 1.4 + 0.012 * v.speed * v.speed : 0.2);
  const dv = decel * dt;
  if (Math.abs(v.speed) <= dv) v.speed = 0;
  else v.speed -= Math.sign(v.speed) * dv;

  // Steering
  const steerIn = (keys & KEY.LEFT ? 1 : 0) - (keys & KEY.RIGHT ? 1 : 0);
  const maxSteer = p.maxSteer / (1 + Math.abs(v.speed) / 16);
  const target = steerIn * maxSteer;
  const rate = steerIn === 0 ? 5 : 3;
  v.steer += clamp(target - v.steer, -rate * dt, rate * dt);

  const slide = handbrake && Math.abs(v.speed) > 6 ? 1.35 : 1;
  const yawRate = ((v.speed * Math.tan(v.steer)) / p.wheelbase) * Math.min(1.7, p.grip) * slide;
  v.rot += yawRate * dt;
  if (v.rot > Math.PI) v.rot -= Math.PI * 2;
  if (v.rot < -Math.PI) v.rot += Math.PI * 2;

  const hx = Math.sin(v.rot);
  const hz = Math.cos(v.rot);
  const ox = v.x;
  const oz = v.z;
  let nx = v.x + hx * v.speed * dt;
  let nz = v.z + hz * v.speed * dt;

  // Collision using front & rear circles.
  let impact = 0;
  const off = Math.max(0, p.halfLength - p.halfWidth);
  const r = p.halfWidth + 0.05;
  let pushX = 0;
  let pushZ = 0;
  let hit = false;
  let normalX = 0;
  let normalZ = 0;
  for (const sign of [1, -1]) {
    const cx = nx + hx * off * sign;
    const cz = nz + hz * off * sign;
    const res = resolveCircle(cx, cz, r, world, selfId);
    if (res.hit) {
      hit = true;
      pushX += res.x - cx;
      pushZ += res.z - cz;
      normalX += res.nx;
      normalZ += res.nz;
    }
  }
  if (hit) {
    nx += pushX;
    nz += pushZ;
    const nl = Math.hypot(normalX, normalZ) || 1;
    normalX /= nl;
    normalZ /= nl;
    const moveDirX = hx * Math.sign(v.speed || 1);
    const moveDirZ = hz * Math.sign(v.speed || 1);
    const into = -(moveDirX * normalX + moveDirZ * normalZ);
    if (into > 0.35) {
      impact = Math.abs(v.speed) * into;
      v.speed = -v.speed * 0.2;
    } else {
      v.speed *= 0.97;
    }
  }
  v.x = nx;
  v.z = nz;
  return { impact, distance: Math.hypot(v.x - ox, v.z - oz) };
}

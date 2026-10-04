// Deterministic movement & collision shared by server (authoritative) and
// client (prediction). Keep this file free of DOM/Node APIs.

import { CAR_GATES } from './alleys';
import { SECURITY_GATES } from './heists';
import { ECONOMY } from './economy.config';
import { G, KMH_PER_MS, SPEED_SCALE, driveStep, powertrainFor, topSpeedOf, tuningKey, type DriveOut, type DriveState, type Powertrain } from './drivetrain';
import { HIGHWAY_BARRIERS, inGap, nearHighway, projectToHighway } from './highway';
import { circleVsObb, obbCorners, obbNear, obbVsCircle, obbVsObb, type Contact, type OBB } from './obb';
import type { VehicleCondition, VehicleMods } from './types';
import { angleDiff, clamp } from './util';
import type { VehicleModel } from './vehicles';
import { wallsNear, type Wall } from './farShore';
import { BRIDGE_HALF, BRIDGE_PIERS, RAMP_BLOCKS, WATER, WORLD_BOX, bridgeByN, nextDeck } from './strait';
import type { AABB, Circle } from './world';

export const KEY = {
  FORWARD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  /** On foot: run. On a motorcycle: wheelie (with the throttle open). */
  SPRINT: 16,
  BRAKE: 32,
  /** Horn + headlight flash: slower traffic ahead moves over. */
  HORN: 64,
  /** A gun drawn: the character faces where the camera looks (and strafes). */
  AIM: 128,
} as const;
export const MAX_KEYS = 255;

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
  /** On a bridge deck (strait.ts): only things on the same deck touch it. */
  deck?: number;
}

/** A vehicle body (parked or driven car, highway traffic, police, drag bot) as a tight box. */
export interface DynamicBox extends OBB {
  /** Owner entity id (so an entity does not collide with itself). Traffic ids start with `tr:`. */
  id: string;
  /** Velocity (game m/s) for impact speeds; 0 for parked vehicles. */
  vx: number;
  vz: number;
  /** On a bridge deck (strait.ts): only things on the same deck touch it. */
  deck?: number;
}

export interface CollisionWorld {
  boxes: readonly AABB[];
  circles: readonly Circle[];
  dynamic: readonly DynamicCircle[];
  vehicles: readonly DynamicBox[];
  /** Road surface grip: 1 dry, 0.8 in the rain. */
  grip?: number;
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
  /** On a bridge deck (strait.ts), 0 on the ground. */
  deck?: number;
}

interface Push {
  x: number;
  z: number;
  hit: boolean;
  nx: number;
  nz: number;
  /** Id of a dynamic collider (another vehicle, traffic) that was touched. */
  hitId?: string;
}

/**
 * Push a circle out of all colliders. `from` is where the circle came from this step: thin
 * barriers push it back to that side (so fast movers can't slip through).
 */
export function resolveCircle(x: number, z: number, r: number, world: CollisionWorld, ignoreId?: string, from?: { x: number; z: number }, deck = 0): Push {
  if (deck) return resolveOnDeck(x, z, r, world, ignoreId, deck);
  let px = x;
  let pz = z;
  let hit = false;
  let nx = 0;
  let nz = 0;
  let hitId: string | undefined;
  const fromOffset = from && nearHighway(from.x, from.z, r + 2) ? projectToHighway(from.x, from.z).offset : null;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxSets(world)) {
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
    for (const b of world.vehicles) {
      if (ignoreId !== undefined && b.id === ignoreId) continue;
      if (b.deck) continue;
      const dx = px - b.x;
      const dz = pz - b.z;
      const reach = b.hl + b.hw + r;
      if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
      const c = circleVsObb(px, pz, r, b);
      if (!c) continue;
      hit = true;
      hitId = b.id;
      px += c.nx * c.depth;
      pz += c.nz * c.depth;
      nx += c.nx;
      nz += c.nz;
    }
    const circleSets: (readonly Circle[])[] = [world.circles, world.dynamic, BRIDGE_PIERS];
    for (const set of circleSets) {
      for (const c of set) {
        if (ignoreId !== undefined && (c as DynamicCircle).id === ignoreId) continue;
        if ((c as DynamicCircle).deck) continue;
        const rr = r + c.r;
        const dx = px - c.x;
        const dz = pz - c.z;
        if (dx > rr || dx < -rr || dz > rr || dz < -rr) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        hit = true;
        if (set === world.dynamic) hitId = (c as DynamicCircle).id;
        const d = Math.sqrt(d2) || 1e-4;
        const ux = d2 < 1e-8 ? 1 : dx / d;
        const uz = d2 < 1e-8 ? 0 : dz / d;
        px = c.x + ux * rr;
        pz = c.z + uz * rr;
        nx += ux;
        nz += uz;
      }
    }
    // Highway guardrails and the median barrier (analytic, with gaps at junctions/crossovers).
    if (nearHighway(px, pz, r + 1)) {
      const hp = projectToHighway(px, pz);
      for (const b of HIGHWAY_BARRIERS) {
        const d = hp.offset - b.offset;
        const lim = b.half + r;
        if (d >= lim || d <= -lim || inGap(b, hp.s)) continue;
        const ref = fromOffset !== null ? fromOffset - b.offset : d;
        const sign = ref >= 0 ? 1 : -1;
        const push = sign * lim - d;
        px += hp.nx * push;
        pz += hp.nz * push;
        nx += hp.nx * sign;
        nz += hp.nz * sign;
        hit = true;
      }
    }
    // Far shore guardrails (the touge).
    for (const w of wallsNear(px, pz, r + 1, wallTmp)) {
      const c = circleVsObb(px, pz, r, w);
      if (!c) continue;
      hit = true;
      px += c.nx * c.depth;
      pz += c.nz * c.depth;
      nx += c.nx;
      nz += c.nz;
    }
    // The strait: the banks stop anything on the ground (back to the side it came from).
    if (px > WATER.west - r && px < WATER.east + r) {
      const west = (from?.x ?? x) < (WATER.west + WATER.east) / 2;
      px = west ? WATER.west - r : WATER.east + r;
      nx += west ? -1 : 1;
      hit = true;
    }
    if (!hit) break;
  }
  return clampToWorld(px, pz, r, hit, nx, nz, hitId);
}

function clampToWorld(px: number, pz: number, r: number, hit: boolean, nx: number, nz: number, hitId: string | undefined): Push {
  const w = WORLD_BOX;
  if (px < w.minX + r || px > w.maxX - r || pz < w.minZ + r || pz > w.maxZ - r) {
    hit = true;
    if (px < w.minX + r) nx += 1;
    if (px > w.maxX - r) nx -= 1;
    if (pz < w.minZ + r) nz += 1;
    if (pz > w.maxZ - r) nz -= 1;
    px = clamp(px, w.minX + r, w.maxX - r);
    pz = clamp(pz, w.minZ + r, w.maxZ - r);
  }
  const nl = Math.hypot(nx, nz) || 1;
  return { x: px, z: pz, hit, nx: nx / nl, nz: nz / nl, hitId };
}

/** Static boxes on the ground: the world's, plus the bridges' ramp embankments. */
function boxSets(world: CollisionWorld): readonly AABB[] {
  if (cachedBoxes.src !== world.boxes) {
    cachedBoxes.src = world.boxes;
    cachedBoxes.all = [...world.boxes, ...RAMP_BLOCKS];
  }
  return cachedBoxes.all;
}
const cachedBoxes: { src: readonly AABB[] | null; all: readonly AABB[] } = { src: null, all: [] };
const wallTmp: Wall[] = [];

/** A circle on a bridge deck: the rails and others on the same deck only. */
function resolveOnDeck(x: number, z: number, r: number, world: CollisionWorld, ignoreId: string | undefined, deck: number): Push {
  const b = bridgeByN(deck)!;
  let px = x;
  let pz = z;
  let hit = false;
  let nx = 0;
  let nz = 0;
  let hitId: string | undefined;
  for (let pass = 0; pass < 2; pass++) {
    for (const o of world.vehicles) {
      if ((ignoreId !== undefined && o.id === ignoreId) || o.deck !== deck) continue;
      const c = circleVsObb(px, pz, r, o);
      if (!c) continue;
      hit = true;
      hitId = o.id;
      px += c.nx * c.depth;
      pz += c.nz * c.depth;
      nx += c.nx;
      nz += c.nz;
    }
    for (const c of world.dynamic) {
      if ((ignoreId !== undefined && c.id === ignoreId) || c.deck !== deck) continue;
      const rr = r + c.r;
      const dx = px - c.x;
      const dz = pz - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4;
      px = c.x + (dx / d) * rr;
      pz = c.z + (dz / d) * rr;
      nx += dx / d;
      nz += dz / d;
      hit = true;
      hitId = c.id;
    }
    const lim = BRIDGE_HALF - 0.3 - r;
    if (Math.abs(pz - b.z) > lim) {
      const side = pz > b.z ? 1 : -1;
      pz = b.z + side * lim;
      nz -= side;
      hit = true;
    }
  }
  return clampToWorld(px, pz, r, hit, nx, nz, hitId);
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
  const aiming = (cmd.keys & KEY.AIM) !== 0;
  // Gun drawn: face the aim (and walk sideways / backwards without turning round).
  if (aiming) s.rot += angleDiff(s.rot, cmd.yaw) * Math.min(1, CHAR_TURN_RATE * 1.5 * dt);
  if (!dir) {
    s.gait = 0;
    return;
  }
  const running = (cmd.keys & KEY.SPRINT) !== 0 && !aiming;
  const speed = running ? RUN_SPEED : WALK_SPEED;
  s.gait = running ? 2 : 1;
  if (!aiming) s.rot += angleDiff(s.rot, Math.atan2(dir.x, dir.z)) * Math.min(1, CHAR_TURN_RATE * dt);
  const tx = s.x + dir.x * speed * dt;
  const tz = s.z + dir.z * speed * dt;
  s.deck = nextDeck(s.deck ?? 0, tx, tz);
  const res = resolveCircle(tx, tz, CHAR_RADIUS, world, selfId, s, s.deck);
  s.x = res.x;
  s.z = res.z;
}


// ----------------------------------------------------------------------------
// Vehicles
// ----------------------------------------------------------------------------
//
// Longitudinal motion (engine, gearbox, drag, brakes) is real-world physics in drivetrain.ts.
// Here: steering and yaw. Steering input is smoothed (slower at speed), the steering lock shrinks
// with speed, the yaw rate follows the steering with a lag that grows with speed and mass (the
// car's inertia), and the tyres can only pull the car around a corner so hard (lateral grip) - past
// that it understeers. The velocity direction can lag behind the heading (a slide / drift, e.g. on
// the handbrake, with wheelspin or in the rain) and sliding scrubs speed.

export interface VehicleDyn extends DriveState {
  x: number;
  z: number;
  /** Heading (0 = +z). */
  rot: number;
  /** Front wheel angle (rad). */
  steer: number;
  /** Smoothed steering input -1..1 (the steering wheel: +1 full lock left). */
  input: number;
  /** Yaw rate (rad/s). */
  yaw: number;
  /** Slip angle: velocity direction minus heading (rad). */
  slip: number;
  /** Motorcycle wheelie: front wheel up (rad) and how fast it is rising (rad/s). */
  wheelie?: number;
  wheelieV?: number;
  /** On a bridge deck (strait.ts), 0 on the ground. */
  deck?: number;
}

export function newVehicleDyn(x: number, z: number, rot: number): VehicleDyn {
  return { x, z, rot, steer: 0, input: 0, yaw: 0, slip: 0, speed: 0, rpm: 0, gear: 1, shift: 0, boost: 0, thr: 0, brk: 0, nitro: 0, wheelie: 0, wheelieV: 0, deck: 0 };
}

/** Compact wire format of the authoritative vehicle state (see SelfSnap). */
export type DynTuple = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export function dynToTuple(d: VehicleDyn): DynTuple {
  const r = (v: number, k = 1000) => Math.round(v * k) / k;
  return [r(d.x), r(d.z), r(d.rot, 10000), r(d.speed), r(d.steer, 10000), r(d.input, 10000), r(d.yaw, 10000), r(d.slip, 10000), Math.round(d.rpm), d.gear, r(d.shift), r(d.boost), r(d.thr), r(d.brk), r(d.nitro ?? 0), r(d.wheelie ?? 0, 10000), r(d.wheelieV ?? 0, 10000), d.deck ?? 0];
}

export function dynFromTuple(t: readonly number[]): VehicleDyn {
  const [x, z, rot, speed, steer, input, yaw, slip, rpm, gear, shift, boost, thr, brk, nitro, wheelie, wheelieV, deck] = t as DynTuple;
  return { x, z, rot, speed, steer, input, yaw, slip, rpm, gear, shift, boost, thr, brk, nitro: nitro ?? 0, wheelie: wheelie ?? 0, wheelieV: wheelieV ?? 0, deck: deck ?? 0 };
}

export interface VehicleParams {
  /** Engine, gearbox, tyres, aero and brakes (condition applied). */
  pt: Powertrain;
  /** Collision box half extents (tight around the body). */
  halfLength: number;
  halfWidth: number;
  wheelbase: number;
  hasFuel: boolean;
  /** Front wheel lock (rad) at parking speed. */
  lock: number;
  /** Yaw response scale (heavier = lazier). */
  inertia: number;
  /** Top speed (game m/s) for the HUD and sounds. */
  topSpeed: number;
  /** A two-wheeler: can wheelie (Shift). */
  wheelie: boolean;
  /** A motorcycle or a quad: the rider sits in the open (crashes throw them off). */
  bike: boolean;
}

const paramsCache = new Map<string, VehicleParams>();

export function vehicleParams(model: VehicleModel, condition: VehicleCondition, fuel: number, mods?: VehicleMods): VehicleParams {
  const eng = Math.round(clamp(condition.engine, 0, 100));
  const trans = Math.round(clamp(condition.transmission, 0, 100));
  const brakes = Math.round(clamp(condition.brakes, 0, 100));
  const tires = Math.round(clamp(condition.tires, 0, 100));
  const hasFuel = fuel > 0.05;
  const tuning = mods?.tuning ?? null;
  const blown = !!mods?.blown;
  const armored = !!mods?.armor;
  const key = `${model.id}|${tuningKey(tuning)}|${eng}|${trans}|${brakes}|${tires}|${hasFuel}|${blown}|${armored}`;
  const hit = paramsCache.get(key);
  if (hit) return hit;
  const base = powertrainFor(model, tuning);
  // Worn parts: a tired engine is down on power, a worn gearbox shifts slowly, worn brakes and
  // tyres stop and grip less.
  const pt: Powertrain = {
    ...base,
    eff: base.eff * (0.55 + 0.45 * (eng / 100)) * (0.85 + 0.15 * (trans / 100)),
    shiftTime: base.shiftTime * (1 + (1 - trans / 100) * 1.2),
    brakeG: base.brakeG * (0.35 + 0.65 * (brakes / 100)),
    mu: base.mu * (0.7 + 0.3 * (tires / 100)),
    latGrip: base.latGrip * (0.75 + 0.25 * (tires / 100)),
  };
  // Level-3 armour: steel plates and thick glass (slower off the line, heavier in the turns).
  if (armored) pt.mass += ECONOMY.security.armorKg;
  // Burst tyres (a spike strip): running on the rims.
  if (blown) {
    pt.mu *= ECONOMY.police.spikes.traction;
    pt.latGrip *= ECONOMY.police.spikes.latGrip;
  }
  const bike = model.specs.kind === 'bike';
  const p: VehicleParams = {
    pt,
    halfLength: model.shape.length / 2 - 0.03,
    halfWidth: model.shape.width / 2 - (bike ? 0.1 : 0.04),
    wheelbase: model.shape.length * (bike ? 0.62 : 0.6),
    hasFuel,
    lock: bike ? 0.5 : 0.62,
    inertia: Math.sqrt(clamp(pt.mass / 1500, 0.5, 2.4)),
    topSpeed: topSpeedOf(pt) / SPEED_SCALE,
    wheelie: bike && model.shape.style !== 'atv',
    bike,
  };
  if (paramsCache.size > 300) paramsCache.clear();
  paramsCache.set(key, p);
  return p;
}

/** A vehicle's collision box. */
export function vehicleBox(id: string, x: number, z: number, rot: number, halfLength: number, halfWidth: number, vx = 0, vz = 0, deck = 0): DynamicBox {
  return deck ? { id, x, z, rot, hl: halfLength, hw: halfWidth, vx, vz, deck } : { id, x, z, rot, hl: halfLength, hw: halfWidth, vx, vz };
}

export interface VehicleStepResult {
  /** Impact speed (game m/s, along the contact normal) if the vehicle hit something. */
  impact: number;
  /** Distance travelled (m). */
  distance: number;
  /** A vehicle (other car, traffic) that was touched. */
  hitId?: string;
  /** A wheelie went past the balance point: the bike flipped over backwards (the rider comes off). */
  flipped?: boolean;
  /** ABS working, wheels locked, wheelspin, sliding, gear change - for sounds and effects. */
  abs: boolean;
  locked: boolean;
  wheelspin: number;
  sliding: boolean;
  shifted: number;
}

/** The bike-only gates: the back alleys' ends and the heist targets' security forecourts. */
const ALL_GATES = [...CAR_GATES, ...SECURITY_GATES];

/** Longest distance a vehicle moves in one physics sub-step (keeps fast cars from tunnelling). */
const MAX_SUBSTEP_DIST = 1;

export function stepVehicle(v: VehicleDyn, cmd: Pick<InputCmd, 'keys' | 'dt'>, p: VehicleParams, world: CollisionWorld, selfId?: string): VehicleStepResult {
  const dt = clamp(cmd.dt, 0, MAX_CMD_DT);
  const n = Math.min(8, Math.max(2, Math.ceil((Math.abs(v.speed) * dt) / MAX_SUBSTEP_DIST)));
  const out: VehicleStepResult = { impact: 0, distance: 0, abs: false, locked: false, wheelspin: 0, sliding: false, shifted: 0 };
  for (let i = 0; i < n; i++) stepVehicleOnce(v, cmd.keys, dt / n, p, world, selfId, out);
  return out;
}

const driveOut: DriveOut = { accel: 0, wheelspin: 0, abs: false, locked: false, shifted: 0, limiting: false };
const corners: number[] = [];

function stepVehicleOnce(v: VehicleDyn, keys: number, dt: number, p: VehicleParams, world: CollisionWorld, selfId: string | undefined, res: VehicleStepResult): void {
  const fwd = (keys & KEY.FORWARD) !== 0;
  const back = (keys & KEY.BACK) !== 0;
  const handbrake = (keys & KEY.BRAKE) !== 0;
  let throttle = 0;
  let brake = 0;
  let reverse = false;
  if (fwd) {
    if (v.speed < -0.3) brake = 1;
    else throttle = 1;
  }
  if (back) {
    if (v.speed > 0.3) brake = 1;
    else {
      throttle = 1;
      reverse = true;
    }
  }
  const grip = world.grip ?? 1;
  const rot0 = v.rot;
  const phi0 = v.speed >= 0 ? v.rot + v.slip : v.rot;
  const d = driveStep(p.pt, v, { throttle, brake, reverse, handbrake, grip, noFuel: !p.hasFuel }, dt, driveOut);
  res.abs ||= d.abs;
  res.locked ||= d.locked;
  res.wheelspin = Math.max(res.wheelspin, d.wheelspin);
  if (d.shifted) res.shifted = d.shifted;

  // --- steering and yaw (game units: what the eye sees)
  const vg = v.speed;
  const av = Math.abs(vg);
  const vr = av * SPEED_SCALE;
  const aero = 1 + p.pt.downforce * (vr / 80) * (vr / 80);
  const aLat = G * p.pt.latGrip * grip * aero;
  const sIn = (keys & KEY.LEFT ? 1 : 0) - (keys & KEY.RIGHT ? 1 : 0);
  const tauS = (sIn === 0 ? 0.08 : 0.12) + 0.24 * Math.min(1, vr / 55);
  v.input += (sIn - v.input) * (1 - Math.exp(-dt / tauS));
  // The usable steering lock shrinks with speed (a little past the grip limit at full lock).
  const lockGrip = Math.atan((aLat * 1.12 * p.wheelbase) / Math.max(1, av * av));
  // Front wheel in the air: you steer by leaning only, much less.
  const up = (v.wheelie ?? 0) > 0.12 ? 0.35 : 1;
  const lock = Math.min(p.lock, Math.max(0.025, lockGrip)) * up;
  v.steer = v.input * lock;
  const slide = handbrake && av > 3;
  let wT = (vg * Math.tan(v.steer)) / p.wheelbase;
  let wMax = aLat / Math.max(1.5, av);
  if (slide) {
    wT *= 1.6;
    wMax *= 2.1;
  }
  if (d.locked) wT *= 0.15;
  wT = clamp(wT, -wMax, wMax);
  const tauY = 0.05 + 0.27 * Math.min(1, vr / 70) * p.inertia;
  v.yaw += (wT - v.yaw) * (1 - Math.exp(-dt / tauY));
  v.rot = rot0 + v.yaw * dt;
  if (v.rot > Math.PI) v.rot -= Math.PI * 2;
  if (v.rot < -Math.PI) v.rot += Math.PI * 2;

  // --- where the car is actually going: the tyres pull the velocity round towards the heading,
  // limited by the grip that is left (handbrake, wheelspin, locked wheels and rain take some away).
  let phi: number;
  if (vg > 0.5) {
    let cap = aLat;
    if (slide) cap *= 0.3;
    if (d.wheelspin > 0 && p.pt.drive !== 'fwd') cap *= Math.max(0.3, 1 - d.wheelspin * (p.pt.drive === 'rwd' ? 1 : 0.45));
    if (d.locked) cap *= 0.6;
    const want = angleDiff(phi0, v.rot);
    const maxTurn = (cap / av) * dt;
    phi = phi0 + clamp(want, -maxTurn, maxTurn);
    v.slip = clamp(angleDiff(v.rot, phi), -1.25, 1.25);
    phi = v.rot + v.slip;
    const sl = Math.abs(Math.sin(v.slip));
    if (sl > 0.03) {
      res.sliding = true;
      v.speed = Math.max(0, v.speed - ((0.75 * G * grip * sl) / SPEED_SCALE) * dt);
    }
  } else {
    v.slip *= Math.exp(-dt * 8);
    phi = v.rot + (vg >= 0 ? v.slip : 0);
  }

  const ox = v.x;
  const oz = v.z;
  v.x += Math.sin(phi) * v.speed * dt;
  v.z += Math.cos(phi) * v.speed * dt;
  v.deck = nextDeck(v.deck ?? 0, v.x, v.z);

  // --- collisions: push the body box out, then bounce and scrub the velocity.
  const c = resolveVehicle(v, p, world, selfId, ox, oz);
  if (c) {
    const vel = v.speed;
    const hd = v.speed >= 0 ? v.rot + v.slip : v.rot;
    let vx = Math.sin(hd) * vel;
    let vz = Math.cos(hd) * vel;
    let rx = vx - c.ovx;
    let rz = vz - c.ovz;
    const vn = rx * c.nx + rz * c.nz;
    if (vn < 0) {
      res.impact = Math.max(res.impact, -vn);
      const e = 0.12;
      const jx = -(1 + e) * vn * c.nx;
      const jz = -(1 + e) * vn * c.nz;
      rx += jx;
      rz += jz;
      // Friction along the contact scrubs speed.
      const tn = rx * c.nx + rz * c.nz;
      const tx = rx - tn * c.nx;
      const tz = rz - tn * c.nz;
      const scrub = 1 - Math.min(0.5, 0.06 + 0.04 * -vn);
      rx = tn * c.nx + tx * scrub;
      rz = tn * c.nz + tz * scrub;
      vx = rx + c.ovx;
      vz = rz + c.ovz;
      // Off-centre hits spin the car.
      const L = p.halfLength * 2;
      const W = p.halfWidth * 2;
      const ax = c.px - v.x;
      const az = c.pz - v.z;
      v.yaw = clamp(v.yaw + (0.55 * 12 * (az * jx - ax * jz)) / (L * L + W * W), -4, 4);
      const hx = Math.sin(v.rot);
      const hz = Math.cos(v.rot);
      const along = vx * hx + vz * hz;
      const mag = Math.hypot(vx, vz);
      if (along >= 0) {
        v.speed = mag;
        v.slip = mag > 0.3 ? clamp(angleDiff(v.rot, Math.atan2(vx, vz)), -1.25, 1.25) : 0;
      } else {
        v.speed = -Math.abs(along);
        v.slip = 0;
      }
    }
    if (c.hitId) res.hitId = c.hitId;
  }
  res.distance += Math.hypot(v.x - ox, v.z - oz);
  if (p.wheelie) stepWheelie(v, keys, throttle > 0 && !reverse, brake > 0 || handbrake, dt, res);
}

/**
 * Wheelie: holding the wheelie key with the throttle open above wheelieMinKmh lifts the front.
 * Gravity pulls it back down below the balance point and over backwards past it, so you keep it
 * up by feathering the key; the brake brings it down. Past wheelieFlip the bike flips.
 */
export function stepWheelie(v: VehicleDyn, keys: number, throttle: boolean, braking: boolean, dt: number, res: { flipped?: boolean }): void {
  const c = ECONOMY.bikes;
  const kmh = v.speed * KMH_PER_MS;
  let a = v.wheelie ?? 0;
  let w = v.wheelieV ?? 0;
  const lifting = (keys & KEY.SPRINT) !== 0 && throttle && kmh >= (a > 0.02 ? c.wheelieHoldKmh : c.wheelieMinKmh);
  if (a <= 0 && !lifting) {
    v.wheelie = 0;
    v.wheelieV = 0;
    return;
  }
  let acc = -c.wheelieGravity * Math.sin(c.wheelieBalance - a);
  if (lifting) acc += c.wheelieLift;
  if (braking || kmh < c.wheelieHoldKmh) acc -= c.wheelieBrake;
  w = (w + acc * dt) * Math.exp(-c.wheelieDamp * dt);
  a += w * dt;
  if (a <= 0) {
    a = 0;
    w = 0;
  }
  if (a >= c.wheelieFlip) {
    res.flipped = true;
    a = 0;
    w = 0;
    v.speed *= 0.2;
  }
  v.wheelie = a;
  v.wheelieV = w;
}

interface VehicleContact {
  nx: number;
  nz: number;
  px: number;
  pz: number;
  /** Velocity of what was hit. */
  ovx: number;
  ovz: number;
  hitId?: string;
}

const box: OBB = { x: 0, z: 0, rot: 0, hl: 0, hw: 0 };

/** Push the vehicle's box out of everything it overlaps (a few passes, deepest contact first). */
function resolveVehicle(v: VehicleDyn, p: VehicleParams, world: CollisionWorld, selfId: string | undefined, ox: number, oz: number): VehicleContact | null {
  box.rot = v.rot;
  box.hl = p.halfLength;
  box.hw = p.halfWidth;
  let result: VehicleContact | null = null;
  let sumX = 0;
  let sumZ = 0;
  const reach = p.halfLength + p.halfWidth;
  for (let pass = 0; pass < 4; pass++) {
    box.x = v.x;
    box.z = v.z;
    let best: Contact | null = null;
    let bestVx = 0;
    let bestVz = 0;
    let bestId: string | undefined;
    const take = (c: Contact | null, vx = 0, vz = 0, id?: string) => {
      if (c && (!best || c.depth > best.depth)) {
        best = c;
        bestVx = vx;
        bestVz = vz;
        bestId = id;
      }
    };
    const deck = v.deck ?? 0;
    if (deck) {
      // On a bridge: the rails and whatever else is on the same deck.
      for (const ci of world.dynamic) {
        if (ci.deck !== deck) continue;
        const rr = reach + ci.r;
        const dx = v.x - ci.x;
        const dz = v.z - ci.z;
        if (dx > rr || dx < -rr || dz > rr || dz < -rr) continue;
        take(obbVsCircle(box, ci.x, ci.z, ci.r), 0, 0, ci.id);
      }
      for (const o of world.vehicles) {
        if ((selfId !== undefined && o.id === selfId) || o.deck !== deck) continue;
        if (!obbNear(box, o)) continue;
        take(obbVsObb(box, o), o.vx, o.vz, o.id);
      }
      take(railContact(deck));
    }
    for (const b of deck ? [] : boxSets(world)) {
      if (v.x + reach < b.minX || v.x - reach > b.maxX || v.z + reach < b.minZ || v.z - reach > b.maxZ) continue;
      take(obbVsObb(box, { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, rot: 0, hl: (b.maxZ - b.minZ) / 2, hw: (b.maxX - b.minX) / 2 }));
    }
    // The back alleys and the security forecourts: a car (not a bike or an ATV) can't get between the bollards.
    if (!deck && !p.bike) {
      for (const g of ALL_GATES) {
        if (v.x + reach < g.minX || v.x - reach > g.maxX || v.z + reach < g.minZ || v.z - reach > g.maxZ) continue;
        take(obbVsObb(box, { x: (g.minX + g.maxX) / 2, z: (g.minZ + g.maxZ) / 2, rot: 0, hl: (g.maxZ - g.minZ) / 2, hw: (g.maxX - g.minX) / 2 }));
      }
    }
    for (const set of (deck ? [] : [world.circles, world.dynamic, BRIDGE_PIERS]) as (readonly Circle[])[]) {
      for (const ci of set) {
        if ((ci as DynamicCircle).deck) continue;
        const rr = reach + ci.r;
        const dx = v.x - ci.x;
        const dz = v.z - ci.z;
        if (dx > rr || dx < -rr || dz > rr || dz < -rr) continue;
        take(obbVsCircle(box, ci.x, ci.z, ci.r), 0, 0, set === world.dynamic ? (ci as DynamicCircle).id : undefined);
      }
    }
    for (const o of deck ? [] : world.vehicles) {
      if ((selfId !== undefined && o.id === selfId) || o.deck) continue;
      if (!obbNear(box, o)) continue;
      take(obbVsObb(box, o), o.vx, o.vz, o.id);
    }
    if (!deck) {
      take(barrierContact(v, ox, oz));
      take(waterContact(ox));
      for (const w of wallsNear(v.x, v.z, reach + 1, wallTmp)) if (obbNear(box, w)) take(obbVsObb(box, w));
    }
    take(boundsContact());
    if (!best) break;
    const c: Contact = best;
    const push = c.depth + 1e-4;
    v.x += c.nx * push;
    v.z += c.nz * push;
    sumX += c.nx * c.depth;
    sumZ += c.nz * c.depth;
    result ??= { nx: 0, nz: 0, px: c.px, pz: c.pz, ovx: bestVx, ovz: bestVz };
    if (bestId) {
      result.hitId = bestId;
      result.ovx = bestVx;
      result.ovz = bestVz;
    }
  }
  if (!result) return null;
  const l = Math.hypot(sumX, sumZ) || 1;
  result.nx = sumX / l;
  result.nz = sumZ / l;
  return result;
}

/** Highway guardrails and the median (analytic, with gaps at junctions and crossovers). */
function barrierContact(v: VehicleDyn, ox: number, oz: number): Contact | null {
  if (!nearHighway(box.x, box.z, box.hl + 2)) return null;
  const from = projectToHighway(ox, oz).offset;
  obbCorners(box, corners);
  let best: Contact | null = null;
  const proj = [0, 2, 4, 6].map((i) => ({ x: corners[i]!, z: corners[i + 1]!, hp: projectToHighway(corners[i]!, corners[i + 1]!) }));
  for (const b of HIGHWAY_BARRIERS) {
    const side = from - b.offset >= 0 ? 1 : -1;
    // A car well clear of this barrier line can't touch it.
    if (Math.abs(from - b.offset) > box.hl + box.hw + 2) continue;
    for (const q of proj) {
      if (inGap(b, q.hp.s)) continue;
      const dd = (q.hp.offset - b.offset) * side;
      const pen = b.half - dd;
      if (pen <= 0 || pen > 6) continue;
      if (!best || pen > best.depth) best = { nx: q.hp.nx * side, nz: q.hp.nz * side, depth: pen, px: q.x, pz: q.z };
    }
  }
  void v;
  return best;
}

/** The banks of the strait (a car on the ground stays on its side of the water). */
function waterContact(ox: number): Contact | null {
  if (box.x + box.hl + box.hw < WATER.west || box.x - box.hl - box.hw > WATER.east) return null;
  obbCorners(box, corners);
  const west = ox < (WATER.west + WATER.east) / 2;
  let best: Contact | null = null;
  for (let i = 0; i < 8; i += 2) {
    const x = corners[i]!;
    const pen = west ? x - WATER.west : WATER.east - x;
    if (pen > 0 && (!best || pen > best.depth)) best = { nx: west ? -1 : 1, nz: 0, depth: pen, px: x, pz: corners[i + 1]! };
  }
  return best;
}

/** A bridge deck's rails. */
function railContact(deck: number): Contact | null {
  const b = bridgeByN(deck);
  if (!b) return null;
  obbCorners(box, corners);
  const lim = BRIDGE_HALF - 0.3;
  let best: Contact | null = null;
  for (let i = 0; i < 8; i += 2) {
    const dz = corners[i + 1]! - b.z;
    const pen = Math.abs(dz) - lim;
    if (pen > 0 && (!best || pen > best.depth)) best = { nx: 0, nz: dz > 0 ? -1 : 1, depth: pen, px: corners[i]!, pz: corners[i + 1]! };
  }
  return best;
}

function boundsContact(): Contact | null {
  obbCorners(box, corners);
  const w = WORLD_BOX;
  let best: Contact | null = null;
  for (let i = 0; i < 8; i += 2) {
    const x = corners[i]!;
    const z = corners[i + 1]!;
    const checks: [number, number, number][] = [
      [x - w.maxX, -1, 0],
      [w.minX - x, 1, 0],
      [z - w.maxZ, 0, -1],
      [w.minZ - z, 0, 1],
    ];
    for (const [pen, nx, nz] of checks) if (pen > 0 && (!best || pen > best.depth)) best = { nx, nz, depth: pen, px: x, pz: z };
  }
  return best;
}

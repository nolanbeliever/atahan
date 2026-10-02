// Server-authoritative movement simulation. Clients send input commands; the
// server applies them with the shared physics and broadcasts snapshots.

import { KMH_PER_MS } from '../../shared/drivetrain';
import { ECONOMY } from '../../shared/economy.config';
import { MARKET_LOT_SLOTS, INTERACTABLES, SERVICE_INTERACT_SLACK, type Interactable } from '../../shared/world';
import { worldBoxes, vehicleObstacles, STATIC_CIRCLES, type ObstacleVehicle } from '../../shared/collision';
import {
  CHAR_RADIUS,
  KEY,
  MAX_CMD_DT,
  MAX_KEYS,
  newVehicleDyn,
  resolveCircle,
  stepCharacter,
  stepVehicle,
  vehicleParams,
  type CollisionWorld,
  type DynamicBox,
  type InputCmd,
  type VehicleDyn,
  type VehicleParams,
} from '../../shared/physics';
import { surfaceGrip } from '../../shared/environment';
import { Anim, VF, type NpcSnap, type PlayerSnap, type Vehicle, type VehicleSnap } from '../../shared/types';
import { round2 } from '../../shared/util';
import { getModel } from '../../shared/vehicles';
import { exitSide } from '../../shared/passengers';
import { nearHighway } from '../../shared/highway';
import { deckAt } from '../../shared/strait';
import type { GameState } from './state';
import { TrafficSystem, type HighwayBody } from './traffic';

export interface CharacterEntity {
  id: string;
  x: number;
  z: number;
  rot: number;
  gait: number;
  /** On a bridge deck (shared/strait.ts), 0 on the ground. */
  deck?: number;
  drivingId: string | null;
  /** Riding as a passenger in someone else's car (and which seat, see shared/passengers.ts). */
  ridingId: string | null;
  seat: number;
  lastSeq: number;
  /** Seconds of simulation the client may still claim (anti speed-hack). */
  budget: number;
  budgetAt: number;
  interactUntil: number;
  droppedCmds: number;
  lastInputAt: number;
  /** Last time the player actually did something (pressed a key, turned the camera, used a menu). */
  activeAt: number;
  lastYaw: number;
  /** Last time the horn / headlight flash was used (ms). */
  hornAt: number;
  /** Gun drawn (shared/weapons.ts slot, 0: none) and down (WASTED). */
  weapon: number;
  dead: boolean;
}

export interface DriveState {
  vehicleId: string;
  playerId: string;
  dyn: VehicleDyn;
  params: VehicleParams;
  /** Metres driven since the last flush. */
  pendingDistance: number;
  /** Worst impact speed since the last flush, summed damage. */
  pendingDamage: number;
  lastFlushAt: number;
  /** Last crash (hard impact or any contact with traffic), ms. */
  crashAt: number;
  /** Last time a motorcycle / quad threw its riders off (ms). */
  bikeCrashAt?: number;
  /** While true the vehicle ignores the driver's input (drag strip staging, arrests). */
  hold: boolean;
  /** Snapshot flags from the last physics step (VF). */
  flags: number;
  /** Last near-contact and hard-contact bookkeeping for services (ms). */
  lastHitId: string | null;
  lastHitAt: number;
}

export interface NpcEntity {
  id: string;
  x: number;
  z: number;
  rot: number;
  anim: number;
  style: number;
}

export interface DriveFlush {
  distance: number;
  damage: number;
  dyn: VehicleDyn;
}

const MAX_BUDGET = 1.0;

/** Held vehicles only keep the brakes (the driver's inputs are ignored). */
function holdKeys(keys: number): number {
  return (keys & KEY.HORN) | KEY.BRAKE;
}

export class Simulation {
  readonly chars = new Map<string, CharacterEntity>();
  readonly drives = new Map<string, DriveState>();
  readonly npcs = new Map<string, NpcEntity>();
  private dynamic: DynamicBox[] = [];
  private world: CollisionWorld = { boxes: [], circles: STATIC_CIRCLES, dynamic: [], vehicles: this.dynamic, grip: 1 };
  readonly traffic = new TrafficSystem();
  /** Players, walkers and parked cars on the highway (traffic brakes for them). */
  highwayBodies: HighwayBody[] = [];
  /** Extra vehicles owned by services (drag strip bots, police cars), by owner. */
  private obstacleSources = new Map<string, ObstacleVehicle[]>();
  /** A motorcycle or quad crashed (crash speed in km/h; flipped: a wheelie went over). */
  readonly bikeCrashListeners: ((vehicleId: string, kmh: number, flipped: boolean) => void)[] = [];

  constructor(private readonly state: GameState) {
    this.rebuildStatic();
  }

  /** Recompute building colliders (after a dealership purchase/upgrade). */
  rebuildStatic(): void {
    const levels = new Map<string, number>();
    for (const d of this.state.dealerships.values()) levels.set(d.plotId, d.level);
    this.world = { boxes: worldBoxes(levels), circles: STATIC_CIRCLES, dynamic: [], vehicles: this.dynamic, grip: this.world.grip };
  }

  /** Recompute vehicle obstacles (called every tick). Passengers move with their vehicle even
   *  when their client sends no input. */
  rebuildDynamic(): void {
    for (const c of this.chars.values()) if (c.ridingId) this.followRide(c);
    const list: ObstacleVehicle[] = [];
    for (const v of this.state.vehicles.values()) {
      if (this.drives.has(v.id)) continue;
      if (v.status === 'world' || v.status === 'displayed' || v.status === 'stolen') list.push({ id: v.id, modelId: v.modelId, x: v.x, z: v.z, rot: v.rotation, deck: this.parkedDeck(v.id, v.x, v.z) });
    }
    for (const l of this.state.listings.values()) {
      const v = this.state.vehicles.get(l.vehicleId);
      const slot = MARKET_LOT_SLOTS[l.lotSlot];
      if (v && slot) list.push({ id: v.id, modelId: v.modelId, x: slot.x, z: slot.z, rot: slot.rot });
    }
    for (const d of this.drives.values()) {
      const v = this.state.vehicles.get(d.vehicleId);
      const h = d.dyn.speed >= 0 ? d.dyn.rot + d.dyn.slip : d.dyn.rot;
      if (v) list.push({ id: v.id, modelId: v.modelId, x: d.dyn.x, z: d.dyn.z, rot: d.dyn.rot, vx: Math.sin(h) * d.dyn.speed, vz: Math.cos(h) * d.dyn.speed, deck: d.dyn.deck ?? 0 });
    }
    for (const extra of this.obstacleSources.values()) list.push(...extra);
    this.dynamic.length = 0;
    vehicleObstacles(list, this.dynamic);
    this.world.grip = surfaceGrip(Date.now());
    // Traffic near someone who could touch it.
    const near: { x: number; z: number }[] = [];
    for (const c of this.chars.values()) if (nearHighway(c.x, c.z, 60)) near.push(c);
    this.traffic.boxesNear(near, 70, this.dynamic);
    // What traffic has to brake for.
    const bodies: HighwayBody[] = [];
    for (const o of list) {
      // Up on a bridge over the highway: not in the traffic's way.
      if (o.deck || !nearHighway(o.x, o.z, 4)) continue;
      const m = getModel(o.modelId);
      const d = this.drives.get(o.id);
      const speed = d ? d.dyn.speed : o.vx !== undefined ? Math.sin(o.rot) * o.vx + Math.cos(o.rot) * (o.vz ?? 0) : 0;
      bodies.push({ id: o.id, x: o.x, z: o.z, rot: o.rot, speed, halfLength: m.shape.length / 2, halfWidth: m.shape.width / 2 });
    }
    for (const c of this.chars.values()) {
      if (!c.drivingId && !c.ridingId && !c.deck && nearHighway(c.x, c.z, 4)) bodies.push({ id: c.id, x: c.x, z: c.z, rot: c.rot, speed: 0, halfLength: CHAR_RADIUS, halfWidth: CHAR_RADIUS });
    }
    this.highwayBodies = bodies;
  }

  /** Cars left standing on a bridge deck (not saved: after a restart the position decides). */
  private readonly deckParked = new Map<string, number>();

  private parkedDeck(vehicleId: string, x: number, z: number): number {
    return this.deckParked.get(vehicleId) ?? deckAt(x, z);
  }

  /** Which deck a parked vehicle stands on (0: the ground). */
  deckOfParked(vehicleId: string, x: number, z: number): number {
    const d = this.drives.get(vehicleId);
    return d ? d.dyn.deck ?? 0 : this.parkedDeck(vehicleId, x, z);
  }

  /** A vehicle was parked by a service at a known level. */
  setParkedDeck(vehicleId: string, deck: number): void {
    if (deck) this.deckParked.set(vehicleId, deck);
    else this.deckParked.delete(vehicleId);
  }

  /** Vehicles a service owns (drag bots, police): colliders and traffic obstacles. */
  setExtraObstacles(owner: string, list: ObstacleVehicle[]): void {
    if (list.length === 0) this.obstacleSources.delete(owner);
    else this.obstacleSources.set(owner, list);
  }

  /** Advance the highway traffic (players and parked cars are obstacles). */
  stepTraffic(dt: number): void {
    this.traffic.step(dt, this.highwayBodies);
  }

  get collisionWorld(): CollisionWorld {
    return this.world;
  }

  addPlayer(id: string, x: number, z: number, rot: number): CharacterEntity {
    const now = Date.now();
    const c: CharacterEntity = { id, x, z, rot, gait: 0, drivingId: null, ridingId: null, seat: 0, lastSeq: 0, budget: 0.25, budgetAt: now, interactUntil: 0, droppedCmds: 0, lastInputAt: now, activeAt: now, lastYaw: 0, hornAt: 0, weapon: 0, dead: false };
    this.chars.set(id, c);
    return c;
  }

  removePlayer(id: string): void {
    this.chars.delete(id);
  }

  position(playerId: string): { x: number; z: number; rot: number } | null {
    const c = this.chars.get(playerId);
    return c ? { x: c.x, z: c.z, rot: c.rot } : null;
  }

  isDriven(vehicleId: string): boolean {
    return this.drives.has(vehicleId);
  }

  driverOf(vehicleId: string): string | null {
    return this.drives.get(vehicleId)?.playerId ?? null;
  }

  /** Players riding along in a vehicle. */
  ridersOf(vehicleId: string): CharacterEntity[] {
    return [...this.chars.values()].filter((c) => c.ridingId === vehicleId);
  }

  /** Get into someone's car as a passenger (the caller checks the seat is free). */
  startRiding(playerId: string, vehicleId: string, seat: number): void {
    const c = this.chars.get(playerId);
    const d = this.drives.get(vehicleId);
    if (!c || !d) return;
    c.ridingId = vehicleId;
    c.seat = seat;
    c.x = d.dyn.x;
    c.z = d.dyn.z;
    c.rot = d.dyn.rot;
    c.deck = d.dyn.deck ?? 0;
    c.gait = 0;
  }

  /** Get out of a car as a passenger; returns where the character stands. */
  stopRiding(playerId: string): { x: number; z: number } | null {
    const c = this.chars.get(playerId);
    if (!c || !c.ridingId) return null;
    const d = this.drives.get(c.ridingId);
    c.ridingId = null;
    if (d) this.placeBeside(c, d, exitSide(c.seat));
    return { x: c.x, z: c.z };
  }

  /** Stand a character beside a car (side 1 = the driver's / left side, -1 = the right), clear of obstacles. */
  private placeBeside(c: CharacterEntity, d: DriveState, side: 1 | -1): void {
    const left = { x: Math.cos(d.dyn.rot), z: -Math.sin(d.dyn.rot) };
    const off = d.params.halfWidth + 0.9;
    const candidates = [
      { x: d.dyn.x + left.x * off * side, z: d.dyn.z + left.z * off * side },
      { x: d.dyn.x - left.x * off * side, z: d.dyn.z - left.z * off * side },
      { x: d.dyn.x - Math.sin(d.dyn.rot) * (d.params.halfLength + 1), z: d.dyn.z - Math.cos(d.dyn.rot) * (d.params.halfLength + 1) },
    ];
    this.rebuildDynamic();
    const deck = d.dyn.deck ?? 0;
    let chosen = candidates[0]!;
    for (const p of candidates) {
      const res = resolveCircle(p.x, p.z, CHAR_RADIUS, this.world, undefined, undefined, deck);
      if (!res.hit) {
        chosen = p;
        break;
      }
    }
    const settled = resolveCircle(chosen.x, chosen.z, CHAR_RADIUS, this.world, undefined, undefined, deck);
    c.x = settled.x;
    c.z = settled.z;
    c.deck = deck;
    c.gait = 0;
  }

  /** Distance from the player to an interactable (with latency slack). */
  isNear(playerId: string, target: { x: number; z: number }, radius: number): boolean {
    const c = this.chars.get(playerId);
    if (!c) return false;
    return Math.hypot(c.x - target.x, c.z - target.z) <= radius;
  }

  isNearInteractable(playerId: string, kind: Interactable['kind']): boolean {
    return INTERACTABLES.some((i) => i.kind === kind && this.isNear(playerId, i, i.radius + SERVICE_INTERACT_SLACK));
  }

  markInteract(playerId: string): void {
    const c = this.chars.get(playerId);
    if (c) c.interactUntil = Date.now() + 900;
  }

  /** Apply a batch of client input commands. Invalid commands are ignored. */
  handleInputs(playerId: string, cmds: unknown): void {
    const c = this.chars.get(playerId);
    if (!c || !Array.isArray(cmds) || cmds.length === 0 || cmds.length > 16) return;
    const now = Date.now();
    c.budget = Math.min(MAX_BUDGET, c.budget + (now - c.budgetAt) / 1000);
    c.budgetAt = now;
    for (const raw of cmds as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const cmd = raw as Partial<InputCmd>;
      const seq = cmd.seq;
      const dt = cmd.dt;
      const keys = cmd.keys;
      const yaw = cmd.yaw;
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= c.lastSeq || seq > c.lastSeq + 10_000) continue;
      if (typeof dt !== 'number' || !(dt > 0) || dt > MAX_CMD_DT) continue;
      if (typeof keys !== 'number' || !Number.isInteger(keys) || keys < 0 || keys > MAX_KEYS) continue;
      if (typeof yaw !== 'number' || !Number.isFinite(yaw)) continue;
      c.lastSeq = seq;
      // Speed-hack protection: a client cannot simulate more time than has passed.
      if (dt > c.budget + 1e-6) {
        c.droppedCmds++;
        continue;
      }
      c.budget -= dt;
      c.lastInputAt = now;
      if (keys !== 0 || Math.abs(yaw - c.lastYaw) > 1e-3) c.activeAt = now;
      c.lastYaw = yaw;
      if (keys & KEY.HORN) c.hornAt = now;
      this.applyCommand(c, { seq, dt, keys, yaw });
    }
  }

  private applyCommand(c: CharacterEntity, cmd: InputCmd): void {
    // Down (WASTED): no moving until the hospital.
    if (c.dead) return;
    // Passengers just ride along.
    if (c.ridingId) {
      this.followRide(c);
      return;
    }
    if (c.drivingId) {
      const d = this.drives.get(c.drivingId);
      if (!d) {
        c.drivingId = null;
        return;
      }
      const keys = d.hold ? holdKeys(cmd.keys) : cmd.keys;
      const before = d.dyn.speed;
      const res = stepVehicle(d.dyn, { ...cmd, keys }, d.params, this.world, d.vehicleId);
      // A motorcycle or quad: flipping a wheelie or a hard hit throws the riders off.
      if (d.params.bike && (res.flipped || res.impact > ECONOMY.bikes.crashImpact)) {
        const kmh = Math.abs(res.flipped ? before : res.impact) * KMH_PER_MS;
        for (const l of this.bikeCrashListeners) l(d.vehicleId, kmh, !!res.flipped);
        if (!this.drives.has(d.vehicleId)) return;
      }
      d.flags =
        (d.dyn.brk > 0.1 ? VF.BRAKE : 0) |
        (d.dyn.gear < 0 ? VF.REVERSE : 0) |
        (res.sliding || res.locked || res.wheelspin > 0.25 ? VF.SLIDE : 0) |
        (d.dyn.boost > 0.6 ? VF.BOOST : 0) |
        (keys & KEY.HORN ? VF.HORN : 0) |
        ((d.dyn.nitro ?? 0) > 0 ? VF.NITRO : 0);
      if (res.hitId) {
        d.lastHitId = res.hitId;
        d.lastHitAt = Date.now();
      }
      d.pendingDistance += res.distance;
      if (res.impact > ECONOMY.world.impactDamageThreshold) {
        d.pendingDamage += (res.impact - ECONOMY.world.impactDamageThreshold) * ECONOMY.world.impactDamagePerMs;
      }
      if (res.impact > ECONOMY.highway.crashImpact || res.hitId?.startsWith('tr:')) d.crashAt = Date.now();
      c.x = d.dyn.x;
      c.z = d.dyn.z;
      c.rot = d.dyn.rot;
      c.deck = d.dyn.deck ?? 0;
      c.gait = 0;
      return;
    }
    stepCharacter(c, cmd, this.world, c.id);
    if (cmd.keys & (KEY.FORWARD | KEY.BACK | KEY.LEFT | KEY.RIGHT)) c.interactUntil = 0;
  }

  startDriving(playerId: string, v: Vehicle): void {
    const c = this.chars.get(playerId);
    if (!c) return;
    const model = getModel(v.modelId);
    const d: DriveState = {
      vehicleId: v.id,
      playerId,
      dyn: { ...newVehicleDyn(v.x, v.z, v.rotation), deck: this.parkedDeck(v.id, v.x, v.z) },
      params: vehicleParams(model, v.condition, v.fuel, v.mods),
      pendingDistance: 0,
      pendingDamage: 0,
      lastFlushAt: Date.now(),
      crashAt: 0,
      hold: false,
      flags: 0,
      lastHitId: null,
      lastHitAt: 0,
    };
    this.drives.set(v.id, d);
    this.deckParked.delete(v.id);
    c.drivingId = v.id;
    c.x = v.x;
    c.z = v.z;
    c.deck = d.dyn.deck;
  }

  /** Refresh physics parameters after the vehicle record changed (fuel, repairs). */
  refreshParams(v: Vehicle): void {
    const d = this.drives.get(v.id);
    if (d) d.params = vehicleParams(getModel(v.modelId), v.condition, v.fuel, v.mods);
  }

  /** Take the accumulated driving results (distance/damage) for persistence. */
  takeFlush(vehicleId: string): DriveFlush | null {
    const d = this.drives.get(vehicleId);
    if (!d) return null;
    const out = { distance: d.pendingDistance, damage: d.pendingDamage, dyn: { ...d.dyn } };
    d.pendingDistance = 0;
    d.pendingDamage = 0;
    d.lastFlushAt = Date.now();
    return out;
  }

  /** Stop driving; returns the exit position for the character. */
  stopDriving(playerId: string): { x: number; z: number } | null {
    const c = this.chars.get(playerId);
    if (!c || !c.drivingId) return null;
    const d = this.drives.get(c.drivingId);
    if (!d) {
      c.drivingId = null;
      return { x: c.x, z: c.z };
    }
    // The passengers get out with the driver (on their own sides).
    for (const r of this.ridersOf(d.vehicleId)) {
      r.ridingId = null;
      this.placeBeside(r, d, exitSide(r.seat));
    }
    this.drives.delete(c.drivingId);
    if (d.dyn.deck) this.deckParked.set(d.vehicleId, d.dyn.deck);
    else this.deckParked.delete(d.vehicleId);
    c.drivingId = null;
    // Step out on the driver's (left) side, falling back to the other side / behind.
    this.placeBeside(c, d, 1);
    return { x: c.x, z: c.z };
  }

  /** A passenger sits where the car is. */
  private followRide(c: CharacterEntity): void {
    const d = c.ridingId ? this.drives.get(c.ridingId) : undefined;
    if (!d) {
      c.ridingId = null;
      return;
    }
    c.deck = d.dyn.deck ?? 0;
    c.x = d.dyn.x;
    c.z = d.dyn.z;
    c.rot = d.dyn.rot;
    c.gait = 0;
  }

  /** Move a driven vehicle (and its driver) to a spot, stopped (drag strip staging). `deck`: on a
   *  bridge deck (otherwise guessed from the place: over the highway that is the road below). */
  placeDrive(vehicleId: string, x: number, z: number, rot: number, deck = deckAt(x, z)): void {
    const d = this.drives.get(vehicleId);
    if (!d) return;
    Object.assign(d.dyn, newVehicleDyn(x, z, rot), { deck });
    const c = this.chars.get(d.playerId);
    if (c) Object.assign(c, { x, z, rot, deck });
    for (const r of this.ridersOf(vehicleId)) Object.assign(r, { x, z, rot, deck });
  }

  /** Teleport a character (e.g. respawn). */
  teleport(playerId: string, x: number, z: number): void {
    const c = this.chars.get(playerId);
    if (c) {
      c.x = x;
      c.z = z;
      c.deck = deckAt(x, z);
    }
  }

  buildSnapshotLists(): { p: PlayerSnap[]; v: VehicleSnap[]; n: NpcSnap[] } {
    const now = Date.now();
    const p: PlayerSnap[] = [];
    for (const c of this.chars.values()) {
      if (now - c.lastInputAt > 300) c.gait = 0;
      if (c.ridingId) this.followRide(c);
      const anim = c.dead
        ? Anim.Dead
        : c.drivingId || c.ridingId
          ? Anim.Drive
          : c.interactUntil > now && c.gait === 0
            ? Anim.Interact
            : c.gait === 2
              ? Anim.Run
              : c.gait === 1
                ? Anim.Walk
                : c.weapon > 0
                  ? Anim.Aim
                  : Anim.Idle;
      if (c.ridingId) p.push([c.id, round2(c.x), round2(c.z), round2(c.rot), anim, c.drivingId, c.ridingId, c.seat]);
      else if (c.deck && !c.drivingId) p.push([c.id, round2(c.x), round2(c.z), round2(c.rot), anim, null, null, 0, c.weapon, c.deck]);
      else if (c.weapon > 0) p.push([c.id, round2(c.x), round2(c.z), round2(c.rot), anim, c.drivingId, null, 0, c.weapon]);
      else p.push([c.id, round2(c.x), round2(c.z), round2(c.rot), anim, c.drivingId]);
    }
    const v: VehicleSnap[] = [];
    for (const d of this.drives.values()) {
      const snap: VehicleSnap = [d.vehicleId, round2(d.dyn.x), round2(d.dyn.z), Math.round(d.dyn.rot * 1000) / 1000, round2(d.dyn.speed), Math.round(d.dyn.steer * 1000) / 1000, Math.round(d.dyn.rpm), d.dyn.gear, d.flags | (d.dyn.deck ? VF.DECK : 0)];
      // On a bridge: which one (the deck height comes from it).
      if (d.dyn.deck) snap.push((d.dyn.wheelie ?? 0) > 0.005 ? round2(d.dyn.wheelie!) : 0, d.dyn.deck);
      // A wheelie: everyone sees the front up.
      else if ((d.dyn.wheelie ?? 0) > 0.005) snap.push(round2(d.dyn.wheelie!));
      v.push(snap);
    }
    const n: NpcSnap[] = [];
    for (const npc of this.npcs.values()) n.push([npc.id, round2(npc.x), round2(npc.z), round2(npc.rot), npc.anim, npc.style]);
    return { p, v, n };
  }
}

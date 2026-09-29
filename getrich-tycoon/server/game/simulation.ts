// Server-authoritative movement simulation. Clients send input commands; the
// server applies them with the shared physics and broadcasts snapshots.

import { ECONOMY } from '../../shared/economy.config';
import { MARKET_LOT_SLOTS, INTERACTABLES, SERVICE_INTERACT_SLACK, type Interactable } from '../../shared/world';
import { worldBoxes, vehicleObstacles, STATIC_CIRCLES, type ObstacleVehicle } from '../../shared/collision';
import {
  CHAR_RADIUS,
  KEY,
  MAX_CMD_DT,
  resolveCircle,
  stepCharacter,
  stepVehicle,
  vehicleParams,
  type CollisionWorld,
  type DynamicCircle,
  type InputCmd,
  type VehicleDyn,
  type VehicleParams,
} from '../../shared/physics';
import { Anim, type NpcSnap, type PlayerSnap, type Vehicle, type VehicleSnap } from '../../shared/types';
import { round2 } from '../../shared/util';
import { getModel } from '../../shared/vehicles';
import type { GameState } from './state';

export interface CharacterEntity {
  id: string;
  x: number;
  z: number;
  rot: number;
  gait: number;
  drivingId: string | null;
  lastSeq: number;
  /** Seconds of simulation the client may still claim (anti speed-hack). */
  budget: number;
  budgetAt: number;
  interactUntil: number;
  droppedCmds: number;
  lastInputAt: number;
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

export class Simulation {
  readonly chars = new Map<string, CharacterEntity>();
  readonly drives = new Map<string, DriveState>();
  readonly npcs = new Map<string, NpcEntity>();
  private world: CollisionWorld = { boxes: [], circles: STATIC_CIRCLES, dynamic: [] };
  private dynamic: DynamicCircle[] = [];

  constructor(private readonly state: GameState) {
    this.rebuildStatic();
  }

  /** Recompute building colliders (after a dealership purchase/upgrade). */
  rebuildStatic(): void {
    const levels = new Map<string, number>();
    for (const d of this.state.dealerships.values()) levels.set(d.plotId, d.level);
    this.world = { boxes: worldBoxes(levels), circles: STATIC_CIRCLES, dynamic: this.dynamic };
  }

  /** Recompute vehicle obstacles (called every tick). */
  rebuildDynamic(): void {
    const list: ObstacleVehicle[] = [];
    for (const v of this.state.vehicles.values()) {
      if (this.drives.has(v.id)) continue;
      if (v.status === 'world' || v.status === 'displayed') list.push({ id: v.id, modelId: v.modelId, x: v.x, z: v.z, rot: v.rotation });
    }
    for (const l of this.state.listings.values()) {
      const v = this.state.vehicles.get(l.vehicleId);
      const slot = MARKET_LOT_SLOTS[l.lotSlot];
      if (v && slot) list.push({ id: v.id, modelId: v.modelId, x: slot.x, z: slot.z, rot: slot.rot });
    }
    for (const d of this.drives.values()) {
      const v = this.state.vehicles.get(d.vehicleId);
      if (v) list.push({ id: v.id, modelId: v.modelId, x: d.dyn.x, z: d.dyn.z, rot: d.dyn.rot });
    }
    this.dynamic.length = 0;
    vehicleObstacles(list, this.dynamic);
  }

  get collisionWorld(): CollisionWorld {
    return this.world;
  }

  addPlayer(id: string, x: number, z: number, rot: number): CharacterEntity {
    const now = Date.now();
    const c: CharacterEntity = { id, x, z, rot, gait: 0, drivingId: null, lastSeq: 0, budget: 0.25, budgetAt: now, interactUntil: 0, droppedCmds: 0, lastInputAt: now };
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
      if (typeof keys !== 'number' || !Number.isInteger(keys) || keys < 0 || keys > 63) continue;
      if (typeof yaw !== 'number' || !Number.isFinite(yaw)) continue;
      c.lastSeq = seq;
      // Speed-hack protection: a client cannot simulate more time than has passed.
      if (dt > c.budget + 1e-6) {
        c.droppedCmds++;
        continue;
      }
      c.budget -= dt;
      c.lastInputAt = now;
      this.applyCommand(c, { seq, dt, keys, yaw });
    }
  }

  private applyCommand(c: CharacterEntity, cmd: InputCmd): void {
    if (c.drivingId) {
      const d = this.drives.get(c.drivingId);
      if (!d) {
        c.drivingId = null;
        return;
      }
      const res = stepVehicle(d.dyn, cmd, d.params, this.world, d.vehicleId);
      d.pendingDistance += res.distance;
      if (res.impact > ECONOMY.world.impactDamageThreshold) {
        d.pendingDamage += (res.impact - ECONOMY.world.impactDamageThreshold) * ECONOMY.world.impactDamagePerMs;
      }
      c.x = d.dyn.x;
      c.z = d.dyn.z;
      c.rot = d.dyn.rot;
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
      dyn: { x: v.x, z: v.z, rot: v.rotation, speed: 0, steer: 0 },
      params: vehicleParams(model, v.condition, v.fuel, v.mods),
      pendingDistance: 0,
      pendingDamage: 0,
      lastFlushAt: Date.now(),
    };
    this.drives.set(v.id, d);
    c.drivingId = v.id;
    c.x = v.x;
    c.z = v.z;
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
    this.drives.delete(c.drivingId);
    c.drivingId = null;
    if (!d) return { x: c.x, z: c.z };
    // Step out on the driver's (left) side, falling back to the other side / behind.
    const left = { x: Math.cos(d.dyn.rot), z: -Math.sin(d.dyn.rot) };
    const off = d.params.halfWidth + 0.9;
    const candidates = [
      { x: d.dyn.x + left.x * off, z: d.dyn.z + left.z * off },
      { x: d.dyn.x - left.x * off, z: d.dyn.z - left.z * off },
      { x: d.dyn.x - Math.sin(d.dyn.rot) * (d.params.halfLength + 1), z: d.dyn.z - Math.cos(d.dyn.rot) * (d.params.halfLength + 1) },
    ];
    this.rebuildDynamic();
    let chosen = candidates[0]!;
    for (const p of candidates) {
      const res = resolveCircle(p.x, p.z, CHAR_RADIUS, this.world);
      if (!res.hit) {
        chosen = p;
        break;
      }
    }
    const settled = resolveCircle(chosen.x, chosen.z, CHAR_RADIUS, this.world);
    chosen = { x: settled.x, z: settled.z };
    c.x = chosen.x;
    c.z = chosen.z;
    c.gait = 0;
    return chosen;
  }

  /** Teleport a character (e.g. respawn). */
  teleport(playerId: string, x: number, z: number): void {
    const c = this.chars.get(playerId);
    if (c) {
      c.x = x;
      c.z = z;
    }
  }

  buildSnapshotLists(): { p: PlayerSnap[]; v: VehicleSnap[]; n: NpcSnap[] } {
    const now = Date.now();
    const p: PlayerSnap[] = [];
    for (const c of this.chars.values()) {
      if (now - c.lastInputAt > 300) c.gait = 0;
      const anim = c.drivingId ? Anim.Drive : c.interactUntil > now && c.gait === 0 ? Anim.Interact : c.gait === 2 ? Anim.Run : c.gait === 1 ? Anim.Walk : Anim.Idle;
      p.push([c.id, round2(c.x), round2(c.z), round2(c.rot), anim, c.drivingId]);
    }
    const v: VehicleSnap[] = [];
    for (const d of this.drives.values()) v.push([d.vehicleId, round2(d.dyn.x), round2(d.dyn.z), round2(d.dyn.rot), round2(d.dyn.speed), round2(d.dyn.steer)]);
    const n: NpcSnap[] = [];
    for (const npc of this.npcs.values()) n.push([npc.id, round2(npc.x), round2(npc.z), round2(npc.rot), npc.anim, npc.style]);
    return { p, v, n };
  }
}

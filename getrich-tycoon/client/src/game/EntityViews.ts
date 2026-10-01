// Scene objects for everything dynamic: players, NPCs, vehicles, price tags. Drivers sit visibly in
// their cars; getting in and out is animated (door opens, the character ducks in and sits down, the
// door shuts); cars roll and pitch with their motion and show brake / reverse lights.

import * as THREE from 'three';
import { SPEED_SCALE } from '../../../shared/drivetrain';
import { Anim, VF, type Appearance, type MarketListing, type PublicVehicle, type Vehicle } from '../../../shared/types';
import { angleDiff, clamp, formatMoney, lerpAngle } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import { groundHeight } from '../render/City';
import { CharacterView, NPC_PALETTE, type Pose } from '../render/Character';
import { Label } from '../render/Labels';
import { calculateVehicleStats } from '../../../shared/tuningSystem';
import { getModel } from '../../../shared/vehicles';
import { HeadlightRig } from '../render/Headlights';
import { BikeView, createVehicleView, type AnyVehicleView } from '../render/VehicleMesh';
import { INTERP_DELAY_MS, InterpBuffer } from './Interpolation';

export interface CharEntity {
  view: CharacterView;
  label: Label | null;
  buffer: InterpBuffer;
  anim: number;
  driving: string | null;
  lastSeen: number;
  /** What it was driving last frame (undefined until first drawn: no animation on first sight). */
  prevDriving?: string | null;
  /** Last place on foot (where an enter animation starts). */
  foot: { x: number; z: number; rot: number };
  board: Boarding | null;
}

/** Getting into / out of a car. */
interface Boarding {
  vehicleId: string;
  kind: 'in' | 'out';
  /** Seconds since it started (on the real clock, so a slow frame rate doesn't stretch it). */
  t: number;
  start: number;
  from: { x: number; z: number; rot: number };
  /** Getting in: the walk to the driver's door (around the car if needed) and how long it takes. */
  path?: { x: number; z: number }[];
  walk?: number;
}

/** A character placed by a cutscene (overrides everything else for that player). */
export interface Puppet {
  x: number;
  z: number;
  rot: number;
  anim: number;
  pose: Pose;
}

/** Enter (after the walk to the door) / exit animation lengths (s). */
export const BOARD_IN = 1.0;
export const BOARD_OUT = 1.25;
const WALK_SPEED = 4.2;

function pathLength(p: { x: number; z: number }[]): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.z - p[i - 1]!.z);
  return d;
}

/** Point at distance d along a path, and the heading there. */
function along(p: { x: number; z: number }[], d: number): { x: number; z: number; rot: number } {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= len || i === p.length - 1) {
      const k = len > 1e-6 ? Math.min(1, d / len) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, rot: Math.atan2(b.x - a.x, b.z - a.z) };
    }
    d -= len;
  }
  const last = p[p.length - 1]!;
  return { x: last.x, z: last.z, rot: 0 };
}

const ease = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

export interface VehEntity {
  view: AnyVehicleView;
  /** Previous frame speed, to spot throttle lifts on other players' cars (backfires). */
  lastSpeed: number;
  accel: number;
  label: Label | null;
  data: Vehicle;
  kind: 'public' | 'market';
  listing?: MarketListing;
  buffer: InterpBuffer;
  driven: boolean;
  lastDriven: number;
  x: number;
  z: number;
  rot: number;
  lights: HeadlightRig | null;
  /** Body roll / pitch (rad) and the smoothed longitudinal acceleration behind them. */
  roll: number;
  pitch: number;
  aLong: number;
  prevRot: number;
}

export class EntityViews {
  readonly players = new Map<string, CharEntity>();
  readonly npcs = new Map<string, CharEntity>();
  readonly vehicles = new Map<string, VehEntity>();
  showNames = true;
  /** 0 by day, 1 at night: driven vehicles switch their lights on. */
  night = 0;
  /** Full-beam flash of the local player's car (0-1). */
  flash = 0;
  /** Cutscene-controlled characters (by player id). */
  readonly puppets = new Map<string, Puppet>();
  /** Doors held open by a cutscene (vehicle id -> 0..1). */
  readonly doors = new Map<string, number>();
  /** First-person view: the local driver's own body is not drawn. */
  hideLocalDriver = false;
  /** Players whose next exit should not be animated (e.g. towed away after an arrest). */
  readonly skipExit = new Set<string>();
  private tmp = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly myId: () => string,
  ) {}

  // ------------------------------------------------------------ characters

  ensurePlayer(id: string, name: string, level: number, appearance: Appearance): CharEntity {
    let e = this.players.get(id);
    if (!e) {
      const view = new CharacterView(appearance);
      this.scene.add(view.root);
      const isMe = id === this.myId();
      const label = isMe ? null : new Label(name, { badge: String(level), badgeColor: '#7a5cff' });
      if (label) this.scene.add(label.sprite);
      e = { view, label, buffer: new InterpBuffer(), anim: Anim.Idle, driving: null, lastSeen: performance.now(), foot: { x: 0, z: 0, rot: 0 }, board: null };
      this.players.set(id, e);
    } else {
      e.view.setAppearance(appearance);
      e.label?.set(name, { badge: String(level), badgeColor: '#7a5cff' });
    }
    return e;
  }

  removePlayer(id: string): void {
    const e = this.players.get(id);
    if (!e) return;
    e.view.root.removeFromParent(); // the scene, or a motorcycle's rider mount
    if (e.label) {
      this.scene.remove(e.label.sprite);
      e.label.dispose();
    }
    e.view.dispose();
    this.players.delete(id);
  }

  upsertNpc(id: string, style: number, t: number, x: number, z: number, r: number, a: number): void {
    let e = this.npcs.get(id);
    if (!e) {
      const view = new CharacterView(NPC_PALETTE[style % NPC_PALETTE.length]!);
      this.scene.add(view.root);
      const label = new Label('Customer', { color: '#ffd166', height: 0.3 });
      this.scene.add(label.sprite);
      e = { view, label, buffer: new InterpBuffer(), anim: Anim.Idle, driving: null, lastSeen: t, foot: { x, z, rot: r }, board: null };
      this.npcs.set(id, e);
    }
    e.buffer.push({ t, x, z, r, a, b: 0 });
    e.lastSeen = t;
  }

  pruneNpcs(alive: Set<string>): void {
    for (const [id, e] of this.npcs) {
      if (alive.has(id)) continue;
      this.scene.remove(e.view.root);
      if (e.label) {
        this.scene.remove(e.label.sprite);
        e.label.dispose();
      }
      e.view.dispose();
      this.npcs.delete(id);
    }
  }

  // ------------------------------------------------------------ vehicles

  upsertVehicle(v: PublicVehicle | Vehicle, kind: 'public' | 'market', listing?: MarketListing, ownerName?: string | null): void {
    let e = this.vehicles.get(v.id);
    if (!e) {
      const view = createVehicleView(v);
      this.scene.add(view.root);
      e = { view, lastSpeed: 0, accel: 0, label: null, data: v, kind, listing, buffer: new InterpBuffer(), driven: false, lastDriven: 0, x: v.x, z: v.z, rot: v.rotation, lights: null, roll: 0, pitch: 0, aLong: 0, prevRot: v.rotation };
      this.vehicles.set(v.id, e);
    } else {
      e.view.update(v);
      e.data = v;
      e.kind = kind;
      e.listing = listing;
    }
    if (!e.driven) {
      e.x = v.x;
      e.z = v.z;
      e.rot = v.rotation;
    }
    this.updateVehicleLabel(e, ownerName ?? null);
  }

  private updateVehicleLabel(e: VehEntity, ownerName: string | null): void {
    const v = e.data;
    let text: string | null = null;
    let opts: ConstructorParameters<typeof Label>[1] = {};
    if (e.kind === 'market' && e.listing) {
      text = modelDisplayName(v.modelId);
      opts = { sub: formatMoney(e.listing.askingPrice), bg: 'rgba(40,24,6,0.8)', subColor: '#ffc53d' };
    } else if (v.status === 'displayed' && v.salePrice !== null) {
      const mine = v.ownerId === this.myId();
      text = mine ? 'YOUR LISTING' : 'FOR SALE';
      opts = { sub: formatMoney(v.salePrice), bg: mine ? 'rgba(60,44,0,0.82)' : 'rgba(6,40,24,0.82)', color: mine ? '#ffc53d' : '#2ee59d', subColor: '#ffffff' };
    } else if (v.status === 'world' && ownerName) {
      text = `${ownerName}'s ${modelDisplayName(v.modelId)}`;
      opts = { height: 0.3, bg: 'rgba(12,16,28,0.55)' };
    }
    if (!text) {
      if (e.label) {
        this.scene.remove(e.label.sprite);
        e.label.dispose();
        e.label = null;
      }
      return;
    }
    if (!e.label) {
      e.label = new Label(text, opts);
      this.scene.add(e.label.sprite);
    } else e.label.set(text, opts);
  }

  removeVehicle(id: string): void {
    const e = this.vehicles.get(id);
    if (!e) return;
    this.scene.remove(e.view.root);
    if (e.label) {
      this.scene.remove(e.label.sprite);
      e.label.dispose();
    }
    e.view.dispose();
    e.lights?.dispose();
    this.vehicles.delete(id);
  }

  /** Sync market lot vehicles with the listing set. */
  syncMarket(listings: MarketListing[]): void {
    const ids = new Set(listings.map((l) => l.vehicle.id));
    for (const [id, e] of this.vehicles) if (e.kind === 'market' && !ids.has(id)) this.removeVehicle(id);
    for (const l of listings) this.upsertVehicle(l.vehicle, 'market', l);
  }

  // ------------------------------------------------------------ per-frame

  /** Seconds left of a player's enter / exit animation (0 when none). */
  boardingLeft(id: string): number {
    const b = this.players.get(id)?.board;
    return b ? Math.max(0, (b.kind === 'in' ? (b.walk ?? 0.8) + BOARD_IN : BOARD_OUT) - (performance.now() - b.start) / 1000) : 0;
  }

  /** The player is busy getting in (until seated) or out (until standing beside the car): no driving / walking. */
  boardingBusy(id: string): boolean {
    const b = this.players.get(id)?.board;
    if (!b) return false;
    const t = (performance.now() - b.start) / 1000;
    return b.kind === 'in' ? t < (b.walk ?? 0.8) + 0.55 : t < 0.8;
  }

  update(
    dt: number,
    now: number,
    local: { id: string; x: number; z: number; rot: number; anim: number; driving: string | null; speed: number; steer: number; flags: number },
  ): void {
    const renderT = now - INTERP_DELAY_MS;
    // Vehicles
    for (const [id, e] of this.vehicles) {
      let speed = 0;
      let steer = 0;
      let flags = 0;
      if (local.driving === id) {
        e.x = local.x;
        e.z = local.z;
        e.rot = local.rot;
        speed = local.speed;
        steer = local.steer;
        flags = local.flags;
        e.driven = true;
      } else if (e.driven && now - e.lastDriven < 400) {
        const s = e.buffer.sample(renderT);
        if (s) {
          e.x = s.x;
          e.z = s.z;
          e.rot = s.r;
          speed = s.a;
          steer = s.b;
          flags = s.f ?? 0;
        }
      } else if (e.driven && local.driving !== id) {
        e.driven = false;
        e.x = e.data.x;
        e.z = e.data.z;
        e.rot = e.data.rotation;
      }
      const y = groundHeight(e.x, e.z);
      e.view.root.position.set(e.x, y, e.z);
      e.view.root.rotation.y = e.rot;
      e.view.animate(speed, steer, dt);
      // Body roll (outwards in corners) and pitch (nose dives under braking, squats when
      // accelerating), from real-scale accelerations, lagging a little like a sprung body.
      if (!e.view.isBike && dt > 0) {
        const yawRate = angleDiff(e.prevRot, e.rot) / dt;
        const aLong = ((speed - e.lastSpeed) / dt) * SPEED_SCALE;
        e.aLong += (clamp(aLong, -14, 14) - e.aLong) * Math.min(1, dt * 8);
        const aLat = clamp(speed * SPEED_SCALE * yawRate, -14, 14);
        const rollT = e.driven ? clamp(aLat * 0.0058, -0.075, 0.075) : 0;
        const pitchT = e.driven ? clamp(-e.aLong * 0.0042, -0.05, 0.05) : 0;
        e.roll += (rollT - e.roll) * Math.min(1, dt * 5);
        e.pitch += (pitchT - e.pitch) * Math.min(1, dt * 6);
        e.view.setMotion(e.roll, e.pitch);
      }
      e.prevRot = e.rot;
      // Other drivers' backfires: a sharp lift off the throttle at speed.
      if (local.driving !== id && e.driven && dt > 0) {
        const a = (speed - e.lastSpeed) / dt;
        if (e.accel > 2 && a < -1 && Math.abs(speed) > 8) {
          const pops = calculateVehicleStats(getModel(e.data.modelId), e.data.mods.tuning).sound.pops;
          if (Math.random() < pops) e.view.pop(pops);
        }
        e.accel = e.accel * 0.8 + a * 0.2;
      }
      e.lastSpeed = speed;
      if (e.view instanceof BikeView) e.view.ridden = e.driven;
      // Brake, reverse and tail lights; headlights on while someone drives it at night (or flashes).
      e.view.setLights({ brake: e.driven && (flags & VF.BRAKE) !== 0, reverse: e.driven && (flags & VF.REVERSE) !== 0, night: e.driven ? this.night : 0 });
      const mine = local.driving === id;
      const flash = mine ? this.flash : 0;
      if (e.driven && (this.night > 0.02 || flash > 0.02)) {
        if (!e.lights) {
          e.lights = new HeadlightRig(e.view.length, e.view.width);
          e.view.root.add(e.lights.group);
        }
        e.lights.set(this.night, flash);
      } else if (e.lights) {
        e.lights.dispose();
        e.lights = null;
      }
      if (e.label) {
        e.label.sprite.visible = local.driving !== id && (this.showNames || e.kind === 'market' || e.data.status === 'displayed');
        e.label.sprite.position.set(e.x, y + e.view.height + 0.75, e.z);
      }
    }
    // Players
    const doorWant = new Map<string, number>();
    for (const [id, e] of this.players) {
      let x: number, z: number, r: number, anim: number;
      let driving: string | null;
      if (id === local.id) {
        x = local.x;
        z = local.z;
        r = local.rot;
        anim = local.anim;
        driving = local.driving;
      } else {
        const s = e.buffer.sample(renderT);
        if (!s) {
          e.view.root.visible = false;
          if (e.label) e.label.sprite.visible = false;
          continue;
        }
        x = s.x;
        z = s.z;
        r = s.r;
        anim = s.a;
        driving = e.driving;
      }
      this.trackBoarding(id, e, driving, now);
      const y = groundHeight(x, z);
      const puppet = this.puppets.get(id);
      const ride = driving ? this.vehicles.get(driving)?.view : undefined;
      e.view.pose = 'none';
      if (puppet) {
        // Cutscene.
        this.toScene(e);
        e.view.root.visible = true;
        e.view.root.position.set(puppet.x, groundHeight(puppet.x, puppet.z), puppet.z);
        e.view.root.rotation.set(0, puppet.rot, 0);
        e.view.pose = puppet.pose;
        e.view.animate(puppet.anim, dt);
      } else if (e.board && this.animateBoarding(e, x, z, dt, now, doorWant)) {
        // Getting in or out (positioned by animateBoarding).
      } else if (ride instanceof BikeView) {
        // Motorcycle riders sit on the bike.
        if (e.view.root.parent !== ride.riderMount) ride.riderMount.add(e.view.root);
        e.view.root.visible = true;
        e.view.root.position.set(0, -0.86, 0.04);
        e.view.root.rotation.set(0, 0, 0);
        e.view.animate(Anim.Drive, dt);
      } else if (ride) {
        // Car drivers sit in the driver's seat, hands on the wheel.
        if (e.view.root.parent !== ride.driverMount) ride.driverMount.add(e.view.root);
        e.view.root.visible = !(id === local.id && this.hideLocalDriver);
        e.view.root.position.set(0, 0, 0);
        e.view.root.rotation.set(0, 0, 0);
        e.view.pose = 'sit';
        e.view.animate(Anim.Idle, dt);
      } else {
        this.toScene(e);
        e.view.root.visible = !driving;
        e.view.root.position.set(x, y, z);
        e.view.root.rotation.set(0, r, 0);
        e.view.animate(anim, dt);
      }
      if (!driving) e.foot = { x, z, rot: r };
      if (e.label) {
        e.label.sprite.visible = this.showNames;
        const veh = driving ? this.vehicles.get(driving) : undefined;
        e.label.sprite.position.set(x, y + (driving ? (veh?.view.height ?? 1.5) + 1.3 : 2.35), z);
      }
    }
    // Doors: open while someone gets in or out (or a cutscene holds them).
    for (const [id, e] of this.vehicles) e.view.setDoor(Math.max(doorWant.get(id) ?? 0, this.doors.get(id) ?? 0));
    // NPCs
    for (const e of this.npcs.values()) {
      const s = e.buffer.sample(renderT);
      if (!s) continue;
      const y = groundHeight(s.x, s.z);
      e.view.root.position.set(s.x, y, s.z);
      e.view.root.rotation.y = s.r;
      e.view.animate(s.a, dt);
      if (e.label) e.label.sprite.position.set(s.x, y + 2.2, s.z);
    }
  }

  private toWorld(view: AnyVehicleView, lx: number, lz: number): { x: number; z: number } {
    const p = view.root.localToWorld(new THREE.Vector3(lx, 0, lz));
    return { x: p.x, z: p.z };
  }

  private toScene(e: CharEntity): void {
    if (e.view.root.parent !== this.scene) this.scene.add(e.view.root);
  }

  /** Start an enter / exit animation when a player's vehicle changes. */
  private trackBoarding(id: string, e: CharEntity, driving: string | null, now: number): void {
    const prev = e.prevDriving;
    e.prevDriving = driving;
    if (prev === undefined || prev === driving) return;
    const car = (vid: string | null) => {
      const v = vid ? this.vehicles.get(vid) : undefined;
      return v && !v.view.isBike ? v : undefined;
    };
    const skip = !driving && prev ? this.skipExit.delete(id) : false;
    if (driving && !prev && car(driving)) e.board = { vehicleId: driving, kind: 'in', t: 0, start: now, from: { ...e.foot } };
    else if (!driving && prev && car(prev) && !skip) e.board = { vehicleId: prev, kind: 'out', t: 0, start: now, from: { ...e.foot } };
    else e.board = null;
  }

  /** Place a character getting in / out of a car. False when the animation is over. */
  private animateBoarding(e: CharEntity, x: number, z: number, dt: number, now: number, doors: Map<string, number>): boolean {
    const b = e.board!;
    const veh = this.vehicles.get(b.vehicleId);
    if (!veh) {
      e.board = null;
      return false;
    }
    const view = veh.view;
    view.root.updateMatrixWorld(true);
    const seat = view.driverMount.getWorldPosition(this.tmp).clone();
    const m = view.driverMount.position;
    const hw = view.width / 2;
    const door = view.root.localToWorld(new THREE.Vector3(hw + 0.5, 0, m.z + 0.25));
    if (b.kind === 'in' && !b.path) {
      // Walk to the driver's door, around the front or back of the car when starting on the far side.
      const local = view.root.worldToLocal(new THREE.Vector3(b.from.x, 0, b.from.z));
      const path = [{ x: b.from.x, z: b.from.z }];
      if (local.x < hw * 0.6) {
        const end = (local.z >= 0 ? 1 : -1) * (view.length / 2 + 0.7);
        if (Math.abs(local.z) < view.length / 2 + 0.7) path.push(this.toWorld(view, Math.min(local.x, -hw - 0.6), end));
        path.push(this.toWorld(view, hw + 0.6, end));
      }
      path.push({ x: door.x, z: door.z });
      b.path = path;
      b.walk = clamp(pathLength(path) / WALK_SPEED, 0.15, 2.2);
    }
    const walk = b.kind === 'in' ? b.walk ?? 0.5 : 0;
    const dur = b.kind === 'in' ? walk + BOARD_IN : BOARD_OUT;
    b.t = (now - b.start) / 1000;
    if (b.t >= dur) {
      e.board = null;
      return false;
    }
    const inward = veh.rot - Math.PI / 2;
    const outward = veh.rot + Math.PI / 2;
    const t = b.t;
    let px: number, py: number, pz: number, rot: number;
    let anim: number = Anim.Idle;
    let pose: Pose = 'none';
    let seated = false;
    let open: number;
    if (b.kind === 'in') {
      // Timeline after the walk: door opens, duck in and sit (0.6 s), door shuts (0.4 s).
      const w = t - walk;
      open = w < 0.6 ? ease((w + 0.15) / 0.35) : 1 - ease((w - 0.6) / 0.4);
      if (w < 0) {
        const path = b.path!;
        const total = pathLength(path);
        const at = along(path, (t / walk) * total);
        px = at.x;
        pz = at.z;
        py = groundHeight(px, pz);
        rot = total > 0.3 ? lerpAngle(at.rot, inward, ease((t - walk + 0.18) / 0.18)) : inward;
        anim = total > 0.3 ? Anim.Walk : Anim.Idle;
      } else if (w < 0.6) {
        const u = ease(w / 0.6);
        px = door.x + (seat.x - door.x) * u;
        pz = door.z + (seat.z - door.z) * u;
        py = groundHeight(door.x, door.z) + (seat.y - groundHeight(door.x, door.z)) * u;
        rot = lerpAngle(inward, veh.rot, u);
        pose = u < 0.65 ? 'duck' : 'sit';
      } else {
        seated = true;
        px = py = pz = rot = 0;
      }
    } else {
      open = t < 0.85 ? ease(t / 0.3) : 1 - ease((t - 0.85) / 0.35);
      if (t < 0.3) {
        seated = true;
        px = py = pz = rot = 0;
      } else if (t < 0.8) {
        const u = ease((t - 0.3) / 0.5);
        px = seat.x + (door.x - seat.x) * u;
        pz = seat.z + (door.z - seat.z) * u;
        py = seat.y + (groundHeight(door.x, door.z) - seat.y) * u;
        rot = lerpAngle(veh.rot, outward, u);
        pose = u < 0.6 ? 'duck' : 'none';
      } else {
        const u = ease((t - 0.8) / 0.45);
        px = door.x + (x - door.x) * u;
        pz = door.z + (z - door.z) * u;
        py = groundHeight(px, pz);
        rot = Math.hypot(x - door.x, z - door.z) > 0.25 ? lerpAngle(outward, Math.atan2(x - door.x, z - door.z), Math.min(1, u * 3)) : outward;
        anim = Math.hypot(x - door.x, z - door.z) > 0.25 && u < 0.95 ? Anim.Walk : Anim.Idle;
      }
    }
    doors.set(b.vehicleId, Math.max(doors.get(b.vehicleId) ?? 0, clamp(open, 0, 1)));
    if (seated) {
      if (e.view.root.parent !== view.driverMount) view.driverMount.add(e.view.root);
      e.view.root.visible = true;
      e.view.root.position.set(0, 0, 0);
      e.view.root.rotation.set(0, 0, 0);
      e.view.pose = 'sit';
      e.view.animate(Anim.Idle, dt);
      return true;
    }
    this.toScene(e);
    e.view.root.visible = true;
    e.view.root.position.set(px, py, pz);
    e.view.root.rotation.set(0, rot, 0);
    e.view.pose = pose;
    e.view.animate(anim, dt);
    return true;
  }

  clear(): void {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const id of [...this.vehicles.keys()]) this.removeVehicle(id);
    this.pruneNpcs(new Set());
  }
}

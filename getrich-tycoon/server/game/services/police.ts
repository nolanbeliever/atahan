// Wanted level and police pursuits.
//
// Reckless driving builds heat: near misses above 180 km/h, crashing into traffic, ramming a police
// car. Heat becomes 1-5 stars; from 2 stars police interceptors (real physics cars, same collision
// boxes as everyone) spawn behind the player and chase them: along the highway lanes, and through
// the city on the road grid (line of sight or a route over the junctions). Losing every police car
// for 30 s is an escape (cash + XP). A police car right beside you while you are (nearly) stopped
// for 3 s is an arrest: a fine (10% of your cash, at least $1,500), the car is towed to your
// garage, and you walk out of the nearest garage after a short cutscene.

import { KMH_PER_MS } from '../../../shared/drivetrain';
import { ECONOMY } from '../../../shared/economy.config';
import { CARRIAGEWAY_EDGE, laneOffset, offsetToLane, pathPoint, pathYaw, projectToHighway, travelDir, wrapS, type Carriageway } from '../../../shared/highway';
import { obbDistance } from '../../../shared/obb';
import { KEY, newVehicleDyn, stepVehicle, vehicleBox, vehicleParams, type VehicleDyn, type VehicleParams } from '../../../shared/physics';
import { PF, type BustedEvent, type PoliceSnap, type WantedState } from '../../../shared/police';
import { angleDiff } from '../../../shared/util';
import { POLICE_MODEL, modelDisplayName } from '../../../shared/vehicles';
import { INTERACTABLES, ROAD_LINES, type AABB } from '../../../shared/world';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';
import type { VehicleService } from './vehicles';

const log = createLogger('police');

const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

interface Unit {
  id: number;
  dyn: VehicleDyn;
  /** Seconds it has been stuck (throttle on, not moving). */
  stuck: number;
  /** Reversing out of a jam until this time (s of the service clock). */
  reverseUntil: number;
  /** Route waypoint through the city (recomputed twice a second). */
  waypoint: { x: number; z: number } | null;
  replanAt: number;
  /** Side it tries to pull up on when close (+1 / -1). */
  side: number;
  /** Parked beside the player for the arrest. */
  parked: boolean;
}

interface Wanted {
  heat: number;
  lastOffence: number;
  /** Seconds without a police car within escapeRadius (while pursued). */
  escapeT: number;
  bustT: number;
  units: Unit[];
  /** Police have been after this player (an escape pays). */
  pursued: boolean;
  /** Last hit already counted (DriveState.lastHitAt). */
  seenHitAt: number;
  busted: { until: number; event: BustedEvent } | null;
  sent: string;
  sentAt: number;
}

export function starsFor(heat: number): number {
  return Math.min(5, Math.max(0, Math.ceil(heat / 100)));
}

/** Fine for an arrest: a share of the cash, at least the minimum, never more than the cash. */
export function policeFine(cash: number): number {
  const c = ECONOMY.police;
  return Math.max(0, Math.min(cash, Math.max(c.minFine, Math.round(cash * c.fineShare))));
}

const GARAGES = INTERACTABLES.filter((i) => i.kind === 'repair' || i.kind === 'custom').map((i) => ({ x: i.x, z: i.z + 6 }));

let nextUnitId = 1;

export class PoliceService {
  private wanted = new Map<string, Wanted>();
  private params: VehicleParams = vehicleParams(POLICE_MODEL, PERFECT, 100);
  private time = 0;
  /** Missions and others hear about escapes. */
  readonly escapeListeners: ((playerId: string) => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly vehicles: VehicleService,
  ) {}

  // ---------------------------------------------------------------- offences

  private get(playerId: string): Wanted {
    let w = this.wanted.get(playerId);
    if (!w) {
      w = { heat: 0, lastOffence: 0, escapeT: 0, bustT: 0, units: [], pursued: false, seenHitAt: Date.now(), busted: null, sent: '', sentAt: 0 };
      this.wanted.set(playerId, w);
    }
    return w;
  }

  /** Add heat for an offence (also used by tests). */
  addHeat(playerId: string, amount: number): void {
    const w = this.get(playerId);
    if (w.busted) return;
    w.heat = Math.min(ECONOMY.police.maxHeat, w.heat + amount);
    w.lastOffence = Date.now();
    w.escapeT = 0;
  }

  /** Raise the heat to at least this much (e.g. a car alarm: straight to 2 stars). */
  raiseHeat(playerId: string, atLeast: number): void {
    const w = this.get(playerId);
    if (w.busted) return;
    w.heat = Math.min(ECONOMY.police.maxHeat, Math.max(w.heat, atLeast));
    w.lastOffence = Date.now();
    w.escapeT = 0;
  }

  /** A near miss at speed (from the highway service). */
  onNearMiss(playerId: string, kmh: number): void {
    if (kmh >= ECONOMY.police.fastNearMissKmh) this.addHeat(playerId, ECONOMY.police.heatNearMissFast);
  }

  wantedOf(playerId: string): Readonly<Wanted> | undefined {
    return this.wanted.get(playerId);
  }

  forget(playerId: string): void {
    this.wanted.delete(playerId);
    this.publishObstacles();
  }

  // ---------------------------------------------------------------- tick

  tick(dt: number, now = Date.now()): void {
    this.time += dt;
    const cfg = ECONOMY.police;
    // Crashes into traffic / police count as offences.
    for (const d of this.ctx.sim.drives.values()) {
      if (!d.lastHitId || d.lastHitAt <= 0) continue;
      const w = this.wanted.get(d.playerId);
      const seen = w?.seenHitAt ?? 0;
      if (d.lastHitAt <= seen) continue;
      if (d.lastHitId.startsWith('tr:')) this.addHeat(d.playerId, cfg.heatTrafficCrash);
      else if (d.lastHitId.startsWith('po:')) this.addHeat(d.playerId, cfg.heatHitPolice);
      else continue;
      this.get(d.playerId).seenHitAt = d.lastHitAt;
    }
    for (const [playerId, w] of this.wanted) {
      if (!this.ctx.sim.chars.has(playerId)) {
        this.wanted.delete(playerId);
        continue;
      }
      if (w.busted) {
        if (now >= w.busted.until) void this.release(playerId, w);
        continue;
      }
      const stars = starsFor(w.heat);
      if (stars === 0) {
        if (w.units.length === 0) this.wanted.delete(playerId);
        else w.units = [];
        this.send(playerId, w, true);
        continue;
      }
      const me = this.target(playerId);
      if (!me) continue;
      // Spawn / retire police cars to match the wanted level.
      const want = stars >= cfg.pursuitStars ? cfg.unitsByStars[stars] ?? 0 : 0;
      while (w.units.length < want) {
        const u = this.spawn(me, w.units.length);
        if (!u) break;
        w.units.push(u);
        w.pursued = true;
      }
      if (w.units.length > want) w.units.length = want;
      // Drive them.
      let nearest = Infinity;
      let nearestGap = Infinity;
      const myBox = vehicleBox('me', me.x, me.z, me.rot, me.hl, me.hw);
      for (const u of w.units) {
        this.drive(u, me, dt);
        const dist = Math.hypot(u.dyn.x - me.x, u.dyn.z - me.z);
        nearest = Math.min(nearest, dist);
        if (dist < 12) nearestGap = Math.min(nearestGap, obbDistance(myBox, vehicleBox('u', u.dyn.x, u.dyn.z, u.dyn.rot, this.params.halfLength, this.params.halfWidth)));
        // Lost far behind or hopelessly stuck: come back from behind the player.
        if (dist > 320 || u.stuck > 6) Object.assign(u, this.spawn(me, u.side > 0 ? 0 : 1) ?? u, { id: u.id });
      }
      // Escape: no police car close for escapeSec (pursuit), or no new offence for calmSec (1 star).
      if (w.units.length > 0) {
        w.escapeT = nearest > cfg.escapeRadius ? w.escapeT + dt : 0;
        if (w.escapeT >= cfg.escapeSec) {
          void this.escaped(playerId, w);
          continue;
        }
      } else if (stars < cfg.pursuitStars && now - w.lastOffence > cfg.calmSec * 1000) {
        w.heat = 0;
        this.send(playerId, w, true);
        this.wanted.delete(playerId);
        continue;
      }
      // Arrest: a police car right beside you while you're (nearly) stopped.
      const slow = Math.abs(me.speed) * KMH_PER_MS < cfg.bustKmh;
      const close = me.onFoot ? nearest < 6 : nearestGap < cfg.bustGap;
      w.bustT = slow && close ? w.bustT + dt : Math.max(0, w.bustT - dt * 0.5);
      if (w.bustT >= cfg.bustSec) {
        void this.bust(playerId, w, me);
        continue;
      }
      this.send(playerId, w);
    }
    this.publishObstacles();
  }

  /** Where the wanted player is: their car or themselves on foot. */
  private target(playerId: string): { x: number; z: number; rot: number; speed: number; vx: number; vz: number; hl: number; hw: number; onFoot: boolean; vehicleId: string | null } | null {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c) return null;
    const d = c.drivingId ? this.ctx.sim.drives.get(c.drivingId) : undefined;
    if (d) {
      const h = d.dyn.speed >= 0 ? d.dyn.rot + d.dyn.slip : d.dyn.rot;
      return { x: d.dyn.x, z: d.dyn.z, rot: d.dyn.rot, speed: d.dyn.speed, vx: Math.sin(h) * d.dyn.speed, vz: Math.cos(h) * d.dyn.speed, hl: d.params.halfLength, hw: d.params.halfWidth, onFoot: false, vehicleId: d.vehicleId };
    }
    return { x: c.x, z: c.z, rot: c.rot, speed: 0, vx: 0, vz: 0, hl: 0.4, hw: 0.4, onFoot: true, vehicleId: null };
  }

  // ---------------------------------------------------------------- spawning

  /** A police car ~130 m behind the player, on the same road. */
  private spawn(me: { x: number; z: number; rot: number }, index: number): Unit | null {
    const side = index % 2 === 0 ? 1 : -1;
    const hp = projectToHighway(me.x, me.z);
    let x: number;
    let z: number;
    let rot: number;
    if (Math.abs(hp.offset) < CARRIAGEWAY_EDGE) {
      const cw: Carriageway = hp.offset < 0 ? 0 : 1;
      const lane = Math.max(0, Math.min(3, Math.round(offsetToLane(hp.offset)) + (index % 2 ? 1 : -1)));
      const s = wrapS(hp.s - travelDir(cw) * (125 + index * 14));
      const p = pathPoint(s, laneOffset(cw, lane));
      x = p.x;
      z = p.z;
      rot = pathYaw(p, cw === 1);
    } else {
      // City: the road point 100-160 m away, preferably behind the player.
      const fx = Math.sin(me.rot);
      const fz = Math.cos(me.rot);
      let best: { x: number; z: number; score: number } | null = null;
      for (const l of ROAD_LINES) {
        for (let t = -150; t <= 150; t += 10) {
          for (const [px, pz] of [
            [l, t],
            [t, l],
          ] as const) {
            const d = Math.hypot(px - me.x, pz - me.z);
            if (d < 90 || d > 170) continue;
            const behind = -((px - me.x) * fx + (pz - me.z) * fz) / d;
            const score = Math.abs(d - 125) - behind * 40 + (index * 17 + t) % 7;
            if (!best || score < best.score) best = { x: px, z: pz, score };
          }
        }
      }
      if (!best) return null;
      x = best.x;
      z = best.z;
      rot = Math.atan2(me.x - x, me.z - z);
    }
    const dyn = newVehicleDyn(x, z, rot);
    // Arrive at speed.
    dyn.speed = 80 / KMH_PER_MS;
    dyn.gear = 3;
    return { id: nextUnitId++, dyn, stuck: 0, reverseUntil: 0, waypoint: null, replanAt: 0, side, parked: false };
  }

  // ---------------------------------------------------------------- driving

  private drive(u: Unit, me: { x: number; z: number; rot: number; speed: number; vx: number; vz: number; hw: number }, dt: number): void {
    if (u.parked) {
      stepVehicle(u.dyn, { keys: KEY.BRAKE, dt }, this.params, this.ctx.sim.collisionWorld, `po:${u.id}`);
      return;
    }
    const dist = Math.hypot(me.x - u.dyn.x, me.z - u.dyn.z);
    // Aim: ahead of the player when far, alongside them when close (to box them in).
    const lead = Math.min(1.4, dist / 45);
    let tx = me.x + me.vx * lead;
    let tz = me.z + me.vz * lead;
    if (dist < 22) {
      const rx = Math.cos(me.rot);
      const rz = -Math.sin(me.rot);
      const side = (me.hw + this.params.halfWidth + 0.6) * u.side;
      tx = me.x + rx * side + Math.sin(me.rot) * 1.5;
      tz = me.z + rz * side + Math.cos(me.rot) * 1.5;
    }
    const hp = projectToHighway(u.dyn.x, u.dyn.z);
    const onHighway = Math.abs(hp.offset) < CARRIAGEWAY_EDGE;
    const meHp = projectToHighway(me.x, me.z);
    if (onHighway && Math.abs(meHp.offset) < CARRIAGEWAY_EDGE && dist > 22) {
      // Follow the lanes round the ring towards the player.
      const cw: Carriageway = hp.offset < 0 ? 0 : 1;
      const p = pathPoint(wrapS(hp.s + travelDir(cw) * Math.min(28, dist)), (hp.offset + meHp.offset) / 2);
      tx = p.x;
      tz = p.z;
    } else if (!onHighway && !this.clear(u.dyn.x, u.dyn.z, tx, tz)) {
      if (this.time >= u.replanAt) {
        u.replanAt = this.time + 0.5;
        u.waypoint = this.route(u.dyn.x, u.dyn.z, tx, tz);
      }
      if (u.waypoint) {
        tx = u.waypoint.x;
        tz = u.waypoint.z;
      }
    }
    const want = Math.atan2(tx - u.dyn.x, tz - u.dyn.z);
    const turn = angleDiff(u.dyn.rot, want);
    let keys = 0;
    if (this.time < u.reverseUntil) {
      keys = KEY.BACK | (turn > 0 ? KEY.RIGHT : KEY.LEFT);
    } else {
      if (turn > 0.04) keys |= KEY.LEFT;
      else if (turn < -0.04) keys |= KEY.RIGHT;
      const mySpeed = Math.hypot(me.vx, me.vz);
      const tooFast = dist < 16 && u.dyn.speed > mySpeed + 3;
      const sharp = Math.abs(turn) > 1.1 && u.dyn.speed > 11;
      keys |= tooFast || sharp ? KEY.BACK : KEY.FORWARD;
      // Stuck against something: back out.
      if (u.dyn.speed < 0.8 && (keys & KEY.FORWARD) !== 0) u.stuck += dt;
      else u.stuck = Math.max(0, u.stuck - dt);
      if (u.stuck > 1.6) {
        u.reverseUntil = this.time + 1.3;
        u.stuck += 0.5;
      }
    }
    stepVehicle(u.dyn, { keys, dt }, this.params, this.ctx.sim.collisionWorld, `po:${u.id}`);
  }

  /** Is the straight line between two points free of buildings? */
  private clear(ax: number, az: number, bx: number, bz: number): boolean {
    for (const b of this.ctx.sim.collisionWorld.boxes) if (segmentHitsBox(ax, az, bx, bz, b, 1.4)) return false;
    return true;
  }

  /** Next waypoint on the road grid (intersections) towards a target. */
  private route(ax: number, az: number, tx: number, tz: number): { x: number; z: number } | null {
    const nodes: { x: number; z: number }[] = [];
    for (const x of ROAD_LINES) for (const z of ROAD_LINES) nodes.push({ x, z });
    const n = nodes.length;
    const dist = new Array<number>(n).fill(Infinity);
    const first = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (this.clear(ax, az, nodes[i]!.x, nodes[i]!.z)) {
        dist[i] = Math.hypot(nodes[i]!.x - ax, nodes[i]!.z - az);
        first[i] = i;
      }
    }
    let best = -1;
    let bestCost = Infinity;
    for (;;) {
      let i = -1;
      for (let k = 0; k < n; k++) if (!done[k] && dist[k]! < Infinity && (i < 0 || dist[k]! < dist[i]!)) i = k;
      if (i < 0) break;
      done[i] = true;
      const a = nodes[i]!;
      if (this.clear(a.x, a.z, tx, tz)) {
        const c = dist[i]! + Math.hypot(tx - a.x, tz - a.z);
        if (c < bestCost) {
          bestCost = c;
          best = i;
        }
      }
      // Neighbours along the road lines.
      for (let k = 0; k < n; k++) {
        if (done[k]) continue;
        const b = nodes[k]!;
        const adjacent = (a.x === b.x && Math.abs(a.z - b.z) === 100) || (a.z === b.z && Math.abs(a.x - b.x) === 100);
        if (!adjacent) continue;
        const c = dist[i]! + 100;
        if (c < dist[k]!) {
          dist[k] = c;
          first[k] = first[i]!;
        }
      }
    }
    return best >= 0 ? nodes[first[best]!]! : null;
  }

  // ---------------------------------------------------------------- outcomes

  private async escaped(playerId: string, w: Wanted): Promise<void> {
    const cfg = ECONOMY.police;
    this.wanted.delete(playerId);
    this.ctx.hub.sendTo(playerId, 'police.wanted', { stars: 0, units: 0, escapeLeft: null, bust: 0 });
    if (!w.pursued) return;
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        uow.credit(p, cfg.escapeReward, 'police_escape', 'Escaped a police pursuit');
        uow.grantXp(p, cfg.escapeXp);
        await uow.commit();
      });
      this.ctx.hub.sendTo(playerId, 'police.escaped', { reward: cfg.escapeReward, xp: cfg.escapeXp });
      for (const l of this.escapeListeners) l(playerId);
    } catch (err) {
      log.error('escape reward failed', { playerId, error: (err as Error).message });
    }
  }

  private async bust(playerId: string, w: Wanted, me: { x: number; z: number; rot: number; vehicleId: string | null; hl: number; hw: number }): Promise<void> {
    const cfg = ECONOMY.police;
    // The nearest police car pulls up beside the player; the others leave.
    let nearest: Unit | null = null;
    for (const u of w.units) if (!nearest || Math.hypot(u.dyn.x - me.x, u.dyn.z - me.z) < Math.hypot(nearest.dyn.x - me.x, nearest.dyn.z - me.z)) nearest = u;
    w.units = nearest ? [nearest] : [];
    if (nearest) {
      // Stopped alongside on the driver's (left) side, a little ahead, leaving room for the door.
      const rx = Math.cos(me.rot);
      const rz = -Math.sin(me.rot);
      const side = me.hw + this.params.halfWidth + 2.4;
      Object.assign(nearest.dyn, newVehicleDyn(me.x + rx * side + Math.sin(me.rot) * 1.8, me.z + rz * side + Math.cos(me.rot) * 1.8, me.rot));
      nearest.parked = true;
    }
    const d = me.vehicleId ? this.ctx.sim.drives.get(me.vehicleId) : undefined;
    if (d) {
      d.hold = true;
      d.dyn.speed = 0;
    }
    const garage = GARAGES.reduce((a, b) => (Math.hypot(b.x - me.x, b.z - me.z) < Math.hypot(a.x - me.x, a.z - me.z) ? b : a));
    let fine = 0;
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        fine = policeFine(p.money);
        if (fine > 0) uow.debit(p, fine, 'police_fine', 'Arrested: police fine');
        uow.notify(playerId, { kind: 'warning', title: 'BUSTED!', text: `Your car was impounded and a $${fine.toLocaleString('en-US')} fine was deducted.` }, false, (id) => this.ctx.hub.isOnline(id));
        await uow.commit();
      });
    } catch (err) {
      log.error('police fine failed', { playerId, error: (err as Error).message });
    }
    const event: BustedEvent = {
      fine,
      at: { x: me.x, z: me.z, rot: me.rot },
      police: nearest ? { x: nearest.dyn.x, z: nearest.dyn.z, rot: nearest.dyn.rot } : null,
      respawn: { x: garage.x, z: garage.z, rot: 0 },
      vehicleId: me.vehicleId,
      cutsceneMs: cfg.cutsceneSec * 1000,
    };
    w.busted = { until: Date.now() + event.cutsceneMs, event };
    w.heat = 0;
    this.ctx.hub.sendTo(playerId, 'police.busted', event);
    this.ctx.hub.sendTo(playerId, 'police.wanted', { stars: 0, units: 0, escapeLeft: null, bust: 1 });
    log.info('player arrested', { playerId, fine });
  }

  /** After the cutscene: the car goes to the garage, the player walks out of the nearest garage. */
  private async release(playerId: string, w: Wanted): Promise<void> {
    const ev = w.busted?.event;
    this.wanted.delete(playerId);
    this.publishObstacles();
    if (!ev) return;
    try {
      const c = this.ctx.sim.chars.get(playerId);
      const vehicleId = c?.drivingId ?? ev.vehicleId;
      if (c?.drivingId) {
        await this.ctx.locks.run([K.player(playerId), K.vehicle(c.drivingId)], async () => {
          await this.vehicles.flushDrive(c.drivingId!, true);
          this.ctx.sim.stopDriving(playerId);
        });
      }
      if (vehicleId) {
        await this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
          const v = this.ctx.state.vehicles.get(vehicleId);
          if (!v || v.ownerId !== playerId || this.ctx.sim.isDriven(vehicleId)) return;
          if (v.status === 'stolen') {
            // A stolen car goes back to its real owner.
            const uow = this.ctx.state.begin();
            uow.deleteVehicle(vehicleId);
            uow.notify(playerId, { kind: 'info', title: 'Stolen car seized', text: `The ${modelDisplayName(v.modelId)} went back to its owner.` }, false, (id) => this.ctx.hub.isOnline(id));
            await uow.commit();
            return;
          }
          if (v.status !== 'world') return;
          const uow = this.ctx.state.begin();
          uow.vehicle(vehicleId).status = 'stored';
          uow.notify(playerId, { kind: 'info', title: 'Impounded', text: `Your ${modelDisplayName(v.modelId)} was towed to your garage.` }, false, (id) => this.ctx.hub.isOnline(id));
          await uow.commit();
        });
      }
      this.ctx.sim.teleport(playerId, ev.respawn.x, ev.respawn.z);
      this.ctx.sim.rebuildDynamic();
    } catch (err) {
      log.error('release after arrest failed', { playerId, error: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------- network

  private send(playerId: string, w: Wanted, force = false): void {
    const cfg = ECONOMY.police;
    const stars = starsFor(w.heat);
    const escapeLeft = w.units.length > 0 && w.escapeT > 0.5 ? Math.max(0, Math.ceil(cfg.escapeSec - w.escapeT)) : null;
    const state: WantedState = { stars, units: w.units.length, escapeLeft, bust: Math.round(Math.min(1, w.bustT / cfg.bustSec) * 10) / 10 };
    const key = JSON.stringify(state);
    const now = Date.now();
    if (!force && (key === w.sent || now - w.sentAt < 200)) return;
    w.sent = key;
    w.sentAt = now;
    this.ctx.hub.sendTo(playerId, 'police.wanted', state);
  }

  /** Police cars are obstacles for everyone (and traffic brakes for them). */
  private publishObstacles(): void {
    const list = [];
    for (const w of this.wanted.values()) {
      for (const u of w.units) {
        const h = u.dyn.speed >= 0 ? u.dyn.rot + u.dyn.slip : u.dyn.rot;
        list.push({ id: `po:${u.id}`, modelId: POLICE_MODEL.id, x: u.dyn.x, z: u.dyn.z, rot: u.dyn.rot, vx: Math.sin(h) * u.dyn.speed, vz: Math.cos(h) * u.dyn.speed });
      }
    }
    this.ctx.sim.setExtraObstacles('police', list);
  }

  /** Police cars within `radius` of a point (for snapshots). */
  snapshot(x: number, z: number, radius: number): PoliceSnap[] {
    const out: PoliceSnap[] = [];
    const r2 = radius * radius;
    for (const w of this.wanted.values()) {
      for (const u of w.units) {
        const d = u.dyn;
        if ((d.x - x) ** 2 + (d.z - z) ** 2 > r2) continue;
        out.push([u.id, Math.round(d.x * 100) / 100, Math.round(d.z * 100) / 100, Math.round(d.rot * 1000) / 1000, Math.round(d.speed * 100) / 100, Math.round(d.steer * 1000) / 1000, PF.SIREN | (d.brk > 0.1 ? PF.BRAKE : 0)]);
      }
    }
    return out;
  }

  /** Any police car in the world (tick fast path). */
  get active(): boolean {
    return this.wanted.size > 0;
  }
}

/** Does a segment pass through an axis-aligned box (grown by `pad`)? */
function segmentHitsBox(ax: number, az: number, bx: number, bz: number, b: AABB, pad: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const slab = (p: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return p >= lo && p <= hi;
    let ta = (lo - p) / d;
    let tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    return t0 <= t1;
  };
  return slab(ax, dx, b.minX - pad, b.maxX + pad) && slab(az, dz, b.minZ - pad, b.maxZ + pad);
}

// Guns and fights: Ammu-Nation, shots, damage, health, pedestrians, police officers on foot, WASTED.
//
// Shots come from clients as 'fire' events (weapon, muzzle, aim). The server checks the gun, the
// ammo and the fire rate, then traces the shot itself: the first building, car or person in the way
// takes the damage. Everyone near sees the tracer ('combat.shot').
//
//  - Cars have body HP (shared/weapons.ts damageLook: glass, bumper, doors, smoke). At zero the
//    engine blows: an explosion, and the car is a wreck (owned cars: engine and body at 0 until
//    repaired; street cars are towed; highway traffic leaves; police cars are written off).
//    Other players' cars and other players themselves don't take damage (no PvP in the city), but
//    shooting at them is still a crime.
//  - Shooting at people (pedestrians, drivers, customers) is 3 stars at once; at the police, 4.
//  - From 3 stars, officers get out of the police cars close to you and shoot back.
//  - Health comes back slowly out of a fight; at zero you are WASTED: you wake up at the hospital
//    without your lockpick sets, stripped parts or stolen cars, and the police forget you.

import { CHAR_RADIUS } from '../../../shared/physics';
import { HOSPITAL } from '../../../shared/compounds';
import { LOCKPICK_ITEM, parsePartItem } from '../../../shared/theft';
import { Anim } from '../../../shared/types';
import { angleDiff } from '../../../shared/util';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { AMMO, COMBAT, STARTER_ROUNDS, WEAPONS, aimRay, ammoDef, rayBox, rayCircle, rayObb, rayY, spreadAim, weapon, weaponItem, type ExplosionFx, type HealthView, type Ray2, type ShotFx, type WeaponDef, type WeaponId } from '../../../shared/weapons';
import { BLOCK_CENTERS, BLOCK_HALF, BUILDINGS, SIDEWALK } from '../../../shared/world';
import { VIP_COIN } from '../../../shared/rewards';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireNear } from '../guards';
import type { NpcEntity } from '../simulation';
import type { CustomerService } from './customers';
import type { PoliceService } from './police';
import type { TheftService } from './theft';
import type { VehicleService } from './vehicles';

const log = createLogger('combat');
const C = COMBAT;
const PERSON_R = 0.38;
const PERSON_H = 1.85;
const SHOT_FX_RADIUS = 170;

interface Health {
  hp: number;
  hitAt: number;
  fromX?: number;
  fromZ?: number;
  sentHp: number;
}

interface Ped {
  npc: NpcEntity;
  hp: number;
  /** Block loop it walks around, which way, how far along (m) and how fast. */
  bx: number;
  bz: number;
  dir: 1 | -1;
  s: number;
  speed: number;
  panicUntil: number;
  deadAt: number;
}

interface Officer {
  npc: NpcEntity;
  hp: number;
  target: string;
  unitId: number;
  fireAt: number;
  deadAt: number;
}

/** Size of a block's sidewalk loop (half) and its length. */
const LOOP_HALF = BLOCK_HALF + SIDEWALK / 2;
const LOOP_LEN = LOOP_HALF * 8;

function loopPoint(bx: number, bz: number, s: number): { x: number; z: number; rot: number } {
  const h = LOOP_HALF;
  const t = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const side = Math.floor(t / (2 * h));
  const k = t - side * 2 * h;
  // Clockwise on the map from the north-west corner.
  if (side === 0) return { x: bx - h + k, z: bz - h, rot: Math.PI / 2 };
  if (side === 1) return { x: bx + h, z: bz - h + k, rot: 0 };
  if (side === 2) return { x: bx + h - k, z: bz + h, rot: -Math.PI / 2 };
  return { x: bx - h, z: bz + h - k, rot: Math.PI };
}

type Who = 'player' | 'ped' | 'officer' | 'customer';
type Target = { type: 'car'; id: string; who?: undefined } | { type: 'person'; id: string; who: Who };

let seq = 1;

export class CombatService {
  private health = new Map<string, Health>();
  private equipped = new Map<string, WeaponId>();
  private lastShot = new Map<string, number>();
  /** Rounds fired but not yet taken out of the saved inventory (written every couple of seconds). */
  private spent = new Map<string, Map<string, number>>();
  /** Body HP of damaged vehicles (by obstacle id); missing = full. */
  private carHp = new Map<string, number>();
  private wrecks = new Set<string>();
  private peds = new Map<string, Ped>();
  private officers = new Map<string, Officer>();
  private pedRespawn: number[] = [];
  private flushAt = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
    private readonly theft: TheftService,
    private readonly customers: CustomerService,
    private readonly vehicles: VehicleService,
  ) {
    for (let i = 0; i < C.pedestrians; i++) this.spawnPed(Date.now());
  }

  // ---------------------------------------------------------------- shop

  /** Buy a gun (cash or VIP Coins) or a box of ammo at Ammu-Nation. */
  async buy(playerId: string, params: unknown): Promise<{ item: string; money: number }> {
    const p = val.obj(params);
    const item = val.str(p.item, 'item', 40);
    const gun = WEAPONS.find((w) => weaponItem(w.id) === item);
    const box = gun ? undefined : ammoDef(item);
    if (!gun && !box) throw new GameError('bad_request', 'Ammu-Nation does not sell that.');
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'ammu');
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const inv = player.inventory;
      if (gun) {
        if ((inv[item] ?? 0) > 0) throw new GameError('conflict', 'You already own that gun.');
        if (gun.vip !== null) {
          const coins = inv[VIP_COIN] ?? 0;
          if (coins < gun.vip) throw new GameError('insufficient_funds', `You need ${gun.vip} VIP Coins (you have ${coins}). They come from the daily login streak and the 3-hour playtime reward.`);
          inv[VIP_COIN] = coins - gun.vip;
          if (inv[VIP_COIN] === 0) delete inv[VIP_COIN];
        } else {
          uow.debit(player, gun.price!, 'weapon', `Ammu-Nation: ${gun.name}`);
        }
        inv[item] = 1;
        inv[gun.ammo] = (inv[gun.ammo] ?? 0) + STARTER_ROUNDS;
        uow.notify(playerId, { kind: 'success', title: `${gun.name} bought`, text: `It comes with ${STARTER_ROUNDS} rounds. Press ${gun.slot} to draw it, left click to fire, Q to put it away.` });
      } else {
        uow.debit(player, box!.price, 'weapon', `Ammu-Nation: ${box!.name}`);
        inv[box!.id] = (inv[box!.id] ?? 0) + box!.rounds;
      }
      await uow.commit();
      return { item, money: this.ctx.state.players.get(playerId)!.money };
    });
  }

  /** Patch up at the hospital front desk. */
  async heal(playerId: string): Promise<HealthView> {
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'hospital');
      const h = this.hp(playerId);
      if (h.hp >= C.playerHp) throw new GameError('conflict', 'You are in perfect health.');
      const uow = this.ctx.state.begin();
      uow.debit(uow.player(playerId), C.healPrice, 'hospital', 'Hospital: patched up');
      await uow.commit();
      h.hp = C.playerHp;
      this.sendHealth(playerId, true);
      return this.healthView(playerId);
    });
  }

  // ---------------------------------------------------------------- guns

  /** Draw a gun (or put it away: null). */
  equip(playerId: string, params: unknown): { weapon: WeaponId | null } {
    const p = val.obj(params);
    const c = this.ctx.sim.chars.get(playerId);
    if (!c) throw new GameError('conflict', 'You are not in the world.');
    if (p.weapon === null || p.weapon === undefined) {
      this.equipped.delete(playerId);
      c.weapon = 0;
      return { weapon: null };
    }
    const w = weapon(String(p.weapon));
    if (!w) throw new GameError('bad_request', 'Unknown weapon.');
    const inv = this.ctx.state.players.get(playerId)?.inventory ?? {};
    if ((inv[weaponItem(w.id)] ?? 0) < 1) throw new GameError('forbidden', `You don't have a ${w.name}. Ammu-Nation sells them.`);
    this.equipped.set(playerId, w.id);
    c.weapon = w.slot;
    return { weapon: w.id };
  }

  /** Rounds left of a kind (inventory minus what was fired since the last save). */
  ammoLeft(playerId: string, ammo: string): number {
    const inv = this.ctx.state.players.get(playerId)?.inventory ?? {};
    return (inv[ammo] ?? 0) - (this.spent.get(playerId)?.get(ammo) ?? 0);
  }

  /** A shot from a client: [weapon, x, y, z, yaw, pitch, seq]. Returns false when refused. */
  fire(playerId: string, raw: unknown, now = Date.now()): boolean {
    if (!Array.isArray(raw) || raw.length < 7) return false;
    const [wid, x, y, z, yaw, pitch, n] = raw as unknown[];
    const w = typeof wid === 'string' ? weapon(wid) : undefined;
    if (!w || ![x, y, z, yaw, pitch, n].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.drivingId || c.ridingId || c.dead) return false;
    if (this.equipped.get(playerId) !== w.id) return false;
    if (this.police.wantedOf(playerId)?.busted) return false;
    // Fire rate (a little slack for network jitter).
    const last = this.lastShot.get(playerId) ?? 0;
    if (now - last < (1000 / w.rate) * 0.75) return false;
    // From where the player stands.
    if (Math.hypot((x as number) - c.x, (z as number) - c.z) > 1.6 || (y as number) < 0.6 || (y as number) > 2.2) return false;
    if (this.ammoLeft(playerId, w.ammo) < 1) return false;
    this.lastShot.set(playerId, now);
    const spent = this.spent.get(playerId) ?? new Map<string, number>();
    spent.set(w.ammo, (spent.get(w.ammo) ?? 0) + 1);
    this.spent.set(playerId, spent);
    for (let i = 0; i < w.pellets; i++) {
      const aim = spreadAim(yaw as number, pitch as number, w.spread, (n as number) * 13 + i * 7 + 1);
      this.trace(playerId, w, aimRay(x as number, y as number, z as number, aim.yaw, aim.pitch), now, i === 0);
    }
    // Shots fired near people get reported.
    if (this.witnesses(c.x, c.z, 40)) this.police.raiseHeat(playerId, 100);
    this.panic(c.x, c.z, 35, now);
    return true;
  }

  /** Follow one pellet: the first thing in its way takes the damage. */
  private trace(shooter: string, w: WeaponDef, r: Ray2, now: number, sound: boolean): void {
    let best = w.range;
    let kind: ShotFx['hit'] = 'air';
    let n: [number, number, number] | undefined;
    let target: Target | null = null;
    // The ground.
    if (r.slope < -1e-4) {
      const t = r.y / -r.slope;
      if (t < best) {
        best = t;
        kind = 'ground';
        n = [0, 1, 0];
      }
    }
    // Buildings and walls.
    for (const b of BUILDINGS) {
      const hit = rayBox(r, b.box.minX, b.box.maxX, b.box.minZ, b.box.maxZ);
      if (hit && hit.t < best && rayY(r, hit.t) <= b.height) {
        best = hit.t;
        kind = 'wall';
        n = [hit.nx, 0, hit.nz];
        target = null;
      }
    }
    for (const b of this.ctx.sim.collisionWorld.boxes) {
      const hit = rayBox(r, b.minX, b.maxX, b.minZ, b.maxZ);
      if (hit && hit.t < best && rayY(r, hit.t) <= 5) {
        best = hit.t;
        kind = 'wall';
        n = [hit.nx, 0, hit.nz];
        target = null;
      }
    }
    // Cars (parked and driven, street cars, police, highway traffic near players).
    for (const v of this.ctx.sim.collisionWorld.vehicles) {
      const hit = rayObb(r, v.x, v.z, v.rot, v.hl, v.hw);
      if (!hit || hit.t >= best) continue;
      const y = rayY(r, hit.t);
      if (y < 0 || y > this.carHeight(v.id)) continue;
      // A driver can't shoot their own car from inside; nor from right next to it by accident.
      if (hit.t < 0.05) continue;
      best = hit.t;
      kind = 'car';
      n = [hit.nx, 0, hit.nz];
      target = { type: 'car', id: v.id };
    }
    // People.
    const person = (id: string, x: number, z: number, who: Who) => {
      const t = rayCircle(r, x, z, PERSON_R);
      if (t === null || t >= best || t < 0.3) return;
      const y = rayY(r, t);
      if (y < 0 || y > PERSON_H) return;
      best = t;
      kind = 'person';
      n = undefined;
      target = { type: 'person', id, who };
    };
    for (const c of this.ctx.sim.chars.values()) if (c.id !== shooter && !c.drivingId && !c.ridingId && !c.dead) person(c.id, c.x, c.z, 'player');
    for (const p of this.peds.values()) if (!p.deadAt) person(p.npc.id, p.npc.x, p.npc.z, 'ped');
    for (const o of this.officers.values()) if (!o.deadAt) person(o.npc.id, o.npc.x, o.npc.z, 'officer');
    for (const npc of this.ctx.sim.npcs.values()) if (npc.id.startsWith('npc')) person(npc.id, npc.x, npc.z, 'customer');

    const to: [number, number, number] = [r.x + r.dx * best, rayY(r, best), r.z + r.dz * best];
    const fx: ShotFx = { by: shooter, weapon: w.id, from: [r.x, r.y, r.z], to, hit: kind, ...(n ? { n } : {}) };
    const t = target as Target | null;
    if (t?.type === 'car') fx.carId = t.id;
    if (sound || kind !== 'air') this.broadcastShot(fx);
    if (w.blast && kind !== 'air') {
      this.explode(to[0], Math.max(0, to[1]), to[2], w.blast.radius, w.blast.damage, shooter, now);
      return;
    }
    if (!t) return;
    if (t.type === 'car') this.damageCar(t.id, w.damage, shooter, now);
    else this.damagePerson(t.id, t.who!, w.damage, shooter, r.x, r.z, now);
  }

  private carHeight(id: string): number {
    const v = this.ctx.state.vehicles.get(id);
    const m = v ? getModel(v.modelId) : null;
    return m ? m.shape.rideHeight + m.shape.bodyHeight + m.shape.cabinHeight : id.startsWith('tr:') ? 3 : 1.6;
  }

  private broadcastShot(fx: ShotFx): void {
    for (const c of this.ctx.sim.chars.values()) {
      if (Math.hypot(c.x - fx.from[0], c.z - fx.from[2]) < SHOT_FX_RADIUS) this.ctx.hub.sendTo(c.id, 'combat.shot', fx);
    }
  }

  // ---------------------------------------------------------------- damage

  /** Who is in a car (a player driving it, a traffic or police driver). */
  private occupied(id: string): boolean {
    return id.startsWith('tr:') || id.startsWith('po:') || this.ctx.sim.isDriven(id);
  }

  /** Damage a car (when it may be damaged); at zero HP the engine blows. */
  damageCar(id: string, amount: number, by: string | null, now = Date.now()): void {
    if (this.wrecks.has(id)) return;
    if (by) {
      if (id.startsWith('po:')) this.police.raiseHeat(by, C.heatPolice);
      else if (this.occupied(id) && this.ctx.sim.driverOf(id) !== by) this.police.raiseHeat(by, C.heatPerson);
    }
    const v = this.ctx.state.vehicles.get(id);
    if (v) {
      // Nobody else's car: no damage to other players' property.
      if (by && v.ownerId !== by) return;
    } else if (!id.startsWith('tr:') && !id.startsWith('po:') && !this.theft.streetCar(id)) {
      return;
    }
    const before = this.carHp.get(id) ?? C.vehicleHp;
    const hp = Math.max(0, before - amount);
    this.carHp.set(id, hp);
    this.ctx.hub.broadcast('combat.carHp', { id, hp });
    if (hp <= 0) void this.blowUp(id, by, now);
  }

  /** Engine blow-out: an explosion, and what's left of the car. */
  private async blowUp(id: string, by: string | null, now: number): Promise<void> {
    if (this.wrecks.has(id)) return;
    this.wrecks.add(id);
    const box = this.ctx.sim.collisionWorld.vehicles.find((b) => b.id === id);
    if (box) this.explode(box.x, 0.8, box.z, C.explosionRadius, C.explosionDamage, by, now, id);
    if (id.startsWith('po:')) {
      this.police.removeUnit(Number(id.slice(3)));
      this.forgetCar(id, 4000);
      return;
    }
    if (id.startsWith('tr:')) {
      this.forgetCar(id, 2500);
      return;
    }
    if (this.theft.streetCar(id)) {
      setTimeout(() => this.theft.wreckStreetCar(id), 6000);
      this.forgetCar(id, 6500);
      return;
    }
    const v = this.ctx.state.vehicles.get(id);
    if (!v) return;
    try {
      await this.ctx.locks.run([K.vehicle(id)], async () => {
        const driver = this.ctx.sim.driverOf(id);
        if (driver) {
          await this.vehicles.flushDrive(id, true);
          this.ctx.sim.stopDriving(driver);
        }
        const uow = this.ctx.state.begin();
        const veh = uow.vehicle(id);
        veh.condition = { ...veh.condition, engine: 0, body: 0 };
        if (veh.ownerId) uow.notify(veh.ownerId, { kind: 'warning', title: 'Engine blow-out!', text: `Your ${modelDisplayName(veh.modelId)} is a wreck. Send it to the garage (store it) and repair it at Wrench Bros.` });
        await uow.commit();
        this.ctx.sim.rebuildDynamic();
      });
    } catch (err) {
      log.error('blow-up failed', { id, error: (err as Error).message });
    }
  }

  /** Forget a destroyed car's damage after a while (traffic and police come back as new cars). */
  private forgetCar(id: string, ms: number): void {
    setTimeout(() => {
      this.carHp.delete(id);
      this.wrecks.delete(id);
      this.ctx.hub.broadcast('combat.carHp', { id, hp: C.vehicleHp });
    }, ms);
  }

  /** A blast: cars and people inside the radius take damage that falls off with distance. */
  explode(x: number, y: number, z: number, radius: number, damage: number, by: string | null, now = Date.now(), carId?: string): void {
    const fx: ExplosionFx = { x, y, z, radius, ...(carId ? { carId } : {}) };
    for (const c of this.ctx.sim.chars.values()) if (Math.hypot(c.x - x, c.z - z) < SHOT_FX_RADIUS * 1.5) this.ctx.hub.sendTo(c.id, 'combat.explosion', fx);
    const fall = (d: number) => damage * Math.max(0, 1 - d / radius);
    for (const v of [...this.ctx.sim.collisionWorld.vehicles]) {
      if (v.id === carId) continue;
      const d = Math.max(0, Math.hypot(v.x - x, v.z - z) - Math.max(v.hl, v.hw) * 0.5);
      if (d < radius) this.damageCar(v.id, fall(d), by, now);
    }
    for (const p of this.peds.values()) {
      const d = Math.hypot(p.npc.x - x, p.npc.z - z);
      if (d < radius && !p.deadAt) this.damagePerson(p.npc.id, 'ped', fall(d), by, x, z, now);
    }
    for (const o of this.officers.values()) {
      const d = Math.hypot(o.npc.x - x, o.npc.z - z);
      if (d < radius && !o.deadAt) this.damagePerson(o.npc.id, 'officer', fall(d), by, x, z, now);
    }
    for (const npc of [...this.ctx.sim.npcs.values()]) {
      if (!npc.id.startsWith('npc')) continue;
      const d = Math.hypot(npc.x - x, npc.z - z);
      if (d < radius) this.damagePerson(npc.id, 'customer', fall(d), by, x, z, now);
    }
    // Players: only the one who set it off (no PvP), and anyone caught in a police car's blast.
    for (const c of this.ctx.sim.chars.values()) {
      if (by && c.id !== by) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < radius) this.hurtPlayer(c.id, fall(d) * (c.drivingId ? 0.6 : 1), x, z, now);
    }
    this.panic(x, z, 60, now);
  }

  private damagePerson(id: string, who: Who, amount: number, by: string | null, fromX: number, fromZ: number, now: number): void {
    if (by) this.police.raiseHeat(by, who === 'officer' ? C.heatPolice : C.heatPerson);
    if (who === 'player') return; // no PvP
    if (who === 'customer') {
      const npc = this.ctx.sim.npcs.get(id);
      if (!npc) return;
      this.customers.kill(id);
      // Lies there a while as a pedestrian body.
      npc.anim = Anim.Dead;
      setTimeout(() => this.ctx.sim.npcs.delete(id), 9000);
      return;
    }
    if (who === 'ped') {
      const p = this.peds.get(id);
      if (!p || p.deadAt) return;
      p.hp -= amount;
      p.panicUntil = now + 8000;
      if (p.hp <= 0) {
        p.deadAt = now;
        p.npc.anim = Anim.Dead;
        p.npc.rot = Math.atan2(p.npc.x - fromX, p.npc.z - fromZ);
      }
      return;
    }
    const o = this.officers.get(id);
    if (!o || o.deadAt) return;
    o.hp -= amount;
    if (o.hp <= 0) {
      o.deadAt = now;
      o.npc.anim = Anim.Dead;
    }
  }

  // ---------------------------------------------------------------- health

  private hp(playerId: string): Health {
    let h = this.health.get(playerId);
    if (!h) {
      h = { hp: C.playerHp, hitAt: 0, sentHp: C.playerHp };
      this.health.set(playerId, h);
    }
    return h;
  }

  healthView(playerId: string): HealthView {
    const h = this.hp(playerId);
    return { hp: Math.round(h.hp), max: C.playerHp, hitAt: h.hitAt, ...(h.fromX !== undefined ? { fromX: h.fromX, fromZ: h.fromZ } : {}) };
  }

  private sendHealth(playerId: string, force = false): void {
    const h = this.hp(playerId);
    const hp = Math.round(h.hp);
    if (!force && hp === h.sentHp) return;
    h.sentHp = hp;
    this.ctx.hub.sendTo(playerId, 'combat.health', this.healthView(playerId));
  }

  /** A player gets hurt (police bullets, a blast). */
  hurtPlayer(playerId: string, amount: number, fromX: number, fromZ: number, now = Date.now()): void {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead || amount <= 0) return;
    const h = this.hp(playerId);
    h.hp = Math.max(0, h.hp - amount);
    h.hitAt = now;
    h.fromX = fromX;
    h.fromZ = fromZ;
    this.sendHealth(playerId, true);
    if (h.hp <= 0) void this.wasted(playerId);
  }

  /** Health to zero: WASTED, the hospital, and what the police take. */
  private async wasted(playerId: string): Promise<void> {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead) return;
    c.dead = true;
    this.equipped.delete(playerId);
    c.weapon = 0;
    const lost: string[] = [];
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (c.drivingId) {
          const id = c.drivingId;
          await this.ctx.locks.run([K.vehicle(id)], async () => {
            await this.vehicles.flushDrive(id, true);
            this.ctx.sim.stopDriving(playerId);
          });
        }
        if (c.ridingId) this.ctx.sim.stopRiding(playerId);
        this.flushAmmo(playerId);
        const uow = this.ctx.state.begin();
        const player = uow.player(playerId);
        for (const [item, qty] of Object.entries(player.inventory)) {
          if (item === LOCKPICK_ITEM || parsePartItem(item)) {
            delete player.inventory[item];
            lost.push(`${qty}x ${item === LOCKPICK_ITEM ? 'Lockpick & Testere Seti' : 'stripped part'}`);
          }
        }
        for (const v of this.ctx.state.vehiclesOf(playerId)) {
          if (v.status !== 'stolen' || v.mods.strip || this.ctx.sim.isDriven(v.id)) continue;
          uow.deleteVehicle(v.id);
          lost.push(`stolen ${modelDisplayName(v.modelId)}`);
        }
        await uow.commit();
      });
    } catch (err) {
      log.error('wasted cleanup failed', { playerId, error: (err as Error).message });
    }
    this.police.clearWanted(playerId);
    for (const o of this.officers.values()) if (o.target === playerId) o.target = '';
    this.ctx.hub.sendTo(playerId, 'combat.wasted', { lost, respawnInMs: 4500 });
    log.info('player wasted', { playerId, lost: lost.length });
    setTimeout(() => {
      const ch = this.ctx.sim.chars.get(playerId);
      if (!ch) return;
      this.ctx.sim.teleport(playerId, HOSPITAL.respawn.x, HOSPITAL.respawn.z);
      ch.dead = false;
      this.hp(playerId).hp = C.playerHp;
      this.sendHealth(playerId, true);
      this.ctx.sim.rebuildDynamic();
    }, 4500);
  }

  // ---------------------------------------------------------------- people in the street

  private spawnPed(now: number): void {
    const rng = this.ctx.rng;
    const bx = BLOCK_CENTERS[Math.floor(rng() * BLOCK_CENTERS.length)]!;
    const bz = BLOCK_CENTERS[Math.floor(rng() * BLOCK_CENTERS.length)]!;
    const s = rng() * LOOP_LEN;
    const at = loopPoint(bx, bz, s);
    const id = `ped_${seq++}`;
    const npc: NpcEntity = { id, x: at.x, z: at.z, rot: at.rot, anim: Anim.Walk, style: Math.floor(rng() * 1000) };
    this.peds.set(id, { npc, hp: C.pedestrianHp, bx, bz, dir: rng() < 0.5 ? 1 : -1, s, speed: 1.2 + rng() * 0.6, panicUntil: 0, deadAt: 0 });
    this.ctx.sim.npcs.set(id, npc);
    void now;
  }

  /** People near gunfire run. */
  private panic(x: number, z: number, radius: number, now: number): void {
    for (const p of this.peds.values()) if (!p.deadAt && Math.hypot(p.npc.x - x, p.npc.z - z) < radius) p.panicUntil = now + 7000;
  }

  private witnesses(x: number, z: number, radius: number): boolean {
    for (const p of this.peds.values()) if (!p.deadAt && Math.hypot(p.npc.x - x, p.npc.z - z) < radius) return true;
    for (const npc of this.ctx.sim.npcs.values()) if (npc.id.startsWith('npc') && Math.hypot(npc.x - x, npc.z - z) < radius) return true;
    return false;
  }

  // ---------------------------------------------------------------- tick

  tick(dt: number, now = Date.now()): void {
    // Pedestrians walk round their block (run when there's shooting).
    for (const [id, p] of this.peds) {
      if (p.deadAt) {
        if (now - p.deadAt > 9000) {
          this.peds.delete(id);
          this.ctx.sim.npcs.delete(id);
          this.pedRespawn.push(now + C.pedRespawnSec * 1000);
        }
        continue;
      }
      const run = now < p.panicUntil;
      p.s += p.dir * (run ? 4.2 : p.speed) * dt;
      const at = loopPoint(p.bx, p.bz, p.s);
      p.npc.x = at.x;
      p.npc.z = at.z;
      p.npc.rot = at.rot + (p.dir < 0 ? Math.PI : 0);
      p.npc.anim = run ? Anim.Run : Anim.Walk;
    }
    while (this.pedRespawn.length && this.pedRespawn[0]! <= now) {
      this.pedRespawn.shift();
      this.spawnPed(now);
    }
    this.tickOfficers(dt, now);
    // Health comes back out of a fight.
    for (const [playerId, h] of this.health) {
      if (!this.ctx.sim.chars.has(playerId)) {
        this.health.delete(playerId);
        continue;
      }
      if (h.hp < C.playerHp && h.hp > 0 && now - h.hitAt > C.regenDelaySec * 1000) {
        h.hp = Math.min(C.playerHp, h.hp + C.regenPerSec * dt);
        this.sendHealth(playerId);
      }
    }
    // Wrecked cars: owned ones come back to life once repaired.
    for (const id of this.wrecks) {
      const v = this.ctx.state.vehicles.get(id);
      if (v && v.condition.engine > 20) {
        this.wrecks.delete(id);
        this.carHp.delete(id);
        this.ctx.hub.broadcast('combat.carHp', { id, hp: C.vehicleHp });
      }
    }
    // A wreck can't be driven.
    for (const d of this.ctx.sim.drives.values()) if (this.wrecks.has(d.vehicleId)) d.hold = true;
    if (now > this.flushAt) {
      this.flushAt = now + 2000;
      for (const playerId of [...this.spent.keys()]) this.flushAmmo(playerId);
    }
  }

  /** Officers get out of police cars near a 3-star suspect, keep their distance and shoot. */
  private tickOfficers(dt: number, now: number): void {
    for (const c of this.ctx.sim.chars.values()) {
      if (c.dead || this.police.starsOf(c.id) < C.officerStars) continue;
      const pos = c.drivingId ? this.ctx.sim.drives.get(c.drivingId)?.dyn : c;
      if (!pos) continue;
      for (const u of this.police.unitsOf(c.id)) {
        if (Math.abs(u.dyn.speed) > 3 || Math.hypot(u.dyn.x - pos.x, u.dyn.z - pos.z) > 32) continue;
        const crew = [...this.officers.values()].filter((o) => o.unitId === u.id && !o.deadAt).length;
        if (crew >= 2) continue;
        const side = crew === 0 ? 1 : -1;
        const id = `cop_${seq++}`;
        const npc: NpcEntity = { id, x: u.dyn.x + Math.cos(u.dyn.rot) * 1.6 * side, z: u.dyn.z - Math.sin(u.dyn.rot) * 1.6 * side, rot: u.dyn.rot, anim: Anim.Aim, style: 0 };
        this.officers.set(id, { npc, hp: C.officerHp, target: c.id, unitId: u.id, fireAt: now + 900 + this.ctx.rng() * 600, deadAt: 0 });
        this.ctx.sim.npcs.set(id, npc);
      }
    }
    for (const [id, o] of this.officers) {
      if (o.deadAt) {
        if (now - o.deadAt > 10_000) {
          this.officers.delete(id);
          this.ctx.sim.npcs.delete(id);
        }
        continue;
      }
      const t = o.target ? this.ctx.sim.chars.get(o.target) : undefined;
      const tpos = t ? (t.drivingId ? this.ctx.sim.drives.get(t.drivingId)?.dyn : t) : undefined;
      // Suspect gone, calmed down or far away: back to the car and off.
      if (!t || !tpos || t.dead || this.police.starsOf(t.id) < C.officerStars || Math.hypot(tpos.x - o.npc.x, tpos.z - o.npc.z) > 120) {
        this.officers.delete(id);
        this.ctx.sim.npcs.delete(id);
        continue;
      }
      const dx = tpos.x - o.npc.x;
      const dz = tpos.z - o.npc.z;
      const d = Math.hypot(dx, dz);
      o.npc.rot += angleDiff(o.npc.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      // Close in to about 12 m, then stand and shoot.
      if (d > 14) {
        const step = Math.min(d - 12, 3.6 * dt);
        o.npc.x += (dx / d) * step;
        o.npc.z += (dz / d) * step;
        o.npc.anim = Anim.Run;
      } else {
        o.npc.anim = Anim.Aim;
      }
      if (now >= o.fireAt && d < C.officerRange) {
        o.fireAt = now + C.officerFireSec * 1000 * (0.8 + this.ctx.rng() * 0.4);
        const moving = t.drivingId ? Math.abs(this.ctx.sim.drives.get(t.drivingId)?.dyn.speed ?? 0) : 0;
        const chance = C.officerAccuracy * (1 - d / C.officerRange) * (moving > 8 ? 0.45 : 1) + 0.12;
        const hit = this.ctx.rng() < chance;
        const aimY = t.drivingId ? 1.0 : 1.3;
        const jitter = hit ? 0 : (this.ctx.rng() - 0.5) * 3;
        const to: [number, number, number] = [tpos.x + jitter, aimY + (hit ? 0 : this.ctx.rng() * 1.2), tpos.z + jitter];
        this.broadcastShot({ by: id, weapon: 'pistol', from: [o.npc.x, 1.35, o.npc.z], to, hit: hit ? (t.drivingId ? 'car' : 'person') : 'air', ...(hit && t.drivingId ? { carId: t.drivingId } : {}) });
        if (hit) {
          const [lo, hi] = C.officerDamage;
          const dmg = lo + this.ctx.rng() * (hi - lo);
          if (t.drivingId) {
            this.hurtPlayer(t.id, dmg * C.inCarShare, o.npc.x, o.npc.z, now);
            const own = this.ctx.state.vehicles.get(t.drivingId);
            if (own) this.damageCar(t.drivingId, dmg * 0.6, own.ownerId, now);
          } else {
            this.hurtPlayer(t.id, dmg, o.npc.x, o.npc.z, now);
          }
        }
      }
    }
  }

  /** Take fired rounds out of the saved inventory. */
  private flushAmmo(playerId: string): void {
    const spent = this.spent.get(playerId);
    if (!spent || spent.size === 0) return;
    this.spent.delete(playerId);
    void this.ctx.locks
      .run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const inv = uow.player(playerId).inventory;
        for (const [ammo, n] of spent) {
          const left = (inv[ammo] ?? 0) - n;
          if (left > 0) inv[ammo] = left;
          else delete inv[ammo];
        }
        await uow.commit();
      })
      .catch((err) => log.error('ammo flush failed', { playerId, error: (err as Error).message }));
  }

  /** State for a player who just connected. */
  welcome(playerId: string): void {
    this.sendHealth(playerId, true);
    for (const [id, hp] of this.carHp) this.ctx.hub.sendTo(playerId, 'combat.carHp', { id, hp });
  }

  forget(playerId: string): void {
    this.flushAmmo(playerId);
    this.equipped.delete(playerId);
    this.lastShot.delete(playerId);
    this.health.delete(playerId);
    for (const [id, o] of this.officers) {
      if (o.target !== playerId) continue;
      this.officers.delete(id);
      this.ctx.sim.npcs.delete(id);
    }
  }

  /** Body HP of a car (tests, HUD). */
  carHpOf(id: string): number {
    return this.carHp.get(id) ?? C.vehicleHp;
  }

  /** Every shop item (panel). */
  static catalogue() {
    return { weapons: WEAPONS, ammo: AMMO };
  }

  /** Characters stand this far apart; used to keep officers off the player. */
  static readonly reach = CHAR_RADIUS;
}

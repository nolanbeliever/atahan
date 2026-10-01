// Car theft, start to finish:
//
//  1. Black Market: Lockpick & saw sets for $2,500 from a shared stock of 5 that is full again every
//     10 minutes (real time; the count survives restarts).
//  2. Street cars: cars parked at city kerbs and broken-down cars on the highway shoulder (not
//     anybody's property). Next to one, with a set, a player starts the lockpick mini-game: the
//     lock has a secret sweet spot (only the server knows it); each turn of the pick tells how far
//     the cylinder moved, a wrong turn snaps a pick, three snapped picks lose the set, set off the
//     car alarm and bring the police (2 stars). Opening the lock makes the car the player's stolen
//     car (status 'stolen'): drivable, but it can't be stored, sold, listed or displayed.
//  3. Sanayi: drive the stolen car between the posts of a lift and put it up; walk round it and take
//     off the mirrors, doors, steering wheel, seats and exhaust, and from the engine bay the engine
//     block, gearbox, turbo, ECU, radiator, alternator and battery (each takes a few seconds of
//     work, timed by the server). The bare shell is scrapped.
//  4. Pawn Shop: a whole car's parts sell for $10,000-$15,000 (the car's value and luck); each part
//     fetches its share of that.
//
// Stolen cars left alone are recovered by the police; cars left on a lift are scrapped eventually.

import { ECONOMY } from '../../../shared/economy.config';
import {
  LIFT_BAYS,
  LOCKPICK_ITEM,
  STREET_SPOTS,
  STRIP_PARTS,
  bayAt,
  blackMarketEpoch,
  lockDifficulty,
  lockTolerance,
  lockTurn,
  nextRestockAt,
  parsePartItem,
  partItemId,
  partsFor,
  partProfile,
  pawnCarPrice,
  partShare,
  removedParts,
  stealable,
  stockLeft,
  stripPart,
  valueTier,
  type BlackMarketInfo,
  type StreetCar,
  type StripPart,
} from '../../../shared/theft';
import type { LockpickResult, StripResult } from '../../../shared/protocol';
import type { Vehicle } from '../../../shared/types';
import { formatMoney } from '../../../shared/util';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as repo from '../../db/repo';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { generateNpcVehicle } from '../generator';
import { requireNear } from '../guards';
import type { PoliceService } from './police';
import type { VehicleService } from './vehicles';

const log = createLogger('theft');
const T = ECONOMY.theft;
const STOCK_KEY = 'black_market';
const STRIP_IDS: readonly StripPart[] = STRIP_PARTS.map((p) => p.id);
const BM_LOCK = 'blackmarket';

interface LockSession {
  id: string;
  playerId: string;
  carId: string;
  sweet: number;
  tolerance: number;
  picks: number;
  expiresAt: number;
  lastTry: number;
}

interface StreetEntry extends StreetCar {
  spot: number;
  mileage: number;
  fuel: number;
}

/** Inventory delta helper (drops items that reach zero). */
function addItem(inv: Record<string, number>, id: string, qty: number): void {
  const n = (inv[id] ?? 0) + qty;
  if (n > 0) inv[id] = n;
  else delete inv[id];
}

export class TheftService {
  private cars = new Map<string, StreetEntry>();
  /** Spots waiting for a new car (spot index -> when). */
  private respawn = new Map<number, number>();
  private sessions = new Map<string, LockSession>();
  private stock = { epoch: -1, sold: 0 };
  /** Strip work in progress per car. */
  private work = new Map<string, { playerId: string; part: StripPart; readyAt: number }>();
  /** Last time each stolen car was driven or worked on. */
  private lastUsed = new Map<string, number>();
  private readonly bootAt = Date.now();
  /** Missions and others hear about thefts and pawn sales. */
  readonly theftListeners: ((playerId: string) => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
    private readonly vehicles: VehicleService,
  ) {}

  async init(): Promise<void> {
    const raw = await repo.getWorldValue(this.ctx.state.db, STOCK_KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw) as { epoch?: unknown; sold?: unknown };
        if (typeof s.epoch === 'number' && typeof s.sold === 'number') this.stock = { epoch: s.epoch, sold: s.sold };
      } catch {
        /* start fresh */
      }
    }
    const city = STREET_SPOTS.map((s, i) => ({ s, i })).filter((x) => !x.s.highway);
    const hw = STREET_SPOTS.map((s, i) => ({ s, i })).filter((x) => x.s.highway);
    for (const [list, n] of [
      [city, T.streetCars],
      [hw, T.highwayCars],
    ] as const) {
      const pool = [...list];
      for (let k = 0; k < n && pool.length > 0; k++) {
        const pick = pool.splice(Math.floor(this.ctx.rng() * pool.length), 1)[0]!;
        this.park(pick.i);
      }
    }
    this.publish();
  }

  // ---------------------------------------------------------------- Black Market

  private soldNow(now: number): number {
    return this.stock.epoch === blackMarketEpoch(now) ? this.stock.sold : 0;
  }

  info(playerId: string): BlackMarketInfo {
    const now = Date.now();
    const p = this.ctx.state.players.get(playerId);
    return { price: T.lockpickPrice, stock: stockLeft(this.soldNow(now)), max: T.stockMax, restockAt: nextRestockAt(now), owned: p?.inventory[LOCKPICK_ITEM] ?? 0 };
  }

  async buy(playerId: string): Promise<BlackMarketInfo> {
    await this.ctx.locks.run([K.player(playerId), BM_LOCK], async () => {
      const now = Date.now();
      const sold = this.soldNow(now);
      if (stockLeft(sold) <= 0) throw new GameError('conflict', `Sold out. New stock in ${Math.ceil((nextRestockAt(now) - now) / 60_000)} min.`);
      const uow = this.ctx.state.begin();
      const p = uow.player(playerId);
      if (p.money < T.lockpickPrice) throw new GameError('insufficient_funds', `You need ${formatMoney(T.lockpickPrice)} in cash.`);
      uow.debit(p, T.lockpickPrice, 'black_market', 'Black Market: Lockpick & saw set');
      addItem(p.inventory, LOCKPICK_ITEM, 1);
      const next = { epoch: blackMarketEpoch(now), sold: sold + 1 };
      uow.setWorldValue(STOCK_KEY, JSON.stringify(next));
      await uow.commit();
      this.stock = next;
    });
    const info = this.info(playerId);
    this.ctx.hub.broadcast('blackmarket.update', { price: info.price, stock: info.stock, max: info.max, restockAt: info.restockAt });
    return info;
  }

  // ---------------------------------------------------------------- street cars

  list(): { cars: StreetCar[] } {
    return { cars: this.publicCars() };
  }

  private publicCars(): StreetCar[] {
    return [...this.cars.values()].map(({ spot: _s, mileage: _m, fuel: _f, ...c }) => c);
  }

  /** Park a fresh car at a spot. */
  private park(spot: number): void {
    const s = STREET_SPOTS[spot]!;
    let v: Vehicle = generateNpcVehicle(this.ctx.rng);
    for (let i = 0; i < 20 && !stealable(v.modelId); i++) v = generateNpcVehicle(this.ctx.rng);
    if (!stealable(v.modelId)) return;
    const id = newId('sc');
    this.cars.set(id, { id, modelId: v.modelId, color: v.color, mods: v.mods, condition: v.condition, x: s.x, z: s.z, rot: s.rot, highway: s.highway, alarmUntil: 0, spot, mileage: v.mileage, fuel: v.fuel });
  }

  /** A spot is free if no car (street car or parked player car) or player is on it. */
  private spotFree(spot: number): boolean {
    const s = STREET_SPOTS[spot]!;
    for (const c of this.cars.values()) if (c.spot === spot || Math.hypot(c.x - s.x, c.z - s.z) < 7) return false;
    for (const v of this.ctx.state.vehicles.values()) {
      if ((v.status === 'world' || v.status === 'stolen') && Math.hypot(v.x - s.x, v.z - s.z) < 7) return false;
    }
    for (const c of this.ctx.sim.chars.values()) if (Math.hypot(c.x - s.x, c.z - s.z) < 6) return false;
    return true;
  }

  /** Share the street cars with everyone and make them solid. */
  private publish(): void {
    const cars = this.publicCars();
    this.ctx.sim.setExtraObstacles(
      'street',
      cars.map((c) => ({ id: c.id, modelId: c.modelId, x: c.x, z: c.z, rot: c.rot })),
    );
    this.ctx.hub.broadcast('street.cars', cars);
  }

  // ---------------------------------------------------------------- lockpick

  private near(playerId: string, x: number, z: number, reach: number): boolean {
    const pos = this.ctx.sim.position(playerId);
    return !!pos && Math.hypot(pos.x - x, pos.z - z) <= reach;
  }

  async start(playerId: string, params: unknown) {
    const p = val.obj(params);
    const carId = val.id(p.carId, 'car');
    return this.ctx.locks.run([K.player(playerId), `street:${carId}`], async () => {
      const car = this.cars.get(carId);
      if (!car) throw new GameError('not_found', 'That car is gone.');
      const now = Date.now();
      if (car.alarmUntil > now) throw new GameError('conflict', 'The alarm is still going off. Come back later.');
      const c = this.ctx.sim.chars.get(playerId);
      if (!c) throw new GameError('conflict', 'You are not in the world.');
      if (c.drivingId) throw new GameError('conflict', 'Get out of your car first.');
      if (this.police.wantedOf(playerId)?.busted) throw new GameError('conflict', 'You are under arrest.');
      const model = getModel(car.modelId);
      if (!this.near(playerId, car.x, car.z, model.shape.length / 2 + T.pickReach)) throw new GameError('too_far', 'Get right next to the car.');
      for (const s of this.sessions.values()) if (s.carId === carId && s.playerId !== playerId && s.expiresAt > now) throw new GameError('conflict', 'Someone is already working on that lock.');
      // A new attempt replaces an unfinished one (that set is lost).
      this.sessions.delete(playerId);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      if ((player.inventory[LOCKPICK_ITEM] ?? 0) < 1) throw new GameError('forbidden', 'You need a Lockpick & saw set from the Black Market.');
      addItem(player.inventory, LOCKPICK_ITEM, -1);
      await uow.commit();
      const session: LockSession = {
        id: newId('lp'),
        playerId,
        carId,
        // The sweet spot stays on the server; keep it away from the very ends of the range.
        sweet: 12 + this.ctx.rng() * 156,
        tolerance: lockTolerance(model),
        picks: T.picks,
        expiresAt: now + T.sessionSec * 1000,
        lastTry: 0,
      };
      this.sessions.set(playerId, session);
      return { sessionId: session.id, picks: session.picks, difficulty: lockDifficulty(model), modelId: car.modelId };
    });
  }

  async tryPick(playerId: string, params: unknown): Promise<LockpickResult> {
    const p = val.obj(params);
    const sessionId = val.id(p.sessionId, 'session');
    const angle = val.num(p.angle, 'angle', 0, 180);
    return this.ctx.locks.run([K.player(playerId)], async () => {
      const s = this.sessions.get(playerId);
      const now = Date.now();
      if (!s || s.id !== sessionId) throw new GameError('not_found', 'No lock in progress.');
      if (now > s.expiresAt) {
        this.sessions.delete(playerId);
        throw new GameError('conflict', 'You took too long: the set is ruined.');
      }
      if (now - s.lastTry < T.tryCooldownMs) throw new GameError('rate_limited', 'Easy - one turn at a time.');
      s.lastTry = now;
      const car = this.cars.get(s.carId);
      if (!car) {
        this.sessions.delete(playerId);
        throw new GameError('not_found', 'That car is gone.');
      }
      const model = getModel(car.modelId);
      if (!this.near(playerId, car.x, car.z, model.shape.length / 2 + T.pickReach + 1)) throw new GameError('too_far', 'Get right next to the car.');
      const turn = lockTurn(angle - s.sweet, s.tolerance);
      if (turn >= 1) {
        this.sessions.delete(playerId);
        const vehicleId = await this.steal(playerId, car);
        return { turn: 1, opened: true, picksLeft: s.picks, failed: false, vehicleId };
      }
      s.picks--;
      if (s.picks > 0) return { turn, opened: false, picksLeft: s.picks, failed: false, vehicleId: null };
      // Out of picks: the set is gone, the alarm goes off and the police come (2 stars).
      this.sessions.delete(playerId);
      car.alarmUntil = now + T.alarmSec * 1000;
      this.publish();
      this.ctx.hub.broadcast('car.alarm', { carId: car.id, x: car.x, z: car.z, until: car.alarmUntil });
      this.police.raiseHeat(playerId, T.failHeat);
      this.ctx.hub.notify(playerId, { kind: 'warning', title: 'ALARM! The lock beat you', text: 'Maymuncuk kırıldı, alarm çalıyor: polis geliyor (2 yıldız).' });
      return { turn, opened: false, picksLeft: 0, failed: true, vehicleId: null };
    });
  }

  cancel(playerId: string, params: unknown): { ok: true } {
    const p = val.obj(params);
    const sessionId = val.id(p.sessionId, 'session');
    const s = this.sessions.get(playerId);
    if (s && s.id === sessionId) this.sessions.delete(playerId);
    return { ok: true };
  }

  /** The lock is open: the street car becomes the player's stolen car, and they get in. */
  private async steal(playerId: string, car: StreetEntry): Promise<string> {
    const now = Date.now();
    const vehicle: Vehicle = {
      id: newId('veh'),
      modelId: car.modelId,
      ownerId: playerId,
      color: car.color,
      mileage: car.mileage,
      fuel: Math.max(25, car.fuel),
      condition: car.condition,
      mods: car.mods,
      status: 'stolen',
      purchasePrice: 0,
      salePrice: null,
      plotId: null,
      slot: null,
      rotation: car.rot,
      x: car.x,
      z: car.z,
      serviceUntil: 0,
      createdAt: now,
    };
    this.cars.delete(car.id);
    this.respawn.set(car.spot, now + T.respawnSec * 1000);
    this.publish();
    await this.ctx.locks.run([K.vehicle(vehicle.id)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      uow.createVehicle(vehicle);
      if (!T.consumeOnSuccess) addItem(player.inventory, LOCKPICK_ITEM, 1);
      uow.grantXp(player, T.xpPerTheft);
      uow.notify(playerId, { kind: 'success', title: 'Lock picked!', text: `Kilit açıldı: ${modelDisplayName(car.modelId)}. Sanayi'ye götürüp lifte kaldır.` });
      await uow.commit();
    });
    const live = this.ctx.state.vehicles.get(vehicle.id)!;
    const c = this.ctx.sim.chars.get(playerId);
    if (c && !c.drivingId) this.ctx.sim.startDriving(playerId, live);
    this.ctx.hub.broadcast('vehicle.upsert', this.ctx.state.toPublicVehicle(live));
    this.ctx.sim.rebuildDynamic();
    this.lastUsed.set(vehicle.id, now);
    for (const l of this.theftListeners) l(playerId);
    log.info('car stolen', { playerId, modelId: car.modelId });
    return vehicle.id;
  }

  // ---------------------------------------------------------------- Sanayi

  async lift(playerId: string, params: unknown): Promise<{ vehicle: Vehicle }> {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const veh = this.ctx.state.vehicles.get(vehicleId);
      if (!veh || veh.ownerId !== playerId) throw new GameError('not_found', 'Vehicle not found.');
      if (veh.status !== 'stolen') throw new GameError('forbidden', 'The Sanayi only strips stolen cars.');
      if (veh.mods.strip) throw new GameError('conflict', 'It is already on the lift.');
      const d = this.ctx.sim.drives.get(vehicleId);
      if (!d || d.playerId !== playerId) throw new GameError('conflict', 'Drive it onto the lift first.');
      const bay = bayAt(d.dyn.x, d.dyn.z, d.dyn.rot);
      if (bay < 0) throw new GameError('too_far', 'Line the car up between the lift posts.');
      if (Math.abs(d.dyn.speed) > 0.6) throw new GameError('conflict', 'Stop the car first.');
      for (const v of this.ctx.state.vehicles.values()) if (v.mods.strip?.bay === bay && v.id !== vehicleId) throw new GameError('conflict', 'That lift is taken.');
      await this.vehicles.flushDrive(vehicleId, true);
      this.ctx.sim.stopDriving(playerId);
      const b = LIFT_BAYS[bay]!;
      const uow = this.ctx.state.begin();
      const v = uow.vehicle(vehicleId);
      const facing = Math.abs(Math.atan2(Math.sin(v.rotation - b.yaw), Math.cos(v.rotation - b.yaw))) < Math.PI / 2;
      v.x = b.x;
      v.z = b.z;
      v.rotation = facing ? b.yaw : b.yaw + Math.PI;
      v.mods = { ...v.mods, strip: { bay, liftedAt: Date.now(), removed: [] } };
      await uow.commit();
      this.lastUsed.set(vehicleId, Date.now());
      this.ctx.sim.rebuildDynamic();
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)! };
    });
  }

  /** Where the mechanic stands to take a part off (world coordinates). */
  static stripPoint(v: Vehicle, part: StripPart): { x: number; z: number } {
    const m = getModel(v.modelId);
    const local = stripPart(part)!.point(m.shape.length, m.shape.width);
    const left = { x: Math.cos(v.rotation), z: -Math.sin(v.rotation) };
    const fwd = { x: Math.sin(v.rotation), z: Math.cos(v.rotation) };
    return { x: v.x + left.x * local.x + fwd.x * local.z, z: v.z + left.z * local.x + fwd.z * local.z };
  }

  async strip(playerId: string, params: unknown): Promise<StripResult> {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const part = val.oneOf(p.part, 'part', STRIP_IDS);
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const veh = this.ctx.state.vehicles.get(vehicleId);
      if (!veh || veh.ownerId !== playerId || veh.status !== 'stolen') throw new GameError('not_found', 'Vehicle not found.');
      if (!veh.mods.strip) throw new GameError('conflict', 'Put the car on a lift first.');
      const model = getModel(veh.modelId);
      if (!partsFor(model).includes(part)) throw new GameError('bad_request', 'This car has no such part.');
      if (removedParts(veh.mods).includes(part)) throw new GameError('conflict', 'That part is already off.');
      const c = this.ctx.sim.chars.get(playerId);
      if (!c || c.drivingId) throw new GameError('conflict', 'Get out of the car to work on it.');
      const at = TheftService.stripPoint(veh, part);
      // A little slack for latency, less than the gap between two work spots.
      if (Math.hypot(c.x - at.x, c.z - at.z) > T.stripReach + 0.5) throw new GameError('too_far', 'Stand at that part to take it off.');
      const now = Date.now();
      const w = this.work.get(vehicleId);
      if (!w || w.playerId !== playerId || w.part !== part) {
        // Start the job: the server times it.
        const readyAt = now + stripPart(part)!.seconds * 1000;
        this.work.set(vehicleId, { playerId, part, readyAt });
        this.lastUsed.set(vehicleId, now);
        this.ctx.sim.markInteract(playerId);
        return { done: false, readyAt, vehicle: veh, scrapped: false };
      }
      if (now < w.readyAt - 250) return { done: false, readyAt: w.readyAt, vehicle: veh, scrapped: false };
      this.work.delete(vehicleId);
      this.lastUsed.set(vehicleId, now);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const v = uow.vehicle(vehicleId);
      const removed = [...removedParts(v.mods), part];
      addItem(player.inventory, partItemId(part, valueTier(model), partProfile(model)), 1);
      uow.grantXp(player, T.xpPerPart);
      const all = partsFor(model).every((x) => removed.includes(x));
      if (all) {
        uow.deleteVehicle(vehicleId);
        uow.notify(playerId, { kind: 'success', title: 'Stripped bare', text: `${modelDisplayName(v.modelId)}: tüm parçalar söküldü, kasa hurdaya gitti. Parçaları Pawn Shop'ta sat.` });
      } else {
        v.mods = { ...v.mods, strip: { ...v.mods.strip!, removed } };
      }
      await uow.commit();
      if (all) {
        this.lastUsed.delete(vehicleId);
        this.ctx.sim.rebuildDynamic();
      }
      return { done: true, readyAt: w.readyAt, vehicle: all ? null : this.ctx.state.vehicles.get(vehicleId)!, scrapped: all };
    });
  }

  // ---------------------------------------------------------------- Pawn Shop

  async sell(playerId: string, params: unknown): Promise<{ amount: number; count: number }> {
    const p = val.obj(params);
    const only = p.part === undefined || p.part === null ? null : val.oneOf(p.part, 'part', STRIP_IDS);
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'pawn');
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      // Parts from the same kind of car share one price for this sale (so a whole car fetches $10,000-$15,000).
      const groups = new Map<string, { tier: number; share: number }>();
      let count = 0;
      for (const [id, qty] of Object.entries(player.inventory)) {
        const item = parsePartItem(id);
        if (!item || (only && item.part !== only) || qty <= 0) continue;
        const key = `${item.tier}:${item.profile}`;
        const g = groups.get(key) ?? { tier: item.tier, share: 0 };
        g.share += partShare(item.part, item.profile) * qty;
        groups.set(key, g);
        count += qty;
        delete player.inventory[id];
      }
      if (count === 0) throw new GameError('bad_request', 'You have no parts to sell.');
      let exact = 0;
      for (const g of groups.values()) exact += pawnCarPrice(g.tier, this.ctx.rng()) * g.share;
      const amount = Math.max(1, Math.round(exact));
      uow.credit(player, amount, 'pawn_sale', `Pawn Shop: ${count} part${count === 1 ? '' : 's'}`);
      uow.notify(playerId, { kind: 'money', title: `Parçalar Pawn Shop'a satıldı: +${formatMoney(amount)}`, text: `${count} parça (${count} part${count === 1 ? '' : 's'})` });
      await uow.commit();
      return { amount, count };
    });
  }

  // ---------------------------------------------------------------- upkeep

  forget(playerId: string): void {
    this.sessions.delete(playerId);
  }

  /** Once a second: new street cars, quiet alarms, expired locks, abandoned stolen cars. */
  async tick(): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const [spot, at] of this.respawn) {
      if (now < at) continue;
      // Park somewhere free (the same spot or another free one of the same kind).
      const kind = STREET_SPOTS[spot]!.highway;
      const options = STREET_SPOTS.map((_s, i) => i).filter((i) => STREET_SPOTS[i]!.highway === kind && this.spotFree(i));
      if (options.length === 0) continue;
      this.respawn.delete(spot);
      this.park(options[Math.floor(this.ctx.rng() * options.length)]!);
      changed = true;
    }
    for (const c of this.cars.values()) {
      if (c.alarmUntil > 0 && c.alarmUntil <= now) {
        c.alarmUntil = 0;
        changed = true;
      }
    }
    for (const [pid, s] of this.sessions) if (now > s.expiresAt + 5000) this.sessions.delete(pid);
    if (changed) this.publish();

    for (const v of [...this.ctx.state.vehicles.values()]) {
      if (v.status !== 'stolen') continue;
      if (this.ctx.sim.isDriven(v.id)) {
        this.lastUsed.set(v.id, now);
        continue;
      }
      const last = Math.max(this.lastUsed.get(v.id) ?? this.bootAt, v.mods.strip?.liftedAt ?? 0);
      const limit = (v.mods.strip ? T.liftIdleSec : T.abandonSec) * 1000;
      if (now - last < limit) continue;
      await this.ctx.locks
        .run([K.vehicle(v.id)], async () => {
          const live = this.ctx.state.vehicles.get(v.id);
          if (!live || live.status !== 'stolen' || this.ctx.sim.isDriven(v.id)) return;
          const uow = this.ctx.state.begin();
          uow.deleteVehicle(v.id);
          if (live.ownerId) {
            uow.notify(
              live.ownerId,
              live.mods.strip
                ? { kind: 'info', title: 'Scrapped', text: `The ${modelDisplayName(live.modelId)} left on the lift went for scrap.` }
                : { kind: 'warning', title: 'Stolen car recovered', text: `Police found the ${modelDisplayName(live.modelId)} you left and returned it to its owner.` },
              true,
              (id) => this.ctx.hub.isOnline(id),
            );
          }
          await uow.commit();
          this.lastUsed.delete(v.id);
          this.ctx.sim.rebuildDynamic();
        })
        .catch((err) => log.error('stolen car cleanup failed', { error: (err as Error).message }));
    }
  }
}

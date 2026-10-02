// The themed showrooms on the far shore's Galeri Bulvarı (shared/showrooms.ts).
//
//   * New cars at the showroom price (market value plus the showroom's margin), in any of the
//     model's factory colours.
//   * The Black Market: six used cars the Sanayi pieced together, with a theft record (`mods.hot`:
//     number-plate cameras flag them), cheap but never below the quick-sell payout. The stock is
//     rolled from (server secret, epoch) every rotation, like the Rare Dealer's, and sold cars stay
//     sold across restarts.
//   * Test drives: a temporary car (status 'testdrive') waits in the showroom's bay and the player
//     is put behind the wheel. It goes back when the time is up (the driver is walked back to the
//     showroom door), when the driver gets out or is arrested, or when they log off. Body damage is
//     billed. A test-drive car can't be stored, sold, tuned, raced or earn the driving bonus, and
//     cars left over from a restart are removed at startup.

import { randomBytes } from 'node:crypto';
import { DEFAULT_MODS } from '../../../shared/customization';
import { ECONOMY } from '../../../shared/economy.config';
import { rotationSeed } from '../../../shared/rareMarket';
import {
  SHOWROOM_DOOR_RADIUS,
  SHOWROOM_IDS,
  blackMarketEpoch,
  blackMarketEpochEnd,
  blackMarketOfferId,
  blackMarketPrice,
  findShowroom,
  newOfferId,
  newShowroomCar,
  parseShowroomOffer,
  showroomPrice,
  type Showroom,
  type ShowroomId,
  type ShowroomInfo,
  type ShowroomOffer,
  type TestDriveEnd,
  type TestDriveView,
} from '../../../shared/showrooms';
import type { Vehicle } from '../../../shared/types';
import { mulberry32, pick, randRange } from '../../../shared/util';
import { CATALOG_MODELS, getModel, modelDisplayName } from '../../../shared/vehicles';
import { SERVICE_INTERACT_SLACK } from '../../../shared/world';
import * as repo from '../../db/repo';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { generateCondition } from '../generator';
import type { PoliceService } from './police';
import { acquireVehicle, assertCanOwnMore, assertCategoryUnlocked } from './sales';
import type { VehicleService } from './vehicles';

const log = createLogger('showroom');

const SECRET_KEY = 'showroom_secret';
const SOLD_KEY = 'showroom_bm_sold';
/** The test-drive bay must be this clear of other cars (m). */
const BAY_CLEAR = 4.5;

interface TestDrive {
  playerId: string;
  vehicleId: string;
  showroomId: ShowroomId;
  modelId: string;
  /** The car's price (damage is billed against it) and its body condition at the start. */
  price: number;
  startBody: number;
  endsAt: number;
}

export class ShowroomService {
  private secret = '';
  private epoch = -1;
  private blackMarket: ShowroomOffer[] = [];
  /** Black Market slot -> buyer name, for the current epoch. */
  private sold = new Map<number, string>();
  private restored: { epoch: number; sold: Record<string, string> } | null = null;
  private drives = new Map<string, TestDrive>();
  /** Player -> when they may start the next test drive. */
  private cooldown = new Map<string, number>();
  private ending = new Set<string>();
  /** Players whose test drive was interrupted by an arrest. */
  private arrested = new Set<string>();

  constructor(
    private readonly ctx: Ctx,
    private readonly vehicles: VehicleService,
    private readonly police: PoliceService,
  ) {}

  async init(): Promise<void> {
    const db = this.ctx.state.db;
    let secret = await repo.getWorldValue(db, SECRET_KEY);
    if (!secret) {
      secret = randomBytes(16).toString('hex');
      const uow = this.ctx.state.begin();
      uow.setWorldValue(SECRET_KEY, secret);
      await uow.commit();
    }
    this.secret = secret;
    const raw = await repo.getWorldValue(db, SOLD_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { epoch: number; sold: Record<string, string> };
        if (typeof parsed.epoch === 'number' && parsed.sold && typeof parsed.sold === 'object') this.restored = parsed;
      } catch {
        /* ignore */
      }
    }
    // Test-drive cars still out when the server stopped have gone back to their showrooms.
    const left = [...this.ctx.state.vehicles.values()].filter((v) => v.status === 'testdrive');
    if (left.length > 0) {
      const uow = this.ctx.state.begin();
      for (const v of left) uow.deleteVehicle(v.id);
      await uow.commit();
      log.info('returned leftover test-drive cars', { count: left.length });
    }
    this.ensure(Date.now());
  }

  // ---------------------------------------------------------------- stock

  /** Roll the Black Market over when its epoch changed. Returns true on a new rotation. */
  private ensure(now: number): boolean {
    const epoch = blackMarketEpoch(now);
    if (epoch === this.epoch) return false;
    this.epoch = epoch;
    this.blackMarket = this.generate(epoch);
    this.sold.clear();
    if (this.restored && this.restored.epoch === epoch) {
      for (const [slot, name] of Object.entries(this.restored.sold)) this.sold.set(Number(slot), String(name));
    }
    this.restored = null;
    return true;
  }

  private generate(epoch: number): ShowroomOffer[] {
    const cfg = ECONOMY.showrooms.blackMarket;
    const rng = mulberry32(rotationSeed(`${this.secret}:bm`, epoch));
    const pool = CATALOG_MODELS.filter((m) => m.specs.kind !== 'bike');
    const offers: ShowroomOffer[] = [];
    const taken = new Set<string>();
    for (let slot = 0; slot < cfg.slots; slot++) {
      let model = pick(rng, pool);
      for (let k = 0; k < 6 && taken.has(model.id); k++) model = pick(rng, pool);
      taken.add(model.id);
      const car: Vehicle = {
        ...newShowroomCar(model.id, pick(rng, model.colors), `bm_${epoch}_${slot}`),
        mileage: Math.round(randRange(rng, cfg.mileage[0], cfg.mileage[1])),
        fuel: Math.round(randRange(rng, 15, 55)),
        condition: generateCondition(rng, randRange(rng, cfg.quality[0], cfg.quality[1])),
        mods: { ...DEFAULT_MODS, hot: true },
        createdAt: epoch * cfg.rotationSec * 1000,
      };
      const price = blackMarketPrice(car, randRange(rng, cfg.priceRange[0], cfg.priceRange[1]), this.ctx.state.trends);
      offers.push({ id: blackMarketOfferId(epoch, slot), modelId: model.id, price, vehicle: car, hot: true, soldTo: null });
    }
    return offers;
  }

  private offersOf(s: Showroom): ShowroomOffer[] {
    if (s.id === 'blackmarket') {
      this.ensure(Date.now());
      return this.blackMarket.map((o, slot) => ({ ...o, soldTo: this.sold.get(slot) ?? null }));
    }
    const trends = this.ctx.state.trends;
    return s.models.map((modelId) => ({
      id: newOfferId(modelId),
      modelId,
      price: showroomPrice(modelId, trends),
      vehicle: newShowroomCar(modelId, getModel(modelId).colors[0]!),
      hot: false,
      soldTo: null,
    }));
  }

  infoFor(s: Showroom): ShowroomInfo {
    const now = Date.now();
    return {
      showroomId: s.id,
      offers: this.offersOf(s),
      restockAt: s.id === 'blackmarket' ? blackMarketEpochEnd(this.epoch) : null,
      serverTime: now,
    };
  }

  info(_playerId: string, params: unknown): ShowroomInfo {
    return this.infoFor(this.showroomParam(params));
  }

  private showroomParam(params: unknown): Showroom {
    const p = val.obj(params);
    return findShowroom(val.oneOf(p.showroomId, 'showroom', SHOWROOM_IDS))!;
  }

  /** The offer an id names in a showroom (and the car it is), or an error. */
  private offer(s: Showroom, offerId: string): { offer: ShowroomOffer; slot: number | null } {
    const parsed = parseShowroomOffer(offerId);
    if (!parsed) throw new GameError('bad_request', 'Invalid offer.');
    if (parsed.kind === 'new') {
      if (!s.models.includes(parsed.modelId)) throw new GameError('not_found', `${s.name} doesn't sell that car.`);
      const offer = this.offersOf(s).find((o) => o.modelId === parsed.modelId)!;
      return { offer, slot: null };
    }
    if (s.id !== 'blackmarket') throw new GameError('not_found', 'Offer not found.');
    this.ensure(Date.now());
    if (parsed.epoch !== this.epoch) throw new GameError('conflict', 'That car is gone: the Black Market has new stock.');
    const offer = this.blackMarket[parsed.slot];
    if (!offer) throw new GameError('not_found', 'Offer not found.');
    if (this.sold.has(parsed.slot)) throw new GameError('conflict', 'Someone else just bought that one.');
    return { offer, slot: parsed.slot };
  }

  private requireAtDoor(playerId: string, s: Showroom): void {
    if (!this.ctx.sim.isNear(playerId, s.door, SHOWROOM_DOOR_RADIUS + SERVICE_INTERACT_SLACK)) {
      throw new GameError('too_far', `You need to be at ${s.name} (Galeri Bulvarı, across the bridges).`);
    }
  }

  /** A factory colour for a new car (the first one unless the buyer picked another). */
  private colorFor(modelId: string, raw: unknown): string {
    const colors = getModel(modelId).colors;
    if (raw === undefined || raw === null) return colors[0]!;
    return val.oneOf(raw, 'color', colors);
  }

  // ---------------------------------------------------------------- buying

  async buy(playerId: string, params: unknown): Promise<{ vehicle: Vehicle; price: number }> {
    const s = this.showroomParam(params);
    const p = val.obj(params);
    const offerId = val.str(p.offerId, 'offer', 60);
    const expected = val.int(p.expectedPrice, 'price', 0, ECONOMY.limits.maxPrice);
    return this.ctx.locks.run([K.player(playerId), `showroom:${offerId}`], async () => {
      this.requireAtDoor(playerId, s);
      const { offer, slot } = this.offer(s, offerId);
      if (offer.price !== expected) throw new GameError('conflict', `The price is $${offer.price.toLocaleString('en-US')}. Please review and try again.`);
      const uow = this.ctx.state.begin();
      const buyer = uow.player(playerId);
      assertCategoryUnlocked(buyer, offer.modelId);
      assertCanOwnMore(this.ctx, buyer);
      const veh: Vehicle = slot === null ? newShowroomCar(offer.modelId, this.colorFor(offer.modelId, p.color)) : structuredClone(offer.vehicle);
      veh.id = newId('veh');
      veh.createdAt = uow.now;
      uow.createVehicle(veh);
      acquireVehicle(uow, buyer, veh, offer.price, 'showroom', null, ECONOMY.xp.marketBuy);
      let sold: Map<number, string> | null = null;
      if (slot !== null) {
        sold = new Map(this.sold).set(slot, buyer.name);
        uow.setWorldValue(SOLD_KEY, JSON.stringify({ epoch: this.epoch, sold: Object.fromEntries(sold) }));
      }
      uow.notify(playerId, {
        kind: 'success',
        title: `${modelDisplayName(veh.modelId)} senin!`,
        text: slot === null ? `Bought new at ${s.name}: it is waiting in your garage.` : 'Kara borsadan aldın: çalıntı kaydı var, plaka okuma kameralarına dikkat. It is in your garage.',
      });
      uow.checkAchievements(buyer);
      await uow.commit();
      if (sold) {
        this.sold = sold;
        this.ctx.hub.broadcast('showroom.update', this.infoFor(s));
      }
      this.ctx.sim.markInteract(playerId);
      log.info('showroom purchase', { playerId, showroom: s.id, model: veh.modelId, price: offer.price });
      if (getModel(veh.modelId).tier === 'legendary') this.ctx.hub.systemChat(`${buyer.name} just drove a brand-new ${modelDisplayName(veh.modelId)} out of the ${s.name}!`);
      return { vehicle: this.ctx.state.vehicles.get(veh.id)!, price: offer.price };
    });
  }

  // ---------------------------------------------------------------- test drives

  view(playerId: string): TestDriveView | null {
    const d = this.drives.get(playerId);
    return d ? { vehicleId: d.vehicleId, showroomId: d.showroomId, modelId: d.modelId, endsAt: d.endsAt, serverTime: Date.now() } : null;
  }

  isTestCar(vehicleId: string): boolean {
    return this.ctx.state.vehicles.get(vehicleId)?.status === 'testdrive';
  }

  async testDrive(playerId: string, params: unknown): Promise<TestDriveView> {
    const s = this.showroomParam(params);
    const p = val.obj(params);
    const offerId = val.str(p.offerId, 'offer', 60);
    const cfg = ECONOMY.showrooms;
    // The bay lock keeps two players from being handed cars in the same spot.
    return this.ctx.locks.run([K.player(playerId), `showroom-bay:${s.id}`], async () => {
      if (this.drives.has(playerId)) throw new GameError('conflict', 'You are already on a test drive.');
      const now = Date.now();
      const wait = (this.cooldown.get(playerId) ?? 0) - now;
      if (wait > 0) throw new GameError('conflict', `The next test drive is ready in ${Math.ceil(wait / 1000)} s.`);
      this.requireAtDoor(playerId, s);
      const c = this.ctx.sim.chars.get(playerId);
      if (!c) throw new GameError('conflict', 'You are not in the world.');
      if (c.drivingId || c.ridingId) throw new GameError('conflict', 'Get out of your car first.');
      if (this.police.starsOf(playerId) > 0) throw new GameError('forbidden', 'Aranırken test sürüşü yok: lose the police first.');
      const { offer, slot } = this.offer(s, offerId);
      const bay = s.testDrive;
      for (const v of this.ctx.state.vehicles.values()) {
        if (v.status !== 'world' && v.status !== 'stolen' && v.status !== 'testdrive' && v.status !== 'displayed') continue;
        const at = this.ctx.sim.drives.get(v.id)?.dyn ?? v;
        if (Math.hypot(at.x - bay.x, at.z - bay.z) < BAY_CLEAR) throw new GameError('conflict', 'The test-drive bay is taken. Try again in a moment.');
      }
      // The Black Market lends the very car on offer; the others a new one in the chosen colour.
      const base = slot !== null ? structuredClone(offer.vehicle) : newShowroomCar(offer.modelId, this.colorFor(offer.modelId, p.color));
      const { hot: _hot, ...mods } = base.mods;
      const vehicle: Vehicle = { ...base, id: newId('veh'), ownerId: playerId, fuel: 100, mods, status: 'testdrive', purchasePrice: 0, x: bay.x, z: bay.z, rotation: bay.rot, createdAt: now };
      const uow = this.ctx.state.begin();
      uow.createVehicle(vehicle);
      await uow.commit();
      const live = this.ctx.state.vehicles.get(vehicle.id)!;
      this.ctx.sim.setParkedDeck(live.id, 0);
      this.ctx.sim.startDriving(playerId, live);
      this.ctx.hub.broadcast('vehicle.upsert', this.ctx.state.toPublicVehicle(live));
      this.ctx.sim.rebuildDynamic();
      const drive: TestDrive = { playerId, vehicleId: live.id, showroomId: s.id, modelId: offer.modelId, price: offer.price, startBody: live.condition.body, endsAt: now + cfg.testDriveSec * 1000 };
      this.drives.set(playerId, drive);
      const view = this.view(playerId)!;
      this.ctx.hub.sendTo(playerId, 'testdrive.update', view);
      log.info('test drive', { playerId, showroom: s.id, model: offer.modelId });
      return view;
    });
  }

  /** Hand the car back early (from the HUD). */
  async endTestDrive(playerId: string): Promise<{ ok: true }> {
    if (!this.drives.has(playerId)) throw new GameError('conflict', 'You are not on a test drive.');
    await this.end(playerId, 'cancel');
    return { ok: true };
  }

  /** Once a second: restock the Black Market, end drives that are over. */
  async tick(now = Date.now()): Promise<void> {
    if (this.ensure(now)) this.ctx.hub.broadcast('showroom.update', this.infoFor(findShowroom('blackmarket')!));
    for (const d of [...this.drives.values()]) {
      const live = this.ctx.state.vehicles.get(d.vehicleId);
      const c = this.ctx.sim.chars.get(d.playerId);
      // An arrest plays out first (the police hand the driver over afterwards).
      if (c && this.police.wantedOf(d.playerId)?.busted) {
        this.arrested.add(d.playerId);
        continue;
      }
      if (!live || !c) await this.end(d.playerId, 'lost');
      else if (c.drivingId !== d.vehicleId) await this.end(d.playerId, this.arrested.has(d.playerId) ? 'busted' : 'exit');
      else if (now >= d.endsAt) await this.end(d.playerId, 'time');
    }
    for (const id of [...this.arrested]) if (!this.drives.has(id)) this.arrested.delete(id);
  }

  /** The player logged off: the car goes back. */
  async forget(playerId: string): Promise<void> {
    if (this.drives.has(playerId)) await this.end(playerId, 'lost');
    this.cooldown.delete(playerId);
  }

  private async end(playerId: string, reason: TestDriveEnd): Promise<void> {
    const d = this.drives.get(playerId);
    if (!d || this.ending.has(playerId)) return;
    this.ending.add(playerId);
    try {
      await this.ctx.locks.run([K.player(playerId), K.vehicle(d.vehicleId)], async () => {
        if (this.drives.get(playerId) !== d) return;
        const s = findShowroom(d.showroomId)!;
        const c = this.ctx.sim.chars.get(playerId);
        if (c?.drivingId === d.vehicleId) {
          await this.vehicles.flushDrive(d.vehicleId, true);
          this.ctx.sim.stopDriving(playerId);
          // Time's up: the car is driven back and so are you.
          if (reason === 'time' || reason === 'cancel') this.ctx.sim.teleport(playerId, s.door.x, s.door.z + (s.side === 'north' ? 1.5 : -1.5));
        }
        for (const [pid, ch] of this.ctx.sim.chars) if (ch.ridingId === d.vehicleId) this.ctx.sim.stopRiding(pid);
        const live = this.ctx.state.vehicles.get(d.vehicleId);
        const uow = this.ctx.state.begin();
        let fee = 0;
        if (live) {
          const lost = Math.max(0, d.startBody - live.condition.body);
          const bill = Math.min(Math.round(d.price * ECONOMY.showrooms.damageMax), Math.round(d.price * ECONOMY.showrooms.damagePerPoint * lost));
          uow.deleteVehicle(d.vehicleId);
          if (bill > 0 && this.ctx.state.players.has(playerId)) {
            const player = uow.player(playerId);
            fee = Math.min(bill, Math.max(0, player.money));
            if (fee > 0) uow.debit(player, fee, 'testdrive', `Test drive damage: ${modelDisplayName(d.modelId)}`);
          }
        }
        await uow.commit();
        this.drives.delete(playerId);
        this.cooldown.set(playerId, Date.now() + ECONOMY.showrooms.testDriveCooldownSec * 1000);
        this.ctx.sim.rebuildDynamic();
        this.ctx.hub.sendTo(playerId, 'testdrive.update', null);
        this.ctx.hub.sendTo(playerId, 'testdrive.end', { reason, modelId: d.modelId, fee });
        log.info('test drive over', { playerId, model: d.modelId, reason, fee });
      });
    } catch (err) {
      log.error('ending a test drive failed', { playerId, error: (err as Error).message });
    } finally {
      this.ending.delete(playerId);
    }
  }
}

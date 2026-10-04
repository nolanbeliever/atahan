// Rare Dealer: a stock of special vehicles that rotates every 120 seconds (see shared/rareMarket.ts).
// Offers are generated from (server secret, epoch), so a restart or a page reload shows the same
// stock and countdown; sold offers are saved with the purchase so they stay sold.

import { randomBytes } from 'node:crypto';
import { DEFAULT_MODS } from '../../../shared/customization';
import { ECONOMY } from '../../../shared/economy.config';
import { PERF_SLOTS, emptyTuning, findPart, type PerfSlot, type VehicleTuning } from '../../../shared/modificationsData';
import {
  RARE_ROTATION_MS,
  offerId,
  parseOfferId,
  rareEpoch,
  rareEpochEnd,
  rollModel,
  rollTier,
  rotationSeed,
  type RareMarketState,
  type RareOffer,
} from '../../../shared/rareMarket';
import { dropInvalidParts } from '../../../shared/tuningSystem';
import type { Vehicle } from '../../../shared/types';
import { mulberry32, pick, randRange, type Rng } from '../../../shared/util';
import { marketValue } from '../../../shared/valuation';
import { modelDisplayName, type VehicleModel } from '../../../shared/vehicles';
import * as repo from '../../db/repo';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as v from '../../validate';
import { K, type Ctx } from '../context';
import { generateCondition } from '../generator';
import { acquireVehicle, assertCanOwnMore, assertCategoryUnlocked } from './sales';

const log = createLogger('rare');

const SECRET_KEY = 'rare_secret';
const SOLD_KEY = 'rare_sold';

/** Performance packages a non-legendary offer may come with. */
const PACKAGES: string[][] = [
  ['ecu_stage1', 'intake_cai', 'exh_catback', 'susp_sport'],
  ['ecu_stage1', 'tire_semislick', 'susp_coilover', 'brake_bbk'],
  ['exh_downpipe', 'ecu_stage2', 'intake_cai', 'ic_fmic', 'tire_semislick'],
];

function randomPackage(rng: Rng, model: VehicleModel): VehicleTuning {
  const tuning = emptyTuning();
  for (const id of pick(rng, PACKAGES)) {
    const part = findPart(id);
    if (part && PERF_SLOTS.includes(part.slot as PerfSlot)) tuning.perf[part.slot as PerfSlot] = id;
  }
  const clean = dropInvalidParts(model, tuning);
  clean.drop = findPart(clean.perf.suspension)?.suspension?.defaultDrop ?? 0;
  return clean;
}

export class RareMarketService {
  private secret = '';
  private epoch = -1;
  private offers: RareOffer[] = [];
  /** slot -> buyer name, for the current epoch. */
  private sold = new Map<number, string>();
  private restored: { epoch: number; sold: Record<string, string> } | null = null;

  constructor(private readonly ctx: Ctx) {}

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
    this.ensure(Date.now());
  }

  /** Roll the stock over when the epoch changed. Returns true on a new rotation. */
  private ensure(now: number): boolean {
    const epoch = rareEpoch(now);
    if (epoch === this.epoch) return false;
    this.epoch = epoch;
    this.offers = this.generate(epoch);
    this.sold.clear();
    if (this.restored && this.restored.epoch === epoch) {
      for (const [slot, name] of Object.entries(this.restored.sold)) this.sold.set(Number(slot), String(name));
    }
    this.restored = null;
    return true;
  }

  private generate(epoch: number): RareOffer[] {
    const cfg = ECONOMY.rareMarket;
    const rng = mulberry32(rotationSeed(this.secret, epoch));
    const taken = new Set<string>();
    const offers: RareOffer[] = [];
    for (let slot = 0; slot < cfg.slots; slot++) {
      const model = rollModel(rng, rollTier(rng), taken);
      const tier = model.tier;
      taken.add(model.id);
      const [qmin, qmax] = cfg.quality[tier];
      const condition = generateCondition(rng, randRange(rng, qmin, qmax));
      if (tier === 'legendary') for (const k of Object.keys(condition) as (keyof typeof condition)[]) condition[k] = Math.max(90, condition[k]);
      const [mmin, mmax] = cfg.mileage[tier];
      const mods = { ...DEFAULT_MODS };
      if (tier !== 'legendary' && rng() < cfg.tunedChance) mods.tuning = randomPackage(rng, model);
      const vehicle: Vehicle = {
        id: `rare_${epoch}_${slot}`,
        modelId: model.id,
        ownerId: null,
        color: pick(rng, model.colors),
        mileage: Math.round(randRange(rng, mmin, mmax)),
        fuel: Math.round(randRange(rng, 60, 100)),
        condition,
        mods,
        status: 'market',
        purchasePrice: 0,
        salePrice: null,
        plotId: null,
        slot: null,
        rotation: 0,
        x: 0,
        z: 0,
        serviceUntil: 0,
        createdAt: epoch * RARE_ROTATION_MS,
      };
      // Priced above what the wholesaler or an auction would pay, whatever the demand trends.
      const value = Math.max(marketValue(vehicle), marketValue(vehicle, this.ctx.state.trends));
      const [pmin, pmax] = cfg.priceRange[tier];
      const price = Math.max(ECONOMY.limits.minPrice, Math.round((value * randRange(rng, pmin, pmax)) / 100) * 100);
      offers.push({ id: offerId(epoch, slot), epoch, slot, tier, vehicle, price, soldTo: null });
    }
    return offers;
  }

  state(): RareMarketState {
    const now = Date.now();
    this.ensure(now);
    return {
      epoch: this.epoch,
      endsAt: rareEpochEnd(this.epoch),
      serverTime: now,
      rotationSec: ECONOMY.rareMarket.rotationSec,
      offers: this.offers.map((o) => ({ ...o, soldTo: this.sold.get(o.slot) ?? null })),
    };
  }

  list(): RareMarketState {
    return this.state();
  }

  /** Called every second: broadcast the new stock when the rotation flips. */
  tick(): void {
    if (this.ensure(Date.now())) this.ctx.hub.broadcast('rare.update', this.state());
  }

  async buy(playerId: string, params: unknown) {
    const p = v.obj(params);
    const id = v.str(p.offerId, 'offer', 32);
    const expected = v.int(p.expectedPrice, 'price', 0, ECONOMY.limits.maxPrice);
    const parsed = parseOfferId(id);
    if (!parsed) throw new GameError('bad_request', 'Invalid offer.');
    return this.ctx.locks.run([K.player(playerId), `rare:${id}`], async () => {
      this.ensure(Date.now());
      if (parsed.epoch !== this.epoch) throw new GameError('conflict', 'That offer has expired: the Rare Dealer has restocked.');
      const offer = this.offers[parsed.slot];
      if (!offer) throw new GameError('not_found', 'Offer not found.');
      if (this.sold.has(offer.slot)) throw new GameError('conflict', 'Someone else just bought that one.');
      if (offer.price !== expected) throw new GameError('conflict', `The price is $${offer.price.toLocaleString('en-US')}. Please review and try again.`);
      const uow = this.ctx.state.begin();
      const buyer = uow.player(playerId);
      assertCategoryUnlocked(buyer, offer.vehicle.modelId);
      assertCanOwnMore(this.ctx, buyer);
      const veh: Vehicle = structuredClone(offer.vehicle);
      veh.id = newId('veh');
      veh.createdAt = uow.now;
      uow.createVehicle(veh);
      acquireVehicle(uow, buyer, veh, offer.price, 'rare_buy', null, ECONOMY.xp.marketBuy);
      const sold = new Map(this.sold).set(offer.slot, buyer.name);
      uow.setWorldValue(SOLD_KEY, JSON.stringify({ epoch: this.epoch, sold: Object.fromEntries(sold) }));
      uow.checkAchievements(buyer);
      await uow.commit();
      this.sold = sold;
      this.ctx.sim.markInteract(playerId);
      log.info('rare purchase', { playerId, model: veh.modelId, tier: offer.tier, price: offer.price });
      this.ctx.hub.broadcast('rare.update', this.state());
      if (offer.tier === 'legendary') this.ctx.hub.systemChat(`${buyer.name} just bought a legendary ${modelDisplayName(veh.modelId)} from the Rare Dealer!`);
      return { vehicle: this.ctx.state.vehicles.get(veh.id)!, price: offer.price };
    });
  }
}

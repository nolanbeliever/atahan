// NPC customers: they walk to player dealerships, browse the displayed vehicles
// and buy (or make an offer) depending on their archetype, budget and the
// vehicle's value. Remote buyers also occasionally purchase classifieds.

import { ECONOMY, dealershipLevel, type CustomerArchetypeConfig } from '../../../shared/economy.config';
import { Anim, type CustomerOffer, type Vehicle } from '../../../shared/types';
import { averageCondition, marketValue } from '../../../shared/valuation';
import { angleDiff, randRange, weightedPick } from '../../../shared/util';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { findPlot, plotEntrance, plotSidewalk, type Plot } from '../../../shared/world';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { randomPersonName } from '../generator';
import type { NpcEntity } from '../simulation';
import { settleSale } from './sales';

const log = createLogger('customers');

type CustomerState = 'arriving' | 'browsing' | 'waiting' | 'leaving';

interface Customer {
  npc: NpcEntity;
  name: string;
  plotId: string;
  archetype: CustomerArchetypeConfig;
  budget: number;
  willingness: number;
  targetVehicleId: string | null;
  path: { x: number; z: number }[];
  state: CustomerState;
  timer: number;
  offerId: string | null;
  interested: boolean;
}

interface OpenOffer {
  offer: CustomerOffer;
  customerId: string;
  ownerId: string;
  askingPrice: number;
}

function roundPrice(v: number): number {
  return v >= 10_000 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10;
}

export class CustomerService {
  private customers = new Map<string, Customer>();
  private nextVisit = new Map<string, number>();
  private offers = new Map<string, OpenOffer>();
  private lastClassifieds = Date.now();

  constructor(private readonly ctx: Ctx) {}

  get count(): number {
    return this.customers.size;
  }

  private forSale(plotId: string): Vehicle[] {
    const out: Vehicle[] = [];
    for (const v of this.ctx.state.vehicles.values()) {
      if (v.plotId === plotId && v.status === 'displayed' && v.salePrice !== null && v.serviceUntil <= Date.now()) out.push(v);
    }
    return out;
  }

  private repFactor(ownerId: string): number {
    const rep = this.ctx.state.players.get(ownerId)?.reputation ?? 50;
    return 1 + ((rep - 50) / 100) * ECONOMY.customers.repRateScale;
  }

  private visitInterval(plotId: string, ownerId: string): number {
    const c = ECONOMY.customers;
    const d = this.ctx.state.dealerships.get(plotId);
    const rate = dealershipLevel(d?.level ?? 1).customerRate * this.repFactor(ownerId) * (this.ctx.hub.isOnline(ownerId) ? 1 : c.offlineRateMultiplier);
    const jitter = 1 + (this.ctx.rng() * 2 - 1) * c.intervalJitter;
    return (c.baseIntervalSec * 1000 * jitter) / Math.max(0.1, rate);
  }

  // ------------------------------------------------------------ 1 Hz logic

  async tick(): Promise<void> {
    const now = Date.now();
    // Spawn
    for (const d of this.ctx.state.dealerships.values()) {
      const inventory = this.forSale(d.plotId);
      if (inventory.length === 0) {
        this.nextVisit.delete(d.plotId);
        continue;
      }
      const due = this.nextVisit.get(d.plotId);
      if (due === undefined) {
        this.nextVisit.set(d.plotId, now + this.visitInterval(d.plotId, d.ownerId) * 0.5);
        continue;
      }
      if (due > now || this.customers.size >= ECONOMY.customers.maxGlobal) continue;
      this.nextVisit.set(d.plotId, now + this.visitInterval(d.plotId, d.ownerId));
      this.spawn(d.plotId, inventory);
    }
    // State transitions
    for (const c of [...this.customers.values()]) {
      if (c.state === 'browsing' && now >= c.timer) await this.decide(c).catch((err) => this.fail(c, err));
      else if (c.state === 'waiting' && now >= c.timer) this.expireOffer(c);
    }
    // Remote classifieds buyers
    if (now - this.lastClassifieds >= ECONOMY.customers.classifiedsIntervalSec * 1000) {
      this.lastClassifieds = now;
      await this.classifiedsBuyers().catch((err) => log.error('classifieds buyers failed', { error: (err as Error).message }));
    }
  }

  private fail(c: Customer, err: unknown): void {
    log.warn('customer decision failed', { error: (err as Error).message });
    this.leave(c);
  }

  private spawn(plotId: string, inventory: Vehicle[]): void {
    const plot = findPlot(plotId)!;
    const rng = this.ctx.rng;
    const archetype = weightedPick(rng, ECONOMY.customers.archetypes, (a) => a.weight);
    const budget = Math.round(randRange(rng, archetype.budget[0], archetype.budget[1]));
    // Prefer vehicles matching the archetype.
    const matches = inventory.filter((v) => archetype.categories.includes(getModel(v.modelId).category));
    const pool = matches.length > 0 && rng() < 0.85 ? matches : inventory;
    const target = weightedPick(rng, pool, (v) => (v.salePrice! <= budget * 1.1 ? 3 : 1));
    const side = rng() < 0.5 ? -1 : 1;
    const start = plotSidewalk(plot, side * 26);
    const walkTo = this.besideVehicle(plot, target);
    const npc: NpcEntity = { id: newId('npc'), x: start.x, z: start.z, rot: 0, anim: Anim.Walk, style: Math.floor(rng() * 1000) };
    const customer: Customer = {
      npc,
      name: randomPersonName(rng),
      plotId,
      archetype,
      budget,
      willingness: randRange(rng, archetype.willingness[0], archetype.willingness[1]),
      targetVehicleId: target.id,
      path: [plotSidewalk(plot, side * 2), plotEntrance(plot), walkTo],
      state: 'arriving',
      timer: 0,
      offerId: null,
      interested: matches.includes(target),
    };
    this.customers.set(npc.id, customer);
    this.ctx.sim.npcs.set(npc.id, npc);
  }

  private besideVehicle(plot: Plot, v: Vehicle): { x: number; z: number } {
    const m = getModel(v.modelId);
    const off = m.shape.width / 2 + 1.1;
    return { x: v.x + Math.cos(plot.rot) * off, z: v.z - Math.sin(plot.rot) * off };
  }

  // ------------------------------------------------------------ movement (sim tick rate)

  tickMovement(dt: number): void {
    const speed = ECONOMY.customers.walkSpeed;
    for (const c of this.customers.values()) {
      const npc = c.npc;
      if (c.state !== 'arriving' && c.state !== 'leaving') {
        // Face the target vehicle while browsing.
        const v = c.targetVehicleId ? this.ctx.state.vehicles.get(c.targetVehicleId) : undefined;
        if (v) npc.rot += angleDiff(npc.rot, Math.atan2(v.x - npc.x, v.z - npc.z)) * Math.min(1, dt * 5);
        continue;
      }
      const wp = c.path[0];
      if (!wp) {
        if (c.state === 'arriving') {
          c.state = 'browsing';
          npc.anim = Anim.Interact;
          const [b0, b1] = ECONOMY.customers.browseSeconds;
          c.timer = Date.now() + randRange(this.ctx.rng, b0, b1) * 1000;
        } else {
          this.customers.delete(npc.id);
          this.ctx.sim.npcs.delete(npc.id);
        }
        continue;
      }
      const dx = wp.x - npc.x;
      const dz = wp.z - npc.z;
      const dist = Math.hypot(dx, dz);
      const step = speed * dt;
      npc.anim = Anim.Walk;
      if (dist <= step) {
        npc.x = wp.x;
        npc.z = wp.z;
        c.path.shift();
      } else {
        npc.x += (dx / dist) * step;
        npc.z += (dz / dist) * step;
      }
      npc.rot += angleDiff(npc.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
    }
  }

  private leave(c: Customer): void {
    const plot = findPlot(c.plotId);
    c.state = 'leaving';
    c.npc.anim = Anim.Walk;
    c.targetVehicleId = null;
    if (!plot) {
      c.path = [];
      return;
    }
    const side = this.ctx.rng() < 0.5 ? -1 : 1;
    c.path = [plotEntrance(plot), plotSidewalk(plot, side * 2), plotSidewalk(plot, side * 28)];
  }

  // ------------------------------------------------------------ decisions

  private maxPay(c: Customer, v: Vehicle, ownerId: string): number {
    const d = this.ctx.state.dealerships.get(c.plotId);
    const premium = dealershipLevel(d?.level ?? 1).premium;
    const rep = this.ctx.state.players.get(ownerId)?.reputation ?? 50;
    const repAdj = ((rep - 50) / 50) * ECONOMY.customers.repWillingnessScale;
    const value = marketValue(v, this.ctx.state.trends);
    const interestAdj = c.interested ? 1 : 0.92;
    return Math.min(c.budget, Math.round(value * c.willingness * (1 + premium + repAdj) * interestAdj));
  }

  private async decide(c: Customer): Promise<void> {
    const v = c.targetVehicleId ? this.ctx.state.vehicles.get(c.targetVehicleId) : undefined;
    if (!v || v.status !== 'displayed' || v.plotId !== c.plotId || v.salePrice === null || !v.ownerId) return this.leave(c);
    const a = c.archetype;
    if (averageCondition(v.condition) < a.minCondition || v.mileage > a.maxMileage) return this.leave(c);
    const maxPay = this.maxPay(c, v, v.ownerId);
    const price = v.salePrice;
    if (price <= maxPay) {
      await this.sell(c, v.id, price);
      return this.leave(c);
    }
    if (price <= maxPay * 1.15 && this.ctx.rng() < a.negotiateChance && this.ctx.hub.isOnline(v.ownerId)) {
      const amount = roundPrice(maxPay * randRange(this.ctx.rng, 0.96, 1.0));
      if (amount < ECONOMY.limits.minPrice) return this.leave(c);
      const offer: CustomerOffer = {
        id: newId('off'),
        vehicleId: v.id,
        customerName: c.name,
        amount,
        askingPrice: price,
        expiresAt: Date.now() + ECONOMY.customers.offerTimeoutSec * 1000,
        message: `Hi! I'm ${c.name} (${a.label}). I love the ${modelDisplayName(v.modelId)}, but would you take $${amount.toLocaleString('en-US')}?`,
      };
      this.offers.set(offer.id, { offer, customerId: c.npc.id, ownerId: v.ownerId, askingPrice: price });
      c.offerId = offer.id;
      c.state = 'waiting';
      c.timer = offer.expiresAt;
      this.ctx.hub.sendTo(v.ownerId, 'offer', offer);
      return;
    }
    this.leave(c);
  }

  private expireOffer(c: Customer): void {
    if (c.offerId) {
      const o = this.offers.get(c.offerId);
      this.offers.delete(c.offerId);
      if (o) this.ctx.hub.sendTo(o.ownerId, 'offer.closed', c.offerId);
    }
    c.offerId = null;
    this.leave(c);
  }

  /** Execute a sale to a customer. */
  private async sell(c: Customer, vehicleId: string, price: number, agreedWithOwner = false): Promise<boolean> {
    const v0 = this.ctx.state.vehicles.get(vehicleId);
    if (!v0?.ownerId) return false;
    const ownerId = v0.ownerId;
    return this.ctx.locks.run([K.player(ownerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const veh = uow.vehicle(vehicleId);
      if (veh.status !== 'displayed' || veh.ownerId !== ownerId || veh.salePrice === null) return false;
      if (!agreedWithOwner && veh.salePrice !== price) return false;
      if (this.ctx.sim.isDriven(vehicleId)) return false;
      const owner = uow.player(ownerId);
      const sale = settleSale(this.ctx, uow, owner, veh, price, {
        feeRate: ECONOMY.fees.saleFeeRate,
        kind: 'customer_sale',
        buyerId: null,
        buyerName: c.name,
        customer: true,
      });
      uow.deleteVehicle(veh.id);
      uow.notify(
        ownerId,
        {
          kind: 'money',
          title: 'Customer purchase!',
          text: `${c.name} bought your ${modelDisplayName(veh.modelId)} for $${price.toLocaleString('en-US')}. Profit: $${sale.profit.toLocaleString('en-US')}.`,
        },
        true,
        (id) => this.ctx.hub.isOnline(id),
      );
      uow.checkAchievements(owner);
      await uow.commit();
      this.ctx.sim.rebuildDynamic();
      log.info('customer sale', { ownerId, vehicleId, price, customer: c.archetype.id });
      return true;
    });
  }

  /** Owner accepts or declines a customer offer. */
  async respond(playerId: string, params: unknown): Promise<{ sold: boolean }> {
    const p = val.obj(params);
    const offerId = val.id(p.offerId, 'offer');
    const accept = val.bool(p.accept, 'accept');
    const o = this.offers.get(offerId);
    if (!o || o.ownerId !== playerId) throw new GameError('not_found', 'That offer has expired.');
    this.offers.delete(offerId);
    const c = this.customers.get(o.customerId);
    if (!accept || !c) {
      if (c) {
        c.offerId = null;
        this.leave(c);
      }
      return { sold: false };
    }
    if (o.offer.expiresAt < Date.now()) throw new GameError('conflict', 'That offer has expired.');
    const v = this.ctx.state.vehicles.get(o.offer.vehicleId);
    if (!v || v.salePrice !== o.askingPrice) {
      this.leave(c);
      throw new GameError('conflict', 'The vehicle or its price changed; the customer left.');
    }
    const sold = await this.sell(c, o.offer.vehicleId, o.offer.amount, true);
    c.offerId = null;
    this.leave(c);
    return { sold };
  }

  // ------------------------------------------------------------ classifieds

  private async classifiedsBuyers(): Promise<void> {
    const cfg = ECONOMY.customers;
    const rng = this.ctx.rng;
    const listed = [...this.ctx.state.vehicles.values()].filter((v) => v.status === 'listed' && v.salePrice !== null && v.ownerId);
    for (const v of listed) {
      if (rng() > cfg.classifiedsBuyChance * this.repFactor(v.ownerId!)) continue;
      const cat = getModel(v.modelId).category;
      const candidates = cfg.archetypes.filter((a) => a.categories.includes(cat));
      const archetype = weightedPick(rng, candidates.length ? candidates : cfg.archetypes, (a) => a.weight);
      const budget = randRange(rng, archetype.budget[0], archetype.budget[1]) * 1.2;
      if (averageCondition(v.condition) < archetype.minCondition * 0.8) continue;
      const rep = this.ctx.state.players.get(v.ownerId!)?.reputation ?? 50;
      const repAdj = ((rep - 50) / 50) * cfg.repWillingnessScale;
      const maxPay = Math.min(budget, marketValue(v, this.ctx.state.trends) * randRange(rng, archetype.willingness[0], archetype.willingness[1]) * 0.97 * (1 + repAdj));
      if (v.salePrice! > maxPay) continue;
      const ownerId = v.ownerId!;
      const price = v.salePrice!;
      const buyerName = randomPersonName(rng);
      await this.ctx.locks.run([K.player(ownerId), K.vehicle(v.id)], async () => {
        const uow = this.ctx.state.begin();
        const veh = uow.vehicle(v.id);
        if (veh.status !== 'listed' || veh.ownerId !== ownerId || veh.salePrice !== price) return;
        const owner = uow.player(ownerId);
        const sale = settleSale(this.ctx, uow, owner, veh, price, {
          feeRate: ECONOMY.fees.saleFeeRate,
          kind: 'customer_sale',
          buyerId: null,
          buyerName,
          customer: true,
        });
        uow.deleteVehicle(veh.id);
        uow.notify(
          ownerId,
          { kind: 'money', title: 'Classifieds sale!', text: `${buyerName} bought your ${modelDisplayName(veh.modelId)} online for $${price.toLocaleString('en-US')}. Profit: $${sale.profit.toLocaleString('en-US')}.` },
          true,
          (id) => this.ctx.hub.isOnline(id),
        );
        uow.checkAchievements(owner);
        await uow.commit();
        log.info('classifieds sale', { ownerId, vehicleId: v.id, price });
      });
    }
  }
}

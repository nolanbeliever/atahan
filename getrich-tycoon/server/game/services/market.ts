// Used Vehicle Market (NPC sellers + negotiation) and player-to-player purchases.

import { ECONOMY } from '../../../shared/economy.config';
import { applyOffer, createSellerSession, toNegotiationState, type SellerSession } from '../../../shared/negotiation';
import type { MarketListing, NegotiationState, PlayerListing, Vehicle } from '../../../shared/types';
import { marketValue } from '../../../shared/valuation';
import { randRange, weightedPick } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import { MARKET_LOT_SLOTS } from '../../../shared/world';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as v from '../../validate';
import { K, type Ctx } from '../context';
import { generateNpcVehicle, randomPersonName } from '../generator';
import type { ListingRecord } from '../records';
import { isPlayerListing } from '../state';
import { acquireVehicle, assertCanOwnMore, assertCategoryUnlocked, settleSale } from './sales';

const log = createLogger('market');

export class MarketService {
  /** Negotiation sessions keyed by `${playerId}:${listingId}`. */
  private sessions = new Map<string, SellerSession>();
  /** Lot slots recently emptied -> earliest refill time (keeps the lot feeling alive). */
  private slotCooldown = new Map<number, number>();

  constructor(private readonly ctx: Ctx) {}

  // ------------------------------------------------------------ views

  publicListing(l: ListingRecord): MarketListing | null {
    const veh = this.ctx.state.vehicles.get(l.vehicleId);
    if (!veh) return null;
    const slot = MARKET_LOT_SLOTS[l.lotSlot]!;
    return {
      id: l.id,
      vehicle: { ...veh, x: slot.x, z: slot.z, rotation: slot.rot },
      askingPrice: l.askingPrice,
      sellerName: l.sellerName,
      personality: l.personality,
      lotSlot: l.lotSlot,
      expiresAt: l.expiresAt,
    };
  }

  npcListings(): MarketListing[] {
    const out: MarketListing[] = [];
    for (const l of this.ctx.state.listings.values()) {
      const pl = this.publicListing(l);
      if (pl) out.push(pl);
    }
    return out.sort((a, b) => a.lotSlot - b.lotSlot);
  }

  playerListings(): PlayerListing[] {
    const out: PlayerListing[] = [];
    for (const veh of this.ctx.state.vehicles.values()) {
      if (!isPlayerListing(veh) || !veh.ownerId) continue;
      const seller = this.ctx.state.players.get(veh.ownerId);
      out.push({
        vehicle: this.ctx.state.toPublicVehicle(veh),
        price: veh.salePrice!,
        sellerId: veh.ownerId,
        sellerName: seller?.name ?? 'Unknown',
        location: veh.status === 'displayed' ? 'dealership' : 'classifieds',
        plotId: veh.plotId,
      });
    }
    return out;
  }

  list() {
    return { listings: this.npcListings(), playerListings: this.playerListings(), trends: this.ctx.state.trends };
  }

  // ------------------------------------------------------------ NPC inventory

  /** Remove expired listings and fill empty lot slots. */
  async refresh(): Promise<void> {
    const now = Date.now();
    const { state, locks } = this.ctx;
    const expired = [...state.listings.values()].filter((l) => l.expiresAt <= now);
    for (const l of expired) {
      await locks.run([K.listing(l.id), K.vehicle(l.vehicleId)], async () => {
        if (!state.listings.has(l.id)) return;
        const uow = state.begin();
        uow.deleteListing(l.id);
        uow.deleteVehicle(l.vehicleId);
        await uow.commit();
        this.slotCooldown.set(l.lotSlot, now + 5_000);
      });
    }
    for (const [key, s] of this.sessions) if (now - s.createdAt > ECONOMY.marketplace.negotiationTtlSec * 1000) this.sessions.delete(key);

    const used = new Set([...state.listings.values()].map((l) => l.lotSlot));
    const free: number[] = [];
    for (let i = 0; i < Math.min(ECONOMY.marketplace.npcListingCount, MARKET_LOT_SLOTS.length); i++) {
      if (!used.has(i) && (this.slotCooldown.get(i) ?? 0) <= now) free.push(i);
    }
    if (free.length === 0) return;
    // Fill a few slots per refresh (all of them on a cold start).
    const toFill = used.size === 0 ? free : free.slice(0, 2);
    const uow = state.begin();
    for (const slot of toFill) {
      const veh = generateNpcVehicle(this.ctx.rng);
      const s = MARKET_LOT_SLOTS[slot]!;
      veh.x = s.x;
      veh.z = s.z;
      veh.rotation = s.rot;
      const value = marketValue(veh, state.trends);
      const personality = weightedPick(this.ctx.rng, ECONOMY.sellerPersonalities, (p) => p.weight);
      const ask = Math.round((value * randRange(this.ctx.rng, personality.askRange[0], personality.askRange[1])) / 10) * 10;
      const min = Math.round(value * randRange(this.ctx.rng, personality.minRange[0], personality.minRange[1]));
      const [lmin, lmax] = ECONOMY.marketplace.listingLifetimeSec;
      uow.createVehicle(veh);
      uow.createListing({
        id: newId('lst'),
        vehicleId: veh.id,
        askingPrice: Math.max(ECONOMY.limits.minPrice, ask),
        minPrice: Math.max(ECONOMY.limits.minPrice, Math.min(ask, min)),
        sellerName: randomPersonName(this.ctx.rng),
        personality: personality.id,
        lotSlot: slot,
        expiresAt: now + Math.round(randRange(this.ctx.rng, lmin, lmax) * 1000),
        createdAt: now,
      });
      this.slotCooldown.delete(slot);
    }
    await uow.commit();
  }

  // ------------------------------------------------------------ buying from NPCs

  private currentPrice(playerId: string, l: ListingRecord): number {
    const s = this.sessions.get(`${playerId}:${l.id}`);
    return s && s.status === 'open' ? s.counterOffer : l.askingPrice;
  }

  async buy(playerId: string, params: unknown) {
    const p = v.obj(params);
    const listingId = v.id(p.listingId, 'listing');
    const expected = v.int(p.expectedPrice, 'price', 0, ECONOMY.limits.maxPrice);
    const listing = this.ctx.state.listings.get(listingId);
    if (!listing) throw new GameError('not_found', 'That vehicle has already been sold.');
    return this.ctx.locks.run([K.player(playerId), K.listing(listingId), K.vehicle(listing.vehicleId)], async () => {
      const l = this.ctx.state.listings.get(listingId);
      if (!l) throw new GameError('not_found', 'That vehicle has already been sold.');
      const price = this.currentPrice(playerId, l);
      if (price !== expected) throw new GameError('conflict', `The price changed to $${price.toLocaleString('en-US')}. Please review and try again.`);
      return this.executePurchase(playerId, l, price, false);
    });
  }

  /** Must be called while holding player/listing/vehicle locks. */
  private async executePurchase(playerId: string, l: ListingRecord, price: number, negotiated: boolean) {
    const uow = this.ctx.state.begin();
    const buyer = uow.player(playerId);
    const veh = uow.vehicle(l.vehicleId);
    if (veh.status !== 'market' || veh.ownerId !== null) throw new GameError('conflict', 'That vehicle is no longer for sale.');
    assertCategoryUnlocked(buyer, veh.modelId);
    assertCanOwnMore(this.ctx, buyer);
    acquireVehicle(uow, buyer, veh, price, 'market_buy', null, ECONOMY.xp.marketBuy);
    if (negotiated && price < l.askingPrice) {
      buyer.stats.negotiationsWon++;
      uow.grantXp(buyer, ECONOMY.xp.negotiationWin);
    }
    uow.deleteListing(l.id);
    uow.checkAchievements(buyer);
    await uow.commit();
    for (const key of [...this.sessions.keys()]) if (key.endsWith(`:${l.id}`)) this.sessions.delete(key);
    this.slotCooldown.set(l.lotSlot, Date.now() + 20_000);
    log.info('market purchase', { playerId, vehicleId: veh.id, model: veh.modelId, price, negotiated });
    this.ctx.sim.markInteract(playerId);
    return { vehicle: this.ctx.state.vehicles.get(veh.id)!, price };
  }

  // ------------------------------------------------------------ negotiation

  negotiate(playerId: string, params: unknown): NegotiationState {
    const p = v.obj(params);
    const listingId = v.id(p.listingId, 'listing');
    const l = this.ctx.state.listings.get(listingId);
    if (!l) throw new GameError('not_found', 'That vehicle has already been sold.');
    const key = `${playerId}:${listingId}`;
    let s = this.sessions.get(key);
    if (!s) {
      s = createSellerSession(l.id, l.personality, l.askingPrice, l.minPrice, Date.now());
      this.sessions.set(key, s);
    }
    return toNegotiationState(s);
  }

  async offer(playerId: string, params: unknown): Promise<{ state: NegotiationState; vehicle: Vehicle | null; price: number | null }> {
    const p = v.obj(params);
    const listingId = v.id(p.listingId, 'listing');
    const amount = v.int(p.offer, 'offer', 1, ECONOMY.limits.maxPrice);
    const listing = this.ctx.state.listings.get(listingId);
    if (!listing) throw new GameError('not_found', 'That vehicle has already been sold.');
    return this.ctx.locks.run([K.player(playerId), K.listing(listingId), K.vehicle(listing.vehicleId)], async () => {
      const l = this.ctx.state.listings.get(listingId);
      if (!l) throw new GameError('not_found', 'That vehicle has already been sold.');
      const buyer = this.ctx.state.players.get(playerId)!;
      if (amount > buyer.money) throw new GameError('insufficient_funds', "You can't make an offer you can't pay for.");
      const veh = this.ctx.state.vehicles.get(l.vehicleId)!;
      assertCategoryUnlocked(buyer, veh.modelId);
      const key = `${playerId}:${listingId}`;
      let s = this.sessions.get(key);
      if (!s) {
        s = createSellerSession(l.id, l.personality, l.askingPrice, l.minPrice, Date.now());
        this.sessions.set(key, s);
      }
      if (s.status !== 'open') return { state: toNegotiationState(s), vehicle: null, price: null };
      const snapshot = { ...s };
      const outcome = applyOffer(s, amount);
      if (outcome !== 'accept') return { state: toNegotiationState(s), vehicle: null, price: null };
      try {
        const res = await this.executePurchase(playerId, l, s.counterOffer, true);
        return { state: toNegotiationState(s), vehicle: res.vehicle, price: res.price };
      } catch (err) {
        Object.assign(s, snapshot); // purchase failed (e.g. garage full) - keep negotiating
        throw err;
      }
    });
  }

  // ------------------------------------------------------------ buying from players

  async buyFromPlayer(playerId: string, params: unknown) {
    const p = v.obj(params);
    const vehicleId = v.id(p.vehicleId, 'vehicle');
    const expected = v.int(p.expectedPrice, 'price', 0, ECONOMY.limits.maxPrice);
    const current = this.ctx.state.vehicles.get(vehicleId);
    if (!current || !isPlayerListing(current) || !current.ownerId) throw new GameError('not_found', 'That vehicle is no longer for sale.');
    const sellerId = current.ownerId;
    if (sellerId === playerId) throw new GameError('bad_request', "You can't buy your own vehicle.");
    return this.ctx.locks.run([K.player(playerId), K.player(sellerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const veh = uow.vehicle(vehicleId);
      if (!isPlayerListing(veh) || veh.ownerId !== sellerId) throw new GameError('conflict', 'That vehicle is no longer for sale.');
      if (this.ctx.sim.isDriven(vehicleId)) throw new GameError('conflict', 'That vehicle is being driven.');
      const price = veh.salePrice!;
      if (price !== expected) throw new GameError('conflict', `The price changed to $${price.toLocaleString('en-US')}.`);
      const buyer = uow.player(playerId);
      const seller = uow.player(sellerId);
      assertCategoryUnlocked(buyer, veh.modelId);
      assertCanOwnMore(this.ctx, buyer);
      const sale = settleSale(this.ctx, uow, seller, veh, price, {
        feeRate: ECONOMY.fees.saleFeeRate,
        kind: 'player_sale',
        buyerId: buyer.id,
        buyerName: buyer.name,
      });
      acquireVehicle(uow, buyer, veh, price, 'player_buy', seller.id, ECONOMY.xp.playerBuy);
      uow.notify(
        seller.id,
        { kind: 'money', title: 'Vehicle sold!', text: `${buyer.name} bought your ${modelDisplayName(veh.modelId)} for $${price.toLocaleString('en-US')} (you received $${sale.net.toLocaleString('en-US')}).` },
        true,
        (id) => this.ctx.hub.isOnline(id),
      );
      uow.checkAchievements(buyer);
      uow.checkAchievements(seller);
      await uow.commit();
      log.info('player purchase', { buyer: playerId, seller: sellerId, vehicleId, price });
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)!, price };
    });
  }
}

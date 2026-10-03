// Hammerfall Auction House. Bids are escrowed: the bid amount is taken from the
// bidder immediately and refunded when outbid, so a winner can always pay.

import { ECONOMY } from '../../../shared/economy.config';
import type { Auction } from '../../../shared/types';
import { marketValue } from '../../../shared/valuation';
import { randRange } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { generateNpcVehicle, randomPersonName } from '../generator';
import { requireIdle, requireNear, requireOwned } from '../guards';
import type { AuctionRecord } from '../records';
import { assertCanOwnMore, assertCanTradeWithPlayers, assertCategoryUnlocked, maxAskingPrice, settleSale } from './sales';

const log = createLogger('auction');

export function minNextBid(a: Pick<AuctionRecord, 'currentBid' | 'startingBid'>): number {
  const cfg = ECONOMY.auction;
  if (a.currentBid === null) return a.startingBid;
  return a.currentBid + Math.max(cfg.minIncrement, Math.ceil((a.currentBid * cfg.minIncrementRate) / 10) * 10);
}

export class AuctionService {
  private finalizing = new Set<string>();

  constructor(private readonly ctx: Ctx) {}

  toPublic(a: AuctionRecord): Auction | null {
    const veh = this.ctx.state.vehicles.get(a.vehicleId);
    if (!veh) return null;
    return {
      id: a.id,
      vehicle: this.ctx.state.toPublicVehicle(veh),
      sellerId: a.sellerId,
      sellerName: a.sellerName,
      startingBid: a.startingBid,
      currentBid: a.currentBid,
      currentBidderId: a.currentBidderId,
      currentBidderName: a.currentBidderName,
      bidCount: a.bidCount,
      endsAt: a.endsAt,
      status: a.status,
    };
  }

  list(): Auction[] {
    const out: Auction[] = [];
    for (const a of this.ctx.state.auctions.values()) {
      const pub = this.toPublic(a);
      if (pub) out.push(pub);
    }
    return out.sort((x, y) => x.endsAt - y.endsAt);
  }

  async create(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const startingBid = val.int(p.startingBid, 'starting bid', ECONOMY.limits.minPrice, ECONOMY.limits.maxPrice);
    const cfg = ECONOMY.auction;
    const duration = val.int(p.durationSec, 'duration', cfg.minDurationSec, cfg.maxDurationSec);
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      requireNear(this.ctx, playerId, 'auction');
      const uow = this.ctx.state.begin();
      const seller = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, seller);
      requireIdle(this.ctx, veh, { allowedStatus: ['stored', 'world'] });
      const value = marketValue(veh, this.ctx.state.trends);
      const [lo, hi] = cfg.startingBidRange;
      if (startingBid < Math.round(value * lo) || startingBid > Math.round(value * hi)) {
        throw new GameError(
          'bad_request',
          `Starting bid must be between $${Math.round(value * lo).toLocaleString('en-US')} and $${Math.round(value * hi).toLocaleString('en-US')}.`,
        );
      }
      uow.debit(seller, ECONOMY.fees.auctionListingFee, 'listing_fee', `Auction consignment: ${modelDisplayName(veh.modelId)}`, veh.id);
      veh.status = 'auction';
      veh.salePrice = null;
      const record: AuctionRecord = {
        id: newId('auc'),
        vehicleId,
        sellerId: playerId,
        sellerName: seller.name,
        startingBid,
        currentBid: null,
        currentBidderId: null,
        currentBidderName: null,
        bidCount: 0,
        npcCap: Math.round(value * randRange(this.ctx.rng, cfg.npcMaxBidRate[0], cfg.npcMaxBidRate[1])),
        endsAt: uow.now + duration * 1000,
        status: 'active',
        createdAt: uow.now,
      };
      uow.createAuction(record);
      await uow.commit();
      this.ctx.sim.markInteract(playerId);
      this.ctx.hub.systemChat(`${seller.name} put a ${modelDisplayName(veh.modelId)} up for auction!`);
      log.info('auction created', { playerId, auctionId: record.id, startingBid });
      return { auction: this.toPublic(this.ctx.state.auctions.get(record.id)!)! };
    });
  }

  async bid(playerId: string, params: unknown) {
    const p = val.obj(params);
    const auctionId = val.id(p.auctionId, 'auction');
    const amount = val.int(p.amount, 'bid', 1, ECONOMY.limits.maxPrice);
    const current = this.ctx.state.auctions.get(auctionId);
    if (!current) throw new GameError('not_found', 'That auction has ended.');
    const prevBidder = current.currentBidderId;
    const keys = [K.auction(auctionId), K.player(playerId)];
    if (prevBidder) keys.push(K.player(prevBidder));
    return this.ctx.locks.run(keys, async () => {
      const uow = this.ctx.state.begin();
      const a = uow.auction(auctionId);
      if (a.status !== 'active' || a.endsAt <= uow.now || this.finalizing.has(a.id)) throw new GameError('conflict', 'That auction has ended.');
      if (a.currentBidderId !== prevBidder) throw new GameError('conflict', 'Someone just bid. Please try again.');
      if (a.sellerId === playerId) throw new GameError('forbidden', "You can't bid on your own auction.");
      if (a.currentBidderId === playerId) throw new GameError('conflict', 'You are already the highest bidder.');
      const min = minNextBid(a);
      if (amount < min) throw new GameError('bad_request', `Minimum bid is $${min.toLocaleString('en-US')}.`);
      const bidder = uow.player(playerId);
      const veh = this.ctx.state.vehicles.get(a.vehicleId);
      if (!veh) throw new GameError('not_found', 'Vehicle missing.');
      if (a.sellerId !== null) assertCanTradeWithPlayers(bidder);
      assertCategoryUnlocked(bidder, veh.modelId);
      assertCanOwnMore(this.ctx, bidder);
      // Same cap as asking prices: stops funnelling money between accounts through absurd bids.
      const cap = maxAskingPrice(this.ctx, veh);
      if (amount > cap) throw new GameError('bad_request', `Bids on this vehicle are capped at $${cap.toLocaleString('en-US')}.`);
      uow.debit(bidder, amount, 'auction_bid_hold', `Bid on ${modelDisplayName(veh.modelId)} (held)`, veh.id);
      if (a.currentBidderId && a.currentBid) {
        const prev = uow.player(a.currentBidderId);
        uow.credit(prev, a.currentBid, 'auction_refund', `Outbid on ${modelDisplayName(veh.modelId)} - bid returned`, veh.id);
        uow.notify(prev.id, { kind: 'warning', title: 'You were outbid!', text: `${bidder.name} bid $${amount.toLocaleString('en-US')} on the ${modelDisplayName(veh.modelId)}.` });
      }
      a.currentBid = amount;
      a.currentBidderId = playerId;
      a.currentBidderName = bidder.name;
      a.bidCount++;
      const snipe = ECONOMY.auction.antiSnipeSec * 1000;
      if (a.endsAt - uow.now < snipe) a.endsAt = uow.now + snipe;
      await uow.commit();
      log.info('bid', { playerId, auctionId, amount });
      return { auction: this.toPublic(this.ctx.state.auctions.get(auctionId)!)! };
    });
  }

  /** Called every second: NPC bids, finalisation, NPC consignments. */
  async tick(): Promise<void> {
    const now = Date.now();
    for (const a of [...this.ctx.state.auctions.values()]) {
      if (a.status !== 'active') continue;
      if (a.endsAt <= now) {
        await this.finalize(a.id).catch((err) => log.error('finalize failed', { auctionId: a.id, error: (err as Error).message }));
        continue;
      }
      await this.maybeNpcBid(a.id).catch((err) => log.error('npc bid failed', { error: (err as Error).message }));
    }
    await this.ensureNpcAuctions();
  }

  private async maybeNpcBid(auctionId: string): Promise<void> {
    const a0 = this.ctx.state.auctions.get(auctionId);
    if (!a0 || this.ctx.rng() > 0.12) return;
    // NPCs don't pile onto an auction that another NPC leads unless a player is involved.
    if (a0.currentBidderId === null && a0.currentBid !== null && a0.sellerId === null && this.ctx.rng() < 0.7) return;
    const next = minNextBid(a0);
    if (next > a0.npcCap) return;
    const prevBidder = a0.currentBidderId;
    const keys = [K.auction(auctionId)];
    if (prevBidder) keys.push(K.player(prevBidder));
    await this.ctx.locks.run(keys, async () => {
      const uow = this.ctx.state.begin();
      const a = uow.auction(auctionId);
      if (a.status !== 'active' || a.endsAt <= uow.now || a.currentBidderId !== prevBidder) return;
      const amount = minNextBid(a);
      if (amount > a.npcCap) return;
      const veh = this.ctx.state.vehicles.get(a.vehicleId);
      if (a.currentBidderId && a.currentBid) {
        const prev = uow.player(a.currentBidderId);
        uow.credit(prev, a.currentBid, 'auction_refund', `Outbid on ${veh ? modelDisplayName(veh.modelId) : 'vehicle'} - bid returned`, a.vehicleId);
        uow.notify(prev.id, { kind: 'warning', title: 'You were outbid!', text: `A bidder offered $${amount.toLocaleString('en-US')}.` });
      }
      a.currentBid = amount;
      a.currentBidderId = null;
      a.currentBidderName = randomPersonName(this.ctx.rng);
      a.bidCount++;
      const snipe = ECONOMY.auction.antiSnipeSec * 1000;
      if (a.endsAt - uow.now < snipe) a.endsAt = uow.now + snipe;
      await uow.commit();
    });
  }

  async finalize(auctionId: string): Promise<void> {
    const a0 = this.ctx.state.auctions.get(auctionId);
    if (!a0) return;
    this.finalizing.add(auctionId);
    const keys = [K.auction(auctionId), K.vehicle(a0.vehicleId)];
    if (a0.sellerId) keys.push(K.player(a0.sellerId));
    if (a0.currentBidderId) keys.push(K.player(a0.currentBidderId));
    try {
      await this.ctx.locks.run(keys, async () => {
        const uow = this.ctx.state.begin();
        const a = uow.auction(auctionId);
        if (a.status !== 'active') return;
        // A last-second bid may have extended the auction (anti-sniping) or changed the
        // leader after our lock keys were computed: settle on a later tick instead.
        if (a.endsAt > uow.now || a.currentBidderId !== a0.currentBidderId) return;
        const veh = uow.vehicle(a.vehicleId);
        const name = modelDisplayName(veh.modelId);
        const isOnline = (id: string) => this.ctx.hub.isOnline(id);
        if (a.currentBid !== null) {
          a.status = 'sold';
          if (a.sellerId) {
            const seller = uow.player(a.sellerId);
            settleSale(this.ctx, uow, seller, veh, a.currentBid, {
              feeRate: ECONOMY.fees.auctionFeeRate,
              kind: 'auction_sale',
              buyerId: a.currentBidderId,
              buyerName: a.currentBidderName ?? 'a bidder',
            });
            seller.stats.auctionsSold++;
            uow.grantXp(seller, ECONOMY.xp.auctionSale);
            uow.notify(seller.id, { kind: 'money', title: 'Auction sold!', text: `Your ${name} sold for $${a.currentBid.toLocaleString('en-US')}.` }, true, isOnline);
            uow.checkAchievements(seller);
          }
          if (a.currentBidderId) {
            const winner = uow.player(a.currentBidderId);
            // Money was already held when bidding.
            veh.ownerId = winner.id;
            veh.status = 'stored';
            if (veh.mods.stashGrams) veh.mods = { ...veh.mods, stashGrams: 0 };
            veh.purchasePrice = a.currentBid;
            veh.salePrice = null;
            veh.plotId = null;
            veh.slot = null;
            winner.stats.auctionsWon++;
            winner.stats.vehiclesBought++;
            uow.grantXp(winner, ECONOMY.xp.auctionWin);
            uow.notify(winner.id, { kind: 'success', title: 'You won the auction!', text: `The ${name} is now in your garage.` }, true, isOnline);
            uow.checkAchievements(winner);
            this.ctx.hub.systemChat(`${winner.name} won the ${name} at auction for $${a.currentBid.toLocaleString('en-US')}!`);
          } else {
            uow.deleteVehicle(veh.id);
          }
        } else {
          a.status = 'unsold';
          if (a.sellerId) {
            veh.status = 'stored';
            uow.notify(a.sellerId, { kind: 'info', title: 'Auction ended', text: `No bids for your ${name}. It was returned to your garage.` }, true, isOnline);
          } else {
            uow.deleteVehicle(veh.id);
          }
        }
        await uow.commit();
        log.info('auction finalized', { auctionId, status: a.status, price: a.currentBid, winner: a.currentBidderId });
      });
    } finally {
      this.finalizing.delete(auctionId);
    }
  }

  private async ensureNpcAuctions(): Promise<void> {
    const cfg = ECONOMY.auction;
    const npcActive = [...this.ctx.state.auctions.values()].filter((a) => a.sellerId === null && a.status === 'active').length;
    if (npcActive >= cfg.npcAuctionCount) return;
    const uow = this.ctx.state.begin();
    const veh = generateNpcVehicle(this.ctx.rng, { rarityBias: 1.2, minQuality: 30 });
    veh.status = 'auction';
    const value = marketValue(veh, this.ctx.state.trends);
    uow.createVehicle(veh);
    uow.createAuction({
      id: newId('auc'),
      vehicleId: veh.id,
      sellerId: null,
      sellerName: `${randomPersonName(this.ctx.rng)} Estate`,
      startingBid: Math.max(ECONOMY.limits.minPrice, Math.round((value * randRange(this.ctx.rng, 0.4, 0.6)) / 50) * 50),
      currentBid: null,
      currentBidderId: null,
      currentBidderName: null,
      bidCount: 0,
      npcCap: Math.round(value * randRange(this.ctx.rng, cfg.npcMaxBidRate[0], cfg.npcMaxBidRate[1])),
      endsAt: uow.now + Math.round(randRange(this.ctx.rng, cfg.npcAuctionDurationSec[0], cfg.npcAuctionDurationSec[1]) * 1000),
      status: 'active',
      createdAt: uow.now,
    });
    await uow.commit();
  }
}

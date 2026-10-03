// Shared purchase/sale settlement logic.

import { ECONOMY } from '../../../shared/economy.config';
import { isCategoryUnlocked } from '../../../shared/progression';
import { garageSlots } from '../../../shared/reputation';
import type { TransactionKind, Vehicle } from '../../../shared/types';
import { averageCondition, marketValue } from '../../../shared/valuation';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { GameError } from '../../errors';
import type { Ctx } from '../context';
import type { PlayerRecord } from '../records';
import type { UnitOfWork } from '../state';

export function assertCanOwnMore(ctx: Ctx, buyer: PlayerRecord): void {
  // Auctions the player currently leads count too: they will become owned vehicles.
  let leading = 0;
  for (const a of ctx.state.auctions.values()) if (a.status === 'active' && a.currentBidderId === buyer.id) leading++;
  const slots = garageSlots(buyer.level);
  // A stolen car on its way to the Sanayi or a test-drive car doesn't take a garage slot.
  const owned = ctx.state.vehiclesOf(buyer.id).filter((v) => v.status !== 'stolen' && v.status !== 'testdrive').length;
  if (owned + leading >= slots) {
    throw new GameError('conflict', `Your garage is full (max ${slots} vehicles at level ${buyer.level} - level up for more room).`);
  }
}

export function assertCategoryUnlocked(buyer: PlayerRecord, modelId: string): void {
  const model = getModel(modelId);
  if (!isCategoryUnlocked(model.category, buyer.level)) {
    throw new GameError(
      'forbidden',
      `${model.category.toUpperCase()} vehicles unlock at level ${ECONOMY.categoryUnlockLevel[model.category]}.`,
    );
  }
}

/** Transfer a vehicle (draft) to a buyer (draft) and charge them. */
export function acquireVehicle(
  uow: UnitOfWork,
  buyer: PlayerRecord,
  v: Vehicle,
  price: number,
  kind: TransactionKind,
  counterpartyId: string | null,
  xp: number,
): void {
  uow.debit(buyer, price, kind, `Bought ${modelDisplayName(v.modelId)}`, v.id, counterpartyId);
  v.ownerId = buyer.id;
  v.status = 'stored';
  // Whatever was left in a hidden compartment goes to the scrap heap, not to the buyer.
  if (v.mods.stashGrams) v.mods = { ...v.mods, stashGrams: 0 };
  v.purchasePrice = price;
  v.salePrice = null;
  v.plotId = null;
  v.slot = null;
  buyer.stats.vehiclesBought++;
  uow.grantXp(buyer, xp);
}

export interface SaleResult {
  net: number;
  fee: number;
  profit: number;
}

/** Pay a seller for a vehicle and update their stats/XP/reputation. */
export function settleSale(
  ctx: Ctx,
  uow: UnitOfWork,
  seller: PlayerRecord,
  v: Vehicle,
  price: number,
  opts: { feeRate: number; kind: TransactionKind; buyerId: string | null; buyerName: string; customer?: boolean },
): SaleResult {
  const fee = Math.round(price * opts.feeRate);
  const net = price - fee;
  const value = marketValue(v, ctx.state.trends);
  uow.credit(seller, net, opts.kind, `Sold ${modelDisplayName(v.modelId)} to ${opts.buyerName} (fee ${fee})`, v.id, opts.buyerId);
  const profit = net - v.purchasePrice;
  seller.stats.totalRevenue += net;
  // Sales to other *players* earn money only: no XP, profit stats or sales achievements.
  // Otherwise two cooperating accounts could farm them by trading one car back and forth.
  const toPlayer = opts.buyerId !== null;
  if (!toPlayer) {
    seller.stats.vehiclesSold++;
    seller.stats.totalProfit += profit;
    seller.stats.bestFlipProfit = Math.max(seller.stats.bestFlipProfit, profit);
    if (opts.customer) seller.stats.customersServed++;
    const xpCfg = ECONOMY.xp;
    uow.grantXp(seller, xpCfg.sale + Math.min(xpCfg.maxProfitXp, Math.max(0, Math.floor(profit / 100) * xpCfg.profitPer100)));
  }
  if (!toPlayer) {
    const r = ECONOMY.reputation;
    const ratio = value > 0 ? price / value : 1;
    if (ratio <= 1.0) uow.adjustReputation(seller, r.fairSaleBonus);
    else if (ratio > r.overpricedThreshold) uow.adjustReputation(seller, -r.overpricedPenalty);
    if (opts.customer && averageCondition(v.condition) < r.poorConditionThreshold) uow.adjustReputation(seller, -r.poorConditionPenalty);
  }
  return { net, fee, profit };
}

/** Max price a player may ask (anti money-laundering between accounts). */
export function maxAskingPrice(ctx: Ctx, v: Vehicle): number {
  return Math.max(ECONOMY.limits.minPrice * 10, Math.round(marketValue(v, ctx.state.trends) * ECONOMY.trading.maxPriceRate));
}

/** Min price a player may ask: never below what the wholesaler pays (no give-aways to alt accounts). */
export function minAskingPrice(ctx: Ctx, v: Vehicle): number {
  return Math.max(ECONOMY.limits.minPrice, Math.round(marketValue(v, ctx.state.trends) * ECONOMY.fees.quickSellRate));
}

export function assertAskingPrice(ctx: Ctx, v: Vehicle, price: number): void {
  const min = minAskingPrice(ctx, v);
  const max = maxAskingPrice(ctx, v);
  if (price < min) throw new GameError('bad_request', `Asking price is too low (minimum $${min.toLocaleString('en-US')}).`);
  if (price > max) throw new GameError('bad_request', `Asking price is too high (max $${max.toLocaleString('en-US')}).`);
}

/** Buying from other players (or bidding on their auctions) needs some real play first. */
export function assertCanTradeWithPlayers(buyer: PlayerRecord): void {
  const min = ECONOMY.trading.minLevelToBuyFromPlayers;
  if (buyer.level < min) throw new GameError('forbidden', `Buying from other players unlocks at level ${min}.`);
}

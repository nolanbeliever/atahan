// Shared purchase/sale settlement logic.

import { ECONOMY } from '../../../shared/economy.config';
import { isCategoryUnlocked } from '../../../shared/progression';
import type { TransactionKind, Vehicle } from '../../../shared/types';
import { averageCondition, marketValue } from '../../../shared/valuation';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { GameError } from '../../errors';
import type { Ctx } from '../context';
import type { PlayerRecord } from '../records';
import type { UnitOfWork } from '../state';

export function assertCanOwnMore(ctx: Ctx, buyer: PlayerRecord): void {
  if (ctx.state.vehiclesOf(buyer.id).length >= ECONOMY.player.maxOwnedVehicles) {
    throw new GameError('conflict', `Your garage is full (max ${ECONOMY.player.maxOwnedVehicles} vehicles).`);
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
  seller.stats.vehiclesSold++;
  seller.stats.totalRevenue += net;
  seller.stats.totalProfit += profit;
  seller.stats.bestFlipProfit = Math.max(seller.stats.bestFlipProfit, profit);
  if (opts.customer) seller.stats.customersServed++;
  const xpCfg = ECONOMY.xp;
  uow.grantXp(seller, xpCfg.sale + Math.min(xpCfg.maxProfitXp, Math.max(0, Math.floor(profit / 100) * xpCfg.profitPer100)));
  const r = ECONOMY.reputation;
  const ratio = value > 0 ? price / value : 1;
  if (ratio <= 1.0) uow.adjustReputation(seller, r.fairSaleBonus);
  else if (ratio > r.overpricedThreshold) uow.adjustReputation(seller, -r.overpricedPenalty);
  if (opts.customer && averageCondition(v.condition) < r.poorConditionThreshold) uow.adjustReputation(seller, -r.poorConditionPenalty);
  return { net, fee, profit };
}

/** Max price a player may ask (anti money-laundering between accounts). */
export function maxAskingPrice(ctx: Ctx, v: Vehicle): number {
  return Math.max(ECONOMY.limits.minPrice * 10, Math.round(marketValue(v, ctx.state.trends) * 2.5));
}

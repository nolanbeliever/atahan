// Levels, XP and achievements.

import { ECONOMY } from './economy.config';
import type { PlayerStats, VehicleCategory } from './types';

/** XP required to advance from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  const l = ECONOMY.levels;
  return Math.round(l.xpBase * Math.pow(Math.max(1, level), l.xpExponent));
}

/** Total XP needed to reach `level` from level 1. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i < level; i++) total += xpToNext(i);
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (level < ECONOMY.levels.maxLevel) {
    const need = xpToNext(level);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return level;
}

export function levelProgress(xp: number): { level: number; into: number; needed: number; fraction: number } {
  const level = levelFromXp(xp);
  const into = xp - totalXpForLevel(level);
  const needed = level >= ECONOMY.levels.maxLevel ? 1 : xpToNext(level);
  return { level, into, needed, fraction: Math.min(1, into / needed) };
}

export function isCategoryUnlocked(category: VehicleCategory, level: number): boolean {
  return level >= ECONOMY.categoryUnlockLevel[category];
}

export interface AchievementContext {
  stats: PlayerStats;
  netWorth: number;
  dealershipLevel: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  reward: number;
  check: (ctx: AchievementContext) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_purchase', title: 'First Wheels', description: 'Buy your first vehicle.', reward: 250, check: (c) => c.stats.vehiclesBought >= 1 },
  { id: 'first_sale', title: 'Open for Business', description: 'Sell your first vehicle.', reward: 500, check: (c) => c.stats.vehiclesSold >= 1 },
  { id: 'flipper', title: 'Flipper', description: 'Sell 10 vehicles.', reward: 2_000, check: (c) => c.stats.vehiclesSold >= 10 },
  { id: 'dealer_pro', title: 'Dealer Pro', description: 'Sell 50 vehicles.', reward: 10_000, check: (c) => c.stats.vehiclesSold >= 50 },
  { id: 'profit_10k', title: 'In the Black', description: 'Earn $10,000 total profit.', reward: 1_000, check: (c) => c.stats.totalProfit >= 10_000 },
  { id: 'profit_100k', title: 'Six Figures', description: 'Earn $100,000 total profit.', reward: 5_000, check: (c) => c.stats.totalProfit >= 100_000 },
  { id: 'big_flip', title: 'Big Flip', description: 'Make $10,000 profit on a single vehicle.', reward: 2_500, check: (c) => c.stats.bestFlipProfit >= 10_000 },
  { id: 'millionaire', title: 'GetRich!', description: 'Reach a net worth of $1,000,000.', reward: 25_000, check: (c) => c.netWorth >= 1_000_000 },
  { id: 'dealership_owner', title: 'Proprietor', description: 'Open your own dealership.', reward: 500, check: (c) => c.dealershipLevel >= 1 },
  { id: 'showroom', title: 'Showroom Floor', description: 'Upgrade your dealership to level 3.', reward: 3_000, check: (c) => c.dealershipLevel >= 3 },
  { id: 'mega_dealer', title: 'Mega Dealer', description: 'Upgrade your dealership to level 6.', reward: 20_000, check: (c) => c.dealershipLevel >= 6 },
  { id: 'grease_monkey', title: 'Grease Monkey', description: 'Spend $10,000 on repairs.', reward: 800, check: (c) => c.stats.spentOnRepairs >= 10_000 },
  { id: 'haggler', title: 'Haggler', description: 'Win 5 negotiations.', reward: 750, check: (c) => c.stats.negotiationsWon >= 5 },
  { id: 'auction_win', title: 'Going Once...', description: 'Win an auction.', reward: 600, check: (c) => c.stats.auctionsWon >= 1 },
  { id: 'auction_sell', title: 'Sold to the Highest Bidder', description: 'Sell a vehicle at auction.', reward: 600, check: (c) => c.stats.auctionsSold >= 1 },
  { id: 'customer_service', title: 'Customer Service', description: 'Sell 10 vehicles to walk-in customers.', reward: 1_500, check: (c) => c.stats.customersServed >= 10 },
  { id: 'road_warrior', title: 'Road Warrior', description: 'Drive 25 km in total.', reward: 500, check: (c) => c.stats.distanceDriven >= 25 },
];

export function findAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export function emptyStats(): PlayerStats {
  return {
    vehiclesBought: 0,
    vehiclesSold: 0,
    totalRevenue: 0,
    totalProfit: 0,
    spentOnRepairs: 0,
    spentOnCustomization: 0,
    auctionsWon: 0,
    auctionsSold: 0,
    customersServed: 0,
    negotiationsWon: 0,
    distanceDriven: 0,
    bestFlipProfit: 0,
  };
}

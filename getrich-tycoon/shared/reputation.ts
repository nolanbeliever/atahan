// Reputation unlocks: what a dealer's level opens up (bigger garage, more cars on the street,
// market discounts, underglow neon kits). Pure functions shared by server and client.

import { ECONOMY } from './economy.config';

const R = ECONOMY.unlocks;

/** How many vehicles a player may own at this level. */
export function garageSlots(level: number): number {
  const g = R.garage;
  return Math.min(g.max, g.base + g.perStep * Math.floor(Math.max(0, level - 1) / g.levelsPerStep));
}

/** How many vehicles a player may have out on the street at once. */
export function spawnSlots(level: number): number {
  let n = R.spawnSlots[0]!.slots;
  for (const s of R.spawnSlots) if (level >= s.level) n = s.slots;
  return n;
}

/** Discount (share) on the used vehicle market at this level. */
export function marketDiscount(level: number): number {
  let d = 0;
  for (const s of R.marketDiscount) if (level >= s.level) d = s.discount;
  return d;
}

/** Price a player pays for a market listing after their reputation discount. */
export function discountedPrice(askingPrice: number, level: number): number {
  return Math.round(askingPrice * (1 - marketDiscount(level)));
}

export interface UnlockInfo {
  level: number;
  title: string;
  detail: string;
}

/** Everything the reputation track unlocks, in level order (for the missions panel). */
export function reputationUnlocks(): UnlockInfo[] {
  const out: UnlockInfo[] = [];
  const g = R.garage;
  for (let level = 1 + g.levelsPerStep; garageSlots(level) <= g.max && level <= ECONOMY.levels.maxLevel; level += g.levelsPerStep * 3) {
    out.push({ level, title: `Garage: ${garageSlots(level)} slots`, detail: 'Own more vehicles at once.' });
    if (garageSlots(level) >= g.max) break;
  }
  for (const s of R.spawnSlots.slice(1)) out.push({ level: s.level, title: `${s.slots} cars on the street`, detail: 'Take more of your cars out at the same time.' });
  for (const s of R.marketDiscount) out.push({ level: s.level, title: `${Math.round(s.discount * 100)}% market discount`, detail: 'Cheaper cars at the Used Vehicle Market.' });
  out.push({ level: R.underglowLevel, title: 'Underglow neon', detail: 'Neon lights under your car at Chroma Customs.' });
  out.push({ level: R.rainbowUnderglowLevel, title: 'Rainbow underglow', detail: 'Animated colour-cycling underglow kit.' });
  return out.sort((a, b) => a.level - b.level);
}

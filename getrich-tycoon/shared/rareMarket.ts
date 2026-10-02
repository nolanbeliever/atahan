// Rare Dealer: a rotating stock of special vehicles that is replaced every 120 seconds.
//
// The rotation is tied to the server clock (epoch = floor(time / rotation length)), so every
// player sees the same stock and the countdown survives page reloads and server restarts. The
// offers of an epoch are generated from a seed only the server knows, so upcoming rotations
// can't be predicted.
//
// Odds per offer: common/uncommon 70%, rare/epic 25%, legendary 5% (ECONOMY.rareMarket.tierWeights).
// A legendary offer picks one legendary model by weighted random (its `dropChance`), and every
// legendary model stays under its drop chance per rotation (see appearanceChance).

import { ECONOMY } from './economy.config';
import { SPECIAL_DROP_CHANCE } from './specialVehicles';
import type { Vehicle } from './types';
import { weightedPick, type Rng } from './util';
import { RARITY_TIERS, VEHICLE_MODELS, type RarityTier, type VehicleModel } from './vehicles';

export const RARE_ROTATION_MS = ECONOMY.rareMarket.rotationSec * 1000;

export interface RareOffer {
  /** `${epoch}:${slot}` */
  id: string;
  epoch: number;
  slot: number;
  tier: RarityTier;
  /** Preview of the vehicle you get (a new id is assigned on purchase). */
  vehicle: Vehicle;
  price: number;
  /** Name of the buyer once sold (everyone sees it). */
  soldTo: string | null;
}

export interface RareMarketState {
  epoch: number;
  /** Server time (ms) when this rotation ends. */
  endsAt: number;
  /** Server time when this state was sent (clients derive their clock offset from it). */
  serverTime: number;
  rotationSec: number;
  offers: RareOffer[];
}

export function rareEpoch(now: number): number {
  return Math.floor(now / RARE_ROTATION_MS);
}

export function rareEpochEnd(epoch: number): number {
  return (epoch + 1) * RARE_ROTATION_MS;
}

export function offerId(epoch: number, slot: number): string {
  return `${epoch}:${slot}`;
}

export function parseOfferId(id: string): { epoch: number; slot: number } | null {
  const m = /^(\d{1,12}):(\d{1,2})$/.exec(id);
  if (!m) return null;
  return { epoch: Number(m[1]), slot: Number(m[2]) };
}

/** Deterministic 32-bit seed from the server secret and an epoch (cyrb53-style string hash). */
export function rotationSeed(secret: string, epoch: number): number {
  const str = `${secret}:${epoch}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export function modelsOfTier(tier: RarityTier): VehicleModel[] {
  // Showroom-only cars are sold on the far shore, not by the Rare Dealer.
  return VEHICLE_MODELS.filter((m) => m.tier === tier && !m.showroom);
}

/** Weight of a model inside its tier: legendary models use their drop chance. */
export function tierPickWeight(m: VehicleModel): number {
  return m.tier === 'legendary' ? SPECIAL_DROP_CHANCE[m.id] ?? 0.05 : 1;
}

/** Weighted random tier for one offer. */
export function rollTier(rng: Rng): RarityTier {
  const w = ECONOMY.rareMarket.tierWeights;
  return weightedPick(rng, RARITY_TIERS as RarityTier[], (t) => w[t]);
}

/**
 * Pick the model for one offer: weighted random inside the tier. Rare, epic and legendary models
 * never repeat within a rotation; when a small tier runs out, the offer drops to the next lower
 * tier (so the returned model's `tier` is the offer's tier).
 */
export function rollModel(rng: Rng, tier: RarityTier, taken: Set<string>): VehicleModel {
  for (let i = RARITY_TIERS.indexOf(tier); i >= 0; i--) {
    const t = RARITY_TIERS[i]!;
    const all = modelsOfTier(t);
    const pool = t === 'common' || t === 'uncommon' ? all : all.filter((m) => !taken.has(m.id));
    if (pool.length) return weightedPick(rng, pool, tierPickWeight);
  }
  return weightedPick(rng, modelsOfTier('common'), tierPickWeight);
}

/** Probability (0-1) that one offer slot is from `tier`. */
export function tierChance(tier: RarityTier): number {
  const w = ECONOMY.rareMarket.tierWeights;
  const total = RARITY_TIERS.reduce((s, t) => s + w[t], 0);
  return w[tier] / total;
}

/**
 * Chance (0-1) that `modelId` appears in one rotation: the per-slot chance summed over all slots.
 * (The no-repeat rule shifts this by a hair; a unit test checks the real rate by simulation.)
 */
export function appearanceChance(modelId: string): number {
  const model = VEHICLE_MODELS.find((m) => m.id === modelId);
  if (!model) return 0;
  const pool = modelsOfTier(model.tier);
  const total = pool.reduce((s, m) => s + tierPickWeight(m), 0);
  const perSlot = tierChance(model.tier) * (tierPickWeight(model) / total);
  return Math.min(1, perSlot * ECONOMY.rareMarket.slots);
}

export const TIER_LABELS: Record<RarityTier, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

export const TIER_COLORS: Record<RarityTier, string> = {
  common: '#9aa4b2',
  uncommon: '#2ee59d',
  rare: '#4f8cff',
  epic: '#b86bff',
  legendary: '#ffb020',
};

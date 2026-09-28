// Vehicle valuation & service pricing. Pure functions used by the server for
// authoritative prices and by the client for previews.

import { ECONOMY } from './economy.config';
import { modsValue } from './customization';
import type { CategoryTrends, RepairPart, Vehicle, VehicleCondition, VehicleMods } from './types';
import { REPAIR_PARTS, VEHICLE_CATEGORIES } from './types';
import { clamp } from './util';
import { getModel, type VehicleModel } from './vehicles';

export type ValuableVehicle = Pick<Vehicle, 'modelId' | 'condition' | 'mileage' | 'mods'>;

export function neutralTrends(): CategoryTrends {
  const t = {} as CategoryTrends;
  for (const c of VEHICLE_CATEGORIES) t[c] = 1;
  return t;
}

/** Weighted overall condition score 0-100. */
export function overallCondition(c: VehicleCondition): number {
  const w = ECONOMY.valuation.conditionWeights;
  let sum = c.cleanliness * ECONOMY.valuation.cleanlinessWeight;
  for (const p of REPAIR_PARTS) sum += c[p] * w[p];
  return clamp(sum, 0, 100);
}

/** Average of the mechanical/cosmetic parts, ignoring cleanliness. */
export function averageCondition(c: VehicleCondition): number {
  let sum = 0;
  for (const p of REPAIR_PARTS) sum += c[p];
  return sum / REPAIR_PARTS.length;
}

export function conditionFactor(c: VehicleCondition): number {
  const v = ECONOMY.valuation;
  const score = overallCondition(c) / 100;
  return v.conditionFloor + (1 - v.conditionFloor) * Math.pow(score, v.conditionCurve);
}

export function mileageFactor(model: VehicleModel, mileage: number): number {
  const v = ECONOMY.valuation;
  const mult = model.category === 'classic' ? v.classicMileageMultiplier : 1;
  return Math.max(v.mileageFloor, 1 - (Math.max(0, mileage) / v.mileageRefKm) * v.mileageDepreciation * mult);
}

export function rarityFactor(model: VehicleModel): number {
  return 1 + (model.rarity - 1) * ECONOMY.valuation.rarityValueScale;
}

export function modsBonus(baseValue: number, mods: VehicleMods): number {
  const v = ECONOMY.valuation;
  return Math.min(baseValue * v.maxModsBonus, modsValue(mods) * ECONOMY.customization.valueRetention);
}

/** Authoritative market value of a vehicle (whole dollars). */
export function marketValue(vehicle: ValuableVehicle, trends?: CategoryTrends): number {
  const model = getModel(vehicle.modelId);
  const demand = trends ? trends[model.category] ?? 1 : 1;
  const base =
    model.basePrice * demand * rarityFactor(model) * conditionFactor(vehicle.condition) * mileageFactor(model, vehicle.mileage);
  return Math.max(50, Math.round(base + modsBonus(base, vehicle.mods)));
}

export function quickSellPrice(vehicle: ValuableVehicle, trends?: CategoryTrends): number {
  return Math.round(marketValue(vehicle, trends) * ECONOMY.fees.quickSellRate);
}

export interface RepairQuoteLine {
  part: RepairPart;
  current: number;
  target: number;
  points: number;
  /** Full shop price without discounts. */
  baseCost: number;
  /** What the player actually pays. */
  cost: number;
  laborCost: number;
  partsCost: number;
  kitApplied: boolean;
  seconds: number;
}

export interface RepairOptions {
  /** Kits owned by the player: itemId -> qty. */
  inventory?: Record<string, number>;
  useKits?: boolean;
  /** Dealership repair bay discount on labour (0-1). */
  laborDiscount?: number;
}

export function kitForPart(part: RepairPart): { id: string; label: string; price: number } | undefined {
  return ECONOMY.parts.find((k) => k.part === part);
}

export function repairLine(vehicle: ValuableVehicle, part: RepairPart, opts: RepairOptions = {}): RepairQuoteLine {
  const model = getModel(vehicle.modelId);
  const r = ECONOMY.repair;
  const current = Math.round(clamp(vehicle.condition[part], 0, 100));
  const target = 100;
  const points = Math.max(0, target - current);
  const perPoint = Math.max(r.minCostPerPoint[part], model.basePrice * r.costPerPointRate[part]);
  const baseCost = Math.round(points * perPoint);
  let laborCost = baseCost * r.laborShare;
  let partsCost = baseCost - laborCost;
  laborCost *= 1 - clamp(opts.laborDiscount ?? 0, 0, 0.9);
  let kitApplied = false;
  const kit = kitForPart(part);
  if (points > 0 && opts.useKits && kit && (opts.inventory?.[kit.id] ?? 0) > 0) {
    kitApplied = true;
    partsCost = Math.max(0, partsCost - kit.price * r.kitCoverageMultiplier);
  }
  const cost = points > 0 ? Math.max(1, Math.round(laborCost + partsCost)) : 0;
  const seconds = points > 0 ? clamp(points * r.secondsPerPoint, r.minSeconds, r.maxSeconds) : 0;
  return {
    part,
    current,
    target,
    points,
    baseCost,
    cost,
    laborCost: Math.round(laborCost),
    partsCost: Math.round(partsCost),
    kitApplied,
    seconds,
  };
}

export function repairQuote(vehicle: ValuableVehicle, parts: readonly RepairPart[], opts: RepairOptions = {}) {
  const lines = parts.map((p) => repairLine(vehicle, p, opts));
  const total = lines.reduce((s, l) => s + l.cost, 0);
  // Jobs run in parallel bays; total time is the longest job plus a little.
  const seconds = lines.reduce((s, l) => Math.max(s, l.seconds), 0) + (lines.filter((l) => l.points > 0).length > 1 ? 2 : 0);
  const after: VehicleCondition = { ...vehicle.condition };
  for (const l of lines) after[l.part] = l.target;
  const valueBefore = marketValue(vehicle);
  const valueAfter = marketValue({ ...vehicle, condition: after });
  return { lines, total, seconds, after, valueBefore, valueAfter };
}

export function washPrice(tierId: string) {
  return ECONOMY.wash.tiers.find((t) => t.id === tierId);
}

export function fuelCost(currentFuel: number): number {
  const missing = clamp(100 - currentFuel, 0, 100);
  return Math.ceil(missing * ECONOMY.fuel.pricePerPercent);
}

// Procedural generation of NPC vehicles and names.

import { DEFAULT_MODS, PAINTS, WHEELS } from '../../shared/customization';
import { ECONOMY } from '../../shared/economy.config';
import type { Vehicle, VehicleCondition } from '../../shared/types';
import { REPAIR_PARTS } from '../../shared/types';
import { clamp, pick, randRange, weightedPick, type Rng } from '../../shared/util';
import { CATALOG_MODELS, type VehicleModel } from '../../shared/vehicles';
import { newId } from '../ids';

const FIRST = ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Jamie', 'Avery', 'Quinn', 'Rowan', 'Harper', 'Emery', 'Dakota', 'Skyler', 'Reese', 'Parker', 'Sage', 'Blair', 'Devon', 'Marlo', 'Nico', 'Ines', 'Tobi', 'Yara', 'Omar', 'Lena', 'Kai', 'Mira', 'Theo'];
const LAST = ['Hartley', 'Okafor', 'Lindqvist', 'Moreau', 'Castillo', 'Novak', 'Brennan', 'Sato', 'Petrov', 'Adeyemi', 'Fischer', 'Duarte', 'Kowalski', 'Mbeki', 'Ricci', 'Varga', 'Holm', 'Quintero', 'Abara', 'Linde'];

export function randomPersonName(rng: Rng): string {
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}

function gaussian(rng: Rng): number {
  // Irwin-Hall approximation of a standard normal.
  return rng() + rng() + rng() + rng() + rng() + rng() - 3;
}

export function pickModel(rng: Rng, opts: { rarityBias?: number } = {}): VehicleModel {
  const bias = opts.rarityBias ?? 0;
  const weights = ECONOMY.marketplace.categoryWeights;
  return weightedPick(rng, CATALOG_MODELS as VehicleModel[], (m) => weights[m.category] * Math.pow(m.rarity, bias - 1.2));
}

export function generateCondition(rng: Rng, quality: number): VehicleCondition {
  const c = {} as VehicleCondition;
  for (const part of REPAIR_PARTS) c[part] = Math.round(clamp(quality + gaussian(rng) * 14, 3, 100));
  c.cleanliness = Math.round(clamp(quality * 0.8 + randRange(rng, -25, 25), 5, 100));
  return c;
}

export function generateNpcVehicle(rng: Rng, opts: { rarityBias?: number; minQuality?: number } = {}): Vehicle {
  const model = pickModel(rng, opts);
  const [cmin, cmax] = ECONOMY.marketplace.conditionRange;
  // Skew towards used-but-okay cars.
  const quality = clamp(randRange(rng, Math.max(cmin, opts.minQuality ?? cmin), cmax) * 0.7 + randRange(rng, cmin, cmax) * 0.3, cmin, cmax);
  const [mmin, mmax] = ECONOMY.marketplace.mileageRange;
  const wear = 1 - quality / 100;
  const classicMult = model.category === 'classic' ? 1.3 : 1;
  const mileage = Math.round(clamp(mmin + (mmax - mmin) * (wear * 0.75 + rng() * 0.25) * classicMult, mmin, mmax * 1.3));
  const mods = { ...DEFAULT_MODS };
  if (rng() < 0.12) mods.paint = pick(rng, PAINTS).id;
  if (rng() < 0.1) mods.wheels = pick(rng, WHEELS).id;
  const now = Date.now();
  return {
    id: newId('veh'),
    modelId: model.id,
    ownerId: null,
    color: pick(rng, model.colors),
    mileage,
    fuel: Math.round(randRange(rng, 12, 85)),
    condition: generateCondition(rng, quality),
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
    createdAt: now,
  };
}

// Vehicle catalog. The regular catalogue uses fictional brands that are original to GetRich Tycoon.
// The exclusive models sold only by the Rare Dealer (see specialVehicles.ts) are real cars.

import { SPECIAL_MODELS } from './specialVehicles';
import type { VehicleCategory } from './types';

export type BodyStyle = 'hatch' | 'sedan' | 'suv' | 'coupe' | 'pickup' | 'van' | 'classic' | 'wagon' | 'bike';

/** Rarity tiers used by the Rare Dealer rotation (see rareMarket.ts). */
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITY_TIERS: readonly RarityTier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export type Aspiration = 'na' | 'turbo' | 'twin_turbo' | 'supercharged' | 'electric';
export type Drivetrain = 'fwd' | 'rwd' | 'awd';

/**
 * Real-world style engine and performance figures. They drive the tuning system, the dyno and the
 * numbers shown to players. The physics works in the game's own (smaller) scale in `perf`, and
 * tuning scales `perf` by the same ratios as these figures (see tuningSystem.ts).
 */
export interface VehicleSpecs {
  kind: 'car' | 'bike';
  /** Peak power (hp) and torque (Nm). */
  hp: number;
  torque: number;
  /** Kerb weight in kg. */
  weight: number;
  /** Top speed in km/h and 0-100 km/h time in seconds. */
  topSpeed: number;
  accel: number;
  /** Rev limit (rpm). Electric motors use their maximum motor speed. */
  redline: number;
  aspiration: Aspiration;
  drive: Drivetrain;
  /** 0 for electric. */
  cylinders: number;
}

export interface VehicleShape {
  style: BodyStyle;
  /** Overall length / width / body height in metres. */
  length: number;
  width: number;
  bodyHeight: number;
  /** Height of the cabin (greenhouse) above the body. */
  cabinHeight: number;
  /** Cabin length as a fraction of total length. */
  cabinLength: number;
  /** Cabin centre offset along the length (-0.5..0.5, positive = forward). */
  cabinOffset: number;
  /** How much narrower the roof is than the body (0-0.4). */
  cabinTaper: number;
  rideHeight: number;
  wheelRadius: number;
  wheelWidth: number;
}

export interface VehiclePerformance {
  /** Top speed in m/s at perfect condition. */
  topSpeed: number;
  /** Forward acceleration m/s^2. */
  accel: number;
  /** Braking deceleration m/s^2. */
  brake: number;
  /** Handling / grip factor ~0.8-1.2. */
  handling: number;
}

export interface VehicleModel {
  id: string;
  brand: string;
  name: string;
  category: VehicleCategory;
  year: number;
  /** Market value at 100% condition, 0 km, demand 1.0. */
  basePrice: number;
  /** 1 = common. Higher = rarer and more valuable, less likely to spawn. */
  rarity: number;
  tier: RarityTier;
  shape: VehicleShape;
  perf: VehiclePerformance;
  specs: VehicleSpecs;
  /** Factory colours. */
  colors: string[];
  description: string;
  /** Only sold by the Rare Dealer: never generated for the used market, auctions or NPC sellers. */
  exclusive?: boolean;
  /** Optional photo (URL or path under client/public). Without one the UI shows a 3D render. */
  image?: string | null;
}

export const BRANDS = [
  { id: 'norda', name: 'Norda', tagline: 'Honest cars for honest roads.' },
  { id: 'voltara', name: 'Voltara', tagline: 'Silent power.' },
  { id: 'velora', name: 'Velora', tagline: 'Comfort, refined.' },
  { id: 'granforge', name: 'Granforge', tagline: 'Built to haul.' },
  { id: 'apexon', name: 'Apexon', tagline: 'Born on the track.' },
  { id: 'solenne', name: 'Solenne', tagline: 'Quiet luxury.' },
  { id: 'harlan', name: 'Harlan & Finch', tagline: 'Timeless coachwork since 1931.' },
] as const;

export const VEHICLE_MODELS: VehicleModel[] = [
  {
    id: 'norda_pixi',
    brand: 'Norda',
    name: 'Pixi',
    category: 'compact',
    year: 2016,
    basePrice: 9_500,
    rarity: 1,
    tier: 'common',
    shape: { style: 'hatch', length: 3.7, width: 1.7, bodyHeight: 0.72, cabinHeight: 0.62, cabinLength: 0.55, cabinOffset: -0.08, cabinTaper: 0.12, rideHeight: 0.28, wheelRadius: 0.3, wheelWidth: 0.2 },
    perf: { topSpeed: 24, accel: 6.2, brake: 11, handling: 1.1 },
    specs: { kind: 'car', hp: 118, torque: 180, weight: 1150, topSpeed: 195, accel: 9.8, redline: 6500, aspiration: 'na', drive: 'fwd', cylinders: 4 },
    colors: ['#e4572e', '#29335c', '#f3a712', '#a8c686', '#f0f0f0', '#669bbc'],
    description: 'A cheerful city hatchback. Cheap to run, cheap to fix.',
  },
  {
    id: 'voltara_luma',
    brand: 'Voltara',
    name: 'Luma EV',
    category: 'compact',
    year: 2021,
    basePrice: 13_500,
    rarity: 1.1,
    tier: 'uncommon',
    shape: { style: 'hatch', length: 3.9, width: 1.75, bodyHeight: 0.7, cabinHeight: 0.64, cabinLength: 0.58, cabinOffset: -0.02, cabinTaper: 0.14, rideHeight: 0.26, wheelRadius: 0.31, wheelWidth: 0.21 },
    perf: { topSpeed: 26, accel: 7.5, brake: 11.5, handling: 1.05 },
    specs: { kind: 'car', hp: 150, torque: 250, weight: 1450, topSpeed: 160, accel: 7.9, redline: 12000, aspiration: 'electric', drive: 'fwd', cylinders: 0 },
    colors: ['#ffffff', '#00a6a6', '#3d3b8e', '#b8b8d1', '#ff6f59'],
    description: 'Compact electric commuter with instant torque.',
  },
  {
    id: 'norda_arlo',
    brand: 'Norda',
    name: 'Arlo',
    category: 'sedan',
    year: 2017,
    basePrice: 16_000,
    rarity: 1,
    tier: 'common',
    shape: { style: 'sedan', length: 4.6, width: 1.8, bodyHeight: 0.75, cabinHeight: 0.6, cabinLength: 0.46, cabinOffset: -0.04, cabinTaper: 0.14, rideHeight: 0.26, wheelRadius: 0.32, wheelWidth: 0.22 },
    perf: { topSpeed: 28, accel: 6.4, brake: 11, handling: 1.0 },
    specs: { kind: 'car', hp: 150, torque: 200, weight: 1350, topSpeed: 205, accel: 9.4, redline: 6600, aspiration: 'na', drive: 'fwd', cylinders: 4 },
    colors: ['#c0c0c0', '#1b263b', '#7d1d3f', '#f5f5f5', '#2f3e46', '#bc6c25'],
    description: 'The sensible family sedan everyone has driven at least once.',
  },
  {
    id: 'velora_serene',
    brand: 'Velora',
    name: 'Serene',
    category: 'sedan',
    year: 2020,
    basePrice: 24_000,
    rarity: 1.05,
    tier: 'common',
    shape: { style: 'sedan', length: 4.8, width: 1.85, bodyHeight: 0.74, cabinHeight: 0.58, cabinLength: 0.45, cabinOffset: -0.05, cabinTaper: 0.16, rideHeight: 0.25, wheelRadius: 0.33, wheelWidth: 0.23 },
    perf: { topSpeed: 31, accel: 7, brake: 12, handling: 1.05 },
    specs: { kind: 'car', hp: 250, torque: 370, weight: 1550, topSpeed: 240, accel: 6.6, redline: 6500, aspiration: 'turbo', drive: 'rwd', cylinders: 4 },
    colors: ['#0b132b', '#e0e1dd', '#6b705c', '#9a031e', '#415a77'],
    description: 'Quiet, smooth and quietly expensive to repair.',
  },
  {
    id: 'granforge_ridgeback',
    brand: 'Granforge',
    name: 'Ridgeback',
    category: 'suv',
    year: 2018,
    basePrice: 31_000,
    rarity: 1,
    tier: 'common',
    shape: { style: 'suv', length: 4.7, width: 1.95, bodyHeight: 0.95, cabinHeight: 0.72, cabinLength: 0.62, cabinOffset: -0.06, cabinTaper: 0.08, rideHeight: 0.42, wheelRadius: 0.4, wheelWidth: 0.27 },
    perf: { topSpeed: 27, accel: 6, brake: 10, handling: 0.9 },
    specs: { kind: 'car', hp: 204, torque: 500, weight: 2350, topSpeed: 175, accel: 10.5, redline: 4400, aspiration: 'turbo', drive: 'awd', cylinders: 4 },
    colors: ['#344e41', '#dad7cd', '#582f0e', '#14213d', '#8d99ae'],
    description: 'Rugged five-seater that shrugs off gravel roads.',
  },
  {
    id: 'solenne_marquee',
    brand: 'Solenne',
    name: 'Marquee',
    category: 'suv',
    year: 2022,
    basePrice: 46_000,
    rarity: 1.25,
    tier: 'uncommon',
    shape: { style: 'suv', length: 5.0, width: 2.0, bodyHeight: 0.98, cabinHeight: 0.7, cabinLength: 0.6, cabinOffset: -0.05, cabinTaper: 0.1, rideHeight: 0.4, wheelRadius: 0.42, wheelWidth: 0.28 },
    perf: { topSpeed: 32, accel: 7, brake: 11, handling: 0.95 },
    specs: { kind: 'car', hp: 340, torque: 450, weight: 2250, topSpeed: 225, accel: 6.9, redline: 6500, aspiration: 'supercharged', drive: 'awd', cylinders: 6 },
    colors: ['#111111', '#f8f9fa', '#3a5a40', '#7f5539', '#274c77'],
    description: 'A premium SUV with a cabin like a hotel lobby.',
  },
  {
    id: 'granforge_hauler',
    brand: 'Granforge',
    name: 'Hauler 2500',
    category: 'truck',
    year: 2015,
    basePrice: 28_000,
    rarity: 1,
    tier: 'common',
    shape: { style: 'pickup', length: 5.6, width: 2.05, bodyHeight: 1.0, cabinHeight: 0.75, cabinLength: 0.34, cabinOffset: 0.12, cabinTaper: 0.06, rideHeight: 0.5, wheelRadius: 0.44, wheelWidth: 0.3 },
    perf: { topSpeed: 26, accel: 5.4, brake: 9, handling: 0.82 },
    specs: { kind: 'car', hp: 400, torque: 555, weight: 2300, topSpeed: 180, accel: 7.2, redline: 6000, aspiration: 'na', drive: 'rwd', cylinders: 8 },
    colors: ['#9d0208', '#f8f9fa', '#003049', '#495057', '#606c38'],
    description: 'Full-size pickup. Tows boats, moves houses.',
  },
  {
    id: 'granforge_packmule',
    brand: 'Granforge',
    name: 'Packmule',
    category: 'utility',
    year: 2014,
    basePrice: 13_000,
    rarity: 1,
    tier: 'common',
    shape: { style: 'pickup', length: 4.6, width: 1.8, bodyHeight: 0.85, cabinHeight: 0.66, cabinLength: 0.36, cabinOffset: 0.12, cabinTaper: 0.06, rideHeight: 0.36, wheelRadius: 0.34, wheelWidth: 0.23 },
    perf: { topSpeed: 23, accel: 5.4, brake: 9.5, handling: 0.92 },
    specs: { kind: 'car', hp: 160, torque: 240, weight: 1650, topSpeed: 165, accel: 11.5, redline: 5800, aspiration: 'na', drive: 'rwd', cylinders: 4 },
    colors: ['#f2e8cf', '#386641', '#bc4749', '#5c677d'],
    description: 'Small work ute with a big heart and a leaky tailgate.',
  },
  {
    id: 'norda_workmate',
    brand: 'Norda',
    name: 'Workmate Van',
    category: 'utility',
    year: 2016,
    basePrice: 15_500,
    rarity: 1,
    tier: 'common',
    shape: { style: 'van', length: 4.9, width: 1.95, bodyHeight: 1.05, cabinHeight: 0.85, cabinLength: 0.86, cabinOffset: -0.06, cabinTaper: 0.03, rideHeight: 0.34, wheelRadius: 0.34, wheelWidth: 0.24 },
    perf: { topSpeed: 23, accel: 5, brake: 9, handling: 0.85 },
    specs: { kind: 'car', hp: 130, torque: 340, weight: 1900, topSpeed: 160, accel: 13.5, redline: 4500, aspiration: 'turbo', drive: 'fwd', cylinders: 4 },
    colors: ['#ffffff', '#ffd166', '#118ab2', '#adb5bd'],
    description: 'Boxy panel van. Every small business needs one.',
  },
  {
    id: 'apexon_strix',
    brand: 'Apexon',
    name: 'Strix',
    category: 'sports',
    year: 2019,
    basePrice: 58_000,
    rarity: 1.3,
    tier: 'uncommon',
    shape: { style: 'coupe', length: 4.4, width: 1.9, bodyHeight: 0.62, cabinHeight: 0.45, cabinLength: 0.38, cabinOffset: -0.08, cabinTaper: 0.2, rideHeight: 0.18, wheelRadius: 0.34, wheelWidth: 0.28 },
    perf: { topSpeed: 38, accel: 10.5, brake: 14, handling: 1.2 },
    specs: { kind: 'car', hp: 385, torque: 450, weight: 1450, topSpeed: 293, accel: 4.2, redline: 7400, aspiration: 'turbo', drive: 'rwd', cylinders: 6 },
    colors: ['#ffbe0b', '#d00000', '#3a86ff', '#212529', '#8338ec'],
    description: 'Lightweight coupe that lives for corners.',
  },
  {
    id: 'apexon_vanta',
    brand: 'Apexon',
    name: 'Vanta GT',
    category: 'sports',
    year: 2023,
    basePrice: 86_000,
    rarity: 1.6,
    tier: 'rare',
    shape: { style: 'coupe', length: 4.6, width: 1.98, bodyHeight: 0.6, cabinHeight: 0.42, cabinLength: 0.34, cabinOffset: -0.1, cabinTaper: 0.22, rideHeight: 0.16, wheelRadius: 0.36, wheelWidth: 0.3 },
    perf: { topSpeed: 43, accel: 12.5, brake: 15, handling: 1.25 },
    specs: { kind: 'car', hp: 620, torque: 700, weight: 1480, topSpeed: 330, accel: 3.0, redline: 8500, aspiration: 'twin_turbo', drive: 'rwd', cylinders: 8 },
    colors: ['#0d0d0d', '#e63946', '#f1faee', '#2a9d8f', '#ff7b00'],
    description: 'Twin-turbo grand tourer. Loud, fast, and thirsty.',
  },
  {
    id: 'velora_aurelian',
    brand: 'Velora',
    name: 'Aurelian',
    category: 'luxury',
    year: 2022,
    basePrice: 96_000,
    rarity: 1.5,
    tier: 'rare',
    shape: { style: 'sedan', length: 5.2, width: 1.95, bodyHeight: 0.78, cabinHeight: 0.6, cabinLength: 0.46, cabinOffset: -0.06, cabinTaper: 0.14, rideHeight: 0.24, wheelRadius: 0.36, wheelWidth: 0.26 },
    perf: { topSpeed: 36, accel: 8.5, brake: 13, handling: 1.05 },
    specs: { kind: 'car', hp: 450, torque: 650, weight: 2100, topSpeed: 250, accel: 4.9, redline: 6500, aspiration: 'twin_turbo', drive: 'awd', cylinders: 8 },
    colors: ['#000000', '#e9ecef', '#1d3557', '#6d6875', '#3c1518'],
    description: 'Flagship limousine with massaging seats and a whisper-quiet V8.',
  },
  {
    id: 'solenne_monarch',
    brand: 'Solenne',
    name: 'Monarch',
    category: 'luxury',
    year: 2024,
    basePrice: 142_000,
    rarity: 1.9,
    tier: 'epic',
    shape: { style: 'coupe', length: 5.0, width: 2.0, bodyHeight: 0.68, cabinHeight: 0.5, cabinLength: 0.4, cabinOffset: -0.12, cabinTaper: 0.18, rideHeight: 0.2, wheelRadius: 0.38, wheelWidth: 0.3 },
    perf: { topSpeed: 41, accel: 10, brake: 14, handling: 1.12 },
    specs: { kind: 'car', hp: 560, torque: 700, weight: 1850, topSpeed: 300, accel: 3.9, redline: 7000, aspiration: 'twin_turbo', drive: 'rwd', cylinders: 12 },
    colors: ['#f8f4e3', '#2b2d42', '#7b2cbf', '#b08968', '#0b3954'],
    description: 'Hand-built grand coupe. Rare, dramatic and very expensive.',
  },
  {
    id: 'harlan_bellwether',
    brand: 'Harlan & Finch',
    name: "Bellwether '62",
    category: 'classic',
    year: 1962,
    basePrice: 36_000,
    rarity: 1.4,
    tier: 'rare',
    shape: { style: 'classic', length: 5.1, width: 1.95, bodyHeight: 0.8, cabinHeight: 0.55, cabinLength: 0.42, cabinOffset: -0.04, cabinTaper: 0.12, rideHeight: 0.28, wheelRadius: 0.35, wheelWidth: 0.24 },
    perf: { topSpeed: 27, accel: 5.5, brake: 8.5, handling: 0.85 },
    specs: { kind: 'car', hp: 300, torque: 490, weight: 1700, topSpeed: 180, accel: 8.5, redline: 5000, aspiration: 'na', drive: 'rwd', cylinders: 8 },
    colors: ['#7fc8f8', '#f4acb7', '#fefae0', '#9e2a2b', '#335c67'],
    description: 'Chrome, fins and a lazy straight-six. A cruising icon.',
  },
  {
    id: 'harlan_duchess',
    brand: 'Harlan & Finch',
    name: "Duchess '58",
    category: 'classic',
    year: 1958,
    basePrice: 74_000,
    rarity: 2.1,
    tier: 'epic',
    shape: { style: 'classic', length: 4.4, width: 1.8, bodyHeight: 0.7, cabinHeight: 0.45, cabinLength: 0.34, cabinOffset: -0.12, cabinTaper: 0.16, rideHeight: 0.24, wheelRadius: 0.36, wheelWidth: 0.22 },
    perf: { topSpeed: 32, accel: 7, brake: 9, handling: 0.95 },
    specs: { kind: 'car', hp: 265, torque: 350, weight: 1250, topSpeed: 240, accel: 6.5, redline: 6000, aspiration: 'na', drive: 'rwd', cylinders: 6 },
    colors: ['#c1121f', '#003049', '#fdf0d5', '#283618', '#e9c46a'],
    description: 'Rare two-seat roadster. Collectors fight over clean examples.',
  },
];

/** Models that appear on the used market, at auctions and with NPC sellers. */
export const CATALOG_MODELS: readonly VehicleModel[] = VEHICLE_MODELS.filter((m) => !m.exclusive);

VEHICLE_MODELS.push(...SPECIAL_MODELS);

/**
 * Service vehicles that are never sold: the police interceptor (a Velora Serene body with a
 * tuned twin-turbo V8 and pursuit tyres). Found by getModel() but not part of the catalogue.
 */
export const POLICE_MODEL: VehicleModel = {
  id: 'police',
  brand: 'Police',
  name: 'Interceptor',
  category: 'sedan',
  year: 2023,
  basePrice: 0,
  rarity: 1,
  tier: 'common',
  shape: { style: 'sedan', length: 4.8, width: 1.85, bodyHeight: 0.74, cabinHeight: 0.58, cabinLength: 0.45, cabinOffset: -0.05, cabinTaper: 0.16, rideHeight: 0.25, wheelRadius: 0.33, wheelWidth: 0.23 },
  perf: { topSpeed: 36, accel: 9, brake: 13.5, handling: 1.12 },
  specs: { kind: 'car', hp: 480, torque: 640, weight: 1850, topSpeed: 275, accel: 4.4, redline: 6800, aspiration: 'twin_turbo', drive: 'awd', cylinders: 8 },
  colors: ['#f4f4f2'],
  description: 'Pursuit-rated interceptor. You do not want to see it in your mirrors.',
  exclusive: true,
};

const MODEL_INDEX = new Map([...VEHICLE_MODELS, POLICE_MODEL].map((m) => [m.id, m]));

export function getModel(modelId: string): VehicleModel {
  const m = MODEL_INDEX.get(modelId);
  if (!m) throw new Error(`Unknown vehicle model: ${modelId}`);
  return m;
}

export function findModel(modelId: string): VehicleModel | undefined {
  return MODEL_INDEX.get(modelId);
}

export function modelDisplayName(modelId: string): string {
  const m = findModel(modelId);
  return m ? `${m.brand} ${m.name}` : 'Unknown vehicle';
}

export const CATEGORY_LABELS: Record<VehicleCategory, string> = {
  compact: 'Compact',
  sedan: 'Sedan',
  suv: 'SUV',
  sports: 'Sports',
  luxury: 'Luxury',
  truck: 'Truck',
  classic: 'Classic',
  utility: 'Utility',
};

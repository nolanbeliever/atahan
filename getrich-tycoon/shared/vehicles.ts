// Vehicle catalog. All brands and models are fictional and original to GetRich Tycoon.

import type { VehicleCategory } from './types';

export type BodyStyle = 'hatch' | 'sedan' | 'suv' | 'coupe' | 'pickup' | 'van' | 'classic' | 'wagon';

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
  shape: VehicleShape;
  perf: VehiclePerformance;
  /** Factory colours. */
  colors: string[];
  description: string;
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
    shape: { style: 'hatch', length: 3.7, width: 1.7, bodyHeight: 0.72, cabinHeight: 0.62, cabinLength: 0.55, cabinOffset: -0.08, cabinTaper: 0.12, rideHeight: 0.28, wheelRadius: 0.3, wheelWidth: 0.2 },
    perf: { topSpeed: 24, accel: 6.2, brake: 11, handling: 1.1 },
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
    shape: { style: 'hatch', length: 3.9, width: 1.75, bodyHeight: 0.7, cabinHeight: 0.64, cabinLength: 0.58, cabinOffset: -0.02, cabinTaper: 0.14, rideHeight: 0.26, wheelRadius: 0.31, wheelWidth: 0.21 },
    perf: { topSpeed: 26, accel: 7.5, brake: 11.5, handling: 1.05 },
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
    shape: { style: 'sedan', length: 4.6, width: 1.8, bodyHeight: 0.75, cabinHeight: 0.6, cabinLength: 0.46, cabinOffset: -0.04, cabinTaper: 0.14, rideHeight: 0.26, wheelRadius: 0.32, wheelWidth: 0.22 },
    perf: { topSpeed: 28, accel: 6.4, brake: 11, handling: 1.0 },
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
    shape: { style: 'sedan', length: 4.8, width: 1.85, bodyHeight: 0.74, cabinHeight: 0.58, cabinLength: 0.45, cabinOffset: -0.05, cabinTaper: 0.16, rideHeight: 0.25, wheelRadius: 0.33, wheelWidth: 0.23 },
    perf: { topSpeed: 31, accel: 7, brake: 12, handling: 1.05 },
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
    shape: { style: 'suv', length: 4.7, width: 1.95, bodyHeight: 0.95, cabinHeight: 0.72, cabinLength: 0.62, cabinOffset: -0.06, cabinTaper: 0.08, rideHeight: 0.42, wheelRadius: 0.4, wheelWidth: 0.27 },
    perf: { topSpeed: 27, accel: 6, brake: 10, handling: 0.9 },
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
    shape: { style: 'suv', length: 5.0, width: 2.0, bodyHeight: 0.98, cabinHeight: 0.7, cabinLength: 0.6, cabinOffset: -0.05, cabinTaper: 0.1, rideHeight: 0.4, wheelRadius: 0.42, wheelWidth: 0.28 },
    perf: { topSpeed: 32, accel: 7, brake: 11, handling: 0.95 },
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
    shape: { style: 'pickup', length: 5.6, width: 2.05, bodyHeight: 1.0, cabinHeight: 0.75, cabinLength: 0.34, cabinOffset: 0.12, cabinTaper: 0.06, rideHeight: 0.5, wheelRadius: 0.44, wheelWidth: 0.3 },
    perf: { topSpeed: 26, accel: 5.4, brake: 9, handling: 0.82 },
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
    shape: { style: 'pickup', length: 4.6, width: 1.8, bodyHeight: 0.85, cabinHeight: 0.66, cabinLength: 0.36, cabinOffset: 0.12, cabinTaper: 0.06, rideHeight: 0.36, wheelRadius: 0.34, wheelWidth: 0.23 },
    perf: { topSpeed: 23, accel: 5.4, brake: 9.5, handling: 0.92 },
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
    shape: { style: 'van', length: 4.9, width: 1.95, bodyHeight: 1.05, cabinHeight: 0.85, cabinLength: 0.86, cabinOffset: -0.06, cabinTaper: 0.03, rideHeight: 0.34, wheelRadius: 0.34, wheelWidth: 0.24 },
    perf: { topSpeed: 23, accel: 5, brake: 9, handling: 0.85 },
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
    shape: { style: 'coupe', length: 4.4, width: 1.9, bodyHeight: 0.62, cabinHeight: 0.45, cabinLength: 0.38, cabinOffset: -0.08, cabinTaper: 0.2, rideHeight: 0.18, wheelRadius: 0.34, wheelWidth: 0.28 },
    perf: { topSpeed: 38, accel: 10.5, brake: 14, handling: 1.2 },
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
    shape: { style: 'coupe', length: 4.6, width: 1.98, bodyHeight: 0.6, cabinHeight: 0.42, cabinLength: 0.34, cabinOffset: -0.1, cabinTaper: 0.22, rideHeight: 0.16, wheelRadius: 0.36, wheelWidth: 0.3 },
    perf: { topSpeed: 43, accel: 12.5, brake: 15, handling: 1.25 },
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
    shape: { style: 'sedan', length: 5.2, width: 1.95, bodyHeight: 0.78, cabinHeight: 0.6, cabinLength: 0.46, cabinOffset: -0.06, cabinTaper: 0.14, rideHeight: 0.24, wheelRadius: 0.36, wheelWidth: 0.26 },
    perf: { topSpeed: 36, accel: 8.5, brake: 13, handling: 1.05 },
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
    shape: { style: 'coupe', length: 5.0, width: 2.0, bodyHeight: 0.68, cabinHeight: 0.5, cabinLength: 0.4, cabinOffset: -0.12, cabinTaper: 0.18, rideHeight: 0.2, wheelRadius: 0.38, wheelWidth: 0.3 },
    perf: { topSpeed: 41, accel: 10, brake: 14, handling: 1.12 },
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
    shape: { style: 'classic', length: 5.1, width: 1.95, bodyHeight: 0.8, cabinHeight: 0.55, cabinLength: 0.42, cabinOffset: -0.04, cabinTaper: 0.12, rideHeight: 0.28, wheelRadius: 0.35, wheelWidth: 0.24 },
    perf: { topSpeed: 27, accel: 5.5, brake: 8.5, handling: 0.85 },
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
    shape: { style: 'classic', length: 4.4, width: 1.8, bodyHeight: 0.7, cabinHeight: 0.45, cabinLength: 0.34, cabinOffset: -0.12, cabinTaper: 0.16, rideHeight: 0.24, wheelRadius: 0.36, wheelWidth: 0.22 },
    perf: { topSpeed: 32, accel: 7, brake: 9, handling: 0.95 },
    colors: ['#c1121f', '#003049', '#fdf0d5', '#283618', '#e9c46a'],
    description: 'Rare two-seat roadster. Collectors fight over clean examples.',
  },
];

const MODEL_INDEX = new Map(VEHICLE_MODELS.map((m) => [m.id, m]));

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

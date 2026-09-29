// Legendary vehicles sold only by the Rare Dealer (see rareMarket.ts).
//
// `specialVehicles` is the source list: name, rarity, drop chance, price, headline stats and an
// optional photo. `SPECIAL_MODELS` turns each entry into a full catalogue model (size, physics,
// engine specs) so it can be bought, driven, tuned, displayed and sold like any other vehicle.
//
// Photos: put a file in client/public/cars/ (for example client/public/cars/bmw_m3_g80.jpg) and set
// `image: '/cars/bmw_m3_g80.jpg'`. Without a photo the game shows a 3D render of the car.

import type { VehicleCategory } from './types';
import type { Aspiration, Drivetrain, VehicleModel, VehicleShape } from './vehicles';

export interface SpecialVehicle {
  id: string;
  name: string;
  rarity: 'Legendary';
  /** Maximum chance (0-1) that this vehicle shows up in one Rare Dealer rotation. */
  dropChance: number;
  /** Price of a new one, in dollars. */
  price: number;
  /** hp, top speed (km/h), 0-100 km/h (s). */
  baseStats: { hp: number; topSpeed: number; accel: number };
  image: string | null;
}

export const specialVehicles: SpecialVehicle[] = [
  {
    id: 'bmw_i7_g70',
    name: 'BMW i7 / 7 Series (G70)',
    rarity: 'Legendary',
    dropChance: 0.05, // 5%
    price: 250000,
    baseStats: { hp: 544, topSpeed: 240, accel: 4.7 },
    image: null,
  },
  {
    id: 'bmw_m3_g80',
    name: 'BMW M3 Competition (G80)',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 180000,
    baseStats: { hp: 510, topSpeed: 290, accel: 3.9 },
    image: null,
  },
  {
    id: 'bmw_x7_facelift',
    name: 'BMW X7 M60i',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 210000,
    baseStats: { hp: 530, topSpeed: 250, accel: 4.7 },
    image: null,
  },
  {
    id: 'bmw_5_g60',
    name: 'BMW 5 Series (G60)',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 120000,
    baseStats: { hp: 380, topSpeed: 250, accel: 5.1 },
    image: null,
  },
  {
    id: 'bmw_gs_moto',
    name: 'BMW F 900 GS / Adventure',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 45000,
    baseStats: { hp: 105, topSpeed: 210, accel: 3.6 },
    image: null,
  },
  {
    id: 'bmw_m8_comp',
    name: 'BMW M8 Competition Coupe',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 280000,
    baseStats: { hp: 625, topSpeed: 305, accel: 3.2 },
    image: null,
  },
  {
    id: 'mercedes_amg_gt',
    name: 'Mercedes-AMG GT Coupe',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 290000,
    baseStats: { hp: 585, topSpeed: 315, accel: 3.2 },
    image: null,
  },
  {
    id: 'mercedes_e_w214',
    name: 'Mercedes-Benz E-Class (W214)',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 130000,
    baseStats: { hp: 381, topSpeed: 250, accel: 4.8 },
    image: null,
  },
  {
    id: 'mercedes_g_class',
    name: 'Mercedes-Benz G-Class (G63 AMG)',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 320000,
    baseStats: { hp: 585, topSpeed: 240, accel: 4.5 },
    image: null,
  },
  {
    id: 'audi_rs5_coupe',
    name: 'Audi RS5 Coupe',
    rarity: 'Legendary',
    dropChance: 0.05,
    price: 175000,
    baseStats: { hp: 450, topSpeed: 280, accel: 3.9 },
    image: null,
  },
];

/** Everything else a catalogue model needs, per special vehicle. */
interface SpecialDetails {
  brand: string;
  model: string;
  category: VehicleCategory;
  year: number;
  torque: number;
  weight: number;
  redline: number;
  aspiration: Aspiration;
  drive: Drivetrain;
  cylinders: number;
  kind?: 'car' | 'bike';
  /** Length, width, wheel radius / width (m). */
  size: [number, number, number, number];
  style: VehicleShape['style'];
  brake: number;
  handling: number;
  colors: string[];
  description: string;
}

const DETAILS: Record<string, SpecialDetails> = {
  bmw_i7_g70: {
    brand: 'BMW', model: 'i7 (G70)', category: 'luxury', year: 2023, torque: 745, weight: 2640, redline: 14000,
    aspiration: 'electric', drive: 'awd', cylinders: 0, size: [5.39, 1.95, 0.37, 0.26], style: 'sedan', brake: 13, handling: 1.02,
    colors: ['#0d0e12', '#f2f2f0', '#3b3f47', '#1f3a5f', '#6f6a64'],
    description: 'Flagship electric limousine with split headlights, an illuminated grille and a theatre screen in the back.',
  },
  bmw_m3_g80: {
    brand: 'BMW', model: 'M3 Competition (G80)', category: 'sports', year: 2022, torque: 650, weight: 1730, redline: 7200,
    aspiration: 'twin_turbo', drive: 'rwd', cylinders: 6, size: [4.79, 1.9, 0.35, 0.28], style: 'sedan', brake: 14.5, handling: 1.2,
    colors: ['#0b4f3c', '#1c4fa0', '#e8e8e4', '#111215', '#7d8288', '#c9b037'],
    description: 'Twin-turbo straight six, wide arches, quad pipes and that tall grille. A four-door race car.',
  },
  bmw_x7_facelift: {
    brand: 'BMW', model: 'X7 M60i', category: 'luxury', year: 2023, torque: 750, weight: 2525, redline: 6800,
    aspiration: 'twin_turbo', drive: 'awd', cylinders: 8, size: [5.18, 2.0, 0.42, 0.29], style: 'suv', brake: 12.5, handling: 0.98,
    colors: ['#0d0e12', '#f2f2f0', '#3a4a5c', '#5b5e62', '#2b3a33'],
    description: 'Seven-seat luxury SUV with a twin-turbo V8 and split LED lights.',
  },
  bmw_5_g60: {
    brand: 'BMW', model: '5 Series (G60)', category: 'luxury', year: 2024, torque: 540, weight: 1900, redline: 7000,
    aspiration: 'turbo', drive: 'awd', cylinders: 6, size: [5.06, 1.9, 0.36, 0.26], style: 'sedan', brake: 13, handling: 1.08,
    colors: ['#1f3a5f', '#f2f2f0', '#0d0e12', '#8a8d91', '#5a2330'],
    description: 'The executive saloon benchmark: quiet, fast and packed with tech.',
  },
  bmw_gs_moto: {
    brand: 'BMW', model: 'F 900 GS', category: 'sports', year: 2024, torque: 93, weight: 219, redline: 9500,
    aspiration: 'na', drive: 'rwd', cylinders: 2, kind: 'bike', size: [2.3, 0.95, 0.34, 0.12], style: 'bike', brake: 12, handling: 1.15,
    colors: ['#f2f2f0', '#1c4fa0', '#c1121f', '#1d1e22'],
    description: 'Adventure bike with a parallel twin, long-travel suspension and a beak that goes anywhere.',
  },
  bmw_m8_comp: {
    brand: 'BMW', model: 'M8 Competition Coupe', category: 'sports', year: 2022, torque: 750, weight: 1885, redline: 7200,
    aspiration: 'twin_turbo', drive: 'awd', cylinders: 8, size: [4.87, 1.91, 0.36, 0.29], style: 'coupe', brake: 14.5, handling: 1.18,
    colors: ['#1c4fa0', '#111215', '#e8e8e4', '#6d7075', '#7a1d25'],
    description: 'Big grand tourer coupe with a 625 hp V8, carbon roof and quad exhausts.',
  },
  mercedes_amg_gt: {
    brand: 'Mercedes-AMG', model: 'GT Coupe', category: 'sports', year: 2024, torque: 800, weight: 1970, redline: 7000,
    aspiration: 'twin_turbo', drive: 'awd', cylinders: 8, size: [4.73, 1.98, 0.36, 0.3], style: 'coupe', brake: 15, handling: 1.22,
    colors: ['#b8b9b4', '#111215', '#e9e9e4', '#c1121f', '#d9b235'],
    description: 'Long hood, fastback, vertical-slat grille and a hand-built twin-turbo V8.',
  },
  mercedes_e_w214: {
    brand: 'Mercedes-Benz', model: 'E-Class (W214)', category: 'luxury', year: 2024, torque: 500, weight: 1950, redline: 6500,
    aspiration: 'turbo', drive: 'awd', cylinders: 6, size: [4.95, 1.88, 0.35, 0.25], style: 'sedan', brake: 13, handling: 1.05,
    colors: ['#111215', '#e9e9e4', '#8c9095', '#1b2b44', '#5b1a22'],
    description: 'Comfort-first executive saloon with a connected light band and a glossy grille.',
  },
  mercedes_g_class: {
    brand: 'Mercedes-AMG', model: 'G 63', category: 'luxury', year: 2024, torque: 850, weight: 2560, redline: 6500,
    aspiration: 'twin_turbo', drive: 'awd', cylinders: 8, size: [4.72, 1.98, 0.43, 0.3], style: 'suv', brake: 12, handling: 0.9,
    colors: ['#111215', '#e9e9e4', '#5c6146', '#8c9095', '#7a1d25'],
    description: 'A box on wheels that everybody wants: round lights, side pipes and a spare wheel on the door.',
  },
  audi_rs5_coupe: {
    brand: 'Audi', model: 'RS5 Coupe', category: 'sports', year: 2023, torque: 600, weight: 1780, redline: 6800,
    aspiration: 'twin_turbo', drive: 'awd', cylinders: 6, size: [4.72, 1.86, 0.35, 0.28], style: 'coupe', brake: 14, handling: 1.18,
    colors: ['#7e8286', '#c1121f', '#e9e9e4', '#111215', '#1f3a5f'],
    description: 'Quattro all-wheel drive, a big honeycomb grille and a twin-turbo V6.',
  },
};

/** Numeric rarity of legendary models (collector premium, see valuation.rarityFactor). */
export const LEGENDARY_RARITY = 2.5;
const RARITY_VALUE_SCALE = 0.1; // mirrors ECONOMY.valuation.rarityValueScale (checked by a unit test)

/** Game-scale physics from real figures, matched to the regular catalogue. */
function gameTopSpeed(kmh: number): number {
  return Math.round((24 + (kmh - 190) * 0.146) * 10) / 10;
}
function gameAccel(zeroTo100: number): number {
  return Math.round(12.5 * Math.pow(3 / zeroTo100, 0.63) * 10) / 10;
}

export const SPECIAL_MODELS: VehicleModel[] = specialVehicles.map((sv) => {
  const x = DETAILS[sv.id];
  if (!x) throw new Error(`Missing details for special vehicle ${sv.id}`);
  const [length, width, wheelRadius, wheelWidth] = x.size;
  const bike = x.kind === 'bike';
  return {
    id: sv.id,
    brand: x.brand,
    name: x.model,
    category: x.category,
    year: x.year,
    // A new one at neutral demand is worth exactly the listed price.
    basePrice: Math.round(sv.price / (1 + (LEGENDARY_RARITY - 1) * RARITY_VALUE_SCALE) / 100) * 100,
    rarity: LEGENDARY_RARITY,
    tier: 'legendary',
    exclusive: true,
    image: sv.image,
    shape: {
      style: x.style,
      length,
      width,
      bodyHeight: bike ? 0.9 : 0.75,
      cabinHeight: bike ? 0.4 : 0.6,
      cabinLength: 0.45,
      cabinOffset: -0.04,
      cabinTaper: 0.14,
      rideHeight: bike ? 0.3 : 0.25,
      wheelRadius,
      wheelWidth,
    },
    perf: { topSpeed: gameTopSpeed(sv.baseStats.topSpeed), accel: gameAccel(sv.baseStats.accel), brake: x.brake, handling: x.handling },
    specs: {
      kind: x.kind ?? 'car',
      hp: sv.baseStats.hp,
      torque: x.torque,
      weight: x.weight,
      topSpeed: sv.baseStats.topSpeed,
      accel: sv.baseStats.accel,
      redline: x.redline,
      aspiration: x.aspiration,
      drive: x.drive,
      cylinders: x.cylinders,
    },
    colors: x.colors,
    description: x.description,
  };
});

/** Drop chance cap per special vehicle id. */
export const SPECIAL_DROP_CHANCE: Record<string, number> = Object.fromEntries(specialVehicles.map((s) => [s.id, s.dropChance]));

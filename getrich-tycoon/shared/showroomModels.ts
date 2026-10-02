// Cars sold only in the themed showrooms on the far shore (shared/showrooms.ts): JDM legends,
// hypercars, American muscle, super-SUVs and electric hypercars. Real cars with real figures (no
// logos on the bodies). Like the Rare Dealer's exclusives they never turn up on the used market,
// at auctions or with NPC sellers, and they stay out of the Rare Dealer's rotation.

import type { VehicleCategory } from './types';
import type { Aspiration, Drivetrain, RarityTier, VehicleModel, VehicleShape } from './vehicles';

/** The themed showrooms (see showrooms.ts for their names and buildings). */
export type ShowroomId = 'jdm' | 'german' | 'hyper' | 'classic' | 'moto' | 'offroad' | 'blackmarket' | 'ev';

interface ShowroomCar {
  id: string;
  showroom: ShowroomId;
  brand: string;
  name: string;
  category: VehicleCategory;
  year: number;
  /** New price in dollars (at neutral demand). */
  price: number;
  tier: RarityTier;
  hp: number;
  torque: number;
  weight: number;
  /** Top speed (km/h) and 0-100 km/h (s). */
  topSpeed: number;
  accel: number;
  redline: number;
  aspiration: Aspiration;
  drive: Drivetrain;
  cylinders: number;
  /** Length, width, wheel radius, wheel width (m). */
  size: [number, number, number, number];
  style: VehicleShape['style'];
  /** Ride height, body and cabin heights (m): their sum is the roof. */
  heights: [number, number, number];
  brake: number;
  handling: number;
  colors: string[];
  description: string;
}

const CARS: ShowroomCar[] = [
  // ---------------------------------------------------------------- JDM Underground
  {
    id: 'toyota_supra_a80', showroom: 'jdm', brand: 'Toyota', name: 'Supra RZ (A80)', category: 'sports', year: 1998, price: 120_000, tier: 'epic',
    hp: 330, torque: 451, weight: 1510, topSpeed: 285, accel: 4.6, redline: 6800, aspiration: 'twin_turbo', drive: 'rwd', cylinders: 6,
    size: [4.52, 1.81, 0.33, 0.25], style: 'coupe', heights: [0.16, 0.62, 0.5], brake: 13.5, handling: 1.15,
    colors: ['#d62828', '#f2f2f0', '#111215', '#2a3a8c', '#f4a261'],
    description: 'The 2JZ twin-turbo straight six that tuners love: smooth curves, round tail lights, a hoop wing.',
  },
  {
    id: 'nissan_skyline_r34', showroom: 'jdm', brand: 'Nissan', name: 'Skyline GT-R V-Spec (R34)', category: 'sports', year: 1999, price: 180_000, tier: 'epic',
    hp: 330, torque: 392, weight: 1560, topSpeed: 280, accel: 4.7, redline: 8000, aspiration: 'twin_turbo', drive: 'awd', cylinders: 6,
    size: [4.6, 1.79, 0.33, 0.25], style: 'coupe', heights: [0.16, 0.66, 0.54], brake: 14, handling: 1.2,
    colors: ['#2a52be', '#f2f2f0', '#5a5d62', '#111215', '#7a1d25'],
    description: 'Godzilla: RB26 twin-turbo six, ATTESA all-wheel drive, four round tail lights and a big wing.',
  },
  {
    id: 'mazda_rx7_fd', showroom: 'jdm', brand: 'Mazda', name: 'RX-7 Spirit R (FD)', category: 'sports', year: 2002, price: 85_000, tier: 'epic',
    hp: 280, torque: 314, weight: 1270, topSpeed: 260, accel: 5.0, redline: 8000, aspiration: 'twin_turbo', drive: 'rwd', cylinders: 2,
    size: [4.29, 1.76, 0.32, 0.24], style: 'coupe', heights: [0.15, 0.58, 0.5], brake: 13, handling: 1.24,
    colors: ['#c1121f', '#f2c230', '#f2f2f0', '#111215', '#3b5b8c'],
    description: 'Twin-rotor, twin-turbo, light as a feather and all curves. Revs to 8,000 and sings.',
  },
  // ---------------------------------------------------------------- Hypercar / Exotics Pavilion
  {
    id: 'bugatti_chiron', showroom: 'hyper', brand: 'Bugatti', name: 'Chiron Sport', category: 'sports', year: 2021, price: 3_300_000, tier: 'legendary',
    hp: 1500, torque: 1600, weight: 1995, topSpeed: 420, accel: 2.4, redline: 6800, aspiration: 'twin_turbo', drive: 'awd', cylinders: 16,
    size: [4.54, 2.04, 0.37, 0.33], style: 'coupe', heights: [0.12, 0.62, 0.47], brake: 18, handling: 1.3,
    colors: ['#1d3557', '#111215', '#c1121f', '#e9e9e4', '#3a86ff'],
    description: 'Quad-turbo W16, a horseshoe grille, the C-line down its flank and 420 km/h.',
  },
  {
    id: 'lamborghini_aventador', showroom: 'hyper', brand: 'Lamborghini', name: 'Aventador SVJ', category: 'sports', year: 2021, price: 520_000, tier: 'legendary',
    hp: 770, torque: 720, weight: 1525, topSpeed: 350, accel: 2.8, redline: 8700, aspiration: 'na', drive: 'awd', cylinders: 12,
    size: [4.94, 2.1, 0.36, 0.33], style: 'coupe', heights: [0.12, 0.58, 0.44], brake: 17, handling: 1.32,
    colors: ['#78be20', '#f2c230', '#e85d04', '#111215', '#e9e9e4'],
    description: 'A screaming naturally aspirated V12 behind your head, scissor doors and active aero.',
  },
  {
    id: 'ferrari_sf90', showroom: 'hyper', brand: 'Ferrari', name: 'SF90 Stradale', category: 'sports', year: 2021, price: 525_000, tier: 'legendary',
    hp: 986, torque: 800, weight: 1570, topSpeed: 340, accel: 2.5, redline: 8000, aspiration: 'twin_turbo', drive: 'awd', cylinders: 8,
    size: [4.71, 1.97, 0.36, 0.32], style: 'coupe', heights: [0.12, 0.6, 0.47], brake: 17, handling: 1.3,
    colors: ['#d00000', '#f2c230', '#111215', '#e9e9e4', '#2a3a8c'],
    description: 'Plug-in hybrid V8 with three electric motors: almost 1,000 hp and four-wheel drive.',
  },
  // ---------------------------------------------------------------- Classic & Vintage Garage
  {
    id: 'ford_mustang_boss429', showroom: 'classic', brand: 'Ford', name: 'Mustang Boss 429', category: 'classic', year: 1969, price: 260_000, tier: 'epic',
    hp: 375, torque: 610, weight: 1610, topSpeed: 200, accel: 5.3, redline: 6000, aspiration: 'na', drive: 'rwd', cylinders: 8,
    size: [4.77, 1.82, 0.36, 0.24], style: 'classic', heights: [0.2, 0.7, 0.42], brake: 10, handling: 0.96,
    colors: ['#1b3b6f', '#111215', '#c1121f', '#f2f2f0', '#2d6a4f'],
    description: 'A homologation special: the huge 429 V8 shoehorned into a fastback, hood scoop and all.',
  },
  {
    id: 'dodge_charger_rt70', showroom: 'classic', brand: 'Dodge', name: 'Charger R/T 440', category: 'classic', year: 1970, price: 150_000, tier: 'epic',
    hp: 375, torque: 651, weight: 1700, topSpeed: 210, accel: 5.8, redline: 5800, aspiration: 'na', drive: 'rwd', cylinders: 8,
    size: [5.28, 1.95, 0.36, 0.25], style: 'classic', heights: [0.2, 0.72, 0.42], brake: 10, handling: 0.9,
    colors: ['#111215', '#e85d04', '#f4d35e', '#7a1d25', '#2d6a4f'],
    description: 'Hidden headlights behind a full-width grille, coke-bottle hips and a 440 Magnum V8.',
  },
  // ---------------------------------------------------------------- Off-Road & SUV Empire
  {
    id: 'lamborghini_urus', showroom: 'offroad', brand: 'Lamborghini', name: 'Urus Performante', category: 'luxury', year: 2023, price: 290_000, tier: 'epic',
    hp: 666, torque: 850, weight: 2150, topSpeed: 306, accel: 3.3, redline: 6800, aspiration: 'twin_turbo', drive: 'awd', cylinders: 8,
    size: [5.14, 2.02, 0.42, 0.32], style: 'suv', heights: [0.34, 0.82, 0.5], brake: 15, handling: 1.08,
    colors: ['#f2c230', '#111215', '#e9e9e4', '#78be20', '#5a5d62'],
    description: 'A super-SUV with a twin-turbo V8, Y-shaped lamps and a coupe roofline.',
  },
  {
    id: 'ford_ranger_raptor', showroom: 'offroad', brand: 'Ford', name: 'Ranger Raptor', category: 'truck', year: 2023, price: 75_000, tier: 'rare',
    hp: 392, torque: 583, weight: 2475, topSpeed: 180, accel: 5.8, redline: 6500, aspiration: 'twin_turbo', drive: 'awd', cylinders: 6,
    size: [5.38, 2.03, 0.42, 0.3], style: 'pickup', heights: [0.48, 0.86, 0.6], brake: 11, handling: 0.92,
    colors: ['#e85d04', '#1d3557', '#e9e9e4', '#111215', '#6c757d'],
    description: 'Desert-racing pickup: long-travel suspension, all-terrain tyres and a twin-turbo V6.',
  },
  // ---------------------------------------------------------------- EV / Futuristic Dealer
  {
    id: 'rimac_nevera', showroom: 'ev', brand: 'Rimac', name: 'Nevera', category: 'sports', year: 2022, price: 2_400_000, tier: 'legendary',
    hp: 1914, torque: 2360, weight: 2300, topSpeed: 412, accel: 1.85, redline: 20000, aspiration: 'electric', drive: 'awd', cylinders: 0,
    size: [4.75, 1.99, 0.36, 0.32], style: 'coupe', heights: [0.12, 0.62, 0.47], brake: 18, handling: 1.32,
    colors: ['#1d3557', '#e9e9e4', '#111215', '#3a86ff', '#5a5d62'],
    description: 'Four electric motors, nearly 2,000 hp and 0-100 in under two seconds. Silent and brutal.',
  },
  {
    id: 'tesla_model_s_plaid', showroom: 'ev', brand: 'Tesla', name: 'Model S Plaid', category: 'luxury', year: 2023, price: 115_000, tier: 'epic',
    hp: 1020, torque: 1420, weight: 2190, topSpeed: 322, accel: 2.1, redline: 20000, aspiration: 'electric', drive: 'awd', cylinders: 0,
    size: [4.97, 1.96, 0.35, 0.27], style: 'sedan', heights: [0.18, 0.72, 0.54], brake: 15, handling: 1.1,
    colors: ['#e9e9e4', '#111215', '#1d3557', '#c1121f', '#5a5d62'],
    description: 'A family saloon with three motors that outruns supercars off the line.',
  },
];

/** Numeric rarity per tier (collector premium, see valuation.rarityFactor). */
const RARITY: Record<RarityTier, number> = { common: 1, uncommon: 1.2, rare: 1.5, epic: 1.8, legendary: 2.5 };
const RARITY_VALUE_SCALE = 0.1; // mirrors ECONOMY.valuation.rarityValueScale

function gameTopSpeed(kmh: number): number {
  return Math.round((24 + (kmh - 190) * 0.146) * 10) / 10;
}
function gameAccel(zeroTo100: number): number {
  return Math.round(12.5 * Math.pow(3 / zeroTo100, 0.63) * 10) / 10;
}

export const SHOWROOM_MODELS: (VehicleModel & { showroom: ShowroomId })[] = CARS.map((c) => {
  const [length, width, wheelRadius, wheelWidth] = c.size;
  const [rideHeight, bodyHeight, cabinHeight] = c.heights;
  const rarity = RARITY[c.tier];
  return {
    id: c.id,
    brand: c.brand,
    name: c.name,
    category: c.category,
    year: c.year,
    basePrice: Math.round(c.price / (1 + (rarity - 1) * RARITY_VALUE_SCALE) / 100) * 100,
    rarity,
    tier: c.tier,
    exclusive: true,
    showroom: c.showroom,
    image: null,
    shape: { style: c.style, length, width, bodyHeight, cabinHeight, cabinLength: 0.45, cabinOffset: -0.04, cabinTaper: 0.14, rideHeight, wheelRadius, wheelWidth },
    perf: { topSpeed: gameTopSpeed(c.topSpeed), accel: gameAccel(c.accel), brake: c.brake, handling: c.handling },
    specs: { kind: 'car', hp: c.hp, torque: c.torque, weight: c.weight, topSpeed: c.topSpeed, accel: c.accel, redline: c.redline, aspiration: c.aspiration, drive: c.drive, cylinders: c.cylinders },
    colors: c.colors,
    description: c.description,
  };
});

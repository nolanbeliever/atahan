// The eight themed showrooms along the far shore's Galeri Bulvarı: where each building stands, how
// it looks, what it sells, and the rules for a test drive. Shared by the server (stock, prices,
// "are you at the door") and the client (the buildings, the "Galeriyi Gez (E)" prompt, the panel).
//
// Each plot faces the boulevard: a forecourt by the pavement with a turntable (a car spins on it)
// and the test-drive bay, then the glass-fronted building with two more turntables inside.

import { DEFAULT_MODS } from './customization';
import { ECONOMY } from './economy.config';
import { BOULEVARD } from './farShore';
import type { ShowroomId } from './showroomModels';
import type { CategoryTrends, Vehicle, VehicleCondition } from './types';
import { marketValue } from './valuation';
import type { AABB, Circle } from './world';

export type { ShowroomId };

export interface ShowroomTheme {
  /** Walls and roof. */
  main: string;
  /** Sign and trim colour. */
  accent: string;
  /** Neon / light colour at night. */
  glow: string;
  /** Showroom floor. */
  floor: string;
}

export interface Showroom {
  id: ShowroomId;
  name: string;
  /** One line under the name (Turkish). */
  tagline: string;
  side: 'north' | 'south';
  cx: number;
  /** The building (a collider): the glass front faces the boulevard at `frontZ`. */
  box: AABB;
  frontZ: number;
  height: number;
  /** Stand here for "Galeriyi Gez (E)". */
  door: { x: number; z: number };
  /** The turntable on the forecourt (a collider). */
  podium: Circle;
  /** Two turntables behind the glass. */
  displays: { x: number; z: number }[];
  /** Where a test-drive car waits, nose to the boulevard. */
  testDrive: { x: number; z: number; rot: number };
  theme: ShowroomTheme;
  /** What it sells, new (the Black Market rolls its own used stock instead). */
  models: string[];
}

/** Building width and depth, forecourt depth (pavement to glass). */
const WIDTH = 40;
const DEPTH = 22;
const FORECOURT = 17;
const PAVEMENT = 4;
export const SHOWROOM_DOOR_RADIUS = 3.5;

function showroom(
  id: ShowroomId,
  side: 'north' | 'south',
  cx: number,
  height: number,
  name: string,
  tagline: string,
  theme: ShowroomTheme,
  models: string[],
): Showroom {
  const north = side === 'north';
  // Towards the boulevard: +z for the north side, -z for the south side.
  const s = north ? 1 : -1;
  const frontZ = north ? BOULEVARD.minZ - PAVEMENT - FORECOURT : BOULEVARD.maxZ + PAVEMENT + FORECOURT;
  const backZ = frontZ - s * DEPTH;
  return {
    id,
    name,
    tagline,
    side,
    cx,
    box: { minX: cx - WIDTH / 2, maxX: cx + WIDTH / 2, minZ: Math.min(frontZ, backZ), maxZ: Math.max(frontZ, backZ) },
    frontZ,
    height,
    door: { x: cx, z: frontZ + s * 2.2 },
    podium: { x: cx - 11, z: frontZ + s * 9, r: 3.4 },
    displays: [
      { x: cx - 10, z: frontZ - s * 8 },
      { x: cx + 10, z: frontZ - s * 8 },
    ],
    testDrive: { x: cx + 11, z: frontZ + s * 9, rot: north ? 0 : Math.PI },
    theme,
    models,
  };
}

export const SHOWROOMS: Showroom[] = [
  // North side of the boulevard (west to east).
  showroom('jdm', 'north', 742, 8, 'JDM Underground', 'Supra · Skyline · RX-7: Japon efsaneleri', { main: '#15151d', accent: '#ff2d55', glow: '#ff2d55', floor: '#23242c' }, [
    'toyota_supra_a80',
    'nissan_skyline_r34',
    'mazda_rx7_fd',
  ]),
  showroom('german', 'north', 796, 10, 'German Muscle & Tuning', 'BMW M · Mercedes-AMG · Audi RS', { main: '#1d2733', accent: '#3f8cff', glow: '#9cc4ff', floor: '#2c333d' }, [
    'bmw_m3_g80',
    'bmw_m8_comp',
    'mercedes_amg_gt',
    'audi_rs5_coupe',
    'bmw_5_g60',
    'mercedes_e_w214',
  ]),
  showroom('hyper', 'north', 850, 14, 'Hypercar Pavilion', 'Bugatti · Lamborghini · Ferrari', { main: '#eeeeea', accent: '#c9a227', glow: '#ffe7a3', floor: '#d9d6cf' }, [
    'bugatti_chiron',
    'lamborghini_aventador',
    'ferrari_sf90',
  ]),
  showroom('classic', 'north', 904, 9, 'Classic & Vintage Garage', 'Klasikler ve Amerikan kası', { main: '#7a3b22', accent: '#f4c430', glow: '#ffb347', floor: '#4a3426' }, [
    'ford_mustang_boss429',
    'dodge_charger_rt70',
    'harlan_bellwether',
    'harlan_duchess',
  ]),
  // South side (west to east; the docks road runs between the off-road and EV showrooms).
  showroom('moto', 'south', 744, 8, 'Moto & ATV Showroom', 'Motosikletler ve ATV', { main: '#2a2d33', accent: '#ff7a1a', glow: '#ff9a4a', floor: '#33363d' }, [
    'yamaha_mt09',
    'yamaha_tracer7',
    'ktm_duke390',
    'yamaha_yz250',
    'bmw_gs_moto',
    'granforge_mudhog',
  ]),
  showroom('offroad', 'south', 798, 11, 'Off-Road & SUV Empire', 'G-Serisi · Urus · Ranger Raptor', { main: '#4b4a3a', accent: '#8bc34a', glow: '#c5e1a5', floor: '#3e3c30' }, [
    'mercedes_g_class',
    'lamborghini_urus',
    'ford_ranger_raptor',
    'bmw_x7_facelift',
    'granforge_ridgeback',
  ]),
  showroom('ev', 'south', 912, 12, 'EV / Futuristic', 'Elektrikli gelecek: Nevera · Model S Plaid', { main: '#e6f1fa', accent: '#00d5ff', glow: '#00e5ff', floor: '#cfdde8' }, [
    'rimac_nevera',
    'tesla_model_s_plaid',
    'bmw_i7_g70',
    'voltara_luma',
  ]),
  showroom('blackmarket', 'south', 990, 7, 'Black Market', 'Çalıntı · plakası silinmiş · Sanayi toplaması', { main: '#1b1a19', accent: '#b3001b', glow: '#ff3b30', floor: '#262422' }, []),
];

const BY_ID = new Map(SHOWROOMS.map((s) => [s.id, s]));

export function findShowroom(id: string | null | undefined): Showroom | undefined {
  return id ? BY_ID.get(id as ShowroomId) : undefined;
}

export const SHOWROOM_IDS = SHOWROOMS.map((s) => s.id);
export const SHOWROOM_BOXES: AABB[] = SHOWROOMS.map((s) => s.box);
export const SHOWROOM_CIRCLES: Circle[] = SHOWROOMS.map((s) => s.podium);

// ---------------------------------------------------------------- stock and prices

/** One car on offer in a showroom. */
export interface ShowroomOffer {
  /** `new:<modelId>` (any number in stock) or `bm:<epoch>:<slot>` (one of a kind). */
  id: string;
  modelId: string;
  price: number;
  /** What it looks like and its state (a brand-new car, or the Black Market car as it stands). */
  vehicle: Vehicle;
  /** Black Market: the car has a theft record (number-plate cameras flag it). */
  hot: boolean;
  /** Black Market: who bought it already. */
  soldTo: string | null;
}

export interface ShowroomInfo {
  showroomId: ShowroomId;
  offers: ShowroomOffer[];
  /** Black Market: when the stock is replaced (epoch ms). */
  restockAt: number | null;
  serverTime: number;
}

/** A test drive in progress. */
export interface TestDriveView {
  vehicleId: string;
  showroomId: ShowroomId;
  modelId: string;
  endsAt: number;
  serverTime: number;
}

export type TestDriveEnd = 'time' | 'exit' | 'busted' | 'lost' | 'cancel';

export const NEW_CONDITION: VehicleCondition = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

export const newOfferId = (modelId: string): string => `new:${modelId}`;
export const blackMarketOfferId = (epoch: number, slot: number): string => `bm:${epoch}:${slot}`;

export function parseShowroomOffer(id: string): { kind: 'new'; modelId: string } | { kind: 'bm'; epoch: number; slot: number } | null {
  const n = /^new:([a-z0-9_]{1,40})$/.exec(id);
  if (n) return { kind: 'new', modelId: n[1]! };
  const b = /^bm:(\d{1,12}):(\d{1,2})$/.exec(id);
  if (b) return { kind: 'bm', epoch: Number(b[1]), slot: Number(b[2]) };
  return null;
}

/** A brand-new car in the showroom (not anyone's yet). */
export function newShowroomCar(modelId: string, color: string, id = `new_${modelId}`): Vehicle {
  return {
    id,
    modelId,
    ownerId: null,
    color,
    mileage: 8,
    fuel: 100,
    condition: { ...NEW_CONDITION },
    mods: { ...DEFAULT_MODS },
    status: 'market',
    purchasePrice: 0,
    salePrice: null,
    plotId: null,
    slot: null,
    rotation: 0,
    x: 0,
    z: 0,
    serviceUntil: 0,
    createdAt: 0,
  };
}

const round100 = (v: number) => Math.round(v / 100) * 100;

/**
 * A new car's showroom price: its market value with the showroom's margin on top, never below
 * what it is worth at neutral demand (so buying new and selling at once always loses money).
 */
export function showroomPrice(modelId: string, trends?: CategoryTrends): number {
  const car = newShowroomCar(modelId, '#ffffff');
  const value = Math.max(marketValue(car), marketValue(car, trends));
  return Math.max(ECONOMY.limits.minPrice, round100(value * ECONOMY.showrooms.markup));
}

/** The Black Market's price for a car: a cut of its value, never below the quick-sell payout. */
export function blackMarketPrice(car: Vehicle, rate: number, trends?: CategoryTrends): number {
  const value = Math.max(marketValue(car), marketValue(car, trends));
  const floor = Math.ceil(value * (ECONOMY.fees.quickSellRate + 0.04));
  return Math.max(ECONOMY.limits.minPrice, Math.max(floor, round100(value * rate)));
}

export const blackMarketEpoch = (now: number): number => Math.floor(now / (ECONOMY.showrooms.blackMarket.rotationSec * 1000));
export const blackMarketEpochEnd = (epoch: number): number => (epoch + 1) * ECONOMY.showrooms.blackMarket.rotationSec * 1000;

/** The showroom whose door a point is at (within the prompt radius plus `slack`). */
export function showroomAtDoor(x: number, z: number, slack = 0): Showroom | undefined {
  return SHOWROOMS.find((s) => Math.hypot(s.door.x - x, s.door.z - z) <= SHOWROOM_DOOR_RADIUS + slack);
}

// Car theft: the Black Market's lockpick sets, the lock (sweet spot and how far the cylinder turns),
// the cars parked on the street and the highway shoulder, the Sanayi garage with its lifts, the
// parts that come off a stolen car, and what the Pawn Shop pays for them. Pure data and helpers
// shared by the server (authoritative) and the client (3D, prompts, panels).

import { ECONOMY } from './economy.config';
import { BRIDGES, BRIDGE_HALF } from './strait';
import { CARRIAGEWAY_EDGE, LANES, LANE_WIDTH, MEDIAN_HALF, OVERPASSES, JUNCTIONS, CROSSOVERS, RAMP_SPAN, deltaS, pathPoint, pathYaw, straightS, type Carriageway } from './highway';
import type { VehicleCondition, VehicleMods } from './types';
import { SANAYI } from './sanayiLayout';
import { getModel, type VehicleModel } from './vehicles';

export { SANAYI, inSanayi } from './sanayiLayout';

const T = ECONOMY.theft;

/** Inventory item: one Lockpick & saw set (3 picks). */
export const LOCKPICK_ITEM = 'lockpick_set';

// ------------------------------------------------------------------ Black Market stock

export interface BlackMarketInfo {
  price: number;
  stock: number;
  max: number;
  /** When the stock is back to full (epoch ms). */
  restockAt: number;
  /** Sets the player owns. */
  owned: number;
}

/** Restock window index: the stock is full again at the start of every window. */
export function blackMarketEpoch(now: number): number {
  return Math.floor(now / (T.restockSec * 1000));
}

export function nextRestockAt(now: number): number {
  return (blackMarketEpoch(now) + 1) * T.restockSec * 1000;
}

export function stockLeft(soldThisEpoch: number): number {
  return Math.max(0, T.stockMax - soldThisEpoch);
}

// ------------------------------------------------------------------ the lock

/** Sweet-spot tolerance (degrees either side of the sweet spot) for a car. */
export function lockTolerance(model: VehicleModel): number {
  return T.tolerance.find((t) => model.basePrice <= t.maxValue)!.deg;
}

export type LockDifficulty = 'easy' | 'medium' | 'hard' | 'extreme';

export function lockDifficulty(model: VehicleModel): LockDifficulty {
  const i = T.tolerance.findIndex((t) => model.basePrice <= t.maxValue);
  return (['easy', 'medium', 'hard', 'extreme'] as const)[Math.max(0, i)]!;
}

/**
 * How far the cylinder turns (0-1) with the pick `diff` degrees off the sweet spot: all the way
 * inside the tolerance, less and less further out (squared, so it is hard to read exactly), not at
 * all beyond `turnRange`.
 */
export function lockTurn(diff: number, tolerance: number): number {
  const d = Math.abs(diff);
  if (d <= tolerance) return 1;
  const k = 1 - (d - tolerance) / T.turnRange;
  return k <= 0 ? 0 : Math.min(0.92, k * k);
}

/** Which way the sweet spot is from a try (+1: a bigger angle, to the right) and how far (band 0-3, see hintBands). */
export function lockHint(diff: number): { dir: -1 | 0 | 1; band: number } {
  const away = Math.abs(diff);
  const band = T.hintBands.findIndex((b) => away < b);
  return { dir: diff > 0 ? 1 : diff < 0 ? -1 : 0, band: band < 0 ? T.hintBands.length : band };
}

/** The angles a hint band covers (degrees from the try), for the screen. */
export function hintBandRange(band: number): [number, number] {
  const bands = T.hintBands;
  return [band === 0 ? 0 : bands[band - 1]!, band < bands.length ? bands[band]! : 180];
}

/** The pick's angle range on screen (degrees): 0 = pointing left, 180 = pointing right. */
export const PICK_RANGE: [number, number] = [0, 180];

// ------------------------------------------------------------------ parts

export type StripPart =
  | 'mirrors'
  | 'exhaust'
  | 'doors'
  | 'seats'
  | 'steering'
  // Engine bay (all taken out from the front of the car, through the engine bay panel).
  | 'engine'
  | 'gearbox'
  | 'turbo'
  | 'radiator'
  | 'alternator'
  | 'battery'
  | 'ecu';

export interface StripPartDef {
  id: StripPart;
  label: string;
  labelTr: string;
  /** Body parts each have their own spot round the car; engine parts all come out of the engine bay. */
  group: 'body' | 'engine';
  /** Seconds of work to take it off. */
  seconds: number;
  /** How much of the car's Pawn Shop price this part is worth (relative; a car's parts share its price). */
  weight: number;
  /** Where the mechanic stands to take it off, in the car's frame (x left, z forward) from its size
   *  (ahead of and behind the lift posts, which stand level with the car's middle). */
  point: (length: number, width: number) => { x: number; z: number };
}

/** In front of the car: the engine bay. */
const BAY_POINT = (l: number) => ({ x: 0, z: l / 2 + 0.9 });

export const STRIP_PARTS: StripPartDef[] = [
  { id: 'mirrors', label: 'Side mirrors', labelTr: 'Yan Aynalar', group: 'body', seconds: 2.5, weight: 0.15, point: (l, w) => ({ x: w / 2 + 0.85, z: l * 0.3 }) },
  { id: 'doors', label: 'Doors', labelTr: 'Kapılar', group: 'body', seconds: 5, weight: 0.45, point: (l, w) => ({ x: w / 2 + 0.85, z: -l * 0.3 }) },
  { id: 'steering', label: 'Steering wheel', labelTr: 'Direksiyon', group: 'body', seconds: 3, weight: 0.3, point: (l, w) => ({ x: -(w / 2 + 0.85), z: l * 0.3 }) },
  { id: 'seats', label: 'Seats', labelTr: 'Koltuklar', group: 'body', seconds: 4, weight: 0.4, point: (l, w) => ({ x: -(w / 2 + 0.85), z: -l * 0.3 }) },
  { id: 'exhaust', label: 'Exhaust & catalytic converter', labelTr: 'Egzoz Sistemi / Katalizör', group: 'body', seconds: 4, weight: 0.8, point: (l) => ({ x: 0, z: -l / 2 - 0.9 }) },
  { id: 'engine', label: 'Engine block', labelTr: 'Motor Bloğu', group: 'engine', seconds: 8, weight: 1, point: BAY_POINT },
  { id: 'gearbox', label: 'Gearbox', labelTr: 'Şanzıman', group: 'engine', seconds: 6, weight: 0.85, point: BAY_POINT },
  { id: 'turbo', label: 'Turbo / supercharger', labelTr: 'Turbo / Kompresör', group: 'engine', seconds: 4, weight: 0.75, point: BAY_POINT },
  { id: 'ecu', label: 'Engine computer (ECU)', labelTr: 'Motor Beyni (ECU)', group: 'engine', seconds: 2.5, weight: 0.55, point: BAY_POINT },
  { id: 'radiator', label: 'Radiator', labelTr: 'Radyatör', group: 'engine', seconds: 3, weight: 0.3, point: BAY_POINT },
  { id: 'alternator', label: 'Alternator', labelTr: 'Alternatör', group: 'engine', seconds: 3, weight: 0.25, point: BAY_POINT },
  { id: 'battery', label: 'Battery', labelTr: 'Akü', group: 'engine', seconds: 2, weight: 0.2, point: BAY_POINT },
];

const PART_INDEX = new Map(STRIP_PARTS.map((p) => [p.id, p]));

export function stripPart(id: string): StripPartDef | undefined {
  return PART_INDEX.get(id as StripPart);
}

/** Which parts a car has: e electric (no exhaust, alternator or turbo), n naturally aspirated (no turbo), t turbo / supercharged. */
export type PartProfile = 'e' | 'n' | 't';

export function partProfile(model: VehicleModel): PartProfile {
  const asp = model.specs.aspiration;
  return asp === 'electric' ? 'e' : asp === 'turbo' || asp === 'twin_turbo' || asp === 'supercharged' ? 't' : 'n';
}

function profileParts(profile: PartProfile): StripPart[] {
  return STRIP_PARTS.filter((p) => {
    if (p.id === 'exhaust' || p.id === 'alternator') return profile !== 'e';
    if (p.id === 'turbo') return profile === 't';
    return true;
  }).map((p) => p.id);
}

/** Parts a car has: electric cars have no exhaust or alternator, only forced-induction engines a turbo. */
export function partsFor(model: VehicleModel): StripPart[] {
  return profileParts(partProfile(model));
}

/** A part's Turkish name on a given car (an electric car's engine is its motor). */
export function partLabelTr(part: StripPart, model?: VehicleModel): string {
  if (part === 'engine' && model?.specs.aspiration === 'electric') return 'Elektrik Motoru';
  if (part === 'turbo' && model?.specs.aspiration === 'supercharged') return 'Kompresör';
  return PART_INDEX.get(part)!.labelTr;
}

/** Value tier of a car (0 cheap - 3 exotic): dearer cars' parts fetch more. */
export function valueTier(model: VehicleModel): number {
  const v = model.basePrice;
  return v < 20_000 ? 0 : v < 60_000 ? 1 : v < 150_000 ? 2 : 3;
}

/** Inventory item id of a stripped part (with the value tier and part profile of the car it came from). */
export function partItemId(part: StripPart, tier: number, profile: PartProfile = 't'): string {
  return `stolen_part:${part}:${Math.max(0, Math.min(3, Math.round(tier)))}:${profile}`;
}

export function parsePartItem(id: string): { part: StripPart; tier: number; profile: PartProfile } | null {
  const m = /^stolen_part:([a-z]+):([0-3])(?::([ent]))?$/.exec(id);
  if (!m || !PART_INDEX.has(m[1] as StripPart)) return null;
  return { part: m[1] as StripPart, tier: Number(m[2]), profile: (m[3] as PartProfile | undefined) ?? 't' };
}

/**
 * What the Pawn Shop pays for all the parts of one stripped car: between pawnMin and pawnMax by the car's value tier
 * and luck (r 0-1). Both are $25,000: every car fetches $25,000.
 */
export function pawnCarPrice(tier: number, r: number): number {
  const k = Math.max(0, Math.min(1, Math.max(0, Math.min(3, tier)) * 0.15 + Math.max(0, Math.min(1, r)) * 0.55));
  return T.pawnMin + (T.pawnMax - T.pawnMin) * k;
}

/** A part's share of its car's Pawn Shop price (a car's parts add up to 1). */
export function partShare(part: StripPart, profile: PartProfile = 't'): number {
  const parts = profileParts(profile);
  if (!parts.includes(part)) return 0;
  const total = parts.reduce((a, p) => a + PART_INDEX.get(p)!.weight, 0);
  return PART_INDEX.get(part)!.weight / total;
}

/** What one part fetches (exact dollars; the Pawn Shop rounds the total of a sale). */
export function pawnPrice(part: StripPart, tier: number, r: number, profile: PartProfile = 't'): number {
  return pawnCarPrice(tier, r) * partShare(part, profile);
}

/** Strip state helpers. */
export function isLifted(mods: VehicleMods | undefined): boolean {
  return !!mods?.strip;
}

export function removedParts(mods: VehicleMods | undefined): StripPart[] {
  return (mods?.strip?.removed ?? []).filter((p): p is StripPart => PART_INDEX.has(p as StripPart));
}

// ------------------------------------------------------------------ Sanayi garage & Pawn Shop

export interface LiftBay {
  x: number;
  z: number;
  /** Cars drive in heading south (+z). */
  yaw: number;
}

export const LIFT_BAYS: LiftBay[] = [
  { x: 82, z: 186, yaw: 0 },
  { x: 106, z: 186, yaw: 0 },
  // The repair lifts at either end of the hall (the part-time mechanic's jobs; strip work too).
  { x: 70, z: 186, yaw: 0 },
  { x: 118, z: 186, yaw: 0 },
];

/** How high the lift takes a car (m). */
export const LIFT_HEIGHT = 1.75;
/** Lift posts stand this far either side of the bay's centre line. */
export const LIFT_POST_X = 1.75;

/** The bay a car is parked in (close enough to lift), or -1. */
export function bayAt(x: number, z: number, rot: number): number {
  return LIFT_BAYS.findIndex((b) => {
    const dx = x - b.x;
    const dz = z - b.z;
    // Lined up between the posts, roughly straight.
    const yawOff = Math.abs(Math.atan2(Math.sin(rot - b.yaw), Math.cos(rot - b.yaw)));
    const straight = Math.min(yawOff, Math.PI - yawOff) < 0.5;
    return Math.abs(dx) < 1.1 && Math.abs(dz) < 3 && straight;
  });
}

/** Walls of the hall, the Pawn Shop and the lift posts (colliders). */
export const SANAYI_BOXES = [
  { minX: SANAYI.hall.minX - 1, maxX: SANAYI.hall.minX, minZ: SANAYI.hall.minZ, maxZ: SANAYI.hall.maxZ + 1 },
  { minX: SANAYI.hall.maxX, maxX: SANAYI.hall.maxX + 1, minZ: SANAYI.hall.minZ, maxZ: SANAYI.hall.maxZ + 1 },
  { minX: SANAYI.hall.minX - 1, maxX: SANAYI.hall.maxX + 1, minZ: SANAYI.hall.maxZ, maxZ: SANAYI.hall.maxZ + 1 },
  { ...SANAYI.pawn },
];

export const SANAYI_CIRCLES = LIFT_BAYS.flatMap((b) => [
  { x: b.x + LIFT_POST_X, z: b.z, r: 0.22 },
  { x: b.x - LIFT_POST_X, z: b.z, r: 0.22 },
]);

// ------------------------------------------------------------------ street-parked cars

export interface StreetSpot {
  x: number;
  z: number;
  rot: number;
  /** A broken-down car on the highway shoulder (hazard lights on). */
  highway: boolean;
}

export interface StreetCar {
  id: string;
  modelId: string;
  color: string;
  mods: VehicleMods;
  condition: VehicleCondition;
  x: number;
  z: number;
  rot: number;
  highway: boolean;
  /** Alarm sounding until (epoch ms; 0 = quiet). */
  alarmUntil: number;
}

/** Kerbside spots on the city roads, clear of junctions, and shoulder spots on the highway. */
export const STREET_SPOTS: StreetSpot[] = (() => {
  const spots: StreetSpot[] = [];
  const lines = [-150, -50, 50, 150];
  const mids = [-125, -75, -25, 25, 75, 125];
  const kerb = 4.6;
  lines.forEach((l, i) => {
    mids.forEach((m, j) => {
      // Alternate sides and skip every other spot, so the cars spread out.
      if ((i + j) % 2 === 0) spots.push({ x: l + kerb, z: m, rot: 0, highway: false });
      else spots.push({ x: m, z: l - kerb, rot: Math.PI / 2, highway: false });
    });
  });
  // Highway shoulders: parked beyond the outer lane, facing the traffic's direction.
  const shoulder = MEDIAN_HALF + LANES * LANE_WIDTH + (CARRIAGEWAY_EDGE - MEDIAN_HALF - LANES * LANE_WIDTH) / 2;
  for (let k = 0; k < 4; k++) {
    for (const u of [45, 115, 255]) {
      const s = straightS(k, u);
      if (OVERPASSES.some((o) => Math.abs(deltaS(o.s, s)) < 18)) continue;
      const q = pathPoint(s, 0);
      if (BRIDGES.some((b) => Math.abs(q.z - b.z) < BRIDGE_HALF + 14 && q.x > b.x0)) continue;
      if (JUNCTIONS.some((jn) => deltaS(jn.s, s) > -RAMP_SPAN[0] - 12 && deltaS(jn.s, s) < RAMP_SPAN[1] + 12)) continue;
      if (CROSSOVERS.some((c) => Math.abs(deltaS(c, s)) < 14)) continue;
      const cw: Carriageway = (k + (u > 100 ? 1 : 0)) % 2 === 0 ? 0 : 1;
      const offset = (cw === 0 ? -1 : 1) * shoulder;
      const p = pathPoint(s, offset);
      spots.push({ x: p.x, z: p.z, rot: pathYaw(p, cw === 1), highway: true });
    }
  }
  return spots;
})();

/** A catalogue car that can be stolen off the street (cars, not motorcycles or exclusives). */
export function stealable(modelId: string): boolean {
  const m = getModel(modelId);
  return m.specs.kind !== 'bike' && !m.exclusive;
}

/** The Sanayi yard (fence line): stolen cars parked here can get forged papers. */
export function inSanayiYard(x: number, z: number): boolean {
  const y = SANAYI.yard;
  return x >= y.minX && x <= y.maxX && z >= y.minZ && z <= y.maxZ;
}

/** Forged papers for a stolen car worth `value`. */
export function papersPrice(value: number): number {
  const T = ECONOMY.theft;
  return Math.max(T.papersMin, Math.round((value * T.papersRate) / 50) * 50);
}

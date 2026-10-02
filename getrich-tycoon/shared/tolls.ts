// The bridges' toll plazas, number-plate (ANPR) cameras and police checkpoints. Shared so the server
// (charging, reading plates, setting up a checkpoint) and the client (booths, barrier arms, the
// cameras' flash, the history panel) agree.
//
//   * Toll plaza: on the far-shore road from each bridge to the VIP Otoban. Heading over to the far
//     shore you pay at the barrier (HGS: slow down under the limit and the arm lifts: "İyi
//     Yolculuklar - $250"); blasting through the arm is an evasion fine.
//   * ANPR cameras: on the plaza's gantry and on a gantry over each bridge's city end. They read the
//     plate of every car in both directions: a car with a theft record (bought at the Black Market),
//     a stolen car or the car of someone the police want gets one more star. A flipped plate can't
//     be read; a fake plate reads clean.
//   * Checkpoints: a driver with 2 stars or more who drives onto a bridge finds the police waiting
//     at the far end: four cars parked in a V across the deck with a spike strip in front of the
//     middle. Ram through ("Barikatı yar") or turn back ("kaç").

import { ECONOMY } from './economy.config';
import { BRIDGES, BRIDGE_HALF, VIP_X, VIP_HALF, type Bridge } from './strait';
import type { AABB } from './world';

/** Where the toll line is (x) on each bridge's far-shore road (between the landing and the VIP Otoban). */
export const TOLL_X = 652;
/** The plaza: booth islands either side of the line along this much road (m). */
export const TOLL_ISLAND_LEN = 7;

export interface TollPlaza {
  /** Bridge number (1 north, 2 south). */
  n: number;
  name: string;
  x: number;
  z: number;
  /** Centre lines of the lanes (z), eastbound (paying) and westbound. */
  east: number[];
  west: number[];
  /** The booth islands (colliders). */
  islands: AABB[];
}

/** Island offsets from the bridge axis and their half widths: two between the lanes each way (the
 *  middle stays open: the police drive down the road's centre line). */
const ISLANDS: [number, number][] = [
  [4.7, 0.4],
  [-4.7, 0.4],
  [8.9, 0.4],
  [-8.9, 0.4],
];

export const TOLL_PLAZAS: TollPlaza[] = BRIDGES.map((b) => ({
  n: b.n,
  name: b.name,
  x: TOLL_X,
  z: b.z,
  // Driving on the right: eastbound (+x) traffic keeps to +z.
  east: [2.3, 6.8, 11.1].map((o) => b.z + o),
  west: [-2.3, -6.8, -11.1].map((o) => b.z + o),
  islands: ISLANDS.map(([o, h]) => ({ minX: TOLL_X - TOLL_ISLAND_LEN / 2, maxX: TOLL_X + TOLL_ISLAND_LEN / 2, minZ: b.z + o - h, maxZ: b.z + o + h })),
}));

export const TOLL_BOXES: AABB[] = TOLL_PLAZAS.flatMap((p) => p.islands);

/** The plaza a point is in (on the road across it), if any. */
export function tollPlazaAt(x: number, z: number): TollPlaza | undefined {
  return TOLL_PLAZAS.find((p) => Math.abs(x - p.x) < 30 && Math.abs(z - p.z) < BRIDGE_HALF + 0.5);
}

/** A move from (ax) to (bx) across the toll line, eastbound (the paying direction). */
export function crossesTollEast(ax: number, bx: number): boolean {
  return ax < TOLL_X && bx >= TOLL_X;
}

/** Whether a crossing at this speed (real km/h) is a paid pass or an evasion. */
export function tollOutcome(kmh: number): 'paid' | 'evaded' {
  return kmh <= ECONOMY.tolls.maxKmh ? 'paid' : 'evaded';
}

// ---------------------------------------------------------------- ANPR

export interface AnprCamera {
  id: string;
  /** Bridge number; `deck` is the level it watches (the bridge's number on the deck, 0 on the ground). */
  n: number;
  deck: number;
  x: number;
  z: number;
  name: string;
}

/** On each bridge: one over the deck near the city end, one on the toll plaza's gantry. */
export const ANPR_CAMERAS: AnprCamera[] = BRIDGES.flatMap((b) => [
  { id: `${b.id}-city`, n: b.n, deck: b.n, x: b.x0 + 70, z: b.z, name: `${b.name.split(' · ')[0]} · şehir girişi` },
  { id: `${b.id}-toll`, n: b.n, deck: 0, x: TOLL_X + 6, z: b.z, name: `${b.name.split(' · ')[0]} · gişe` },
]);

/** The camera whose line a move from ax to bx crosses (either way) on the given level and road. */
export function anprCrossed(ax: number, bx: number, z: number, deck: number): AnprCamera | undefined {
  return ANPR_CAMERAS.find((c) => c.deck === deck && Math.abs(z - c.z) < BRIDGE_HALF + 0.5 && (ax - c.x) * (bx - c.x) <= 0 && ax !== bx);
}

/** What a camera reads off a car: nothing (flipped), a fake registration, or the car's own plate. */
export function plateRead(mods: { plateFlipped?: boolean; fakePlate?: string }): 'none' | 'fake' | 'real' {
  if (mods.plateFlipped) return 'none';
  return mods.fakePlate ? 'fake' : 'real';
}

// ---------------------------------------------------------------- checkpoints

export interface CheckpointPlan {
  n: number;
  /** +1: the driver is heading east (the checkpoint is at the east end), -1: west. */
  dir: 1 | -1;
  /** The line the V stands on (x, on the deck), and the strip in front of it. */
  x: number;
  z: number;
  cars: { x: number; z: number; rot: number }[];
  spikes: { x: number; z: number; rot: number; half: number };
}

/** Where a checkpoint stands on a bridge for a driver heading `dir` (on the deck near the far end). */
export function checkpointPlan(b: Bridge, dir: 1 | -1): CheckpointPlan {
  const x = dir > 0 ? b.x1 - 48 : b.x0 + 48;
  // Four cars in a V pointing at the driver: the middle pair a little further forward.
  const towards = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  const cars = [
    { o: -9.6, ahead: 0, turn: 0.95 },
    { o: -3.2, ahead: 2.2, turn: 0.95 },
    { o: 3.2, ahead: 2.2, turn: -0.95 },
    { o: 9.6, ahead: 0, turn: -0.95 },
  ].map((c) => ({ x: x - dir * c.ahead, z: b.z + c.o, rot: towards + c.turn * (dir > 0 ? 1 : -1) }));
  return { n: b.n, dir, x, z: b.z, cars, spikes: { x: x - dir * 11, z: b.z, rot: Math.PI / 2, half: 6.5 } };
}

/** The VIP Otoban's west edge (the toll plaza is between the landing and it). */
export const TOLL_ROAD_END = VIP_X - VIP_HALF;

// ---------------------------------------------------------------- history

export type TollEventKind = 'toll' | 'evasion' | 'anpr' | 'checkpoint' | 'breakthrough';

/** One line in the "Geçiş Geçmişi / Ceza Bildirimi" panel. */
export interface TollEvent {
  id: string;
  kind: TollEventKind;
  at: number;
  /** Where (a bridge or camera name). */
  place: string;
  /** Money: negative paid, positive earned; 0 for a camera read. */
  amount: number;
  /** The plate as the camera saw it (or the car's), and the car. */
  plate: string | null;
  modelId: string | null;
  /** Stars added (ANPR). */
  stars: number;
  text: string;
}

export const TOLL_HISTORY_MAX = 40;

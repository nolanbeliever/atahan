// Highway traffic: vehicle kinds, the deterministic line-up (so client and server agree on what
// each traffic vehicle looks like without sending it), lane speeds, poses and colliders.
//
// Traffic lives on the ring highway in (s, offset) coordinates (see highway.ts). The server runs
// the driver model (IDM car following + MOBIL-style lane changes, server/game/traffic.ts); clients
// get compact updates and extrapolate between them.

import {
  LANES,
  centrelineStep,
  laneOffset,
  pathPoint,
  pathYaw,
  travelDir,
  wrapS,
  type Carriageway,
} from './highway';
import type { Circle } from './world';

export type TrafficKind = 'car' | 'truck' | 'bus' | 'semi';

export interface TrafficKindDef {
  length: number;
  width: number;
  /** Lanes this kind may use (0 = fast lane by the median). */
  lanes: [number, number];
  /** Cruising speed range on the speedometer (km/h). */
  kmh: [number, number];
  /** IDM comfortable acceleration / deceleration (game m/s^2). */
  accel: number;
  decel: number;
  share: number;
}

export const TRAFFIC_KINDS: Record<TrafficKind, TrafficKindDef> = {
  car: { length: 4.6, width: 1.9, lanes: [0, 3], kmh: [92, 138], accel: 2.2, decel: 3.5, share: 0.7 },
  truck: { length: 8.4, width: 2.45, lanes: [2, 3], kmh: [78, 88], accel: 1.1, decel: 2.6, share: 0.1 },
  bus: { length: 12.2, width: 2.55, lanes: [1, 3], kmh: [88, 100], accel: 1.2, decel: 2.6, share: 0.07 },
  semi: { length: 16.4, width: 2.55, lanes: [2, 3], kmh: [76, 86], accel: 0.9, decel: 2.4, share: 0.13 },
};

/** Vehicles per carriageway. */
export const TRAFFIC_PER_SIDE = 58;
export const TRAFFIC_COUNT = TRAFFIC_PER_SIDE * 2;

/**
 * Speedometer km/h per game m/s for traffic (the same compression as player cars, whose
 * speedometers read about 2.1x the game speed).
 */
export const TRAFFIC_KMH_PER_MS = 3.6 * 2.1;
export const kmhToGame = (kmh: number): number => kmh / TRAFFIC_KMH_PER_MS;

/** Speed limit of each lane (km/h): fast on the left, trucks on the right. */
export const LANE_MAX_KMH = [140, 118, 100, 88];
/** Sideways speed while changing lanes (m/s) and how long the indicator blinks first (s). */
export const LANE_CHANGE_RATE = 1.35;
export const SIGNAL_TIME = 1.3;

/** Everyday traffic cars (weighted towards family cars). */
const TRAFFIC_CAR_MODELS: [string, number][] = [
  ['norda_arlo', 5],
  ['velora_serene', 4],
  ['norda_pixi', 4],
  ['voltara_luma', 3],
  ['granforge_ridgeback', 3],
  ['solenne_marquee', 2],
  ['granforge_hauler', 2],
  ['granforge_packmule', 2],
  ['norda_workmate', 2],
  ['bmw_5_g60', 1],
  ['mercedes_e_w214', 1],
  ['velora_aurelian', 1],
  ['apexon_strix', 0.5],
];

const CAR_COLORS = ['#e8e8e6', '#f4f4f2', '#16181c', '#23262b', '#8e949b', '#b7bcc2', '#5b6068', '#1d3b6e', '#7a1c1c', '#2d4a3a', '#c9b89a', '#3a5f8f', '#a31f24'];
const CAB_COLORS = ['#f2f2f0', '#c62828', '#1e4f9c', '#2e7d32', '#f9a825', '#37474f', '#e65100', '#ffffff'];
const BUS_COLORS = ['#f4f4f2', '#1f5fa8', '#e2a31a', '#2e7d32', '#b71c1c'];

export interface TrafficSpec {
  id: number;
  kind: TrafficKind;
  /** Catalogue model for cars, the kind for heavy vehicles. */
  modelId: string;
  color: string;
  /** Trailer / body colour for trucks and semis. */
  color2: string;
  cw: Carriageway;
  length: number;
  width: number;
  /** Cruising speed (km/h on the speedometer). */
  kmh: number;
  /** Lane this driver prefers when the road is clear. */
  homeLane: number;
  /** Moves over when a fast car comes up behind (even without a horn). */
  polite: boolean;
  /** Circle colliders along the body. */
  circles: number;
}

function hash(n: number): () => number {
  let x = (n + 1) * 2654435761;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

function weighted<T>(rng: () => number, items: [T, number][]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [it, w] of items) {
    r -= w;
    if (r <= 0) return it;
  }
  return items[items.length - 1]![0];
}

/** Rightmost lane whose speed limit suits a cruising speed, within the kind's allowed lanes. */
export function homeLaneFor(kmh: number, lanes: [number, number]): number {
  let lane = 0;
  for (let l = 0; l < LANES; l++) if (LANE_MAX_KMH[l]! >= kmh - 2) lane = l;
  return Math.max(lanes[0], Math.min(lanes[1], lane));
}

const SPEC_CACHE = new Map<number, TrafficSpec>();

/** What traffic vehicle `id` is (deterministic, identical on client and server). */
export function trafficSpec(id: number): TrafficSpec {
  const hit = SPEC_CACHE.get(id);
  if (hit) return hit;
  const rng = hash(id * 7919 + 17);
  rng();
  const kind = weighted<TrafficKind>(
    rng,
    (Object.keys(TRAFFIC_KINDS) as TrafficKind[]).map((k) => [k, TRAFFIC_KINDS[k].share]),
  );
  const def = TRAFFIC_KINDS[kind];
  const modelId = kind === 'car' ? weighted(rng, TRAFFIC_CAR_MODELS) : kind;
  const kmh = Math.round(def.kmh[0] + (def.kmh[1] - def.kmh[0]) * rng());
  const color = kind === 'car' ? CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)]! : kind === 'bus' ? BUS_COLORS[Math.floor(rng() * BUS_COLORS.length)]! : CAB_COLORS[Math.floor(rng() * CAB_COLORS.length)]!;
  const color2 = rng() < 0.6 ? '#f1f1ee' : CAB_COLORS[Math.floor(rng() * CAB_COLORS.length)]!;
  const spec: TrafficSpec = {
    id,
    kind,
    modelId,
    color,
    color2,
    cw: id < TRAFFIC_PER_SIDE ? 0 : 1,
    length: def.length,
    width: def.width,
    kmh,
    homeLane: homeLaneFor(kmh, def.lanes),
    polite: rng() < 0.7,
    circles: Math.max(2, Math.ceil(def.length / def.width)),
  };
  SPEC_CACHE.set(id, spec);
  return spec;
}

/** Cruising speed (game m/s) of a vehicle in a lane: its own pace, capped by the lane limit. */
export function laneSpeed(spec: TrafficSpec, lane: number): number {
  return kmhToGame(Math.min(spec.kmh, LANE_MAX_KMH[Math.max(0, Math.min(LANES - 1, Math.round(lane)))]!));
}

export interface TrafficPose {
  x: number;
  z: number;
  yaw: number;
}

/** World pose of a point `along` metres ahead of a traffic vehicle's centre (negative = behind). */
export function trafficPose(cw: Carriageway, s: number, off: number, along = 0): TrafficPose {
  const dir = travelDir(cw);
  const ss = along === 0 ? s : wrapS(s + dir * centrelineStep(s, off, along));
  const p = pathPoint(ss, off);
  return { x: p.x, z: p.z, yaw: pathYaw(p, cw === 1) };
}

/** Collider circles along a traffic vehicle's body (bent around corners like the vehicle). */
export function trafficCircles(spec: TrafficSpec, s: number, off: number, out: Circle[] = []): Circle[] {
  const r = spec.width / 2 + 0.05;
  const n = spec.circles;
  const span = spec.length / 2 - r;
  for (let i = 0; i < n; i++) {
    const along = n === 1 ? 0 : span - (2 * span * i) / (n - 1);
    const p = trafficPose(spec.cw, s, off, along);
    out.push({ x: p.x, z: p.z, r });
  }
  return out;
}

/** Starting line-up: vehicles spread around the loop in their home lanes. */
export function initialTraffic(loopLen: number): { id: number; s: number; lane: number }[] {
  const out: { id: number; s: number; lane: number }[] = [];
  for (let cw = 0; cw < 2; cw++) {
    for (let i = 0; i < TRAFFIC_PER_SIDE; i++) {
      const id = cw * TRAFFIC_PER_SIDE + i;
      const spec = trafficSpec(id);
      const rng = hash(id * 31 + 5);
      out.push({ id, s: wrapS(((i + 0.3 * rng()) / TRAFFIC_PER_SIDE) * loopLen + cw * 13), lane: spec.homeLane });
    }
  }
  return out;
}

export { laneOffset };

/** Indicator bits in a traffic snapshot's flags. */
export const TF = {
  LEFT: 1,
  RIGHT: 2,
  BRAKE: 4,
} as const;

/** Compact traffic update: [id, s, offset, target offset, speed (game m/s), flags]. */
export type TrafficSnap = [number, number, number, number, number, number];

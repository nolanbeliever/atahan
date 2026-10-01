// The GetRich Expressway: an 8-lane ring highway (4 lanes each way) around the city, its barriers,
// junctions, overpasses and street lights, plus the drag strip in the green belt between the city
// and the highway. Shared so the server (collisions, traffic, races) and the client (3D, minimap)
// use the same geometry.
//
// The centreline is a rounded square (half size HW_HALF, corner radius HW_RADIUS). Positions along
// it are measured by `s` (metres of centreline, clockwise on the map, starting at the west end of
// the north side) and a signed lateral `offset` (positive = away from the city).
//
// Inner carriageway (city side, negative offsets) runs clockwise; the outer carriageway runs
// anti-clockwise. In both, lane 0 is the fast lane next to the median and lane 3 the slow lane.

import { inSanayi } from './sanayiLayout';

export const HW_HALF = 240;
export const HW_RADIUS = 90;
export const LANE_WIDTH = 3.6;
export const LANES = 4;
/** Distance from the centreline (median) to the inner edge of lane 0. */
export const MEDIAN_HALF = 1.8;
/** Distance from the centreline to the edge of the paved shoulder. */
export const CARRIAGEWAY_EDGE = MEDIAN_HALF + LANES * LANE_WIDTH + 2.5; // 18.7
export const GUARDRAIL_OFFSET = 19;

const C = HW_HALF - HW_RADIUS; // half length of each straight
export const STRAIGHT_LEN = 2 * C; // 300
export const CORNER_LEN = (Math.PI / 2) * HW_RADIUS;
/** Length of the centreline loop. */
export const LOOP_LEN = 4 * (STRAIGHT_LEN + CORNER_LEN);

export type Carriageway = 0 | 1;

/** Lateral offset of a lane centre (fractional lanes are allowed while changing lanes). */
export function laneOffset(cw: Carriageway, lane: number): number {
  return (cw === 0 ? -1 : 1) * (MEDIAN_HALF + LANE_WIDTH * (lane + 0.5));
}

/** Lane (fractional) at a lateral offset; the carriageway is the sign of the offset. */
export function offsetToLane(offset: number): number {
  return (Math.abs(offset) - MEDIAN_HALF) / LANE_WIDTH - 0.5;
}

export function carriagewayOf(offset: number): Carriageway {
  return offset < 0 ? 0 : 1;
}

/** Travel direction along s: the inner carriageway runs clockwise (+s), the outer one anti-clockwise. */
export function travelDir(cw: Carriageway): 1 | -1 {
  return cw === 0 ? 1 : -1;
}

export function wrapS(s: number): number {
  const r = s % LOOP_LEN;
  return r < 0 ? r + LOOP_LEN : r;
}

/** Signed distance from a to b along the loop, in (-L/2, L/2]. */
export function deltaS(a: number, b: number): number {
  let d = wrapS(b - a);
  if (d > LOOP_LEN / 2) d -= LOOP_LEN;
  return d;
}

export interface PathPoint {
  x: number;
  z: number;
  /** Outward normal. */
  nx: number;
  nz: number;
  /** Unit tangent in the clockwise (+s) direction. */
  tx: number;
  tz: number;
  /** True on the rounded corners. */
  corner: boolean;
}

const normalOf = (a: number) => ({ nx: Math.sin(a), nz: -Math.cos(a), tx: Math.cos(a), tz: Math.sin(a) });

/** A point of the highway at centreline position s and lateral offset. */
export function pathPoint(s: number, offset = 0): PathPoint {
  const w = wrapS(s);
  const seg = STRAIGHT_LEN + CORNER_LEN;
  const k = Math.min(3, Math.floor(w / seg));
  const u = w - k * seg;
  if (u < STRAIGHT_LEN) {
    const { nx, nz, tx, tz } = normalOf((k * Math.PI) / 2);
    const x = HW_HALF * nx - C * tx + u * tx;
    const z = HW_HALF * nz - C * tz + u * tz;
    return { x: x + offset * nx, z: z + offset * nz, nx, nz, tx, tz, corner: false };
  }
  const phi = (u - STRAIGHT_LEN) / HW_RADIUS;
  const a = (k * Math.PI) / 2 + phi;
  const { nx, nz, tx, tz } = normalOf(a);
  const n0 = normalOf((k * Math.PI) / 2);
  const n1 = normalOf(((k + 1) * Math.PI) / 2);
  const cx = C * (n0.nx + n1.nx);
  const cz = C * (n0.nz + n1.nz);
  const r = HW_RADIUS + offset;
  return { x: cx + r * nx, z: cz + r * nz, nx, nz, tx, tz, corner: true };
}

/** Yaw (0 = facing +z) of travel along the highway at s: clockwise, or anti-clockwise when `reverse`. */
export function pathYaw(p: PathPoint, reverse: boolean): number {
  return Math.atan2(reverse ? -p.tx : p.tx, reverse ? -p.tz : p.tz);
}

/**
 * Centreline metres advanced when travelling `dist` metres at a lateral offset (corners are longer
 * on the outside, shorter on the inside).
 */
export function centrelineStep(s: number, offset: number, dist: number): number {
  const p = pathPoint(s);
  return p.corner ? (dist * HW_RADIUS) / (HW_RADIUS + offset) : dist;
}

export interface HighwayCoords {
  s: number;
  /** Signed distance from the centreline (positive = away from the city). */
  offset: number;
  /** Outward normal at s. */
  nx: number;
  nz: number;
}

/** Nearest highway coordinates of a world point: centreline position and signed lateral offset. */
export function projectToHighway(x: number, z: number): HighwayCoords {
  let best = Infinity;
  let bestS = 0;
  let bestOff = 0;
  let bnx = 0;
  let bnz = -1;
  const seg = STRAIGHT_LEN + CORNER_LEN;
  for (let k = 0; k < 4; k++) {
    // Straight k
    const { nx, nz, tx, tz } = normalOf((k * Math.PI) / 2);
    const sx = HW_HALF * nx - C * tx;
    const sz = HW_HALF * nz - C * tz;
    const u = Math.max(0, Math.min(STRAIGHT_LEN, (x - sx) * tx + (z - sz) * tz));
    const px = sx + u * tx;
    const pz = sz + u * tz;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) {
      best = d;
      bestS = k * seg + u;
      bestOff = (x - px) * nx + (z - pz) * nz;
      bnx = nx;
      bnz = nz;
    }
    // Corner k
    const n0 = normalOf((k * Math.PI) / 2);
    const n1 = normalOf(((k + 1) * Math.PI) / 2);
    const cx = C * (n0.nx + n1.nx);
    const cz = C * (n0.nz + n1.nz);
    const vx = x - cx;
    const vz = z - cz;
    const len = Math.hypot(vx, vz) || 1e-6;
    // Angle of v measured like the normal angle a = atan2(nx, -nz).
    let a = Math.atan2(vx / len, -vz / len) - (k * Math.PI) / 2;
    while (a < -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    if (a >= 0 && a <= Math.PI / 2) {
      const dd = (len - HW_RADIUS) * (len - HW_RADIUS);
      if (dd < best) {
        best = dd;
        bestS = k * seg + STRAIGHT_LEN + a * HW_RADIUS;
        bestOff = len - HW_RADIUS;
        bnx = vx / len;
        bnz = vz / len;
      }
    }
  }
  return { s: wrapS(bestS), offset: bestOff, nx: bnx, nz: bnz };
}

/** Cheap test: can a circle at (x, z) touch anything of the highway (barriers, pillars)? */
export function nearHighway(x: number, z: number, margin = 0): boolean {
  return Math.max(Math.abs(x), Math.abs(z)) > 196 - margin;
}

/** Centreline position of the middle of straight k (0 north, 1 east, 2 south, 3 west) plus u. */
export function straightS(k: number, u: number): number {
  return k * (STRAIGHT_LEN + CORNER_LEN) + u;
}

// ------------------------------------------------------------------ junctions & barriers

export interface Junction {
  id: string;
  name: string;
  /** Centreline position where the connector road meets the highway. */
  s: number;
  /** Where the connector road leaves the city (world coordinates of its city end). */
  cityX: number;
  cityZ: number;
}

/** Connector roads from the city's outer road to the inner carriageway (u = 200 on three sides). */
export const JUNCTIONS: Junction[] = [
  { id: 'north', name: 'Exit 1 · North Gate', s: straightS(0, 200), cityX: 50, cityZ: -156 },
  { id: 'east', name: 'Exit 2 · East Gate', s: straightS(1, 200), cityX: 156, cityZ: 50 },
  { id: 'south', name: 'Exit 3 · South Gate', s: straightS(2, 200), cityX: -50, cityZ: 156 },
];
/** The off-ramp leaves this far before the junction, the on-ramp joins this far after it. */
export const RAMP_SPAN: [number, number] = [34, 38];
/** Offset where the ramps meet the straight connector road (city side of the guardrail). */
export const JUNCTION_APRON = 34;

export interface Barrier {
  offset: number;
  half: number;
  /** Centreline ranges without barrier. */
  gaps: [number, number][];
  kind: 'guardrail' | 'median';
}

/** Median crossovers so drivers can reach the outer carriageway. */
export const CROSSOVERS: number[] = [straightS(0, 70), straightS(2, 70)];

export const HIGHWAY_BARRIERS: Barrier[] = [
  { offset: -GUARDRAIL_OFFSET, half: 0.25, kind: 'guardrail', gaps: JUNCTIONS.map((j) => [j.s - RAMP_SPAN[0] - 4, j.s + RAMP_SPAN[1] + 4] as [number, number]) },
  { offset: 0, half: 0.35, kind: 'median', gaps: CROSSOVERS.map((s) => [s - 9, s + 9] as [number, number]) },
  { offset: GUARDRAIL_OFFSET, half: 0.25, kind: 'guardrail', gaps: [] },
];

export function inGap(b: Barrier, s: number): boolean {
  return b.gaps.some(([a, c]) => {
    const d0 = wrapS(s - a);
    return d0 <= wrapS(c - a);
  });
}

/** Barrier ends (round caps) as circles, so cars can't clip the end of a gap. */
export function barrierEndCaps(): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const b of HIGHWAY_BARRIERS) {
    for (const [a, c] of b.gaps) {
      for (const s of [a, c]) {
        const p = pathPoint(s, b.offset);
        out.push({ x: p.x, z: p.z, r: b.half + 0.1 });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ furniture

/**
 * Road bridges over the highway. The deck spans |offset| <= OVERPASS_DECK and slopes down to the
 * ground at |offset| = OVERPASS_RAMP; piers stand outside both guardrails and on the median.
 */
export const OVERPASSES: { s: number; label: string }[] = [
  { s: straightS(0, 270), label: 'GETRICH EXPRESSWAY' },
  { s: straightS(1, 120), label: 'GETRICH EXPRESSWAY' },
  { s: straightS(2, 120), label: 'GETRICH EXPRESSWAY' },
];
export const OVERPASS_DECK = 30;
export const OVERPASS_RAMP = 54;
export const OVERPASS_WIDTH = 11;
export const OVERPASS_HEIGHT = 6.8;

export const SIGN_GANTRIES: { s: number; inner: string; outer: string }[] = [
  ...JUNCTIONS.map((j) => ({ s: j.s - 150, inner: `${j.name}  ›  CITY CENTER`, outer: 'DRAG STRIP · WEST BELT' })),
  { s: straightS(3, 60), inner: 'NO HESITATION  ·  KEEP RIGHT', outer: 'NEAR MISS = CASH' },
];

/** Street light positions on the median (centreline s), every 42 m. */
export const STREET_LIGHTS: number[] = Array.from({ length: Math.floor(LOOP_LEN / 42) }, (_, i) => i * 42 + 10);

/** Bridge piers and the inner embankments of the overpasses (colliders). */
export function overpassColliders(): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const o of OVERPASSES) {
    // Piers just outside the guardrails.
    for (const off of [-22, 22]) {
      for (const ds of [-3.5, 3.5]) {
        const p = pathPoint(o.s + ds, off);
        out.push({ x: p.x, z: p.z, r: 0.9 });
      }
    }
    // The embankment on the city side is a solid ramp: a row of fat circles along its length.
    for (let off = -OVERPASS_DECK - 3; off >= -OVERPASS_RAMP + 5; off -= 4) {
      for (const ds of [-3, 3]) {
        const p = pathPoint(o.s + ds, off);
        out.push({ x: p.x, z: p.z, r: 3.4 });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ drag strip

/**
 * Quarter-mile drag strip in the west belt, racing north (towards -z). The world is drawn at 1/2.1
 * scale of the speedometer (drivetrain.SPEED_SCALE), so 402 m on the clock is 191.6 m of strip.
 */
export const DRAG_STRIP = {
  laneX: [-194, -188] as const,
  /** Front bumpers line up here. */
  startZ: 150,
  finishZ: 150 - 402.34 / 2.1,
  /** Side walls (x) and their extent (z): open at the south end (entry) and long shutdown area. */
  wallX: [-199.5, -182.5] as const,
  wallZ: [-198, 166] as const,
  /** Yaw facing down the strip (-z). */
  yaw: Math.PI,
  /** Staging area where racers line up (drive in here to race). */
  stage: { x: -191, z: 176, radius: 12 },
  /** Christmas tree between the lanes, just past the start line. */
  tree: { x: -191, z: 146 },
  lengthLabel: '1/4 MILE',
};

/** Strip walls and the grandstand beside the strip. */
export const DRAG_BOXES: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [
  { minX: DRAG_STRIP.wallX[0] - 0.6, maxX: DRAG_STRIP.wallX[0], minZ: DRAG_STRIP.wallZ[0], maxZ: DRAG_STRIP.wallZ[1] },
  { minX: DRAG_STRIP.wallX[1], maxX: DRAG_STRIP.wallX[1] + 0.6, minZ: DRAG_STRIP.wallZ[0], maxZ: DRAG_STRIP.wallZ[1] },
];
export const DRAG_GRANDSTAND = { minX: -180, maxX: -171.5, minZ: 10, maxZ: 80 };
DRAG_BOXES.push(DRAG_GRANDSTAND);

/** Colliders that belong to the highway area (end caps, bridges, the tree, belt trees). */
export function highwayCircles(): { x: number; z: number; r: number }[] {
  return [
    ...barrierEndCaps(),
    ...overpassColliders(),
    { x: DRAG_STRIP.tree.x, z: DRAG_STRIP.tree.z, r: 0.45 },
    ...BELT_TREES.map((t) => ({ x: t.x, z: t.z, r: 0.45 })),
  ];
}

// ------------------------------------------------------------------ belt decoration

/** Inside a junction: the connector road from the city and its ramps (kept clear of trees). */
export function inJunctionArea(x: number, z: number, margin = 0): boolean {
  const hp = projectToHighway(x, z);
  if (hp.offset > -GUARDRAIL_OFFSET + 1 || hp.offset < -92) return false;
  return JUNCTIONS.some((j) => {
    const ds = deltaS(j.s, hp.s);
    // The apron flares from the connector (|ds| <= 7) to the ramp span at the guardrail.
    const t = Math.max(0, Math.min(1, (-hp.offset - GUARDRAIL_OFFSET) / (JUNCTION_APRON - GUARDRAIL_OFFSET)));
    const lo = -(RAMP_SPAN[0] + 4) * (1 - t) - 7 * t;
    const hi = (RAMP_SPAN[1] + 4) * (1 - t) + 7 * t;
    return ds >= lo - margin && ds <= hi + margin;
  });
}

/** Trees in the green belt between the city and the highway (deterministic; also colliders). */
export const BELT_TREES: { x: number; z: number; s: number }[] = (() => {
  let seed = 90210;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 400 && out.length < 150; i++) {
    const side = Math.floor(rng() * 4);
    const t = (rng() - 0.5) * 420;
    const d = 168 + rng() * 44;
    const [x, z] = side === 0 ? [t, -d] : side === 1 ? [t, d] : side === 2 ? [-d, t] : [d, t];
    const { offset } = projectToHighway(x, z);
    if (offset > -GUARDRAIL_OFFSET - 4) continue; // keep off the highway
    if (Math.abs(x) < 164 && Math.abs(z) < 164) continue; // not in the city
    if (inJunctionArea(x, z, 6)) continue;
    if (x < -168 && x > -216 && z > -210 && z < 212) continue; // drag strip and its paddock
    if (inSanayi(x, z, 6)) continue; // the Sanayi industrial estate
    const hp = projectToHighway(x, z);
    if (OVERPASSES.some((o) => Math.abs(deltaS(o.s, hp.s)) < 12)) continue; // bridge embankments
    out.push({ x, z, s: 0.9 + rng() * 0.8 });
  }
  return out;
})();

// ------------------------------------------------------------------ day & night

export { DAY_LENGTH_MS, gameHour, nightFactor } from './environment';

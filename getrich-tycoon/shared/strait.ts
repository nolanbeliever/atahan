// The strait (Boğaz) east of the city, the far shore beyond it and the two suspension bridges that
// cross it. Shared so the server (collisions, police routes) and the client (3D, minimap) agree.
//
// The world is flat for the physics. A bridge is a long deck from the city's edge, up over the
// ring highway, across the water and down onto the far shore. Something that drives (or walks) onto
// a bridge at one of its ends is "on the deck" (`deck` = the bridge's number) until it leaves the
// deck at an end again: on the deck only the rails and other things on the same deck touch it;
// underneath, the highway's traffic, barriers and anyone on the ground ignore it.

import type { AABB } from './world';

/** The playable area: the city square plus the strait and the far shore to the east. */
export const WORLD_BOX = { minX: -262, maxX: 1060, minZ: -262, maxZ: 262 };

/** The water between the two shores (x range; it runs the whole north-south length). */
export const WATER = { west: 292, east: 548 };

/** The far shore (Karşı Kıyı). */
export const FAR_SHORE: AABB = { minX: WATER.east, maxX: WORLD_BOX.maxX, minZ: WORLD_BOX.minZ, maxZ: WORLD_BOX.maxZ };

/** Lanes each way on a bridge, lane width, and the half width between the rails. */
export const BRIDGE_LANES = 3;
export const BRIDGE_LANE_WIDTH = 3.6;
export const BRIDGE_HALF = 13;
/** How far into the deck from an end still counts as getting on (metres). */
const ENTRY = 9;
/** Deck height over the highway and the approach (m), and how much higher the middle of the main span is. */
export const DECK_HEIGHT = 9;
export const SPAN_RISE = 5;
/** Length of the ramp at each end (ground to deck height). */
export const RAMP_LEN = 55;
/** Below this the deck is too low to drive under (the ramp is a solid embankment there). */
export const CLEARANCE = 4;

export interface Bridge {
  /** 1 or 2 (the `deck` value of things on it). */
  n: number;
  id: 'north' | 'south';
  name: string;
  /** Axis (east-west, at this z). */
  z: number;
  /** West end (on the ground, at the city's edge) and east end (on the far shore). */
  x0: number;
  x1: number;
  /** The two suspension towers (x), standing in the water near the banks. */
  towers: [number, number];
}

export const BRIDGES: Bridge[] = [
  { n: 1, id: 'north', name: 'Kuzey Köprüsü · North Bridge', z: -50, x0: 160, x1: 620, towers: [304, 536] },
  { n: 2, id: 'south', name: 'Güney Köprüsü · South Bridge', z: 130, x0: 160, x1: 620, towers: [304, 536] },
];

export function bridgeByN(n: number): Bridge | undefined {
  return BRIDGES[n - 1];
}

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Height of a bridge's road surface at x (0 at both ends). */
export function deckHeight(b: Bridge, x: number): number {
  if (x <= b.x0 || x >= b.x1) return 0;
  if (x < b.x0 + RAMP_LEN) return DECK_HEIGHT * smooth((x - b.x0) / RAMP_LEN);
  if (x > b.x1 - RAMP_LEN) return DECK_HEIGHT * smooth((b.x1 - x) / RAMP_LEN);
  const w0 = WATER.west - 10;
  const w1 = WATER.east + 10;
  if (x > w0 && x < w1) return DECK_HEIGHT + SPAN_RISE * Math.sin((Math.PI * (x - w0)) / (w1 - w0));
  return DECK_HEIGHT;
}

/** Where a ramp is still too low to pass under: [x0, a] and [b, x1]. */
export function lowRamp(b: Bridge): [number, number] {
  // smooth(t) = CLEARANCE / DECK_HEIGHT, solved numerically (once).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (smooth(m) * DECK_HEIGHT < CLEARANCE) lo = m;
    else hi = m;
  }
  const d = lo * RAMP_LEN;
  return [b.x0 + d, b.x1 - d];
}
const LOW = BRIDGES.map(lowRamp);

/** Inside a bridge's footprint (its deck seen from above, rails included). */
export function inFootprint(b: Bridge, x: number, z: number, margin = 0.5): boolean {
  return x >= b.x0 && x <= b.x1 && Math.abs(z - b.z) <= BRIDGE_HALF + margin;
}

/**
 * The deck state after moving to (x, z): stays on a deck while inside its footprint; gets on from the
 * ground only at an end; anywhere else it is the ground (0).
 */
export function nextDeck(prev: number, x: number, z: number): number {
  for (const b of BRIDGES) {
    if (!inFootprint(b, x, z)) continue;
    if (prev === b.n) return b.n;
    if (prev === 0 && (x < b.x0 + ENTRY || x > b.x1 - ENTRY)) return b.n;
    return 0;
  }
  return 0;
}

/** A best guess for something placed at (x, z) without a history (spawned, teleported): on the
 *  deck over the water and on the ramps, otherwise on the ground. */
export function deckAt(x: number, z: number): number {
  for (const b of BRIDGES) {
    if (!inFootprint(b, x, z, 0)) continue;
    const [a, c] = LOW[b.n - 1]!;
    if (x < a || x > c || (x > WATER.west && x < WATER.east)) return b.n;
  }
  return 0;
}

/** Height of the surface something stands on: a bridge deck, or the ground (0). */
export function surfaceHeight(deck: number, x: number): number {
  const b = deck ? bridgeByN(deck) : undefined;
  return b ? deckHeight(b, x) : 0;
}

/** Under a bridge deck with headroom (the helicopter can't see in). */
export function underBridge(x: number, z: number): boolean {
  return BRIDGES.some((b) => inFootprint(b, x, z, -1) && deckHeight(b, x) >= CLEARANCE);
}

/** Bridge piers (ground level colliders): two columns per bent wherever the deck crosses land with
 *  headroom - in the belt, either side of the highway and on its median, and on both shores. */
export const BRIDGE_PIERS: { x: number; z: number; r: number }[] = (() => {
  const out: { x: number; z: number; r: number }[] = [];
  for (const b of BRIDGES) {
    for (const x of [200, 214, 240, 266, 284, 556, 590]) {
      for (const dz of [-8, 8]) out.push({ x, z: b.z + dz, r: x === 240 ? 0.75 : 1.1 });
    }
  }
  return out;
})();

/** Where the main cables come down: concrete anchor blocks on each shore, outside the deck. */
export const CABLE_Z = BRIDGE_HALF + 2.2;
export const ANCHOR_X: [number, number] = [274, 556];
export const ANCHOR_HALF = 5;

/** Solid blocks at ground level: the ramps where they are too low to pass under (beside the entry)
 *  and the cable anchorages. */
export const RAMP_BLOCKS: (AABB & { n: number })[] = BRIDGES.flatMap((b) => {
  const [a, c] = LOW[b.n - 1]!;
  const half = BRIDGE_HALF + 0.6;
  const anchors = ANCHOR_X.flatMap((x) => [-1, 1].map((side) => ({ n: b.n, minX: x - ANCHOR_HALF, maxX: x + ANCHOR_HALF, minZ: b.z + side * CABLE_Z - ANCHOR_HALF, maxZ: b.z + side * CABLE_Z + ANCHOR_HALF })));
  return [{ n: b.n, minX: b.x0 + ENTRY, maxX: a, minZ: b.z - half, maxZ: b.z + half }, { n: b.n, minX: c, maxX: b.x1 - ENTRY, minZ: b.z - half, maxZ: b.z + half }, ...anchors];
});

/** Height of the towers' tops and of the main cables between them (m). */
export const TOWER_TOP = 78;

/** Over the water (a boat would be needed). */
export function inWater(x: number): boolean {
  return x > WATER.west && x < WATER.east;
}

/** A straight line that would cross open water (not along a bridge's axis). */
export function crossesWater(ax: number, az: number, bx: number, bz: number): boolean {
  if (Math.max(ax, bx) <= WATER.west || Math.min(ax, bx) >= WATER.east) return false;
  return !BRIDGES.some((b) => Math.abs(az - b.z) < BRIDGE_HALF - 1 && Math.abs(bz - b.z) < BRIDGE_HALF - 1);
}

// ------------------------------------------------------------------ far shore roads

/** The VIP Otoban: a 3+3 lane boulevard down the far shore, and the bridge roads that run into it. */
export const VIP_X = 700;
export const VIP_HALF = 12;
export const FAR_ROAD_HALF = 7;

/** Far shore road surfaces (rectangles; the bridges' own decks are drawn separately). */
export const FAR_ROADS: AABB[] = [
  // VIP Otoban, north to south.
  { minX: VIP_X - VIP_HALF, maxX: VIP_X + VIP_HALF, minZ: -246, maxZ: 246 },
  // From each bridge's landing to the VIP Otoban.
  ...BRIDGES.map((b) => ({ minX: b.x1 - 4, maxX: VIP_X - VIP_HALF, minZ: b.z - BRIDGE_HALF, maxZ: b.z + BRIDGE_HALF })),
  // Shore road along the water (to the docks).
  { minX: 566, maxX: 580, minZ: -246, maxZ: 246 },
];

// ------------------------------------------------------------------ road graph

/** A junction of the road network (police routes). */
export interface NavNode {
  x: number;
  z: number;
}

const CITY_LINES = [-150, -50, 50, 150];

/** Road junctions: the city grid, where the bridge roads leave the city, the far shore. */
export const NAV_NODES: NavNode[] = (() => {
  const out: NavNode[] = [];
  for (const x of CITY_LINES) for (const z of CITY_LINES) out.push({ x, z });
  // The South Bridge leaves the city's east road between two junctions.
  out.push({ x: 150, z: 130 });
  // The VIP Otoban: its ends, the bridge landings and the boulevard junction.
  for (const z of [-240, -50, 40, 130, 240]) out.push({ x: VIP_X, z });
  return out;
})();

const nodeIndex = (x: number, z: number) => NAV_NODES.findIndex((n) => n.x === x && n.z === z);

/** Roads between junctions (both ways). `bridge` marks a bridge crossing. */
export const NAV_EDGES: { a: number; b: number; bridge?: number }[] = (() => {
  const out: { a: number; b: number; bridge?: number }[] = [];
  const add = (ax: number, az: number, bx: number, bz: number, bridge?: number) => {
    const a = nodeIndex(ax, az);
    const b = nodeIndex(bx, bz);
    if (a < 0 || b < 0) throw new Error(`nav edge ${ax},${az} - ${bx},${bz}`);
    out.push(bridge ? { a, b, bridge } : { a, b });
  };
  for (const x of CITY_LINES) {
    for (let i = 0; i < 3; i++) {
      add(CITY_LINES[i]!, x, CITY_LINES[i + 1]!, x);
      // The east road (x = 150) has the South Bridge junction between z = 50 and z = 150.
      if (x === 150 && i === 1) {
        add(150, 50, 150, 130);
        add(150, 130, 150, 150);
      } else add(x, CITY_LINES[i]!, x, CITY_LINES[i + 1]!);
    }
  }
  for (const b of BRIDGES) add(150, b.z, VIP_X, b.z, b.n);
  const vip = [-240, -50, 40, 130, 240];
  for (let i = 0; i < vip.length - 1; i++) add(VIP_X, vip[i]!, VIP_X, vip[i + 1]!);
  return out;
})();

/** Points along the roads (not the bridges) every `step` metres, with the road's direction: where
 *  police cars can join a chase. */
export function navRoadPoints(step = 10): { x: number; z: number; rot: number }[] {
  const out: { x: number; z: number; rot: number }[] = [];
  for (const e of NAV_EDGES) {
    if (e.bridge) continue;
    const a = NAV_NODES[e.a]!;
    const b = NAV_NODES[e.b]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const rot = Math.atan2(b.x - a.x, b.z - a.z);
    for (let d = 0; d <= len; d += step) out.push({ x: a.x + ((b.x - a.x) * d) / len, z: a.z + ((b.z - a.z) * d) / len, rot });
  }
  return out;
}

/** The ends of a bridge where you get on and off (just off the deck, on the axis). */
export function bridgeEnds(b: Bridge): [NavNode, NavNode] {
  return [
    { x: b.x0 - 6, z: b.z },
    { x: b.x1 + 6, z: b.z },
  ];
}

// The far shore across the strait (Karşı Kıyı): what is on it besides the VIP Otoban and the bridge
// landings (shared/strait.ts).
//  - The touge (Dağ Yolu): a hill in the north-east with a two-lane mountain road that climbs its
//    face in five switchbacks (tight hairpins at the ends) over the top and comes down in fast
//    sweepers to the boulevard. Guardrails on both sides the whole way.
//  - The Galeri Bulvarı: the boulevard the eight themed showrooms stand on.
//  - The docks (Liman): a container yard on the sea with drift lanes between the stacks, gantry
//    cranes on the quay and flood-light towers.
// The physics is flat: the hill only lifts what is drawn (and the shots fired up there); the
// guardrails, containers, crane legs and towers are colliders.

import type { OBB } from './obb';
import { VIP_HALF, VIP_X, WORLD_BOX, bridgeByN, deckHeight } from './strait';
import type { AABB, Circle } from './world';

// ------------------------------------------------------------------ the hill

/** The hill: centre, radii and height (m). */
export const HILL = { x: 905, z: -165, rx: 172, rz: 112, top: 30 };

/** Ground height on the far shore (0 everywhere but the hill). */
export function terrainHeight(x: number, z: number): number {
  const dx = (x - HILL.x) / HILL.rx;
  const dz = (z - HILL.z) / HILL.rz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= 1) return 0;
  const d = Math.sqrt(d2);
  return (HILL.top * (Math.cos(Math.PI * d) + 1)) / 2;
}

/** Height of what something stands on: a bridge deck, the hill, or the flat ground. */
export function standHeight(deck: number, x: number, z: number): number {
  const b = deck ? bridgeByN(deck) : undefined;
  return b ? deckHeight(b, x) : terrainHeight(x, z);
}

/** Where a ray from (x, y, z) along (dx, slope, dz) per horizontal metre first goes into the hill
 *  (t in metres), or null. Coarse steps refined by bisection. */
export function rayHitsHill(x: number, y: number, z: number, dx: number, dz: number, slope: number, maxT: number): number | null {
  // Quick reject: nowhere near the hill's bounding box.
  const x1 = x + dx * maxT;
  const z1 = z + dz * maxT;
  if (Math.max(x, x1) < HILL.x - HILL.rx || Math.min(x, x1) > HILL.x + HILL.rx || Math.max(z, z1) < HILL.z - HILL.rz || Math.min(z, z1) > HILL.z + HILL.rz) return null;
  const above = (t: number) => y + slope * t - terrainHeight(x + dx * t, z + dz * t);
  if (above(0) < 0) return 0;
  let prev = 0;
  for (let t = 1.5; t <= maxT; t += 1.5) {
    if (above(t) < 0) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 12; i++) {
        const m = (lo + hi) / 2;
        if (above(m) < 0) hi = m;
        else lo = m;
      }
      return hi;
    }
    prev = t;
  }
  return null;
}

/** Slope of the ground (rise per metre) along x and z. */
export function terrainGradient(x: number, z: number): { gx: number; gz: number } {
  const e = 0.5;
  return { gx: (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e), gz: (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e) };
}

// ------------------------------------------------------------------ the touge

/** Half the touge's road width (two lanes) and where its guardrails stand. */
export const TOUGE_HALF = 4;
export const TOUGE_RAIL = TOUGE_HALF + 0.5;
const HAIRPIN_R = 11;

/** The touge's centreline, sampled about every 2 m (from the VIP Otoban to the boulevard). */
export const TOUGE_PATH: { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = [];
  const line = (ax: number, az: number, bx: number, bz: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let i = out.length ? 1 : 0; i <= n; i++) out.push({ x: ax + ((bx - ax) * i) / n, z: az + ((bz - az) * i) / n });
  };
  // A hairpin: half a circle from (x, z) to (x, z + 2r), bulging east (+1) or west (-1).
  const hairpin = (x: number, z: number, side: 1 | -1) => {
    const n = 18;
    for (let i = 1; i <= n; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / n;
      out.push({ x: x + side * Math.cos(a) * HAIRPIN_R, z: z + HAIRPIN_R + Math.sin(a) * HAIRPIN_R });
    }
  };
  const start = VIP_X + VIP_HALF;
  line(start, -236, 850, -236);
  hairpin(850, -236, 1);
  line(850, -214, 770, -214);
  hairpin(770, -214, -1);
  line(770, -192, 870, -192);
  hairpin(870, -192, 1);
  line(870, -170, 800, -170);
  hairpin(800, -170, -1);
  // Over the top, then fast sweepers down to the boulevard.
  line(800, -148, 950, -148);
  const sweep: [number, number][] = [
    [950, -148],
    [972, -142],
    [990, -128],
    [998, -110],
    [994, -92],
    [1000, -74],
    [1016, -60],
    [1032, -42],
    [1038, -20],
    [1034, 2],
    [1030, 20],
    [1030, 33],
  ];
  for (let i = 1; i < sweep.length; i++) {
    const [ax, az] = sweep[i - 1]!;
    const [bx, bz] = sweep[i]!;
    line(ax, az, bx, bz);
  }
  return smoothPath(out);
})();

/** Rounds the corners of the sweepers (a few passes of neighbour averaging, ends fixed). */
function smoothPath(p: { x: number; z: number }[]): { x: number; z: number }[] {
  let cur = p;
  for (let pass = 0; pass < 6; pass++) {
    const next = cur.map((q, i) => {
      if (i === 0 || i === cur.length - 1) return q;
      const a = cur[i - 1]!;
      const b = cur[i + 1]!;
      return { x: (a.x + 2 * q.x + b.x) / 4, z: (a.z + 2 * q.z + b.z) / 4 };
    });
    cur = next;
  }
  return cur;
}

/** The two guardrails (offset polylines), as points. */
export function tougeRails(): { left: { x: number; z: number }[]; right: { x: number; z: number }[] } {
  const left: { x: number; z: number }[] = [];
  const right: { x: number; z: number }[] = [];
  const p = TOUGE_PATH;
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)]!;
    const b = p[Math.min(p.length - 1, i + 1)]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // Left of the direction of travel (start to end).
    const nx = -(b.z - a.z) / l;
    const nz = (b.x - a.x) / l;
    left.push({ x: p[i]!.x + nx * TOUGE_RAIL, z: p[i]!.z + nz * TOUGE_RAIL });
    right.push({ x: p[i]!.x - nx * TOUGE_RAIL, z: p[i]!.z - nz * TOUGE_RAIL });
  }
  return { left, right };
}

/** Distance from a point to the touge's centreline. */
export function distToTouge(x: number, z: number): number {
  let best = Infinity;
  const p = TOUGE_PATH;
  for (let i = 1; i < p.length; i++) best = Math.min(best, segDist(x, z, p[i - 1]!.x, p[i - 1]!.z, p[i]!.x, p[i]!.z));
  return best;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// ------------------------------------------------------------------ the boulevard and the docks

/** The Galeri Bulvarı (east-west) and the road from it down to the docks. */
export const BOULEVARD: AABB = { minX: VIP_X + VIP_HALF, maxX: 1044, minZ: 33, maxZ: 47 };
export const DOCKS_ROAD: AABB = { minX: 868, maxX: 882, minZ: 47, maxZ: 150 };
/** The docks' west gate road from the VIP Otoban. */
export const DOCKS_GATE: AABB = { minX: VIP_X + VIP_HALF, maxX: 722, minZ: 193, maxZ: 207 };

/** The container yard (open to the north and the west gate, the sea to the south). */
export const DOCKS: AABB = { minX: 722, maxX: 1052, minZ: 150, maxZ: WORLD_BOX.maxZ };

/** A stack of containers: its footprint, how many high, and the colours. */
export interface ContainerStack extends AABB {
  high: number;
  seed: number;
}

/** Rows of stacked containers with wide lanes between them (for drifting). */
export const CONTAINER_STACKS: ContainerStack[] = (() => {
  const out: ContainerStack[] = [];
  let seed = 7;
  for (const z of [172, 200, 228]) {
    for (const x of [755, 815, 935, 995]) {
      seed += 13;
      out.push({ minX: x - 17, maxX: x + 17, minZ: z - 3, maxZ: z + 3, high: 1 + (seed % 3), seed });
    }
  }
  // Short stacks either side of the docks road's lane (it carries on into the yard).
  out.push({ minX: 850, maxX: 862, minZ: 197, maxZ: 203, high: 2, seed: 99 }, { minX: 888, maxX: 900, minZ: 197, maxZ: 203, high: 3, seed: 101 });
  return out;
})();

/** Gantry cranes on the quay (x of each), and the z of their two leg rows. */
export const CRANES_X = [790, 905, 1010];
export const CRANE_LEGS_Z: [number, number] = [240, 256];
/** Flood-light towers in the yard. */
export const LIGHT_TOWERS: { x: number; z: number }[] = [
  { x: 728, z: 156 },
  { x: 875, z: 214 },
  { x: 1046, z: 156 },
  { x: 728, z: 246 },
];

/** The yard's fence (thin boxes), open at the west gate and where the docks road comes in. */
export const DOCK_FENCES: AABB[] = (() => {
  const d = DOCKS;
  const t = 0.3;
  return [
    { minX: d.minX - t, maxX: d.minX + t, minZ: d.minZ, maxZ: DOCKS_GATE.minZ },
    { minX: d.minX - t, maxX: d.minX + t, minZ: DOCKS_GATE.maxZ, maxZ: d.maxZ },
    { minX: d.minX, maxX: DOCKS_ROAD.minX, minZ: d.minZ - t, maxZ: d.minZ + t },
    { minX: DOCKS_ROAD.maxX, maxX: d.maxX, minZ: d.minZ - t, maxZ: d.minZ + t },
    { minX: d.maxX - t, maxX: d.maxX + t, minZ: d.minZ, maxZ: d.maxZ },
  ];
})();

/** Ground-level boxes on the far shore (containers, the docks' fence). */
export const FAR_BOXES: AABB[] = [...CONTAINER_STACKS.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ })), ...DOCK_FENCES];

/** Ground-level circles on the far shore: crane legs, light towers, the hill's trees. */
export const FAR_CIRCLES: Circle[] = [
  ...CRANES_X.flatMap((x) => CRANE_LEGS_Z.flatMap((z) => [-7, 7].map((dx) => ({ x: x + dx, z, r: 0.9 })))),
  ...LIGHT_TOWERS.map((t) => ({ x: t.x, z: t.z, r: 0.7 })),
];

/** Trees on the hill (deterministic; off the touge and its rails; colliders). */
export const HILL_TREES: { x: number; z: number; s: number }[] = (() => {
  let seed = 31337;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 900 && out.length < 170; i++) {
    const x = HILL.x + (rng() * 2 - 1) * HILL.rx;
    const z = HILL.z + (rng() * 2 - 1) * HILL.rz;
    const s = 0.9 + rng() * 0.9;
    if (terrainHeight(x, z) < 2 || z < WORLD_BOX.minZ + 3 || x > WORLD_BOX.maxX - 3) continue;
    if (x < VIP_X + VIP_HALF + 8 || distToTouge(x, z) < TOUGE_RAIL + 5) continue;
    if (z > BOULEVARD.minZ - 8) continue;
    out.push({ x, z, s });
  }
  return out;
})();

// ------------------------------------------------------------------ guardrail colliders

/** A thin wall segment (guardrails) as a box. */
export interface Wall extends OBB {}

function wallOf(ax: number, az: number, bx: number, bz: number, half = 0.2): Wall {
  return { x: (ax + bx) / 2, z: (az + bz) / 2, rot: Math.atan2(bx - ax, bz - az), hl: Math.hypot(bx - ax, bz - az) / 2 + 0.05, hw: half };
}

/** The touge's guardrails as wall boxes (open at both ends, where it meets the other roads). */
export const FAR_WALLS: Wall[] = (() => {
  const out: Wall[] = [];
  const { left, right } = tougeRails();
  for (const rail of [left, right]) {
    // Leave the first and last few metres open (the junctions).
    for (let i = 5; i < rail.length - 5; i++) {
      const a = rail[i - 1]!;
      const b = rail[i]!;
      out.push(wallOf(a.x, a.z, b.x, b.z));
    }
  }
  return out;
})();

/** Wall boxes by grid cell (40 m), for quick lookups. */
const CELL = 40;
const wallGrid = new Map<string, number[]>();
FAR_WALLS.forEach((w, i) => {
  const r = w.hl + w.hw;
  for (let cx = Math.floor((w.x - r) / CELL); cx <= Math.floor((w.x + r) / CELL); cx++) {
    for (let cz = Math.floor((w.z - r) / CELL); cz <= Math.floor((w.z + r) / CELL); cz++) {
      const k = `${cx},${cz}`;
      const list = wallGrid.get(k);
      if (list) list.push(i);
      else wallGrid.set(k, [i]);
    }
  }
});

/** Walls that might touch something within `r` of (x, z). */
export function wallsNear(x: number, z: number, r: number, out: Wall[] = []): Wall[] {
  out.length = 0;
  if (x + r < 700 || z - r > 60) return out;
  const seen = new Set<number>();
  for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
    for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
      for (const i of wallGrid.get(`${cx},${cz}`) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        out.push(FAR_WALLS[i]!);
      }
    }
  }
  return out;
}

/** Does a straight line cross a guardrail? (police lines of sight) */
export function crossesWall(ax: number, az: number, bx: number, bz: number): boolean {
  if (Math.max(ax, bx) < 700 || Math.min(az, bz) > 60) return false;
  const { left, right } = RAILS;
  for (const rail of [left, right]) {
    for (let i = 5; i < rail.length - 5; i++) if (segmentsCross(ax, az, bx, bz, rail[i - 1]!.x, rail[i - 1]!.z, rail[i]!.x, rail[i]!.z)) return true;
  }
  return false;
}
const RAILS = tougeRails();

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  // Touching counts (a line through a rail post), lying along the same line does not.
  if (d1 === 0 && d2 === 0) return false;
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/** Road junctions on the far shore for the police graph: along the touge, the boulevard, the docks. */
export const TOUGE_NODES: { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = [];
  const p = TOUGE_PATH;
  for (let i = 0; i < p.length; i += 5) out.push({ x: Math.round(p[i]!.x * 10) / 10, z: Math.round(p[i]!.z * 10) / 10 });
  const last = p[p.length - 1]!;
  const end = { x: Math.round(last.x * 10) / 10, z: Math.round(last.z * 10) / 10 };
  const prev = out[out.length - 1]!;
  if (prev.x !== end.x || prev.z !== end.z) out.push(end);
  return out;
})();

// Back alleys: narrow passages through three city blocks between rows of old apartment buildings,
// with fire escapes overhead and, behind Wrench Bros, a flight of steps up to a raised courtyard
// and back down. Steel bollards stand across both ends: a motorcycle or an ATV slips between them,
// a car (and a police interceptor) can't. Dive in at speed with the police behind you and they hit
// the bollards; the ones that see where you went race round to the other end instead.

import type { AABB, Building, Circle } from './world';

export interface Alley {
  id: string;
  name: string;
  /** Runs along x (east-west) or z (north-south). */
  axis: 'x' | 'z';
  /** Centre line (z for an east-west alley, x for a north-south one), and where it runs along the axis. */
  c: number;
  from: number;
  to: number;
  /** Steps up to a raised middle section and back down: start of the climb, top reached, start of
   *  the way down, bottom; along the axis. */
  stairs?: { up: number; top: number; down: number; end: number; rise: number };
  /** Fire escapes on the walls: where along the axis, on which wall (-1: the lower-coordinate side). */
  fireEscapes: [number, -1 | 1][];
}

/** Half the width of the passage between the walls (m). */
export const ALLEY_HALF = 2.5;
/** A steel bollard's radius; two stand across each end, splitting it in thirds (gaps about 1.45 m:
 *  the widest bike, an ATV, is 1.0 m; the narrowest car 1.6 m, and an invisible gate on the
 *  bollard line stops every car anyway). */
export const BOLLARD_R = 0.12;
/** How far inside the end of the passage the bollards stand. */
const BOLLARD_INSET = 0.7;

export const ALLEYS: Alley[] = [
  {
    id: 'wrench',
    name: 'Tamirhane Arka Sokağı',
    axis: 'x',
    c: 118,
    from: 59,
    to: 141,
    stairs: { up: 90, top: 94.5, down: 105.5, end: 110, rise: 1.2 },
    fireEscapes: [
      [70, -1],
      [84, 1],
      [119, -1],
      [132, 1],
    ],
  },
  {
    id: 'auction',
    name: 'Müzayede Arka Sokağı',
    axis: 'x',
    c: 30.5,
    from: 59,
    to: 141,
    fireEscapes: [
      [68, 1],
      [92, -1],
      [113, 1],
      [131, -1],
    ],
  },
  {
    id: 'chroma',
    name: 'Chroma Pasajı',
    axis: 'z',
    c: -70,
    from: 59,
    to: 97,
    fireEscapes: [
      [67, -1],
      [86, 1],
    ],
  },
];

/** The open passage of an alley (between the walls, end to end). */
export function alleyBox(a: Alley): AABB {
  return a.axis === 'x' ? { minX: a.from, maxX: a.to, minZ: a.c - ALLEY_HALF, maxZ: a.c + ALLEY_HALF } : { minX: a.c - ALLEY_HALF, maxX: a.c + ALLEY_HALF, minZ: a.from, maxZ: a.to };
}

/** World point from (along the axis, across it). */
export function alleyPoint(a: Alley, along: number, across: number): { x: number; z: number } {
  return a.axis === 'x' ? { x: along, z: a.c + across } : { x: a.c + across, z: along };
}

/** The alley a point is in (inside the passage), if any. */
export function alleyAt(x: number, z: number): Alley | undefined {
  return ALLEYS.find((a) => {
    const b = alleyBox(a);
    return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
  });
}

/** The two bollards across each end of every alley (solid for everyone). */
export const BOLLARDS: Circle[] = ALLEYS.flatMap((a) =>
  [a.from + BOLLARD_INSET, a.to - BOLLARD_INSET].flatMap((along) => [-1, 1].map((k) => ({ ...alleyPoint(a, along, (k * (ALLEY_HALF * 2)) / 6), r: BOLLARD_R }))),
);

/** Invisible gates on the bollard lines that only cars meet (bikes and ATVs thread between the
 *  bollards themselves): a car hitting the bollards always stops dead instead of being squeezed
 *  sideways between them. */
export const CAR_GATES: AABB[] = ALLEYS.flatMap((a) =>
  [a.from + BOLLARD_INSET, a.to - BOLLARD_INSET].map((along) => {
    const p = alleyPoint(a, along, 0);
    return a.axis === 'x' ? { minX: p.x - 0.3, maxX: p.x + 0.3, minZ: a.c - ALLEY_HALF, maxZ: a.c + ALLEY_HALF } : { minX: a.c - ALLEY_HALF, maxX: a.c + ALLEY_HALF, minZ: p.z - 0.3, maxZ: p.z + 0.3 };
  }),
);

/** Dumpsters against the walls (along the axis, which wall): something to weave round. */
export const DUMPSTERS: { alley: string; along: number; side: -1 | 1 }[] = [
  { alley: 'wrench', along: 66, side: 1 },
  { alley: 'wrench', along: 127, side: -1 },
  { alley: 'auction', along: 75, side: -1 },
  { alley: 'auction', along: 103, side: 1 },
  { alley: 'auction', along: 125, side: -1 },
  { alley: 'chroma', along: 73, side: 1 },
];
/** A dumpster sticks out this far from the wall and is this long. */
export const DUMPSTER_DEPTH = 1.05;
export const DUMPSTER_LEN = 1.9;

/** The dumpsters' colliders: two circles each. */
export const DUMPSTER_CIRCLES: Circle[] = DUMPSTERS.flatMap((d) => {
  const a = ALLEYS.find((x) => x.id === d.alley)!;
  const across = d.side * (ALLEY_HALF - DUMPSTER_DEPTH / 2);
  return [-0.45, 0.45].map((k) => ({ ...alleyPoint(a, d.along + k, across), r: DUMPSTER_DEPTH / 2 }));
});

/** The ends of an alley out on the street (a few metres past the bollards), lower end first. */
export function alleyMouths(a: Alley, out = 6): [{ x: number; z: number }, { x: number; z: number }] {
  return [alleyPoint(a, a.from - out, 0), alleyPoint(a, a.to + out, 0)];
}

/** Height of the alley floor above the pavement (the steps behind Wrench Bros), m. */
export function alleyRise(x: number, z: number): number {
  const a = alleyAt(x, z);
  const s = a?.stairs;
  if (!a || !s) return 0;
  const t = a.axis === 'x' ? x : z;
  if (t <= s.up || t >= s.end) return 0;
  if (t < s.top) return (s.rise * (t - s.up)) / (s.top - s.up);
  if (t <= s.down) return s.rise;
  return (s.rise * (s.end - t)) / (s.end - s.down);
}

// ---------------------------------------------------------------- the buildings either side

const BRICKS = ['#8a4b3c', '#a0613f', '#6f4a3a', '#9c7a5b', '#7b5a4d', '#b07b5a', '#5f4b43', '#8c6d5a'];

/** A row of buildings along one side of an alley: [start, end, height] segments along the axis,
 *  from the wall to `depth` (the far side) across. */
function row(a: Alley, side: -1 | 1, far: number, segs: [number, number, number][], facing: Building['facing'], seed: number): Building[] {
  const near = a.c + side * ALLEY_HALF;
  const lo = Math.min(near, far);
  const hi = Math.max(near, far);
  return segs.map(([s0, s1, h], i) => ({
    id: `alley_${a.id}_${side < 0 ? 'l' : 'r'}${i + 1}`,
    box: a.axis === 'x' ? { minX: s0, maxX: s1, minZ: lo, maxZ: hi } : { minX: lo, maxX: hi, minZ: s0, maxZ: s1 },
    height: h,
    color: BRICKS[(seed + i * 3) % BRICKS.length]!,
    kind: 'office' as const,
    facing,
  }));
}

const [WRENCH, AUCTION, CHROMA] = ALLEYS as [Alley, Alley, Alley];

/** Shops in the rows, with their signs on the street side (heist targets robbed through their
 *  back doors on the alley: shared/heists.ts). */
const SHOPS: Record<string, { sign: string; signColor: string; color?: string }> = {
  alley_wrench_r2: { sign: 'KUYUMCU ALTINSARAY', signColor: '#ffc53d', color: '#3b2a1e' },
  alley_wrench_l3: { sign: 'ATLAS OFİS PLAZA', signColor: '#4f8cff', color: '#5c6b7a' },
  alley_auction_r2: { sign: 'MEGA MARKET 7/24', signColor: '#2ec4b6' },
  alley_chroma_r1: { sign: 'EMLAK DÜNYASI', signColor: '#ff7a1a' },
};

/** The apartment rows that make the alleys (colliders; drawn like the other buildings). */
export const ALLEY_BUILDINGS: Building[] = [
  ...row(WRENCH, -1, 101, [[59, 77, 13], [77, 93, 10], [93, 108, 15], [108, 125, 11], [125, 141, 14]], 'north', 0),
  ...row(WRENCH, 1, 141, [[59, 79, 12], [79, 97, 16], [97, 115, 10], [115, 141, 13]], 'south', 1),
  ...row(AUCTION, -1, 21.5, [[59, 78, 8], [78, 100, 7], [100, 121, 9], [121, 141, 7]], 'north', 2),
  ...row(AUCTION, 1, 41, [[59, 82, 11], [82, 104, 9], [104, 124, 12], [124, 141, 10]], 'south', 5),
  ...row(CHROMA, -1, -84, [[59, 78, 12]], 'north', 4),
  ...row(CHROMA, -1, -84, [[78, 97, 9]], 'south', 7).map((b) => ({ ...b, id: 'alley_chroma_l2' })),
  ...row(CHROMA, 1, -59, [[59, 78, 14], [78, 97, 10]], 'east', 6),
].map((b) => (SHOPS[b.id] ? { ...b, ...SHOPS[b.id] } : b));

// Oriented bounding boxes (OBBs): tight rectangles around vehicle bodies for collisions and the
// near-miss clearance. A box is centred at (x, z), faces `rot` (forward = (sin rot, cos rot),
// right = (cos rot, -sin rot)) and extends `hl` along its length and `hw` across.

import type { AABB } from './world';

export interface OBB {
  x: number;
  z: number;
  rot: number;
  hl: number;
  hw: number;
}

export interface Contact {
  /** Direction to push the first shape out (unit). */
  nx: number;
  nz: number;
  depth: number;
  /** A point on the contact (world). */
  px: number;
  pz: number;
}

/** The four corners (front-right, front-left, rear-left, rear-right). */
export function obbCorners(b: OBB, out: number[] = []): number[] {
  const fx = Math.sin(b.rot);
  const fz = Math.cos(b.rot);
  const rx = fz;
  const rz = -fx;
  out.length = 0;
  for (const [a, c] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    out.push(b.x + fx * b.hl * a + rx * b.hw * c, b.z + fz * b.hl * a + rz * b.hw * c);
  }
  return out;
}

export function aabbToObb(a: AABB): OBB {
  return { x: (a.minX + a.maxX) / 2, z: (a.minZ + a.maxZ) / 2, rot: 0, hl: (a.maxZ - a.minZ) / 2, hw: (a.maxX - a.minX) / 2 };
}

/** Quick reject: bounding radius test. */
export function obbNear(a: OBB, b: OBB, margin = 0): boolean {
  const r = Math.hypot(a.hl, a.hw) + Math.hypot(b.hl, b.hw) + margin;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz < r * r;
}

const cA: number[] = [];
const cB: number[] = [];

function inside(b: OBB, px: number, pz: number, slack = 1e-6): boolean {
  const dx = px - b.x;
  const dz = pz - b.z;
  const f = dx * Math.sin(b.rot) + dz * Math.cos(b.rot);
  const r = dx * Math.cos(b.rot) - dz * Math.sin(b.rot);
  return Math.abs(f) <= b.hl + slack && Math.abs(r) <= b.hw + slack;
}

/**
 * Separating-axis test between two boxes. Returns how to push `a` out of `b`, or null when they
 * don't touch.
 */
export function obbVsObb(a: OBB, b: OBB): Contact | null {
  if (!obbNear(a, b)) return null;
  const axes = [
    [Math.sin(a.rot), Math.cos(a.rot)],
    [Math.cos(a.rot), -Math.sin(a.rot)],
    [Math.sin(b.rot), Math.cos(b.rot)],
    [Math.cos(b.rot), -Math.sin(b.rot)],
  ];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (const [ax, az] of axes as [number, number][]) {
    const ra = a.hl * Math.abs(Math.sin(a.rot) * ax + Math.cos(a.rot) * az) + a.hw * Math.abs(Math.cos(a.rot) * ax - Math.sin(a.rot) * az);
    const rb = b.hl * Math.abs(Math.sin(b.rot) * ax + Math.cos(b.rot) * az) + b.hw * Math.abs(Math.cos(b.rot) * ax - Math.sin(b.rot) * az);
    const d = dx * ax + dz * az;
    const overlap = ra + rb - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < best) {
      best = overlap;
      // Push a away from b.
      const s = d > 0 ? -1 : 1;
      bx = ax * s;
      bz = az * s;
    }
  }
  // Contact point: corners of one box inside the other (averaged), else the midpoint.
  obbCorners(a, cA);
  obbCorners(b, cB);
  let px = 0;
  let pz = 0;
  let n = 0;
  for (let i = 0; i < 8; i += 2) {
    if (inside(b, cA[i]!, cA[i + 1]!, 0.02)) {
      px += cA[i]!;
      pz += cA[i + 1]!;
      n++;
    }
    if (inside(a, cB[i]!, cB[i + 1]!, 0.02)) {
      px += cB[i]!;
      pz += cB[i + 1]!;
      n++;
    }
  }
  if (n === 0) {
    px = (a.x + b.x) / 2;
    pz = (a.z + b.z) / 2;
    n = 1;
  }
  return { nx: bx, nz: bz, depth: best, px: px / n, pz: pz / n };
}

/** Push a box out of an axis-aligned box. */
export function obbVsAabb(a: OBB, box: AABB): Contact | null {
  return obbVsObb(a, aabbToObb(box));
}

/** Box against a circle (push the box out). */
export function obbVsCircle(a: OBB, cx: number, cz: number, r: number): Contact | null {
  const hit = circleVsObb(cx, cz, r, a);
  if (!hit) return null;
  return { nx: -hit.nx, nz: -hit.nz, depth: hit.depth, px: hit.px, pz: hit.pz };
}

/** Circle against a box: how to push the circle out (unit normal and depth), or null. */
export function circleVsObb(cx: number, cz: number, r: number, b: OBB): Contact | null {
  const fx = Math.sin(b.rot);
  const fz = Math.cos(b.rot);
  const rx = fz;
  const rz = -fx;
  const dx = cx - b.x;
  const dz = cz - b.z;
  const lf = dx * fx + dz * fz;
  const lr = dx * rx + dz * rz;
  if (Math.abs(lf) > b.hl + r || Math.abs(lr) > b.hw + r) return null;
  const qf = Math.max(-b.hl, Math.min(b.hl, lf));
  const qr = Math.max(-b.hw, Math.min(b.hw, lr));
  const px = b.x + fx * qf + rx * qr;
  const pz = b.z + fz * qf + rz * qr;
  let nx = cx - px;
  let nz = cz - pz;
  const d = Math.hypot(nx, nz);
  if (d > 1e-6) {
    if (d >= r) return null;
    return { nx: nx / d, nz: nz / d, depth: r - d, px, pz };
  }
  // Centre inside the box: leave by the nearest face.
  const toF = b.hl - Math.abs(lf);
  const toR = b.hw - Math.abs(lr);
  if (toF < toR) {
    const s = lf >= 0 ? 1 : -1;
    nx = fx * s;
    nz = fz * s;
    return { nx, nz, depth: toF + r, px, pz };
  }
  const s = lr >= 0 ? 1 : -1;
  nx = rx * s;
  nz = rz * s;
  return { nx, nz, depth: toR + r, px, pz };
}

function segPointDist2(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + vx * t - px;
  const qz = az + vz * t - pz;
  return qx * qx + qz * qz;
}

/** Exact clearance between two boxes (0 when they overlap): the near-miss distance. */
export function obbDistance(a: OBB, b: OBB): number {
  if (obbVsObb(a, b)) return 0;
  obbCorners(a, cA);
  obbCorners(b, cB);
  let best = Infinity;
  for (let i = 0; i < 8; i += 2) {
    const j = (i + 2) % 8;
    for (let k = 0; k < 8; k += 2) {
      best = Math.min(best, segPointDist2(cA[i]!, cA[i + 1]!, cA[j]!, cA[j + 1]!, cB[k]!, cB[k + 1]!));
      best = Math.min(best, segPointDist2(cB[i]!, cB[i + 1]!, cB[j]!, cB[j + 1]!, cA[k]!, cA[k + 1]!));
    }
  }
  return Math.sqrt(best);
}

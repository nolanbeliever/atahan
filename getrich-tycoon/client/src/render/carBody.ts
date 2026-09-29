// Procedural car bodies. The lower body is lofted from rounded (superellipse) cross-sections along
// the length, following the side profile, plan shape and wheel arches of a CarDesign. The cabin is
// a second loft of glass with a painted roof skin and pillars on top. Lamps, grilles, trim lines
// and bumpers are thin patches projected onto the body surface, so they follow its curvature.
// Geometry is built once per model, merged per material slot and cached.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getModel } from '../../../shared/vehicles';
import { designFor, type CarDesign, type Lamp, type RimStyle } from './carDesigns';

/** What a piece of geometry is made of. */
type Piece = 'paint' | 'roof' | 'pillar' | 'glass' | 'dark' | 'chrome' | 'head' | 'tail' | 'plate' | 'interior' | 'tire';
/**
 * Material slots of the finished body. Dark trim, interior and plates share one vertex-coloured
 * slot, and so do head and tail lamps, which keeps every car at a handful of draw calls.
 */
export type Part = 'paint' | 'roof' | 'pillar' | 'glass' | 'trim' | 'chrome' | 'lamp' | 'tire';

const linear = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const PIECE_COLORS: Partial<Record<Piece, [number, number, number]>> = {
  dark: linear('#141619'),
  interior: linear('#2d201c'),
  plate: linear('#f1f1ea'),
  head: [1, 1, 1],
  tail: [1, 0.07, 0.1],
};

type V2 = [number, number];
type V3 = [number, number, number];

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
/** Section taper: tucked-in bottom, slight tumblehome at the top. */
const taper = (yn: number) => (yn < 0 ? 1 + 0.07 * yn : 1 - 0.035 * yn);

// ------------------------------------------------------------------ geometry helpers

/** Keep every piece in the same layout (non-indexed, position/normal/uv) so they can be merged. */
function finalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  return out;
}

/**
 * Loft closed rings (counter-clockwise seen from the front, same point count) through stations of
 * increasing u. Caps get their own vertices so they shade flat.
 */
function loft(stations: number[], ring: (u: number) => V2[], L: number, caps: [boolean, boolean], uvOf?: (x: number, y: number, z: number) => V2): THREE.BufferGeometry {
  const rings = stations.map((u) => ring(u));
  const n = rings[0]!.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  rings.forEach((r, i) => {
    const z = stations[i]! * L;
    for (const [x, y] of r) {
      pos.push(x, y, z);
      const t = uvOf ? uvOf(x, y, z) : [0, 0];
      uv.push(t[0], t[1]);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      const c = (i + 1) * n + j;
      const e = (i + 1) * n + ((j + 1) % n);
      idx.push(a, b, c, b, e, c);
    }
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  side.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  side.setIndex(idx);
  side.computeVertexNormals();
  const parts = [finalize(side)];
  const cap = (r: V2[], z: number, front: boolean) => {
    const cx = r.reduce((s, p) => s + p[0], 0) / r.length;
    const cy = r.reduce((s, p) => s + p[1], 0) / r.length;
    const p: number[] = [];
    for (let j = 0; j < r.length; j++) {
      const a = r[j]!;
      const b = r[(j + 1) % r.length]!;
      if (front) p.push(cx, cy, z, a[0], a[1], z, b[0], b[1], z);
      else p.push(cx, cy, z, b[0], b[1], z, a[0], a[1], z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    parts.push(finalize(g));
  };
  if (caps[0]) cap(rings[0]!, stations[0]! * L, false);
  if (caps[1]) cap(rings[rings.length - 1]!, stations[stations.length - 1]! * L, true);
  return parts.length === 1 ? parts[0]! : mergeGeometries(parts, false)!;
}

/** A (nu+1) x (nv+1) grid of points. Triangles face along (dir i) x (dir j), or the opposite if `flip`. */
function grid(nu: number, nv: number, at: (i: number, j: number) => V3 | null, flip: boolean): THREE.BufferGeometry | null {
  const pts: V3[] = [];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const p = at(i, j);
      if (!p || p.some((v) => !Number.isFinite(v))) return null;
      pts.push(p);
    }
  }
  const idx: number[] = [];
  const id = (i: number, j: number) => i * (nv + 1) + j;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = id(i, j);
      const b = id(i + 1, j);
      const c = id(i, j + 1);
      const e = id(i + 1, j + 1);
      if (flip) idx.push(a, c, b, b, c, e);
      else idx.push(a, b, c, b, e, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(points: V3[], radius: number, radial = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, Math.max(4, points.length * 3), radius, radial, false);
}

function boxAt(w: number, h: number, dz: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, dz);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

// ------------------------------------------------------------------ wheels (shared by all cars)

const tireCache = new Map<number, THREE.BufferGeometry>();
/** Unit tire (outer radius 1, width 1) around the X axis; `inner` is the rim radius fraction. */
export function tireGeometry(inner: number): THREE.BufferGeometry {
  const key = Math.round(inner * 100);
  const hit = tireCache.get(key);
  if (hit) return hit;
  const prof: [number, number][] = [
    [inner, -0.46],
    [0.9, -0.5],
    [0.975, -0.43],
    [1, -0.26],
    [1, 0.26],
    [0.975, 0.43],
    [0.9, 0.5],
    [inner, 0.46],
  ];
  const g = new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    20,
  );
  g.rotateZ(-Math.PI / 2);
  tireCache.set(key, g);
  return g;
}

const rimCache = new Map<RimStyle, { face: THREE.BufferGeometry; back: THREE.BufferGeometry }>();
/** Unit rim (radius 1) around the X axis with its face towards +X: `face` is metal, `back` is dark. */
export function rimGeometry(style: RimStyle): { face: THREE.BufferGeometry; back: THREE.BufferGeometry } {
  const hit = rimCache.get(style);
  if (hit) return hit;
  const faceX = 0.34;
  const pieces: THREE.BufferGeometry[] = [];
  const lip = new THREE.TorusGeometry(0.96, 0.045, 5, 20);
  lip.rotateY(Math.PI / 2);
  lip.translate(faceX, 0, 0);
  pieces.push(lip);
  const hub = new THREE.CylinderGeometry(0.2, 0.24, 0.12, 12);
  hub.rotateZ(-Math.PI / 2);
  hub.translate(faceX + 0.02, 0, 0);
  pieces.push(hub);
  const spokes = (count: number, width: number, twist = 0, depth = 0.08, x = faceX - 0.02, phase = 0) => {
    for (let i = 0; i < count; i++) {
      const s = new THREE.BoxGeometry(depth, 0.78, width);
      s.translate(0, 0.55, 0);
      s.rotateY(twist);
      s.rotateX(((i + phase) / count) * Math.PI * 2);
      s.translate(x, 0, 0);
      pieces.push(s);
    }
  };
  const disc = (r: number, x: number, t = 0.05) => {
    const c = new THREE.CylinderGeometry(r, r, t, 28);
    c.rotateZ(-Math.PI / 2);
    c.translate(x, 0, 0);
    pieces.push(c);
  };
  switch (style) {
    case 'five':
      spokes(5, 0.2);
      break;
    case 'multi':
      spokes(10, 0.075, 0.25);
      break;
    case 'aero':
      disc(0.93, faceX - 0.03);
      spokes(5, 0.16, 0, 0.04);
      break;
    case 'hubcap': {
      disc(0.9, faceX - 0.02);
      const cone = new THREE.ConeGeometry(0.3, 0.2, 16);
      cone.rotateZ(-Math.PI / 2);
      cone.translate(faceX + 0.1, 0, 0);
      pieces.push(cone);
      break;
    }
    case 'wire':
      spokes(24, 0.022, 0.5, 0.03);
      spokes(24, 0.022, -0.5, 0.03);
      break;
    case 'steel':
      disc(0.9, faceX - 0.04);
      spokes(6, 0.1, 0, 0.03);
      break;
    case 'mesh':
      // Cross-laced mesh (BBS-style): two sets of twisted spokes.
      spokes(10, 0.05, 0.42, 0.05);
      spokes(10, 0.05, -0.42, 0.05);
      break;
    case 'sixspoke':
      // Wide forged six-spoke (Rays-style).
      spokes(6, 0.2, 0, 0.1);
      break;
    case 'turbofan': {
      // Flat disc with turbine blades (Rotiform-style).
      disc(0.88, faceX - 0.05, 0.04);
      spokes(16, 0.07, 0.65, 0.05, faceX - 0.01);
      break;
    }
    case 'deepdish': {
      // Spokes set deep inside a wide polished barrel.
      const barrel = new THREE.CylinderGeometry(0.95, 0.95, 0.24, 24, 1, true);
      barrel.rotateZ(-Math.PI / 2);
      barrel.translate(faceX - 0.1, 0, 0);
      pieces.push(barrel);
      spokes(5, 0.2, 0, 0.08, faceX - 0.2);
      break;
    }
  }
  const face = mergeGeometries(pieces.map(finalize), false)!;
  const backDisc = new THREE.CylinderGeometry(0.95, 0.95, 0.04, 24);
  backDisc.rotateZ(-Math.PI / 2);
  backDisc.translate(0.05, 0, 0);
  const out = { face, back: backDisc };
  rimCache.set(style, out);
  return out;
}

// ------------------------------------------------------------------ the body

interface Section {
  cy: number;
  b: number;
  a: number;
  n: number;
}

export class CarBody {
  readonly d: CarDesign;
  readonly L: number;
  readonly hw: number;
  readonly height: number;
  readonly archR: number;
  readonly axles: { u: number; z: number; front: boolean }[];
  readonly trackX: number;
  readonly parts = new Map<Part, THREE.BufferGeometry>();
  /** The lower body shell alone (with UVs), used for the dirt overlay. */
  readonly lower: THREE.BufferGeometry;
  private pieces = new Map<Part, THREE.BufferGeometry[]>();
  /** Inward lean of the side glass: metres of width lost per metre of height. */
  private sideSlope = 0;
  /** Exhaust tip positions (for backfire flames). */
  readonly exhausts: [number, number, number][] = [];

  constructor(modelId: string) {
    const shape = getModel(modelId).shape;
    this.d = designFor(modelId);
    this.L = shape.length;
    this.hw = shape.width / 2;
    const d = this.d;
    this.archR = d.wheelR + d.archGap;
    this.axles = [
      { u: d.frontAxle, z: d.frontAxle * this.L, front: true },
      { u: d.rearAxle, z: d.rearAxle * this.L, front: false },
    ];
    this.trackX = Math.min(...this.axles.map((a) => this.planWidth(a.u))) - d.wheelW / 2 - 0.025;
    this.height = d.open?.kind === 'cockpit' ? d.beltY + 0.4 : d.roofY + d.roofArc + (d.roofRails ? 0.08 : 0);
    const um = (d.roofFront + d.roofBack) / 2;
    this.sideSlope = ((1 - d.tumble) * this.gwb(um)) / Math.max(0.1, this.roofTop(um) - this.gBottom(um));
    this.lower = this.buildLower();
    this.buildOpenTop();
    if (d.open?.kind !== 'cockpit') this.buildGreenhouse();
    this.buildRunningGear();
    this.buildFront();
    this.buildRear();
    this.buildSides();
    for (const [part, list] of this.pieces) this.parts.set(part, mergeGeometries(list, false)!);
    this.pieces.clear();
  }

  private add(piece: Piece, g: THREE.BufferGeometry | null): void {
    if (!g) return;
    const d = this.d;
    const part: Part =
      piece === 'dark' || piece === 'interior' || piece === 'plate'
        ? 'trim'
        : piece === 'head' || piece === 'tail'
          ? 'lamp'
          : (piece === 'roof' && d.roof === 'body') || (piece === 'pillar' && d.pillars === 'body')
            ? 'paint'
            : piece;
    const geo = finalize(g);
    const rgb = PIECE_COLORS[piece];
    if (rgb) {
      const n = geo.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set(rgb, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const list = this.pieces.get(part) ?? [];
    list.push(geo);
    this.pieces.set(part, list);
  }

  // ---------------------------------------------------------------- profile

  planWidth(u: number): number {
    const d = this.d;
    let f = 1;
    if (u > 0.5 - d.noseRound) f = 1 - (1 - d.noseWidth) * Math.pow((u - (0.5 - d.noseRound)) / d.noseRound, 2.2);
    else if (u < -0.5 + d.tailRound) f = 1 - (1 - d.tailWidth) * Math.pow((-0.5 + d.tailRound - u) / d.tailRound, 2.2);
    let w = this.hw * f - d.hips * 0.5;
    for (const a of this.axles) {
      const t = ((u - a.u) * this.L) / 0.6;
      w += d.hips * Math.exp(-t * t);
    }
    return w;
  }

  /** Top of the solid body (ignores open beds / cockpits). */
  topSolid(u: number): number {
    const d = this.d;
    let y: number;
    if (u >= d.cowl) {
      y = d.hoodY - (d.hoodY - d.noseY) * Math.pow((u - d.cowl) / (0.5 - d.cowl), d.hoodCurve);
    } else if (u >= d.cBase) {
      const span = 0.035;
      y = d.beltY;
      if (u > d.cowl - span) y = lerp(d.beltY, d.hoodY, smooth((u - (d.cowl - span)) / span));
      if (u < d.cBase + span) y = lerp(d.deckY, y, smooth((u - d.cBase) / span));
    } else {
      const t = (d.cBase - u) / (d.cBase + 0.5);
      y = d.deckY - (d.deckY - d.tailY) * t * t * t;
    }
    // The body must always clear the wheels: bulge over the arches when the hood is low (sports cars).
    for (const a of this.axles) {
      const dz = (u - a.u) * this.L;
      const R = this.archR + 0.07;
      if (Math.abs(dz) < R) y = Math.max(y, d.wheelR + Math.sqrt(R * R - dz * dz) + 0.02);
    }
    return y;
  }

  top(u: number): number {
    const o = this.d.open;
    return o && u > o.from && u < o.to ? o.floorY : this.topSolid(u);
  }

  /** Bottom edge of the body ignoring the wheel arches (sills and bumpers). */
  private baseBottom(u: number): number {
    const d = this.d;
    const end = 0.13;
    const a = Math.abs(u);
    return a > 0.5 - end ? lerp(d.sillY, d.bumperY, smooth((a - (0.5 - end)) / end)) : d.sillY;
  }

  /** Height of the wheel-arch opening at u (-Infinity away from the wheels). */
  private archY(u: number): number {
    let y = -Infinity;
    for (const ax of this.axles) {
      const dz = (u - ax.u) * this.L;
      if (Math.abs(dz) < this.archR) y = Math.max(y, this.d.wheelR + Math.sqrt(this.archR * this.archR - dz * dz));
    }
    return y;
  }

  /** Lowest point of the body side at u, including the arch cut-outs. */
  bottom(u: number): number {
    return Math.max(this.baseBottom(u), this.archY(u));
  }

  section(u: number, solid = true): Section {
    const b = this.baseBottom(u);
    const t = Math.max(b + 0.04, solid ? this.topSolid(u) : this.top(u));
    return { cy: (t + b) / 2, b: (t - b) / 2, a: this.planWidth(u), n: this.d.section };
  }

  /** Half width of the body surface at u and height y (0 if y is outside the section). */
  surfaceX(u: number, y: number, solid = true): number {
    if (y < this.archY(u)) return 0;
    return this.rawSurfaceX(u, y, solid);
  }

  /** Like surfaceX, but as if there were no wheel arch at u. */
  private rawSurfaceX(u: number, y: number, solid = true): number {
    const s = this.section(u, solid);
    const yn = (y - s.cy) / s.b;
    if (Math.abs(yn) >= 1) return 0;
    return s.a * taper(yn) * Math.pow(1 - Math.pow(Math.abs(yn), s.n), 1 / s.n);
  }

  /** Height of the top surface at u and lateral offset x. */
  surfaceY(u: number, x: number, solid = true): number {
    const s = this.section(u, solid);
    const xn = Math.min(0.999, Math.abs(x) / (s.a * 0.965));
    return s.cy + s.b * Math.pow(1 - Math.pow(xn, s.n), 1 / s.n);
  }

  private inside(u: number, x: number, y: number): boolean {
    return Math.abs(x) <= this.surfaceX(u, y);
  }

  /** z of the front (or rear) surface at (x, y), NaN if the point is outside the body. */
  surfaceZ(x: number, y: number, front: boolean): number {
    const s = front ? 1 : -1;
    const at = (t: number) => this.inside(s * t, x, y);
    if (at(0.5)) return s * 0.5 * this.L;
    let found = -1;
    for (let t = 0.49; t >= 0.04; t -= 0.01) {
      if (at(t)) {
        found = t;
        break;
      }
    }
    if (found < 0) return Number.NaN;
    let lo = found;
    let hi = Math.min(0.5, found + 0.01);
    for (let k = 0; k < 18; k++) {
      const m = (lo + hi) / 2;
      if (at(m)) lo = m;
      else hi = m;
    }
    return s * lo * this.L;
  }

  /** A point on the front/rear surface, pushed out along the local plan normal. */
  private facePoint(x: number, y0: number, front: boolean, off = 0.007): V3 | null {
    // Points just above the body edge (e.g. the top of a lamp near the hood line) slide down onto it.
    let y = y0;
    let z = this.surfaceZ(x, y, front);
    for (let k = 0; k < 8 && !Number.isFinite(z); k++) {
      y -= 0.015;
      z = this.surfaceZ(x, y, front);
    }
    if (!Number.isFinite(z)) return null;
    const za = this.surfaceZ(x + 0.02, y, front);
    const zb = this.surfaceZ(x - 0.02, y, front);
    let nx = 0;
    let nz = front ? 1 : -1;
    if (Number.isFinite(za) && Number.isFinite(zb)) {
      nx = -(za - zb) / 0.04;
      const l = Math.hypot(nx, 1);
      nx /= l;
      nz /= l;
      if (!front) nx = -nx;
    }
    return [x + nx * off, y, z + nz * off];
  }

  // ---------------------------------------------------------------- lower body

  private stations(u0: number, u1: number): number[] {
    const list: number[] = [];
    const n = Math.max(3, Math.round(46 * (u1 - u0)));
    for (let i = 0; i <= n; i++) list.push(lerp(u0, u1, i / n));
    const ru = (this.archR + 0.005) / this.L;
    for (const a of this.axles) {
      for (let k = 0; k <= 12; k++) list.push(a.u - ru + (2 * ru * k) / 12);
      list.push(a.u - ru - 0.004, a.u + ru + 0.004);
    }
    const inRange = list.filter((u) => u >= u0 && u <= u1).sort((a, b) => a - b);
    const out: number[] = [];
    for (const u of inRange) if (!out.length || u - out[out.length - 1]! > 0.0025) out.push(u);
    if (out[out.length - 1]! < u1) out.push(u1);
    return out;
  }

  private ring(u: number, solid: boolean, count = 24): V2[] {
    const s = this.section(u, solid);
    // Wheel arches are cut out of the section, which keeps the body side untouched above them.
    const cut = Math.min(this.archY(u), s.cy + s.b - 0.03);
    const pts: V2[] = [];
    for (let j = 0; j < count; j++) {
      const th = (j / count) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const xn = Math.sign(c) * Math.pow(Math.abs(c), 2 / s.n);
      const yn = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / s.n);
      pts.push([s.a * taper(yn) * xn, Math.max(cut, s.cy + s.b * yn)]);
    }
    return pts;
  }

  private buildLower(): THREE.BufferGeometry {
    const d = this.d;
    const cuts = [-0.5, 0.5];
    if (d.open) cuts.push(d.open.from, d.open.to);
    const bounds = [...new Set(cuts.map((c) => Math.min(0.5, Math.max(-0.5, c))))].sort((a, b) => a - b);
    const hRef = d.roofY - d.sillY;
    const uvOf = (x: number, y: number, z: number): V2 => [(z / this.L + 0.5) * 2 + x * 0.3, (y - d.sillY) / hRef];
    const segs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const u0 = bounds[i]!;
      const u1 = bounds[i + 1]!;
      if (u1 - u0 < 0.005) continue;
      const mid = (u0 + u1) / 2;
      const openSeg = !!d.open && mid > d.open.from && mid < d.open.to;
      const eps = 0.0005;
      const st = this.stations(u0 + (u0 > -0.5 ? eps : 0), u1 - (u1 < 0.5 ? eps : 0));
      segs.push(loft(st, (u) => this.ring(u, !openSeg), this.L, [true, true], uvOf));
    }
    const lower = segs.length === 1 ? segs[0]! : mergeGeometries(segs, false)!;
    this.add('paint', lower.clone());
    return lower;
  }

  // ---------------------------------------------------------------- beds and cockpits

  private buildOpenTop(): void {
    const d = this.d;
    const o = d.open;
    if (!o) return;
    const u0 = Math.max(-0.5, o.from);
    const u1 = o.to;
    const st = this.stations(u0 + 0.001, u1 - 0.001);
    const thick = 0.055;
    // Side walls follow the outer body surface from the floor up to the rail.
    const wall = (side: 1 | -1) => (u: number): V2[] => {
      const y0 = o.floorY - 0.02;
      const y1 = this.topSolid(u) - 0.012;
      const outer: V2[] = [];
      for (let k = 0; k <= 5; k++) {
        const y = lerp(y0, y1, k / 5);
        outer.push([this.surfaceX(u, y), y]);
      }
      const xin = outer[5]![0] - thick;
      const r: V2[] = [[xin, y0], ...outer, [xin, y1]];
      return side === 1 ? r : r.map(([x, y]) => [-x, y] as V2).reverse();
    };
    this.add('paint', loft(st, wall(1), this.L, [true, true]));
    this.add('paint', loft(st, wall(-1), this.L, [true, true]));
    const inner = this.surfaceX((u0 + u1) / 2, o.floorY + 0.1) - thick;
    const len = (u1 - u0) * this.L;
    this.add(o.kind === 'bed' ? 'dark' : 'interior', boxAt(inner * 2, 0.03, len, 0, o.floorY + 0.005, ((u0 + u1) / 2) * this.L));
    if (o.kind === 'bed') {
      // Tailgate
      const tz = -this.L / 2 + 0.03;
      const tw = this.surfaceX(-0.49, o.floorY + 0.15) * 2;
      this.add('paint', boxAt(tw, this.topSolid(-0.49) - o.floorY - 0.01, 0.06, 0, (this.topSolid(-0.49) + o.floorY) / 2, tz));
      return;
    }
    // Roadster cockpit: seats, steering wheel, windscreen, head fairings.
    const seatZ = lerp(u0, u1, 0.42) * this.L;
    for (const s of [-1, 1]) {
      const x = s * inner * 0.48;
      this.add('interior', boxAt(0.46, 0.14, 0.5, x, o.floorY + 0.08, seatZ));
      this.add('interior', boxAt(0.46, 0.55, 0.12, x, o.floorY + 0.36, seatZ - 0.26, -0.22));
      const fair = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      fair.scale(0.17, 0.2, 0.42);
      fair.translate(x, this.topSolid(u0 - 0.02) - 0.01, u0 * this.L - 0.34);
      this.add('paint', fair);
    }
    const wheel = new THREE.TorusGeometry(0.17, 0.02, 6, 20);
    wheel.rotateX(-0.45);
    wheel.translate(inner * 0.48, d.beltY - 0.02, u1 * this.L - 0.2);
    this.add('dark', wheel);
    const ws = boxAt(this.surfaceX(d.cowl, d.beltY - 0.05) * 1.7, 0.3, 0.012, 0, d.beltY + 0.13, d.cowl * this.L - 0.07, -0.55);
    this.add('glass', ws);
    const wy = d.beltY + 0.13 + 0.15 * Math.cos(0.55);
    const wz = d.cowl * this.L - 0.07 - 0.15 * Math.sin(0.55);
    const wx = this.surfaceX(d.cowl, d.beltY - 0.05) * 0.85;
    this.add('chrome', tube([[-wx, wy, wz], [0, wy + 0.01, wz], [wx, wy, wz]], 0.012));
  }

  // ---------------------------------------------------------------- greenhouse

  roofTop(u: number): number {
    const d = this.d;
    const m = (d.roofFront + d.roofBack) / 2;
    const h = Math.max(0.001, (d.roofFront - d.roofBack) / 2);
    const t = Math.max(-1, Math.min(1, (u - m) / h));
    return d.roofY + d.roofArc * (1 - t * t);
  }

  private gBottom(u: number): number {
    const s = this.section(u);
    return this.topSolid(u) - Math.min(0.045, s.b * 0.14);
  }

  private gTop(u: number): number {
    const d = this.d;
    const yb = this.gBottom(u);
    let y: number;
    if (u > d.roofFront) {
      const t = clamp01((d.cowl - u) / (d.cowl - d.roofFront));
      y = yb + (this.roofTop(d.roofFront) - yb) * Math.pow(t, 0.92);
    } else if (u < d.roofBack) {
      const t = clamp01((u - d.cBase) / Math.max(0.001, d.roofBack - d.cBase));
      y = yb + (this.roofTop(d.roofBack) - yb) * (d.rear === 'fast' ? Math.sin((t * Math.PI) / 2) : t);
    } else y = this.roofTop(u);
    return Math.max(yb + 0.004, y);
  }

  private gwb(u: number): number {
    return this.surfaceX(u, this.gBottom(u)) * 0.995;
  }

  private gwt(u: number): number {
    const wb = this.gwb(u);
    return Math.max(wb * 0.3, wb - (this.gTop(u) - this.gBottom(u)) * this.sideSlope);
  }

  private gRadius(u: number): number {
    return Math.min(0.09, (this.gTop(u) - this.gBottom(u)) * 0.35, this.gwt(u) * 0.35);
  }

  /** x of the glass side surface at u and height y. */
  private glassX(u: number, y: number): number {
    const yb = this.gBottom(u);
    const yt = this.gTop(u) - this.gRadius(u);
    const t = clamp01((y - yb) / Math.max(0.001, yt - yb));
    return lerp(this.gwb(u), this.gwt(u), t);
  }

  private glassRing = (u: number): V2[] => {
    const yb = this.gBottom(u);
    const yt = this.gTop(u);
    const wb = this.gwb(u);
    const wt = this.gwt(u);
    const r = this.gRadius(u);
    const pts: V2[] = [
      [wb, yb],
      [lerp(wb, wt, 0.5), lerp(yb, yt - r, 0.5)],
    ];
    for (let k = 0; k <= 3; k++) {
      const a = (k / 3) * (Math.PI / 2);
      pts.push([wt - r + r * Math.cos(a), yt - r + r * Math.sin(a)]);
    }
    for (const f of [0.5, 0, -0.5]) pts.push([(wt - r) * f, yt + (1 - f * f) * 0.004]);
    for (let k = 0; k <= 3; k++) {
      const a = Math.PI / 2 + (k / 3) * (Math.PI / 2);
      pts.push([-(wt - r) + r * Math.cos(a), yt - r + r * Math.sin(a)]);
    }
    pts.push([-lerp(wb, wt, 0.5), lerp(yb, yt - r, 0.5)], [-wb, yb]);
    return pts;
  };

  private buildGreenhouse(): void {
    const d = this.d;
    const L = this.L;
    const span = (u0: number, u1: number, n: number) => Array.from({ length: n + 1 }, (_, i) => lerp(u0, u1, i / n));
    const cargo = d.cargoFrom;
    if (cargo !== undefined) {
      this.add('glass', loft(span(cargo, d.cowl, 18), this.glassRing, L, [false, false]));
      this.add('paint', loft(span(d.cBase, cargo, 18), this.glassRing, L, [true, false]));
    } else {
      this.add('glass', loft(span(d.cBase, d.cowl, 36), this.glassRing, L, [false, false]));
    }

    // Painted roof skin over the glass
    const r0 = d.roofBack + 0.006;
    const r1 = d.roofFront - 0.008;
    this.add(
      'roof',
      loft(
        span(r0, r1, 14),
        (u) => {
          const y = this.roofTop(u) - 0.002;
          const a = this.gwt(u) + 0.01;
          const pts: V2[] = [];
          for (let j = 0; j < 20; j++) {
            const th = (j / 20) * Math.PI * 2;
            const c = Math.cos(th);
            const s = Math.sin(th);
            pts.push([a * Math.sign(c) * Math.pow(Math.abs(c), 0.5), y + 0.013 * Math.sign(s) * Math.pow(Math.abs(s), 0.5)]);
          }
          return pts;
        },
        L,
        [true, true],
      ),
    );

    // A pillars follow the windscreen edge.
    for (const s of [-1, 1]) {
      const pts: V3[] = [];
      for (let k = 0; k <= 8; k++) {
        const u = lerp(d.cowl - 0.003, d.roofFront, k / 8);
        const r = this.gRadius(u);
        pts.push([s * (this.gwt(u) - r * 0.25 + 0.006), this.gTop(u) - r * 0.25, u * L]);
      }
      this.add('pillar', tube(pts, 0.034 + this.hw * 0.006, 6));
    }

    // Pillar strips on the side glass
    const bw = 0.05 / L;
    const doors = this.doorLines();
    const strips: [number, number][] = [];
    if (cargo !== undefined) strips.push([cargo - bw, cargo + bw]);
    else {
      if (doors.b !== null) strips.push([doors.b - bw, doors.b + bw]);
      if (d.rear === 'fast') strips.push([d.cBase, d.cBase + (d.roofBack - d.cBase) * 0.55]);
      else if (d.cBase > -0.42) strips.push([d.cBase, d.roofBack + 0.03]);
      else {
        strips.push([d.cBase, d.cBase + 0.05]);
        if (d.doors === 4) strips.push([doors.rear - bw, doors.rear + bw]);
      }
    }
    for (const [a, b] of strips) {
      const u0 = Math.max(d.cBase, a);
      const u1 = Math.min(d.cowl, b);
      if (u1 - u0 < 0.002) continue;
      for (const s of [-1, 1]) {
        this.add(
          'pillar',
          grid(4, 4, (i, j) => {
            const u = lerp(u0, u1, i / 4);
            const y = lerp(this.gBottom(u) + 0.004, this.gTop(u) - this.gRadius(u) * 0.3, j / 4);
            return [s * (this.glassX(u, y) + 0.007), y, u * L];
          }, s === 1),
        );
      }
    }

    // Window line trim
    const trim: Piece = d.chromeTrim ? 'chrome' : 'dark';
    for (const s of [-1, 1]) {
      const pts: V3[] = [];
      for (let k = 0; k <= 14; k++) {
        const u = lerp(d.cBase + 0.01, d.cowl - 0.012, k / 14);
        pts.push([s * (this.gwb(u) + 0.006), this.gBottom(u) + 0.012, u * L]);
      }
      this.add(trim, tube(pts, 0.011, 5));
    }

    // Seat silhouettes behind the side glass, kept under the roof so they never poke through.
    const i0 = Math.max(cargo ?? -1, d.cBase, d.roofBack - 0.02) + 0.01;
    const i1 = Math.min(d.cowl, d.roofFront + 0.03) - 0.01;
    if (i1 > i0) {
      // A dark cabin floor at window-line height: you do not see the road through the car.
      const w = this.gwb((i0 + i1) / 2) * 1.5;
      this.add('interior', boxAt(w, 0.12, (i1 - i0) * L, 0, d.beltY - 0.02, ((i0 + i1) / 2) * L));
    }

    if (d.roofRails) {
      for (const s of [-1, 1]) {
        const pts: V3[] = [];
        for (let k = 0; k <= 6; k++) {
          const u = lerp(d.roofBack + 0.03, d.roofFront - 0.03, k / 6);
          pts.push([s * this.gwt(u) * 0.78, this.roofTop(u) + 0.07, u * L]);
        }
        this.add('dark', tube(pts, 0.022, 6));
        for (const u of [d.roofBack + 0.035, d.roofFront - 0.035]) this.add('dark', boxAt(0.05, 0.07, 0.08, s * this.gwt(u) * 0.78, this.roofTop(u) + 0.035, u * L));
      }
    }
  }

  // ---------------------------------------------------------------- wheels, arches and chassis

  private buildRunningGear(): void {
    const d = this.d;
    const R = this.archR;
    const archTop = d.wheelR + R;
    for (const a of this.axles) {
      // Keep the liner inside the body side, which tucks in towards the bottom.
      const xo = Math.min(this.rawSurfaceX(a.u, d.wheelR), this.rawSurfaceX(a.u, d.wheelR + R * 0.8)) - 0.02;
      const depth = d.wheelW + 0.18;
      for (const s of [-1, 1]) {
        const well = new THREE.CylinderGeometry(R, R, depth, 18, 1, true, 0, Math.PI);
        well.rotateZ(Math.PI / 2);
        well.translate(s * (xo - depth / 2), d.wheelR, a.z);
        this.add('dark', well);
      }
    }
    // Fills the gap between the arches so you cannot see through the car under the body.
    const inner = this.trackX - d.wheelW / 2 - 0.08;
    const z0 = this.axles[1]!.z - R;
    const z1 = this.axles[0]!.z + R;
    const topY = d.open?.kind === 'cockpit' ? Math.min(archTop, d.open.floorY - 0.03) : archTop;
    this.add('dark', boxAt(inner * 2, topY - d.sillY + 0.03, z1 - z0, 0, (topY + d.sillY) / 2 - 0.02, (z0 + z1) / 2));
  }

  // ---------------------------------------------------------------- front and rear

  /** A flat patch on the front/rear face covering the quad (x0,y0)-(x1,y1), optionally swept. */
  private facePatch(part: Piece, front: boolean, x0: number, x1: number, y0: number, y1: number, sweep = 0, nx = 6, ny = 2, off = 0.007): void {
    const pts: V3[][] = [];
    for (let i = 0; i <= nx; i++) {
      const t = i / nx;
      const x = lerp(x0, x1, t);
      const lift = sweep >= 0 ? sweep * t : -sweep * (1 - t);
      const ya = y0 + lift;
      const base = this.facePoint(x, ya, front, off);
      if (!base) return;
      // Wrapping around a rounded corner is fine, running up onto the hood or the boot lid is not:
      // where the face turns flat, the column stops at the edge (the lamp follows the hood line).
      const fits = (y: number): boolean => {
        const p = this.facePoint(x, y, front, off);
        return !!p && Math.abs(p[2] - base[2]) <= 1.5 * (p[1] - base[1]) + 0.03;
      };
      let yb = y1 + lift;
      if (!fits(yb)) {
        let lo = ya;
        let hi = yb;
        for (let k = 0; k < 8; k++) {
          const m = (lo + hi) / 2;
          if (fits(m)) lo = m;
          else hi = m;
        }
        yb = lo;
      }
      const col: V3[] = [base];
      for (let j = 1; j <= ny; j++) {
        const p = this.facePoint(x, lerp(ya, yb, j / ny), front, off);
        if (!p) return;
        col.push(p);
      }
      pts.push(col);
    }
    this.add(part, grid(nx, ny, (i, j) => pts[i]![j]!, !front));
  }

  private faceDisc(part: Piece, front: boolean, cx: number, cy: number, rx: number, ry: number, inner = 0, off = 0.007): void {
    const seg = 16;
    this.add(
      part,
      grid(seg, 2, (i, j) => {
        const a = (i / seg) * Math.PI * 2 * (front ? 1 : -1);
        const k = lerp(inner, 1, j / 2);
        return this.facePoint(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, front, off);
      }, true),
    );
  }

  private lamp(l: Lamp, part: Piece, front: boolean): void {
    const d = this.d;
    const hw = this.hw;
    const ring = d.bumpers === 'chrome' || d.chromeTrim;
    for (const s of [-1, 1]) {
      const cx = s * l.x * hw;
      switch (l.style) {
        case 'round':
        case 'oval':
          if (ring) this.faceDisc('chrome', front, cx, l.y, (l.w / 2) * 1.2, (l.h / 2) * 1.2, 0.8, 0.005);
          this.faceDisc(part, front, cx, l.y, l.w / 2, l.h / 2);
          break;
        case 'twin':
          for (const k of [-1, 1]) {
            const x = cx + k * l.w * 0.58;
            if (ring) this.faceDisc('chrome', front, x, l.y, l.w * 0.6, l.h * 0.6, 0.8, 0.005);
            this.faceDisc(part, front, x, l.y, l.w / 2, l.h / 2);
          }
          break;
        case 'slim':
          // Swept upwards towards the fender, in a dark housing so it reads on any paint colour.
          this.facePatch('dark', front, cx - l.w / 2 - 0.02, cx + l.w / 2 + 0.02, l.y - l.h / 2 - 0.02, l.y + l.h / 2 + 0.02, s * l.h * 0.6, 8, 1, 0.005);
          this.facePatch(part, front, cx - l.w / 2, cx + l.w / 2, l.y - l.h / 2, l.y + l.h / 2, s * l.h * 0.6, 8, 1);
          break;
        case 'square':
        case 'vertical':
          this.facePatch('dark', front, cx - l.w / 2 - 0.015, cx + l.w / 2 + 0.015, l.y - l.h / 2 - 0.015, l.y + l.h / 2 + 0.015, 0, 4, 2, 0.005);
          this.facePatch(part, front, cx - l.w / 2, cx + l.w / 2, l.y - l.h / 2, l.y + l.h / 2, 0, 4, 2);
          break;
        case 'bar':
          if (s === 1) {
            this.facePatch('dark', front, -l.w * hw - 0.02, l.w * hw + 0.02, l.y - l.h / 2 - 0.025, l.y + l.h / 2 + 0.025, 0, 16, 1, 0.005);
            this.facePatch(part, front, -l.w * hw, l.w * hw, l.y - l.h / 2, l.y + l.h / 2, 0, 16, 1);
          }
          break;
      }
    }
  }

  private buildFront(): void {
    const d = this.d;
    const hw = this.hw;
    this.lamp(d.head, 'head', true);
    if (d.head2) this.lamp(d.head2, 'head', true);
    const g = d.grille;
    const gw = g.w * hw;
    switch (g.style) {
      case 'wide':
        this.facePatch('dark', true, -gw, gw, g.y - g.h / 2, g.y + g.h / 2, 0, 8, 2);
        if (d.bumpers === 'chrome' || d.chromeTrim) this.facePatch('chrome', true, -gw, gw, g.y - 0.012, g.y + 0.012, 0, 8, 1, 0.01);
        break;
      case 'tall':
      case 'chrome': {
        const frame = g.style === 'chrome' ? 0.03 : 0.022;
        this.facePatch('chrome', true, -gw - frame, gw + frame, g.y - g.h / 2 - frame, g.y + g.h / 2 + frame, 0, 8, 2, 0.005);
        this.facePatch('dark', true, -gw, gw, g.y - g.h / 2, g.y + g.h / 2, 0, 8, 2, 0.008);
        const bars = g.style === 'chrome' ? 4 : 3;
        for (let k = 1; k <= bars; k++) {
          const y = g.y - g.h / 2 + (g.h * k) / (bars + 1);
          this.facePatch('chrome', true, -gw, gw, y - 0.008, y + 0.008, 0, 8, 1, 0.011);
        }
        break;
      }
      case 'mesh':
        this.facePatch('dark', true, -gw, gw, g.y - g.h / 2, g.y + g.h / 2, 0, 10, 2);
        break;
      case 'oval':
        this.faceDisc('dark', true, 0, g.y, gw, g.h / 2);
        if (d.bumpers === 'chrome' || d.chromeTrim) this.faceDisc('chrome', true, 0, g.y, gw * 1.12, (g.h / 2) * 1.25, 0.86, 0.005);
        break;
      case 'none':
        this.facePatch('dark', true, -gw, gw, g.y - g.h / 2, g.y + g.h / 2, 0, 8, 1);
        break;
      case 'kidney': {
        // Two tall grilles side by side, chrome framed, with vertical slats.
        const kw = gw * 0.4;
        for (const s of [-1, 1]) {
          const cx = s * gw * 0.56;
          this.facePatch('chrome', true, cx - kw - 0.02, cx + kw + 0.02, g.y - g.h / 2 - 0.02, g.y + g.h / 2 + 0.02, 0, 4, 2, 0.005);
          this.facePatch('dark', true, cx - kw, cx + kw, g.y - g.h / 2, g.y + g.h / 2, 0, 4, 2, 0.008);
          for (let k = -2; k <= 2; k++) this.facePatch('chrome', true, cx + (k * kw) / 3 - 0.007, cx + (k * kw) / 3 + 0.007, g.y - g.h / 2, g.y + g.h / 2, 0, 1, 2, 0.011);
        }
        break;
      }
      case 'panamericana': {
        // Chrome frame with many vertical chrome slats.
        this.facePatch('chrome', true, -gw - 0.025, gw + 0.025, g.y - g.h / 2 - 0.025, g.y + g.h / 2 + 0.025, 0, 8, 2, 0.005);
        this.facePatch('dark', true, -gw, gw, g.y - g.h / 2, g.y + g.h / 2, 0, 8, 2, 0.008);
        const n = 11;
        for (let k = 0; k < n; k++) {
          const x = -gw + ((k + 0.5) * 2 * gw) / n;
          this.facePatch('chrome', true, x - 0.009, x + 0.009, g.y - g.h / 2, g.y + g.h / 2, 0, 1, 2, 0.011);
        }
        break;
      }
      case 'singleframe':
        // Large six-sided grille: a wide lower part and a slightly narrower upper part.
        this.facePatch('dark', true, -gw, gw, g.y - g.h / 2, g.y + g.h * 0.1, 0, 10, 2, 0.008);
        this.facePatch('dark', true, -gw * 0.84, gw * 0.84, g.y + g.h * 0.1, g.y + g.h / 2, 0, 10, 1, 0.008);
        this.facePatch('chrome', true, -gw * 0.84, gw * 0.84, g.y + g.h / 2 - 0.004, g.y + g.h / 2 + 0.014, 0, 10, 1, 0.011);
        for (const s of [-1, 1]) this.facePatch('chrome', true, s * gw - 0.009, s * gw + 0.009, g.y - g.h / 2, g.y + g.h * 0.1, 0, 1, 2, 0.011);
        break;
      case 'star': {
        // Wide gloss-black panel dotted with small chrome studs.
        this.facePatch('chrome', true, -gw - 0.018, gw + 0.018, g.y - g.h / 2 - 0.018, g.y + g.h / 2 + 0.018, 0, 10, 2, 0.005);
        this.facePatch('dark', true, -gw, gw, g.y - g.h / 2, g.y + g.h / 2, 0, 10, 2, 0.008);
        for (let i = 0; i < 7; i++) {
          for (let j = 0; j < 2; j++) {
            const x = -gw + ((i + 0.5) * 2 * gw) / 7;
            const y = g.y - g.h / 2 + ((j + 0.5) * g.h) / 2;
            this.faceDisc('chrome', true, x, y, 0.014, 0.014, 0, 0.012);
          }
        }
        break;
      }
    }
    if (d.intake) this.facePatch('dark', true, -d.intake.w * hw, d.intake.w * hw, d.intake.y - d.intake.h / 2, d.intake.y + d.intake.h / 2, 0, 10, 1);
    this.bumper(true);
    const py = d.bumperY + (d.noseY - d.bumperY) * 0.28;
    this.facePatch('plate', true, -0.26, 0.26, py - 0.055, py + 0.055, 0, 4, 1, 0.012);
  }

  private bumper(front: boolean): void {
    const d = this.d;
    const x = this.hw * 0.995;
    const y0 = d.bumperY + 0.012;
    if (d.bumpers === 'black') this.facePatch('dark', front, -x, x, y0, y0 + 0.2, 0, 20, 2, 0.006);
    else if (d.bumpers === 'chrome') this.facePatch('chrome', front, -x, x, y0 + 0.04, y0 + 0.14, 0, 20, 2, 0.009);
    else this.facePatch('dark', front, -x * 0.85, x * 0.85, y0, y0 + 0.045, 0, 14, 1, 0.006);
  }

  private buildRear(): void {
    const d = this.d;
    const hw = this.hw;
    this.lamp(d.tail, 'tail', false);
    this.bumper(false);
    const top = d.open?.kind === 'bed' ? d.deckY : d.tailY;
    const py = d.bumperY + (top - d.bumperY) * 0.42;
    this.facePatch('plate', false, -0.26, 0.26, py - 0.055, py + 0.055, 0, 4, 1, 0.012);

    const ey = d.bumperY + 0.07;
    const pipes: number[] = [];
    if (d.exhaust === 'single') pipes.push(0.55 * hw);
    else if (d.exhaust === 'dual') pipes.push(-0.55 * hw, 0.55 * hw);
    else if (d.exhaust === 'quad') pipes.push(-0.55 * hw, -0.4 * hw, 0.4 * hw, 0.55 * hw);
    else if (d.exhaust === 'center') pipes.push(-0.07, 0.07);
    for (const x of pipes) {
      const z = this.surfaceZ(x, ey + 0.03, false);
      if (!Number.isFinite(z)) continue;
      this.exhausts.push([x, ey, z - 0.09]);
      const p = new THREE.CylinderGeometry(0.042, 0.042, 0.14, 12, 1, true);
      p.rotateX(Math.PI / 2);
      p.translate(x, ey, z - 0.02);
      this.add('chrome', p);
    }

    if (d.spare) {
      const y = (d.bumperY + d.tailY) / 2 + 0.1;
      const r = d.wheelR * 0.95;
      const z = this.surfaceZ(0, y, false) - d.wheelW / 2 - 0.01;
      if (Number.isFinite(z)) {
        const t = tireGeometry(0.62).clone();
        t.scale(d.wheelW, r, r);
        t.rotateY(Math.PI / 2);
        t.translate(0, y, z);
        this.add('tire', t);
        const cover = new THREE.CylinderGeometry(r * 0.64, r * 0.64, d.wheelW * 0.9, 20);
        cover.rotateX(Math.PI / 2);
        cover.translate(0, y, z);
        this.add('paint', cover);
      }
    }

    if (d.fins) {
      const f0 = -0.5 + 0.004;
      const f1 = -0.1;
      for (const s of [-1, 1]) {
        const st = Array.from({ length: 13 }, (_, i) => lerp(f0, f1, i / 12));
        this.add(
          'paint',
          loft(
            st,
            (u) => {
              const t = smooth((f1 - u) / (f1 - f0));
              const yb = this.topSolid(u) - 0.06;
              const yt = this.topSolid(u) + 0.17 * t + 0.004;
              const xc = s * this.surfaceX(u, this.topSolid(u) - 0.07) * 0.97;
              const pts: V2[] = [];
              for (let j = 0; j < 10; j++) {
                const a = (j / 10) * Math.PI * 2;
                pts.push([xc + Math.cos(a) * 0.035, (yb + yt) / 2 + (Math.sin(a) * (yt - yb)) / 2]);
              }
              return pts;
            },
            this.L,
            [true, true],
          ),
        );
      }
    }
  }

  // ---------------------------------------------------------------- sides

  /** u positions of the door shut lines. */
  doorLines(): { front: number; b: number | null; rear: number } {
    const d = this.d;
    const archFront = d.frontAxle - (this.archR + 0.07) / this.L;
    const archRear = d.rearAxle + (this.archR + 0.05) / this.L;
    const front = Math.min(d.cowl, archFront);
    if (d.doors === 'van') return { front, b: d.cargoFrom ?? null, rear: (d.cargoFrom ?? 0) - 1.15 / this.L };
    if (d.doors === 4) return { front, b: lerp(front, archRear, 0.5) + 0.01, rear: archRear };
    const rear = lerp(front, archRear, 0.88);
    return { front, b: rear > d.cBase && rear < d.cowl ? rear : null, rear };
  }

  private sidePatch(part: Piece, s: 1 | -1, u0: number, u1: number, yLow: (u: number) => number, yHigh: (u: number) => number, nu = 6, nv = 2, off = 0.006, glass = false): void {
    this.add(
      part,
      grid(nu, nv, (i, j) => {
        const u = lerp(u0, u1, i / nu);
        const y = lerp(yLow(u), yHigh(u), j / nv);
        const x = glass ? this.glassX(u, y) : this.surfaceX(u, y);
        return [s * (x + off), y, u * this.L];
      }, s === 1),
    );
  }

  private buildSides(): void {
    const d = this.d;
    const L = this.L;
    const doors = this.doorLines();
    const lineW = 0.004 / L;
    const lines = [doors.front, doors.rear];
    if (doors.b !== null && d.doors !== 2) lines.push(doors.b);
    const handles: number[] = [];
    // Handles sit near the rear edge of each hinged door, and the front edge of a sliding door.
    if (d.doors === 4) handles.push(doors.b! + 0.1 / L, doors.rear + 0.1 / L);
    else if (d.doors === 2) handles.push(doors.rear + 0.12 / L);
    else if (doors.b !== null) handles.push(doors.b + 0.1 / L, doors.b - 0.12 / L);

    for (const s of [-1, 1] as const) {
      for (const u of lines) {
        const van = d.doors === 'van' && u !== doors.front;
        this.sidePatch('dark', s, u - lineW, u + lineW, (v) => this.bottom(v) + 0.05, (v) => this.topSolid(v) - 0.03, 1, 6, 0.004);
        if (van && d.cargoFrom !== undefined && u <= d.cargoFrom) {
          this.sidePatch('dark', s, u - lineW, u + lineW, (v) => this.gBottom(v) + 0.02, (v) => this.gTop(v) - 0.15, 1, 3, 0.004, true);
        }
      }
      for (const u of handles) {
        this.sidePatch(d.chromeTrim ? 'chrome' : 'dark', s, u - 0.07 / L, u + 0.07 / L, () => d.beltY - 0.13, () => d.beltY - 0.1, 2, 1, 0.009);
      }
      // Mirrors
      if (d.open?.kind !== 'cockpit') {
        const u = d.cowl - 0.02;
        const x = s * (this.gwb(u) + 0.1);
        const y = this.gBottom(u) + 0.1;
        const m = new THREE.SphereGeometry(1, 10, 8);
        m.scale(0.1, 0.06, 0.045);
        m.translate(x, y, u * L - 0.04);
        this.add('paint', m);
        this.add('dark', boxAt(0.1, 0.025, 0.05, x - s * 0.07, y - 0.03, u * L));
      }
      if (d.cladding) {
        const ra = (this.archR + 0.005) / L;
        this.sidePatch('dark', s, d.rearAxle + ra, d.frontAxle - ra, (u) => this.bottom(u) + 0.004, (u) => this.bottom(u) + 0.11, 10, 1, 0.006);
        for (const a of this.axles) {
          this.add(
            'dark',
            grid(16, 1, (i, j) => {
              const phi = (i / 16) * Math.PI;
              const rho = this.archR + (j ? 0.075 : 0.004);
              const z = a.z + Math.cos(phi) * rho;
              const y = d.wheelR + Math.sin(phi) * rho;
              // Arch mouldings hug the body side and stand slightly proud of it.
              const x = this.rawSurfaceX(z / L, y);
              return [s * (x + 0.014), y, z];
            }, s === -1),
          );
        }
      }
      if (d.fins || (d.chromeTrim && d.bumpers === 'chrome')) {
        const y = d.sillY + (d.beltY - d.sillY) * 0.55;
        const pts: V3[] = [];
        const u0 = d.rearAxle + (this.archR + 0.08) / L;
        const u1 = d.frontAxle - (this.archR + 0.1) / L;
        for (let k = 0; k <= 10; k++) {
          const u = lerp(u0, u1, k / 10);
          pts.push([s * (this.surfaceX(u, y) + 0.008), y, u * L]);
        }
        this.add('chrome', tube(pts, 0.012, 5));
      }
      if (d.sideIntake) {
        const u0 = d.rearAxle + (this.archR + 0.06) / L;
        const u1 = u0 + 0.55 / L;
        this.sidePatch('dark', s, u0, u1, (u) => lerp(d.sillY + 0.12, d.sillY + 0.2, (u - u0) / (u1 - u0)), () => d.beltY - 0.1, 6, 3, 0.006);
      }
    }
  }
}

const bodyCache = new Map<string, CarBody>();

export function carBody(modelId: string): CarBody {
  let b = bodyCache.get(modelId);
  if (!b) {
    b = new CarBody(modelId);
    bodyCache.set(modelId, b);
  }
  return b;
}

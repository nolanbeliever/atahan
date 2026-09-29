// Heavy highway traffic: a European cab-over semi (tractor + 13.6 m box trailer), a rigid box truck
// and an intercity coach. Built from simple solids for instanced drawing: `paint` takes the main
// colour, `paint2` the trailer / cargo box colour, `fixed` has its colours baked in.
// Local frame: +z forward, +y up, the body centred on (0, 0).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface LampSpots {
  head: [number, number, number][];
  tail: [number, number, number][];
  /** Indicators at the corners (facing +z, x > 0 is the vehicle's left side). */
  ind: [number, number, number][];
}

export interface HeavyPart {
  paint: THREE.BufferGeometry;
  paint2: THREE.BufferGeometry | null;
  fixed: THREE.BufferGeometry;
  lamps: LampSpots;
  length: number;
}

class Builder {
  paint: THREE.BufferGeometry[] = [];
  paint2: THREE.BufferGeometry[] = [];
  fixed: THREE.BufferGeometry[] = [];

  private prep(g: THREE.BufferGeometry, color: THREE.Color | null): THREE.BufferGeometry {
    const x = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal') x.deleteAttribute(name);
    const n = x.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const c = color ?? new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    x.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return x;
  }

  box(target: 'paint' | 'paint2' | string, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    this.add(target, g);
  }

  add(target: 'paint' | 'paint2' | string, g: THREE.BufferGeometry): void {
    if (target === 'paint') this.paint.push(this.prep(g, null));
    else if (target === 'paint2') this.paint2.push(this.prep(g, null));
    else this.fixed.push(this.prep(g, new THREE.Color(target)));
  }

  /** A wheel (tyre + hub) on the axle at z; dual rear wheels are a bit wider. */
  wheel(x: number, z: number, r: number, dual = false): void {
    const w = dual ? 0.5 : 0.3;
    const tire = new THREE.CylinderGeometry(r, r, w, 14);
    tire.rotateZ(Math.PI / 2);
    tire.translate(x, r, z);
    this.add('#16171a', tire);
    const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10);
    hub.rotateZ(Math.PI / 2);
    hub.translate(x, r, z);
    this.add('#b9bec5', hub);
  }

  done(lamps: LampSpots, length: number): HeavyPart {
    const m = (l: THREE.BufferGeometry[]) => (l.length ? mergeGeometries(l, false)! : null);
    return { paint: m(this.paint) ?? new THREE.BufferGeometry(), paint2: m(this.paint2), fixed: m(this.fixed)!, lamps, length };
  }
}

const GLASS = '#1a2230';
const DARK = '#23262b';
const CHROME = '#c9ced4';
const LAMP = '#fff3cf';
const RED = '#b0141c';
const AMBER = '#e89a1a';

/** Cab-over tractor unit (6.0 m). */
function tractor(): HeavyPart {
  const b = new Builder();
  const L = 6.0;
  const front = L / 2;
  // Chassis and fifth wheel.
  b.box(DARK, 1.0, 0.35, L - 0.3, 0, 0.78, 0);
  b.box('#30343a', 1.6, 0.12, 1.4, 0, 1.12, -1.6);
  // Cab with a roof fairing.
  const cabD = 2.3;
  const cz = front - cabD / 2;
  b.box('paint', 2.46, 2.55, cabD, 0, 1.05 + 2.55 / 2, cz);
  b.box('paint', 2.3, 0.75, cabD - 0.3, 0, 3.6 + 0.37, cz - 0.1);
  b.box('paint', 2.2, 0.55, 0.6, 0, 3.5, front - 0.2, -0.5);
  // Windscreen, side windows, grille, bumper, steps.
  b.box(GLASS, 2.2, 1.0, 0.05, 0, 2.95, front + 0.01);
  for (const s of [-1, 1]) b.box(GLASS, 0.05, 0.8, 1.0, s * 1.235, 2.95, front - 0.65);
  b.box(DARK, 1.7, 0.95, 0.06, 0, 1.75, front + 0.01);
  for (let i = 0; i < 4; i++) b.box(CHROME, 1.5, 0.05, 0.07, 0, 1.4 + i * 0.22, front + 0.03);
  b.box('#3a3f46', 2.46, 0.45, 0.25, 0, 0.95, front - 0.02);
  for (const s of [-1, 1]) {
    b.box(LAMP, 0.42, 0.18, 0.05, s * 0.9, 1.0, front + 0.12);
    b.box(DARK, 0.5, 0.12, 0.45, s * 1.05, 0.6, front - 0.6);
    // Mirrors.
    b.box(DARK, 0.08, 0.5, 0.18, s * 1.42, 2.8, front - 0.2);
    // Fuel tank and side skirt.
    const tank = new THREE.CylinderGeometry(0.32, 0.32, 1.3, 12);
    tank.rotateX(Math.PI / 2);
    tank.translate(s * 0.95, 0.72, -0.1);
    b.add(CHROME, tank);
  }
  // Wheels: steer axle and a drive axle with dual tyres.
  const r = 0.52;
  for (const s of [-1, 1]) {
    b.wheel(s * 1.03, front - 1.0, r);
    b.wheel(s * 0.98, -1.75, r, true);
  }
  return b.done(
    {
      head: [
        [-0.9, 1.0, front + 0.15],
        [0.9, 1.0, front + 0.15],
      ],
      tail: [],
      ind: [
        [-1.15, 1.0, front + 0.1],
        [1.15, 1.0, front + 0.1],
      ],
    },
    L,
  );
}

/** 13.6 m box trailer. */
function trailer(): HeavyPart {
  const b = new Builder();
  const L = 13.6;
  const H0 = 1.2;
  const H1 = 4.0;
  b.box('paint2', 2.55, H1 - H0, L, 0, (H0 + H1) / 2, 0);
  // Roof edge, corner posts and rear doors.
  b.box('#dadcd8', 2.57, 0.08, L, 0, H1, 0);
  for (const s of [-1, 1]) b.box('#9ea3a8', 0.06, H1 - H0, 0.1, s * 1.28, (H0 + H1) / 2, -L / 2 + 0.05);
  b.box('#c4c7c9', 0.05, H1 - H0 - 0.1, 0.05, 0, (H0 + H1) / 2, -L / 2 - 0.01);
  b.box(DARK, 2.3, 0.3, L - 0.4, 0, H0 - 0.2, 0);
  // Side underrun guards, landing legs, rear bumper and lights.
  for (const s of [-1, 1]) {
    b.box('#8f959b', 0.05, 0.25, 6.2, s * 1.2, 0.72, 0.6);
    b.box(DARK, 0.12, 0.9, 0.12, s * 0.9, 0.7, L / 2 - 2.2);
    b.box(RED, 0.3, 0.15, 0.05, s * 1.0, 0.95, -L / 2 - 0.08);
    b.box(AMBER, 0.12, 0.12, 0.05, s * 1.2, 0.95, -L / 2 - 0.08);
  }
  b.box('#3a3f46', 2.3, 0.18, 0.12, 0, 0.65, -L / 2 - 0.05);
  // Tri-axle bogie at the back.
  for (const z of [-3.6, -4.9, -6.2]) for (const s of [-1, 1]) b.wheel(s * 0.98, z + L / 2 - 6.8 + 0.2, 0.5, true);
  return b.done(
    {
      head: [],
      tail: [
        [-1.0, 0.95, -L / 2 - 0.12],
        [1.0, 0.95, -L / 2 - 0.12],
      ],
      ind: [
        [-1.2, 0.95, -L / 2 - 0.12],
        [1.2, 0.95, -L / 2 - 0.12],
      ],
    },
    L,
  );
}

/** Rigid box truck (8.4 m). */
function boxTruck(): HeavyPart {
  const b = new Builder();
  const L = 8.4;
  const front = L / 2;
  const cabD = 2.2;
  const cz = front - cabD / 2;
  b.box(DARK, 1.0, 0.3, L - 0.4, 0, 0.72, 0);
  b.box('paint', 2.4, 2.25, cabD, 0, 0.95 + 2.25 / 2, cz);
  b.box('paint', 2.2, 0.35, 0.5, 0, 3.25, front - 0.35, -0.35);
  b.box(GLASS, 2.1, 0.95, 0.05, 0, 2.55, front + 0.01);
  for (const s of [-1, 1]) b.box(GLASS, 0.05, 0.75, 0.9, s * 1.205, 2.55, front - 0.6);
  b.box(DARK, 1.5, 0.7, 0.06, 0, 1.55, front + 0.01);
  b.box('#3a3f46', 2.4, 0.4, 0.22, 0, 0.9, front - 0.02);
  for (const s of [-1, 1]) {
    b.box(LAMP, 0.38, 0.18, 0.05, s * 0.88, 0.95, front + 0.1);
    b.box(DARK, 0.08, 0.45, 0.16, s * 1.36, 2.5, front - 0.2);
    b.box(RED, 0.25, 0.3, 0.05, s * 1.0, 0.95, -front - 0.05);
  }
  // Cargo box.
  const boxL = L - cabD - 0.25;
  b.box('paint2', 2.5, 2.7, boxL, 0, 1.05 + 1.35, -front + boxL / 2);
  b.box('#c4c7c9', 2.52, 0.08, boxL, 0, 3.78, -front + boxL / 2);
  const r = 0.5;
  for (const s of [-1, 1]) {
    b.wheel(s * 1.02, front - 1.1, r);
    b.wheel(s * 0.98, -front + 1.9, r, true);
  }
  return b.done(
    {
      head: [
        [-0.88, 0.95, front + 0.13],
        [0.88, 0.95, front + 0.13],
      ],
      tail: [
        [-1.0, 0.95, -front - 0.1],
        [1.0, 0.95, -front - 0.1],
      ],
      ind: [
        [-1.15, 0.95, front + 0.1],
        [1.15, 0.95, front + 0.1],
        [-1.2, 0.95, -front - 0.1],
        [1.2, 0.95, -front - 0.1],
      ],
    },
    L,
  );
}

/** Intercity coach (12.2 m). */
function coach(): HeavyPart {
  const b = new Builder();
  const L = 12.2;
  const f = L / 2;
  const W = 2.55;
  // Body, with a rounded-looking roof edge and raked windscreen.
  b.box('paint', W, 2.6, L - 0.3, 0, 0.45 + 1.3, -0.15);
  b.box('paint', W - 0.2, 0.35, L - 0.6, 0, 3.2, -0.2);
  b.box('paint', W, 2.2, 0.35, 0, 1.55, f - 0.18);
  b.box(GLASS, W - 0.1, 1.55, 0.05, 0, 2.35, f - 0.02, -0.12);
  b.box('#ffb300', 1.4, 0.22, 0.05, 0, 3.1, f - 0.1);
  // Window band along both sides, stripe and luggage doors.
  for (const s of [-1, 1]) {
    b.box(GLASS, 0.04, 1.15, L - 1.6, s * (W / 2 + 0.005), 2.35, -0.2);
    b.box('paint2', 0.04, 0.22, L - 0.6, s * (W / 2 + 0.01), 1.45, -0.2);
    for (let i = 0; i < 3; i++) b.box('#b5bac0', 0.03, 0.75, 1.6, s * (W / 2 + 0.012), 0.95, 1.8 - i * 2.4);
    b.box(LAMP, 0.35, 0.16, 0.05, s * 0.9, 0.85, f + 0.01);
    b.box(RED, 0.2, 0.55, 0.05, s * 1.05, 1.3, -f - 0.01);
    b.box(DARK, 0.07, 0.5, 0.25, s * 1.4, 2.6, f - 0.1);
  }
  b.box('#3a3f46', W, 0.4, 0.2, 0, 0.55, f + 0.02);
  b.box('#3a3f46', W, 0.4, 0.2, 0, 0.55, -f - 0.02);
  b.box(GLASS, W - 0.3, 0.9, 0.04, 0, 2.5, -f - 0.02);
  const r = 0.52;
  for (const s of [-1, 1]) {
    b.wheel(s * 1.05, f - 2.6, r);
    b.wheel(s * 1.0, -f + 3.3, r, true);
  }
  return b.done(
    {
      head: [
        [-0.9, 0.85, f + 0.1],
        [0.9, 0.85, f + 0.1],
      ],
      tail: [
        [-1.05, 1.3, -f - 0.08],
        [1.05, 1.3, -f - 0.08],
      ],
      ind: [
        [-1.15, 0.85, f + 0.08],
        [1.15, 0.85, f + 0.08],
        [-1.15, 1.6, -f - 0.08],
        [1.15, 1.6, -f - 0.08],
      ],
    },
    L,
  );
}

const CACHE = new Map<string, HeavyPart>();

export type HeavyKey = 'semi_tractor' | 'semi_trailer' | 'truck' | 'bus';

export function heavyPart(key: HeavyKey): HeavyPart {
  let p = CACHE.get(key);
  if (!p) {
    p = key === 'semi_tractor' ? tractor() : key === 'semi_trailer' ? trailer() : key === 'truck' ? boxTruck() : coach();
    CACHE.set(key, p);
  }
  return p;
}

/** Along-body offsets of a semi's tractor and trailer centres (overall length 16.4 m). */
export const SEMI_LAYOUT = { length: 16.4, tractor: 16.4 / 2 - 3.0, trailer: -16.4 / 2 + 6.8 };

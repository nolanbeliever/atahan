// Procedural adventure motorcycle (modelled after a mid-size adventure bike: tall beak, small
// screen, big tank, parallel-twin engine, long-travel fork, 21"/17" spoked wheels).
// Geometry is merged per material slot like carBody.ts; the steering parts are kept separate so
// the fork, bars and front wheel can turn.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Part } from './carBody';

type V3 = [number, number, number];

const DARK: [number, number, number] = [0.08, 0.085, 0.095];
const ENGINE: [number, number, number] = [0.22, 0.23, 0.25];
const SEAT: [number, number, number] = [0.05, 0.05, 0.055];
const HEAD: [number, number, number] = [1, 1, 1];
const TAIL: [number, number, number] = [1, 0.07, 0.1];

export interface BikeBody {
  parts: Map<Part, THREE.BufferGeometry>;
  /** Parts that turn with the handlebars (pivot at `steerPivot`, geometry relative to it). */
  steerParts: Map<Part, THREE.BufferGeometry>;
  steerPivot: V3;
  /** Steering axis tilt (rake), radians. */
  rake: number;
  front: { z: number; r: number; w: number };
  rear: { z: number; r: number; w: number };
  /** Where the rider's hips sit. */
  seat: V3;
  exhausts: V3[];
  height: number;
}

function colorize(g: THREE.BufferGeometry, c: [number, number, number]): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function clean(g: THREE.BufferGeometry, keepColor: boolean): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(keepColor && name === 'color')) out.deleteAttribute(name);
  }
  return out;
}

/** A tube (cylinder) between two points. */
function tube(a: V3, b: V3, r: number, seg = 8): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

function box(w: number, h: number, d: number, at: V3, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(...at);
  return g;
}

function blob(sx: number, sy: number, sz: number, at: V3, seg = 14): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1));
  g.scale(sx, sy, sz);
  g.translate(...at);
  return g;
}

class Builder {
  private pieces = new Map<Part, THREE.BufferGeometry[]>();
  add(part: Part, g: THREE.BufferGeometry, color?: [number, number, number]): void {
    const vc = part === 'trim' || part === 'lamp';
    if (vc) colorize(g, color ?? DARK);
    const list = this.pieces.get(part) ?? [];
    list.push(clean(g, vc));
    this.pieces.set(part, list);
  }
  build(): Map<Part, THREE.BufferGeometry> {
    const out = new Map<Part, THREE.BufferGeometry>();
    for (const [part, list] of this.pieces) {
      const merged = mergeGeometries(list, false);
      if (merged) {
        merged.computeBoundingSphere();
        out.set(part, merged);
      }
      for (const g of list) g.dispose();
    }
    return out;
  }
}

const cache = new Map<string, BikeBody>();

export function bikeBody(modelId: string, length: number, wheelR: number, wheelW: number): BikeBody {
  const hit = cache.get(modelId);
  if (hit) return hit;
  const half = length / 2;
  const front = { z: half - wheelR - 0.02, r: wheelR, w: wheelW * 0.8 };
  const rear = { z: -half + wheelR * 0.94 + 0.04, r: wheelR * 0.94, w: wheelW * 1.25 };
  const b = new Builder();
  const s = new Builder();

  const head: V3 = [0, 1.02, front.z - 0.24];
  const pivot: V3 = [0, 0.52, -0.2];
  // Frame: twin spars from the steering head to the swingarm pivot, plus a subframe.
  for (const x of [-0.12, 0.12]) {
    b.add('trim', tube([x * 0.5, head[1], head[2]], [x, 0.78, 0.02], 0.028));
    b.add('trim', tube([x, 0.78, 0.02], [x, pivot[1], pivot[2]], 0.028));
    b.add('trim', tube([x, 0.8, -0.1], [x * 0.9, 0.9, rear.z + 0.1], 0.02));
    b.add('trim', tube([x, pivot[1], pivot[2]], [x * 1.1, 0.88, -0.45], 0.018));
    // Swingarm
    b.add('trim', tube([x * 1.15, pivot[1], pivot[2]], [x * 1.1, rear.r, rear.z], 0.03));
  }
  // Rear shock
  b.add('chrome', tube([0, pivot[1] + 0.05, pivot[2] - 0.08], [0, 0.82, -0.36], 0.035));
  // Engine (parallel twin) with sump guard.
  b.add('trim', box(0.36, 0.3, 0.44, [0, 0.46, 0.06]), ENGINE);
  b.add('trim', box(0.34, 0.16, 0.26, [0, 0.66, 0.16], -0.35), ENGINE);
  b.add('trim', box(0.24, 0.18, 0.2, [0, 0.4, -0.2]), ENGINE);
  b.add('chrome', box(0.3, 0.03, 0.5, [0, 0.29, 0.08], 0.12));
  // Radiator between the frame spars.
  b.add('trim', box(0.3, 0.26, 0.05, [0, 0.72, 0.38], -0.25));
  // Fuel tank + radiator shrouds + side panels (paint).
  b.add('paint', blob(0.21, 0.12, 0.3, [0, 1.0, 0.12]));
  for (const x of [-1, 1]) {
    b.add('paint', box(0.03, 0.28, 0.34, [x * 0.19, 0.84, 0.3], 0.3, x * 0.12));
    b.add('paint', box(0.03, 0.16, 0.34, [x * 0.15, 0.82, -0.52], -0.1));
  }
  // Seat (split rider/pillion) and tail section with lamp and luggage rack.
  b.add('trim', box(0.28, 0.08, 0.46, [0, 0.93, -0.22], 0.06), SEAT);
  b.add('trim', box(0.24, 0.08, 0.34, [0, 0.99, -0.6], 0.04), SEAT);
  b.add('paint', box(0.2, 0.1, 0.34, [0, 0.9, -0.82], 0.25));
  b.add('trim', box(0.28, 0.02, 0.26, [0, 1.06, -0.86]));
  b.add('lamp', box(0.12, 0.05, 0.02, [0, 0.93, -1.0], 0.25), TAIL);
  b.add('trim', box(0.16, 0.1, 0.02, [0, 0.72, -1.02]), DARK);
  // Rear fender / hugger.
  b.add('trim', box(0.16, 0.02, 0.4, [0, rear.r + 0.36, rear.z + 0.05], 0.3));
  // Exhaust: header, silencer on the right.
  b.add('chrome', tube([0.08, 0.5, 0.36], [0.17, 0.4, -0.06], 0.03));
  b.add('chrome', tube([0.17, 0.4, -0.06], [0.2, 0.6, -0.5], 0.03));
  b.add('chrome', tube([0.2, 0.6, -0.5], [0.2, 0.72, -0.86], 0.06, 12));
  // Frame-mounted cockpit: beak, headlight, screen, dash.
  b.add('paint', box(0.12, 0.05, 0.46, [0, 0.84, front.z - 0.06], 0.42));
  b.add('paint', box(0.28, 0.22, 0.14, [0, 1.06, front.z - 0.18], -0.35));
  b.add('lamp', box(0.2, 0.08, 0.02, [0, 1.07, front.z - 0.1], -0.35), HEAD);
  b.add('glass', box(0.32, 0.3, 0.012, [0, 1.3, front.z - 0.3], -0.45));
  b.add('trim', box(0.2, 0.1, 0.04, [0, 1.2, front.z - 0.36], -0.6));

  // Steering parts, relative to the steering head.
  const rake = 0.44;
  const toHead = (p: V3): V3 => [p[0] - head[0], p[1] - head[1], p[2] - head[2]];
  for (const x of [-0.1, 0.1]) {
    s.add('chrome', tube(toHead([x, head[1] + 0.06, head[2]]), toHead([x, 0.62, front.z - 0.06]), 0.026));
    s.add('trim', tube(toHead([x, 0.64, front.z - 0.06]), toHead([x, front.r, front.z]), 0.034));
  }
  s.add('trim', box(0.24, 0.05, 0.1, toHead([0, head[1] + 0.05, head[2]])));
  // Handlebars with hand guards and mirrors.
  s.add('trim', tube(toHead([-0.44, 1.2, head[2] - 0.12]), toHead([0.44, 1.2, head[2] - 0.12]), 0.014));
  s.add('trim', tube(toHead([-0.12, 1.1, head[2]]), toHead([-0.2, 1.2, head[2] - 0.1]), 0.014));
  s.add('trim', tube(toHead([0.12, 1.1, head[2]]), toHead([0.2, 1.2, head[2] - 0.1]), 0.014));
  for (const x of [-1, 1]) {
    s.add('paint', box(0.1, 0.08, 0.14, toHead([x * 0.42, 1.21, head[2] - 0.06])));
    s.add('trim', tube(toHead([x * 0.3, 1.2, head[2] - 0.1]), toHead([x * 0.34, 1.38, head[2] - 0.08]), 0.008));
    s.add('trim', box(0.1, 0.06, 0.012, toHead([x * 0.35, 1.4, head[2] - 0.08])));
  }
  // Low front fender.
  s.add('paint', box(0.14, 0.02, 0.5, toHead([0, front.r + 0.1, front.z]), -0.05));

  const body: BikeBody = {
    parts: b.build(),
    steerParts: s.build(),
    steerPivot: head,
    rake,
    front,
    rear,
    seat: [0, 0.94, -0.26],
    exhausts: [[0.2, 0.72, -0.93]],
    height: 1.46,
  };
  cache.set(modelId, body);
  return body;
}

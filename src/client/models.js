// Procedurally modelled props and vehicles (vertex-coloured, merged geometry so they
// can be drawn with InstancedMesh). Built once at startup.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();

function colorize(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
function place(g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  tmpE.set(rx, ry, rz); tmpQ.setFromEuler(tmpE); tmpS.set(sx, sy, sz); tmpP.set(x, y, z);
  tmpM.compose(tmpP, tmpQ, tmpS);
  g.applyMatrix4(tmpM);
  return g;
}
const box = (w, h, d, col, x, y, z, rx, ry, rz) => place(colorize(new THREE.BoxGeometry(w, h, d), col), x, y, z, rx, ry, rz);
const cyl = (r0, r1, h, seg, col, x, y, z, rx = 0, ry = 0, rz = 0) => place(colorize(new THREE.CylinderGeometry(r0, r1, h, seg), col), x, y, z, rx, ry, rz);

// hexahedron with bottom rect (±bw, z in [b0,b1]) at y0 and top rect (±tw, [t0,t1]) at y1
function hexa(bw, b0, b1, tw, t0, t1, y0, y1, col) {
  const v = [
    [-bw, y0, b0], [bw, y0, b0], [bw, y0, b1], [-bw, y0, b1],
    [-tw, y1, t0], [tw, y1, t0], [tw, y1, t1], [-tw, y1, t1],
  ];
  const f = [[0, 1, 2, 3], [7, 6, 5, 4], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]];
  const pos = [];
  for (const q of f) { const [a, b, c, d] = q.map(i => v[i]); pos.push(...a, ...b, ...c, ...a, ...c, ...d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return colorize(g, col);
}

const BODY = 0xffffff, GLASS = 0x141a20, TIRE = 0x1a1a1a, RIM = 0x8a8a8a, CHROME = 0x9a9a9a, DARK = 0x2a2a2a;

// Vehicle body specs (length along +z = forward)
export const CAR_SPECS = {
  car: { w: 1.86, l: 4.45, bodyH: [0.32, 0.88], cab: [0.88, 1.42, -1.05, 1.05, -0.62, 0.55], wheelR: 0.34, wheelZ: 1.35, track: 0.8 },
  sedan: { w: 1.86, l: 4.45, bodyH: [0.32, 0.88], cab: [0.88, 1.42, -1.05, 1.05, -0.62, 0.55], wheelR: 0.34, wheelZ: 1.35, track: 0.8 },
  police: { w: 1.9, l: 4.65, bodyH: [0.32, 0.9], cab: [0.9, 1.45, -1.1, 1.0, -0.65, 0.5], wheelR: 0.35, wheelZ: 1.4, track: 0.82, bar: true },
  pickup: { w: 1.98, l: 5.1, bodyH: [0.45, 1.05], cab: [1.05, 1.8, 0.0, 1.5, 0.1, 1.2], wheelR: 0.42, wheelZ: 1.65, track: 0.86, bed: true },
  van: { w: 2.0, l: 5.0, bodyH: [0.38, 1.0], cab: [1.0, 2.15, -2.4, 1.6, -2.4, 1.2], wheelR: 0.38, wheelZ: 1.65, track: 0.86, van: true },
  ambulance: { w: 2.15, l: 5.8, bodyH: [0.4, 1.05], cab: [1.05, 2.5, -2.8, 1.7, -2.8, 1.35], wheelR: 0.4, wheelZ: 1.95, track: 0.9, van: true, amb: true },
  truck: { w: 2.45, l: 7.2, bodyH: [0.55, 1.3], cab: [1.3, 2.7, 1.6, 3.5, 1.7, 3.3], wheelR: 0.5, wheelZ: 2.5, track: 1.0, box: true },
  bus: { w: 2.55, l: 11.2, bodyH: [0.45, 1.3], cab: [1.3, 3.0, -5.5, 5.5, -5.5, 5.4], wheelR: 0.5, wheelZ: 3.9, track: 1.05, bus: true },
};

export function vehicleGeometry(kind, { wheels = true, flat = false } = {}) {
  const s = CAR_SPECS[kind] || CAR_SPECS.car;
  const parts = [];
  const hw = s.w / 2, hl = s.l / 2;
  const [y0, y1] = s.bodyH;
  // lower body with tapered nose/tail
  parts.push(hexa(hw, -hl, hl, hw - 0.04, -hl + 0.15, hl - 0.25, y0, y1, BODY));
  parts.push(box(s.w + 0.04, 0.16, 0.22, DARK, 0, y0 + 0.06, hl - 0.05));
  parts.push(box(s.w + 0.04, 0.16, 0.22, DARK, 0, y0 + 0.06, -hl + 0.05));
  parts.push(box(s.w - 0.02, 0.12, s.l - 0.6, DARK, 0, y0 + 0.02, 0));
  const [cy0, cy1, cb0, cb1, ct0, ct1] = s.cab;
  if (s.bus) {
    parts.push(hexa(hw, cb0, cb1, hw - 0.02, ct0, ct1, cy0, cy1, BODY));
    for (let z = -4.6; z < 4.6; z += 1.3) for (const sd of [-1, 1]) parts.push(box(0.03, 0.8, 1.1, GLASS, sd * (hw + 0.005), cy0 + 0.9, z));
    parts.push(box(s.w - 0.2, 0.9, 0.03, GLASS, 0, cy0 + 0.9, hl - 0.25 + 0.01));
  } else if (s.van) {
    parts.push(hexa(hw, cb0, cb1, hw - 0.05, ct0, ct1, cy0, cy1, BODY));
    parts.push(hexa(hw - 0.02, cb1 - 0.02, hl - 0.1, hw - 0.15, ct1 - 0.02, ct1 + 0.3, cy0, cy0 + 0.75, GLASS));
    for (const sd of [-1, 1]) parts.push(box(0.03, 0.55, 0.9, GLASS, sd * (hw + 0.005), cy0 + 0.5, cb1 - 0.5));
    if (s.amb) { parts.push(box(0.04, 0.3, 2.6, 0xc81e1e, hw + 0.01, cy0 + 0.6, -1.0)); parts.push(box(0.04, 0.3, 2.6, 0xc81e1e, -hw - 0.01, cy0 + 0.6, -1.0)); parts.push(box(1.2, 0.15, 0.3, 0xc81e1e, 0, cy1 + 0.07, ct1 - 0.2)); }
  } else if (s.box) {
    parts.push(hexa(hw, cb0, cb1, hw - 0.08, ct0, ct1, cy0, cy1, BODY));
    parts.push(box(s.w - 0.3, 0.8, 0.04, GLASS, 0, cy0 + 0.85, cb1 - 0.06 + 0.02, -0.12));
    parts.push(box(s.w + 0.1, 2.6, 5.2, 0xd8d4c8, 0, y1 + 1.3, -0.95));
  } else {
    parts.push(hexa(hw - 0.06, cb0, cb1, hw - 0.22, ct0, ct1, cy0, cy1, GLASS));
    parts.push(box((hw - 0.22) * 2 + 0.02, 0.05, ct1 - ct0 + 0.02, BODY, 0, cy1, (ct0 + ct1) / 2));
    // pillars
    for (const sd of [-1, 1]) parts.push(box(0.06, cy1 - cy0, 0.1, BODY, sd * (hw - 0.14), (cy0 + cy1) / 2, (cb0 + cb1) / 2 + 0.05));
    if (s.bed) { // pickup bed walls
      parts.push(box(s.w, 0.45, 0.08, BODY, 0, y1 + 0.22, -hl + 0.06));
      for (const sd of [-1, 1]) parts.push(box(0.08, 0.45, hl + cb0 - 0.05, BODY, sd * (hw - 0.04), y1 + 0.22, (-hl + cb0) / 2));
    }
    if (s.bar) { parts.push(box(1.1, 0.1, 0.25, DARK, 0, cy1 + 0.08, (ct0 + ct1) / 2)); }
  }
  // lights
  parts.push(box(0.36, 0.12, 0.04, 0xfff4d0, hw - 0.3, y1 - 0.15, hl - 0.04 + 0.02));
  parts.push(box(0.36, 0.12, 0.04, 0xfff4d0, -hw + 0.3, y1 - 0.15, hl - 0.04 + 0.02));
  parts.push(box(0.3, 0.12, 0.04, 0x8a1010, hw - 0.25, y1 - 0.12, -hl + 0.02));
  parts.push(box(0.3, 0.12, 0.04, 0x8a1010, -hw + 0.25, y1 - 0.12, -hl + 0.02));
  parts.push(box(0.5, 0.18, 0.03, 0x2a2a2a, 0, y0 + 0.28, hl + 0.01));
  for (const sd of [-1, 1]) parts.push(box(0.2, 0.1, 0.08, DARK, sd * (hw + 0.05), cy0 + 0.05, cb1 - 0.05));
  if (wheels) {
    const r = s.wheelR;
    for (const zz of [s.wheelZ, -s.wheelZ]) for (const sd of [-1, 1]) {
      const fl = flat && zz < 0 && sd < 0 ? 0.12 : 0;
      parts.push(cyl(r, r, 0.26, 12, TIRE, sd * (hw - 0.14), r - fl, zz, 0, 0, Math.PI / 2));
      parts.push(cyl(r * 0.55, r * 0.55, 0.27, 8, RIM, sd * (hw - 0.14), r - fl, zz, 0, 0, Math.PI / 2));
    }
    if (s.bus || s.box) for (const sd of [-1, 1]) parts.push(cyl(s.wheelR, s.wheelR, 0.3, 12, TIRE, sd * (hw - 0.16), s.wheelR, -s.wheelZ + 1.2, 0, 0, Math.PI / 2));
  }
  const g = mergeGeometries(parts.map(p => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) q.deleteAttribute(k); return q; }));
  g.computeBoundingSphere();
  return g;
}

export function wheelGeometry(kind) {
  const s = CAR_SPECS[kind] || CAR_SPECS.car;
  const r = s.wheelR;
  return mergeGeometries([cyl(r, r, 0.26, 14, TIRE, 0, 0, 0, 0, 0, Math.PI / 2), cyl(r * 0.55, r * 0.55, 0.27, 8, RIM, 0, 0, 0, 0, 0, Math.PI / 2), box(0.28, r * 0.9, 0.08, 0x5a5a5a, 0, 0, 0)]);
}

function merge(parts) {
  const g = mergeGeometries(parts.map(p => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) q.deleteAttribute(k); return q; }));
  g.computeBoundingSphere();
  return g;
}

export function propGeometries() {
  const G = {};
  const POLE = 0x4a4c4e;
  // street lamp (arm towards +z); head separately
  G.lamp = merge([cyl(0.09, 0.13, 7, 8, POLE, 0, 3.5, 0), cyl(0.2, 0.2, 0.4, 8, POLE, 0, 0.2, 0), box(0.1, 0.1, 1.7, POLE, 0, 7.0, 0.8), box(0.4, 0.12, 0.7, 0x3a3a3a, 0, 7.0, 1.6)]);
  G.lampHead = merge([box(0.3, 0.05, 0.5, 0xffffff, 0, 6.92, 1.6)]);
  G.tlight = merge([cyl(0.09, 0.09, 4.5, 8, POLE, 0, 2.25, 0), box(0.12, 0.12, 3.2, POLE, 0, 4.4, 1.6), box(0.36, 1.0, 0.3, 0x2a2a2a, 0, 3.8, 3.1), cyl(0.1, 0.1, 0.05, 8, 0x5a1010, 0, 4.1, 3.27, Math.PI / 2), cyl(0.1, 0.1, 0.05, 8, 0x5a4a10, 0, 3.8, 3.27, Math.PI / 2), cyl(0.1, 0.1, 0.05, 8, 0x105a10, 0, 3.5, 3.27, Math.PI / 2)]);
  // trees
  const crown = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3, r = i ? 0.9 : 0;
    const ico = colorize(new THREE.IcosahedronGeometry(i ? 1.3 : 1.7, 1), [0x4a5a2a, 0x3e5226, 0x55602e, 0x46552a, 0x5a5a30][i]);
    const p = ico.attributes.position;
    for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (1 + Math.sin(k * 7.1) * 0.12), p.getY(k) * 0.85, p.getZ(k) * (1 + Math.cos(k * 3.3) * 0.12));
    ico.computeVertexNormals();
    crown.push(place(ico, Math.cos(a) * r, 4.6 + (i ? Math.sin(a * 2) * 0.5 : 0.6), Math.sin(a) * r));
  }
  G.tree = merge([cyl(0.14, 0.24, 4.5, 7, 0x4a3a2a, 0, 2.25, 0), cyl(0.06, 0.1, 1.8, 5, 0x4a3a2a, 0.5, 3.6, 0, 0, 0, -0.7), ...crown]);
  G.treeDead = merge([cyl(0.12, 0.22, 5, 7, 0x3a3028, 0, 2.5, 0), cyl(0.05, 0.09, 2.2, 5, 0x3a3028, 0.7, 4.0, 0, 0, 0, -0.8), cyl(0.04, 0.08, 1.8, 5, 0x3a3028, -0.6, 4.4, 0.2, 0.3, 0, 0.7), cyl(0.03, 0.06, 1.4, 5, 0x3a3028, 0.1, 4.9, -0.5, -0.6, 0, 0.1)]);
  G.bag = merge([place(colorize(new THREE.IcosahedronGeometry(0.32, 1), 0x1a1c1e), 0, 0.22, 0, 0, 0, 0, 1, 0.75, 1), place(colorize(new THREE.ConeGeometry(0.07, 0.15, 5), 0x1a1c1e), 0, 0.5, 0)]);
  G.trashcan = merge([cyl(0.3, 0.27, 0.95, 12, 0x5a6058, 0, 0.475, 0), cyl(0.32, 0.32, 0.06, 12, 0x4a5048, 0, 0.98, 0)]);
  G.sign = merge([cyl(0.04, 0.04, 2.6, 6, 0x8a8a8a, 0, 1.3, 0), place(colorize(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 8), 0xb81c1c), 0, 2.3, 0.03, Math.PI / 2, Math.PI / 8, 0)]);
  G.swing = merge([box(0.08, 2.4, 0.08, 0xa83a2a, -1.5, 1.2, -0.6, 0.25), box(0.08, 2.4, 0.08, 0xa83a2a, -1.5, 1.2, 0.6, -0.25), box(0.08, 2.4, 0.08, 0xa83a2a, 1.5, 1.2, -0.6, 0.25), box(0.08, 2.4, 0.08, 0xa83a2a, 1.5, 1.2, 0.6, -0.25), box(3.1, 0.08, 0.08, 0xa83a2a, 0, 2.35, 0), box(0.5, 0.05, 0.25, 0x2a2a2a, -0.6, 0.5, 0), box(0.02, 1.8, 0.02, 0x8a8a8a, -0.8, 1.45, 0), box(0.02, 1.8, 0.02, 0x8a8a8a, -0.4, 1.45, 0)]);
  G.cart = merge([box(0.55, 0.45, 0.85, 0x9aa0a8, 0, 0.75, 0), box(0.5, 0.04, 0.8, 0x6a7078, 0, 0.3, 0), box(0.04, 0.6, 0.04, 0x6a7078, 0.22, 0.3, 0.35), box(0.04, 0.6, 0.04, 0x6a7078, -0.22, 0.3, -0.35), box(0.55, 0.04, 0.04, 0xc81e1e, 0, 1.0, -0.48)]);
  G.pallet = merge([box(1.2, 0.04, 1.0, 0x9a8060, 0, 0.13, 0), box(1.2, 0.1, 0.12, 0x8a7050, 0, 0.05, -0.42), box(1.2, 0.1, 0.12, 0x8a7050, 0, 0.05, 0.42), box(1.2, 0.1, 0.12, 0x8a7050, 0, 0.05, 0)]);
  G.generator = merge([box(1.8, 1.2, 1.1, 0xc8a020, 0, 0.6, 0), box(1.9, 0.1, 1.2, 0x3a3a3a, 0, 1.25, 0), cyl(0.08, 0.08, 0.5, 6, 0x3a3a3a, 0.6, 1.5, 0.3), box(0.6, 0.4, 0.05, 0x2a2a2a, -0.4, 0.7, 0.56)]);
  const tire = (x, z, y = 0.1) => place(colorize(new THREE.TorusGeometry(0.3, 0.12, 6, 10), 0x1a1a1a), x, y, z, Math.PI / 2, 0, 0);
  G.debris = merge([tire(0, 0), box(0.6, 0.05, 0.4, 0x8a8478, 0.7, 0.03, 0.3, 0, 0.6, 0), box(0.3, 0.2, 0.3, 0x6a5a4a, -0.5, 0.1, 0.5, 0, 0.3, 0), box(0.9, 0.02, 0.6, 0xc8c0a8, 0.2, 0.01, -0.6, 0, 1.2, 0)]);
  return G;
}

export function carColor(hex) { return new THREE.Color(hex); }

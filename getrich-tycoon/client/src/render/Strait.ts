// The strait east of the city (Boğaz), its quays, the far shore's ground and roads, and the two
// suspension bridges: 3+3 lane decks that climb over the ring highway, towers standing in the
// water, main cables with hangers (lit in slowly changing colours at night), tall street lamps,
// piers and cable anchorages. Geometry comes from shared/strait.ts, so what you see is what the
// physics drives on.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ANCHOR_HALF,
  ANCHOR_X,
  BRIDGES,
  BRIDGE_HALF,
  BRIDGE_PIERS,
  CABLE_Z,
  CLEARANCE,
  FAR_ROADS,
  RADARS,
  TOWER_TOP,
  VIP_HALF,
  VIP_X,
  WATER,
  WORLD_BOX,
  deckHeight,
  type Bridge,
} from '../../../shared/strait';
import { lightGlowTexture } from './Highway';
import { Tex } from './Textures';
import { registerRoad } from './Weather';

/** Water surface height (below the quays). */
export const WATER_Y = -1.6;
/** How thick the deck is under the road (girders). */
const GIRDER = 1.8;
/** Hangers stand at this distance from the axis (on the walkway's outer edge). */
const HANGER_Z = BRIDGE_HALF + 1.2;

function rep(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

/** A small tiling normal map of choppy water (computed once). */
function waterNormals(): THREE.Texture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  const h = (x: number, y: number) => {
    const u = (x / n) * Math.PI * 2;
    const v = (y / n) * Math.PI * 2;
    return Math.sin(u * 3 + v * 2) * 0.5 + Math.sin(u * 7 - v * 5) * 0.28 + Math.sin(u * 13 + v * 11) * 0.14 + Math.sin(u * 2 - v * 9) * 0.2;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const nx = -dx * 2.2;
      const ny = -dy * 2.2;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * n + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** x samples along a bridge (every `step` m, plus the ends). */
function xsOf(b: Bridge, x0 = b.x0, x1 = b.x1, step = 2): number[] {
  const out: number[] = [];
  for (let x = x0; x < x1; x += step) out.push(x);
  out.push(x1);
  return out;
}

/** A strip lying on the deck between z offsets a..b (from the axis), `lift` above the road. */
function deckStrip(b: Bridge, a: number, c: number, lift: number, x0 = b.x0, x1 = b.x1, uvScale = 8): THREE.BufferGeometry {
  const xs = xsOf(b, x0, x1);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  xs.forEach((x, i) => {
    const y = deckHeight(b, x) + lift;
    pos.push(x, y, b.z + a, x, y, b.z + c);
    uv.push(x / uvScale, a / uvScale, x / uvScale, c / uvScale);
    if (i > 0) {
      const k = i * 2;
      // Facing up whichever way a..c runs.
      if (c > a) idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      else idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A vertical face along the bridge at z offset `at`, from `top(x)` down to `bottom(x)`, facing `out` (±1 in z). */
function deckFace(b: Bridge, at: number, top: (x: number) => number, bottom: (x: number) => number, out: 1 | -1): THREE.BufferGeometry {
  const xs = xsOf(b);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  xs.forEach((x, i) => {
    const t = top(x);
    const u = bottom(x);
    pos.push(x, t, b.z + at, x, u, b.z + at);
    uv.push(x / 6, t / 6, x / 6, u / 6);
    if (i > 0) {
      const k = i * 2;
      if (out > 0) idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      else idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = geos.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') x.deleteAttribute(name);
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position!.count * 2), 2));
    return x;
  });
  const m = mergeGeometries(clean, false)!;
  for (const g of geos) g.dispose();
  return m;
}

/** Height of a main cable above the ground at x: down to the anchorages, up over the towers,
 *  sagging to just above the deck in the middle of the main span. */
export function cableY(b: Bridge, x: number): number {
  const [t0, t1] = b.towers;
  const [a0, a1] = ANCHOR_X;
  const anchorY = 4;
  if (x <= t0) return anchorY + ((TOWER_TOP - anchorY) * (x - a0)) / (t0 - a0) - 2 * Math.sin((Math.PI * (x - a0)) / (t0 - a0));
  if (x >= t1) return anchorY + ((TOWER_TOP - anchorY) * (a1 - x)) / (a1 - t1) - 2 * Math.sin((Math.PI * (a1 - x)) / (a1 - t1));
  const mid = (t0 + t1) / 2;
  const low = deckHeight(b, mid) + 3.5;
  const u = (x - mid) / ((t1 - t0) / 2);
  return low + (TOWER_TOP - low) * u * u;
}

let water: THREE.MeshStandardMaterial | null = null;

/** The water surface (the strait and the sea share it; its waves move in StraitView.update). */
export function waterMaterial(): THREE.MeshStandardMaterial {
  if (!water) {
    const normalMap = waterNormals();
    normalMap.repeat.set(18, 160);
    water = new THREE.MeshStandardMaterial({ color: '#1b4d72', roughness: 0.12, metalness: 0.05, normalMap, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 1.3 });
  }
  return water;
}

export class StraitView {
  readonly group = new THREE.Group();
  private waterMat!: THREE.MeshStandardMaterial;
  private lampMat = new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a8', emissiveIntensity: 0.6 });
  private poolMat = new THREE.MeshBasicMaterial({ map: lightGlowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffd9a0' });
  private pools: THREE.Mesh[] = [];
  /** Cables and hangers glow in slowly changing colours at night (like the real Bosphorus bridges). */
  private ledMat = new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 0.7, roughness: 0.35, emissive: '#000000' });
  private beaconMat = new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff1a1a', emissiveIntensity: 0 });
  private night = 0;
  private time = 0;
  private flashes = new Map<string, THREE.Sprite>();
  private flashT = new Map<string, number>();

  constructor() {
    this.group.name = 'strait';
    this.buildGround();
    this.buildWater();
    this.buildQuays();
    this.buildFarRoads();
    for (const b of BRIDGES) this.buildBridge(b);
    this.buildFarSkyline();
    this.group.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  update(dt: number): void {
    this.time += dt;
    const n = this.waterMat.normalMap!;
    n.offset.set((this.time * 0.012) % 1, (this.time * 0.02) % 1);
    // The colour show on the cables at night.
    if (this.night > 0.05) {
      const hue = (this.time * 0.035) % 1;
      this.ledMat.emissive.setHSL(hue, 0.85, 0.5);
      this.ledMat.emissiveIntensity = this.night * 1.4;
    } else this.ledMat.emissiveIntensity = 0;
    // Aviation lights on the towers blink.
    this.beaconMat.emissiveIntensity = Math.sin(this.time * Math.PI * 1.2) > 0.2 ? 2.5 : 0.1;
    // Radar flashes fade out.
    for (const [id, t] of this.flashT) {
      const left = t - dt;
      const g = this.flashes.get(id)!;
      (g.material as THREE.SpriteMaterial).opacity = Math.max(0, left / 0.25);
      if (left <= 0) this.flashT.delete(id);
      else this.flashT.set(id, left);
    }
  }

  /** 0 by day - 1 at night: street lamps on, lit cables. */
  setNight(f: number): void {
    this.night = f;
    this.lampMat.emissiveIntensity = 0.6 + f * 2.6;
    this.poolMat.opacity = f * 0.5;
    for (const p of this.pools) p.visible = f > 0.02;
  }

  private add(geo: THREE.BufferGeometry, mat: THREE.Material, cast = false): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  // ------------------------------------------------------------ land and water

  private buildGround(): void {
    // The far shore: a slightly drier, warmer grass than the city's (to the sea at its south edge).
    const w = 1500 - WATER.east;
    const d = WORLD_BOX.maxZ + 800;
    const grass = new THREE.MeshStandardMaterial({ map: rep(Tex.grass(), w / 8.6, d / 8.6), roughness: 1, color: '#d9d2b4' });
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), grass);
    g.position.set(WATER.east + w / 2, -0.02, WORLD_BOX.maxZ - d / 2);
    g.receiveShadow = true;
    this.group.add(g);
  }

  private buildWater(): void {
    this.waterMat = waterMaterial();
    const w = WATER.east - WATER.west + 4;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, 2400).rotateX(-Math.PI / 2), this.waterMat);
    water.position.set((WATER.west + WATER.east) / 2, WATER_Y, 0);
    water.receiveShadow = true;
    this.group.add(water);
    // The bed under it (seen at grazing angles through the waves).
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(w, 2400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0b2233' }));
    bed.position.set((WATER.west + WATER.east) / 2, WATER_Y - 6, 0);
    this.group.add(bed);
  }

  private buildQuays(): void {
    const stone = new THREE.MeshStandardMaterial({ map: rep(Tex.concrete(), 300, 1), roughness: 0.9, color: '#a29c90' });
    const cap = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.7 });
    const wet = new THREE.MeshStandardMaterial({ color: '#3f4a45', roughness: 0.4 });
    const geos: THREE.BufferGeometry[] = [];
    const caps: THREE.BufferGeometry[] = [];
    const wets: THREE.BufferGeometry[] = [];
    const L = 2400;
    for (const [x, side] of [
      [WATER.west, 1],
      [WATER.east, -1],
    ] as const) {
      // A stone wall from the bed up to the quay, a pale coping on top, a dark tide line.
      geos.push(new THREE.BoxGeometry(1.2, 9.2, L).translate(x - side * 0.6, -4.5, 0));
      caps.push(new THREE.BoxGeometry(1.6, 0.3, L).translate(x - side * 0.5, 0.15, 0));
      wets.push(new THREE.BoxGeometry(0.06, 0.6, L).translate(x + side * 0.02, WATER_Y + 0.2, 0));
    }
    this.add(merge(geos), stone);
    this.add(merge(caps), cap);
    this.add(merge(wets), wet);
    // Mooring bollards along both quays.
    const bollard = new THREE.CylinderGeometry(0.25, 0.32, 0.8, 8);
    const im = new THREE.InstancedMesh(bollard, new THREE.MeshStandardMaterial({ color: '#2a2c31', metalness: 0.6, roughness: 0.4 }), 2 * 40);
    const m = new THREE.Matrix4();
    let i = 0;
    for (const x of [WATER.west - 1.2, WATER.east + 1.2]) {
      for (let k = 0; k < 40; k++) {
        const z = WORLD_BOX.minZ + 10 + k * 13;
        if (BRIDGES.some((b) => Math.abs(z - b.z) < 22)) continue;
        im.setMatrixAt(i++, m.makeTranslation(x, 0.4, z));
      }
    }
    im.count = i;
    this.group.add(im);
  }

  private buildFarRoads(): void {
    const asphalt = registerRoad(new THREE.MeshStandardMaterial({ map: rep(Tex.asphalt(), 1, 1), roughness: 0.95 }));
    const geos: THREE.BufferGeometry[] = [];
    const flat = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, y: number) => {
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate((r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
      const uv = g.attributes.uv!;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 10), uv.getY(k) * (d / 10));
      return g;
    };
    for (const r of FAR_ROADS) geos.push(flat(r, 0.01));
    // From the city's east road onto each bridge (the deck starts a few metres out).
    for (const b of BRIDGES) geos.push(flat({ minX: 150, maxX: b.x0 + 1, minZ: b.z - BRIDGE_HALF, maxZ: b.z + BRIDGE_HALF }, 0.012));
    this.add(merge(geos), asphalt);
    // VIP Otoban markings: a planted median with a low barrier, white lane lines.
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 });
    const lines: THREE.BufferGeometry[] = [];
    const vip = FAR_ROADS[0]!;
    for (const lane of [-1, 1]) {
      for (const k of [1, 2]) {
        const x = VIP_X + lane * (1.2 + k * 3.6);
        for (let z = vip.minZ + 2; z < vip.maxZ - 2; z += 9) {
          if (BRIDGES.some((b) => Math.abs(z - b.z) < BRIDGE_HALF + 2) || Math.abs(z - 40) < 9) continue;
          lines.push(new THREE.PlaneGeometry(0.18, 4.5).rotateX(-Math.PI / 2).translate(x, 0.02, z + 2.25));
        }
      }
      lines.push(new THREE.PlaneGeometry(0.2, vip.maxZ - vip.minZ).rotateX(-Math.PI / 2).translate(VIP_X + lane * (VIP_HALF - 0.6), 0.02, 0));
    }
    this.add(merge(lines), white);
    const median = new THREE.MeshStandardMaterial({ color: '#4d7a3c', roughness: 1 });
    const kerb = new THREE.MeshStandardMaterial({ color: '#c9c4b8', roughness: 0.8 });
    const meds: THREE.BufferGeometry[] = [];
    const kerbs: THREE.BufferGeometry[] = [];
    // Median islands between the junctions (gaps where the bridge roads and the boulevard cross).
    const gaps = [...BRIDGES.map((b) => [b.z - BRIDGE_HALF - 2, b.z + BRIDGE_HALF + 2]), [40 - 9, 40 + 9]].sort((p, q) => p[0]! - q[0]!);
    let z0 = vip.minZ + 2;
    for (const [a, c] of [...gaps, [vip.maxZ - 2, vip.maxZ]]) {
      if (a! - z0 > 4) {
        meds.push(new THREE.BoxGeometry(1.6, 0.18, a! - z0).translate(VIP_X, 0.09, (z0 + a!) / 2));
        kerbs.push(new THREE.BoxGeometry(2.0, 0.12, a! - z0).translate(VIP_X, 0.06, (z0 + a!) / 2));
      }
      z0 = c!;
    }
    this.add(merge(meds), median);
    this.add(merge(kerbs), kerb);
  }

  private buildFarSkyline(): void {
    // Hills of apartment blocks beyond the far shore (no colliders: out of reach).
    let seed = 4242;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const spots: [number, number, number, number, number][] = [];
    for (let i = 0; i < 90; i++) {
      const band = rng();
      let x: number;
      let z: number;
      if (band < 0.5) {
        x = WORLD_BOX.maxX + 60 + rng() * 220;
        z = (rng() - 0.5) * 900;
      } else {
        x = WATER.east + 40 + rng() * (WORLD_BOX.maxX - WATER.east + 200);
        z = (rng() < 0.5 ? -1 : 1) * (WORLD_BOX.maxZ + 70 + rng() * 140);
      }
      const size = [10 + rng() * 20, 10 + rng() * 20, 14 + Math.pow(rng(), 2) * 60] as const;
      // Not in the sea south of the far shore.
      if (z > WORLD_BOX.maxZ - 20) continue;
      spots.push([x, z, ...size]);
    }
    const win = Tex.windows('farskyline', '#b8a99a', '#3a4258', '#ffe0a0', 8, 12);
    const mat = new THREE.MeshStandardMaterial({ map: rep(win, 2, 4), roughness: 0.7 });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z, w, d, h], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d))));
    this.group.add(im);
  }

  // ------------------------------------------------------------ bridges

  private buildBridge(b: Bridge): void {
    const road = registerRoad(new THREE.MeshStandardMaterial({ map: rep(Tex.asphalt(), 1, 1), roughness: 0.93, color: '#b8bcc4' }));
    const concrete = new THREE.MeshStandardMaterial({ map: rep(Tex.concrete(), 1, 1), roughness: 0.85, color: '#c4c0b6' });
    const girder = new THREE.MeshStandardMaterial({ color: '#8f969e', roughness: 0.55, metalness: 0.35 });
    const walk = new THREE.MeshStandardMaterial({ map: rep(Tex.concrete(), 1, 1), roughness: 0.9, color: '#a8a49a' });
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 });
    const H = BRIDGE_HALF;
    const W = H + 1.6; // walkway outer edge
    const h = (x: number) => deckHeight(b, x);
    // Road, walkways.
    this.add(deckStrip(b, -H, H, 0.02), road);
    this.add(merge([deckStrip(b, H, W, 0.18), deckStrip(b, -W, -H, 0.18)]), walk);
    // Concrete barriers (inner face, top, outer face) on both sides.
    const barrier: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1] as const) {
      const zi = side * (H - 0.3);
      const zo = side * H;
      barrier.push(deckFace(b, zi, (x) => h(x) + 0.95, (x) => h(x), (-side) as 1 | -1));
      barrier.push(deckStrip(b, Math.min(zi, zo), Math.max(zi, zo), 0.95));
      // The deck's outer edge: girders down to the underside (to the ground on the low ramps).
      barrier.push(deckFace(b, side * W, (x) => h(x) + 0.2, (x) => (h(x) < CLEARANCE ? -0.05 : h(x) - GIRDER), side));
    }
    this.add(merge(barrier), concrete);
    // Underside of the deck where it is up in the air.
    const under = deckStrip(b, W, -W, -GIRDER);
    this.add(under, girder);
    // Steel railing on the walkways' outer edge.
    const rail: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) rail.push(deckStrip(b, side * (W - 0.05), side * W, 1.25));
    this.add(merge(rail), girder);
    // Markings: double yellow in the middle, dashed white lane lines, solid edge lines.
    const yl: THREE.BufferGeometry[] = [];
    const wl: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      yl.push(deckStrip(b, side * 0.12, side * 0.3, 0.035));
      wl.push(deckStrip(b, side * (0.6 + 10.8 - 0.1), side * (0.6 + 10.8 + 0.1), 0.035));
      for (const k of [1, 2]) {
        const z = side * (0.6 + k * 3.6);
        for (let x = b.x0 + 6; x < b.x1 - 6; x += 10) wl.push(deckStrip(b, z - 0.09, z + 0.09, 0.035, x, Math.min(b.x1 - 6, x + 4.5)));
      }
    }
    this.add(merge(yl), yellow);
    this.add(merge(wl), white);
    this.buildRadars(b);
    this.buildPiers(b, concrete);
    this.buildTowersAndCables(b, concrete);
    this.buildLamps(b);
    // The name over the main span's middle.
    this.buildNameSign(b);
  }

  /** Speed radar gantries across the deck (shared RADARS), with a flash that goes off at a pass. */
  private buildRadars(b: Bridge): void {
    const frame = new THREE.MeshStandardMaterial({ color: '#2d3138', metalness: 0.6, roughness: 0.4 });
    const box = new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.5 });
    const lens = new THREE.MeshStandardMaterial({ color: '#111318', metalness: 0.8, roughness: 0.2 });
    const tex = Tex.sign('HIZ KONTROLÜ · RADAR', { bg: '#0d2a45', fg: '#ffffff', accent: '#f2c230', w: 1024, h: 160 });
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.4, side: THREE.DoubleSide });
    for (const r of RADARS) {
      if (r.n !== b.n) continue;
      const y = deckHeight(b, r.x);
      const zs = BRIDGE_HALF + 0.9;
      this.add(merge([new THREE.BoxGeometry(0.5, 8, 0.5).translate(r.x, y + 4, b.z - zs), new THREE.BoxGeometry(0.5, 8, 0.5).translate(r.x, y + 4, b.z + zs), new THREE.BoxGeometry(0.7, 0.8, zs * 2 + 0.5).translate(r.x, y + 7.6, b.z)]), frame, true);
      const boxes: THREE.BufferGeometry[] = [];
      const lenses: THREE.BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        // One camera over each carriageway, looking at the traffic coming at it.
        const z = b.z + side * 5.5;
        boxes.push(new THREE.BoxGeometry(1.2, 0.9, 0.9).translate(r.x, y + 6.8, z));
        lenses.push(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 12).rotateZ(Math.PI / 2).translate(r.x + side * -0.65, y + 6.8, z));
      }
      this.add(merge(boxes), box);
      this.add(merge(lenses), lens);
      for (const dx of [-0.4, 0.4]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.25), signMat);
        sign.position.set(r.x + dx, y + 8.7, b.z);
        sign.rotation.y = Math.PI / 2;
        this.group.add(sign);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      glow.position.set(r.x, y + 6.6, b.z);
      glow.scale.setScalar(22);
      this.group.add(glow);
      this.flashes.set(r.id, glow);
    }
  }

  /** A radar went off. */
  flash(id: string): void {
    const g = this.flashes.get(id);
    if (!g) return;
    (g.material as THREE.SpriteMaterial).opacity = 1;
    this.flashT.set(id, 0.25);
  }

  private buildPiers(b: Bridge, mat: THREE.Material): void {
    const geos: THREE.BufferGeometry[] = [];
    const xs = new Set<number>();
    for (const p of BRIDGE_PIERS) {
      if (Math.abs(p.z - b.z) > BRIDGE_HALF) continue;
      const top = deckHeight(b, p.x) - GIRDER;
      geos.push(new THREE.CylinderGeometry(p.r, p.r * 1.1, top, 12).translate(p.x, top / 2, p.z));
      xs.add(p.x);
    }
    // A cross beam under the deck on each pair of piers.
    for (const x of xs) {
      const top = deckHeight(b, x) - GIRDER;
      geos.push(new THREE.BoxGeometry(2.2, 1.0, (BRIDGE_HALF + 1.6) * 2 - 1).translate(x, top - 0.5, b.z));
    }
    this.add(merge(geos), mat, true);
  }

  private buildTowersAndCables(b: Bridge, concrete: THREE.Material): void {
    const tower = new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.55, metalness: 0.2 });
    const geos: THREE.BufferGeometry[] = [];
    const beacons: THREE.BufferGeometry[] = [];
    for (const x of b.towers) {
      for (const side of [-1, 1]) {
        const z = b.z + side * CABLE_Z;
        // A tapering leg from below the water to the top.
        const base = WATER_Y - 4;
        const len = TOWER_TOP - base;
        geos.push(new THREE.CylinderGeometry(1.4, 2.4, len, 4, 1).rotateY(Math.PI / 4).translate(x, base + len / 2, z));
        // Saddle on top where the cable passes over.
        geos.push(new THREE.BoxGeometry(3.2, 1.6, 2.4).translate(x, TOWER_TOP + 0.6, z));
        beacons.push(new THREE.SphereGeometry(0.45, 8, 6).translate(x, TOWER_TOP + 1.8, z));
      }
      // Portal beams: under the deck, halfway up and at the top.
      const span = CABLE_Z * 2;
      for (const [y, t] of [
        [deckHeight(b, x) - GIRDER - 1.4, 2.4],
        [42, 2.6],
        [TOWER_TOP - 3, 3.2],
      ] as const) {
        geos.push(new THREE.BoxGeometry(2.6, t, span).translate(x, y, b.z));
      }
      // Footing in the water.
      geos.push(new THREE.BoxGeometry(9, 4, span + 9).translate(x, WATER_Y - 0.6, b.z));
    }
    this.add(merge(geos), tower, true);
    this.add(merge(beacons), this.beaconMat);
    // Anchorages on both shores.
    const anchors: THREE.BufferGeometry[] = [];
    for (const x of ANCHOR_X) for (const side of [-1, 1]) anchors.push(new THREE.BoxGeometry(ANCHOR_HALF * 2, 6, ANCHOR_HALF * 2).translate(x, 3, b.z + side * CABLE_Z));
    this.add(merge(anchors), concrete, true);
    // Main cables (sagging tubes) and the hangers down to the deck edge.
    const cables: THREE.BufferGeometry[] = [];
    const hangers: THREE.BufferGeometry[] = [];
    const [a0, a1] = ANCHOR_X;
    for (const side of [-1, 1]) {
      const z = b.z + side * CABLE_Z;
      const pts: THREE.Vector3[] = [];
      for (let x = a0; x <= a1; x += 3) pts.push(new THREE.Vector3(x, cableY(b, x), z));
      pts.push(new THREE.Vector3(a1, cableY(b, a1), z));
      cables.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.55, 6, false));
      for (let x = a0 + 8; x < a1 - 4; x += 8) {
        if (b.towers.some((t) => Math.abs(t - x) < 4)) continue;
        const top = cableY(b, x);
        const bottom = deckHeight(b, x) + 0.4;
        if (top - bottom < 1) continue;
        const hz = b.z + side * HANGER_Z;
        // From the cable down to the walkway edge.
        const g = new THREE.CylinderGeometry(0.07, 0.07, 1, 4).translate(0, 0.5, 0);
        const dir = new THREE.Vector3(0, top - bottom, z - hz);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, bottom, hz), q, new THREE.Vector3(1, dir.length(), 1)));
        hangers.push(g);
      }
    }
    this.add(merge([...cables, ...hangers]), this.ledMat);
  }

  private buildLamps(b: Bridge): void {
    // Tall twin-arm lamp posts on the walkways, every 34 m (off the road).
    const spots: { x: number; side: number }[] = [];
    for (let x = b.x0 + 34; x < b.x1 - 20; x += 34) {
      if (b.towers.some((t) => Math.abs(t - x) < 8)) continue;
      for (const side of [-1, 1]) spots.push({ x, side });
    }
    const poleGeo = new THREE.CylinderGeometry(0.16, 0.24, 14, 8).translate(0, 7, 0);
    const armGeo = new THREE.BoxGeometry(0.16, 0.16, 3.4).translate(0, 13.8, -1.7);
    const headGeo = new THREE.BoxGeometry(0.7, 0.24, 1.6).translate(0, 13.6, -3.2);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#4a525e', metalness: 0.6, roughness: 0.4 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, spots.length);
    const heads = new THREE.InstancedMesh(headGeo, this.lampMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((p, i) => {
      // Arms reach in over the road.
      q.setFromEuler(new THREE.Euler(0, p.side > 0 ? 0 : Math.PI, 0));
      m.compose(new THREE.Vector3(p.x, deckHeight(b, p.x) + 0.18, b.z + p.side * (BRIDGE_HALF + 0.8)), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(i, m);
      arms.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    this.group.add(poles, arms, heads);
    // Pools of light on the road at night.
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.poolMat, spots.length);
    spots.forEach((p, i) => {
      const x = p.x;
      pool.setMatrixAt(i, m.compose(new THREE.Vector3(x, deckHeight(b, x) + 0.06, b.z + p.side * (BRIDGE_HALF - 3.6)), new THREE.Quaternion(), new THREE.Vector3(12, 1, 12)));
    });
    pool.renderOrder = 2;
    pool.visible = false;
    this.pools.push(pool as unknown as THREE.Mesh);
    this.group.add(pool);
  }

  private buildNameSign(b: Bridge): void {
    const x = b.towers[0];
    const tex = Tex.sign(b.name.split(' · ')[0]!.toUpperCase(), { bg: '#0d2a45', fg: '#ffffff', accent: '#f2c230', w: 1024, h: 192 });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.4 });
    // On the top beam of the city-side tower, facing the city and the far shore.
    const g = new THREE.PlaneGeometry(CABLE_Z * 1.6, 3.6);
    const west = new THREE.Mesh(g, mat);
    west.position.set(x - 1.35, TOWER_TOP - 3, b.z);
    west.rotation.y = -Math.PI / 2;
    const east = new THREE.Mesh(g, mat);
    east.position.set(x + 1.35, TOWER_TOP - 3, b.z);
    east.rotation.y = Math.PI / 2;
    this.group.add(west, east);
  }
}

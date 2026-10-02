// What stands on the far shore (shared/farShore.ts): the hill with the touge (road, guardrails,
// trees, a start banner), the Galeri Bulvarı with its lamps, the road and gate into the docks, the
// container yard (stacks, gantry cranes on the quay, flood-light towers, the fence) and the sea
// beyond it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BOULEVARD,
  CONTAINER_STACKS,
  CRANES_X,
  CRANE_LEGS_Z,
  DOCKS,
  DOCKS_GATE,
  DOCKS_ROAD,
  DOCK_FENCES,
  HILL,
  HILL_TREES,
  LIGHT_TOWERS,
  TOUGE_HALF,
  TOUGE_PATH,
  distToTouge,
  terrainHeight,
  tougeRails,
} from '../../../shared/farShore';
import { WATER, WORLD_BOX } from '../../../shared/strait';
import { lightGlowTexture } from './Highway';
import { WATER_Y, waterMaterial } from './Strait';
import { Tex } from './Textures';
import { registerRoad } from './Weather';

function rep(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
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

/** A flat rectangle on the ground (y), uv in metres / `tile`. */
function flat(r: { minX: number; maxX: number; minZ: number; maxZ: number }, y: number, tile = 10): THREE.BufferGeometry {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate((r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
  const uv = g.attributes.uv!;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / tile), uv.getY(k) * (d / tile));
  return g;
}

/** A ribbon along a polyline, `half` wide either side, lying on the terrain (+ lift). */
function ribbon(pts: { x: number; z: number }[], a: number, b: number, lift: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let along = 0;
  pts.forEach((p, i) => {
    const q0 = pts[Math.max(0, i - 1)]!;
    const q1 = pts[Math.min(pts.length - 1, i + 1)]!;
    const l = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1;
    const nx = -(q1.z - q0.z) / l;
    const nz = (q1.x - q0.x) / l;
    if (i > 0) along += Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z);
    for (const off of [a, b]) {
      const x = p.x + nx * off;
      const z = p.z + nz * off;
      pos.push(x, terrainHeight(x, z) + lift, z);
      uv.push(off / 8, along / 8);
    }
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Corrugated steel for the containers (white, tinted per instance). */
function corrugated(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 128; x += 8) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x, 0, 3, 64);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x + 4, 0, 2, 64);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, 128, 3);
  g.fillRect(0, 61, 128, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class FarShoreView {
  readonly group = new THREE.Group();
  private lampMat = new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a8', emissiveIntensity: 0.6 });
  private floodMat = new THREE.MeshStandardMaterial({ color: '#f4f8ff', emissive: '#dfeaff', emissiveIntensity: 0.4 });
  private poolMat = new THREE.MeshBasicMaterial({ map: lightGlowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffe0b0' });
  private pools: THREE.Object3D[] = [];
  private craneLights = new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff2020', emissiveIntensity: 0 });
  private time = 0;

  constructor() {
    this.group.name = 'far-shore';
    this.buildSea();
    this.buildHill();
    this.buildTouge();
    this.buildBoulevard();
    this.buildDocks();
    this.group.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  update(dt: number): void {
    this.time += dt;
    // Aviation lights on the cranes blink with the bridges'.
    this.craneLights.emissiveIntensity = Math.sin(this.time * Math.PI * 1.2) > 0.2 ? 2.5 : 0.1;
  }

  setNight(f: number): void {
    this.lampMat.emissiveIntensity = 0.6 + f * 2.6;
    this.floodMat.emissiveIntensity = 0.4 + f * 3.2;
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

  // ------------------------------------------------------------ the sea

  private buildSea(): void {
    // South of the far shore (the docks' quay is its edge) and east of the playable area.
    const x0 = WATER.east - 2;
    const w = 1700 - x0;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(w, 1300).rotateX(-Math.PI / 2), waterMaterial());
    sea.position.set(x0 + w / 2, WATER_Y, WORLD_BOX.maxZ + 650);
    sea.receiveShadow = true;
    this.group.add(sea);
    // The quay wall along the far shore's south edge.
    const stone = new THREE.MeshStandardMaterial({ map: rep(Tex.concrete(), 120, 1), roughness: 0.9, color: '#a29c90' });
    this.add(new THREE.BoxGeometry(w, 9.2, 1.2).translate(x0 + w / 2, -4.5, WORLD_BOX.maxZ + 0.6), stone);
    this.add(new THREE.BoxGeometry(w, 0.3, 1.6).translate(x0 + w / 2, 0.15, WORLD_BOX.maxZ + 0.5), new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.7 }));
  }

  // ------------------------------------------------------------ the hill and the touge

  private buildHill(): void {
    const step = 3;
    const x0 = 712;
    const x1 = WORLD_BOX.maxX + 90;
    const z0 = WORLD_BOX.minZ - 90;
    const z1 = HILL.z + HILL.rz + 4;
    const nx = Math.ceil((x1 - x0) / step);
    const nz = Math.ceil((z1 - z0) / step);
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const grass = new THREE.Color('#5f8f45');
    const high = new THREE.Color('#7d8a55');
    const rock = new THREE.Color('#8a8172');
    const c = new THREE.Color();
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * step;
        const z = z0 + j * step;
        const h = terrainHeight(x, z);
        // Dip under the touge so the terrain never pokes through the road.
        const dip = h > 0.05 && distToTouge(x, z) < TOUGE_HALF + 3 ? 0.45 : 0;
        pos.push(x, h - 0.04 - dip, z);
        uv.push(x / 8.6, z / 8.6);
        const g = Math.hypot(terrainHeight(x + 1, z) - terrainHeight(x - 1, z), terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2;
        c.copy(grass).lerp(high, Math.min(1, h / HILL.top)).lerp(rock, Math.min(1, Math.max(0, (g - 0.35) * 2.5)));
        col.push(c.r, c.g, c.b);
        if (i > 0 && j > 0) {
          const a = (j - 1) * (nx + 1) + (i - 1);
          const b = a + 1;
          const d = a + nx + 1;
          const e = d + 1;
          idx.push(a, d, b, b, d, e);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: rep(Tex.grass(), 1, 1), vertexColors: true, roughness: 1 });
    this.add(geo, mat);
    // Trees.
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6), new THREE.MeshStandardMaterial({ color: '#6d4c35', roughness: 1 }), HILL_TREES.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 4.2, 7), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), HILL_TREES.length);
    const m = new THREE.Matrix4();
    const greens = ['#2f6b34', '#3b7a3a', '#24592c', '#4a8441'].map((c) => new THREE.Color(c));
    HILL_TREES.forEach((t, i) => {
      const y = terrainHeight(t.x, t.z);
      trunk.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, y + 1.2 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s, t.s)));
      crown.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, y + 4 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s, t.s)));
      crown.setColorAt(i, greens[i % greens.length]!);
    });
    trunk.castShadow = true;
    crown.castShadow = true;
    this.group.add(trunk, crown);
  }

  private buildTouge(): void {
    const road = registerRoad(new THREE.MeshStandardMaterial({ map: rep(Tex.asphalt(), 1, 1), roughness: 0.95, color: '#a7abb3' }));
    const p = TOUGE_PATH;
    this.add(ribbon(p, -TOUGE_HALF, TOUGE_HALF, 0.05), road);
    // Double yellow in the middle, white edges.
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 });
    this.add(merge([ribbon(p, -0.3, -0.12, 0.07), ribbon(p, 0.12, 0.3, 0.07)]), yellow);
    this.add(merge([ribbon(p, -TOUGE_HALF + 0.25, -TOUGE_HALF + 0.42, 0.07), ribbon(p, TOUGE_HALF - 0.42, TOUGE_HALF - 0.25, 0.07)]), white);
    // Guardrails: a W-beam on posts, both sides.
    const steel = new THREE.MeshStandardMaterial({ color: '#c3c8cf', metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide });
    const { left, right } = tougeRails();
    const beams: THREE.BufferGeometry[] = [];
    const postSpots: { x: number; z: number }[] = [];
    for (const rail of [left, right]) {
      const run = rail.slice(4, rail.length - 4);
      beams.push(ribbonWall(run, 0.45, 0.8));
      for (let i = 0; i < run.length; i += 2) postSpots.push(run[i]!);
    }
    this.add(merge(beams), steel);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.85, 0.12).translate(0, 0.42, 0), steel, postSpots.length);
    const m = new THREE.Matrix4();
    postSpots.forEach((q, i) => posts.setMatrixAt(i, m.makeTranslation(q.x, terrainHeight(q.x, q.z), q.z)));
    this.group.add(posts);
    // The start banner over the road where it leaves the VIP Otoban.
    const s = p[3]!;
    const frame = new THREE.MeshStandardMaterial({ color: '#1b1d22', metalness: 0.5, roughness: 0.5 });
    const y0 = terrainHeight(s.x, s.z);
    this.add(merge([new THREE.BoxGeometry(0.4, 6.4, 0.4).translate(s.x, y0 + 3.2, s.z - 5.4), new THREE.BoxGeometry(0.4, 6.4, 0.4).translate(s.x, y0 + 3.2, s.z + 5.4), new THREE.BoxGeometry(0.5, 0.5, 11.4).translate(s.x, y0 + 6.2, s.z)]), frame);
    const tex = Tex.sign('DAĞ YOLU · TOUGE', { bg: '#14161b', fg: '#ffffff', accent: '#e63946', w: 1024, h: 192, sub: '5 viraj · drift' });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 1.95), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
    banner.position.set(s.x, y0 + 5.1, s.z);
    banner.rotation.y = -Math.PI / 2;
    this.group.add(banner);
  }

  // ------------------------------------------------------------ the boulevard and the docks

  private buildBoulevard(): void {
    const asphalt = registerRoad(new THREE.MeshStandardMaterial({ map: rep(Tex.asphalt(), 1, 1), roughness: 0.95 }));
    this.add(merge([flat(BOULEVARD, 0.01), flat(DOCKS_ROAD, 0.011), flat(DOCKS_GATE, 0.011)]), asphalt);
    // Sidewalks along the boulevard and lamp posts on them.
    const walk = new THREE.MeshStandardMaterial({ map: rep(Tex.concrete(), 1, 1), roughness: 0.9, color: '#b9b4a8' });
    const b = BOULEVARD;
    this.add(
      merge([
        new THREE.BoxGeometry(b.maxX - b.minX, 0.14, 4).translate((b.minX + b.maxX) / 2, 0.07, b.minZ - 2),
        new THREE.BoxGeometry(DOCKS_ROAD.minX - b.minX, 0.14, 4).translate((b.minX + DOCKS_ROAD.minX) / 2, 0.07, b.maxZ + 2),
        new THREE.BoxGeometry(b.maxX - DOCKS_ROAD.maxX, 0.14, 4).translate((DOCKS_ROAD.maxX + b.maxX) / 2, 0.07, b.maxZ + 2),
      ]),
      walk,
    );
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 });
    const dashes: THREE.BufferGeometry[] = [];
    for (let x = b.minX + 4; x < b.maxX - 4; x += 9) dashes.push(new THREE.PlaneGeometry(4.5, 0.18).rotateX(-Math.PI / 2).translate(x + 2.25, 0.02, (b.minZ + b.maxZ) / 2));
    for (let z = DOCKS_ROAD.minZ + 4; z < DOCKS_ROAD.maxZ - 4; z += 9) dashes.push(new THREE.PlaneGeometry(0.18, 4.5).rotateX(-Math.PI / 2).translate((DOCKS_ROAD.minX + DOCKS_ROAD.maxX) / 2, 0.02, z + 2.25));
    this.add(merge(dashes), white);
    const spots: { x: number; z: number; side: number }[] = [];
    for (let x = b.minX + 14; x < b.maxX - 6; x += 32) {
      spots.push({ x, z: b.minZ - 2.6, side: 1 });
      if (Math.abs(x - (DOCKS_ROAD.minX + DOCKS_ROAD.maxX) / 2) > 12) spots.push({ x, z: b.maxZ + 2.6, side: -1 });
    }
    this.buildLampPosts(spots);
    // The boulevard's name over its west end.
    const tex = Tex.sign('GALERİ BULVARI', { bg: '#0d2a45', fg: '#ffffff', accent: '#f2c230', w: 1024, h: 192, sub: 'Karşı Kıyı · 8 galeri' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.25), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
    sign.position.set(b.minX + 6, 6.2, (b.minZ + b.maxZ) / 2);
    sign.rotation.y = Math.PI / 2;
    const frame = new THREE.MeshStandardMaterial({ color: '#1b1d22', metalness: 0.5, roughness: 0.5 });
    this.add(merge([new THREE.BoxGeometry(0.4, 7.4, 0.4).translate(b.minX + 6, 3.7, b.minZ - 0.6), new THREE.BoxGeometry(0.4, 7.4, 0.4).translate(b.minX + 6, 3.7, b.maxZ + 0.6), new THREE.BoxGeometry(0.5, 0.5, b.maxZ - b.minZ + 1.6).translate(b.minX + 6, 7.4, (b.minZ + b.maxZ) / 2)]), frame);
    this.group.add(sign);
  }

  private buildLampPosts(spots: { x: number; z: number; side: number }[]): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: '#39404d', metalness: 0.6, roughness: 0.4 });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 7, 6).translate(0, 3.5, 0), poleMat, spots.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.2, 1.2).translate(0, 7, 0.8), this.lampMat, spots.length);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.poolMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.side > 0 ? 0 : Math.PI, 0));
      m.compose(new THREE.Vector3(s.x, 0.14, s.z), q, new THREE.Vector3(1, 1, 1));
      pole.setMatrixAt(i, m);
      head.setMatrixAt(i, m);
      pool.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0.05, s.z + s.side * 3), new THREE.Quaternion(), new THREE.Vector3(12, 1, 12)));
    });
    pole.castShadow = true;
    pool.renderOrder = 2;
    pool.visible = false;
    this.pools.push(pool);
    this.group.add(pole, head, pool);
  }

  private buildDocks(): void {
    // The yard: pale concrete with painted lane lines.
    const yard = new THREE.MeshStandardMaterial({ map: rep(Tex.concrete(), 1, 1), roughness: 0.85, color: '#9d9a92' });
    this.add(flat(DOCKS, 0.008, 6), registerRoad(yard));
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 });
    const lines: THREE.BufferGeometry[] = [];
    for (const z of [186, 214, 242]) lines.push(new THREE.PlaneGeometry(DOCKS.maxX - DOCKS.minX - 8, 0.25).rotateX(-Math.PI / 2).translate((DOCKS.minX + DOCKS.maxX) / 2, 0.02, z));
    this.add(merge(lines), yellow);
    // Containers: 20 ft boxes in stacks, in shipping-line colours.
    const tex = corrugated();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.3 });
    const L = 6.06;
    const W = 2.44;
    const H = 2.59;
    const boxes: { x: number; y: number; z: number; c: THREE.Color }[] = [];
    const colors = ['#c1121f', '#1d3557', '#2a9d8f', '#e76f51', '#f4a261', '#6c757d', '#3a5a40', '#7b2cbf', '#b08968', '#e9c46a'].map((c) => new THREE.Color(c));
    for (const s of CONTAINER_STACKS) {
      const nx = Math.floor((s.maxX - s.minX) / (L + 0.1));
      const nz = Math.floor((s.maxZ - s.minZ) / (W + 0.05));
      let k = s.seed;
      for (let lvl = 0; lvl < s.high; lvl++) {
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < nz; j++) {
            k = (k * 1103515245 + 12345) >>> 0;
            // The top level has gaps.
            if (lvl > 0 && lvl === s.high - 1 && k % 5 === 0) continue;
            boxes.push({ x: s.minX + (s.maxX - s.minX - nx * (L + 0.1)) / 2 + (i + 0.5) * (L + 0.1), y: lvl * H + H / 2, z: s.minZ + (s.maxZ - s.minZ - nz * (W + 0.05)) / 2 + (j + 0.5) * (W + 0.05), c: colors[k % colors.length]! });
          }
        }
      }
    }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(L, H, W), mat, boxes.length);
    const m = new THREE.Matrix4();
    boxes.forEach((b, i) => {
      im.setMatrixAt(i, m.makeTranslation(b.x, b.y, b.z));
      im.setColorAt(i, b.c);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    this.group.add(im);
    // The fence: posts and mesh panels.
    const fence = new THREE.MeshStandardMaterial({ color: '#8d939b', metalness: 0.6, roughness: 0.5, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const panels: THREE.BufferGeometry[] = [];
    for (const f of DOCK_FENCES) {
      const w = f.maxX - f.minX;
      const d = f.maxZ - f.minZ;
      panels.push(new THREE.BoxGeometry(Math.max(0.06, w), 2.4, Math.max(0.06, d)).translate((f.minX + f.maxX) / 2, 1.2, (f.minZ + f.maxZ) / 2));
    }
    this.add(merge(panels), fence);
    this.buildCranes();
    this.buildFloodLights();
    // A sign over the west gate.
    const sTex = Tex.sign('LİMAN · DOCKS', { bg: '#1d1f24', fg: '#ffcf4a', accent: '#ff7a1a', w: 1024, h: 192, sub: 'Konteyner sahası · drift' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.25), new THREE.MeshStandardMaterial({ map: sTex, emissive: '#ffffff', emissiveMap: sTex, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
    const gz = (DOCKS_GATE.minZ + DOCKS_GATE.maxZ) / 2;
    sign.position.set(DOCKS.minX, 5.6, gz);
    sign.rotation.y = Math.PI / 2;
    const frame = new THREE.MeshStandardMaterial({ color: '#1b1d22', metalness: 0.5, roughness: 0.5 });
    this.add(merge([new THREE.BoxGeometry(0.4, 6.8, 0.4).translate(DOCKS.minX, 3.4, DOCKS_GATE.minZ), new THREE.BoxGeometry(0.4, 6.8, 0.4).translate(DOCKS.minX, 3.4, DOCKS_GATE.maxZ), new THREE.BoxGeometry(0.5, 0.5, DOCKS_GATE.maxZ - DOCKS_GATE.minZ).translate(DOCKS.minX, 6.8, gz)]), frame);
    this.group.add(sign);
  }

  private buildCranes(): void {
    const red = new THREE.MeshStandardMaterial({ color: '#c8282b', roughness: 0.5, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.6, metalness: 0.4 });
    const geos: THREE.BufferGeometry[] = [];
    const cab: THREE.BufferGeometry[] = [];
    const beacons: THREE.BufferGeometry[] = [];
    const [za, zb] = CRANE_LEGS_Z;
    for (const x of CRANES_X) {
      for (const z of [za, zb]) for (const dx of [-7, 7]) geos.push(new THREE.BoxGeometry(1.1, 34, 1.1).translate(x + dx, 17, z));
      // Portal beams, the girder running out over the sea (the boom) and back over the yard.
      for (const dx of [-7, 7]) geos.push(new THREE.BoxGeometry(1.2, 1.4, zb - za + 1.2).translate(x + dx, 12, (za + zb) / 2));
      geos.push(new THREE.BoxGeometry(16, 1.6, 1.4).translate(x, 33, za), new THREE.BoxGeometry(16, 1.6, 1.4).translate(x, 33, zb));
      for (const dx of [-3.5, 3.5]) geos.push(new THREE.BoxGeometry(1.2, 1.8, 72).translate(x + dx, 35, (za + zb) / 2 + 14));
      // A-frame on top.
      geos.push(new THREE.BoxGeometry(1, 14, 1).translate(x - 3.5, 42, zb), new THREE.BoxGeometry(1, 14, 1).translate(x + 3.5, 42, zb), new THREE.BoxGeometry(8, 1, 1).translate(x, 49, zb));
      cab.push(new THREE.BoxGeometry(5, 3, 4).translate(x, 32, zb + 8), new THREE.BoxGeometry(7, 5, 10).translate(x, 39, za - 6));
      beacons.push(new THREE.SphereGeometry(0.4, 8, 6).translate(x, 49.8, zb));
    }
    this.add(merge(geos), red, true);
    this.add(merge(cab), dark, true);
    this.add(merge(beacons), this.craneLights);
  }

  private buildFloodLights(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: '#4a525e', metalness: 0.6, roughness: 0.4 });
    const geos: THREE.BufferGeometry[] = [];
    const heads: THREE.BufferGeometry[] = [];
    for (const t of LIGHT_TOWERS) {
      geos.push(new THREE.CylinderGeometry(0.35, 0.55, 22, 8).translate(t.x, 11, t.z), new THREE.BoxGeometry(4.2, 0.3, 1.2).translate(t.x, 22, t.z));
      for (const dx of [-1.5, 0, 1.5]) heads.push(new THREE.BoxGeometry(1, 0.8, 0.5).translate(t.x + dx, 22.6, t.z));
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2), this.poolMat);
      pool.position.set(t.x, 0.04, t.z);
      pool.renderOrder = 2;
      pool.visible = false;
      this.pools.push(pool);
      this.group.add(pool);
    }
    this.add(merge(geos), poleMat, true);
    this.add(merge(heads), this.floodMat);
  }
}

/** A vertical strip along a polyline on the terrain (guardrail beams), from y0 to y1 above it. */
function ribbonWall(pts: { x: number; z: number }[], y0: number, y1: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    const h = terrainHeight(p.x, p.z);
    pos.push(p.x, h + y0, p.z, p.x, h + y1, p.z);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

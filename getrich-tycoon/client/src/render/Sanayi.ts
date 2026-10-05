// The Sanayi industrial estate south of the city: a paved yard off the outer road, the garage hall
// (open to the north, its roof fading away while you are inside) with two yellow two-post lifts whose
// arms rise with the car on them, workbenches, tool chests and tyre stacks, and the Pawn Shop with
// its neon sign. Colliders come from shared/theft.ts (hall walls, Pawn Shop, lift posts).

import * as THREE from 'three';
import { LIFT_BAYS, LIFT_POST_X, SANAYI } from '../../../shared/theft';
import { mulberry32 } from '../../../shared/util';
import { batchStatic } from './batch';
import { Tex } from './Textures';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function box(mat: THREE.Material | THREE.Material[], sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function repeated(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

function plane(w: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

/** One lift: the carriages and arms that ride up the posts. */
interface Lift {
  carriage: THREE.Group;
  height: number;
}

export class SanayiView {
  readonly group = new THREE.Group();
  private roof = new THREE.Group();
  private roofMats: THREE.MeshStandardMaterial[] = [];
  private lifts: Lift[] = [];
  private neon: THREE.MeshStandardMaterial[] = [];
  private t = 0;

  constructor() {
    this.group.name = 'sanayi';
    const statics = new THREE.Group();
    this.group.add(statics);
    this.buildYard(statics);
    this.buildHall(statics);
    this.buildPawnShop(statics);
    this.buildLifts();
    this.group.add(this.roof);
    batchStatic(statics);
  }

  private buildYard(g: THREE.Group): void {
    const y = SANAYI.yard;
    const asphalt = new THREE.MeshStandardMaterial({ map: repeated(Tex.lot(), (y.maxX - y.minX) / 8, (y.maxZ - y.minZ) / 8), roughness: 0.95, color: '#8a8780' });
    g.add(plane(y.maxX - y.minX, y.maxZ - y.minZ, asphalt, (y.minX + y.maxX) / 2, 0.012, (y.minZ + y.maxZ) / 2));
    // Driveway from the outer road.
    const drive = new THREE.MeshStandardMaterial({ map: repeated(Tex.asphalt(), 2, 1), roughness: 0.95 });
    g.add(plane(SANAYI.entry.width, 8, drive, SANAYI.entry.x, 0.016, 160));
    // Oil stains.
    const stain = new THREE.MeshBasicMaterial({ color: '#1a1a1a', transparent: true, opacity: 0.35, depthWrite: false });
    const rng = mulberry32(911);
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.6 + rng() * 1.4, 12), stain);
      s.rotation.x = -Math.PI / 2;
      s.position.set(y.minX + 4 + rng() * (y.maxX - y.minX - 8), 0.02, y.minZ + 3 + rng() * (y.maxZ - y.minZ - 6));
      g.add(s);
    }
    // Low concrete kerb round the yard (open at the driveway), tyre stacks and oil drums.
    const kerb = new THREE.MeshStandardMaterial({ color: '#a9a69e', roughness: 0.9 });
    const k = 0.35;
    const gapA = SANAYI.entry.x - SANAYI.entry.width / 2;
    const gapB = SANAYI.entry.x + SANAYI.entry.width / 2;
    g.add(box(kerb, gapA - y.minX, k, 0.4, (y.minX + gapA) / 2, k / 2, 162.2, false));
    g.add(box(kerb, y.maxX - gapB, k, 0.4, (gapB + y.maxX) / 2, k / 2, 162.2, false));
    g.add(box(kerb, 0.4, k, y.maxZ - 162, y.minX, k / 2, (162 + y.maxZ) / 2, false));
    g.add(box(kerb, 0.4, k, y.maxZ - 162, y.maxX, k / 2, (162 + y.maxZ) / 2, false));
    g.add(box(kerb, y.maxX - y.minX, k, 0.4, (y.minX + y.maxX) / 2, k / 2, y.maxZ, false));
    const tyre = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.9 });
    const tyreGeo = new THREE.TorusGeometry(0.34, 0.14, 8, 16).rotateX(Math.PI / 2);
    for (const [x, z, n] of [
      [59, 203, 5],
      [60.4, 205, 3],
      [128, 205, 4],
      [150, 166, 4],
    ] as const) {
      for (let i = 0; i < n; i++) {
        const t = new THREE.Mesh(tyreGeo, tyre);
        t.position.set(x, 0.14 + i * 0.28, z);
        t.castShadow = true;
        g.add(t);
      }
    }
    const drumMats = ['#2d6a9f', '#b03a2e', '#2e7d32'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.5 }));
    const drumGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14);
    for (let i = 0; i < 7; i++) {
      const d = new THREE.Mesh(drumGeo, drumMats[i % 3]!);
      d.position.set(127 + (i % 4) * 0.7, 0.45, 166 + Math.floor(i / 4) * 0.7);
      d.castShadow = true;
      g.add(d);
    }
    // Pole sign at the driveway.
    const pole = new THREE.MeshStandardMaterial({ color: '#39404d', metalness: 0.6, roughness: 0.4 });
    const sx = gapB + 2.5;
    g.add(box(pole, 0.25, 6, 0.25, sx, 3, 163.5));
    const tex = Tex.sign('SANAYİ', { bg: '#1c140c', fg: '#ffc53d', accent: '#ff7a1a', sub: 'IZGARA GARAJI · PAWN SHOP', w: 768, h: 256 });
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.5 });
    this.neon.push(signMat);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.8, 0.2), [pole, pole, pole, pole, signMat, signMat]);
    sign.position.set(sx, 6.4, 163.5);
    sign.castShadow = true;
    g.add(sign);
  }

  private buildHall(g: THREE.Group): void {
    const hall = SANAYI.hall;
    const H = SANAYI.wallHeight;
    const w = hall.maxX - hall.minX;
    const d = hall.maxZ - hall.minZ;
    const cx = (hall.minX + hall.maxX) / 2;
    const cz = (hall.minZ + hall.maxZ) / 2;
    // Floor: sealed concrete with yellow bay lines.
    const floor = new THREE.MeshStandardMaterial({ map: repeated(Tex.concrete(), w / 6, d / 6), roughness: 0.75, color: '#a7a49c' });
    g.add(plane(w, d, floor, cx, 0.022, cz));
    const yellow = new THREE.MeshBasicMaterial({ color: '#f2c200' });
    for (const b of LIFT_BAYS) {
      for (const s of [-1, 1]) g.add(box(yellow, 0.14, 0.01, 7, b.x + s * 2.6, 0.03, b.z, false));
      g.add(box(yellow, 5.34, 0.01, 0.14, b.x, 0.03, b.z - 3.5, false));
    }
    // Walls: corrugated sheet on a brick plinth (the west, east and south sides; open to the north).
    const sheet = new THREE.MeshStandardMaterial({ map: corrugated(), color: '#8fa0ad', metalness: 0.35, roughness: 0.55 });
    const brick = new THREE.MeshStandardMaterial({ color: '#8d5a45', roughness: 0.9 });
    const walls: [number, number, number, number][] = [
      [hall.minX - 0.5, cz + 0.5, 1, d + 1],
      [hall.maxX + 0.5, cz + 0.5, 1, d + 1],
      [cx, hall.maxZ + 0.5, w + 2, 1],
    ];
    for (const [x, z, sx, sz] of walls) {
      g.add(box(brick, sx, 1.2, sz, x, 0.6, z));
      g.add(box(sheet, sx * 0.9, H - 1.2, sz * (sz > 1.5 ? 1 : 0.9), x, 1.2 + (H - 1.2) / 2, z));
    }
    // Front columns and the beam over the opening, with the sign.
    const steel = new THREE.MeshStandardMaterial({ color: '#2f3b4a', metalness: 0.6, roughness: 0.45 });
    g.add(box(steel, w + 2, 0.8, 0.5, cx, H - 0.4, hall.minZ));
    const tex = Tex.sign('SANAYİ · IZGARA GARAJI', { bg: '#141a24', fg: '#ffffff', accent: '#ffc53d', w: 1536, h: 192 });
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.4 });
    this.neon.push(signMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(22, 2.75), signMat);
    sign.position.set(cx, H + 1.1, hall.minZ - 0.3);
    sign.rotation.y = Math.PI;
    g.add(sign);
    g.add(box(steel, 22.4, 3, 0.2, cx, H + 1.1, hall.minZ - 0.15));
    // Workbenches, tool chests, a parts rack and the office desk.
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.45, metalness: 0.3 });
    const grey = new THREE.MeshStandardMaterial({ color: '#59626d', roughness: 0.6, metalness: 0.4 });
    for (const x of [72, 94, 116]) {
      g.add(box(wood, 4, 0.12, 1, x, 0.95, hall.maxZ - 0.9));
      g.add(box(grey, 3.8, 0.9, 0.9, x, 0.45, hall.maxZ - 0.9));
      g.add(box(grey, 4, 1.6, 0.06, x, 1.9, hall.maxZ - 0.15));
    }
    for (const x of [88, 100]) g.add(box(red, 1.4, 1.2, 0.7, x, 0.6, hall.maxZ - 1));
    for (let i = 0; i < 3; i++) g.add(box(grey, 0.08, 3, 0.6, hall.maxX - 0.5, 1.5, 176 + i * 2.2));
    for (let i = 0; i < 4; i++) g.add(box(grey, 0.6, 0.05, 6.6, hall.maxX - 0.5, 0.5 + i * 0.8, 178.2));
    g.add(box(wood, 2.2, 1, 0.9, hall.minX + 2.2, 0.5, hall.minZ + 2.5));
    const office = Tex.sign('OFİS', { bg: '#0f1626', fg: '#ffffff', accent: '#ffc53d', w: 512, h: 192 });
    const officeMat = new THREE.MeshStandardMaterial({ map: office, emissive: '#ffffff', emissiveMap: office, emissiveIntensity: 0.3 });
    this.neon.push(officeMat);
    const o = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), officeMat);
    o.position.set(hall.minX + 0.05, 3, hall.minZ + 4);
    o.rotation.y = Math.PI / 2;
    g.add(o);
    // Roof (not batched: it fades away while you are inside).
    const roofMat = new THREE.MeshStandardMaterial({ map: corrugated(), color: '#7d8a94', metalness: 0.3, roughness: 0.6, transparent: true, side: THREE.DoubleSide });
    this.roofMats.push(roofMat);
    const roof = box(roofMat, w + 2.4, 0.15, d + 1.6, cx, H + 0.08, cz + 0.3, false);
    this.roof.add(roof);
    const lightMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f1ff', emissiveIntensity: 1.2, transparent: true });
    this.roofMats.push(lightMat);
    for (const b of LIFT_BAYS) this.roof.add(box(lightMat, 0.3, 0.06, 5, b.x, H - 0.05, b.z, false));
  }

  private buildPawnShop(g: THREE.Group): void {
    const p = SANAYI.pawn;
    const w = p.maxX - p.minX;
    const d = p.maxZ - p.minZ;
    const cx = (p.minX + p.maxX) / 2;
    const cz = (p.minZ + p.maxZ) / 2;
    const h = 5.2;
    const win = Tex.windows('pawn', '#6b4a3a', '#1d2633', '#ffd27a', 4, 2);
    const side = new THREE.MeshStandardMaterial({ map: repeated(win, 1, 1), roughness: 0.8 });
    const roof = new THREE.MeshStandardMaterial({ color: '#3d3f44', roughness: 0.9 });
    g.add(box([side, side, roof, roof, side, side], w, h, d, cx, h / 2, cz));
    // Door, bars on the window, awning and the neon sign on the west front.
    const doorMat = new THREE.MeshStandardMaterial({ color: '#1b2433', roughness: 0.3, metalness: 0.6 });
    g.add(box(doorMat, 0.2, 2.6, 1.8, p.minX - 0.05, 1.3, cz));
    const bars = new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.8, roughness: 0.4 });
    for (const z of [cz - 4.5, cz + 4.5]) {
      g.add(box(new THREE.MeshStandardMaterial({ color: '#ffe3a1', emissive: '#ffcf6b', emissiveIntensity: 0.5 }), 0.06, 1.6, 3, p.minX - 0.04, 1.7, z, false));
      for (let i = -3; i <= 3; i++) g.add(box(bars, 0.06, 1.7, 0.05, p.minX - 0.1, 1.7, z + i * 0.45, false));
    }
    const awning = new THREE.MeshStandardMaterial({ color: '#7d1f2c', roughness: 0.7 });
    g.add(box(awning, 1.6, 0.12, 4.4, p.minX - 0.8, 3, cz));
    const tex = Tex.sign('PAWN SHOP', { bg: '#120812', fg: '#ff4fd8', accent: '#ffe14f', sub: 'REHİN · ALTIN · PARÇA', w: 1024, h: 256 });
    const neon = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.4 });
    this.neon.push(neon);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.75), neon);
    sign.position.set(p.minX - 0.12, h - 1.2, cz);
    sign.rotation.y = -Math.PI / 2;
    g.add(sign);
  }

  private buildLifts(): void {
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2b705', roughness: 0.45, metalness: 0.3 });
    const blue = new THREE.MeshStandardMaterial({ color: '#1f4e8c', roughness: 0.5, metalness: 0.4 });
    const pad = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
    for (const b of LIFT_BAYS) {
      const posts = new THREE.Group();
      for (const s of [-1, 1]) {
        posts.add(box(yellow, 0.36, 3.9, 0.36, b.x + s * LIFT_POST_X, 1.95, b.z));
        posts.add(box(blue, 0.6, 0.12, 0.6, b.x + s * LIFT_POST_X, 0.06, b.z));
      }
      // Overhead bar with the hydraulic line.
      posts.add(box(yellow, LIFT_POST_X * 2 + 0.36, 0.22, 0.3, b.x, 3.95, b.z));
      posts.add(box(blue, 0.3, 0.3, 0.3, b.x - LIFT_POST_X - 0.35, 0.6, b.z));
      this.group.add(posts);
      // Carriages with two arms each (swung under the car's sills, front and back).
      const carriage = new THREE.Group();
      for (const s of [-1, 1]) {
        carriage.add(box(blue, 0.5, 0.7, 0.5, b.x + s * LIFT_POST_X, 0.35, b.z));
        for (const f of [-1, 1]) {
          const arm = box(blue, 1.4, 0.1, 0.16, b.x + s * (LIFT_POST_X - 0.7), 0.1, b.z + f * 0.55);
          arm.rotation.y = s * f * 0.55;
          carriage.add(arm);
          carriage.add(box(pad, 0.22, 0.08, 0.22, b.x + s * 0.72, 0.18, b.z + f * 1.25));
        }
      }
      this.group.add(carriage);
      this.lifts.push({ carriage, height: 0 });
    }
  }

  /** Raise a lift's arms to a car on it (m). */
  setLift(bay: number, height: number): void {
    const l = this.lifts[bay];
    if (!l || Math.abs(l.height - height) < 1e-3) return;
    l.height = height;
    l.carriage.position.y = height;
  }

  /** Per frame: fade the roof while the player is inside the hall; signs glow at night. */
  update(dt: number, x: number, z: number, night: number): void {
    this.t += dt;
    const h = SANAYI.hall;
    const inside = x > h.minX - 1 && x < h.maxX + 1 && z > h.minZ - 2 && z < h.maxZ + 1;
    for (const m of this.roofMats) {
      const target = inside ? 0 : 1;
      m.opacity += (target - m.opacity) * Math.min(1, dt * 6);
      m.depthWrite = m.opacity > 0.98;
    }
    this.roof.visible = this.roofMats[0]!.opacity > 0.02;
    for (const m of this.neon) m.emissiveIntensity = 0.35 + night * 1.4 + (m === this.neon[this.neon.length - 1] ? Math.sin(this.t * 9) * 0.06 * night : 0);
  }
}

let corrugatedTex: THREE.CanvasTexture | null = null;

/** Corrugated metal sheet (vertical ribs). */
function corrugated(): THREE.Texture {
  if (corrugatedTex) return corrugatedTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 64; x++) {
    const v = 150 + Math.round(Math.sin((x / 64) * Math.PI * 8) * 40);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, 64);
  }
  corrugatedTex = new THREE.CanvasTexture(c);
  corrugatedTex.wrapS = corrugatedTex.wrapT = THREE.RepeatWrapping;
  corrugatedTex.repeat.set(6, 1);
  corrugatedTex.colorSpace = THREE.SRGBColorSpace;
  return corrugatedTex;
}

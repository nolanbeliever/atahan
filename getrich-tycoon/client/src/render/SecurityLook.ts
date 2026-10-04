// The security gear on a car's model (shared/security.ts): run-flat tyres get a yellow ring on the
// sidewall, armoured glass cracks (three levels of bullet stars that never break through), and in
// Chroma Customs' preview an "x-ray" shows what's fitted: the armour glowing in the glass and the
// doors, the hidden compartment under the boot floor, the run-flats lit up.

import * as THREE from 'three';
import type { VehicleMods } from '../../../shared/types';

// ------------------------------------------------------------------ cracked glass

const crackTex: THREE.Texture[] = [];

/** Bullet stars on the glass: a few at level 1, many at level 3 (tiles every ~0.8 m). */
function crackTexture(level: 1 | 2 | 3): THREE.Texture {
  const cached = crackTex[level];
  if (cached) return cached;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 7 + level * 31;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars = [2, 5, 10][level - 1]!;
  g.lineCap = 'round';
  for (let s = 0; s < stars; s++) {
    const cx = 40 + rnd() * (size - 80);
    const cy = 40 + rnd() * (size - 80);
    const r = 60 + rnd() * 70 + level * 12;
    // The bruise where the bullet stopped.
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 14);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, 14, 0, Math.PI * 2);
    g.fill();
    // Radial cracks, jagged.
    const spokes = 9 + Math.floor(rnd() * 6);
    g.strokeStyle = 'rgba(240,248,255,0.85)';
    for (let i = 0; i < spokes; i++) {
      let a = (i / spokes) * Math.PI * 2 + rnd() * 0.3;
      let x = cx;
      let y = cy;
      const len = r * (0.5 + rnd() * 0.6);
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, y);
      for (let d = 0; d < len; d += 10 + rnd() * 8) {
        a += (rnd() - 0.5) * 0.35;
        x = cx + Math.cos(a) * d;
        y = cy + Math.sin(a) * d;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Rings round the star, broken.
    g.lineWidth = 1.1;
    g.strokeStyle = 'rgba(240,248,255,0.6)';
    for (let k = 1; k <= 2; k++) {
      const rr = r * 0.25 * k + rnd() * 6;
      for (let i = 0; i < 6; i++) {
        const a0 = rnd() * Math.PI * 2;
        g.beginPath();
        g.arc(cx, cy, rr, a0, a0 + 0.4 + rnd() * 0.5);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  crackTex[level] = t;
  return t;
}

/** Projected texture coordinates for a glass mesh: side windows over (z, y), the screens over (x, y). */
const projected = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
function projectedGeometry(src: THREE.BufferGeometry, scale: number): THREE.BufferGeometry {
  const key = scale.toFixed(3);
  let byScale = projected.get(src);
  if (!byScale) projected.set(src, (byScale = new Map()));
  const hit = byScale.get(key);
  if (hit) return hit;
  const geo = src.clone();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position!;
  const nor = geo.attributes.normal!;
  const uv = new Float32Array(pos.count * 2);
  const density = 1.25 * scale;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const [u, v] = nx > ny && nx > nz ? [pos.getZ(i), pos.getY(i)] : ny > nz ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = u * density;
    uv[i * 2 + 1] = v * density;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  byScale.set(key, geo);
  return geo;
}

const isGlass = (mesh: THREE.Mesh): boolean => {
  const orig = (mesh.userData.orig as THREE.Material | undefined) ?? (mesh.material as THREE.Material);
  const name = `${mesh.name} ${Array.isArray(orig) ? '' : orig.name}`.toLowerCase();
  return /glass|window/.test(name) && !/light|lamp/.test(name) && !mesh.userData.secOverlay;
};

/** The meshes of the model's glass. */
function glassMeshes(model: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && isGlass(m)) out.push(m);
  });
  return out;
}

// ------------------------------------------------------------------ the gear on one view

const XRAY_ARMOR = new THREE.MeshBasicMaterial({ color: '#38d6ff', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
const XRAY_STASH = new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.28, depthWrite: false, depthTest: false });
const XRAY_STASH_EDGE = new THREE.LineBasicMaterial({ color: '#ffcf6b', depthTest: false, transparent: true });
const RING = new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.5, emissive: '#ffb300', emissiveIntensity: 0.15 });
const RING_XRAY = new THREE.MeshBasicMaterial({ color: '#ffe680', toneMapped: false });

export interface WheelLike {
  pivot: THREE.Object3D;
  spin: THREE.Object3D;
  left: boolean;
}

export class SecurityLook {
  private cracks: THREE.Mesh[] = [];
  private crackMat: THREE.MeshBasicMaterial | null = null;
  /** How cracked the glass is now (0-3). */
  level = 0;
  private rings: THREE.Mesh[] = [];
  private xrayParts: THREE.Object3D[] = [];
  xray = false;
  private mods: Pick<VehicleMods, 'stash' | 'runflat' | 'armor'> = {};

  constructor(private readonly owner: THREE.Object3D) {}

  /** After the model is (re)dressed: the run-flat rings, the cracks, the x-ray. */
  apply(model: THREE.Group, wheels: WheelLike[], mods: VehicleMods, info: { seatY: number; length: number; width: number; wheelR: number }, bike: boolean): void {
    this.mods = { stash: !!mods.stash, runflat: !!mods.runflat, armor: !!mods.armor };
    // Run-flat rings on the tyre sidewalls.
    for (const r of this.rings) r.removeFromParent();
    this.rings = [];
    if (mods.runflat) {
      const geo = ringGeometry(info.wheelR);
      for (const w of wheels) {
        const half = tyreHalfWidth(w);
        for (const side of bike ? [-1, 1] : [w.left ? 1 : -1]) {
          const ring = new THREE.Mesh(geo, this.xray ? RING_XRAY : RING);
          ring.rotation.y = Math.PI / 2;
          ring.position.x = side * (half + 0.004);
          ring.userData.secOverlay = true;
          w.pivot.add(ring);
          this.rings.push(ring);
        }
      }
    }
    // The glass may have new materials: fresh overlays.
    for (const c of this.cracks) c.removeFromParent();
    this.cracks = [];
    this.crackMat?.dispose();
    this.crackMat = null;
    this.setCracks(model, this.level, true);
    this.buildXray(model, info);
  }

  /** 0-3: how cracked the armoured glass is. */
  setCracks(model: THREE.Group | null, level: number, rebuild = false): void {
    if (level === this.level && !rebuild) return;
    this.level = level;
    if (!model) return;
    if (level <= 0) {
      for (const m of this.cracks) m.visible = false;
      return;
    }
    if (!this.crackMat) {
      this.crackMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.crackMat.name = 'crack_overlay';
    }
    this.crackMat.map = crackTexture(level as 1 | 2 | 3);
    this.crackMat.needsUpdate = true;
    if (this.cracks.length === 0) {
      model.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      for (const g of glassMeshes(model)) {
        g.getWorldScale(s);
        const ov = new THREE.Mesh(projectedGeometry(g.geometry, (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3), this.crackMat);
        ov.name = 'crack';
        ov.userData.secOverlay = true;
        g.add(ov);
        this.cracks.push(ov);
      }
    }
    for (const m of this.cracks) m.visible = true;
  }

  /** Chroma Customs' x-ray view of the gear. */
  setXray(model: THREE.Group | null, on: boolean, info: { seatY: number; length: number; width: number; wheelR: number } | null): void {
    if (on === this.xray) return;
    this.xray = on;
    for (const r of this.rings) r.material = on ? RING_XRAY : RING;
    if (model && info) this.buildXray(model, info);
  }

  private buildXray(model: THREE.Group, info: { seatY: number; length: number; width: number; wheelR: number }): void {
    for (const p of this.xrayParts) p.removeFromParent();
    this.xrayParts = [];
    if (!this.xray) return;
    if (this.mods.armor) {
      // The armour: the glass and the doors light up.
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.secOverlay) return;
        let door = false;
        for (let p: THREE.Object3D | null = m; p && p !== model; p = p.parent) if (/^door_f[lr]$/.test(p.name)) door = true;
        if (!door && !isGlass(m)) return;
        const ov = new THREE.Mesh(m.geometry, XRAY_ARMOR);
        ov.userData.secOverlay = true;
        m.add(ov);
        this.xrayParts.push(ov);
      });
    }
    if (this.mods.stash) {
      // The hidden compartment under the boot floor.
      const w = info.width * 0.58;
      const d = Math.min(0.75, info.length * 0.17);
      const h = 0.16;
      const geo = new THREE.BoxGeometry(w, h, d);
      const box = new THREE.Mesh(geo, XRAY_STASH);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), XRAY_STASH_EDGE);
      const g = new THREE.Group();
      g.add(box, edge);
      g.position.set(0, Math.max(0.32, info.seatY - 0.82), -info.length / 2 + d / 2 + 0.28);
      g.renderOrder = 10;
      box.renderOrder = edge.renderOrder = 10;
      g.userData.secOverlay = true;
      this.owner.add(g);
      this.xrayParts.push(g);
    }
  }

  dispose(): void {
    for (const p of [...this.xrayParts, ...this.rings, ...this.cracks]) p.removeFromParent();
    this.xrayParts = [];
    this.rings = [];
    this.cracks = [];
    this.crackMat?.dispose();
  }
}

const rings = new Map<number, THREE.TorusGeometry>();
function ringGeometry(wheelR: number): THREE.TorusGeometry {
  const key = Math.round(wheelR * 100);
  let g = rings.get(key);
  if (!g) rings.set(key, (g = new THREE.TorusGeometry(wheelR * 0.8, Math.max(0.008, wheelR * 0.035), 6, 32)));
  return g;
}

/** Half the tyre's width, in its pivot's frame. */
function tyreHalfWidth(w: WheelLike): number {
  w.pivot.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(w.pivot.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const m4 = new THREE.Matrix4();
  w.spin.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.secOverlay) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    tmp.copy(mesh.geometry.boundingBox!).applyMatrix4(m4.multiplyMatrices(inv, mesh.matrixWorld));
    box.union(tmp);
  });
  if (box.isEmpty()) return 0.11;
  return Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
}

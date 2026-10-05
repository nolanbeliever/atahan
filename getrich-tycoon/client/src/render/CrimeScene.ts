// Taped-off crime scenes on the client (shared/police.ts CrimeSceneView): orange traffic cones
// with the yellow-black "POLİS · GİRİLMEZ · CRIME SCENE · DO NOT CROSS" tape between them (sagging
// a little and stirring in the wind; a segment a car went through hangs loose from its cones), red
// road flares burning on the ground with a flickering glow, and the numbered yellow evidence
// markers with what lies there: brass shell casings, a dark blood stain, broken glass.

import * as THREE from 'three';
import type { CrimeSceneView, EvidenceKind } from '../../../shared/police';
import { surfaceY } from './City';
import { lightGlowTexture } from './Highway';

const TAPE_Y = 0.86;
const TAPE_H = 0.085;

let tapeTex: THREE.CanvasTexture | null = null;
/** The tape's print, repeated along it. */
function tapeTexture(): THREE.CanvasTexture {
  if (tapeTex) return tapeTex;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd400';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111';
  g.fillRect(0, 0, c.width, 5);
  g.fillRect(0, c.height - 5, c.width, 5);
  g.font = '900 25px system-ui, Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('POLİS · GİRİLMEZ  ✖  CRIME SCENE · DO NOT CROSS  ✖', 14, c.height / 2 + 1);
  tapeTex = new THREE.CanvasTexture(c);
  tapeTex.wrapS = THREE.RepeatWrapping;
  tapeTex.colorSpace = THREE.SRGBColorSpace;
  tapeTex.anisotropy = 4;
  return tapeTex;
}

const markerMats = new Map<number, THREE.MeshStandardMaterial>();
/** A yellow evidence tent's face with its number. */
function markerMaterial(n: number): THREE.MeshStandardMaterial {
  let m = markerMats.get(n);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffcc00';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#111';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 60, 60);
  g.fillStyle = '#111';
  g.font = '900 42px system-ui, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, side: THREE.DoubleSide, emissive: '#ffcc00', emissiveIntensity: 0.15 });
  markerMats.set(n, m);
  return m;
}

let shared: {
  cone: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
  base: THREE.BufferGeometry;
  coneMat: THREE.MeshStandardMaterial;
  bandMat: THREE.MeshStandardMaterial;
  baseMat: THREE.MeshStandardMaterial;
  tapeMat: THREE.MeshStandardMaterial;
  flare: THREE.BufferGeometry;
  flareMat: THREE.MeshStandardMaterial;
  tip: THREE.BufferGeometry;
  tipMat: THREE.MeshBasicMaterial;
  casing: THREE.BufferGeometry;
  brass: THREE.MeshStandardMaterial;
  blood: THREE.BufferGeometry;
  bloodMat: THREE.MeshStandardMaterial;
  shard: THREE.BufferGeometry;
  glassMat: THREE.MeshStandardMaterial;
  tent: THREE.BufferGeometry;
} | null = null;

function kit(): NonNullable<typeof shared> {
  if (shared) return shared;
  const tape = tapeTexture();
  shared = {
    cone: new THREE.ConeGeometry(0.2, 0.72, 14, 1, true).translate(0, 0.4, 0),
    band: new THREE.CylinderGeometry(0.115, 0.15, 0.13, 14, 1, true).translate(0, 0.46, 0),
    base: new THREE.BoxGeometry(0.46, 0.04, 0.46).translate(0, 0.02, 0),
    coneMat: new THREE.MeshStandardMaterial({ color: '#ff5a0a', roughness: 0.55, emissive: '#ff3c00', emissiveIntensity: 0.12 }),
    bandMat: new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.25, metalness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.18 }),
    baseMat: new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.9 }),
    tapeMat: new THREE.MeshStandardMaterial({ map: tape, emissiveMap: tape, emissive: '#ffffff', emissiveIntensity: 0.22, roughness: 0.55, side: THREE.DoubleSide }),
    flare: new THREE.CylinderGeometry(0.022, 0.022, 0.24, 8).rotateZ(Math.PI / 2).translate(0, 0.025, 0),
    flareMat: new THREE.MeshStandardMaterial({ color: '#b3121a', roughness: 0.6 }),
    tip: new THREE.SphereGeometry(0.035, 8, 6).translate(0.13, 0.03, 0),
    tipMat: new THREE.MeshBasicMaterial({ color: '#ff5040', toneMapped: false }),
    casing: new THREE.CylinderGeometry(0.0065, 0.0065, 0.026, 6).rotateZ(Math.PI / 2).translate(0, 0.007, 0),
    brass: new THREE.MeshStandardMaterial({ color: '#c9a03a', metalness: 0.9, roughness: 0.3 }),
    blood: new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
    bloodMat: new THREE.MeshStandardMaterial({ color: '#4a0306', roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, transparent: true, opacity: 0.92 }),
    shard: new THREE.PlaneGeometry(0.06, 0.04).rotateX(-Math.PI / 2),
    glassMat: new THREE.MeshStandardMaterial({ color: '#cfe8ff', metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
    tent: new THREE.PlaneGeometry(0.15, 0.13),
  };
  return shared;
}

/**
 * A strip of tape from a to b: `ya` / `yb` heights at the ends, sagging `sag` m in the middle
 * (local to the scene group's origin).
 */
function ribbon(ax: number, az: number, ya: number, bx: number, bz: number, yb: number, sag: number, mat: THREE.Material): THREE.Mesh {
  const n = 10;
  const len = Math.hypot(bx - ax, bz - az, yb - ya);
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const y = ya + (yb - ya) * t - sag * Math.sin(Math.PI * t);
    pos.set([x, y + TAPE_H / 2, z, x, y - TAPE_H / 2, z], i * 6);
    const u = (t * len) / 2.6;
    uv.set([u, 1, u, 0], i * 4);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  return m;
}

interface Built {
  view: CrimeSceneView;
  group: THREE.Group;
  tape: THREE.Mesh[];
  flares: THREE.Sprite[];
}

export class CrimeScenes {
  private scenes = new Map<number, Built>();
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {}

  /** A scene went up (or changed: a segment of tape broke). */
  apply(v: CrimeSceneView): void {
    this.remove(v.id);
    const k = kit();
    const group = new THREE.Group();
    const y0 = surfaceY(v.x, v.z, v.deck);
    group.position.set(v.x, y0, v.z);
    const local = (x: number, z: number): [number, number, number] => [x - v.x, surfaceY(x, z, v.deck) - y0, z - v.z];
    // Cones.
    for (const [px, pz] of v.posts) {
      const [lx, ly, lz] = local(px, pz);
      for (const [geo, mat] of [
        [k.cone, k.coneMat],
        [k.band, k.bandMat],
        [k.base, k.baseMat],
      ] as const) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(lx, ly, lz);
        m.castShadow = geo !== k.base;
        group.add(m);
      }
    }
    // The tape: cone to cone (not through a wall); a broken segment hangs from both cones.
    const tape: THREE.Mesh[] = [];
    const broken = new Set(v.broken ?? []);
    const n = v.posts.length;
    for (let i = 0; i < n; i++) {
      if (v.gaps.includes(i)) continue;
      const [ax, ay, az] = local(...v.posts[i]!);
      const [bx, by, bz] = local(...v.posts[(i + 1) % n]!);
      if (broken.has(i)) {
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        tape.push(ribbon(ax, az, ay + TAPE_Y, ax + (mx - ax) * 0.55, az + (mz - az) * 0.55, ay + 0.06, 0.05, k.tapeMat));
        tape.push(ribbon(bx, bz, by + TAPE_Y, bx + (mx - bx) * 0.55, bz + (mz - bz) * 0.55, by + 0.06, 0.05, k.tapeMat));
      } else {
        const len = Math.hypot(bx - ax, bz - az);
        tape.push(ribbon(ax, az, ay + TAPE_Y, bx, bz, by + TAPE_Y, Math.min(0.16, len * 0.025), k.tapeMat));
      }
    }
    for (const t of tape) group.add(t);
    // Road flares.
    const flares: THREE.Sprite[] = [];
    v.flares.forEach(([fx, fz], i) => {
      const [lx, ly, lz] = local(fx, fz);
      const body = new THREE.Mesh(k.flare, k.flareMat);
      const tip = new THREE.Mesh(k.tip, k.tipMat);
      for (const m of [body, tip]) {
        m.position.set(lx, ly, lz);
        m.rotation.y = i * 1.7;
        group.add(m);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: '#ff3020', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
      glow.position.set(lx + Math.cos(i * 1.7) * 0.13, ly + 0.08, lz - Math.sin(i * 1.7) * 0.13);
      glow.scale.setScalar(1.3);
      group.add(glow);
      flares.push(glow);
    });
    // Evidence: a numbered tent beside each, and what lies there.
    v.evidence.forEach(([ex, ez, kind], i) => {
      const [lx, ly, lz] = local(ex, ez);
      this.evidence(group, kind, lx, ly, lz, i);
      const tex = markerMaterial(i + 1);
      const yaw = i * 2.1;
      for (const s of [1, -1]) {
        const p = new THREE.Mesh(k.tent, tex);
        p.position.set(lx + 0.32 + Math.sin(yaw) * 0.035 * s, ly + 0.06, lz + 0.2 + Math.cos(yaw) * 0.035 * s);
        p.rotation.set(0, yaw, 0);
        p.rotateX(0.42 * s);
        if (s < 0) p.rotateY(Math.PI);
        group.add(p);
      }
    });
    this.scene.add(group);
    this.scenes.set(v.id, { view: v, group, tape, flares });
  }

  /** What lies at an evidence marker. */
  private evidence(group: THREE.Group, kind: EvidenceKind, x: number, y: number, z: number, seed: number): void {
    const k = kit();
    const rnd = (i: number) => ((Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
    if (kind === 'casing') {
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(k.casing, k.brass);
        m.position.set(x + (rnd(i) - 0.5) * 0.5, y, z + (rnd(i + 9) - 0.5) * 0.5);
        m.rotation.y = rnd(i + 3) * Math.PI * 2;
        group.add(m);
      }
    } else if (kind === 'blood') {
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(k.blood, k.bloodMat);
        const r = i === 0 ? 0.42 : 0.12 + rnd(i) * 0.1;
        m.scale.set(r * (1 + rnd(i + 4) * 0.4), 1, r);
        m.position.set(x + (i ? (rnd(i + 2) - 0.5) * 1.1 : 0), y + 0.012, z + (i ? (rnd(i + 6) - 0.5) * 1.1 : 0));
        m.rotation.y = rnd(i + 1) * Math.PI;
        group.add(m);
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(k.shard, k.glassMat);
        const a = rnd(i) * Math.PI * 2;
        const d = rnd(i + 20) * 0.7;
        m.position.set(x + Math.cos(a) * d, y + 0.01, z + Math.sin(a) * d);
        m.rotation.y = rnd(i + 5) * Math.PI;
        m.scale.setScalar(0.6 + rnd(i + 8) * 1.2);
        group.add(m);
      }
    }
  }

  remove(id: number): void {
    const s = this.scenes.get(id);
    if (!s) return;
    s.group.removeFromParent();
    s.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (s.tape.includes(m)) m.geometry.dispose();
      if ((o as THREE.Sprite).isSprite) ((o as THREE.Sprite).material as THREE.SpriteMaterial).dispose();
    });
    this.scenes.delete(id);
  }

  /** Flares flicker, the tape stirs. */
  update(dt: number, night: number): void {
    this.time += dt;
    const t = this.time;
    for (const s of this.scenes.values()) {
      s.flares.forEach((f, i) => {
        const flick = 0.75 + 0.25 * Math.sin(t * 23 + i * 3.1) * Math.sin(t * 9.7 + i);
        (f.material as THREE.SpriteMaterial).opacity = (0.55 + night * 0.4) * flick;
        f.scale.setScalar((1.1 + night * 1.4) * (0.9 + 0.15 * flick));
      });
      s.tape.forEach((m, i) => {
        m.position.y = Math.sin(t * 2.6 + i * 1.3) * 0.012;
      });
    }
  }

  /** Scenes up now (the map). */
  list(): CrimeSceneView[] {
    return [...this.scenes.values()].map((s) => s.view);
  }

  clear(): void {
    for (const id of [...this.scenes.keys()]) this.remove(id);
  }
}

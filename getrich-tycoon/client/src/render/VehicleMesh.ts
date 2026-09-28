// Procedural, original vehicle models built from extruded side profiles.

import * as THREE from 'three';
import { findOption, vehicleColor } from '../../../shared/customization';
import type { VehicleCondition, VehicleMods } from '../../../shared/types';
import { getModel, type BodyStyle, type VehicleShape } from '../../../shared/vehicles';
import { batchStatic } from './batch';
import { Tex } from './Textures';

export interface VehicleLook {
  modelId: string;
  color: string;
  mods: VehicleMods;
  condition: VehicleCondition;
}

interface StyleParams {
  rearSlope: number;
  frontSlope: number;
  hoodDrop: number;
  noseHeight: number;
  tailHeight: number;
}

const STYLE: Record<BodyStyle, StyleParams> = {
  hatch: { rearSlope: 0.18, frontSlope: 0.55, hoodDrop: 0.1, noseHeight: 0.55, tailHeight: 0.85 },
  sedan: { rearSlope: 0.5, frontSlope: 0.65, hoodDrop: 0.08, noseHeight: 0.55, tailHeight: 0.9 },
  coupe: { rearSlope: 0.75, frontSlope: 0.75, hoodDrop: 0.14, noseHeight: 0.45, tailHeight: 0.85 },
  suv: { rearSlope: 0.12, frontSlope: 0.42, hoodDrop: 0.06, noseHeight: 0.7, tailHeight: 0.95 },
  pickup: { rearSlope: 0.08, frontSlope: 0.38, hoodDrop: 0.05, noseHeight: 0.75, tailHeight: 1.0 },
  van: { rearSlope: 0.04, frontSlope: 0.55, hoodDrop: 0.1, noseHeight: 0.7, tailHeight: 1.0 },
  classic: { rearSlope: 0.35, frontSlope: 0.45, hoodDrop: 0.05, noseHeight: 0.6, tailHeight: 0.95 },
  wagon: { rearSlope: 0.1, frontSlope: 0.6, hoodDrop: 0.08, noseHeight: 0.55, tailHeight: 0.9 },
};

interface Geoms {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  cabinTop: { z0: number; z1: number; y: number; width: number; c0: number; c1: number };
  hb: number;
}

const geomCache = new Map<string, Geoms>();

/** Extrude a side profile (s = along length, y = up) across the width, mapped to local vehicle axes (+z forward). */
function extrudeProfile(points: [number, number][], width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([s, y]) => new THREE.Vector2(s, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, width - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2); // shape x -> +z (forward), extrusion -> x
  geo.computeVertexNormals();
  return geo;
}

function remapUv(geo: THREE.BufferGeometry, length: number, y0: number, height: number): void {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getZ(i) / length + 0.5) * 2 + pos.getX(i) * 0.3;
    uv[i * 2 + 1] = (pos.getY(i) - y0) / height;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function buildGeoms(modelId: string): Geoms {
  const hit = geomCache.get(modelId);
  if (hit) return hit;
  const sh: VehicleShape = getModel(modelId).shape;
  const st = STYLE[sh.style];
  const L = sh.length;
  const h0 = sh.rideHeight;
  const hb = h0 + sh.bodyHeight;
  const bh = sh.bodyHeight;
  const half = L / 2;
  const cabinLen = sh.cabinLength * L;
  const cc = sh.cabinOffset * L;
  const c0 = cc - cabinLen / 2;
  const c1 = cc + cabinLen / 2;

  const body: [number, number][] = [
    [-half + 0.08, h0],
    [-half, h0 + bh * 0.35],
    [-half, h0 + bh * st.tailHeight - 0.05],
    [-half + 0.12, hb],
    [c1, hb],
    [half - 0.45, hb - st.hoodDrop],
    [half - 0.08, h0 + bh * st.noseHeight],
    [half, h0 + bh * 0.3],
    [half - 0.1, h0],
  ];
  const bodyGeo = extrudeProfile(body, sh.width, 0.06);
  remapUv(bodyGeo, L, h0, bh + sh.cabinHeight);

  const ch = sh.cabinHeight;
  const rs = st.rearSlope * ch;
  const fs = st.frontSlope * ch;
  const cabin: [number, number][] = [
    [c0, hb - 0.01],
    [c0 + rs, hb + ch],
    [c1 - fs, hb + ch],
    [c1, hb - 0.01],
  ];
  const cabinWidth = sh.width * (1 - sh.cabinTaper);
  const cabinGeo = extrudeProfile(cabin, cabinWidth, 0.04);
  const g: Geoms = {
    body: bodyGeo,
    cabin: cabinGeo,
    cabinTop: { z0: c0 + rs, z1: c1 - fs, y: hb + ch, width: cabinWidth, c0, c1 },
    hb,
  };
  geomCache.set(modelId, g);
  return g;
}

const RIM_COLORS: Record<string, { color: string; metal: number; rough: number }> = {
  stock: { color: '#8d939b', metal: 0.6, rough: 0.45 },
  sport: { color: '#d7dbe0', metal: 0.85, rough: 0.25 },
  chrome: { color: '#f2f5f8', metal: 1, rough: 0.08 },
  black: { color: '#1b1c1f', metal: 0.5, rough: 0.35 },
  gold: { color: '#d4a017', metal: 1, rough: 0.2 },
};

const tireMat = new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.92 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.7 });
const chromeMat = new THREE.MeshStandardMaterial({ color: '#e8ecf0', metalness: 1, roughness: 0.12 });
const tailMat = new THREE.MeshStandardMaterial({ color: '#ff2a3a', emissive: '#ff1a2a', emissiveIntensity: 0.7 });
const tireGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
tireGeo.rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.04, 12);
rimGeo.rotateZ(Math.PI / 2);
const spokeGeo = new THREE.BoxGeometry(1.06, 0.1, 1.1);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function box(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export interface WheelRef {
  steer: THREE.Group;
  spin: THREE.Group;
  front: boolean;
}

export function lookSignature(v: VehicleLook): string {
  return [v.modelId, v.color, JSON.stringify(v.mods), Math.round(v.condition.cleanliness / 8), Math.round(v.condition.body / 15)].join('|');
}

/** A complete vehicle object with wheel animation support. */
export class VehicleView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private wheels: WheelRef[] = [];
  private mats: THREE.Material[] = [];
  private wheelSpin = 0;
  signature = '';
  readonly length: number;
  readonly width: number;
  readonly height: number;

  constructor(look: VehicleLook) {
    const shape = getModel(look.modelId).shape;
    this.length = shape.length;
    this.width = shape.width;
    this.height = shape.rideHeight + shape.bodyHeight + shape.cabinHeight;
    this.root.add(this.body);
    this.build(look);
  }

  update(look: VehicleLook): void {
    const sig = lookSignature(look);
    if (sig === this.signature) return;
    this.clear();
    this.build(look);
  }

  private clear(): void {
    this.body.clear();
    this.wheels = [];
    for (const m of this.mats) m.dispose();
    this.mats = [];
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private build(look: VehicleLook): void {
    this.signature = lookSignature(look);
    const model = getModel(look.modelId);
    const sh = model.shape;
    const g = buildGeoms(look.modelId);
    const dirt = 1 - Math.max(0, Math.min(100, look.condition.cleanliness)) / 100;
    const damage = Math.max(0, (45 - look.condition.body) / 45);
    const paint = new THREE.Color(vehicleColor(look.color, look.mods));
    const mud = new THREE.Color('#6b5236');
    paint.lerp(mud, dirt * 0.35).multiplyScalar(1 - damage * 0.25);
    const bodyMat = this.mat(
      new THREE.MeshStandardMaterial({ color: paint, metalness: 0.5 - dirt * 0.35, roughness: 0.3 + dirt * 0.55 + damage * 0.1, envMapIntensity: 1.1 }),
    );
    const tint = Number(findOption(look.mods.tint)?.value ?? '0.25');
    const glassMat = this.mat(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#1c2635').lerp(new THREE.Color('#05070b'), tint),
        metalness: 0.9,
        roughness: 0.08,
        transparent: true,
        opacity: 0.55 + tint * 0.43,
        envMapIntensity: 1.6,
      }),
    );
    const headColor = findOption(look.mods.headlights)?.value ?? '#fff4d6';
    const headMat = this.mat(new THREE.MeshStandardMaterial({ color: headColor, emissive: headColor, emissiveIntensity: 0.9 }));

    const bodyMesh = new THREE.Mesh(g.body, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.body.add(bodyMesh);
    if (dirt > 0.12) {
      const dirtMat = this.mat(
        new THREE.MeshStandardMaterial({
          map: Tex.dirt(),
          transparent: true,
          opacity: Math.min(1, dirt * 1.15),
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          roughness: 1,
        }),
      );
      const dirtMesh = new THREE.Mesh(g.body, dirtMat);
      dirtMesh.scale.setScalar(1.004);
      this.body.add(dirtMesh);
    }

    const isVan = sh.style === 'van';
    const cabin = new THREE.Mesh(g.cabin, isVan ? bodyMat : glassMat);
    cabin.castShadow = true;
    this.body.add(cabin);
    const top = g.cabinTop;
    // Painted roof
    this.body.add(box(bodyMat, top.width + 0.02, 0.07, Math.max(0.2, top.z1 - top.z0), 0, top.y + 0.01, (top.z0 + top.z1) / 2));
    // B pillar
    if (!isVan) this.body.add(box(bodyMat, top.width + 0.03, top.y - g.hb, 0.12, 0, (top.y + g.hb) / 2, (top.c0 + top.c1) / 2 - 0.05));
    if (isVan) {
      // Windshield and front side windows on the van box
      const wz = top.c1 - 0.05;
      const wy = (g.hb + top.y) / 2 + 0.05;
      this.body.add(box(glassMat, top.width + 0.02, (top.y - g.hb) * 0.6, 0.6, 0, wy, wz - 0.45));
      const front = box(glassMat, top.width * 0.92, (top.y - g.hb) * 0.62, 0.05, 0, wy, top.c1 - 0.02);
      this.body.add(front);
    }

    const half = sh.length / 2;
    const W = sh.width;
    const h0 = sh.rideHeight;
    const hb = g.hb;
    // Lights
    for (const s of [-1, 1]) {
      this.body.add(box(headMat, W * 0.22, 0.11, 0.06, s * W * 0.3, h0 + sh.bodyHeight * 0.68, half - 0.06));
      const tl = box(tailMat, W * 0.2, 0.1, 0.05, s * W * 0.32, h0 + sh.bodyHeight * 0.72, -half + 0.03);
      this.body.add(tl);
    }
    // Grille / bumpers
    this.body.add(box(darkMat, W * 0.5, 0.14, 0.05, 0, h0 + sh.bodyHeight * 0.42, half - 0.03));
    if (sh.style === 'classic') {
      this.body.add(box(chromeMat, W * 0.96, 0.1, 0.12, 0, h0 + 0.12, half - 0.02));
      this.body.add(box(chromeMat, W * 0.96, 0.1, 0.12, 0, h0 + 0.12, -half + 0.02));
      for (const s of [-1, 1]) {
        const fin = box(bodyMat, 0.08, 0.22, 0.9, s * (W / 2 - 0.12), hb + 0.08, -half + 0.55);
        fin.rotation.x = -0.18;
        this.body.add(fin);
      }
    } else {
      this.body.add(box(darkMat, W * 0.98, 0.16, 0.14, 0, h0 + 0.1, half - 0.04));
      this.body.add(box(darkMat, W * 0.98, 0.16, 0.14, 0, h0 + 0.1, -half + 0.04));
    }
    // Pickup bed
    if (sh.style === 'pickup') {
      const bedStart = -half + 0.1;
      const bedEnd = top.c0 - 0.05;
      const bedLen = bedEnd - bedStart;
      this.body.add(box(darkMat, W * 0.86, 0.04, bedLen, 0, hb + 0.01, bedStart + bedLen / 2));
      for (const s of [-1, 1]) this.body.add(box(bodyMat, 0.08, 0.3, bedLen, s * (W / 2 - 0.06), hb + 0.14, bedStart + bedLen / 2));
      this.body.add(box(bodyMat, W, 0.3, 0.08, 0, hb + 0.14, bedStart));
    }

    this.addMods(look.mods, bodyMat, headMat, g, sh);
    batchStatic(this.body);
    this.addWheels(sh, look.mods.wheels);
  }

  private addMods(mods: VehicleMods, bodyMat: THREE.Material, headMat: THREE.Material, g: Geoms, sh: VehicleShape): void {
    const kit = findOption(mods.bodyKit)?.value ?? 'none';
    const acc = findOption(mods.accessory)?.value ?? 'none';
    const half = sh.length / 2;
    const W = sh.width;
    const top = g.cabinTop;
    if (kit === 'lip' || kit === 'full') {
      this.body.add(box(darkMat, W * 0.95, 0.05, 0.3, 0, sh.rideHeight - 0.02, half - 0.12));
      for (const s of [-1, 1]) this.body.add(box(darkMat, 0.08, 0.1, sh.length * 0.55, s * (W / 2 + 0.01), sh.rideHeight + 0.02, 0));
    }
    if (kit === 'spoiler' || kit === 'full') {
      const wingY = g.hb + 0.34;
      const wingZ = -half + 0.28;
      for (const s of [-1, 1]) this.body.add(box(darkMat, 0.06, 0.34, 0.1, s * W * 0.32, g.hb + 0.17, wingZ));
      this.body.add(box(bodyMat, W * 0.95, 0.05, 0.36, 0, wingY, wingZ));
    }
    if (kit === 'full') {
      for (const s of [-1, 1]) for (const zz of [-1, 1]) this.body.add(box(bodyMat, 0.12, 0.18, 0.9, s * (W / 2 + 0.03), sh.rideHeight + sh.wheelRadius + 0.05, zz * sh.length * 0.31));
    }
    if (acc === 'roofrack') {
      for (const s of [-1, 1]) this.body.add(box(darkMat, 0.05, 0.08, top.z1 - top.z0, s * top.width * 0.4, top.y + 0.09, (top.z0 + top.z1) / 2));
      for (let i = 0; i < 3; i++) this.body.add(box(darkMat, top.width * 0.85, 0.04, 0.05, 0, top.y + 0.13, top.z0 + ((top.z1 - top.z0) * (i + 0.5)) / 3));
    } else if (acc === 'bullbar') {
      const y = sh.rideHeight + sh.bodyHeight * 0.45;
      this.body.add(box(chromeMat, W * 0.7, 0.07, 0.07, 0, y + 0.25, half + 0.12));
      this.body.add(box(chromeMat, W * 0.7, 0.07, 0.07, 0, y - 0.1, half + 0.12));
      for (const s of [-1, 1]) this.body.add(box(chromeMat, 0.07, 0.45, 0.07, s * W * 0.3, y + 0.08, half + 0.12));
    } else if (acc === 'stripes') {
      const stripe = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.4 });
      this.mats.push(stripe);
      for (const s of [-1, 1]) {
        this.body.add(box(stripe, 0.16, 0.012, sh.length * 0.32, s * 0.14, g.hb - 0.02 + 0.012, half - sh.length * 0.18));
        this.body.add(box(stripe, 0.16, 0.012, Math.max(0.2, top.z1 - top.z0), s * 0.14, top.y + 0.055, (top.z0 + top.z1) / 2));
      }
    } else if (acc === 'lightbar') {
      this.body.add(box(headMat, top.width * 0.8, 0.09, 0.1, 0, top.y + 0.1, top.z1 - 0.1));
    }
  }

  private addWheels(sh: VehicleShape, wheelId: string): void {
    const style = findOption(wheelId)?.value ?? 'stock';
    const rc = RIM_COLORS[style] ?? RIM_COLORS.stock!;
    const rimMat = this.mat(new THREE.MeshStandardMaterial({ color: rc.color, metalness: rc.metal, roughness: rc.rough }));
    const wb = sh.length * 0.62;
    const r = sh.wheelRadius;
    const x = sh.width / 2 - sh.wheelWidth / 2 + 0.03;
    for (const [sx, sz] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ] as const) {
      const steer = new THREE.Group();
      steer.position.set(sx * x, r, (sz * wb) / 2);
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.scale.set(sh.wheelWidth, r, r);
      tire.castShadow = true;
      spin.add(tire);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.scale.set(sh.wheelWidth, r, r);
      spin.add(rim);
      if (style !== 'stock') {
        for (let i = 0; i < 3; i++) {
          const spoke = new THREE.Mesh(spokeGeo, rimMat);
          spoke.scale.set(sh.wheelWidth, r * 1.1, r * 0.12);
          spoke.rotation.x = (i * Math.PI) / 3;
          spin.add(spoke);
        }
      }
      steer.add(spin);
      this.body.add(steer);
      this.wheels.push({ steer, spin, front: sz > 0 });
    }
  }

  /** Animate wheels (spin by speed m/s, steering angle rad). */
  animate(speed: number, steer: number, dt: number): void {
    const r = this.wheels.length ? getWheelRadius(this) : 0.33;
    this.wheelSpin += (speed / r) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.steer.rotation.y = steer;
    }
    // Subtle body roll / pitch
    this.body.rotation.z = -steer * Math.min(1, Math.abs(speed) / 20) * 0.05;
  }

  dispose(): void {
    this.clear();
  }
}

function getWheelRadius(v: VehicleView): number {
  return Math.max(0.2, v.height * 0.2);
}

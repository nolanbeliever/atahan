// Vehicles: the procedural body from carBody.ts dressed with per-vehicle paint, glass tint, lamps,
// wheels, dirt, damage and customization parts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { findOption, vehicleColor } from '../../../shared/customization';
import type { VehicleCondition, VehicleMods } from '../../../shared/types';
import { getModel } from '../../../shared/vehicles';
import { batchStatic } from './batch';
import { carBody, rimGeometry, tireGeometry, type CarBody, type Part } from './carBody';
import type { RimStyle } from './carDesigns';
import { Tex } from './Textures';

export interface VehicleLook {
  modelId: string;
  color: string;
  mods: VehicleMods;
  condition: VehicleCondition;
}

interface Finish {
  color: string;
  metal: number;
  rough: number;
}

/** Wheel upgrades from the customization shop. */
const RIM_MODS: Record<string, { style: RimStyle; finish: Finish }> = {
  sport: { style: 'multi', finish: { color: '#d7dbe0', metal: 0.85, rough: 0.25 } },
  chrome: { style: 'five', finish: { color: '#f2f5f8', metal: 1, rough: 0.08 } },
  black: { style: 'five', finish: { color: '#1b1c1f', metal: 0.5, rough: 0.35 } },
  gold: { style: 'multi', finish: { color: '#d4a017', metal: 1, rough: 0.2 } },
};

/** Factory wheels per rim design. */
const STOCK_FINISH: Record<RimStyle, Finish> = {
  five: { color: '#b9bec5', metal: 0.8, rough: 0.3 },
  multi: { color: '#c9ced4', metal: 0.85, rough: 0.25 },
  aero: { color: '#d9dde2', metal: 0.55, rough: 0.3 },
  hubcap: { color: '#eef2f5', metal: 1, rough: 0.1 },
  wire: { color: '#e6eaee', metal: 1, rough: 0.15 },
  steel: { color: '#2b2e33', metal: 0.4, rough: 0.5 },
};

const tireMat = new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.9 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#141619', roughness: 0.65, side: THREE.DoubleSide });
/** Dark trim, interior and plates: colours come from the geometry. */
const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
const chromeMat = new THREE.MeshStandardMaterial({ color: '#f1f4f7', metalness: 1, roughness: 0.16, envMapIntensity: 1.6 });
const glossBlack = new THREE.MeshStandardMaterial({ color: '#0c0d10', metalness: 0.4, roughness: 0.2 });
const whitewallMat = new THREE.MeshStandardMaterial({ color: '#f3f1ea', roughness: 0.7 });
const stripeMat = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.4 });
const ringGeo = new THREE.RingGeometry(0.66, 0.84, 32).rotateY(Math.PI / 2);

export interface WheelRef {
  steer: THREE.Group;
  spin: THREE.Group;
  front: boolean;
}

/** Seconds a vehicle must stand still before its wheels are merged back into a static mesh. */
const WHEEL_MERGE_DELAY = 3;

export function lookSignature(v: VehicleLook): string {
  return [v.modelId, v.color, JSON.stringify(v.mods), Math.round(v.condition.cleanliness / 8), Math.round(v.condition.body / 15)].join('|');
}

/** A complete vehicle object with wheel animation support. */
export class VehicleView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private wheels: WheelRef[] = [];
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private wheelSpin = 0;
  /** Parked vehicles draw their four wheels as a couple of merged meshes; moving ones animate them. */
  private readonly wheelRoot = new THREE.Group();
  private wheelGeos: THREE.BufferGeometry[] = [];
  private animated = false;
  private still = 0;
  private rimMat: THREE.Material | null = null;
  private rimStyle: RimStyle = 'five';
  signature = '';
  readonly length: number;
  readonly width: number;
  readonly height: number;
  private readonly car: CarBody;

  constructor(look: VehicleLook) {
    const shape = getModel(look.modelId).shape;
    this.car = carBody(look.modelId);
    this.length = shape.length;
    this.width = shape.width;
    this.height = this.car.height;
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
    this.clearWheels();
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    this.mats = [];
    this.geos = [];
  }

  private clearWheels(): void {
    this.wheelRoot.clear();
    this.wheels = [];
    for (const g of this.wheelGeos) g.dispose();
    this.wheelGeos = [];
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private build(look: VehicleLook): void {
    this.signature = lookSignature(look);
    const car = this.car;
    const d = car.d;
    const dirt = 1 - Math.max(0, Math.min(100, look.condition.cleanliness)) / 100;
    const damage = Math.max(0, (45 - look.condition.body) / 45);
    const base = new THREE.Color(vehicleColor(look.color, look.mods));
    const paint = base.clone().lerp(new THREE.Color('#6b5236'), dirt * 0.35).multiplyScalar(1 - damage * 0.25);
    const paintMat = this.mat(
      new THREE.MeshStandardMaterial({ color: paint, metalness: 0.55 - dirt * 0.35, roughness: 0.26 + dirt * 0.55 + damage * 0.1, envMapIntensity: 1.2 }),
    );
    const light = base.r * 0.3 + base.g * 0.59 + base.b * 0.11 > 0.7;
    const roofMat =
      d.roof === 'black' ? glossBlack : d.roof === 'contrast' ? this.mat(new THREE.MeshStandardMaterial({ color: light ? '#111215' : '#f3f3ef', metalness: 0.3, roughness: 0.3 })) : paintMat;
    const tint = Number(findOption(look.mods.tint)?.value ?? '0.25');
    const glassMat = this.mat(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#1c2635').lerp(new THREE.Color('#05070b'), tint),
        metalness: 0.9,
        roughness: 0.06,
        transparent: true,
        opacity: 0.74 + tint * 0.25,
        envMapIntensity: 1.7,
      }),
    );
    const headColor = findOption(look.mods.headlights)?.value ?? '#fff4d6';
    const headMat = this.mat(new THREE.MeshStandardMaterial({ color: headColor, emissive: headColor, emissiveIntensity: 0.9, roughness: 0.2 }));
    // Unlit lamps: head lamps take the headlight colour, tail lamps stay red.
    const lampMat = this.mat(new THREE.MeshBasicMaterial({ color: headColor, vertexColors: true }));
    const materials: Record<Part, THREE.Material> = {
      paint: paintMat,
      roof: roofMat,
      pillar: d.pillars === 'black' ? glossBlack : paintMat,
      glass: glassMat,
      trim: trimMat,
      chrome: chromeMat,
      lamp: lampMat,
      tire: tireMat,
    };
    for (const [part, g] of car.parts) {
      const m = new THREE.Mesh(g, materials[part]);
      m.castShadow = part === 'paint' || part === 'roof' || part === 'glass' || part === 'tire';
      m.receiveShadow = part === 'paint';
      this.body.add(m);
    }
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
      const dirtMesh = new THREE.Mesh(car.lower, dirtMat);
      dirtMesh.scale.setScalar(1.004);
      this.body.add(dirtMesh);
    }
    const mods = new THREE.Group();
    this.addMods(mods, look.mods, paintMat, headMat);
    batchStatic(mods);
    this.body.add(mods);
    const mod = RIM_MODS[findOption(look.mods.wheels)?.value ?? 'stock'];
    const finish = mod?.finish ?? STOCK_FINISH[d.rim];
    this.rimStyle = mod?.style ?? d.rim;
    this.rimMat = this.mat(new THREE.MeshStandardMaterial({ color: finish.color, metalness: finish.metal, roughness: finish.rough }));
    this.body.add(this.wheelRoot);
    if (this.animated) this.buildAnimatedWheels();
    else this.buildStaticWheels();
  }

  private part(group: THREE.Group, g: THREE.BufferGeometry, m: THREE.Material): void {
    const mesh = new THREE.Mesh(this.geo(g), m);
    mesh.castShadow = true;
    group.add(mesh);
  }

  private box(group: THREE.Group, m: THREE.Material, w: number, h: number, dz: number, x: number, y: number, z: number, rx = 0): void {
    const g = new THREE.BoxGeometry(w, h, dz);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    this.part(group, g, m);
  }

  private addMods(group: THREE.Group, mods: VehicleMods, paintMat: THREE.Material, headMat: THREE.Material): void {
    const kit = findOption(mods.bodyKit)?.value ?? 'none';
    const acc = findOption(mods.accessory)?.value ?? 'none';
    const c = this.car;
    const d = c.d;
    const L = c.L;
    const hw = c.hw;
    const hasRoof = d.open?.kind !== 'cockpit';
    const archSpan = (d.frontAxle - d.rearAxle) * L - 2 * c.archR - 0.12;
    const midZ = ((d.frontAxle + d.rearAxle) / 2) * L;

    if (kit === 'lip' || kit === 'full') {
      this.box(group, darkMat, hw * 1.7, 0.03, 0.18, 0, d.bumperY - 0.006, L / 2 - 0.1);
      this.box(group, darkMat, hw * 1.3, 0.05, 0.2, 0, d.bumperY + 0.01, -L / 2 + 0.1);
      for (const s of [-1, 1]) this.box(group, darkMat, 0.05, 0.07, archSpan, s * (c.planWidth(0) + 0.012), d.sillY + 0.025, midZ);
    }
    if (kit === 'spoiler' || kit === 'full') {
      if (d.open?.kind === 'bed') {
        const z = d.open.to * L - 0.12;
        for (const s of [-1, 1]) this.box(group, darkMat, 0.06, 0.34, 0.06, s * hw * 0.8, d.deckY + 0.17, z);
        this.box(group, darkMat, hw * 1.7, 0.06, 0.06, 0, d.deckY + 0.34, z);
      } else if (d.cBase > -0.42 || !hasRoof) {
        const u = -0.5 + 0.07;
        const y = c.topSolid(u);
        for (const s of [-1, 1]) this.box(group, darkMat, 0.05, 0.16, 0.08, s * hw * 0.55, y + 0.08, u * L);
        this.box(group, paintMat, hw * 1.72, 0.035, 0.28, 0, y + 0.17, u * L - 0.03, -0.08);
      } else {
        const y = c.roofTop(d.roofBack);
        this.box(group, paintMat, hw * 1.45, 0.04, 0.26, 0, y + 0.005, d.roofBack * L - 0.09, 0.12);
      }
    }
    if (kit === 'full') {
      for (const a of c.axles) {
        for (const s of [-1, 1]) {
          const flare = new THREE.TorusGeometry(c.archR + 0.045, 0.055, 6, 16, Math.PI);
          flare.rotateY(Math.PI / 2);
          flare.translate(s * (c.planWidth(a.u) + 0.01), d.wheelR, a.z);
          this.part(group, flare, paintMat);
        }
      }
    }

    if (acc === 'roofrack' && hasRoof) {
      const z0 = d.roofBack * L + 0.12;
      const z1 = d.roofFront * L - 0.12;
      const y = c.roofTop((d.roofBack + d.roofFront) / 2) + 0.09;
      for (const s of [-1, 1]) this.box(group, darkMat, 0.05, 0.06, z1 - z0, s * hw * 0.62, y, (z0 + z1) / 2);
      for (let i = 0; i < 3; i++) this.box(group, darkMat, hw * 1.35, 0.035, 0.05, 0, y + 0.03, z0 + ((z1 - z0) * (i + 0.5)) / 3);
    } else if (acc === 'bullbar') {
      const z = L / 2 + 0.12;
      const y0 = d.bumperY + 0.12;
      const y1 = d.noseY + 0.06;
      for (const y of [y0, y1]) this.box(group, chromeMat, hw * 1.3, 0.06, 0.06, 0, y, z);
      for (const s of [-1, 1]) this.box(group, chromeMat, 0.06, y1 - y0, 0.06, s * hw * 0.55, (y0 + y1) / 2, z);
    } else if (acc === 'stripes') {
      const ribbon = (u0: number, u1: number, yAt: (u: number, x: number) => number) => {
        for (const cx of [-0.14, 0.14]) {
          const g = new THREE.BufferGeometry();
          const pos: number[] = [];
          const n = 12;
          for (let i = 0; i < n; i++) {
            const ua = u0 + ((u1 - u0) * i) / n;
            const ub = u0 + ((u1 - u0) * (i + 1)) / n;
            const x0 = cx - 0.075;
            const x1 = cx + 0.075;
            const p = (u: number, x: number) => [x, yAt(u, x), u * L];
            pos.push(...p(ua, x0), ...p(ub, x1), ...p(ub, x0), ...p(ua, x0), ...p(ua, x1), ...p(ub, x1));
          }
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.computeVertexNormals();
          this.part(group, g, stripeMat);
        }
      };
      ribbon(d.cowl + 0.01, 0.49, (u, x) => c.surfaceY(u, x) + 0.006);
      if (hasRoof) ribbon(d.roofBack + 0.01, d.roofFront - 0.01, (u) => c.roofTop(u) + 0.017);
      if (d.cBase > -0.42 && !d.open) ribbon(-0.49, d.cBase - 0.01, (u, x) => c.surfaceY(u, x) + 0.006);
    } else if (acc === 'lightbar' && hasRoof) {
      this.box(group, headMat, hw * 1.2, 0.08, 0.1, 0, c.roofTop(d.roofFront) + 0.08, d.roofFront * L - 0.1);
    }
  }

  /** One wheel assembly; `flip` turns the rim face outwards on the left side. */
  private wheelMeshes(): { tire: THREE.Mesh; face: THREE.Mesh; back: THREE.Mesh; wall: THREE.Mesh | null } {
    const d = this.car.d;
    const r = d.wheelR;
    const w = d.wheelW;
    const rr = r * d.rimScale;
    const rim = rimGeometry(this.rimStyle);
    const tire = new THREE.Mesh(tireGeometry(d.rimScale), tireMat);
    tire.scale.set(w, r, r);
    const face = new THREE.Mesh(rim.face, this.rimMat!);
    face.scale.set(w, rr, rr);
    const back = new THREE.Mesh(rim.back, tireMat);
    back.scale.set(w, rr, rr);
    let wall: THREE.Mesh | null = null;
    if (d.whitewalls) {
      wall = new THREE.Mesh(ringGeo, whitewallMat);
      wall.scale.set(1, r, r);
      wall.position.x = w * 0.5 + 0.003;
    }
    return { tire, face, back, wall };
  }

  private wheelPlacements(): { x: number; z: number; flip: boolean; front: boolean }[] {
    const out: { x: number; z: number; flip: boolean; front: boolean }[] = [];
    for (const a of this.car.axles) for (const s of [-1, 1]) out.push({ x: s * this.car.trackX, z: a.z, flip: s < 0, front: a.front });
    return out;
  }

  private buildAnimatedWheels(): void {
    this.clearWheels();
    const r = this.car.d.wheelR;
    for (const p of this.wheelPlacements()) {
      const steer = new THREE.Group();
      steer.position.set(p.x, r, p.z);
      const spin = new THREE.Group();
      const flip = new THREE.Group();
      if (p.flip) flip.rotation.y = Math.PI;
      const m = this.wheelMeshes();
      m.tire.castShadow = true;
      flip.add(m.tire, m.face, m.back);
      if (m.wall) flip.add(m.wall);
      spin.add(flip);
      steer.add(spin);
      this.wheelRoot.add(steer);
      this.wheels.push({ steer, spin, front: p.front });
    }
  }

  /** Bake all four wheels into one tyre mesh, one rim mesh and (for whitewalls) one ring mesh. */
  private buildStaticWheels(): void {
    this.clearWheels();
    const r = this.car.d.wheelR;
    const lists: { tire: THREE.BufferGeometry[]; face: THREE.BufferGeometry[]; wall: THREE.BufferGeometry[] } = { tire: [], face: [], wall: [] };
    const bake = (mesh: THREE.Mesh, m: THREE.Matrix4) => {
      mesh.updateMatrix();
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, mesh.matrix));
    };
    for (const p of this.wheelPlacements()) {
      const at = new THREE.Matrix4().compose(new THREE.Vector3(p.x, r, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.flip ? Math.PI : 0), new THREE.Vector3(1, 1, 1));
      const m = this.wheelMeshes();
      lists.tire.push(bake(m.tire, at), bake(m.back, at));
      lists.face.push(bake(m.face, at));
      if (m.wall) lists.wall.push(bake(m.wall, at));
    }
    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow: boolean) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false)!;
      for (const g of geos) g.dispose();
      this.wheelGeos.push(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadow;
      this.wheelRoot.add(mesh);
    };
    add(lists.tire, tireMat, true);
    add(lists.face, this.rimMat!, false);
    add(lists.wall, whitewallMat, false);
  }

  /** Animate wheels (spin by speed m/s, steering angle rad). */
  animate(speed: number, steer: number, dt: number): void {
    const moving = Math.abs(speed) > 0.01 || Math.abs(steer) > 0.001;
    if (moving) {
      this.still = 0;
      if (!this.animated) {
        this.animated = true;
        this.buildAnimatedWheels();
      }
    } else if (this.animated) {
      this.still += dt;
      if (this.still > WHEEL_MERGE_DELAY) {
        this.animated = false;
        this.buildStaticWheels();
      }
    }
    this.wheelSpin += (speed / this.car.d.wheelR) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.steer.rotation.y = steer;
    }
    // Subtle body roll
    this.body.rotation.z = -steer * Math.min(1, Math.abs(speed) / 20) * 0.05;
  }

  dispose(): void {
    this.clear();
  }

  /** Number of meshes, for tests: parked vehicles should stay cheap to draw. */
  get meshCount(): number {
    let n = 0;
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  }
}

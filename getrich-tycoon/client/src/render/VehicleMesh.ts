// Vehicles: the procedural body from carBody.ts (or bikeBody.ts) dressed with per-vehicle paint,
// glass tint, lamps, wheels, dirt, damage, body parts, stance and exhaust flames.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { findOption, vehicleColor } from '../../../shared/customization';
import { RIM_FINISH_DEFS, findRimDesign, type PaintFinish } from '../../../shared/modificationsData';
import type { VehicleCondition, VehicleMods } from '../../../shared/types';
import { getModel } from '../../../shared/vehicles';
import { batchStatic } from './batch';
import { bikeBody, type BikeBody } from './bikeBody';
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

/** Wheel upgrades from the classic customization shop. */
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
  mesh: { color: '#c9ced4', metal: 0.85, rough: 0.25 },
  sixspoke: { color: '#c9ced4', metal: 0.85, rough: 0.25 },
  turbofan: { color: '#c9ced4', metal: 0.85, rough: 0.25 },
  deepdish: { color: '#c9ced4', metal: 0.85, rough: 0.25 },
};

const tireMat = new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.9 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#141619', roughness: 0.65, side: THREE.DoubleSide });
/** Dark trim, interior and plates: colours come from the geometry. */
const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
const chromeMat = new THREE.MeshStandardMaterial({ color: '#f1f4f7', metalness: 1, roughness: 0.16, envMapIntensity: 1.6 });
const glossBlack = new THREE.MeshStandardMaterial({ color: '#0c0d10', metalness: 0.4, roughness: 0.2 });
const whitewallMat = new THREE.MeshStandardMaterial({ color: '#f3f1ea', roughness: 0.7 });
const stripeMat = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.4 });
let carbonMat: THREE.MeshStandardMaterial | null = null;
const carbon = () => (carbonMat ??= new THREE.MeshStandardMaterial({ map: Tex.carbon(), metalness: 0.35, roughness: 0.3, envMapIntensity: 1.2, side: THREE.DoubleSide }));
const ringGeo = new THREE.RingGeometry(0.66, 0.84, 32).rotateY(Math.PI / 2);
const flameMat = new THREE.SpriteMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

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

/** Body paint for a look: factory/classic colours use the standard paint, custom finishes their own. */
export function paintMaterial(look: VehicleLook, dirt: number, damage: number): THREE.Material {
  const custom = look.mods.tuning?.paint;
  const brown = new THREE.Color('#6b5236');
  const weather = (c: THREE.Color) => c.clone().lerp(brown, dirt * 0.35).multiplyScalar(1 - damage * 0.25);
  const base = weather(new THREE.Color(vehicleColor(look.color, look.mods)));
  if (!custom) {
    return new THREE.MeshStandardMaterial({ color: base, metalness: 0.55 - dirt * 0.35, roughness: 0.26 + dirt * 0.55 + damage * 0.1, envMapIntensity: 1.2 });
  }
  const finish: PaintFinish = custom.finish;
  const coat = Math.max(0, 1 - dirt * 1.2);
  switch (finish) {
    case 'matte':
      return new THREE.MeshStandardMaterial({ color: base, metalness: 0.12, roughness: Math.min(1, 0.78 + dirt * 0.2), envMapIntensity: 0.55 });
    case 'metallic':
      return new THREE.MeshPhysicalMaterial({ color: base, metalness: 0.78 - dirt * 0.4, roughness: 0.34 + dirt * 0.4, clearcoat: coat, clearcoatRoughness: 0.08, envMapIntensity: 1.45 });
    case 'chameleon': {
      const m = new THREE.MeshPhysicalMaterial({
        color: base,
        metalness: 0.62,
        roughness: 0.26 + dirt * 0.4,
        clearcoat: coat,
        clearcoatRoughness: 0.05,
        iridescence: 0.5,
        iridescenceIOR: 1.6,
        envMapIntensity: 1.5,
      });
      const flip = { value: weather(new THREE.Color(custom.color2 ?? custom.color)) };
      // Colour shift: facing the camera shows the base colour, grazing angles the flip colour.
      m.onBeforeCompile = (shader) => {
        shader.uniforms.flipColor = flip;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 flipColor;')
          .replace(
            '#include <normal_fragment_maps>',
            '#include <normal_fragment_maps>\n{ float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); diffuseColor.rgb = mix(flipColor, diffuseColor.rgb, smoothstep(0.1, 0.85, facing)); }',
          );
      };
      m.customProgramCacheKey = () => 'chameleon-paint';
      return m;
    }
    default:
      return new THREE.MeshPhysicalMaterial({ color: base, metalness: 0.05, roughness: 0.3 + dirt * 0.5, clearcoat: coat, clearcoatRoughness: 0.05, envMapIntensity: 1.1 });
  }
}

/** Rim design and finish for a look. */
function rimChoice(look: VehicleLook, stock: RimStyle): { style: RimStyle; finish: Finish } {
  const t = look.mods.tuning?.rim;
  const design = findRimDesign(t?.design);
  if (t && design) return { style: design.style, finish: RIM_FINISH_DEFS[t.finish] };
  const mod = RIM_MODS[findOption(look.mods.wheels)?.value ?? 'stock'];
  return mod ?? { style: stock, finish: STOCK_FINISH[stock] };
}

/** Short-lived backfire flames at the exhaust tips. */
class Flames {
  private sprites: THREE.Sprite[] = [];
  private t = 0;
  constructor(parent: THREE.Object3D, tips: readonly (readonly [number, number, number])[]) {
    for (const [x, y, z] of tips.slice(0, 4)) {
      const s = new THREE.Sprite(flameMat);
      s.position.set(x, y, z);
      s.visible = false;
      parent.add(s);
      this.sprites.push(s);
    }
  }
  pop(strength: number): void {
    this.t = 0.06 + 0.08 * strength;
    for (const s of this.sprites) {
      s.visible = true;
      const k = 0.18 + Math.random() * 0.2 * (0.5 + strength);
      s.scale.set(k, k * 0.8, 1);
    }
  }
  update(dt: number): void {
    if (this.t <= 0) return;
    this.t -= dt;
    if (this.t <= 0) for (const s of this.sprites) s.visible = false;
  }
}

/** Common surface of car and bike views. */
export interface AnyVehicleView {
  readonly root: THREE.Group;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly isBike: boolean;
  signature: string;
  update(look: VehicleLook): void;
  animate(speed: number, steer: number, dt: number): void;
  /** Backfire (pops & bangs). */
  pop(strength: number): void;
  dispose(): void;
  readonly meshCount: number;
}

export function createVehicleView(look: VehicleLook): AnyVehicleView {
  return getModel(look.modelId).specs.kind === 'bike' ? new BikeView(look) : new VehicleView(look);
}

/** A complete car with wheel animation support. */
export class VehicleView implements AnyVehicleView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  /** Everything but the wheels: lowered by the suspension drop. */
  private readonly shell = new THREE.Group();
  readonly isBike = false;
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
  /** Negative camber in radians. */
  private camber = 0;
  private flames: Flames | null = null;
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
    this.body.add(this.shell, this.wheelRoot);
    this.build(look);
  }

  update(look: VehicleLook): void {
    const sig = lookSignature(look);
    if (sig === this.signature) return;
    this.clear();
    this.build(look);
  }

  private clear(): void {
    this.shell.clear();
    this.clearWheels();
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    this.mats = [];
    this.geos = [];
    this.flames = null;
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
    const paintMat = this.mat(paintMaterial(look, dirt, damage));
    const base = new THREE.Color(vehicleColor(look.color, look.mods));
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
      this.shell.add(m);
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
      this.shell.add(dirtMesh);
    }
    const mods = new THREE.Group();
    this.addMods(mods, look.mods, paintMat, headMat);
    this.addBodyParts(mods, look.mods, paintMat);
    batchStatic(mods);
    this.shell.add(mods);
    this.flames = new Flames(this.shell, car.exhausts);

    // Stance: the body drops (tyres tuck into the arches a little), wheels tilt with camber.
    const t = look.mods.tuning;
    const drop = Math.min((t?.drop ?? 0) / 100, d.archGap + 0.035);
    this.shell.position.y = -drop;
    this.camber = ((t?.camber ?? 0) * Math.PI) / 180;

    const rim = rimChoice(look, d.rim);
    this.rimStyle = rim.style;
    this.rimMat = this.mat(new THREE.MeshStandardMaterial({ color: rim.finish.color, metalness: rim.finish.metal, roughness: rim.finish.rough }));
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

  /** Half width of the body along the sill between the wheels (where skirts sit). */
  private sillX(): number {
    const d = this.car.d;
    const u = (d.frontAxle + d.rearAxle) / 2;
    return this.car.surfaceX(u, d.sillY + 0.05) || this.car.planWidth(u) * 0.95;
  }

  /** A thin sheet following the body's top surface (hood panels, stripes), with UVs. */
  private surfaceSheet(u0: number, u1: number, x0: number, x1: number, yAt: (u: number, x: number) => number, nu = 12, nx = 6): THREE.BufferGeometry {
    const L = this.car.L;
    const pos: number[] = [];
    const uv: number[] = [];
    const p = (i: number, j: number) => {
      const u = u0 + ((u1 - u0) * i) / nu;
      const x = x0 + ((x1 - x0) * j) / nx;
      return { v: [x, yAt(u, x), u * L], t: [j / nx, i / nu] };
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nx; j++) {
        const a = p(i, j);
        const b = p(i + 1, j);
        const c = p(i + 1, j + 1);
        const e = p(i, j + 1);
        for (const q of [a, e, c, a, c, b]) {
          pos.push(...q.v);
          uv.push(...q.t);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  /** Classic customization parts (body kit and accessory slots). */
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
      for (const s of [-1, 1]) this.box(group, darkMat, 0.05, 0.07, archSpan, s * (this.sillX() + 0.01), d.sillY + 0.025, midZ);
    }
    if (kit === 'spoiler' || kit === 'full') this.wing(group, 'gt', paintMat);
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
        for (const cx of [-0.14, 0.14]) this.part(group, this.surfaceSheet(u0, u1, cx - 0.075, cx + 0.075, yAt, 12, 1), stripeMat);
      };
      ribbon(d.cowl + 0.01, 0.49, (u, x) => c.surfaceY(u, x) + 0.006);
      if (hasRoof) ribbon(d.roofBack + 0.01, d.roofFront - 0.01, (u) => c.roofTop(u) + 0.017);
      if (d.cBase > -0.42 && !d.open) ribbon(-0.49, d.cBase - 0.01, (u, x) => c.surfaceY(u, x) + 0.006);
    } else if (acc === 'lightbar' && hasRoof) {
      this.box(group, headMat, hw * 1.2, 0.08, 0.1, 0, c.roofTop(d.roofFront) + 0.08, d.roofFront * L - 0.1);
    }
  }

  /** Rear spoilers and wings: on the bed of pickups, the boot of saloons, the roof of hatches. */
  private wing(group: THREE.Group, kind: 'duck' | 'gt' | 'swan', paintMat: THREE.Material): void {
    const c = this.car;
    const d = c.d;
    const L = c.L;
    const hw = c.hw;
    const hasRoof = d.open?.kind !== 'cockpit';
    if (d.open?.kind === 'bed') {
      const z = d.open.to * L - 0.12;
      for (const s of [-1, 1]) this.box(group, darkMat, 0.06, 0.34, 0.06, s * hw * 0.8, d.deckY + 0.17, z);
      this.box(group, kind === 'swan' ? carbon() : darkMat, hw * 1.7, 0.06, 0.06, 0, d.deckY + 0.34, z);
    } else if (d.cBase > -0.42 || !hasRoof) {
      const u = -0.5 + 0.07;
      const y = c.topSolid(u);
      if (kind === 'duck') {
        this.box(group, paintMat, hw * 1.5, 0.04, 0.16, 0, y + 0.025, u * L + 0.02, 0.35);
        return;
      }
      const lift = kind === 'swan' ? 0.3 : 0.16;
      for (const s of [-1, 1]) {
        if (kind === 'swan') {
          // Swan-neck mounts hold the wing from above.
          this.box(group, darkMat, 0.04, lift, 0.06, s * hw * 0.42, y + lift / 2, u * L + 0.08);
          this.box(group, darkMat, 0.04, 0.05, 0.16, s * hw * 0.42, y + lift + 0.02, u * L);
        } else this.box(group, darkMat, 0.05, lift, 0.08, s * hw * 0.55, y + lift / 2, u * L);
      }
      this.box(group, kind === 'swan' ? carbon() : paintMat, hw * (kind === 'swan' ? 1.84 : 1.72), 0.035, kind === 'swan' ? 0.32 : 0.28, 0, y + lift + 0.01, u * L - 0.03, -0.08);
      if (kind === 'swan') for (const s of [-1, 1]) this.box(group, darkMat, 0.02, 0.16, 0.34, s * hw * 0.93, y + lift, u * L - 0.03);
    } else {
      const y = c.roofTop(d.roofBack);
      this.box(group, kind === 'swan' ? carbon() : paintMat, hw * (kind === 'duck' ? 1.3 : 1.45), 0.04, kind === 'duck' ? 0.18 : 0.26, 0, y + 0.005, d.roofBack * L - 0.09, 0.12);
    }
  }

  /** Tuning garage body parts. */
  private addBodyParts(group: THREE.Group, mods: VehicleMods, paintMat: THREE.Material): void {
    const body = mods.tuning?.body;
    if (!body) return;
    const c = this.car;
    const d = c.d;
    const L = c.L;
    const hw = c.hw;
    const archSpan = (d.frontAxle - d.rearAxle) * L - 2 * c.archR - 0.1;
    const midZ = ((d.frontAxle + d.rearAxle) / 2) * L;
    const noseZ = L / 2;

    switch (body.frontBumper) {
      case 'fb_sport':
        this.box(group, darkMat, hw * 1.5, 0.035, 0.12, 0, d.bumperY - 0.004, noseZ - 0.07);
        for (const s of [-1, 1]) this.box(group, darkMat, hw * 0.34, 0.1, 0.04, s * hw * 0.66, d.bumperY + 0.08, noseZ - 0.08);
        break;
      case 'fb_aero':
        this.box(group, darkMat, hw * 1.86, 0.025, 0.26, 0, d.bumperY - 0.012, noseZ - 0.06);
        for (const s of [-1, 1]) this.box(group, darkMat, 0.14, 0.02, 0.1, s * hw * 0.9, d.bumperY + 0.12, noseZ - 0.12, 0.3);
        break;
      case 'fb_carbon':
        this.box(group, carbon(), hw * 1.7, 0.03, 0.2, 0, d.bumperY - 0.006, noseZ - 0.08);
        for (const s of [-1, 1]) this.box(group, carbon(), 0.16, 0.018, 0.12, s * hw * 0.88, d.bumperY + 0.14, noseZ - 0.14, 0.35);
        break;
    }
    switch (body.rearBumper) {
      case 'rb_sport':
        this.box(group, darkMat, hw * 1.4, 0.07, 0.16, 0, d.bumperY + 0.02, -noseZ + 0.09);
        break;
      case 'rb_diffuser':
        this.box(group, carbon(), hw * 1.4, 0.03, 0.3, 0, d.bumperY - 0.01, -noseZ + 0.12, -0.18);
        for (let k = -2; k <= 2; k++) this.box(group, carbon(), 0.015, 0.1, 0.26, k * hw * 0.26, d.bumperY + 0.03, -noseZ + 0.12);
        break;
    }
    const skirt = body.sideSkirts;
    if (skirt) {
      const m = skirt === 'ss_carbon' ? carbon() : darkMat;
      for (const s of [-1, 1]) {
        this.box(group, m, 0.06, 0.08, archSpan, s * (this.sillX() + 0.012), d.sillY + 0.02, midZ);
        if (skirt === 'ss_carbon') this.box(group, m, 0.1, 0.015, 0.14, s * (this.sillX() + 0.06), d.sillY - 0.005, midZ - archSpan / 2 + 0.1);
      }
    }
    if (body.hood && !d.cargoFrom) {
      const u0 = d.cowl + 0.015;
      const u1 = Math.min(0.47, d.frontAxle + 0.1);
      const w = hw * 0.62;
      if (body.hood === 'hood_carbon') this.part(group, this.surfaceSheet(u0, u1, -w, w, (u, x) => c.surfaceY(u, x) + 0.007, 14, 8), carbon());
      else for (const s of [-1, 1]) this.part(group, this.surfaceSheet(u0 + 0.03, u0 + 0.11, s * w * 0.35, s * w * 0.75, (u, x) => c.surfaceY(u, x) + 0.008, 4, 3), darkMat);
    }
    if (body.wing) this.wing(group, body.wing === 'wing_ducktail' ? 'duck' : body.wing === 'wing_swan' ? 'swan' : 'gt', paintMat);
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
      // Negative camber: the top of each wheel leans in towards the car.
      const tilt = new THREE.Group();
      tilt.rotation.z = (p.x > 0 ? 1 : -1) * this.camber;
      const spin = new THREE.Group();
      const flip = new THREE.Group();
      if (p.flip) flip.rotation.y = Math.PI;
      const m = this.wheelMeshes();
      m.tire.castShadow = true;
      flip.add(m.tire, m.face, m.back);
      if (m.wall) flip.add(m.wall);
      spin.add(flip);
      tilt.add(spin);
      steer.add(tilt);
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
    const zAxis = new THREE.Vector3(0, 0, 1);
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const p of this.wheelPlacements()) {
      const q = new THREE.Quaternion()
        .setFromAxisAngle(zAxis, (p.x > 0 ? 1 : -1) * this.camber)
        .multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, p.flip ? Math.PI : 0));
      const at = new THREE.Matrix4().compose(new THREE.Vector3(p.x, r, p.z), q, new THREE.Vector3(1, 1, 1));
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
    this.flames?.update(dt);
  }

  pop(strength: number): void {
    this.flames?.pop(strength);
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

/** A motorcycle: frame-mounted body, steering fork with the front wheel, lean in corners, a rider mount. */
export class BikeView implements AnyVehicleView {
  readonly root = new THREE.Group();
  /** Leans into corners (and onto the side stand when parked). */
  readonly lean = new THREE.Group();
  /** The rider's character is parented here while riding (hips at the seat). */
  readonly riderMount = new THREE.Group();
  readonly isBike = true;
  private readonly steer = new THREE.Group();
  private readonly frontSpin = new THREE.Group();
  private readonly rearSpin = new THREE.Group();
  private mats: THREE.Material[] = [];
  private flames: Flames | null = null;
  private spin = 0;
  private leanAngle = 0.14;
  ridden = false;
  signature = '';
  readonly length: number;
  readonly width: number;
  readonly height: number;
  private readonly bike: BikeBody;

  constructor(look: VehicleLook) {
    const shape = getModel(look.modelId).shape;
    this.bike = bikeBody(look.modelId, shape.length, shape.wheelRadius, shape.wheelWidth);
    this.length = shape.length;
    this.width = shape.width;
    this.height = this.bike.height;
    this.root.add(this.lean);
    this.riderMount.position.set(...this.bike.seat);
    this.build(look);
  }

  update(look: VehicleLook): void {
    if (lookSignature(look) === this.signature) return;
    this.clear();
    this.build(look);
  }

  private clear(): void {
    this.lean.clear();
    this.steer.clear();
    this.frontSpin.clear();
    this.rearSpin.clear();
    for (const m of this.mats) m.dispose();
    this.mats = [];
    this.flames = null;
  }

  private wheel(r: number, w: number, rimMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(tireGeometry(0.78), tireMat);
    tire.scale.set(w, r, r);
    tire.castShadow = true;
    const rim = rimGeometry('wire');
    for (const flip of [0, Math.PI]) {
      const face = new THREE.Mesh(rim.face, rimMat);
      face.scale.set(w * 0.6, r * 0.78, r * 0.78);
      face.rotation.y = flip;
      g.add(face);
    }
    g.add(tire);
    return g;
  }

  private build(look: VehicleLook): void {
    this.signature = lookSignature(look);
    const b = this.bike;
    const dirt = 1 - Math.max(0, Math.min(100, look.condition.cleanliness)) / 100;
    const damage = Math.max(0, (45 - look.condition.body) / 45);
    const paintMat = paintMaterial(look, dirt, damage);
    const glassMat = new THREE.MeshStandardMaterial({ color: '#2a3442', metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.55 });
    const headColor = findOption(look.mods.headlights)?.value ?? '#fff4d6';
    const lampMat = new THREE.MeshBasicMaterial({ color: headColor, vertexColors: true });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#d7b34a', metalness: 0.8, roughness: 0.3 });
    this.mats.push(paintMat, glassMat, lampMat, rimMat);
    const materials: Record<Part, THREE.Material> = { paint: paintMat, roof: paintMat, pillar: paintMat, glass: glassMat, trim: trimMat, chrome: chromeMat, lamp: lampMat, tire: tireMat };
    for (const [part, g] of b.parts) {
      const m = new THREE.Mesh(g, materials[part]);
      m.castShadow = part === 'paint' || part === 'trim';
      this.lean.add(m);
    }
    this.steer.position.set(...b.steerPivot);
    for (const [part, g] of b.steerParts) this.steer.add(new THREE.Mesh(g, materials[part]));
    this.frontSpin.position.set(0, b.front.r - b.steerPivot[1], b.front.z - b.steerPivot[2]);
    this.frontSpin.add(this.wheel(b.front.r, b.front.w, rimMat));
    this.steer.add(this.frontSpin);
    this.rearSpin.position.set(0, b.rear.r, b.rear.z);
    this.rearSpin.add(this.wheel(b.rear.r, b.rear.w, rimMat));
    this.lean.add(this.steer, this.rearSpin, this.riderMount);
    this.flames = new Flames(this.lean, b.exhausts);
  }

  animate(speed: number, steer: number, dt: number): void {
    this.spin += (speed / this.bike.front.r) * dt;
    this.frontSpin.rotation.x = this.spin;
    this.rearSpin.rotation.x = (this.spin * this.bike.front.r) / this.bike.rear.r;
    this.steer.rotation.y = steer * 0.9;
    // Lean into corners when moving; on the side stand when parked; nearly upright (foot down) when ridden.
    const target = Math.abs(speed) > 1.5 ? -steer * Math.min(1, Math.abs(speed) / 10) * 0.9 : this.ridden ? 0.03 : 0.14;
    this.leanAngle += (target - this.leanAngle) * Math.min(1, dt * 6);
    this.lean.rotation.z = this.leanAngle;
    this.flames?.update(dt);
  }

  pop(strength: number): void {
    this.flames?.pop(strength);
  }

  dispose(): void {
    this.clear();
  }

  get meshCount(): number {
    let n = 0;
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  }
}

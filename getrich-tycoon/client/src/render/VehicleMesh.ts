// Vehicles on screen: a clone of the vehicle's GLB model (see ModelLibrary.ts and
// data/highDetailVehicles.ts) dressed per vehicle: paint (with custom finishes, dirt and damage),
// glass tint, lamp colours, aftermarket rims, body-kit parts, stance, spinning/steering wheels, body
// roll and pitch, brake / reverse / head lights, the driver's door, exhaust flames, underglow neon and
// a seat for the driver's character.
// Parked vehicles are merged into a few meshes (cheap to draw) and unmerged when they move.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { findOption, vehicleColor } from '../../../shared/customization';
import { RIM_FINISH_DEFS, airDropCm, findRimDesign, hasAirRide, type PaintFinish } from '../../../shared/modificationsData';
import { plateText } from '../../../shared/plates';
import type { VehicleDamageLook } from '../../../shared/weapons';
import type { VehicleCondition, VehicleMods } from '../../../shared/types';
import { seatOffset } from '../../../shared/passengers';
import { getModel, type VehicleModel } from '../../../shared/vehicles';
import { PAINT_MATERIALS } from '../data/highDetailVehicles';
import { rimTemplates, vehicleTemplate, type TemplateInfo, type VehicleTemplate } from './ModelLibrary';

export interface VehicleLook {
  /** The vehicle's id (its own registration plate). */
  id?: string;
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
const RIM_MODS: Record<string, { style: string; finish: Finish }> = {
  sport: { style: 'multi', finish: { color: '#d7dbe0', metal: 0.85, rough: 0.25 } },
  chrome: { style: 'five', finish: { color: '#f2f5f8', metal: 1, rough: 0.08 } },
  black: { style: 'five', finish: { color: '#1b1c1f', metal: 0.5, rough: 0.35 } },
  gold: { style: 'multi', finish: { color: '#d4a017', metal: 1, rough: 0.2 } },
};

const flameMat = new THREE.SpriteMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const nitroMat = new THREE.SpriteMaterial({ color: '#4fa8ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

let glowTex: THREE.CanvasTexture | null = null;

/** Soft rectangular glow for underglow neon (white, tinted per car). */
function underglowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      // Distance outside an inner rectangle, faded towards the edges.
      const dx = Math.max(0, Math.abs(x - 31.5) - 14) / 18;
      const dy = Math.max(0, Math.abs(y - 63.5) - 44) / 20;
      const a = Math.max(0, 1 - Math.hypot(dx, dy)) ** 1.6;
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** Seconds a vehicle must stand still before it is merged into a static mesh. */
const FREEZE_DELAY = 3;

export function lookSignature(v: VehicleLook): string {
  // Air ride height and plate text change in place (no rebuild).
  const { air: _air, plate: _plate, ...mods } = v.mods;
  return [v.modelId, v.color, JSON.stringify(mods), Math.round(v.condition.cleanliness / 8), Math.round(v.condition.body / 15)].join('|');
}

/** Body paint for a look: factory/classic colours use the standard paint, custom finishes their own. */
export function paintMaterial(look: VehicleLook, dirt: number, damage: number): THREE.Material {
  const custom = look.mods.tuning?.paint;
  const brown = new THREE.Color('#6b5236');
  const weather = (c: THREE.Color) => c.clone().lerp(brown, dirt * 0.35).multiplyScalar(1 - damage * 0.25);
  const base = weather(new THREE.Color(vehicleColor(look.color, look.mods)));
  if (!custom) {
    return new THREE.MeshPhysicalMaterial({ name: 'paint', color: base, metalness: 0.5 - dirt * 0.35, roughness: 0.28 + dirt * 0.55 + damage * 0.1, clearcoat: Math.max(0, 0.8 - dirt), clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
  }
  const finish: PaintFinish = custom.finish;
  const coat = Math.max(0, 1 - dirt * 1.2);
  switch (finish) {
    case 'matte':
      return new THREE.MeshStandardMaterial({ name: 'paint', color: base, metalness: 0.12, roughness: Math.min(1, 0.78 + dirt * 0.2), envMapIntensity: 0.55 });
    case 'metallic':
      return new THREE.MeshPhysicalMaterial({ name: 'paint', color: base, metalness: 0.78 - dirt * 0.4, roughness: 0.34 + dirt * 0.4, clearcoat: coat, clearcoatRoughness: 0.08, envMapIntensity: 1.45 });
    case 'chameleon': {
      const m = new THREE.MeshPhysicalMaterial({
        name: 'paint',
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
      return new THREE.MeshPhysicalMaterial({ name: 'paint', color: base, metalness: 0.05, roughness: 0.3 + dirt * 0.5, clearcoat: coat, clearcoatRoughness: 0.05, envMapIntensity: 1.1 });
  }
}

/** Aftermarket rim for a look (null = the model's own wheels). */
function rimChoice(look: VehicleLook): { style: string; finish: Finish } | null {
  const t = look.mods.tuning?.rim;
  const design = findRimDesign(t?.design);
  if (t && design) return { style: design.style, finish: RIM_FINISH_DEFS[t.finish] };
  return RIM_MODS[findOption(look.mods.wheels)?.value ?? 'stock'] ?? null;
}

/** Kit / accessory nodes to show for a set of mods. */
function kitNodes(mods: VehicleMods): Set<string> {
  const on = new Set<string>();
  const kit = findOption(mods.bodyKit)?.value ?? 'none';
  if (kit === 'lip' || kit === 'full') on.add('kit_lip');
  if (kit === 'spoiler' || kit === 'full') on.add('kit_wing_gt');
  if (kit === 'full') on.add('kit_flares');
  const acc = findOption(mods.accessory)?.value ?? 'none';
  if (acc !== 'none') on.add(`acc_${acc}`);
  const b = mods.tuning?.body;
  if (b?.frontBumper) on.add(`kit_${b.frontBumper}`);
  if (b?.rearBumper) on.add(`kit_${b.rearBumper}`);
  if (b?.sideSkirts) on.add(`kit_${b.sideSkirts}`);
  if (b?.hood) on.add(`kit_${b.hood}`);
  if (b?.wing) {
    on.delete('kit_wing_gt');
    on.add(b.wing === 'wing_ducktail' ? 'kit_wing_duck' : b.wing === 'wing_swan' ? 'kit_wing_swan' : 'kit_wing_gt');
  }
  return on;
}

/** Short-lived backfire flames at the exhaust tips. */
class Flames {
  private sprites: THREE.Sprite[] = [];
  private t = 0;
  constructor(tips: THREE.Object3D[]) {
    for (const tip of tips.slice(0, 4)) {
      const s = new THREE.Sprite(flameMat);
      s.visible = false;
      tip.add(s);
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
  private nos = false;
  /** A nitrous shot: a steady, flickering blue flame. */
  nitro(on: boolean): void {
    if (on === this.nos) return;
    this.nos = on;
    for (const s of this.sprites) {
      s.material = on ? nitroMat : flameMat;
      s.visible = on;
    }
  }
  update(dt: number): void {
    if (this.nos) {
      for (const s of this.sprites) {
        const k = 0.26 + Math.random() * 0.22;
        s.scale.set(k, k * 0.75, 1);
      }
      return;
    }
    if (this.t <= 0) return;
    this.t -= dt;
    if (this.t <= 0) for (const s of this.sprites) s.visible = false;
  }
}

// ------------------------------------------------------------------ number plates

const PLATE_W = 0.52;
const PLATE_H = 0.12;

/** Plate art: white with the blue TR band, black lettering (like a Turkish plate). */
function plateTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 60;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f3ee';
  g.fillRect(0, 0, 256, 60);
  g.fillStyle = '#1f47b8';
  g.fillRect(0, 0, 30, 60);
  g.fillStyle = '#ffffff';
  g.font = 'bold 14px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('TR', 15, 50);
  g.strokeStyle = '#151515';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 57);
  g.fillStyle = '#121212';
  let size = 40;
  g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
  while (size > 18 && g.measureText(text).width > 212) {
    size -= 2;
    g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
  }
  g.textBaseline = 'middle';
  g.fillText(text, 143, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Where the plates go on a model: found once by casting rays at the bumpers (body space). */
const plateGeoCache = new WeakMap<object, THREE.BufferGeometry | null>();

function plateGeometry(t: VehicleTemplate, bike: boolean): THREE.BufferGeometry | null {
  if (plateGeoCache.has(t)) return plateGeoCache.get(t)!;
  const scene = t.scene;
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    if (/wheel|tire|tyre|rim|exhaust|glass|window/i.test(`${m.name} ${m.material.name}`)) return;
    meshes.push(m);
  });
  const avg = (v: THREE.Vector3[], k: 'y' | 'z', d: number) => (v.length ? v.reduce((a, p) => a + p[k], 0) / v.length : d);
  // Headlights tell which way the model faces.
  const front = Math.sign(avg(t.info.heads, 'z', 1)) || 1;
  const reach = t.info.length;
  const parts: THREE.BufferGeometry[] = [];
  const ray = new THREE.Raycaster();
  for (const end of bike ? [-front] : [front, -front]) {
    const lampY = avg(end === front ? t.info.heads : t.info.tails, 'y', t.info.height * 0.42);
    let pos: THREE.Vector3 | null = null;
    for (const y of [lampY - 0.17, lampY - 0.28, lampY - 0.07, lampY + 0.05]) {
      if (y < 0.18) continue;
      ray.set(new THREE.Vector3(0, y, end * reach), new THREE.Vector3(0, 0, -end));
      ray.far = reach;
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) {
        pos = hit.point.clone();
        pos.z += end * 0.014;
        break;
      }
    }
    pos ??= new THREE.Vector3(0, Math.max(0.3, lampY - 0.15), (end * t.info.length) / 2 + end * 0.01);
    const g = new THREE.PlaneGeometry(PLATE_W, PLATE_H);
    if (end < 0) g.rotateY(Math.PI);
    g.translate(pos.x, pos.y, pos.z);
    parts.push(g);
  }
  const merged = parts.length ? mergeGeometries(parts, false) : null;
  for (const g of parts) g.dispose();
  plateGeoCache.set(t, merged);
  return merged;
}

export interface VehicleLights {
  /** Brake lights (pedal pressed). */
  brake: boolean;
  reverse: boolean;
  /** Headlights and tail lights on (0-1, e.g. the night factor). */
  night: number;
}

/** Common surface of car and bike views. */
export interface AnyVehicleView {
  readonly root: THREE.Group;
  readonly length: number;
  readonly width: number;
  height: number;
  readonly isBike: boolean;
  signature: string;
  /** Resolves when the model has loaded (or failed to). */
  readonly ready: Promise<void>;
  /** Fitted model facts once loaded (lamp spots, seat, size). */
  info: TemplateInfo | null;
  update(look: VehicleLook): void;
  /** Wheels (speed m/s, front wheel angle rad), body roll / pitch. */
  animate(speed: number, steer: number, dt: number): void;
  /** Body roll (rad, + leans right) and pitch (rad, + nose down). */
  setMotion(roll: number, pitch: number): void;
  setLights(l: VehicleLights): void;
  /** Driver's door 0 (shut) - 1 (open). */
  setDoor(open: number): void;
  /** Where a seated driver's character goes (feet origin). */
  readonly driverMount: THREE.Group;
  /** Where a passenger sits (0 front passenger, 1 rear right, 2 rear left). */
  passengerMount(seat: number): THREE.Group;
  /** Backfire (pops & bangs). */
  pop(strength: number): void;
  /** Blue nitrous flames from the exhausts while a shot burns. */
  setNitro(on: boolean): void;
  /** Bullet damage: broken glass, parts off, a burnt-out wreck (null: none). */
  setShotDamage(d: VehicleDamageLook | null): void;
  /** Where engine smoke comes out (world space). */
  hoodPoint(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
  readonly meshCount: number;
}

export function createVehicleView(look: VehicleLook): AnyVehicleView {
  return getModel(look.modelId).specs.kind === 'bike' ? new BikeView(look) : new VehicleView(look);
}

interface WheelRef {
  pivot: THREE.Object3D;
  spin: THREE.Object3D;
  front: boolean;
  left: boolean;
}

/** Shared per-view machinery: loading, dressing, merging when parked. */
abstract class ModelView implements AnyVehicleView {
  readonly root = new THREE.Group();
  /** Rolls and pitches with the car's motion (and drops with lowered suspension). */
  readonly body = new THREE.Group();
  /** The driver's character sits here (feet origin, placed from the model's seat). */
  readonly driverMount = new THREE.Group();
  /** Car wheels live outside the body so they stay planted while the body rolls. */
  protected readonly wheelRoot = new THREE.Group();
  abstract readonly isBike: boolean;
  /** Material names that take the paint colour (from the model entry). */
  protected paintKeys: string[] = PAINT_MATERIALS.map((k) => k.toLowerCase());
  readonly length: number;
  readonly width: number;
  height: number;
  signature = '';
  info: TemplateInfo | null = null;
  readonly ready: Promise<void>;
  protected model: THREE.Group | null = null;
  protected look: VehicleLook;
  protected readonly vm: VehicleModel;
  protected wheels: WheelRef[] = [];
  protected owned: THREE.Material[] = [];
  protected paintMats: THREE.Material[] = [];
  protected heads: THREE.MeshBasicMaterial[] = [];
  protected tails: THREE.MeshBasicMaterial[] = [];
  protected flames: Flames | null = null;
  protected door: THREE.Object3D | null = null;
  protected cavity: THREE.Object3D | null = null;
  /** Passenger door and the side mirrors (taken off at the Sanayi). */
  protected doorR: THREE.Object3D | null = null;
  protected cavityR: THREE.Object3D | null = null;
  protected mirrors: THREE.Object3D[] = [];
  /** Both front doors have been stripped: the openings show. */
  protected doorsOff = false;
  protected doorOpen = 0;
  protected wheelSpin = 0;
  private frozen: THREE.Group | null = null;
  private still = 0;
  private disposed = false;
  private lights: VehicleLights = { brake: false, reverse: false, night: 0 };
  private roll = 0;
  private pitch = 0;
  protected drop = 0;
  /** Body drop the air ride is heading for (m); the body moves there gradually. */
  private dropTarget = 0;
  private airLevel = 0;
  private dressed = false;
  private nos = false;
  private plate: THREE.Mesh | null = null;
  private plateShown = '';
  private template: VehicleTemplate | null = null;
  private glow: THREE.Mesh | null = null;
  private glowColor: string | null = null;
  private glowHue = Math.random();

  constructor(look: VehicleLook, opts: { lod?: boolean } = {}) {
    this.look = look;
    this.vm = getModel(look.modelId);
    this.length = this.vm.shape.length;
    this.width = this.vm.shape.width;
    this.height = this.vm.shape.rideHeight + this.vm.shape.bodyHeight + this.vm.shape.cabinHeight;
    this.root.add(this.body, this.wheelRoot);
    this.body.add(this.driverMount);
    this.ready = vehicleTemplate(look.modelId, this.length, opts.lod)
      .then((t) => {
        if (this.disposed) return;
        this.attach(t);
        this.dress(this.look);
      })
      .catch((err) => console.warn(`vehicle model for ${look.modelId} failed to load`, err));
  }

  private attach(t: VehicleTemplate): void {
    const model = t.scene.clone(true);
    this.model = model;
    this.template = t;
    this.info = t.info;
    this.height = t.info.height;
    // Character origin is at its feet with the eyes 1.76 m up; seated, the eyes meet the seat's eye.
    this.driverMount.position.set(t.info.seat.x, t.info.seat.y - 1.72, t.info.seat.z - 0.05);
    this.paintKeys = (t.entry.paintMaterials ?? PAINT_MATERIALS).map((k) => k.toLowerCase());
    this.body.add(model);
    this.found(model);
    if (!this.isBike) {
      this.root.updateMatrixWorld(true);
      for (const w of this.wheels) this.wheelRoot.attach(w.pivot);
    }
  }

  /** Find the named parts in a fresh clone (wheels, door, exhausts...). */
  protected found(model: THREE.Group): void {
    const tips: THREE.Object3D[] = [];
    model.traverse((o) => {
      if (/^exhaust_\d$/.test(o.name)) tips.push(o);
    });
    this.flames = new Flames(tips);
    this.door = model.getObjectByName('door_fl') ?? null;
    this.cavity = model.getObjectByName('door_fl_cavity') ?? null;
    if (this.cavity) this.cavity.visible = false;
    this.doorR = model.getObjectByName('door_fr') ?? null;
    this.cavityR = model.getObjectByName('door_fr_cavity') ?? null;
    if (this.cavityR) this.cavityR.visible = false;
    this.mirrors = ['mirror_l', 'mirror_r'].map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
    for (const key of ['fl', 'fr', 'rl', 'rr', 'front', 'rear'] as const) {
      const pivot = model.getObjectByName(`wheel_${key}`);
      const spin = model.getObjectByName(`wheel_${key}_spin`);
      if (pivot && spin) this.wheels.push({ pivot, spin, front: key.startsWith('f'), left: key.endsWith('l') });
    }
  }

  /** Apply a look: paint, glass, lamps, rims, kits, stance. */
  protected dress(look: VehicleLook): void {
    const model = this.model;
    if (!model) return;
    this.thaw();
    this.signature = lookSignature(look);
    for (const m of this.owned) m.dispose();
    this.owned = [];
    this.paintMats = [];
    this.heads = [];
    this.tails = [];
    const dirt = 1 - Math.max(0, Math.min(100, look.condition.cleanliness)) / 100;
    const damage = Math.max(0, (45 - look.condition.body) / 45);
    const keys = this.paintKeys;
    const paint = this.own(paintMaterial(look, dirt, damage));
    this.paintMats.push(paint);
    const tint = Number(findOption(look.mods.tint)?.value ?? '0.25');
    const base = new THREE.Color(vehicleColor(look.color, look.mods));
    const light = base.r * 0.3 + base.g * 0.59 + base.b * 0.11 > 0.7;
    const swapped = new Map<THREE.Material, THREE.Material>();
    const rim = rimChoice(look);
    const kits = kitNodes(look.mods);
    const visit = (o: THREE.Object3D) => {
      if (o.parent?.name === 'kits') o.visible = kits.has(o.name);
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      // Originals are kept on the mesh so a new look starts from the model's own materials.
      const orig = (mesh.userData.orig as THREE.Material | undefined) ?? mesh.material;
      mesh.userData.orig = orig;
      const name = orig.name.toLowerCase();
      let next: THREE.Material = orig;
      if (keys.some((k) => name === k || name.includes(k)) && !name.includes('interior')) next = paint;
      else if (name === 'roof_contrast') next = swap(orig, (m) => (m as THREE.MeshStandardMaterial).color.set(light ? '#111215' : '#f3f3ef'));
      else if (name.includes('glass') || name.includes('window')) {
        next = swap(orig, (m) => {
          const g = m as THREE.MeshStandardMaterial;
          g.color.set(new THREE.Color('#1c2635').lerp(new THREE.Color('#05070b'), tint));
          g.transparent = true;
          g.opacity = 0.74 + tint * 0.25;
        });
      } else if (mesh.name === 'headlights' || name === 'headlight' || /head.?light/.test(name)) {
        next = swap(orig, (m) => (m.toneMapped = false), 'head');
        if (!this.heads.includes(next as THREE.MeshBasicMaterial)) this.heads.push(next as THREE.MeshBasicMaterial);
      } else if (mesh.name === 'taillights' || name === 'taillight' || /tail.?light|brake/.test(name)) {
        next = swap(orig, (m) => (m.toneMapped = false), 'tail');
        if (!this.tails.includes(next as THREE.MeshBasicMaterial)) this.tails.push(next as THREE.MeshBasicMaterial);
      } else if (rim && name === 'rim') {
        next = swap(orig, (m) => {
          const r = m as THREE.MeshStandardMaterial;
          r.color.set(rim.finish.color);
          r.metalness = rim.finish.metal;
          r.roughness = rim.finish.rough;
        });
      }
      mesh.material = next;
    };
    model.traverse(visit);
    this.wheelRoot.traverse(visit);
    function swap(orig: THREE.Material, edit: (m: THREE.Material) => void, tag = ''): THREE.Material {
      const key = orig;
      let m = swapped.get(key);
      if (!m) {
        m = orig.clone();
        edit(m);
        if (tag) m.userData.lamp = tag;
        swapped.set(key, m);
      }
      return m;
    }
    for (const m of swapped.values()) this.owned.push(m);
    // Aftermarket rims: swap the rim meshes for the chosen design (our models' wheels only).
    if (rim) void this.fitRims(rim.style);
    else this.restoreRims();
    // Stance: the body drops into the arches, wheels tilt with camber.
    const t = look.mods.tuning;
    this.setAir(look, !this.dressed);
    this.dressed = true;
    const camber = ((t?.camber ?? 0) * Math.PI) / 180;
    if (!this.isBike) for (const w of this.wheels) w.pivot.rotation.z = (w.left ? 1 : -1) * camber;
    this.applyBody();
    this.applyLights();
    this.setUnderglow(findOption(look.mods.underglow)?.value ?? 'none');
    this.applyStrip(look.mods.strip?.removed ?? []);
    this.setPlate(look);
    if (this.shot) {
      this.burnt = false;
      this.applyShot();
    }
  }

  /** Air ride height (or the garage stance): snap there, or let the body move there gradually. */
  private setAir(look: VehicleLook, snap: boolean): void {
    const t = look.mods.tuning;
    this.airLevel = look.mods.air ?? 0;
    const cm = hasAirRide(t) ? airDropCm(this.airLevel, t?.drop ?? 0) : (t?.drop ?? 0);
    this.dropTarget = Math.min(cm / 100, 0.12);
    if (snap) {
      this.drop = this.dropTarget;
      this.applyBody();
    }
  }

  /** Number plates front and back (motorcycles: back only), with the car's registration or custom text. */
  private setPlate(look: VehicleLook): void {
    const text = look.id ? plateText(look.id, look.mods) : (look.mods.plate ?? 'GETRICH');
    if (!this.template || text === this.plateShown) return;
    this.plateShown = text;
    if (!this.plate) {
      const geo = plateGeometry(this.template, this.isBike);
      if (!geo) return;
      this.plate = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.15 }));
      this.plate.name = 'plates';
      this.body.add(this.plate);
    }
    const mat = this.plate.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.map = plateTexture(text);
    mat.needsUpdate = true;
  }

  /** Parts stripped at the Sanayi: mirrors gone, doors gone (the openings show). */
  private applyStrip(removed: readonly string[]): void {
    this.stripped = removed;
    for (const m of this.mirrors) m.visible = !removed.includes('mirrors');
    this.doorsOff = removed.includes('doors');
    const shot = this.shot;
    const offL = this.doorsOff || !!shot?.doorL;
    const offR = this.doorsOff || !!shot?.doorR;
    if (this.door) this.door.visible = !offL;
    if (this.doorR) this.doorR.visible = !offR;
    if (this.cavity) this.cavity.visible = offL || this.doorOpen > 0.02;
    if (this.cavityR) this.cavityR.visible = offR;
  }

  private stripped: readonly string[] = [];
  private shot: VehicleDamageLook | null = null;
  private burnt = false;

  setShotDamage(d: VehicleDamageLook | null): void {
    const key = d ? `${d.glass}${d.bumper}${d.doorL}${d.doorR}${d.blown}` : '';
    const was = this.shot ? `${this.shot.glass}${this.shot.bumper}${this.shot.doorL}${this.shot.doorR}${this.shot.blown}` : '';
    this.shot = d;
    if (key === was) return;
    this.thaw();
    this.applyShot();
  }

  /** Show the bullet damage on the model (again after a re-dress). */
  private applyShot(): void {
    const d = this.shot;
    const model = this.model;
    if (!model) return;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const orig = (mesh.userData.orig as THREE.Material | undefined) ?? (mesh.material as THREE.Material);
      const name = `${mesh.name} ${Array.isArray(orig) ? '' : orig.name}`.toLowerCase();
      if (/glass|window/.test(name) && !/light|lamp/.test(name)) mesh.visible = !(d?.glass ?? false);
      if (/bumper/.test(name)) mesh.visible = !(d?.bumper ?? false);
    });
    this.applyStrip(this.stripped);
    // A burnt-out shell: everything goes dark.
    const burnt = !!d?.blown;
    if (burnt !== this.burnt) {
      this.burnt = burnt;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (!m.color) return;
        if (burnt) {
          mesh.userData.burntFrom ??= m.color.getHex();
          const c = m.clone();
          c.color.setHex(0x161412);
          if ('metalness' in c) c.metalness = 0.1;
          if ('roughness' in c) c.roughness = 0.95;
          mesh.userData.burntMat = c;
          mesh.userData.liveMat = mesh.material;
          mesh.material = c;
          this.owned.push(c);
        } else if (mesh.userData.liveMat) {
          mesh.material = mesh.userData.liveMat as THREE.Material;
          delete mesh.userData.liveMat;
        }
      });
    }
  }

  hoodPoint(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, this.height * 0.55, this.length * 0.32);
    return this.root.localToWorld(out);
  }

  /** Neon under the car: a soft additive glow on the road (brighter at night). */
  private setUnderglow(value: string): void {
    const want = value === 'none' ? null : value;
    if (want === this.glowColor) return;
    this.glowColor = want;
    if (this.glow) {
      (this.glow.material as THREE.Material).dispose();
      this.glow.geometry.dispose();
      this.glow.removeFromParent();
      this.glow = null;
    }
    if (!want || this.isBike) return;
    const mat = new THREE.MeshBasicMaterial({ map: underglowTexture(), color: want === 'rainbow' ? '#ff2bd6' : want === 'plasma' ? '#7a3cff' : want, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(this.width * 1.45, this.length * 1.12).rotateX(-Math.PI / 2), mat);
    glow.position.y = 0.035;
    glow.renderOrder = 2;
    glow.name = 'underglow';
    this.glow = glow;
    this.root.add(glow);
    this.applyLights();
  }

  private rimSwap = new Map<THREE.Mesh, THREE.BufferGeometry>();

  private async fitRims(style: string): Promise<void> {
    const rims = await rimTemplates().catch(() => null);
    const design = rims?.get(style);
    if (!design || !this.model) return;
    const face = design.getObjectByName('rim') as THREE.Mesh | undefined;
    if (!face) return;
    for (const w of this.wheels) {
      w.spin.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.name !== 'rim') return;
        if (!this.rimSwap.has(m)) this.rimSwap.set(m, m.geometry);
        m.geometry = face.geometry;
      });
    }
    this.frozenDirty();
  }

  private restoreRims(): void {
    for (const [m, g] of this.rimSwap) m.geometry = g;
    this.rimSwap.clear();
  }

  protected own<T extends THREE.Material>(m: T): T {
    this.owned.push(m);
    return m;
  }

  update(look: VehicleLook): void {
    this.look = look;
    if ((look.mods.air ?? 0) !== this.airLevel) this.setAir(look, false);
    this.setPlate(look);
    if (lookSignature(look) === this.signature) return;
    this.dress(look);
  }

  setNitro(on: boolean): void {
    if (on === this.nos) return;
    this.nos = on;
    if (on) this.thaw();
    this.flames?.nitro(on);
  }

  setMotion(roll: number, pitch: number): void {
    this.roll = roll;
    this.pitch = pitch;
    this.applyBody();
  }

  protected applyBody(): void {
    // The body rolls about the axle line and drops with lowered suspension; wheels stay planted.
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = -this.drop;
  }

  setLights(l: VehicleLights): void {
    if (l.brake === this.lights.brake && l.reverse === this.lights.reverse && Math.abs(l.night - this.lights.night) < 0.02) return;
    this.lights = { ...l };
    this.applyLights();
  }

  private applyLights(): void {
    const l = this.lights;
    if (this.glow) (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.32 + 0.68 * Math.min(1, l.night * 1.5);
    // Unlit lamp materials (not tone mapped): dimmer when off, full when on.
    const head = 0.72 + 0.28 * Math.min(1, l.night * 2);
    for (const m of this.heads) m.color.set(findOption(this.look.mods.headlights)?.value ?? '#fff4d6').multiplyScalar(head);
    const tail = l.brake ? 1 : 0.42 + 0.38 * Math.min(1, l.night * 2);
    for (const m of this.tails) {
      if (l.reverse) m.color.setRGB(0.95, 0.9, 0.85);
      else m.color.setRGB(tail, tail * 0.07, tail * 0.1);
    }
  }

  private passengers: THREE.Group[] = [];

  passengerMount(seat: number): THREE.Group {
    let g = this.passengers[seat];
    if (!g) {
      g = new THREE.Group();
      this.body.add(g);
      this.passengers[seat] = g;
    }
    // Placed from the driver's seat (the model may still be loading).
    const d = this.driverMount.position;
    const o = seatOffset(seat, d.x, this.length);
    g.position.set(o.x, d.y, d.z + o.dz);
    return g;
  }

  setDoor(open: number): void {
    const t = Math.max(0, Math.min(1, open));
    if (Math.abs(t - this.doorOpen) < 1e-3) return;
    this.doorOpen = t;
    if (t > 0) this.thaw();
    // The driver's door (left side, +x) swings out about its front hinge.
    if (this.door) this.door.rotation.y = -t * 1.15;
    if (this.cavity) this.cavity.visible = t > 0.02 || this.doorsOff;
  }

  pop(strength: number): void {
    this.flames?.pop(strength);
  }

  /** Never merged while true (e.g. a rider sits on it). */
  protected keepLive = false;

  animate(speed: number, steer: number, dt: number): void {
    const settling = Math.abs(this.drop - this.dropTarget) > 1e-4;
    const moving = Math.abs(speed) > 0.01 || Math.abs(steer) > 0.001 || this.doorOpen > 0 || this.keepLive || settling || this.nos;
    if (settling) {
      // Air ride: the bags fill or vent over a second or two.
      const step = dt * 0.075;
      this.drop = Math.abs(this.dropTarget - this.drop) <= step ? this.dropTarget : this.drop + Math.sign(this.dropTarget - this.drop) * step;
      this.applyBody();
    }
    if (moving) {
      this.still = 0;
      this.thaw();
    } else if (!this.frozen && this.model) {
      this.still += dt;
      if (this.still > FREEZE_DELAY) this.freeze();
    }
    this.wheelSpin += (speed / (this.info?.wheelR ?? 0.33)) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = steer;
    }
    this.flames?.update(dt);
    if (this.glow && this.glowColor === 'rainbow') {
      this.glowHue = (this.glowHue + dt * 0.18) % 1;
      (this.glow.material as THREE.MeshBasicMaterial).color.setHSL(this.glowHue, 1, 0.55);
    } else if (this.glow && this.glowColor === 'plasma') {
      // Plazma Neon: purple and cyan breathing into each other.
      this.glowHue = (this.glowHue + dt * 0.6) % 1;
      const k = 0.5 + 0.5 * Math.sin(this.glowHue * Math.PI * 2);
      (this.glow.material as THREE.MeshBasicMaterial).color.setRGB(0.48 * (1 - k), 0.24 + 0.66 * k, 1);
    }
  }

  // ---------------------------------------------------------------- merging parked vehicles

  private frozenDirty(): void {
    if (this.frozen) {
      this.thaw();
      this.still = 0;
    }
  }

  /** Merge every visible mesh per material into one (a parked car = a handful of draw calls). */
  private freeze(): void {
    const model = this.model;
    if (!model || this.frozen) return;
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    const collect = (o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const list = groups.get(m.material) ?? [];
      list.push(m);
      groups.set(m.material, list);
    };
    model.traverseVisible(collect);
    this.wheelRoot.traverseVisible(collect);
    const out = new THREE.Group();
    out.name = 'frozen';
    for (const [mat, meshes] of groups) {
      const std = mat as THREE.MeshStandardMaterial;
      const keep = ['position', 'normal', ...(std.vertexColors ? ['color'] : []), ...(std.map ? ['uv'] : [])];
      const geos: THREE.BufferGeometry[] = [];
      for (const m of meshes) {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
        if (keep.some((k) => !g.getAttribute(k))) {
          g.dispose();
          continue;
        }
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        geos.push(g);
      }
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = meshes.some((m) => m.castShadow);
      mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
      out.add(mesh);
    }
    this.frozen = out;
    this.root.add(out);
    model.visible = false;
    this.wheelRoot.visible = false;
  }

  private thaw(): void {
    if (!this.frozen) return;
    for (const c of this.frozen.children) (c as THREE.Mesh).geometry.dispose();
    this.frozen.removeFromParent();
    this.frozen = null;
    if (this.model) this.model.visible = true;
    this.wheelRoot.visible = true;
  }

  dispose(): void {
    this.disposed = true;
    this.thaw();
    this.setUnderglow('none');
    for (const m of this.owned) m.dispose();
    this.owned = [];
    if (this.plate) {
      const mat = this.plate.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
      this.plate = null;
    }
    this.root.removeFromParent();
  }

  /** Number of meshes drawn (parked vehicles should stay cheap). */
  get meshCount(): number {
    let n = 0;
    this.root.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  }
}

/** A car (or van, pickup, SUV...). */
export class VehicleView extends ModelView {
  readonly isBike = false;
}

/** A motorcycle: leans into corners (and onto the side stand when parked), a rider mount on the seat. */
export class BikeView extends ModelView {
  readonly isBike = true;
  /** The rider's character is parented here while riding (hips at the seat). */
  readonly riderMount = new THREE.Group();
  ridden = false;
  private fork: THREE.Object3D | null = null;
  private leanAngle = 0.14;

  constructor(look: VehicleLook) {
    super(look);
    this.body.add(this.riderMount);
    void this.ready.then(() => {
      const model = this.model;
      const seat = model?.getObjectByName('seat_rider');
      if (model && seat) {
        model.updateMatrixWorld(true);
        model.worldToLocal(seat.getWorldPosition(this.riderMount.position));
      }
    });
  }

  protected override found(model: THREE.Group): void {
    super.found(model);
    this.fork = model.getObjectByName('fork') ?? null;
  }

  override animate(speed: number, steer: number, dt: number): void {
    this.keepLive = this.ridden;
    super.animate(speed, 0, dt);
    if (this.fork) this.fork.rotation.y = steer * 0.9;
    // Lean into corners when moving; on the side stand when parked; nearly upright (foot down) when ridden.
    const target = Math.abs(speed) > 1.5 ? -steer * Math.min(1, Math.abs(speed) / 10) * 0.9 : this.ridden ? 0.03 : 0.14;
    this.leanAngle += (target - this.leanAngle) * Math.min(1, dt * 6);
    this.setMotion(this.leanAngle, 0);
  }
}

// ------------------------------------------------------------------ instanced traffic

/**
 * A whole model as two static geometries for instanced drawing (highway traffic): the body paint
 * (white, tinted per instance) and everything else with its colours baked into vertex colours.
 * Kit parts and the door opening are left out.
 */
export function bakeTemplate(t: VehicleTemplate): { paint: THREE.BufferGeometry; paint2: THREE.BufferGeometry | null; fixed: THREE.BufferGeometry } {
  const root = t.scene;
  root.updateMatrixWorld(true);
  const paint: THREE.BufferGeometry[] = [];
  const paint2: THREE.BufferGeometry[] = [];
  const fixed: THREE.BufferGeometry[] = [];
  const white = new THREE.Color(1, 1, 1);
  const keys = (t.entry.paintMaterials ?? PAINT_MATERIALS).map((k) => k.toLowerCase());
  const skip = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.name === 'kits' || p.name === 'door_fl_cavity' || p.name === 'door_fr_cavity') return true;
    return false;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || skip(mesh)) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const name = mat.name.toLowerCase();
    const isPaint2 = name === 'paint2';
    const isPaint = !isPaint2 && keys.some((k) => name === k || name.includes(k));
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    const base = isPaint || isPaint2 ? white : mat.color ?? white;
    const src = mat.vertexColors ? (g.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    // Lamps get a little brighter so they read as lamps without lighting.
    const boost = mat.type === 'MeshBasicMaterial' ? 1.4 : 1;
    for (let i = 0; i < n; i++) {
      col[i * 3] = Math.min(1, base.r * (src ? src.getX(i) : 1) * boost);
      col[i * 3 + 1] = Math.min(1, base.g * (src ? src.getY(i) : 1) * boost);
      col[i * 3 + 2] = Math.min(1, base.b * (src ? src.getZ(i) : 1) * boost);
    }
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (isPaint2 ? paint2 : isPaint ? paint : fixed).push(g);
  });
  const merge = (list: THREE.BufferGeometry[]) => {
    const m = mergeGeometries(list, false) ?? new THREE.BufferGeometry();
    for (const g of list) g.dispose();
    return m;
  };
  return { paint: merge(paint), paint2: paint2.length ? merge(paint2) : null, fixed: merge(fixed) };
}

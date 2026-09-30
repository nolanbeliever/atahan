// Loads vehicle models (.glb / .gltf, Draco supported) with GLTFLoader + DRACOLoader and prepares a
// fitted template per vehicle: facing +z, scaled to the vehicle's real length, centred, tyres on the
// road (y = 0), with its wheels, door, seat, exhausts, lamps and kit parts found by name. Views clone
// the template (geometry and most materials are shared).

import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HQ_MODEL_FILES } from 'virtual:hq-models';
import { CUSTOM_MODEL_DIR, LEGACY_HQ_FILES, PAINT_MATERIALS, PART_MODELS, highDetailVehicles, type HighDetailVehicle } from '../data/highDetailVehicles';

const customFiles = new Set(HQ_MODEL_FILES.map((f) => f.toLowerCase()));
const entries = new Map(highDetailVehicles.map((e) => [e.vehicleId, e]));

/** The model entry for a vehicle: a dropped-in custom file wins over the registry entry. */
export function modelEntry(vehicleId: string): HighDetailVehicle | null {
  const base = entries.get(vehicleId);
  const off = (globalThis as { location?: { search: string } }).location;
  const allowCustom = !off || new URLSearchParams(off.search).get('hq') !== '0';
  if (allowCustom) {
    const own = `${vehicleId}.glb`.toLowerCase();
    if (customFiles.has(own)) return { ...(base ?? fallbackEntry(vehicleId)), id: `${vehicleId}_custom`, modelUrl: `${CUSTOM_MODEL_DIR}${vehicleId}.glb`, lodUrl: null, autoFit: true, credit: 'custom model' };
    for (const [file, legacy] of Object.entries(LEGACY_HQ_FILES)) {
      if (legacy.vehicleId === vehicleId && customFiles.has(file)) {
        return { ...(base ?? fallbackEntry(vehicleId)), id: `${vehicleId}_hq`, modelUrl: `${CUSTOM_MODEL_DIR}${file}`, lodUrl: null, autoFit: true, rotationOffset: legacy.rotationOffset ?? { x: 0, y: 0, z: 0 } };
      }
    }
  }
  return base ?? null;
}

function fallbackEntry(vehicleId: string): HighDetailVehicle {
  return { id: vehicleId, vehicleId, name: vehicleId, modelUrl: '', scale: 1, rotationOffset: { x: 0, y: 0, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT_MATERIALS };
}

let loader: Promise<GLTFLoader> | null = null;

function getLoader(): Promise<GLTFLoader> {
  loader ??= Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/loaders/DRACOLoader.js')]).then(([g, d]) => {
    // The glTF Draco decoder (wasm) ships with the build (three bundles it via import.meta.url).
    const draco = new d.DRACOLoader();
    draco.setDecoderPath(d.DRACO_GLTF_CONFIG);
    const l = new g.GLTFLoader();
    l.setDRACOLoader(draco);
    return l;
  });
  return loader;
}

const files = new Map<string, Promise<THREE.Group>>();

/** The raw scene of a model file (loaded once). */
export function loadScene(url: string): Promise<THREE.Group> {
  let p = files.get(url);
  if (!p) {
    p = getLoader()
      .then((l) => l.loadAsync(url))
      .then((g) => g.scene);
    // A failed download is retried the next time.
    p.catch(() => files.delete(url));
    files.set(url, p);
  }
  return p;
}

export type WheelKey = 'fl' | 'fr' | 'rl' | 'rr' | 'front' | 'rear';

export interface TemplateInfo {
  /** Real size of the fitted model (m). */
  length: number;
  width: number;
  height: number;
  /** Wheel radius (m) and whether the model has spinning wheels. */
  wheelR: number;
  /** Local positions of lamps (for glows). */
  heads: THREE.Vector3[];
  tails: THREE.Vector3[];
  /** Driver's eye (local) - from seat_driver or estimated. */
  seat: THREE.Vector3;
  /** The model brings its own cockpit. */
  interior: boolean;
}

export interface VehicleTemplate {
  scene: THREE.Group;
  entry: HighDetailVehicle;
  info: TemplateInfo;
}

const WHEEL_NAMES: Record<WheelKey, RegExp> = {
  fl: /(wheel|tire|tyre)[\s_.-]*(fl|front[\s_.-]*left|left[\s_.-]*front|lf)\b/i,
  fr: /(wheel|tire|tyre)[\s_.-]*(fr|front[\s_.-]*right|right[\s_.-]*front|rf)\b/i,
  rl: /(wheel|tire|tyre)[\s_.-]*(rl|bl|rear[\s_.-]*left|back[\s_.-]*left|left[\s_.-]*rear|lr)\b/i,
  rr: /(wheel|tire|tyre)[\s_.-]*(rr|br|rear[\s_.-]*right|back[\s_.-]*right|right[\s_.-]*rear)\b/i,
  front: /^wheel_front$/i,
  rear: /^wheel_rear$/i,
};

/** Bounding box of the visible body (kit parts, door opening and helpers excluded). */
export function bodyBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const skip = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.name === 'kits' || p.name === 'door_fl_cavity' || p.name === 'cockpit') return true;
    return false;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip(m)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
    box.union(tmp);
  });
  return box;
}

function findNode(root: THREE.Object3D, test: (name: string) => boolean): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && o !== root && test(o.name)) hit = o;
  });
  return hit;
}

/**
 * Make sure a wheel turns about its own centre: our models already have a pivot named wheel_xx with
 * a wheel_xx_spin child; other models get a pivot group inserted at the wheel's centre.
 */
function pivotWheel(root: THREE.Object3D, node: THREE.Object3D, key: WheelKey): void {
  if (node.name === `wheel_${key}` && node.getObjectByName(`wheel_${key}_spin`)) return;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(node);
  const centre = box.getCenter(new THREE.Vector3());
  const parent = node.parent!;
  const pivot = new THREE.Group();
  pivot.name = `wheel_${key}`;
  const spin = new THREE.Group();
  spin.name = `wheel_${key}_spin`;
  pivot.add(spin);
  parent.worldToLocal(pivot.position.copy(centre));
  parent.add(pivot);
  pivot.updateMatrixWorld(true);
  spin.attach(node);
}

const templates = new Map<string, Promise<VehicleTemplate>>();

/**
 * The fitted template of a vehicle model. `length` is the real length it must have (the
 * catalogue's; 0 keeps the model's own size), `lod` asks for the simplified copy when there is one.
 */
export function vehicleTemplate(vehicleId: string, length: number, lod = false): Promise<VehicleTemplate> {
  const entry = modelEntry(vehicleId);
  if (!entry || !entry.modelUrl) return Promise.reject(new Error(`No model for ${vehicleId}`));
  const url = lod && entry.lodUrl ? entry.lodUrl : entry.modelUrl;
  const key = `${url}|${length}`;
  let p = templates.get(key);
  if (!p) {
    p = loadScene(url).then((raw) => fitTemplate(raw.clone(true), entry, length));
    p.catch(() => templates.delete(key));
    templates.set(key, p);
  }
  return p;
}

/** Fit a loaded model scene to a vehicle (exported for tests). */
export function fitTemplate(scene: THREE.Group, entry: HighDetailVehicle, length: number): VehicleTemplate {
  const holder = new THREE.Group();
  holder.name = entry.vehicleId;
  const inner = new THREE.Group();
  holder.add(inner);
  inner.add(scene);
  const r = entry.rotationOffset;
  scene.rotation.set(r.x, r.y, r.z);
  const autoFit = entry.autoFit !== false;
  // Scale to the real length.
  let box = bodyBox(holder);
  const size = box.getSize(new THREE.Vector3());
  const s = autoFit && size.z > 1e-6 && length > 0 ? (length / size.z) * entry.scale : entry.scale;
  inner.scale.setScalar(s);
  // Wheels: pivot groups at their centres (named per our convention or recognised by name).
  const found = new Map<WheelKey, THREE.Object3D>();
  for (const key of Object.keys(WHEEL_NAMES) as WheelKey[]) {
    const wanted = entry.nodes?.wheels?.[key];
    const node = wanted ? findNode(holder, (n) => n === wanted) : findNode(holder, (n) => n === `wheel_${key}`) ?? findNode(holder, (n) => WHEEL_NAMES[key].test(n));
    if (node) found.set(key, node);
  }
  for (const [key, node] of found) pivotWheel(holder, node, key);
  // Tyres on the road: the lowest point of the wheels (or of the body) goes to y = 0.
  holder.updateMatrixWorld(true);
  box = bodyBox(holder);
  let ground = box.min.y;
  if (found.size > 0) {
    const wb = new THREE.Box3();
    for (const key of found.keys()) wb.union(new THREE.Box3().setFromObject(holder.getObjectByName(`wheel_${key}`)!));
    if (Number.isFinite(wb.min.y)) ground = wb.min.y;
  }
  const c = box.getCenter(new THREE.Vector3());
  if (autoFit) inner.position.set(-c.x, -ground, -c.z);
  holder.updateMatrixWorld(true);
  box = bodyBox(holder);
  const fitted = box.getSize(new THREE.Vector3());
  // Shadows.
  holder.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = entry.castShadow;
    m.receiveShadow = entry.receiveShadow;
  });
  // Lamps and seat.
  const centreOf = (o: THREE.Object3D) => holder.worldToLocal(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()));
  const lamps = (name: string, fallbackZ: number, fallbackY: number): THREE.Vector3[] => {
    const node = findNode(holder, (n) => n === name);
    if (node) {
      const b = new THREE.Box3().setFromObject(node);
      const cz = (b.min.z + b.max.z) / 2;
      const cy = (b.min.y + b.max.y) / 2;
      const hx = Math.max(0.2, (b.max.x - b.min.x) / 2 - 0.12);
      return [new THREE.Vector3(hx, cy, cz), new THREE.Vector3(-hx, cy, cz)];
    }
    return [new THREE.Vector3(fitted.x * 0.34, fallbackY, fallbackZ), new THREE.Vector3(-fitted.x * 0.34, fallbackY, fallbackZ)];
  };
  const seatNode = entry.nodes?.seat ? findNode(holder, (n) => n === entry.nodes!.seat) : findNode(holder, (n) => n === 'seat_driver');
  const seat = seatNode ? centreOf(seatNode) : new THREE.Vector3(fitted.x * 0.2, Math.min(fitted.y - 0.25, 1.15), fitted.z * 0.02);
  let wheelR = 0.33;
  const w = holder.getObjectByName('wheel_fl') ?? holder.getObjectByName('wheel_front');
  if (w) wheelR = new THREE.Box3().setFromObject(w).getSize(new THREE.Vector3()).y / 2;
  return {
    scene: holder,
    entry,
    info: {
      length: fitted.z,
      width: fitted.x,
      height: fitted.y,
      wheelR,
      heads: lamps('headlights', fitted.z / 2 - 0.05, 0.72),
      tails: lamps('taillights', -fitted.z / 2 + 0.05, 0.85),
      seat,
      interior: !!entry.interior,
    },
  };
}

// ------------------------------------------------------------------ shared parts

/** Aftermarket rim designs (unit size), by style name. */
export function rimTemplates(): Promise<Map<string, THREE.Object3D>> {
  return loadScene(PART_MODELS.rims).then((scene) => {
    const out = new Map<string, THREE.Object3D>();
    for (const c of scene.children) if (c.name.startsWith('rim_')) out.set(c.name.slice(4), c);
    return out;
  });
}

/** The generic cockpit interior (origin: car centre line at the driver's eye). */
export function cockpitTemplate(): Promise<THREE.Group> {
  return loadScene(PART_MODELS.cockpit);
}

/** Start downloading a vehicle's model early (e.g. when a listing is shown). */
export function preloadVehicle(vehicleId: string, length: number): void {
  void vehicleTemplate(vehicleId, length).catch(() => undefined);
}

// Loads high-detail vehicle models (.glb, Draco supported) with GLTFLoader + DRACOLoader, fits them
// to the vehicle's real size and hands out recoloured copies. The loaders are only downloaded when a
// model is actually used, and only files that exist (virtual:hq-models) are ever requested.

import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HQ_MODEL_FILES } from 'virtual:hq-models';
import { highDetailVehicles, type HighDetailVehicle } from '../data/highDetailVehicles';

const available = new Set(HQ_MODEL_FILES.map((f) => f.toLowerCase()));

function fileName(url: string): string {
  return url.split('/').pop()!.split('?')[0]!.toLowerCase();
}

/** The HQ model for a catalogue vehicle, if its file has been added. `?hq=0` turns them off. */
export function hqEntryFor(vehicleId: string): HighDetailVehicle | null {
  const loc = (globalThis as { location?: { search: string } }).location;
  if (loc && new URLSearchParams(loc.search).get('hq') === '0') return null;
  const e = highDetailVehicles.find((v) => v.vehicleId === vehicleId);
  return e && available.has(fileName(e.modelUrl)) ? e : null;
}

let loader: Promise<GLTFLoader> | null = null;

function getLoader(): Promise<GLTFLoader> {
  loader ??= Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/loaders/DRACOLoader.js')]).then(([g, d]) => {
    // The glTF-only Draco decoder (wasm) ships with the build (three bundles it via import.meta.url).
    const draco = new d.DRACOLoader();
    draco.setDecoderPath(d.DRACO_GLTF_CONFIG);
    const l = new g.GLTFLoader();
    l.setDRACOLoader(draco);
    return l;
  });
  return loader;
}

interface Prepared {
  scene: THREE.Group;
  paint: Set<THREE.Material>;
}

const cache = new Map<string, Promise<Prepared>>();

/**
 * Fit a loaded model to a vehicle: rotate it to face +z, scale it to the vehicle's length, centre it
 * on x/z and stand it on y = 0. Returns the materials that take the paint colour.
 */
export function fitModel(scene: THREE.Object3D, entry: HighDetailVehicle, length: number): Set<THREE.Material> {
  const r = entry.rotationOffset;
  scene.rotation.set(r.x, r.y, r.z);
  scene.scale.setScalar(1);
  scene.position.set(0, 0, 0);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const s = size.z > 1e-6 ? (length / size.z) * entry.scale : entry.scale;
  scene.scale.setScalar(s);
  scene.updateMatrixWorld(true);
  box.setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  scene.position.set(-c.x, -box.min.y, -c.z);
  const paint = new Set<THREE.Material>();
  const keys = (entry.paintMaterials ?? []).map((k) => k.toLowerCase());
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = entry.castShadow;
    mesh.receiveShadow = entry.receiveShadow;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (keys.length && keys.some((k) => m.name.toLowerCase().includes(k))) paint.add(m);
    }
  });
  return paint;
}

function prepare(entry: HighDetailVehicle, length: number): Promise<Prepared> {
  const key = `${entry.id}:${length}`;
  let p = cache.get(key);
  if (!p) {
    p = getLoader()
      .then((l) => l.loadAsync(entry.modelUrl))
      .then((gltf) => {
        const holder = new THREE.Group();
        holder.add(gltf.scene);
        const paint = fitModel(gltf.scene, entry, length);
        return { scene: holder, paint };
      });
    // A failed download is retried the next time the vehicle is shown.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** A fitted copy of the model, with its own paint materials set to `color` (if it has paint). */
export async function loadHqVehicle(entry: HighDetailVehicle, length: number, color: string): Promise<{ root: THREE.Group; setColor: (c: string) => void; dispose: () => void }> {
  const prepared = await prepare(entry, length);
  const root = prepared.scene.clone(true);
  root.userData.hq = true;
  const own = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      if (!prepared.paint.has(m)) return m;
      let c = own.get(m);
      if (!c) own.set(m, (c = m.clone()));
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  const setColor = (hex: string) => {
    for (const m of own.values()) (m as THREE.MeshStandardMaterial).color?.set(hex);
  };
  setColor(color);
  return {
    root,
    setColor,
    dispose: () => {
      for (const m of own.values()) m.dispose();
      root.removeFromParent();
    },
  };
}

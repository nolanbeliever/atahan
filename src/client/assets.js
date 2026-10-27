// Optional imported GLB/GLTF models (see ASSETS.md). Each entry is loaded lazily;
// if a file is missing or fails, the game keeps using its procedural model.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_FILES = {
  // user-supplied Toyota Hilux, used for the drivable pickup truck
  pickup: { url: 'models/hilux/hilux.gltf', length: 5.2, yaw: 0 },
};

const cache = new Map();
const loader = new GLTFLoader();

export function loadModel(key) {
  if (cache.has(key)) return cache.get(key);
  const def = MODEL_FILES[key];
  if (!def) return Promise.resolve(null);
  const p = new Promise((resolve) => {
    loader.load(import.meta.env.BASE_URL + def.url, (gltf) => resolve(prepare(gltf.scene, def)), undefined, (err) => { console.warn(`Model ${key} unavailable, using procedural fallback`, err && err.message); resolve(null); });
  });
  cache.set(key, p);
  return p;
}

// Normalise: forward = +z, length = def.length, wheels on y = 0, centred on x/z.
function prepare(root, def) {
  root.rotation.y = def.yaw || 0;
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  // the longest horizontal axis is the vehicle's length; rotate so it lies along z
  if (size.x > size.z) { root.rotation.y += Math.PI / 2; root.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(root); box.getSize(size); }
  const s = def.length / size.z;
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x; root.position.z -= c.z; root.position.y -= box.min.y;
  const holder = new THREE.Group();
  holder.add(root);
  const wheels = [];
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.map) m.map.anisotropy = 4; if (m.transparent && m.opacity > 0.9) m.transparent = false; }
    }
    if (/wheel|tire|tyre|rim/i.test(o.name) && !wheels.some(w => isAncestor(w, o))) wheels.push(o);
  });
  return { holder, wheels, size: new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3()) };
}

// ---------------------------------------------------------------- weapons
// Converted from the user's OBJ files with tools/obj2glb.mjs. Oriented so the barrel
// points along -z (camera forward) with the grip below; `flip`/`rot` fix source axes.
export const WEAPON_FILES = {
  pistol: { url: 'models/weapons/glock19.glb', length: 0.19, flip: true, skipLow: true }, // source barrel points +z: flip so it faces away from the player
  m4: { url: 'models/weapons/m4a1.glb', length: 0.86, flip: false },
};
const wcache = new Map();
const wready = new Map();
export function loadWeapon(id, quality) {
  const def = WEAPON_FILES[id];
  if (!def || (def.skipLow && quality === 'low')) return Promise.resolve(null);
  if (wcache.has(id)) return wcache.get(id);
  const p = new Promise((resolve) => {
    loader.load(import.meta.env.BASE_URL + def.url, (gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      // longest axis -> z
      if (size.x >= size.y && size.x >= size.z) root.rotation.y = Math.PI / 2;
      else if (size.y >= size.x && size.y >= size.z) root.rotation.x = Math.PI / 2;
      if (def.rot) root.rotation.set(...def.rot);
      root.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(root); box.getSize(size);
      root.scale.multiplyScalar(def.length / Math.max(size.x, size.y, size.z));
      root.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      root.position.sub(c);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.frustumCulled = false;
        // no environment map in the viewmodel scene: keep metals from rendering black
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.metalness = Math.min(m.metalness, 0.35); m.roughness = Math.max(m.roughness, 0.35); if (m.map) m.map.anisotropy = 4; }
      });
      const holder = new THREE.Group();
      const inner = new THREE.Group(); inner.add(root);
      if (def.flip) inner.rotation.y = Math.PI;
      holder.add(inner);
      wready.set(id, holder);
      resolve(holder);
    }, undefined, (err) => { console.warn(`Weapon model ${id} unavailable`, err && err.message); resolve(null); });
  });
  wcache.set(id, p);
  return p;
}
export function weaponModel(id) { const h = wready.get(id); return h ? h.clone(true) : null; }

function isAncestor(a, b) { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; }

// Fresh copy for one vehicle (materials are shared; geometry is shared).
export function instantiate(model) {
  const holder = model.holder.clone(true);
  const wheels = [];
  holder.traverse((o) => { if (/wheel|tire|tyre|rim/i.test(o.name) && !wheels.some(w => isAncestor(w, o))) wheels.push(o); });
  // wheel pivots: rotate each wheel about its own centre
  const pivots = wheels.map((w) => {
    w.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3());
    holder.updateMatrixWorld(true);
    const local = holder.worldToLocal(c.clone());
    return { node: w, base: w.quaternion.clone(), front: local.z > 0, centre: local };
  });
  return { holder, pivots };
}

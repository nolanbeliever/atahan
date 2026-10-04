// Merges static meshes that share a material into a single draw call.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Bake world transforms of all plain meshes under `root` and merge them per material.
 * Meshes with multi-materials, instanced meshes, sprites and anything listed in `keep` are left untouched.
 */
export function batchStatic(root: THREE.Object3D, keep: Set<THREE.Object3D> = new Set()): void {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  const skip = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (keep.has(p)) return true;
    return false;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || skip(mesh)) return;
    const list = groups.get(mesh.material) ?? [];
    list.push(mesh);
    groups.set(mesh.material, list);
  });
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const mixed = meshes.some((m) => !m.geometry.index);
    const geos: THREE.BufferGeometry[] = [];
    let cast = false;
    let receive = false;
    for (const m of meshes) {
      const g = mixed && m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld));
      geos.push(g);
      cast ||= m.castShadow;
      receive ||= m.receiveShadow;
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    for (const m of meshes) m.parent?.remove(m);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
}

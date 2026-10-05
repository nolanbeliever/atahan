// The two villas in the south of the green belt (shared/compounds.ts VILLAS; night burglary
// targets): a modern two-storey house each, white render and dark timber, big glass windows (a few
// lit at night), a flat roof with an overhang, the front door with a lamp either side, and round it
// a walled garden with a lawn, hedges, a gate and a pool at the back.

import * as THREE from 'three';
import { VILLAS, type Villa } from '../../../shared/compounds';
import { surfaceY } from './City';
import { lightGlowTexture } from './Highway';

export class VillasView {
  readonly group = new THREE.Group();
  private lamps: THREE.Sprite[] = [];
  private lit: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.group.name = 'villas';
    this.lit = new THREE.MeshStandardMaterial({ color: '#2a3542', emissive: '#ffcf8a', emissiveIntensity: 0, roughness: 0.1, metalness: 0.3 });
    for (const v of VILLAS) this.build(v);
    scene.add(this.group);
  }

  private build(v: Villa): void {
    const render = new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.85 });
    const timber = new THREE.MeshStandardMaterial({ color: '#5a3b26', roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: '#22303d', roughness: 0.08, metalness: 0.5 });
    const roof = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.8 });
    const stone = new THREE.MeshStandardMaterial({ color: '#d9d2c3', roughness: 0.9 });
    const lawn = new THREE.MeshStandardMaterial({ color: '#4f8a3a', roughness: 1 });
    const hedge = new THREE.MeshStandardMaterial({ color: '#2f6b2a', roughness: 1 });
    const b = v.box;
    const g = v.garden;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const y0 = surfaceY(cx, cz);
    const root = new THREE.Group();
    root.position.set(0, y0, 0);
    this.group.add(root);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    // The lawn inside the garden wall.
    add(new THREE.PlaneGeometry(g.maxX - g.minX - 0.8, g.maxZ - g.minZ - 0.8).rotateX(-Math.PI / 2), lawn, (g.minX + g.maxX) / 2, 0.02, (g.minZ + g.maxZ) / 2, false);
    // Ground floor (the full footprint) and the upper floor (set back, overhanging at the front).
    add(new THREE.BoxGeometry(w, 3.6, d), render, cx, 1.8, cz);
    add(new THREE.BoxGeometry(w * 0.72, 3.2, d * 0.8), render, cx + w * 0.12, 3.6 + 1.6, cz + d * 0.05);
    // Roofs with an overhang.
    add(new THREE.BoxGeometry(w + 1.2, 0.3, d + 1.2), roof, cx, 3.75, cz);
    add(new THREE.BoxGeometry(w * 0.72 + 1.4, 0.3, d * 0.8 + 1.4), roof, cx + w * 0.12, 6.95, cz + d * 0.05);
    // A timber-clad block at the front corner.
    add(new THREE.BoxGeometry(w * 0.28, 3.6, 0.3), timber, b.minX + w * 0.14, 1.8, b.minZ - 0.12);
    // Big windows along the front of both floors (a few lit at night), glass doors at the back.
    const front = b.minZ - 0.03;
    for (let i = 0; i < 3; i++) {
      const x = b.minX + w * 0.42 + i * w * 0.18;
      add(new THREE.BoxGeometry(w * 0.14, 2.2, 0.06), i === 1 ? this.lit : glass, x, 1.7, front, false);
    }
    for (let i = 0; i < 3; i++) {
      const x = cx + w * 0.12 - w * 0.24 + i * w * 0.24;
      add(new THREE.BoxGeometry(w * 0.16, 1.9, 0.06), i === 0 ? this.lit : glass, x, 5.2, cz + d * 0.05 - d * 0.4 - 0.03, false);
    }
    add(new THREE.BoxGeometry(w * 0.6, 2.6, 0.06), glass, cx, 1.5, b.maxZ + 0.03, false);
    // The front door with a lamp either side.
    add(new THREE.BoxGeometry(1.4, 2.5, 0.1), timber, v.door.x, 1.25, front - 0.04);
    add(new THREE.BoxGeometry(0.06, 0.4, 0.08), new THREE.MeshStandardMaterial({ color: '#c9a45c', metalness: 0.9, roughness: 0.3 }), v.door.x + 0.5, 1.2, front - 0.12);
    for (const k of [-1, 1]) {
      const lx = v.door.x + k * 1.2;
      add(new THREE.BoxGeometry(0.16, 0.3, 0.12), new THREE.MeshStandardMaterial({ color: '#1d1f24', emissive: '#ffcf8a', emissiveIntensity: 1.2 }), lx, 2.3, front - 0.08, false);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: '#ffcf8a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      glow.position.set(lx, y0 + 2.3, front - 0.3);
      glow.scale.setScalar(1.6);
      this.group.add(glow);
      this.lamps.push(glow);
    }
    // The garden wall (with a gap at the gate) and gate posts; hedges inside it.
    const t = 0.4;
    const wallH = 1.5;
    for (const [x0, x1, z0, z1] of [
      [g.minX, v.door.x - 2, g.minZ, g.minZ + t],
      [v.door.x + 2, g.maxX, g.minZ, g.minZ + t],
      [g.minX, g.maxX, g.maxZ - t, g.maxZ],
      [g.minX, g.minX + t, g.minZ, g.maxZ],
      [g.maxX - t, g.maxX, g.minZ, g.maxZ],
    ] as const) {
      add(new THREE.BoxGeometry(x1 - x0, wallH, z1 - z0), stone, (x0 + x1) / 2, wallH / 2, (z0 + z1) / 2);
      add(new THREE.BoxGeometry(x1 - x0 + 0.1, 0.08, z1 - z0 + 0.1), new THREE.MeshStandardMaterial({ color: '#bfb7a6', roughness: 0.8 }), (x0 + x1) / 2, wallH + 0.04, (z0 + z1) / 2);
    }
    for (const k of [-1, 1]) add(new THREE.BoxGeometry(0.6, 2, 0.6), stone, v.door.x + k * 2.3, 1, g.minZ + 0.2);
    for (const [x0, x1, z] of [
      [g.minX + 0.6, v.door.x - 2.6, g.minZ + 1.1],
      [v.door.x + 2.6, g.maxX - 0.6, g.minZ + 1.1],
    ] as const)
      add(new THREE.BoxGeometry(x1 - x0, 0.9, 0.8), hedge, (x0 + x1) / 2, 0.45, z);
    // A path to the door and the pool at the back.
    add(new THREE.PlaneGeometry(2.2, b.minZ - g.minZ).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#cfc8b8', roughness: 0.9 }), v.door.x, 0.03, (g.minZ + b.minZ) / 2, false);
    const pool = add(new THREE.BoxGeometry(w * 0.5, 0.1, 3.2), new THREE.MeshStandardMaterial({ color: '#3fa9d6', emissive: '#0b5e85', emissiveIntensity: 0.4, roughness: 0.05, metalness: 0.2 }), cx, 0.06, b.maxZ + 3.2, false);
    pool.receiveShadow = true;
  }

  update(night: number): void {
    this.lit.emissiveIntensity = 0.9 * night;
    for (const l of this.lamps) l.material.opacity = 0.15 + 0.6 * night;
  }
}

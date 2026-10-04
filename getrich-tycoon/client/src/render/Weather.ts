// Rain and wet roads. Rain streaks fall in a box that follows the camera; road materials register
// here and get darker, glossier and more reflective as the road gets wet.

import * as THREE from 'three';

const roads: THREE.MeshStandardMaterial[] = [];

/** Register an asphalt material so it looks wet in the rain. */
export function registerRoad(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.userData.dry = { color: mat.color.clone(), roughness: mat.roughness, metalness: mat.metalness, env: mat.envMapIntensity };
  roads.push(mat);
  return mat;
}

let shownWet = -1;

/** 0 dry - 1 soaked: darker, glossier asphalt that mirrors the sky and lights. */
export function setRoadWetness(w: number): void {
  const k = Math.round(Math.max(0, Math.min(1, w)) * 50) / 50;
  if (k === shownWet) return;
  shownWet = k;
  for (const m of roads) {
    const dry = m.userData.dry as { color: THREE.Color; roughness: number; metalness: number; env: number };
    m.color.copy(dry.color).multiplyScalar(1 - 0.38 * k);
    m.roughness = dry.roughness * (1 - 0.68 * k);
    m.metalness = dry.metalness + 0.22 * k;
    m.envMapIntensity = dry.env + 1.6 * k;
  }
}

const BOX = { x: 70, y: 34, z: 70 };

export class Rain {
  readonly mesh: THREE.LineSegments;
  private pos: Float32Array;
  private drops: Float32Array;
  private count: number;
  private mat: THREE.LineBasicMaterial;
  private wind = new THREE.Vector2(1.2, 0.6);

  constructor(count = 1800) {
    this.count = count;
    this.drops = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.drops[i * 3 + 1] = Math.random() * BOX.y;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
    }
    this.pos = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: '#c8d4e6', transparent: true, opacity: 0, depthWrite: false, fog: true });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
  }

  /** Rain strength 0-1, quality share of drops to draw (0-1). */
  update(dt: number, camera: THREE.Camera, amount: number, quality = 1): void {
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    this.mat.opacity = 0.18 + 0.32 * amount;
    const active = Math.max(1, Math.floor(this.count * Math.min(1, amount * 1.2) * quality));
    const fall = 24 + amount * 6;
    const len = 0.55 + amount * 0.5;
    const c = camera.position;
    const d = this.drops;
    const p = this.pos;
    for (let i = 0; i < active; i++) {
      let y = d[i * 3 + 1]! - fall * dt;
      let x = d[i * 3]! + this.wind.x * dt;
      let z = d[i * 3 + 2]! + this.wind.y * dt;
      if (y < 0) {
        y += BOX.y;
        x = (Math.random() - 0.5) * BOX.x;
        z = (Math.random() - 0.5) * BOX.z;
      }
      d[i * 3] = x;
      d[i * 3 + 1] = y;
      d[i * 3 + 2] = z;
      // Drops live in a box around the camera (wrapped so they never run out).
      const wx = c.x + (((x - c.x + BOX.x * 0.5) % BOX.x) + BOX.x) % BOX.x - BOX.x * 0.5;
      const wz = c.z + (((z - c.z + BOX.z * 0.5) % BOX.z) + BOX.z) % BOX.z - BOX.z * 0.5;
      const wy = c.y - BOX.y * 0.45 + y;
      p[i * 6] = wx;
      p[i * 6 + 1] = wy;
      p[i * 6 + 2] = wz;
      p[i * 6 + 3] = wx - this.wind.x * 0.03;
      p[i * 6 + 4] = wy + len;
      p[i * 6 + 5] = wz - this.wind.y * 0.03;
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, active * 2);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

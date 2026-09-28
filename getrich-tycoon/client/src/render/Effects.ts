// Floating texts and sparkle bursts.

import * as THREE from 'three';
import { Label } from './Labels';

interface Floater {
  label: Label;
  life: number;
  max: number;
  vy: number;
}

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
}

export class Effects {
  private floaters: Floater[] = [];
  private bursts: Burst[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  floatText(text: string, pos: THREE.Vector3, color = '#2ee59d'): void {
    const label = new Label(text, { color, bg: 'rgba(0,0,0,0)', height: 0.7 });
    label.sprite.position.copy(pos);
    this.scene.add(label.sprite);
    this.floaters.push({ label, life: 0, max: 1.8, vy: 1.4 });
  }

  sparkle(pos: THREE.Vector3, color = '#ffd35a', count = 60): void {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const up = 2 + Math.random() * 5;
      const out = 1 + Math.random() * 3;
      velocities[i * 3] = Math.cos(a) * out;
      velocities[i * 3 + 1] = up;
      velocities[i * 3 + 2] = Math.sin(a) * out;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.22, transparent: true, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: 0 });
  }

  update(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.life += dt;
      f.label.sprite.position.y += f.vy * dt;
      (f.label.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - f.life / f.max);
      if (f.life >= f.max) {
        this.scene.remove(f.label.sprite);
        f.label.dispose();
        this.floaters.splice(i, 1);
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.life += dt;
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let k = 0; k < arr.length; k += 3) {
        b.velocities[k + 1]! -= 9 * dt;
        arr[k]! += b.velocities[k]! * dt;
        arr[k + 1]! += b.velocities[k + 1]! * dt;
        arr[k + 2]! += b.velocities[k + 2]! * dt;
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.life / 1.4);
      if (b.life > 1.4) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}

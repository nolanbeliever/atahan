// Headlights for driven vehicles: lamp glows and a pool of light on the road at night, and a
// full-beam flash when the driver flashes / honks at traffic.

import * as THREE from 'three';
import { lightGlowTexture } from './Highway';

const beamMat = () => new THREE.MeshBasicMaterial({ map: lightGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#fff1cc', opacity: 0 });
const glowMat = (color: string) => new THREE.SpriteMaterial({ map: lightGlowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });

export class HeadlightRig {
  readonly group = new THREE.Group();
  private beam: THREE.Mesh;
  private heads: THREE.Sprite[] = [];
  private tails: THREE.Sprite[] = [];

  constructor(length: number, width: number) {
    const L = length / 2;
    const W = width / 2;
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), beamMat());
    this.beam.position.set(0, 0.06, L + 7);
    this.beam.scale.set(6.5, 1, 14);
    this.beam.renderOrder = 2;
    this.group.add(this.beam);
    const hm = glowMat('#fff4d8');
    const tm = glowMat('#ff2a2a');
    for (const s of [-1, 1]) {
      const h = new THREE.Sprite(hm);
      h.position.set(s * W * 0.68, 0.72, L + 0.05);
      h.scale.setScalar(1.6);
      const t = new THREE.Sprite(tm);
      t.position.set(s * W * 0.72, 0.85, -L - 0.05);
      t.scale.setScalar(1.1);
      this.heads.push(h);
      this.tails.push(t);
      this.group.add(h, t);
    }
  }

  /** night: 0-1; flash: 0-1 (full beam flash). */
  set(night: number, flash: number): void {
    const head = Math.min(1, night + flash);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = night * 0.5 + flash * 0.35;
    this.beam.scale.z = 14 + flash * 10;
    (this.heads[0]!.material as THREE.SpriteMaterial).opacity = head;
    (this.tails[0]!.material as THREE.SpriteMaterial).opacity = night * 0.8;
    this.group.visible = head > 0.02;
  }

  dispose(): void {
    this.group.removeFromParent();
    (this.beam.material as THREE.Material).dispose();
    this.beam.geometry.dispose();
    (this.heads[0]!.material as THREE.Material).dispose();
    (this.tails[0]!.material as THREE.Material).dispose();
  }
}

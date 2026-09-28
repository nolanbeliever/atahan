// Original low-poly character with procedural animation (idle/walk/run/interact).

import * as THREE from 'three';
import { Anim, type Appearance } from '../../../shared/types';

const geo = new THREE.BoxGeometry(1, 1, 1);
const shoeMat = new THREE.MeshStandardMaterial({ color: '#222326', roughness: 0.8 });
const eyeMat = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.4 });

function part(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export const NPC_PALETTE: Appearance[] = [
  { skin: '#f1c27d', shirt: '#6c757d', pants: '#343a40', hair: '#4a2c2a' },
  { skin: '#8d5524', shirt: '#e9c46a', pants: '#264653', hair: '#1b1b1b' },
  { skin: '#ffdbac', shirt: '#2a9d8f', pants: '#3d405b', hair: '#d4a373' },
  { skin: '#c68642', shirt: '#e76f51', pants: '#2b2d42', hair: '#1b1b1b' },
  { skin: '#e0ac69', shirt: '#f4f1de', pants: '#6c584c', hair: '#7f5539' },
  { skin: '#a5694f', shirt: '#118ab2', pants: '#1d3557', hair: '#1b1b1b' },
  { skin: '#f1c27d', shirt: '#b5838d', pants: '#495057', hair: '#e9c46a' },
  { skin: '#8d5524', shirt: '#06d6a0', pants: '#073b4c', hair: '#4a2c2a' },
];

export class CharacterView {
  readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private torso!: THREE.Mesh;
  private mats: THREE.MeshStandardMaterial[] = [];
  private phase = Math.random() * 10;
  private time = Math.random() * 10;
  private appearanceKey = '';

  constructor(appearance: Appearance) {
    this.root.add(this.rig);
    this.setAppearance(appearance);
  }

  setAppearance(a: Appearance): void {
    const key = `${a.skin}${a.shirt}${a.pants}${a.hair}`;
    if (key === this.appearanceKey) return;
    this.appearanceKey = key;
    this.rig.clear();
    this.hipL.clear();
    this.hipR.clear();
    this.shL.clear();
    this.shR.clear();
    for (const m of this.mats) m.dispose();
    const skin = new THREE.MeshStandardMaterial({ color: a.skin, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: a.shirt, roughness: 0.75 });
    const pants = new THREE.MeshStandardMaterial({ color: a.pants, roughness: 0.8 });
    const hair = new THREE.MeshStandardMaterial({ color: a.hair, roughness: 0.9 });
    this.mats = [skin, shirt, pants, hair];

    for (const [hip, x] of [
      [this.hipL, 0.11],
      [this.hipR, -0.11],
    ] as const) {
      hip.position.set(x, 0.9, 0);
      hip.add(part(pants, 0.17, 0.82, 0.2, 0, -0.41, 0));
      hip.add(part(shoeMat, 0.18, 0.1, 0.3, 0, -0.85, 0.04));
      this.rig.add(hip);
    }
    this.torso = part(shirt, 0.46, 0.62, 0.26, 0, 1.22, 0);
    this.rig.add(this.torso);
    this.rig.add(part(pants, 0.44, 0.1, 0.25, 0, 0.93, 0));
    for (const [sh, x] of [
      [this.shL, 0.3],
      [this.shR, -0.3],
    ] as const) {
      sh.position.set(x, 1.48, 0);
      sh.add(part(shirt, 0.14, 0.34, 0.15, 0, -0.15, 0));
      sh.add(part(skin, 0.12, 0.3, 0.13, 0, -0.45, 0));
      this.rig.add(sh);
    }
    this.rig.add(part(skin, 0.12, 0.08, 0.12, 0, 1.56, 0));
    this.rig.add(part(skin, 0.3, 0.32, 0.3, 0, 1.74, 0));
    this.rig.add(part(hair, 0.32, 0.09, 0.32, 0, 1.92, 0));
    this.rig.add(part(hair, 0.32, 0.22, 0.08, 0, 1.8, -0.13));
    this.rig.add(part(eyeMat, 0.05, 0.05, 0.02, 0.07, 1.76, 0.151));
    this.rig.add(part(eyeMat, 0.05, 0.05, 0.02, -0.07, 1.76, 0.151));
  }

  animate(anim: number, dt: number): void {
    this.time += dt;
    const moving = anim === Anim.Walk || anim === Anim.Run;
    const running = anim === Anim.Run;
    if (moving) this.phase += dt * (running ? 11 : 7.5);
    const swing = moving ? Math.sin(this.phase) * (running ? 0.95 : 0.55) : 0;
    const k = Math.min(1, dt * 12);
    const lerp = (obj: THREE.Object3D, target: number) => (obj.rotation.x += (target - obj.rotation.x) * k);
    lerp(this.hipL, swing);
    lerp(this.hipR, -swing);
    if (anim === Anim.Interact) {
      lerp(this.shR, -1.35 + Math.sin(this.time * 9) * 0.15);
      lerp(this.shL, 0.1);
    } else {
      const idleSway = moving ? 0 : Math.sin(this.time * 1.6) * 0.04;
      lerp(this.shL, -swing * 0.85 + idleSway);
      lerp(this.shR, swing * 0.85 - idleSway);
    }
    this.rig.position.y = moving ? Math.abs(Math.sin(this.phase)) * (running ? 0.09 : 0.04) : 0;
    this.rig.rotation.x += ((running ? 0.14 : 0) - this.rig.rotation.x) * k;
    if (this.torso) this.torso.scale.y = 0.62 * (1 + (moving ? 0 : Math.sin(this.time * 2.2) * 0.012));
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}

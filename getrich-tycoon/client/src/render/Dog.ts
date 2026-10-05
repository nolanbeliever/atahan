// The K9 sniffer dog at a police checkpoint: a German Shepherd built from boxes (tan with the black
// saddle, pointed ears, a bushy tail) in a black K9 harness. Animations by the NPC's anim: standing
// by the handler (Idle), trotting (Walk), nose to the ground sniffing a door or the boot (Kneel),
// and barking at what it found (Aim).

import * as THREE from 'three';
import { Anim } from '../../../shared/types';

const box = new THREE.BoxGeometry(1, 1, 1);
let mats: Record<'tan' | 'black' | 'dark' | 'harness' | 'nose' | 'patch', THREE.MeshStandardMaterial> | null = null;

function materials(): NonNullable<typeof mats> {
  if (mats) return mats;
  mats = {
    tan: new THREE.MeshStandardMaterial({ color: '#b07a3e', roughness: 0.85 }),
    black: new THREE.MeshStandardMaterial({ color: '#1d1a17', roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: '#5c3d22', roughness: 0.85 }),
    harness: new THREE.MeshStandardMaterial({ color: '#111216', roughness: 0.5 }),
    nose: new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.3 }),
    patch: new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.15 }),
  };
  return mats;
}

function part(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(box, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export class DogView {
  readonly root = new THREE.Group();
  /** Unused (the NPC interface of a character). */
  pose = 'none';
  private body = new THREE.Group();
  private head = new THREE.Group();
  private jaw: THREE.Mesh;
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private phase = Math.random() * 10;
  private time = Math.random() * 10;

  constructor() {
    const m = materials();
    this.root.add(this.body);
    // Body: tan, with the black saddle over the back; the harness round the chest.
    part(m.tan, 0.3, 0.27, 0.82, 0, 0.56, 0, this.body);
    part(m.black, 0.31, 0.12, 0.6, 0, 0.67, -0.06, this.body);
    part(m.harness, 0.33, 0.24, 0.26, 0, 0.58, 0.2, this.body);
    part(m.patch, 0.335, 0.08, 0.12, 0, 0.62, 0.2, this.body);
    part(m.tan, 0.24, 0.3, 0.22, 0, 0.62, 0.38, this.body); // chest / neck base
    // Head: skull, muzzle, nose, ears; the jaw drops when it barks.
    this.head.position.set(0, 0.8, 0.47);
    this.body.add(this.head);
    part(m.tan, 0.2, 0.19, 0.22, 0, 0, 0, this.head);
    part(m.dark, 0.11, 0.09, 0.17, 0, -0.03, 0.17, this.head);
    part(m.nose, 0.05, 0.04, 0.04, 0, -0.005, 0.26, this.head);
    this.jaw = part(m.dark, 0.09, 0.03, 0.14, 0, -0.085, 0.14, this.head);
    for (const x of [-0.06, 0.06]) {
      const ear = part(m.black, 0.05, 0.12, 0.04, x, 0.13, -0.02, this.head);
      ear.rotation.z = x > 0 ? -0.2 : 0.2;
    }
    // Tail, hanging low.
    this.tail.position.set(0, 0.62, -0.41);
    this.body.add(this.tail);
    part(m.dark, 0.07, 0.07, 0.34, 0, 0, -0.16, this.tail);
    this.tail.rotation.x = 0.7;
    // Legs.
    for (const [x, z] of [
      [-0.1, 0.3],
      [0.1, 0.3],
      [-0.1, -0.3],
      [0.1, -0.3],
    ] as const) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.46, z);
      part(m.tan, 0.08, 0.44, 0.09, 0, -0.22, 0, leg);
      part(m.black, 0.085, 0.05, 0.12, 0, -0.44, 0.02, leg);
      this.body.add(leg);
      this.legs.push(leg);
    }
  }

  /** (The character interface: dogs carry no guns.) */
  setWeapon(): void {}

  animate(anim: number, dt: number): void {
    this.time += dt;
    const k = Math.min(1, dt * 10);
    const walking = anim === Anim.Walk || anim === Anim.Run;
    if (walking) this.phase += dt * 10;
    const swing = walking ? Math.sin(this.phase) * 0.55 : 0;
    this.legs.forEach((leg, i) => {
      const s = i === 0 || i === 3 ? swing : -swing;
      leg.rotation.x += (s - leg.rotation.x) * k;
    });
    let headPitch = 0;
    let bodyY = 0;
    let jaw = 0;
    let tail = 0.7 + Math.sin(this.time * 2) * 0.05;
    let wag = 0;
    if (anim === Anim.Kneel) {
      // Sniffing: nose to the ground, tail up and wagging.
      headPitch = 0.75 + Math.sin(this.time * 14) * 0.06;
      bodyY = -0.04;
      tail = 0.1;
      wag = Math.sin(this.time * 12) * 0.5;
    } else if (anim === Anim.Aim) {
      // Barking: head up and jerking, jaw snapping, tail stiff.
      const b = Math.max(0, Math.sin(this.time * 9));
      headPitch = -0.3 - b * 0.15;
      jaw = b * 0.35;
      tail = -0.1;
    } else if (walking) {
      headPitch = 0.15;
      bodyY = Math.abs(Math.sin(this.phase)) * 0.02;
      tail = 0.45;
      wag = Math.sin(this.time * 8) * 0.25;
    } else {
      // Standing by the handler, looking about.
      headPitch = Math.sin(this.time * 0.7) * 0.08;
      this.head.rotation.y += (Math.sin(this.time * 0.4) * 0.4 - this.head.rotation.y) * k * 0.2;
    }
    this.head.rotation.x += (headPitch - this.head.rotation.x) * k;
    this.body.position.y += (bodyY - this.body.position.y) * k;
    this.jaw.rotation.x = jaw;
    this.tail.rotation.x += (tail - this.tail.rotation.x) * k;
    this.tail.rotation.y = wag;
  }

  /** Where the collar is in the world (the handler's leash goes there). */
  collar(out: THREE.Vector3): THREE.Vector3 {
    return this.head.getWorldPosition(out).add(new THREE.Vector3(0, -0.1, 0));
  }

  dispose(): void {
    // Shared geometry and materials stay for the next dog.
  }
}

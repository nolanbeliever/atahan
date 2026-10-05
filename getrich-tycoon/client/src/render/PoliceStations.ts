// The police stations' dressing (the building itself is one of shared/world.ts BUILDINGS): the
// blue-and-white band round the walls, blue beacons pulsing on the roof edge over the door, and the
// painted bays on the forecourt the patrol cars set off from.

import * as THREE from 'three';
import { POLICE_STATIONS } from '../../../shared/police';
import { surfaceY } from './City';
import { lightGlowTexture } from './Highway';

export class PoliceStationsView {
  readonly group = new THREE.Group();
  private beacons: { mat: THREE.MeshStandardMaterial; glow: THREE.Sprite; phase: number }[] = [];
  private time = 0;
  private night = 0;

  constructor() {
    const blue = new THREE.MeshStandardMaterial({ color: '#1f4fd1', roughness: 0.45, emissive: '#1f4fd1', emissiveIntensity: 0.15 });
    const white = new THREE.MeshStandardMaterial({ color: '#f4f6fa', roughness: 0.5 });
    const paint = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const st of POLICE_STATIONS) {
      const b = st.box;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const y0 = surfaceY(cx, cz);
      const band = (mat: THREE.Material, y: number, h: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h, d + 0.12), mat);
        m.position.set(cx, y0 + y, cz);
        this.group.add(m);
      };
      band(blue, 3.9, 0.7);
      band(white, 4.37, 0.24);
      // Beacons on the roof edge over the door.
      const out = st.facing === 'north' ? { x: 0, z: -1 } : st.facing === 'south' ? { x: 0, z: 1 } : st.facing === 'east' ? { x: 1, z: 0 } : { x: -1, z: 0 };
      const edge = { x: cx + (out.x * w) / 2, z: cz + (out.z * d) / 2 };
      const along = { x: -out.z, z: out.x };
      for (const k of [-1, 1]) {
        const mat = new THREE.MeshStandardMaterial({ color: '#2a5bff', emissive: '#2a5bff', emissiveIntensity: 0.3, roughness: 0.3 });
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 12), mat);
        const x = edge.x + along.x * k * (Math.max(w, d) * 0.3) - out.x * 0.6;
        const z = edge.z + along.z * k * (Math.max(w, d) * 0.3) - out.z * 0.6;
        lamp.position.set(x, y0 + 9.65, z);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: '#3b6dff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
        glow.position.set(x, y0 + 9.7, z);
        glow.scale.setScalar(3);
        this.group.add(lamp, glow);
        this.beacons.push({ mat, glow, phase: k > 0 ? 0 : 0.5 });
      }
      // Painted bays on the forecourt, nose to the road.
      const bay = st.bay;
      for (let i = -2; i <= 2; i++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 5.2), paint);
        const ox = along.x * (i * 3.1 + 1.55);
        const oz = along.z * (i * 3.1 + 1.55);
        line.position.set(bay.x + ox - out.x * 2.6, surfaceY(bay.x, bay.z) + 0.012, bay.z + oz - out.z * 2.6);
        line.rotation.y = Math.atan2(out.x, out.z);
        this.group.add(line);
      }
    }
  }

  setNight(n: number): void {
    this.night = n;
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.beacons) {
      const p = (this.time * 0.9 + b.phase) % 1;
      const on = p < 0.18 || (p > 0.28 && p < 0.4);
      b.mat.emissiveIntensity = on ? 3.2 : 0.25;
      (b.glow.material as THREE.SpriteMaterial).opacity = on ? 0.45 + this.night * 0.5 : 0;
      b.glow.scale.setScalar(2.4 + this.night * 3);
    }
  }
}

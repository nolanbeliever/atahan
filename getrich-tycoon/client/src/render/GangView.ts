// Gang territories on the client (shared/gangs.ts): the gang cars and bikes racing in during a turf
// war (smoothed between the server's updates, wheels turning, headlights at night), and at each
// hangout a neon strip and a flag in the colour of whoever holds the zone (purple once it's yours).

import * as THREE from 'three';
import { normalizeMods } from '../../../shared/customization';
import { GANG_ZONES, PLAYER_ZONE_COLOR, type GangCarView, type GangZoneView } from '../../../shared/gangs';
import { angleDiff } from '../../../shared/util';
import { groundHeight } from './City';
import { lightGlowTexture } from './Highway';
import { createVehicleView, type AnyVehicleView } from './VehicleMesh';

const GOOD = { engine: 70, transmission: 70, brakes: 70, tires: 70, body: 55, interior: 50, cleanliness: 40 };

interface CarView {
  data: GangCarView;
  view: AnyVehicleView;
  x: number;
  z: number;
  rot: number;
}

interface Hangout {
  neon: THREE.MeshBasicMaterial;
  flag: THREE.MeshStandardMaterial;
  glow: THREE.Sprite;
  cloth: THREE.Mesh;
}

export class GangView {
  private cars = new Map<string, CarView>();
  private hangouts = new Map<string, Hangout>();
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    for (const z of GANG_ZONES) this.buildHangout(z.id);
  }

  /** A neon strip over the door and a flag on a pole beside it. */
  private buildHangout(id: string): void {
    const z = GANG_ZONES.find((g) => g.id === id)!;
    const v = z.venue;
    const d = v.door;
    // Outwards from the wall the door is on.
    const ox = Math.sin(d.rot + Math.PI);
    const oz = Math.cos(d.rot + Math.PI);
    const wallX = d.x - ox * 1.3;
    const wallZ = d.z - oz * 1.3;
    const y0 = groundHeight(wallX, wallZ);
    const g = new THREE.Group();
    g.position.set(wallX + ox * 0.08, y0, wallZ + oz * 0.08);
    g.rotation.y = d.rot + Math.PI;
    const neon = new THREE.MeshBasicMaterial({ color: z.color, toneMapped: false });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 0.06), neon);
    strip.position.set(0, 3.0, 0.05);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.08), new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.5, metalness: 0.5 }));
    door.position.set(0, 1.1, 0.04);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: z.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
    glow.position.set(0, 3.0, 0.4);
    glow.scale.set(5, 1.6, 1);
    g.add(strip, door, glow);
    // The flag.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 5.2, 8), new THREE.MeshStandardMaterial({ color: '#b8bec6', metalness: 0.7, roughness: 0.3 }));
    pole.position.set(3.2, 2.6, 0.9);
    const flag = new THREE.MeshStandardMaterial({ color: z.color, side: THREE.DoubleSide, roughness: 0.8 });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9, 8, 1), flag);
    cloth.position.set(3.2 + 0.72, 4.6, 0.9);
    g.add(pole, cloth);
    this.scene.add(g);
    this.hangouts.set(id, { neon, flag, glow, cloth });
  }

  setZones(zones: readonly GangZoneView[]): void {
    for (const v of zones) {
      const h = this.hangouts.get(v.id);
      if (!h) continue;
      const color = v.owner ? PLAYER_ZONE_COLOR : GANG_ZONES.find((z) => z.id === v.id)!.color;
      h.neon.color.set(color);
      h.flag.color.set(color);
      h.glow.material.color.set(color);
    }
  }

  setCars(list: readonly GangCarView[]): void {
    const ids = new Set(list.map((c) => c.id));
    for (const [id, c] of this.cars) {
      if (ids.has(id)) continue;
      c.view.root.removeFromParent();
      c.view.dispose();
      this.cars.delete(id);
    }
    for (const d of list) {
      const c = this.cars.get(d.id);
      if (c) {
        c.data = d;
        continue;
      }
      const view = createVehicleView({ id: d.id, modelId: d.modelId, color: d.color, mods: normalizeMods({}), condition: GOOD });
      view.root.rotation.order = 'YXZ';
      view.root.position.set(d.x, groundHeight(d.x, d.z), d.z);
      view.root.rotation.y = d.rot;
      this.scene.add(view.root);
      this.cars.set(d.id, { data: d, view, x: d.x, z: d.z, rot: d.rot });
    }
  }

  update(dt: number, night: number): void {
    this.time += dt;
    for (const c of this.cars.values()) {
      const d = c.data;
      // Run ahead along the heading between updates, then ease onto the server's position.
      const k = Math.min(1, dt * 8);
      const px = d.x + Math.sin(d.rot) * d.speed * 0.1;
      const pz = d.z + Math.cos(d.rot) * d.speed * 0.1;
      c.x += (px - c.x) * k;
      c.z += (pz - c.z) * k;
      c.rot += angleDiff(c.rot, d.rot) * k;
      c.view.root.position.set(c.x, groundHeight(c.x, c.z), c.z);
      c.view.root.rotation.y = c.rot;
      c.view.animate(d.speed, 0, dt);
      c.view.setLights({ brake: d.speed < 4, reverse: false, night });
    }
    // The flags flutter.
    for (const h of this.hangouts.values()) {
      const pos = h.cloth.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + 0.7;
        pos.setZ(i, Math.sin(this.time * 6 + x * 4) * 0.08 * x);
      }
      pos.needsUpdate = true;
    }
  }

  /** Gang car boxes (aiming, collisions on the client). */
  obstacles(): { id: string; modelId: string; x: number; z: number; rot: number }[] {
    return [...this.cars.values()].map((c) => ({ id: c.data.id, modelId: c.data.modelId, x: c.x, z: c.z, rot: c.rot }));
  }
}

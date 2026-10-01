// Police cars on the client: snapshot interpolation, the interceptor model with flashing red / blue
// light bars (and glows that light up the night), and their collision boxes for local prediction.

import * as THREE from 'three';
import { PF, type PoliceSnap } from '../../../shared/police';
import { vehicleBox, type DynamicBox } from '../../../shared/physics';
import { modelBoxHalfExtents } from '../../../shared/collision';
import { Anim } from '../../../shared/types';
import { CharacterView, POLICE_OFFICER } from '../render/Character';
import { groundHeight } from '../render/City';
import { lightGlowTexture } from '../render/Highway';
import { VehicleView } from '../render/VehicleMesh';
import { INTERP_DELAY_MS, InterpBuffer } from './Interpolation';

interface Unit {
  id: number;
  buffer: InterpBuffer;
  view: VehicleView;
  /** The officer at the wheel. */
  driver: CharacterView;
  red: THREE.Sprite;
  blue: THREE.Sprite;
  lastSeen: number;
  flags: number;
  sirens: { red: THREE.MeshStandardMaterial[]; blue: THREE.MeshStandardMaterial[] } | null;
  x: number;
  z: number;
  rot: number;
  speed: number;
}

const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
const LOOK = { modelId: 'police', color: '#f4f4f2', mods: { paint: null, wheels: 'wheel_stock', tint: 'tint_dark', bodyKit: 'kit_none', headlights: 'lights_xenon', accessory: 'acc_none' }, condition: PERFECT };

/** The light bar lenses of a police car (own copies, so each car flashes on its own). */
function sirenMaterials(view: VehicleView): { red: THREE.MeshStandardMaterial[]; blue: THREE.MeshStandardMaterial[] } {
  const out = { red: [] as THREE.MeshStandardMaterial[], blue: [] as THREE.MeshStandardMaterial[] };
  view.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    const list = mat.name === 'siren_red' ? out.red : mat.name === 'siren_blue' ? out.blue : null;
    if (!list || !mat.emissive) return;
    const own = mat.clone();
    m.material = own;
    list.push(own);
  });
  return out;
}

/** Id of the police car a cutscene drives itself. */
const STAGED = -1;

export class PoliceClient {
  readonly units = new Map<number, Unit>();
  private time = 0;
  night = 0;
  /** Cutscene: one police car placed by the client (the server's units are hidden meanwhile). */
  private staged: { x: number; z: number; rot: number; speed: number; flags: number } | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** Place (or remove, with null) the cutscene's police car. */
  stage(p: { x: number; z: number; rot: number; speed: number; siren: boolean; brake: boolean } | null, now = performance.now()): void {
    if (!p) {
      this.staged = null;
      const u = this.units.get(STAGED);
      if (u) this.drop(u);
      return;
    }
    this.staged = { x: p.x, z: p.z, rot: p.rot, speed: p.speed, flags: (p.siren ? PF.SIREN : 0) | (p.brake ? PF.BRAKE : 0) };
    if (!this.units.has(STAGED)) this.apply([[STAGED, p.x, p.z, p.rot, 0, 0, this.staged.flags]], now);
  }

  apply(snaps: PoliceSnap[], now = performance.now()): void {
    for (const [id, x, z, rot, speed, steer, flags] of snaps) {
      let u = this.units.get(id);
      if (!u) {
        const view = new VehicleView(LOOK);
        const glow = (color: string) => {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
          s.scale.setScalar(2.4);
          view.root.add(s);
          return s;
        };
        const driver = new CharacterView(POLICE_OFFICER);
        driver.pose = 'sit';
        view.driverMount.add(driver.root);
        const unit: Unit = { id, buffer: new InterpBuffer(), view, driver, red: glow('#ff2a2a'), blue: glow('#2a5bff'), lastSeen: now, flags, x, z, rot, speed: 0, sirens: null };
        void view.ready.then(() => (unit.sirens = sirenMaterials(view)));
        u = unit;
        this.scene.add(view.root);
        this.units.set(id, u);
      }
      u.buffer.push({ t: now, x, z, r: rot, a: speed, b: steer, f: flags });
      u.lastSeen = now;
      u.flags = flags;
    }
  }

  update(dt: number, now = performance.now()): void {
    this.time += dt;
    const renderT = now - INTERP_DELAY_MS;
    for (const [id, u] of this.units) {
      if (id === STAGED && this.staged) {
        u.lastSeen = now;
        u.flags = this.staged.flags;
        u.buffer.push({ t: renderT, x: this.staged.x, z: this.staged.z, r: this.staged.rot, a: this.staged.speed, b: 0, f: u.flags });
      }
      if (now - u.lastSeen > 1200) {
        this.drop(u);
        continue;
      }
      u.view.root.visible = !this.staged || id === STAGED;
      const s = u.buffer.sample(renderT);
      if (!s) continue;
      u.x = s.x;
      u.z = s.z;
      u.rot = s.r;
      u.speed = s.a;
      u.view.root.position.set(s.x, groundHeight(s.x, s.z), s.z);
      u.view.root.rotation.y = s.r;
      u.view.animate(s.a, s.b, dt);
      u.driver.animate(Anim.Idle, dt);
      u.view.setLights({ brake: (u.flags & PF.BRAKE) !== 0, reverse: false, night: Math.max(this.night, 0.3) });
      // Wig-wag: red and blue alternate with a quick double flash.
      const siren = (u.flags & PF.SIREN) !== 0;
      const phase = (this.time * 2.2 + id * 0.37) % 1;
      const redOn = siren && (phase < 0.12 || (phase > 0.2 && phase < 0.32));
      const blueOn = siren && ((phase > 0.5 && phase < 0.62) || (phase > 0.7 && phase < 0.82));
      for (const m of u.sirens?.red ?? []) m.emissiveIntensity = redOn ? 4 : 0.15;
      for (const m of u.sirens?.blue ?? []) m.emissiveIntensity = blueOn ? 4 : 0.15;
      const h = (u.view.info?.height ?? 1.45) + 0.12;
      const w = 0.42;
      u.red.position.set(w, h, 0.1);
      u.blue.position.set(-w, h, 0.1);
      const glowK = 0.55 + this.night * 0.45;
      (u.red.material as THREE.SpriteMaterial).opacity = redOn ? glowK : 0;
      (u.blue.material as THREE.SpriteMaterial).opacity = blueOn ? glowK : 0;
      u.red.scale.setScalar(2 + this.night * 3);
      u.blue.scale.setScalar(2 + this.night * 3);
    }
  }

  /** Collision boxes for local prediction (same ids as the server's). */
  boxesNear(x: number, z: number, radius: number, out: DynamicBox[]): void {
    const e = modelBoxHalfExtents('police');
    if (!e) return;
    for (const u of this.units.values()) {
      if (u.id === STAGED || (u.x - x) ** 2 + (u.z - z) ** 2 > radius * radius) continue;
      out.push(vehicleBox(`po:${u.id}`, u.x, u.z, u.rot, e.hl, e.hw, Math.sin(u.rot) * u.speed, Math.cos(u.rot) * u.speed));
    }
  }

  /** Distance to the nearest police car with its siren on (for the siren sound). */
  nearestSiren(x: number, z: number): number {
    let best = Infinity;
    for (const u of this.units.values()) if (u.flags & PF.SIREN) best = Math.min(best, Math.hypot(u.x - x, u.z - z));
    return best;
  }

  private drop(u: Unit): void {
    u.view.dispose();
    u.driver.dispose();
    this.units.delete(u.id);
  }

  clear(): void {
    for (const u of [...this.units.values()]) this.drop(u);
  }
}

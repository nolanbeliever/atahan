// Police cars on the client: snapshot interpolation, the interceptor model with flashing red / blue
// light bars (and glows that light up the night), and their collision boxes for local prediction.

import * as THREE from 'three';
import { PF, type PoliceSnap } from '../../../shared/police';
import { SPIKE_HALF_WIDTH, type HeliSnap, type SpikeSnap } from '../../../shared/policeGear';
import { HelicopterView } from '../render/Helicopter';
import { vehicleBox, type DynamicBox } from '../../../shared/physics';
import { modelBoxHalfExtents } from '../../../shared/collision';
import { Anim } from '../../../shared/types';
import { CharacterView, POLICE_OFFICER } from '../render/Character';
import { surfaceSlope, surfaceY } from '../render/City';
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
  /** Up on a bridge deck. */
  deck: number;
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

function angleWrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Id of the police car a cutscene drives itself. */
const STAGED = -1;

/** A spike strip: a dark mat studded with spikes, a cone and a flashing lamp at each end. */
function spikeStrip(half: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 0.8, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.05, SPIKE_HALF_WIDTH * 1.6), mat);
  base.position.y = 0.03;
  base.receiveShadow = true;
  g.add(base);
  const n = Math.round(half * 2 / 0.22);
  const spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.035, 0.12, 5), steel, n * 2);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    for (const [k, dz] of [
      [0, -0.12],
      [1, 0.12],
    ] as const) {
      m.makeTranslation(-half + (i + 0.5) * (half * 2 / n), 0.11, dz + (i % 2 ? 0.05 : -0.05));
      spikes.setMatrixAt(i * 2 + k, m);
    }
  }
  g.add(spikes);
  const coneMat = new THREE.MeshStandardMaterial({ color: '#ff6a00', roughness: 0.6 });
  const lamp = new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false });
  for (const x of [-half - 0.5, half + 0.5]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 12), coneMat);
    cone.position.set(x, 0.35, 0);
    cone.castShadow = true;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lamp);
    l.position.set(x, 0.75, 0);
    l.name = 'lamp';
    g.add(cone, l);
  }
  return g;
}

export class PoliceClient {
  readonly units = new Map<number, Unit>();
  private spikes = new Map<number, { group: THREE.Group; lastSeen: number }>();
  /** Helicopters: the view, their recent states (interpolated) and when last seen. */
  readonly helis = new Map<number, { view: HelicopterView; buffer: { t: number; s: HeliSnap }[]; lastSeen: number; x: number; y: number; z: number }>();
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
    for (const [id, x, z, rot, speed, steer, flags, deck] of snaps) {
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
        const unit: Unit = { id, buffer: new InterpBuffer(), view, driver, red: glow('#ff2a2a'), blue: glow('#2a5bff'), lastSeen: now, flags, x, z, rot, speed: 0, sirens: null, deck: 0 };
        view.root.rotation.order = 'YXZ';
        void view.ready.then(() => (unit.sirens = sirenMaterials(view)));
        u = unit;
        this.scene.add(view.root);
        this.units.set(id, u);
      }
      u.buffer.push({ t: now, x, z, r: rot, a: speed, b: steer, f: flags });
      u.lastSeen = now;
      u.flags = flags;
      u.deck = deck ?? 0;
    }
  }

  update(dt: number, now = performance.now()): void {
    this.time += dt;
    this.updateHelis(dt, now);
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
      u.view.root.position.set(s.x, surfaceY(s.x, s.z, u.deck), s.z);
      u.view.root.rotation.y = s.r;
      u.view.root.rotation.x = -Math.atan(surfaceSlope(s.x, s.r, u.deck));
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

  /** Spike strips from a snapshot (ones not seen for a while are taken away). */
  applySpikes(list: SpikeSnap[], now = performance.now()): void {
    for (const [id, x, z, rot, half, deck] of list) {
      let s = this.spikes.get(id);
      if (!s) {
        const group = spikeStrip(half);
        group.position.set(x, surfaceY(x, z, deck ?? 0), z);
        // The strip runs along `rot` (0 = +z); the model runs along x.
        group.rotation.y = rot - Math.PI / 2;
        this.scene.add(group);
        s = { group, lastSeen: now };
        this.spikes.set(id, s);
      }
      s.lastSeen = now;
    }
    for (const [id, s] of this.spikes) {
      if (now - s.lastSeen < 1500) {
        const on = Math.sin(this.time * 10 + id) > 0;
        s.group.traverse((o) => {
          if (o.name === 'lamp') o.visible = on;
        });
        continue;
      }
      s.group.removeFromParent();
      this.spikes.delete(id);
    }
  }

  /** Helicopters from a snapshot. */
  applyHelis(list: HeliSnap[], now = performance.now()): void {
    for (const s of list) {
      let h = this.helis.get(s[0]);
      if (!h) {
        const view = new HelicopterView();
        this.scene.add(view.root);
        h = { view, buffer: [], lastSeen: now, x: s[1], y: s[2], z: s[3] };
        this.helis.set(s[0], h);
      }
      h.buffer.push({ t: now, s });
      if (h.buffer.length > 8) h.buffer.shift();
      h.lastSeen = now;
    }
  }

  private updateHelis(dt: number, now: number): void {
    const renderT = now - INTERP_DELAY_MS;
    for (const [id, h] of this.helis) {
      if (now - h.lastSeen > 1500) {
        h.view.dispose();
        this.helis.delete(id);
        continue;
      }
      // Interpolate between the two snapshots around the render time.
      const b = h.buffer;
      let a = b[0]!;
      let c = b[b.length - 1]!;
      for (let i = 0; i + 1 < b.length; i++) {
        if (b[i]!.t <= renderT && b[i + 1]!.t >= renderT) {
          a = b[i]!;
          c = b[i + 1]!;
          break;
        }
      }
      const k = c.t > a.t ? Math.max(0, Math.min(1, (renderT - a.t) / (c.t - a.t))) : 1;
      const lerp = (i: number) => a.s[i]! + (c.s[i]! - a.s[i]!) * k;
      h.x = lerp(1);
      h.y = lerp(2);
      h.z = lerp(3);
      const yaw = a.s[4] + angleWrap(c.s[4] - a.s[4]) * k;
      const lit = c.s[5] < 9000;
      h.view.update(dt, h.x, h.y, h.z, yaw, lit ? { x: c.s[5], z: c.s[6] } : null, c.s[7], this.night);
    }
  }

  /** Distance to the nearest helicopter (rotor sound). */
  nearestHeli(x: number, z: number): number {
    let best = Infinity;
    for (const h of this.helis.values()) best = Math.min(best, Math.hypot(h.x - x, h.y, h.z - z));
    return best;
  }

  /** Collision boxes for local prediction (same ids as the server's). */
  boxesNear(x: number, z: number, radius: number, out: DynamicBox[]): void {
    const e = modelBoxHalfExtents('police');
    if (!e) return;
    for (const u of this.units.values()) {
      if (u.id === STAGED || (u.x - x) ** 2 + (u.z - z) ** 2 > radius * radius) continue;
      out.push(vehicleBox(`po:${u.id}`, u.x, u.z, u.rot, e.hl, e.hw, Math.sin(u.rot) * u.speed, Math.cos(u.rot) * u.speed, u.deck));
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

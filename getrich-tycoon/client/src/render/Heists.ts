// The heist targets in 3D (shared/heists.ts): a steel door with a keypad at each target, an alarm
// beacon over it that spins red and blue (with a glow and the work going on at the door: a drill
// throwing sparks or a laptop with a glowing screen) while a job is on, the security forecourts
// with their bollards, the Golden Palace Casino's neon, canopy, red carpet and palms, and the
// pulsing drop marker at the docks for the showroom job.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOLLARD_R } from '../../../shared/alleys';
import { CASINO_BOX, HEISTS, HEIST_DROP, SECURITY_BOLLARDS, SECURITY_FORECOURTS, type Heist, type HeistId } from '../../../shared/heists';
import { groundHeight } from './City';
import { lightGlowTexture } from './Highway';
import { Tex } from './Textures';

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = geos.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') x.deleteAttribute(name);
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position!.count * 2), 2));
    return x;
  });
  const m = mergeGeometries(clean, false)!;
  for (const g of geos) g.dispose();
  return m;
}

interface Target {
  heist: Heist;
  beacon: THREE.Group;
  red: THREE.Sprite;
  blue: THREE.Sprite;
  glow: THREE.Sprite;
  tool: THREE.Group;
  bit: THREE.Object3D | null;
  sparks: THREE.Points | null;
  screen: THREE.MeshStandardMaterial | null;
  on: boolean;
}

export class HeistsView {
  readonly group = new THREE.Group();
  private readonly targets = new Map<HeistId, Target>();
  private readonly neon: THREE.MeshStandardMaterial[] = [];
  private readonly drop: THREE.Group;
  private readonly dropRing: THREE.Mesh;
  private time = 0;

  constructor() {
    this.group.name = 'heists';
    const steel = new THREE.MeshStandardMaterial({ color: '#5d636c', metalness: 0.8, roughness: 0.35 });
    const frame = new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.6, roughness: 0.5 });
    const keypad = new THREE.MeshStandardMaterial({ color: '#16181c', emissive: '#2bff88', emissiveIntensity: 0.8 });
    for (const h of HEISTS) this.buildTarget(h, steel, frame, keypad);
    this.buildForecourts();
    this.buildCasino();
    // The docks drop: a pulsing ring and a beam of light (shown during the showroom job).
    this.drop = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffc53d', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    this.dropRing = new THREE.Mesh(new THREE.RingGeometry(HEIST_DROP.radius - 0.6, HEIST_DROP.radius, 48).rotateX(-Math.PI / 2), ringMat);
    this.dropRing.position.y = 0.08;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ffc53d', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 30;
    this.drop.add(this.dropRing, beam);
    this.drop.position.set(HEIST_DROP.x, groundHeight(HEIST_DROP.x, HEIST_DROP.z), HEIST_DROP.z);
    this.drop.visible = false;
    this.group.add(this.drop);
  }

  /** A target's alarm went on or off. */
  setAlarm(id: HeistId, on: boolean): void {
    const t = this.targets.get(id);
    if (!t) return;
    t.on = on;
    t.tool.visible = on;
    t.glow.visible = on;
  }

  /** The docks marker for the showroom job (the local player's). */
  showDrop(on: boolean): void {
    this.drop.visible = on;
  }

  update(dt: number): void {
    this.time += dt;
    for (const t of this.targets.values()) {
      t.beacon.rotation.y += dt * (t.on ? 9 : 0);
      const phase = (this.time * 3) % 1;
      (t.red.material as THREE.SpriteMaterial).opacity = t.on && phase < 0.5 ? 1 : 0;
      (t.blue.material as THREE.SpriteMaterial).opacity = t.on && phase >= 0.5 ? 1 : 0;
      (t.glow.material as THREE.SpriteMaterial).opacity = t.on ? 0.16 + Math.sin(this.time * 18) * 0.06 : 0;
      if (!t.on) continue;
      if (t.bit) t.bit.rotation.z += dt * 40;
      if (t.screen) t.screen.emissiveIntensity = 1.2 + Math.sin(this.time * 9) * 0.3;
      if (t.sparks) {
        const pos = t.sparks.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const k = (this.time * 2.3 + i * 0.137) % 1;
          const a = i * 2.39996;
          pos.setXYZ(i, Math.cos(a) * k * 0.9, 0.2 - k * k * 1.1 + Math.sin(a * 3) * 0.05, Math.sin(a) * k * 0.9 + k * 0.4);
        }
        pos.needsUpdate = true;
      }
    }
    const pulse = 1 + Math.sin(this.time * 4) * 0.06;
    this.dropRing.scale.set(pulse, 1, pulse);
  }

  setNight(f: number): void {
    for (const m of this.neon) m.emissiveIntensity = 0.8 + f * 2.2;
  }

  private buildTarget(h: Heist, steel: THREE.Material, frame: THREE.Material, keypad: THREE.Material): void {
    const g = new THREE.Group();
    const y0 = groundHeight(h.stand.x, h.stand.z);
    g.position.set(h.door.x, y0, h.door.z);
    // Face the stand (the door's outside).
    g.rotation.y = Math.atan2(h.stand.x - h.door.x, h.stand.z - h.door.z);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.12), steel);
    door.position.set(0, 1.15, 0.04);
    const surround = new THREE.Mesh(merge([new THREE.BoxGeometry(1.6, 0.16, 0.18).translate(0, 2.38, 0.05), new THREE.BoxGeometry(0.15, 2.4, 0.18).translate(-0.72, 1.2, 0.05), new THREE.BoxGeometry(0.15, 2.4, 0.18).translate(0.72, 1.2, 0.05)]), frame);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.05), keypad);
    pad.position.set(0.95, 1.3, 0.06);
    door.castShadow = surround.castShadow = true;
    g.add(door, surround, pad);
    // The alarm beacon over the door.
    const beacon = new THREE.Group();
    beacon.position.set(0, 2.9, 0.25);
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.28, 12), new THREE.MeshStandardMaterial({ color: '#c51d2a', emissive: '#ff1a10', emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }));
    beacon.add(dome);
    const sprite = (color: string, scale: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(scale);
      return s;
    };
    const red = sprite('#ff2a2a', 3.2);
    const blue = sprite('#2a5bff', 3.2);
    red.position.set(0.25, 0, 0);
    blue.position.set(-0.25, 0, 0);
    beacon.add(red, blue);
    const glow = sprite('#ff3030', 7);
    glow.position.set(0, 2.2, 1.5);
    glow.visible = false;
    g.add(beacon, glow);
    // The work at the door: a drill on a stand, or a laptop on a crate.
    const tool = new THREE.Group();
    tool.position.set(0.15, 0, 0.55);
    tool.visible = false;
    let bit: THREE.Object3D | null = null;
    let sparks: THREE.Points | null = null;
    let screen: THREE.MeshStandardMaterial | null = null;
    const dark = new THREE.MeshStandardMaterial({ color: '#2b2e34', metalness: 0.6, roughness: 0.4 });
    if (h.tool === 'drill') {
      const body = new THREE.MeshStandardMaterial({ color: '#e5a21a', roughness: 0.5 });
      tool.add(new THREE.Mesh(merge([new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6).translate(-0.25, 0.55, 0.1), new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6).translate(0.25, 0.55, 0.1), new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6).translate(0, 0.55, 0.45)]), dark));
      const drill = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.6), body);
      drill.position.set(0, 1.2, 0.05);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8).rotateX(Math.PI / 2), dark);
      b.position.set(0, 1.2, -0.45);
      bit = b;
      tool.add(drill, b);
      const n = 40;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffd35a', size: 0.06, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sparks.position.set(0, 1.2, -0.68);
      tool.add(sparks);
    } else {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.5), new THREE.MeshStandardMaterial({ color: '#6b4f33', roughness: 0.9 }));
      crate.position.y = 0.35;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.3), dark);
      base.position.set(0, 0.72, 0);
      screen = new THREE.MeshStandardMaterial({ color: '#0a1f12', emissive: '#18ff70', emissiveIntensity: 1.2, map: Tex.sign('ACCESS GRANTED', { bg: '#03120a', fg: '#2bff88', accent: '#2bff88', w: 256, h: 160 }) });
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.02), [dark, dark, dark, dark, screen, dark]);
      lid.position.set(0, 0.86, -0.14);
      lid.rotation.x = 0.25;
      // A cable from the laptop into the keypad.
      tool.add(crate, base, lid, new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9, 4).rotateZ(Math.PI / 2.6).translate(0.45, 1.05, -0.4), dark));
    }
    g.add(tool);
    this.group.add(g);
    this.targets.set(h.id, { heist: h, beacon, red, blue, glow, tool, bit, sparks, screen, on: false });
  }

  private buildForecourts(): void {
    const paving = new THREE.MeshStandardMaterial({ map: repeat(Tex.paving(), 4, 4), color: '#9a948a', roughness: 0.8 });
    const stripe = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 });
    for (const f of SECURITY_FORECOURTS) {
      const w = f.maxX - f.minX;
      const d = f.maxZ - f.minZ;
      const cx = (f.minX + f.maxX) / 2;
      const cz = (f.minZ + f.maxZ) / 2;
      const y = groundHeight(cx, cz) + 0.02;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), paving);
      m.position.set(cx, y, cz);
      m.receiveShadow = true;
      this.group.add(m);
      const lines = new THREE.Mesh(merge([new THREE.PlaneGeometry(w, 0.15).rotateX(-Math.PI / 2).translate(0, 0, -d / 2 + 0.1), new THREE.PlaneGeometry(w, 0.15).rotateX(-Math.PI / 2).translate(0, 0, d / 2 - 0.1)]), stripe);
      lines.position.set(cx, y + 0.005, cz);
      this.group.add(lines);
    }
    const metal = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 0.85, roughness: 0.25 });
    const band = new THREE.MeshStandardMaterial({ color: '#f2c230', emissive: '#f2c230', emissiveIntensity: 0.15, roughness: 0.4 });
    const posts: THREE.BufferGeometry[] = [];
    const bands: THREE.BufferGeometry[] = [];
    for (const b of SECURITY_BOLLARDS) {
      const y = groundHeight(b.x, b.z);
      posts.push(new THREE.CylinderGeometry(BOLLARD_R, BOLLARD_R + 0.02, 0.95, 12).translate(b.x, y + 0.47, b.z));
      posts.push(new THREE.SphereGeometry(BOLLARD_R, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(b.x, y + 0.95, b.z));
      bands.push(new THREE.CylinderGeometry(BOLLARD_R + 0.005, BOLLARD_R + 0.005, 0.08, 12).translate(b.x, y + 0.78, b.z));
    }
    for (const [geos, mat] of [
      [posts, metal],
      [bands, band],
    ] as const) {
      const m = new THREE.Mesh(merge(geos), mat);
      m.castShadow = true;
      this.group.add(m);
    }
  }

  /** The Golden Palace Casino's front: neon edging, a canopy on gold columns, a red carpet, palms. */
  private buildCasino(): void {
    const b = CASINO_BOX;
    const front = b.maxZ;
    const cx = (b.minX + b.maxX) / 2;
    const y0 = groundHeight(cx, front + 2);
    const gold = new THREE.MeshStandardMaterial({ color: '#ffc53d', emissive: '#ffb000', emissiveIntensity: 1.2, metalness: 0.8, roughness: 0.3 });
    const pink = new THREE.MeshStandardMaterial({ color: '#ff4fd8', emissive: '#ff2bd0', emissiveIntensity: 1.4 });
    this.neon.push(gold, pink);
    const w = b.maxX - b.minX;
    const H = 20;
    // Neon edges on the front and the top.
    this.group.add(new THREE.Mesh(merge([new THREE.BoxGeometry(w + 0.4, 0.25, 0.25).translate(cx, y0 + H + 0.1, front + 0.15), new THREE.BoxGeometry(0.25, H, 0.25).translate(b.minX - 0.05, y0 + H / 2, front + 0.15), new THREE.BoxGeometry(0.25, H, 0.25).translate(b.maxX + 0.05, y0 + H / 2, front + 0.15)]), gold));
    for (let k = 0; k < 3; k++) this.group.add(new THREE.Mesh(new THREE.BoxGeometry(w - 6, 0.12, 0.12).translate(cx, y0 + 6 + k * 4.2, front + 0.12), pink));
    // Canopy on gold columns over the entrance, a vertical CASINO sign.
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 6), new THREE.MeshStandardMaterial({ color: '#1a0824', metalness: 0.4, roughness: 0.4 }));
    canopy.position.set(cx, y0 + 4.6, front + 3);
    canopy.castShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.18, 6.2), gold);
    edge.position.set(cx, y0 + 4.35, front + 3);
    const cols = new THREE.Mesh(merge([-6.4, 6.4].map((x) => new THREE.CylinderGeometry(0.3, 0.34, 4.4, 14).translate(cx + x, y0 + 2.2, front + 5.6))), gold);
    this.group.add(canopy, edge, cols);
    const tex = Tex.sign('CASINO', { bg: '#1a0824', fg: '#ffc53d', accent: '#ff4fd8', w: 512, h: 160 });
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1, side: THREE.DoubleSide });
    this.neon.push(signMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), signMat);
    sign.position.set(cx, y0 + 7.6, front + 0.3);
    this.group.add(sign);
    // Red carpet from the forecourt to the door.
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(3, 11).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#a3122a', roughness: 0.9 }));
    carpet.position.set(cx, y0 + 0.035, front + 5.6);
    this.group.add(carpet);
    // Palms either side of the forecourt.
    const trunk = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 1 });
    const leaf = new THREE.MeshStandardMaterial({ color: '#2f8a3a', roughness: 0.9, side: THREE.DoubleSide });
    for (const x of [cx - 20, cx - 17, cx + 17, cx + 20]) {
      const z = front + 8;
      this.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 7, 8).translate(x, y0 + 3.5, z), trunk));
      const leaves: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 7; k++) leaves.push(new THREE.PlaneGeometry(0.9, 3.4).translate(0, 1.7, 0).rotateX(1.1).rotateY((k / 7) * Math.PI * 2).translate(x, y0 + 7, z));
      this.group.add(new THREE.Mesh(merge(leaves), leaf));
    }
  }
}

function repeat(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

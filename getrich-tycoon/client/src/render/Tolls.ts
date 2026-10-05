// The toll plazas on the far-shore roads from the bridges, and the number-plate (ANPR) camera
// gantries (shared/tolls.ts): a canopy over the road with lit "HGS · GİŞE" signs, booths on the
// islands between the lanes, a barrier arm in each lane towards the far shore (it lifts when a car
// pays, and flies up red when one crashes through), and camera gantries whose infrared flash goes
// off when they read a flagged car.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ANPR_CAMERAS, TOLL_ISLAND_LEN, TOLL_PLAZAS, TOLL_X } from '../../../shared/tolls';
import { BRIDGE_HALF, bridgeByN, deckHeight } from '../../../shared/strait';
import { lightGlowTexture } from './Highway';
import { Tex } from './Textures';

const CANOPY_H = 6.2;

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

interface Arm {
  n: number;
  z: number;
  pivot: THREE.Group;
  bar: THREE.Mesh;
  /** Seconds left up (paid) and red (evaded). */
  up: number;
  broken: number;
  angle: number;
}

export class TollsView {
  readonly group = new THREE.Group();
  private readonly arms: Arm[] = [];
  private readonly flashes = new Map<string, { glow: THREE.Sprite; t: number }>();
  private readonly signMat: THREE.MeshStandardMaterial;
  private readonly laneLights = new THREE.MeshStandardMaterial({ color: '#2bff88', emissive: '#18ff70', emissiveIntensity: 1.2 });
  private readonly armMat = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.5 });
  private readonly armRed = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff1a10', emissiveIntensity: 1.2 });

  constructor() {
    this.group.name = 'tolls';
    const tex = Tex.sign('KÖPRÜ GİŞESİ · HGS', { bg: '#0b3d2e', fg: '#ffffff', accent: '#2bff88', w: 1024, h: 160, sub: 'Karşı kıyıya geçiş $250 · yavaşla, kol kalksın' });
    this.signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.4, side: THREE.DoubleSide });
    for (const p of TOLL_PLAZAS) this.buildPlaza(p);
    this.buildCameras();
  }

  /** A car went through the barrier in the lane nearest `z` on bridge road `n`. */
  pass(n: number, z: number, evaded: boolean): void {
    let best: Arm | null = null;
    for (const a of this.arms) if (a.n === n && (!best || Math.abs(a.z - z) < Math.abs(best.z - z))) best = a;
    if (!best || Math.abs(best.z - z) > 4) return;
    if (evaded) best.broken = 4;
    else best.up = 2.5;
  }

  /** A camera read a flagged plate. */
  flash(id: string): void {
    const f = this.flashes.get(id);
    if (!f) return;
    f.t = 0.3;
    (f.glow.material as THREE.SpriteMaterial).opacity = 1;
  }

  update(dt: number): void {
    for (const a of this.arms) {
      a.up = Math.max(0, a.up - dt);
      a.broken = Math.max(0, a.broken - dt);
      const target = a.broken > 0 ? 1.45 : a.up > 0 ? 1.4 : 0;
      a.angle += (target - a.angle) * Math.min(1, dt * (a.broken > 0 ? 12 : 4));
      a.pivot.rotation.x = a.angle;
      a.bar.material = a.broken > 0 ? this.armRed : this.armMat;
    }
    for (const f of this.flashes.values()) {
      if (f.t <= 0) continue;
      f.t -= dt;
      (f.glow.material as THREE.SpriteMaterial).opacity = Math.max(0, f.t / 0.3);
    }
  }

  setNight(f: number): void {
    this.signMat.emissiveIntensity = 0.4 + f * 1.6;
    this.laneLights.emissiveIntensity = 1.2 + f * 2;
  }

  private add(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private buildPlaza(p: (typeof TOLL_PLAZAS)[number]): void {
    const steel = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 0.6, roughness: 0.35 });
    const roof = new THREE.MeshStandardMaterial({ color: '#0f5a43', roughness: 0.6, metalness: 0.2 });
    const kerb = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.7 });
    const booth = new THREE.MeshStandardMaterial({ color: '#e8e6e0', roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: '#7fb6cf', metalness: 0.8, roughness: 0.1, transparent: true, opacity: 0.55 });
    const W = BRIDGE_HALF + 1;
    // Canopy on columns across the whole road.
    const cols: THREE.BufferGeometry[] = [];
    for (const zo of [-W, W]) for (const xo of [-2.5, 2.5]) cols.push(new THREE.CylinderGeometry(0.28, 0.28, CANOPY_H, 10).translate(p.x + xo, CANOPY_H / 2, p.z + zo));
    for (const isl of p.islands) for (const xo of [-2.5, 2.5]) cols.push(new THREE.CylinderGeometry(0.16, 0.16, CANOPY_H, 8).translate(p.x + xo, CANOPY_H / 2, (isl.minZ + isl.maxZ) / 2));
    this.add(merge(cols), steel);
    this.add(new THREE.BoxGeometry(9, 0.6, W * 2 + 1.5).translate(p.x, CANOPY_H + 0.3, p.z), roof);
    // Signs on both faces of the canopy edge.
    for (const side of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.5), this.signMat);
      sign.position.set(p.x + side * 4.55, CANOPY_H + 0.2, p.z);
      sign.rotation.y = side * (Math.PI / 2);
      this.group.add(sign);
    }
    // Islands (yellow kerbs) with a booth on each.
    const kerbs: THREE.BufferGeometry[] = [];
    const booths: THREE.BufferGeometry[] = [];
    const panes: THREE.BufferGeometry[] = [];
    for (const isl of p.islands) {
      const zc = (isl.minZ + isl.maxZ) / 2;
      kerbs.push(new THREE.BoxGeometry(TOLL_ISLAND_LEN, 0.25, isl.maxZ - isl.minZ).translate(p.x, 0.125, zc));
      booths.push(new THREE.BoxGeometry(2.2, 2.4, isl.maxZ - isl.minZ - 0.05).translate(p.x + 1.2, 1.45, zc));
      panes.push(new THREE.BoxGeometry(2.25, 0.9, isl.maxZ - isl.minZ + 0.02).translate(p.x + 1.2, 1.9, zc));
    }
    this.add(merge(kerbs), kerb);
    this.add(merge(booths), booth);
    this.add(merge(panes), glass, false);
    // Lane lights and barrier arms for the lanes towards the far shore (eastbound).
    const lights: THREE.BufferGeometry[] = [];
    for (const z of p.east) {
      lights.push(new THREE.BoxGeometry(0.2, 0.5, 0.5).translate(p.x - 0.1, CANOPY_H - 0.6, z));
      // The arm hinges on the island on the lane's right (+z side), across the lane towards -z.
      const pivot = new THREE.Group();
      pivot.position.set(TOLL_X, 1.05, z + 1.75);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.4).translate(0, 0, -1.7), this.armMat);
      bar.castShadow = true;
      pivot.add(bar);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35).translate(TOLL_X, 0.55, z + 1.75), steel);
      this.group.add(post, pivot);
      this.arms.push({ n: p.n, z, pivot, bar, up: 0, broken: 0, angle: 0 });
    }
    this.add(merge(lights), this.laneLights, false);
  }

  private buildCameras(): void {
    const frame = new THREE.MeshStandardMaterial({ color: '#2d3138', metalness: 0.6, roughness: 0.4 });
    const body = new THREE.MeshStandardMaterial({ color: '#1d2026', roughness: 0.5 });
    const led = new THREE.MeshStandardMaterial({ color: '#ff3030', emissive: '#ff2020', emissiveIntensity: 1.5 });
    const tex = Tex.sign('PLAKA TANIMA · ANPR', { bg: '#1b1d22', fg: '#ffffff', accent: '#ff3b30', w: 1024, h: 160 });
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    for (const c of ANPR_CAMERAS) {
      const b = bridgeByN(c.n)!;
      // Over the deck the gantry stands on the deck; at the plaza the cameras hang from the canopy.
      const y0 = c.deck ? deckHeight(b, c.x) : 0;
      const top = c.deck ? y0 + 7.4 : CANOPY_H - 0.1;
      const zs = BRIDGE_HALF + 0.9;
      if (c.deck) {
        this.add(merge([new THREE.BoxGeometry(0.45, 7.6, 0.45).translate(c.x, y0 + 3.8, c.z - zs), new THREE.BoxGeometry(0.45, 7.6, 0.45).translate(c.x, y0 + 3.8, c.z + zs), new THREE.BoxGeometry(0.6, 0.6, zs * 2 + 0.4).translate(c.x, top, c.z)]), frame);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.25), signMat);
        sign.position.set(c.x, top + 1, c.z);
        sign.rotation.y = Math.PI / 2;
        this.group.add(sign);
      }
      const boxes: THREE.BufferGeometry[] = [];
      const leds: THREE.BufferGeometry[] = [];
      for (const lane of [-1, 1]) for (const k of [3, 8.5]) {
        const z = c.z + lane * k;
        boxes.push(new THREE.BoxGeometry(0.5, 0.35, 0.35).translate(c.x, top - 0.5, z));
        leds.push(new THREE.BoxGeometry(0.06, 0.08, 0.08).translate(c.x - lane * 0.27, top - 0.42, z + 0.1));
      }
      this.add(merge(boxes), body);
      this.add(merge(leds), led, false);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: '#ffdede', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      glow.position.set(c.x, top - 0.6, c.z);
      glow.scale.setScalar(26);
      this.group.add(glow);
      this.flashes.set(c.id, { glow, t: 0 });
    }
  }
}

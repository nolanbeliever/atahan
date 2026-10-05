// Police checkpoints on the client (shared/trafficStops.ts): the orange cones narrowing the road to
// one lane through the stop, a "DUR · POLİS UYGULAMASI" sign on a stand facing each way with a
// blinking amber lamp on top, and a stop line across the lane. The patrol cars come with the police
// snapshots, the officers and the K9 dog with the NPCs.

import * as THREE from 'three';
import { coneLayout, stopHeading, stopPoint, type StopView } from '../../../shared/trafficStops';
import { surfaceY } from './City';
import { lightGlowTexture } from './Highway';

let kit: {
  cone: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
  base: THREE.BufferGeometry;
  coneMat: THREE.MeshStandardMaterial;
  bandMat: THREE.MeshStandardMaterial;
  baseMat: THREE.MeshStandardMaterial;
  pole: THREE.MeshStandardMaterial;
  sign: THREE.MeshStandardMaterial;
  line: THREE.MeshStandardMaterial;
  lamp: THREE.MeshBasicMaterial;
} | null = null;

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  // A red octagon "DUR" over a blue "POLİS UYGULAMASI" plate.
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#d6111a';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = 128 + Math.cos(a) * 88;
    const y = 100 + Math.sin(a) * 88;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '900 64px system-ui, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DUR', 128, 102);
  g.fillStyle = '#1f4fd1';
  g.fillRect(0, 200, 256, 56);
  g.fillStyle = '#ffffff';
  g.font = '900 25px system-ui, Arial, sans-serif';
  g.fillText('POLİS UYGULAMASI', 128, 229);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function parts(): NonNullable<typeof kit> {
  if (kit) return kit;
  const tex = signTexture();
  kit = {
    cone: new THREE.ConeGeometry(0.2, 0.72, 14, 1, true).translate(0, 0.4, 0),
    band: new THREE.CylinderGeometry(0.115, 0.15, 0.13, 14, 1, true).translate(0, 0.46, 0),
    base: new THREE.BoxGeometry(0.46, 0.04, 0.46).translate(0, 0.02, 0),
    coneMat: new THREE.MeshStandardMaterial({ color: '#ff5a0a', roughness: 0.55, emissive: '#ff3c00', emissiveIntensity: 0.12 }),
    bandMat: new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.25, metalness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.25 }),
    baseMat: new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.9 }),
    pole: new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 0.6, roughness: 0.4 }),
    sign: new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.18, roughness: 0.5 }),
    line: new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
    lamp: new THREE.MeshBasicMaterial({ color: '#ffb300', toneMapped: false }),
  };
  return kit;
}

interface Built {
  view: StopView;
  group: THREE.Group;
  lamps: { mesh: THREE.Mesh; glow: THREE.Sprite }[];
}

export class TrafficStopsView {
  private stops = new Map<string, Built>();
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {}

  /** The stops up now (the full list, replacing what was there). */
  set(list: StopView[]): void {
    const ids = new Set(list.map((s) => s.id));
    for (const [id, b] of this.stops) {
      if (ids.has(id) && b.view.until === list.find((s) => s.id === id)!.until) continue;
      b.group.removeFromParent();
      b.group.traverse((o) => {
        if ((o as THREE.Sprite).isSprite) ((o as THREE.Sprite).material as THREE.SpriteMaterial).dispose();
      });
      this.stops.delete(id);
    }
    for (const v of list) if (!this.stops.has(v.id)) this.build(v);
  }

  private build(v: StopView): void {
    const k = parts();
    const group = new THREE.Group();
    const y0 = surfaceY(v.x, v.z);
    group.position.set(v.x, y0, v.z);
    const at = (along: number, across: number) => {
      const p = stopPoint(v, along, across);
      return new THREE.Vector3(p.x - v.x, surfaceY(p.x, p.z) - y0, p.z - v.z);
    };
    for (const [a, c] of coneLayout(v.half)) {
      const p = at(a, c);
      for (const [geo, mat] of [
        [k.cone, k.coneMat],
        [k.band, k.bandMat],
        [k.base, k.baseMat],
      ] as const) {
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(p);
        m.castShadow = geo !== k.base;
        group.add(m);
      }
    }
    // The stop line across the lane.
    const line = new THREE.Mesh(new THREE.BoxGeometry(v.axis === 'x' ? 0.35 : 6, 0.02, v.axis === 'x' ? 6 : 0.35), k.line);
    line.position.copy(at(0, 0)).y += 0.012;
    group.add(line);
    // A sign each way, at the mouth of the funnel, with an amber lamp blinking on top.
    const lamps: Built['lamps'] = [];
    for (const dir of [-1, 1]) {
      const p = at(dir * 14, dir * (v.half - 0.8));
      const stand = new THREE.Group();
      stand.position.copy(p);
      // Facing the cars coming in from that end.
      stand.rotation.y = stopHeading(v, dir);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.9, 8), k.pole);
      pole.position.y = 0.95;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), k.sign);
      sign.position.set(0, 1.55, 0.06);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), k.pole);
      back.position.set(0, 1.55, 0.05);
      back.rotation.y = Math.PI;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), k.lamp);
      lamp.position.y = 2.15;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: '#ffb300', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      glow.position.y = 2.15;
      glow.scale.setScalar(1.6);
      for (const o of [pole, sign, back, lamp]) o.castShadow = true;
      stand.add(pole, sign, back, lamp, glow);
      group.add(stand);
      lamps.push({ mesh: lamp, glow });
    }
    this.scene.add(group);
    this.stops.set(v.id, { view: v, group, lamps });
  }

  update(dt: number, night: number): void {
    this.time += dt;
    for (const b of this.stops.values()) {
      b.lamps.forEach((l, i) => {
        const on = (this.time * 1.4 + i * 0.5) % 1 < 0.5;
        l.mesh.visible = on;
        (l.glow.material as THREE.SpriteMaterial).opacity = on ? 0.5 + night * 0.4 : 0;
      });
    }
  }

  list(): StopView[] {
    return [...this.stops.values()].map((b) => b.view);
  }

  clear(): void {
    this.set([]);
  }
}

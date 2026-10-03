// The back alleys (shared/alleys.ts) in 3D: a wet cobbled floor between the apartment rows, the
// yellow-and-black steel bollards across both ends with a "bikes only" sign, fire escapes zig-zagging
// up the walls overhead, dumpsters and bin bags, graffiti, puddles, string lights that glow at night,
// and behind Wrench Bros a flight of steps up to a raised courtyard and back down, with handrails.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ALLEY_BUILDINGS, ALLEY_HALF, ALLEYS, BOLLARD_R, BOLLARDS, DUMPSTER_DEPTH, DUMPSTER_LEN, DUMPSTERS, type Alley } from '../../../shared/alleys';
import { mulberry32 } from '../../../shared/util';
import { SIDEWALK_HEIGHT } from './City';
import { lightGlowTexture } from './Highway';
import { Tex } from './Textures';

const Y0 = SIDEWALK_HEIGHT;
const FLOOR_H = 3.4;

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

/** A box in the alley's own frame: x along the alley, z across it (+ towards the side +1 wall). */
function box(sx: number, sy: number, sz: number, along: number, y: number, across: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(sx, sy, sz).translate(along, y, across);
}

/** A thin bar from one point to another (alley frame). */
function bar(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const d = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** Spray-painted tags for the walls. */
function graffiti(text: string, seed: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const rng = mulberry32(seed);
  const hues = [[330, 95], [190, 90], [50, 100], [120, 80], [275, 85], [15, 95]];
  const [h, sat] = hues[seed % hues.length]!;
  g.translate(256, 136);
  g.rotate((rng() - 0.5) * 0.25);
  g.font = `900 ${text.length > 6 ? 92 : 120}px Impact, 'Arial Black', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 22;
  g.strokeStyle = '#111';
  g.strokeText(text, 0, 0);
  const grad = g.createLinearGradient(0, -60, 0, 60);
  grad.addColorStop(0, `hsl(${h}, ${sat}%, 70%)`);
  grad.addColorStop(1, `hsl(${(h + 40) % 360}, ${sat}%, 48%)`);
  g.fillStyle = grad;
  g.fillText(text, 0, 0);
  g.lineWidth = 4;
  g.strokeStyle = '#fff';
  g.strokeText(text, -3, -3);
  // Drips.
  g.fillStyle = `hsl(${h}, ${sat}%, 55%)`;
  for (let i = 0; i < 9; i++) g.fillRect(-200 + rng() * 400, 30 + rng() * 10, 4, 20 + rng() * 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The round "no motor vehicles" traffic sign, with a motorcycle allowed underneath. */
function noCarsSign(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 26;
  g.strokeStyle = '#d7191c';
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  // A little car.
  g.fillStyle = '#111';
  g.beginPath();
  g.moveTo(58, 150);
  g.lineTo(70, 112);
  g.lineTo(100, 96);
  g.lineTo(156, 96);
  g.lineTo(186, 112);
  g.lineTo(198, 150);
  g.closePath();
  g.fill();
  for (const x of [88, 170]) {
    g.beginPath();
    g.arc(x, 154, 15, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 22;
  g.strokeStyle = '#d7191c';
  g.beginPath();
  g.moveTo(54, 54);
  g.lineTo(202, 202);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Height of the building on one wall of an alley at a point along it. */
function wallHeight(a: Alley, along: number, side: -1 | 1): number {
  const across = a.c + side * (ALLEY_HALF + 0.5);
  for (const b of ALLEY_BUILDINGS) {
    const [x, z] = a.axis === 'x' ? [along, across] : [across, along];
    if (x > b.box.minX && x < b.box.maxX && z > b.box.minZ && z < b.box.maxZ) return b.height;
  }
  return 8;
}

export class AlleysView {
  readonly group = new THREE.Group();
  private readonly bulbMat = new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffbf5a', emissiveIntensity: 0.3 });
  private readonly signMats: THREE.MeshStandardMaterial[] = [];
  private readonly glows: THREE.Sprite[] = [];

  constructor() {
    this.group.name = 'alleys';
    const mats = {
      floor: new THREE.MeshStandardMaterial({ map: repeat(Tex.asphalt(), 2, 10), color: '#5d5a57', roughness: 0.55, metalness: 0.1 }),
      step: new THREE.MeshStandardMaterial({ map: repeat(Tex.concrete(), 1, 1), color: '#a39d93', roughness: 0.85 }),
      iron: new THREE.MeshStandardMaterial({ color: '#23262b', metalness: 0.65, roughness: 0.45 }),
      rail: new THREE.MeshStandardMaterial({ color: '#3a3f46', metalness: 0.8, roughness: 0.3 }),
      yellow: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.45, metalness: 0.3 }),
      black: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.5, metalness: 0.3 }),
      reflect: new THREE.MeshStandardMaterial({ color: '#f4f4f4', emissive: '#ffffff', emissiveIntensity: 0.15, roughness: 0.2, metalness: 0.4 }),
      green: new THREE.MeshStandardMaterial({ color: '#2f4a3a', roughness: 0.7, metalness: 0.35 }),
      blue: new THREE.MeshStandardMaterial({ color: '#2a3b5c', roughness: 0.7, metalness: 0.35 }),
      lid: new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.6 }),
      bag: new THREE.MeshStandardMaterial({ color: '#111216', roughness: 0.35, metalness: 0.1 }),
      ac: new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.6, metalness: 0.4 }),
      puddle: new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.04, metalness: 0.6, transparent: true, opacity: 0.75 }),
      wire: new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.8 }),
    };
    const noCars = new THREE.MeshStandardMaterial({ map: noCarsSign(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
    ALLEYS.forEach((a, i) => this.buildAlley(a, i, mats, noCars));
    this.buildBollards(mats);
  }

  setNight(f: number): void {
    this.bulbMat.emissiveIntensity = 0.3 + f * 2.6;
    for (const m of this.signMats) m.emissiveIntensity = 0.3 + f * 1.4;
    for (const s of this.glows) (s.material as THREE.SpriteMaterial).opacity = f * 0.55;
  }

  private buildAlley(a: Alley, index: number, mats: Record<string, THREE.MeshStandardMaterial>, noCars: THREE.Material): void {
    const g = new THREE.Group();
    // The alley's own frame: x along it, z across it (+z towards the side +1 wall).
    if (a.axis === 'x') g.position.set(0, 0, a.c);
    else {
      g.position.set(a.c, 0, 0);
      g.rotation.y = -Math.PI / 2;
    }
    // In this frame a world side +1 (higher x) of a north-south alley is local -z.
    const flip = a.axis === 'x' ? 1 : -1;
    const across = (side: -1 | 1, d: number) => flip * side * d;
    const rng = mulberry32(911 + index * 77);
    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => {
      if (geos.length === 0) return;
      const m = new THREE.Mesh(merge(geos), mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      g.add(m);
    };
    const W = ALLEY_HALF * 2;
    const len = a.to - a.from;
    const mid = (a.from + a.to) / 2;

    // Floor (and the steps).
    const floor: THREE.BufferGeometry[] = [];
    const steps: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const s = a.stairs;
    if (!s) floor.push(new THREE.PlaneGeometry(len, W).rotateX(-Math.PI / 2).translate(mid, Y0 + 0.012, 0));
    else {
      floor.push(new THREE.PlaneGeometry(s.up - a.from, W).rotateX(-Math.PI / 2).translate((a.from + s.up) / 2, Y0 + 0.012, 0));
      floor.push(new THREE.PlaneGeometry(a.to - s.end, W).rotateX(-Math.PI / 2).translate((s.end + a.to) / 2, Y0 + 0.012, 0));
      const n = 8;
      const flight = (from: number, to: number) => {
        const d = (to - from) / n;
        for (let k = 0; k < n; k++) {
          const h = (s.rise * (k + 0.5)) / n + 0.04;
          steps.push(box(Math.abs(d) + 0.02, h, W, from + d * (k + 0.5), Y0 + h / 2, 0));
        }
      };
      flight(s.up, s.top);
      flight(s.end, s.down);
      steps.push(box(s.down - s.top, s.rise, W, (s.top + s.down) / 2, Y0 + s.rise / 2, 0));
      // Handrails along both walls, 0.9 m over the line of the steps, on posts.
      for (const side of [-1, 1] as const) {
        const z = across(side, ALLEY_HALF - 0.12);
        const pts = [new THREE.Vector3(s.up - 0.3, Y0 + 0.9, z), new THREE.Vector3(s.top, Y0 + s.rise + 0.9, z), new THREE.Vector3(s.down, Y0 + s.rise + 0.9, z), new THREE.Vector3(s.end + 0.3, Y0 + 0.9, z)];
        for (let k = 0; k < 3; k++) rails.push(bar(pts[k]!, pts[k + 1]!, 0.035));
        for (const p of pts) rails.push(bar(new THREE.Vector3(p.x, p.y - 0.9, z), p, 0.03));
      }
    }
    add(floor, mats.floor!, false);
    add(steps, mats.step!);
    add(rails, mats.rail!);

    // Puddles.
    const puddles: THREE.BufferGeometry[] = [];
    for (let k = 0; k < Math.round(len / 16); k++) {
      const at = a.from + 6 + rng() * (len - 12);
      if (s && at > s.up - 1 && at < s.end + 1) continue;
      puddles.push(new THREE.CircleGeometry(0.6 + rng() * 0.9, 18).scale(1.6, 1, 1).rotateX(-Math.PI / 2).translate(at, Y0 + 0.02, (rng() - 0.5) * 2.4));
    }
    add(puddles, mats.puddle!, false);

    // Fire escapes: a landing at every floor, railings, flights between landings and a drop ladder.
    const iron: THREE.BufferGeometry[] = [];
    for (const [at, side] of a.fireEscapes) {
      const top = wallHeight(a, at, side) - 1.4;
      const out = 1.15;
      const zc = across(side, ALLEY_HALF - out / 2);
      const zEdge = across(side, ALLEY_HALF - out);
      let flightDir = 1;
      for (let y = FLOOR_H; y <= top; y += FLOOR_H) {
        iron.push(box(3.2, 0.08, out, at, Y0 + y, zc));
        // Railing: top rail on the outer edge and the ends, posts.
        iron.push(box(3.2, 0.05, 0.05, at, Y0 + y + 0.95, zEdge));
        for (const e of [-1.6, 1.6]) iron.push(box(0.05, 0.05, out, at + e, Y0 + y + 0.95, zc));
        for (let px = -1.6; px <= 1.61; px += 0.8) iron.push(box(0.04, 0.95, 0.04, at + px, Y0 + y + 0.47, zEdge));
        // The flight up to the next landing.
        if (y + FLOOR_H <= top) {
          const x0 = at - flightDir * 1.4;
          const x1 = at + flightDir * 1.4;
          iron.push(bar(new THREE.Vector3(x0, Y0 + y + 0.05, zc), new THREE.Vector3(x1, Y0 + y + FLOOR_H, zc), 0.05));
          for (let k = 1; k < 9; k++) {
            const t = k / 9;
            iron.push(box(0.25, 0.04, out * 0.8, x0 + (x1 - x0) * t, Y0 + y + 0.05 + (FLOOR_H - 0.05) * t, zc));
          }
          flightDir = -flightDir;
        }
      }
      // Drop ladder from the first landing, stopping well above a rider's head.
      for (const e of [-0.22, 0.22]) iron.push(box(0.04, 1.6, 0.04, at + 1.1 + e, Y0 + FLOOR_H - 0.8, zEdge));
      for (let k = 0; k < 6; k++) iron.push(box(0.44, 0.03, 0.03, at + 1.1, Y0 + FLOOR_H - 0.2 - k * 0.27, zEdge));
      // Brackets into the wall.
      for (const e of [-1.4, 1.4]) iron.push(bar(new THREE.Vector3(at + e, Y0 + FLOOR_H - 0.9, across(side, ALLEY_HALF)), new THREE.Vector3(at + e, Y0 + FLOOR_H - 0.04, zEdge), 0.035));
    }
    add(iron, mats.iron!);

    // Dumpsters with bin bags, AC units and pipes on the walls.
    const green: THREE.BufferGeometry[] = [];
    const blue: THREE.BufferGeometry[] = [];
    const lids: THREE.BufferGeometry[] = [];
    const bags: THREE.BufferGeometry[] = [];
    for (const d of DUMPSTERS.filter((x) => x.alley === a.id)) {
      const z = across(d.side, ALLEY_HALF - DUMPSTER_DEPTH / 2);
      (rng() < 0.5 ? green : blue).push(box(DUMPSTER_LEN, 1.15, DUMPSTER_DEPTH, d.along, Y0 + 0.6, z));
      lids.push(box(DUMPSTER_LEN + 0.1, 0.08, DUMPSTER_DEPTH + 0.1, d.along, Y0 + 1.22, z));
      for (let k = 0; k < 3; k++) bags.push(new THREE.SphereGeometry(0.34, 8, 6).scale(1, 0.8, 1).translate(d.along + DUMPSTER_LEN / 2 + 0.35 + k * 0.45, Y0 + 0.28, across(d.side, ALLEY_HALF - 0.35 - (k % 2) * 0.3)));
    }
    add(green, mats.green!);
    add(blue, mats.blue!);
    add(lids, mats.lid!);
    add(bags, mats.bag!);
    const ac: THREE.BufferGeometry[] = [];
    const pipes: THREE.BufferGeometry[] = [];
    for (let at = a.from + 5; at < a.to - 4; at += 7 + rng() * 6) {
      const side: -1 | 1 = rng() < 0.5 ? -1 : 1;
      const y = 3 + Math.floor(rng() * 2) * FLOOR_H + 0.8;
      ac.push(box(0.9, 0.6, 0.5, at, Y0 + y, across(side, ALLEY_HALF - 0.25)));
      if (rng() < 0.6) pipes.push(box(0.12, wallHeight(a, at, side), 0.12, at + 0.8, Y0 + wallHeight(a, at, side) / 2, across(side, ALLEY_HALF - 0.08)));
    }
    add(ac, mats.ac!);
    add(pipes, mats.rail!);

    // Graffiti on the walls.
    const tags = ['GETRICH', 'KAÇ!', 'NO COPS', 'BRRAP', 'İSTANBUL', '34 ATA', 'GAZLA', 'SOKAK'];
    for (let k = 0; k < 3; k++) {
      const side: -1 | 1 = k % 2 ? 1 : -1;
      const at = a.from + ((k + 0.6) / 3.2) * len;
      const tex = graffiti(tags[(index * 3 + k) % tags.length]!, index * 10 + k);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.position.set(at, Y0 + 1.7 + (s && at > s.up && at < s.end ? s.rise : 0), across(side, ALLEY_HALF - 0.03));
      m.rotation.y = flip * side > 0 ? Math.PI : 0;
      g.add(m);
    }

    // String lights across the alley.
    const wires: THREE.BufferGeometry[] = [];
    const bulbs: THREE.BufferGeometry[] = [];
    for (let at = a.from + 8; at < a.to - 6; at += 11) {
      const y = 5.2 + rng() * 0.6;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        pts.push(new THREE.Vector3(at + (t - 0.5) * 1.5, Y0 + y - Math.sin(t * Math.PI) * 0.6, -ALLEY_HALF + t * W));
      }
      for (let k = 0; k < 8; k++) wires.push(bar(pts[k]!, pts[k + 1]!, 0.012));
      for (let k = 1; k < 8; k++) bulbs.push(new THREE.SphereGeometry(0.07, 6, 5).translate(pts[k]!.x, pts[k]!.y - 0.08, pts[k]!.z));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: '#ffb35a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.set(at, Y0 + y - 0.5, 0);
      glow.scale.setScalar(5);
      this.glows.push(glow);
      g.add(glow);
    }
    add(wires, mats.wire!, false);
    add(bulbs, this.bulbMat, false);

    // At each end: a sign across the top and the round "no cars" sign on the wall.
    const signTex = Tex.sign(`🏍 ${a.name.toUpperCase()}`, { bg: '#1b1d22', fg: '#ffd23f', accent: '#ff7a1a', w: 1024, h: 180, sub: 'SADECE MOTOSİKLET & ATV · ARAÇ GİREMEZ' });
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.3, side: THREE.DoubleSide });
    this.signMats.push(signMat);
    for (const [end, dir] of [
      [a.from, -1],
      [a.to, 1],
    ] as const) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(W, W * (180 / 1024)), signMat);
      // Facing out into the street (readable as you ride in).
      sign.position.set(end - dir * 0.15, Y0 + 4.4, 0);
      sign.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(sign);
      const round = new THREE.Mesh(new THREE.CircleGeometry(0.38, 28), noCars);
      // On the corner of the building beside the entrance.
      round.position.set(end + dir * 0.03, Y0 + 2.3, across(1, ALLEY_HALF + 0.7));
      round.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(round);
    }
    this.group.add(g);
  }

  private buildBollards(mats: Record<string, THREE.MeshStandardMaterial>): void {
    const yellow: THREE.BufferGeometry[] = [];
    const black: THREE.BufferGeometry[] = [];
    const white: THREE.BufferGeometry[] = [];
    for (const b of BOLLARDS) {
      yellow.push(new THREE.CylinderGeometry(BOLLARD_R, BOLLARD_R, 1.0, 12).translate(b.x, Y0 + 0.5, b.z));
      yellow.push(new THREE.SphereGeometry(BOLLARD_R, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(b.x, Y0 + 1.0, b.z));
      for (const y of [0.35, 0.7]) black.push(new THREE.CylinderGeometry(BOLLARD_R + 0.004, BOLLARD_R + 0.004, 0.1, 12).translate(b.x, Y0 + y, b.z));
      white.push(new THREE.CylinderGeometry(BOLLARD_R + 0.006, BOLLARD_R + 0.006, 0.06, 12).translate(b.x, Y0 + 0.88, b.z));
    }
    for (const [geos, mat] of [
      [yellow, mats.yellow],
      [black, mats.black],
      [white, mats.reflect],
    ] as const) {
      const m = new THREE.Mesh(merge(geos), mat);
      m.castShadow = true;
      this.group.add(m);
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

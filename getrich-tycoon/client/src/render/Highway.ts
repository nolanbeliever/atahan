// The GetRich Expressway in 3D: two 4-lane carriageways around the city with lane markings,
// guardrails, a concrete median, junctions to the city, bridges, sign gantries and street lights
// that come on at night - plus the drag strip in the west belt. Geometry comes from
// shared/highway.ts, so it lines up with the collisions and the traffic.

import { registerRoad } from './Weather';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CARRIAGEWAY_EDGE,
  CORNER_LEN,
  DRAG_GRANDSTAND,
  DRAG_STRIP,
  GUARDRAIL_OFFSET,
  HIGHWAY_BARRIERS,
  HW_HALF,
  JUNCTIONS,
  JUNCTION_APRON,
  LANES,
  LANE_WIDTH,
  LOOP_LEN,
  MEDIAN_HALF,
  OVERPASSES,
  OVERPASS_DECK,
  OVERPASS_HEIGHT,
  OVERPASS_RAMP,
  OVERPASS_WIDTH,
  RAMP_SPAN,
  SIGN_GANTRIES,
  STRAIGHT_LEN,
  STREET_LIGHTS,
  barrierEndCaps,
  deltaS,
  inGap,
  pathPoint,
  wrapS,
  type Barrier,
} from '../../../shared/highway';
import { CITY_HALF } from '../../../shared/world';
import { Tex } from './Textures';

const SEG = STRAIGHT_LEN + CORNER_LEN;

/** Sample positions over [s0, s1] (fine on the corners, coarse on the straights). */
function samples(s0: number, s1: number): number[] {
  const out: number[] = [s0];
  let s = s0;
  while (s < s1 - 1e-6) {
    const u = wrapS(s) % SEG;
    const step = u < STRAIGHT_LEN ? Math.min(10, STRAIGHT_LEN - u > 0.01 ? STRAIGHT_LEN - u : 10) : 2.2;
    s = Math.min(s1, s + Math.max(0.3, step));
    out.push(s);
  }
  return out;
}

/** The parts of the loop not covered by the gaps. */
function runs(gaps: [number, number][]): [number, number][] {
  if (gaps.length === 0) return [[0, LOOP_LEN]];
  const g = gaps.map(([a, b]) => [wrapS(a), wrapS(a) + (wrapS(b) - wrapS(a) + LOOP_LEN) % LOOP_LEN] as [number, number]).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (let i = 0; i < g.length; i++) {
    const end = g[i]![1];
    const next = i + 1 < g.length ? g[i + 1]![0] : g[0]![0] + LOOP_LEN;
    if (next > end) out.push([end, next]);
  }
  return out;
}

/** Flat strip between two lateral offsets over [s0, s1], with world-space UVs. */
function strip(s0: number, s1: number, offA: number, offB: number, y: number, uvScale = 10): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ss = samples(s0, s1);
  ss.forEach((s, i) => {
    for (const off of [offA, offB]) {
      const p = pathPoint(s, off);
      pos.push(p.x, y, p.z);
      uv.push(p.x / uvScale, -p.z / uvScale);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Wind so the top faces up.
  const n = new THREE.Vector3();
  g.computeVertexNormals();
  n.fromBufferAttribute(g.getAttribute('normal') as THREE.BufferAttribute, 0);
  if (n.y < 0) {
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i += 3) {
      const t = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, t);
    }
    g.computeVertexNormals();
  }
  return g;
}

/** A profile (lateral, height) swept along the path over [s0, s1] (barriers, rails). */
function sweep(s0: number, s1: number, offset: number, profile: [number, number][], closed = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const ss = samples(s0, s1);
  const n = profile.length;
  ss.forEach((s, i) => {
    for (const [dx, y] of profile) {
      const p = pathPoint(s, offset + dx);
      pos.push(p.x, y, p.z);
    }
    if (i > 0) {
      const a = (i - 1) * n;
      const b = i * n;
      const segs = closed ? n : n - 1;
      for (let k = 0; k < segs; k++) {
        const k1 = (k + 1) % n;
        idx.push(a + k, b + k, a + k1, a + k1, b + k, b + k1);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

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

/** Local frame at a straight-road point: x across the road (outwards), z along the traffic. */
function frameAt(s: number, offset = 0): THREE.Matrix4 {
  const p = pathPoint(s, offset);
  const nx = new THREE.Vector3(p.nx, 0, p.nz);
  const tz = new THREE.Vector3(p.tx, 0, p.tz);
  const m = new THREE.Matrix4().makeBasis(nx, new THREE.Vector3(0, 1, 0), tz);
  m.setPosition(p.x, 0, p.z);
  return m;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, frame: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g.applyMatrix4(frame);
}

/** Radial light pool texture (street lights and headlights at night). */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,236,190,0.95)');
  grd.addColorStop(0.35, 'rgba(255,220,160,0.45)');
  grd.addColorStop(1, 'rgba(255,210,150,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowTex: THREE.Texture | null = null;
export function lightGlowTexture(): THREE.Texture {
  return (glowTex ??= glowTexture());
}

function signTexture(text: string, sub: string | undefined, bg: string, w = 1024, h = 256): THREE.Texture {
  return Tex.sign(text, { bg, fg: '#ffffff', w, h, sub, accent: '#ffffff' });
}

/** Lamp heads and light pools that react to the time of day. */
export interface NightLights {
  setNight(f: number): void;
}

export class HighwayView implements NightLights {
  readonly group = new THREE.Group();
  private lampMat = new THREE.MeshStandardMaterial({ color: '#fff6dc', emissive: '#ffd98a', emissiveIntensity: 0.2, roughness: 0.4 });
  private poolMat = new THREE.MeshBasicMaterial({ map: lightGlowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffd9a0' });
  private pools: THREE.InstancedMesh | null = null;
  readonly tree: DragTreeView;

  constructor() {
    this.group.name = 'highway';
    this.buildRoadway();
    this.buildMarkings();
    this.buildBarriers();
    this.buildJunctions();
    this.buildLights();
    this.buildOverpasses();
    this.buildGantries();
    this.tree = this.buildDragStrip();
    this.group.traverse((o) => {
      if (o === this.tree.group || o.parent === this.tree.group) return;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  setNight(f: number): void {
    this.lampMat.emissiveIntensity = 0.2 + f * 2.6;
    this.poolMat.opacity = f * 0.55;
    if (this.pools) this.pools.visible = f > 0.02;
  }

  private add(geo: THREE.BufferGeometry, mat: THREE.Material, opts: { cast?: boolean; receive?: boolean } = {}): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = opts.cast ?? false;
    m.receiveShadow = opts.receive ?? true;
    this.group.add(m);
    return m;
  }

  private buildRoadway(): void {
    const asphalt = registerRoad(new THREE.MeshStandardMaterial({ map: Tex.asphalt(), roughness: 0.93, color: '#b8bcc4' }));
    const shoulder = registerRoad(new THREE.MeshStandardMaterial({ map: Tex.asphalt(), roughness: 0.95, color: '#9ea2a8' }));
    const median = new THREE.MeshStandardMaterial({ map: Tex.concrete(), roughness: 0.9, color: '#b6b2a8' });
    const verge = new THREE.MeshStandardMaterial({ map: Tex.concrete(), roughness: 1, color: '#7d8a6a' });
    const laneEdge = MEDIAN_HALF + LANES * LANE_WIDTH;
    const geos: THREE.BufferGeometry[] = [];
    const shoulders: THREE.BufferGeometry[] = [];
    for (const sign of [-1, 1]) {
      geos.push(strip(0, LOOP_LEN, sign * MEDIAN_HALF, sign * laneEdge, 0.012));
      shoulders.push(strip(0, LOOP_LEN, sign * laneEdge, sign * CARRIAGEWAY_EDGE, 0.011));
    }
    this.add(merge(geos), asphalt);
    this.add(merge(shoulders), shoulder);
    this.add(strip(0, LOOP_LEN, -MEDIAN_HALF, MEDIAN_HALF, 0.013), median);
    // Gravel verge outside the guardrails.
    this.add(merge([strip(0, LOOP_LEN, -GUARDRAIL_OFFSET - 2.5, -CARRIAGEWAY_EDGE, 0.006), strip(0, LOOP_LEN, CARRIAGEWAY_EDGE, GUARDRAIL_OFFSET + 2.5, 0.006)]), verge);
  }

  private buildMarkings(): void {
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 });
    const whites: THREE.BufferGeometry[] = [];
    const yellows: THREE.BufferGeometry[] = [];
    const y = 0.022;
    const dash = 4;
    const period = 12;
    for (const sign of [-1, 1]) {
      // Dashed white lines between the lanes.
      for (let k = 1; k < LANES; k++) {
        const off = sign * (MEDIAN_HALF + k * LANE_WIDTH);
        for (let s = 0; s < LOOP_LEN - dash; s += period) whites.push(strip(s, s + dash, off - 0.08, off + 0.08, y));
      }
      // Solid yellow edge lines (median side and shoulder side).
      const inner = sign * (MEDIAN_HALF + 0.18);
      const outer = sign * (MEDIAN_HALF + LANES * LANE_WIDTH + 0.12);
      yellows.push(strip(0, LOOP_LEN, inner - 0.1, inner + 0.1, y));
      yellows.push(strip(0, LOOP_LEN, outer - 0.1, outer + 0.1, y));
    }
    this.add(merge(whites), white);
    this.add(merge(yellows), yellow);
  }

  private buildBarriers(): void {
    const steel = new THREE.MeshStandardMaterial({ color: '#c4cad1', metalness: 0.75, roughness: 0.35 });
    const concrete = new THREE.MeshStandardMaterial({ map: Tex.concrete(), color: '#d6d2c8', roughness: 0.85 });
    const rails: THREE.BufferGeometry[] = [];
    const jersey: THREE.BufferGeometry[] = [];
    const posts: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (const b of HIGHWAY_BARRIERS) {
      for (const [s0, s1] of runs(b.gaps)) {
        if (b.kind === 'median') {
          // Concrete safety barrier (jersey profile).
          jersey.push(
            sweep(s0, s1, 0, [
              [-0.34, 0],
              [-0.28, 0.1],
              [-0.12, 0.36],
              [-0.1, 0.86],
              [0.1, 0.86],
              [0.12, 0.36],
              [0.28, 0.1],
              [0.34, 0],
            ]),
          );
        } else {
          // W-beam guardrail on posts, facing the road.
          const face = b.offset < 0 ? 1 : -1;
          const beam: [number, number][] = [
            [0, 0.52],
            [0.06 * face, 0.58],
            [0.02 * face, 0.66],
            [0.06 * face, 0.74],
            [0, 0.8],
          ];
          rails.push(sweep(s0, s1, b.offset, beam));
          rails.push(sweep(s0, s1, b.offset - 0.03 * face, [...beam].reverse()));
          for (let s = s0 + 1; s < s1 - 0.5; s += 4) {
            const p = pathPoint(s, b.offset - 0.12 * face);
            posts.push(m.clone().compose(new THREE.Vector3(p.x, 0.42, p.z), q, one));
          }
        }
      }
    }
    this.add(merge(rails), steel, { cast: true });
    this.add(merge(jersey), concrete, { cast: true });
    const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.84, 0.14), steel, posts.length);
    posts.forEach((pm, i) => postMesh.setMatrixAt(i, pm));
    this.group.add(postMesh);
    // Yellow/black crash cushions at every barrier end.
    const caps = barrierEndCaps();
    const cushion = new THREE.MeshStandardMaterial({ color: '#f6c026', roughness: 0.6 });
    const capMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 10), cushion, caps.length);
    caps.forEach((c, i) => capMesh.setMatrixAt(i, m.makeTranslation(c.x, 0.45, c.z)));
    this.group.add(capMesh);
  }

  private buildJunctions(): void {
    const asphalt = registerRoad(new THREE.MeshStandardMaterial({ map: Tex.asphalt(), roughness: 0.93, color: '#b8bcc4' }));
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 });
    const roads: THREE.BufferGeometry[] = [];
    const whites: THREE.BufferGeometry[] = [];
    const yellows: THREE.BufferGeometry[] = [];
    for (const j of JUNCTIONS) {
      const f = frameAt(j.s);
      const cityOff = -(HW_HALF - CITY_HALF) + 2;
      // Connector road: 2 lanes, from the city's outer road to the ramps.
      const len = -JUNCTION_APRON - cityOff;
      roads.push(boxAt(len, 0.02, 12, (cityOff - JUNCTION_APRON) / 2, 0.005, 0, f));
      // The apron flares out to the off-ramp (before) and on-ramp (after) along the slow lane.
      const shape = new THREE.Shape();
      const edge = -CARRIAGEWAY_EDGE + 0.2;
      // Shape (x, y) becomes local (x, -z) once laid flat (facing up).
      shape.moveTo(-JUNCTION_APRON - 0.5, 6);
      shape.lineTo(-JUNCTION_APRON - 0.5, -6);
      shape.lineTo(edge, -RAMP_SPAN[1] - 4);
      shape.lineTo(edge, RAMP_SPAN[0] + 4);
      const apron = new THREE.ShapeGeometry(shape);
      apron.rotateX(-Math.PI / 2);
      apron.translate(0, 0.009, 0);
      roads.push(apron.applyMatrix4(f));
      // Markings: centre line, edges, and the ramp gore lines.
      for (let x = cityOff; x < -JUNCTION_APRON - 3; x += 6) yellows.push(boxAt(3, 0.02, 0.16, x + 1.5, 0.02, 0, f));
      for (const side of [-1, 1]) whites.push(boxAt(len, 0.02, 0.14, (cityOff - JUNCTION_APRON) / 2, 0.02, side * 5.6, f));
      const gore = (x0: number, z0: number, x1: number, z1: number) => {
        const L = Math.hypot(x1 - x0, z1 - z0);
        const g = new THREE.BoxGeometry(L, 0.02, 0.16);
        g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
        g.translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
        whites.push(g.applyMatrix4(f));
      };
      gore(-MEDIAN_HALF - LANES * LANE_WIDTH - 0.1, -RAMP_SPAN[0], -JUNCTION_APRON, -5.6);
      gore(-JUNCTION_APRON, 5.6, -MEDIAN_HALF - LANES * LANE_WIDTH - 0.1, RAMP_SPAN[1]);
      // Direction signs at the city end.
      this.signPost(f, cityOff - 1, 8.5, 'EXPRESSWAY', 'ALL DIRECTIONS', '#1c6b3a', Math.PI);
      this.signPost(f, -JUNCTION_APRON - 4, -8.5, 'CITY CENTER', j.name, '#1d4f91', 0);
    }
    this.add(merge(roads), asphalt);
    this.add(merge(whites), white);
    this.add(merge(yellows), yellow);
  }

  private signPost(frame: THREE.Matrix4, x: number, z: number, text: string, sub: string, bg: string, rot: number): void {
    const pole = new THREE.MeshStandardMaterial({ color: '#8b939c', metalness: 0.6, roughness: 0.4 });
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.4, 8), pole);
    post.position.y = 1.7;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), new THREE.MeshStandardMaterial({ map: signTexture(text, sub, bg, 768, 248), roughness: 0.5, side: THREE.DoubleSide }));
    board.position.y = 3.2;
    g.add(post, board);
    g.position.set(x, 0, z);
    g.rotation.y = rot + Math.PI / 2;
    const holder = new THREE.Group();
    holder.applyMatrix4(frame);
    holder.add(g);
    this.group.add(holder);
  }

  private buildLights(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: '#7c848d', metalness: 0.6, roughness: 0.4 });
    const spots = STREET_LIGHTS.filter((s) => !HIGHWAY_BARRIERS[1]!.gaps.some(([a, b]) => deltaS(a, s) > -3 && deltaS(b, s) < 3) && !OVERPASSES.some((o) => Math.abs(deltaS(o.s, s)) < 9));
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 10, 8), poleMat, spots.length);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(6.4, 0.12, 0.14), poleMat, spots.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.2, 0.5), this.lampMat, spots.length * 2);
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.poolMat, spots.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((s, i) => {
      const p = pathPoint(s, 0);
      const yaw = Math.atan2(p.nx, p.nz);
      q.setFromEuler(new THREE.Euler(0, yaw - Math.PI / 2, 0));
      poles.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, 5.4, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
      arms.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, 10.2, p.z), q, new THREE.Vector3(1, 1, 1)));
      for (const side of [-1, 1]) {
        const h = pathPoint(s, side * 3.3);
        heads.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m.compose(new THREE.Vector3(h.x, 10.05, h.z), q, new THREE.Vector3(1, 1, 1)));
        const f = pathPoint(s, side * 7.5);
        pools.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m.compose(new THREE.Vector3(f.x, 0.05, f.z), new THREE.Quaternion(), new THREE.Vector3(19, 1, 19)));
      }
    });
    poles.castShadow = true;
    pools.renderOrder = 2;
    this.pools = pools;
    this.group.add(poles, arms, heads, pools);
  }

  private buildOverpasses(): void {
    const concrete = new THREE.MeshStandardMaterial({ map: Tex.concrete(), color: '#cfcbc1', roughness: 0.85 });
    const road = registerRoad(new THREE.MeshStandardMaterial({ map: Tex.asphalt(), roughness: 0.93, color: '#a9adb4' }));
    const rail = new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.7, roughness: 0.35 });
    const decks: THREE.BufferGeometry[] = [];
    const tops: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const W = OVERPASS_WIDTH;
    const H = OVERPASS_HEIGHT;
    for (const o of OVERPASSES) {
      const f = frameAt(o.s);
      // Flat deck and girder.
      decks.push(boxAt(OVERPASS_DECK * 2, 1.3, W, 0, H - 0.65, 0, f));
      tops.push(boxAt(OVERPASS_DECK * 2, 0.05, W - 1, 0, H + 0.03, 0, f));
      // Piers: outside both guardrails and on the median.
      for (const x of [-22, 0, 22]) decks.push(boxAt(x === 0 ? 0.9 : 1.4, H - 1.3, W - 3, x, (H - 1.3) / 2, 0, f));
      // Ramps down to the ground on both sides (solid embankments with a road on top).
      for (const side of [-1, 1]) {
        const len = OVERPASS_RAMP - OVERPASS_DECK;
        const slope = Math.atan2(H, len);
        const hyp = Math.hypot(len, H);
        const mid = side * (OVERPASS_DECK + len / 2);
        const wedge = new THREE.BufferGeometry();
        const x0 = side * OVERPASS_DECK;
        const x1 = side * OVERPASS_RAMP;
        const hw = W / 2;
        // Triangular prism: top slope from (x0, H) to (x1, 0), vertical face at x0.
        const v = [
          [x0, 0, -hw], [x0, H, -hw], [x1, 0, -hw],
          [x0, 0, hw], [x1, 0, hw], [x0, H, hw],
          [x0, H, -hw], [x0, H, hw], [x1, 0, hw], [x0, H, -hw], [x1, 0, hw], [x1, 0, -hw],
        ];
        if (side < 0) for (let i = 0; i < v.length; i += 3) [v[i + 1], v[i + 2]] = [v[i + 2]!, v[i + 1]!];
        wedge.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3));
        wedge.computeVertexNormals();
        decks.push(wedge.applyMatrix4(f));
        const top = new THREE.BoxGeometry(hyp, 0.05, W - 1);
        top.rotateZ(-side * slope);
        top.translate(mid, H / 2 + 0.05, 0);
        tops.push(top.applyMatrix4(f));
        for (const e of [-1, 1]) {
          const r = new THREE.BoxGeometry(hyp, 0.9, 0.12);
          r.rotateZ(-side * slope);
          r.translate(mid, H / 2 + 0.5, e * (W / 2 - 0.1));
          rails.push(r.applyMatrix4(f));
        }
      }
      for (const e of [-1, 1]) rails.push(boxAt(OVERPASS_DECK * 2, 0.9, 0.12, 0, H + 0.45, e * (W / 2 - 0.1), f));
      // Name boards on both faces of the bridge.
      for (const e of [-1, 1]) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.4), new THREE.MeshStandardMaterial({ map: signTexture(o.label, undefined, '#1c6b3a', 1024, 110), roughness: 0.5 }));
        const holder = new THREE.Group();
        holder.applyMatrix4(f);
        board.position.set(0, H - 0.7, e * (W / 2 + 0.02));
        board.rotation.y = e > 0 ? 0 : Math.PI;
        holder.add(board);
        this.group.add(holder);
      }
    }
    this.add(merge(decks), concrete, { cast: true });
    this.add(merge(tops), road);
    this.add(merge(rails), rail, { cast: true });
  }

  private buildGantries(): void {
    const steel = new THREE.MeshStandardMaterial({ color: '#8f98a2', metalness: 0.65, roughness: 0.4 });
    const frames: THREE.BufferGeometry[] = [];
    for (const g of SIGN_GANTRIES) {
      for (const cw of [0, 1] as const) {
        const side = cw === 0 ? -1 : 1;
        const f = frameAt(g.s + (cw === 0 ? 0 : 20));
        const from = side * (GUARDRAIL_OFFSET + 0.8);
        const to = side * 1.1;
        for (const x of [from, to]) frames.push(boxAt(0.35, 7.4, 0.35, x, 3.7, 0, f));
        frames.push(boxAt(Math.abs(from - to), 0.3, 0.3, (from + to) / 2, 7.1, 0, f));
        frames.push(boxAt(Math.abs(from - to), 0.2, 0.2, (from + to) / 2, 6.3, 0, f));
        // Board faces the traffic on that carriageway.
        const text = cw === 0 ? g.inner : g.outer;
        const board = new THREE.Mesh(
          new THREE.PlaneGeometry(12, 2.2),
          new THREE.MeshStandardMaterial({ map: signTexture(text, cw === 0 ? '↑ EXPRESSWAY  ·  ↗ EXIT' : '↑ EXPRESSWAY', '#1c6b3a', 1024, 190), emissive: '#ffffff', emissiveIntensity: 0.05, roughness: 0.5 }),
        );
        const holder = new THREE.Group();
        holder.applyMatrix4(f);
        board.position.set(side * 9.6, 6.7, cw === 0 ? -0.22 : 0.22);
        board.rotation.y = cw === 0 ? Math.PI : 0;
        holder.add(board);
        this.group.add(holder);
      }
    }
    this.add(merge(frames), steel, { cast: true });
  }

  private buildDragStrip(): DragTreeView {
    const d = DRAG_STRIP;
    const asphalt = registerRoad(new THREE.MeshStandardMaterial({ map: Tex.asphalt(), roughness: 0.9, color: '#8d9098' }));
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 });
    const wallMat = new THREE.MeshStandardMaterial({ map: Tex.concrete(), color: '#e3e0d8', roughness: 0.8 });
    const flat = (x0: number, x1: number, z0: number, z1: number, y: number, geos: THREE.BufferGeometry[]) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
      const uv = g.getAttribute('uv');
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + (x0 + x1) / 2) / 10, -(pos.getZ(i) + (z0 + z1) / 2) / 10);
      g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      geos.push(g);
    };
    const road: THREE.BufferGeometry[] = [];
    flat(d.wallX[0], d.wallX[1], d.wallZ[0], d.wallZ[1], 0.012, road);
    flat(-206, -160, d.wallZ[1], 192, 0.011, road);
    this.add(merge(road), asphalt);
    const lines: THREE.BufferGeometry[] = [];
    const line = (x0: number, x1: number, z0: number, z1: number) => flat(x0, x1, z0, z1, 0.022, lines);
    const mid = (d.laneX[0] + d.laneX[1]) / 2;
    line(mid - 0.1, mid + 0.1, d.finishZ - 60, d.startZ + 14);
    for (const x of [d.wallX[0] + 1, d.wallX[1] - 1]) line(x - 0.08, x + 0.08, d.wallZ[0] + 2, d.startZ + 14);
    line(d.wallX[0] + 1, d.wallX[1] - 1, d.startZ - 0.12, d.startZ + 0.12);
    this.add(merge(lines), white);
    // Checkered finish line.
    const check = new THREE.CanvasTexture(
      (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 16;
        const g = c.getContext('2d')!;
        for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
          g.fillStyle = (i + j) % 2 ? '#111' : '#f5f5f5';
          g.fillRect(i * 4, j * 4, 4, 4);
        }
        return c;
      })(),
    );
    check.colorSpace = THREE.SRGBColorSpace;
    check.magFilter = THREE.NearestFilter;
    const finish = new THREE.Mesh(new THREE.PlaneGeometry(d.wallX[1] - d.wallX[0] - 2, 1.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: check, roughness: 0.6 }));
    finish.position.set(mid, 0.024, d.finishZ);
    this.group.add(finish);
    // Walls (with a coloured top stripe) and the grandstand.
    const walls: THREE.BufferGeometry[] = [];
    for (const x of d.wallX) {
      const g = new THREE.BoxGeometry(0.6, 1.1, d.wallZ[1] - d.wallZ[0]);
      g.translate(x + (x < mid ? -0.3 : 0.3), 0.55, (d.wallZ[0] + d.wallZ[1]) / 2);
      walls.push(g);
    }
    this.add(merge(walls), wallMat, { cast: true });
    const stripeMat = new THREE.MeshStandardMaterial({ color: '#d7263d', roughness: 0.5 });
    for (const x of d.wallX) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, d.wallZ[1] - d.wallZ[0]), stripeMat);
      s.position.set(x + (x < mid ? -0.3 : 0.3), 1.0, (d.wallZ[0] + d.wallZ[1]) / 2);
      this.group.add(s);
    }
    const gs = DRAG_GRANDSTAND;
    const seats: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const g = new THREE.BoxGeometry((gs.maxX - gs.minX) - k * 1.4, 0.6 + k * 0.6, gs.maxZ - gs.minZ);
      g.translate(gs.minX + ((gs.maxX - gs.minX) - k * 1.4) / 2 + k * 1.4, (0.6 + k * 0.6) / 2, (gs.minZ + gs.maxZ) / 2);
      seats.push(g);
    }
    this.add(merge(seats), new THREE.MeshStandardMaterial({ color: '#5a6473', roughness: 0.7 }), { cast: true });
    // Start and finish gantries with signs.
    const truss = new THREE.MeshStandardMaterial({ color: '#2b2f36', metalness: 0.5, roughness: 0.5 });
    const gantry = (z: number, text: string, sub: string, bg: string) => {
      const w = d.wallX[1] - d.wallX[0] + 2;
      for (const x of [d.wallX[0] - 1, d.wallX[1] + 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), truss);
        p.position.set(x, 3.5, z);
        this.group.add(p);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, 0.4), truss);
      beam.position.set(mid, 6.6, z);
      this.group.add(beam);
      for (const e of [-1, 1]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.2, 1.35), new THREE.MeshStandardMaterial({ map: Tex.sign(text, { bg, fg: '#ffffff', accent: '#f7b32b', sub }), emissive: '#ffffff', emissiveIntensity: 0.25 }));
        sign.position.set(mid, 6.6, z + e * 0.21);
        sign.rotation.y = e > 0 ? 0 : Math.PI;
        this.group.add(sign);
      }
    };
    gantry(d.startZ + 6, 'GETRICH DRAGWAY', `${d.lengthLabel} · $250 ENTRY · WINNER TAKES $500`, '#161a22');
    gantry(d.finishZ, 'FINISH', d.lengthLabel, '#161a22');
    const tree = new DragTreeView();
    tree.group.position.set(d.tree.x, 0, d.tree.z);
    this.group.add(tree.group);
    return tree;
  }
}

/** The Christmas tree: three red lamps and a green one for each lane, plus a foul lamp. */
export class DragTreeView {
  readonly group = new THREE.Group();
  private lamps: THREE.MeshStandardMaterial[][] = [];

  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.5 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 10), dark);
    pole.position.y = 1.1;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.3), dark);
    box.position.y = 3.05;
    this.group.add(pole, box);
    const colors = ['#ff2020', '#ff2020', '#ff2020', '#22ff55', '#ff2020'];
    for (const lane of [0, 1]) {
      const row: THREE.MeshStandardMaterial[] = [];
      colors.forEach((c, i) => {
        const mat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', emissive: c, emissiveIntensity: 0, roughness: 0.3 });
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 14).rotateX(Math.PI / 2), mat);
        // Drivers face -z, so the lamps face +z. Lane 0 (x = -194) is on the left of the tree.
        lamp.position.set(lane === 0 ? -0.24 : 0.24, 3.75 - i * 0.34, 0.17);
        this.group.add(lamp);
        row.push(mat);
      });
      this.lamps.push(row);
    }
    this.set(0, [false, false]);
  }

  /** lights: 0 dark, 1-3 reds, 4 green; foul: false start per lane. */
  set(lights: number, foul: [boolean, boolean]): void {
    for (let lane = 0; lane < 2; lane++) {
      const row = this.lamps[lane]!;
      for (let i = 0; i < 3; i++) row[i]!.emissiveIntensity = lights >= i + 1 && lights < 4 ? 3 : 0;
      row[3]!.emissiveIntensity = lights === 4 && !foul[lane] ? 3.5 : 0;
      row[4]!.emissiveIntensity = foul[lane] ? 3.5 : 0;
    }
  }
}

export { inGap, type Barrier };

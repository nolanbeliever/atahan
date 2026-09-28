// Builds the static 3D city from the shared layout.

import * as THREE from 'three';
import { mulberry32 } from '../../../shared/util';
import {
  BLOCK_CENTERS,
  BLOCK_HALF,
  BUILDINGS,
  MARKET_LOT_SLOTS,
  PARKING_LOTS,
  ROAD_LINES,
  ROAD_WIDTH,
  WORLD_BOUNDS,
  ZONES,
  isOnRoad,
  type Building,
  type ZoneId,
} from '../../../shared/world';
import { batchStatic } from './batch';
import { Tex } from './Textures';

export const SIDEWALK_HEIGHT = 0.12;

/** Visual ground height at a point (roads are lower than sidewalks/lots). */
export function groundHeight(x: number, z: number): number {
  if (Math.abs(x) > 156 || Math.abs(z) > 156) return 0;
  return isOnRoad(x, z) ? 0 : SIDEWALK_HEIGHT;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function plane(w: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

function repeated(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

function boxMesh(mat: THREE.Material | THREE.Material[], sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export class City {
  readonly group = new THREE.Group();
  private water: THREE.Mesh | null = null;
  private brushes: THREE.Mesh[] = [];
  private time = 0;
  /** Position of the auction turntable (featured vehicle). */
  readonly turntable = new THREE.Group();

  constructor() {
    this.group.name = 'city';
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    for (const b of BUILDINGS) this.buildBuilding(b);
    this.buildPlaza();
    this.buildMarketLot();
    this.buildParking();
    this.buildFuelAndWash();
    this.buildAuctionStage();
    this.buildLamps();
    this.buildTrees();
    this.buildSkyline();
    const animated = new Set<THREE.Object3D>([this.turntable, ...this.brushes]);
    if (this.water) animated.add(this.water);
    batchStatic(this.group, animated);
    this.group.traverse((o) => {
      if (animated.has(o)) return;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  update(dt: number): void {
    this.time += dt;
    this.turntable.rotation.y += dt * 0.35;
    for (const b of this.brushes) b.rotation.y += dt * 6;
    if (this.water) (this.water.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + Math.sin(this.time * 2) * 0.05;
  }

  private buildGround(): void {
    const grass = new THREE.MeshStandardMaterial({ map: repeated(Tex.grass(), 140, 140), roughness: 1 });
    const g = plane(1200, 1200, grass, 0, -0.02, 0);
    this.group.add(g);
  }

  private buildRoads(): void {
    const asphalt = new THREE.MeshStandardMaterial({ map: repeated(Tex.asphalt(), 1, 1), roughness: 0.95 });
    const lines = ROAD_LINES;
    const hw = ROAD_WIDTH / 2;
    const addRoad = (w: number, d: number, x: number, z: number) => {
      const geo = new THREE.PlaneGeometry(w, d);
      // World-space UVs so every road segment can share one material (and be batched).
      const pos = geo.getAttribute('position');
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + x) / 10, (pos.getY(i) - z) / 10);
      const m = new THREE.Mesh(geo, asphalt);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.01, z);
      m.receiveShadow = true;
      this.group.add(m);
    };
    // Intersections
    for (const x of lines) for (const z of lines) addRoad(ROAD_WIDTH, ROAD_WIDTH, x, z);
    // Segments between intersections
    for (const l of lines) {
      for (let i = 0; i < lines.length - 1; i++) {
        const a = lines[i]! + hw;
        const b = lines[i + 1]! - hw;
        addRoad(ROAD_WIDTH, b - a, l, (a + b) / 2); // NS segment
        addRoad(b - a, ROAD_WIDTH, (a + b) / 2, l); // EW segment
      }
    }
    // Markings (instanced)
    const dashMat = new THREE.MeshStandardMaterial({ color: '#f4d35e', roughness: 0.6 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#f1f1f1', roughness: 0.6 });
    const dashes: THREE.Matrix4[] = [];
    const edges: THREE.Matrix4[] = [];
    const cross: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (const l of lines) {
      for (let i = 0; i < lines.length - 1; i++) {
        const a = lines[i]! + hw + 3;
        const b = lines[i + 1]! - hw - 3;
        for (let s = a; s < b; s += 7) {
          dashes.push(m.clone().compose(new THREE.Vector3(l, 0.025, s + 1.5), new THREE.Quaternion(), new THREE.Vector3(0.18, 0.02, 3)));
          dashes.push(m.clone().compose(new THREE.Vector3(s + 1.5, 0.025, l), new THREE.Quaternion(), new THREE.Vector3(3, 0.02, 0.18)));
        }
        const len = b - a + 6;
        const mid = (a + b) / 2;
        for (const side of [-1, 1]) {
          edges.push(m.clone().compose(new THREE.Vector3(l + side * (hw - 0.5), 0.024, mid), new THREE.Quaternion(), new THREE.Vector3(0.14, 0.02, len)));
          edges.push(m.clone().compose(new THREE.Vector3(mid, 0.024, l + side * (hw - 0.5)), new THREE.Quaternion(), new THREE.Vector3(len, 0.02, 0.14)));
        }
      }
    }
    for (const x of lines)
      for (const z of lines) {
        for (const [dx, dz, horizontal] of [
          [0, hw + 1.6, true],
          [0, -hw - 1.6, true],
          [hw + 1.6, 0, false],
          [-hw - 1.6, 0, false],
        ] as const) {
          for (let k = -4; k <= 4; k++) {
            const px = x + dx + (horizontal ? k * 1.25 : 0);
            const pz = z + dz + (horizontal ? 0 : k * 1.25);
            cross.push(m.clone().compose(new THREE.Vector3(px, 0.026, pz), new THREE.Quaternion(), horizontal ? new THREE.Vector3(0.6, 0.02, 2.6) : new THREE.Vector3(2.6, 0.02, 0.6)));
          }
        }
      }
    const inst = (mats: THREE.Matrix4[], mat: THREE.Material) => {
      const im = new THREE.InstancedMesh(boxGeo, mat, mats.length);
      mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.receiveShadow = true;
      this.group.add(im);
    };
    inst(dashes, dashMat);
    inst(edges, whiteMat);
    inst(cross, whiteMat);
  }

  private buildBlocks(): void {
    const concrete = Tex.concrete();
    const sidewalkMat = new THREE.MeshStandardMaterial({ map: repeated(concrete, 12, 12), roughness: 0.9, color: '#d9d6cf' });
    const surfaces: Record<ZoneId, THREE.Material> = {
      dealers_west: new THREE.MeshStandardMaterial({ map: repeated(Tex.concrete(), 10, 10), color: '#cfcac0', roughness: 0.9 }),
      dealers_east: new THREE.MeshStandardMaterial({ map: repeated(Tex.concrete(), 10, 10), color: '#cfcac0', roughness: 0.9 }),
      market: new THREE.MeshStandardMaterial({ map: repeated(Tex.lot(), 10, 10), roughness: 0.95 }),
      bank: new THREE.MeshStandardMaterial({ map: repeated(Tex.paving(), 14, 14), roughness: 0.85, color: '#cdc4b4' }),
      spawn: new THREE.MeshStandardMaterial({ map: repeated(Tex.grass(), 12, 12), roughness: 1 }),
      auction: new THREE.MeshStandardMaterial({ map: repeated(Tex.paving(), 14, 14), roughness: 0.85, color: '#c4b8a8' }),
      custom: new THREE.MeshStandardMaterial({ map: repeated(Tex.lot(), 10, 10), roughness: 0.95 }),
      wash_fuel: new THREE.MeshStandardMaterial({ map: repeated(Tex.lot(), 10, 10), roughness: 0.95 }),
      repair_parts: new THREE.MeshStandardMaterial({ map: repeated(Tex.lot(), 10, 10), roughness: 0.95 }),
    };
    const curbMat = new THREE.MeshStandardMaterial({ color: '#b9b6ad', roughness: 0.9 });
    for (const cx of BLOCK_CENTERS)
      for (const cz of BLOCK_CENTERS) {
        const size = 100 - ROAD_WIDTH;
        const sw = boxMesh([curbMat, curbMat, sidewalkMat, curbMat, curbMat, curbMat], size, SIDEWALK_HEIGHT, size, cx, SIDEWALK_HEIGHT / 2, cz, false);
        this.group.add(sw);
        const zone = ZONES.find((z) => z.cx === cx && z.cz === cz)!;
        this.group.add(plane(BLOCK_HALF * 2, BLOCK_HALF * 2, surfaces[zone.id], cx, SIDEWALK_HEIGHT + 0.005, cz));
      }
    // Outer sidewalk ring around the perimeter road
    const outer = 162;
    for (const [w, d, x, z] of [
      [outer * 2, 6, 0, -159],
      [outer * 2, 6, 0, 159],
      [6, outer * 2, -159, 0],
      [6, outer * 2, 159, 0],
    ] as const) {
      this.group.add(boxMesh([curbMat, curbMat, sidewalkMat, curbMat, curbMat, curbMat], w, SIDEWALK_HEIGHT, d, x, SIDEWALK_HEIGHT / 2, z, false));
    }
    // Low wall marking the world boundary
    const wallMat = new THREE.MeshStandardMaterial({ color: '#8a8f7a', roughness: 0.9 });
    const B = WORLD_BOUNDS + 3.5;
    for (const [w, d, x, z] of [
      [B * 2, 0.6, 0, -B],
      [B * 2, 0.6, 0, B],
      [0.6, B * 2, -B, 0],
      [0.6, B * 2, B, 0],
    ] as const) {
      this.group.add(boxMesh(wallMat, w, 1.1, d, x, 0.55, z));
    }
  }

  private buildBuilding(b: Building): void {
    const w = b.box.maxX - b.box.minX;
    const d = b.box.maxZ - b.box.minZ;
    const cx = (b.box.minX + b.box.maxX) / 2;
    const cz = (b.box.minZ + b.box.maxZ) / 2;
    const y0 = SIDEWALK_HEIGHT;
    if (b.kind === 'wall') {
      const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.6 });
      this.group.add(boxMesh(mat, w, b.height, d, cx, y0 + b.height / 2, cz));
      if (b.sign) this.addSign(b.sign, b.signColor ?? '#00bbf9', cx, y0 + b.height - 0.9, b.box.maxZ + 0.06, 0, Math.min(8, d * 0.6), 1.3);
      return;
    }
    const floors = Math.max(1, Math.round(b.height / 3.4));
    const win = Tex.windows(b.id, b.color, '#2a3b55', '#ffe7a8', 6, 4);
    const sideX = new THREE.MeshStandardMaterial({ map: repeated(win, Math.max(1, d / 10), floors / 4), roughness: 0.7 });
    const sideZ = new THREE.MeshStandardMaterial({ map: repeated(win, Math.max(1, w / 10), floors / 4), roughness: 0.7 });
    const roof = new THREE.MeshStandardMaterial({ color: '#4a4f5a', roughness: 0.9 });
    const mesh = boxMesh([sideX, sideX, roof, roof, sideZ, sideZ], w, b.height, d, cx, y0 + b.height / 2, cz);
    this.group.add(mesh);
    // Roof trim + AC units
    const trim = new THREE.MeshStandardMaterial({ color: b.signColor ?? '#ffffff', roughness: 0.5, metalness: 0.2 });
    this.group.add(boxMesh(trim, w + 0.4, 0.45, d + 0.4, cx, y0 + b.height + 0.2, cz));
    const ac = new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.6, metalness: 0.4 });
    const rng = mulberry32(w * 13 + d);
    for (let i = 0; i < 3; i++) this.group.add(boxMesh(ac, 2, 1.1, 1.6, cx + (rng() - 0.5) * w * 0.6, y0 + b.height + 0.9, cz + (rng() - 0.5) * d * 0.5));

    // Door & sign on the facing side
    const dir = b.facing;
    const fz = dir === 'south' ? b.box.maxZ : dir === 'north' ? b.box.minZ : cz;
    const fx = dir === 'east' ? b.box.maxX : dir === 'west' ? b.box.minX : cx;
    const out = dir === 'south' ? 1 : dir === 'north' ? -1 : 0;
    const rotY = dir === 'north' ? Math.PI : dir === 'east' ? Math.PI / 2 : dir === 'west' ? -Math.PI / 2 : 0;
    const doorMat = new THREE.MeshStandardMaterial({ color: '#1b2433', roughness: 0.3, metalness: 0.6 });
    if (b.id === 'repair_garage') {
      const roller = new THREE.MeshStandardMaterial({ map: Tex.rollerDoor(), roughness: 0.6, metalness: 0.3 });
      for (let i = -1; i <= 1; i++) this.group.add(boxMesh(roller, 9, 5.5, 0.2, cx + i * 12, y0 + 2.75, fz + out * 0.1));
    } else {
      this.group.add(boxMesh(doorMat, 3.2, 3, 0.2, fx, y0 + 1.5, fz + out * 0.1));
      // Awning
      this.group.add(boxMesh(trim, 5, 0.18, 1.6, fx, y0 + 3.4, fz + out * 0.8));
    }
    if (b.id === 'bank') {
      const col = new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.5 });
      const cyl = new THREE.CylinderGeometry(0.45, 0.5, 8, 14);
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const c = new THREE.Mesh(cyl, col);
        c.position.set(cx + i * 3.6, y0 + 4, b.box.maxZ + 1.4);
        c.castShadow = true;
        this.group.add(c);
      }
      this.group.add(boxMesh(col, 28, 0.9, 3.6, cx, y0 + 8.4, b.box.maxZ + 1.4));
      this.group.add(boxMesh(col, 28, 0.3, 3.8, cx, y0 + 0.15, b.box.maxZ + 1.5));
    }
    if (b.sign) {
      const signW = Math.min(w * 0.85, 26);
      const sx = out !== 0 ? fx : fx + (dir === 'east' ? 0.12 : -0.12);
      const sz = out !== 0 ? fz + out * 0.13 : fz;
      this.addSign(b.sign, b.signColor ?? '#4f8cff', sx, y0 + b.height - 1.3, sz, rotY, signW, signW / 6.5);
    }
  }

  private addSign(text: string, accent: string, x: number, y: number, z: number, rotY: number, w: number, h: number): void {
    const tex = Tex.sign(text, { bg: '#0f1626', fg: '#ffffff', accent });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.4 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.group.add(m);
  }

  private buildPlaza(): void {
    const y0 = SIDEWALK_HEIGHT;
    const paving = new THREE.MeshStandardMaterial({ map: repeated(Tex.paving(), 8, 8), roughness: 0.85, color: '#c9c0b0' });
    const ring = new THREE.Mesh(new THREE.CircleGeometry(20, 48), paving);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, y0 + 0.01, 0);
    ring.receiveShadow = true;
    this.group.add(ring);
    // Paths to the four sides
    for (const [w, d, x, z] of [
      [4, 41 - 18, 0, 30],
      [4, 41 - 18, 0, -30],
      [41 - 18, 4, 30, 0],
      [41 - 18, 4, -30, 0],
    ] as const)
      this.group.add(plane(w, d, paving, x, y0 + 0.012, z));
    const stone = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.7 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.8, 0.8, 40), stone);
    basin.position.set(0, y0 + 0.4, 0);
    basin.castShadow = true;
    basin.receiveShadow = true;
    this.group.add(basin);
    const waterMat = new THREE.MeshStandardMaterial({ color: '#4cc9f0', emissive: '#1d7fa8', emissiveIntensity: 0.25, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 });
    this.water = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 4.9, 0.08, 40), waterMat);
    this.water.position.set(0, y0 + 0.84, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.3, 8, 48), stone);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, y0 + 0.85, 0);
    rim.castShadow = true;
    this.group.add(rim);
    this.group.add(this.water);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, 2.6, 20), stone);
    pillar.position.set(0, y0 + 1.6, 0);
    pillar.castShadow = true;
    this.group.add(pillar);
    const gold = new THREE.MeshStandardMaterial({ color: '#ffcc33', metalness: 1, roughness: 0.18, emissive: '#6b4a00', emissiveIntensity: 0.25 });
    const sculpture = new THREE.Mesh(new THREE.TorusKnotGeometry(1.1, 0.32, 120, 16, 2, 3), gold);
    sculpture.position.set(0, y0 + 4.4, 0);
    sculpture.castShadow = true;
    this.group.add(sculpture);
    // Benches
    const wood = new THREE.MeshStandardMaterial({ color: '#8b5e3c', roughness: 0.8 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const bx = Math.sin(a) * 16;
      const bz = Math.cos(a) * 16;
      const bench = boxMesh(wood, 2.4, 0.12, 0.6, bx, y0 + 0.5, bz);
      bench.rotation.y = a;
      this.group.add(bench);
      const back = boxMesh(wood, 2.4, 0.5, 0.1, bx + Math.sin(a) * 0.3, y0 + 0.8, bz + Math.cos(a) * 0.3);
      back.rotation.y = a;
      this.group.add(back);
    }
    // Welcome arch
    this.addSign('WELCOME TO GETRICH CITY', '#2ee59d', 0, y0 + 6, 38.5, 0, 22, 2.6);
    const post = new THREE.MeshStandardMaterial({ color: '#1f2a44', roughness: 0.5, metalness: 0.4 });
    for (const s of [-1, 1]) this.group.add(boxMesh(post, 0.6, 7.4, 0.6, s * 11.4, y0 + 3.7, 38.5));
  }

  private buildMarketLot(): void {
    const y = SIDEWALK_HEIGHT + 0.02;
    const white = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.6 });
    const mats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const s of MARKET_LOT_SLOTS) {
      for (const side of [-1, 1]) mats.push(m.clone().compose(new THREE.Vector3(s.x + side * 3.4, y, s.z), q, new THREE.Vector3(0.14, 0.02, 6.2)));
      mats.push(m.clone().compose(new THREE.Vector3(s.x, y, s.z - 3.1), q, new THREE.Vector3(6.8, 0.02, 0.14)));
    }
    const im = new THREE.InstancedMesh(boxGeo, white, mats.length);
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    this.group.add(im);
    // Bunting
    const colors = ['#e63946', '#ffbe0b', '#3a86ff', '#2ee59d', '#ff006e'];
    const flagGeo = new THREE.ConeGeometry(0.35, 0.7, 3);
    flagGeo.rotateX(Math.PI);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#555b66', metalness: 0.6, roughness: 0.4 });
    const lines: [number, number, number, number][] = [
      [62, -123, 138, -123],
      [62, -72, 138, -72],
      [62, -123, 62, -72],
      [138, -123, 138, -72],
    ];
    const flagMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: THREE.DoubleSide }));
    for (const [x1, z1, x2, z2] of lines) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.floor(len / 1.6);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const sag = Math.sin(t * Math.PI * 4) * 0.4;
        const f = new THREE.Mesh(flagGeo, flagMats[i % flagMats.length]!);
        f.position.set(x1 + (x2 - x1) * t, 5.4 - Math.abs(sag), z1 + (z2 - z1) * t);
        this.group.add(f);
      }
      this.group.add(boxMesh(poleMat, 0.25, 6, 0.25, x1, SIDEWALK_HEIGHT + 3, z1));
    }
    this.addSign('USED VEHICLE MARKET - DEALS DAILY', '#f4a261', 100, SIDEWALK_HEIGHT + 7, -63, 0, 26, 2.8);
    for (const s of [-1, 1]) this.group.add(boxMesh(poleMat, 0.5, 8.6, 0.5, 100 + s * 13.2, SIDEWALK_HEIGHT + 4.3, -63));
    // Dealership row gateways
    for (const cx of [-100, 0]) {
      this.addSign('DEALERSHIP ROW', '#3a7bd5', cx, SIDEWALK_HEIGHT + 7.5, -58.5, 0, 16, 2.2);
      this.addSign('DEALERSHIP ROW', '#3a7bd5', cx, SIDEWALK_HEIGHT + 7.5, -141.5, Math.PI, 16, 2.2);
    }
  }

  private buildParking(): void {
    const white = new THREE.MeshStandardMaterial({ color: '#f1f1f1', roughness: 0.6 });
    const asphalt = new THREE.MeshStandardMaterial({ map: repeated(Tex.lot(), 8, 4), roughness: 0.95 });
    const mats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const lot of PARKING_LOTS) {
      const w = lot.maxX - lot.minX;
      const d = lot.maxZ - lot.minZ;
      this.group.add(plane(w, d, asphalt, (lot.minX + lot.maxX) / 2, SIDEWALK_HEIGHT + 0.012, (lot.minZ + lot.maxZ) / 2));
      const rowD = d / lot.rows;
      for (let r = 0; r < lot.rows; r++) {
        const z = lot.minZ + rowD * (r + 0.5);
        for (let x = lot.minX + 1; x <= lot.maxX - 1; x += 3.2) mats.push(m.clone().compose(new THREE.Vector3(x, SIDEWALK_HEIGHT + 0.025, z), q, new THREE.Vector3(0.12, 0.02, rowD * 0.6)));
      }
    }
    const im = new THREE.InstancedMesh(boxGeo, white, mats.length);
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    this.group.add(im);
  }

  private buildFuelAndWash(): void {
    const y0 = SIDEWALK_HEIGHT;
    // Car wash roof + brushes
    const roofMat = new THREE.MeshStandardMaterial({ color: '#90e0ef', roughness: 0.4, metalness: 0.2 });
    this.group.add(boxMesh(roofMat, 16, 0.4, 26, -26, y0 + 5.2, 77));
    const brushColors = ['#ff006e', '#3a86ff', '#ffbe0b'];
    const brushGeo = new THREE.CylinderGeometry(0.7, 0.7, 3.6, 12);
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const b = new THREE.Mesh(brushGeo, new THREE.MeshStandardMaterial({ color: brushColors[i]!, roughness: 1 }));
        b.position.set(-26 + s * 4.6, y0 + 1.9, 70 + i * 7);
        this.group.add(b);
        this.brushes.push(b);
      }
    }
    // Fuel canopy & pumps
    const canopy = new THREE.MeshStandardMaterial({ color: '#f8f9fa', roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: '#ef233c', roughness: 0.5 });
    this.group.add(boxMesh(canopy, 30, 0.8, 16, 26, y0 + 5.6, 96));
    this.group.add(boxMesh(red, 30.2, 0.35, 16.2, 26, y0 + 5.1, 96));
    const pillar = new THREE.MeshStandardMaterial({ color: '#dee2e6', roughness: 0.5 });
    for (const x of [14, 38]) for (const z of [90, 102]) this.group.add(boxMesh(pillar, 0.5, 5, 0.5, x, y0 + 2.5, z));
    const pumpMat = new THREE.MeshStandardMaterial({ color: '#2b2d42', roughness: 0.5 });
    for (const x of [18, 34]) {
      this.group.add(boxMesh(canopy, 3, 0.25, 1.6, x, y0 + 0.12, 96));
      this.group.add(boxMesh(pumpMat, 1.1, 1.8, 0.8, x, y0 + 1.1, 96));
      this.group.add(boxMesh(red, 1.12, 0.35, 0.82, x, y0 + 1.9, 96));
    }
    this.addSign('FUEL', '#ef233c', 26, y0 + 5.6, 104.05, 0, 6, 1.1);
    this.addSign('SPARKLE WASH', '#00bbf9', -26, y0 + 6.2, 90.3, 0, 9, 1.4);
  }

  private buildAuctionStage(): void {
    const y0 = SIDEWALK_HEIGHT;
    const stone = new THREE.MeshStandardMaterial({ color: '#2d1b4e', roughness: 0.4, metalness: 0.3 });
    const gold = new THREE.MeshStandardMaterial({ color: '#ffc53d', metalness: 1, roughness: 0.25 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.6, 0.6, 40), stone);
    base.position.set(100, y0 + 0.3, 14);
    base.receiveShadow = true;
    this.group.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.12, 8, 48), gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(100, y0 + 0.62, 14);
    this.group.add(rim);
    this.turntable.position.set(100, y0 + 0.62, 14);
    this.group.add(this.turntable);
    this.addSign('FEATURED LOT', '#c77dff', 100, y0 + 4.6, 7.2, 0, 8, 1.2);
    const postMat = new THREE.MeshStandardMaterial({ color: '#3c096c', roughness: 0.5 });
    for (const s of [-1, 1]) this.group.add(boxMesh(postMat, 0.3, 5, 0.3, 100 + s * 4.2, y0 + 2.5, 7.2));
  }

  private buildLamps(): void {
    const positions: [number, number, number][] = [];
    for (const l of ROAD_LINES) {
      for (let s = -150; s <= 150; s += 24) {
        if (ROAD_LINES.some((k) => Math.abs(k - s) < 10)) continue;
        positions.push([l - 7.5, s, 1]);
        positions.push([l + 7.5, s + 12, -1]);
        positions.push([s, l - 7.5, 2]);
        positions.push([s + 12, l + 7.5, -2]);
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 6, 6);
    const headGeo = new THREE.BoxGeometry(0.5, 0.2, 1.2);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#39404d', metalness: 0.6, roughness: 0.4 });
    const headMat = new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a8', emissiveIntensity: 0.6 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, positions.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, positions.length);
    const m = new THREE.Matrix4();
    positions.forEach(([x, z, dir], i) => {
      poles.setMatrixAt(i, m.makeTranslation(x, 3 + SIDEWALK_HEIGHT, z));
      const hx = Math.abs(dir) === 1 ? x + dir * 0.8 : x;
      const hz = Math.abs(dir) === 2 ? z + Math.sign(dir) * 0.8 : z;
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.abs(dir) === 1 ? Math.PI / 2 : 0, 0));
      heads.setMatrixAt(i, m.compose(new THREE.Vector3(hx, 6 + SIDEWALK_HEIGHT, hz), rot, new THREE.Vector3(1, 1, 1)));
    });
    poles.castShadow = true;
    this.group.add(poles, heads);
  }

  private buildTrees(): void {
    const rng = mulberry32(4242);
    const spots: [number, number, number][] = [];
    // Plaza ring
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      spots.push([Math.sin(a) * 27, Math.cos(a) * 27, 0.9 + rng() * 0.4]);
    }
    for (let i = 0; i < 12; i++) spots.push([(rng() - 0.5) * 76, (rng() - 0.5) * 76, 0.8 + rng() * 0.5]);
    // Outside the city boundary
    for (let i = 0; i < 260; i++) {
      const side = Math.floor(rng() * 4);
      const t = (rng() - 0.5) * 380;
      const d = 166 + rng() * 22;
      const [x, z] = side === 0 ? [t, -d] : side === 1 ? [t, d] : side === 2 ? [-d, t] : [d, t];
      spots.push([x, z, 0.9 + rng() * 0.8]);
    }
    const filtered = spots.filter(([x, z]) => Math.abs(x) > 158 || Math.abs(z) > 158 || (Math.abs(x) < 38 && Math.abs(z) < 38 && Math.hypot(x, z) > 21));
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6);
    const crownGeo = new THREE.IcosahedronGeometry(1.8, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6d4c35', roughness: 1 }), filtered.length);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), filtered.length);
    const m = new THREE.Matrix4();
    const greens = ['#3f8f3a', '#4c9a3f', '#2f7d32', '#5aa04a', '#6a994e'].map((c) => new THREE.Color(c));
    filtered.forEach(([x, z, s], i) => {
      const y = groundHeight(x, z);
      trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, y + 1.2 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
      crown.setMatrixAt(i, m.compose(new THREE.Vector3(x, y + 3.2 * s, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * 3, 0)), new THREE.Vector3(s, s * 1.15, s)));
      crown.setColorAt(i, greens[i % greens.length]!);
    });
    trunk.castShadow = true;
    crown.castShadow = true;
    this.group.add(trunk, crown);
  }

  private buildSkyline(): void {
    const rng = mulberry32(777);
    const spots: [number, number, number, number, number][] = [];
    for (let i = 0; i < 150; i++) {
      const side = Math.floor(rng() * 4);
      const t = (rng() - 0.5) * 520;
      const d = 200 + rng() * 90;
      const [x, z] = side === 0 ? [t, -d] : side === 1 ? [t, d] : side === 2 ? [-d, t] : [d, t];
      spots.push([x, z, 12 + rng() * 22, 12 + rng() * 22, 18 + Math.pow(rng(), 2) * 80]);
    }
    const win = Tex.windows('skyline', '#8d99ae', '#34435e', '#ffe7a8', 8, 12);
    const mat = new THREE.MeshStandardMaterial({ map: repeated(win, 2, 4), roughness: 0.6 });
    const im = new THREE.InstancedMesh(boxGeo, mat, spots.length);
    const m = new THREE.Matrix4();
    const tints = ['#ffffff', '#dfe7f5', '#f6ead7', '#e1f0ea', '#e9e1f5'].map((c) => new THREE.Color(c));
    spots.forEach(([x, z, w, d, h], i) => {
      im.setMatrixAt(i, m.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d)));
      im.setColorAt(i, tints[i % tints.length]!);
    });
    this.group.add(im);
  }
}

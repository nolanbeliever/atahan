import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { TRUCK_MODELS, CAR_BY_ID, CAR_XFER_BY_ID, TRUCK_RULES, isTruck, formatEuro } from '/shared/cars.js';
import {
  HWY, SERVICE_YARD, HOTEL_DELIVERY, SITES, SITE_BY_ID, ROADS, YARDS, ROAD_KMH, isDrivable, yardAt, routeTo, constrainToRoads,
  laneAt, trunkAt, TRUNK_LENGTH, inHighwayRegion,
} from '/shared/worldmap.js';
import { CARGO_BY_ID, LOGI_RULES, deliveryPay } from '/shared/logistics.js';
import { StaticBatcher } from '../world/StaticBatcher.js';
import { canvasTexture, drawAsphalt, drawConcrete, rng, signMaterial, panel } from '../world/CarWorldKit.js';
import { setTrailer, articulate, turnTractor } from '../world/TruckModels.js';

const NO = { cast: false, receive: false };
const KMH = 3.6;
const BODY_ART = { 'zeeland-lx': 'LX', 'brabant-titan': 'XF', 'noordkaap-v8': 'V8' };
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// =====================================================================================================
// Dünya geometrisi
// =====================================================================================================

function materials() {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const B = (o) => new THREE.MeshBasicMaterial(o);
  const asph = canvasTexture(256, 256, drawAsphalt('#3b3e42', 21));
  const conc = canvasTexture(256, 256, drawConcrete('#9a9c9e', 5, 0.2));
  const grass = canvasTexture(128, 128, (g, w, h) => {
    const r = rng(77);
    g.fillStyle = '#58853f';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(130,180,90,0.22)' : 'rgba(30,64,24,0.22)';
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 3);
    }
  });
  const tulip = canvasTexture(256, 64, (g, w, h) => {
    const cols = ['#d7263d', '#f2c230', '#e36fa8', '#ff7a1a', '#f4f1e8'];
    const st = w / cols.length;
    cols.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(i * st, 0, st * 0.78, h);
      g.fillStyle = '#3d6b2e';
      g.fillRect(i * st + st * 0.78, 0, st * 0.22, h);
    });
  });
  const shed = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#c9cdd1';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 2, h);
  });
  const water = canvasTexture(128, 128, (g, w, h) => {
    const r = rng(9);
    g.fillStyle = '#2f5d7c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`;
      g.fillRect(r() * w, r() * h, 6 + r() * 10, 1);
    }
  });
  return {
    wAsph: L({ map: asph }),
    wConc: L({ map: conc }),
    wGrass: L({ map: grass }),
    wTulip: L({ map: tulip }),
    wShed: L({ map: shed }),
    wWater: L({ map: water }),
    wPaint: B({ color: 0xf1f1ea }),
    wYellow: B({ color: 0xf2c230 }),
    wRail: L({ color: 0xb9bfc6 }),
    wPost: L({ color: 0x6b7178 }),
    wBrick: L({ color: 0x8a4b32 }),
    wDark: L({ color: 0x1b1e22 }),
    wRoof: L({ color: 0x4d555d }),
    wDoor: L({ color: 0x5f6b77 }),
    wGreen: L({ color: 0x1f5d43 }),
    wRed: L({ color: 0xc3202f }),
    wOrange: L({ color: 0xf07b16 }),
    wWhite: L({ color: 0xeeeeea }),
    wWood: L({ color: 0x7a5a38 }),
    wLamp: B({ color: 0xfff1c8 }),
  };
}

/** Polyline boyunca şerit (ribbon) geometrisi: u enine (0..1), v boyuna (m / vScale) */
function ribbon(pts, half, y, vScale = 8, from = -1, to = 1) {
  const pos = [];
  const uv = [];
  const nor = [];
  const idx = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[Math.min(i, pts.length - 1)];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // Sağ = (−dz, dx); sol kenar (−) / sağ kenar (+)
    const rx = -dz;
    const rz = dx;
    if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    for (const [s, u] of [[from, 0], [to, 1]]) {
      pos.push(p[0] + rx * half * s, y, p[1] + rz * half * s);
      uv.push(u, acc / vScale);
      nor.push(0, 1, 0);
    }
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k); // yukarı bakan yüzler (CCW)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Polyline'ı eşit aralıklarla örnekle: [{ x, z, ux, uz, s }] */
function sample(pts, step) {
  const out = [];
  let carry = 0;
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    let d = carry;
    while (d <= len) {
      out.push({ x: ax + ux * d, z: az + uz * d, ux, uz, s: s + d });
      d += step;
    }
    carry = d - len;
    s += len;
  }
  return out;
}

/** Kesik çizgi şeritleri (yol işaretleri): offset (sağa +), dash/gap uzunluğu */
function dashes(pts, offset, w, dash, gap, y) {
  const list = [];
  for (const p of sample(pts, dash + gap)) {
    const rx = -p.uz;
    const rz = p.ux;
    const cx = p.x + rx * offset + p.ux * dash * 0.5;
    const cz = p.z + rz * offset + p.uz * dash * 0.5;
    const g = new THREE.PlaneGeometry(w, dash).rotateX(-Math.PI / 2).rotateY(Math.atan2(p.ux, p.uz));
    g.translate(cx, y, cz);
    list.push(g);
  }
  return list;
}

function setInstance(mesh, i, x, y, z, ry, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
  mesh.setMatrixAt(i, m);
}

/** Bir nokta başka bir yolun / avlunun ağzında mı (bariyer boşluğu) */
function nearOtherRoad(x, z, selfId) {
  for (const r of ROADS) {
    if (r.id === selfId) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i];
      const [bx, bz] = r.pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < r.half + 3) return true;
    }
  }
  return yardAt(x, z, 3) !== null;
}

/**
 * Otoyol bölgesi: zemin, yollar, bariyerler, lambalar, ağaçlar, lale tarlaları, yel değirmenleri, tabelalar,
 * otelin lojistik avlusu, üç toptancı deposu ve konteyner limanı. Statikler malzeme başına tek mesh;
 * tekrarlanan nesneler (bariyer, lamba, ağaç, konteyner) InstancedMesh.
 */
export function buildHighway({ collision }) {
  const group = new THREE.Group();
  group.name = 'highway';
  const M = materials();
  const b = new StaticBatcher();
  const R = HWY.bounds;
  // Zemin (tek düzlem, tekrarlı doku)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(R.maxX - R.minX + 400, R.maxZ - R.minZ + 400).rotateX(-Math.PI / 2), M.wGrass);
  M.wGrass.map.repeat.set((R.maxX - R.minX + 400) / 10, (R.maxZ - R.minZ + 400) / 10);
  ground.position.set((R.minX + R.maxX) / 2, 0, (R.minZ + R.maxZ) / 2);
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  group.add(ground);
  // Liman suyu (doğuda)
  const water = new THREE.Mesh(new THREE.PlaneGeometry(260, 900).rotateX(-Math.PI / 2), M.wWater);
  M.wWater.map.repeat.set(20, 60);
  water.position.set(R.maxX + 120, 0.02, 0);
  water.matrixAutoUpdate = false;
  water.updateMatrix();
  group.add(water);

  // Yollar + işaretler
  for (const r of ROADS) {
    b.add('wAsph', ribbon(r.pts, r.half, 0.03), NO);
    const lw = HWY.laneW;
    // Kenar çizgileri (sürekli)
    b.add('wPaint', ribbon(r.pts, r.half - 0.35, 0.045, 8, -1, -0.97), NO);
    b.add('wPaint', ribbon(r.pts, r.half - 0.35, 0.045, 8, 0.97, 1), NO);
    // Orta çizgi (iki yön): otoyolda çift sürekli sarı, bağlantı yolunda kesik
    if (r.kind === 'trunk') {
      b.add('wYellow', ribbon(r.pts, 0.25, 0.045, 8, -1, -0.4), NO);
      b.add('wYellow', ribbon(r.pts, 0.25, 0.045, 8, 0.4, 1), NO);
      for (const off of [lw, -lw]) for (const g of dashes(r.pts, off, 0.15, 4, 8, 0.046)) b.add('wPaint', g, NO);
    } else {
      for (const g of dashes(r.pts, 0, 0.15, 3, 5, 0.046)) b.add('wPaint', g, NO);
    }
  }
  // Avlular (beton zemin)
  for (const y of YARDS) {
    const yb = y.bounds;
    b.floor('wConc', yb.minX, yb.maxX, yb.minZ, yb.maxZ, 0.035, { ...NO, uvScale: 0.12 });
  }

  // ---- Bariyerler (InstancedMesh), lambalar, ağaçlar ----
  const railPts = [];
  for (const r of ROADS) {
    for (const p of sample(r.pts, 4)) {
      for (const side of [-1, 1]) {
        const x = p.x - p.uz * (r.half + 0.4) * side;
        const z = p.z + p.ux * (r.half + 0.4) * side;
        if (nearOtherRoad(x, z, r.id)) continue;
        railPts.push([x, z, Math.atan2(p.ux, p.uz)]);
      }
    }
  }
  const rail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.32, 4.05).translate(0, 0.62, 0), M.wRail, railPts.length);
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(0, 0.375, 0), M.wPost, railPts.length);
  railPts.forEach(([x, z, ry], i) => {
    setInstance(rail, i, x, 0, z, ry);
    setInstance(post, i, x, 0, z, ry);
  });
  group.add(rail, post);

  const lampPts = sample(ROADS[0].pts, 45).map((p, i) => {
    const side = i % 2 ? 1 : -1;
    return [p.x - p.uz * (HWY.trunkHalf + 1.4) * side, p.z + p.ux * (HWY.trunkHalf + 1.4) * side, Math.atan2(p.ux, p.uz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2)];
  }).filter(([x, z]) => !nearOtherRoad(x, z, 'trunk'));
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 9, 6).translate(0, 4.5, 0), M.wPost, lampPts.length);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 2.6).translate(0, 8.9, 1.2), M.wPost, lampPts.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.14, 0.9).translate(0, 8.8, 2.4), M.wLamp, lampPts.length);
  lampPts.forEach(([x, z, ry], i) => {
    for (const m of [pole, arm, head]) setInstance(m, i, x, 0, z, ry);
  });
  group.add(pole, arm, head);

  // Ağaçlar: yoldan, avlulardan ve tarlalardan uzak, tohumlu
  const r = rng(4242);
  const trees = [];
  const fields = [[360, 90, 120, 60], [640, -240, 140, 80], [1000, -200, 120, 70], [700, 170, 150, 60], [420, -150, 110, 70]];
  const inField = (x, z) => fields.some(([fx, fz, w, h]) => Math.abs(x - fx) < w / 2 + 4 && Math.abs(z - fz) < h / 2 + 4);
  for (let i = 0; i < 2600 && trees.length < 520; i++) {
    const x = R.minX + 10 + r() * (R.maxX - R.minX - 20);
    const z = R.minZ + 10 + r() * (R.maxZ - R.minZ - 20);
    if (isDrivable(x, z, 7) || yardAt(x, z, 8) || inField(x, z)) continue;
    if (x > 1140) continue; // liman
    trees.push([x, z, 0.75 + r() * 0.6]);
  }
  const trunkM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 2.6, 5).translate(0, 1.3, 0), M.wWood, trees.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.9, 0), new THREE.MeshLambertMaterial({ color: 0x3f7a35, flatShading: true }), trees.length);
  trees.forEach(([x, z, s], i) => {
    setInstance(trunkM, i, x, 0, z, 0, s, s, s);
    setInstance(crown, i, x, 0, z, i, s, s * (0.9 + (i % 5) * 0.06), s);
  });
  group.add(trunkM, crown);

  // Lale tarlaları + yel değirmenleri
  for (const [fx, fz, w, h] of fields) b.floor('wTulip', fx - w / 2, fx + w / 2, fz - h / 2, fz + h / 2, 0.025, { ...NO, uvScale: 0.05 });
  for (const [x, z] of [[400, 150], [720, -300], [1080, -230]]) {
    b.add('wWhite', new THREE.CylinderGeometry(2.2, 3.4, 13, 8), { position: [x, 6.5, z], ...NO });
    b.add('wRoof', new THREE.ConeGeometry(2.6, 3, 8), { position: [x, 14.5, z], ...NO });
    for (let k = 0; k < 4; k++) {
      b.add('wWood', new THREE.BoxGeometry(0.6, 11, 0.12), { position: [x, 12, z - 3.2], rotation: [0, 0, (k * Math.PI) / 2 + 0.35], ...NO });
    }
    collision.add(x - 3, x + 3, z - 3, z + 3);
  }

  // ---- Otelin lojistik avlusu ----
  const Y = SERVICE_YARD.bounds;
  const fence = (x0, x1, z0, z1) => {
    b.box('wDark', x0, x1, 0, 2.2, z0, z1, NO);
    collision.add(x0, x1, z0, z1);
  };
  const P = SERVICE_YARD.portal;
  // Kuzey: otelin arka cephesi (mal kabul rampası), güney / batı / doğu: duvar (ağızlar açık)
  b.box('wBrick', Y.minX, Y.maxX, 0, 9, Y.maxZ, Y.maxZ + 1.2, NO);
  collision.add(Y.minX, Y.maxX, Y.maxZ - 0.2, Y.maxZ + 1.2);
  for (let x = Y.minX + 6; x < Y.maxX - 4; x += 8) {
    b.box('wDoor', x - 1.6, x + 1.6, 1.2, 4.6, Y.maxZ - 0.04, Y.maxZ, NO); // rampa kapıları
    for (let k = 0; k < 2; k++) b.box('wLamp', x - 1.5, x + 1.5, 6 + k * 1.4, 6.9 + k * 1.4, Y.maxZ - 0.05, Y.maxZ - 0.02, NO); // pencereler
  }
  b.box('wConc', HOTEL_DELIVERY.zone.minX - 2, HOTEL_DELIVERY.zone.maxX + 2, 0, 1.2, HOTEL_DELIVERY.dockZ, Y.maxZ, NO); // rampa platformu
  collision.add(HOTEL_DELIVERY.zone.minX - 2, HOTEL_DELIVERY.zone.maxX + 2, HOTEL_DELIVERY.dockZ, Y.maxZ);
  // Teslim körfezi işaretleri (sarı çerçeve)
  const D = HOTEL_DELIVERY.zone;
  for (const [x0, x1, z0, z1] of [[D.minX, D.maxX, D.minZ, D.minZ + 0.3], [D.minX, D.maxX, D.maxZ - 0.3, D.maxZ], [D.minX, D.minX + 0.3, D.minZ, D.maxZ], [D.maxX - 0.3, D.maxX, D.minZ, D.maxZ]]) {
    b.floor('wYellow', x0, x1, z0, z1, 0.05, NO);
  }
  fence(Y.minX, Y.maxX, Y.minZ - 0.6, Y.minZ); // güney
  fence(Y.minX - 0.6, Y.minX, Y.minZ, P.minZ); // batı (tünel ağzının iki yanı)
  fence(Y.minX - 0.6, Y.minX, P.maxZ, Y.maxZ);
  fence(Y.maxX, Y.maxX + 0.6, Y.minZ, -HWY.trunkHalf); // doğu (otoyol ağzının iki yanı)
  fence(Y.maxX, Y.maxX + 0.6, HWY.trunkHalf, Y.maxZ);
  // Tünel ağzı (şehre)
  b.box('wConc', Y.minX - 3, Y.minX, 0, 6, P.minZ - 1.2, P.minZ, NO);
  b.box('wConc', Y.minX - 3, Y.minX, 0, 6, P.maxZ, P.maxZ + 1.2, NO);
  b.box('wConc', Y.minX - 3, Y.minX, 5, 6.5, P.minZ - 1.2, P.maxZ + 1.2, NO);
  b.box('wDark', Y.minX - 3, Y.minX - 2.9, 0, 5, P.minZ, P.maxZ, NO);
  // Tır parkı çizgileri
  for (const t of SERVICE_YARD.truckBays) {
    for (const sx of [-1, 1]) b.floor('wPaint', t.x + sx * 1.9 - 0.08, t.x + sx * 1.9 + 0.08, t.z - 7, t.z + 7, 0.05, NO);
  }
  // TruckCenter bayisi (küçük bina)
  const K = SERVICE_YARD.dealer;
  b.box('wWhite', K.x - 5, K.x + 5, 0, 3.6, Y.minZ + 0.2, K.z, NO);
  b.box('wOrange', K.x - 5.2, K.x + 5.2, 3.6, 4.1, Y.minZ, K.z + 0.4, NO);
  b.box('wDoor', K.x - 1, K.x + 1, 0, 2.3, K.z, K.z + 0.04, NO);
  collision.add(K.x - 5, K.x + 5, Y.minZ, K.z);

  // ---- Depolar + liman ----
  for (const s of SITES) {
    const sb = s.bounds;
    if (s.id === 'port') continue;
    // Depo binası (avlunun uzak kenarında), yükleme körfezi çerçevesi
    const far = s.gate[1] < s.dock.z; // giriş güneyde → bina kuzeyde
    const bz0 = far ? s.dock.z : sb.minZ;
    const bz1 = far ? sb.maxZ : s.dock.z;
    b.box('wShed', sb.minX + 2, sb.maxX - 2, 0, 11, bz0, bz1, { ...NO, uvScale: 0.25 });
    b.box('wRoof', sb.minX + 1.5, sb.maxX - 1.5, 11, 11.6, bz0 - 0.5, bz1 + 0.5, NO);
    collision.add(sb.minX + 2, sb.maxX - 2, bz0, bz1);
    const faceZ = far ? bz0 : bz1;
    for (let x = sb.minX + 7; x < sb.maxX - 5; x += 9) b.box('wDoor', x - 2, x + 2, 0.4, 5, faceZ - 0.05, faceZ + 0.05, NO);
    const ld = s.load;
    for (const [x0, x1, z0, z1] of [[ld.minX, ld.maxX, ld.minZ, ld.minZ + 0.3], [ld.minX, ld.maxX, ld.maxZ - 0.3, ld.maxZ], [ld.minX, ld.minX + 0.3, ld.minZ, ld.maxZ], [ld.maxX - 0.3, ld.maxX, ld.minZ, ld.maxZ]]) {
      b.floor('wYellow', x0, x1, z0, z1, 0.05, NO);
    }
    // Çit (giriş açık)
    const gx = s.gate[0];
    const fz = far ? sb.minZ : sb.maxZ;
    fence(sb.minX, gx - 7, fz - 0.3, fz + 0.3);
    fence(gx + 7, sb.maxX, fz - 0.3, fz + 0.3);
    fence(sb.minX - 0.6, sb.minX, sb.minZ, sb.maxZ);
    fence(sb.maxX, sb.maxX + 0.6, sb.minZ, sb.maxZ);
  }
  // Liman: konteyner yığınları (InstancedMesh, renkli), iki portal vinç, rıhtım
  const port = SITE_BY_ID.port;
  const pb = port.bounds;
  const boxes = [];
  const cr = rng(31);
  for (let gx = pb.minX + 22; gx < pb.maxX - 18; gx += 7) {
    for (const zr of [[-100, -60], [40, 100]]) {
      for (let z = zr[0]; z < zr[1]; z += 13) {
        const h = 1 + Math.floor(cr() * 3);
        for (let k = 0; k < h; k++) boxes.push([gx, z, k, cr()]);
      }
    }
  }
  const cont = new THREE.InstancedMesh(new THREE.BoxGeometry(2.44, 2.59, 12.2).translate(0, 1.3, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), boxes.length);
  const palette = [0xc3202f, 0x24508f, 0x1f5d43, 0xf07b16, 0x8a8f96, 0xf2c230, 0x5b3a8c];
  const col = new THREE.Color();
  boxes.forEach(([x, z, k, c], i) => {
    setInstance(cont, i, x, k * 2.6, z, 0);
    cont.setColorAt(i, col.setHex(palette[Math.floor(c * palette.length)]));
  });
  group.add(cont);
  for (const [x0, x1, z0, z1] of [[pb.minX + 18, pb.maxX - 14, -104, -54], [pb.minX + 18, pb.maxX - 14, 34, 104]]) collision.add(x0, x1, z0, z1);
  for (const z of [-30, 30]) {
    for (const sx of [-1, 1]) {
      b.box('wOrange', pb.maxX - 6 + sx * 7 - 0.6, pb.maxX - 6 + sx * 7 + 0.6, 0, 26, z - 0.6, z + 0.6, NO);
      collision.add(pb.maxX - 6 + sx * 7 - 0.6, pb.maxX - 6 + sx * 7 + 0.6, z - 0.6, z + 0.6);
    }
    b.box('wOrange', pb.maxX - 16, pb.maxX + 40, 25, 27.5, z - 1.2, z + 1.2, NO);
  }
  b.box('wConc', pb.maxX, pb.maxX + 4, -0.2, 0.6, pb.minZ, pb.maxZ, NO); // rıhtım
  collision.add(pb.maxX - 0.2, pb.maxX + 0.6, pb.minZ, pb.maxZ);
  // Gemi
  b.box('wRed', pb.maxX + 14, pb.maxX + 34, -1, 6, -70, 60, NO);
  b.box('wWhite', pb.maxX + 16, pb.maxX + 32, 6, 14, 40, 56, NO);
  // Liman çiti (kuzey / güney)
  fence(pb.minX, pb.maxX, pb.minZ - 0.6, pb.minZ);
  fence(pb.minX, pb.maxX, pb.maxZ, pb.maxZ + 0.6);
  fence(pb.minX - 0.6, pb.minX, pb.minZ, -HWY.trunkHalf);
  fence(pb.minX - 0.6, pb.minX, HWY.trunkHalf, pb.maxZ);

  b.build(M, group);

  // ---- Tabelalar ----
  const signs = [];
  const sign = (lines, w, h, x, y, z, facing, opts = {}) => {
    const m = panel(signMaterial(lines, { w: 512, h: Math.round((512 * h) / w), ...opts }), w, h, x, y, z, facing);
    group.add(m);
    signs.push(m);
  };
  sign(['🏨 Hotel De Tulp — Mal Kabul', 'Teslim körfezi · Lojistik avlusu'], 14, 2.6, HOTEL_DELIVERY.x, 7.8, Y.maxZ - 0.06, 'z-', { bg: '#1f5d43' });
  sign(['🚛 TruckCenter', 'Tır satış · Zeeland · Brabant · Noordkaap'], 9, 1.7, K.x, 4.9, K.z + 0.45, 'z+', { bg: '#f07b16', fg: '#1b1e22' });
  sign(['🏙️ Şehir / Otel', 'Tünel ⇠'], 6, 1.6, Y.minX + 0.05, 7.3, 0, 'x+', { bg: '#24508f' });
  sign(['A10 Ring ⇢', 'VersMarkt · FrisDepot · ArcadeWorks · Haven Zuid'], 12, 2.2, Y.maxX - 2, 6.5, -HWY.trunkHalf - 1.5, 'x-', { bg: '#1f5d43' });
  for (const s of SITES) {
    const gx = s.gate[0];
    const gz = s.gate[1];
    sign([`${s.icon} ${s.short}`, s.name], 10, 2.2, gx, 5.5, gz + (s.id === 'port' ? 0 : s.gate[1] < s.dock.z ? -0.6 : 0.6), s.id === 'port' ? 'x-' : s.gate[1] < s.dock.z ? 'z-' : 'z+', { bg: '#24508f' });
    if (s.id === 'port') continue;
    // Çıkış tabelası: bağlantı yolunun ana gövdeye bağlandığı yerden ~120 m önce (avludan gelen yöne bakar)
    const spur = ROADS.find((x) => x.site === s.id);
    const j = spur.pts[0];
    let best = 0;
    for (let k = 0; k < ROADS[0].pts.length; k++) if (Math.hypot(ROADS[0].pts[k][0] - j[0], ROADS[0].pts[k][1] - j[1]) < Math.hypot(ROADS[0].pts[best][0] - j[0], ROADS[0].pts[best][1] - j[1])) best = k;
    const back = ROADS[0].pts[Math.max(0, best - 9)];
    const nxt = ROADS[0].pts[Math.max(1, best - 8)];
    const yaw = Math.atan2(-(nxt[0] - back[0]), -(nxt[1] - back[1]));
    const g = new THREE.Group();
    g.position.set(back[0], 0, back[1]);
    g.rotation.y = yaw;
    const gm = new THREE.MeshLambertMaterial({ color: 0x6b7178 });
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7, 0.3), gm);
      leg.position.set(sx * (HWY.trunkHalf + 1), 3.5, 0);
      g.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(HWY.trunkHalf * 2 + 2.4, 0.4, 0.4), gm);
    beam.position.y = 7;
    g.add(beam);
    // Çıkış sağda mı solda mı (bağlantı yönü × yol yönü)
    const ux = nxt[0] - back[0];
    const uz = nxt[1] - back[1];
    const sd = spur.pts[Math.min(4, spur.pts.length - 1)];
    const right = -uz * (sd[0] - j[0]) + ux * (sd[1] - j[1]) > 0;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), signMaterial([`${right ? '' : '↖ '}${s.icon} ${s.short}${right ? ' ↗' : ''}`, `${s.name} · çıkış 120 m`], { bg: '#1f5d43', w: 512, h: 154 }));
    face.position.set(HWY.trunkHalf * 0.45 * (right ? 1 : -1), 6.2, 0.25);
    g.add(face);
    group.add(g);
  }
  // Hız tabelaları
  for (const k of [0.08, 0.35, 0.62, 0.88]) {
    const p = trunkAt(TRUNK_LENGTH * k);
    const x = p.x - p.uz * (HWY.trunkHalf + 1.2); // yolun sağı (avludan limana giderken)
    const z = p.z + p.ux * (HWY.trunkHalf + 1.2);
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), signMaterial([String(ROAD_KMH.trunk)], { bg: '#ffffff', fg: '#111111', w: 128, h: 128, border: true }));
    m.position.set(x, 2.4, z);
    m.rotation.y = Math.atan2(-p.ux, -p.uz);
    group.add(m);
  }
  group.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh) {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    }
  });
  for (const m of [rail, post, pole, arm, head, trunkM, crown, cont]) {
    m.matrixAutoUpdate = false;
    m.computeBoundingSphere();
  }
  return { group, mats: M };
}

/** Şehir tarafı: otelin önündeki sokağın doğu ucunda tünel ağzı + tabela (otel dünyasının parçası) */
function buildCityPortal(scene) {
  const t = CAR_XFER_BY_ID.toHighway.zone;
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x15181c });
  const conc = new THREE.MeshLambertMaterial({ color: 0x8d8f91 });
  const x = 17.98;
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(t.maxZ - t.minZ + 0.6, 3.1), dark);
  mouth.position.set(x, 1.55, (t.minZ + t.maxZ) / 2);
  mouth.rotation.y = -Math.PI / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, t.maxZ - t.minZ + 1.4), conc);
  top.position.set(x - 0.1, 3.3, (t.minZ + t.maxZ) / 2);
  g.add(mouth, top);
  for (const z of [t.minZ - 0.45, t.maxZ + 0.45]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.3, 0.35), conc);
    p.position.set(x - 0.1, 1.65, z);
    g.add(p);
  }
  g.add(panel(signMaterial(['🛣️ A10 Ring ⇢', 'Lojistik avlusu · tır parkı'], { bg: '#1f5d43', w: 512, h: 150 }), 3.4, 1.0, x - 0.27, 4.0, (t.minZ + t.maxZ) / 2, 'x-'));
  g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  scene.add(g);
  return g;
}

// =====================================================================================================
// Trafik (deterministik süs araçları) + sunucu ajanları (polis eklentisi)
// =====================================================================================================

const TRAFFIC_COLORS = [0xc3202f, 0x24508f, 0xeef0f2, 0x3d434b, 0xa9b0b8, 0x1f5d43, 0xf2c230, 0x121417];

class Traffic {
  constructor(group, count) {
    this.count = count;
    const body = new THREE.BoxGeometry(1.8, 0.8, 4.3).translate(0, 0.7, 0);
    const cab = new THREE.BoxGeometry(1.6, 0.55, 2.2).translate(0, 1.37, -0.2);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.body = new THREE.InstancedMesh(body, mat, count);
    this.cab = new THREE.InstancedMesh(cab, new THREE.MeshLambertMaterial({ color: 0x1d2a36 }), count);
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cab.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.frustumCulled = false;
    this.cab.frustumCulled = false;
    const r = rng(1919);
    const c = new THREE.Color();
    this.cars = [];
    for (let i = 0; i < count; i++) {
      const dir = i % 2 ? 1 : -1;
      const lane = r() < 0.65 ? 0 : 1;
      const speed = (lane === 0 ? 22 : 28) + r() * 5; // m/sn
      this.cars.push({ dir, lane, speed, s0: r() * TRUNK_LENGTH, x: 0, z: 0 });
      this.body.setColorAt(i, c.setHex(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]));
    }
    group.add(this.body, this.cab);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  /** Zamana bağlı konumlar (her istemcide aynı): t sn */
  update(t) {
    const L = TRUNK_LENGTH;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      let s = (c.s0 + c.speed * t) % (2 * L);
      if (s > L) s = 2 * L - s; // uçlarda karşı şeride döner (dönüş anında görünmez)
      const fwd = Math.floor((c.s0 + c.speed * t) / L) % 2 === 0 ? c.dir : -c.dir;
      const p = laneAt(s, fwd, c.lane);
      const vis = s > 45 && s < L - 45; // avlu / liman ağzında görünmez (çarpışma da yok)
      c.x = vis ? p.x : -1e6;
      c.z = vis ? p.z : -1e6;
      this._p.set(p.x, 0, p.z);
      this._q.setFromEuler(this._e.set(0, p.yaw + Math.PI, 0));
      this._s.setScalar(vis ? 1 : 0);
      this._m.compose(this._p, this._q, this._s);
      this.body.setMatrixAt(i, this._m);
      this.cab.setMatrixAt(i, this._m);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.cab.instanceMatrix.needsUpdate = true;
  }

  /** (x, z) noktasına r'den yakın trafik aracı */
  near(x, z, r) {
    for (const c of this.cars) if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r && Math.hypot(c.x - x, c.z - z) < r) return c;
    return null;
  }
}

// =====================================================================================================
// Ana sınıf
// =====================================================================================================

/**
 * Devasa açık dünya + FPV lojistik tırı (istemci).
 *
 *  - Harita: şehir dışı otoyol bölgesi (shared/worldmap.js) ayrı bir grup olarak garajın alan yöneticisine
 *    'highway' alanı olarak eklenir (oradayken otel dünyası çizilmez; uzak düzlem 900 m, sis). Şehre
 *    otelin önündeki sokağın doğu ucundaki tünelden gelinir (CAR_XFERS toHighway / toCity).
 *  - Sürüş kısıtı: Collision.constraints'e yol şeridi + avlu dikdörtgenleri eklenir (yoldan çıkılmaz).
 *  - Navi: sürerken (ya da aktif işin varken) bölgedeyken köşede mini harita (5 Hz yeniden çizim): yol ağı,
 *    rota çizgisi, hedef, mesafe / tahmini süre, sıradaki çıkış; 🗺️ ile tam harita.
 *  - Lojistik: Resepsiyon PC "🚛 Lojistik" sekmesi ve telefonda 🚛 uygulaması: sözleşme panosu, aktif iş,
 *    TruckCenter (tır satın al, cüzdandan). Avludaki TruckCenter binasında da E ile açılır.
 *  - Tırla yükleme körfezinde / mal kabul körfezinde durunca E: yükle / teslim et (park yerine geçer).
 *  - Yüklü dorseyle çarpma (ani hız kaybı ya da trafik aracına çarpma) → sunucuya hasar bildirimi.
 *  - Trafik: otoyolda deterministik süs araçları (InstancedMesh, tek draw call); sunucunun yapay araçları
 *    (LOGI_AGENTS: ileride polis) ayrı çizilir, polislerin tepe lambası yanıp söner.
 * Pil: bölge dışındayken hiçbir iş yapılmaz; trafik yalnızca bölgedeyken ve kare çizilirken güncellenir.
 */
export class LargeWorldMap {
  constructor({ engine, net, hud, interaction, player, collision, modal, device, settings, sfx, garage, vehicles, phone, reception, state, getWallet }) {
    Object.assign(this, { engine, net, hud, interaction, player, collision, modal, device, settings, sfx, garage, vehicles, phone, reception, state, getWallet });
    this.st = { offers: [], jobs: [], agents: [], stats: {} };
    this.selfId = null;
    this.inRegion = false;
    this.pending = false;
    this.selColor = Object.create(null);
    this.msg = '';
    this.prevVel = 0;
    this.hitAt = 0;
    this.bumpAt = 0;
    this.naviAt = 0;
    this.route = null;
    this.routeAt = 0;
    this.agentMeshes = new Map();
    this.boardAsked = false;

    const world = buildHighway({ collision });
    this.world = world;
    engine.scene.add(world.group);
    garage.addArea('highway', world.group, HWY.far);
    this.portal = buildCityPortal(engine.scene);
    this.traffic = new Traffic(world.group, device.touch ? 14 : 26);
    this.fog = new THREE.Fog(0xa9c7de, 220, HWY.far - 40);

    // Yol kısıtı: sürerken ve yürürken (yalnızca bölgede; başka yerde hemen döner)
    collision.constraints.push((pos, r) => {
      if (pos.x < HWY.bounds.minX - 6) return;
      constrainToRoads(pos, Math.min(r, 1.6));
    });

    const prev = garage.onArea;
    garage.onArea = (id, from) => {
      prev?.(id, from);
      this.onArea(id);
    };

    // Araç eklentisine (UndergroundGarage.carHooks) dorse görünürlüğü + kıvrılma eklenir
    const hooks = vehicles.cars;
    const prevList = hooks.onList;
    hooks.onList = (list, meshes) => {
      prevList(list, meshes);
      this.onVehicles();
    };
    const prevMesh = hooks.updateMesh;
    hooks.updateMesh = (m, v, own, x, z, ry) => {
      if (m.obj.userData.truck) this.articulate(m, x, z, ry);
      prevMesh(m, v, own, x, z, ry);
    };

    this.buildUi();
    interaction.providers.unshift({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    phone?.registerApp({ id: 'logistics', icon: '🚛', name: 'Lojistik', order: 5, render: (body) => this.renderBoard(body, 'phone') });
    if (reception) {
      reception.tabs.logistics = (body) => this.renderBoard(body, 'pc');
      const tabs = document.getElementById('pc-tabs');
      if (tabs && !tabs.querySelector('[data-tab="logistics"]')) {
        const btn = el('button', null, '🚛 Lojistik');
        btn.type = 'button';
        btn.dataset.tab = 'logistics';
        tabs.append(btn);
      }
    }
  }

  // ---- Durum ------------------------------------------------------------------------------------------

  reset(selfId) {
    this.selfId = selfId;
  }

  onState(s) {
    if (!s) return;
    this.st = s;
    this.syncAgents(s.agents ?? []);
    this.route = null;
    this.rerender();
    this.interaction.invalidate();
  }

  onAgents(list) {
    this.st.agents = list;
    this.syncAgents(list);
  }

  get myJob() {
    return this.st.jobs.find((j) => j.ownerId === this.selfId) ?? null;
  }

  myTrucks() {
    return this.vehicles.list.filter((v) => v.type === 'car' && v.ownerId === this.vehicles.selfId && isTruck(v.model));
  }

  /** Kendi tırını sürüyor mu → araç kaydı */
  drivingTruck() {
    const seat = this.vehicles.seat;
    if (seat?.seat !== 'driver') return null;
    const v = this.vehicles.byId.get(seat.id);
    return v && isTruck(v.model) ? v : null;
  }

  /** Sürülen tırın dorsesi: çekicinin dönüşü + gidilen yol (CityVehicleSystem.update'ten, araç başına) */
  articulate(m, x, z, ry) {
    const obj = m.obj;
    const ly = m.lry ?? ry;
    m.lry = ry;
    turnTractor(obj, Math.atan2(Math.sin(ry - ly), Math.cos(ry - ly)));
    // İleri yön (model: önü +Z) = (sin ry, cos ry)
    articulate(obj, (x - m.lx) * Math.sin(ry) + (z - m.lz) * Math.cos(ry));
  }

  /** VEHICLES listesi geldi: tırlarda dorse görünürlüğü */
  onVehicles() {
    for (const v of this.vehicles.list) {
      if (v.type !== 'car' || !isTruck(v.model)) continue;
      const m = this.vehicles.meshes.get(v.id);
      if (m) setTrailer(m.obj, v.trailer?.cargo ?? null);
    }
    this.rerender();
  }

  onArea(id) {
    this.inRegion = id === 'highway';
    const scene = this.engine.scene;
    if (this.inRegion) {
      scene.fog = this.fog;
      this.fog.color.copy(scene.background?.isColor ? scene.background : this.fog.color);
      if (!this.boardAsked) this.requestBoard();
    } else if (scene.fog === this.fog) scene.fog = null;
    this.el.navi.hidden = true;
    this.naviAt = 0;
    for (const m of this.agentMeshes.values()) m.visible = this.inRegion;
    this.engine.requestRender();
  }

  async requestBoard() {
    this.boardAsked = true;
    const res = await this.net.request(EVT.LOGI_ACT, { act: 'board' });
    if (res?.ok && res.state) this.onState(res.state);
  }

  // ---- Hedefler (E) ----------------------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (!this.inRegion && !inHighwayRegion(px, pz, 4)) return null;
    const truck = this.drivingTruck();
    const job = this.myJob;
    if (truck && job?.legal === false && this.illegal) return this.illegal.findTarget(px, pz, f, truck); // kaçak iş (IllegalLogistics)
    if (truck) {
      const at = { x: px, z: pz, marker: false };
      if (job?.state === 'accepted') {
        const s = SITE_BY_ID[job.site];
        if (pointIn(s.load, px, pz, 1)) return { ...at, short: 'Yükle', label: `📦 ${s.short}: ${job.pallets} palet ${CARGO_BY_ID[job.cargo].name} yükle (kasadan ${formatEuro(job.wholesale)})`, use: () => this.act('load') };
      }
      if (job?.state === 'loaded' && truck.trailer && pointIn(HOTEL_DELIVERY.zone, px, pz, 1)) {
        return { ...at, short: 'Teslim', label: '🏨 Mal kabul: yükü teslim et', use: () => this.act('deliver') };
      }
      return null;
    }
    if (this.vehicles.seat) return null;
    const extra = this.illegal?.findTarget(px, pz, f, null); // limandaki tanıdık (yaya)
    if (extra) return extra;
    const K = SERVICE_YARD.dealer;
    const dx = K.point[0] - px;
    const dz = K.point[1] - pz;
    const d = Math.hypot(dx, dz);
    if (d < K.range && (d < 0.8 || (dx * f.x + dz * f.z) / d > 0.3)) {
      return { x: K.x, z: K.z + 0.5, marker: false, short: 'Tır', label: '🚛 TruckCenter — tır satın al / Lojistik panosu', use: () => this.openDealer() };
    }
    return null;
  }

  async act(act) {
    if (this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.LOGI_ACT, { act });
    this.pending = false;
    if (!res?.ok) {
      this.hud.toast(res?.error || 'Olmadı.', 'warn');
      return;
    }
    if (act === 'load') {
      this.hud.toast('📦 Yüklendi! Dorse takıldı — otelin lojistik avlusundaki 🏨 mal kabul körfezine götür.', 'info');
      if (this.settings.sound) this.sfx?.clink?.();
    } else if (act === 'deliver' && this.settings.sound) this.sfx?.coin?.();
    this.route = null;
  }

  // ---- Arayüz (DOM) ------------------------------------------------------------------------------------

  buildUi() {
    const navi = el('div', 'navi');
    navi.id = 'navi';
    navi.hidden = true;
    const canvas = el('canvas');
    const size = this.device.touch ? 150 : 210;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const info = el('div', 'navi-info');
    const big = el('button', 'navi-map', '🗺️');
    big.type = 'button';
    big.title = 'Tam harita';
    big.addEventListener('click', () => this.openMap());
    navi.append(canvas, info, big);
    document.body.append(navi);

    const mapPanel = el('div', 'overlay');
    mapPanel.id = 'world-map-panel';
    mapPanel.hidden = true;
    const card = el('div', 'card world-map-card');
    const title = el('h2', null, '🗺️ A10 Ring — Lojistik haritası');
    const mapCanvas = el('canvas', 'world-map-canvas');
    mapCanvas.width = 1020;
    mapCanvas.height = 770;
    const legend = el('p', 'sub world-map-legend');
    const close = el('button', 'primary', 'Kapat');
    close.type = 'button';
    close.addEventListener('click', () => this.modal.close(mapPanel));
    card.append(title, mapCanvas, legend, close);
    mapPanel.append(card);
    document.body.append(mapPanel);

    const dealer = el('div', 'overlay');
    dealer.id = 'logi-panel';
    dealer.hidden = true;
    const dcard = el('div', 'card logi-card');
    const dbody = el('div', 'logi-body');
    const dclose = el('button', 'secondary', 'Kapat');
    dclose.type = 'button';
    dclose.addEventListener('click', () => this.modal.close(dealer));
    dcard.append(dbody, dclose);
    dealer.append(dcard);
    document.body.append(dealer);

    this.el = { navi, canvas, info, ctx: canvas.getContext('2d'), size, dpr, mapPanel, mapCanvas, legend, dealer, dbody };
  }

  openDealer() {
    this.msg = '';
    this.renderBoard(this.el.dbody, 'kiosk');
    this.modal.open(this.el.dealer);
    if (!this.st.offers.length) this.requestBoard();
  }

  openMap() {
    this.drawMap(this.el.mapCanvas.getContext('2d'), 1020, 770, null);
    const job = this.myJob;
    this.el.legend.textContent = job
      ? `Hedef: ${job.state === 'accepted' ? `${SITE_BY_ID[job.site].icon} ${SITE_BY_ID[job.site].name} (yükle)` : '🏨 Otelin mal kabul körfezi (teslim)'} · mor çizgi: rota`
      : '🏨 Lojistik avlusu (otel) · 🥩 VersMarkt · 🧃 FrisDepot · 🎳 ArcadeWorks · ⚓ Liman';
    this.modal.open(this.el.mapPanel);
  }

  rerender() {
    if (!this.el.dealer.hidden) this.renderBoard(this.el.dbody, 'kiosk');
    if (this.phone?.isOpen && this.phone.current?.id === 'logistics') this.phone.rerender();
    if (this.reception?.tab === 'logistics' && !this.reception.el.panel.hidden) this.reception.render();
  }

  /** Lojistik panosu: aktif iş, teklifler, tırlarım, TruckCenter kataloğu */
  renderBoard(box, where) {
    box.replaceChildren();
    if (!this.boardAsked && !this.st.offers.length) this.requestBoard();
    const root = el('div', `logi${where === 'phone' ? ' in-phone' : ''}`);
    const wallet = this.getWallet();
    const kasa = this.state.economy?.money ?? 0;
    const trucks = this.myTrucks();
    const st = this.st.stats ?? {};
    root.append(el('div', 'logi-head', `🎒 ${formatEuro(wallet)} · 🏨 Kasa ${formatEuro(kasa)} · 📦 ${st.deliveries ?? 0} teslimat · ${(st.km ?? 0).toFixed(1).replace('.', ',')} km`));
    if (this.msg) root.append(el('p', 'logi-msg', this.msg));
    const job = this.myJob;
    if (job) root.append(job.legal === false && this.illegal ? this.illegal.jobCard(job) : this.jobCard(job));
    else if (!trucks.length) root.append(el('p', 'logi-hint', '🚛 Sevkiyat almak için önce bir tır al (aşağıda TruckCenter). Tır, şehir dışındaki lojistik avlusunun tır parkına teslim edilir — otelin önündeki sokağın doğu ucundaki 🛣️ tünelden ya da 🗺️ Işınlan → 🚛 Lojistik avlusu ile gidilir.'));
    // Teklifler
    root.append(el('div', 'logi-sub', '📋 Sözleşme panosu'));
    const list = el('div', 'logi-offers');
    const now = this.net.serverNow();
    for (const o of this.st.offers) {
      const c = CARGO_BY_ID[o.cargo];
      const s = SITE_BY_ID[o.site];
      const row = el('div', 'logi-offer');
      row.append(el('div', 'lo-icon', c.icon));
      const info = el('div', 'lo-info');
      info.append(el('b', null, `${o.pallets} palet ${c.name}`), el('small', null, `${s.icon} ${s.name} → 🏨 otel · ${fmtKm(o.dist * 2)} · süre ${fmtTime(o.timeSec)}`));
      info.append(el('small', null, `Toptan ${formatEuro(o.wholesale)} (kasadan) → değer ${formatEuro(o.value)} · şoför ücreti ${formatEuro(o.fee)} · ${fmtTime((o.expires - now) / 1000)} sonra kalkar`));
      const btn = el('button', 'lo-take', 'Al');
      btn.type = 'button';
      btn.disabled = !!job || !trucks.length || this.pending;
      btn.addEventListener('click', () => this.accept(o.id));
      row.append(info, btn);
      list.append(row);
    }
    if (!this.st.offers.length) list.append(el('p', 'logi-hint', 'Pano yükleniyor…'));
    root.append(list);
    // Tırlarım
    if (trucks.length) {
      root.append(el('div', 'logi-sub', '🅿️ Tırlarım'));
      for (const v of trucks) {
        const m = CAR_BY_ID[v.model];
        const where = yardAt(v.x, v.z);
        const place = where === 'yard' ? 'lojistik avlusunda' : where ? `${SITE_BY_ID[where]?.short ?? ''}'da` : 'yolda';
        const row = el('div', 'logi-mine');
        const dot = el('i');
        dot.style.background = m.colors[v.color]?.hex ?? '#888';
        row.append(dot, el('span', null, `${m.name} — ${place}${v.trailer ? ` · 📦 ${CARGO_BY_ID[v.trailer.cargo]?.name}` : ''}${v.driver != null ? ' (sürülüyor)' : ''}`));
        root.append(row);
      }
    }
    // TruckCenter
    root.append(el('div', 'logi-sub', '🚛 TruckCenter — tır satın al (cüzdandan)'));
    const cat = el('div', 'logi-trucks');
    const full = trucks.length >= TRUCK_RULES.MAX_PER_PLAYER;
    for (const m of TRUCK_MODELS) {
      const sel = this.selColor[m.id] ?? 0;
      const card = el('div', 'truck-card');
      const art = el('div', 'truck-art', BODY_ART[m.id] ?? '🚛');
      art.style.setProperty('--paint', m.colors[sel].hex);
      const info = el('div', 'truck-info');
      info.append(el('b', null, m.name), el('div', 'truck-price', formatEuro(m.price)));
      info.append(el('small', null, `🐎 ${m.hp} bg · ${m.gears} vites · 0–60 ${m.t60} sn · sınırlayıcı ${m.topKmh} km/s`));
      info.append(el('div', 'truck-desc', m.desc));
      const colors = el('div', 'car-colors');
      m.colors.forEach((c, i) => {
        const b = el('button', i === sel ? 'on' : '');
        b.type = 'button';
        b.title = c.name;
        b.setAttribute('aria-label', c.name);
        b.style.background = c.hex;
        b.addEventListener('click', () => {
          this.selColor[m.id] = i;
          this.rerender();
          if (where === 'pc') this.reception.render();
        });
        colors.append(b);
      });
      info.append(colors);
      const buy = el('button', 'truck-buy', full ? `En fazla ${TRUCK_RULES.MAX_PER_PLAYER} tır` : `Satın al · ${formatEuro(m.price)}`);
      buy.type = 'button';
      buy.disabled = full || wallet < m.price;
      buy.addEventListener('click', () => this.buy(m, sel));
      card.append(art, info, buy);
      cat.append(card);
    }
    root.append(cat);
    this.illegal?.renderBoard(root, where); // 🕶️ gizli bölme + limandaki tanıdık (IllegalLogistics)
    box.append(root);
  }

  jobCard(job) {
    const s = SITE_BY_ID[job.site];
    const c = CARGO_BY_ID[job.cargo];
    const card = el('div', 'logi-job');
    const left = (job.deadline - this.net.serverNow()) / 1000;
    card.append(el('b', null, `${c.icon} Aktif sevkiyat: ${job.pallets} palet ${c.name}`));
    const step = job.state === 'accepted'
      ? `1/2 · ${s.icon} ${s.name} yükleme körfezine git, dur, E: yükle (kasadan ${formatEuro(job.wholesale)})`
      : '2/2 · 🏨 Otelin lojistik avlusundaki mal kabul körfezine götür, dur, E: teslim';
    card.append(el('div', null, step));
    const pay = deliveryPay(job, this.net.serverNow());
    card.append(el('small', null, `${left > 0 ? `⏱ ${fmtTime(left)} kaldı` : '⏱ Gecikti!'} · hasar %${Math.round(job.damage * 100)} · beklenen: kasaya ${formatEuro(job.state === 'loaded' ? pay.value : job.value)}, sana ${formatEuro(job.state === 'loaded' ? pay.fee : Math.round(job.fee * LOGI_RULES.ONTIME_MUL))}`));
    const row = el('div', 'logi-job-btns');
    const map = el('button', null, '🗺️ Harita');
    map.type = 'button';
    map.addEventListener('click', () => this.openMap());
    const cancel = el('button', 'danger', job.state === 'loaded' ? 'İptal (yükün yarısı iade)' : 'İptal');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.cancel());
    row.append(map, cancel);
    card.append(row);
    return card;
  }

  async accept(offer) {
    if (this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.LOGI_ACT, { act: 'accept', offer });
    this.pending = false;
    this.msg = res?.ok ? `✓ ${res.text}` : res?.error || 'Alınamadı.';
    this.hud.toast(this.msg, res?.ok ? 'info' : 'warn');
    this.route = null;
    this.rerender();
  }

  async cancel() {
    const res = await this.net.request(EVT.LOGI_ACT, { act: 'cancel' });
    this.msg = res?.ok ? `Sevkiyat iptal edildi${res.refund ? ` — kasaya ${formatEuro(res.refund)} iade` : ''}.` : res?.error || '';
    this.rerender();
  }

  async buy(m, color) {
    const res = await this.net.request(EVT.CAR_ACT, { act: 'buy', model: m.id, color, source: 'wallet' });
    this.msg = res?.ok ? `✓ ${m.name} senin! Lojistik avlusunda ${res.bay ?? 'tır parkına'} park edildi.` : res?.error || 'Satın alınamadı.';
    this.hud.toast(`🚛 ${this.msg}`, res?.ok ? 'money' : 'warn');
    setTimeout(() => this.rerender(), 250);
  }

  // ---- Navi ---------------------------------------------------------------------------------------------

  /** Aktif hedef: iş adımına göre depo / otel */
  destination() {
    const job = this.myJob;
    if (!job) return null;
    if (job.legal === false) return job.state === 'accepted' ? 'port' : 'drinks'; // K-17 (liman) → Eski Kantar Deposu (FrisDepot)
    return job.state === 'accepted' ? job.site : 'hotel';
  }

  updateNavi(now) {
    const show = this.inRegion && (this.vehicles.seat?.seat === 'driver' || !!this.myJob);
    if (this.el.navi.hidden === show) this.el.navi.hidden = !show;
    if (!show || now - this.naviAt < 200) return;
    this.naviAt = now;
    const { x, z } = this.player.pos;
    const dest = this.destination();
    if (dest && (!this.route || now - this.routeAt > 1000)) {
      this.route = routeTo(x, z, dest);
      this.routeAt = now;
    } else if (!dest) this.route = null;
    const { ctx, size, dpr } = this.el;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawMap(ctx, size, size, { x, z, zoom: 0.5 });
    // Metin
    let text = '';
    if (this.route) {
      const v = Math.max(8, Math.abs(this.player.vel));
      const turn = this.nextTurn(x, z, dest);
      text = `${fmtKm(this.route.length)} · ~${fmtTime(this.route.length / v)}${turn ? `\n${turn}` : ''}`;
    } else {
      const lim = ROAD_KMH;
      text = `A10 Ring · ${lim.trunk} km/s`;
    }
    if (this.el.info.textContent !== text) this.el.info.textContent = text;
  }

  /** Sıradaki manevra: hedefin çıkışı / otoyola katılma / avluya giriş */
  nextTurn(x, z, dest) {
    const destSite = dest === 'hotel' ? 'yard' : dest;
    const here = yardAt(x, z, 1);
    const hint = this.illegal?.turnHint(here, destSite);
    if (hint) return hint;
    if (here === destSite) return dest === 'hotel' ? '🏨 Sarı çerçeveli mal kabul körfezinde dur → E' : '📦 Sarı çerçeveli yükleme körfezinde dur → E';
    if (here) return '⬆ Otoyola çık';
    const r = this.route;
    if (!r) return '';
    if (destSite === 'yard') return `⬅ ${fmtKm(r.length)} sonra lojistik avlusu`;
    if (destSite === 'port') return `⬆ Otoyolun sonu: ⚓ Liman`;
    const spur = ROADS.find((s) => s.site === destSite);
    const j = spur.pts[0];
    const dj = Math.hypot(j[0] - x, j[1] - z);
    if (dj < 25) return `↪ ${SITE_BY_ID[destSite].short} çıkışına gir`;
    return `↗ ${SITE_BY_ID[destSite].short} çıkışı · ${fmtKm(dj)}`;
  }

  /**
   * Haritayı çiz. view null → bütün bölge (tam harita); yoksa oyuncu merkezli mini harita (kuzey yukarı:
   * dünyanın −z yönü yukarı değil — kuşbakışı: x sağa, z aşağı).
   */
  drawMap(ctx, w, h, view) {
    const B = HWY.bounds;
    let k;
    let ox;
    let oz;
    if (view) {
      k = view.zoom; // px / m
      ox = view.x - w / 2 / k;
      oz = view.z - h / 2 / k;
    } else {
      k = Math.min(w / (B.maxX - B.minX), h / (B.maxZ - B.minZ));
      ox = B.minX;
      oz = B.minZ;
    }
    const X = (x) => (x - ox) * k;
    const Z = (z) => (z - oz) * k;
    ctx.fillStyle = '#2f4a2a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a4f6b';
    ctx.fillRect(X(B.maxX), 0, w, h);
    // Avlular
    for (const y of YARDS) {
      const b = y.bounds;
      ctx.fillStyle = y.id === 'yard' ? '#1f5d43' : '#59606a';
      ctx.fillRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
    }
    // Yollar
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of ROADS) {
      ctx.strokeStyle = r.kind === 'trunk' ? '#d8d3c4' : '#b9b4a6';
      ctx.lineWidth = Math.max(view ? 3 : 2, r.half * 2 * k);
      ctx.beginPath();
      r.pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
    }
    // Rota
    const route = view ? this.route : (this.destination() ? routeTo(this.player.pos.x, this.player.pos.z, this.destination()) : null);
    if (route) {
      ctx.strokeStyle = '#b05cff';
      ctx.lineWidth = view ? 4 : 3;
      ctx.beginPath();
      route.pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
      const g = route.pts[route.pts.length - 1];
      ctx.fillStyle = '#ff2bd6';
      ctx.beginPath();
      ctx.arc(X(g[0]), Z(g[1]), view ? 5 : 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Etiketler (tam harita)
    ctx.font = `${view ? 11 : 15}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    if (!view) {
      ctx.fillText('🏨 Lojistik avlusu', X(290), Z(-50));
      for (const s of SITES) ctx.fillText(`${s.icon} ${s.short}`, X((s.bounds.minX + s.bounds.maxX) / 2), Z(s.bounds.minZ) - 6);
    }
    this.illegal?.drawMap(ctx, X, Z, view); // kaçak iş hedefleri, tarayıcı kapıları
    // Yapay araçlar (polis)
    for (const a of this.st.agents ?? []) {
      ctx.fillStyle = a.kind === 'police' ? '#3b82ff' : '#cccccc';
      ctx.fillRect(X(a.x) - 3, Z(a.z) - 3, 6, 6);
    }
    // Oyuncu oku
    const px = this.player.pos.x;
    const pz = this.player.pos.z;
    if (inHighwayRegion(px, pz, 4)) {
      const yaw = this.player.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const cx = X(px);
      const cz = Z(pz);
      const s = view ? 9 : 10;
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + fx * s, cz + fz * s);
      ctx.lineTo(cx - fx * s * 0.6 - fz * s * 0.55, cz - fz * s * 0.6 + fx * s * 0.55);
      ctx.lineTo(cx - fx * s * 0.3, cz - fz * s * 0.3);
      ctx.lineTo(cx - fx * s * 0.6 + fz * s * 0.55, cz - fz * s * 0.6 - fx * s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // ---- Yapay araçlar (sunucu) ------------------------------------------------------------------------------

  syncAgents(list) {
    const seen = new Set();
    for (const a of list) {
      seen.add(a.id);
      let m = this.agentMeshes.get(a.id);
      if (!m) {
        m = new THREE.Group();
        const police = a.kind === 'police';
        const civil = a.kind === 'civil';
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.85, 4.6).translate(0, 0.72, 0), new THREE.MeshLambertMaterial({ color: police ? 0xf4f4f4 : civil ? 0x2b2f35 : 0x8a8f96 }));
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.3).translate(0, 1.4, -0.2), new THREE.MeshLambertMaterial({ color: 0x1d2a36 }));
        m.add(body, cab);
        if (police) {
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.87, 0.18, 4.62).translate(0, 0.78, 0), new THREE.MeshLambertMaterial({ color: 0x1747c9 }));
          const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.35).translate(0, 1.76, -0.2), new THREE.MeshBasicMaterial({ color: 0x2b6dff }));
          m.add(stripe, bar);
          m.userData.bar = bar;
        }
        if (civil) {
          const flash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(0, 1.1, 2.0), new THREE.MeshBasicMaterial({ color: 0x2b6dff }));
          m.add(flash);
          m.userData.bar = flash;
        }
        m.userData.kind = a.kind;
        m.visible = this.inRegion;
        this.world.group.add(m);
        this.agentMeshes.set(a.id, m);
      }
      m.userData.tx = a.x;
      m.userData.tz = a.z;
      m.userData.tyaw = a.yaw + Math.PI;
      if (m.userData.x === undefined) {
        m.position.set(a.x, 0, a.z);
        m.rotation.y = a.yaw + Math.PI;
        m.userData.x = a.x;
      }
    }
    for (const [id, m] of this.agentMeshes) {
      if (seen.has(id)) continue;
      this.world.group.remove(m);
      this.agentMeshes.delete(id);
    }
  }

  updateAgents(dt, t) {
    const k = Math.min(1, dt * 6);
    for (const m of this.agentMeshes.values()) {
      const u = m.userData;
      m.position.x += (u.tx - m.position.x) * k;
      m.position.z += (u.tz - m.position.z) * k;
      m.rotation.y += Math.atan2(Math.sin(u.tyaw - m.rotation.y), Math.cos(u.tyaw - m.rotation.y)) * k;
      if (u.bar) u.bar.material.color.setHex(Math.floor(t * 4) % 2 ? 0xff2a2a : 0x2b6dff);
    }
  }

  // ---- Çarpma / trafik --------------------------------------------------------------------------------------

  checkHits(now) {
    const truck = this.drivingTruck();
    const job = this.myJob;
    const v = Math.abs(this.player.vel);
    if (truck && this.inRegion) {
      // Trafik aracına çarpma: tır burnu (ön 3 m) bir arabaya değerse
      const yaw = this.player.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const hit = this.traffic.near(this.player.pos.x + fx * 3, this.player.pos.z + fz * 3, 2.6);
      if (hit && v > 2 && now - this.bumpAt > 1000) {
        this.bumpAt = now;
        this.player.vel *= 0.3;
        if (this.settings.sound) this.sfx?.clink?.();
      }
    }
    if (!truck || job?.state !== 'loaded' || !truck.trailer) {
      this.prevVel = 0;
      return;
    }
    const prev = this.prevVel;
    this.prevVel = Math.abs(this.player.vel);
    if (prev > 2 && this.prevVel < prev * 0.55 && now - this.hitAt > LOGI_RULES.HIT_MIN_MS) {
      this.hitAt = now;
      this.net.request(EVT.LOGI_ACT, { act: 'hit', kmh: Math.round(prev * KMH * 10) / 10 }).then((res) => {
        if (res?.ok && res.damage > 0) this.hud.toast(`💥 Yük hasar gördü! (%${Math.round(res.damage * 100)})`, 'warn');
      });
    }
  }

  // ---- Kare ---------------------------------------------------------------------------------------------------

  /** @returns {boolean} kare gerekli mi */
  update(dt) {
    if (!this.inRegion) {
      if (!this.el.navi.hidden) this.el.navi.hidden = true;
      return false;
    }
    const now = performance.now();
    const t = this.net.serverNow() / 1000;
    this.traffic.update(t % 100000);
    this.updateAgents(dt, t);
    this.checkHits(now);
    this.updateNavi(now);
    // Kare yalnızca sürerken ya da yakında (250 m) trafik varken gerekir (avluda dururken pil)
    return !!this.vehicles.seat || !!this.traffic.near(this.player.pos.x, this.player.pos.z, 250) || this.agentMeshes.size > 0;
  }
}

function pointIn(b, x, z, tol = 0) {
  return x > b.minX - tol && x < b.maxX + tol && z > b.minZ - tol && z < b.maxZ + tol;
}

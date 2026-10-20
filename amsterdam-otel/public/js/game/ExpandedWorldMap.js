import * as THREE from 'three';
import {
  HWY, SERVICE_YARD, HOTEL_DELIVERY, SITES, SITE_BY_ID, ROADS, ROAD_BY_ID, YARDS, ROAD_KMH, PLAZAS, SIGNALS, GRAPH,
  NIEUW_ZUID, INDUSTRY, isDrivable, yardAt, nearOtherRoad, roadPoint, roadLength, signalState, edgeDirAt, signalAxis, LANES,
} from '/shared/worldmap.js';
import { StaticBatcher } from '../world/StaticBatcher.js';
import { canvasTexture, drawAsphalt, drawConcrete, rng, signMaterial, panel } from '../world/CarWorldKit.js';

/**
 * Genişletilmiş açık dünya geometrisi (şehir dışı bölge, x 240..7800, z −2300..1700): A10 Ring (~7.3 km) ve A4
 * Noord otoyolları, Nieuw-Zuid şehir semti (ızgara sokaklar, bloklar, trafik ışıkları, yaya geçitleri),
 * Industrieweg sanayi yolu (depolar), lojistik avlusu, üç toptancı deposu, Haven Zuid konteyner limanı.
 *
 * Pil / performans:
 *  - Bölge 1 km'lik HÜCRELERE (chunk) bölünür; her hücrenin statikleri malzeme başına tek mesh (StaticBatcher),
 *    tekrarlanan nesneleri (bariyer, lamba, ağaç, bina dışı) hücre başına InstancedMesh. Yalnızca oyuncuya
 *    VIEW (950 m) içindeki hücreler görünür (setView, oyuncu 40 m yürüdükçe) — uzak düzlem 900 m + sis.
 *  - Bütün hücreler açılışta kurulur ve aynı paylaşılan malzemeleri kullanır: Engine.prewarm hepsini menüde
 *    derler; hücre değişiminde (ya da sonradan) YENİ shader derlenmez.
 *  - Trafik ışıkları bütün kavşaklarda aynı fazda (tek döngü): 6 paylaşılan lamba malzemesinin rengi yalnızca
 *    faz değişince güncellenir (draw call artmaz).
 */

const NO = { cast: false, receive: false };
export const CHUNK = 1000;
const VIEW = 950;

function materials() {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const B = (o) => new THREE.MeshBasicMaterial(o);
  const asph = canvasTexture(256, 256, drawAsphalt('#3b3e42', 21));
  const conc = canvasTexture(256, 256, drawConcrete('#9a9c9e', 5, 0.2));
  const walk = canvasTexture(128, 128, drawConcrete('#b7b3aa', 9, 0.1));
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
  // Cephe: açık duvar + koyu pencere ızgarası (6 m'de bir döşenir: 2 kat × 2 pencere); malzeme rengi tonlar
  const facade = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#f2efe8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b3440';
    for (let fy = 0; fy < 2; fy++) for (let fx = 0; fx < 2; fx++) g.fillRect(fx * 64 + 14, fy * 64 + 12, 36, 38);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let fy = 0; fy < 2; fy++) for (let fx = 0; fx < 2; fx++) g.fillRect(fx * 64 + 16, fy * 64 + 14, 10, 34);
  });
  return {
    wAsph: L({ map: asph }),
    wConc: L({ map: conc }),
    wWalk: L({ map: walk }),
    wGrass: L({ map: grass }),
    wTulip: L({ map: tulip }),
    wShed: L({ map: shed }),
    wWater: L({ map: water }),
    wFacadeA: L({ map: facade, color: 0xb7563c }), // tuğla kırmızı
    wFacadeB: L({ map: facade, color: 0xe8dcc0 }), // krem
    wFacadeC: L({ map: facade, color: 0x9aa3ad }), // gri
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
    wCrown: L({ color: 0x3f7a35, flatShading: true }),
    wCont: L({ color: 0xffffff }),
    // Trafik ışığı lambaları (iki faz × üç renk; renk faz değişince güncellenir)
    sigNsR: B({ color: 0x3a1210 }), sigNsY: B({ color: 0x3a2e10 }), sigNsG: B({ color: 0x103a1a }),
    sigEwR: B({ color: 0x3a1210 }), sigEwY: B({ color: 0x3a2e10 }), sigEwG: B({ color: 0x103a1a }),
  };
}

const LIT = { R: [0xff2a1a, 0x3a1210], Y: [0xffc21a, 0x3a2e10], G: [0x2bff5a, 0x103a1a] };

/** Polyline boyunca şerit (ribbon) geometrisi: u enine (0..1), v boyuna (m / vScale) */
function ribbon(pts, half, y, vScale = 8, from = -1, to = 1) {
  const pos = [];
  const uv = [];
  const nor = [];
  const idx = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
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
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
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
function sample(pts, step, offset = 0) {
  const out = [];
  let carry = offset;
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

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function setInstance(mesh, i, x, y, z, ry, sx = 1, sy = 1, sz = 1) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(sx, sy, sz));
  mesh.setMatrixAt(i, _m);
}

const chunkKey = (cx, cz) => `${cx},${cz}`;

/**
 * Genişletilmiş dünyayı kur. @returns {{ group, mats, chunks, setView(x, z), updateSignals(tSec), stats }}
 * group: bölgenin kök grubu (garajın alan yöneticisine 'highway' alanı olarak eklenir; ajanlar / IllegalLogistics
 * props'u buraya eklenir).
 */
export function buildExpandedWorld({ collision }) {
  const group = new THREE.Group();
  group.name = 'highway';
  const M = materials();
  const R = HWY.bounds;
  const chunks = new Map();
  const chunkAt = (x, z) => {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const k = chunkKey(cx, cz);
    let c = chunks.get(k);
    if (!c) {
      c = { key: k, cx, cz, group: new THREE.Group(), b: new StaticBatcher(), inst: Object.create(null) };
      c.group.name = `chunk:${k}`;
      chunks.set(k, c);
    }
    return c;
  };
  /** Tekrarlanan nesne örneği (hücre başına toplanır, sonra InstancedMesh) */
  const inst = (kind, x, z, ry = 0, s = 1, sy = s, extra = null) => {
    const c = chunkAt(x, z);
    (c.inst[kind] ??= []).push([x, z, ry, s, sy, extra]);
  };
  const B = (x, z) => chunkAt(x, z).b;

  // ---- Zemin (tek düzlem) + liman suyu ----
  const gw = R.maxX - R.minX + 600;
  const gd = R.maxZ - R.minZ + 600;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd).rotateX(-Math.PI / 2), M.wGrass);
  M.wGrass.map.repeat.set(gw / 10, gd / 10);
  ground.position.set((R.minX + R.maxX) / 2, 0, (R.minZ + R.maxZ) / 2);
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  group.add(ground);
  const port = SITE_BY_ID.port;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(500, 2400).rotateX(-Math.PI / 2), M.wWater);
  M.wWater.map.repeat.set(40, 160);
  water.position.set(port.bounds.maxX + 250, 0.02, 0);
  water.matrixAutoUpdate = false;
  water.updateMatrix();
  group.add(water);

  // ---- Yollar ----
  // Otoyol / bağlantı yolu: polyline şeridi (ribbon) hücrelere parça parça; şehir yolları: eksene hizalı zemin
  // dikdörtgenleri (dünya UV — kesişmelerde aynı piksel, titreme yok)
  const yOf = { trunk: 0.03, spur: 0.026 };
  for (const r of ROADS) {
    if (r.kind === 'urban') continue;
    const y = r.id === 'trunk' ? 0.03 : r.id === 'a4' ? 0.028 : yOf[r.kind];
    // Hücrelere böl (segment ortası hangi hücredeyse)
    let piece = [r.pts[0]];
    let cur = null;
    const flush = () => {
      if (piece.length < 2) return;
      const mid = piece[Math.floor(piece.length / 2)];
      const b = B(mid[0], mid[1]);
      b.add('wAsph', ribbon(piece, r.half, y), NO);
      b.add('wPaint', ribbon(piece, r.half - 0.35, y + 0.015, 8, -1, -0.97), NO);
      b.add('wPaint', ribbon(piece, r.half - 0.35, y + 0.015, 8, 0.97, 1), NO);
      if (r.kind === 'trunk') {
        b.add('wYellow', ribbon(piece, 0.25, y + 0.015, 8, -1, -0.4), NO);
        b.add('wYellow', ribbon(piece, 0.25, y + 0.015, 8, 0.4, 1), NO);
      }
    };
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1];
      const p = r.pts[i];
      const k = chunkKey(Math.floor((a[0] + p[0]) / 2 / CHUNK), Math.floor((a[1] + p[1]) / 2 / CHUNK));
      if (cur !== null && k !== cur) {
        flush();
        piece = [a];
      }
      cur = k;
      piece.push(p);
    }
    flush();
    // Kesik şerit çizgileri (dash: hücresine)
    const lane = HWY.laneW;
    const dash = (offset, w, len, gap) => {
      for (const p of sample(r.pts, len + gap, 30)) {
        const cx = p.x - p.uz * offset + p.ux * len * 0.5;
        const cz = p.z + p.ux * offset + p.uz * len * 0.5;
        if (nearOtherRoad(cx, cz, r.id, -1)) continue;
        const g = new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2).rotateY(Math.atan2(p.ux, p.uz));
        g.translate(cx, y + 0.016, cz);
        B(cx, cz).add('wPaint', g, NO);
      }
    };
    if (r.kind === 'trunk') for (const off of [lane, -lane]) dash(off, 0.15, 4, 8);
    else dash(0, 0.15, 3, 5);
  }
  // Şehir yolları (Nieuw-Zuid ızgarası, Industrieweg, depo girişleri): asfalt + kaldırım + orta çizgi
  const plazaNear = (x, z, pad = 0) => PLAZAS.some((p) => Math.abs(x - p.x) < p.half + pad && Math.abs(z - p.z) < p.half + pad);
  for (const r of ROADS) {
    if (r.kind !== 'urban') continue;
    const [a, b] = [r.pts[0], r.pts[r.pts.length - 1]];
    const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
    const h = r.half;
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [z0, z1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    // Hücre sınırında parçala (uzun Industrieweg)
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.ceil(len / 400));
    for (let k = 0; k < n; k++) {
      const f0 = k / n;
      const f1 = (k + 1) / n;
      const px0 = alongX ? x0 + (x1 - x0) * f0 : x0 - h;
      const px1 = alongX ? x0 + (x1 - x0) * f1 : x1 + h;
      const pz0 = alongX ? z0 - h : z0 + (z1 - z0) * f0;
      const pz1 = alongX ? z1 + h : z0 + (z1 - z0) * f1;
      const cxm = (px0 + px1) / 2;
      const czm = (pz0 + pz1) / 2;
      const bb = B(cxm, czm);
      bb.floor('wAsph', px0, px1, pz0, pz1, 0.031, { ...NO, uvScale: 0.125 });
    }
    // Kaldırımlar (yolun iki yanı, 3 m, hafif yüksek): kavşak meydanlarında kesilir
    const t0 = alongX ? x0 : z0;
    const t1 = alongX ? x1 : z1;
    const cut = PLAZAS.filter((q) => (alongX ? Math.abs(q.z - a[1]) < 1 && q.x > t0 - q.half && q.x < t1 + q.half : Math.abs(q.x - a[0]) < 1 && q.z > t0 - q.half && q.z < t1 + q.half))
      .map((q) => [(alongX ? q.x : q.z) - q.half - 3, (alongX ? q.x : q.z) + q.half + 3]).sort((p1, p2) => p1[0] - p2[0]);
    let t = t0;
    const walkPiece = (u0, u1) => {
      if (u1 - u0 < 1) return;
      if (u1 - u0 > 400) {
        const m = (u0 + u1) / 2;
        walkPiece(u0, m);
        walkPiece(m, u1);
        return;
      }
      for (const side of [-1, 1]) {
        const w0 = (alongX ? a[1] : a[0]) + side * h;
        const w1 = w0 + side * 3;
        const [c0, c1] = [Math.min(w0, w1), Math.max(w0, w1)];
        if (alongX) B((u0 + u1) / 2, c0).box('wWalk', u0, u1, 0, 0.12, c0, c1, { ...NO, uvScale: 0.2 });
        else B(c0, (u0 + u1) / 2).box('wWalk', c0, c1, 0, 0.12, u0, u1, { ...NO, uvScale: 0.2 });
      }
    };
    for (const [c0, c1] of cut) {
      walkPiece(t, Math.min(c0, t1));
      t = Math.max(t, c1);
    }
    walkPiece(t, t1);
    // Orta kesik çizgi + park şeridi çizgisi (meydanlarda yok)
    for (const p of sample(r.pts, 6, 2)) {
      if (plazaNear(p.x, p.z, 1)) continue;
      const g = new THREE.PlaneGeometry(alongX ? 3 : 0.15, alongX ? 0.15 : 3);
      g.rotateX(-Math.PI / 2).translate(p.x + (alongX ? 1.5 : 0), 0.047, p.z + (alongX ? 0 : 1.5));
      B(p.x, p.z).add('wPaint', g, NO);
    }
    for (const side of [-1, 1]) {
      const off = side * (LANES.urban[0] + 1.75);
      for (const p of sample(r.pts, 20, 5)) {
        if (plazaNear(p.x, p.z, 1)) continue;
        const g = new THREE.PlaneGeometry(alongX ? 20 : 0.12, alongX ? 0.12 : 20);
        g.rotateX(-Math.PI / 2).translate(p.x + (alongX ? 10 : off), 0.047, p.z + (alongX ? off : 10));
        B(p.x, p.z).add('wPaint', g, NO);
      }
    }
    // Sokak lambaları (kaldırımda, iki yanda 35 m'de bir)
    for (const [i, p] of sample(r.pts, 35, 12).entries()) {
      if (plazaNear(p.x, p.z, 4)) continue;
      const side = i % 2 ? 1 : -1;
      const x = alongX ? p.x : p.x + side * (h + 1.5);
      const z = alongX ? p.z + side * (h + 1.5) : p.z;
      const ry = alongX ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2;
      inst('slamp', x, z, ry);
    }
  }
  // Kavşak meydanları (asfalt kare) + yaya geçitleri + durma çizgileri (ışıklı kavşaklarda)
  for (const p of PLAZAS) {
    B(p.x, p.z).floor('wAsph', p.x - p.half, p.x + p.half, p.z - p.half, p.z + p.half, 0.031, { ...NO, uvScale: 0.125 });
  }
  for (const sig of SIGNALS) {
    const node = GRAPH.nodes[sig.node];
    const pl = PLAZAS.find((q) => q.node === node.id);
    const b = B(node.x, node.z);
    for (const eid of node.edges) {
      const e = GRAPH.edges[eid];
      const d = edgeDirAt(e, node.id); // düğüme doğru
      const out = { x: -d.x, z: -d.z }; // kavşaktan kola doğru
      const rx = -out.z;
      const rz = out.x;
      const at = pl.half + 1.6;
      // Zebra: kolun tamamı boyunca enine şeritler
      for (let k = -6; k <= 6; k++) {
        const cx = node.x + out.x * at + rx * k * 1.05;
        const cz = node.z + out.z * at + rz * k * 1.05;
        const g = new THREE.PlaneGeometry(Math.abs(out.x) > 0.5 ? 2.4 : 0.55, Math.abs(out.x) > 0.5 ? 0.55 : 2.4);
        g.rotateX(-Math.PI / 2).translate(cx, 0.048, cz);
        b.add('wPaint', g, NO);
      }
      // Durma çizgisi: gelen şeridin (kolun sağı, düğüme doğru gidiş) üstünde
      const lx = -d.z;
      const lz = d.x; // gidişin sağı
      const sx = node.x + out.x * (at + 2.2) + lx * 3.5;
      const sz = node.z + out.z * (at + 2.2) + lz * 3.5;
      const g = new THREE.PlaneGeometry(Math.abs(out.x) > 0.5 ? 0.45 : 6.8, Math.abs(out.x) > 0.5 ? 6.8 : 0.45);
      g.rotateX(-Math.PI / 2).translate(sx, 0.049, sz);
      b.add('wPaint', g, NO);
      // Işık direği: gelen şeridin sağ köşesinde, gelen trafiğe bakar
      const axis = signalAxis(d);
      const px = node.x + out.x * (pl.half + 0.5) + lx * (HWY.urbanHalf + 1.2);
      const pz = node.z + out.z * (pl.half + 0.5) + lz * (HWY.urbanHalf + 1.2);
      b.box('wDark', px - 0.12, px + 0.12, 0, 4.2, pz - 0.12, pz + 0.12, NO);
      const face = Math.atan2(out.x, out.z); // kafa gelen sürücüye bakar
      const head = new THREE.BoxGeometry(0.42, 1.25, 0.32).rotateY(face).translate(px, 4.7, pz);
      b.add('wDark', head, NO);
      const keys = axis === 'ns' ? ['sigNsR', 'sigNsY', 'sigNsG'] : ['sigEwR', 'sigEwY', 'sigEwG'];
      keys.forEach((key, j) => {
        const lamp = new THREE.CircleGeometry(0.14, 12).rotateY(face).translate(px + out.x * 0.17, 5.1 - j * 0.38, pz + out.z * 0.17);
        b.add(key, lamp, NO);
      });
    }
  }

  // ---- Bariyerler, otoyol lambaları (InstancedMesh, hücre başına) ----
  for (const r of ROADS) {
    if (r.kind === 'urban') continue;
    for (const p of sample(r.pts, 4)) {
      for (const side of [-1, 1]) {
        const x = p.x - p.uz * (r.half + 0.4) * side;
        const z = p.z + p.ux * (r.half + 0.4) * side;
        if (nearOtherRoad(x, z, r.id, 3)) continue;
        inst('rail', x, z, Math.atan2(p.ux, p.uz));
      }
    }
    if (r.kind !== 'trunk') continue;
    sample(r.pts, 48, 20).forEach((p, i) => {
      const side = i % 2 ? 1 : -1;
      const x = p.x - p.uz * (r.half + 1.4) * side;
      const z = p.z + p.ux * (r.half + 1.4) * side;
      if (nearOtherRoad(x, z, r.id, 3)) return;
      inst('lamp', x, z, Math.atan2(p.ux, p.uz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2));
    });
  }

  // ---- Nieuw-Zuid binaları (blok kenarları sokağa bakar) ----
  const rnd = rng(5150);
  const NZ = NIEUW_ZUID;
  const facades = ['wFacadeA', 'wFacadeB', 'wFacadeC'];
  const footprintFree = (x0, x1, z0, z1, pad = 2.5) => {
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2], [(x0 + x1) / 2, z0], [(x0 + x1) / 2, z1], [x0, (z0 + z1) / 2], [x1, (z0 + z1) / 2]]) {
      if (isDrivable(x, z, pad)) return false;
    }
    return !SITES.some((s) => x1 > s.bounds.minX - 6 && x0 < s.bounds.maxX + 6 && z1 > s.bounds.minZ - 6 && z0 < s.bounds.maxZ + 6);
  };
  const building = (x0, x1, z0, z1, hgt, key) => {
    if (!footprintFree(x0, x1, z0, z1)) return;
    const b = B((x0 + x1) / 2, (z0 + z1) / 2);
    b.box(key, x0, x1, 0, hgt, z0, z1, { ...NO, uvScale: 1 / 6 });
    b.box('wRoof', x0 - 0.3, x1 + 0.3, hgt, hgt + 0.5, z0 - 0.3, z1 + 0.3, NO);
  };
  /** Bir sokak kenarı boyunca bina sırası: yön (x ya da z), sokak çizgisi c, kenar başlangıcı / sonu, taraf (±1) */
  const row = (alongX, c, from, to, side) => {
    const set = 10; // sokak ortasından cepheye
    const depth = 14 + rnd() * 6;
    let t = from;
    while (t < to - 8) {
      const w = Math.min(to - t, 12 + rnd() * 14);
      const hgt = 9 + Math.floor(rnd() * 6) * 3;
      const key = facades[Math.floor(rnd() * facades.length)];
      const f0 = c + side * set;
      const f1 = c + side * (set + depth);
      if (alongX) building(t, t + w - 1.2, Math.min(f0, f1), Math.max(f0, f1), hgt, key);
      else building(Math.min(f0, f1), Math.max(f0, f1), t, t + w - 1.2, hgt, key);
      t += w + (rnd() < 0.15 ? 8 : 0);
    }
  };
  const gap = HWY.urbanHalf + 8; // köşelerde meydan + yaya payı
  for (const z of NZ.zs) for (let i = 0; i < NZ.xs.length - 1; i++) for (const side of [-1, 1]) row(true, z, NZ.xs[i] + gap, NZ.xs[i + 1] - gap, side);
  for (const x of NZ.xs) for (let i = 0; i < NZ.zs.length - 1; i++) for (const side of [-1, 1]) row(false, x, NZ.zs[i] + gap, NZ.zs[i + 1] - gap, side);
  // Sanayi: Industrieweg boyunca depolar
  for (let x = INDUSTRY.from[0] + 60; x < INDUSTRY.to[0] - 80; x += 70 + rnd() * 40) {
    for (const side of [-1, 1]) {
      const z0 = INDUSTRY.from[1] + side * 18;
      const z1 = INDUSTRY.from[1] + side * (18 + 24 + rnd() * 16);
      const w = 36 + rnd() * 22;
      if (!footprintFree(x, x + w, Math.min(z0, z1), Math.max(z0, z1))) continue;
      const b = B(x + w / 2, z0);
      b.box('wShed', x, x + w, 0, 8 + rnd() * 5, Math.min(z0, z1), Math.max(z0, z1), { ...NO, uvScale: 0.25 });
    }
  }

  // ---- Ağaçlar, lale tarlaları, yel değirmenleri (yolların çevresinde) ----
  const r = rng(4242);
  const fields = [];
  const inField = (x, z) => fields.some(([fx, fz, w, h]) => Math.abs(x - fx) < w / 2 + 4 && Math.abs(z - fz) < h / 2 + 4);
  const inTown = (x, z, pad = 40) => x > NZ.bounds.minX - pad && x < NZ.bounds.maxX + pad && z > NZ.bounds.minZ - pad && z < NZ.bounds.maxZ + pad;
  const inIndustry = (x, z) => x > INDUSTRY.from[0] - 20 && x < INDUSTRY.to[0] + 60 && Math.abs(z - INDUSTRY.from[1]) < 80;
  const clear = (x, z, pad) => !isDrivable(x, z, pad) && !yardAt(x, z, pad + 2) && !inTown(x, z) && !inIndustry(x, z) && !inField(x, z) && x < port.bounds.minX - 20
    && !SITES.some((s) => x > s.bounds.minX - 25 && x < s.bounds.maxX + 25 && z > s.bounds.minZ - 25 && z < s.bounds.maxZ + 25);
  // Tarlalar: otoyol boyunca seyrek
  for (const road of [ROAD_BY_ID.trunk, ROAD_BY_ID.a4]) {
    for (const p of sample(road.pts, 420, 150)) {
      const side = r() < 0.5 ? -1 : 1;
      const off = 70 + r() * 60;
      const fx = p.x - p.uz * off * side;
      const fz = p.z + p.ux * off * side;
      const w = 90 + r() * 70;
      const h = 50 + r() * 40;
      if (!clear(fx, fz, w / 2 + 6) || !clear(fx - w / 2, fz - h / 2, 6) || !clear(fx + w / 2, fz + h / 2, 6)) continue;
      fields.push([fx, fz, w, h]);
      B(fx, fz).floor('wTulip', fx - w / 2, fx + w / 2, fz - h / 2, fz + h / 2, 0.025, { ...NO, uvScale: 0.05 });
      if (r() < 0.45) {
        const mx = fx + w / 2 + 12;
        const mz = fz;
        const b = B(mx, mz);
        b.add('wWhite', new THREE.CylinderGeometry(2.2, 3.4, 13, 8), { position: [mx, 6.5, mz], ...NO });
        b.add('wRoof', new THREE.ConeGeometry(2.6, 3, 8), { position: [mx, 14.5, mz], ...NO });
        for (let k = 0; k < 4; k++) b.add('wWood', new THREE.BoxGeometry(0.6, 11, 0.12), { position: [mx, 12, mz - 3.2], rotation: [0, 0, (k * Math.PI) / 2 + 0.35], ...NO });
      }
    }
  }
  for (const road of ROADS) {
    if (road.kind === 'urban') continue;
    for (const p of sample(road.pts, 22, 7)) {
      for (let k = 0; k < 2; k++) {
        const side = r() < 0.5 ? -1 : 1;
        const off = road.half + 14 + r() * 110;
        const x = p.x - p.uz * off * side + (r() - 0.5) * 12;
        const z = p.z + p.ux * off * side + (r() - 0.5) * 12;
        if (!clear(x, z, 7)) continue;
        inst('tree', x, z, r() * 6, 0.75 + r() * 0.6, 0);
      }
    }
  }
  // Nieuw-Zuid avluları: blok içlerinde birkaç ağaç
  for (let i = 0; i < NZ.xs.length - 1; i++) {
    for (let j = 0; j < NZ.zs.length - 1; j++) {
      const cx = (NZ.xs[i] + NZ.xs[i + 1]) / 2;
      const cz = (NZ.zs[j] + NZ.zs[j + 1]) / 2;
      for (let k = 0; k < 18; k++) inst('tree', cx + (r() - 0.5) * 300, cz + (r() - 0.5) * 300, r() * 6, 0.7 + r() * 0.5, 0);
    }
  }

  // ---- Otelin lojistik avlusu ----
  const Y = SERVICE_YARD.bounds;
  const yb = B((Y.minX + Y.maxX) / 2, 0);
  const fence = (b, x0, x1, z0, z1) => {
    b.box('wDark', x0, x1, 0, 2.2, z0, z1, NO);
    collision.add(x0, x1, z0, z1);
  };
  const P = SERVICE_YARD.portal;
  for (const y of YARDS) B((y.bounds.minX + y.bounds.maxX) / 2, (y.bounds.minZ + y.bounds.maxZ) / 2).floor('wConc', y.bounds.minX, y.bounds.maxX, y.bounds.minZ, y.bounds.maxZ, 0.035, { ...NO, uvScale: 0.12 });
  yb.box('wBrick', Y.minX, Y.maxX, 0, 9, Y.maxZ, Y.maxZ + 1.2, NO);
  collision.add(Y.minX, Y.maxX, Y.maxZ - 0.2, Y.maxZ + 1.2);
  for (let x = Y.minX + 6; x < Y.maxX - 4; x += 8) {
    yb.box('wDoor', x - 1.6, x + 1.6, 1.2, 4.6, Y.maxZ - 0.04, Y.maxZ, NO);
    for (let k = 0; k < 2; k++) yb.box('wLamp', x - 1.5, x + 1.5, 6 + k * 1.4, 6.9 + k * 1.4, Y.maxZ - 0.05, Y.maxZ - 0.02, NO);
  }
  yb.box('wConc', HOTEL_DELIVERY.zone.minX - 2, HOTEL_DELIVERY.zone.maxX + 2, 0, 1.2, HOTEL_DELIVERY.dockZ, Y.maxZ, NO);
  collision.add(HOTEL_DELIVERY.zone.minX - 2, HOTEL_DELIVERY.zone.maxX + 2, HOTEL_DELIVERY.dockZ, Y.maxZ);
  const frameRect = (b, Dz) => {
    for (const [x0, x1, z0, z1] of [[Dz.minX, Dz.maxX, Dz.minZ, Dz.minZ + 0.3], [Dz.minX, Dz.maxX, Dz.maxZ - 0.3, Dz.maxZ], [Dz.minX, Dz.minX + 0.3, Dz.minZ, Dz.maxZ], [Dz.maxX - 0.3, Dz.maxX, Dz.minZ, Dz.maxZ]]) {
      b.floor('wYellow', x0, x1, z0, z1, 0.05, NO);
    }
  };
  frameRect(yb, HOTEL_DELIVERY.zone);
  fence(yb, Y.minX, Y.maxX, Y.minZ - 0.6, Y.minZ);
  fence(yb, Y.minX - 0.6, Y.minX, Y.minZ, P.minZ);
  fence(yb, Y.minX - 0.6, Y.minX, P.maxZ, Y.maxZ);
  fence(yb, Y.maxX, Y.maxX + 0.6, Y.minZ, -HWY.trunkHalf);
  fence(yb, Y.maxX, Y.maxX + 0.6, HWY.trunkHalf, Y.maxZ);
  yb.box('wConc', Y.minX - 3, Y.minX, 0, 6, P.minZ - 1.2, P.minZ, NO);
  yb.box('wConc', Y.minX - 3, Y.minX, 0, 6, P.maxZ, P.maxZ + 1.2, NO);
  yb.box('wConc', Y.minX - 3, Y.minX, 5, 6.5, P.minZ - 1.2, P.maxZ + 1.2, NO);
  yb.box('wDark', Y.minX - 3, Y.minX - 2.9, 0, 5, P.minZ, P.maxZ, NO);
  for (const t of SERVICE_YARD.truckBays) {
    for (const sx of [-1, 1]) yb.floor('wPaint', t.x + sx * 1.9 - 0.08, t.x + sx * 1.9 + 0.08, t.z - 7, t.z + 7, 0.05, NO);
  }
  const K = SERVICE_YARD.dealer;
  yb.box('wWhite', K.x - 5, K.x + 5, 0, 3.6, Y.minZ + 0.2, K.z, NO);
  yb.box('wOrange', K.x - 5.2, K.x + 5.2, 3.6, 4.1, Y.minZ, K.z + 0.4, NO);
  yb.box('wDoor', K.x - 1, K.x + 1, 0, 2.3, K.z, K.z + 0.04, NO);
  collision.add(K.x - 5, K.x + 5, Y.minZ, K.z);

  // ---- Depolar + liman ----
  for (const s of SITES) {
    if (s.id === 'port') continue;
    const sb = s.bounds;
    const b = B((sb.minX + sb.maxX) / 2, (sb.minZ + sb.maxZ) / 2);
    const far = s.gate[1] < s.dock.z; // giriş kuzeyde → bina güneyde
    const bz0 = far ? s.dock.z : sb.minZ;
    const bz1 = far ? sb.maxZ : s.dock.z;
    b.box('wShed', sb.minX + 2, sb.maxX - 2, 0, 11, bz0, bz1, { ...NO, uvScale: 0.25 });
    b.box('wRoof', sb.minX + 1.5, sb.maxX - 1.5, 11, 11.6, bz0 - 0.5, bz1 + 0.5, NO);
    collision.add(sb.minX + 2, sb.maxX - 2, bz0, bz1);
    const faceZ = far ? bz0 : bz1;
    for (let x = sb.minX + 7; x < sb.maxX - 5; x += 9) b.box('wDoor', x - 2, x + 2, 0.4, 5, faceZ - 0.05, faceZ + 0.05, NO);
    frameRect(b, s.load);
    const gx = s.gate[0];
    const fz = far ? sb.minZ : sb.maxZ;
    fence(b, sb.minX, gx - 7, fz - 0.3, fz + 0.3);
    fence(b, gx + 7, sb.maxX, fz - 0.3, fz + 0.3);
    fence(b, sb.minX - 0.6, sb.minX, sb.minZ, sb.maxZ);
    fence(b, sb.maxX, sb.maxX + 0.6, sb.minZ, sb.maxZ);
  }
  const pb = port.bounds;
  const pbB = B(pb.minX + 40, 0);
  const cr = rng(31);
  for (let gx = pb.minX + 22; gx < pb.maxX - 18; gx += 7) {
    for (const zr of [[-100, -60], [40, 100]]) {
      for (let z = zr[0]; z < zr[1]; z += 13) {
        const h = 1 + Math.floor(cr() * 3);
        for (let k = 0; k < h; k++) inst('cont', gx, z, 0, 1, k, cr());
      }
    }
  }
  for (const [x0, x1, z0, z1] of [[pb.minX + 18, pb.maxX - 14, -104, -54], [pb.minX + 18, pb.maxX - 14, 34, 104]]) collision.add(x0, x1, z0, z1);
  for (const z of [-30, 30]) {
    for (const sx of [-1, 1]) {
      pbB.box('wOrange', pb.maxX - 6 + sx * 7 - 0.6, pb.maxX - 6 + sx * 7 + 0.6, 0, 26, z - 0.6, z + 0.6, NO);
      collision.add(pb.maxX - 6 + sx * 7 - 0.6, pb.maxX - 6 + sx * 7 + 0.6, z - 0.6, z + 0.6);
    }
    pbB.box('wOrange', pb.maxX - 16, pb.maxX + 40, 25, 27.5, z - 1.2, z + 1.2, NO);
  }
  pbB.box('wConc', pb.maxX, pb.maxX + 4, -0.2, 0.6, pb.minZ, pb.maxZ, NO);
  collision.add(pb.maxX - 0.2, pb.maxX + 0.6, pb.minZ, pb.maxZ);
  pbB.box('wRed', pb.maxX + 14, pb.maxX + 34, -1, 6, -70, 60, NO);
  pbB.box('wWhite', pb.maxX + 16, pb.maxX + 32, 6, 14, 40, 56, NO);
  fence(pbB, pb.minX, pb.maxX, pb.minZ - 0.6, pb.minZ);
  fence(pbB, pb.minX, pb.maxX, pb.maxZ, pb.maxZ + 0.6);
  fence(pbB, pb.minX - 0.6, pb.minX, pb.minZ, -HWY.trunkHalf);
  fence(pbB, pb.minX - 0.6, pb.minX, HWY.trunkHalf, pb.maxZ);

  // ---- Hücreleri kur: statikler + örnek (instanced) nesneler ----
  const G = {
    rail: new THREE.BoxGeometry(0.08, 0.32, 4.05).translate(0, 0.62, 0),
    post: new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(0, 0.375, 0),
    pole: new THREE.CylinderGeometry(0.09, 0.12, 9, 6).translate(0, 4.5, 0),
    arm: new THREE.BoxGeometry(0.12, 0.12, 2.6).translate(0, 8.9, 1.2),
    head: new THREE.BoxGeometry(0.5, 0.14, 0.9).translate(0, 8.8, 2.4),
    spole: new THREE.CylinderGeometry(0.07, 0.09, 6, 6).translate(0, 3, 0),
    sarm: new THREE.BoxGeometry(0.1, 0.1, 1.6).translate(0, 5.9, 0.7),
    shead: new THREE.BoxGeometry(0.4, 0.12, 0.6).translate(0, 5.85, 1.4),
    trunkT: new THREE.CylinderGeometry(0.18, 0.25, 2.6, 5).translate(0, 1.3, 0),
    crown: new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.9, 0),
    cont: new THREE.BoxGeometry(2.44, 2.59, 12.2).translate(0, 1.3, 0),
  };
  const palette = [0xc3202f, 0x24508f, 0x1f5d43, 0xf07b16, 0x8a8f96, 0xf2c230, 0x5b3a8c];
  const col = new THREE.Color();
  const instanced = (c, list, geo, mat, fn) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => fn(m, i, it));
    m.matrixAutoUpdate = false;
    m.computeBoundingSphere();
    c.group.add(m);
    return m;
  };
  let instances = 0;
  for (const c of chunks.values()) {
    c.b.build(M, c.group);
    const I = c.inst;
    if (I.rail) {
      instanced(c, I.rail, G.rail, M.wRail, (m, i, [x, z, ry]) => setInstance(m, i, x, 0, z, ry));
      instanced(c, I.rail, G.post, M.wPost, (m, i, [x, z, ry]) => setInstance(m, i, x, 0, z, ry));
    }
    if (I.lamp) {
      instanced(c, I.lamp, G.pole, M.wPost, (m, i, [x, z, ry]) => setInstance(m, i, x, 0, z, ry));
      instanced(c, I.lamp, G.arm, M.wPost, (m, i, [x, z, ry]) => setInstance(m, i, x, 0, z, ry));
      instanced(c, I.lamp, G.head, M.wLamp, (m, i, [x, z, ry]) => setInstance(m, i, x, 0, z, ry));
    }
    if (I.slamp) {
      instanced(c, I.slamp, G.spole, M.wPost, (m, i, [x, z, ry]) => setInstance(m, i, x, 0, z, ry));
      instanced(c, I.slamp, G.sarm, M.wPost, (m, i, [x, z, ry]) => setInstance(m, i, x, 0, z, ry));
      instanced(c, I.slamp, G.shead, M.wLamp, (m, i, [x, z, ry]) => setInstance(m, i, x, 0, z, ry));
    }
    if (I.tree) {
      instanced(c, I.tree, G.trunkT, M.wWood, (m, i, [x, z, , s]) => setInstance(m, i, x, 0, z, 0, s, s, s));
      instanced(c, I.tree, G.crown, M.wCrown, (m, i, [x, z, ry, s]) => setInstance(m, i, x, 0, z, ry, s, s * (0.9 + (i % 5) * 0.06), s));
    }
    if (I.cont) {
      instanced(c, I.cont, G.cont, M.wCont, (m, i, [x, z, , , k, cc]) => {
        setInstance(m, i, x, k * 2.6, z, 0);
        m.setColorAt(i, col.setHex(palette[Math.floor(cc * palette.length)]));
      });
    }
    for (const list of Object.values(I)) instances += list.length;
    group.add(c.group);
  }

  // ---- Tabelalar ----
  const signs = [];
  const sign = (lines, w, h, x, y, z, facing, opts = {}) => {
    const m = panel(signMaterial(lines, { w: 512, h: Math.round((512 * h) / w), ...opts }), w, h, x, y, z, facing);
    chunkAt(x, z).group.add(m);
    signs.push(m);
  };
  sign(['🏨 Hotel De Tulp — Mal Kabul', 'Teslim körfezi · Lojistik avlusu'], 14, 2.6, HOTEL_DELIVERY.x, 7.8, Y.maxZ - 0.06, 'z-', { bg: '#1f5d43' });
  sign(['🚛 TruckCenter', 'Tır satış · Zeeland · Brabant · Noordkaap'], 9, 1.7, K.x, 4.9, K.z + 0.45, 'z+', { bg: '#f07b16', fg: '#1b1e22' });
  sign(['🏙️ Şehir / Otel', 'Tünel ⇠'], 6, 1.6, Y.minX + 0.05, 7.3, 0, 'x+', { bg: '#24508f' });
  sign(['A10 Ring ⇢', 'A4 Noord · Nieuw-Zuid · Haven Zuid'], 12, 2.2, Y.maxX - 2, 6.5, -HWY.trunkHalf - 1.5, 'x-', { bg: '#1f5d43' });
  for (const s of SITES) {
    const [gx, gz] = s.gate;
    const facing = s.id === 'port' ? 'x-' : s.gate[1] < s.dock.z ? 'z-' : 'z+';
    sign([`${s.icon} ${s.short}`, s.name], 10, 2.2, gx + (s.id === 'port' ? 0 : 10), 5.5, gz + (s.id === 'port' ? -14 : s.gate[1] < s.dock.z ? -0.6 : 0.6), facing, { bg: '#24508f' });
  }
  // Otoyol köprü tabelaları: ayrımlardan ~250 m önce, iki yönde (gidiş yönüne bakar)
  const gantry = (roadId, sAt, dir, lines, sideRight) => {
    const p = roadPoint(roadId, sAt - dir * 250);
    const ux = p.ux * dir;
    const uz = p.uz * dir;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(-ux, -uz);
    const gm = M.wPost;
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7, 0.3), gm);
      leg.position.set(sx * (HWY.trunkHalf + 1), 3.5, 0);
      g.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(HWY.trunkHalf * 2 + 2.4, 0.4, 0.4), gm);
    beam.position.y = 7;
    g.add(beam);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), signMaterial(lines, { bg: '#1f5d43', w: 512, h: 154 }));
    // Gidiş yönünün sağı (−z'ye bakan grup yerelinde +x)
    face.position.set(HWY.trunkHalf * 0.45 * (sideRight ? 1 : -1), 6.2, 0.25);
    g.add(face);
    g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    chunkAt(p.x, p.z).group.add(g);
  };
  const trunk = ROAD_BY_ID.trunk;
  const sOnTrunk = (pt) => {
    let best = 0;
    let bd = Infinity;
    for (let s = 0; s < roadLength('trunk'); s += 5) {
      const q = roadPoint('trunk', s);
      const d = Math.hypot(q.x - pt[0], q.z - pt[1]);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  const sA4 = sOnTrunk(ROAD_BY_ID.a4.pts[0]);
  const sNZ = sOnTrunk(ROAD_BY_ID['spur-nz'].pts[0]);
  gantry('trunk', sA4, 1, ['↖ A4 Noord', '🧃 FrisDepot · Industrieweg · 250 m'], false);
  gantry('trunk', sA4, -1, ['A4 Noord ↗', '🧃 FrisDepot · Industrieweg · 250 m'], true);
  gantry('trunk', sNZ, 1, ['Nieuw-Zuid ↘', '🥩 VersMarkt · 🎳 ArcadeWorks · 250 m'], true);
  gantry('trunk', sNZ, -1, ['↙ Nieuw-Zuid', '🥩 VersMarkt · 🎳 ArcadeWorks · 250 m'], false);
  gantry('trunk', roadLength('trunk') - 120, 1, ['⚓ Haven Zuid', 'Konteyner limanı · 250 m'], true);
  gantry('trunk', 200, -1, ['🏨 Hotel De Tulp', 'Lojistik avlusu · tünel ⇠ şehir'], true);
  // Hız tabelaları (yolun sağı, gidiş yönüne bakar)
  const speedSign = (roadId, s, dir, kmh) => {
    const p = roadPoint(roadId, s);
    const road = ROAD_BY_ID[roadId];
    const ux = p.ux * dir;
    const uz = p.uz * dir;
    const x = p.x - uz * (road.half + 1.2);
    const z = p.z + ux * (road.half + 1.2);
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), speedMats[kmh]);
    m.position.set(x, 2.4, z);
    m.rotation.y = Math.atan2(-ux, -uz); // gelen sürücüye bakar
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    chunkAt(x, z).group.add(m);
  };
  const speedMats = Object.fromEntries([ROAD_KMH.trunk, ROAD_KMH.spur, ROAD_KMH.urban].map((k) => [k, signMaterial([String(k)], { bg: '#ffffff', fg: '#111111', w: 128, h: 128, border: true })]));
  for (const rd of ROADS) {
    const L = roadLength(rd.id);
    if (L < 120) continue;
    const step = rd.kind === 'trunk' ? 1600 : 500;
    for (let s = 60; s < L - 60; s += step) for (const dir of [1, -1]) speedSign(rd.id, dir > 0 ? s : L - s, dir, rd.kmh);
  }
  // Semt tabelaları + sokak adları (ışıklı kavşaklarda)
  const nzIn = ROAD_BY_ID['spur-nz'].pts[ROAD_BY_ID['spur-nz'].pts.length - 8];
  sign(['🏙️ Nieuw-Zuid', 'Hız sınırı 50 · trafik ışıkları'], 7, 1.8, nzIn[0] + 14, 3.6, nzIn[1], 'x-', { bg: '#24508f' });
  sign(['🏭 Industrieweg', 'FrisDepot ⇢ 1,5 km'], 7, 1.8, INDUSTRY.from[0] + 20, 3.6, INDUSTRY.from[1] + 12, 'z-', { bg: '#24508f' });
  for (const sig of SIGNALS) {
    const node = GRAPH.nodes[sig.node];
    const names = [...new Set(node.edges.map((id) => ROAD_BY_ID[GRAPH.edges[id].road]).filter((rd) => rd.kind === 'urban').map((rd) => rd.name))];
    if (!names.length) continue;
    sign([`${names.join(' × ')}`], 6.5, 0.9, node.x + HWY.urbanHalf + 6, 4.4, node.z - HWY.urbanHalf - 6, 'z+', { bg: '#1d3f8f' });
  }
  group.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.matrixAutoUpdate) {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    }
  });

  // ---- Görünürlük (hücreler) + trafik ışıkları ----
  let vx = NaN;
  let vz = NaN;
  const list = [...chunks.values()];
  const setView = (x, z, force = false) => {
    if (!force && Math.abs(x - vx) < 40 && Math.abs(z - vz) < 40) return false;
    vx = x;
    vz = z;
    let changed = false;
    for (const c of list) {
      const x0 = c.cx * CHUNK;
      const z0 = c.cz * CHUNK;
      const dx = Math.max(x0 - x, 0, x - (x0 + CHUNK));
      const dz = Math.max(z0 - z, 0, z - (z0 + CHUNK));
      const vis = dx * dx + dz * dz < VIEW * VIEW;
      if (c.group.visible !== vis) {
        c.group.visible = vis;
        changed = true;
      }
    }
    return changed;
  };
  let sigKey = '';
  const updateSignals = (tSec) => {
    if (!SIGNALS.length) return false;
    const sg = SIGNALS[0]; // bütün kavşaklar aynı fazda
    const ns = signalState(sg, 'ns', tSec);
    const ew = signalState(sg, 'ew', tSec);
    const key = ns + ew;
    if (key === sigKey) return false;
    sigKey = key;
    const put = (prefix, st) => {
      M[`${prefix}R`].color.setHex(LIT.R[st === 'r' ? 0 : 1]);
      M[`${prefix}Y`].color.setHex(LIT.Y[st === 'y' ? 0 : 1]);
      M[`${prefix}G`].color.setHex(LIT.G[st === 'g' ? 0 : 1]);
    };
    put('sigNs', ns);
    put('sigEw', ew);
    return true;
  };
  updateSignals(0);
  return { group, mats: M, chunks, setView, updateSignals, stats: { chunks: chunks.size, instances, signs: signs.length } };
}

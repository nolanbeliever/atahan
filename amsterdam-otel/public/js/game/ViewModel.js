import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOOD_BY_ID } from '/shared/constants.js';

// Birinci şahıs eller + elde tutulan nesne (bardak, kirli bardak yığını, yiyecek, çöp).
//
// Yöntem: kamera sahneye eklenir, vm kökü kameraya bağlanır ve 0.35 ölçeğiyle
// "küçültülür": modeller ~0.4 m önde modellenir ama gerçekte ~0.14 m öndedir.
// Açısal boyut aynı kaldığından ekranda normal görünür, oyuncu yarıçapı (0.3 m)
// içinde kaldığı için duvara/tezgâha gömülmez. Ayrı bir render geçişi yok; trip
// shader'ı da aynı sahneyi çizdiği için ellere uygulanır.
//
// Pil: animasyonlar zaman tabanlı (performance.now); yalnızca animasyon / yürüme
// sallantısı sürerken update() true döner. Elde nesne tutulurken boşta hiçbir
// şey kıpırdamaz → motor uyuyabilir. Parça başına tek draw call (köşe rengi +
// mergeGeometries, FurnitureModels kalıbı); gölge yok, frustumCulled = false.

const VIEW_SCALE = 0.35; // küçültme hilesi
const DEPTH = 0.4; // sanal derinlik (kök biriminde)
const MOUTH_DEPTH = 0.3; // ısırırken yiyecek daha yakına gelir
const HIDE_Y = -0.36; // ekranın altına (görüş dışına) iniş
const MAX_PARTICLES = 48;

const SKIN = '#eab48e';
const CUFF = '#ec7a2c'; // otel görevlisi turuncusu
const TRIM = '#fff1df';
const GLASS = '#e4f5ff';
const DIRTY_TINT = 0xd9cba6;
const CLEAN_TINT = 0xffffff;
const METAL = '#c4cad2';

const TRASH_ITEMS = Object.freeze(['paper', 'can', 'box', 'bottle']);
const FOOD_YAW = -Math.PI / 2; // dinlenirken ısırılan uç ekran ortasına (sola) bakar
const FOOD_TILT = 0.45; // üst yüz biraz kameraya dönük
const CRUMB_COLORS = Object.freeze({
  brownie: Object.freeze([0x3d2213, 0x5b3520, 0x2b160b]),
  stroopwafel: Object.freeze([0xd59a52, 0xb47833, 0x8a4512]),
});

// ---- Zaman eğrileri -------------------------------------------------------------

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (k, a, b) => clamp01((k - a) / (b - a));
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const back = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2; // hafif taşmalı varış
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

/** Anahtar kareler: [[k, [x,y,z,rx,ry,rz], easing?], ...] → aradeğer (out dizisine) */
function track(k, keys, out) {
  let i = 0;
  while (i < keys.length - 1 && k >= keys[i + 1][0]) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const e = a === b ? 0 : (b[2] || inOut)(seg(k, a[0], b[0]));
  for (let j = 0; j < 6; j++) out[j] = lerp(a[1][j], b[1][j], e);
  return out;
}

const P = (p, r) => [p[0], p[1], p[2], r[0], r[1], r[2]];
const add = (p, x, y, z) => [p[0] + x, p[1] + y, p[2] + z];

// ---- Geometri yardımcıları (köşe rengi) ------------------------------------------

const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

function colored(geo, hex, shade = 1) {
  _c.set(hex);
  const r = Math.min(1, _c.r * shade);
  const g = Math.min(1, _c.g * shade);
  const b = Math.min(1, _c.b * shade);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** İndeksli/indekssiz karışık parçaları tek geometride birleştirir */
function merge(list) {
  const flat = list.map((g) => {
    if (!g.index) return g;
    const f = g.toNonIndexed();
    g.dispose();
    return f;
  });
  for (const g of flat) g.clearGroups();
  const m = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  return m;
}

const box = (w, h, d, x, y, z, hex, shade) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex, shade);
const cyl = (rt, rb, h, x, y, z, hex, seg = 14, shade = 1, open = false) => colored(
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y, z), hex, shade,
);
const ball = (r, x, y, z, hex, s = [1, 1, 1], shade = 1) => colored(
  new THREE.SphereGeometry(r, 12, 9).scale(s[0], s[1], s[2]).translate(x, y, z), hex, shade,
);

/** from noktasından dir yönünde uzanan (koni olabilen) silindir */
function limb(r0, r1, len, from, dir, hex, shade = 1, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg).translate(0, len / 2, 0);
  _v.set(dir[0], dir[1], dir[2]).normalize();
  g.applyQuaternion(_q.setFromUnitVectors(UP, _v));
  g.translate(from[0], from[1], from[2]);
  return colored(g, hex, shade);
}

/** X ekseni boyunca yatan kapsül (parmak), Y çevresinde döndürülmüş */
function finger(r, len, x, y, z, yaw, hex, pitch = 0) {
  const g = new THREE.CapsuleGeometry(r, len, 3, 8).rotateZ(Math.PI / 2);
  if (pitch) g.rotateZ(pitch);
  g.rotateY(yaw).translate(x, y, z);
  return colored(g, hex);
}

/**
 * Stilize el: kavrama noktası (tutulan nesnenin merkezi) orijinde.
 * s = +1 sağ el (avuç nesnenin sağında, -X'e bakar), s = -1 sol el (ayna).
 * Parmaklar nesnenin arkasından, başparmak önünden sarar; bilekte turuncu manşet.
 */
function buildHand(s) {
  const parts = [
    ball(1, s * 0.056, -0.004, 0.004, SKIN, [0.021, 0.043, 0.036]), // avuç / el sırtı
    ball(1, s * 0.05, 0.03, -0.01, SKIN, [0.017, 0.012, 0.03], 0.97), // boğum sırası
  ];
  // Dört parmak: nesnenin uzak yüzünü sarar (uçları kameraya doğru kıvrılır)
  const fy = [0.026, 0.009, -0.008, -0.024];
  const fl = [0.046, 0.05, 0.047, 0.038];
  for (let i = 0; i < 4; i++) {
    parts.push(finger(0.0092, fl[i], s * 0.026, fy[i], -0.043, s * 0.36, SKIN, 0));
  }
  // Başparmak: üstten, kameraya yakın yüzden
  parts.push(finger(0.0098, 0.034, s * 0.026, 0.03, 0.033, s * 0.5, SKIN, s * -0.15));
  // Bilek → manşet → kol (ekranın altına doğru iner)
  const dir = [s * 0.32, -0.72, 0.62];
  const wrist = [s * 0.06, -0.036, 0.014];
  const d = new THREE.Vector3(...dir).normalize();
  const at = (t) => [wrist[0] + d.x * t, wrist[1] + d.y * t, wrist[2] + d.z * t];
  parts.push(
    limb(0.02, 0.021, 0.04, wrist, dir, SKIN, 0.95),
    limb(0.0262, 0.0262, 0.007, at(0.034), dir, TRIM),
    limb(0.026, 0.028, 0.032, at(0.04), dir, CUFF),
    limb(0.0285, 0.0285, 0.006, at(0.07), dir, TRIM),
    limb(0.03, 0.035, 0.22, at(0.075), dir, CUFF, 0.86),
  );
  return merge(parts);
}

// ---- Bardaklar ---------------------------------------------------------------------

const GLASS_H = 0.1;
const LIQ_MAX = 0.088;

/** Bardak kabuğu (saydam, iki yüzlü): açık silindir + taban + parlak ağız halkası */
function glassShellParts(y) {
  return [
    cyl(0.036, 0.031, GLASS_H, 0, y, 0, GLASS, 18, 1, true),
    cyl(0.031, 0.031, 0.008, 0, y - GLASS_H / 2 + 0.004, 0, GLASS, 18, 0.92),
    colored(new THREE.TorusGeometry(0.036, 0.0024, 4, 22).rotateX(Math.PI / 2).translate(0, y + GLASS_H / 2, 0), '#ffffff'),
  ];
}

/** Sıvı: taban y=0, boy 1 (scale.y ile dolum); üst yüzey biraz daha açık */
function liquidGeometry(r0 = 0.03, r1 = 0.027) {
  return merge([
    cyl(r0, r1, 1, 0, 0.5, 0, '#ffffff', 18, 0.8, true),
    colored(new THREE.CircleGeometry(r0, 18).rotateX(-Math.PI / 2).translate(0, 1, 0), '#ffffff'),
  ]);
}

/** n adet iç içe kirli bardak: kabuklar (saydam) ve lekeler (opak) ayrı geometri */
function dirtyGeometries(n) {
  const shells = [];
  const stains = [];
  for (let i = 0; i < n; i++) {
    const y = i * 0.028;
    shells.push(...glassShellParts(y));
    // Dipte kalan tortu + iç yüzeyde lekeler + kurumuş içecek halkası
    stains.push(cyl(0.029, 0.029, 0.005, 0, y - 0.042, 0, '#a57f55', 14));
    stains.push(colored(new THREE.TorusGeometry(0.032, 0.0016, 3, 18).rotateX(Math.PI / 2).translate(0, y - 0.012, 0), '#c98a77'));
    for (let j = 0; j < 3; j++) {
      const a = 0.8 + j * 2.1 + i * 1.3;
      const yy = y - 0.03 + ((j * 0.37 + i * 0.21) % 1) * 0.05;
      const r = 0.0335;
      const g = new THREE.SphereGeometry(0.009, 7, 5).scale(1, 0.7, 0.3)
        .rotateY(-a + Math.PI / 2).translate(Math.cos(a) * r, yy, Math.sin(a) * r);
      stains.push(colored(g, j % 2 ? '#b59466' : '#c7ab7d'));
    }
  }
  return { shell: merge(shells), stain: merge(stains) };
}

// ---- Yiyecekler (ısırık izi geometrisi) -----------------------------------------------

/** Şekil uzayında (x, y) çizilen dilimi yatay katman olarak çıkarır: şekil y → dünya +Z (kameraya) */
function slab(shape, h, yTop, hex, shade = 1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(Math.PI / 2).translate(0, yTop, 0);
  return colored(g, hex, shade);
}

/** Brownie: kutu dilimi; ısırılan uç kameraya bakar, her ısırıkta kısalır ve yarım ay şeklinde oyulur */
function brownieGeometry(bitesLeft, bites) {
  const W = 0.058;
  const L = 0.084;
  const H = 0.03;
  const backZ = -0.048;
  const eaten = bites - bitesLeft;
  const zf = backZ + L * (bitesLeft / bites);
  const rb = 0.024;
  const front = (x) => {
    if (!eaten) return zf;
    const s = rb * rb - x * x;
    if (s <= 0) return zf;
    const z = zf + 0.42 * rb - Math.sqrt(s);
    if (z >= zf) return zf;
    return z - 0.0017 * (1 - Math.cos((x * 2 * Math.PI) / 0.0105)) * 0.5; // diş izleri
  };
  const pts = [new THREE.Vector2(-W / 2, backZ), new THREE.Vector2(W / 2, backZ)];
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const x = W / 2 - (W * i) / N;
    pts.push(new THREE.Vector2(x, front(x)));
  }
  const shape = new THREE.Shape(pts);
  const parts = [
    slab(shape, H * 0.8, H / 2 - H * 0.2, '#4d2b17'),
    slab(shape, H * 0.2, H / 2, '#2c160a'), // çikolata kaplama
  ];
  // Pudra şekeri noktaları (yalnızca kalan kısımda)
  const dots = [[-0.016, -0.034], [0.013, -0.02], [-0.004, -0.004], [0.017, 0.012], [-0.015, 0.02], [0.006, 0.028]];
  for (const [x, z] of dots) {
    if (z < front(x) - 0.006) parts.push(box(0.006, 0.002, 0.006, x, H / 2 + 0.001, z, '#f6f0e6'));
  }
  return merge(parts);
}

/** Stroopwafel: disk; her ısırıkta bir dilim (dişli yay) eksilir — kutupsal sınır (yıldız biçimli) */
function wafelGeometry(bitesLeft, bites) {
  const R = 0.05;
  const eaten = bites - bitesLeft;
  const step = (Math.PI * 2) / bites;
  const rho = R * (0.55 + 1.05 / bites);
  const centers = [];
  for (let j = 0; j < eaten; j++) {
    const a = Math.PI / 2 + j * step;
    centers.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  const inside = (x, y) => centers.some(([cx, cy]) => {
    const dx = x - cx;
    const dy = y - cy;
    const rr = rho * (1 + 0.045 * Math.cos(16 * Math.atan2(dy, dx)));
    return dx * dx + dy * dy < rr * rr;
  });
  const N = 64;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const cx = Math.cos(th);
    const sy = Math.sin(th);
    let r = R;
    const steps = 32;
    for (let k = 1; k <= steps; k++) {
      const t = (k / steps) * R;
      if (inside(cx * t, sy * t)) {
        let lo = t - R / steps;
        let hi = t;
        for (let b = 0; b < 6; b++) {
          const mid = (lo + hi) / 2;
          if (inside(cx * mid, sy * mid)) hi = mid;
          else lo = mid;
        }
        r = Math.max(0.004, lo);
        break;
      }
    }
    pts.push(new THREE.Vector2(cx * r, sy * r));
  }
  const shape = new THREE.Shape(pts);
  const layers = [
    slab(shape, 0.0045, -0.0015, '#d9a35d'),
    slab(shape, 0.003, 0.0015, '#8a4512'), // karamel
    slab(shape, 0.0045, 0.006, '#dfaa62'),
  ];
  // Petek deseni yalnızca üst/alt yüzlerde: kapak köşelerine 45° dönük doku koordinatı
  const CELL = 0.0105;
  for (const g of layers) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nor.getY(i)) > 0.7) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        uv.setXY(i, (x + z) * 0.7071 / CELL, (x - z) * 0.7071 / CELL);
      } else {
        uv.setXY(i, 0.5, 0.5);
      }
    }
  }
  return merge(layers);
}

function makeWaffleTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#9c8f84';
  ctx.fillRect(0, 0, 32, 4);
  ctx.fillRect(0, 0, 4, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---- Şişe, çalkalayıcı, otel çöpleri ---------------------------------------------------

/** Şurup şişesi (kavrama = gövde ortası): saydam kabuk + iç sıvı + opak etiket/dökme ağzı */
function bottleGeometries() {
  return {
    shell: merge([
      cyl(0.03, 0.03, 0.1, 0, -0.005, 0, '#d8efe6', 16, 1, true),
      cyl(0.012, 0.03, 0.032, 0, 0.061, 0, '#d8efe6', 16, 1, true),
      cyl(0.012, 0.012, 0.03, 0, 0.092, 0, '#d8efe6', 12, 1, true),
      cyl(0.03, 0.03, 0.006, 0, -0.052, 0, '#cfe6dc', 16),
    ]),
    liquid: merge([
      cyl(0.027, 0.027, 0.084, 0, -0.01, 0, '#ffffff', 16, 0.85),
      cyl(0.011, 0.026, 0.02, 0, 0.042, 0, '#ffffff', 12, 0.95),
    ]),
    solid: merge([
      cyl(0.0306, 0.0306, 0.042, 0, -0.016, 0, '#f4e8cf', 16), // etiket
      cyl(0.031, 0.031, 0.007, 0, -0.016, 0, '#7a4a2a', 16), // etiket şeridi
      cyl(0.0145, 0.0145, 0.012, 0, 0.111, 0, '#30343a', 12), // tıpa
      limb(0.004, 0.0035, 0.034, [0, 0.115, 0], [0.12, 1, 0], '#b9c0c8', 1, 8), // metal dökme ağzı
    ]),
    mouth: new THREE.Vector3(0.0045, 0.148, 0),
  };
}

/** İki parçalı metal çalkalayıcı (merkez orijinde) */
function shakerGeometry() {
  return merge([
    cyl(0.04, 0.034, 0.104, 0, -0.035, 0, METAL, 18),
    cyl(0.0345, 0.0345, 0.006, 0, -0.085, 0, METAL, 18, 0.78),
    cyl(0.0415, 0.0415, 0.008, 0, 0.018, 0, METAL, 18, 0.72), // birleşim bandı
    cyl(0.029, 0.04, 0.044, 0, 0.044, 0, METAL, 18, 1.1),
    cyl(0.013, 0.017, 0.02, 0, 0.074, 0, METAL, 14, 0.85), // kapak
    cyl(0.0135, 0.0135, 0.004, 0, 0.086, 0, METAL, 14, 1.15),
    box(0.006, 0.06, 0.002, 0.026, -0.03, 0.03, '#f4f8ff'), // parlama şeridi
  ]);
}
const SHAKER_MOUTH = new THREE.Vector3(0, 0.09, 0);

function paperGeometry() {
  const g = new THREE.IcosahedronGeometry(0.032, 1);
  const pos = g.attributes.position;
  // Buruşukluk: aynı köşe her üçgende aynı oranda itilsin (konuma bağlı karma)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = Math.sin(x * 1271.1 + y * 3117.7 + z * 747.3) * 43758.5453;
    const f = 0.8 + 0.34 * (h - Math.floor(h));
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  colored(g, '#ece8dc');
  const col = g.attributes.color;
  for (let t = 0; t < pos.count; t += 3) {
    const sh = 0.82 + ((t * 7919) % 23) / 100;
    for (let j = 0; j < 3; j++) col.setXYZ(t + j, col.getX(t + j) * sh, col.getY(t + j) * sh, col.getZ(t + j) * sh);
  }
  return merge([g]);
}

function trashGeometry(item) {
  switch (item) {
    case 'can':
      return merge([
        cyl(0.022, 0.022, 0.07, 0, 0, 0, '#c8202f', 16),
        cyl(0.0225, 0.0225, 0.014, 0, 0.006, 0, '#f2f2f2', 16),
        cyl(0.019, 0.022, 0.006, 0, 0.038, 0, '#c9cdd2', 16),
        cyl(0.022, 0.019, 0.006, 0, -0.038, 0, '#c9cdd2', 16),
      ]);
    case 'box':
      return merge([
        box(0.12, 0.022, 0.12, 0, 0, 0, '#b08850'),
        box(0.121, 0.003, 0.121, 0, 0.005, 0, '#8d6a3c'),
        cyl(0.02, 0.02, 0.002, 0.02, 0.0115, -0.015, '#94683a', 12),
      ]).rotateY(0.35);
    case 'bottle':
      return merge([
        cyl(0.021, 0.021, 0.075, 0, -0.01, 0, '#7fc4d8', 14),
        cyl(0.0215, 0.0215, 0.026, 0, -0.008, 0, '#2f7fb0', 14),
        cyl(0.009, 0.021, 0.02, 0, 0.037, 0, '#7fc4d8', 12),
        cyl(0.0095, 0.0095, 0.012, 0, 0.052, 0, '#f3f3f3', 10),
      ]);
    default:
      return paperGeometry();
  }
}

// ---- Parçacıklar (kırıntı, köpük, su damlası, ışıltı) — tek InstancedMesh ----------------

class Particles {
  constructor(max) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.set(0xffffff));
    this.pool = [];
    for (let i = 0; i < max; i++) this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0, ttl: 1, size: 0.01, grow: 0, color: new THREE.Color() });
    this.n = 0;
    this.dummy = new THREE.Object3D();
  }

  spawn(x, y, z, vx, vy, vz, { ttl = 0.8, size = 0.006, hex = 0xffffff, g = -1.8, grow = 0 } = {}) {
    if (this.n >= this.pool.length) return;
    const p = this.pool[this.n++];
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.g = g; p.life = 0; p.ttl = ttl; p.size = size; p.grow = grow;
    p.color.set(hex);
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** @returns {boolean} canlı parçacık var mı */
  update(dt) {
    if (!this.n) return false;
    const d = this.dummy;
    let i = 0;
    while (i < this.n) {
      const p = this.pool[i];
      p.life += dt;
      if (p.life >= p.ttl) {
        // Sondakiyle yer değiştir (havuz sıkışık kalır)
        this.pool[i] = this.pool[this.n - 1];
        this.pool[this.n - 1] = p;
        this.n--;
        continue;
      }
      p.vy += p.g * dt;
      if (p.grow) {
        // köpük: yavaşlar
        p.vx *= 0.96;
        p.vz *= 0.96;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = p.life / p.ttl;
      const s = p.grow ? p.size * (0.4 + 0.9 * Math.sin(Math.PI * Math.min(1, k * 1.1))) : p.size * (k > 0.8 ? (1 - k) * 5 : 1);
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.life * 7, p.life * 5, 0);
      d.scale.setScalar(Math.max(0.0001, s));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      this.mesh.setColorAt(i, p.color);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return true;
  }
}

// ---- ViewModel --------------------------------------------------------------------------

function prep(mesh) {
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Birinci şahıs eller ve elde tutulan nesne.
 *  setHold(hold)              — anında (animasyon sürüyorsa animasyonun sonunda geçerli olur)
 *  play(kind, durMs, opts)    — take | pour | shake | serve | collect | wash | buy | bite | pickup
 *  cancel(hold)               — animasyonu kes, hold'a dön (sunucu reddi)
 *  update(dt) → boolean       — animasyon / sallantı sürüyorsa (ve bittiği karede) true
 */
export class ViewModel {
  constructor({ engine, settings }) {
    this.engine = engine;
    this.settings = settings || {};
    this.camera = engine.camera;
    if (this.camera.parent !== engine.scene) engine.scene.add(this.camera); // idempotent

    this.hold = null; // gösterilen kalıcı durum
    this.anim = null;
    this.fit = 1;
    this.layoutKey = '';
    this.anchors = null;
    this.bob = { amp: 0, phase: 0, x: 0, y: 0, last: new THREE.Vector3(), has: false };
    this._rp = [0, 0, 0, 0, 0, 0];
    this._lp = [0, 0, 0, 0, 0, 0];
    this._tmp = [0, 0, 0, 0, 0, 0];
    this._from = new THREE.Color();
    this._to = new THREE.Color();

    // Malzemeler: tek "katı" program (köşe rengi), saydam cam, renkli sıvılar
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glassMat = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide,
    });
    this.dirtyMat = this.glassMat.clone();
    this.dirtyMat.opacity = 0.6;
    this.dirtyMat.color.setHex(DIRTY_TINT);
    this.stainMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 1 });
    this.liquidMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xf4e46c });
    this.pourMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xf4e46c });
    this.wafelMat = null; // ilk stroopwafel'de (doku)

    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.root.scale.setScalar(VIEW_SCALE);
    this.root.visible = false;
    this.camera.add(this.root);

    // Eller
    this.right = new THREE.Group();
    this.left = new THREE.Group();
    this.rightHand = prep(new THREE.Mesh(buildHand(1), this.solidMat));
    this.leftHand = prep(new THREE.Mesh(buildHand(-1), this.solidMat));
    this.rightHeld = new THREE.Group();
    this.leftHeld = new THREE.Group();
    this.right.add(this.rightHand, this.rightHeld);
    this.left.add(this.leftHand, this.leftHeld);
    this.left.visible = false;
    this.root.add(this.right, this.left);

    // Bardak (kabuk + sıvı)
    this.glass = new THREE.Group();
    this.glassShell = prep(new THREE.Mesh(merge(glassShellParts(0)), this.glassMat));
    this.liquid = prep(new THREE.Mesh(liquidGeometry(), this.liquidMat));
    this.liquid.position.y = -GLASS_H / 2 + 0.008;
    this.glass.add(this.liquid, this.glassShell);
    this.rightHeld.add(this.glass);
    this.glassFill = 0;

    // Kirli bardak yığını (1..3 için önceden üretilmiş geometriler)
    this.dirtyGeos = [null, dirtyGeometries(1), dirtyGeometries(2), dirtyGeometries(3)];
    this.dirty = new THREE.Group();
    this.dirtyShell = prep(new THREE.Mesh(this.dirtyGeos[1].shell, this.dirtyMat));
    this.dirtyStain = prep(new THREE.Mesh(this.dirtyGeos[1].stain, this.stainMat));
    this.dirty.add(this.dirtyStain, this.dirtyShell);
    this.rightHeld.add(this.dirty);

    // Yiyecek (geometri durum başına önbellekte)
    this.foodGeos = new Map();
    this.food = prep(new THREE.Mesh(undefined, this.solidMat));
    this.food.visible = false;
    this.rightHeld.add(this.food);

    // Çöp (toplama animasyonu; hangi el boşsa ona takılır)
    this.trashGeos = new Map();
    this.trash = prep(new THREE.Mesh(undefined, this.solidMat));
    this.trash.visible = false;

    // Şişe (sol el) ve çalkalayıcı (serbest)
    const bg = bottleGeometries();
    this.bottle = new THREE.Group();
    this.bottle.add(
      prep(new THREE.Mesh(bg.liquid, this.pourMat)),
      prep(new THREE.Mesh(bg.solid, this.solidMat)),
      prep(new THREE.Mesh(bg.shell, this.glassMat)),
    );
    this.bottleMouth = bg.mouth;
    this.bottle.visible = false;
    this.leftHeld.add(this.bottle);
    this.shaker = prep(new THREE.Mesh(shakerGeometry(), this.solidMat));
    this.shaker.visible = false;
    this.root.add(this.shaker);

    // İnce sıvı akışı (üst uç orijinde, -Y boyunca 1 birim)
    this.stream = prep(new THREE.Mesh(
      colored(new THREE.CylinderGeometry(0.0055, 0.0042, 1, 8, 1, true).translate(0, -0.5, 0), '#ffffff', 0.95),
      this.pourMat,
    ));
    this.stream.visible = false;
    this.root.add(this.stream);

    this.particles = new Particles(MAX_PARTICLES);
    prep(this.particles.mesh);
    this.root.add(this.particles.mesh);

    this.layout();
    this.applyHold(null);
  }

  get busy() { return this.anim !== null; }

  /** Hareketi azalt: sallanma/çalkalama genlikleri ~%25 */
  get amp() { return this.settings.reduceMotion ? 0.25 : 1; }

  // ---- Genel API -------------------------------------------------------------------

  setHold(hold) {
    if (this.anim) {
      // Animasyon sürüyorsa yarıda kesme: bitince bu durum geçerli olur
      this.anim.after = hold || null;
      return;
    }
    this.applyHold(hold || null);
    this.poseRest();
    this.engine.requestRender();
  }

  play(kind, durMs, opts = {}) {
    if (this.anim) this.finish(); // öncekini bitir (sonuç durumuna atla)
    const from = this.hold;
    const dur = Math.max(120, Number.isFinite(durMs) ? durMs : 600);
    const a = {
      kind, dur, opts, from,
      t0: performance.now(),
      after: 'after' in opts ? opts.after || null : this.defaultAfter(kind, opts, from),
      spawned: false,
      emit: 0,
    };
    this.anim = a;
    this.layout();
    this.particles.clear();
    this.root.visible = true;
    this.setupAnim(a);
    this.poseAnim(a, 0, 0);
    this.engine.wake();
    this.engine.requestRender();
  }

  cancel(hold) {
    if (this.anim) this.cleanupAnim();
    this.anim = null;
    this.applyHold(hold || null);
    this.poseRest();
    this.engine.requestRender();
  }

  /** @returns {boolean} bu kare çizilsin mi */
  update(dt) {
    let draw = false;
    if (this.layout()) draw = this.root.visible;
    const moved = this.updateBob(dt);
    const a = this.anim;
    if (a) {
      const k = (performance.now() - a.t0) / a.dur;
      if (k >= 1) this.finish();
      else this.poseAnim(a, k, Math.min(dt, 0.1));
      draw = true; // bittiği karede de çiz
    } else if (moved || draw) {
      this.poseRest();
      if (moved) draw = true;
    }
    if (this.particles.update(Math.min(dt, 0.1))) draw = true;
    return draw;
  }

  // ---- Yerleşim (fov / en-boy oranından ekran konumları) -------------------------------

  /** @returns {boolean} değişti mi (ucuz karşılaştırma; her karede çağrılır) */
  layout() {
    const cam = this.camera;
    const key = `${cam.fov.toFixed(2)}|${cam.aspect.toFixed(3)}`;
    if (key === this.layoutKey) return false;
    this.layoutKey = key;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const aspect = cam.aspect;
    // Dikey telefonda yatay alan dar: eller biraz küçülür ve merkeze yaklaşır
    const portrait = aspect < 1;
    this.fit = portrait ? Math.max(0.58, Math.min(1, aspect / 1.15)) : 1;
    const at = (nx, ny, d = DEPTH) => [nx * d * tanH * aspect, ny * d * tanH, -d];
    const rx = portrait ? 0.34 : 0.42;
    this.anchors = {
      R: at(rx, -0.5),
      L: at(-rx, -0.5),
      C: at(0.03, -0.38),
      M: at(0.0, -0.3, MOUTH_DEPTH),
      tanH,
      aspect,
    };
    return true;
  }

  below(p, dx = 0) {
    return [p[0] + dx * this.fit, p[1] + HIDE_Y, p[2] + 0.05];
  }

  /** Yürürken hafif el sallantısı: yalnızca kamera hareket ederken (zaten çizilen karelerde) */
  updateBob(dt) {
    const b = this.bob;
    const p = this.camera.position;
    if (!b.has) {
      b.last.copy(p);
      b.has = true;
      return false;
    }
    const dist = Math.hypot(p.x - b.last.x, p.z - b.last.z);
    b.last.copy(p);
    if (!this.root.visible) {
      b.amp = 0;
      b.x = b.y = 0;
      return false;
    }
    const walking = dist > 0.0005 && dist < 0.5; // ışınlanma sayılmaz
    if (walking) {
      b.phase += dist * 9;
      b.amp = Math.min(1, b.amp + dt * 6);
    } else if (b.amp > 0) {
      b.amp = Math.max(0, b.amp - dt * 5);
    } else {
      return false;
    }
    const A = b.amp * this.amp;
    b.x = Math.sin(b.phase) * 0.006 * A;
    b.y = -Math.abs(Math.cos(b.phase)) * 0.008 * A;
    return true;
  }

  // ---- Elde tutulan durum -----------------------------------------------------------------

  defaultAfter(kind, opts, from) {
    switch (kind) {
      case 'take': return { kind: 'glass', fill: 0, color: null };
      case 'pour': return { kind: 'glass', fill: opts.toFill ?? 0.3, color: opts.color || null };
      case 'shake': return { kind: 'glass', fill: from?.fill || 0.6, color: opts.color || from?.color || null };
      case 'collect': return { kind: 'dirty', count: Math.min(3, (from?.kind === 'dirty' ? from.count : 0) + 1) };
      case 'buy': return from;
      case 'bite': {
        const left = opts.bitesLeft ?? 0;
        return left > 0 ? { kind: 'food', food: opts.food, bitesLeft: left, bites: opts.bites } : null;
      }
      case 'pickup': return from;
      default: return null; // serve, wash
    }
  }

  applyHold(h) {
    this.hold = h;
    this.glass.visible = false;
    this.dirty.visible = false;
    this.food.visible = false;
    this.right.visible = !!h;
    this.root.visible = !!h;
    if (!h) return;
    if (h.kind === 'glass') this.showGlass(h.fill || 0, h.color);
    else if (h.kind === 'dirty') this.showDirty(h.count || 1);
    else if (h.kind === 'food') this.showFood(h.food, h.bitesLeft, h.bites);
  }

  showGlass(fill, color) {
    this.glass.visible = true;
    this.glass.position.set(0, 0, 0);
    this.glass.rotation.set(0, 0, 0);
    this.glass.scale.setScalar(1);
    if (this.glass.parent !== this.rightHeld) this.rightHeld.add(this.glass);
    if (color) this.liquidMat.color.set(color);
    this.setFill(color ? fill : 0);
  }

  setFill(fill) {
    this.glassFill = fill;
    this.liquid.visible = fill > 0.005;
    this.liquid.scale.y = Math.max(0.001, fill * LIQ_MAX);
  }

  showDirty(count) {
    const g = this.dirtyGeos[Math.max(1, Math.min(3, count | 0))];
    this.dirtyShell.geometry = g.shell;
    this.dirtyStain.geometry = g.stain;
    this.dirty.visible = true;
    this.dirty.position.set(0, 0, 0);
    this.dirty.rotation.set(0, 0, 0);
    this.dirty.scale.setScalar(1);
    this.dirtyMat.color.setHex(DIRTY_TINT);
    this.stainMat.opacity = 1;
  }

  foodGeometry(food, bitesLeft, bites) {
    const key = `${food}:${bitesLeft}/${bites}`;
    let g = this.foodGeos.get(key);
    if (!g) {
      g = food === 'stroopwafel' ? wafelGeometry(bitesLeft, bites) : brownieGeometry(bitesLeft, bites);
      this.foodGeos.set(key, g);
    }
    return g;
  }

  showFood(food, bitesLeft, bites) {
    const total = bites || FOOD_BY_ID[food]?.bites || 3;
    const left = Math.max(0, Math.min(total, bitesLeft ?? total));
    if (left <= 0) {
      this.food.visible = false;
      return;
    }
    this.food.geometry = this.foodGeometry(food, left, total);
    if (food === 'stroopwafel') {
      if (!this.wafelMat) this.wafelMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeWaffleTexture() });
      this.food.material = this.wafelMat;
    } else {
      this.food.material = this.solidMat;
    }
    this.food.visible = true;
    this.food.position.set(0, 0, 0);
    this.food.scale.setScalar(1);
    this.food.rotation.set(FOOD_TILT, FOOD_YAW + this.foodTurn(food, left, total), 0);
  }

  /** Stroopwafel'de sıradaki ısırık noktası kameraya dönsün */
  foodTurn(food, bitesLeft, bites) {
    return food === 'stroopwafel' ? (bites - bitesLeft) * ((Math.PI * 2) / bites) : 0;
  }

  // ---- Animasyon kurulum / bitiş -----------------------------------------------------------

  setupAnim(a) {
    const { kind, opts, from } = a;
    const after = a.after;
    this.right.visible = true;
    switch (kind) {
      case 'take':
        this.applyHold(null);
        this.root.visible = true;
        this.right.visible = true;
        this.showGlass(0, null);
        this.glass.visible = false;
        break;
      case 'pour': {
        const f0 = opts.fromFill ?? (from?.kind === 'glass' ? from.fill || 0 : 0);
        const c0 = from?.kind === 'glass' && from.color ? from.color : opts.color || '#ffffff';
        this.showGlass(f0, c0);
        this._from.set(c0);
        this._to.set(opts.color || c0);
        this.pourMat.color.set(opts.streamColor || opts.color || c0);
        this.left.visible = true;
        this.bottle.visible = true;
        break;
      }
      case 'shake':
        if (from?.kind !== 'glass') this.showGlass(0, null);
        this._to.set(opts.color || from?.color || '#ffffff');
        this.pourMat.color.copy(this._to);
        this.left.visible = true;
        this.shaker.visible = true;
        break;
      case 'collect':
        if (from?.kind !== 'dirty') {
          this.applyHold(null);
          this.root.visible = true;
          this.right.visible = true;
        }
        break;
      case 'wash':
        this.left.visible = true;
        if (!from) this.showDirty(1);
        break;
      case 'buy':
        this.applyHold(null);
        this.root.visible = true;
        this.right.visible = true;
        if (after?.kind === 'food') this.showFood(after.food, after.bitesLeft, after.bites);
        break;
      case 'bite': {
        const food = opts.food || from?.food || 'brownie';
        const bites = opts.bites || from?.bites || FOOD_BY_ID[food]?.bites || 3;
        const leftAfter = opts.bitesLeft ?? (after?.bitesLeft || 0);
        const before = from?.kind === 'food' && from.food === food ? from.bitesLeft : Math.min(bites, leftAfter + 1);
        a.food = food;
        a.bites = bites;
        a.before = before;
        a.leftAfter = leftAfter;
        this.glass.visible = false;
        this.dirty.visible = false;
        this.showFood(food, before, bites);
        a.turn0 = this.foodTurn(food, before, bites);
        a.turn1 = leftAfter > 0 ? this.foodTurn(food, leftAfter, bites) : a.turn0;
        break;
      }
      case 'pickup': {
        const item = TRASH_ITEMS.includes(opts.item) ? opts.item : 'paper';
        let g = this.trashGeos.get(item);
        if (!g) {
          g = trashGeometry(item);
          this.trashGeos.set(item, g);
        }
        this.trash.geometry = g;
        this.trash.visible = false;
        // Elde bir şey varsa sol el toplar, yoksa sağ el
        a.useLeft = !!from;
        (a.useLeft ? this.leftHeld : this.rightHeld).add(this.trash);
        if (a.useLeft) this.left.visible = true;
        else this.right.visible = true;
        break;
      }
      default:
        break;
    }
  }

  finish() {
    const a = this.anim;
    if (!a) return;
    this.cleanupAnim();
    this.anim = null;
    this.applyHold(a.after);
    this.poseRest();
  }

  cleanupAnim() {
    if (this.glass.parent !== this.rightHeld) this.rightHeld.add(this.glass);
    this.left.visible = false;
    this.bottle.visible = false;
    this.shaker.visible = false;
    this.stream.visible = false;
    this.trash.visible = false;
    this.trash.removeFromParent();
    this.particles.clear();
  }

  // ---- Pozlar -------------------------------------------------------------------------------

  restRot(left = false) {
    return left ? [0.08, 0.22, -0.06] : [0.08, -0.22, 0.06];
  }

  setPivot(pivot, pose) {
    const b = this.bob;
    pivot.position.set(pose[0] + b.x, pose[1] + b.y, pose[2]);
    pivot.rotation.set(pose[3], pose[4], pose[5]);
    pivot.scale.setScalar(this.fit);
  }

  poseRest() {
    this.poseRight();
    this.setPivot(this.left, P(this.anchors.L, this.restRot(true)));
  }

  poseRight() {
    this.setPivot(this.right, P(this.anchors.R, this.restRot()));
  }

  /** Bir alt nesnenin yerel noktasını kök uzayına çevirir */
  pointInRoot(obj, local, out) {
    out.copy(local);
    let o = obj;
    while (o && o !== this.root) {
      o.updateMatrix();
      out.applyMatrix4(o.matrix);
      o = o.parent;
    }
    return out;
  }

  setStream(from, to, s0, s1) {
    _v2.subVectors(to, from);
    const len = _v2.length();
    const a = Math.min(s0, s1);
    const b = Math.max(s0, s1);
    if (len < 1e-4 || b - a < 0.01) {
      this.stream.visible = false;
      return;
    }
    this.stream.visible = true;
    this.stream.position.copy(from).addScaledVector(_v2, a);
    _v2.normalize();
    this.stream.quaternion.setFromUnitVectors(DOWN, _v2);
    this.stream.scale.set(this.fit, len * (b - a), this.fit);
  }

  poseAnim(a, k, dt) {
    const fn = ANIMS[a.kind];
    if (fn) fn.call(this, a, k, dt);
    else this.poseRest();
  }
}

// ---- Animasyonlar (this = ViewModel; k = 0..1 ilerleme) ------------------------------------

const ANIMS = {
  /** Rafa öne-sağa uzan, bardak belirir, geri gel */
  take(a, k) {
    const { R } = this.anchors;
    const f = this.fit;
    const rest = this.restRot();
    const reach = add(R, 0.1 * f, 0.075, -0.17);
    track(k, [
      [0, P(this.below(R, 0.04), rest)],
      [0.4, P(reach, [-0.3, -0.55, -0.2]), easeOut],
      [0.5, P(add(reach, 0.004, -0.006, 0.01), [-0.25, -0.5, -0.18])],
      [1, P(R, rest)],
    ], this._rp);
    this.setPivot(this.right, this._rp);
    const g = seg(k, 0.4, 0.56);
    this.glass.visible = k >= 0.4;
    this.glass.scale.setScalar(0.35 + 0.65 * back(g));
  },

  /** Elde bardak; sol elde şişe eğilir, ince akış, dolum fromFill → toFill */
  pour(a, k) {
    const { R, L } = this.anchors;
    const f = this.fit;
    const o = a.opts;
    const rest = this.restRot();
    const gp = add(R, -0.06 * f, 0.025, -0.015);
    track(k, [
      [0, P(R, rest)],
      [0.16, P(gp, [0.05, -0.12, 0.12])],
      [0.84, P(gp, [0.05, -0.12, 0.12])],
      [1, P(R, rest)],
    ], this._rp);
    this.setPivot(this.right, this._rp);

    // Şişe: ağzı bardağın üstüne gelecek şekilde kavrama noktası hesaplanır
    const tilt = -1.85;
    const m = this.bottleMouth;
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    const mx = (m.x * c - m.y * s) * f;
    const my = (m.x * s + m.y * c) * f;
    const target = [gp[0] - 0.004 * f, gp[1] + (GLASS_H / 2) * f + 0.075, gp[2] + 0.004];
    const grip = [target[0] - mx, target[1] - my, target[2]];
    const lrest = this.restRot(true);
    track(k, [
      [0, P(this.below(L, -0.04), lrest)],
      [0.2, P(add(grip, -0.02 * f, -0.03, 0.01), [0.05, 0.25, -0.35]), easeOut],
      [0.32, P(grip, [0.05, 0.12, tilt])],
      [0.78, P(grip, [0.05, 0.12, tilt])],
      [0.9, P(add(grip, -0.02 * f, -0.02, 0.01), [0.05, 0.25, -0.4])],
      [1, P(this.below(L, -0.04), lrest)],
    ], this._lp);
    // Bilek eğimin yalnızca bir kısmını alır, gerisini şişe elin içinde döner (kol ekranın altında kalır)
    const tiltNow = this._lp[5];
    this._lp[5] = tiltNow * 0.3;
    this.bottle.rotation.z = tiltNow - this._lp[5];
    this.setPivot(this.left, this._lp);

    // Dolum ve renk karışımı
    const fk = inOut(seg(k, 0.34, 0.82));
    const from = o.fromFill ?? 0;
    const to = o.toFill ?? Math.min(0.9, from + 0.3);
    this.setFill(lerp(from, to, fk));
    this.liquidMat.color.lerpColors(this._from, this._to, from > 0.005 ? fk : 1);

    // Akış: şişe ağzından sıvı yüzeyine
    if (k > 0.3 && k < 0.85) {
      const mouth = this.pointInRoot(this.bottle, this.bottleMouth, _v);
      const surf = this.pointInRoot(this.liquid, _v2.set(0, 1, 0), new THREE.Vector3());
      surf.y = Math.max(surf.y, mouth.y - 0.4);
      this.setStream(mouth, surf, easeIn(seg(k, 0.78, 0.84)), easeOut(seg(k, 0.3, 0.36)));
    } else {
      this.stream.visible = false;
    }
  },

  /** Çalkalayıcı iki elle hızla sallanır, sonra bardağa dökülür */
  shake(a, k) {
    const { R, L, C } = this.anchors;
    const f = this.fit;
    const A = this.amp;
    const rest = this.restRot();
    const lrest = this.restRot(true);
    const dur = a.dur / 1000;
    const glassP = add(R, -0.035 * f, 0.01, -0.01);

    // Çalkalayıcının konumu / eğimi
    const pourTilt = -1.95;
    const sm = SHAKER_MOUTH;
    const c = Math.cos(pourTilt);
    const s = Math.sin(pourTilt);
    const target = [glassP[0] - 0.004 * f, glassP[1] + (GLASS_H / 2) * f + 0.06, glassP[2] + 0.01];
    const pourPos = [target[0] - (sm.x * c - sm.y * s) * f, target[1] - (sm.x * s + sm.y * c) * f, target[2]];
    const sk = [0, 0, 0, 0, 0, 0];
    track(k, [
      [0.06, P(this.below(C), [0, 0, 0.3])],
      [0.22, P(C, [0, 0, 0]), back],
      [0.62, P(C, [0, 0, 0])],
      [0.74, P(pourPos, [0, 0, -0.5])],
      [0.78, P(pourPos, [0, 0, pourTilt])],
      [0.92, P(pourPos, [0, 0, pourTilt])],
      [1, P(this.below(pourPos), [0, 0, -0.4])],
    ], sk);
    // Sallama: hızlı yukarı-aşağı (sin), yumuşak giriş/çıkış
    const shakeEnv = seg(k, 0.22, 0.27) * (1 - seg(k, 0.57, 0.62));
    const ph = (k - 0.22) * dur * Math.PI * 2 * 5.5;
    sk[1] += Math.sin(ph) * 0.042 * A * shakeEnv;
    sk[0] += Math.sin(ph * 0.5) * 0.006 * A * shakeEnv;
    sk[5] += Math.sin(ph + 0.6) * 0.14 * A * shakeEnv;
    this.shaker.position.set(sk[0], sk[1], sk[2]);
    this.shaker.rotation.set(sk[3], sk[4], sk[5]);
    this.shaker.scale.setScalar(f);

    // Sol el: çalkalayıcının alt gövdesini kavrar (eğimle birlikte döner)
    const gripOn = (lx, ly) => {
      const cz = Math.cos(sk[5]);
      const sz = Math.sin(sk[5]);
      return [sk[0] + (lx * cz - ly * sz) * f, sk[1] + (lx * sz + ly * cz) * f, sk[2] + 0.004];
    };
    const lg = gripOn(0, -0.035);
    const lrz = k < 0.62 ? sk[5] : sk[5] * 0.35; // dökerken bilek eğimin bir kısmını alır
    if (k < 0.22) {
      track(k, [[0.06, P(this.below(L), lrest)], [0.22, P(lg, [0.05, 0.2, lrz]), easeOut]], this._lp);
    } else {
      this._lp = P(lg, [0.05, 0.2, lrz]);
    }
    this.setPivot(this.left, this._lp);

    // Sağ el: önce bardakla aşağı iner, çalkalayıcının üst kısmını kavrar, sonra bardakla geri gelir
    const rg = gripOn(0, 0.045);
    const onShaker = k >= 0.24 && k < 0.64;
    if (k < 0.14) {
      track(k, [[0, P(R, rest)], [0.14, P(this.below(R), rest), easeIn]], this._rp);
    } else if (k < 0.24) {
      track(k, [[0.14, P(this.below(C, 0.06), [0, -0.2, 0])], [0.24, P(rg, [0.05, -0.2, sk[5]]), easeOut]], this._rp);
    } else if (onShaker) {
      this._rp = P(rg, [0.05, -0.2, sk[5]]);
    } else {
      track(k, [
        [0.64, P(rg, [0.05, -0.2, sk[5]])],
        [0.69, P(this.below(R, 0.04), rest), easeIn],
        [0.76, P(glassP, [0.05, -0.15, 0.08]), easeOut],
        [0.93, P(glassP, [0.05, -0.15, 0.08])],
        [1, P(R, rest)],
      ], this._rp);
    }
    this.setPivot(this.right, this._rp);
    // Bardak: elde aşağı iner, el çalkalayıcıdayken görünmez, boş döner ve dolar
    this.glass.visible = k < 0.16 || k >= 0.68;
    if (k >= 0.68) {
      const fill = a.after?.kind === 'glass' ? a.after.fill || 0.6 : 0.6;
      const fk = inOut(seg(k, 0.8, 0.93));
      this.liquidMat.color.copy(this._to);
      this.setFill(fill * fk);
      if (k > 0.78 && k < 0.95) {
        const mouth = this.pointInRoot(this.shaker, SHAKER_MOUTH, _v);
        const surf = this.pointInRoot(this.liquid, _v2.set(0, 1, 0), new THREE.Vector3());
        this.setStream(mouth, surf, easeIn(seg(k, 0.9, 0.95)), easeOut(seg(k, 0.78, 0.82)));
      } else {
        this.stream.visible = false;
      }
    } else {
      this.stream.visible = false;
    }
  },

  /** Bardağı ileri itip tezgâha bırakır, el boş döner */
  serve(a, k) {
    const { R } = this.anchors;
    const f = this.fit;
    const rest = this.restRot();
    const push = add(R, -0.1 * f, -0.03, -0.19);
    track(k, [
      [0, P(R, rest)],
      [0.45, P(push, [-0.25, -0.1, 0.05])],
      [0.55, P(add(push, 0.01, 0.01, 0.02), [-0.15, -0.1, 0.05])],
      [1, P(this.below(R, 0.03), rest), easeIn],
    ], this._rp);
    this.setPivot(this.right, this._rp);
    if (k >= 0.47 && this.glass.parent === this.rightHeld) {
      this.root.attach(this.glass); // dünya dönüşümünü koruyarak bırak
      a.release = this.glass.position.toArray();
    }
    if (a.release) {
      const e = easeIn(seg(k, 0.47, 0.95));
      const r = a.release;
      this.glass.position.set(r[0] - 0.02 * e, r[1] - 0.26 * e, r[2] - 0.08 * easeOut(seg(k, 0.47, 0.95)));
    }
  },

  /** Öne-aşağı uzanır, kirli bardak ele gelir (yığın +1) */
  collect(a, k) {
    const { R } = this.anchors;
    const f = this.fit;
    const rest = this.restRot();
    const had = a.from?.kind === 'dirty';
    const reach = add(R, -0.06 * f, -0.1, -0.2);
    track(k, [
      [0, P(had ? R : this.below(R, 0.04), rest)],
      [0.45, P(reach, [-0.55, -0.3, 0.05]), had ? inOut : easeOut],
      [0.52, P(add(reach, 0, 0.008, 0.005), [-0.5, -0.3, 0.05])],
      [1, P(R, rest)],
    ], this._rp);
    this.setPivot(this.right, this._rp);
    const n0 = had ? a.from.count : 0;
    const n1 = a.after?.kind === 'dirty' ? a.after.count : n0 + 1;
    if (k < 0.47) {
      if (n0 > 0) this.showDirty(n0);
      else this.dirty.visible = false;
    } else {
      if (a.shown !== n1) {
        this.showDirty(n1);
        a.shown = n1;
      }
      this.dirty.scale.setScalar(0.85 + 0.15 * back(seg(k, 0.47, 0.6)));
    }
  },

  /** İki el bardakları köpükle ovar, su damlar; sonda bardaklar kaybolur */
  wash(a, k, dt) {
    const { R, L, C } = this.anchors;
    const f = this.fit;
    const A = this.amp;
    const rest = this.restRot();
    const lrest = this.restRot(true);
    const dur = a.dur / 1000;
    const t = k * dur;
    const rub = seg(k, 0.12, 0.18) * (1 - seg(k, 0.8, 0.86));
    const w = t * Math.PI * 2 * 2.6;
    const center = add(C, 0.025 * f, -0.04, 0);
    const rc = add(center, Math.cos(w) * 0.008 * A * rub, Math.sin(w * 2) * 0.006 * A * rub, 0);
    track(k, [
      [0, P(R, rest)],
      [0.12, P(center, [0.1, -0.1, 0.05])],
      [0.86, P(center, [0.1, -0.1, 0.05])],
      [1, P(this.below(R), rest), easeIn],
    ], this._rp);
    if (k > 0.12 && k < 0.86) {
      this._rp[0] = rc[0];
      this._rp[1] = rc[1];
    }
    this.setPivot(this.right, this._rp);
    // Sol el: bardağın sol yüzünü dairesel ovar (ters faz)
    const lc = add(center, -0.006 * f - Math.cos(w) * 0.02 * A * rub, 0.01 + Math.sin(w) * 0.022 * A * rub, 0.012);
    track(k, [
      [0, P(this.below(L, -0.04), lrest)],
      [0.14, P(lc, [0.1, 0.25, -0.1]), easeOut],
      [0.86, P(lc, [0.1, 0.25, -0.1])],
      [1, P(this.below(L, -0.04), lrest), easeIn],
    ], this._lp);
    if (k > 0.14 && k < 0.86) {
      this._lp[0] = lc[0];
      this._lp[1] = lc[1];
      this._lp[5] = -0.1 + Math.sin(w) * 0.25 * A * rub;
    }
    this.setPivot(this.left, this._lp);

    // Temizlenme: kir rengi beyaza, lekeler solar; istenmeyen içecek boşalır
    const clean = seg(k, 0.2, 0.8);
    const held = this.dirty.visible ? this.dirty : this.glass;
    if (this.dirty.visible) {
      this.dirtyMat.color.setHex(DIRTY_TINT).lerp(_c.setHex(CLEAN_TINT), clean);
      this.stainMat.opacity = 1 - clean;
    } else if (this.glass.visible) {
      const f0 = a.from?.kind === 'glass' ? a.from.fill || 0 : 0;
      this.setFill(f0 * (1 - seg(k, 0.1, 0.35)));
    }
    held.rotation.y = rub ? Math.sin(w * 0.5) * 0.4 * A : 0;
    // Sonda bardaklar ışıltıyla kaybolur
    const vanish = seg(k, 0.82, 0.9);
    held.scale.setScalar(Math.max(0.0001, 1 - easeIn(vanish)));

    // Köpük ve damlalar (kök uzayında, el ölçeğinde)
    const p = this.right.position;
    if (k > 0.14 && k < 0.82 && dt > 0) {
      a.emit += dt * (this.settings.reduceMotion ? 9 : 26);
      while (a.emit >= 1) {
        a.emit -= 1;
        const foam = Math.random() < 0.7;
        const ang = Math.random() * Math.PI * 2;
        const r = rand(0.01, 0.045) * f;
        if (foam) {
          this.particles.spawn(p.x + Math.cos(ang) * r, p.y + rand(0.01, 0.06) * f, p.z + Math.sin(ang) * r * 0.6,
            rand(-0.03, 0.03), rand(0.02, 0.07), rand(-0.02, 0.02),
            { ttl: rand(0.45, 0.8), size: rand(0.006, 0.012) * f, hex: 0xffffff, g: 0.02, grow: 1 });
        } else {
          this.particles.spawn(p.x + Math.cos(ang) * r, p.y - 0.04 * f, p.z,
            rand(-0.05, 0.05), rand(-0.05, 0.03), rand(-0.02, 0.02),
            { ttl: 0.5, size: rand(0.004, 0.006) * f, hex: 0x8fd3f5, g: -1.6 });
        }
      }
    }
    if (k >= 0.84 && !a.spawned) {
      a.spawned = true;
      const n = this.settings.reduceMotion ? 3 : 9;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        this.particles.spawn(p.x, p.y + 0.02 * f, p.z, Math.cos(ang) * 0.12, Math.sin(ang) * 0.12, 0,
          { ttl: 0.35, size: 0.006 * f, hex: i % 2 ? 0xbfefff : 0xffffff, g: 0 });
      }
    }
  },

  /** Yiyecek aşağıdan ele gelir */
  buy(a, k) {
    const { R } = this.anchors;
    const rest = this.restRot();
    track(k, [
      [0, P(this.below(R, 0.02), rest)],
      [0.72, P(R, [rest[0] - 0.15, rest[1], rest[2] + 0.1]), back],
      [1, P(R, rest)],
    ], this._rp);
    this.setPivot(this.right, this._rp);
  },

  /** Yiyeceği ağza kaldır, ısır (ısırık izi + kırıntılar), çiğne, indir */
  bite(a, k) {
    const { R, M } = this.anchors;
    const A = this.amp;
    const rest = this.restRot();
    const gone = a.leftAfter <= 0;
    const mouthRot = [0.15, 0.2, -0.05];
    const chomp = add(M, 0, 0.01, 0.035);
    track(k, [
      [0, P(R, rest)],
      [0.28, P(M, mouthRot)],
      [0.31, P(chomp, [0.22, 0.2, -0.05]), easeOut],
      [0.37, P(M, mouthRot)],
      [0.64, P(add(M, 0, -0.025, -0.01), [0.3, -0.05, -0.02])],
      [1, P(gone ? this.below(R, 0.02) : R, rest)],
    ], this._rp);
    // Çiğneme titremesi
    const chew = seg(k, 0.37, 0.42) * (1 - seg(k, 0.58, 0.64));
    if (chew > 0) {
      const ph = (k - 0.37) * (a.dur / 1000) * Math.PI * 2 * 7;
      this._rp[1] += Math.sin(ph) * 0.0045 * A * chew;
      this._rp[5] += Math.sin(ph * 0.5) * 0.04 * A * chew;
    }
    this.setPivot(this.right, this._rp);

    // Isırık anı: geometri bir sonraki duruma geçer, kırıntılar saçılır
    if (k >= 0.31 && !a.spawned) {
      a.spawned = true;
      if (gone) this.food.visible = false;
      else {
        this.food.geometry = this.foodGeometry(a.food, a.leftAfter, a.bites);
        this.food.visible = true;
      }
      const tip = this.pointInRoot(this.food, _v2.set(0, 0.01, a.food === 'stroopwafel' ? 0.04 : 0.02), _v);
      const cols = CRUMB_COLORS[a.food] || CRUMB_COLORS.brownie;
      const n = this.settings.reduceMotion ? 4 : (gone ? 18 : 13);
      const f = this.fit;
      for (let i = 0; i < n; i++) {
        this.particles.spawn(tip.x + rand(-0.02, 0.02) * f, tip.y + rand(-0.01, 0.01) * f, tip.z,
          rand(-0.22, 0.22), rand(0.02, 0.22), rand(-0.04, 0.08),
          { ttl: rand(0.6, 1.1), size: rand(0.0035, 0.0065) * f, hex: cols[i % cols.length], g: -1.7 });
      }
    }
    // Ağza giderken ısırılacak uç kameraya döner; inerken yana (stroopwafel'de sıradaki ısırık noktası)
    if (!gone) {
      const face = inOut(seg(k, 0.04, 0.28)) * (1 - inOut(seg(k, 0.64, 0.96)));
      this.food.rotation.x = lerp(FOOD_TILT, 0.1, face);
      this.food.rotation.y = lerp(FOOD_YAW, 0, face) + lerp(a.turn0, a.turn1, inOut(seg(k, 0.66, 1)));
    }
  },

  /** Otel çöpü: öne-aşağı uzan, al, göster, çantaya at (el ekran altına iner) */
  pickup(a, k) {
    const useLeft = a.useLeft;
    const base = useLeft ? this.anchors.L : this.anchors.R;
    const sgn = useLeft ? -1 : 1;
    const rest = this.restRot(useLeft);
    const reach = add(base, -0.05 * sgn * this.fit, -0.12, -0.2);
    const show = add(base, -0.02 * sgn * this.fit, 0.02, -0.02);
    const pose = useLeft ? this._lp : this._rp;
    track(k, [
      [0, P(this.below(base, 0.04 * sgn), rest)],
      [0.38, P(reach, [-0.6, -0.25 * sgn, 0.05 * sgn]), easeOut],
      [0.45, P(add(reach, 0, 0.006, 0.004), [-0.55, -0.25 * sgn, 0.05 * sgn])],
      [0.68, P(show, [0.0, -0.1 * sgn, 0.12 * sgn])],
      [1, P(this.below(base, 0.06 * sgn), [0.3, 0, 0.2 * sgn]), easeIn],
    ], pose);
    this.setPivot(useLeft ? this.left : this.right, pose);
    if (useLeft) this.poseRight();
    this.trash.visible = k >= 0.4 && k < 0.97;
    this.trash.scale.setScalar(0.4 + 0.6 * back(seg(k, 0.4, 0.52)));
  },
};

import * as THREE from 'three';
import { HOUSE_RULES } from '/shared/house.js';

// Düşük poligonlu mobilya modelleri. Her parça köşe rengi (vertex color) taşır;
// böylece evdeki TÜM mobilyalar tek bir geometride birleştirilip tek draw call
// ile çizilebilir (mobilde pil/GPU dostu).
// Yerel eksen: merkez ayak izinin ortası, y=0 zemin, ön yüz +Z.

const _c = new THREE.Color();

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

const box = (w, h, d, x, y, z, hex, shade) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex, shade);
const cyl = (rt, rb, h, x, y, z, hex, seg = 10, shade = 1, open = false) => colored(
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y, z), hex, shade,
);
const ball = (r, x, y, z, hex, s = [1, 1, 1], shade = 1) => colored(
  new THREE.SphereGeometry(r, 10, 8).scale(s[0], s[1], s[2]).translate(x, y, z), hex, shade,
);

const WOOD = '#6b4428';
const DARK = '#1c1c1f';
const LEAF = '#3f7d3a';

const BOOK_COLORS = ['#9c2f2f', '#2d4f7c', '#3e6b48', '#d9a441', '#6a4c93', '#e8e4dc', '#b5462f', '#1f5e5e'];

/** Rafa dizilmiş kitaplar (x0..x1 arası, taban yüksekliği y, raf derinliği ortası z) */
function books(out, x0, x1, y, z, depth, seed) {
  let x = x0;
  let i = seed;
  while (x < x1 - 0.05) {
    const w = 0.035 + ((i * 7) % 5) * 0.008;
    const h = 0.17 + ((i * 3) % 4) * 0.025;
    if (x + w > x1) break;
    // ara sıra boşluk
    if ((i * 5) % 11 === 0) {
      x += 0.06;
      i++;
      continue;
    }
    out.push(box(w, h, depth, x + w / 2, y + h / 2, z, BOOK_COLORS[i % BOOK_COLORS.length], 0.95));
    x += w + 0.004;
    i++;
  }
}

/** Tablonun resmi: yüzey (0,0) merkezli, w×h, z yüzeyi; her eser renkli kutulardan */
function artwork(out, art, w, h, y, z) {
  const r = (x0, y0, x1, y1, hex, dz = 0) => out.push(box(
    (x1 - x0) * w, (y1 - y0) * h, 0.004, ((x0 + x1) / 2 - 0.5) * w, y + ((y0 + y1) / 2 - 0.5) * h, z + dz, hex,
  ));
  switch (art) {
    case 0: // Mondriaan
      r(0, 0, 1, 1, '#f4f1e8');
      r(0, 0.55, 0.62, 1, '#d7263d', 0.001);
      r(0.7, 0, 1, 0.3, '#2b5ea7', 0.001);
      r(0, 0, 0.25, 0.25, '#f2c230', 0.001);
      for (const x of [0.25, 0.62, 0.7]) r(x - 0.012, 0, x + 0.012, 1, '#141414', 0.002);
      for (const yy of [0.25, 0.55, 0.3]) r(0, yy - 0.015, 1, yy + 0.015, '#141414', 0.002);
      break;
    case 1: // Lale tarlası
      r(0, 0.55, 1, 1, '#9fd0f0');
      r(0, 0.45, 1, 0.58, '#5f9a4a', 0.001);
      ['#e8384f', '#f2c230', '#f28ab2', '#e36f1e', '#b03cff'].forEach((c, i) => r(0, i * 0.09, 1, i * 0.09 + 0.09, c, 0.001));
      r(0.72, 0.68, 0.84, 0.82, '#fff3b0', 0.002);
      break;
    case 2: { // Kanal evleri
      r(0, 0, 1, 1, '#a9d4f2');
      const hs = ['#7a3b2e', '#2d4f7c', '#3e6b48', '#b5462f', '#5b5f66'];
      hs.forEach((c, i) => {
        const x0 = 0.05 + i * 0.18;
        const top = 0.62 + (i % 2) * 0.12;
        r(x0, 0.22, x0 + 0.16, top, c, 0.001);
        r(x0 + 0.04, top, x0 + 0.12, top + 0.06, c, 0.001);
        r(x0 + 0.05, 0.35, x0 + 0.11, 0.45, '#f4f1e8', 0.002);
      });
      r(0, 0, 1, 0.22, '#2a5d7c', 0.001);
      break;
    }
    case 3: // Yıldızlı gece
      r(0, 0, 1, 1, '#1d2a4a');
      r(0, 0.35, 1, 0.5, '#2f4f8a', 0.001);
      for (const [x, yy, s2] of [[0.2, 0.8, 0.1], [0.5, 0.7, 0.07], [0.78, 0.85, 0.12], [0.35, 0.6, 0.05], [0.65, 0.55, 0.05]]) {
        r(x - s2 / 2, yy - s2 / 2, x + s2 / 2, yy + s2 / 2, '#f2d06b', 0.002);
      }
      r(0.08, 0, 0.18, 0.75, '#13261c', 0.003);
      r(0, 0, 1, 0.18, '#26334f', 0.002);
      break;
    case 4: // Yel değirmeni
      r(0, 0.4, 1, 1, '#bfe0f5');
      r(0, 0, 1, 0.4, '#5f9a4a', 0.001);
      r(0.45, 0.3, 0.6, 0.72, '#6b4428', 0.002);
      r(0.3, 0.68, 0.75, 0.74, '#e8e4dc', 0.003);
      r(0.5, 0.48, 0.55, 0.95, '#e8e4dc', 0.003);
      break;
    default: // Ayçiçekleri
      r(0, 0, 1, 1, '#e9c46a');
      r(0, 0, 1, 0.3, '#b08d57', 0.001);
      r(0.38, 0.12, 0.62, 0.42, '#3a86c8', 0.002);
      for (const [x, yy] of [[0.3, 0.62], [0.5, 0.7], [0.7, 0.6], [0.42, 0.82], [0.6, 0.85]]) {
        r(x - 0.07, yy - 0.07, x + 0.07, yy + 0.07, '#f2b705', 0.003);
        r(x - 0.025, yy - 0.025, x + 0.025, yy + 0.025, '#6b4428', 0.004);
      }
  }
}

const SOIL = '#3a2a1c';
const STEM = '#4f8f3e';

/** Saksıdaki bitki (kind: 'mint' | 'strawberry' | 'tulip', stage 0..3), saksı ağzı y */
function plantModel(out, kind, stage, y) {
  if (stage === 0) {
    out.push(ball(0.06, 0, y + 0.01, 0, '#5a4330', [1.4, 0.5, 1.4]));
    return;
  }
  if (stage === 1) {
    out.push(cyl(0.008, 0.008, 0.08, 0, y + 0.04, 0, STEM, 5));
    out.push(ball(0.035, -0.03, y + 0.09, 0, '#7cc45a', [1.3, 0.6, 1]));
    out.push(ball(0.035, 0.03, y + 0.09, 0, '#7cc45a', [1.3, 0.6, 1]));
    return;
  }
  const ripe = stage === 3;
  if (kind === 'tulip') {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * 0.08;
      const z = Math.sin(a) * 0.08;
      const h = ripe ? 0.36 + (i % 2) * 0.06 : 0.22;
      out.push(cyl(0.008, 0.008, h, x, y + h / 2, z, STEM, 5));
      out.push(ball(0.05, x * 1.4, y + 0.08, z * 1.4, '#5f9a4a', [0.5, 1.6, 0.5]));
      if (ripe) out.push(ball(0.045, x, y + h + 0.03, z, ['#e8384f', '#f2c230', '#f28ab2', '#e8384f', '#e36f1e'][i], [1, 1.35, 1]));
      else out.push(ball(0.025, x, y + h + 0.01, z, '#8cc46a', [1, 1.5, 1]));
    }
    return;
  }
  if (kind === 'strawberry') {
    out.push(ball(ripe ? 0.17 : 0.12, 0, y + 0.08, 0, '#3f7d3a', [1.2, 0.6, 1.2]));
    if (ripe) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        out.push(ball(0.032, Math.cos(a) * 0.17, y + 0.04, Math.sin(a) * 0.17, '#e23a4e', [1, 1.2, 1]));
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        out.push(ball(0.018, Math.cos(a) * 0.12, y + 0.1, Math.sin(a) * 0.12, '#f4f1e8'));
      }
    }
    return;
  }
  // Nane: gür, açık yeşil
  const s = ripe ? 1 : 0.7;
  out.push(ball(0.15 * s, 0, y + 0.12 * s, 0, '#4fae4a', [1.1, 0.9, 1.1]));
  out.push(ball(0.1 * s, 0.07, y + 0.2 * s, -0.04, '#6cc764', [1, 1, 1]));
  out.push(ball(0.09 * s, -0.08, y + 0.18 * s, 0.05, '#5bb855', [1, 1, 1]));
}

/** Tavana vuran ışık: şeridin iki yanına sönen yatay leke (aşağı bakar) */
function ceilingGlow(out, w, y, hex) {
  const half = new THREE.PlaneGeometry(w + 0.9, 0.9).translate(0, -0.45, 0).rotateX(Math.PI / 2);
  const other = half.clone().rotateY(Math.PI);
  for (const g of [half, other]) out.push(colored(g.translate(0, y - 0.012, 0), hex));
}

/**
 * @param opts.color  renk dizini (tablolar: hangi eser)
 * @param opts.plant  saksıdaki bitki { kind, stage } | null
 * @returns {{ solid: BufferGeometry[], unlit: BufferGeometry[], glow: BufferGeometry[],
 *             screen?: { w: number, h: number, y: number, z: number } }}
 *   solid: ışıktan etkilenen; unlit: kendi ışığı olan (LED, abajur); glow: duvara / tavana vuran ışık (additive)
 */
export function buildFurniture(def, hex, opts = {}) {
  const solid = [];
  const unlit = [];
  const glow = [];
  let screen;
  switch (def.id) {
    case 'sofa':
      solid.push(
        box(2.0, 0.08, 0.86, 0, 0.04, 0, DARK),
        box(2.0, 0.34, 0.9, 0, 0.25, 0, hex),
        box(2.0, 0.52, 0.2, 0, 0.68, -0.35, hex, 0.82),
        box(0.18, 0.24, 0.9, -0.91, 0.54, 0, hex, 0.9),
        box(0.18, 0.24, 0.9, 0.91, 0.54, 0, hex, 0.9),
        box(0.8, 0.1, 0.62, -0.42, 0.47, 0.08, hex, 1.12),
        box(0.8, 0.1, 0.62, 0.42, 0.47, 0.08, hex, 1.12),
      );
      break;
    case 'armchair':
      solid.push(
        box(0.86, 0.08, 0.84, 0, 0.04, 0, DARK),
        box(0.9, 0.34, 0.9, 0, 0.25, 0, hex),
        box(0.9, 0.56, 0.18, 0, 0.7, -0.36, hex, 0.82),
        box(0.14, 0.24, 0.9, -0.38, 0.54, 0, hex, 0.9),
        box(0.14, 0.24, 0.9, 0.38, 0.54, 0, hex, 0.9),
        box(0.6, 0.1, 0.62, 0, 0.47, 0.08, hex, 1.12),
      );
      break;
    case 'beanbag':
      solid.push(
        ball(0.42, 0, 0.27, 0, hex, [1, 0.68, 1]),
        ball(0.3, 0, 0.42, -0.14, hex, [1.1, 0.9, 0.8], 0.92),
      );
      break;
    case 'tv':
      solid.push(
        box(1.6, 0.45, 0.45, 0, 0.225, 0, WOOD),
        box(1.5, 0.02, 0.4, 0, 0.455, 0, DARK),
        box(0.14, 0.1, 0.06, 0, 0.51, 0, DARK),
        box(1.46, 0.86, 0.06, 0, 0.98, 0, hex),
      );
      screen = { w: 1.38, h: 0.78, y: 0.98, z: 0.032 };
      break;
    case 'table':
      solid.push(box(1.1, 0.05, 0.6, 0, 0.425, 0, hex));
      for (const [x, z] of [[-0.5, -0.24], [0.5, -0.24], [-0.5, 0.24], [0.5, 0.24]]) {
        solid.push(box(0.05, 0.4, 0.05, x, 0.2, z, hex, 0.75));
      }
      break;
    case 'rug':
      solid.push(
        box(2.2, 0.01, 1.5, 0, 0.006, 0, hex),
        box(1.9, 0.01, 1.2, 0, 0.011, 0, hex, 1.25),
        box(1.5, 0.01, 0.8, 0, 0.016, 0, hex, 0.85),
      );
      break;
    case 'plant':
      solid.push(
        cyl(0.2, 0.15, 0.4, 0, 0.2, 0, hex),
        cyl(0.18, 0.18, 0.02, 0, 0.39, 0, '#3a2a1c'),
        ball(0.3, 0, 0.72, 0, LEAF, [1, 1.15, 1]),
        ball(0.2, 0.12, 0.98, -0.05, LEAF, [1, 1, 1], 1.15),
      );
      break;
    case 'lamp':
      solid.push(
        cyl(0.18, 0.2, 0.04, 0, 0.02, 0, DARK),
        cyl(0.015, 0.015, 1.5, 0, 0.78, 0, DARK, 6),
      );
      unlit.push(cyl(0.16, 0.24, 0.32, 0, 1.62, 0, hex, 12, 1, true));
      break;
    case 'led': {
      const y = HOUSE_RULES.LED_HEIGHT;
      unlit.push(box(def.w, 0.035, 0.03, 0, y, 0.02, hex));
      // Duvara vuran renkli ışık: aşağı ve yanlara doğru sönen yumuşak bir leke
      glow.push(colored(new THREE.PlaneGeometry(def.w + 0.8, 1.7).translate(0, y - 0.6, 0.008), hex));
      break;
    }
    case 'ceilLed': {
      const y = HOUSE_RULES.CEIL_HEIGHT;
      unlit.push(box(def.w, 0.025, 0.035, 0, y - 0.0125, 0, hex));
      ceilingGlow(glow, def.w, y, hex);
      break;
    }
    case 'bed': {
      // Başucu -Z tarafında
      solid.push(
        box(1.5, 0.28, 2.1, 0, 0.14, 0, WOOD),
        box(1.5, 0.95, 0.08, 0, 0.475, -1.01, WOOD, 0.85),
        box(1.4, 0.2, 1.98, 0, 0.38, 0.02, '#f4f1e8'),
        box(1.44, 0.06, 1.34, 0, 0.5, 0.36, hex),
        box(1.44, 0.18, 0.06, 0, 0.42, 1.03, hex, 0.88),
        box(0.56, 0.12, 0.34, -0.36, 0.53, -0.76, '#ffffff'),
        box(0.56, 0.12, 0.34, 0.36, 0.53, -0.76, '#ffffff'),
      );
      break;
    }
    case 'cornerSofa': {
      // L: arka (-Z) boyunca tam genişlik + sol (-X) kol boyunca
      solid.push(
        box(2.0, 0.08, 0.86, 0, 0.04, -0.57, DARK),
        box(2.0, 0.34, 0.86, 0, 0.25, -0.57, hex),
        box(0.86, 0.08, 1.14, -0.57, 0.04, 0.43, DARK),
        box(0.86, 0.34, 1.14, -0.57, 0.25, 0.43, hex),
        box(2.0, 0.52, 0.2, 0, 0.68, -0.9, hex, 0.82),
        box(0.2, 0.52, 1.8, -0.9, 0.68, 0.1, hex, 0.82),
        box(0.18, 0.24, 0.86, 0.91, 0.54, -0.57, hex, 0.9),
        box(0.86, 0.24, 0.18, -0.57, 0.54, 0.91, hex, 0.9),
        box(0.75, 0.1, 0.62, 0.45, 0.47, -0.52, hex, 1.12),
        box(0.62, 0.1, 0.75, -0.52, 0.47, -0.4, hex, 1.12),
        box(0.62, 0.1, 0.75, -0.52, 0.47, 0.42, hex, 1.12),
      );
      break;
    }
    case 'bookcase': {
      const W = 1.2;
      const D = 0.4;
      const H = 2.0;
      solid.push(
        box(0.04, H, D, -W / 2 + 0.02, H / 2, 0, hex),
        box(0.04, H, D, W / 2 - 0.02, H / 2, 0, hex),
        box(W, 0.02, D, 0, H - 0.01, 0, hex),
        box(W - 0.06, H - 0.04, 0.02, 0, H / 2, -D / 2 + 0.01, hex, 0.7),
      );
      const levels = [0.05, 0.45, 0.85, 1.25, 1.62];
      levels.forEach((ly, i) => {
        solid.push(box(W - 0.06, 0.03, D - 0.03, 0, ly, 0.01, hex, 0.92));
        books(solid, -W / 2 + 0.06, W / 2 - 0.06, ly + 0.015, 0.02, 0.26, i * 3 + 1);
      });
      break;
    }
    case 'shelf': {
      const y = HOUSE_RULES.PAINT_HEIGHT - 0.15;
      solid.push(box(1.2, 0.035, 0.24, 0, y, 0.12, hex));
      for (const x of [-0.45, 0.45]) solid.push(box(0.03, 0.14, 0.18, x, y - 0.08, 0.09, DARK));
      books(solid, -0.55, 0.15, y + 0.018, 0.12, 0.18, 2);
      solid.push(
        cyl(0.06, 0.05, 0.11, 0.33, y + 0.07, 0.12, '#b5462f'),
        ball(0.09, 0.33, y + 0.19, 0.12, LEAF),
        box(0.12, 0.16, 0.02, 0.5, y + 0.1, 0.06, '#e8e4dc'),
      );
      break;
    }
    case 'painting': {
      const y = HOUSE_RULES.PAINT_HEIGHT;
      const frame = ['#6b4428', '#c9a25e', '#1c1c1f'][(opts.color ?? 0) % 3];
      solid.push(box(def.w, def.h, 0.04, 0, y, 0.02, frame));
      artwork(solid, opts.color ?? 0, def.w - 0.1, def.h - 0.1, y, 0.042);
      break;
    }
    case 'pot': {
      solid.push(
        cyl(0.22, 0.16, 0.36, 0, 0.18, 0, hex, 12),
        cyl(0.24, 0.24, 0.05, 0, 0.36, 0, hex, 12, 0.85),
        cyl(0.205, 0.205, 0.02, 0, 0.37, 0, SOIL, 12),
      );
      if (opts.plant) plantModel(solid, opts.plant.kind, opts.plant.stage, 0.38);
      break;
    }
    default:
      solid.push(box(def.w, 0.5, def.d, 0, 0.25, 0, hex));
  }
  return { solid, unlit, glow, screen };
}

/** LED ışığı için sönümlü degrade doku (bir kez üretilir) */
export function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const u = (x / 127) * 2 - 1; // -1..1 yatay
      const v = y / 127; // 0 üst (şerit) → 1 alt
      const a = Math.max(0, 1 - u * u) ** 1.5 * Math.max(0, 1 - v) ** 2.2;
      const i = (y * 128 + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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

/**
 * @returns {{ solid: BufferGeometry[], unlit: BufferGeometry[], glow: BufferGeometry[],
 *             screen?: { w: number, h: number, y: number, z: number } }}
 *   solid: ışıktan etkilenen; unlit: kendi ışığı olan (LED, abajur); glow: duvara vuran ışık (additive)
 */
export function buildFurniture(def, hex) {
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

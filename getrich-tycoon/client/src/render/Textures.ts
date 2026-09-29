// Procedurally generated canvas textures (no external assets).

import * as THREE from 'three';
import { mulberry32 } from '../../../shared/util';

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function noise(key: string, base: [number, number, number], variance: number, size = 256, speckle = 0): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const rng = mulberry32(size * 31 + base[0]);
  for (let i = 0; i < size * size; i++) {
    const n = (rng() - 0.5) * variance;
    const s = speckle && rng() < speckle ? (rng() - 0.5) * variance * 3 : 0;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + n + s));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n + s));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n + s));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c);
  cache.set(key, t);
  return t;
}

export const Tex = {
  asphalt: () => noise('asphalt', [62, 65, 72], 22, 256, 0.02),
  lot: () => noise('lot', [88, 91, 98], 18, 256, 0.02),
  concrete: () => noise('concrete', [178, 178, 172], 16, 256, 0.01),
  paving: () => {
    const key = 'paving';
    const hit = cache.get(key);
    if (hit) return hit;
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#c9c1b3';
    g.fillRect(0, 0, 256, 256);
    const rng = mulberry32(7);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const v = 185 + Math.floor(rng() * 30);
        g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
        g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
      }
    const t = toTexture(c);
    cache.set(key, t);
    return t;
  },
  grass: () => noise('grass', [78, 138, 64], 34, 256, 0.04),

  windows(key: string, wall: string, glass: string, lit: string, cols: number, rows: number): THREE.Texture {
    const id = `win:${key}:${wall}:${cols}x${rows}`;
    const hit = cache.get(id);
    if (hit) return hit;
    const [c, g] = canvas(256, 256);
    g.fillStyle = wall;
    g.fillRect(0, 0, 256, 256);
    const rng = mulberry32(cols * 97 + rows);
    const cw = 256 / cols;
    const rh = 256 / rows;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        g.fillStyle = rng() < 0.28 ? lit : glass;
        g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.2, cw * 0.64, rh * 0.55);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.2, cw * 0.64, rh * 0.08);
      }
    const t = toTexture(c);
    cache.set(id, t);
    return t;
  },

  rollerDoor(): THREE.Texture {
    const key = 'roller';
    const hit = cache.get(key);
    if (hit) return hit;
    const [c, g] = canvas(128, 128);
    for (let y = 0; y < 128; y += 8) {
      g.fillStyle = y % 16 === 0 ? '#9aa1ab' : '#b8bec7';
      g.fillRect(0, y, 128, 8);
    }
    const t = toTexture(c);
    cache.set(key, t);
    return t;
  },

  /** Dirt splatter with alpha, used as an overlay on dirty vehicles. */
  dirt(): THREE.Texture {
    const key = 'dirt';
    const hit = cache.get(key);
    if (hit) return hit;
    const [c, g] = canvas(256, 256);
    g.clearRect(0, 0, 256, 256);
    const rng = mulberry32(99);
    for (let i = 0; i < 900; i++) {
      const x = rng() * 256;
      const y = 256 - Math.pow(rng(), 0.55) * 256; // denser near the bottom
      const r = 1 + rng() * 7;
      const a = 0.25 + rng() * 0.55;
      g.fillStyle = `rgba(${90 + rng() * 30}, ${66 + rng() * 20}, ${40 + rng() * 15}, ${a})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    const grad = g.createLinearGradient(0, 256, 0, 120);
    grad.addColorStop(0, 'rgba(96,72,44,0.85)');
    grad.addColorStop(1, 'rgba(96,72,44,0)');
    g.fillStyle = grad;
    g.fillRect(0, 120, 256, 136);
    const t = toTexture(c);
    cache.set(key, t);
    return t;
  },

  /** 2x2 twill carbon-fibre weave for carbon body parts. */
  carbon(): THREE.Texture {
    const key = 'carbon';
    const hit = cache.get(key);
    if (hit) return hit;
    const [c, g] = canvas(64, 64);
    const cell = 8;
    for (let y = 0; y < 64 / cell; y++) {
      for (let x = 0; x < 64 / cell; x++) {
        const along = ((x + y) >> 1) % 2 === 0;
        const grad = along ? g.createLinearGradient(x * cell, 0, x * cell + cell, 0) : g.createLinearGradient(0, y * cell, 0, y * cell + cell);
        grad.addColorStop(0, '#15171b');
        grad.addColorStop(0.5, along ? '#3a3f47' : '#2a2e35');
        grad.addColorStop(1, '#121417');
        g.fillStyle = grad;
        g.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    const t = toTexture(c);
    t.repeat.set(6, 6);
    cache.set(key, t);
    return t;
  },

  /** Text sign texture. */
  sign(text: string, opts: { bg?: string; fg?: string; accent?: string; w?: number; h?: number; font?: number; sub?: string } = {}): THREE.Texture {
    const w = opts.w ?? 1024;
    const h = opts.h ?? 192;
    const [c, g] = canvas(w, h);
    const bg = opts.bg ?? '#101828';
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (opts.accent) {
      g.fillStyle = opts.accent;
      g.fillRect(0, h - 14, w, 14);
      g.fillRect(0, 0, w, 6);
    }
    g.fillStyle = opts.fg ?? '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = opts.font ?? Math.floor(h * 0.52);
    g.font = `900 ${size}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
    while (g.measureText(text).width > w * 0.92 && size > 10) {
      size -= 2;
      g.font = `900 ${size}px sans-serif`;
    }
    g.fillText(text, w / 2, opts.sub ? h * 0.4 : h / 2);
    if (opts.sub) {
      g.font = `700 ${Math.floor(h * 0.2)}px sans-serif`;
      g.globalAlpha = 0.8;
      g.fillText(opts.sub, w / 2, h * 0.78);
      g.globalAlpha = 1;
    }
    return toTexture(c, false);
  },
};

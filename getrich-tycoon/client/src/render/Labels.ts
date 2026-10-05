// Canvas-texture sprites for name tags and price tags.

import * as THREE from 'three';

export interface LabelOptions {
  color?: string;
  bg?: string;
  sub?: string;
  subColor?: string;
  /** World height of the label in metres. */
  height?: number;
  badge?: string;
  badgeColor?: string;
}

export function drawLabel(text: string, opts: LabelOptions = {}): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '800 40px system-ui, sans-serif';
  const subFont = '700 28px system-ui, sans-serif';
  g.font = font;
  const tw = g.measureText(text).width;
  g.font = subFont;
  const sw = opts.sub ? g.measureText(opts.sub).width : 0;
  g.font = '900 30px system-ui, sans-serif';
  const bw = opts.badge ? g.measureText(opts.badge).width + 26 : 0;
  const w = Math.ceil(Math.max(tw + bw + (opts.badge ? 14 : 0), sw) + 44);
  const h = opts.sub ? 104 : 64;
  c.width = w;
  c.height = h;
  const r = 18;
  g.fillStyle = opts.bg ?? 'rgba(12,16,28,0.78)';
  g.beginPath();
  g.roundRect(0, 0, w, h, r);
  g.fill();
  let x = w / 2 - (tw + bw + (opts.badge ? 14 : 0)) / 2;
  if (opts.badge) {
    g.fillStyle = opts.badgeColor ?? '#4f8cff';
    g.beginPath();
    g.roundRect(x, 12, bw, 40, 10);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '900 30px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(opts.badge, x + bw / 2, 33);
    x += bw + 14;
  }
  g.font = font;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = opts.color ?? '#ffffff';
  g.fillText(text, x, 33);
  if (opts.sub) {
    g.font = subFont;
    g.textAlign = 'center';
    g.fillStyle = opts.subColor ?? '#2ee59d';
    g.fillText(opts.sub, w / 2, 80);
  }
  return c;
}

export class Label {
  readonly sprite: THREE.Sprite;
  private key = '';
  private readonly material: THREE.SpriteMaterial;

  constructor(text: string, opts: LabelOptions = {}) {
    this.material = new THREE.SpriteMaterial({ depthWrite: false, transparent: true, fog: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 10;
    this.set(text, opts);
  }

  set(text: string, opts: LabelOptions = {}): void {
    const key = JSON.stringify([text, opts]);
    if (key === this.key) return;
    this.key = key;
    const canvas = drawLabel(text, opts);
    this.material.map?.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    this.material.map = tex;
    this.material.needsUpdate = true;
    const height = opts.height ?? (opts.sub ? 0.62 : 0.38);
    this.sprite.scale.set((canvas.width / canvas.height) * height, height, 1);
  }

  dispose(): void {
    this.material.map?.dispose();
    this.material.dispose();
  }
}

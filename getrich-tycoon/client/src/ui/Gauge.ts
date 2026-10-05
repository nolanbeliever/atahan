// Cockpit gauge cluster (bottom right while driving): analog rev counter with a redline and shift
// light, digital speed, gear, turbo boost (psi), the car's tuning stage, ABS / traction lights and
// the driving bonus pop-up.

import { h } from './dom';

export interface GaugeState {
  kmh: number;
  rpm: number;
  redline: number;
  /** -1 reverse, 0 neutral, 1..n */
  gear: number;
  /** Current and peak boost (psi); max 0 = no forced induction. */
  psi: number;
  maxPsi: number;
  electric: boolean;
  /** ECU stage 0-3. */
  stage: number;
  abs: boolean;
  slip: boolean;
  limiter: boolean;
}

export class GaugeHud {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bonus: HTMLElement;
  private size = 230;
  private shown = -1;
  private flash = 0;

  constructor() {
    this.canvas = h('canvas', { class: 'gauge-canvas', 'data-testid': 'gauge' });
    this.ctx = this.canvas.getContext('2d')!;
    this.bonus = h('div', { class: 'drive-bonus', 'data-testid': 'drive-bonus' });
    this.el = h('div', { class: 'gauge-cluster' }, this.canvas, this.bonus);
    this.resize();
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** "+$150 (Driving Bonus)" floating up next to the gauge. */
  showBonus(amount: number): void {
    this.bonus.textContent = `+$${amount.toLocaleString('en-US')} (Driving Bonus)`;
    this.bonus.classList.remove('show');
    void this.bonus.offsetWidth;
    this.bonus.classList.add('show');
  }

  draw(s: GaugeState, dt: number): void {
    this.flash += dt;
    const g = this.ctx;
    const S = this.size;
    const cx = S / 2;
    const cy = S / 2 + 6;
    const R = S / 2 - 12;
    g.clearRect(0, 0, S, S);
    // Face.
    const face = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R + 8);
    face.addColorStop(0, 'rgba(14,18,30,0.82)');
    face.addColorStop(1, 'rgba(6,9,16,0.62)');
    g.fillStyle = face;
    g.beginPath();
    g.arc(cx, cy, R + 8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1.5;
    g.stroke();

    // Rev counter: 240 degree sweep.
    const a0 = (-210 * Math.PI) / 180;
    const a1 = (30 * Math.PI) / 180;
    const maxK = s.electric ? Math.ceil(s.redline / 2000) * 2 : Math.max(6, Math.ceil((s.redline + 600) / 1000));
    const toA = (rpm: number) => a0 + (a1 - a0) * Math.min(1, Math.max(0, rpm / (maxK * 1000)));
    // Red zone.
    if (!s.electric) {
      g.strokeStyle = 'rgba(255,60,70,0.85)';
      g.lineWidth = 7;
      g.beginPath();
      g.arc(cx, cy, R - 6, toA(s.redline), a1);
      g.stroke();
    }
    // Lit bar up to the current rpm.
    const frac = s.rpm / Math.max(1, s.redline);
    g.strokeStyle = frac > 0.93 ? '#ff4d5e' : frac > 0.8 ? '#ffc53d' : '#4fd1ff';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, R - 15, a0, toA(s.rpm));
    g.stroke();
    // Ticks and numbers.
    const step = s.electric ? 2 : 1;
    for (let k = 0; k <= maxK; k += step) {
      const a = toA(k * 1000);
      g.strokeStyle = 'rgba(235,240,248,0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22));
      g.lineTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10));
      g.stroke();
      g.fillStyle = k * 1000 >= s.redline && !s.electric ? '#ff6b78' : 'rgba(235,240,248,0.9)';
      g.font = '700 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(k), cx + Math.cos(a) * (R - 34), cy + Math.sin(a) * (R - 34));
    }
    // Needle.
    const na = toA(s.rpm);
    g.strokeStyle = '#ff3b30';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - Math.cos(na) * 10, cy - Math.sin(na) * 10);
    g.lineTo(cx + Math.cos(na) * (R - 18), cy + Math.sin(na) * (R - 18));
    g.stroke();
    g.fillStyle = '#1b2130';
    g.beginPath();
    g.arc(cx, cy, 7, 0, Math.PI * 2);
    g.fill();

    // Shift light near the redline.
    const shift = !s.electric && frac > 0.94;
    if (shift && this.flash % 0.16 < 0.09) {
      g.fillStyle = '#ff2a3b';
      g.beginPath();
      g.arc(cx, cy - R + 26, 6, 0, Math.PI * 2);
      g.fill();
    }

    // Digital speed in the middle.
    g.fillStyle = '#ffffff';
    g.font = '900 42px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(Math.round(s.kmh)), cx, cy + 6);
    g.fillStyle = 'rgba(200,210,225,0.8)';
    g.font = '700 10px system-ui, sans-serif';
    g.fillText('KM/H', cx, cy + 30);
    g.fillStyle = 'rgba(200,210,225,0.7)';
    g.font = '700 9px system-ui, sans-serif';
    g.fillText(s.electric ? 'x1000 r/min (motor)' : 'x1000 r/min', cx, cy - 32);
    // Bottom gap of the dial: stage badge, gear box, ABS / TCS light.
    const ry = cy + 54;
    const gear = s.gear < 0 ? 'R' : s.gear === 0 ? 'N' : String(s.gear);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.strokeStyle = s.limiter ? '#ff4d5e' : 'rgba(255,197,61,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(cx - 15, ry - 15, 30, 30, 6);
    else g.rect(cx - 15, ry - 15, 30, 30);
    g.fill();
    g.stroke();
    g.fillStyle = s.limiter ? '#ff4d5e' : '#ffc53d';
    g.font = '900 22px system-ui, sans-serif';
    g.fillText(gear, cx, ry + 1);

    // Boost bar (psi) along the bottom.
    const by = cy + 80;
    if (s.maxPsi > 0) {
      const w = 88;
      const x0 = cx - w / 2;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x0, by, w, 5);
      g.fillStyle = '#39d98a';
      g.fillRect(x0, by, (w * Math.max(0, Math.min(1, s.psi / s.maxPsi))), 5);
      g.fillStyle = 'rgba(220,230,240,0.9)';
      g.font = '800 10px system-ui, sans-serif';
      g.font = '800 9px system-ui, sans-serif';
      g.fillText(`TURBO ${s.psi.toFixed(1)} PSI`, cx, by + 13);
    } else {
      g.fillStyle = 'rgba(200,210,225,0.6)';
      g.font = '800 9px system-ui, sans-serif';
      g.fillText(s.electric ? 'ELECTRIC' : 'N/A', cx, by + 4);
    }
    const stage = s.stage > 0 ? `ST${s.stage}` : 'STOCK';
    g.fillStyle = s.stage >= 3 ? '#ff6b3d' : s.stage === 2 ? '#ffc53d' : s.stage === 1 ? '#4fd1ff' : 'rgba(200,210,225,0.55)';
    g.font = '900 9px system-ui, sans-serif';
    g.fillText(stage, cx - 38, ry + 1);
    // Warning lights.
    const warn = s.abs ? 'ABS' : s.slip ? 'TCS' : '';
    if (warn) {
      g.fillStyle = '#ffb020';
      g.font = '900 10px system-ui, sans-serif';
      g.fillText(warn, cx + 38, ry + 1);
    }
    this.shown = s.kmh;
  }

  get lastSpeed(): number {
    return this.shown;
  }
}

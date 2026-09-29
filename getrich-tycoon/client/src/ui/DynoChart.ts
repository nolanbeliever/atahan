// Dyno sheet: power (hp) and torque (Nm) against rpm, stock (dashed) against the build (solid),
// with a moving rpm cursor during a dyno pull.

import type { DynoCurve } from '../../../shared/tuningSystem';

const HP_COLOR = '#ff7a45';
const NM_COLOR = '#4f8cff';

export class DynoChart {
  readonly el: HTMLCanvasElement;
  stock: DynoCurve | null = null;
  build: DynoCurve | null = null;
  /** Rpm of the moving cursor (null = no cursor). */
  cursor: number | null = null;

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'dyno-chart';
    this.el.setAttribute('data-testid', 'dyno-chart');
  }

  /** Values of the build curve at an rpm (linear interpolation). */
  sample(rpm: number): { hp: number; torque: number } {
    const c = this.build;
    if (!c) return { hp: 0, torque: 0 };
    const r = c.rpm;
    if (rpm <= r[0]!) return { hp: c.hp[0]!, torque: c.torque[0]! };
    for (let i = 1; i < r.length; i++) {
      if (rpm <= r[i]!) {
        const t = (rpm - r[i - 1]!) / Math.max(1, r[i]! - r[i - 1]!);
        return { hp: c.hp[i - 1]! + (c.hp[i]! - c.hp[i - 1]!) * t, torque: c.torque[i - 1]! + (c.torque[i]! - c.torque[i - 1]!) * t };
      }
    }
    return { hp: c.hp[c.hp.length - 1]!, torque: c.torque[c.torque.length - 1]! };
  }

  draw(): void {
    const el = this.el;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(200, el.clientWidth || 600);
    const h = Math.max(160, el.clientHeight || 260);
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    const g = el.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#12151b';
    g.fillRect(0, 0, w, h);
    const curves = [this.stock, this.build].filter((c): c is DynoCurve => !!c);
    if (!curves.length) return;
    const pad = { l: 44, r: 44, t: 16, b: 28 };
    const maxRpm = Math.max(...curves.map((c) => c.redline));
    const minRpm = Math.min(...curves.map((c) => c.idle));
    const niceMax = (v: number) => {
      const step = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))) / 2;
      return Math.ceil((v * 1.1) / step) * step;
    };
    const maxHp = niceMax(Math.max(...curves.map((c) => c.peakHp)));
    const maxNm = niceMax(Math.max(...curves.map((c) => c.peakTorque)));
    const X = (rpm: number) => pad.l + ((rpm - minRpm) / Math.max(1, maxRpm - minRpm)) * (w - pad.l - pad.r);
    const Yhp = (v: number) => h - pad.b - (v / maxHp) * (h - pad.t - pad.b);
    const Ynm = (v: number) => h - pad.b - (v / maxNm) * (h - pad.t - pad.b);

    // Grid and axes
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ((h - pad.t - pad.b) * i) / 4;
      g.beginPath();
      g.moveTo(pad.l, y);
      g.lineTo(w - pad.r, y);
      g.stroke();
      g.textAlign = 'right';
      g.fillStyle = HP_COLOR;
      g.fillText(String(Math.round(maxHp * (1 - i / 4))), pad.l - 6, y + 3);
      g.textAlign = 'left';
      g.fillStyle = NM_COLOR;
      g.fillText(String(Math.round(maxNm * (1 - i / 4))), w - pad.r + 6, y + 3);
    }
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.textAlign = 'center';
    const step = maxRpm > 10000 ? 2000 : 1000;
    for (let r = Math.ceil(minRpm / step) * step; r <= maxRpm; r += step) {
      const x = X(r);
      g.beginPath();
      g.moveTo(x, pad.t);
      g.lineTo(x, h - pad.b);
      g.stroke();
      g.fillText(`${r / 1000}k`, x, h - pad.b + 14);
    }
    g.fillText('rpm', w - pad.r, h - 4);
    g.textAlign = 'left';
    g.fillStyle = HP_COLOR;
    g.fillText('hp', 6, 12);
    g.textAlign = 'right';
    g.fillStyle = NM_COLOR;
    g.fillText('Nm', w - 6, 12);

    const line = (c: DynoCurve, key: 'hp' | 'torque', color: string, dashed: boolean) => {
      g.strokeStyle = color;
      g.lineWidth = dashed ? 1.5 : 2.6;
      g.setLineDash(dashed ? [5, 4] : []);
      g.globalAlpha = dashed ? 0.55 : 1;
      g.beginPath();
      c.rpm.forEach((r, i) => {
        const y = key === 'hp' ? Yhp(c.hp[i]!) : Ynm(c.torque[i]!);
        if (i === 0) g.moveTo(X(r), y);
        else g.lineTo(X(r), y);
      });
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    };
    if (this.stock && this.build) {
      line(this.stock, 'torque', NM_COLOR, true);
      line(this.stock, 'hp', HP_COLOR, true);
    }
    const main = this.build ?? this.stock!;
    line(main, 'torque', NM_COLOR, false);
    line(main, 'hp', HP_COLOR, false);

    // Peak markers
    g.fillStyle = HP_COLOR;
    g.beginPath();
    g.arc(X(main.peakHpRpm), Yhp(main.peakHp), 3.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = NM_COLOR;
    g.beginPath();
    g.arc(X(main.peakTorqueRpm), Ynm(main.peakTorque), 3.5, 0, Math.PI * 2);
    g.fill();

    if (this.cursor !== null && this.build) {
      const x = X(this.cursor);
      const v = this.sample(this.cursor);
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, pad.t);
      g.lineTo(x, h - pad.b);
      g.stroke();
      for (const [y, col] of [
        [Yhp(v.hp), HP_COLOR],
        [Ynm(v.torque), NM_COLOR],
      ] as const) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, y, 4.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

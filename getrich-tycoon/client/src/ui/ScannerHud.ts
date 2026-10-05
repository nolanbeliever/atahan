// The police scanner panel (top left, under the wanted stars): the radio waveform while the
// dispatcher talks, the last lines of police radio, and while a call is out for you the police on
// their way: the estimate when the call went out, or with the Police Scanner fitted (Chroma
// Customs) the live countdown to the first car on the scene. Plus the yellow "POLİS İHBAR EDİLDİ"
// strip across the top of the screen when a call goes out.

import type { PoliceCall, RadioLine, WantedState } from '../../../shared/police';
import { h } from './dom';

const SHOW_AFTER_MS = 9000;

export class ScannerHud {
  readonly el: HTMLElement;
  /** The yellow strip across the top of the screen (a new call). */
  readonly strip: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private lines: HTMLElement;
  private eta: HTMLElement;
  private etaBig: HTMLElement;
  private etaSub: HTMLElement;
  private tag: HTMLElement;
  private stripText: HTMLElement;
  private stripTimer = 0;
  private talkUntil = 0;
  private lastLineAt = -Infinity;
  private call: PoliceCall | null = null;
  private scanner = false;
  /** Local countdown between server updates (s, and when it was set). */
  private liveEta: { sec: number; at: number } | null = null;
  private phase = 0;

  constructor() {
    this.canvas = h('canvas', { class: 'scanner-wave', width: 236, height: 34 }) as HTMLCanvasElement;
    this.g = this.canvas.getContext('2d')!;
    this.tag = h('span', { class: 'scanner-tag' }, '');
    this.lines = h('div', { class: 'scanner-lines', 'data-testid': 'scanner-lines' });
    this.etaBig = h('div', { class: 'scanner-eta-big', 'data-testid': 'scanner-eta' });
    this.etaSub = h('div', { class: 'scanner-eta-sub' });
    this.eta = h('div', { class: 'scanner-eta' }, this.etaBig, this.etaSub);
    this.el = h('div', { class: 'scanner', 'data-testid': 'scanner' }, h('div', { class: 'scanner-head' }, h('span', { class: 'scanner-dot' }), h('span', null, '📻 POLİS TELSİZİ · 155'), this.tag), this.canvas, this.lines, this.eta);
    this.stripText = h('div', { class: 'pcs-text', 'data-testid': 'police-call' });
    this.strip = h('div', { class: 'police-call-strip' }, h('div', { class: 'pcs-icon' }, '🚨'), this.stripText);
  }

  /** A line on the radio. */
  radio(line: RadioLine, talkSec: number, now = performance.now()): void {
    this.talkUntil = now + talkSec * 1000;
    this.lastLineAt = now;
    const el = h('div', { class: `scanner-line ${line.tone}` }, line.text);
    this.lines.prepend(el);
    while (this.lines.children.length > 3) this.lines.lastElementChild!.remove();
    if (line.tone === 'call' && line.eta !== undefined) this.showStrip(line.eta);
    this.refresh(now);
  }

  /** The yellow strip: "POLİS İHBAR EDİLDİ - Tahmini Geliş Süresi: 00:45". */
  private showStrip(eta: number): void {
    this.stripText.textContent = `POLİS İHBAR EDİLDİ - Tahmini Geliş Süresi: ${mmss(eta)}`;
    this.strip.classList.remove('show');
    void this.strip.offsetWidth;
    this.strip.classList.add('show');
    window.clearTimeout(this.stripTimer);
    this.stripTimer = window.setTimeout(() => this.strip.classList.remove('show'), 5200);
  }

  set(w: WantedState, now = performance.now()): void {
    const was = this.call;
    this.call = w.call ?? null;
    this.scanner = !!w.scanner;
    if (this.call?.eta !== undefined) this.liveEta = { sec: this.call.eta, at: now };
    else this.liveEta = null;
    if (was && !this.call) this.lastLineAt = now;
    this.refresh(now);
  }

  private refresh(now: number): void {
    const c = this.call;
    const visible = !!c || now - this.lastLineAt < SHOW_AFTER_MS || now < this.talkUntil;
    this.el.classList.toggle('show', visible);
    this.el.classList.toggle('live', this.scanner);
    this.tag.textContent = this.scanner ? 'CANLI' : '';
    this.eta.style.display = c ? '' : 'none';
    if (!c) return;
    const units = `${c.cars} ekip${c.swat ? ` (${c.swat} SWAT)` : ''}${c.heli ? ' · 🚁' : ''}`;
    if (c.arrived) {
      this.etaBig.textContent = 'POLİS OLAY YERİNDE';
      this.etaSub.textContent = `${units} · şüpheliyi arıyorlar: görünme!`;
      this.eta.className = 'scanner-eta arrived';
    } else if (this.scanner && this.liveEta) {
      const left = Math.max(0, Math.ceil(this.liveEta.sec - (now - this.liveEta.at) / 1000));
      this.etaBig.textContent = `⏱ ${mmss(left)}`;
      this.etaSub.textContent = `İntikal: ${units} yolda · ilk ekip ${left} sn sonra olay yerinde`;
      this.eta.className = `scanner-eta live${left <= 10 ? ' soon' : ''}`;
    } else {
      this.etaBig.textContent = `~${mmss(c.eta0)}`;
      this.etaSub.textContent = `Tahmini geliş (ihbar anında) · ${units} yolda. Canlı sayaç: Chroma Customs → 📻 Polis Telsiz Dinleyici`;
      this.eta.className = 'scanner-eta';
    }
  }

  /** Every frame: the waveform and the live countdown. */
  update(dt: number, now = performance.now()): void {
    if (!this.el.classList.contains('show')) {
      if (this.call || now - this.lastLineAt < SHOW_AFTER_MS) this.refresh(now);
      return;
    }
    if (this.call && !this.call.arrived && this.scanner) this.refresh(now);
    else if (!this.call && now - this.lastLineAt >= SHOW_AFTER_MS && now >= this.talkUntil) this.refresh(now);
    this.phase += dt;
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    const talking = now < this.talkUntil;
    // Faint grid, then the trace: a lively voice while talking, a low hiss otherwise.
    g.strokeStyle = 'rgba(120,255,170,0.12)';
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 18) {
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, H);
      g.stroke();
    }
    g.strokeStyle = talking ? '#7dffb0' : 'rgba(125,255,176,0.55)';
    g.lineWidth = 1.6;
    g.beginPath();
    const t = this.phase;
    for (let x = 0; x <= W; x += 2) {
      const k = x / W;
      const env = talking ? 0.35 + 0.65 * Math.abs(Math.sin(t * 3.1 + k * 5.3)) * (0.5 + 0.5 * Math.sin(t * 7.7 + k * 13)) : 0.06;
      const y = H / 2 + Math.sin(k * 60 + t * 38) * env * (H * 0.42) * (0.6 + 0.4 * Math.sin(k * 23 + t * 11)) + (Math.random() - 0.5) * (talking ? 3 : 1.4);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

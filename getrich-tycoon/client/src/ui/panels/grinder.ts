// The angle grinder (Avuç Taşlama): cutting through a container's three locking bars. Hold the
// mouse button / Space / the CUT button and the disc bites into the bar under it, sparks fountain,
// the cut deepens; the blade heats up while it cuts, and past the red line it jams (a second's
// pause and a bit of the cut lost). Let go and it cools. All three bars through before the time runs
// out and the doors are open (the server checks it took long enough). Every listener the panel adds
// is taken off again when it closes, and keys held when it opened are let go.

import { ECONOMY } from '../../../../shared/economy.config';
import { clamp } from '../../../../shared/util';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';

const W = 560;
const H = 360;
const BARS = 3;
const D = ECONOMY.docks;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export class GrinderPanel extends Panel {
  readonly name = 'grinder';
  override size = 'medium' as const;
  override closeOnBackdrop = false;
  private readonly containerId = String(this.arg.containerId ?? '');
  private readonly cutSec = Number(this.arg.cutSec ?? D.cutSec);
  private readonly expiresAt = Date.now() + Number(this.arg.cutSec ?? D.cutSec) * 1000;
  private canvas = h('canvas', { class: 'lp-canvas', 'data-testid': 'grinder-canvas' });
  private cutBtn = h('button', { class: 'btn primary lp-turn', 'data-testid': 'grinder-cut' }, 'KES · Hold to cut');
  private root: HTMLElement | null = null;
  private unbind: (() => void)[] = [];
  private holding = { mouse: false, key: false, button: false };
  /** Cut depth of each bar (0-1), the blade's heat (0-1), jammed until (s). */
  private cuts = new Array<number>(BARS).fill(0);
  private bar = 0;
  private heat = 0;
  private jam = 0;
  private spin = 0;
  private sparks: Spark[] = [];
  private state: 'cut' | 'done' | 'fail' = 'cut';
  private stateT = 0;
  private finished = false;
  private raf = 0;
  private last = performance.now();
  private soundT = 0;
  private message = 'Basılı tut: kes · Bırak: soğut. Kırmızıya girme, disk sıkışır!';
  private messageColor = '#cfd6e6';

  title() {
    return 'Avuç Taşlama · Konteyner Kilidi';
  }
  override subtitle() {
    return `${this.containerId} · ${BARS} kilit kolu`;
  }
  iconSvg() {
    return ICONS.lockpick;
  }

  private get cutting(): boolean {
    return this.state === 'cut' && this.jam <= 0 && (this.holding.mouse || this.holding.key || this.holding.button);
  }

  override init(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, ev: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(ev, fn as EventListener, opts);
      this.unbind.push(() => target.removeEventListener(ev, fn as EventListener, opts));
    };
    // The grinder owns the keyboard while it is open (Space would jump, W would walk).
    const key = (e: KeyboardEvent, down: boolean) => {
      if (e.code === 'Escape') return;
      if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'Enter' || e.code === 'KeyE') {
        this.holding.key = down;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    on(window, 'keydown', (e) => key(e, true), { capture: true });
    on(window, 'keyup', (e) => key(e, false), { capture: true });
    on(window, 'blur', () => (this.holding = { mouse: false, key: false, button: false }));
    on(this.canvas, 'pointerdown', (e) => {
      e.preventDefault();
      this.holding.mouse = true;
    });
    on(window, 'pointerup', () => (this.holding.mouse = false));
    on(this.cutBtn, 'pointerdown', (e) => {
      e.preventDefault();
      this.holding.button = true;
    });
    on(this.cutBtn, 'pointerup', () => (this.holding.button = false));
    on(this.cutBtn, 'pointerleave', () => (this.holding.button = false));
    this.game.input.releaseAll();
    this.game.working = true;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      try {
        this.step(dt);
        this.draw();
      } catch (err) {
        console.warn('grinder frame', err);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  renderBody(): Child {
    this.root ??= h(
      'div',
      { class: 'lockpick', 'data-testid': 'grinder' },
      this.canvas,
      h(
        'div',
        { class: 'lp-help' },
        h('span', null, h('span', { class: 'kbd' }, 'Click'), h('span', { class: 'kbd' }, 'Space'), 'basılı tut: kes'),
        h('span', null, 'bırak: disk soğur'),
        h('span', null, h('span', { class: 'kbd' }, 'Esc'), 'Vazgeç'),
      ),
      h('div', { class: 'lp-tip' }, 'İpucu: ısı göstergesi sarıdayken kısa kısa kes; kırmızıya girerse disk sıkışır ve kesiğin bir kısmı kaybolur.'),
      this.cutBtn,
    );
    return this.root;
  }

  override onStoreChange(): void {
    /* draws itself */
  }

  private step(dt: number): void {
    this.stateT += dt;
    if (this.state === 'cut') {
      if (Date.now() > this.expiresAt) return this.fail('Süre doldu: disk köreldi.');
      this.jam = Math.max(0, this.jam - dt);
      if (this.cutting) {
        this.spin = Math.min(1, this.spin + dt * 4);
        this.heat += dt * 0.42;
        this.cuts[this.bar] = Math.min(1, this.cuts[this.bar]! + dt * (0.32 + 0.25 * this.spin) * (1 - 0.4 * Math.max(0, this.heat - 0.6)));
        for (let i = 0; i < 6; i++) this.sparks.push({ x: this.barX(this.bar), y: this.cutY(), vx: 80 + Math.random() * 260, vy: -60 - Math.random() * 220, life: 0.3 + Math.random() * 0.4 });
        this.soundT -= dt;
        if (this.soundT <= 0) {
          this.soundT = 0.09;
          this.game.audio.play('ratchet');
        }
        if (this.heat >= 1) {
          // Overheated: it jams and the cut loses a little.
          this.jam = 1.1;
          this.heat = 0.85;
          this.cuts[this.bar] = Math.max(0, this.cuts[this.bar]! - 0.18);
          this.message = 'DİSK SIKIŞTI! Bırak, soğusun...';
          this.messageColor = '#ff5c7a';
          this.game.audio.play('snap');
        }
        if (this.cuts[this.bar]! >= 1) {
          this.game.audio.play('clunk');
          this.bar++;
          this.message = this.bar < BARS ? `Kol ${this.bar}/${BARS} kesildi! Sıradaki...` : 'Tüm kollar kesildi!';
          this.messageColor = '#2ee59d';
          if (this.bar >= BARS) void this.done();
        }
      } else {
        this.spin = Math.max(0, this.spin - dt * 2);
        this.heat = Math.max(0, this.heat - dt * 0.55);
        if (this.jam <= 0 && this.messageColor === '#ff5c7a') {
          this.message = 'Soğudu. Kesmeye devam.';
          this.messageColor = '#cfd6e6';
        }
      }
    }
    if ((this.state === 'done' && this.stateT > 1.4) || (this.state === 'fail' && this.stateT > 2)) this.ui.closeAll();
    for (const s of this.sparks) {
      s.vy += 600 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  private async done(): Promise<void> {
    this.state = 'done';
    this.stateT = 0;
    try {
      // The server wants the cut to have taken a little while.
      const r = await this.net.rpc('docks.finish', { containerId: this.containerId });
      this.finished = true;
      this.message = 'KAPILAR AÇILIYOR!';
      this.messageColor = '#2ee59d';
      this.game.audio.play('unlock');
      this.game.docks.onOpened(r.text);
    } catch (err) {
      this.ui.error(err);
      this.state = 'cut';
      this.bar = BARS - 1;
      this.cuts[this.bar] = 0.8;
    }
  }

  private fail(text: string): void {
    this.state = 'fail';
    this.stateT = 0;
    this.message = text;
    this.messageColor = '#ff5c7a';
    this.game.audio.play('error');
  }

  private barX(i: number): number {
    return W * 0.3 + i * W * 0.2;
  }

  private cutY(): number {
    return H * 0.48;
  }

  private draw(): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    // The container's door: ribbed steel.
    const steel = g.createLinearGradient(0, 0, W, 0);
    steel.addColorStop(0, '#6d2a20');
    steel.addColorStop(0.5, '#8a3a2c');
    steel.addColorStop(1, '#5c241b');
    g.fillStyle = steel;
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 22) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x, 0, 8, H);
    }
    // The locking bars with their cams and the cut in each.
    for (let i = 0; i < BARS; i++) {
      const x = this.barX(i);
      const bar = g.createLinearGradient(x - 9, 0, x + 9, 0);
      bar.addColorStop(0, '#8e959c');
      bar.addColorStop(0.5, '#e6eaee');
      bar.addColorStop(1, '#7a8188');
      g.fillStyle = bar;
      g.fillRect(x - 9, 20, 18, H - 40);
      g.fillStyle = '#2b2e33';
      g.fillRect(x - 22, this.cutY() - 22, 44, 44);
      g.fillStyle = '#c9a227';
      g.fillRect(x - 6, this.cutY() - 6, 12, 12);
      // The cut: a glowing notch growing across the bar.
      const depth = this.cuts[i]!;
      if (depth > 0) {
        g.fillStyle = depth >= 1 ? '#111' : `rgba(255,${140 - depth * 80},40,${0.6 + depth * 0.4})`;
        g.fillRect(x - 9, this.cutY() + 26, 18 * depth, 6);
      }
      if (depth >= 1) {
        g.strokeStyle = '#2ee59d';
        g.lineWidth = 3;
        g.strokeRect(x - 12, 18, 24, H - 36);
      }
    }
    // The grinder on the current bar.
    if (this.state === 'cut' && this.bar < BARS) {
      const x = this.barX(this.bar) + 26;
      const y = this.cutY() + 29;
      g.save();
      g.translate(x, y);
      g.fillStyle = '#1e5bd8';
      g.fillRect(0, -16, 150, 32);
      g.fillStyle = '#111';
      g.fillRect(140, -10, 60, 20);
      g.rotate((this.spin * performance.now()) / 20);
      g.fillStyle = '#bfc5cc';
      g.beginPath();
      g.arc(0, 0, 30, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#6b7178';
      g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos((i / 6) * Math.PI * 2) * 28, Math.sin((i / 6) * Math.PI * 2) * 28);
        g.stroke();
      }
      g.restore();
    }
    for (const s of this.sparks) {
      g.fillStyle = `rgba(255,${180 + Math.random() * 60},80,${clamp(s.life * 2, 0, 1)})`;
      g.fillRect(s.x, s.y, 3, 3);
    }
    // HUD: heat, time, message.
    g.fillStyle = 'rgba(8,10,16,0.65)';
    g.fillRect(14, 14, 190, 40);
    g.font = '800 11px system-ui, sans-serif';
    g.fillStyle = '#9aa6bd';
    g.fillText(this.jam > 0 ? 'ISI · SIKIŞTI!' : 'DİSK ISISI · HEAT', 24, 30);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(24, 38, 170, 8);
    g.fillStyle = this.heat > 0.85 ? '#ff3b47' : this.heat > 0.6 ? '#ffc53d' : '#2ee59d';
    g.fillRect(24, 38, 170 * this.heat, 8);
    g.fillStyle = '#ff3b47';
    g.fillRect(24 + 170 * 0.85, 34, 2, 16);
    const left = Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000));
    g.fillStyle = 'rgba(8,10,16,0.65)';
    g.fillRect(W - 120, 14, 106, 40);
    g.fillStyle = '#9aa6bd';
    g.fillText('SÜRE', W - 108, 30);
    g.font = '900 18px ui-monospace, monospace';
    g.fillStyle = left < 10 ? '#ff5c7a' : '#fff';
    g.fillText(`00:${String(left).padStart(2, '0')}`, W - 108, 48);
    g.fillStyle = 'rgba(8,10,16,0.7)';
    g.fillRect(20, H - 40, W - 40, 28);
    g.font = '800 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = this.messageColor;
    g.fillText(this.message, W / 2, H - 21);
    g.textAlign = 'left';
    void this.cutSec;
  }

  override dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const u of this.unbind) u();
    this.unbind = [];
    this.holding = { mouse: false, key: false, button: false };
    this.game.input.releaseAll();
    this.game.working = false;
    if (!this.finished) void this.net.rpc('docks.cancel', { containerId: this.containerId }).catch(() => undefined);
    super.dispose();
  }
}

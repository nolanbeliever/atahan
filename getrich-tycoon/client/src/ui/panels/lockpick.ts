// The lockpick mini-game. A car door lock seen close up: the pick sits in the keyway and the
// player sets its angle (mouse, A/D or a drag on touch screens), then turns the cylinder with the
// tension saw (W / Space / click / the TURN button). Only the server knows the sweet spot. Off the
// spot the cylinder stops short, the pick strains and snaps, and the lock gives a hint: which way
// the sweet spot is and roughly how far (shown as a green zone on the dial and an arrow). Three
// snapped picks and the alarm goes off. On the spot the lock opens and the car is yours.

import { ECONOMY } from '../../../../shared/economy.config';
import { vehicleColor } from '../../../../shared/customization';
import type { LockpickResult } from '../../../../shared/protocol';
import { hintBandRange, type LockDifficulty } from '../../../../shared/theft';
import { clamp } from '../../../../shared/util';
import { modelDisplayName } from '../../../../shared/vehicles';
import { RpcError } from '../../net/Network';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';

const W = 560;
const H = 380;
const CX = W / 2;
const CY = H * 0.57;
const GUIDE_R = 150;
const PICK_LEN = 205;

const DIFFICULTY: Record<LockDifficulty, { label: string; color: string }> = {
  easy: { label: 'Kolay · Easy', color: '#2ee59d' },
  medium: { label: 'Orta · Medium', color: '#ffc53d' },
  hard: { label: 'Zor · Hard', color: '#ff8c42' },
  extreme: { label: 'Çok Zor · Extreme', color: '#ff5c7a' },
};

type State = 'aim' | 'turning' | 'strain' | 'snap' | 'open' | 'alarm' | 'expired';

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  len: number;
}

const ease = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

export class LockpickPanel extends Panel {
  readonly name = 'lockpick';
  override size = 'medium' as const;
  override closeOnBackdrop = false;
  private readonly sessionId = String(this.arg.sessionId ?? '');
  private readonly carId = String(this.arg.carId ?? '');
  private readonly modelId = String(this.arg.modelId ?? '');
  private readonly difficulty = (this.arg.difficulty as LockDifficulty) ?? 'medium';
  private readonly totalPicks = Number(this.arg.picks ?? ECONOMY.theft.picks);
  private picksLeft = this.totalPicks;
  private readonly expiresAt = Date.now() + ECONOMY.theft.sessionSec * 1000;
  private canvas = h('canvas', { class: 'lp-canvas', 'data-testid': 'lockpick-canvas' });
  private turnBtn = h('button', { class: 'btn primary lp-turn', 'data-testid': 'lockpick-turn' }, 'ÇEVİR · Turn');
  private root: HTMLElement | null = null;
  /** Pick angle (degrees): 0 = pointing left, 90 = up, 180 = right. */
  private angle = 90;
  private state: State = 'aim';
  private stateT = 0;
  /** Cylinder turn 0-1 (of 90 degrees) and where it is going. */
  private rot = 0;
  private target: number | null = null;
  private result: LockpickResult | null = null;
  /** The new pick sliding in after a snap (0-1). */
  private slide = 1;
  private shards: Shard[] = [];
  private keys = { left: false, right: false, fine: false };
  private message = 'Açıyı ayarla, sonra çevir. Set the angle, then turn.';
  private messageColor = '#cfd6e6';
  private finished = false;
  private raf = 0;
  private last = performance.now();
  private tickAngle = 90;
  private paint = '#3a4a66';
  private unbind: (() => void)[] = [];
  /** Earlier tries and what the lock said. */
  private tries: { angle: number; dir: -1 | 0 | 1; band: number }[] = [];
  private tryAngle = 90;

  title() {
    return 'Lockpick Et';
  }
  override subtitle() {
    return `${modelDisplayName(this.modelId)} · ${DIFFICULTY[this.difficulty].label}`;
  }
  iconSvg() {
    return ICONS.lockpick;
  }

  override init(): void {
    const car = this.store.street.get(this.carId);
    if (car) this.paint = vehicleColor(car.color, car.mods);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, ev: K, fn: (e: WindowEventMap[K]) => void) => {
      target.addEventListener(ev, fn as EventListener);
      this.unbind.push(() => target.removeEventListener(ev, fn as EventListener));
    };
    // The lock owns the keyboard while it is open: capture the keys before the game's own handlers
    // (W and Space would also drive / jump the character away from the car), and let go of them
    // if the window loses focus mid-press (a stuck A or D used to keep turning the pick).
    const capture = (e: KeyboardEvent, down: boolean) => {
      if (e.code === 'Escape') return;
      if (this.onKey(e, down)) e.stopImmediatePropagation();
    };
    const opts = { capture: true };
    const kd = (e: KeyboardEvent) => capture(e, true);
    const ku = (e: KeyboardEvent) => capture(e, false);
    window.addEventListener('keydown', kd, opts);
    window.addEventListener('keyup', ku, opts);
    this.unbind.push(() => window.removeEventListener('keydown', kd, opts), () => window.removeEventListener('keyup', ku, opts));
    on(window, 'blur', () => (this.keys = { left: false, right: false, fine: false }));
    on(window, 'mousemove', (e) => this.aimAt(e.clientX, e.clientY));
    on(this.canvas, 'pointerdown', (e) => {
      e.preventDefault();
      this.aimAt(e.clientX, e.clientY, true);
      // A click turns; on a touch screen dragging aims and the button turns.
      if (e.pointerType === 'mouse') void this.turn();
    });
    on(this.canvas, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse' && e.buttons) this.aimAt(e.clientX, e.clientY, true);
    });
    this.turnBtn.addEventListener('click', () => void this.turn());
    this.game.working = true;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      // Real time (capped), so a slow frame rate does not stretch the animations.
      const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      try {
        this.step(dt);
        this.draw();
      } catch (err) {
        // One bad frame must not freeze the lock.
        console.warn('lockpick frame', err);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** The body is built once (store updates must not rebuild the canvas). */
  renderBody(): Child {
    this.root ??= h(
      'div',
      { class: 'lockpick', 'data-testid': 'lockpick' },
      this.canvas,
      h(
        'div',
        { class: 'lp-help' },
        h('span', null, h('span', { class: 'kbd' }, 'Mouse'), h('span', { class: 'kbd' }, 'A'), h('span', { class: 'kbd' }, 'D'), 'Açı / angle (Shift: fine)'),
        h('span', null, h('span', { class: 'kbd' }, 'W'), h('span', { class: 'kbd' }, 'Space'), h('span', { class: 'kbd' }, 'Click'), 'Çevir / turn'),
        h('span', null, h('span', { class: 'kbd' }, 'Esc'), 'Vazgeç (set is lost)'),
      ),
      h('div', { class: 'lp-tip' }, 'İpucu: maymuncuk kırılınca kadranda yeşil bölge ve ok çıkar - doğru açı o yeşil bölgenin içinde. Tip: after a snap, aim into the green zone.'),
      this.turnBtn,
    );
    return this.root;
  }

  override onStoreChange(): void {
    /* the mini-game draws itself */
  }

  /** Returns true when the key is the lock's (the game must not see it). */
  private onKey(e: KeyboardEvent, down: boolean): boolean {
    const c = e.code;
    if (c === 'KeyA' || c === 'ArrowLeft') this.keys.left = down;
    else if (c === 'KeyD' || c === 'ArrowRight') this.keys.right = down;
    else if (c === 'ShiftLeft' || c === 'ShiftRight') this.keys.fine = down;
    else if (c === 'KeyW' || c === 'Space' || c === 'ArrowUp' || c === 'Enter') {
      if (down && !e.repeat) void this.turn();
    } else return false;
    e.preventDefault();
    return true;
  }

  /** Aim the pick at a screen point (relative to the lock). */
  private aimAt(clientX: number, clientY: number, force = false): void {
    if (this.state !== 'aim' || this.slide < 1) return;
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0) return;
    const x = ((clientX - r.left) / r.width) * W;
    const y = ((clientY - r.top) / r.height) * H;
    const dx = x - CX;
    const up = CY - y;
    // Ignore the mouse while it is right on the lock or far away (keys may be in use).
    const d = Math.hypot(dx, up);
    if (!force && (d < 30 || d > 420)) return;
    let a = (Math.atan2(up, -dx) * 180) / Math.PI;
    if (a < 0) a = a < -90 ? 180 : 0;
    this.setAngle(a);
  }

  private setAngle(a: number): void {
    this.angle = clamp(a, 0, 180);
    if (Math.abs(this.angle - this.tickAngle) >= 6) {
      this.tickAngle = this.angle;
      this.game.audio.play('pick');
    }
  }

  private async turn(): Promise<void> {
    if (this.state !== 'aim' || this.slide < 1 || this.finished) return;
    this.state = 'turning';
    this.stateT = 0;
    this.target = null;
    this.result = null;
    this.tryAngle = this.angle;
    this.message = 'Çeviriyorsun... Turning...';
    this.messageColor = '#cfd6e6';
    this.game.audio.play('pick');
    try {
      const r = await this.net.rpc('lockpick.try', { sessionId: this.sessionId, angle: Math.round(this.angle * 10) / 10 });
      this.result = r;
      this.target = r.opened ? 1 : r.turn;
    } catch (err) {
      this.ui.error(err);
      const code = err instanceof RpcError ? err.code : 'server_error';
      if (code === 'not_found' || code === 'conflict') {
        this.finished = true;
        this.state = 'expired';
        this.stateT = 0;
      } else {
        // Too far, too quick or a network hiccup: the pick comes back, try again.
        this.state = 'aim';
        this.target = 0;
        this.rot = 0;
        this.message = code === 'too_far' ? 'Arabaya yaklaş. Get right next to the car.' : 'Tekrar dene. Try again.';
        this.messageColor = '#ffd27a';
      }
    }
  }

  private step(dt: number): void {
    this.stateT += dt;
    if (this.state === 'aim' && this.slide >= 1) {
      const speed = this.keys.fine ? 12 : 70;
      if (this.keys.left) this.setAngle(this.angle - speed * dt);
      if (this.keys.right) this.setAngle(this.angle + speed * dt);
    }
    this.slide = Math.min(1, this.slide + dt * 3.2);
    if (this.state === 'aim' && Date.now() > this.expiresAt) {
      this.finished = true;
      this.state = 'expired';
      this.stateT = 0;
      this.message = 'Süre doldu: set bozuldu. Out of time.';
      this.messageColor = '#ff5c7a';
      this.game.audio.play('error');
    }
    switch (this.state) {
      case 'turning': {
        // Turn towards the answer (a little way while it is on its way).
        const goal = this.target ?? 0.1;
        const next = this.rot + Math.sign(goal - this.rot) * dt * 1.5;
        this.rot = goal > this.rot ? Math.min(goal, next) : Math.max(goal, next);
        if (this.target !== null && Math.abs(this.rot - this.target) < 1e-3 && this.result) {
          this.stateT = 0;
          if (this.result.opened) {
            this.state = 'open';
            this.finished = true;
            this.message = 'KİLİT AÇILDI! The lock is open.';
            this.messageColor = '#2ee59d';
            this.game.audio.play('unlock');
          } else {
            this.state = 'strain';
            this.message = 'Maymuncuk zorlanıyor! The pick is straining...';
            this.messageColor = '#ffc53d';
            this.game.audio.play('strain');
          }
        }
        break;
      }
      case 'strain':
        if (this.stateT > 0.7) {
          this.state = 'snap';
          this.stateT = 0;
          this.game.audio.play('snap');
          this.breakPick();
          const r = this.result!;
          this.picksLeft = r.picksLeft;
          this.tries.push({ angle: this.tryAngle, dir: r.dir, band: r.band });
          const [lo, hi] = hintBandRange(r.band);
          const way = r.dir > 0 ? 'SAĞA →' : 'SOLA ←';
          const far = hi >= 180 ? `${lo}°'den fazla` : `${lo}-${hi}°`;
          this.message = r.failed ? 'Son maymuncuk da kırıldı! ALARM - polis geliyor ★★' : `KIRILDI! ${way} çevir: doğru açı ${far} ${r.dir > 0 ? 'sağda' : 'solda'} (${this.picksLeft} hak)`;
          this.messageColor = r.failed ? '#ff5c7a' : '#ffd27a';
        }
        break;
      case 'snap':
        this.rot = Math.max(0, this.rot - dt * 3);
        if (this.stateT > 0.65) {
          this.stateT = 0;
          if (this.result?.failed) {
            this.state = 'alarm';
            this.finished = true;
          } else {
            this.state = 'aim';
            this.slide = 0;
            // Keep the hint on screen for the next try.
            this.messageColor = '#ffd27a';
          }
        }
        break;
      case 'open':
        if (this.stateT > 1.1) this.ui.closeAll();
        break;
      case 'alarm':
        if (this.stateT > 2.2) this.ui.closeAll();
        break;
      case 'expired':
        if (this.stateT > 1.8) this.ui.closeAll();
        break;
    }
    for (const s of this.shards) {
      s.vy += 900 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.a += s.va * dt;
    }
    this.shards = this.shards.filter((s) => s.y < H + 40);
  }

  private pickDir(): { x: number; y: number } {
    const a = (this.angle * Math.PI) / 180;
    return { x: -Math.cos(a), y: -Math.sin(a) };
  }

  /** The pick snaps near the keyway: the long end falls away. */
  private breakPick(): void {
    const d = this.pickDir();
    const at = 46;
    for (const [from, len] of [
      [at, 70],
      [at + 70, PICK_LEN - at - 70],
    ] as const) {
      this.shards.push({ x: CX + d.x * (from + len / 2), y: CY + d.y * (from + len / 2), vx: d.x * 120 + (Math.random() - 0.5) * 80, vy: -160 - Math.random() * 120, a: Math.atan2(d.y, d.x), va: (Math.random() - 0.5) * 12, len });
    }
  }

  /** Where the sweet spot can be after the hints so far (degrees), or null before the first miss. */
  private zone(): [number, number] | null {
    let zone: [number, number] | null = null;
    for (const t of this.tries) {
      const [lo, hi] = hintBandRange(t.band);
      const a = t.dir > 0 ? [t.angle + lo, t.angle + hi] : [t.angle - hi, t.angle - lo];
      const next: [number, number] = [clamp(Math.min(a[0]!, a[1]!), 0, 180), clamp(Math.max(a[0]!, a[1]!), 0, 180)];
      // Narrow it down with every hint (start again from the latest if they disagree).
      if (zone && Math.max(zone[0], next[0]) < Math.min(zone[1], next[1])) zone = [Math.max(zone[0], next[0]), Math.min(zone[1], next[1])];
      else zone = next;
    }
    return zone;
  }

  /** The green zone where the sweet spot is, marks for the earlier tries and an arrow from the last one. */
  private drawHints(g: CanvasRenderingContext2D): void {
    const zone = this.zone();
    if (!zone) return;
    const rad = (a: number) => Math.PI + (a * Math.PI) / 180;
    g.save();
    g.translate(CX, CY);
    const pulse = 0.55 + 0.25 * Math.sin(performance.now() / 260);
    g.strokeStyle = `rgba(46,229,157,${pulse})`;
    g.lineWidth = 20;
    g.lineCap = 'butt';
    g.beginPath();
    g.arc(0, 0, GUIDE_R - 6, rad(zone[0]), rad(Math.max(zone[1], zone[0] + 0.5)));
    g.stroke();
    // Earlier tries: red notches on the dial.
    for (const t of this.tries) {
      const r = (t.angle * Math.PI) / 180;
      const x = -Math.cos(r);
      const y = -Math.sin(r);
      g.strokeStyle = '#ff5c7a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x * (GUIDE_R - 18), y * (GUIDE_R - 18));
      g.lineTo(x * (GUIDE_R + 8), y * (GUIDE_R + 8));
      g.stroke();
    }
    // Arrow along the dial from the last try towards the zone.
    const last = this.tries[this.tries.length - 1]!;
    const from = last.angle + last.dir * 4;
    const to = clamp(last.angle + last.dir * 14, 0, 180);
    const R = GUIDE_R + 16;
    g.strokeStyle = '#2ee59d';
    g.fillStyle = '#2ee59d';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, R, rad(Math.min(from, to)), rad(Math.max(from, to)));
    g.stroke();
    const tip = rad(to);
    const tx = Math.cos(tip) * R;
    const ty = Math.sin(tip) * R;
    // Tangent direction at the tip (clockwise for a bigger angle).
    const s = last.dir >= 0 ? 1 : -1;
    const dx = -Math.sin(tip) * s;
    const dy = Math.cos(tip) * s;
    g.beginPath();
    g.moveTo(tx + dx * 10, ty + dy * 10);
    g.lineTo(tx - dy * 7, ty + dx * 7);
    g.lineTo(tx + dy * 7, ty - dx * 7);
    g.closePath();
    g.fill();
    g.restore();
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, W, H);
    // The door skin in the car's colour, with a chrome handle.
    const door = g.createLinearGradient(0, 0, 0, H);
    door.addColorStop(0, shade(this.paint, 0.35));
    door.addColorStop(0.45, shade(this.paint, 0.05));
    door.addColorStop(1, shade(this.paint, -0.45));
    g.fillStyle = door;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, H * 0.18, W, 3);
    // Door handle, low on the right (clear of the angle guide).
    const hx = W - 150;
    const hy = CY + 34;
    const handle = g.createLinearGradient(0, hy, 0, hy + 26);
    handle.addColorStop(0, '#f4f6f8');
    handle.addColorStop(0.5, '#9aa3ad');
    handle.addColorStop(1, '#e1e5ea');
    g.fillStyle = handle;
    g.beginPath();
    rrect(g, hx, hy, 130, 26, 13);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    rrect(g, hx + 10, hy + 6, 110, 14, 7);
    g.fill();

    // Angle guide round the lock.
    g.save();
    g.translate(CX, CY);
    for (let a = 0; a <= 180; a += 5) {
      const r = (a * Math.PI) / 180;
      const big = a % 30 === 0;
      const x = -Math.cos(r);
      const y = -Math.sin(r);
      // A dark edge under a light tick reads on any paint colour.
      for (const [color, extra] of [
        [big ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)', 2],
        [big ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)', 0],
      ] as const) {
        g.strokeStyle = color;
        g.lineWidth = (big ? 2 : 1) + extra;
        g.beginPath();
        g.moveTo(x * (GUIDE_R - (big ? 12 : 7)), y * (GUIDE_R - (big ? 12 : 7)));
        g.lineTo(x * GUIDE_R, y * GUIDE_R);
        g.stroke();
      }
    }
    g.restore();
    this.drawHints(g);

    // Cylinder: chrome bezel, brass face, keyway turning with it.
    const turn = (this.rot * Math.PI) / 2;
    g.save();
    g.translate(CX, CY);
    const bezel = g.createRadialGradient(-18, -18, 10, 0, 0, 64);
    bezel.addColorStop(0, '#ffffff');
    bezel.addColorStop(0.55, '#b8c0c8');
    bezel.addColorStop(1, '#5d656e');
    g.fillStyle = bezel;
    g.beginPath();
    g.arc(0, 0, 62, 0, Math.PI * 2);
    g.fill();
    g.rotate(turn);
    const face = g.createRadialGradient(-12, -14, 4, 0, 0, 50);
    face.addColorStop(0, '#f5d98b');
    face.addColorStop(0.7, '#b8892c');
    face.addColorStop(1, '#7a5a1b');
    g.fillStyle = face;
    g.beginPath();
    g.arc(0, 0, 49, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1407';
    g.beginPath();
    rrect(g, -5, -32, 10, 64, 5);
    g.fill();
    g.beginPath();
    g.arc(0, -10, 8, 0, Math.PI * 2);
    g.fill();
    // Tension tool: a hacksaw blade bent into an L in the bottom of the keyway.
    g.fillStyle = '#c9ced4';
    g.fillRect(-3, 18, 6, 70);
    g.fillRect(-3, 82, 92, 8);
    g.fillStyle = '#8b939b';
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.moveTo(6 + i * 9, 90);
      g.lineTo(10 + i * 9, 96);
      g.lineTo(14 + i * 9, 90);
      g.fill();
    }
    g.fillStyle = '#e67e22';
    g.beginPath();
    rrect(g, 86, 76, 34, 20, 6);
    g.fill();
    g.restore();

    // The pick (straining: shaking and bending; sliding in after a snap).
    if (this.state !== 'snap' && this.state !== 'alarm') {
      const d = this.pickDir();
      const n = { x: -d.y, y: d.x };
      const strain = this.state === 'strain' ? ease(this.stateT / 0.7) : this.state === 'turning' ? 0.15 * this.rot : 0;
      const jitter = this.state === 'strain' ? (Math.random() - 0.5) * (2 + 5 * strain) : 0;
      const inset = (1 - ease(this.slide)) * 160;
      const tip = { x: CX + d.x * (inset - 4) + n.x * jitter, y: CY + d.y * (inset - 4) + n.y * jitter };
      const end = { x: CX + d.x * (PICK_LEN + inset) + n.x * jitter, y: CY + d.y * (PICK_LEN + inset) + n.y * jitter };
      const bend = strain * 26;
      const mid = { x: (tip.x + end.x) / 2 + n.x * bend, y: (tip.y + end.y) / 2 + n.y * bend };
      g.lineCap = 'round';
      g.strokeStyle = strain > 0.6 ? '#ffd0c4' : '#dfe4ea';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      g.stroke();
      // Hook at the tip.
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(tip.x + n.x * 9 - d.x * 2, tip.y + n.y * 9 - d.y * 2);
      g.stroke();
      // Handle.
      g.strokeStyle = '#26282d';
      g.lineWidth = 13;
      g.beginPath();
      g.moveTo(end.x - d.x * 62, end.y - d.y * 62);
      g.lineTo(end.x, end.y);
      g.stroke();
    }
    for (const s of this.shards) {
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.a);
      g.strokeStyle = '#dfe4ea';
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-s.len / 2, 0);
      g.lineTo(s.len / 2, 0);
      g.stroke();
      g.restore();
    }

    // HUD: picks left, difficulty, time, angle, message.
    g.fillStyle = 'rgba(8,10,16,0.62)';
    g.beginPath();
    rrect(g, 12, 12, 176, 46, 10);
    g.fill();
    g.font = '800 11px system-ui, sans-serif';
    g.fillStyle = '#9aa6bd';
    g.fillText('MAYMUNCUK · PICKS', 22, 28);
    for (let i = 0; i < this.totalPicks; i++) {
      const ok = i < this.picksLeft;
      const x = 24 + i * 52;
      g.strokeStyle = ok ? '#e8ecf1' : '#ff5c7a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x, 44);
      g.lineTo(x + 30, 44);
      g.stroke();
      g.strokeStyle = ok ? '#2a2c31' : 'rgba(255,92,122,0.6)';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(x + 30, 44);
      g.lineTo(x + 42, 44);
      g.stroke();
      if (!ok) {
        g.strokeStyle = '#ff5c7a';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x + 10, 38);
        g.lineTo(x + 20, 50);
        g.moveTo(x + 20, 38);
        g.lineTo(x + 10, 50);
        g.stroke();
      }
    }
    const left = Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000));
    g.fillStyle = 'rgba(8,10,16,0.62)';
    g.beginPath();
    rrect(g, W - 112, 12, 100, 46, 10);
    g.fill();
    g.font = '800 11px system-ui, sans-serif';
    g.fillStyle = '#9aa6bd';
    g.fillText('SÜRE · TIME', W - 100, 28);
    g.font = '900 20px ui-monospace, monospace';
    g.fillStyle = left <= 15 ? '#ff5c7a' : '#ffffff';
    g.fillText(`${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`, W - 100, 50);
    const diff = DIFFICULTY[this.difficulty];
    g.font = '800 12px system-ui, sans-serif';
    const dw = g.measureText(diff.label).width + 20;
    g.fillStyle = 'rgba(8,10,16,0.62)';
    g.beginPath();
    rrect(g, CX - dw / 2, 14, dw, 24, 12);
    g.fill();
    g.fillStyle = diff.color;
    g.textAlign = 'center';
    g.fillText(diff.label, CX, 30);
    g.fillStyle = 'rgba(8,10,16,0.62)';
    g.beginPath();
    rrect(g, CX - 150, CY + 46, 76, 24, 8);
    g.fill();
    g.font = '800 13px ui-monospace, monospace';
    g.fillStyle = '#ffffff';
    g.fillText(`${this.angle.toFixed(1)}°`, CX - 112, CY + 63);
    g.fillStyle = 'rgba(8,10,16,0.7)';
    g.beginPath();
    rrect(g, 20, H - 40, W - 40, 28, 10);
    g.fill();
    g.font = '800 13px system-ui, sans-serif';
    g.fillStyle = this.messageColor;
    g.fillText(this.message, CX, H - 21);
    g.textAlign = 'left';
    if (this.state === 'open' || this.state === 'alarm') {
      const k = Math.min(1, this.stateT * 3);
      g.fillStyle = this.state === 'open' ? `rgba(46,229,157,${0.18 * k})` : `rgba(255,40,60,${(0.18 + 0.14 * Math.sin(this.stateT * 18)) * k})`;
      g.fillRect(0, 0, W, H);
      g.font = '900 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = this.state === 'open' ? '#2ee59d' : '#ff5c7a';
      g.fillText(this.state === 'open' ? 'KİLİT AÇILDI!' : 'ALARM!', CX, CY - 80);
      g.textAlign = 'left';
    }
  }

  override dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const u of this.unbind) u();
    this.unbind = [];
    this.game.working = false;
    // Walking away mid-attempt ends it (the set is spent).
    if (!this.finished) void this.net.rpc('lockpick.cancel', { sessionId: this.sessionId }).catch(() => undefined);
    super.dispose();
  }
}

/** A rounded rectangle path (CanvasRenderingContext2D.roundRect is missing on older browsers). */
function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof g.roundRect === 'function') {
    g.roundRect(x, y, w, h, r);
    return;
  }
  const k = Math.min(r, w / 2, h / 2);
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

/** Lighten (k > 0) or darken (k < 0) a CSS hex colour. */
function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

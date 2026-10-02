// On-screen controls for touch devices (iPad, phones): a movement stick, an interact button,
// a secondary-action button (fuel/wash), a hold button that sprints on foot and brakes while
// driving, a gun button (draw / switch / put away) and a big ATEŞ ET (fire) button. The whole right
// side of the screen is a free look area: drag anywhere there (behind the HUD) to turn the camera.

import { KEY } from '../../../shared/physics';
import type { Interaction } from '../game/Game';
import { stickKeys } from '../game/stick';
import { h } from './dom';
import type { UI } from './UI';

/** Touch UI is on for coarse (finger) pointers; `?touch=1` / `?touch=0` force it on or off. */
export function wantsTouch(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

export class TouchControls {
  readonly el: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly act: HTMLButtonElement;
  private readonly alt: HTMLButtonElement;
  private readonly hold: HTMLButtonElement;
  private readonly horn: HTMLButtonElement;
  private readonly camBtn: HTMLButtonElement;
  private readonly fire: HTMLButtonElement;
  private readonly gun: HTMLButtonElement;
  /** Right half of the screen, behind the HUD: dragging turns the camera. */
  readonly lookZone: HTMLElement;
  private lookPointer: { id: number; x: number; y: number } | null = null;
  private firePointer: number | null = null;
  private hornPointer: number | null = null;
  private stickPointer: number | null = null;
  private nx = 0;
  private ny = 0;
  private holdPointer: number | null = null;
  enabled = false;

  constructor(private readonly ui: UI) {
    this.knob = h('div', { class: 'knob' });
    this.stick = h('div', { class: 'touch-stick', 'data-testid': 'touch-stick' }, h('div', { class: 'base' }), this.knob);
    this.act = h('button', { class: 'tbtn act', 'data-testid': 'touch-action', 'aria-label': 'Interact' }, 'E');
    this.alt = h('button', { class: 'tbtn alt', 'data-testid': 'touch-alt', 'aria-label': 'Secondary action' }, 'G');
    this.camBtn = h('button', { class: 'tbtn cam', 'data-testid': 'touch-camera', 'aria-label': 'Switch camera' }, 'CAM');
    this.hold = h('button', { class: 'tbtn hold', 'data-testid': 'touch-hold' }, 'RUN');
    this.horn = h('button', { class: 'tbtn horn', 'data-testid': 'touch-horn', 'aria-label': 'Horn' }, 'HORN');
    this.fire = h('button', { class: 'tbtn fire', 'data-testid': 'touch-fire', 'aria-label': 'Fire' }, h('span', { class: 'fire-icon' }, '🎯'), h('span', {}, 'ATEŞ ET'));
    this.gun = h('button', { class: 'tbtn gun', 'data-testid': 'touch-gun', 'aria-label': 'Draw or switch gun' }, '🔫');
    this.el = h('div', { class: 'touch-controls' }, this.stick, h('div', { class: 'touch-actions' }, this.camBtn, this.horn, this.alt, this.hold, this.act), this.gun, this.fire);
    this.lookZone = h('div', { class: 'touch-look', 'data-testid': 'touch-look' });
    this.bindLook();
    this.bindFire();
    this.gun.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ui.game.combat.cycleWeapon();
    });
    this.camBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ui.game.toggleCockpit();
    });
    this.horn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.hornPointer = e.pointerId;
      this.horn.classList.add('pressed');
    });
    const hornUp = (e: PointerEvent) => {
      if (e.pointerId !== this.hornPointer) return;
      this.hornPointer = null;
      this.horn.classList.remove('pressed');
    };
    this.horn.addEventListener('pointerup', hornUp);
    this.horn.addEventListener('pointercancel', hornUp);
    this.horn.addEventListener('pointerleave', hornUp);

    this.bindStick();
    this.bindHold();
    // pointerdown instead of click: responds instantly and works while another finger holds the stick.
    this.act.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ui.game.interact();
    });
    this.alt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ui.game.interactSecondary();
    });
    ui.game.input.touchSource = () => this.keys();

    if (wantsTouch()) this.enable();
    // A real touch anywhere turns the controls on (e.g. touchscreen laptops, iPads with a trackpad).
    window.addEventListener('touchstart', () => this.enable(), { passive: true });
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch');
    // Stop Safari's pinch-to-zoom of the whole page; pinches belong to the game.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    this.ui.onTouchEnabled();
  }

  /** Movement bits for Input: the stick plus the hold button (sprint on foot, handbrake in a car). */
  private keys(): number {
    const driving = !!this.ui.game.driving;
    let k = this.stickPointer === null ? 0 : stickKeys(this.nx, this.ny, driving);
    if (this.holdPointer !== null) k |= driving ? KEY.BRAKE : KEY.SPRINT;
    if (this.hornPointer !== null && driving) k |= KEY.HORN;
    return k;
  }

  setActions(primary: Interaction | null, secondary: Interaction | null): void {
    this.act.classList.toggle('ready', !!primary);
    this.alt.classList.toggle('show', !!secondary);
  }

  /** Called ~10x per second: keeps the buttons in sync with driving / walking / a gun drawn. */
  update(): void {
    const g = this.ui.game;
    const label = g.driving ? 'BRAKE' : 'RUN';
    if (this.hold.textContent !== label) this.hold.textContent = label;
    this.horn.classList.toggle('show', !!g.driving);
    this.camBtn.classList.toggle('show', !!g.driving);
    const onFoot = !g.driving && !g.riding;
    const armed = onFoot && !!g.combat.equipped;
    this.fire.classList.toggle('show', armed);
    this.gun.classList.toggle('show', onFoot && g.combat.owned().length > 0);
    this.gun.classList.toggle('armed', armed);
    document.body.classList.toggle('touch-armed', armed);
    if (!armed && this.firePointer !== null) {
      this.firePointer = null;
      this.fire.classList.remove('pressed');
      g.input.touchFire(false);
    }
  }

  /** The right side of the screen: one finger drags the camera around. */
  private bindLook(): void {
    const z = this.lookZone;
    z.addEventListener('pointerdown', (e) => {
      if (this.lookPointer) return;
      e.preventDefault();
      this.lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        z.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    });
    z.addEventListener('pointermove', (e) => {
      const p = this.lookPointer;
      if (!p || e.pointerId !== p.id) return;
      this.ui.game.input.addLook(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX;
      p.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (this.lookPointer?.id === e.pointerId) this.lookPointer = null;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  /** ATEŞ ET: fires on touch, keeps firing while held (automatic guns); sliding the finger aims. */
  private bindFire(): void {
    const f = this.fire;
    let last = { x: 0, y: 0 };
    f.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.firePointer !== null) return;
      this.firePointer = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      f.classList.add('pressed');
      try {
        f.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      this.ui.game.input.touchFire(true);
    });
    f.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.firePointer) return;
      this.ui.game.input.addLook((e.clientX - last.x) * 0.6, (e.clientY - last.y) * 0.6);
      last = { x: e.clientX, y: e.clientY };
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.firePointer) return;
      this.firePointer = null;
      f.classList.remove('pressed');
      this.ui.game.input.touchFire(false);
    };
    f.addEventListener('pointerup', up);
    f.addEventListener('pointercancel', up);
  }

  private bindStick(): void {
    const move = (e: PointerEvent) => {
      const r = this.stick.getBoundingClientRect();
      const radius = r.width * 0.36;
      let dx = (e.clientX - (r.left + r.width / 2)) / radius;
      let dy = (e.clientY - (r.top + r.height / 2)) / radius;
      const mag = Math.hypot(dx, dy);
      if (mag > 1) {
        dx /= mag;
        dy /= mag;
      }
      this.nx = dx;
      this.ny = dy;
      this.knob.style.transform = `translate(${dx * radius}px, ${dy * radius}px)`;
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.nx = 0;
      this.ny = 0;
      this.knob.style.transform = '';
      this.stick.classList.remove('active');
    };
    this.stick.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      this.stick.classList.add('active');
      try {
        this.stick.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      move(e);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) move(e);
    });
    this.stick.addEventListener('pointerup', release);
    this.stick.addEventListener('pointercancel', release);
  }

  private bindHold(): void {
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.holdPointer) return;
      this.holdPointer = null;
      this.hold.classList.remove('pressed');
    };
    this.hold.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.holdPointer = e.pointerId;
      this.hold.classList.add('pressed');
      try {
        this.hold.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    });
    this.hold.addEventListener('pointerup', release);
    this.hold.addEventListener('pointercancel', release);
  }
}

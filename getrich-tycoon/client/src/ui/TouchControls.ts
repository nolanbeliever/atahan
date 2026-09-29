// On-screen controls for touch devices (iPad, phones): a movement stick, an interact button,
// a secondary-action button (fuel/wash) and a hold button that sprints on foot and brakes while
// driving. Looking around by dragging on the 3D view is handled by Input.

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
  private stickPointer: number | null = null;
  private nx = 0;
  private ny = 0;
  private holdPointer: number | null = null;
  enabled = false;

  constructor(private readonly ui: UI) {
    this.knob = h('div', { class: 'knob' });
    this.stick = h('div', { class: 'touch-stick', 'data-testid': 'touch-stick' }, h('div', { class: 'base' }), this.knob);
    this.act = h('button', { class: 'tbtn act', 'data-testid': 'touch-action', 'aria-label': 'Interact' }, 'E');
    this.alt = h('button', { class: 'tbtn alt', 'data-testid': 'touch-alt', 'aria-label': 'Secondary action' }, 'F');
    this.hold = h('button', { class: 'tbtn hold', 'data-testid': 'touch-hold' }, 'RUN');
    this.el = h('div', { class: 'touch-controls' }, this.stick, h('div', { class: 'touch-actions' }, this.alt, this.hold, this.act));

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
    return k;
  }

  setActions(primary: Interaction | null, secondary: Interaction | null): void {
    this.act.classList.toggle('ready', !!primary);
    this.alt.classList.toggle('show', !!secondary);
  }

  /** Called ~10x per second: keeps the hold button label in sync with driving/walking. */
  update(): void {
    const label = this.ui.game.driving ? 'BRAKE' : 'RUN';
    if (this.hold.textContent !== label) this.hold.textContent = label;
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

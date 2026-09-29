// Keyboard & mouse input with pointer lock (and drag fallback), plus touch: dragging a finger
// across the 3D view looks around, and on-screen controls contribute movement keys.

import { KEY } from '../../../shared/physics';

const KEYMAP: Record<string, number> = {
  KeyW: KEY.FORWARD,
  ArrowUp: KEY.FORWARD,
  KeyS: KEY.BACK,
  ArrowDown: KEY.BACK,
  KeyA: KEY.LEFT,
  ArrowLeft: KEY.LEFT,
  KeyD: KEY.RIGHT,
  ArrowRight: KEY.RIGHT,
  ShiftLeft: KEY.SPRINT,
  ShiftRight: KEY.SPRINT,
  Space: KEY.BRAKE,
};

/** Touch drags move the camera further per pixel than a mouse does. */
const TOUCH_LOOK_SCALE = 1.8;
/** Browsers emulate mouse events after a tap; ignore mouse input this long after a touch. */
const TOUCH_MOUSE_GUARD_MS = 1000;

export class Input {
  private down = new Set<string>();
  /** When false (menus open, typing), movement keys are ignored. */
  enabled = true;
  mouseDX = 0;
  mouseDY = 0;
  lastMouseMove = 0;
  /** Movement bits from on-screen touch controls, merged with the keyboard. */
  touchSource: (() => number) | null = null;
  private dragging = false;
  private lastTouch = -Infinity;
  private look: { id: number; x: number; y: number } | null = null;
  private pressedHandlers: ((code: string, e: KeyboardEvent) => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('touchstart', () => (this.lastTouch = performance.now()), { capture: true, passive: true });
    canvas.addEventListener('click', () => {
      if (this.enabled && !this.recentTouch() && document.pointerLockElement !== canvas) this.requestLock();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.recentTouch()) return;
      if (e.button === 2 || document.pointerLockElement !== canvas) this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || (this.dragging && !this.recentTouch())) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        this.lastMouseMove = performance.now();
      }
    });

    // One finger on the 3D view orbits the camera; other fingers are free for on-screen controls.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || this.look) return;
      this.lastTouch = performance.now();
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.look || e.pointerId !== this.look.id) return;
      this.mouseDX += (e.clientX - this.look.x) * TOUCH_LOOK_SCALE;
      this.mouseDY += (e.clientY - this.look.y) * TOUCH_LOOK_SCALE;
      this.look.x = e.clientX;
      this.look.y = e.clientY;
      this.lastMouseMove = performance.now();
    });
    const endLook = (e: PointerEvent) => {
      if (this.look && e.pointerId === this.look.id) this.look = null;
    };
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', endLook);
  }

  private recentTouch(): boolean {
    return performance.now() - this.lastTouch < TOUCH_MOUSE_GUARD_MS;
  }

  requestLock(): void {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    } catch {
      /* pointer lock unavailable (e.g. automated tests) */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  onPressed(fn: (code: string, e: KeyboardEvent) => void): void {
    this.pressedHandlers.push(fn);
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (isDown && !e.repeat) for (const h of this.pressedHandlers) h(e.code, e);
    if (typing) return;
    if (KEYMAP[e.code] !== undefined) {
      if (isDown) this.down.add(e.code);
      else this.down.delete(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    }
  }

  keys(): number {
    if (!this.enabled) return 0;
    let k = this.touchSource?.() ?? 0;
    for (const code of this.down) k |= KEYMAP[code] ?? 0;
    return k;
  }

  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }
}

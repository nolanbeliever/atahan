// Keyboard & mouse input with pointer lock (and drag fallback).

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

export class Input {
  private down = new Set<string>();
  /** When false (menus open, typing), movement keys are ignored. */
  enabled = true;
  mouseDX = 0;
  mouseDY = 0;
  lastMouseMove = 0;
  private dragging = false;
  private pressedHandlers: ((code: string, e: KeyboardEvent) => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('click', () => {
      if (this.enabled && document.pointerLockElement !== canvas) this.requestLock();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 || document.pointerLockElement !== canvas) this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        this.lastMouseMove = performance.now();
      }
    });
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
    let k = 0;
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

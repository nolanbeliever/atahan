// PC kontrolleri: WASD / ok tuşları + fare ile bakış (Pointer Lock).
// Pointer Lock alınamazsa (ör. iframe) sürükleyerek bakmaya geri düşer.

const MOUSE_SENS = 0.0022; // radyan / piksel
// Bazı tarayıcılar kilit alınırken / sekme değişince dev bir sahte hareket
// gönderir: bu eşiği aşan olaylar tamamen yok sayılır.
const SPIKE = 300;
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class KeyboardMouse {
  constructor({ input, canvas }) {
    this.input = input;
    this.canvas = canvas;
    this.dragging = false;
    this.dragFallback = false;

    window.addEventListener('keydown', (e) => {
      if (!input.enabled || e.target instanceof HTMLInputElement) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Space') input.action('key');
      else if (e.code === 'KeyF') input.command('consume');
      else if (e.code === 'KeyQ') input.command('cycle');
      else if (e.code === 'KeyB') input.command('build');
      else if (e.code === 'KeyR') input.command('rotate');
      else if (e.code === 'KeyC') input.command('color');
      else if (e.code === 'KeyX') input.command('remove');
      else if (e.code === 'KeyT') input.command('tv');
      else if (/^Digit[1-9]$/.test(e.code)) input.command(`select:${Number(e.code.slice(5)) - 1}`);
      else input.setKey(e.code, true);
    });
    window.addEventListener('keyup', (e) => input.setKey(e.code, false));
    window.addEventListener('blur', () => input.clear());

    this.skipMoves = 0;
    this.everLocked = false;
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) return;
      this.skipMoves = 2;
      this.everLocked = true;
    });
    document.addEventListener('mousemove', (e) => {
      if (!input.enabled || !(this.locked || this.dragging)) return;
      if (this.skipMoves > 0) {
        this.skipMoves--;
        return;
      }
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (Math.abs(dx) > SPIKE || Math.abs(dy) > SPIKE) return;
      if (dx || dy) input.addLook(dx * MOUSE_SENS, dy * MOUSE_SENS);
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!input.enabled || e.button !== 0) return;
      if (this.locked) input.action('mouse');
      else if (this.dragFallback) this.dragging = true;
      else this.lock(); // kilit bir pencere/menü sonrası düştüyse tıklayınca geri al
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  lock() {
    if (!this.canvas.requestPointerLock) {
      this.dragFallback = true;
      return;
    }
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { this.dragFallback = true; });
    } catch {
      this.dragFallback = true;
    }
  }
}

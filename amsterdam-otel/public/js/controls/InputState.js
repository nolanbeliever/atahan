// Klavye/fare ve dokunmatik girdilerin birleştiği ortak durum.
// Her girdi olayı `onActivity` ile render döngüsünü uyandırır; girdi yoksa
// döngü uyur (bkz. Engine).

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];

export class InputState {
  constructor(onActivity) {
    this.onActivity = onActivity;
    this.enabled = false;
    this.keys = new Set();
    this.joyX = 0;
    this.joyY = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.run = false;
    this.actionHandlers = [];
    this.commandHandlers = [];
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.clear();
  }

  clear() {
    this.keys.clear();
    this.joyX = 0;
    this.joyY = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.run = false;
  }

  setKey(code, down) {
    if (!this.enabled) return;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    this.run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.onActivity();
  }

  setJoystick(x, y) {
    if (!this.enabled) return;
    this.joyX = x;
    this.joyY = y;
    this.onActivity();
  }

  addLook(dx, dy) {
    if (!this.enabled) return;
    this.lookX += dx;
    this.lookY += dy;
    this.onActivity();
  }

  /** Biriken bakış hareketini döndürür ve sıfırlar */
  consumeLook(out) {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  any(codes) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** x: sağ(+)/sol(-), y: ileri(+)/geri(-) — uzunluğu en fazla 1 */
  moveVector(out) {
    let x = (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0) + this.joyX;
    let y = (this.any(FORWARD) ? 1 : 0) - (this.any(BACK) ? 1 : 0) + this.joyY;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  onAction(fn) { this.actionHandlers.push(fn); }

  /** @param source 'key' | 'mouse' | 'touch' */
  action(source = 'key') {
    if (!this.enabled) return;
    for (const fn of this.actionHandlers) fn(source);
    this.onActivity();
  }

  /** Adlandırılmış komutlar: 'consume', 'cycle', 'select:N' */
  onCommand(fn) { this.commandHandlers.push(fn); }

  /** İlk `true` döndüren işleyicide durur (ör. dekorasyon modu 1-9'u kendine alır) */
  command(name) {
    if (!this.enabled) return;
    for (const fn of this.commandHandlers) if (fn(name) === true) break;
    this.onActivity();
  }
}

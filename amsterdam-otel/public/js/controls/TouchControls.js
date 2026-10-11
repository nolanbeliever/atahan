// Mobil/tablet kontrolleri:
//  - Sol bölge: parmak nereye basarsa orada beliren dinamik joystick (Nipple.js tarzı)
//  - Sağ bölge: dokunup sürükleyerek kamera çevirme
//  - Tek, şeffaf "Aksiyon" butonu
// Görsel güncellemeler yalnızca transform ile yapılır (layout/reflow yok).

const RADIUS = 52; // joystick yarıçapı (px)
const DEADZONE = 0.12;
const LOOK_SENS = 0.0052; // radyan / piksel

function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* bazı tarayıcılarda/sentetik olaylarda desteklenmez */
  }
}

export class TouchControls {
  constructor({ input, root }) {
    this.input = input;
    this.root = root;
    this.moveZone = root.querySelector('#touch-move');
    this.lookZone = root.querySelector('#touch-look');
    this.joy = root.querySelector('#joystick');
    this.knob = root.querySelector('#joystick-knob');
    this.actionBtn = root.querySelector('#btn-action');
    this.movePointer = null;
    this.lookPointer = null;
    this.origin = { x: 0, y: 0 };
    this.lastLook = { x: 0, y: 0 };

    this.bindMove();
    this.bindLook();

    this.actionBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.action('touch');
    });
    // iOS: çift dokunma ile yakınlaştırma / uzun basma menüsü olmasın
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(on) { this.root.hidden = !on; }

  setReady(on) {
    this.actionBtn.classList.toggle('ready', on);
  }

  /** Kısa fiil (≤ 8 harf); boşsa varsayılan "Aksiyon" */
  setLabel(text) {
    const t = text || 'Aksiyon';
    if (this.actionBtn.textContent !== t) this.actionBtn.textContent = t;
  }

  bindMove() {
    const z = this.moveZone;
    z.addEventListener('pointerdown', (e) => {
      if (this.movePointer !== null) return;
      e.preventDefault();
      this.movePointer = e.pointerId;
      capture(z, e.pointerId);
      this.origin.x = e.clientX;
      this.origin.y = e.clientY;
      this.joy.style.transform = `translate(${e.clientX - 58}px, ${e.clientY - 58}px)`;
      this.knob.style.transform = 'translate(0px, 0px)';
      this.joy.classList.add('active');
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.movePointer) return;
      let dx = e.clientX - this.origin.x;
      let dy = e.clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      let x = dx / RADIUS;
      let y = -dy / RADIUS;
      if (Math.hypot(x, y) < DEADZONE) { x = 0; y = 0; }
      this.input.setJoystick(x, y);
    });
    const end = (e) => {
      if (e.pointerId !== this.movePointer) return;
      this.movePointer = null;
      this.joy.classList.remove('active');
      this.input.setJoystick(0, 0);
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  bindLook() {
    const z = this.lookZone;
    z.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      e.preventDefault();
      this.lookPointer = e.pointerId;
      capture(z, e.pointerId);
      this.lastLook.x = e.clientX;
      this.lastLook.y = e.clientY;
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      const dx = e.clientX - this.lastLook.x;
      const dy = e.clientY - this.lastLook.y;
      this.lastLook.x = e.clientX;
      this.lastLook.y = e.clientY;
      if (dx || dy) this.input.addLook(dx * LOOK_SENS, dy * LOOK_SENS);
    });
    const end = (e) => {
      if (e.pointerId === this.lookPointer) this.lookPointer = null;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  reset() {
    this.movePointer = null;
    this.lookPointer = null;
    this.joy.classList.remove('active');
    this.input.setJoystick(0, 0);
  }
}

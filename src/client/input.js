// Unified input: keyboard + mouse (pointer lock with drag fallback) + multitouch
// (floating joystick on the left, drag-to-look on the right, on-screen buttons).
import { IS_TOUCH } from './settings.js';

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump', KeyC: 'crouch', ControlLeft: 'crouch', KeyE: 'interact', KeyF: 'light',
  KeyV: 'cam', KeyR: 'reload', KeyI: 'inv', Tab: 'inv', Escape: 'pause', KeyP: 'pause', KeyQ: 'swap', KeyH: 'horn', KeyL: 'headlights',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', KeyM: 'map', KeyX: 'heal', Enter: 'chat',
};
const HOLD = new Set(['up', 'down', 'left', 'right', 'sprint', 'fire', 'aim', 'hand', 'jump']);

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.keys = new Set();
    this.held = new Set();
    this.edges = new Set();
    this.lookDX = 0; this.lookDY = 0;
    this.joy = { x: 0, y: 0, active: false, id: -1, ox: 0, oy: 0 };
    this.lookId = -1; this.lookX = 0; this.lookY = 0;
    this.enabled = false;
    this.locked = false;
    this.dragLook = false;
    this.touchMode = IS_TOUCH;
    this.crouchToggle = false;
    this.sprintToggle = false;
    this.lastTouchLook = 0;
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.edges.add(a);
      this.keys.add(a);
    });
    addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) this.keys.delete(a); });
    addEventListener('blur', () => { this.keys.clear(); this.held.clear(); this.joy.active = false; this.joy.x = this.joy.y = 0; });

    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.pointerType === 'touch') return;
      if (!this.locked && !this.touchMode) {
        try { const p = c.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { c.requestPointerLock(); } catch (er) { /* */ } }); } catch (er) { this.dragLook = true; }
      }
      if (e.button === 0) this.held.add('fire');
      if (e.button === 2) { this.held.add('aim'); if (!this.locked) this.dragLook = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.held.delete('fire'); if (e.button === 2) this.held.delete('aim'); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === c; });
    addEventListener('mousemove', (e) => {
      if (!this.enabled || this.touchMode) return;
      if (this.locked || (this.dragLook && (e.buttons & 3))) {
        const k = 0.0022 * this.settings.sens;
        this.lookDX += e.movementX * k; this.lookDY += e.movementY * k;
      }
    });
    c.addEventListener('wheel', (e) => { if (this.enabled) this.edges.add(e.deltaY > 0 ? 'next' : 'prev'); }, { passive: true });

    // ---- touch / pointer controls
    const joyZone = document.getElementById('joyzone');
    const lookZone = document.getElementById('lookzone');
    const base = document.getElementById('joybase'), knob = document.getElementById('joyknob');
    this.base = base; this.knob = knob;
    const R = () => 52 * this.settings.touchScale;
    joyZone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.touchMode) return;
      this.touchMode = true;
      e.preventDefault();
      if (this.joy.active) return;
      try { joyZone.setPointerCapture(e.pointerId); } catch (er) { /* pointer already gone */ }
      this.joy.active = true; this.joy.id = e.pointerId; this.joy.ox = e.clientX; this.joy.oy = e.clientY;
      base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px';
      base.classList.add('active');
      knob.style.transform = 'translate(-50%,-50%)';
    });
    const joyMove = (e) => {
      if (e.pointerId !== this.joy.id) return;
      e.preventDefault();
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const r = R(), d = Math.hypot(dx, dy);
      if (d > r * 1.6) { // drag the base along (floating joystick)
        const k = (d - r * 1.6) / d; this.joy.ox += dx * k; this.joy.oy += dy * k;
        base.style.left = this.joy.ox + 'px'; base.style.top = this.joy.oy + 'px';
        dx = e.clientX - this.joy.ox; dy = e.clientY - this.joy.oy;
      }
      const m = Math.min(1, Math.hypot(dx, dy) / r);
      const a = Math.atan2(dy, dx);
      this.joy.x = Math.cos(a) * m; this.joy.y = -Math.sin(a) * m;
      const kx = Math.cos(a) * Math.min(r, Math.hypot(dx, dy)), ky = Math.sin(a) * Math.min(r, Math.hypot(dx, dy));
      knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    };
    const joyEnd = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.active = false; this.joy.id = -1; this.joy.x = this.joy.y = 0;
      base.classList.remove('active');
      knob.style.transform = 'translate(-50%,-50%)';
    };
    joyZone.addEventListener('pointermove', joyMove);
    joyZone.addEventListener('pointerup', joyEnd);
    joyZone.addEventListener('pointercancel', joyEnd);
    joyZone.addEventListener('lostpointercapture', joyEnd);

    lookZone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.touchMode) return;
      this.touchMode = true;
      e.preventDefault();
      if (this.lookId !== -1) return;
      try { lookZone.setPointerCapture(e.pointerId); } catch (er) { /* pointer already gone */ }
      this.lookId = e.pointerId; this.lookX = e.clientX; this.lookY = e.clientY;
    });
    const lookMove = (e) => {
      if (e.pointerId !== this.lookId) return;
      e.preventDefault();
      const k = 0.0052 * this.settings.touchSens;
      this.lookDX += (e.clientX - this.lookX) * k; this.lookDY += (e.clientY - this.lookY) * k;
      this.lookX = e.clientX; this.lookY = e.clientY;
      this.lastTouchLook = performance.now();
    };
    const lookEnd = (e) => { if (e.pointerId === this.lookId) this.lookId = -1; };
    lookZone.addEventListener('pointermove', lookMove);
    lookZone.addEventListener('pointerup', lookEnd);
    lookZone.addEventListener('pointercancel', lookEnd);
    lookZone.addEventListener('lostpointercapture', lookEnd);

    // on-screen buttons: data-act; hold actions stay pressed, others fire an edge.
    // The fire button also acts as a look surface so you can aim while shooting.
    document.querySelectorAll('[data-act]').forEach((el) => {
      const act = el.dataset.act;
      let pid = -1, lx = 0, ly = 0;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.touchMode = true;
        try { el.setPointerCapture(e.pointerId); } catch (er) { /* */ }
        pid = e.pointerId; lx = e.clientX; ly = e.clientY;
        el.classList.add('down');
        if (act === 'sprint') { this.sprintToggle = !this.sprintToggle; el.classList.toggle('on', this.sprintToggle); return; }
        if (act === 'crouch') { this.edges.add('crouch'); return; }
        if (HOLD.has(act)) this.held.add(act);
        this.edges.add(act);
        if (navigator.vibrate && (act === 'fire' || act === 'interact')) { try { navigator.vibrate(8); } catch (er) { /* */ } }
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId !== pid || act !== 'fire') return;
        const k = 0.0052 * this.settings.touchSens;
        this.lookDX += (e.clientX - lx) * k; this.lookDY += (e.clientY - ly) * k;
        lx = e.clientX; ly = e.clientY;
      });
      const up = (e) => { if (e.pointerId !== pid) return; pid = -1; el.classList.remove('down'); if (HOLD.has(act)) this.held.delete(act); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    });
  }

  down(a) { return this.keys.has(a) || this.held.has(a); }
  pressed(a) { if (this.edges.has(a)) { this.edges.delete(a); return true; } return false; }

  // movement vector (x = strafe right, y = forward)
  move() {
    let x = 0, y = 0;
    if (this.keys.has('left')) x -= 1;
    if (this.keys.has('right')) x += 1;
    if (this.keys.has('up')) y += 1;
    if (this.keys.has('down')) y -= 1;
    if (x || y) { const l = Math.hypot(x, y); return { x: x / l, y: y / l, mag: 1, analog: false }; }
    if (this.joy.active) {
      const m = Math.hypot(this.joy.x, this.joy.y);
      const dz = 0.12;
      if (m < dz) return { x: 0, y: 0, mag: 0, analog: true };
      const k = (m - dz) / (1 - dz) / m;
      return { x: this.joy.x * k, y: this.joy.y * k, mag: Math.min(1, (m - dz) / (1 - dz)), analog: true };
    }
    return { x: 0, y: 0, mag: 0, analog: false };
  }
  sprinting() {
    if (this.keys.has('sprint')) return true;
    if (this.sprintToggle) return true;
    return this.settings.autoSprint && this.joy.active && Math.hypot(this.joy.x, this.joy.y) > 0.94;
  }
  takeLook() { const d = [this.lookDX, this.lookDY]; this.lookDX = 0; this.lookDY = 0; return d; }
  clearEdges() { this.edges.clear(); }
  releaseAll() { this.held.clear(); this.keys.clear(); this.edges.clear(); this.joy.active = false; this.joy.x = this.joy.y = 0; this.lookId = -1; }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
}

import { CAR_RULES, carPhysics, carZone } from '/shared/cars.js';
import { setBrake, setNeedle } from '../world/CarModels.js';

const KMH = 3.6;

/**
 * Araba kokpiti (yalnızca kendi arabanı sürerken çalışır):
 *  - HUD: büyük km/s göstergesi, vites (D1…D8 / R / N), devir çubuğu, bölge hız sınırı tabelası;
 *    drag pistinde DragRaceTrack zamanlayıcıyı buraya yazar. DOM yalnızca değer değişince güncellenir.
 *  - 3B kokpit: direksiyon simidi direksiyonla döner, ön tekerlekler kırılır, gösterge ibresi hızı
 *    gösterir, fren yapınca stop lambaları parlar.
 *  - FPV hissi: hızla genişleyen görüş açısı (FOV) ve yüksek hızda hafif kamera titreşimi.
 *    "Sallanmayı azalt" ayarı açıksa titreşim yok, FOV genişlemesi yarım.
 *  - Motor sesi (WebAudio, paylaşılan Sfx bağlamı): testere + kare dalga → alçak geçiren filtre;
 *    perde devirle (silindir sayısı × devir / 120 Hz), filtre ve ses gazla açılır. Elektrikli
 *    arabalarda hafif motor uğultusu. Ses yalnızca sürerken çalar; durunca bağlam uykuya geçer.
 *  - Mobil: büyük ⛽ / 🛑 pedalları (W / S tuşu gibi davranır) — joystick de çalışır.
 * Pil: sürmüyorken hiçbir iş yapılmaz (update hemen döner); araba duruyorsa kare istenmez.
 */
export class CarCockpit {
  constructor({ engine, player, input, settings, sfx, device }) {
    Object.assign(this, { engine, player, input, settings, sfx, device });
    this.car = null; // { v, def, obj }
    this.baseFov = engine.camera.fov;
    this.audio = null;
    this.hudKey = '';
    this.t = 0;
    this.gear = 1;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('car-hud'), speed: $('car-speed'), gear: $('car-gear'), rpm: $('car-rpm'), limit: $('car-limit'),
      timer: $('car-timer'), name: $('car-name'), pedals: $('car-pedals'), gas: $('car-gas'), brake: $('car-brake'),
    };
    const pedal = (el, code) => {
      const set = (on) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.input.setKey(code, on);
        el.classList.toggle('down', on);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    };
    pedal(this.el.gas, 'KeyW');
    pedal(this.el.brake, 'KeyS');
  }

  get active() { return !!this.car; }

  start(v, def, obj) {
    this.car = { v, def, obj, ph: carPhysics(def) };
    this.baseFov = this.engine.camera.fov;
    this.el.name.textContent = def.name;
    this.el.hud.hidden = false;
    this.el.pedals.hidden = !this.device.touch;
    this.hudKey = '';
    obj.userData.head.visible = false;
    if (this.settings.sound) this.startAudio();
  }

  stop() {
    if (!this.car) return;
    const { obj } = this.car;
    setBrake(obj, false);
    obj.userData.wheel.rotation.z = 0;
    for (const p of obj.userData.steer) p.rotation.y = 0;
    setNeedle(obj, 0);
    this.car = null;
    this.el.hud.hidden = true;
    this.el.pedals.hidden = true;
    this.input.setKey('KeyW', false);
    this.input.setKey('KeyS', false);
    this.el.gas.classList.remove('down');
    this.el.brake.classList.remove('down');
    this.setTimer(null);
    const cam = this.engine.camera;
    if (cam.fov !== this.baseFov) {
      cam.fov = this.baseFov;
      cam.updateProjectionMatrix();
    }
    this.stopAudio();
    this.engine.requestRender();
  }

  /** Drag zamanlayıcısı (DragRaceTrack) — null → gizli */
  setTimer(text, cls = '') {
    const el = this.el.timer;
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
  }

  /** Vites ve devir (görsel + ses) */
  drivetrain(v, thr) {
    const { def, ph } = this.car;
    const idle = 850;
    const red = def.redline;
    const s = Math.abs(v);
    if (def.cyl === 0) return { gear: v < -0.05 ? 'R' : 'D', rpm: (s / ph.vmax) * red, k: s / ph.vmax };
    if (def.gears <= 1) {
      // Varyomatik (kayış): devir gaza göre sabit kalır
      const rpm = idle + (red * 0.82 - idle) * Math.min(1, Math.max(thr, 0) * 0.75 + (s / ph.vmax) * 0.45);
      return { gear: v < -0.05 ? 'R' : 'D', rpm, k: rpm / red };
    }
    if (v < -0.05) return { gear: 'R', rpm: idle + (s / CAR_RULES.REVERSE) * red * 0.4, k: 0.3 };
    const n = def.gears;
    const top = (i) => ph.vmax * ((i / n) ** 0.72) * 1.04;
    let g = this.gear;
    while (g < n && s > top(g) * 0.95) g++;
    while (g > 1 && s < top(g - 1) * 0.7) g--;
    this.gear = g;
    const rpm = Math.max(idle, Math.min(red, (s / top(g)) * red));
    return { gear: s < 0.2 && thr <= 0 ? 'N' : `D${g}`, rpm, k: rpm / red };
  }

  /** @returns {boolean} kare gerekli mi */
  update(dt) {
    if (!this.car) return false;
    const p = this.player;
    const { obj } = this.car;
    const v = p.vel;
    const mv = this.input.moveVector({ x: 0, y: 0 });
    const thr = mv.y;
    const kmh = Math.abs(v) * KMH;
    const dtr = this.drivetrain(v, thr);
    // 3B kokpit
    obj.userData.wheel.rotation.z = p.steer * 1.7;
    for (const pv of obj.userData.steer) pv.rotation.y = -p.steer * 0.42;
    setNeedle(obj, kmh);
    setBrake(obj, (thr < 0 && v > 0.1) || (Math.abs(v) < 0.1 && thr <= 0));
    // HUD (yalnızca değişince)
    const limit = carZone(p.pos.x, p.pos.z) === 'drag' ? '' : String(CAR_RULES.CITY_KMH);
    const rpmPct = Math.round(Math.min(1, dtr.rpm / this.car.def.redline) * 20) * 5;
    const key = `${Math.round(kmh)}|${dtr.gear}|${rpmPct}|${limit}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.el.speed.textContent = String(Math.round(kmh));
      this.el.gear.textContent = dtr.gear;
      this.el.rpm.style.transform = `scaleX(${rpmPct / 100})`;
      this.el.rpm.classList.toggle('red', rpmPct >= 90);
      this.el.limit.hidden = !limit;
      this.el.limit.textContent = limit;
    }
    // FOV + titreşim
    const cam = this.engine.camera;
    const calm = this.settings.reduceMotion;
    const fov = this.baseFov + Math.min(16, kmh * 0.065) * (calm ? 0.5 : 1);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
    this.t += dt;
    if (!calm && Math.abs(v) > 22) {
      const a = Math.min(1, (Math.abs(v) - 22) / 60) * 0.011;
      cam.position.y += Math.sin(this.t * 41) * a + Math.sin(this.t * 23.7) * a * 0.6;
      cam.position.x += Math.sin(this.t * 31.3) * a * 0.4;
    }
    this.updateAudio(dtr, thr, Math.abs(v));
    return Math.abs(v) > 0.01 || thr !== 0;
  }

  // ---- Motor sesi -----------------------------------------------------------------------

  startAudio() {
    const ctx = this.sfx.begin?.(800);
    if (!ctx || this.audio) return;
    try {
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(ctx.destination);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.Q.value = 2.2;
      filter.connect(out);
      const ev = this.car.def.cyl === 0;
      const o1 = ctx.createOscillator();
      o1.type = ev ? 'sine' : 'sawtooth';
      const o2 = ctx.createOscillator();
      o2.type = ev ? 'triangle' : 'square';
      const g2 = ctx.createGain();
      g2.gain.value = ev ? 0.25 : 0.5;
      o1.connect(filter);
      o2.connect(g2).connect(filter);
      o1.start();
      o2.start();
      this.audio = { ctx, out, filter, o1, o2, ev };
    } catch {
      this.audio = null;
    }
  }

  updateAudio(dtr, thr, speed) {
    const a = this.audio;
    if (!a) return;
    this.sfx.keepAwake(600);
    const t = a.ctx.currentTime;
    const load = Math.max(0, thr);
    if (a.ev) {
      const f = 90 + speed * 9;
      a.o1.frequency.setTargetAtTime(f, t, 0.05);
      a.o2.frequency.setTargetAtTime(f * 1.5, t, 0.05);
      a.filter.frequency.setTargetAtTime(900 + speed * 25, t, 0.08);
      a.out.gain.setTargetAtTime(0.012 + Math.min(0.05, speed * 0.0012 + load * 0.02), t, 0.08);
      return;
    }
    const f = (dtr.rpm / 60) * (this.car.def.cyl / 2);
    a.o1.frequency.setTargetAtTime(f, t, 0.025);
    a.o2.frequency.setTargetAtTime(f / 2, t, 0.025);
    a.filter.frequency.setTargetAtTime(300 + load * 1500 + dtr.rpm * 0.12, t, 0.05);
    a.out.gain.setTargetAtTime(0.035 + load * 0.05 + dtr.k * 0.02, t, 0.06);
  }

  stopAudio() {
    const a = this.audio;
    if (!a) return;
    this.audio = null;
    try {
      const t = a.ctx.currentTime;
      a.out.gain.setTargetAtTime(0, t, 0.08);
      a.o1.stop(t + 0.4);
      a.o2.stop(t + 0.4);
      setTimeout(() => a.out.disconnect(), 600);
    } catch { /* yok say */ }
  }
}

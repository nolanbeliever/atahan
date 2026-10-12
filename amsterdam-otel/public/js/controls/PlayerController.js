import { EYE_HEIGHT, PLAYER_RADIUS } from '/shared/layout.js';

const WALK = 3.0; // m/sn
const RUN = 5.0;
const PITCH_LIMIT = 1.45;

/** Birinci şahıs (FPV) oyuncu: girdiyi hareket + kamera dönüşüne çevirir */
export class PlayerController {
  constructor({ camera, collision, input }) {
    this.camera = camera;
    this.collision = collision;
    this.input = input;
    this.pos = { x: 0, z: 3 };
    this.yaw = Math.PI; // +Z (koridora doğru) bakar
    this.pitch = 0;
    this._look = { x: 0, y: 0 };
    this._move = { x: 0, y: 0 };
    this._teleported = false;
    this.moved = false;
    // Trip etkileri için: hız çarpanı, kısa süre hareketsizlik, kamera ofseti
    this.speedMul = 1;
    this.stunUntil = 0;
    this.lockUntil = 0; // bar: dökerken / çalkalarken / yıkarken yürünmez (bakış serbest)
    this.viewOffset = { pitch: 0, yaw: 0, roll: 0 };
    // Araç (CityVehicleSystem): sürüş modu { speed, accel, turn, eye, radius } ya da yolcu modu
    // follow() → { x, z } (konumu sürücü belirler, bakış serbest)
    this.drive = null;
    this.follow = null;
    this.vel = 0; // sürüşte ileri hız (m/sn)
    this.steer = 0; // görsel eğilme için son direksiyon girdisi
    this.eye = EYE_HEIGHT;
    this.apply();
  }

  setPose(x, z, yaw) {
    this.pos.x = x;
    this.pos.z = z;
    if (yaw !== undefined) this.yaw = yaw;
    this._teleported = true; // sonraki karede etkileşim hedefleri yeniden hesaplansın
    this.apply();
  }

  /** İleri yön vektörü (XZ) */
  forward(out) {
    out.x = -Math.sin(this.yaw);
    out.z = -Math.cos(this.yaw);
    return out;
  }

  /** @returns {boolean} kamera değişti ya da hareket girdisi sürüyor */
  update(dt) {
    let changed = this._teleported;
    this._teleported = false;
    const look = this.input.consumeLook(this._look);
    if (look.x || look.y) {
      this.yaw -= look.x;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - look.y));
      changed = true;
    }

    if (this.follow) return this.updateFollow(changed);
    if (this.drive) return this.updateDrive(dt, changed);

    const mv = this.input.moveVector(this._move);
    const now = performance.now();
    const moving = (mv.x !== 0 || mv.y !== 0) && now >= this.stunUntil && now >= this.lockUntil;
    if (moving) {
      const joyFull = Math.hypot(this.input.joyX, this.input.joyY) > 0.97;
      const speed = (this.input.run || joyFull ? RUN : WALK) * this.speedMul;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // ileri = (-sin, -cos), sağ = (cos, -sin)
      const dx = (-sin * mv.y + cos * mv.x) * speed * dt;
      const dz = (-cos * mv.y - sin * mv.x) * speed * dt;
      const ox = this.pos.x;
      const oz = this.pos.z;
      this.collision.move(this.pos, dx, dz, PLAYER_RADIUS);
      if (ox !== this.pos.x || oz !== this.pos.z) changed = true;
    }

    if (changed) this.apply();
    this.moved = changed;
    return changed || moving;
  }

  /** Yolcu: konum sürücüden gelir, bakış serbest */
  updateFollow(changed) {
    const p = this.follow();
    if (p && (Math.abs(p.x - this.pos.x) > 1e-4 || Math.abs(p.z - this.pos.z) > 1e-4)) {
      this.pos.x = p.x;
      this.pos.z = p.z;
      changed = true;
    }
    if (changed) this.apply();
    this.moved = changed;
    return changed;
  }

  /**
   * Sürüş: W/S (joystick yukarı/aşağı) gaz-fren-geri, A/D (joystick yan) direksiyon,
   * fare / sağ taraf dokunuşu bakış (ve dolayısıyla yön). Hız yumuşak artar, bırakınca süzülür.
   */
  updateDrive(dt, changed) {
    const d = this.drive;
    const mv = this.input.moveVector(this._move);
    const now = performance.now();
    const thr = now >= this.lockUntil ? mv.y : 0;
    let v = this.vel;
    if (thr > 0) v += (v < 0 ? d.accel * 2 : d.accel) * thr * dt;
    else if (thr < 0) v += (v > 0 ? -d.accel * 1.6 : -d.accel * 0.5) * -thr * dt;
    else v -= Math.sign(v) * Math.min(Math.abs(v), 2.2 * dt); // süzülme
    v = Math.min(d.speed * this.speedMul, Math.max(-d.reverse, v));
    // Direksiyon: hızlanınca tam, dururken az
    const steer = now >= this.lockUntil ? mv.x : 0;
    if (steer && Math.abs(v) > 0.05) {
      this.yaw -= steer * d.turn * dt * Math.min(1, 0.35 + Math.abs(v) / 4) * Math.sign(v);
      changed = true;
    }
    this.steer += (steer - this.steer) * Math.min(1, dt * 6);
    if (Math.abs(v) > 1e-3) {
      const dx = -Math.sin(this.yaw) * v * dt;
      const dz = -Math.cos(this.yaw) * v * dt;
      const ox = this.pos.x;
      const oz = this.pos.z;
      this.collision.move(this.pos, dx, dz, d.radius);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved < Math.hypot(dx, dz) * 0.5) v *= 0.4; // duvara sürtünce yavaşla
      if (moved > 1e-5) changed = true;
    }
    this.vel = Math.abs(v) < 0.02 && !thr ? 0 : v;
    // Hafif viraj eğilmesi (kamera rulosu)
    const roll = -this.steer * Math.min(1, Math.abs(this.vel) / d.speed) * 0.07;
    if (Math.abs(roll - this.viewOffset.roll) > 1e-4) {
      this.viewOffset.roll = roll;
      changed = true;
    }
    if (changed) this.apply();
    this.moved = changed;
    return changed || this.vel !== 0 || thr !== 0;
  }

  /** Araca bin / in (CityVehicleSystem) */
  setDrive(def) {
    this.drive = def;
    this.vel = 0;
    this.steer = 0;
    this.viewOffset.roll = 0;
    this.eye = def?.eye ?? EYE_HEIGHT;
    this.apply();
  }

  setFollow(fn, eye) {
    this.follow = fn;
    this.eye = fn ? (eye ?? EYE_HEIGHT) : EYE_HEIGHT;
    this.apply();
  }

  apply() {
    this.camera.position.set(this.pos.x, this.eye, this.pos.z);
    const o = this.viewOffset;
    this.camera.rotation.set(this.pitch + o.pitch, this.yaw + o.yaw, o.roll, 'YXZ');
  }
}

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

    const mv = this.input.moveVector(this._move);
    const moving = mv.x !== 0 || mv.y !== 0;
    if (moving) {
      const joyFull = Math.hypot(this.input.joyX, this.input.joyY) > 0.97;
      const speed = this.input.run || joyFull ? RUN : WALK;
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

  apply() {
    this.camera.position.set(this.pos.x, EYE_HEIGHT, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

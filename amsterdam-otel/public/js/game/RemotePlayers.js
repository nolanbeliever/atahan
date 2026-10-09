import * as THREE from 'three';
import { makeCharacter } from './Characters.js';

function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(16,20,28,0.72)';
  ctx.fillRect(8, 8, 240, 48);
  ctx.fillStyle = color;
  ctx.fillRect(8, 8, 8, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 134, 33, 220);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(0.95, 0.24, 1);
  sprite.position.y = 1.9;
  return sprite;
}

function angleLerp(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** Diğer oyuncular (kat görevlileri): 10 Hz konum güncellemesi + yumuşak geçiş */
export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
  }

  add(p) {
    if (this.items.has(p.id)) return;
    const obj = makeCharacter({ hair: p.id % 5, skin: (p.id * 3) % 5 }, { color: p.color, staff: true });
    const label = makeLabel(p.name, p.color);
    obj.add(label);
    obj.position.set(p.x, 0, p.z);
    obj.rotation.y = p.yaw + Math.PI;
    this.scene.add(obj);
    this.items.set(p.id, { obj, label, tx: p.x, tz: p.z, tyaw: p.yaw + Math.PI });
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.scene.remove(it.obj);
    it.label.material.map.dispose();
    it.label.material.dispose();
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  /** @param batch [[id, x, z, yaw], ...] */
  applyBatch(batch, selfId) {
    for (const [id, x, z, yaw] of batch) {
      if (id === selfId) continue;
      const it = this.items.get(id);
      if (!it) continue;
      it.tx = x;
      it.tz = z;
      // Kamera yaw'ı → karakter yönü (karakterin önü +Z)
      it.tyaw = yaw + Math.PI;
    }
  }

  /** @returns {boolean} hâlâ yumuşak geçiş yapan oyuncu var mı */
  update(dt) {
    let active = false;
    const k = 1 - Math.exp(-dt * 12);
    for (const it of this.items.values()) {
      const o = it.obj;
      const dx = it.tx - o.position.x;
      const dz = it.tz - o.position.z;
      const dyaw = Math.abs(Math.atan2(Math.sin(it.tyaw - o.rotation.y), Math.cos(it.tyaw - o.rotation.y)));
      if (dx * dx + dz * dz < 1e-5 && dyaw < 1e-3) continue;
      o.position.x += dx * k;
      o.position.z += dz * k;
      o.rotation.y = angleLerp(o.rotation.y, it.tyaw, k);
      o.userData.inner.position.y = Math.hypot(dx, dz) > 0.02 ? Math.abs(Math.sin(performance.now() / 110)) * 0.03 : 0;
      active = true;
    }
    return active;
  }
}

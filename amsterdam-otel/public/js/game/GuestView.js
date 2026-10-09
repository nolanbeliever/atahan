import { GUEST_PHASE } from '/shared/constants.js';
import { pathLength, samplePath } from '/shared/path.js';
import { makeCharacter } from './Characters.js';

const SIT_DROP = 0.4;

/**
 * Misafirlerin görsel temsili. Konumlar sunucudan gelen rota + başlangıç
 * zamanından deterministik olarak hesaplanır (karede ağ trafiği yok).
 * Yalnızca yürüyen misafir varken render döngüsünü aktif tutar.
 */
export class GuestView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this._s = { x: 0, z: 0, dirX: 0, dirZ: 1, done: false };
  }

  upsert(data) {
    let it = this.items.get(data.id);
    if (!it) {
      const obj = makeCharacter(data.look);
      this.scene.add(obj);
      it = { obj, data: null, len: 0 };
      this.items.set(data.id, it);
    }
    it.data = data;
    it.len = pathLength(data.path);
    it.obj.visible = data.phase !== GUEST_PHASE.IN_ROOM;
    const u = it.obj.userData;
    it.obj.position.y = data.sit ? -SIT_DROP : 0;
    if (u.bag) u.bag.position.y = data.sit ? SIT_DROP : 0;
    u.blob.visible = !data.sit;
    u.inner.position.y = 0;
    if (data.path.length === 1) {
      it.obj.position.x = data.path[0][0];
      it.obj.position.z = data.path[0][1];
      it.obj.rotation.y = data.face || 0;
    }
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.scene.remove(it.obj);
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  /** @returns {boolean} yürüyen misafir var mı */
  update(dt, serverNow) {
    let active = false;
    const s = this._s;
    for (const it of this.items.values()) {
      const d = it.data;
      if (!it.obj.visible || d.path.length < 2) continue;
      const dist = Math.max(0, ((serverNow - d.t0) / 1000) * d.speed);
      samplePath(d.path, dist, s);
      it.obj.position.x = s.x;
      it.obj.position.z = s.z;
      it.obj.rotation.y = Math.atan2(s.dirX, s.dirZ);
      const walking = dist < it.len;
      it.obj.userData.inner.position.y = walking ? Math.abs(Math.sin(dist * 4.2)) * 0.035 : 0;
      if (walking) active = true;
    }
    return active;
  }

  /** (x,z) noktasına r metreden yakın görünür misafir var mı (kapılar için) */
  near(x, z, r) {
    const r2 = r * r;
    for (const it of this.items.values()) {
      if (!it.obj.visible) continue;
      const dx = it.obj.position.x - x;
      const dz = it.obj.position.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }
}

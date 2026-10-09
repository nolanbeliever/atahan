import * as THREE from 'three';
import { ROOM_STATUS, INTERACT_RANGE } from '/shared/constants.js';
import { isInsideRoom } from '/shared/layout.js';

/**
 * Temizlik etkileşimi: oyuncunun önündeki en yakın işi (dağınık yatak /
 * çöp) bulur, ipucunu gösterir ve Aksiyon ile sunucuya iletir.
 * Raycast yerine ucuz mesafe + bakış açısı testi kullanılır ve yalnızca
 * oyuncu hareket ettiğinde ya da oda durumu değiştiğinde yeniden hesaplanır.
 */
export class Interaction {
  constructor({ scene, world, state, player, hud, touch, net, desktop }) {
    this.world = world;
    this.state = state;
    this.player = player;
    this.hud = hud;
    this.touch = touch;
    this.net = net;
    this.desktop = desktop;
    this.current = null; // { room, t }
    this.lastVersion = -1;
    this._f = { x: 0, z: 0 };

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.34, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.marker.visible = false;
    this.marker.renderOrder = 2;
    scene.add(this.marker);
  }

  invalidate() { this.lastVersion = -1; }

  update(force = false) {
    if (!force && !this.player.moved && this.lastVersion === this.state.version) return;
    this.lastVersion = this.state.version;

    const { x: px, z: pz } = this.player.pos;
    const f = this.player.forward(this._f);
    let best = null;
    let bestScore = Infinity;
    let roomHere = null;

    for (const room of this.world.rooms) {
      if (!isInsideRoom(room.layout, px, pz)) continue;
      roomHere = room;
      if (room.state.status !== ROOM_STATUS.DIRTY) break;
      for (const t of room.targets) {
        if (!room.isTargetPending(t.target)) continue;
        const dx = t.x - px;
        const dz = t.z - pz;
        const d = Math.hypot(dx, dz);
        if (d > INTERACT_RANGE[t.kind]) continue;
        const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
        // Çok yakında değilse oyuncunun bakış yönünde olmalı
        if (d > 0.9 && dot < 0.3) continue;
        const score = d - dot * 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = { room, t };
        }
      }
      break;
    }

    this.current = best;
    if (best) {
      this.marker.position.set(best.t.x, 0.02, best.t.z);
      this.marker.visible = true;
      this.hud.setPrompt({ key: this.desktop ? 'E' : null, text: best.t.label });
    } else {
      this.marker.visible = false;
      if (roomHere && roomHere.state.status === ROOM_STATUS.DIRTY) {
        const st = roomHere.state;
        const parts = [];
        if (!st.bedMade) parts.push('dağınık yatak');
        const trash = st.trash.filter(Boolean).length;
        if (trash) parts.push(`${trash} çöp`);
        this.hud.setPrompt({ info: `Oda ${roomHere.id} kirli: ${parts.join(', ')}. Yaklaş ve bak.` });
      } else {
        this.hud.setPrompt(null);
      }
    }
    this.hud.setCrosshairReady(!!best);
    this.touch?.setReady(!!best);
  }

  /** Aksiyon tuşu / butonu */
  trigger() {
    const c = this.current;
    if (!c) return;
    const { room, t } = c;
    this.net.interact(room.id, t.target);
    // İyimser güncelleme: anında tepki, sunucu yanıtı gerçeği belirler
    const st = { ...room.state, trash: [...room.state.trash] };
    if (t.target === 'bed') st.bedMade = true;
    else st.trash[t.target] = false;
    room.applyState(st);
    this.state.version++;
    this.update(true);
  }
}

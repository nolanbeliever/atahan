import * as THREE from 'three';
import { ROOM_STATUS, INTERACT_RANGE } from '/shared/constants.js';
import { isInsideRoom } from '/shared/layout.js';

/**
 * Etkileşim: oyuncunun önündeki en yakın hedefi bulur, ipucunu gösterir ve
 * Aksiyon ile çalıştırır.
 *  - Yerleşik hedefler: kirli odadaki dağınık yatak / çöpler.
 *  - Sağlayıcılar (providers): diğer sistemlerin hedefleri (ör. coffee shop
 *    tezgâhı, slot makinesi) → `find(px, pz, forward)` → { x, z, label, use, marker }.
 *  - Boşta ipucu (idleHint): hedef yokken gösterilecek öneri (ör. "F: tüket").
 * Raycast yerine ucuz mesafe + bakış açısı testi kullanılır ve yalnızca
 * oyuncu hareket ettiğinde ya da durum değiştiğinde yeniden hesaplanır.
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
    this.current = null; // { room, t } | { ext }
    this.providers = [];
    this.idleHint = null; // () => { text, touchAction } | null
    this.idleShown = false;
    this.idleShort = null;
    this.onIdleAction = null; // dokunmatik Aksiyon, hedef yokken
    this.onRoomAction = null; // (room, target) — oda temizliği eylemi (toplama animasyonu için)
    this.busy = null; // zamanlı eylem sürerken (bar) gösterilecek metin; hedefleme durur
    this.lastVersion = -1;
    this.enabled = true;
    this._f = { x: 0, z: 0 };

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.34, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.marker.visible = false;
    this.marker.renderOrder = 2;
    scene.add(this.marker);
  }

  addProvider(p) { this.providers.push(p); }

  invalidate() { this.lastVersion = -1; }

  /** Zamanlı bir eylem sürerken hedeflemeyi durdurup yalnızca durum metnini göster */
  setBusy(text) {
    this.busy = text || null;
    this.invalidate();
  }

  /** Dekorasyon modu gibi durumlarda normal hedeflemeyi kapatır */
  setEnabled(on) {
    this.enabled = on;
    this.current = null;
    this.marker.visible = false;
    this.idleShown = false;
    this.invalidate();
  }

  update(force = false) {
    if (!this.enabled) return;
    if (!force && !this.player.moved && this.lastVersion === this.state.version) return;
    this.lastVersion = this.state.version;
    if (this.busy) {
      this.current = null;
      this.idleShown = false;
      this.marker.visible = false;
      this.hud.setPrompt({ info: this.busy });
      this.hud.setCrosshairReady(false);
      this.touch?.setReady(false);
      this.touch?.setLabel(null);
      return;
    }

    const { x: px, z: pz } = this.player.pos;
    const f = this.player.forward(this._f);
    let best = null;
    let roomHere = null;

    for (const room of this.world.rooms) {
      if (!isInsideRoom(room.layout, px, pz)) continue;
      roomHere = room;
      if (room.state.status === ROOM_STATUS.DIRTY) best = this.findRoomTarget(room, px, pz, f);
      break;
    }
    if (!best && !roomHere) {
      for (const p of this.providers) {
        const ext = p.find(px, pz, f);
        if (ext) {
          best = { ext };
          break;
        }
      }
    }

    this.current = best;
    this.idleShown = false;
    if (best) {
      const t = best.ext || best.t;
      const showMarker = !best.ext || best.ext.marker !== false;
      this.marker.visible = showMarker;
      if (showMarker) this.marker.position.set(t.x, 0.02, t.z);
      this.hud.setPrompt({ key: this.desktop ? 'E' : null, text: t.label });
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
        // İpucu metin ya da { text, short } olabilir (short: dokunmatik buton etiketi)
        const hint = this.idleHint?.();
        const text = typeof hint === 'string' ? hint : hint?.text;
        this.idleShown = !!text;
        this.idleShort = typeof hint === 'object' ? hint?.short : null;
        this.hud.setPrompt(text ? { key: this.desktop ? 'F' : null, text } : null);
      }
    }
    this.hud.setCrosshairReady(!!best);
    this.touch?.setReady(!!best || this.idleShown);
    let short = null;
    if (best?.ext) short = best.ext.short;
    else if (best?.t) short = best.t.kind === 'bed' ? 'Düzelt' : 'Topla';
    else if (this.idleShown) short = this.idleShort;
    this.touch?.setLabel(short);
  }

  findRoomTarget(room, px, pz, f) {
    let best = null;
    let bestScore = Infinity;
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
    return best;
  }

  /** Aksiyon tuşu / butonu. @param source 'key' | 'mouse' | 'touch' */
  trigger(source) {
    const c = this.current;
    if (!c) {
      // Mobilde Aksiyon butonu, hedef yokken envanterdeki ürünü tüketir
      if (source === 'touch' && this.idleShown) this.onIdleAction?.();
      return;
    }
    if (c.ext) {
      c.ext.use();
      return;
    }
    const { room, t } = c;
    this.net.interact(room.id, t.target);
    this.onRoomAction?.(room, t);
    // İyimser güncelleme: anında tepki, sunucu yanıtı gerçeği belirler
    const st = { ...room.state, trash: [...room.state.trash] };
    if (t.target === 'bed') st.bedMade = true;
    else st.trash[t.target] = false;
    room.applyState(st);
    this.state.version++;
    this.update(true);
  }
}

import { EVT } from '/shared/constants.js';
import {
  CARGO_DOCK as D, CARGO_TYPES, CARGO_TYPE_IDS, CARGO_RULES as R, JACK, PALLET,
  forkCenter, palletAngleDiff, truckPose, palletUnits,
} from '/shared/cargo.js';
import { buildCargoDock, buildCityGateSign, makeTruck, makePalletKit, makePallet, makeJack } from '../world/CargoDockBuilding.js';

/** Hedef oyuncunun önünde mi (mesafe + bakış açısı) */
function facing(px, pz, f, x, z, range, minDot = 0.3) {
  const dx = x - px;
  const dz = z - pz;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  return d < 0.7 || (dx * f.x + dz * f.z) / d > minDot;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const TYPES = Object.assign(Object.create(null), CARGO_TYPES);

/**
 * Mal Kabul Rampası & Transpalet (istemci).
 *
 *  - Erişim: Achterstraat'ın batı ucundaki demir servis kapısı (E) ya da hızlı ışınlanma (🚚). Avlu
 *    UndergroundGarage'ın alan yöneticisine 'dock' alanı olarak eklenir: oradayken otel dünyası çizilmez.
 *  - Toptancı siparişi: Resepsiyon PC → "🚚 Mal Kabul" sekmesi ya da salondaki sevkiyat ofisi terminali.
 *    NPC tırı avlu kapısından girip boş rampaya geri geri yanaşır; paletler dorsenin içindedir.
 *  - Transpalet: E ile al, FPV sür (W/S ileri-geri, A/D ya da fare dön — yerinde döner), çatalları paletin
 *    altına hizala, E ile kaldır; yük asansörünün kabinine götür, E ile indir; kolondan asansörü gönder →
 *    paletler depo stokuna. Taşınan palet sert çarpmada hasar görür (stok değeri düşer). Q: transpaletten in.
 *  - Diğer oyuncuların transpaleti ve taşıdığı palet, oyuncunun kendi konumuyla (10 Hz) birlikte çizilir.
 */
export class CargoDockManagement {
  constructor({ engine, net, hud, interaction, player, input, modal, device, settings, sfx, collision, garage, reception, touch, remotes }) {
    Object.assign(this, { engine, net, hud, interaction, player, input, modal, device, settings, sfx, collision, garage, reception, touch, remotes });
    this.view = buildCargoDock({ collision });
    engine.scene.add(this.view.group);
    garage.addArea('dock', this.view.group);
    engine.scene.add(buildCityGateSign()); // otel dünyasının parçası (partitionWorld'den önce)

    this.trucks = D.bays.map(() => {
      const t = makeTruck();
      t.obj.visible = false;
      this.view.group.add(t.obj);
      return { ...t, id: 0 };
    });
    this.kit = makePalletKit();
    this.palletObjs = new Map(); // id → { obj, type }
    this.palletBoxes = [];
    this.jackObjs = D.jacks.map((j) => {
      const o = makeJack();
      o.position.set(j.x, 0, j.z);
      o.rotation.y = j.yaw;
      this.view.group.add(o);
      return o;
    });
    this.state = null;
    this.selfId = null;
    this.drive = null; // { j, x, z, yaw, v, lift, carry, lastBump, lastSend }
    this.followPos = { x: 0, z: 0 };
    this.pending = false;
    this.doorOpen = 1; // asansör kapısı animasyonu (0 kapalı, 1 açık)
    this.form = Object.fromEntries(CARGO_TYPE_IDS.map((t) => [t, 0]));
    this.hudKey = '';
    this.lastBeep = 0;
    this._mv = { x: 0, y: 0 };
    this._pos = { x: 0, z: 0 };
    this._load = { x: 0, z: 0 };
    this._pose = { x: 0, z: 0, yaw: 0 };

    this.buildHud();
    this.buildOffice();
    // Resepsiyon PC: "🚚 Mal Kabul" sekmesi (genel ek sekme kancası)
    if (reception) {
      reception.tabs.cargo = (body) => this.renderTab(body, 'pc');
      const tabs = document.getElementById('pc-tabs');
      if (tabs && !tabs.querySelector('[data-tab="cargo"]')) {
        const b = el('button', null, '🚚 Mal Kabul');
        b.type = 'button';
        b.dataset.tab = 'cargo';
        tabs.append(b);
      }
    }
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    const prevArea = garage.onArea;
    garage.onArea = (id, from) => {
      prevArea?.(id, from);
      this.onArea(id, from);
    };
  }

  get inDock() { return this.garage.area === 'dock'; }

  reset(selfId) {
    this.selfId = selfId;
    if (this.drive) this.stopDrive();
  }

  // ---- Durum -----------------------------------------------------------------------------------

  onState(s) {
    if (!s) return;
    this.state = s;
    const now = this.net.serverNow();
    // Tırlar
    s.bays.forEach((t, i) => {
      const tr = this.trucks[i];
      tr.obj.visible = !!t;
      if (t && t.id !== tr.id) {
        tr.id = t.id;
        tr.setSupplier(t.supplier);
        if (this.inDock && t.phase === 'arriving') this.sound('horn');
      }
      const docked = t?.phase === 'docked';
      this.view.bayBlocks[i].enabled = !docked;
      for (const w of this.view.trailerWalls[i]) w.enabled = docked;
      if (t) this.placeTruck(i, t, now);
    });
    // Paletler: nesneler + çarpışma kutuları
    const seen = new Set();
    for (const p of s.pallets) {
      seen.add(p.id);
      let o = this.palletObjs.get(p.id);
      if (!o || o.type !== p.type) {
        if (o) this.view.group.remove(o.obj);
        o = { obj: makePallet(this.kit, p.type), type: p.type };
        this.palletObjs.set(p.id, o);
        this.view.group.add(o.obj);
      }
      o.data = p;
      if (p.where !== 'jack') {
        o.obj.position.set(p.x, p.where === 'cabin' ? 0.005 : 0, p.z);
        o.obj.rotation.y = p.yaw;
      }
      o.obj.visible = true;
    }
    for (const [id, o] of this.palletObjs) {
      if (seen.has(id)) continue;
      this.view.group.remove(o.obj);
      this.palletObjs.delete(id);
    }
    for (const b of this.palletBoxes) this.collision.remove(b);
    this.palletBoxes = [];
    for (const p of s.pallets) {
      if (p.where === 'jack') continue;
      if (p.where === 'trailer' && s.bays[p.bay]?.phase !== 'docked') continue;
      const side = Math.abs(Math.sin(p.yaw)) > 0.7;
      const hx = (side ? PALLET.L : PALLET.W) / 2;
      const hz = (side ? PALLET.W : PALLET.L) / 2;
      this.palletBoxes.push(this.collision.add(p.x - hx, p.x + hx, p.z - hz, p.z + hz));
    }
    // Kendi transpaletim: sunucu bıraktıysa (avludan çıkış, bağlantı) sürüş biter
    if (this.drive) {
      const j = s.jacks[this.drive.j];
      if (!j || j.by !== this.selfId) this.stopDrive();
      else if (!this.pending) this.drive.carry = j.carry || 0;
    }
    if (!this.office.hidden) this.renderTab(this.office.body, 'dock');
    if (this.reception?.tab === 'cargo' && !this.reception.el.panel.hidden) this.reception.render();
    this.hudKey = '';
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  placeTruck(i, t, now) {
    const ms = t.phase === 'arriving' ? R.ARRIVE_MS : R.LEAVE_MS;
    const u = t.phase === 'docked' ? 1 : Math.min(1, Math.max(0, (now - t.at) / ms));
    const pose = truckPose(i, t.phase, u, this._pose);
    const o = this.trucks[i].obj;
    o.position.set(pose.x, 0, pose.z);
    o.rotation.y = pose.yaw;
    return u < 1;
  }

  onArea(id) {
    if (id !== 'dock' && this.drive) this.stopDrive(); // ışınlanma vb.: sunucu transpaleti avluda bırakır
    if (!this.office.hidden && id !== 'dock') this.modal.close(this.office.el);
    this.interaction.invalidate();
  }

  // ---- Etkileşim ---------------------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (this.drive || this.player.drive || this.player.follow) return null;
    if (!this.inDock) {
      const G = D.cityGate;
      if (this.garage.area === 'city' && facing(px, pz, f, G.point[0], G.point[1], D.range)) {
        return { x: G.point[0], z: G.point[1], short: 'Kapı', label: '🚚 Mal Kabul Rampası (servis kapısı)', use: () => this.gate() };
      }
      return null;
    }
    const Dr = D.door;
    if (facing(px, pz, f, Dr.point[0], Dr.point[1], D.range)) {
      return { x: Dr.point[0], z: Dr.point[1], short: 'Çık', label: '🚪 Achterstraat\'a çık', use: () => this.gate() };
    }
    const s = this.state;
    if (!s) return null;
    const P = D.elevator.panel;
    if (facing(px, pz, f, P.point[0], P.point[1], P.range)) {
      const n = s.cabin.slots.filter(Boolean).length;
      const label = s.cabin.phase === 'moving' ? '🛗 Yük asansörü yolda…' : n ? `🛗 Yük asansörünü gönder (${n}/${R.CABIN_CAP} palet → depo)` : '🛗 Yük asansörü — kabin boş (transpaletle palet yükle)';
      return { x: P.x, z: P.z, short: 'Gönder', label, use: () => this.sendLift() };
    }
    const O = D.office;
    if (facing(px, pz, f, O.point[0], O.point[1], O.range)) {
      return { x: O.point[0], z: O.point[1], short: 'Ofis', label: '📋 Sevkiyat ofisi — sipariş & stok', use: () => this.openOffice() };
    }
    let best = null;
    let bd = Infinity;
    s.jacks.forEach((j, i) => {
      if (j.by) return;
      const d = Math.hypot(j.x - px, j.z - pz);
      if (d < bd && facing(px, pz, f, j.x, j.z, 2.2, 0.2)) { bd = d; best = i; }
    });
    if (best !== null) {
      const j = s.jacks[best];
      return { x: j.x, z: j.z, short: 'Transpalet', label: `🛻 Transpaleti al (${best + 1})`, use: () => this.takeJack(best) };
    }
    return null;
  }

  async request(data) {
    if (this.pending) return { ok: false };
    this.pending = true;
    const res = await this.net.request(EVT.CARGO_ACT, data);
    this.pending = false;
    if (!res.ok && res.error) this.hud.toast(res.error, 'warn');
    return res;
  }

  async gate() {
    const fade = this.reception?.el?.fade ?? document.getElementById('lift-fade');
    const res = await this.request({ act: 'gate' });
    if (!res.ok) return;
    if (fade) {
      fade.textContent = res.dock ? '🚚 Mal Kabul Rampası' : '🏘️ Achterstraat';
      fade.hidden = false;
      fade.classList.add('on');
      setTimeout(() => {
        fade.classList.remove('on');
        setTimeout(() => { fade.hidden = true; }, 320);
      }, 420);
    }
    this.player.setPose(res.x, res.z, res.yaw);
    this.net.sendMove(res.x, res.z, res.yaw);
    this.net.flushMove?.();
    this.sound('door');
    this.interaction.invalidate();
    this.engine.wake();
  }

  async sendLift() {
    const res = await this.request({ act: 'send' });
    if (res.ok) {
      this.sound('ding');
      this.hud.toast('🛗 Yük asansörü depoya gidiyor…', 'info');
    }
  }

  // ---- Transpalet sürüşü ------------------------------------------------------------------------

  async takeJack(j) {
    const res = await this.request({ act: 'take', j });
    if (!res.ok) return;
    this.drive = { j, x: res.x, z: res.z, yaw: res.yaw, v: 0, lift: res.carry ? 1 : 0, carry: res.carry || 0, lastBump: 0, lastSend: 0, sentYaw: res.yaw };
    this.followPos.x = res.x;
    this.followPos.z = res.z;
    this.player.setFollow(() => this.followPos, JACK.EYE);
    this.player.setPose(res.x, res.z, res.yaw);
    this.player.pitch = -0.38;
    this.player.apply();
    this.net.sendMove(res.x, res.z, res.yaw);
    this.interaction.setEnabled(false);
    this.hud.setPrompt(null);
    this.touch?.setLabel('Kaldır');
    document.body.classList.add('cargo-driving');
    this.el.hud.hidden = false;
    this.hudKey = '';
    this.sound('lift');
    this.engine.wake();
  }

  stopDrive() {
    if (!this.drive) return;
    this.drive = null;
    this.player.setFollow(null);
    this.player.pitch = 0;
    this.player.apply();
    this.interaction.setEnabled(true);
    this.touch?.setLabel(null);
    document.body.classList.remove('cargo-driving');
    this.el.hud.hidden = true;
    this.engine.wake();
  }

  async park() {
    const d = this.drive;
    if (!d) return;
    if (d.carry) {
      this.hud.toast('Önce paleti indir (E).', 'warn');
      return;
    }
    this.flush();
    const res = await this.request({ act: 'park' });
    if (res.ok) this.stopDrive();
  }

  /** Sunucuya son konum (kaldır / indir doğrulaması bu konuma göre) */
  flush() {
    const d = this.drive;
    if (!d) return;
    this.net.sendMove(d.x, d.z, d.yaw);
    this.net.flushMove?.();
    d.lastSend = performance.now();
    d.sentYaw = d.yaw;
  }

  /** Taşınan paletin (çatal ortası) bu pozda engele değip değmediği */
  loadClear(x, z, yaw) {
    const [cx, cz] = forkCenter(x, z, yaw);
    const q = this._load;
    q.x = cx;
    q.z = cz;
    this.collision.resolve(q, JACK.LOAD_R);
    return Math.hypot(q.x - cx, q.z - cz) < 0.02;
  }

  /** Çatalların önündeki (en yakın) palet ve hizalama durumu */
  palletAhead() {
    const d = this.drive;
    const s = this.state;
    if (!d || !s) return null;
    const fx = -Math.sin(d.yaw);
    const fz = -Math.cos(d.yaw);
    let best = null;
    for (const p of s.pallets) {
      if (p.where !== 'trailer' && p.where !== 'floor') continue;
      if (p.where === 'trailer' && s.bays[p.bay]?.phase !== 'docked') continue;
      const dx = p.x - d.x;
      const dz = p.z - d.z;
      const along = dx * fx + dz * fz;
      if (along < 0.3 || along > 2.4) continue;
      const lat = dx * -fz + dz * fx; // sağa (+)
      if (Math.abs(lat) > 1.2) continue;
      const score = Math.abs(along - R.FORK_C) + Math.abs(lat) * 2;
      if (!best || score < best.score) best = { p, along: along - R.FORK_C, lat, ang: palletAngleDiff(p.yaw, d.yaw), score };
    }
    if (best) best.ok = Math.abs(best.lat) <= 0.3 && Math.abs(best.along) <= 0.42 && best.ang <= 0.32;
    return best;
  }

  /** Taşınan palet kabinin boş yerine yakın mı */
  cabinSlotAhead() {
    const d = this.drive;
    const s = this.state;
    if (!d || !s || s.cabin.phase !== 'open') return -1;
    const [cx, cz] = forkCenter(d.x, d.z, d.yaw);
    let best = -1;
    let bd = 0.9;
    D.elevator.slots.forEach(([x, z], k) => {
      if (s.cabin.slots[k]) return;
      const dd = Math.hypot(cx - x, cz - z);
      if (dd < bd) { bd = dd; best = k; }
    });
    return best;
  }

  nearPanel() {
    const P = D.elevator.panel;
    return Math.hypot(this.player.pos.x - P.point[0], this.player.pos.z - P.point[1]) < P.range + 0.6;
  }

  /** E / Aksiyon (transpaletteyken) */
  onAction() {
    const d = this.drive;
    if (!d) return false;
    if (this.pending) return true;
    if (d.carry) this.dropPallet();
    else {
      const a = this.palletAhead();
      if (a?.ok) this.liftPallet(a.p);
      else if (this.nearPanel() && this.state?.cabin.slots.some(Boolean)) this.sendLift();
      else if (a) this.hud.toast('Çatallar paletin altına tam girmedi — hizala.', 'info');
      else this.hud.toast('Paletin önüne sür, çatalları altına sok.', 'info');
    }
    this.hudKey = '';
    return true;
  }

  async liftPallet(p) {
    const d = this.drive;
    d.carry = p.id; // iyimser: çatallar hemen kalkar
    this.sound('lift');
    this.flush();
    const res = await this.request({ act: 'lift', id: p.id });
    if (!res.ok && this.drive) this.drive.carry = 0;
    this.hudKey = '';
  }

  async dropPallet() {
    this.flush();
    const res = await this.request({ act: 'drop' });
    if (!res.ok || !this.drive) return;
    this.drive.carry = 0;
    this.sound('drop');
    if (res.where === 'cabin') this.hud.toast(res.full ? '🛗 Kabin dolu — kolondan asansörü gönder!' : '🛗 Palet kabinde. Bir palet daha sığar ya da asansörü gönder.', 'info');
    this.hudKey = '';
  }

  async bump(speed) {
    const res = await this.net.request(EVT.CARGO_ACT, { act: 'bump', speed: Math.round(speed * 100) / 100 });
    if (res.ok && res.damage > 0) this.hud.toast(`💥 Palet çarptı! Durum %${Math.round(res.cond * 100)}`, 'warn');
  }

  driveStep(dt) {
    const d = this.drive;
    const p = this.player;
    // Dışarıdan ışınlandıysa (hızlı ışınlanma) sürüş biter; sunucu transpaleti avluda bırakır
    if (Math.hypot(p.pos.x - d.x, p.pos.z - d.z) > 3) {
      this.stopDrive();
      return;
    }
    const mv = this.input.moveVector(this._mv);
    let yaw = p.yaw; // fare bakışı bu karede uygulandı
    if (d.carry && yaw !== d.yaw && !this.loadClear(d.x, d.z, yaw)) yaw = d.yaw;
    if (mv.x) {
      const ny = yaw - mv.x * JACK.TURN * dt;
      if (!d.carry || this.loadClear(d.x, d.z, ny)) yaw = ny;
    }
    const target = mv.y > 0 ? mv.y * JACK.SPEED : mv.y * JACK.REVERSE;
    const k = JACK.ACCEL * dt;
    d.v += Math.max(-k * 1.6, Math.min(k * 1.6, target - d.v));
    if (!mv.y && Math.abs(d.v) < 0.05) d.v = 0;
    if (d.v) {
      const dx = -Math.sin(yaw) * d.v * dt;
      const dz = -Math.cos(yaw) * d.v * dt;
      const pos = this._pos;
      pos.x = d.x;
      pos.z = d.z;
      this.collision.move(pos, dx, dz, JACK.RADIUS);
      if (d.carry && !this.loadClear(pos.x, pos.z, yaw)) {
        pos.x = d.x;
        pos.z = d.z;
      }
      const moved = Math.hypot(pos.x - d.x, pos.z - d.z);
      const want = Math.hypot(dx, dz);
      if (moved < want * 0.5) {
        const speed = Math.abs(d.v);
        if (d.carry && speed > R.BUMP_MIN && performance.now() - d.lastBump > 800) {
          d.lastBump = performance.now();
          this.sound('bump');
          this.bump(speed);
          d.v = 0;
        } else d.v *= 0.3;
      }
      d.x = pos.x;
      d.z = pos.z;
    }
    d.yaw = yaw;
    const lt = d.carry ? 1 : 0;
    d.lift += Math.max(-dt * 3, Math.min(dt * 3, lt - d.lift));
    this.followPos.x = d.x;
    this.followPos.z = d.z;
    p.pos.x = d.x;
    p.pos.z = d.z;
    p.yaw = yaw;
    p.apply();
    const t = performance.now();
    if (t - d.lastSend > 70 && (Math.abs(d.sentYaw - yaw) > 1e-3 || d.v)) {
      d.lastSend = t;
      d.sentYaw = yaw;
      this.net.sendMove(d.x, d.z, yaw);
    }
  }

  command(cmd) {
    if (!this.drive) return false;
    if (cmd === 'cycle') this.park(); // Q: transpaletten in
    return true; // transpaletteyken diğer komutlar (envanter, dekor…) kapalı
  }

  onEscape() {
    if (!this.drive) return false;
    this.park();
    return true;
  }

  // ---- Kare --------------------------------------------------------------------------------------

  update(dt) {
    if (!this.state || (!this.inDock && !this.drive)) return false;
    let active = false;
    const now = this.net.serverNow();
    const s = this.state;
    if (this.drive) {
      this.driveStep(dt);
      active = true;
    }
    // Tırlar (yanaşma / ayrılma animasyonu) + dorsedeki paletler tırla birlikte
    s.bays.forEach((t, i) => {
      if (!t || t.phase === 'docked') return;
      if (this.placeTruck(i, t, now)) active = true;
      const u = (now - t.at) / R.ARRIVE_MS;
      if (t.phase === 'arriving' && u > 0.55 && u < 1 && performance.now() - this.lastBeep > 650) {
        this.lastBeep = performance.now();
        this.sound('beep'); // geri vites ikazı
      }
    });
    for (const o of this.palletObjs.values()) {
      const p = o.data;
      if (p.where !== 'trailer' || p.slot < 0) continue;
      const t = s.bays[p.bay];
      if (!t || t.phase === 'docked') continue;
      const tr = this.trucks[p.bay].obj;
      const bay = D.bays[p.bay];
      const lx = p.x - bay.x;
      const lz = p.z - bay.truck.z;
      const c = Math.cos(tr.rotation.y);
      const sn = Math.sin(tr.rotation.y);
      o.obj.position.set(tr.position.x + lx * c + lz * sn, 0, tr.position.z - lx * sn + lz * c);
      o.obj.rotation.y = tr.rotation.y;
    }
    // Transpaletler: benimki sürüşümden, diğerleri sürücünün (uzak oyuncu) konumundan, boştakiler durumdan
    s.jacks.forEach((j, i) => {
      const o = this.jackObjs[i];
      let x = j.x;
      let z = j.z;
      let yaw = j.yaw;
      let lift = j.carry ? 1 : 0;
      if (this.drive?.j === i) {
        ({ x, z, yaw } = this.drive);
        lift = this.drive.lift;
      } else if (j.by) {
        const r = this.remotes.get(j.by);
        if (r) {
          x = r.obj.position.x;
          z = r.obj.position.z;
          yaw = r.obj.rotation.y - Math.PI;
          active = true;
        }
      }
      o.position.set(x, 0, z);
      o.rotation.y = yaw;
      o.userData.handle.visible = this.drive?.j !== i;
      o.userData.forks.position.y = 0.1 * lift;
      const carry = this.drive?.j === i ? this.drive.carry : j.carry;
      if (carry) {
        const po = this.palletObjs.get(carry);
        if (po) {
          const [cx, cz] = forkCenter(x, z, yaw);
          po.obj.position.set(cx, 0.1 * lift + 0.005, cz);
          po.obj.rotation.y = yaw + (po.data.where === 'jack' ? po.data.rel : this.relFor(po.data, yaw));
        }
      }
    });
    // Yük asansörü kapıları
    const open = s.cabin.phase === 'open' ? 1 : 0;
    if (this.doorOpen !== open) {
      const prev = this.doorOpen;
      this.doorOpen += Math.max(-dt * 1.4, Math.min(dt * 1.4, open - this.doorOpen));
      if ((prev > 0.5) !== (this.doorOpen > 0.5)) this.sound('door');
      active = true;
    }
    const C = this.view.cabin;
    const E = D.elevator.door;
    const mid = (E.from + E.to) / 2;
    const slide = this.doorOpen * (C.leafW - 0.05);
    C.doorL.position.x = mid - C.leafW / 2 - slide;
    C.doorR.position.x = mid + C.leafW / 2 + slide;
    // Asansör yoldayken kabindeki paletler (kapılar kapanınca) görünmez
    for (const id of s.cabin.slots) {
      const po = id && this.palletObjs.get(id);
      if (po) po.obj.visible = !(s.cabin.phase === 'moving' && this.doorOpen < 0.05);
    }
    this.view.panelLight.material.color.setHex(s.cabin.phase === 'moving' ? 0xffb020 : s.cabin.slots.some(Boolean) ? 0x3ad16b : 0x6b7b84);
    if (this.drive) this.renderHud();
    return active;
  }

  /** İyimser kaldırmada (sunucu onayı gelmeden) paletin bağıl yönü */
  relFor(p, yaw) {
    const q = Math.PI / 2;
    return Math.round((p.yaw - yaw) / q) * q;
  }

  // ---- HUD ---------------------------------------------------------------------------------------

  buildHud() {
    const hud = el('div', 'panel');
    hud.id = 'cargo-hud';
    hud.hidden = true;
    const title = el('div', 'cg-title', '🛻 Transpalet');
    const lines = el('div', 'cg-lines');
    const btns = el('div', 'cg-btns');
    const act = el('button', 'cg-act', 'E');
    const send = el('button', 'cg-send', '🛗 Gönder');
    const quit = el('button', 'cg-quit', '✕ İn (Q)');
    for (const b of [act, send, quit]) b.type = 'button';
    act.addEventListener('click', () => this.onAction());
    send.addEventListener('click', () => this.sendLift());
    quit.addEventListener('click', () => this.park());
    btns.append(act, send, quit);
    hud.append(title, lines, btns);
    document.body.append(hud);
    this.el = { hud, lines, act, send };
  }

  renderHud() {
    const d = this.drive;
    const s = this.state;
    const lines = [];
    let action = 'Kaldır';
    let send = false;
    if (d.carry) {
      const p = s.pallets.find((x) => x.id === d.carry);
      const T = p && TYPES[p.type];
      lines.push(T ? `📦 ${T.icon} ${T.name} · durum %${Math.round(p.cond * 100)} (${palletUnits(p.cond)} birim)` : '📦 Palet çatallarda');
      const slot = this.cabinSlotAhead();
      if (slot >= 0) {
        lines.push('✅ Kabinin boş yerine hizalı — E: kabine indir');
        action = 'Kabine';
      } else if (s.cabin.phase === 'moving') lines.push('⏳ Yük asansörü yolda — biraz bekle ya da paleti yere indir');
      else lines.push('🛗 Yük asansörünün kabinine götür (kuzey duvarı) · E: yere indir');
      if (action === 'Kaldır') action = 'İndir';
    } else {
      lines.push('Çatallar boş');
      const a = this.palletAhead();
      if (a?.ok) lines.push(`✅ Hizalı — E: ${TYPES[a.p.type].icon} paleti kaldır`);
      else if (a) {
        const side = a.lat > 0 ? 'sağda' : 'solda';
        const tips = [];
        if (Math.abs(a.lat) > 0.3) tips.push(`palet ${Math.round(Math.abs(a.lat) * 100)} cm ${side}`);
        if (a.ang > 0.32) tips.push(`açı ${Math.round((a.ang * 180) / Math.PI)}°`);
        if (a.along > 0.42) tips.push('biraz daha ileri');
        if (a.along < -0.42) tips.push('biraz geri');
        lines.push(`↔ Hizala: ${tips.join(' · ') || 'neredeyse'}`);
      } else lines.push('Paletin önüne sür, çatalları altına sok');
      send = this.nearPanel() && s.cabin.phase === 'open' && s.cabin.slots.some(Boolean);
      if (send && !a?.ok) action = 'Gönder';
    }
    if (!this.device?.touch) lines.push('W/S ileri-geri · A/D ya da fare dön · E kaldır / indir · Q in');
    const key = JSON.stringify([lines, action, send]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.el.lines.replaceChildren(...lines.map((t) => el('div', null, t)));
    this.el.act.textContent = `${action} (E)`;
    this.el.send.hidden = !send;
    this.touch?.setLabel(action);
  }

  // ---- Sevkiyat ofisi + PC sekmesi --------------------------------------------------------------

  buildOffice() {
    const wrap = el('div', 'overlay');
    wrap.id = 'cargo-panel';
    wrap.hidden = true;
    const card = el('div', 'card wide pc-card cargo-card');
    const title = el('h2', null, '📋 Sevkiyat Ofisi · Mal Kabul');
    const body = el('div', 'cargo-body');
    const close = el('button', 'primary', 'Kapat');
    close.type = 'button';
    close.addEventListener('click', () => this.modal.close(wrap));
    card.append(title, body, close);
    wrap.append(card);
    document.body.append(wrap);
    this.office = { el: wrap, body, get hidden() { return wrap.hidden; } };
  }

  openOffice() {
    this.renderTab(this.office.body, 'dock');
    this.modal.open(this.office.el);
  }

  async orderNow(via, msgEl) {
    const items = {};
    for (const t of CARGO_TYPE_IDS) if (this.form[t]) items[t] = this.form[t];
    if (!Object.keys(items).length) {
      msgEl.textContent = 'Önce palet seç.';
      return;
    }
    const res = await this.request({ act: 'order', via, items });
    if (res.ok) {
      for (const t of CARGO_TYPE_IDS) this.form[t] = 0;
      this.sfx?.coin?.();
      this.hud.toast(`📦 Sipariş verildi (€${res.cost}) — tır yolda!`, 'money');
    } else msgEl.textContent = res.error || '';
  }

  /** "🚚 Mal Kabul" içeriği (Resepsiyon PC sekmesi ve ofis terminali aynı) */
  renderTab(body, via) {
    body.replaceChildren();
    const s = this.state;
    if (!s) {
      body.append(el('p', 'pc-small', 'Yükleniyor…'));
      return;
    }
    const now = this.net.serverNow();
    body.append(el('p', 'pc-small', 'Toptancıdan palet sipariş et (bedel + €' + R.DELIVERY_FEE + ' nakliye otelin kasasından). Tır arka avludaki Mal Kabul Rampası\'na yanaşır: paletleri transpaletle indirip yük asansörüyle depoya çıkar.'));
    // Stok
    const stock = el('div', 'cargo-stock');
    for (const t of CARGO_TYPE_IDS) {
      const T = TYPES[t];
      const row = el('div', 'cargo-row');
      const head = el('div', 'cargo-head');
      head.append(el('b', null, `${T.icon} ${T.name}`), el('span', 'cargo-units', `${s.stock[t]} / ${R.STOCK_MAX} birim`));
      const bar = el('div', 'pc-bar');
      const fill = el('i');
      fill.style.width = `${Math.round((s.stock[t] / R.STOCK_MAX) * 100)}%`;
      bar.append(fill);
      const eff = el('div', `pc-small ${s.stock[t] ? 'ok' : ''}`, `${s.stock[t] ? '✅' : '⛔'} ${T.effect}`);
      const auto = el('label', 'cargo-auto');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!s.auto[t];
      cb.addEventListener('change', async () => {
        const res = await this.request({ act: 'auto', via, type: t, on: cb.checked });
        if (!res.ok) cb.checked = !cb.checked;
      });
      auto.append(cb, document.createTextNode(` Otomatik sipariş (${R.AUTO_BELOW} birimin altında ${R.AUTO_PALLETS} palet)`));
      row.append(head, bar, eff, auto);
      stock.append(row);
    }
    body.append(el('h3', 'cargo-h', '📦 Depo stoku'), stock);
    // Sipariş formu
    body.append(el('h3', 'cargo-h', '🛒 Toptancı siparişi'));
    if (s.offer) {
      const T = TYPES[s.offer.type];
      body.append(el('div', 'cargo-offer', `🔥 Bugünün fırsatı: ${T.icon} ${T.name} %${Math.round((1 - s.offer.mul) * 100)} indirimli`));
    }
    const form = el('div', 'cargo-form');
    let total = R.DELIVERY_FEE;
    let count = 0;
    const totalEl = el('div', 'cargo-total');
    const msg = el('p', 'pc-small bad');
    const refresh = () => {
      total = R.DELIVERY_FEE;
      count = 0;
      for (const t of CARGO_TYPE_IDS) {
        const mul = s.offer?.type === t ? s.offer.mul : 1;
        total += Math.round(TYPES[t].price * mul) * this.form[t];
        count += this.form[t];
      }
      totalEl.textContent = count ? `Toplam: €${total} (${count} palet, nakliye dahil) · kasa €${this.reception?.state?.economy?.money ?? '—'}` : 'Palet seç (tür başına en fazla 4).';
    };
    for (const t of CARGO_TYPE_IDS) {
      const T = TYPES[t];
      const mul = s.offer?.type === t ? s.offer.mul : 1;
      const row = el('div', 'cargo-orow');
      const n = el('b', 'cargo-n', String(this.form[t]));
      const minus = el('button', 'pc-btn', '−');
      const plus = el('button', 'pc-btn', '+');
      minus.type = plus.type = 'button';
      minus.addEventListener('click', () => { this.form[t] = Math.max(0, this.form[t] - 1); n.textContent = String(this.form[t]); refresh(); });
      plus.addEventListener('click', () => { this.form[t] = Math.min(R.MAX_PER_TYPE, this.form[t] + 1); n.textContent = String(this.form[t]); refresh(); });
      row.append(el('span', null, `${T.icon} ${T.short}`), el('span', 'cargo-price', `€${Math.round(T.price * mul)} / palet${mul < 1 ? ' 🔥' : ''}`), minus, n, plus);
      form.append(row);
    }
    const order = el('button', 'pc-btn cargo-order', '📦 Sipariş ver');
    order.type = 'button';
    order.disabled = s.orders.length >= R.MAX_ORDERS;
    order.addEventListener('click', () => this.orderNow(via, msg));
    refresh();
    body.append(form, totalEl, order, msg);
    // Yoldakiler + rampadakiler
    const live = el('div', 'cargo-live');
    for (const o of s.orders) {
      const list = Object.keys(o.items).map((t) => `${o.items[t]} ${TYPES[t].icon}`).join(' + ');
      const sec = Math.max(0, Math.round((o.eta - now) / 1000));
      live.append(el('div', 'cargo-line', `🚚 Yolda: ${list} — ${sec ? `~${sec} sn` : 'rampa bekliyor'} (${o.by})`));
    }
    s.bays.forEach((t, i) => {
      if (!t) return;
      const left = s.pallets.filter((p) => p.where === 'trailer' && p.bay === i).length;
      const ph = t.phase === 'arriving' ? 'yanaşıyor' : t.phase === 'leaving' ? 'ayrılıyor' : `${left} palet indirilmeyi bekliyor`;
      live.append(el('div', 'cargo-line', `🅿️ ${D.bays[i].name}: ${t.supplier} — ${ph}`));
    });
    const floor = s.pallets.filter((p) => p.where === 'floor').length;
    if (floor) live.append(el('div', 'cargo-line', `📦 Rampada ${floor} palet yük asansörünü bekliyor`));
    if (s.queue) live.append(el('div', 'cargo-line', `⏳ ${s.queue} teslimat boş rampa bekliyor`));
    if (!live.childElementCount) live.append(el('div', 'pc-small', 'Yolda ya da rampada tır yok.'));
    body.append(el('h3', 'cargo-h', '🚛 Sevkiyat'), live);
    const st = s.stats;
    body.append(el('p', 'pc-small', `Toplam ${st.pallets} palet depoya çıktı (${st.units} birim) · ${st.damaged} hasarlı palet · ${st.orders} sipariş (€${st.spent})`));
  }

  // ---- Ses ---------------------------------------------------------------------------------------

  sound(name) {
    if (!this.settings.sound || !this.inDock) return;
    const sfx = this.sfx;
    const ctx = sfx.begin(1600);
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const out = sfx.output(ctx, 0.12);
    const P = (f, d, peak = 0.8, type = 'sine', dt = 0) => sfx.ping(ctx, out, t + dt, f, d, peak, type);
    const noise = (sec, peak = 0.4, dt = 0, freq = 900) => {
      const src = sfx.noiseSource(ctx, t + dt, sec);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(peak, t + dt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + sec);
      src.connect(f).connect(g).connect(out);
    };
    switch (name) {
      case 'lift': noise(0.5, 0.5, 0, 600); P(140, 0.45, 0.4, 'sawtooth'); break; // hidrolik pompa
      case 'drop': P(90, 0.25, 0.9, 'triangle'); noise(0.15, 0.4, 0, 300); break;
      case 'bump': P(70, 0.3, 1, 'square'); noise(0.25, 0.7, 0, 400); break;
      case 'ding': P(880, 0.25, 0.7, 'triangle'); P(1320, 0.4, 0.6, 'triangle', 0.18); P(55, 1.2, 0.3, 'sawtooth', 0.3); break;
      case 'door': noise(0.5, 0.25, 0, 1500); break;
      case 'beep': P(1050, 0.16, 0.5, 'square'); break;
      case 'horn': P(220, 0.5, 0.6, 'sawtooth'); P(277, 0.5, 0.5, 'sawtooth'); break;
      default: break;
    }
  }
}

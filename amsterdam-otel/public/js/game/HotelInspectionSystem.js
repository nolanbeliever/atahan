import * as THREE from 'three';
import { EVT, ROOM_STATUS, roomFloor } from '/shared/constants.js';
import { EXTINGUISHERS, BAR_SPILL } from '/shared/layout.js';
import { INSPECTION } from '/shared/hotel.js';

const ROT = { 'x+': Math.PI / 2, 'x-': -Math.PI / 2, 'z+': 0, 'z-': Math.PI };
const GAUGE = { ok: 0x3ecf6e, low: 0xe5534b };
const MAX_PLAQUES = 8;

/** Belediye Onay Plaketi dokusu (tek kanvas, tüm plaketler paylaşır) */
function plaqueTexture() {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 200;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, 0, 160, 200);
  ctx.fillStyle = '#d9b45a';
  ctx.fillRect(12, 12, 136, 176);
  ctx.fillStyle = '#7a5a1e';
  ctx.textAlign = 'center';
  ctx.font = '700 46px system-ui, sans-serif';
  ctx.fillText('🏛', 80, 70);
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillText('BELEDİYE', 80, 112);
  ctx.fillText('ONAYI', 80, 136);
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText('Gemeente A’dam', 80, 166);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Belediye denetimi — istemci tarafı (sunucu: server/game/InspectionService.js).
 *  - Müfettiş gelince ekranın üstünde geri sayım + kontrol listesi: kirli oda sayısı, kontrol
 *    bekleyen yangın tüpleri, barın hijyeni (tezgâhtaki kirli bardaklar + dökülen şurup).
 *  - Basıncı düşük tüpün göstergesi kırmızı yanar; önünde E → 1.5 sn kontrol. Bar zeminindeki
 *    şurup lekesi → E ile 2 sn sil. Sunucu konum + süreyi doğrular.
 *  - Sonuç kartı; başarılı denetimlerin plaketleri lobinin batı duvarına asılır.
 * Pil: geri sayım yalnızca denetim sürerken saniyede 4 kez DOM'u günceller (3B kare çizmez).
 */
export class HotelInspectionSystem {
  constructor({ engine, net, hud, interaction, state, bar, reception }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.state = state;
    this.bar = bar;
    this.reception = reception;
    this.active = null;
    this.floors = 1;
    this.timer = 0;
    this.working = false;

    const $ = (id) => document.getElementById(id);
    this.el = { banner: $('insp-banner'), time: $('insp-time'), title: $('insp-title'), list: $('insp-list') };
    this.buildProps(engine.scene);
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    reception.onChange.push((h) => this.setState(h));
  }

  // ---- 3B: yangın tüpleri, plaketler, şurup lekesi --------------------------------------

  buildProps(scene) {
    const body = new THREE.CylinderGeometry(0.085, 0.085, 0.46, 12).translate(0, 0.23, 0);
    const top = new THREE.CylinderGeometry(0.03, 0.05, 0.08, 8).translate(0, 0.5, 0);
    const hose = new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI).rotateZ(-Math.PI / 2).translate(0.07, 0.42, 0.05);
    const gauge = new THREE.CylinderGeometry(0.035, 0.035, 0.015, 12).rotateX(Math.PI / 2).translate(0, 0.52, 0.06);
    const bracket = new THREE.BoxGeometry(0.22, 0.04, 0.03).translate(0, 0.3, -0.09);
    const red = new THREE.MeshLambertMaterial({ color: '#c8102e' });
    const black = new THREE.MeshLambertMaterial({ color: '#1a1a1a' });
    this.ext = new Map();
    for (const e of EXTINGUISHERS) {
      const g = new THREE.Group();
      const gaugeMat = new THREE.MeshBasicMaterial({ color: GAUGE.ok });
      g.add(new THREE.Mesh(body, red), new THREE.Mesh(top, black), new THREE.Mesh(hose, black), new THREE.Mesh(gauge, gaugeMat), new THREE.Mesh(bracket, black));
      g.position.set(e.x, 0.7, e.z);
      g.rotation.y = ROT[e.facing];
      g.traverse((o) => { o.matrixAutoUpdate = false; });
      g.updateMatrix();
      g.updateMatrixWorld(true);
      scene.add(g);
      // Duvar tabelası "🧯"
      this.ext.set(e.id, { def: e, gaugeMat });
    }

    // Plaketler: lobinin batı duvarı, anahtar panosunun kuzeyi (2 sıra × 4)
    const ptex = plaqueTexture();
    const pmat = new THREE.MeshLambertMaterial({ map: ptex });
    const pgeo = new THREE.PlaneGeometry(0.32, 0.4);
    this.plaques = [];
    for (let i = 0; i < MAX_PLAQUES; i++) {
      const m = new THREE.Mesh(pgeo, pmat);
      m.position.set(-7.885, i < 4 ? 2.0 : 1.45, 9.55 + (i % 4) * 0.5);
      m.rotation.y = Math.PI / 2;
      m.visible = false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
      this.plaques.push(m);
    }

    // Bar zeminine dökülen çilek şurubu (yalnızca denetimde)
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(190,30,60,0.85)';
    for (const [x, y, r] of [[64, 64, 40], [38, 50, 20], [92, 80, 22], [70, 100, 14], [100, 40, 10]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const stex = new THREE.CanvasTexture(c);
    stex.colorSpace = THREE.SRGBColorSpace;
    this.spill = new THREE.Mesh(
      new THREE.PlaneGeometry(BAR_SPILL.r * 2.2, BAR_SPILL.r * 2.2).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: stex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.spill.position.set(BAR_SPILL.point[0], 0.012, BAR_SPILL.point[1]);
    this.spill.visible = false;
    this.spill.matrixAutoUpdate = false;
    this.spill.updateMatrix();
    scene.add(this.spill);
  }

  // ---- Durum ------------------------------------------------------------------------

  setState(h) {
    this.floors = h.growth.floors;
    const n = Math.min(MAX_PLAQUES, h.growth.plaques);
    this.plaques.forEach((m, i) => { m.visible = i < n; });
    this.active = h.inspection?.active ?? null;
    const ext = this.active?.ext ?? {};
    for (const [id, x] of this.ext) x.gaugeMat.color.setHex(ext[id] ? GAUGE.low : GAUGE.ok);
    this.spill.visible = !!this.active?.spill && this.active.phase === 'countdown';
    this.engine.requestRender();
    this.renderBanner();
    clearInterval(this.timer);
    if (this.active) this.timer = setInterval(() => this.renderBanner(), 250);
  }

  /** Oda / bar durumu değişince listeyi tazele */
  refresh() {
    if (this.active) this.renderBanner();
  }

  checks() {
    const a = this.active;
    let dirty = 0;
    for (const r of this.state.rooms.values()) {
      if (r.status === ROOM_STATUS.DIRTY && roomFloor(r.id) <= this.floors) dirty++;
    }
    const extLeft = Object.values(a?.ext ?? {}).filter(Boolean).length;
    const glasses = (this.bar.state?.stools ?? []).filter((s) => s.glass === 'dirty').length;
    return { dirty, extLeft, glasses, spill: !!a?.spill };
  }

  renderBanner() {
    const a = this.active;
    const b = this.el.banner;
    if (!a) {
      if (!this.resultUntil || performance.now() > this.resultUntil) b.hidden = true;
      return;
    }
    b.hidden = false;
    b.className = 'insp';
    const left = Math.max(0, Math.ceil((a.endsAt - this.net.serverNow()) / 1000));
    if (a.phase === 'arriving') {
      this.el.title.textContent = '🏛️ Müfettiş geliyor — hazırlanın!';
      this.el.time.textContent = `${left} sn`;
    } else {
      this.el.title.textContent = '🏛️ Belediye denetimi';
      this.el.time.textContent = `⏱ ${left} sn`;
      b.classList.toggle('urgent', left <= 20);
    }
    const c = this.checks();
    const items = [
      [c.dirty === 0, c.dirty ? `🛏️ ${c.dirty} kirli oda` : '🛏️ Odalar temiz'],
      [c.extLeft === 0, c.extLeft ? `🧯 ${c.extLeft} yangın tüpü kontrol bekliyor (kırmızı gösterge)` : '🧯 Yangın tüpleri tamam'],
      [c.glasses === 0 && !c.spill, c.spill ? '🍹 Bar: zemine şurup dökülmüş — sil' : c.glasses ? `🍹 Bar: tezgâhta ${c.glasses} kirli bardak` : '🍹 Bar hijyeni tamam'],
    ];
    const key = JSON.stringify(items);
    if (this.lastKey === key) return;
    this.lastKey = key;
    this.el.list.replaceChildren(...items.map(([ok, text]) => {
      const li = document.createElement('li');
      li.className = ok ? 'ok' : 'todo';
      li.textContent = `${ok ? '✅' : '⬜'} ${text}`;
      return li;
    }));
  }

  /** EVT.INSPECTION_RESULT */
  onResult(r) {
    clearInterval(this.timer);
    this.active = null;
    this.spill.visible = false;
    const b = this.el.banner;
    b.hidden = false;
    b.className = `insp ${r.pass ? 'pass' : 'fail'}`;
    this.el.title.textContent = r.pass ? '✅ Denetim başarılı!' : '❌ Denetim başarısız';
    this.el.time.textContent = r.pass ? `+€${r.reward}` : `−€${r.fine}`;
    this.el.list.replaceChildren(...[
      ['rooms', '🛏️ Odalar'], ['extinguishers', '🧯 Yangın tüpleri'], ['bar', '🍹 Bar hijyeni'],
    ].map(([id, label]) => {
      const li = document.createElement('li');
      li.className = r.checks[id] ? 'ok' : 'todo';
      li.textContent = `${r.checks[id] ? '✅' : '❌'} ${label}`;
      return li;
    }), Object.assign(document.createElement('li'), {
      className: 'note',
      textContent: r.pass ? '🏅 Belediye Onay Plaketi lobiye asıldı.' : 'Kasadan ceza kesildi, otel bir yıldız kaybetti.',
    }));
    this.lastKey = null;
    this.resultUntil = performance.now() + 7000;
    setTimeout(() => this.renderBanner(), 7100);
  }

  // ---- Etkileşim: tüp kontrolü, şurup silme -------------------------------------------

  findTarget(px, pz, f) {
    const a = this.active;
    if (!a || a.phase !== 'countdown' || this.working) return null;
    const near = (x, z, range) => {
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      return d <= range && (d < 0.6 || (dx * f.x + dz * f.z) / d > 0.2);
    };
    for (const [id, x] of this.ext) {
      if (!a.ext[id]) continue;
      const e = x.def;
      if (near(e.point[0], e.point[1], INSPECTION.RANGE) || near(e.x, e.z, INSPECTION.RANGE)) {
        return {
          x: e.point[0], z: e.point[1], short: 'Kontrol', label: '🧯 Yangın tüpünün basıncını kontrol et', use: () => this.work({ act: 'check', id }, INSPECTION.CHECK_MS, '🧯 Basınç kontrol ediliyor'),
        };
      }
    }
    if (a.spill && near(BAR_SPILL.point[0], BAR_SPILL.point[1], INSPECTION.RANGE)) {
      return {
        x: BAR_SPILL.point[0], z: BAR_SPILL.point[1], short: 'Sil', label: '🧽 Dökülen şurubu sil', use: () => this.work({ act: 'mop' }, INSPECTION.MOP_MS, '🧽 Siliniyor'),
      };
    }
    return null;
  }

  async work(data, ms, text) {
    if (this.working) return;
    this.working = true;
    const res = await this.net.request(EVT.HOTEL_ACT, { ...data, step: 'begin' });
    if (!res.ok) {
      this.working = false;
      this.hud.toast(res.error || 'Olmadı.', 'warn');
      return;
    }
    const t0 = performance.now();
    const tick = () => {
      const left = Math.max(0, ms - (performance.now() - t0));
      this.interaction.setBusy(`${text}… ${(left / 1000).toFixed(1)} sn`);
      if (left > 0) this.busyTimer = setTimeout(tick, 100);
      else this.finishWork(data);
    };
    tick();
  }

  async finishWork(data) {
    const res = await this.net.request(EVT.HOTEL_ACT, { ...data, step: 'finish' });
    this.working = false;
    this.interaction.setBusy(null);
    if (!res.ok) this.hud.toast(res.error || 'Olmadı.', 'warn');
    else this.hud.toast(data.act === 'mop' ? '🧽 Zemin tertemiz!' : '🧯 Tüp kontrol edildi ✓', 'clean');
  }
}

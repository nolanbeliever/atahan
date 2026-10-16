import { EVT } from '/shared/constants.js';
import { STEEG } from '/shared/layout.js';
import {
  CAR_MODELS, CAR_BY_ID, CAR_BODIES, CAR_RULES, CAR_XFERS, CAR_XFER_BY_ID, GARAGE_LAYOUT, inXferZone, carZone, bigArea,
  carSpeedCap, carAccel, carTurnRate, carPhysics, carPassengerSeat, idealRun, formatEuro, formatUsd,
} from '/shared/cars.js';
import { buildGarage, buildStreetRamp } from '../world/GarageBuilding.js';
import { makeCarModel, setBrake } from '../world/CarModels.js';
import { CarCockpit } from './CarCockpit.js';

const HOTEL_LAYER = 3; // otel dünyası (garaj / pistteyken çizilmez)
const BODY_NAME = Object.freeze({
  micro: 'Mikro araba', city: 'Şehir arabası', hatch: 'Hatchback', suv: 'SUV', sedan: 'Sedan', coupe: 'Coupé', gt: 'Lüks GT', super: 'Süper araba',
});

/**
 * Yeraltı garajı + AutoGalerie + arabalar (istemci).
 *
 *  - Garaj ("Hotel Amsterdam Garage", −1): beton sütunlar, numaralı park yerleri, flüoresan
 *    şeritler, rampa tünelleri, asansör (E → lobi), AutoGalerie terminali (E → katalog).
 *    Sokakta otelin önündeki "P ↓" rampa ağzına yürüyen / süren garaja iner (kararma geçişi);
 *    garajın kuzeyindeki rampa sokağa, doğusundaki "🏁 Drag pisti" tüneli piste çıkarır — araba
 *    sürülüyorsa araba (ve ön koltuktaki arkadaş) birlikte gelir. Sunucu konumu doğrular.
 *  - AutoGalerie: telefonda 🚗 uygulaması ve garaj terminali aynı kataloğu gösterir. Renk ve ödeme
 *    kaynağı (🎒 cüzdan / 🏨 otel kasası) seçilir; araba ilk boş park yerine bırakılır.
 *  - Arabalar CityVehicleSystem'in listesinde (`type: 'car'`); bu sınıf modeli, sürüş ayarlarını
 *    (katalogdaki hız / 0–100'den ivme eğrisi, bölge hız sınırı, gövde boyunca çarpışma, sürücü
 *    koltuğu kamerası, serbest bakış), park bölgesini ve ön yolcu koltuğunu eklenti olarak verir.
 *    Park etmiş arabalar yürüyen oyuncuyu da durdurur (gövde boyunca 3 küçük kutu).
 *  - Arabayla yalnızca garajda, otelin önündeki sokakta (30 km/s) ve drag alanında sürülür; steeg
 *    ağzında ve kapılarda yalnızca sürücüye özel engeller vardır.
 *
 * Pil: garaj ve pist ayrı THREE.Group'lardır ve yalnızca oyuncu oradayken görünür; o sırada otel
 * dünyası (açılışta HOTEL_LAYER katmanına alınır) kameranın katman maskesiyle hiç çizilmez,
 * pistte kamera uzak düzlemi uzar. Bölge yalnızca oyuncu hareket edince kontrol edilir. Sürmüyorken
 * karede iş yok; kokpit (FOV, ses, gösterge) yalnızca sürerken çalışır.
 */
export class UndergroundGarage {
  constructor({ engine, net, hud, interaction, player, remotes, collision, modal, device, settings, sfx, vehicles, phone, state, input, getWallet }) {
    Object.assign(this, { engine, net, hud, interaction, player, remotes, collision, modal, device, settings, sfx, vehicles, phone, state, input, getWallet });
    this.camera = engine.camera;
    this.baseFar = this.camera.far;
    this.areas = new Map(); // id → { group, far }
    this.area = 'city';
    this.pending = false;
    this.latch = null; // başarısız geçit: oyuncu alandan çıkana kadar yeniden denenmez
    this.lastXfer = 0;
    this.carColliders = [];
    this.hiddenRiders = new Set();
    this.selColor = Object.create(null); // model → renk dizini
    this.source = 'wallet';
    this.dealerMsg = '';

    // Dünya: garaj (ayrı grup) + sokaktaki rampa ağzı (otel dünyasının parçası)
    const garage = buildGarage({ collision });
    this.garage = garage;
    engine.scene.add(garage.group);
    this.addArea('garage', garage.group);
    this.ramp = buildStreetRamp({ scene: engine.scene, collision });
    // Arabaya özel engel: steeg ağzı (Achterstraat'a araba girmez)
    this.carWalls = [collision.add(STEEG.bounds.minX - 0.1, STEEG.bounds.maxX + 0.1, -0.32, 0.12, false)];

    this.cockpit = new CarCockpit({ engine, player, input, settings, sfx, device });
    vehicles.cars = this.carHooks();

    const $ = (id) => document.getElementById(id);
    this.el = { panel: $('dealer-panel'), body: $('dealer-body'), fade: $('lift-fade') };
    $('dealer-close').addEventListener('click', () => this.modal.close(this.el.panel));
    phone?.registerApp({
      id: 'autogalerie', icon: '🚗', name: 'AutoGalerie', order: 3,
      render: (body) => this.renderDealer(body, true),
    });
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  // ---- Alan yöneticisi (görünürlük, katman maskesi, uzak düzlem) -----------------------------------

  addArea(id, group, far = this.baseFar) {
    this.areas.set(id, { group, far });
    group.visible = this.area === id;
  }

  /**
   * Açılışta (bütün dünya kurulduktan sonra) bir kez: sahnedeki mevcut nesneler otel dünyasıdır →
   * HOTEL_LAYER'a alınır. Işıklar, kamera (birinci şahıs eller) ve etkileşim halkası hariç.
   */
  partitionWorld(keep = []) {
    this.keep = keep;
    this.repartition();
    this.camera.layers.enable(HOTEL_LAYER);
  }

  /**
   * Sonradan eklenen otel parçaları (ör. satın alınan lüks katlar) da katmana alınsın: garaja / piste
   * her girişte bir kez. Arabalar ve diğer oyuncular katman 0'da kalır (her yerde görünür).
   */
  repartition() {
    const skip = new Set([this.camera, ...(this.keep ?? []), ...[...this.areas.values()].map((a) => a.group)]);
    for (const m of this.vehicles.meshes.values()) skip.add(m.obj);
    for (const r of this.remotes.items.values()) skip.add(r.obj);
    for (const child of this.engine.scene.children) {
      if (skip.has(child) || child.isLight || child.layers.mask === 1 << HOTEL_LAYER) continue;
      child.traverse((o) => { if (!o.isLight) o.layers.set(HOTEL_LAYER); });
    }
  }

  checkArea() {
    const a = bigArea(this.player.pos.x, this.player.pos.z);
    if (a !== this.area) this.setArea(a);
  }

  setArea(id) {
    const prev = this.area;
    this.area = id;
    for (const [aid, a] of this.areas) a.group.visible = aid === id;
    const cam = this.camera;
    if (id === 'city') cam.layers.enable(HOTEL_LAYER);
    else {
      if (prev === 'city') this.repartition();
      cam.layers.disable(HOTEL_LAYER);
    }
    const far = this.areas.get(id)?.far ?? this.baseFar;
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    // Otel dünyasına dönünce statik gölge haritası bir kez yeniden çizilir (garajdayken çizildiyse eksik kalmasın)
    if (id === 'city' && prev !== 'city') this.engine.requestShadowUpdate();
    this.onArea?.(id, prev);
    this.engine.requestRender();
  }

  setNight(t) { this.garage.setNight(t); }

  // ---- CityVehicleSystem eklentisi ---------------------------------------------------------------

  carHooks() {
    const self = this;
    return {
      mountRange: CAR_RULES.MOUNT_RANGE,
      makeModel: (v) => makeCarModel(v.model, v.color),
      def(v) {
        const m = CAR_BY_ID[v.model];
        return { icon: '🚗', name: m?.name ?? 'Araba', to: 'Arabaya', from: 'Arabadan', poss: `${m?.brand ?? ''} arabası`.trim() };
      },
      driveDef: (v) => self.driveDef(v),
      canPark: (x, z) => carZone(x, z) !== null,
      passengerEye: (v) => CAR_BODIES[CAR_BY_ID[v.model]?.body]?.eye ?? 1.15,
      passengerPos: (v, x, z, yaw) => carPassengerSeat(x, z, yaw, CAR_BY_ID[v.model]?.body),
      onSeat: (seat, v) => self.onSeat(seat, v),
      onLeave: () => self.onLeave(),
      onList: (list, meshes) => self.onList(list, meshes),
      updateMesh: (m, v, own) => self.updateMesh(m, v, own),
    };
  }

  /** PlayerController sürüş ayarları: katalog fiziği, bölge sınırı, gövde çarpışması, koltuk kamerası */
  driveDef(v) {
    const m = CAR_BY_ID[v.model];
    const body = CAR_BODIES[m.body];
    const ph = carPhysics(m);
    const r = body.W / 2 + 0.03;
    const off = Math.max(0, body.L / 2 - r);
    const col = this.collision;
    const p = { x: 0, z: 0 };
    const resolve = (pos, yaw) => {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      for (const k of [off, -off, 0]) {
        p.x = pos.x + fx * k;
        p.z = pos.z + fz * k;
        const ox = p.x;
        const oz = p.z;
        col.resolve(p, r);
        pos.x += p.x - ox;
        pos.z += p.z - oz;
      }
    };
    return {
      speed: ph.vmax, accel: ph.A, turn: 1.5, eye: body.eye, reverse: CAR_RULES.REVERSE, radius: r,
      accelAt: (s) => carAccel(m, s),
      turnAt: (s) => carTurnRate(s),
      brake: CAR_RULES.BRAKE,
      coast: (s) => CAR_RULES.COAST + s * 0.012,
      limit: (x, z) => carSpeedCap(m, x, z),
      move(pos, yaw, dx, dz) {
        const dist = Math.hypot(dx, dz);
        const steps = Math.max(1, Math.ceil(dist / 0.12));
        for (let i = 0; i < steps; i++) {
          pos.x += dx / steps;
          pos.z += dz / steps;
          resolve(pos, yaw);
        }
      },
      seat: { x: -body.seat.x, z: body.seat.z },
      roll: 0.025,
      freeLook: true,
    };
  }

  onSeat(seat, v) {
    if (seat === 'driver') {
      for (const w of this.carWalls) w.enabled = true;
      const m = this.vehicles.meshes.get(v.id);
      this.cockpit.start(v, CAR_BY_ID[v.model], m.obj);
      this.rebuildColliders(this.vehicles.list, v.id);
      const keys = this.device.touch ? 'Joystick ya da ⛽/🛑: gaz-fren · sağ taraf: etrafa bak' : 'W/S gaz-fren · A/D direksiyon · fare: etrafa bak · E: in';
      this.hud.toast(`🚗 ${CAR_BY_ID[v.model].name} — ${keys}`, 'info');
    }
  }

  onLeave() {
    for (const w of this.carWalls) w.enabled = false;
    this.cockpit.stop();
    this.rebuildColliders(this.vehicles.list);
  }

  /** Araç listesi değişti: park etmiş arabaların çarpışma kutuları, arabadaki oyuncuların gövdesi */
  onList(list, meshes) {
    this.rebuildColliders(list, this.vehicles.drivingCar ? this.vehicles.seat.id : null);
    const riders = new Set();
    for (const v of list) {
      if (v.type !== 'car') continue;
      const m = meshes.get(v.id);
      if (m) m.obj.userData.head.visible = v.driver != null && v.driver !== this.vehicles.selfId;
      if (m && v.driver == null) setBrake(m.obj, false);
      for (const id of [v.driver, v.passenger]) if (id != null && id !== this.vehicles.selfId) riders.add(id);
    }
    // Arabadaki oyuncunun ayakta duran gövdesi tavandan çıkmasın (isim etiketi kalır)
    for (const id of this.hiddenRiders) {
      if (riders.has(id)) continue;
      const r = this.remotes.get(id);
      if (r) r.obj.userData.inner.visible = true;
    }
    for (const id of riders) {
      const r = this.remotes.get(id);
      if (r) r.obj.userData.inner.visible = false;
    }
    this.hiddenRiders = riders;
  }

  rebuildColliders(list, exceptId = null) {
    for (const b of this.carColliders) this.collision.remove(b);
    this.carColliders = [];
    for (const v of list) {
      if (v.type !== 'car' || v.driver != null || v.id === exceptId) continue;
      const body = CAR_BODIES[CAR_BY_ID[v.model]?.body];
      if (!body) continue;
      const h = body.W * 0.46;
      const off = (body.L - body.W) / 2;
      const fx = -Math.sin(v.yaw);
      const fz = -Math.cos(v.yaw);
      for (const k of [-off, 0, off]) {
        const x = v.x + fx * k;
        const z = v.z + fz * k;
        this.carColliders.push(this.collision.add(x - h, x + h, z - h, z + h));
      }
    }
  }

  /** Başkasının sürdüğü araba: durunca stop lambaları yanar */
  updateMesh(m, v, own) {
    if (own) return;
    const spd = Math.hypot(m.obj.position.x - m.lx, m.obj.position.z - m.lz);
    setBrake(m.obj, spd < 0.003);
  }

  // ---- Hedefler (E): terminal, asansör --------------------------------------------------------------

  findTarget(px, pz, f) {
    if (this.area !== 'garage' || this.vehicles.seat) return null;
    const near = (pt, range) => {
      const dx = pt[0] - px;
      const dz = pt[1] - pz;
      const d = Math.hypot(dx, dz);
      if (d > range) return false;
      return d < 0.8 || (dx * f.x + dz * f.z) / d > 0.35;
    };
    const K = GARAGE_LAYOUT.kiosk;
    if (near(K.point, K.range)) {
      return { x: K.x, z: K.z - 0.4, marker: false, short: 'Galeri', label: '🚗 AutoGalerie — araba satın al', use: () => this.openDealer() };
    }
    const E = GARAGE_LAYOUT.elevator;
    if (near(E.point, E.range)) {
      return { x: E.x, z: E.z - 0.6, marker: false, short: 'Lobi', label: '🛗 Asansörle lobiye çık', use: () => this.xfer(CAR_XFER_BY_ID.lobby) };
    }
    return null;
  }

  // ---- Geçitler (rampa, tünel, asansör) ------------------------------------------------------------

  /** Oyuncu hareket edince: bölge + yürüyerek / sürerek girilen geçitler */
  onMoved() {
    this.checkArea();
    const { x, z } = this.player.pos;
    if (this.vehicles.seat?.seat === 'passenger') return; // sürücü götürür
    let hit = null;
    for (const t of CAR_XFERS) if (t.walk && inXferZone(t, x, z)) hit = t;
    if (!hit) {
      this.latch = null;
      return;
    }
    if (this.latch === hit.id || this.pending || performance.now() - this.lastXfer < 1200) return;
    if (this.vehicles.seat && !this.vehicles.drivingCar) {
      this.latch = hit.id;
      this.hud.toast('🚲 Bisiklet / scooter ile buradan geçilmez — önce park et.', 'warn');
      return;
    }
    this.xfer(hit);
  }

  async xfer(t) {
    if (this.pending) return;
    this.pending = true;
    this.latch = t.id;
    const fade = this.el.fade;
    fade.textContent = `${t.icon} ${t.label}`;
    fade.hidden = false;
    fade.classList.add('on');
    if (this.vehicles.drivingCar) this.player.vel *= 0.3;
    const res = await this.net.request(EVT.CAR_ACT, { act: 'xfer', id: t.id });
    this.pending = false;
    const done = () => setTimeout(() => {
      fade.classList.remove('on');
      setTimeout(() => { fade.hidden = true; }, 320);
    }, 380);
    if (!res.ok) {
      this.hud.toast(res.error || 'Geçilemedi.', 'warn');
      done();
      return;
    }
    this.lastXfer = performance.now();
    this.player.setPose(res.x, res.z, res.yaw);
    if (this.vehicles.drivingCar) this.player.vel = Math.min(this.player.vel, 4);
    this.net.sendMove(res.x, res.z, res.yaw);
    this.net.flushMove?.();
    this.setArea(bigArea(res.x, res.z));
    this.interaction.invalidate();
    this.engine.wake();
    done();
  }

  // ---- AutoGalerie --------------------------------------------------------------------------------

  openDealer() {
    this.dealerMsg = '';
    this.renderDealer(this.el.body, false);
    this.modal.open(this.el.panel);
  }

  myCars() {
    return this.vehicles.list.filter((v) => v.type === 'car' && v.ownerId === this.vehicles.selfId);
  }

  rerender() {
    if (!this.el.panel.hidden) this.renderDealer(this.el.body, false);
    if (this.phone?.isOpen && this.phone.current?.id === 'autogalerie') this.phone.rerender();
  }

  renderDealer(box, inPhone) {
    box.replaceChildren();
    const mk = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    const wallet = this.getWallet();
    const kasa = this.state.economy?.money ?? 0;
    const mine = this.myCars();
    const root = mk('div', `dealer${inPhone ? ' in-phone' : ''}`);
    // Üst bilgi: bakiyeler, ödeme kaynağı, sahip olunan arabalar
    const head = mk('div', 'dealer-head');
    const src = mk('div', 'dealer-src');
    for (const [id, label, amount] of [['wallet', '🎒 Cüzdan', wallet], ['kasa', '🏨 Otel kasası', kasa]]) {
      const b = mk('button', id === this.source ? 'on' : '', `${label} · ${formatEuro(amount)}`);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.source = id;
        this.rerender();
      });
      src.append(b);
    }
    head.append(src, mk('div', 'dealer-count', `Arabaların: ${mine.length}/${CAR_RULES.MAX_PER_PLAYER} · teslimat: garajda boş park yeri`));
    root.append(head);
    if (this.dealerMsg) root.append(mk('p', 'dealer-msg', this.dealerMsg));
    const funds = this.source === 'wallet' ? wallet : kasa;
    const list = mk('div', 'dealer-list');
    for (const m of CAR_MODELS) {
      const card = mk('div', 'car-card');
      const sel = this.selColor[m.id] ?? 0;
      const swatch = mk('div', 'car-art');
      swatch.style.setProperty('--paint', m.colors[sel].hex);
      swatch.append(mk('span', 'car-body', BODY_NAME[m.body]));
      const info = mk('div', 'car-info');
      info.append(mk('div', 'car-name', m.name));
      const price = mk('div', 'car-price');
      price.append(mk('b', null, formatEuro(m.price)), mk('small', null, ` ${formatUsd(m.price)}`));
      info.append(price);
      const run = idealRun(m);
      const stats = mk('div', 'car-stats');
      for (const [k, v] of [['🏁', `${m.topKmh} km/s`], ['⏱', `0–100 ${m.t100.toFixed(1)} sn`], ['🐎', `${m.hp} bg`], ['¼', `~${run.et.toFixed(1)} sn`]]) {
        const s = mk('span', null, `${k} ${v}`);
        stats.append(s);
      }
      info.append(stats, mk('div', 'car-desc', m.desc));
      const colors = mk('div', 'car-colors');
      m.colors.forEach((c, i) => {
        const b = mk('button', i === sel ? 'on' : '');
        b.type = 'button';
        b.title = c.name;
        b.setAttribute('aria-label', c.name);
        b.style.background = c.hex;
        b.addEventListener('click', () => {
          this.selColor[m.id] = i;
          this.rerender();
        });
        colors.append(b);
      });
      info.append(colors);
      const buy = mk('button', 'car-buy', mine.length >= CAR_RULES.MAX_PER_PLAYER ? 'Garaj dolu' : `Satın al · ${formatEuro(m.price)}`);
      buy.type = 'button';
      buy.disabled = mine.length >= CAR_RULES.MAX_PER_PLAYER || funds < m.price;
      if (funds < m.price && mine.length < CAR_RULES.MAX_PER_PLAYER) buy.title = 'Seçili kaynakta yeterli para yok';
      buy.addEventListener('click', () => this.buy(m, sel, buy, inPhone));
      card.append(swatch, info, buy);
      list.append(card);
    }
    root.append(list);
    if (mine.length) {
      root.append(mk('div', 'dealer-sub', '🅿️ Arabalarım'));
      const ul = mk('div', 'dealer-mine');
      for (const v of mine) {
        const m = CAR_BY_ID[v.model];
        const where = { garage: 'garajda', street: 'otelin önünde', drag: 'drag pistinde' }[carZone(v.x, v.z)] ?? '?';
        const bay = GARAGE_LAYOUT.bays.find((b) => Math.hypot(b.x - v.x, b.z - v.z) < 0.5);
        const row = mk('div', 'mine-row');
        const dot = mk('i');
        dot.style.background = m.colors[v.color]?.hex ?? '#888';
        row.append(dot, mk('span', null, `${m.name} — ${bay ? bay.label : where}${v.driver != null ? ' (sürülüyor)' : ''}`));
        ul.append(row);
      }
      root.append(ul);
    }
    box.append(root);
  }

  async buy(m, color, btn, inPhone) {
    btn.disabled = true;
    const res = await this.net.request(EVT.CAR_ACT, { act: 'buy', model: m.id, color, source: this.source });
    if (!res.ok) {
      this.dealerMsg = res.error || 'Satın alınamadı.';
      if (inPhone) this.hud.toast(this.dealerMsg, 'warn');
      this.rerender();
      return;
    }
    this.dealerMsg = `✓ ${m.name} senin! ${res.bay ? `Garajda ${res.bay} numaralı yere park edildi.` : 'Garaj dolu — otelin önüne park edildi.'}`;
    this.hud.toast(`🚗 ${this.dealerMsg}`, 'money');
    // Liste (VEHICLES) birazdan gelir; panel o an yeniden çizilir
    setTimeout(() => this.rerender(), 250);
  }

  // ---- Kare ------------------------------------------------------------------------------------------

  /** @returns {boolean} kare gerekli mi */
  update(dt) {
    return this.cockpit.update(dt);
  }
}

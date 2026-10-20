import * as THREE from 'three';
import { EVT, possessive, formatMoney } from '/shared/constants.js';
import { HOUSE, ALLEY, PLAYER_HOUSES, COFFEESHOP, ENTRANCE_HALF, VEHICLE_KIOSK, isOutdoors } from '/shared/layout.js';
import { VEHICLE_TYPES, VEHICLE_BY_ID, VEHICLE_RULES as R, passengerSeat } from '/shared/vehicles.js';

const PASSENGER_EYE = 1.86; // arkada otururken biraz daha yüksek (sürücünün omzunun üstünden bakar)
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// ---- Modeller (düşük poligon; malzemeler renk başına paylaşılır) ------------------------

const mats = new Map();
function mat(hex) {
  let m = mats.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex });
    mats.set(hex, m);
  }
  return m;
}

/** a → b arası silindir (çerçeve boruları) */
function tube(group, a, b, r, hex) {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat(hex));
  m.position.copy(_a).add(_b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _b.sub(_a).normalize());
  group.add(m);
  return m;
}

function box(group, w, h, d, x, y, z, hex, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex));
  m.position.set(x, y, z);
  m.rotation.x = rx;
  group.add(m);
  return m;
}

function wheel(group, r, tubeR, z, hex = '#1a1a1a') {
  const g = new THREE.Group();
  g.position.set(0, r + tubeR, z);
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r, tubeR, 6, 16).rotateY(Math.PI / 2), mat(hex));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8).rotateZ(Math.PI / 2), mat('#9a9a9a'));
  // Jant telleri (dönüşü görünür kılar)
  const spokes = new THREE.Mesh(new THREE.BoxGeometry(0.012, r * 1.9, 0.012), mat('#b8b8b8'));
  const spokes2 = spokes.clone();
  spokes2.rotation.x = Math.PI / 2;
  g.add(tire, hub, spokes, spokes2);
  group.add(g);
  return g;
}

/** Yerel eksen: önü +Z, y=0 zemin. userData.wheels: dönen tekerlekler, userData.r: tekerlek yarıçapı */
export function makeVehicleModel(type, color) {
  const g = new THREE.Group();
  const wheels = [];
  if (type === 'bike') {
    const r = 0.33;
    wheels.push(wheel(g, r, 0.025, 0.52), wheel(g, r, 0.025, -0.52));
    const RW = [0, 0.355, -0.52];
    const FW = [0, 0.355, 0.52];
    const BB = [0, 0.33, -0.05];
    const ST = [0, 0.9, -0.2]; // sele borusu üstü
    const HT = [0, 0.95, 0.38]; // gidon borusu üstü
    tube(g, BB, ST, 0.02, color);
    tube(g, ST, HT, 0.02, color);
    tube(g, BB, [0, 0.62, 0.42], 0.022, color);
    tube(g, BB, RW, 0.015, color);
    tube(g, ST, RW, 0.015, color);
    tube(g, HT, FW, 0.018, color);
    tube(g, HT, [0, 1.06, 0.34], 0.017, '#2a2a2a');
    tube(g, [-0.28, 1.06, 0.34], [0.28, 1.06, 0.34], 0.016, '#2a2a2a'); // gidon
    box(g, 0.17, 0.06, 0.26, 0, 0.96, -0.22, '#2a1a12'); // sele
    // Arka bagaj + minder (yolcu buraya oturur — Amsterdam usulü "achterop")
    tube(g, [0, 0.74, -0.25], RW, 0.012, '#555');
    box(g, 0.22, 0.03, 0.42, 0, 0.75, -0.46, '#555');
    box(g, 0.24, 0.06, 0.36, 0, 0.79, -0.46, '#3b2a20');
    // Ön sepet
    box(g, 0.34, 0.2, 0.26, 0, 0.92, 0.62, '#a8834f');
    box(g, 0.32, 0.02, 0.24, 0, 0.82, 0.62, '#7a5a30');
  } else {
    const r = 0.19;
    wheels.push(wheel(g, r, 0.07, 0.56, '#202020'), wheel(g, r, 0.07, -0.52, '#202020'));
    box(g, 0.5, 0.42, 0.85, 0, 0.55, -0.3, color); // arka gövde
    box(g, 0.36, 0.07, 0.55, 0, 0.3, 0.2, '#2a2a2a'); // ayak tabanı
    box(g, 0.46, 0.75, 0.08, 0, 0.62, 0.5, color, -0.2); // ön kalkan
    tube(g, [0, 0.95, 0.56], [0, 0.32, 0.62], 0.035, '#3a3a3a'); // direksiyon kolonu
    box(g, 0.56, 0.06, 0.08, 0, 1.0, 0.56, '#2a2a2a'); // gidon
    box(g, 0.36, 0.1, 0.78, 0, 0.82, -0.32, '#3b2a20'); // uzun sele (iki kişilik)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
    lamp.position.set(0, 0.92, 0.62);
    g.add(lamp);
    box(g, 0.3, 0.08, 0.1, 0, 0.62, -0.74, '#c8202f'); // stop lambası
  }
  g.userData = { wheels, r: type === 'bike' ? 0.355 : 0.26 };
  return g;
}

/**
 * Şehir içi ulaşım (istemci): bisiklet ve scooter.
 *  - Sokaktaki "Fiets & Scooter" büfesinden satın alınır; araç büfenin önündeki P'ye park eder.
 *  - Araca bakıp E / Aksiyon: sahibi sürücü koltuğuna, arkadaşı arka koltuğa biner.
 *    Sürüş FPV: W/S gaz-fren, A/D direksiyon (mobilde joystick), fare / sağ taraf bakış.
 *    Yolcunun konumu sürücüden gelir, etrafa serbestçe bakar.
 *  - Sürerken binalara girilmez (kapılarda yalnızca sürücüye özel engeller); sokak, steeg ve
 *    Achterstraat'ta istediğin yerde E ile inip park edersin.
 *  - Pil: araçlar statik mesh'lerdir; yalnızca hareket ederken (tekerlek dönüşü) kare çizilir.
 *  - Arabalar (`type: 'car'`) aynı listede gelir; modeli, sürüş ayarları, park bölgesi, ön yolcu
 *    koltuğu ve kokpit `this.cars` eklentisinden (UndergroundGarage) gelir.
 */
export class CityVehicleSystem {
  constructor({ engine, net, hud, interaction, player, remotes, collision, modal, device, settings, sfx, getWallet }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.remotes = remotes;
    this.collision = collision;
    this.modal = modal;
    this.device = device;
    this.settings = settings;
    this.sfx = sfx;
    this.getWallet = getWallet;
    this.selfId = null;
    this.list = []; // EVT.VEHICLES
    this.byId = new Map();
    this.meshes = new Map(); // id → { obj, type, last: {x,z} }
    this.owned = new Set();
    this.seat = null; // { id, seat }
    this.pending = false;
    this.lastHud = '';
    this.cars = null; // araba eklentisi (UndergroundGarage.carHooks)

    // Sürücüye özel engeller: bina kapılarından içeri sürülmez
    const doors = [
      [-ENTRANCE_HALF, ENTRANCE_HALF, -0.12, 0.12], // otel girişi
      [COFFEESHOP.door.from, COFFEESHOP.door.to, -0.12, 0.12],
      [HOUSE.door.from, HOUSE.door.to, -0.12, 0.12], // Bizim Ev
      [ALLEY.backDoor.from, ALLEY.backDoor.to, 25.88, 26.12], // otel arka kapısı
      ...PLAYER_HOUSES.map((h) => [h.door.from, h.door.to, 32.88, 33.12]),
    ];
    this.riderWalls = doors.map(([a, b, c, d]) => collision.add(a, b, c, d, false));

    const $ = (id) => document.getElementById(id);
    this.el = { panel: $('vehicle-panel'), list: $('vehicle-list'), wallet: $('vehicle-wallet'), msg: $('vehicle-msg'), hud: $('vehicle-hud') };
    $('vehicle-close').addEventListener('click', () => this.modal.close(this.el.panel));

    // Sürerken / yolcuyken "in" hedefi her şeyden önce gelir
    interaction.providers.unshift({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  // ---- Sunucu durumu ---------------------------------------------------------------

  applySelf(v) {
    if (!v) return;
    this.owned = new Set(v.owned ?? []);
    if (!v.seat && this.seat) this.leaveSeat(); // sunucuya göre artık araçta değilim
    if (this.el.panel && !this.el.panel.hidden) this.renderPanel();
  }

  /** EVT.VEHICLES / snapshot.vehicles */
  setVehicles(list) {
    this.list = Array.isArray(list) ? list : [];
    this.byId = new Map(this.list.map((v) => [v.id, v]));
    for (const v of this.list) {
      let m = this.meshes.get(v.id);
      if (!m) {
        let obj;
        if (v.type === 'car') obj = this.cars.makeModel(v);
        else {
          const def = VEHICLE_BY_ID[v.type];
          obj = makeVehicleModel(v.type, def.colors[v.ownerId % def.colors.length]);
        }
        m = { obj, type: v.type, lx: v.x, lz: v.z };
        this.engine.scene.add(m.obj);
        this.meshes.set(v.id, m);
      }
    }
    for (const [id, m] of this.meshes) {
      if (this.byId.has(id)) continue;
      this.engine.scene.remove(m.obj);
      this.meshes.delete(id);
    }
    // Sürücüsüyken araç kalktıysa (bağlantı / sunucu) koltuktan in
    if (this.seat) {
      const v = this.byId.get(this.seat.id);
      const mine = v && (this.seat.seat === 'driver' ? v.driver === this.selfId : v.passenger === this.selfId);
      if (!mine) this.leaveSeat();
    }
    this.placeParked();
    this.cars?.onList(this.list, this.meshes);
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  /** Araç türünün tanımı (ad, simge, ekler); arabalarda katalog modeli */
  defOf(v) {
    return v?.type === 'car' ? this.cars.def(v) : VEHICLE_BY_ID[v?.type];
  }

  /** Sürücünün şu an araba sürüyor olması */
  get drivingCar() {
    return this.seat?.seat === 'driver' && this.byId.get(this.seat.id)?.type === 'car';
  }

  /** EVT.VEHICLE_SEAT: sürücü indi → yolcu da iner, sunucunun verdiği yere */
  onSeat({ seat, x, z }) {
    if (seat !== null) return;
    if (this.seat?.seat === 'passenger') this.hud.toast('Sürücü park etti — indin.', 'info');
    this.leaveSeat();
    if (Number.isFinite(x) && Number.isFinite(z)) this.player.setPose(x, z);
  }

  reset(selfId) {
    this.selfId = selfId;
    this.leaveSeat();
  }

  // ---- Hedefler --------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (this.seat) {
      const at = { x: px, z: pz, marker: false };
      if (this.seat.seat === 'passenger') return { ...at, short: 'İn', label: '⬇ Arkadan in', use: () => this.dismount() };
      const sv = this.byId.get(this.seat.id);
      if (sv?.type === 'car') {
        if (!this.cars.canPark(px, pz)) return { ...at, short: 'İn', label: '🚫 Burada park edilmez', use: () => this.hud.toast('Garajda, otelin önünde, drag alanında ya da şehir dışındaki avlu / depolarda park edebilirsin.', 'info') };
      } else if (!isOutdoors(px, pz)) return { ...at, short: 'İn', label: '🚫 Burada park edilmez', use: () => this.hud.toast('Sokakta, steeg\'de ya da Achterstraat\'ta park edebilirsin.', 'info') };
      const def = this.defOf(sv);
      return { ...at, short: 'Park', label: `🅿️ ${def?.from ?? 'Araçtan'} in ve park et`, use: () => this.dismount() };
    }
    // Büfe
    const [kx, kz] = VEHICLE_KIOSK.pos;
    let best = null;
    let bestD = Infinity;
    const consider = (x, z, range, make) => {
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.7 && dot < 0.4) return;
      if (d < bestD) {
        bestD = d;
        best = make();
      }
    };
    consider(kx, kz + 0.4, VEHICLE_KIOSK.range, () => ({
      x: kx, z: kz, marker: false, short: 'Büfe', label: '🛒 Bisiklet / scooter satın al', use: () => this.openPanel(),
    }));
    for (const v of this.list) {
      if (v.driver != null && v.passenger != null) continue;
      if (v.valet && v.ownerId !== this.selfId) continue; // VIP vale aracı: yalnızca anahtar sahibi (ValetCarWash kürsüsü)
      consider(v.x, v.z, v.type === 'car' ? this.cars.mountRange : R.MOUNT_RANGE, () => this.vehicleTarget(v));
    }
    return best;
  }

  vehicleTarget(v) {
    const def = this.defOf(v);
    const at = { x: v.x, z: v.z, marker: true };
    if (v.ownerId === this.selfId) {
      if (v.driver != null) return { ...at, short: def.icon, label: `${def.icon} ${def.name}`, use: () => {} };
      const extra = v.passenger != null ? ' (arkada biri bekliyor)' : '';
      return { ...at, short: 'Bin', label: `${def.icon} ${def.to} bin ve sür${extra}`, use: () => this.mount(v) };
    }
    if (v.passenger != null) return { ...at, short: def.icon, label: `${def.icon} ${possessive(v.ownerName)} ${def.poss} — dolu`, use: () => this.hud.toast('Arka koltuk dolu.', 'info') };
    return { ...at, short: 'Arkaya', label: `${def.icon} ${possessive(v.ownerName)} ${def.poss} — arkaya bin`, use: () => this.mount(v) };
  }

  // ---- Binme / inme ------------------------------------------------------------------

  async mount(v) {
    if (this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.VEHICLE_ACT, { act: 'mount', id: v.id });
    this.pending = false;
    if (!res.ok) {
      this.hud.toast(res.error || 'Binemedin.', 'warn');
      return;
    }
    const def = this.defOf(v);
    const car = v.type === 'car';
    this.seat = { id: v.id, seat: res.seat };
    if (res.seat === 'driver') {
      // Araba: koltuğa otururken gövde yönüne dön (yaw = arabanın yönü)
      this.player.setPose(res.x, res.z, car ? res.yaw : undefined);
      this.player.setDrive(car ? this.cars.driveDef(v) : { speed: def.speed, accel: def.accel, turn: def.turn, eye: def.eye, reverse: R.REVERSE, radius: R.RIDER_RADIUS });
      for (const w of this.riderWalls) w.enabled = true;
      if (car) this.cars.onSeat('driver', v);
      const keys = this.device.touch ? 'Joystick: gaz / direksiyon · Park: in' : 'W/S gaz-fren · A/D direksiyon · E: in ve park et';
      if (!car) this.hud.toast(`${def.icon} Sürüyorsun! ${keys}`, 'info'); // araba: kokpit kendi ipucunu gösterir
      if (this.settings?.sound) this.sfx?.clink?.();
    } else if (car) {
      this.player.setFollow(() => this.passengerPos(), this.cars.passengerEye(v));
      this.cars.onSeat('passenger', v);
      this.hud.toast(`🚗 Ön koltuğa bindin — sürücü nereye, sen oraya. E: in`, 'info');
    } else {
      this.player.setFollow(() => this.passengerPos(), PASSENGER_EYE);
      this.hud.toast(`${def.icon} Arkaya bindin — sürücü nereye, sen oraya. E: in`, 'info');
    }
    this.interaction.invalidate();
    this.engine.wake();
  }

  async dismount() {
    if (this.pending || !this.seat) return;
    this.pending = true;
    const res = await this.net.request(EVT.VEHICLE_ACT, { act: 'dismount' });
    this.pending = false;
    if (!res.ok) {
      this.hud.toast(res.error || 'İnemedin.', 'warn');
      return;
    }
    const wasPassenger = this.seat?.seat === 'passenger';
    const wasCar = this.byId.get(this.seat?.id)?.type === 'car';
    this.leaveSeat();
    // Yolcu ve araba sürücüsü sunucunun verdiği yere (kapının yanı) iner
    if ((wasPassenger || wasCar) && Number.isFinite(res.x)) this.player.setPose(res.x, res.z);
    this.hud.toast(wasPassenger ? 'İndin.' : '🅿️ Park ettin.', 'info');
  }

  leaveSeat() {
    if (!this.seat) return;
    this.seat = null;
    this.showLabel(true);
    this.player.setDrive(null);
    this.player.setFollow(null);
    for (const w of this.riderWalls) w.enabled = false;
    this.cars?.onLeave();
    this.el.hud.hidden = true;
    this.lastHud = '';
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  /** Yolcunun yeri: sürücünün (yumuşatılmış) konumunun arkası */
  passengerPos() {
    const v = this.seat && this.byId.get(this.seat.id);
    const r = v?.driver != null ? this.remotes.get(v.driver) : null;
    if (!r) return v ? { x: v.x, z: v.z } : null;
    const yaw = r.obj.rotation.y - Math.PI; // karakter yönü → kamera yaw'ı
    if (v.type === 'car') return this.cars.passengerPos(v, r.obj.position.x, r.obj.position.z, yaw);
    return passengerSeat(r.obj.position.x, r.obj.position.z, yaw);
  }

  // ---- Büfe paneli -------------------------------------------------------------------

  openPanel() {
    this.el.msg.textContent = '';
    this.renderPanel();
    this.modal.open(this.el.panel);
  }

  renderPanel() {
    const wallet = this.getWallet();
    this.el.wallet.textContent = formatMoney(wallet);
    this.el.list.replaceChildren();
    for (const def of VEHICLE_TYPES) {
      const row = document.createElement('div');
      row.className = 'product';
      const icon = document.createElement('div');
      icon.className = 'icon';
      icon.textContent = def.icon;
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = `${def.name} · ${Math.round(def.speed * 3.6)} km/sa · 2 kişilik`;
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = def.desc;
      info.append(name, desc);
      const btn = document.createElement('button');
      btn.type = 'button';
      const has = this.owned.has(def.id);
      btn.textContent = has ? 'Sende var ✓' : `Satın al · €${def.price}`;
      btn.disabled = has || wallet < def.price;
      btn.addEventListener('click', () => this.buy(def.id, btn));
      row.append(icon, info, btn);
      this.el.list.append(row);
    }
  }

  async buy(type, btn) {
    btn.disabled = true;
    const res = await this.net.request(EVT.VEHICLE_ACT, { act: 'buy', type });
    if (!res.ok) {
      this.el.msg.textContent = res.error || 'Satın alınamadı.';
      this.renderPanel();
      return;
    }
    const def = VEHICLE_BY_ID[type];
    this.owned.add(type);
    this.modal.close(this.el.panel);
    this.hud.toast(`${def.icon} ${def.name} senin! Büfenin önündeki P'ye park edildi — bakıp E ile bin.`, 'money');
  }

  // ---- Kare güncellemesi ---------------------------------------------------------------

  /** Park hâlindeki araçları yerine koy (yalnızca liste değişince) */
  placeParked() {
    for (const v of this.list) {
      if (v.driver != null) continue;
      const m = this.meshes.get(v.id);
      m.obj.position.set(v.x, 0, v.z);
      m.obj.rotation.y = v.yaw + Math.PI;
      m.lx = v.x;
      m.lz = v.z;
    }
  }

  /** Yolcuyken sürücünün isim etiketi tam göz hizasında kalır: gizle (inince geri) */
  showLabel(on) {
    if (on) {
      if (this.hiddenLabel) this.hiddenLabel.visible = true;
      this.hiddenLabel = null;
      return;
    }
    const v = this.byId.get(this.seat?.id);
    const label = v?.driver != null ? this.remotes.get(v.driver)?.label : null;
    if (label === this.hiddenLabel) {
      if (label) label.visible = false; // sohbet balonu kalkınca etiket geri gelmiş olabilir
      return;
    }
    if (this.hiddenLabel) this.hiddenLabel.visible = true;
    this.hiddenLabel = label ?? null;
    if (label) label.visible = false;
  }

  /** @returns {boolean} hareket eden araç var mı */
  update() {
    let active = false;
    if (this.seat?.seat === 'passenger') this.showLabel(false);
    for (const v of this.list) {
      if (v.driver == null) continue;
      const m = this.meshes.get(v.id);
      if (!m) continue;
      let x;
      let z;
      let ry;
      if (v.driver === this.selfId && this.seat?.seat === 'driver') {
        x = this.player.pos.x;
        z = this.player.pos.z;
        ry = this.player.yaw + Math.PI;
      } else {
        const r = this.remotes.get(v.driver);
        if (!r) continue;
        x = r.obj.position.x;
        z = r.obj.position.z;
        ry = r.obj.rotation.y;
      }
      const dist = Math.hypot(x - m.lx, z - m.lz);
      m.obj.position.set(x, 0, z);
      m.obj.rotation.y = ry;
      if (v.type === 'car') this.cars.updateMesh(m, v, v.driver === this.selfId, x, z, ry);
      if (dist > 1e-4) {
        // Tekerlekler gidilen yol kadar döner
        const fwd = (x - m.lx) * Math.sin(ry) + (z - m.lz) * Math.cos(ry);
        for (const w of m.obj.userData.wheels) w.rotation.x += fwd / m.obj.userData.r;
        active = true;
      }
      m.lx = x;
      m.lz = z;
    }
    this.updateHud();
    return active;
  }

  /** Sürerken hız göstergesi (yalnızca değer değişince DOM'a yazılır) */
  updateHud() {
    if (this.seat?.seat !== 'driver' || this.drivingCar) return; // arabanın kendi göstergesi var (kokpit)
    const def = VEHICLE_BY_ID[this.byId.get(this.seat.id)?.type];
    const kmh = Math.round(Math.abs(this.player.vel) * 3.6);
    const text = `${def?.icon ?? '🚲'} ${kmh} km/sa${this.player.vel < -0.05 ? ' · geri' : ''}`;
    if (text === this.lastHud) return;
    this.lastHud = text;
    this.el.hud.hidden = false;
    this.el.hud.textContent = text;
  }
}

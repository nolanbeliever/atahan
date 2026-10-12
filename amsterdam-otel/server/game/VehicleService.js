import { EVT } from '../../shared/constants.js';
import { VEHICLE_KIOSK, isOutdoors } from '../../shared/layout.js';
import { VEHICLE_BY_ID, VEHICLE_RULES as R, passengerSeat } from '../../shared/vehicles.js';

const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_SAVED = 2000;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (typeof v === 'number' ? v : NaN);

/**
 * Şehir içi ulaşım (sunucu yetkili): bisiklet ve scooter.
 *  - Sokaktaki büfeden satın alınır; araç sahibinin cüzdanından ödenir, sahip anahtarlıysa kalıcıdır
 *    (son park yeriyle birlikte). Sahibi çevrimiçiyken araç dünyada park hâlinde durur.
 *  - Sürücü koltuğuna yalnızca sahibi oturur; arka koltuğa (yolcu) başka bir oyuncu biner.
 *    Sürücünün konumu aracın konumudur; yolcu her adımda sürücünün arkasına taşınır
 *    (yolcunun kendi gönderdiği konum yok sayılır, bakış yönü serbesttir).
 *  - Yalnızca açık havada (sokak, steeg, Achterstraat) inilir / park edilir; istemci de binalara
 *    sürmeyi kapı engelleriyle önler.
 */
export class VehicleService {
  constructor(sim) {
    this.sim = sim;
    this.saved = new Map(); // keyHash → { [type]: { x, z, yaw } }
    this.vehicles = new Map(); // id → araç
    this.nextId = 1;
    this.restore(sim.house.vehiclesData);
  }

  // ---- Kalıcılık ---------------------------------------------------------------

  restore(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    for (const [hash, rec] of Object.entries(data)) {
      if (this.saved.size >= MAX_SAVED) break;
      if (!HASH_RE.test(hash) || !rec || typeof rec !== 'object') continue;
      const out = {};
      for (const [type, pos] of Object.entries(rec)) {
        if (!VEHICLE_BY_ID[type] || !pos || typeof pos !== 'object') continue;
        out[type] = this.validPos(num(pos.x), num(pos.z), num(pos.yaw));
      }
      if (Object.keys(out).length) this.saved.set(hash, out);
    }
  }

  persisted() {
    // Çevrimiçi sahiplerin araçlarının güncel park yeri
    for (const v of this.vehicles.values()) {
      const rec = v.ownerHash && this.saved.get(v.ownerHash);
      if (rec) rec[v.type] = { x: v.x, z: v.z, yaw: v.yaw };
    }
    return Object.fromEntries([...this.saved].map(([h, rec]) => [h, { ...rec }]));
  }

  /** Bozuk / kapalı alandaki park yeri → büfenin önü */
  validPos(x, z, yaw) {
    if (Number.isFinite(x) && Number.isFinite(z) && isOutdoors(x, z)) {
      return { x: r2(x), z: r2(z), yaw: Number.isFinite(yaw) ? r2(yaw) : 0 };
    }
    const [sx, sz] = VEHICLE_KIOSK.spawn;
    return { x: sx, z: sz, yaw: Math.PI / 2 };
  }

  save(p) {
    if (!p.keyHash) return;
    this.sim.house.scheduleSave();
  }

  // ---- Oyuncular ---------------------------------------------------------------

  /** Katılınca sahip olduğu araçlar son park yerlerinde belirir */
  initPlayer(p) {
    p.vehicle = null; // { id, seat: 'driver' | 'passenger' }
    p.ownedVehicles = new Set();
    const rec = p.keyHash ? this.saved.get(p.keyHash) : null;
    if (!rec) return;
    for (const [type, pos] of Object.entries(rec)) {
      p.ownedVehicles.add(type);
      this.spawn(p, type, pos);
    }
  }

  /** Oyuncu ayrılırken: sürüyorsa park eder, yolcuysa iner; araçları dünyadan kalkar (park yeri kayıtlı) */
  removePlayer(p) {
    if (p.vehicle) this.dismount(p, { force: true });
    for (const v of [...this.vehicles.values()]) {
      if (v.ownerId !== p.id) continue;
      if (v.passenger != null) {
        const q = this.sim.players.get(v.passenger);
        if (q) this.dismount(q, { force: true });
      }
      const rec = p.keyHash ? this.saved.get(p.keyHash) : null;
      if (rec) rec[v.type] = { x: v.x, z: v.z, yaw: v.yaw };
      this.vehicles.delete(v.id);
    }
    this.save(p);
    this.broadcast();
  }

  spawn(p, type, pos) {
    const v = {
      id: this.nextId++, type, ownerId: p.id, ownerHash: p.keyHash, ownerName: p.name,
      x: pos.x, z: pos.z, yaw: pos.yaw, driver: null, passenger: null,
    };
    this.vehicles.set(v.id, v);
    return v;
  }

  // ---- Eylemler ----------------------------------------------------------------

  /** @returns {{ ok: true, ... } | { ok: false, error }} */
  act(p, data) {
    const act = typeof data?.act === 'string' ? data.act : '';
    if (act === 'buy') return this.buy(p, data.type);
    if (act === 'mount') return this.mount(p, data.id);
    if (act === 'dismount') return this.dismount(p);
    return { ok: false, error: 'Geçersiz işlem.' };
  }

  buy(p, type) {
    const def = typeof type === 'string' ? VEHICLE_BY_ID[type] : undefined;
    if (!def) return { ok: false, error: 'Böyle bir araç yok.' };
    const [kx, kz] = VEHICLE_KIOSK.pos;
    if (Math.hypot(p.x - kx, p.z - kz) > VEHICLE_KIOSK.range + 1) return { ok: false, error: 'Satın almak için büfeye yaklaş.' };
    if (p.ownedVehicles.has(def.id)) return { ok: false, error: `Zaten bir ${def.name.toLocaleLowerCase('tr-TR')} var.` };
    if (!(p.wallet >= def.price)) return { ok: false, error: `${def.name} için €${def.price} gerekli.` };
    p.wallet -= def.price;
    p.ownedVehicles.add(def.id);
    const v = this.spawn(p, def.id, this.validPos(NaN, NaN, NaN));
    if (p.keyHash) {
      const rec = this.saved.get(p.keyHash) ?? {};
      rec[def.id] = { x: v.x, z: v.z, yaw: v.yaw };
      this.saved.delete(p.keyHash);
      this.saved.set(p.keyHash, rec);
      if (this.saved.size > MAX_SAVED) this.saved.delete(this.saved.keys().next().value);
    }
    this.sim.shop.sendSelf(p);
    this.save(p);
    this.broadcast();
    return { ok: true, id: v.id, type: def.id };
  }

  mount(p, id) {
    if (p.vehicle) return { ok: false, error: 'Zaten bir araçtasın.' };
    const v = Number.isInteger(id) ? this.vehicles.get(id) : undefined;
    if (!v) return { ok: false, error: 'Araç bulunamadı.' };
    if (Math.hypot(p.x - v.x, p.z - v.z) > R.MOUNT_RANGE + 1) return { ok: false, error: 'Araca yaklaş.' };
    const def = VEHICLE_BY_ID[v.type];
    if (v.ownerId === p.id) {
      if (v.driver != null) return { ok: false, error: 'Aracında başkası var.' };
      v.driver = p.id;
      p.vehicle = { id: v.id, seat: 'driver' };
      // Sürücü aracın yerine oturur
      p.x = v.x;
      p.z = v.z;
      this.sim.dirtyPlayers.add(p.id);
      if (v.passenger != null) this.carryPassenger(v);
    } else {
      if (v.passenger != null) return { ok: false, error: `${def.name} dolu.` };
      v.passenger = p.id;
      p.vehicle = { id: v.id, seat: 'passenger' };
      this.carryPassenger(v);
    }
    this.broadcast();
    return { ok: true, id: v.id, seat: p.vehicle.seat, x: p.x, z: p.z, yaw: v.yaw };
  }

  /**
   * Araçtan in. Sürücü inince araç orada park eder (yalnızca açık havada); yolcu da iner.
   * @param force oyuncu ayrılırken: konum kontrolü yok
   */
  dismount(p, { force = false } = {}) {
    const seat = p.vehicle;
    if (!seat) return { ok: false, error: 'Bir araçta değilsin.' };
    const v = this.vehicles.get(seat.id);
    if (!v) {
      p.vehicle = null;
      return { ok: true };
    }
    if (seat.seat === 'driver') {
      if (!force && !isOutdoors(p.x, p.z)) return { ok: false, error: 'Buraya park edemezsin — sokakta, steeg\'de ya da Achterstraat\'ta in.' };
      v.driver = null;
      p.vehicle = null;
      Object.assign(v, this.validPos(p.x, p.z, p.yaw));
      if (v.passenger != null) {
        const q = this.sim.players.get(v.passenger);
        if (q) this.dropPassenger(v, q);
      }
      this.save(this.sim.players.get(v.ownerId) ?? p);
    } else {
      this.dropPassenger(v, p);
    }
    this.broadcast();
    return { ok: true, x: p.x, z: p.z };
  }

  /** Yolcu iner: aracın yanına (sağına) bırakılır */
  dropPassenger(v, q) {
    v.passenger = null;
    q.vehicle = null;
    const right = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) };
    let x = v.x + right.x * 0.9;
    let z = v.z + right.z * 0.9;
    if (!isOutdoors(x, z)) {
      x = v.x - right.x * 0.9;
      z = v.z - right.z * 0.9;
    }
    if (!isOutdoors(x, z)) {
      x = v.x;
      z = v.z;
    }
    q.x = r2(x);
    q.z = r2(z);
    this.sim.dirtyPlayers.add(q.id);
    // Yolcunun istemcisi kendi konumunu sunucudan alır
    this.sim.toPlayer(q.id, EVT.VEHICLE_SEAT, { seat: null, x: q.x, z: q.z });
  }

  /** Yolcuyu sürücünün arkasına taşı */
  carryPassenger(v) {
    const q = this.sim.players.get(v.passenger);
    if (!q) return;
    const seat = passengerSeat(v.x, v.z, v.yaw);
    q.x = r2(seat.x);
    q.z = r2(seat.z);
    this.sim.dirtyPlayers.add(q.id);
  }

  /**
   * HotelSimulation.movePlayer'dan, konum uygulanmadan önce.
   * @returns {boolean} false → bu hareketi yok say (yolcu kendi konumunu belirlemez)
   */
  onMove(p, x, z, yaw) {
    const seat = p.vehicle;
    if (!seat) return true;
    const v = this.vehicles.get(seat.id);
    if (!v) {
      p.vehicle = null;
      return true;
    }
    if (seat.seat === 'passenger') {
      p.yaw = yaw; // bakış serbest
      this.sim.dirtyPlayers.add(p.id);
      return false;
    }
    v.x = r2(x);
    v.z = r2(z);
    v.yaw = r2(yaw);
    return true;
  }

  /** Sürücünün konumu uygulandıktan sonra: aracı ve yolcuyu taşı */
  afterMove(p) {
    const seat = p.vehicle;
    if (seat?.seat !== 'driver') return;
    const v = this.vehicles.get(seat.id);
    if (!v) return;
    v.x = r2(p.x);
    v.z = r2(p.z);
    if (v.passenger != null) this.carryPassenger(v);
  }

  privateState(p) {
    return { owned: [...(p.ownedVehicles ?? [])], seat: p.vehicle ? { ...p.vehicle } : null };
  }

  serialize() {
    return [...this.vehicles.values()].map((v) => ({
      id: v.id, type: v.type, ownerId: v.ownerId, ownerName: v.ownerName,
      x: v.x, z: v.z, yaw: v.yaw, driver: v.driver, passenger: v.passenger,
    }));
  }

  broadcast() {
    this.sim.out(EVT.VEHICLES, this.serialize());
  }
}

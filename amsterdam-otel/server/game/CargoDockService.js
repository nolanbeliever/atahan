import { EVT } from '../../shared/constants.js';
import {
  CARGO_DOCK, CARGO_TYPES, CARGO_TYPE_IDS, CARGO_RULES as R, SUPPLIERS,
  isInsideCargoArea, isInsideHall, isInsideCabin, trailerAt, forkCenter, palletAngleDiff, snapRel, palletUnits,
} from '../../shared/cargo.js';

const D = CARGO_DOCK;
const TYPES = Object.assign(Object.create(null), CARGO_TYPES);
const int = (v) => (Number.isInteger(v) ? v : -1);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const near = (p, [x, z], range) => Math.hypot(p.x - x, p.z - z) <= range;
const VIAS = Object.assign(Object.create(null), { pc: true, dock: true });

function emptyStock() {
  return Object.fromEntries(CARGO_TYPE_IDS.map((t) => [t, 0]));
}

/**
 * Mal Kabul Rampası & Transpalet — sunucu yetkili.
 *  - Sipariş: Resepsiyon PC'nin "🚚 Mal Kabul" sekmesinden (ya da rampadaki ofis terminalinden) toptancıya;
 *    bedel + nakliye otelin KASASINDAN. Bir süre sonra NPC tırı avluya girip boş rampaya geri geri yanaşır;
 *    paletler dorsenin içinde fiziksel nesnelerdir.
 *  - Tır sistemi oyuncunun kendi teslimatını `deliver({ by, items, source })` ile bırakır (aynı dorse / paletler).
 *  - Transpalet (2 adet): oyuncu E ile alır, FPV sürer (istemci), çatalları paletin altına hizalayıp kaldırır
 *    (konum + açı burada doğrulanır), yük asansörünün kabinine (2 palet) indirir ve kolondan asansörü gönderir →
 *    paletler depo stokuna (birim = 10 × durum) eklenir. Çarpmalar paletin durumunu düşürür.
 *  - Stok etkileri: `has(type)` / `use(type)` kancalarıyla restoran (büfe), bar, Eğlence Katı ve temizlikçiler.
 *  - Dorse çok uzun dolu bekletilirse şoför bekleme ücreti ister; sonunda paletleri rampaya indirip gider.
 */
export class CargoDockService {
  constructor(sim) {
    this.sim = sim;
    this.stock = emptyStock();
    this.pallets = new Map(); // id → { id, type, cond, where: 'trailer'|'floor'|'jack'|'cabin', bay, slot, x, z, yaw, by, rel }
    this.bays = D.bays.map(() => ({ truck: null })); // truck: { id, phase, at, supplier, npc, fees, lastFee, by }
    this.queue = []; // rampa boşalmasını bekleyen teslimatlar
    this.orders = []; // { id, items: { type: n }, eta, cost, by }
    this.jacks = D.jacks.map((j, i) => ({ id: i, by: null, x: j.x, z: j.z, yaw: j.yaw, carry: null }));
    this.cabin = { phase: 'open', until: 0, slots: [null, null] };
    this.auto = Object.fromEntries(CARGO_TYPE_IDS.map((t) => [t, false]));
    this.offer = null; // { type, mul } (bugünün toptancı fırsatı)
    this.stats = { pallets: 0, damaged: 0, orders: 0, spent: 0, units: 0 };
    this.seq = 1;
    this.truckSeq = 1;
    this.orderSeq = 1;
  }

  get rng() { return this.sim.rng; }

  // ---- Kalıcılık ---------------------------------------------------------------------

  persisted() {
    const now = this.sim.now();
    const pallets = [];
    for (const p of this.pallets.values()) {
      const o = { id: p.id, type: p.type, cond: r3(p.cond), where: p.where, x: r2(p.x), z: r2(p.z), yaw: r3(p.yaw) };
      if (p.where === 'trailer') Object.assign(o, { bay: p.bay, slot: p.slot });
      if (p.where === 'cabin') o.slot = p.slot;
      if (p.where === 'jack') o.where = 'floor'; // taşınan palet kayıtta rampaya bırakılır
      pallets.push(o);
    }
    return {
      stock: { ...this.stock },
      pallets,
      bays: this.bays.map((b) => (b.truck && b.truck.phase !== 'leaving'
        ? { supplier: b.truck.supplier, npc: b.truck.npc, fees: b.truck.fees, by: b.truck.by } : null)),
      queue: this.queue.map((q) => ({ items: q.items, supplier: q.supplier, by: q.by, npc: q.npc })),
      orders: this.orders.map((o) => ({ id: o.id, items: o.items, left: Math.max(0, o.eta - now), cost: o.cost, by: o.by })),
      cabin: this.cabin.slots.slice(),
      cabinMoving: this.cabin.phase === 'moving',
      jacks: this.jacks.map((j) => ({ x: r2(j.x), z: r2(j.z), yaw: r3(j.yaw) })),
      auto: { ...this.auto },
      offer: this.offer,
      stats: { ...this.stats },
      seq: this.seq,
    };
  }

  restore(s) {
    if (!s || typeof s !== 'object') return;
    const now = this.sim.now();
    const okType = (t) => typeof t === 'string' && TYPES[t] !== undefined;
    const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
    if (s.stock && typeof s.stock === 'object') {
      for (const t of CARGO_TYPE_IDS) if (num(s.stock[t], 0, R.STOCK_MAX)) this.stock[t] = Math.round(s.stock[t]);
    }
    if (Array.isArray(s.bays)) {
      s.bays.slice(0, this.bays.length).forEach((b, i) => {
        if (!b || typeof b !== 'object') return;
        this.bays[i].truck = {
          id: this.truckSeq++, phase: 'docked', at: now, supplier: typeof b.supplier === 'string' ? b.supplier.slice(0, 40) : SUPPLIERS.mixed,
          npc: b.npc !== false, fees: int(b.fees) >= 0 ? int(b.fees) : 0, lastFee: now, by: typeof b.by === 'string' ? b.by.slice(0, 24) : '',
        };
      });
    }
    if (Array.isArray(s.pallets)) {
      for (const p of s.pallets.slice(0, 120)) {
        if (!p || !okType(p.type) || !Number.isInteger(p.id) || this.pallets.has(p.id)) continue;
        const cond = num(p.cond, 0, 1) ? Math.max(R.MIN_COND, p.cond) : 1;
        const o = { id: p.id, type: p.type, cond, where: 'floor', bay: -1, slot: -1, x: 0, z: 0, yaw: 0, by: null, rel: 0 };
        if (p.where === 'trailer' && Number.isInteger(p.bay) && this.bays[p.bay]?.truck && Number.isInteger(p.slot) && D.bays[p.bay].slots[p.slot]) {
          Object.assign(o, { where: 'trailer', bay: p.bay, slot: p.slot });
          [o.x, o.z] = D.bays[p.bay].slots[p.slot];
        } else if (p.where === 'trailer' && Number.isInteger(p.bay) && this.bays[p.bay]?.truck && trailerAt(p.x, p.z) === p.bay) {
          Object.assign(o, { where: 'trailer', bay: p.bay, slot: -1, x: p.x, z: p.z, yaw: num(p.yaw, -10, 10) ? p.yaw : 0 }); // dorseye geri bırakılmış
        } else if (p.where === 'cabin' && (p.slot === 0 || p.slot === 1) && this.cabin.slots[p.slot] === null) {
          Object.assign(o, { where: 'cabin', slot: p.slot });
          [o.x, o.z] = D.elevator.slots[p.slot];
          this.cabin.slots[p.slot] = p.id;
        } else if (num(p.x, D.hall.minX, D.hall.maxX) && num(p.z, D.hall.minZ, D.hall.maxZ)) {
          Object.assign(o, { x: p.x, z: p.z, yaw: num(p.yaw, -10, 10) ? p.yaw : 0 });
        } else {
          [o.x, o.z] = [D.spawn[0] + 3, D.spawn[1]];
        }
        this.pallets.set(o.id, o);
      }
    }
    if (s.cabinMoving) this.cabin.phase = 'moving';
    this.cabin.until = now + 500; // açılışta kabindekiler hemen depoya çıkar (gönderildiyse)
    if (Array.isArray(s.queue)) {
      for (const q of s.queue.slice(0, 6)) {
        const items = this.cleanItems(q?.items);
        if (items) this.queue.push({ items, supplier: typeof q.supplier === 'string' ? q.supplier.slice(0, 40) : SUPPLIERS.mixed, by: typeof q.by === 'string' ? q.by.slice(0, 24) : '', npc: q.npc !== false });
      }
    }
    if (Array.isArray(s.orders)) {
      for (const o of s.orders.slice(0, R.MAX_ORDERS)) {
        const items = this.cleanItems(o?.items);
        if (!items) continue;
        this.orders.push({ id: this.orderSeq++, items, eta: now + (num(o.left, 0, 600_000) ? o.left : R.ETA_MIN_MS), cost: num(o.cost, 0, 1e6) ? o.cost : 0, by: typeof o.by === 'string' ? o.by.slice(0, 24) : '' });
      }
    }
    if (Array.isArray(s.jacks)) {
      s.jacks.slice(0, this.jacks.length).forEach((j, i) => {
        if (j && num(j.x, D.hall.minX, D.hall.maxX) && num(j.z, D.bounds.minZ, D.hall.maxZ)) {
          Object.assign(this.jacks[i], { x: j.x, z: j.z, yaw: num(j.yaw, -10, 10) ? j.yaw : 0 });
        }
      });
    }
    if (s.auto && typeof s.auto === 'object') for (const t of CARGO_TYPE_IDS) this.auto[t] = s.auto[t] === true;
    if (s.offer && okType(s.offer.type) && num(s.offer.mul, 0.3, 1)) this.offer = { type: s.offer.type, mul: s.offer.mul };
    if (s.stats && typeof s.stats === 'object') {
      for (const k of Object.keys(this.stats)) if (num(s.stats[k], 0, 1e9)) this.stats[k] = s.stats[k];
    }
    if (Number.isInteger(s.seq) && s.seq > 0) this.seq = Math.max(s.seq, ...[...this.pallets.keys()].map((k) => k + 1), 1);
    else this.seq = Math.max(1, ...[...this.pallets.keys()].map((k) => k + 1));
  }

  /** { type: n } doğrula (tür başına 0..16); boşsa null */
  cleanItems(items) {
    if (!items || typeof items !== 'object') return null;
    const out = {};
    let total = 0;
    for (const t of CARGO_TYPE_IDS) {
      const n = items[t];
      if (n === undefined) continue;
      if (!Number.isInteger(n) || n < 0 || n > 16) return null;
      if (n) out[t] = n;
      total += n;
    }
    return total > 0 && total <= 16 ? out : null;
  }

  shiftTime(delta) {
    for (const b of this.bays) {
      if (!b.truck) continue;
      b.truck.at += delta;
      b.truck.lastFee += delta;
    }
    for (const o of this.orders) o.eta += delta;
    if (this.cabin.phase === 'moving') this.cabin.until += delta;
  }

  // ---- Paylaşılan durum ----------------------------------------------------------------

  serialize() {
    return {
      stock: { ...this.stock },
      bays: this.bays.map((b) => (b.truck ? { id: b.truck.id, phase: b.truck.phase, at: b.truck.at, supplier: b.truck.supplier, npc: b.truck.npc } : null)),
      pallets: [...this.pallets.values()].map((p) => ({
        id: p.id, type: p.type, cond: r3(p.cond), where: p.where, x: r2(p.x), z: r2(p.z), yaw: r3(p.yaw), by: p.by ?? 0, rel: p.rel, bay: p.bay, slot: p.slot,
      })),
      jacks: this.jacks.map((j) => ({ by: j.by ?? 0, x: r2(j.x), z: r2(j.z), yaw: r3(j.yaw), carry: j.carry ?? 0 })),
      cabin: { phase: this.cabin.phase, until: this.cabin.until, slots: this.cabin.slots.slice() },
      orders: this.orders.map((o) => ({ id: o.id, items: o.items, eta: o.eta, by: o.by })),
      queue: this.queue.length,
      auto: { ...this.auto },
      offer: this.offer,
      stats: { ...this.stats },
    };
  }

  changed() {
    this.sim.out(EVT.CARGO_STATE, this.serialize());
  }

  // ---- Stok kancaları (restoran, bar, Eğlence Katı, temizlikçiler) -------------------------

  /** Bu türde en az bir birim stok var mı */
  has(type) {
    return (this.stock[type] ?? 0) >= 1;
  }

  /** Bir birim stok harca. @returns {boolean} harcandı mı (yoksa etki uygulanmaz) */
  use(type) {
    if (!this.has(type)) return false;
    this.stock[type] -= 1;
    this.stockDirty = true;
    return true;
  }

  /** Gün başı: bozulma / günlük tüketim + toptancı fırsatı */
  onNewDay() {
    for (const t of CARGO_TYPE_IDS) {
      const s = this.stock[t];
      if (s > 0) this.stock[t] = Math.max(0, s - Math.max(1, Math.ceil(s * R.DECAY[t])));
    }
    this.offer = null;
    if (this.sim.config.cargoSuppliers !== false && this.rng() < R.OFFER_CHANCE) {
      const type = CARGO_TYPE_IDS[Math.floor(this.rng() * CARGO_TYPE_IDS.length)];
      this.offer = { type, mul: R.OFFER_MUL };
      const T = TYPES[type];
      this.sim.notify(`📦 Toptancı fırsatı: bugün ${T.icon} ${T.name} %${Math.round((1 - R.OFFER_MUL) * 100)} indirimli (PC → 🚚 Mal Kabul).`, 'info');
    }
    this.changed();
  }

  // ---- Teslimat ------------------------------------------------------------------------

  /**
   * Tır sistemi (oyuncunun tırı) ya da sipariş: paletler boş bir rampadaki dorseye yerleşir.
   * @param {{ by?: string|object, items: Array<{ type: string, count: number }>, source?: string }} d
   *   by: teslim eden (oyuncu adı ya da oyuncu nesnesi), source: kaynak etiketi ('truck', 'order', …)
   * @returns {{ ok: true, bay: number, pallets: number, queued?: boolean } | { ok: false, error: string }}
   */
  deliver({ by, items, source } = {}) {
    if (!Array.isArray(items) || !items.length || items.length > 8) return { ok: false, error: 'Geçersiz yük.' };
    const counts = {};
    let total = 0;
    for (const it of items) {
      const t = typeof it?.type === 'string' && TYPES[it.type] ? it.type : null;
      if (!t || !Number.isInteger(it.count) || it.count < 1 || it.count > R.MAX_DELIVERY) return { ok: false, error: 'Geçersiz yük.' };
      counts[t] = (counts[t] ?? 0) + it.count;
      total += it.count;
    }
    if (total > R.MAX_DELIVERY) return { ok: false, error: `Bir teslimatta en fazla ${R.MAX_DELIVERY} palet.` };
    const name = typeof by === 'string' ? by.slice(0, 24) : typeof by?.name === 'string' ? by.name : '';
    const npc = source === 'order' || source === 'auto';
    const supplier = npc ? this.supplierFor(counts) : `${name || 'Otel'} tırı`;
    // 16 paletlik dorselere böl
    const loads = [];
    let cur = {};
    let n = 0;
    for (const t of CARGO_TYPE_IDS) {
      for (let k = 0; k < (counts[t] ?? 0); k++) {
        if (n === 16) { loads.push(cur); cur = {}; n = 0; }
        cur[t] = (cur[t] ?? 0) + 1;
        n++;
      }
    }
    loads.push(cur);
    let first = null;
    let queued = false;
    for (const load of loads) {
      const bay = this.freeBay(npc ? 1 : 0);
      if (bay < 0) {
        this.queue.push({ items: load, supplier, by: name, npc });
        queued = true;
        continue;
      }
      this.dock(bay, load, { supplier, by: name, npc });
      if (first === null) first = bay;
    }
    this.changed();
    this.sim.house?.scheduleSave?.();
    // handled: paletler (transpaletle) stoğa işlenir; tır sistemi yükün değerini kasaya ayrıca yazmaz
    return { ok: true, handled: true, bay: first ?? -1, pallets: total, ...(queued ? { queued: true } : {}) };
  }

  supplierFor(counts) {
    const types = Object.keys(counts);
    return types.length === 1 ? SUPPLIERS[types[0]] : SUPPLIERS.mixed;
  }

  /** Boş rampa (tercih edilen önce); yoksa −1 */
  freeBay(prefer = 0) {
    const order = prefer === 1 ? [1, 0] : [0, 1];
    for (const i of order) if (!this.bays[i].truck && !this.palletsIn(i)) return i;
    return -1;
  }

  palletsIn(bay) {
    let n = 0;
    for (const p of this.pallets.values()) if (p.where === 'trailer' && p.bay === bay) n++;
    return n;
  }

  /** Tır rampaya gelir (yanaşma animasyonu), paletler dorsede */
  dock(bay, load, { supplier, by, npc }) {
    const now = this.sim.now();
    const b = this.bays[bay];
    b.truck = { id: this.truckSeq++, phase: 'arriving', at: now, supplier, npc, fees: 0, lastFee: now, by };
    let slot = 0;
    for (const t of CARGO_TYPE_IDS) {
      for (let k = 0; k < (load[t] ?? 0); k++) {
        const [x, z] = D.bays[bay].slots[slot];
        const id = this.seq++;
        this.pallets.set(id, { id, type: t, cond: 1, where: 'trailer', bay, slot, x, z, yaw: 0, by: null, rel: 0 });
        slot++;
      }
    }
    const list = CARGO_TYPE_IDS.filter((t) => load[t]).map((t) => `${load[t]} ${TYPES[t].icon}`).join(' + ');
    this.sim.notify(`🚚 ${supplier} avluya giriyor → ${D.bays[bay].name} (${list}). Transpaletle indir, yük asansörüne taşı!`, 'info');
  }

  // ---- Oyuncu eylemleri ----------------------------------------------------------------

  initPlayer(p) {
    p.cargo = { jack: -1, lastBump: 0 };
  }

  removePlayer(p) {
    if (this.releaseJack(p)) this.changed();
  }

  /** Oyuncu transpaletten iner (taşıdığı palet çatal ortasına bırakılır) */
  releaseJack(p, { x = p.x, z = p.z, yaw = p.yaw } = {}) {
    const j = this.jacks[p.cargo?.jack ?? -1];
    if (!j || j.by !== p.id) return false;
    if (j.carry) {
      const pal = this.pallets.get(j.carry);
      if (pal) {
        let [cx, cz] = forkCenter(x, z, yaw);
        if (!this.canPlace(cx, cz)) [cx, cz] = [x, z];
        Object.assign(pal, { where: 'floor', x: cx, z: cz, yaw: yaw + pal.rel, by: null, bay: -1, slot: -1 });
      }
      j.carry = null;
    }
    const inArea = isInsideCargoArea(x, z) && (isInsideHall(x, z, 0.3) || trailerAt(x, z) >= 0);
    if (inArea) Object.assign(j, { x, z, yaw });
    j.by = null;
    p.cargo.jack = -1;
    return true;
  }

  /** Palet buraya bırakılabilir mi: salon (kabin dışı) ya da yanaşmış dorsenin içi */
  canPlace(x, z) {
    if (isInsideCabin(x, z)) return false;
    if (isInsideHall(x, z, 0.45)) return true;
    const bay = trailerAt(x, z);
    return bay >= 0 && this.bays[bay].truck?.phase === 'docked';
  }

  act(p, data, now) {
    const act = typeof data?.act === 'string' ? data.act : '';
    if (p.sleeping) return { ok: false, error: 'Uyurken olmaz.' };
    switch (act) {
      case 'gate': return this.gate(p, now);
      case 'take': return this.take(p, int(data.j));
      case 'park': return this.park(p);
      case 'lift': return this.lift(p, int(data.id));
      case 'drop': return this.drop(p);
      case 'bump': return this.bump(p, data.speed, now);
      case 'send': return this.send(p, now);
      case 'order': return this.order(p, data, now);
      case 'auto': return this.setAuto(p, data);
      default: return { ok: false, error: 'Geçersiz işlem.' };
    }
  }

  /** Achterstraat'ın batı ucundaki servis kapısı ↔ mal kabul salonunun kapısı */
  gate(p, now) {
    if (p.vehicle) return { ok: false, error: 'Önce araçtan in.' };
    if (p.cargo.jack >= 0) return { ok: false, error: 'Önce transpaletten in (Q).' };
    const tol = D.range + 1;
    let dest;
    if (near(p, D.cityGate.point, tol)) dest = D.door;
    else if (near(p, D.door.point, tol)) dest = D.cityGate;
    else return { ok: false, error: 'Kapının önünde olmalısın.' };
    p.x = dest.spawn[0];
    p.z = dest.spawn[1];
    p.yaw = dest.yaw;
    p.xfer = { t: now, x: p.x, z: p.z }; // ışınlanmadan önceki konumdan gecikmiş paketler yok sayılır (GarageService)
    this.sim.dirtyPlayers.add(p.id);
    return { ok: true, x: p.x, z: p.z, yaw: p.yaw, dock: dest === D.door };
  }

  take(p, j) {
    const jack = this.jacks[j];
    if (!jack) return { ok: false, error: 'Böyle bir transpalet yok.' };
    if (p.vehicle) return { ok: false, error: 'Önce araçtan in.' };
    if (p.cargo.jack >= 0) return { ok: false, error: 'Zaten bir transpaletin var.' };
    if (jack.by && jack.by !== p.id) {
      const who = this.sim.players.get(jack.by)?.name ?? 'Biri';
      return { ok: false, error: `${who} bu transpaleti kullanıyor.` };
    }
    if (!near(p, [jack.x, jack.z], R.REACH + 1)) return { ok: false, error: 'Transpaletin yanına git.' };
    jack.by = p.id;
    p.cargo.jack = j;
    this.changed();
    return { ok: true, x: jack.x, z: jack.z, yaw: jack.yaw, carry: jack.carry ?? 0 };
  }

  myJack(p) {
    const j = this.jacks[p.cargo?.jack ?? -1];
    return j && j.by === p.id ? j : null;
  }

  park(p) {
    const j = this.myJack(p);
    if (!j) return { ok: false, error: 'Transpaletin yok.' };
    if (j.carry) return { ok: false, error: 'Önce paleti indir (E).' };
    if (!isInsideHall(p.x, p.z, 0.3) && trailerAt(p.x, p.z) < 0) return { ok: false, error: 'Transpaleti salona ya da dorseye bırak.' };
    this.releaseJack(p);
    this.changed();
    return { ok: true };
  }

  lift(p, id) {
    const j = this.myJack(p);
    if (!j) return { ok: false, error: 'Önce bir transpalet al.' };
    if (j.carry) return { ok: false, error: 'Çatallar dolu.' };
    const pal = this.pallets.get(id);
    if (!pal || (pal.where !== 'trailer' && pal.where !== 'floor')) return { ok: false, error: 'Bu palet alınamaz.' };
    if (pal.where === 'trailer' && this.bays[pal.bay]?.truck?.phase !== 'docked') return { ok: false, error: 'Tır henüz yanaşmadı.' };
    const [cx, cz] = forkCenter(p.x, p.z, p.yaw);
    if (Math.hypot(cx - pal.x, cz - pal.z) > R.LIFT_TOL) return { ok: false, error: 'Çatallar paletin altında değil — tam ortala.' };
    if (palletAngleDiff(pal.yaw, p.yaw) > R.LIFT_ANGLE) return { ok: false, error: 'Paletle aynı hizaya gel (düz gir).' };
    const bay = pal.bay;
    Object.assign(pal, { where: 'jack', by: p.id, rel: snapRel(pal.yaw, p.yaw), bay: -1, slot: -1 });
    j.carry = id;
    if (bay >= 0) this.afterUnload(bay);
    this.changed();
    return { ok: true, id };
  }

  /** Dorse boşaldıysa tır ayrılır */
  afterUnload(bay) {
    const t = this.bays[bay].truck;
    if (t && t.phase === 'docked' && !this.palletsIn(bay)) {
      t.phase = 'leaving';
      t.at = this.sim.now();
      this.sim.notify(`🚚 ${D.bays[bay].name} boşaldı — ${t.supplier} avludan ayrılıyor. Teşekkürler!`, 'info');
    }
  }

  drop(p) {
    const j = this.myJack(p);
    if (!j?.carry) return { ok: false, error: 'Çatallar boş.' };
    const pal = this.pallets.get(j.carry);
    if (!pal) {
      j.carry = null;
      return { ok: false, error: 'Palet yok.' };
    }
    const [cx, cz] = forkCenter(p.x, p.z, p.yaw);
    // Yük asansörü kabini: en yakın boş yer
    const E = D.elevator;
    let best = -1;
    let bd = R.CABIN_TOL;
    if (this.cabin.phase === 'open') {
      E.slots.forEach(([sx, sz], k) => {
        if (this.cabin.slots[k] !== null) return;
        const d = Math.hypot(cx - sx, cz - sz);
        if (d < bd) { bd = d; best = k; }
      });
    }
    if (best >= 0) {
      const [sx, sz] = E.slots[best];
      Object.assign(pal, { where: 'cabin', slot: best, x: sx, z: sz, yaw: 0, by: null, bay: -1 });
      this.cabin.slots[best] = pal.id;
      j.carry = null;
      this.changed();
      const full = this.cabin.slots.every((s) => s !== null);
      return { ok: true, where: 'cabin', slot: best, full };
    }
    if (isInsideCabin(cx, cz) && this.cabin.phase !== 'open') return { ok: false, error: 'Asansör yolda — kapılar kapalı.' };
    if (!this.canPlace(cx, cz)) return { ok: false, error: 'Paleti buraya indiremezsin.' };
    // Dorseye geri bırakılan palet: o dorsenin yükü sayılır (tır beklemeye devam eder)
    const bay = trailerAt(cx, cz);
    Object.assign(pal, { where: 'floor', x: r2(cx), z: r2(cz), yaw: r3(p.yaw + pal.rel), by: null, bay: -1, slot: -1 });
    if (bay >= 0) Object.assign(pal, { where: 'trailer', bay, slot: -1 });
    j.carry = null;
    this.changed();
    return { ok: true, where: pal.where };
  }

  /** İstemci: taşınan palet bir yere sertçe çarptı (hız m/sn) */
  bump(p, speed, now) {
    const j = this.myJack(p);
    if (!j?.carry) return { ok: false };
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0 || speed > 4) return { ok: false, error: 'Geçersiz.' };
    if (speed < R.BUMP_MIN) return { ok: true, damage: 0 };
    if (now - p.cargo.lastBump < R.BUMP_COOLDOWN_MS) return { ok: true, damage: 0 };
    p.cargo.lastBump = now;
    const pal = this.pallets.get(j.carry);
    if (!pal) return { ok: false };
    const before = pal.cond;
    const dmg = Math.min(0.3, 0.12 + (speed - R.BUMP_MIN) * 0.15);
    pal.cond = Math.max(R.MIN_COND, r3(pal.cond - dmg));
    if (before === 1) this.stats.damaged++;
    this.changed();
    return { ok: true, damage: r3(before - pal.cond), cond: pal.cond };
  }

  /** Yük asansörünü gönder (kabinde en az 1 palet) */
  send(p, now) {
    const P = D.elevator.panel;
    if (!near(p, P.point, P.range + 1.5)) return { ok: false, error: 'Asansör kolonunun yanına git.' };
    if (this.cabin.phase !== 'open') return { ok: false, error: 'Asansör zaten yolda.' };
    const n = this.cabin.slots.filter((s) => s !== null).length;
    if (!n) return { ok: false, error: 'Kabin boş — önce palet yükle.' };
    this.cabin.phase = 'moving';
    this.cabin.until = now + R.ELEV_MS;
    this.cabin.by = p.name;
    this.changed();
    return { ok: true, until: this.cabin.until };
  }

  /** Kabindeki paletler depoya: stok artar */
  unloadCabin(by = '') {
    const gained = {};
    for (let k = 0; k < this.cabin.slots.length; k++) {
      const id = this.cabin.slots[k];
      if (id === null) continue;
      const pal = this.pallets.get(id);
      this.cabin.slots[k] = null;
      if (!pal) continue;
      this.pallets.delete(id);
      const units = palletUnits(pal.cond);
      const add = Math.min(units, R.STOCK_MAX - this.stock[pal.type]);
      this.stock[pal.type] += Math.max(0, add);
      gained[pal.type] = (gained[pal.type] ?? 0) + units;
      this.stats.pallets++;
      this.stats.units += units;
    }
    this.cabin.phase = 'open';
    this.cabin.until = 0;
    const list = Object.keys(gained).map((t) => `+${gained[t]} ${TYPES[t].icon} ${TYPES[t].short}`).join(', ');
    if (list) this.sim.notify(`🛗 Yük asansörü depoya çıktı${by ? ` (${by})` : ''}: ${list}.`, 'money');
    this.sim.house?.scheduleSave?.();
  }

  /** Toptancı siparişi (PC ya da rampadaki ofis terminali): bedel + nakliye kasadan */
  order(p, data, now) {
    const via = typeof data.via === 'string' && VIAS[data.via] ? data.via : null;
    if (!via) return { ok: false, error: 'Geçersiz işlem.' };
    if (via === 'pc' && !this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    if (via === 'dock' && !near(p, D.office.point, D.office.range + 1)) return { ok: false, error: 'Ofis terminalinin başında olmalısın.' };
    const items = this.cleanItems(data.items);
    if (!items) return { ok: false, error: 'Sipariş boş ya da geçersiz.' };
    for (const t of Object.keys(items)) if (items[t] > R.MAX_PER_TYPE) return { ok: false, error: `Tür başına en fazla ${R.MAX_PER_TYPE} palet.` };
    return this.placeOrder(items, p.name, now);
  }

  quote(items) {
    let cost = R.DELIVERY_FEE;
    for (const t of Object.keys(items)) {
      const mul = this.offer?.type === t ? this.offer.mul : 1;
      cost += Math.round(TYPES[t].price * mul) * items[t];
    }
    return cost;
  }

  placeOrder(items, byName, now, { auto = false } = {}) {
    if (this.orders.length >= R.MAX_ORDERS) return { ok: false, error: `Aynı anda en fazla ${R.MAX_ORDERS} sipariş yolda olabilir.` };
    const cost = this.quote(items);
    if (this.sim.money < cost) return { ok: false, error: `Kasada yeterli para yok (€${cost}).` };
    const eta = now + R.ETA_MIN_MS + Math.floor(this.rng() * (R.ETA_MAX_MS - R.ETA_MIN_MS));
    const id = this.orderSeq++;
    this.orders.push({ id, items, eta, cost, by: byName, auto });
    const list = Object.keys(items).map((t) => `${items[t]} ${TYPES[t].icon}`).join(' + ');
    this.sim.spend(cost, `🚚 Toptan sipariş${auto ? ' (otomatik)' : ''}: ${list} (${byName})`);
    this.stats.orders++;
    this.stats.spent += cost;
    this.changed();
    return { ok: true, id, cost, eta };
  }

  setAuto(p, data) {
    const type = typeof data.type === 'string' && TYPES[data.type] ? data.type : null;
    if (!type || typeof data.on !== 'boolean') return { ok: false, error: 'Geçersiz işlem.' };
    const via = typeof data.via === 'string' && VIAS[data.via] ? data.via : null;
    if (via === 'pc' && !this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    if (via === 'dock' && !near(p, D.office.point, D.office.range + 1)) return { ok: false, error: 'Ofis terminalinin başında olmalısın.' };
    if (!via) return { ok: false, error: 'Geçersiz işlem.' };
    this.auto[type] = data.on;
    this.changed();
    return { ok: true };
  }

  // ---- Döngü -----------------------------------------------------------------------------

  update(now) {
    let changed = false;
    // Siparişler: vakti gelen tır avluya girer (rampa doluysa bekler)
    for (const o of [...this.orders]) {
      if (now < o.eta) continue;
      if (this.freeBay(1) < 0) continue;
      this.orders.splice(this.orders.indexOf(o), 1);
      this.deliver({ by: o.by, items: Object.keys(o.items).map((type) => ({ type, count: o.items[type] })), source: o.auto ? 'auto' : 'order' });
      changed = true;
    }
    // Sıradaki teslimatlar boşalan rampaya
    while (this.queue.length) {
      const q = this.queue[0];
      const bay = this.freeBay(q.npc ? 1 : 0);
      if (bay < 0) break;
      this.queue.shift();
      this.dock(bay, q.items, q);
      changed = true;
    }
    // Tırlar: yanaşma / bekleme ücreti / ayrılma
    this.bays.forEach((b, i) => {
      const t = b.truck;
      if (!t) return;
      if (t.phase === 'arriving' && now - t.at >= R.ARRIVE_MS) {
        t.phase = 'docked';
        t.at = now;
        t.lastFee = now;
        changed = true;
        if (!this.palletsIn(i)) this.afterUnload(i);
      } else if (t.phase === 'docked' && t.npc && this.palletsIn(i)) {
        const due = t.fees === 0 ? t.at + R.WAIT_MS : t.lastFee + R.FEE_EVERY_MS;
        if (now >= due) {
          t.lastFee = now;
          if (t.fees < R.MAX_FEES) {
            t.fees++;
            this.sim.spend(R.WAIT_FEE, `⏳ ${t.supplier}: dorse bekletme ücreti`);
            this.sim.notify(`⏳ ${t.supplier} şoförü ${D.bays[i].name}'de bekliyor — bekletme ücreti €${R.WAIT_FEE} kasadan. Paletleri indirin!`, 'warn');
          } else {
            this.dumpTrailer(i);
            this.sim.notify(`😤 ${t.supplier} şoförü beklemekten sıkıldı: kalan paletleri rampaya indirip gitti.`, 'warn');
          }
          changed = true;
        }
      } else if (t.phase === 'leaving' && now - t.at >= R.LEAVE_MS) {
        b.truck = null;
        changed = true;
      }
    });
    // Yük asansörü
    if (this.cabin.phase === 'moving' && now >= this.cabin.until) {
      this.unloadCabin(this.cabin.by ?? '');
      changed = true;
    }
    // Avludan çıkan transpalet sürücüsü transpaleti bırakır
    for (const j of this.jacks) {
      if (!j.by) continue;
      const p = this.sim.players.get(j.by);
      if (!p) {
        j.by = null;
        changed = true;
        continue;
      }
      if (!isInsideCargoArea(p.x, p.z, 1)) {
        this.releaseJack(p, { x: j.x, z: j.z, yaw: j.yaw });
        changed = true;
      } else {
        j.x = p.x;
        j.z = p.z;
        j.yaw = p.yaw;
      }
    }
    // Otomatik sipariş (stok azalınca 2 palet)
    if (this.sim.config.cargoSuppliers !== false) {
      for (const t of CARGO_TYPE_IDS) {
        if (!this.auto[t] || this.stock[t] >= R.AUTO_BELOW) continue;
        if (this.orders.some((o) => o.items[t]) || this.incoming(t)) continue;
        const res = this.placeOrder({ [t]: R.AUTO_PALLETS }, 'Otomatik', now, { auto: true });
        if (res.ok) changed = true;
      }
    }
    if (this.stockDirty) {
      this.stockDirty = false;
      changed = true;
    }
    if (changed) this.changed();
  }

  /** Bu türden yolda / avluda palet var mı (otomatik sipariş tekrarlanmasın) */
  incoming(type) {
    for (const p of this.pallets.values()) if (p.type === type) return true;
    return this.queue.some((q) => q.items[type]);
  }

  /** Şoför kalan paletleri rampaya (salonun güney kenarı) indirir ve gider */
  dumpTrailer(bay) {
    const b = D.bays[bay];
    let k = 0;
    for (const p of this.pallets.values()) {
      if (p.where !== 'trailer' || p.bay !== bay) continue;
      const col = k % 4;
      const row = Math.floor(k / 4);
      Object.assign(p, { where: 'floor', bay: -1, slot: -1, x: r2(b.x - 2.4 + col * 1.6), z: r2(D.dockZ + 1.3 + row * 1.5), yaw: 0 });
      k++;
    }
    const t = this.bays[bay].truck;
    if (t) {
      t.phase = 'leaving';
      t.at = this.sim.now();
    }
  }
}

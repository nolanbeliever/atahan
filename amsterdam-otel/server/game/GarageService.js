import { EVT } from '../../shared/constants.js';
import {
  CAR_BY_ID, CAR_RULES as R, GARAGE_LAYOUT, CAR_XFER_BY_ID, inXferZone, carZone, carSpeedCap, carExitSpots, bigArea,
  TRUCK_RULES, isTruck, canParkTruck,
} from '../../shared/cars.js';
import { SERVICE_YARD, yardAt, inHighwayRegion, constrainToRoads } from '../../shared/worldmap.js';

const HASH_RE = /^[0-9a-f]{64}$/;
const CAR_ID_RE = /^k\d{1,6}$/;
const MAX_SAVED = 2000;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (typeof v === 'number' ? v : NaN);
// Teslimat: garaj doluysa otelin önündeki sokağa (rampanın doğusu, büfeden uzak)
const STREET_SPOTS = Object.freeze([
  Object.freeze({ x: 2.6, z: -4.4, yaw: -Math.PI / 2 }),
  Object.freeze({ x: 8.2, z: -4.4, yaw: -Math.PI / 2 }),
]);

/**
 * Yeraltı garajı + AutoGalerie (sunucu yetkili).
 *  - Arabalar VehicleService'in araç haritasında `type: 'car'` olarak yaşar: binme, inme, yolcu
 *    (ön sağ koltuk) ve sürücüyle birlikte taşınma oradaki ortak mekanizmayla çalışır. Bu servis
 *    arabaya özgü kuralları ekler: satın alma, garaj park yerleri, kalıcılık, ışınlanan geçitler
 *    (sokak rampası, drag pisti tüneli, asansör) ve hız denetimi.
 *  - Satın alma telefondan (AutoGalerie uygulaması) ya da garajdaki terminalden; ödeme kişisel
 *    cüzdandan ya da otel kasasından (alıcı seçer). Oyuncu başına en fazla CAR_RULES.MAX_PER_PLAYER.
 *    Yeni araba ilk boş numaralı park yerine (P-01…P-34) bırakılır; garaj doluysa otelin önüne.
 *  - Kalıcılık: anahtar özeti → [{ id, m, c, x, z, yaw }] (hotelState().garage). Bozuk kayıtlar
 *    tek tek atılır; konumu geçersizse araba boş bir park yerinde belirir.
 *  - Hız denetimi (filterMove): araba sürücüsünün konumu yalnızca garaj / sokak / drag alanında
 *    olabilir; yol, bulunduğu yerin hız sınırı × 1.15 + 1.5 m/sn ile jeton kovasından düşülür
 *    (en fazla 0.8 sn birikir) — fazlası kırpılır. Işınlanmadan hemen sonra eski konumdan gelen
 *    gecikmiş paketler yok sayılır.
 *  - Tırlar (TRUCK_MODELS, gövde 'truck') da araba kaydıdır ama yalnızca cüzdandan alınır, lojistik
 *    avlusunun tır parkına (T-1…T-4) teslim edilir, yalnızca avlu / depo / limanda park eder ve şehre
 *    (tünelden) giremez. Otoyolda arabalar da sürülebilir; otoyolun ortasına park edilmez.
 *  - Zamanlayıcı yok; her şey olay güdümlü.
 */
export class GarageService {
  constructor(sim) {
    this.sim = sim;
    this.saved = new Map(); // keyHash → kayıt dizisi [{ id, m, c, x, z, yaw }]
  }

  get vehicles() { return this.sim.vehicles; }

  // ---- Kalıcılık ---------------------------------------------------------------------

  restore(data) {
    const cars = data && typeof data === 'object' && !Array.isArray(data) ? data.cars : null;
    if (!cars || typeof cars !== 'object' || Array.isArray(cars)) return;
    for (const [hash, list] of Object.entries(cars)) {
      if (this.saved.size >= MAX_SAVED) break;
      if (!HASH_RE.test(hash) || !Array.isArray(list)) continue;
      const out = [];
      for (const raw of list) {
        if (out.length >= R.MAX_PER_PLAYER) break;
        const rec = this.cleanRecord(raw, out);
        if (rec) out.push(rec);
      }
      if (out.length) this.saved.set(hash, out);
    }
  }

  /** Tek kayıt: bilinmeyen model / renk → atılır; konum geçersizse null (park yeri atanır) */
  cleanRecord(raw, siblings) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const def = typeof raw.m === 'string' ? CAR_BY_ID[raw.m] : undefined;
    if (!def) return null;
    const c = raw.c;
    if (!Number.isInteger(c) || c < 0 || c >= def.colors.length) return null;
    let id = typeof raw.id === 'string' && CAR_ID_RE.test(raw.id) ? raw.id : null;
    if (!id || siblings.some((s) => s.id === id)) id = this.newId(siblings);
    const x = num(raw.x);
    const z = num(raw.z);
    const yaw = num(raw.yaw);
    const ok = Number.isFinite(x) && Number.isFinite(z) && this.canPark(x, z, { model: def.id });
    return { id, m: def.id, c, x: ok ? r2(x) : null, z: ok ? r2(z) : null, yaw: ok && Number.isFinite(yaw) ? r2(yaw) : 0 };
  }

  newId(list) {
    let n = list.length + 1;
    while (list.some((s) => s.id === `k${n}`)) n++;
    return `k${n}`;
  }

  persisted() {
    // Çevrimiçi sahiplerin arabalarının güncel yeri
    for (const v of this.vehicles.vehicles.values()) if (v.type === 'car') this.park(v);
    const cars = {};
    for (const [h, list] of this.saved) cars[h] = list.map((r) => ({ ...r }));
    return { cars };
  }

  save() { this.sim.house.scheduleSave(); }

  /** Arabanın son yeri kaydına yazılır (VehicleService: inişte, oyuncu ayrılırken) */
  park(v) {
    if (v.type !== 'car' || !v.rec) return;
    v.rec.x = v.x;
    v.rec.z = v.z;
    v.rec.yaw = v.yaw;
  }

  // ---- Oyuncular -------------------------------------------------------------------------

  /** Katılınca: kayıtlı arabalar son yerlerinde (çakışırsa boş park yerinde) belirir. @returns {boolean} araba var mı */
  initPlayer(p) {
    p.carGuard = null; // hız denetimi jeton kovası
    p.xfer = null; // son ışınlanma { t, x, z }
    p.carRecs = p.keyHash ? this.saved.get(p.keyHash) ?? [] : [];
    for (const rec of p.carRecs) this.spawnCar(p, rec);
    return p.carRecs.length > 0;
  }

  carsOf(p) { return p.carRecs ?? []; }

  spawnCar(p, rec) {
    let pos = rec.x !== null && rec.x !== undefined ? { x: rec.x, z: rec.z, yaw: rec.yaw } : null;
    if (!pos || this.occupied(pos.x, pos.z, 2.2)) pos = this.deliverySpot(rec.m);
    Object.assign(rec, { x: pos.x, z: pos.z, yaw: pos.yaw });
    const v = this.vehicles.spawn(p, 'car', pos);
    v.model = rec.m;
    v.color = rec.c;
    v.rec = rec;
    return v;
  }

  /** Bu noktada (yarıçap r) park etmiş ya da sürülen bir araç var mı */
  occupied(x, z, r) {
    for (const v of this.vehicles.vehicles.values()) {
      if (Math.hypot(v.x - x, v.z - z) < r) return true;
    }
    return false;
  }

  /** İlk boş numaralı park yeri; garaj doluysa otelin önü. Tır: avludaki tır parkı */
  deliverySpot(model = null) {
    if (model && isTruck(model)) {
      for (const b of SERVICE_YARD.truckBays) if (!this.occupied(b.x, b.z, 4)) return { x: b.x, z: b.z, yaw: b.yaw, bay: b.label };
      const b = SERVICE_YARD.truckBays[0];
      return { x: b.x, z: b.z + 10, yaw: b.yaw, bay: null };
    }
    for (const b of GARAGE_LAYOUT.bays) {
      if (!this.occupied(b.x, b.z, 1.6)) return { x: b.x, z: b.z, yaw: b.yaw, bay: b.label };
    }
    for (const s of STREET_SPOTS) if (!this.occupied(s.x, s.z, 2.5)) return { ...s, bay: null };
    return { ...STREET_SPOTS[0], bay: null };
  }

  /**
   * Arabalar garajda, sokakta, drag alanında ve otoyol bölgesinin avlu / depolarında park eder (yolun
   * ortasında değil). Tır yalnızca avlu / depo / limanda.
   */
  canPark(x, z, v = null) {
    if (v && isTruck(v.model)) return canParkTruck(x, z);
    const zone = carZone(x, z);
    if (zone === 'highway') return yardAt(x, z) !== null;
    return zone !== null;
  }

  /** Arabadan inen sürücünün yeri (sol kapı → sağ kapı → merkez) */
  exitSpot(v) {
    const body = CAR_BY_ID[v.model]?.body;
    for (const s of carExitSpots(v.x, v.z, v.yaw, body)) if (carZone(s.x, s.z) !== null || yardAt(s.x, s.z) !== null) return s;
    return { x: v.x, z: v.z };
  }

  // ---- Eylemler -----------------------------------------------------------------------------

  /** @returns {{ ok: true, ... } | { ok: false, error }} */
  act(p, data) {
    const act = typeof data?.act === 'string' ? data.act : '';
    if (act === 'buy') return this.buy(p, data);
    if (act === 'xfer') return this.xfer(p, data.id);
    return { ok: false, error: 'Geçersiz işlem.' };
  }

  buy(p, data) {
    const def = typeof data.model === 'string' ? CAR_BY_ID[data.model] : undefined;
    if (!def) return { ok: false, error: 'Böyle bir model yok.' };
    const color = data.color;
    if (!Number.isInteger(color) || color < 0 || color >= def.colors.length) return { ok: false, error: 'Geçersiz renk.' };
    const source = data.source;
    if (source !== 'wallet' && source !== 'kasa') return { ok: false, error: 'Ödeme kaynağını seç (cüzdan ya da kasa).' };
    const list = this.carsOf(p);
    if (list.length >= R.MAX_PER_PLAYER) return { ok: false, error: `En fazla ${R.MAX_PER_PLAYER} araban olabilir — garaj dolu.` };
    const truck = isTruck(def);
    if (truck) {
      if (source !== 'wallet') return { ok: false, error: 'Tır yalnızca kişisel cüzdandan alınır.' };
      if (list.filter((r) => isTruck(r.m)).length >= TRUCK_RULES.MAX_PER_PLAYER) return { ok: false, error: `En fazla ${TRUCK_RULES.MAX_PER_PLAYER} tırın olabilir.` };
    }
    const price = def.price;
    if (source === 'wallet') {
      if (!(p.wallet >= price)) return { ok: false, error: `Cüzdanında yeterli para yok (€${price.toLocaleString('nl-NL')} gerekli).` };
      p.wallet -= price;
      this.sim.shop.sendSelf(p);
    } else {
      if (!(this.sim.money >= price)) return { ok: false, error: `Otel kasasında yeterli para yok (€${price.toLocaleString('nl-NL')} gerekli).` };
      this.sim.spend(price, `🚗 ${def.name} (${p.name})`);
    }
    const rec = { id: this.newId(list), m: def.id, c: color, x: null, z: null, yaw: 0 };
    const spot = this.deliverySpot(def.id);
    Object.assign(rec, { x: spot.x, z: spot.z, yaw: spot.yaw });
    list.push(rec);
    if (p.keyHash) {
      // Son dokunulan sona (eski kayıtlar sınır aşılınca önden atılır)
      this.saved.delete(p.keyHash);
      this.saved.set(p.keyHash, list);
      if (this.saved.size > MAX_SAVED) this.saved.delete(this.saved.keys().next().value);
    }
    p.carRecs = list;
    const v = this.spawnCar(p, rec);
    this.save();
    this.vehicles.broadcast();
    return { ok: true, id: v.id, model: def.id, bay: spot.bay, x: v.x, z: v.z, truck };
  }

  /**
   * Geçitler: sokak rampası ↔ garaj, garaj tüneli ↔ drag pisti, garaj asansörü → lobi.
   * Arabayla geçilirse araba (ve ön koltuktaki yolcu) birlikte taşınır. Bisiklet / scooter geçemez.
   */
  xfer(p, id) {
    const t = typeof id === 'string' ? CAR_XFER_BY_ID[id] : undefined;
    if (!t) return { ok: false, error: 'Böyle bir geçit yok.' };
    const seat = p.vehicle;
    if (seat?.seat === 'passenger') return { ok: false, error: 'Yolcu koltuğundasın — sürücü götürür.' };
    const v = seat ? this.vehicles.vehicles.get(seat.id) : null;
    if (v && v.type !== 'car') return { ok: false, error: 'Bisiklet / scooter ile buradan geçilmez — önce park et.' };
    if (v && t.foot) return { ok: false, error: 'Asansöre arabayla binilmez — önce park et.' };
    if (v && isTruck(v.model) && t.area !== 'highway') return { ok: false, error: '🚛 Tır şehrin dar sokaklarına girmez — avluya park et, yürüyerek geç.' };
    if (!inXferZone(t, p.x, p.z, 1.5)) return { ok: false, error: 'Geçide yaklaş.' };
    const now = this.sim.now();
    if (p.xfer && now - p.xfer.t < 1000) return { ok: false, error: 'Biraz bekle.' };
    const from = bigArea(p.x, p.z);
    const { x, z, yaw } = t.to;
    p.x = x;
    p.z = z;
    p.yaw = yaw;
    p.xfer = { t: now, x, z };
    p.carGuard = null;
    this.sim.dirtyPlayers.add(p.id);
    if (v) {
      v.x = x;
      v.z = z;
      v.yaw = r2(yaw);
      if (v.passenger != null) {
        this.vehicles.carryPassenger(v);
        const q = this.sim.players.get(v.passenger);
        if (q) {
          q.xfer = { t: now, x: q.x, z: q.z };
          this.sim.toPlayer(q.id, EVT.NOTIFY, { text: `${t.icon} ${p.name} seni ${AREA_TEXT[t.area]} götürdü.`, kind: 'info' });
        }
      }
    }
    if (from === 'drag' && t.area !== 'drag') this.sim.drag?.onLeave(p);
    return { ok: true, x, z, yaw, area: t.area, car: !!v };
  }

  // ---- Hız denetimi ------------------------------------------------------------------------

  /**
   * HotelSimulation.movePlayer'dan, konum uygulanmadan önce.
   * @returns {[number, number] | null} uygulanacak konum (kırpılmış olabilir) ya da null → yok say
   */
  filterMove(p, x, z) {
    const now = this.sim.now();
    const xf = p.xfer;
    if (xf) {
      if (now - xf.t > R.XFER_GRACE_MS) p.xfer = null;
      else if (Math.hypot(x - xf.x, z - xf.z) > 12) return null; // ışınlanmadan önceki konumdan gecikmiş paket
    }
    const seat = p.vehicle;
    const v = seat?.seat === 'driver' ? this.vehicles.vehicles.get(seat.id) : null;
    if (!v || v.type !== 'car') {
      p.carGuard = null;
      return [x, z];
    }
    // Otoyol bölgesinde sürülebilir alanın biraz dışına taşan konum (kenar, körfez köşesi, istemci kısıt farkı)
    // reddedilmez, en yakın sürülebilir noktaya itilir: reddedilirse sunucu konumu donar, istemci sürmeye devam
    // eder ve "Yükle" ekranda görünse de sunucu tırı geride sanır.
    if (inHighwayRegion(x, z)) {
      const q = { x, z };
      constrainToRoads(q, 0);
      x = q.x;
      z = q.z;
    }
    if (carZone(x, z) === null) return null; // arabayla bina / steeg / Achterstraat yok
    const def = CAR_BY_ID[v.model];
    if (isTruck(def) && carZone(x, z) !== 'highway') return null; // tır yalnızca otoyol bölgesinde
    const cap = Math.max(carSpeedCap(def, p.x, p.z), carSpeedCap(def, x, z)) * R.SPEED_SLACK + R.SPEED_ADD;
    const max = cap * R.BURST_SEC;
    const g = p.carGuard ?? (p.carGuard = { t: now, budget: max });
    g.budget = Math.min(max, g.budget + (cap * Math.max(0, now - g.t)) / 1000);
    g.t = now;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= g.budget) {
      g.budget -= d;
      return [x, z];
    }
    // İzin verilenden hızlı: yalnızca izin verilen kadar ilerlet
    const k = g.budget / d;
    g.budget = 0;
    this.sim.valet?.onClip(p, v, d); // VIP aracında hız ihlali küçük hasar yazar
    const c = { x: r2(p.x + (x - p.x) * k), z: r2(p.z + (z - p.z) * k) };
    if (inHighwayRegion(c.x, c.z)) constrainToRoads(c, 0); // kırpılan ara nokta yol dışına düşmesin
    return carZone(c.x, c.z) !== null ? [c.x, c.z] : null;
  }
}

const AREA_TEXT = Object.freeze({ garage: 'garaja', street: 'sokağa', drag: 'drag pistine', city: 'lobiye', highway: 'otoyola' });

import { EVT } from '../../shared/constants.js';
import { CAR_BY_ID, isTruck, carSpeedCap } from '../../shared/cars.js';
import { SITE_BY_ID, HOTEL_DELIVERY, siteDistance } from '../../shared/worldmap.js';
import { CARGO_TYPES, CARGO_BY_ID, LOGI_RULES as R, offerTerms, deliveryPay, hitDamage } from '../../shared/logistics.js';

const int = (v) => (Number.isInteger(v) ? v : -1);
const r2 = (v) => Math.round(v * 100) / 100;
const inRect = (b, x, z, tol = 0) => x > b.minX - tol && x < b.maxX + tol && z > b.minZ - tol && z < b.maxZ + tol;

/** Lojistiğe özel tohumlu PRNG: simülasyonun ortak rng dizisine dokunmaz (RNG'ye duyarlı testler bozulmaz) */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FPV Lojistik Tırı — sevkiyat işleri (sunucu yetkili).
 *
 *  - Sözleşme panosu (Resepsiyon PC / telefon "🚛 Lojistik"): LOGI_RULES.OFFERS teklif; oyuncu birini alır
 *    (oyuncu başına tek iş). Teklifler lojistiğe özel PRNG ile üretilir (sim.rng'ye dokunmaz).
 *  - Yükleme: kendi tırını sürerken işin yükleme körfezinde (SITES[].load) durup E → toptan fiyat OTEL
 *    KASASINDAN düşer, tıra yüklü dorse takılır (v.trailer, VEHICLES listesinde yayınlanır).
 *  - Teslim: otelin lojistik avlusundaki mal kabul körfezinde (HOTEL_DELIVERY.zone) durup E → kasaya yükün
 *    değeri, şoföre (cüzdan) ücret; dorse ayrılır. Ardından `sim.cargo?.deliver?.({ by, items, source })`
 *    çağrılır (Mal Kabul / transpalet sistemi paletleri indirir). `{ handled: true }` dönerse kasaya ayrıca
 *    değer yazılmaz (stok o sistemde işlenir).
 *  - Hasar: yüklü dorseyle çarpmaları istemci bildirir ({ act: 'hit', kmh }); hız bölge sınırıyla, sıklık
 *    0.7 sn ile sınırlanır. Durmuş sayılma (yükleme / teslim) sunucunun kendi hız ölçümüyle denetlenir.
 *
 * ── İLERİDEKİ İLLEGAL SEVKİYAT / POLİS EKLENTİSİ İÇİN KANCALAR ─────────────────────────────────────
 *  İş nesnesi:   job = { id, ownerId, ownerName, site, cargo, pallets, legal: true, hidden: [], state:
 *                'accepted'|'loaded', wholesale, value, fee, deadline, damage, vehicleId, ... }
 *                `hidden` gizli bölme yükleri için boş dizi olarak hazır; `legal` false olabilir.
 *  Olaylar:      logistics.on(event, fn) → fn(payload). event:
 *                  'jobStart'  { job, p }            — iş alındı
 *                  'loaded'    { job, p, v }         — dorse takıldı (yük tırda)
 *                  'jobEnd'    { job, p, reason, pay } — reason: 'delivered' | 'cancelled' | 'left'
 *                  'stopped'   { job, p, v, at }     — yüklü tır ≥ 2 sn durdu (polis kontrolü noktası)
 *                  'moved'     { p, v, state }       — tır sürücüsünün her konum güncellemesi
 *                  'load' / 'deliver' { job, p, v }  — eylemden hemen önce; dinleyici `{ veto: 'mesaj' }`
 *                                                     dönerse eylem reddedilir (ör. yol kontrolü, el koyma).
 *  Tır durumu:   logistics.truckState(p) → { vehicleId, model, x, z, yaw, speed (m/sn), job } | null
 *  Yapay araçlar: logistics.setAgent(id, { kind: 'police'|'civil'|'traffic', x, z, yaw, speed, label? })
 *                ve removeAgent(id) — LOGI_STATE.agents ile en çok 5 Hz yayınlanır; istemci (LargeWorldMap)
 *                bunları otoyolda çizer (polis: tepe lambası). Yerel süs trafiği istemcidedir (deterministik).
 * ───────────────────────────────────────────────────────────────────────────────────────────────────
 */
export class LogisticsService {
  constructor(sim) {
    this.sim = sim;
    this.rand = prng(0x7a11 ^ (sim.config.logisticsSeed ?? 0));
    this.offers = [];
    this.jobs = new Map(); // id → iş
    this.byPlayer = new Map(); // oyuncu id → iş id
    this.track = new Map(); // oyuncu id → { x, z, t, speed, stillSince }
    this.agents = new Map(); // id → yapay araç (polis eklentisi)
    this.listeners = Object.create(null);
    this.seq = 1;
    this.nextRefill = 0;
    this.dirtyAgents = false;
    this.lastAgentOut = 0;
    this.stats = { deliveries: 0, pallets: 0, km: 0, value: 0, fees: 0 };
  }

  // ---- Kancalar ---------------------------------------------------------------------------

  on(event, fn) {
    (this.listeners[event] ??= []).push(fn);
    return () => { this.listeners[event] = this.listeners[event].filter((f) => f !== fn); };
  }

  /** @returns {string|null} ilk veto mesajı */
  emitEvent(event, payload) {
    let veto = null;
    for (const fn of this.listeners[event] ?? []) {
      const r = fn(payload);
      if (!veto && r && typeof r.veto === 'string') veto = r.veto;
    }
    return veto;
  }

  truckState(p) {
    const seat = p.vehicle;
    const v = seat?.seat === 'driver' ? this.sim.vehicles.vehicles.get(seat.id) : null;
    if (!v || v.type !== 'car' || !isTruck(v.model)) return null;
    const t = this.track.get(p.id);
    const job = this.jobOf(p);
    return { vehicleId: v.id, model: v.model, x: v.x, z: v.z, yaw: v.yaw, speed: t?.speed ?? 0, job };
  }

  setAgent(id, data) {
    const a = { id: String(id), kind: data.kind ?? 'traffic', x: r2(data.x), z: r2(data.z), yaw: r2(data.yaw ?? 0), speed: r2(data.speed ?? 0), label: data.label ?? '' };
    this.agents.set(a.id, a);
    this.dirtyAgents = true;
  }

  removeAgent(id) {
    if (this.agents.delete(String(id))) this.dirtyAgents = true;
  }

  // ---- Kalıcılık ----------------------------------------------------------------------------

  restore(data) {
    const s = data?.stats;
    if (!s || typeof s !== 'object') return;
    for (const k of Object.keys(this.stats)) if (Number.isFinite(s[k]) && s[k] >= 0) this.stats[k] = s[k];
  }

  persisted() {
    return { stats: { ...this.stats } };
  }

  // ---- Teklifler ----------------------------------------------------------------------------

  makeOffer(now) {
    const c = CARGO_TYPES[Math.floor(this.rand() * CARGO_TYPES.length)];
    const pallets = c.min + Math.floor(this.rand() * (c.max - c.min + 1));
    const dist = siteDistance(c.site);
    const terms = offerTerms(c.id, pallets, dist);
    return { id: `o${this.seq++}`, cargo: c.id, site: c.site, pallets, dist, ...terms, expires: now + R.OFFER_TTL_MS * (0.6 + this.rand() * 0.8) };
  }

  /** Eksik / süresi dolan teklifler tamamlanır. @returns {boolean} değişti mi */
  refill(now) {
    const before = this.offers.length;
    this.offers = this.offers.filter((o) => o.expires > now);
    let changed = this.offers.length !== before;
    while (this.offers.length < R.OFFERS) {
      this.offers.push(this.makeOffer(now));
      changed = true;
    }
    return changed;
  }

  // ---- Durum ----------------------------------------------------------------------------------

  jobOf(p) {
    const id = this.byPlayer.get(p.id);
    return id ? this.jobs.get(id) ?? null : null;
  }

  publicJob(j) {
    return {
      id: j.id, ownerId: j.ownerId, ownerName: j.ownerName, site: j.site, cargo: j.cargo, pallets: j.pallets, state: j.state,
      wholesale: j.wholesale, value: j.value, fee: j.fee, deadline: j.deadline, damage: r2(j.damage), legal: j.legal,
    };
  }

  serialize() {
    return {
      offers: this.offers.map((o) => ({ ...o })),
      jobs: [...this.jobs.values()].map((j) => this.publicJob(j)),
      agents: [...this.agents.values()],
      stats: { ...this.stats },
    };
  }

  changed() {
    this.sim.out(EVT.LOGI_STATE, this.serialize());
  }

  // ---- Oyuncular ------------------------------------------------------------------------------

  removePlayer(p) {
    const j = this.jobOf(p);
    if (j) this.endJob(j, p, 'left');
    this.track.delete(p.id);
  }

  /** HotelSimulation.movePlayer'dan (konum uygulandıktan sonra): tır hız ölçümü + 'moved' / 'stopped' */
  onMove(p, now) {
    const st = this.truckState(p);
    if (!st) {
      this.track.delete(p.id);
      return;
    }
    let t = this.track.get(p.id);
    if (!t) {
      t = { x: p.x, z: p.z, t: now, speed: 0, stillSince: now, stopSent: false };
      this.track.set(p.id, t);
    } else {
      const dt = (now - t.t) / 1000;
      if (dt > 0.03) {
        const inst = Math.hypot(p.x - t.x, p.z - t.z) / dt;
        t.speed = dt > 1.5 ? inst : t.speed * 0.4 + inst * 0.6;
        t.x = p.x;
        t.z = p.z;
        t.t = now;
      }
    }
    if (t.speed * 3.6 > R.STOP_KMH) {
      t.stillSince = now;
      t.stopSent = false;
    }
    const v = this.sim.vehicles.vehicles.get(st.vehicleId);
    this.emitEvent('moved', { p, v, state: st });
    const job = st.job;
    if (job?.state === 'loaded' && !t.stopSent && now - t.stillSince > 2000) {
      t.stopSent = true;
      this.emitEvent('stopped', { job, p, v, at: { x: p.x, z: p.z } });
    }
  }

  /** Sunucunun ölçtüğü hız (m/sn): son örnekten bu yana hareket yoksa 0'a düşer */
  speedOf(p, now) {
    const t = this.track.get(p.id);
    if (!t) return 0;
    return now - t.t > 600 ? 0 : t.speed;
  }

  // ---- Eylemler ---------------------------------------------------------------------------------

  act(p, data, now) {
    const act = typeof data?.act === 'string' ? data.act : '';
    switch (act) {
      case 'board': {
        if (this.refill(now)) this.changed();
        return { ok: true, state: this.serialize() };
      }
      case 'accept': return this.accept(p, data.offer, now);
      case 'load': return this.load(p, now);
      case 'deliver': return this.deliver(p, now);
      case 'cancel': return this.cancel(p);
      case 'hit': return this.hit(p, data.kmh, now);
      default: return { ok: false, error: 'Geçersiz işlem.' };
    }
  }

  accept(p, offerId, now) {
    if (this.jobOf(p)) return { ok: false, error: 'Zaten bir sevkiyatın var — önce onu bitir ya da iptal et.' };
    const hasTruck = (p.carRecs ?? []).some((r) => isTruck(r.m));
    if (!hasTruck) return { ok: false, error: 'Önce bir tır al (🚛 TruckCenter, lojistik avlusunda).' };
    this.refill(now);
    const i = typeof offerId === 'string' ? this.offers.findIndex((o) => o.id === offerId) : -1;
    if (i < 0) return { ok: false, error: 'Bu teklif artık yok.' };
    const o = this.offers[i];
    this.offers.splice(i, 1);
    const job = {
      id: `j${this.seq++}`, ownerId: p.id, ownerName: p.name, site: o.site, cargo: o.cargo, pallets: o.pallets, dist: o.dist,
      wholesale: o.wholesale, value: o.value, fee: o.fee, timeSec: o.timeSec, legal: true, hidden: [],
      state: 'accepted', acceptedAt: now, loadedAt: 0, deadline: now + o.timeSec * 1000, damage: 0, vehicleId: null, lastHit: 0,
    };
    this.jobs.set(job.id, job);
    this.byPlayer.set(p.id, job.id);
    this.refill(now);
    this.emitEvent('jobStart', { job, p });
    this.changed();
    const site = SITE_BY_ID[job.site];
    return { ok: true, job: this.publicJob(job), text: `${site.icon} ${site.name}: ${job.pallets} palet ${CARGO_BY_ID[job.cargo].name.toLocaleLowerCase('tr-TR')} — tırınla git, yükleme körfezinde dur ve E.` };
  }

  /** Sürücüsü olduğu tır (yoksa hata mesajı) */
  myTruck(p) {
    const seat = p.vehicle;
    const v = seat?.seat === 'driver' ? this.sim.vehicles.vehicles.get(seat.id) : null;
    if (!v || v.type !== 'car' || !isTruck(v.model)) return { error: 'Tırını sürüyor olmalısın.' };
    if (v.ownerId !== p.id) return { error: 'Bu tır senin değil.' };
    return { v };
  }

  load(p, now) {
    const j = this.jobOf(p);
    if (!j) return { ok: false, error: 'Aktif sevkiyatın yok — Lojistik panosundan bir iş al.' };
    if (j.state !== 'accepted') return { ok: false, error: 'Yük zaten tırda — otelin mal kabul körfezine götür.' };
    const { v, error } = this.myTruck(p);
    if (error) return { ok: false, error };
    const site = SITE_BY_ID[j.site];
    if (!inRect(site.load, p.x, p.z, 1.5)) return { ok: false, error: `Yükleme körfezine gir: ${site.name}.` };
    if (this.speedOf(p, now) * 3.6 > R.STOP_KMH) return { ok: false, error: 'Önce tamamen dur.' };
    const veto = this.emitEvent('load', { job: j, p, v });
    if (veto) return { ok: false, error: veto };
    if (!(this.sim.money >= j.wholesale)) return { ok: false, error: `Otel kasasında toptan alım için €${j.wholesale.toLocaleString('nl-NL')} yok.` };
    this.sim.spend(j.wholesale, `🚛 Toptan alım: ${j.pallets} palet ${CARGO_BY_ID[j.cargo].name} (${site.short})`);
    j.state = 'loaded';
    j.loadedAt = now;
    j.vehicleId = v.id;
    j.damage = 0;
    v.trailer = { job: j.id, cargo: j.cargo, pallets: j.pallets };
    this.sim.vehicles.broadcast();
    this.emitEvent('loaded', { job: j, p, v });
    this.changed();
    return { ok: true, job: this.publicJob(j) };
  }

  deliver(p, now) {
    const j = this.jobOf(p);
    if (!j || j.state !== 'loaded') return { ok: false, error: 'Teslim edilecek yükün yok.' };
    const { v, error } = this.myTruck(p);
    if (error) return { ok: false, error };
    if (v.id !== j.vehicleId || !v.trailer) return { ok: false, error: 'Yük başka bir tırda.' };
    if (!inRect(HOTEL_DELIVERY.zone, p.x, p.z, 1.5)) return { ok: false, error: 'Avludaki 🏨 mal kabul körfezine gir.' };
    if (this.speedOf(p, now) * 3.6 > R.STOP_KMH) return { ok: false, error: 'Önce tamamen dur.' };
    const veto = this.emitEvent('deliver', { job: j, p, v });
    if (veto) return { ok: false, error: veto };
    const pay = deliveryPay(j, now);
    const items = [{ type: CARGO_BY_ID[j.cargo].dock, count: j.pallets }]; // Mal Kabul türleri: food|drinks|fun|clean
    let handled = false;
    try {
      const r = this.sim.cargo?.deliver?.({ by: p, items, source: 'truck', site: j.site, job: this.publicJob(j), condition: pay.cond });
      handled = !!r?.handled;
    } catch (err) {
      console.error('[lojistik] cargo.deliver hatası:', err);
    }
    if (!handled && pay.value > 0) this.sim.earn(pay.value, `🚛 Sevkiyat teslim: ${j.pallets} palet ${CARGO_BY_ID[j.cargo].name}`, { guest: false });
    if (pay.fee > 0) {
      p.wallet += pay.fee;
      this.sim.shop.sendSelf(p);
    }
    this.stats.deliveries++;
    this.stats.pallets += j.pallets;
    this.stats.km = r2(this.stats.km + (2 * j.dist) / 1000);
    this.stats.value += handled ? 0 : pay.value;
    this.stats.fees += pay.fee;
    this.endJob(j, p, 'delivered', { ...pay, handled });
    this.sim.house.scheduleSave?.();
    const msg = `📦 Teslim edildi! Kasa +€${(handled ? 0 : pay.value).toLocaleString('nl-NL')}${handled ? ' (stoğa işlendi)' : ''} · şoför ücreti +€${pay.fee}${pay.late ? ' (geç kaldın)' : ' (zamanında ⏱)'}${j.damage > 0.01 ? ` · hasar %${Math.round(j.damage * 100)}` : ''}`;
    this.sim.toPlayer(p.id, EVT.NOTIFY, { text: msg, kind: 'money' });
    return { ok: true, ...pay, handled, text: msg };
  }

  cancel(p) {
    const j = this.jobOf(p);
    if (!j) return { ok: false, error: 'Aktif sevkiyatın yok.' };
    const refund = this.endJob(j, p, 'cancelled');
    return { ok: true, refund };
  }

  /** İşi bitir: dorse ayrılır, yük tırdaysa (iptal / çıkış) toptan fiyatın yarısı kasaya döner */
  endJob(j, p, reason, pay = null) {
    let refund = 0;
    if (reason !== 'delivered' && j.state === 'loaded') {
      refund = Math.round(j.wholesale * R.CANCEL_REFUND);
      if (refund > 0) this.sim.earn(refund, '🚛 Sevkiyat iptali: yük depoya iade', { guest: false });
    }
    const v = j.vehicleId != null ? this.sim.vehicles.vehicles.get(j.vehicleId) : null;
    if (v?.trailer) {
      v.trailer = null;
      this.sim.vehicles.broadcast();
    }
    this.jobs.delete(j.id);
    this.byPlayer.delete(j.ownerId);
    this.emitEvent('jobEnd', { job: j, p, reason, pay });
    this.changed();
    return refund;
  }

  hit(p, kmh, now) {
    const j = this.jobOf(p);
    if (!j || j.state !== 'loaded') return { ok: true, damage: 0 };
    const { v, error } = this.myTruck(p);
    if (error || v.id !== j.vehicleId) return { ok: false, error: error ?? 'Yük başka bir tırda.' };
    if (typeof kmh !== 'number' || !Number.isFinite(kmh) || kmh <= 0) return { ok: false, error: 'Geçersiz.' };
    if (now - j.lastHit < R.HIT_MIN_MS) return { ok: true, damage: r2(j.damage) };
    const cap = carSpeedCap(CAR_BY_ID[v.model], p.x, p.z) * 3.6 * 1.3 + 5;
    j.lastHit = now;
    j.damage = Math.min(R.MAX_DAMAGE, j.damage + hitDamage(Math.min(kmh, cap)));
    this.changed();
    return { ok: true, damage: r2(j.damage) };
  }

  // ---- Döngü -----------------------------------------------------------------------------------

  update(now) {
    let changed = false;
    if (now >= this.nextRefill && this.sim.config.logisticsOffers !== false) {
      this.nextRefill = now + R.REFILL_MS;
      if (this.offers.length || this.jobs.size) changed = this.refill(now) || changed; // ilk teklifler panoyu açınca
    }
    if (this.dirtyAgents && now - this.lastAgentOut > 200) {
      this.dirtyAgents = false;
      this.lastAgentOut = now;
      this.sim.out(EVT.LOGI_AGENTS, [...this.agents.values()]);
    }
    if (changed) this.changed();
  }

}

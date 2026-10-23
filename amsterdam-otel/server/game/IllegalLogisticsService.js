import { EVT } from '../../shared/constants.js';
import { isTruck } from '../../shared/cars.js';
import { inHighwayRegion, yardAt, constrainToRoads, laneAt, trunkAt, TRUNK_LENGTH, roadProject, roadPoint, HOTEL_DELIVERY } from '../../shared/worldmap.js';
import {
  CONTRA_GOODS, CONTRA_BY_ID, ILLEGAL_RULES as R, BOX_SLOTS, SLOT_ORDER, SCANNERS, CONTACT, SAFE_DROP,
  inContactZone, inDropZone, heatStars, policeWanted, contraTerms, catchFine, isDark, frame, slotPoint, trunkNear, DROP_SITES,
  RAID_RULES,
} from '../../shared/illegal.js';

const inRect = (b, x, z, tol = 0) => x > b.minX - tol && x < b.maxX + tol && z > b.minZ - tol && z < b.maxZ + tol;

const r2 = (v) => Math.round(v * 100) / 100;
const SLOT_BY_ID = Object.fromEntries(BOX_SLOTS.map((s) => [s.id, s]));

/** Bu servise özel tohumlu PRNG (simülasyonun ortak rng dizisine dokunmaz) */
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
 * İllegal sevkiyat + dinamik polis kıskacı (sunucu yetkili). LogisticsService kancaları üzerine kuruludur.
 *
 *  - Gizli zula bölmesi: oyuncunun tırına (araba kaydı kimliği) takılan, cüzdandan ödenen kalıcı yükseltme.
 *  - Tanıdık teklifleri: yalnızca bölmeli tırı olan oyuncuya, kişisel ve TEK TEK — aynı anda en çok 1 teklif;
 *    teklif alınınca ya da süresi dolunca bir sonraki 5–10 gerçek dakika sonra gelir (ilki bölme takılınca hemen).
 *    Kazanç 1.200–1.400 €, peşin bedel 150–250 € (ILLEGAL_RULES). Kaçak iş, lojistiğin iş tablosuna `legal: false,
 *    hidden: [{ good, qty }]` ile yazılır (oyuncu başına tek iş kuralı korunur); LogisticsService'in yükle / teslim
 *    eylemleri bu işler için veto edilir — burada K-17'de yüklenir; Eski Kantar Deposu'nda ya da otelin mal kabul
 *    alanında İNDİRİLİR (PoliceRaidService: ~10 sn indirme, rastgele polis baskını). Bedel / kazanç CÜZDANDA.
 *  - Isı (0–100 → 5★): yük tırdayken otoyolda hareket (hız aşımı sayılmaz), çarpma (yük hasarı), tarayıcı kapıları, polis
 *    aracına çarpma artırır. ≥1★ sivil araç izler, ≥2★ resmi polis gelir; polisler tırın ön / arka / sol / sağ
 *    yuvalarına yerleşip (kinematik, yol koordinatlarında şeridi izleyerek) önden frenleyerek durdurmaya çalışır.
 *  - Yakalanma: ≥3 taraf kapalıyken hız 8 km/s altında 4 sn, ya da durmuşken polis 8 m içinde 6 sn → mallara
 *    el konur, cüzdandan ceza (0'ın altına inmez). Kaçış: 150 m içinde hiçbir ekip yokken 25 sn → takip biter.
 *  - Ajanlar LogisticsService.setAgent ile yayınlanır (LOGI_AGENTS, ≤5 Hz).
 */
export class IllegalLogisticsService {
  constructor(sim) {
    this.sim = sim;
    this.logi = sim.logistics;
    this.rand = prng(0x5ec7 ^ (sim.config.illegalSeed ?? 0));
    this.compartments = new Map(); // sahip anahtarı (keyHash ya da p<id>) → Set(araba kaydı kimliği)
    this.offers = new Map(); // oyuncu id → teklifler
    this.chases = new Map(); // oyuncu id → takip durumu
    this.nextOffer = new Map(); // oyuncu id → bir sonraki teklifin geleceği an (ms; yoksa ilk teklif hemen)
    this.lastOfferCheck = 0;
    this.seq = 1;
    this.lastTick = 0;
    this.stats = { runs: 0, delivered: 0, caught: 0, escaped: 0, earned: 0, fines: 0, compartments: 0 };

    const L = this.logi;
    L.on('load', ({ job }) => (job.legal === false ? { veto: 'Bu yük K-17 konteynerinden yüklenir (🕶️ limandaki tanıdık).' } : null));
    L.on('deliver', ({ job }) => (job.legal === false ? { veto: 'Bu yük otele teslim edilmez — 🏚️ Eski Kantar Deposu.' } : null));
    L.on('jobEnd', ({ job, reason }) => {
      if (job.legal !== false) return;
      const c = this.chases.get(job.ownerId);
      if (!c) return;
      if (reason === 'left') this.endChase(job.ownerId);
      else if (reason === 'cancelled' && c.job === job) {
        // Yük tırdayken iptal: mallar yola dökülür; takip (ısı) sürer, yakalanırsa yalnızca taban ceza
        c.job = null;
        const p = this.sim.players.get(job.ownerId);
        if (p && c.heat >= R.CIVIL_AT) this.radio(p, '📻 Merkez: şüpheli yükünü yola boşalttı — takibe devam!');
      }
    });
  }

  // ---- Kalıcılık ----------------------------------------------------------------------------

  restore(data) {
    const c = data?.compartments;
    if (c && typeof c === 'object') {
      for (const [k, ids] of Object.entries(c)) {
        if (typeof k !== 'string' || !Array.isArray(ids)) continue;
        this.compartments.set(k, new Set(ids.filter((x) => typeof x === 'string' && x.length <= 16).slice(0, 8)));
      }
    }
    const s = data?.stats;
    if (s && typeof s === 'object') for (const k of Object.keys(this.stats)) if (Number.isFinite(s[k]) && s[k] >= 0) this.stats[k] = s[k];
  }

  persisted() {
    const compartments = {};
    for (const [k, set] of this.compartments) if (!k.startsWith('p:') && set.size) compartments[k] = [...set];
    return { compartments, stats: { ...this.stats } };
  }

  // ---- Yardımcılar ----------------------------------------------------------------------------

  ownerKey(p) { return p.keyHash ? p.keyHash : `p:${p.id}`; }

  hasCompartment(p, v) {
    return !!v?.rec && this.compartments.get(this.ownerKey(p))?.has(v.rec.id) === true;
  }

  trucksOf(p) {
    return [...this.sim.vehicles.vehicles.values()].filter((v) => v.type === 'car' && v.ownerId === p.id && isTruck(v.model));
  }

  get night() { return isDark(this.sim.clock.minute); }

  jobOf(p) {
    const j = this.logi.jobOf(p);
    return j && j.legal === false ? j : null;
  }

  /** Oyuncuya özel durum (teklifler, bölmeli tırlar, takip) */
  privateState(p, now = this.sim.now()) {
    const c = this.chases.get(p.id);
    const j = this.jobOf(p);
    return {
      price: R.COMPARTMENT_PRICE,
      job: j ? { id: j.id, hidden: j.hidden, cost: j.cost, pay: j.pay } : null, // kaçak yükün ayrıntısı yalnızca sahibine
      night: this.night,
      trucks: this.trucksOf(p).map((v) => ({ id: v.id, model: v.model, hidden: this.hasCompartment(p, v) })),
      offers: (this.offers.get(p.id) ?? []).filter((o) => o.expires > now),
      nextOfferIn: this.nextOffer.has(p.id) ? Math.max(0, this.nextOffer.get(p.id) - now) : null,
      unload: this.sim.raids?.view(p, now) ?? null, // kaçak yük indirme + baskın (PoliceRaidService)
      chase: c ? this.chaseView(c, now) : null,
      stats: { ...this.stats },
    };
  }

  chaseView(c, now) {
    return {
      heat: Math.round(c.heat), stars: heatStars(c.heat), sides: c.sides, boxed: c.sides.length >= R.BOX_SIDES,
      catchIn: c.catchT > 0 ? r2(Math.max(0, R.CATCH_SEC - c.catchT)) : null,
      pullIn: c.pullT > 0 ? r2(Math.max(0, R.PULL_SEC - c.pullT)) : null,
      escapeIn: c.agents.size && c.escapeT > 0 ? r2(Math.max(0, R.ESCAPE_SEC - c.escapeT)) : null,
      police: [...c.agents.values()].filter((a) => a.kind === 'police').length,
      civil: [...c.agents.values()].some((a) => a.kind === 'civil'),
      loaded: !!c.job, rams: c.rams, at: now,
    };
  }

  sendPrivate(p) {
    this.sim.toPlayer(p.id, EVT.ILLEGAL_STATE, this.privateState(p));
  }

  radio(p, text, kind = 'warn') {
    this.sim.toPlayer(p.id, EVT.NOTIFY, { text, kind });
  }

  // ---- Oyuncular --------------------------------------------------------------------------------

  removePlayer(p) {
    this.offers.delete(p.id);
    this.nextOffer.delete(p.id);
    this.endChase(p.id);
    if (!p.keyHash) this.compartments.delete(`p:${p.id}`);
  }

  // ---- Eylemler ----------------------------------------------------------------------------------

  act(p, data, now) {
    const act = typeof data?.act === 'string' ? data.act : '';
    switch (act) {
      case 'state': return { ok: true, state: this.privateState(p, now) };
      case 'buy': return this.buy(p, data.vehicle);
      case 'board': {
        this.refill(p, now);
        return { ok: true, state: this.privateState(p, now) };
      }
      case 'accept': return this.accept(p, data.offer, now);
      case 'load': return this.load(p, now);
      case 'drop': return this.drop(p, now, data.site);
      default: return { ok: false, error: 'Geçersiz işlem.' };
    }
  }

  buy(p, vehicleId) {
    if (!Number.isInteger(vehicleId)) return { ok: false, error: 'Tır seç.' };
    const v = this.sim.vehicles.vehicles.get(vehicleId);
    if (!v || v.type !== 'car' || !isTruck(v.model) || v.ownerId !== p.id || !v.rec) return { ok: false, error: 'Bu tır senin değil.' };
    if (this.hasCompartment(p, v)) return { ok: false, error: 'Bu tırda zaten gizli bölme var.' };
    if (this.logi.jobOf(p)?.vehicleId === v.id) return { ok: false, error: 'Yüklü tıra bölme takılmaz — önce işi bitir.' };
    if (!(p.wallet >= R.COMPARTMENT_PRICE)) return { ok: false, error: `Cüzdanında €${R.COMPARTMENT_PRICE.toLocaleString('nl-NL')} yok.` };
    p.wallet -= R.COMPARTMENT_PRICE;
    this.sim.shop.sendSelf(p);
    const key = this.ownerKey(p);
    if (!this.compartments.has(key)) this.compartments.set(key, new Set());
    this.compartments.get(key).add(v.rec.id);
    this.stats.compartments++;
    this.sim.house.scheduleSave?.();
    this.refill(p, this.sim.now());
    this.sendPrivate(p);
    return { ok: true, text: '🕶️ Dorsenin tabanına gizli zula bölmesi takıldı. Panoda artık limandaki tanıdığın teklifleri görünür.' };
  }

  makeOffer(now) {
    const g = CONTRA_GOODS[Math.floor(this.rand() * CONTRA_GOODS.length)];
    const qty = g.min + Math.floor(this.rand() * (g.max - g.min + 1));
    return { id: `x${this.seq++}`, good: g.id, qty, ...contraTerms(this.rand(), this.rand()), timeSec: R.TIME_SEC, expires: now + R.OFFER_TTL_MS };
  }

  /** Bir sonraki teklifin gelme zamanı: şimdi + 5–10 dk */
  scheduleOffer(p, now) {
    this.nextOffer.set(p.id, now + R.OFFER_EVERY_MIN_MS + this.rand() * (R.OFFER_EVERY_MAX_MS - R.OFFER_EVERY_MIN_MS));
  }

  /**
   * Bölmeli tırı olan oyuncunun teklifi: aynı anda en çok OFFERS (1). Teklif yoksa ve bekleme süresi dolduysa
   * (ya da hiç teklif gelmediyse) yenisi gelir. @returns {boolean} yeni teklif geldi mi
   */
  refill(p, now) {
    if (!this.trucksOf(p).some((v) => this.hasCompartment(p, v))) {
      this.offers.delete(p.id);
      this.nextOffer.delete(p.id);
      return false;
    }
    const before = this.offers.get(p.id) ?? [];
    const list = before.filter((o) => o.expires > now);
    if (before.length && !list.length && !this.nextOffer.has(p.id)) this.scheduleOffer(p, now); // süresi doldu
    let added = false;
    const due = this.nextOffer.get(p.id);
    if (list.length < R.OFFERS && (due === undefined || now >= due)) {
      list.push(this.makeOffer(now));
      this.nextOffer.delete(p.id);
      added = true;
    }
    this.offers.set(p.id, list);
    return added;
  }

  accept(p, offerId, now) {
    if (this.logi.jobOf(p)) return { ok: false, error: 'Zaten bir sevkiyatın var — önce onu bitir ya da iptal et.' };
    if (!this.trucksOf(p).some((v) => this.hasCompartment(p, v))) return { ok: false, error: 'Önce tırına gizli bölme taktır.' };
    const list = (this.offers.get(p.id) ?? []).filter((o) => o.expires > now);
    const i = typeof offerId === 'string' ? list.findIndex((o) => o.id === offerId) : -1;
    if (i < 0) return { ok: false, error: 'Bu teklif artık yok.' };
    const o = list[i];
    list.splice(i, 1);
    this.offers.set(p.id, list);
    if (!list.length) this.scheduleOffer(p, now); // bir sonraki iş 5–10 dk sonra
    const L = this.logi;
    const job = {
      id: `j${L.seq++}`, ownerId: p.id, ownerName: p.name, site: CONTACT.site, cargo: 'import', pallets: 6, dist: 0,
      wholesale: 0, value: 0, fee: 0, timeSec: o.timeSec, legal: false, hidden: [{ good: o.good, qty: o.qty }],
      cost: o.cost, pay: o.pay, rams: 0,
      state: 'accepted', acceptedAt: now, loadedAt: 0, deadline: now + 30 * 60_000, damage: 0, vehicleId: null, lastHit: 0,
    };
    L.jobs.set(job.id, job);
    L.byPlayer.set(p.id, job.id);
    L.emitEvent('jobStart', { job, p });
    L.changed();
    this.refill(p, now);
    this.sendPrivate(p);
    const g = CONTRA_BY_ID[o.good];
    return { ok: true, text: `🕶️ ${o.qty} ${g.unit} ${g.name.toLocaleLowerCase('tr-TR')} — bölmeli tırınla ⚓ limandaki K-17 konteynerine git, dur ve E (peşin €${o.cost.toLocaleString('nl-NL')}, cüzdandan).` };
  }

  load(p, now) {
    const j = this.jobOf(p);
    if (!j) return { ok: false, error: 'Aktif kaçak işin yok.' };
    if (j.state !== 'accepted') return { ok: false, error: 'Mallar zaten bölmede.' };
    const { v, error } = this.logi.myTruck(p);
    if (error) return { ok: false, error };
    if (!this.hasCompartment(p, v)) return { ok: false, error: 'Bu tırda gizli bölme yok.' };
    if (!inContactZone(p.x, p.z, 7)) return { ok: false, error: '⚓ Limandaki K-17 konteynerinin önüne gir.' };
    if (this.logi.speedOf(p, now) * 3.6 > R.STOP_KMH) return { ok: false, error: 'Önce tamamen dur.' };
    if (!(p.wallet >= j.cost)) return { ok: false, error: `Tanıdık peşin istiyor: cüzdanında €${j.cost.toLocaleString('nl-NL')} yok.` };
    p.wallet -= j.cost;
    this.sim.shop.sendSelf(p);
    j.state = 'loaded';
    j.loadedAt = now;
    j.deadline = now + j.timeSec * 1000;
    j.vehicleId = v.id;
    j.damage = 0;
    j.night = this.night;
    v.trailer = { job: j.id, cargo: j.cargo, pallets: j.pallets };
    this.sim.vehicles.broadcast();
    this.logi.emitEvent('loaded', { job: j, p, v });
    this.logi.changed();
    this.stats.runs++;
    const c = this.chaseOf(p.id, true);
    c.job = j;
    c.damage = 0;
    this.addHeat(p, c, R.HEAT_LOAD * (j.night ? R.NIGHT_HEAT_MUL : 1));
    this.sendPrivate(p);
    return { ok: true, text: '🤫 Mallar gizli bölmede, üstü konteyner yüküyle örtüldü. Dikkat çekmeden 🏚️ Eski Kantar Deposu\'na (FrisDepot\'un batı köşesi) ya da otelin 🏨 mal kabul alanına (riskli) götür.' };
  }

  /** Tırın bulunduğu kaçak teslim yeri: 'depot' (Eski Kantar Deposu) | 'hotel' (otelin mal kabul alanı) | null */
  dropSiteAt(x, z, tol = 7) {
    if (inDropZone(x, z, tol)) return 'depot';
    if (inRect(HOTEL_DELIVERY.zone, x, z, tol)) return 'hotel';
    return null;
  }

  /** Kaçak yükü indirmeye başla (indirme + baskın PoliceRaidService'te); site verilmezse konumdan bulunur */
  drop(p, now, siteArg) {
    const j = this.jobOf(p);
    if (!j || j.state !== 'loaded') return { ok: false, error: 'Teslim edilecek kaçak yükün yok.' };
    const { v, error } = this.logi.myTruck(p);
    if (error) return { ok: false, error };
    if (v.id !== j.vehicleId) return { ok: false, error: 'Mallar başka bir tırda.' };
    if (siteArg !== undefined && !(typeof siteArg === 'string' && DROP_SITES[siteArg])) return { ok: false, error: 'Geçersiz teslim yeri.' };
    const site = this.dropSiteAt(p.x, p.z);
    if (!site || (siteArg && siteArg !== site)) return { ok: false, error: '🏚️ Eski Kantar Deposu\'nun ya da 🏨 otelin mal kabul alanının önüne gir.' };
    if (this.logi.speedOf(p, now) * 3.6 > R.STOP_KMH) return { ok: false, error: 'Önce tamamen dur.' };
    const c = this.chases.get(p.id);
    if (c) {
      for (const a of c.agents.values()) {
        if (Math.hypot(a.x - p.x, a.z - p.z) < R.DROP_POLICE_DIST) return { ok: false, error: '🚓 Polis dibindeyken kapı açılmaz — önce takipten kurtul!' };
      }
    }
    if (!this.sim.raids) return this.finishDrop(p, j, site, now);
    return this.sim.raids.start(p, j, site, now);
  }

  /** İndirme tamamlandı: kazanç cüzdana (geç ×LATE_MUL, hasarla orantılı). seen: baskın ekibi geç kaldı */
  finishDrop(p, j, site, now, { seen = false } = {}) {
    const late = now > j.deadline;
    const cond = Math.max(0, 1 - j.damage);
    const pay = Math.round(j.pay * cond * (late ? R.LATE_MUL : 1));
    if (pay > 0) {
      p.wallet += pay;
      this.sim.shop.sendSelf(p);
    }
    this.stats.delivered++;
    this.stats.earned += pay;
    if (seen) {
      // Polis boş körfeze vardı: seni gördüler — ısı kalır (yük yok → takip soğuyup biter)
      const c = this.chaseOf(p.id, true);
      c.job = null;
      this.addHeat(p, c, RAID_RULES.SEEN_HEAT);
    } else {
      this.endChase(p.id);
    }
    this.logi.endJob(j, p, 'delivered', { value: 0, fee: pay, late, cond });
    this.sim.house.scheduleSave?.();
    const where = DROP_SITES[site];
    const text = `💼 Mallar ${where.icon} ${where.name} önünde alıcıya teslim edildi — cüzdana +€${pay.toLocaleString('nl-NL')}${late ? ' (geç kaldın)' : ''}${j.damage > 0.01 ? ` · hasar %${Math.round(j.damage * 100)}` : ''}${seen ? ' · 🚓 baskın ekibi boş körfeze vardı!' : ''}.`;
    this.radio(p, text, 'money');
    this.sendPrivate(p);
    return { ok: true, pay, late, site, text };
  }

  // ---- Takip ---------------------------------------------------------------------------------------

  chaseOf(pid, create = false) {
    let c = this.chases.get(pid);
    if (!c && create) {
      c = {
        pid, heat: 0, job: null, agents: new Map(), sides: [], catchT: 0, pullT: 0, escapeT: 0, footT: 0, damage: 0, rams: 0,
        lastRam: 0, scanned: Object.create(null), squeeze: 0, lastOut: 0, lastKey: '', lastStars: 0, seq: 0,
      };
      this.chases.set(pid, c);
    }
    return c ?? null;
  }

  addHeat(p, c, amount) {
    c.heat = Math.max(0, Math.min(100, c.heat + amount));
    const stars = heatStars(c.heat);
    if (stars > c.lastStars && stars >= 1) {
      const dir = this.headingText(p);
      const msg = stars === 1
        ? `📻 "Merkez, işaretsiz ekip şüpheli bir tırı izliyor — ${dir}."`
        : stars === 2
          ? `📻 "Merkez: şüpheli tır A10'da ${dir} ilerliyor, bir ekip yönlendiriliyor!"`
          : stars === 3
            ? `📻 "Tüm ekiplere: tır kaçıyor, ${dir}! Önünü kesin, sıkıştırın!"`
            : `📻 "Kıskaç operasyonu! Dört ekip — önden, arkadan ve iki yandan sıkıştırın!"`;
      this.radio(p, msg);
    }
    c.lastStars = stars;
  }

  headingText(p) {
    const st = this.logi.truckState(p);
    if (!st) return 'otoyolda';
    const n = trunkNear(st.x, st.z);
    if (n.d > 25) return yardAt(st.x, st.z) ? 'bir depo avlusunda' : 'bağlantı yolunda';
    const t = trunkAt(n.s);
    const { fx, fz } = frame(st.yaw);
    return fx * t.ux + fz * t.uz >= 0 ? 'limana doğru (doğuya)' : 'şehre doğru (batıya)';
  }

  endChase(pid) {
    const c = this.chases.get(pid);
    if (!c) return;
    for (const id of c.agents.keys()) this.logi.removeAgent(id);
    this.chases.delete(pid);
    const p = this.sim.players.get(pid);
    if (p) this.sendPrivate(p);
  }

  caught(p, c) {
    return this.confiscate(p, c.job, c.rams);
  }

  /**
   * Yakalanma: mallara el konur (iş biter), cüzdandan ceza (0'ın altına inmez), takip biter.
   * @param raid baskında körfezde yakalanma ise { site } (mesaj için)
   */
  confiscate(p, job, rams = 0, raid = null) {
    const fine = catchFine({ pay: job?.pay ?? 0, rams }, p.wallet);
    if (fine.paid > 0) {
      p.wallet -= fine.paid;
      this.sim.shop.sendSelf(p);
    }
    this.stats.caught++;
    this.stats.fines += fine.paid;
    this.endChase(p.id);
    if (job) this.logi.endJob(job, p, 'caught');
    this.sim.house.scheduleSave?.();
    const head = raid ? `🚨 Baskın! ${DROP_SITES[raid.site].icon} ${DROP_SITES[raid.site].name} önünde yakalandın. ` : '🚔 Yakalandın! ';
    const text = `${head}${job ? 'Gizli bölmedeki mallara el konuldu. ' : ''}Ceza: €${fine.paid.toLocaleString('nl-NL')}${fine.paid < fine.due ? ` (cüzdandaki her şey — borç €${fine.due.toLocaleString('nl-NL')} idi)` : ''}.`;
    this.radio(p, text, 'warn');
    this.sim.toPlayer(p.id, EVT.ILLEGAL_STATE, { ...this.privateState(p), caught: { fine: fine.paid, due: fine.due, raid: raid?.site ?? null } });
    return fine;
  }

  /** Yeni ajanın doğduğu yer: ana gövdede tırın gerisinde (yoksa tırın arkasında, yola itilmiş) */
  spawnPoint(x, z, yaw, back) {
    const n = trunkNear(x, z);
    const { fx, fz } = frame(yaw);
    if (n.d < 25) {
      const t = trunkAt(n.s);
      const dir = fx * t.ux + fz * t.uz >= 0 ? 1 : -1;
      const s = Math.max(0, Math.min(TRUNK_LENGTH, n.s - dir * back));
      const l = laneAt(s, dir, this.rand() < 0.5 ? 0 : 1);
      return { x: l.x, z: l.z, yaw: l.yaw };
    }
    const pos = { x: x - fx * Math.min(back, 60), z: z - fz * Math.min(back, 60) };
    constrainToRoads(pos, 1.2);
    return { x: pos.x, z: pos.z, yaw };
  }

  /** Ajan sayısını ısıya göre ayarla (sivil + resmi polis yuvaları) */
  staff(c, st) {
    const wantCivil = c.heat >= R.CIVIL_AT && policeWanted(c.heat) < 4;
    const wantPolice = policeWanted(c.heat);
    const have = [...c.agents.values()];
    const civil = have.find((a) => a.kind === 'civil');
    if (wantCivil && !civil) {
      const sp = this.spawnPoint(st.x, st.z, st.yaw, R.SPAWN_BEHIND * 0.6);
      this.addAgent(c, { kind: 'civil', slot: null, ...sp, label: 'İşaretsiz araç' });
    } else if (!wantCivil && civil) {
      c.agents.delete(civil.id);
      this.logi.removeAgent(civil.id);
    }
    const police = have.filter((a) => a.kind === 'police');
    for (let k = police.length; k < wantPolice; k++) {
      const used = new Set([...c.agents.values()].map((a) => a.slot));
      const slot = SLOT_ORDER.find((s) => !used.has(s));
      if (!slot) break;
      const sp = this.spawnPoint(st.x, st.z, st.yaw, R.SPAWN_BEHIND + k * 12);
      this.addAgent(c, { kind: 'police', slot, ...sp, label: 'Polis' });
    }
  }

  addAgent(c, a) {
    const id = `pol-${c.pid}-${++c.seq}`;
    const agent = { id, speed: 0, ...a };
    c.agents.set(id, agent);
    this.logi.setAgent(id, agent);
  }

  /**
   * Ajan hedefi: polis yuvası (ön yuva kıskaçta yaklaşır), sivil 34 m geride (dorsenin ~20 m arkası).
   * Tır bir yoldaysa yuva YOL koordinatlarında hesaplanır (virajda arka yuva yolun üstünde, tırın izinde kalır):
   * { x, z, road, s, l }; avluda düz geometri.
   */
  target(c, a, st) {
    const slot = a.kind === 'civil' ? { f: -34, r: 0 } : SLOT_BY_ID[a.slot];
    const f = slot.id === 'front' ? slot.f - c.squeeze : slot.f;
    const tp = st.proj;
    if (tp) {
      const { fx, fz } = frame(st.yaw);
      const dir = fx * tp.ux + fz * tp.uz >= 0 ? 1 : -1; // tır yolun s yönünde mi gidiyor
      const lim = tp.half - 1.2;
      const l = Math.max(-lim, Math.min(lim, tp.l + dir * slot.r)); // tırın sağı = dir × yolun sağı
      const sT = tp.s + dir * f;
      const w = roadPoint(tp.road, sT, l);
      return { x: w.x, z: w.z, road: tp.road, s: sT, l };
    }
    return slotPoint({ f, r: slot.r }, st.x, st.z, st.yaw);
  }

  /**
   * Ajanı hedefe doğru yol boyunca ilerlet: yoldaysa yol koordinatlarında (s boyunca, şerit değiştirme hızı
   * sınırlı) — virajda kaymaz, şeridi izler; avludaysa düz + sürülebilir alana it. @returns {{x, z}}
   */
  advance(a, tg, want, dt, inRegion) {
    // Kavşakta (ana gövde ↔ bağlantı yolu) yol seçimi sıçramasın: önce hedefin yolu, sonra ajanın son yolu
    let ap = null;
    if (inRegion) {
      for (const id of [tg.road, a.road]) {
        if (!id || ap) continue;
        const pr = roadProject(a.x, a.z, id);
        if (pr.d <= pr.half + 1.5) ap = pr;
      }
      ap ??= roadProject(a.x, a.z);
    }
    if (ap && ap.d <= ap.half + 1.5) {
      a.road = ap.road;
      let sT;
      let lT;
      if (tg.road === ap.road) {
        sT = tg.s;
        lT = tg.l;
      } else {
        // Hedef başka yolda / avluda: kendi yolunda hedefe en yakın noktaya (kavşağa) doğru sür
        const tp = roadProject(tg.x, tg.z, ap.road);
        sT = tp.s;
        lT = tp.l;
      }
      const lim = ap.half - 1.2;
      lT = Math.max(-lim, Math.min(lim, lT));
      const ds = sT - ap.s;
      const dl = lT - ap.l;
      const stepS = Math.sign(ds) * Math.min(Math.abs(ds), want * dt);
      const stepL = Math.sign(dl) * Math.min(Math.abs(dl), R.LANE_CHANGE * dt);
      const q = roadPoint(ap.road, ap.s + stepS, Math.max(-lim, Math.min(lim, ap.l + stepL)));
      return { x: q.x, z: q.z };
    }
    const dx = tg.x - a.x;
    const dz = tg.z - a.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, want * dt);
    const q = { x: a.x + (d > 1e-6 ? (dx / d) * step : 0), z: a.z + (d > 1e-6 ? (dz / d) * step : 0) };
    if (inRegion) constrainToRoads(q, 1.0);
    return q;
  }

  update(now) {
    const dt = this.lastTick ? Math.min(0.5, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    // Tanıdığın yeni teklifi (5–10 dk'da bir): bölmeli tırı olan oyunculara saniyede bir bakılır
    if (now - this.lastOfferCheck >= 1000) {
      this.lastOfferCheck = now;
      for (const p of this.sim.players.values()) {
        if (!this.offers.has(p.id) && !this.nextOffer.has(p.id)) continue; // bölmesi yok / panoyu hiç açmadı
        if (this.refill(p, now)) {
          this.radio(p, '📞 Limandaki tanıdık: "Yeni bir iş var — Lojistik panosuna bak." (🕶️)', 'info');
          this.sendPrivate(p);
        }
      }
    }
    if (!dt) return;
    for (const c of [...this.chases.values()]) this.step(c, dt, now);
  }

  step(c, dt, now) {
    const p = this.sim.players.get(c.pid);
    if (!p) {
      this.endChase(c.pid);
      return;
    }
    const st = this.logi.truckState(p);
    const driving = !!st && c.job && st.vehicleId === c.job.vehicleId;
    const x = st?.x ?? p.x;
    const z = st?.z ?? p.z;
    const yaw = st?.yaw ?? p.yaw;
    const speed = st ? this.logi.speedOf(p, now) : 0;
    const kmh = speed * 3.6;
    const inRegion = inHighwayRegion(x, z, 4);
    const nightMul = this.night ? R.NIGHT_HEAT_MUL : 1;

    // ---- Isı ----
    if (driving && inRegion) {
      const onRoad = !yardAt(x, z);
      if (onRoad && kmh > 3) this.addHeat(p, c, R.HEAT_ROAD * dt * nightMul);
      if (c.job.damage > c.damage + 1e-6) {
        c.damage = c.job.damage;
        this.addHeat(p, c, R.HEAT_HIT);
      }
      const n = trunkNear(x, z);
      for (const sc of SCANNERS) {
        const near = n.d < 14 && Math.abs(n.s - sc.s) < 9;
        if (near && !c.scanned[sc.id]) {
          c.scanned[sc.id] = true;
          if (this.rand() < (this.night ? R.SCAN_CHANCE_NIGHT : R.SCAN_CHANCE)) {
            this.addHeat(p, c, R.HEAT_SCAN);
            this.radio(p, `📡 ${sc.name}: dorsede şüpheli yoğunluk! Ekipler uyarıldı.`);
          } else {
            this.radio(p, `📡 ${sc.name}: tarama temiz geçti… şimdilik.`, 'info');
          }
        } else if (!near && Math.abs(n.s - sc.s) > 60) c.scanned[sc.id] = false;
      }
    }

    // ---- Ajanlar ----
    const tp = inRegion ? roadProject(x, z) : null;
    const pos = { x, z, yaw, proj: tp && tp.d <= tp.half + 1.5 ? tp : null };
    if (this.sim.config.policeAgents !== false && inRegion && (driving || c.agents.size)) this.staff(c, pos);
    let nearest = Infinity;
    let nearestPolice = Infinity;
    const sides = [];
    const { fx, fz } = frame(yaw);
    for (const a of c.agents.values()) {
      const tg = this.target(c, a, pos);
      const dx = tg.x - a.x;
      const dz = tg.z - a.z;
      const d = Math.hypot(dx, dz);
      // İstenen hız: tırın hızı + mesafe kapatma (yaklaşınca yumuşar)
      const want = Math.min(R.CHASE_MAX, Math.max(0, speed + Math.min(d * 1.4, R.CHASE_MAX)));
      const q = this.advance(a, tg, want, dt, inRegion);
      const moved = Math.hypot(q.x - a.x, q.z - a.z);
      a.speed = moved / dt;
      a.yaw = moved > 0.05 ? Math.atan2(-(q.x - a.x), -(q.z - a.z)) : yaw;
      a.x = q.x;
      a.z = q.z;
      this.logi.setAgent(a.id, a);
      const dist = Math.hypot(a.x - x, a.z - z);
      nearest = Math.min(nearest, dist);
      if (a.kind !== 'police') continue;
      nearestPolice = Math.min(nearestPolice, dist);
      if (Math.hypot(tg.x - a.x, tg.z - a.z) < R.SLOT_TOL) sides.push(a.slot);
      // Polis aracına çarpma: tırın gövdesi (çekici önü … dorse arkası) aracın RAM_LAT yakınından hızla geçerse.
      // Kıskaçtaki ön aracın içinden "geçmek" de böyle sayılır (sunucu konumu geri almaz; ısı + ceza)
      if (driving) {
        const rx = a.x - x;
        const rz = a.z - z;
        const along = Math.max(R.BODY_REAR, Math.min(R.BODY_FRONT, rx * fx + rz * fz));
        const lat = Math.hypot(rx - fx * along, rz - fz * along);
        if (lat < R.RAM_LAT && speed > 7 && now - c.lastRam > R.RAM_COOLDOWN_MS) {
          c.lastRam = now;
          c.rams++;
          if (c.job) c.job.rams = c.rams;
          this.addHeat(p, c, R.HEAT_RAM);
          this.radio(p, '📻 "Ekibe çarptı! Ceza büyüyor — sıkıştırmaya devam!"');
        }
      }
    }
    c.sides = sides.sort();
    const boxed = sides.length >= R.BOX_SIDES;
    // Kıskaç: ön araç yavaşça yaklaşır (önden frenleyerek durdurma)
    c.squeeze = boxed ? Math.min(4.5, c.squeeze + dt * 0.9) : Math.max(0, c.squeeze - dt * 2);

    // ---- Yakalanma ----
    if (boxed && kmh < R.CATCH_KMH) c.catchT += dt;
    else c.catchT = Math.max(0, c.catchT - dt * 2);
    if (st && kmh < 3 && nearestPolice < R.PULL_DIST) c.pullT += dt;
    else c.pullT = Math.max(0, c.pullT - dt * 2);
    // Tırdan inip yürüyerek kaçmak: polis 10 m içindeyse 2 sn
    if (!st && nearestPolice < 10) c.footT += dt;
    else c.footT = 0;
    if (c.catchT >= R.CATCH_SEC || c.pullT >= R.PULL_SEC || c.footT >= 2) {
      this.caught(p, c);
      return;
    }

    // ---- Kaçış / soğuma ----
    if (c.agents.size) {
      if (nearest > R.ESCAPE_DIST) c.escapeT += dt;
      else c.escapeT = 0;
      if (c.escapeT >= R.ESCAPE_SEC) {
        for (const id of c.agents.keys()) this.logi.removeAgent(id);
        c.agents.clear();
        c.heat = Math.min(c.heat, 15);
        c.lastStars = heatStars(c.heat);
        c.escapeT = 0;
        c.sides = [];
        this.stats.escaped++;
        this.radio(p, '📻 "Merkez… şüpheliyi kaybettik. Takip bırakıldı." — kurtuldun!', 'info');
      }
    } else {
      c.escapeT = 0;
      const moving = driving && inRegion && !yardAt(x, z) && kmh > 3;
      if (!moving && c.heat < 40) c.heat = Math.max(0, c.heat - R.DECAY * dt);
    }
    if (!c.job && !c.agents.size && c.heat <= 0) {
      this.endChase(c.pid);
      return;
    }

    // ---- Oyuncuya durum (≤4 Hz, değişince) ----
    if (now - c.lastOut >= 250) {
      const v = this.chaseView(c, now);
      const key = JSON.stringify([v.heat, v.sides, v.catchIn, v.pullIn, v.escapeIn, v.police, v.civil, v.loaded]);
      if (key !== c.lastKey) {
        c.lastKey = key;
        c.lastOut = now;
        this.sim.toPlayer(p.id, EVT.ILLEGAL_STATE, { chase: v });
      }
    }
  }
}

export { CONTACT, SAFE_DROP };

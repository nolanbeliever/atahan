import { HOTEL_DELIVERY, SERVICE_YARD, SITE_BY_ID } from '../../shared/worldmap.js';
import { ILLEGAL_RULES as IR, SAFE_DROP, DROP_SITES, RAID_RULES as R, raidChance, slotPoint } from '../../shared/illegal.js';

const r2 = (v) => Math.round(v * 100) / 100;
const inRect = (b, x, z, tol = 0) => x > b.minX - tol && x < b.maxX + tol && z > b.minZ - tol && z < b.maxZ + tol;

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

// Baskın ekibinin körfezdeki yerleri (tırın çekicisine göre; isimler IllegalLogistics'in kıskaç yuvalarıyla aynı)
const RAID_SLOTS = Object.freeze([
  Object.freeze({ slot: 'front', f: 9, r: 0 }),
  Object.freeze({ slot: 'rear', f: -18, r: 0 }),
  Object.freeze({ slot: 'left', f: -2, r: -4.6 }),
]);

/**
 * Kaçak yük indirme + polis baskını (sunucu yetkili). IllegalLogisticsService.drop() buraya devreder.
 *
 *  - İndirme: tır teslim yerinde (🏚️ Eski Kantar Deposu ya da 🏨 otelin mal kabul alanı) DURURKEN
 *    RAID_RULES.UNLOAD_MS (10 sn) sürer. Tır bölgeden çıkarsa indirme yarıda kalır (yük tırda kalır).
 *  - Baskın olasılığı başta bir kez çekilir (servisin kendi PRNG'si): yer (depo 0.12, otel 0.35) × gece 0.6
 *    + ısı/100 × 0.4 (en çok 0.85). Oyuncuya önceden söylenmez.
 *  - Baskın: indirme başladıktan 1.5–4 sn sonra telsiz uyarısı ("🚨 Baskın!") gelir; 3 ekip
 *    avlu kapısının gerisinden çıkıp 7 sn'de körfeze (tırın önü / arkası / yanı) varır (logistics.setAgent ile
 *    çizilir). Varış indirmenin bitişinden önceyse ve tır hâlâ oradaysa → yakalanma: mallara el konur, cüzdandan
 *    ceza (0'ın altına inmez); otelin avlusundaysa otel itibarı −3 ve herkese duyuru. İndirme önce biterse →
 *    kazanç ödenir, ekipler boş körfeze varır (ısı +12). Uyarıdan sonra tır kaçarsa → ekipler kıskaç takibine
 *    devrolur (IllegalLogisticsService, ısı en az 70). Şiddet yok.
 *  - config.policeRaids === false → baskın olasılığı 0 (testler). Test / hata ayıklama: forceNext = 'raid' | 'none'.
 */
export class PoliceRaidService {
  constructor(sim) {
    this.sim = sim;
    this.rand = prng(0x7a1d ^ (sim.config.raidSeed ?? 0));
    this.sessions = new Map(); // oyuncu id → indirme oturumu
    this.forceNext = null;
    this.seq = 1;
    this.stats = { unloads: 0, raids: 0, busted: 0, fled: 0, late: 0 };
  }

  get illegal() { return this.sim.illegal; }
  get logi() { return this.sim.logistics; }

  restore(data) {
    const s = data?.stats;
    if (s && typeof s === 'object') for (const k of Object.keys(this.stats)) if (Number.isFinite(s[k]) && s[k] >= 0) this.stats[k] = s[k];
  }

  persisted() {
    return { stats: { ...this.stats } };
  }

  zoneOf(site) { return site === 'hotel' ? HOTEL_DELIVERY.zone : SAFE_DROP.zone; }

  /** Baskın ekibinin çıktığı yer: teslim yerinin avlu kapısı (yol tarafı) */
  gateOf(site) {
    const g = site === 'hotel' ? SERVICE_YARD.exit : SITE_BY_ID[SAFE_DROP.site]?.gate;
    return g ? { x: g[0], z: g[1] } : null;
  }

  /** Oyuncuya görünen durum: baskın, uyarı gelene kadar gizlidir */
  view(p, now = this.sim.now()) {
    const s = this.sessions.get(p.id);
    if (!s) return null;
    return {
      site: s.site, start: s.start, end: s.end, ms: R.UNLOAD_MS,
      raid: s.warned ? { arriveAt: s.arriveAt, units: s.units.length } : null,
      now,
    };
  }

  /** IllegalLogisticsService.drop() doğrulamasından sonra: indirmeyi başlat, baskın zarını at */
  start(p, job, site, now) {
    const cur = this.sessions.get(p.id);
    if (cur) return { ok: false, error: 'İndirme zaten sürüyor — tır yerinde dursun.' };
    const heat = this.illegal.chases.get(p.id)?.heat ?? 0;
    const chance = this.sim.config.policeRaids === false ? 0 : raidChance(site, heat, this.illegal.night);
    const roll = this.rand();
    const raid = this.forceNext === 'raid' ? true : this.forceNext === 'none' ? false : roll < chance;
    this.forceNext = null;
    const warnAt = raid ? now + R.WARN_MIN_MS + this.rand() * (R.WARN_MAX_MS - R.WARN_MIN_MS) : 0;
    const s = {
      pid: p.id, jobId: job.id, vehicleId: job.vehicleId, site, start: now, end: now + R.UNLOAD_MS, chance,
      raid, warnAt, arriveAt: raid ? warnAt + R.ETA_MS : 0, warned: false, units: [], heat,
    };
    this.sessions.set(p.id, s);
    this.stats.unloads++;
    this.illegal.sendPrivate(p);
    const where = DROP_SITES[site];
    return { ok: true, unloading: true, ms: R.UNLOAD_MS, site, text: `📦 ${where.icon} ${where.name}: mallar indiriliyor… (${R.UNLOAD_MS / 1000} sn — tır yerinde dursun)` };
  }

  shiftTime(deltaMs) {
    for (const s of this.sessions.values()) {
      s.start += deltaMs;
      s.end += deltaMs;
      if (s.warnAt) s.warnAt += deltaMs;
      if (s.arriveAt) s.arriveAt += deltaMs;
    }
  }

  removePlayer(p) {
    this.stop(p.id);
  }

  /** Oturumu bitir; keepUnits: ekipler takibe devredildi (kaldırma) */
  stop(pid, keepUnits = false) {
    const s = this.sessions.get(pid);
    if (!s) return;
    if (!keepUnits) for (const u of s.units) this.logi.removeAgent(u.id);
    this.sessions.delete(pid);
  }

  /** Uyarı: ekipler avlu kapısının gerisinde belirir */
  warn(p, s, st, now) {
    s.warned = true;
    this.stats.raids++;
    const gate = this.gateOf(s.site) ?? { x: st.x + 40, z: st.z };
    // Kapıdan körfeze doğru yön; ekipler kapının SPAWN_BACK gerisinden gelir
    const dx = st.x - gate.x;
    const dz = st.z - gate.z;
    const d = Math.hypot(dx, dz) || 1;
    const back = { x: gate.x - (dx / d) * R.SPAWN_BACK, z: gate.z - (dz / d) * R.SPAWN_BACK };
    s.units = RAID_SLOTS.slice(0, R.UNITS).map((sl, k) => {
      const tg = slotPoint(sl, st.x, st.z, st.yaw);
      const from = { x: back.x - (dx / d) * k * 9, z: back.z - (dz / d) * k * 9 };
      const u = { id: `raid-${p.id}-${this.seq++}`, slot: sl.slot, from, to: tg, x: from.x, z: from.z, yaw: Math.atan2(-(tg.x - from.x), -(tg.z - from.z)), speed: 0 };
      this.logi.setAgent(u.id, { kind: 'police', x: u.x, z: u.z, yaw: u.yaw, speed: 0, label: 'Baskın ekibi' });
      return u;
    });
    const where = DROP_SITES[s.site];
    this.illegal.radio(p, `🚨 Baskın! "Tüm ekipler ${where.icon} ${where.name} önüne — kaçak mal indiriliyor!" Ekipler ${Math.round(R.ETA_MS / 1000)} sn içinde burada. İndirmeyi bitir ya da kaç!`);
    this.illegal.sendPrivate(p);
  }

  /** Ekipler: kapıdan körfeze düz (avlu açık alan), varışa doğru yavaşlayarak */
  moveUnits(s, now) {
    const k = Math.max(0, Math.min(1, (now - s.warnAt) / R.ETA_MS));
    const e = 1 - (1 - k) * (1 - k); // varışa doğru yavaşlar
    for (const u of s.units) {
      const nx = u.from.x + (u.to.x - u.from.x) * e;
      const nz = u.from.z + (u.to.z - u.from.z) * e;
      const moved = Math.hypot(nx - u.x, nz - u.z);
      if (moved > 0.02) u.yaw = Math.atan2(-(nx - u.x), -(nz - u.z));
      u.speed = r2(moved * 10);
      u.x = nx;
      u.z = nz;
      this.logi.setAgent(u.id, { kind: 'police', x: u.x, z: u.z, yaw: u.yaw, speed: u.speed, label: 'Baskın ekibi' });
    }
  }

  /** Baskın ekibi geldiğinde tır körfezdeyse: yakalanma (mallara el, ceza; otel avlusunda itibar −3) */
  bust(p, s, job) {
    this.stats.busted++;
    this.stop(p.id);
    this.illegal.confiscate(p, job, job.rams ?? 0, { site: s.site });
    if (s.site === 'hotel') {
      this.sim.growth.addReputation(-R.HOTEL_REP);
      this.sim.notify(`🚔 Polis otelin lojistik avlusuna baskın yaptı: ${p.name}'in tırındaki kaçak mallara el konuldu. Otelin itibarı zedelendi (−${R.HOTEL_REP}).`, 'warn');
    }
  }

  /** Uyarıdan sonra tır körfezden çıktı: ekipler kıskaç takibine devrolur, ısı en az FLEE_HEAT */
  flee(p, s, job) {
    this.stats.fled++;
    const c = this.illegal.chaseOf(p.id, true);
    c.job = job;
    for (const u of s.units) {
      c.agents.set(u.id, { id: u.id, kind: 'police', slot: u.slot, x: u.x, z: u.z, yaw: u.yaw, speed: u.speed, label: 'Polis' });
    }
    this.stop(p.id, true);
    if (c.heat < R.FLEE_HEAT) this.illegal.addHeat(p, c, R.FLEE_HEAT - c.heat);
    this.illegal.radio(p, '📻 "Şüpheli baskından kaçıyor — mallar hâlâ tırda! Peşine düşün!"');
    this.illegal.sendPrivate(p);
  }

  update(now) {
    for (const s of [...this.sessions.values()]) {
      const p = this.sim.players.get(s.pid);
      if (!p) {
        this.stop(s.pid);
        continue;
      }
      const job = this.logi.jobOf(p);
      if (!job || job.id !== s.jobId || job.state !== 'loaded') {
        this.stop(s.pid);
        this.illegal.sendPrivate(p);
        continue;
      }
      const st = this.logi.truckState(p);
      if (s.raid && !s.warned && now >= s.warnAt && st) this.warn(p, s, st, now);
      if (s.warned) this.moveUnits(s, now);
      const here = !!st && st.vehicleId === s.vehicleId && inRect(this.zoneOf(s.site), st.x, st.z, R.ZONE_TOL)
        && this.logi.speedOf(p, now) * 3.6 <= IR.STOP_KMH * 1.5;
      if (!here) {
        if (s.warned) this.flee(p, s, job);
        else {
          this.stop(s.pid);
          this.illegal.radio(p, '📦 İndirme yarıda kaldı — mallar hâlâ bölmede. Teslim yerinde durup tekrar E.', 'info');
          this.illegal.sendPrivate(p);
        }
        continue;
      }
      if (s.warned && now >= s.arriveAt) {
        this.bust(p, s, job);
        continue;
      }
      if (now >= s.end) {
        const seen = s.warned; // ekipler yoldaydı ama geç kaldı
        if (seen) this.stats.late++;
        this.stop(s.pid);
        this.illegal.finishDrop(p, job, s.site, now, { seen });
      }
    }
  }
}

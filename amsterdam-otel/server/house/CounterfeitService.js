import { EVT, formatMoney } from '../../shared/constants.js';
import { HOUSE_BY_ID, PLAYER_HOUSES } from '../../shared/layout.js';
import { PRESS, pressSpots } from '../../shared/counterfeit.js';

const str = (v) => (typeof v === 'string' ? v : '');
const near = (p, [x, z], range) => Math.hypot(p.x - x, p.z - z) <= range;
const REACH = PRESS.RANGE + 1;

/**
 * Ev matbaası (sahte para) + polis baskını — sunucu yetkili.
 *  - Ev sahibi Achterstraat'taki evine matbaa kurar (€600, cüzdandan). Matbaanın başında "Bas" →
 *    PRESS.BATCH_MS sonra PRESS.BATCH_VALUE € oyuncunun KİŞİSEL cüzdanına (otel kasasına değil).
 *  - Her partide PRESS.RAID_CHANCE ihtimalle, partinin ortalarında bir anda POLİS BASKINI uyarısı:
 *    15 sn içinde ya matbaanın başında "Gizle" (2 sn basılı tut: makine + para örtülür) ya da evin batı
 *    duvarındaki gizli bölmeye kaçılmalı. Polis kapıya gelince arar: gizlenmediysen ceza (cüzdandan en
 *    fazla €1.000), parti yanar ve matbaa 1 oyun günü mühürlenir; gizlendiysen eli boş döner ve baskı
 *    kaldığı yerden sürer.
 *  - Kalıcı: hangi evde matbaa var, mühür bitişi. Süren parti / baskın kaydedilmez (yeniden başlatmada iptal).
 * Zamanlayıcı yok: HotelSimulation.tick → update(now).
 */
export class CounterfeitService {
  constructor(sim) {
    this.sim = sim;
    this.presses = new Map(); // houseId → { seizedUntilDay, batch: { endsAt, leftMs?, raidAt } | null, raid }
  }

  get rng() { return this.sim.rng; }

  // ---- Kalıcılık / yayın ---------------------------------------------------------------

  persisted() {
    const out = {};
    for (const [id, pr] of this.presses) out[id] = { seizedUntilDay: pr.seizedUntilDay };
    return out;
  }

  restore(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    for (const h of PLAYER_HOUSES) {
      const raw = Object.prototype.hasOwnProperty.call(data, h.id) ? data[h.id] : null;
      if (!raw || typeof raw !== 'object') continue;
      const seized = Number.isInteger(raw.seizedUntilDay) && raw.seizedUntilDay >= 0 && raw.seizedUntilDay < 1e6 ? raw.seizedUntilDay : 0;
      this.presses.set(h.id, { seizedUntilDay: seized, batch: null, raid: null });
    }
  }

  /** Ev boşaltılınca (HouseService.evict) matbaa da gider */
  clear(houseId) {
    if (this.presses.delete(houseId)) this.changed();
  }

  publicState(houseId, pr) {
    const seized = pr.seizedUntilDay > this.sim.clock.dayCount;
    const b = pr.batch;
    return {
      houseId,
      seized,
      printing: b ? { endsAt: b.endsAt, leftMs: b.leftMs ?? null } : null,
      raid: pr.raid ? { endsAt: pr.raid.endsAt, stashed: pr.raid.stashed, hidden: [...pr.raid.hidden], police: pr.raid.police } : null,
    };
  }

  serialize() {
    return [...this.presses].map(([id, pr]) => this.publicState(id, pr));
  }

  changed() {
    this.sim.out(EVT.COUNTERFEIT_STATE, this.serialize());
    this.sim.house.scheduleSave();
  }

  // ---- Eylemler -------------------------------------------------------------------------

  /** Oyuncunun içinde bulunduğu kendi evi (değilse hata metni) */
  ownHouse(p) {
    const houseId = this.sim.house.houseIdOf(p);
    if (!houseId) return { error: 'Achterstraat\'ta bir evin olmalı.' };
    const def = HOUSE_BY_ID[houseId];
    if (!this.sim.house.inHouse(p, def)) return { error: 'Bunun için kendi evinin içinde olmalısın.' };
    return { houseId, def, spots: pressSpots(def) };
  }

  /**
   * { act: 'buy' | 'print' | 'stash' (step: 'begin'|'finish') | 'hide' | 'unhide' }
   */
  act(p, data, now) {
    const act = str(data?.act);
    if (act === 'unhide') return this.unhide(p);
    const own = this.ownHouse(p);
    if (own.error) return { ok: false, error: own.error };
    const { houseId, spots } = own;
    const pr = this.presses.get(houseId);
    switch (act) {
      case 'buy': {
        if (pr) return { ok: false, error: 'Evinde zaten bir matbaa var.' };
        if (!near(p, spots.pressPoint, REACH)) return { ok: false, error: 'Kurulum köşesine yaklaş.' };
        if (!(p.wallet >= PRESS.PRICE)) return { ok: false, error: `Matbaa için cüzdanında ${formatMoney(PRESS.PRICE)} olmalı.` };
        p.wallet -= PRESS.PRICE;
        this.sim.shop.sendSelf(p);
        this.presses.set(houseId, { seizedUntilDay: 0, batch: null, raid: null });
        this.changed();
        return { ok: true };
      }
      case 'print': {
        if (!pr) return { ok: false, error: 'Önce matbaayı kur.' };
        if (pr.seizedUntilDay > this.sim.clock.dayCount) return { ok: false, error: 'Matbaa polis tarafından mühürlendi — yarın tekrar dene.' };
        if (pr.batch || pr.raid) return { ok: false, error: 'Makine zaten çalışıyor.' };
        if (!near(p, spots.pressPoint, REACH)) return { ok: false, error: 'Matbaaya yaklaş.' };
        const raid = this.rng() < PRESS.RAID_CHANCE;
        const raidAt = raid ? now + PRESS.BATCH_MS * (PRESS.RAID_FROM + this.rng() * (PRESS.RAID_TO - PRESS.RAID_FROM)) : null;
        pr.batch = { endsAt: now + PRESS.BATCH_MS, raidAt, owner: p.keyHash };
        this.changed();
        return { ok: true, endsAt: pr.batch.endsAt };
      }
      case 'stash': {
        const r = pr?.raid;
        if (!r || r.police) return { ok: false, error: 'Şu an gizlenecek bir şey yok.' };
        if (r.stashed) return { ok: false, error: 'Zaten gizledin.' };
        if (!near(p, spots.pressPoint, REACH)) return { ok: false, error: 'Matbaaya yaklaş.' };
        const step = data?.step;
        if (step === 'begin') {
          r.stashing = { id: p.id, at: now };
          return { ok: true, ms: PRESS.STASH_MS };
        }
        if (step !== 'finish') return { ok: false, error: 'Geçersiz işlem.' };
        if (r.stashing?.id !== p.id) return { ok: false, error: 'Önce gizlemeye başla.' };
        if (now - r.stashing.at < PRESS.STASH_MS - 250) return { ok: false, error: 'Acele etme — iyice ört!' };
        r.stashed = true;
        r.stashing = null;
        this.changed();
        return { ok: true };
      }
      case 'hide': {
        const r = pr?.raid;
        if (!r || r.police) return { ok: false, error: 'Saklanacak bir sebep yok.' };
        if (!near(p, spots.hidePoint, REACH)) return { ok: false, error: 'Gizli bölmeye yaklaş.' };
        const [x, z] = spots.hideSpot;
        p.x = x;
        p.z = z;
        p.hiding = { houseId, x, z };
        r.hidden.add(p.id);
        this.sim.dirtyPlayers.add(p.id);
        this.changed();
        return { ok: true, x, z };
      }
      default:
        return { ok: false, error: 'Geçersiz işlem.' };
    }
  }

  unhide(p) {
    const h = p.hiding;
    if (!h) return { ok: true };
    p.hiding = null;
    this.presses.get(h.houseId)?.raid?.hidden.delete(p.id);
    this.changed();
    return { ok: true };
  }

  /** HotelSimulation.movePlayer: bölmedeyken yürüyen oyuncu bölmeden çıkar */
  onMove(p) {
    const h = p.hiding;
    if (h && Math.hypot(p.x - h.x, p.z - h.z) > PRESS.HIDE_MOVE) this.unhide(p);
  }

  removePlayer(p) {
    this.unhide(p);
    // Sahibi oyundan çıkarsa süren parti iptal (baskın da kapanır)
    const houseId = this.sim.house.houseIdOf(p);
    const pr = houseId && this.presses.get(houseId);
    if (pr && (pr.batch || pr.raid)) {
      pr.batch = null;
      pr.raid = null;
      this.changed();
    }
  }

  // ---- Döngü -------------------------------------------------------------------------

  update(now) {
    for (const [houseId, pr] of this.presses) {
      if (pr.raid) {
        this.updateRaid(houseId, pr, now);
        continue;
      }
      const b = pr.batch;
      if (!b) continue;
      if (b.raidAt !== null && now >= b.raidAt) {
        this.startRaid(houseId, pr, now);
        continue;
      }
      if (now >= b.endsAt) this.payout(houseId, pr);
    }
  }

  ownerOf(houseId) {
    return this.sim.house.onlineOwner(houseId);
  }

  payout(houseId, pr) {
    pr.batch = null;
    const p = this.ownerOf(houseId);
    if (p) {
      p.wallet += PRESS.BATCH_VALUE;
      this.sim.shop.sendSelf(p);
      this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `🖨️ Parti hazır: +${formatMoney(PRESS.BATCH_VALUE)} cüzdanına. (Dikkat: her baskıda polis riski var!)`, kind: 'money' });
    }
    this.changed();
  }

  startRaid(houseId, pr, now) {
    // Kalan baskı süresi saklanır; baskın atlatılırsa kaldığı yerden sürer
    pr.batch.leftMs = Math.max(0, pr.batch.endsAt - now);
    pr.batch.raidAt = null;
    pr.raid = { endsAt: now + PRESS.WARNING_MS, stashed: false, hidden: new Set(), stashing: null, police: false };
    const def = HOUSE_BY_ID[houseId];
    const p = this.ownerOf(houseId);
    if (p) this.sim.toPlayer(p.id, EVT.NOTIFY, { text: '🚨 POLİS BASKINI! 15 saniyen var: matbaayı gizle ya da gizli bölmeye kaç!', kind: 'warn' });
    this.sim.notify(`🚨 Achterstraat'ta siren sesleri… polis ${def.name} kapısına geliyor!`, 'warn');
    this.changed();
  }

  updateRaid(houseId, pr, now) {
    const r = pr.raid;
    if (now < r.endsAt) return;
    if (!r.police) {
      this.resolveRaid(houseId, pr, now);
      return;
    }
    // Polis aramayı bitirip gider
    pr.raid = null;
    for (const pl of this.sim.players.values()) if (pl.hiding?.houseId === houseId) pl.hiding = null;
    if (pr.batch) {
      if (r.caught) pr.batch = null;
      else pr.batch.endsAt = now + (pr.batch.leftMs ?? 0);
      if (pr.batch) pr.batch.leftMs = null;
    }
    this.changed();
  }

  resolveRaid(houseId, pr, now) {
    const r = pr.raid;
    const p = this.ownerOf(houseId);
    const ownerHidden = !!p && r.hidden.has(p.id);
    const safe = r.stashed || ownerHidden;
    r.police = true;
    r.endsAt = now + PRESS.POLICE_MS;
    r.caught = !safe;
    const def = HOUSE_BY_ID[houseId];
    if (safe) {
      const how = r.stashed ? 'Matbaa ve para örtünün altında' : 'Sen gizli bölmedeyken';
      if (p) this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `😮‍💨 ${how} polis bir şey bulamadı ve gitti. Baskı kaldığı yerden sürüyor.`, kind: 'info' });
      this.sim.notify(`👮 Polis ${def.name}'te arama yaptı ama eli boş döndü.`, 'info');
    } else {
      const fine = p ? Math.min(PRESS.FINE, Math.max(0, Math.floor(p.wallet))) : 0;
      if (p && fine > 0) {
        p.wallet -= fine;
        this.sim.shop.sendSelf(p);
      }
      pr.seizedUntilDay = this.sim.clock.dayCount + PRESS.SEIZE_DAYS;
      if (p) {
        this.sim.toPlayer(p.id, EVT.NOTIFY, {
          text: `🚔 Yakalandın! Cüzdanından ${formatMoney(fine)} ceza kesildi, parti yandı ve matbaa ${PRESS.SEIZE_DAYS} gün mühürlendi.`,
          kind: 'warn',
        });
      }
      this.sim.notify(`🚔 Polis ${def.name}'te sahte para matbaası buldu!`, 'warn');
    }
    this.sim.out(EVT.COUNTERFEIT_RAID, { houseId, safe, x: def.doorPoint[0], z: def.doorPoint[1], until: r.endsAt });
    this.changed();
  }

  /** İstemcinin görsel isteği için: bu ev dolu mu (testler) */
  hasPress(houseId) { return this.presses.has(houseId); }
}

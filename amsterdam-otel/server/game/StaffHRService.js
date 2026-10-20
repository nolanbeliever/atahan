import { EVT } from '../../shared/constants.js';
import { workerLevel } from '../../shared/hotel.js';
import { staffLevel } from '../../shared/restaurant.js';
import {
  HR_RULES as R, HR_ROLE_IDS, OUTFITS, hrKey, moraleSpeedMul, performanceScore, perfStars,
} from '../../shared/staffhr.js';

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Personel Yönetimi 2.0 — bütün çalışanların İK kaydı (sunucu yetkili).
 *  - Kayıt anahtarı `${rol}:${isim}`: temizlikçi (WorkerService), aşçı / garson (KitchenStaffService),
 *    barmen (BarStaffService), bouncer (BouncerService). NPC'lerin kendisi kendi servislerinde yaşar;
 *    burada üniforma, moral, prim ve günlük performans tutulur.
 *  - Üniforma: role göre renk / stil (NPC'nin wire'ında `outfit: { c, a }`, herkes görür).
 *  - Moral (0–100): iş hızını etkiler (moraleSpeedMul); son 2 günde prim almayanın morali her gün düşer,
 *    hatalar da biraz düşürür. Prim (€25 / €50 / €100, OTEL KASASINDAN, kişi başı günde bir) morali yükseltir
 *    ve bugün + yarın %10 hız takviyesi verir.
 *  - Performans (0–100 → 1–5★): bugünkü iş sayısı (hedefe göre), müşteri puanları ve hatalar.
 *  - Resepsiyon PC → 👥 Personel 2.0: herkesi işe al / çıkar, üniforma, prim, performans.
 */
export class StaffHRService {
  constructor(sim) {
    this.sim = sim;
    this.records = new Map(); // key → { outfit, morale, bonusDay, boostUntil, base, mistakes, ratingSum, ratingN, lastScore }
    this.lastSig = '';
    this.nextBroadcastAt = 0;
  }

  get day() { return this.sim.clock.dayCount; }

  // ---- Çalışan listesi (kendi servislerinden) --------------------------------------------------------

  /** @returns [{ role, name, id, tasks, level, doing, svc, npc }] */
  members() {
    const out = [];
    const sim = this.sim;
    for (const w of sim.workers.workers.values()) {
      out.push({ role: 'worker', name: w.name, id: w.id, tasks: w.tasks, level: workerLevel(w.tasks), doing: w.roomId ? `Oda ${w.roomId}` : null, svc: sim.workers, npc: w });
    }
    for (const s of sim.kitchen.staff.values()) {
      out.push({ role: s.role, name: s.name, id: s.id, tasks: s.tasks, level: staffLevel(s.tasks), doing: s.job ? s.label : null, svc: sim.kitchen, npc: s });
    }
    for (const s of sim.barStaff?.staff.values() ?? []) {
      out.push({ role: 'barman', name: s.name, id: s.id, tasks: s.tasks, level: staffLevel(s.tasks), doing: s.job ? s.label : null, svc: sim.barStaff, npc: s });
    }
    for (const s of sim.bouncer?.staff.values() ?? []) {
      out.push({ role: 'bouncer', name: s.name, id: s.id, tasks: s.tasks, level: staffLevel(s.tasks), doing: s.checking ? 'kontrol ediyor' : s.post === 0 ? 'kapıda' : 'kenarda', svc: sim.bouncer, npc: s });
    }
    return out;
  }

  member(role, name) { return this.members().find((m) => m.role === role && m.name === name) ?? null; }

  /** İK kaydı (yoksa varsayılanla oluşturulur) */
  rec(role, name, tasks = null) {
    const key = hrKey(role, name);
    let r = this.records.get(key);
    if (!r) {
      r = {
        outfit: 0, morale: R.MORALE_START, bonusDay: -99, boostUntil: -99,
        base: tasks ?? this.member(role, name)?.tasks ?? 0, mistakes: 0, ratingSum: 0, ratingN: 0, lastScore: null,
      };
      this.records.set(key, r);
    }
    return r;
  }

  // ---- Diğer servislerin kancaları ---------------------------------------------------------------------

  /** İş süresi çarpanı (küçük = hızlı) */
  speedMul(role, name) {
    const r = this.records.get(hrKey(role, name));
    if (!r) return moraleSpeedMul(R.MORALE_START, false);
    return moraleSpeedMul(r.morale, r.boostUntil >= this.day);
  }

  /** NPC'nin üniforması { c, a } (wire'da; istemci gövde / önlük rengini değiştirir) */
  outfitOf(role, name) {
    const list = OUTFITS[role];
    if (!list) return null;
    const r = this.records.get(hrKey(role, name));
    const o = list[r?.outfit ?? 0] ?? list[0];
    return { c: o.c, a: o.a };
  }

  /** Müşteri / iş puanı (1–5) */
  rate(role, name, stars) {
    if (!Number.isFinite(stars)) return;
    const r = this.rec(role, name);
    r.ratingSum += Math.min(5, Math.max(1, stars));
    r.ratingN += 1;
  }

  /** Hata: performans ve moral düşer */
  mistake(role, name) {
    const r = this.rec(role, name);
    r.mistakes += 1;
    r.morale = Math.max(R.MORALE_MIN, r.morale - R.MISTAKE_MORALE);
  }

  // ---- Oyuncu işlemleri (Resepsiyon PC → Personel 2.0) -----------------------------------------------------

  act(p, data) {
    const act = str(data?.act);
    const role = str(data?.role);
    if (!HR_ROLE_IDS.includes(role)) return { ok: false, error: 'Geçersiz pozisyon.' };
    let res;
    if (act === 'hire') res = this.hire(p, role);
    else if (act === 'fire') res = this.fire(p, role, data);
    else if (act === 'outfit') res = this.setOutfit(p, role, data);
    else if (act === 'bonus') res = this.bonus(p, role, data);
    else return { ok: false, error: 'Geçersiz işlem.' };
    if (res.ok) this.changed();
    return res;
  }

  hire(p, role) {
    const sim = this.sim;
    if (role === 'worker') return sim.workers.hire(p);
    if (role === 'chef' || role === 'waiter') return sim.kitchen.hire(p, { role });
    if (role === 'barman') return sim.barStaff.hire(p);
    return sim.bouncer.hire(p);
  }

  fire(p, role, data) {
    const id = data?.id;
    if (!Number.isInteger(id)) return { ok: false, error: 'Böyle bir çalışan yok.' };
    const m = this.members().find((x) => x.role === role && x.id === id);
    if (!m) return { ok: false, error: 'Böyle bir çalışan yok.' };
    const res = role === 'worker' || role === 'chef' || role === 'waiter' || role === 'barman' || role === 'bouncer'
      ? m.svc.fire(p, { id })
      : { ok: false };
    if (res.ok) this.records.delete(hrKey(role, m.name));
    return res;
  }

  /** İşlemin yapılacağı çalışan (PC başında olmak gerekir) */
  target(p, role, data) {
    if (!this.sim.growth.nearPc(p)) return { error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    const m = this.member(role, str(data?.name));
    if (!m) return { error: 'Böyle bir çalışan yok.' };
    return { m, r: this.rec(role, m.name) };
  }

  setOutfit(p, role, data) {
    const t = this.target(p, role, data);
    if (t.error) return { ok: false, error: t.error };
    const k = data.outfit;
    const list = OUTFITS[role];
    if (!Number.isInteger(k) || k < 0 || k >= list.length) return { ok: false, error: 'Geçersiz üniforma.' };
    t.r.outfit = k;
    t.m.svc.broadcast(t.m.npc); // NPC'nin görünüşü herkeste değişsin
    this.sim.house.scheduleSave();
    return { ok: true, outfit: k };
  }

  bonus(p, role, data) {
    const t = this.target(p, role, data);
    if (t.error) return { ok: false, error: t.error };
    const b = R.BONUSES.find((x) => x.amount === data.amount);
    if (!b) return { ok: false, error: 'Geçersiz prim.' };
    if (t.r.bonusDay === this.day) return { ok: false, error: `${t.m.name} bugün zaten prim aldı.` };
    if (this.sim.money < b.amount) return { ok: false, error: `Kasada yeterli para yok (€${b.amount} gerekiyor).` };
    this.sim.spend(b.amount, `💶 ${t.m.name} için günlük prim`);
    t.r.bonusDay = this.day;
    t.r.boostUntil = this.day + 1;
    t.r.morale = Math.min(R.MORALE_MAX, t.r.morale + b.morale);
    this.sim.notify(`💶 ${p.name}, ${t.m.name}'e €${b.amount} prim verdi — morali yükseldi, bugün ve yarın daha hızlı çalışacak!`, 'info');
    this.sim.house.scheduleSave();
    return { ok: true, morale: t.r.morale };
  }

  // ---- Gün ---------------------------------------------------------------------------------------------

  onNewDay() {
    const day = this.day;
    const live = new Set();
    for (const m of this.members()) {
      const key = hrKey(m.role, m.name);
      live.add(key);
      const r = this.rec(m.role, m.name, m.tasks);
      r.lastScore = performanceScore(m.role, this.todayOf(m, r));
      if (r.bonusDay < day - 2) r.morale = Math.max(R.MORALE_MIN, r.morale - R.MORALE_DECAY);
      r.base = m.tasks;
      r.mistakes = 0;
      r.ratingSum = 0;
      r.ratingN = 0;
    }
    for (const key of [...this.records.keys()]) if (!live.has(key)) this.records.delete(key); // ayrılanlar
    this.changed();
  }

  todayOf(m, r) {
    return { tasks: Math.max(0, m.tasks - r.base), mistakes: r.mistakes, ratingSum: r.ratingSum, ratingN: r.ratingN };
  }

  // ---- Kalıcılık ------------------------------------------------------------------------------------------

  persisted() {
    const out = {};
    for (const [key, r] of this.records) out[key] = { ...r };
    return { day: this.day, records: out };
  }

  restore(d) {
    if (!d || typeof d !== 'object' || !d.records || typeof d.records !== 'object') return;
    const num = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
    const int = (v, def) => (Number.isInteger(v) ? v : def);
    for (const [key, raw] of Object.entries(d.records).slice(0, 200)) {
      const [role, name] = key.split(':');
      if (!HR_ROLE_IDS.includes(role) || !name || !raw || typeof raw !== 'object') continue;
      this.records.set(hrKey(role, name), {
        outfit: Math.min(int(raw.outfit, 0), OUTFITS[role].length - 1),
        morale: num(raw.morale, 0, 100, R.MORALE_START),
        bonusDay: int(raw.bonusDay, -99),
        boostUntil: int(raw.boostUntil, -99),
        base: Math.max(0, int(raw.base, 0)),
        mistakes: Math.max(0, int(raw.mistakes, 0)),
        ratingSum: num(raw.ratingSum, 0, 1e6, 0),
        ratingN: Math.max(0, int(raw.ratingN, 0)),
        lastScore: Number.isFinite(raw.lastScore) ? raw.lastScore : null,
      });
    }
  }

  // ---- Yayın ---------------------------------------------------------------------------------------------

  serialize() {
    const day = this.day;
    return {
      day,
      staff: this.members().map((m) => {
        const r = this.rec(m.role, m.name, m.tasks);
        const t = this.todayOf(m, r);
        const score = performanceScore(m.role, t);
        return {
          role: m.role, name: m.name, id: m.id, level: m.level, tasks: m.tasks, doing: m.doing,
          today: { tasks: t.tasks, mistakes: t.mistakes, rating: t.ratingN ? Math.round((t.ratingSum / t.ratingN) * 10) / 10 : null, ratings: t.ratingN },
          score, stars: perfStars(score), lastScore: r.lastScore,
          morale: Math.round(r.morale), outfit: r.outfit, bonusToday: r.bonusDay === day, boosted: r.boostUntil >= day,
        };
      }),
    };
  }

  changed() {
    const s = this.serialize();
    this.lastSig = JSON.stringify(s);
    this.sim.out(EVT.STAFF_STATE, s);
  }

  /** İş sayıları / puanlar değişince en fazla R.BROADCAST_MS'de bir yayınla */
  update(now) {
    if (now < this.nextBroadcastAt) return;
    this.nextBroadcastAt = now + R.BROADCAST_MS;
    const s = this.serialize();
    const sig = JSON.stringify(s);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.sim.out(EVT.STAFF_STATE, s);
  }
}

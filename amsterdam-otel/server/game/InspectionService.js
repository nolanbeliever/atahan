import {
  EVT, ROOM_STATUS, GUEST_SPEED, roomFloor, formatMoney,
} from '../../shared/constants.js';
import {
  POINTS, RECEPTION, EXTINGUISHERS, BAR_SPILL,
} from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';
import { INSPECTION as I, REPUTATION, inspectionChance } from '../../shared/hotel.js';
import { INSPECTION_EXT_MAX } from '../../shared/architecture.js';

const EXT_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(EXTINGUISHERS.map((e) => [e.id, e]))));
const INSPECTOR_SPOT = [-5.1, 5.4]; // resepsiyonun önü (check-in noktasının biraz güneyi)

/**
 * Belediye denetimi. Otel 2★ olunca hafta içi günlerde (yıldız ve kat arttıkça daha sık)
 * 10:00–17:00 arasında bir müfettiş gelir; oyuncular Resepsiyon PC'den de çağırabilir (günde bir).
 *  1. Müfettiş sokaktan resepsiyona yürür ('arriving').
 *  2. Varınca 90 sn geri sayım başlar ('countdown'). Bu sırada:
 *     - açık katlardaki kirli odalar temizlenmeli,
 *     - basıncı düşük görünen 2+ yangın tüpü kontrol edilmeli (basılı tut),
 *     - barda tezgâhta kirli bardak kalmamalı ve zemine dökülen şurup silinmeli.
 *  3. Süre dolunca sonuç: başarılı → kasaya ödül + Belediye Onay Plaketi + itibar;
 *     başarısız → kasadan €300 ceza ve bir yıldız düşer. Müfettiş ayrılır.
 */
export class InspectionService {
  constructor(sim) {
    this.sim = sim;
    this.active = null; // { phase, endsAt, ext: {id: bool (kontrol gerekiyor)}, spill, inspector }
    this.plannedAt = null; // bugünün denetim dakikası (null: bugün yok)
    this.doneDay = -1; // en son denetim yapılan oyun günü (dayCount)
    this.lastResult = null;
  }

  get rng() { return this.sim.rng; }

  // ---- Planlama ------------------------------------------------------------------

  /** Yeni gün: olasılığa göre bugünkü denetimi planla */
  onNewDay() {
    this.plannedAt = null;
    const { clock, growth } = this.sim;
    if (clock.weekend) return;
    if (this.rng() >= inspectionChance(growth.stars, growth.floors)) return;
    this.plannedAt = I.FROM_MIN + Math.floor(this.rng() * (I.TO_MIN - I.FROM_MIN));
  }

  canStart() {
    const { clock, growth } = this.sim;
    if (this.active || clock.night || clock.weekend || !clock.checkinOpen) return false;
    if (growth.stars < I.MIN_STARS) return false;
    return this.doneDay !== clock.dayCount;
  }

  /** Resepsiyon PC: "Müfettişi çağır" */
  request(p) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    if (this.active) return { ok: false, error: 'Denetim zaten sürüyor.' };
    if (this.sim.growth.stars < I.MIN_STARS) return { ok: false, error: `Belediye ${I.MIN_STARS} yıldızdan küçük otelleri denetlemiyor.` };
    if (this.doneDay === this.sim.clock.dayCount) return { ok: false, error: 'Bugün zaten denetlendiniz — yarın tekrar dene.' };
    if (!this.canStart()) return { ok: false, error: 'Müfettiş yalnızca hafta içi, resepsiyon açıkken gelir.' };
    this.start(this.sim.now(), p.name);
    return { ok: true };
  }

  // ---- Akış ---------------------------------------------------------------------

  start(now, by = null) {
    const { clock } = this.sim;
    this.doneDay = clock.dayCount;
    this.plannedAt = null;
    // Kontrol edilecek tüpler: açık katlardakilerden 2 + ek kat başına 1 (en fazla 6: 12 kat 90 sn'ye sığsın)
    const open = EXTINGUISHERS.filter((e) => this.sim.growth.isFloorOpen(e.floor));
    const n = Math.min(open.length, INSPECTION_EXT_MAX, 2 + (this.sim.growth.floors - 1));
    const pool = [...open];
    const ext = Object.create(null);
    for (const e of open) ext[e.id] = false;
    for (let i = 0; i < n; i++) ext[pool.splice(Math.floor(this.rng() * pool.length), 1)[0].id] = true;
    const g = {
      id: this.sim.guests.nextId++,
      look: { body: 6, skin: Math.floor(this.rng() * 5), hair: 3, hat: true, bag: true },
      phase: 'i-arrive',
      path: [POINTS.streetWest, POINTS.doorOutside, POINTS.doorInside, INSPECTOR_SPOT].map((pt) => [pt[0], pt[1]]),
      t0: now,
      face: 0,
    };
    this.active = { phase: 'arriving', endsAt: now + (pathLength(g.path) / GUEST_SPEED) * 1000, ext, spill: true, inspector: g, checking: new Map() };
    this.broadcastInspector();
    this.sim.notify(`🏛️ Belediye müfettişi geliyor${by ? ` (${by} çağırdı)` : ''}! Resepsiyona varınca 90 saniyeniz olacak: odaları temizleyin, yangın tüplerini kontrol edin, barı toparlayın.`, 'warn');
    this.sim.hotelChanged();
  }

  inspectorWire() {
    const g = this.active?.inspector ?? this.leaving;
    if (!g) return null;
    return {
      id: g.id, kind: 'inspector', look: g.look, phase: g.phase, path: g.path, t0: g.t0,
      speed: GUEST_SPEED, face: g.face, sit: false, roomId: null, label: '🏛️ Belediye Müfettişi',
    };
  }

  broadcastInspector() {
    const w = this.inspectorWire();
    if (w) this.sim.out(EVT.GUEST_UPSERT, w);
  }

  update(now) {
    if (this.leaving && now >= this.leaving.endsAt) {
      this.sim.out(EVT.GUEST_REMOVE, this.leaving.id);
      this.leaving = null;
    }
    const a = this.active;
    if (!a) {
      if (this.plannedAt !== null && this.sim.clock.minute >= this.plannedAt && this.sim.players.size) {
        if (this.canStart()) this.start(now);
        else this.plannedAt = null;
      }
      return;
    }
    if (now < a.endsAt) return;
    if (a.phase === 'arriving') {
      a.phase = 'countdown';
      a.endsAt = now + I.COUNTDOWN_MS;
      const g = a.inspector;
      g.phase = 'i-wait';
      g.path = [[...INSPECTOR_SPOT]];
      g.t0 = now;
      g.face = 0;
      this.broadcastInspector();
      this.sim.notify('⏱️ Müfettiş resepsiyonda — denetim başladı! 90 saniye!', 'warn');
      this.sim.hotelChanged();
      return;
    }
    this.finish(now);
  }

  /** Kontrol listesi (canlı) */
  checks() {
    const a = this.active;
    const floors = this.sim.growth.floors;
    let dirty = 0;
    for (const r of this.sim.rooms.rooms.values()) {
      if (r.status === ROOM_STATUS.DIRTY && roomFloor(r.id) <= floors) dirty++;
    }
    const extLeft = a ? Object.values(a.ext).filter(Boolean).length : 0;
    const glasses = this.sim.bar.stools.filter((s) => s.glass === 'dirty').length;
    return {
      rooms: dirty === 0,
      extinguishers: extLeft === 0,
      bar: glasses === 0 && !(a?.spill),
      detail: { dirty, extLeft, glasses, spill: !!a?.spill },
    };
  }

  finish(now) {
    const a = this.active;
    const c = this.checks();
    const pass = c.rooms && c.extinguishers && c.bar;
    const { growth } = this.sim;
    this.active = null;
    let text;
    if (pass) {
      const reward = I.REWARD + I.REWARD_PER_STAR * growth.stars;
      growth.plaques += 1;
      this.sim.earn(reward, '🏛️ Belediye denetimi başarılı', { guest: false });
      growth.addReputation(REPUTATION.INSPECTION_PASS);
      text = `✅ Denetim başarılı! Belediye Onay Plaketi lobiye asıldı (${growth.plaques}. plaket) ve kasaya ${formatMoney(reward)} ödül geldi.`;
      this.lastResult = { pass, checks: { rooms: c.rooms, extinguishers: c.extinguishers, bar: c.bar }, reward };
    } else {
      const fine = Math.min(I.FINE, this.sim.money);
      if (fine > 0) this.sim.spend(fine, '🏛️ Belediye cezası');
      const lost = growth.loseStar();
      const why = [];
      if (!c.rooms) why.push(`${c.detail.dirty} kirli oda`);
      if (!c.extinguishers) why.push(`${c.detail.extLeft} kontrol edilmemiş yangın tüpü`);
      if (!c.bar) why.push(c.detail.spill ? 'barda dökülen şurup' : `tezgâhta ${c.detail.glasses} kirli bardak`);
      text = `❌ Denetim başarısız (${why.join(', ')}). Kasadan ${formatMoney(fine)} ceza${lost ? ' ve bir yıldız kaybı' : ''}.`;
      this.lastResult = { pass, checks: { rooms: c.rooms, extinguishers: c.extinguishers, bar: c.bar }, fine };
    }
    this.sim.notify(text, pass ? 'money' : 'warn');
    this.sim.out(EVT.INSPECTION_RESULT, { ...this.lastResult, text });
    // Müfettiş ayrılır
    const g = a.inspector;
    g.phase = 'i-leave';
    g.path = [INSPECTOR_SPOT, POINTS.doorInside, POINTS.doorOutside, POINTS.streetEast].map((pt) => [pt[0], pt[1]]);
    g.t0 = now;
    g.endsAt = now + (pathLength(g.path) / GUEST_SPEED) * 1000;
    this.leaving = g;
    this.broadcastInspector();
    this.sim.hotelChanged();
    this.sim.house.scheduleSave();
  }

  // ---- Oyuncu eylemleri: tüp kontrolü, şurup silme ---------------------------------------

  /**
   * { act: 'check', id, step: 'begin'|'finish' } — tüpün önünde en az CHECK_MS basılı tut
   * { act: 'mop', step: 'begin'|'finish' } — bar zeminindeki şurubu MOP_MS boyunca sil
   */
  act(p, data, now) {
    const a = this.active;
    if (!a || a.phase !== 'countdown') return { ok: false, error: 'Şu an denetim yok.' };
    const step = data?.step;
    if (step !== 'begin' && step !== 'finish') return { ok: false, error: 'Geçersiz işlem.' };
    let key;
    let point;
    let minMs;
    if (data.act === 'check') {
      const e = typeof data.id === 'string' ? EXT_BY_ID[data.id] : undefined;
      if (!e || !(e.id in a.ext)) return { ok: false, error: 'Geçersiz tüp.' };
      if (!a.ext[e.id]) return { ok: false, error: 'Bu tüp zaten kontrol edildi.' };
      key = `ext:${e.id}`;
      point = e.point;
      minMs = I.CHECK_MS;
    } else if (data.act === 'mop') {
      if (!a.spill) return { ok: false, error: 'Zemin zaten temiz.' };
      key = 'mop';
      point = BAR_SPILL.point;
      minMs = I.MOP_MS;
    } else {
      return { ok: false, error: 'Geçersiz işlem.' };
    }
    if (Math.hypot(p.x - point[0], p.z - point[1]) > I.RANGE + 1) return { ok: false, error: 'Biraz daha yaklaş.' };
    if (step === 'begin') {
      a.checking.set(p.id, { key, at: now });
      return { ok: true, ms: minMs };
    }
    const c = a.checking.get(p.id);
    if (!c || c.key !== key) return { ok: false, error: 'Önce işe başla.' };
    if (now - c.at < minMs - 250) return { ok: false, error: 'Acele etme — düzgün kontrol et!' };
    a.checking.delete(p.id);
    if (key === 'mop') a.spill = false;
    else a.ext[key.slice(4)] = false;
    this.sim.hotelChanged();
    return { ok: true };
  }

  removePlayer(p) {
    this.active?.checking.delete(p.id);
  }

  shiftTime(deltaMs) {
    if (this.active) {
      this.active.endsAt += deltaMs;
      this.active.inspector.t0 += deltaMs;
    }
    if (this.leaving) {
      this.leaving.endsAt += deltaMs;
      this.leaving.t0 += deltaMs;
    }
  }

  serialize() {
    const a = this.active;
    return {
      active: a ? {
        phase: a.phase,
        endsAt: a.endsAt,
        ext: { ...a.ext },
        spill: a.spill,
        checks: this.checks(),
      } : null,
      doneToday: this.doneDay === this.sim.clock.dayCount,
      last: this.lastResult,
    };
  }

  persisted() { return { doneDay: this.doneDay, plannedAt: this.plannedAt }; }

  restore(d) {
    if (!d || typeof d !== 'object') return;
    if (Number.isInteger(d.doneDay) && d.doneDay >= -1) this.doneDay = d.doneDay;
    if (Number.isInteger(d.plannedAt) && d.plannedAt >= I.FROM_MIN && d.plannedAt <= I.TO_MIN) this.plannedAt = d.plannedAt;
  }
}

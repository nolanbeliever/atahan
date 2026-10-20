import { EVT } from '../../shared/constants.js';
import { pathLength } from '../../shared/path.js';
import { BASEMENT, isInsideBasement } from '../../shared/basement.js';
import { staffLevel } from '../../shared/restaurant.js';
import { NEW_STAFF } from '../../shared/staffhr.js';
import {
  DOOR, BOUNCER_RULES as R, CUES_OK, CUES_BAD, SURNAME_INITIALS, VENUE_NAME, FAKE_VENUES,
  dressCodeFor, dressViolation, compliantDress, breakDress, bouncerAccuracy, ambienceFeeMul, ambienceSpawnMul,
} from '../../shared/bouncer.js';

const DEF = NEW_STAFF.bouncer;
const STAFF_SPEED = 1.5;
const QUEUE = 'bmQueue'; // sıradaki misafirin fazı (BasementService bu fazdaki NPC'ye dokunmaz)
const DOOR_IN = 'bmDoor'; // asansörden sıraya yürüyen misafir
const B = Object.freeze({ IDLE: 'bc-idle', WALK: 'bc-walk' });
const int = (v) => (Number.isInteger(v) ? v : -1);
const near = (p, [x, z], range) => Math.hypot(p.x - x, p.z - z) <= range;
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** Kapının kendi rastgele üreticisi: simülasyonun rng dizisine dokunmaz (diğer sistemlerin testleri değişmesin) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sıradaki i. yerin noktası (ilk 5 ip boyunca, sonrası asansörün batısına) */
export function queueSlot(i) {
  if (i < DOOR.slots.length) return DOOR.slots[i];
  const k = i - DOOR.slots.length;
  return [Math.max(26.7, 31.4 - 1.05 * (k % 4)), k < 4 ? -11.65 : -11.0];
}

/**
 * VIP Bouncer — Eğlence Katı kapısı (sunucu yetkili).
 *  - BasementService'in NPC misafirleri (otel misafirleri ve dışarıdan gelenler) asansörden inince kadife ipin
 *    arkasında sıraya girer. Her misafirin görünür bir kıyafeti, bir kartı (oda kartı / davetiye) ve bir tavrı var.
 *  - Bu gecenin kıyafet kuralı (oyun gününe göre sırayla: Şık / Smart Casual / Beyaz Parti / Neon) ve kara liste
 *    panoda. Kapıdaki görevli (kürsüdeki oyuncu, yoksa işe alınan bouncer NPC'si) içeri alır / geri çevirir;
 *    kapıda kimse yoksa misafirler kontrolsüz girer (sorunlu olan içeride olay çıkarabilir).
 *  - Doğru kararlar "Ortam" puanını (0–100) yükseltir: Eğlence Katı NPC ücretleri ve gelme sıklığı ona bağlı;
 *    haksız geri çevirme ve içeride çıkan olaylar düşürür (+ itibar kaybı).
 *  - Bouncer NPC'leri (en fazla 2) Personel 2.0'dan işe alınır; isabeti seviye + moralle artar.
 */
export class BouncerService {
  constructor(sim) {
    this.sim = sim;
    this.rng = mulberry32(sim.config.bouncerSeed ?? Math.floor(Math.random() * 2 ** 32));
    this.queue = []; // BasementService NPC kayıtları (n), sırayla; queue[0] kontrol noktasında
    this.watch = new Set(); // içeri alınmış sorunlu misafirler (olay zamanı n.door.incidentAt)
    this.post = null; // kürsüdeki oyuncu { id, name }
    this.ambience = R.AMBIENCE_START;
    this.lastDecisionAt = 0;
    this.streak = 0; // oyuncunun doğru karar sayacı (her R.REP_EVERY'de +1 itibar)
    this.stats = { checked: 0, correct: 0, incidents: 0 };
    this.today = { admitted: 0, rejected: 0, correct: 0, wrong: 0, incidents: 0 };
    this.staff = new Map(); // bouncer NPC'leri
    this.last = null; // son karar (HUD'da gösterilir) { id, name, admit, correct, reason, by }
    this.day = -1;
    this.code = null;
    this.blacklist = [];
    this.rollNight();
  }

  get basement() { return this.sim.basement; }

  /** Kapı sistemi açık mı (testlerde config.bouncerQueue: false ile eski akış) */
  get active() { return this.sim.config.bouncerQueue !== false; }

  feeMul() { return ambienceFeeMul(this.ambience); }
  spawnMul() { return this.active ? ambienceSpawnMul(this.ambience) : 1; }

  // ---- Gece: kural + kara liste ------------------------------------------------------------------

  rollNight() {
    this.day = this.sim.clock.dayCount;
    this.code = dressCodeFor(this.day);
    const names = this.basementNames();
    const list = new Set();
    let guard = 0;
    while (list.size < R.BLACKLIST && guard++ < 50) list.add(`${pick(this.rng, names)} ${pick(this.rng, SURNAME_INITIALS)}`);
    this.blacklist = [...list];
  }

  basementNames() {
    return ['Sanne', 'Daan', 'Lotte', 'Bram', 'Fenna', 'Joris', 'Ilse', 'Thijs', 'Noor', 'Ruben', 'Elif', 'Kerem', 'Zeynep', 'Mert'];
  }

  onNewDay() {
    this.ambience += (R.AMBIENCE_START - this.ambience) * R.AMBIENCE_DRIFT;
    this.ambience = Math.round(this.ambience * 10) / 10;
    this.today = { admitted: 0, rejected: 0, correct: 0, wrong: 0, incidents: 0 };
    this.rollNight();
    this.changed();
  }

  // ---- Kalıcılık ---------------------------------------------------------------------------------

  persisted() {
    return {
      ambience: this.ambience,
      stats: { ...this.stats },
      staff: [...this.staff.values()].map((s) => ({ name: s.name, look: { ...s.look }, tasks: s.tasks })),
    };
  }

  restore(d) {
    if (!d || typeof d !== 'object') return;
    if (Number.isFinite(d.ambience)) this.ambience = Math.min(100, Math.max(0, d.ambience));
    const s = d.stats;
    if (s && typeof s === 'object') {
      for (const k of Object.keys(this.stats)) if (Number.isInteger(s[k]) && s[k] >= 0) this.stats[k] = s[k];
    }
    if (Array.isArray(d.staff)) {
      for (const raw of d.staff.slice(0, DEF.max)) {
        if (!raw || typeof raw !== 'object') continue;
        const taken = [...this.staff.values()].some((x) => x.name === raw.name);
        const name = typeof raw.name === 'string' && DEF.names.includes(raw.name) && !taken ? raw.name : this.freeName();
        if (!name) break;
        const tasks = Number.isInteger(raw.tasks) && raw.tasks >= 0 ? Math.min(raw.tasks, 1e6) : 0;
        this.create(name, this.cleanLook(raw.look), tasks, this.sim.now());
      }
    }
    this.rollNight();
  }

  cleanLook(l) {
    const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
    return { body: 0, skin: idx(l?.skin, 5), hair: idx(l?.hair, 5), hat: false, bag: false };
  }

  // ---- Misafir profili (BasementService.spawnSession çağırır) ------------------------------------------

  /** Yeni Eğlence Katı misafirine görünür kıyafet + kart + tavır ver */
  assign(n) {
    if (!this.active) return;
    const rng = this.rng;
    const code = this.code.id;
    let violation = null;
    if (rng() >= R.OK_CHANCE) {
      const r = rng();
      if (n.hotel) violation = r < 0.7 ? 'dress' : 'behaviour';
      else violation = r < 0.45 ? 'dress' : r < 0.7 ? 'behaviour' : 'card';
    }
    let dress = compliantDress(rng, code);
    if (violation === 'dress') dress = breakDress(rng, code, dress);
    const cue = violation === 'behaviour' ? pick(rng, CUES_BAD) : pick(rng, CUES_OK);
    const day = this.sim.clock.dayCount;
    let card;
    let name;
    if (n.hotel) {
      name = n.name;
      card = { type: 'room', room: n.room, name, day, venue: VENUE_NAME };
    } else {
      name = `${n.name} ${pick(rng, SURNAME_INITIALS)}`;
      card = { type: 'invite', name, day, venue: VENUE_NAME };
      if (violation === 'card') {
        const kind = rng();
        if (kind < 0.4 && this.blacklist.length) {
          name = pick(rng, this.blacklist);
          card.name = name;
        } else if (kind < 0.7) {
          card.day = day - 1 - Math.floor(rng() * 3); // eski tarihli davetiye
        } else {
          card.venue = pick(rng, FAKE_VENUES); // sahte davetiye (otelin adı yanlış)
        }
      } else {
        // Kara listedeki biriyle aynı isim çıkmasın (yalnızca ihlalde)
        while (this.blacklist.includes(name)) name = `${n.name} ${pick(rng, SURNAME_INITIALS)}`;
        card.name = name;
      }
    }
    n.door = { cue, card, name, troublemaker: violation === 'behaviour' || violation === 'card', slot: -1, readyAt: 0, checkAt: 0, incidentAt: 0 };
    n.e.dress = dress;
  }

  /** Karar anındaki kurallarla: misafir içeri alınmalı mı? @returns {string|null} red sebebi (uygunsa null) */
  violation(n) {
    const d = n.door;
    const dressBad = dressViolation(this.code.id, n.e.dress ?? {});
    if (dressBad) return `Kıyafet: ${dressBad}`;
    if (CUES_BAD.includes(d.cue)) return `Tavır: ${d.cue.toLocaleLowerCase('tr')}`;
    const c = d.card;
    if (c.type === 'invite') {
      if (this.blacklist.includes(c.name)) return `${c.name} kara listede`;
      if (c.venue !== VENUE_NAME) return `Sahte davetiye ("${c.venue}")`;
      if (c.day !== this.sim.clock.dayCount) return `Davetiyenin tarihi geçmiş (Gün ${c.day + 1})`;
    }
    return null;
  }

  // ---- Sıra ----------------------------------------------------------------------------------------

  /** BasementService: asansörden inen misafir sıranın sonuna */
  arrive(n, now) {
    if (this.queue.includes(n)) return;
    this.queue.push(n);
    n.door.slot = -1;
    this.place(n, this.queue.length - 1, now);
    this.changed();
  }

  place(n, i, now) {
    const to = queueSlot(i);
    n.door.slot = i;
    n.door.readyAt = 0;
    n.door.checkAt = 0;
    const from = n.e.path[n.e.path.length - 1];
    this.basement.walk(n, QUEUE, [[from, to]], now);
    // Sırada kuzeye değil kürsüye (doğuya) bakar
    n.e.face = Math.PI / 2;
  }

  /** Sıradakiler birer adım ilerler */
  advance(now) {
    this.queue.forEach((n, i) => { if (n.door.slot !== i) this.place(n, i, now); });
  }

  remove(n, now) {
    const k = this.queue.indexOf(n);
    if (k < 0) return;
    this.queue.splice(k, 1);
    this.advance(now);
  }

  get front() {
    const n = this.queue[0];
    if (!n || n.door.slot !== 0 || n.e.phase !== QUEUE) return null;
    return n;
  }

  /** Sıranın başındaki misafir kontrol noktasına vardı mı */
  ready(n, now) { return !!n && now >= n.e.phaseEndsAt; }

  // ---- Oyuncu: kürsü + karar ---------------------------------------------------------------------------

  act(p, data, now) {
    const act = typeof data?.act === 'string' ? data.act : '';
    if (act === 'post') return this.takePost(p);
    if (act === 'leave') {
      if (this.post?.id === p.id) {
        this.post = null;
        this.changed();
      }
      return { ok: true };
    }
    if (act === 'decide') return this.playerDecide(p, data, now);
    return { ok: false, error: 'Geçersiz işlem.' };
  }

  takePost(p) {
    if (!this.active) return { ok: false, error: 'Kapı kontrolü kapalı.' };
    if (!isInsideBasement(p.x, p.z) || !near(p, DOOR.stand, DOOR.range + 1)) return { ok: false, error: 'Kapıdaki kürsüye git.' };
    if (this.post && this.post.id !== p.id && this.sim.players.has(this.post.id)) return { ok: false, error: `Kapıda ${this.post.name} duruyor.` };
    this.post = { id: p.id, name: p.name };
    this.changed();
    return { ok: true };
  }

  playerDecide(p, data, now) {
    if (this.post?.id !== p.id) return { ok: false, error: 'Önce kapıdaki kürsüye geç.' };
    if (typeof data.admit !== 'boolean') return { ok: false, error: 'Geçersiz karar.' };
    const n = this.front;
    if (!n || n.id !== int(data.id)) return { ok: false, error: 'Kapıda kontrol edilecek misafir yok.' };
    if (!this.ready(n, now)) return { ok: false, error: 'Misafir daha kapıya gelmedi.' };
    if (now - this.lastDecisionAt < R.DECIDE_GAP_MS) return { ok: false, error: 'Çok hızlı!' };
    const res = this.decide(n, data.admit, { by: 'player', p }, now);
    return { ok: true, correct: res.correct, reason: res.reason };
  }

  /**
   * Kararı uygula. @param who { by: 'player'|'npc'|'none', p?, s? }
   * @returns {{ correct: boolean, reason: string|null }}
   */
  decide(n, admit, who, now) {
    this.lastDecisionAt = now;
    const reason = this.violation(n);
    const ok = reason === null;
    const correct = admit === ok;
    const d = n.door;
    const D = R.DELTA;
    this.remove(n, now);
    if (who.by !== 'none') {
      this.stats.checked += 1;
      if (correct) this.stats.correct += 1;
      this.today[correct ? 'correct' : 'wrong'] += 1;
    }
    if (admit) {
      this.today.admitted += 1;
      this.basement.doorAdmit(n, now);
      if (ok) this.bump(who.by === 'none' ? 0 : D.admitOk);
      else if (reason.startsWith('Kıyafet')) this.bump(D.admitDress);
      if (!ok && d.troublemaker && (who.by !== 'none' || this.rng() < R.UNMANNED_INCIDENT)) {
        d.incidentAt = now + R.INCIDENT_MIN_MS + this.rng() * (R.INCIDENT_MAX_MS - R.INCIDENT_MIN_MS);
        this.watch.add(n);
      }
    } else {
      this.today.rejected += 1;
      this.basement.doorReject(n, now);
      if (ok) {
        this.bump(D.rejectOk);
        this.sim.growth.addReputation(-1);
      } else {
        this.bump(D.rejectBad);
      }
    }
    this.last = { id: n.id, name: d.name, admit, correct, reason, by: who.by };
    if (who.by === 'player') {
      if (correct && ++this.streak >= R.REP_EVERY) {
        this.streak = 0;
        this.sim.growth.addReputation(1);
      }
      const text = correct
        ? (admit ? `✅ Doğru karar — ${d.name} içeride, ortam güzel.` : `✅ Doğru karar — ${d.name} geri çevrildi (${reason}).`)
        : (admit ? `❌ Yanlış karar — ${d.name} içeri girmemeliydi (${reason}).` : `❌ Yanlış karar — ${d.name} kurallara uyuyordu, haksız yere geri çevrildi.`);
      this.sim.toPlayer(who.p.id, EVT.NOTIFY, { text, kind: correct ? 'info' : 'warn' });
    } else if (who.by === 'npc') {
      const s = who.s;
      s.tasks += 1;
      this.sim.staffhr?.rate('bouncer', s.name, correct ? 5 : 1);
      if (!correct) this.sim.staffhr?.mistake('bouncer', s.name);
      this.sim.house.scheduleSave();
    }
    this.changed();
    return { correct, reason };
  }

  bump(delta) {
    this.ambience = Math.min(100, Math.max(0, Math.round((this.ambience + delta) * 10) / 10));
  }

  /** İçeri alınan sorunlu misafir olay çıkarır: oturum biter, ortam ve itibar düşer */
  incident(n, now) {
    this.watch.delete(n);
    this.bump(R.DELTA.incident);
    this.sim.growth.addReputation(-2);
    this.stats.incidents += 1;
    this.today.incidents += 1;
    this.sim.notify(`⚠️ Eğlence Katı'nda olay çıktı: ${n.door.name} misafirlerle kavga etti ve dışarı çıkarıldı! Ortam bozuldu (kapıya dikkat).`, 'warn');
    this.basement.endSession(n.session, now);
    this.changed();
  }

  // ---- Bouncer NPC'leri -------------------------------------------------------------------------------

  freeName() {
    const used = new Set([...this.staff.values()].map((s) => s.name));
    return DEF.names.find((x) => !used.has(x)) ?? null;
  }

  level(s) { return staffLevel(s.tasks); }

  create(name, look, tasks, now) {
    const s = {
      id: this.sim.guests.nextId++, name, look, tasks, phase: B.IDLE, path: null, t0: now, phaseEndsAt: 0, face: -Math.PI * 0.75,
      post: -1, checking: false,
    };
    s.path = [[...DOOR.spare]];
    this.staff.set(s.id, s);
    return s;
  }

  hire(p) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    if (this.staff.size >= DEF.max) return { ok: false, error: `En fazla ${DEF.max} bouncer çalışabilir.` };
    if (this.sim.money < DEF.price) return { ok: false, error: `Kasada yeterli para yok (€${DEF.price} gerekiyor).` };
    const name = this.freeName();
    if (!name) return { ok: false, error: 'Şu an işe alınacak aday yok.' };
    const r = this.rng;
    const s = this.create(name, { body: 0, skin: Math.floor(r() * 5), hair: Math.floor(r() * 5), hat: false, bag: false }, 0, this.sim.now());
    this.sim.spend(DEF.price, `${DEF.icon} Bouncer ${name} işe alındı`);
    this.sim.notify(`${DEF.icon} ${name} Eğlence Katı'nın kapısında bouncer olarak işe başladı (${p.name} işe aldı) — kapıda sen yokken misafirleri o kontrol edecek.`, 'info');
    this.broadcast(s);
    this.sim.hotelChanged();
    this.changed();
    return { ok: true, id: s.id };
  }

  fire(p, data) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    const s = Number.isInteger(data?.id) ? this.staff.get(data.id) : undefined;
    if (!s) return { ok: false, error: 'Böyle bir çalışan yok.' };
    this.staff.delete(s.id);
    this.sim.out(EVT.GUEST_REMOVE, s.id);
    this.sim.notify(`${DEF.icon} ${s.name} işten ayrıldı.`, 'info');
    this.sim.hotelChanged();
    this.changed();
    return { ok: true, name: s.name };
  }

  toWire(s) {
    const step = s.checking ? ' · kontrol ediyor…' : '';
    return {
      id: s.id, kind: 'bouncer', look: s.look, phase: s.phase, path: s.path, t0: s.t0, speed: STAFF_SPEED,
      face: s.face, sit: false, roomId: null, label: `${DEF.icon} Bouncer ${s.name} · Sv.${this.level(s)}${step}`,
      outfit: this.sim.staffhr?.outfitOf('bouncer', s.name) ?? null,
    };
  }

  serializeWires() { return [...this.staff.values()].map((s) => this.toWire(s)); }

  broadcast(s) { this.sim.out(EVT.GUEST_UPSERT, this.toWire(s)); }

  /** Kürsüdeki (kontrol eden) bouncer NPC'si: oyuncu kapıdaysa kimse */
  get onDuty() {
    if (this.post) return null;
    for (const s of this.staff.values()) if (s.post === 0 && s.phase === B.IDLE) return s;
    return null;
  }

  /** Bouncer'ları yerlerine yerleştir: ilki kürsüye (oyuncu kapıdaysa kenara), ikincisi kenara */
  placeStaff(now) {
    let k = 0;
    for (const s of this.staff.values()) {
      const post = k === 0 && !this.post ? 0 : 1;
      k++;
      const to = post === 0 ? DOOR.stand : [DOOR.spare[0] + (k > 1 ? 0.7 : 0), DOOR.spare[1]];
      const at = s.path[s.path.length - 1];
      if (s.post === post && Math.hypot(at[0] - to[0], at[1] - to[1]) < 0.05) continue;
      s.post = post;
      s.checking = false;
      s.phase = B.WALK;
      s.path = [[at[0], at[1]], [to[0], to[1]]];
      s.t0 = now;
      s.phaseEndsAt = now + (pathLength(s.path) / STAFF_SPEED) * 1000;
      this.broadcast(s);
    }
  }

  // ---- Döngü -------------------------------------------------------------------------------------------

  shiftTime(deltaMs) {
    for (const n of this.queue) {
      if (n.door.checkAt) n.door.checkAt += deltaMs;
    }
    for (const n of this.watch) n.door.incidentAt += deltaMs;
    for (const s of this.staff.values()) {
      s.t0 += deltaMs;
      s.phaseEndsAt += deltaMs;
    }
  }

  update(now) {
    if (this.day !== this.sim.clock.dayCount) this.rollNight();
    // Kürsüdeki oyuncu ayrıldı / uzaklaştı
    if (this.post) {
      const p = this.sim.players.get(this.post.id);
      if (!p || !near(p, DOOR.stand, DOOR.reach)) {
        this.post = null;
        this.changed();
      }
    }
    this.placeStaff(now);
    for (const s of this.staff.values()) {
      if (s.phase === B.WALK && now >= s.phaseEndsAt) {
        s.phase = B.IDLE;
        s.path = [[...s.path[s.path.length - 1]]];
        s.t0 = now;
        s.face = s.post === 0 ? -Math.PI * 0.8 : Math.PI;
        this.broadcast(s);
      }
    }
    // Oturumu iptal olan (oyuncu yeri aldı) misafir sıradan çıkar
    for (const n of [...this.queue]) {
      if (!this.basement.npcs.has(n.id)) {
        this.remove(n, now);
      } else if (n.session.cancelled) {
        this.remove(n, now);
        this.basement.doorReject(n, now);
      }
    }
    // Sıranın başı
    const n = this.front;
    if (n && this.ready(n, now)) {
      if (!this.post) {
        const s = this.onDuty;
        if (s) {
          if (!n.door.checkAt) {
            n.door.checkAt = now + R.NPC_CHECK_MS * (this.sim.staffhr?.speedMul('bouncer', s.name) ?? 1);
            s.checking = true;
            this.broadcast(s);
          } else if (now >= n.door.checkAt) {
            const acc = bouncerAccuracy(this.level(s), this.sim.staffhr?.speedMul('bouncer', s.name) ?? 1);
            const ok = this.violation(n) === null;
            const admit = this.rng() < acc ? ok : !ok;
            s.checking = false;
            this.broadcast(s);
            this.decide(n, admit, { by: 'npc', s }, now);
          }
        } else {
          // Kapıda kimse yok: kontrolsüz girer
          if (!n.door.checkAt) n.door.checkAt = now + R.UNMANNED_MS;
          else if (now >= n.door.checkAt) this.decide(n, true, { by: 'none' }, now);
        }
      }
    }
    // Olaylar
    for (const m of [...this.watch]) {
      if (!this.basement.npcs.has(m.id)) {
        this.watch.delete(m);
        continue;
      }
      if (m.e.phase === 'bmPlay' && now >= m.door.incidentAt) this.incident(m, now);
    }
  }

  // ---- Durum -------------------------------------------------------------------------------------------

  serialize() {
    const n = this.front;
    const ready = n ? this.sim.now() >= n.e.phaseEndsAt : false;
    return {
      active: this.active,
      code: this.code.id,
      day: this.sim.clock.dayCount,
      blacklist: this.blacklist,
      ambience: this.ambience,
      queue: this.queue.length,
      front: n ? { id: n.id, name: n.door.name, card: n.door.card, cue: n.door.cue, dress: n.e.dress, ready, readyAt: n.e.phaseEndsAt } : null,
      post: this.post,
      staff: [...this.staff.values()].map((s) => ({ id: s.id, name: s.name, level: this.level(s), tasks: s.tasks, post: s.post, checking: s.checking })),
      today: { ...this.today },
      stats: { ...this.stats },
      last: this.last,
    };
  }

  changed() { this.sim.out(EVT.BOUNCER_STATE, this.serialize()); }

  removePlayer(p) {
    if (this.post?.id === p.id) {
      this.post = null;
      this.changed();
    }
  }
}

export { QUEUE as BOUNCER_QUEUE_PHASE, DOOR_IN as BOUNCER_DOOR_PHASE };

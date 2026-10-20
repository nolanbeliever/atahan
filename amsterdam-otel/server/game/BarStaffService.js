import { EVT, DRINK_BY_ID } from '../../shared/constants.js';
import { drinkDifficulty } from '../../shared/drinks.js';
import { BAR } from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';
import { staffLevel, chefSpeedScale } from '../../shared/restaurant.js';
import { NEW_STAFF } from '../../shared/staffhr.js';

const DEF = NEW_STAFF.barman;
const SPEED = 1.4; // m/sn (tezgâh arkası dar)
const K = Object.freeze({ IDLE: 'bm-idle', WALK: 'bm-walk', WORK: 'bm-work', HOME: 'bm-home' });
const CORRIDOR_Z = 12.65; // tezgâh (z 12.0) ile arka tezgâh (z 13.3) arası
const IDLE_SPOTS = Object.freeze([[11.0, CORRIDOR_Z], [12.4, CORRIDOR_Z], [13.8, CORRIDOR_Z]]);
const RACK = [BAR.glassRack[0], 12.85];
const MIX = [12.2, 12.85]; // malzeme muslukları önü
const SHAKER = [BAR.shaker[0], 12.85];
const SINK = [BAR.sink[0], 12.85];
const serveSpot = (i) => [BAR.stools[i].spot[0], 12.3]; // müşterinin önü (tezgâhın arka kenarı)
const MS = Object.freeze({ glass: 700, perIng: 650, shake: 900, serve: 600, collect: 500, wash: 1100 });
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/**
 * Barmen NPC'leri (Personel 2.0'dan kasa parasıyla, en fazla 3). Bar açıkken sipariş bekleyen müşteriye
 * içeceğini hazırlar (raf → musluklar → gerekiyorsa çalkalayıcı → servis; satış + bahşiş kasaya) ve kirli
 * bardakları toplayıp lavaboda yıkar. Oyuncu da aynı anda çalışabilir: barmen hedeflediği müşteriye
 * oyuncu önce servis ederse bardağı rafa geri koyar. Bardak muhasebesi korunur (elde taşınan bardaklar
 * BarService.glassTotal'a eklenir).
 * Misafirlerle aynı ağ biçimi (GUEST_UPSERT, kind: 'barman'); iş = adım listesi (KitchenStaffService kalıbı).
 */
export class BarStaffService {
  constructor(sim) {
    this.sim = sim;
    this.staff = new Map();
  }

  get bar() { return this.sim.bar; }
  get rng() { return this.sim.rng; }

  // ---- Kalıcılık ------------------------------------------------------------------------------------

  persisted() {
    return [...this.staff.values()].map((s) => ({ name: s.name, look: { ...s.look }, tasks: s.tasks }));
  }

  restore(list) {
    if (!Array.isArray(list)) return;
    const now = this.sim.now();
    for (const raw of list.slice(0, DEF.max)) {
      if (!raw || typeof raw !== 'object') continue;
      const taken = [...this.staff.values()].some((s) => s.name === raw.name);
      const name = typeof raw.name === 'string' && DEF.names.includes(raw.name) && !taken ? raw.name : this.freeName();
      if (!name) break;
      const tasks = Number.isInteger(raw.tasks) && raw.tasks >= 0 ? Math.min(raw.tasks, 1e6) : 0;
      const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
      this.create(name, { body: 0, skin: idx(raw.look?.skin, 5), hair: idx(raw.look?.hair, 5), hat: false, bag: false }, tasks, now);
    }
  }

  freeName() {
    const used = new Set([...this.staff.values()].map((s) => s.name));
    return DEF.names.find((n) => !used.has(n)) ?? null;
  }

  freeSpot() {
    const used = new Set([...this.staff.values()].map((s) => s.spot));
    for (let i = 0; i < IDLE_SPOTS.length; i++) if (!used.has(i)) return i;
    return 0;
  }

  create(name, look, tasks, now) {
    const s = {
      id: this.sim.guests.nextId++, name, look, tasks, phase: K.IDLE, path: null, t0: now, phaseEndsAt: 0, face: Math.PI,
      spot: this.freeSpot(), job: null, carry: null, label: null,
    };
    s.path = [[...IDLE_SPOTS[s.spot]]];
    this.staff.set(s.id, s);
    return s;
  }

  level(s) { return staffLevel(s.tasks); }

  /** Elde taşınan bardaklar (BarService.glassTotal: raf + tezgâh + eller sabit kalmalı) */
  glassesHeld() {
    let n = 0;
    for (const s of this.staff.values()) if (s.carry === 'glass' || s.carry === 'dirty') n++;
    return n;
  }

  // ---- Ağ ---------------------------------------------------------------------------------------------

  toWire(s) {
    const step = s.phase === K.WORK || s.phase === K.WALK ? s.label : null;
    return {
      id: s.id, kind: 'barman', look: s.look, phase: s.phase, path: s.path, t0: s.t0, speed: SPEED, face: s.face,
      sit: false, roomId: null, carry: s.carry,
      label: `${DEF.icon} Barmen ${s.name} · Sv.${this.level(s)}${step ? ` · ${step}` : ''}`,
      work: s.phase === K.WORK ? { until: s.phaseEndsAt } : null,
      outfit: this.sim.staffhr?.outfitOf('barman', s.name) ?? null,
    };
  }

  serializeWires() { return [...this.staff.values()].map((s) => this.toWire(s)); }

  broadcast(s) { this.sim.out(EVT.GUEST_UPSERT, this.toWire(s)); }

  shiftTime(deltaMs) {
    for (const s of this.staff.values()) {
      s.t0 += deltaMs;
      s.phaseEndsAt += deltaMs;
    }
  }

  // ---- İşe alma / çıkarma -----------------------------------------------------------------------------

  hire(p) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    if (this.staff.size >= DEF.max) return { ok: false, error: `En fazla ${DEF.max} barmen çalışabilir.` };
    if (this.sim.money < DEF.price) return { ok: false, error: `Kasada yeterli para yok (€${DEF.price} gerekiyor).` };
    const name = this.freeName();
    if (!name) return { ok: false, error: 'Şu an işe alınacak aday yok.' };
    const r = this.rng;
    const s = this.create(name, { body: 0, skin: Math.floor(r() * 5), hair: Math.floor(r() * 5), hat: false, bag: false }, 0, this.sim.now());
    this.sim.spend(DEF.price, `${DEF.icon} Barmen ${name} işe alındı`);
    this.sim.notify(`${DEF.icon} ${name} Bar De Tulp'ta barmen olarak işe başladı (${p.name} işe aldı) — siparişleri hazırlayıp servis edecek, kirli bardakları yıkayacak. Gelirler kasaya!`, 'info');
    this.broadcast(s);
    this.sim.hotelChanged();
    return { ok: true, id: s.id };
  }

  fire(p, data) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    const s = Number.isInteger(data?.id) ? this.staff.get(data.id) : undefined;
    if (!s) return { ok: false, error: 'Böyle bir çalışan yok.' };
    this.dropJob(s);
    this.staff.delete(s.id);
    this.sim.out(EVT.GUEST_REMOVE, s.id);
    this.sim.notify(`${DEF.icon} ${s.name} bardan ayrıldı.`, 'info');
    this.sim.hotelChanged();
    return { ok: true, name: s.name };
  }

  // ---- Yürüme / iş ------------------------------------------------------------------------------------

  lastPoint(s) { return s.path[s.path.length - 1]; }

  /** Tezgâh arkasındaki koridor düz bir hat: önce koridor çizgisine, sonra hedefe */
  walkTo(s, to, now, phase = K.WALK) {
    const [x, z] = this.lastPoint(s);
    const pts = [[x, z]];
    if (Math.abs(x - to[0]) > 0.05) pts.push([x, CORRIDOR_Z], [to[0], CORRIDOR_Z]);
    pts.push([to[0], to[1]]);
    s.phase = phase;
    s.path = pts;
    s.t0 = now;
    s.phaseEndsAt = now + (pathLength(pts) / SPEED) * 1000;
    this.broadcast(s);
  }

  scale(s) {
    return chefSpeedScale(this.sim.growth.stars, this.level(s)) * (this.sim.staffhr?.speedMul('barman', s.name) ?? 1);
  }

  /** İşi bırak: eldeki bardak (temiz / kirli / hazır içecek) yıkanıp rafa döner */
  dropJob(s) {
    if (s.carry === 'glass' || s.carry === 'dirty') this.bar.staffReturnGlass(1);
    s.job = null;
    s.carry = null;
    s.label = null;
  }

  goHome(s, now) {
    s.job = null;
    s.label = null;
    const home = IDLE_SPOTS[s.spot];
    const [x, z] = this.lastPoint(s);
    if (Math.hypot(x - home[0], z - home[1]) < 0.05) {
      this.idle(s, now);
      return;
    }
    this.walkTo(s, home, now, K.HOME);
  }

  idle(s, now) {
    s.phase = K.IDLE;
    s.path = [[...IDLE_SPOTS[s.spot]]];
    s.t0 = now;
    s.face = Math.PI;
    s.label = null;
    this.broadcast(s);
  }

  update(now) {
    for (const s of this.staff.values()) this.updateStaff(s, now);
  }

  updateStaff(s, now) {
    if (s.phase === K.IDLE) {
      if (this.bar.open) this.findJob(s, now);
      return;
    }
    if (now < s.phaseEndsAt) return;
    if (s.phase === K.HOME) {
      this.idle(s, now);
      return;
    }
    const step = s.job?.steps[s.job.i];
    if (!step) {
      this.goHome(s, now);
      return;
    }
    if (s.phase === K.WALK) {
      if (step.check && !step.check()) {
        this.abort(s, now);
        return;
      }
      s.phase = K.WORK;
      s.path = [[...this.lastPoint(s)]];
      s.t0 = now;
      s.face = step.face;
      s.phaseEndsAt = now + step.ms;
      this.broadcast(s);
      return;
    }
    if (step.done && step.done(s, now) === false) {
      this.abort(s, now);
      return;
    }
    s.job.i += 1;
    if (s.job.i < s.job.steps.length) this.nextStep(s, now);
    else this.goHome(s, now);
  }

  abort(s, now) {
    this.dropJob(s);
    this.goHome(s, now);
  }

  nextStep(s, now) {
    const step = s.job.steps[s.job.i];
    s.label = step.label;
    this.walkTo(s, step.to, now);
  }

  targeted() {
    const out = new Set();
    for (const o of this.staff.values()) if (o.job?.stool != null) out.add(o.job.stool);
    return out;
  }

  findJob(s, now) {
    const job = this.serveJob(s) ?? this.collectJob();
    if (!job) return;
    s.job = { ...job, i: 0 };
    this.nextStep(s, now);
  }

  /** En uzun süredir bekleyen (başka barmenin hedeflemediği) müşteriye içeceğini hazırla */
  serveJob(s) {
    if (this.bar.rack <= 0) return null;
    const taken = this.targeted();
    let best = -1;
    this.bar.stools.forEach((st, i) => {
      if (st.state !== 'waiting' || taken.has(i)) return;
      if (best < 0 || st.waitUntil < this.bar.stools[best].waitUntil) best = i;
    });
    if (best < 0) return null;
    const i = best;
    const drinkId = this.bar.stools[i].order;
    const drink = DRINK_BY_ID[drinkId];
    const sc = this.scale(s);
    const steps = [
      {
        to: RACK, face: 0, ms: MS.glass * sc, label: '🥛 bardak alıyor',
        done: (b) => {
          if (!this.bar.staffTakeGlass()) return false;
          b.carry = 'glass';
          return true;
        },
      },
      { to: MIX, face: 0, ms: MS.perIng * Math.max(1, drink.ingredients.length) * sc, label: `${drink.icon} ${drink.name} hazırlıyor` },
    ];
    if (drink.shake) steps.push({ to: SHAKER, face: 0, ms: MS.shake * sc, label: `${drink.icon} çalkalıyor` });
    steps.push({
      to: serveSpot(i), face: Math.PI, ms: MS.serve * sc, label: `${drink.icon} servis ediyor`,
      check: () => this.bar.stools[i].state === 'waiting' && this.bar.stools[i].order === drinkId,
      done: (b, now) => {
        const res = this.bar.staffServe(i, drinkId, now, b.name);
        if (!res) return false;
        b.carry = null;
        this.sim.staffhr?.rate('barman', b.name, 3 + Math.round(2 * clamp01(res.speed)));
        this.levelUp(b);
        return true;
      },
    });
    return { kind: 'serve', stool: i, drink: drinkId, difficulty: drinkDifficulty(drink), steps };
  }

  /** Tezgâhta kalan kirli bardağı topla, lavaboda yıka */
  collectJob() {
    const taken = this.targeted();
    const i = this.bar.stools.findIndex((st, k) => st.glass === 'dirty' && !taken.has(k));
    if (i < 0) return null;
    return {
      kind: 'collect',
      stool: i,
      steps: [
        {
          to: serveSpot(i), face: Math.PI, ms: MS.collect, label: '🧽 kirli bardağı topluyor',
          check: () => this.bar.stools[i].glass === 'dirty',
          done: (b) => {
            if (!this.bar.staffCollect(i)) return false;
            b.carry = 'dirty';
            b.job.stool = null; // tabure serbest (yeni müşteri oturabilir)
            return true;
          },
        },
        {
          to: SINK, face: 0, ms: MS.wash, label: '🫧 bardak yıkıyor',
          done: (b) => {
            b.carry = null;
            this.bar.staffReturnGlass(1);
            this.levelUp(b);
          },
        },
      ],
    };
  }

  levelUp(s) {
    const before = this.level(s);
    s.tasks += 1;
    const lv = this.level(s);
    if (lv > before) {
      this.sim.notify(`${DEF.icon} ${s.name} seviye ${lv}'${lv === 2 ? 'ye' : 'e'} yükseldi — artık daha hızlı!`, 'info');
      this.sim.hotelChanged();
    }
    this.sim.house.scheduleSave();
  }
}

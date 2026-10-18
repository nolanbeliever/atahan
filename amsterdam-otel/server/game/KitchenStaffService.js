import { EVT } from '../../shared/constants.js';
import { RESTAURANT } from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';
import {
  STAFF_ROLES, STAFF_SPEED, BUFFET, DISH_BY_ID, COOK_METHODS, CHEF_MS, CHEF_COOK_MULT, RESTAURANT_RULES,
  staffLevel, chefSpeedScale, restaurantRoute, passChefPoint, passWaiterPoint,
} from '../../shared/restaurant.js';

const K = Object.freeze({ IDLE: 'k-idle', WALK: 'k-walk', WORK: 'k-work', HOME: 'k-home' });
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Mutfak personeli: Gurme Aşçı ve Garson NPC'leri (Resepsiyon PC → Çalışanlar sekmesinden kasa parasıyla).
 *  - Aşçı: bekleyen bir sipariş varsa (pass'te / yolda karşılığı yoksa) pass'te bir yer ayırır, buzdolabından
 *    malzemeyi alır, istasyonda (tava / fırın / tezgâh) pişirir, tabaklar ve pass'e koyar. Açık büfe azalınca
 *    tazeler (malzeme parası kasadan). Otel yıldızı ve aşçının seviyesi işleri hızlandırır.
 *  - Garson: pass'teki tabağı o yemeği bekleyen masaya taşır (satış + bahşiş kasaya), kirli masaları toplayıp
 *    bulaşığı lavaboya götürür. Garson yoksa bunları oyuncu yapar.
 *  - Misafirlerle aynı ağ biçimi (GUEST_UPSERT, kind: 'chef' | 'waiter'): istemci rotayı kendisi oynatır.
 *  - İş = adım listesi ({ to, ms, label, check?, done? }): yürü → çalış → sonraki adım; adım geçersizleşirse iş
 *    bırakılır (ayrılan pass yeri serbest kalır) ve NPC yerine döner.
 */
export class KitchenStaffService {
  constructor(sim) {
    this.sim = sim;
    this.staff = new Map();
  }

  get rest() { return this.sim.restaurant; }
  get rng() { return this.sim.rng; }

  count(role) {
    let n = 0;
    for (const s of this.staff.values()) if (s.role === role) n++;
    return n;
  }

  // ---- Kalıcılık -------------------------------------------------------------------------

  persisted() {
    return [...this.staff.values()].map((s) => ({ role: s.role, name: s.name, look: { ...s.look }, tasks: s.tasks }));
  }

  restore(list) {
    if (!Array.isArray(list)) return;
    const now = this.sim.now();
    for (const raw of list.slice(0, 20)) {
      if (!raw || typeof raw !== 'object') continue;
      const def = STAFF_ROLES[str(raw.role)];
      if (!def || this.count(def.role) >= def.max) continue;
      const taken = [...this.staff.values()].some((s) => s.name === raw.name);
      const name = typeof raw.name === 'string' && def.names.includes(raw.name) && !taken ? raw.name : this.freeName(def);
      if (!name) continue;
      const tasks = Number.isInteger(raw.tasks) && raw.tasks >= 0 ? Math.min(raw.tasks, 1e6) : 0;
      this.create(def.role, name, this.cleanLook(raw.look), tasks, now);
    }
  }

  cleanLook(l) {
    const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
    return { body: 0, skin: idx(l?.skin, 5), hair: idx(l?.hair, 5), hat: false, bag: false };
  }

  freeName(def) {
    const used = new Set([...this.staff.values()].map((s) => s.name));
    return def.names.find((n) => !used.has(n)) ?? null;
  }

  freeSpot(role) {
    const used = new Set([...this.staff.values()].filter((s) => s.role === role).map((s) => s.spot));
    const n = (role === 'chef' ? RESTAURANT.chefSpots : RESTAURANT.waiterSpots).length;
    for (let i = 0; i < n; i++) if (!used.has(i)) return i;
    return 0;
  }

  spotPos(s) {
    return (s.role === 'chef' ? RESTAURANT.chefSpots : RESTAURANT.waiterSpots)[s.spot];
  }

  create(role, name, look, tasks, now) {
    const s = {
      id: this.sim.guests.nextId++, // misafirlerle ortak kimlik sayacı
      role,
      name,
      look,
      tasks,
      phase: K.IDLE,
      path: null,
      t0: now,
      phaseEndsAt: 0,
      face: 0,
      spot: this.freeSpot(role),
      job: null,
      carry: null, // aşçı: 'tray' | tabak kimliği; garson: tabak kimliği | 'dirty'
      label: null, // şu anki adımın etiketi (ör. "🍣 pişiriyor…")
    };
    s.path = [[...this.spotPos(s)]];
    s.face = role === 'chef' ? 0 : Math.PI;
    this.staff.set(s.id, s);
    return s;
  }

  // ---- Durum / ağ ---------------------------------------------------------------------------

  level(s) { return staffLevel(s.tasks); }

  toWire(s) {
    const def = STAFF_ROLES[s.role];
    const title = s.role === 'chef' ? 'Şef' : 'Garson';
    const step = s.phase === K.WORK || s.phase === K.WALK ? s.label : null;
    return {
      id: s.id,
      kind: s.role,
      look: s.look,
      phase: s.phase,
      path: s.path,
      t0: s.t0,
      speed: STAFF_SPEED,
      face: s.face,
      sit: false,
      roomId: null,
      carry: s.carry,
      label: `${def.icon} ${title} ${s.name} · Sv.${this.level(s)}${step ? ` · ${step}` : ''}`,
      work: s.phase === K.WORK ? { until: s.phaseEndsAt } : null,
    };
  }

  serializeWires() { return [...this.staff.values()].map((s) => this.toWire(s)); }

  /** Resepsiyon PC listesi */
  serialize() {
    return [...this.staff.values()].map((s) => ({
      id: s.id, role: s.role, name: s.name, level: this.level(s), tasks: s.tasks, busy: !!s.job, doing: s.job ? s.label : null,
    }));
  }

  broadcast(s) { this.sim.out(EVT.GUEST_UPSERT, this.toWire(s)); }

  shiftTime(deltaMs) {
    for (const s of this.staff.values()) {
      s.t0 += deltaMs;
      s.phaseEndsAt += deltaMs;
    }
  }

  // ---- İşe alma / çıkarma (Resepsiyon PC) ----------------------------------------------------

  hire(p, data) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    const def = STAFF_ROLES[str(data?.role)];
    if (!def) return { ok: false, error: 'Geçersiz pozisyon.' };
    if (this.count(def.role) >= def.max) return { ok: false, error: `En fazla ${def.max} ${def.title.toLocaleLowerCase('tr')} çalışabilir.` };
    if (this.sim.money < def.price) return { ok: false, error: `Kasada yeterli para yok (€${def.price} gerekiyor).` };
    const name = this.freeName(def);
    if (!name) return { ok: false, error: 'Şu an işe alınacak aday yok.' };
    const r = this.rng;
    const look = { body: 0, skin: Math.floor(r() * 5), hair: Math.floor(r() * 5), hat: false, bag: false };
    const s = this.create(def.role, name, look, 0, this.sim.now());
    this.sim.spend(def.price, `${def.icon} ${def.title} ${name} işe alındı`);
    const what = def.role === 'chef'
      ? 'siparişleri kendisi pişirip garson tezgâhına koyacak'
      : 'tabakları masalara taşıyıp kirli masaları toplayacak';
    this.sim.notify(`${def.icon} ${name} restoranda ${def.title.toLocaleLowerCase('tr')} olarak işe başladı (${p.name} işe aldı) — ${what}. Gelirler kasaya!`, 'info');
    this.broadcast(s);
    this.sim.hotelChanged();
    return { ok: true, id: s.id };
  }

  fire(p, data) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    const id = data?.id;
    const s = Number.isInteger(id) ? this.staff.get(id) : undefined;
    if (!s) return { ok: false, error: 'Böyle bir çalışan yok.' };
    this.dropJob(s);
    this.staff.delete(s.id);
    this.sim.out(EVT.GUEST_REMOVE, s.id);
    this.sim.notify(`${STAFF_ROLES[s.role].icon} ${s.name} restorandan ayrıldı.`, 'info');
    this.sim.hotelChanged();
    return { ok: true };
  }

  // ---- Yürüme / çalışma ---------------------------------------------------------------------

  lastPoint(s) { return s.path[s.path.length - 1]; }

  walkTo(s, to, now, phase = K.WALK) {
    s.phase = phase;
    s.path = restaurantRoute(this.lastPoint(s), to);
    s.t0 = now;
    s.phaseEndsAt = now + (pathLength(s.path) / STAFF_SPEED) * 1000;
    this.broadcast(s);
  }

  standWork(s, ms, face, now) {
    s.phase = K.WORK;
    s.path = [[...this.lastPoint(s)]];
    s.t0 = now;
    s.face = face;
    s.phaseEndsAt = now + ms;
    this.broadcast(s);
  }

  goHome(s, now) {
    s.job = null;
    s.label = null;
    const home = this.spotPos(s);
    const [x, z] = this.lastPoint(s);
    if (Math.hypot(x - home[0], z - home[1]) < 0.05) {
      this.idle(s, now);
      return;
    }
    this.walkTo(s, home, now, K.HOME);
  }

  idle(s, now) {
    s.phase = K.IDLE;
    s.path = [[...this.spotPos(s)]];
    s.t0 = now;
    s.face = s.role === 'chef' ? 0 : Math.PI;
    s.label = null;
    this.broadcast(s);
  }

  /** İşi bırak: ayrılan pass yerini serbest bırak, elde taşınan tabak kaybolur */
  dropJob(s) {
    const j = s.job;
    if (j?.slot != null && this.rest.pass[j.slot]?.reserved === s.id) this.rest.pass[j.slot].reserved = 0;
    s.job = null;
    s.carry = null;
    s.label = null;
  }

  startJob(s, job, now) {
    s.job = { ...job, i: 0 };
    this.nextStep(s, now);
  }

  nextStep(s, now) {
    const step = s.job.steps[s.job.i];
    s.label = step.label;
    this.walkTo(s, step.to, now);
  }

  // ---- Döngü ---------------------------------------------------------------------------------

  update(now) {
    for (const s of this.staff.values()) this.updateStaff(s, now);
  }

  updateStaff(s, now) {
    if (s.phase === K.IDLE) {
      if (this.rest.open) this.findJob(s, now);
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
      // Adım noktasına vardı: iş hâlâ geçerliyse çalışmaya başla
      if (step.check && !step.check(s, now)) {
        this.abort(s, now);
        return;
      }
      const [x, z] = this.lastPoint(s);
      const face = step.face ?? (step.look ? Math.atan2(step.look[0] - x, step.look[1] - z) : 0);
      this.standWork(s, step.ms, face, now);
      return;
    }
    // Çalışma bitti
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

  findJob(s, now) {
    const job = s.role === 'chef' ? this.chefJob(s) : this.waiterJob(s);
    if (job) this.startJob(s, job, now);
  }

  // ---- Aşçı ------------------------------------------------------------------------------

  /**
   * Henüz karşılanmamış siparişler: bekleyen masa sayısı − (pass'teki + pişirilen + garsonun taşıdığı) tabaklar.
   * @returns en uzun süredir bekleyen karşılanmamış siparişin tabak kimliği (yoksa null)
   */
  neededDish() {
    const cover = new Map();
    const inc = (d) => cover.set(d, (cover.get(d) ?? 0) + 1);
    for (const sl of this.rest.pass) if (sl.dish) inc(sl.dish);
    for (const o of this.staff.values()) {
      if (o.job?.dish && (o.role === 'chef' || o.carry === o.job.dish)) inc(o.job.dish);
    }
    const waiting = this.rest.tables
      .filter((t) => t.state === 'waiting')
      .sort((a, b) => a.waitUntil - b.waitUntil);
    for (const t of waiting) {
      const c = cover.get(t.order) ?? 0;
      if (c > 0) cover.set(t.order, c - 1);
      else return t.order;
    }
    return null;
  }

  chefJob(s) {
    const scale = chefSpeedScale(this.sim.growth.stars, this.level(s));
    const dishId = this.neededDish();
    const slot = this.rest.pass.findIndex((sl) => !sl.dish && !sl.reserved);
    if (dishId && slot >= 0) {
      const dish = DISH_BY_ID[dishId];
      const m = COOK_METHODS[dish.method];
      this.rest.pass[slot].reserved = s.id;
      return {
        kind: 'cook',
        dish: dishId,
        slot,
        steps: [
          {
            to: RESTAURANT.fridge.point, ms: CHEF_MS.fridge * scale, face: 0, label: `${dish.icon} malzeme alıyor`,
            done: (c) => { c.carry = 'tray'; this.broadcast(c); },
          },
          { to: RESTAURANT.stations[m.id], ms: m.ms * CHEF_COOK_MULT * scale, face: 0, label: `${m.icon} ${dish.name} hazırlıyor` },
          {
            to: RESTAURANT.plates, ms: CHEF_MS.plate * scale, face: 0, label: `${dish.icon} tabaklıyor`,
            done: (c) => { c.carry = dishId; },
          },
          {
            to: passChefPoint(slot), ms: CHEF_MS.pass, face: Math.PI, label: `${dish.icon} garson tezgâhına koyuyor`,
            done: (c) => {
              const sl = this.rest.pass[slot];
              if (sl.reserved !== c.id || sl.dish) return false;
              sl.reserved = 0;
              sl.dish = dishId;
              c.carry = null;
              this.levelUp(c);
              this.rest.changed();
              return true;
            },
          },
        ],
      };
    }
    // Pass dolu ve üstünde kimsenin beklemediği tabak varsa: onu çöpe at (yeni siparişe yer aç)
    if (dishId && slot < 0) {
      const ordered = new Set(this.rest.tables.filter((t) => t.state === 'waiting').map((t) => t.order));
      const busy = new Set([...this.staff.values()].map((o) => o.job?.slot).filter((x) => x != null));
      const orphan = this.rest.pass.findIndex((sl, i) => sl.dish && !sl.reserved && !ordered.has(sl.dish) && !busy.has(i));
      if (orphan >= 0) {
        const dish = DISH_BY_ID[this.rest.pass[orphan].dish];
        return {
          kind: 'discard',
          slot: orphan,
          steps: [
            {
              to: passChefPoint(orphan), ms: CHEF_MS.pass, face: Math.PI, label: `${dish.icon} soğuyan tabağı alıyor`,
              done: (c) => {
                const sl = this.rest.pass[orphan];
                if (sl.dish !== dish.id || sl.reserved) return false;
                sl.dish = null;
                c.carry = dish.id;
                this.rest.changed();
                return true;
              },
            },
            { to: RESTAURANT.trash, ms: CHEF_MS.pass, face: 0, label: '🗑️ çöpe atıyor', done: (c) => { c.carry = null; } },
          ],
        };
      }
    }
    // Açık büfe azaldıysa (ve başka aşçı tazelemiyorsa) tazele
    const restocking = [...this.staff.values()].some((o) => o.job?.kind === 'restock');
    if (!restocking && this.rest.buffet <= BUFFET.LOW && this.sim.money >= BUFFET.REFILL_COST
      && this.sim.clock.minute < RESTAURANT_RULES.BREAKFAST_TO) {
      return {
        kind: 'restock',
        steps: [
          {
            to: RESTAURANT.fridge.point, ms: CHEF_MS.fridge * scale, face: 0, label: '🍳 büfe tepsisi hazırlıyor',
            done: (c) => { c.carry = 'tray'; this.broadcast(c); },
          },
          {
            to: RESTAURANT.buffet.point, ms: CHEF_MS.restock * scale, face: -Math.PI / 2, label: '🍳 büfeyi tazeliyor',
            done: (c) => {
              c.carry = null;
              if (this.rest.restockBuffet(`Şef ${c.name}`)) return false;
              this.levelUp(c);
              return true;
            },
          },
        ],
      };
    }
    return null;
  }

  levelUp(s) {
    const before = this.level(s);
    s.tasks += 1;
    const lv = this.level(s);
    if (lv > before) {
      const def = STAFF_ROLES[s.role];
      this.sim.notify(`${def.icon} ${s.name} seviye ${lv}'${lv === 2 ? 'ye' : 'e'} yükseldi — artık daha hızlı!`, 'info');
      this.sim.hotelChanged();
    }
    this.sim.house.scheduleSave();
  }

  // ---- Garson ----------------------------------------------------------------------------

  /** Başka bir garsonun hedeflediği masalar */
  targetedTables(except) {
    const out = new Set();
    for (const o of this.staff.values()) if (o !== except && o.job?.table != null) out.add(o.job.table);
    return out;
  }

  /** Bu tabağı bekleyen (başka garsonun hedeflemediği) en eski masa */
  tableFor(dishId, except) {
    const taken = this.targetedTables(except);
    let best = -1;
    this.rest.tables.forEach((t, i) => {
      if (t.state !== 'waiting' || t.order !== dishId || taken.has(i)) return;
      if (best < 0 || t.waitUntil < this.rest.tables[best].waitUntil) best = i;
    });
    return best;
  }

  waiterJob(s) {
    // 1) Pass'teki tabağı bekleyen masaya taşı
    const picking = new Set([...this.staff.values()].filter((o) => o.job?.kind === 'deliver' && o.job.slot != null && !o.carry).map((o) => o.job.slot));
    for (let i = 0; i < this.rest.pass.length; i++) {
      const dishId = this.rest.pass[i].dish;
      if (!dishId || picking.has(i)) continue;
      const table = this.tableFor(dishId, s);
      if (table < 0) continue;
      return this.deliverJob(dishId, i, table);
    }
    // 2) Kirli masayı topla
    const taken = this.targetedTables(s);
    const dirty = this.rest.tables.findIndex((t, i) => t.plate === 'dirty' && !taken.has(i));
    if (dirty >= 0) {
      const tb = RESTAURANT.tables[dirty];
      return {
        kind: 'clear',
        table: dirty,
        steps: [
          {
            to: tb.serve, look: tb.center, ms: 900, label: '🧽 masayı topluyor',
            check: () => this.rest.tables[dirty].plate === 'dirty',
            done: (w) => {
              if (!this.rest.clearTable(dirty)) return false;
              w.carry = 'dirty';
              return true;
            },
          },
          {
            to: RESTAURANT.sink, face: Math.PI / 2, ms: 1200, label: '🫧 bulaşığı bırakıyor',
            done: (w) => { w.carry = null; this.levelUp(w); },
          },
        ],
      };
    }
    return null;
  }

  deliverJob(dishId, slot, table) {
    const dish = DISH_BY_ID[dishId];
    const tb = RESTAURANT.tables[table];
    return {
      kind: 'deliver',
      dish: dishId,
      slot,
      table,
      steps: [
        {
          to: passWaiterPoint(slot), face: 0, ms: 600, label: `${dish.icon} tabağı alıyor`,
          check: () => this.rest.pass[slot].dish === dishId,
          done: (w) => {
            this.rest.pass[slot].dish = null;
            w.carry = dishId;
            this.rest.changed();
          },
        },
        {
          to: tb.serve, look: tb.center, ms: 800, label: `${dish.icon} servis ediyor`,
          done: (w, now) => this.deliver(w, now),
        },
      ],
    };
  }

  /** Masaya vardı: hâlâ bekliyorsa servis et; değilse aynı yemeği bekleyen başka masaya ya da pass'e götür */
  deliver(w, now) {
    const j = w.job;
    const t = this.rest.tables[j.table];
    if (t.state === 'waiting' && t.order === j.dish && this.rest.serveTable(j.table, j.dish, now)) {
      w.carry = null;
      this.levelUp(w);
      return true;
    }
    const other = this.tableFor(j.dish, w);
    if (other >= 0) {
      const tb = RESTAURANT.tables[other];
      j.table = other;
      j.steps.push({ to: tb.serve, look: tb.center, ms: 800, label: j.steps[1].label, done: (ww, n) => this.deliver(ww, n) });
      return true;
    }
    const free = this.rest.pass.findIndex((sl) => !sl.dish && !sl.reserved);
    if (free < 0) return false; // tezgâh dolu: tabak gider
    j.table = null;
    j.steps.push({
      to: passWaiterPoint(free), face: 0, ms: 600, label: '↩ tabağı tezgâha geri koyuyor',
      done: (ww) => {
        const sl = this.rest.pass[free];
        if (sl.dish || sl.reserved) return false;
        sl.dish = j.dish;
        ww.carry = null;
        this.rest.changed();
        return true;
      },
    });
    return true;
  }
}

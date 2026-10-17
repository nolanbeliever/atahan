import { EVT, ROOM_STATUS, TIP_MIN, TIP_MAX, roomFloor } from '../../shared/constants.js';
import { ROOM_BY_ID, STAFF_ROOM } from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';
import { ISSUE_IDS, MAINT_RULES, issueSpots } from '../../shared/maintenance.js';
import {
  WORKER_RULES, WORKER_NAMES, REPUTATION, workerTaskMs, workerLevel,
} from '../../shared/hotel.js';
import {
  lobbyToRoom, roomToLobby, roomToRoom, floorToRoom, roomToFloor,
} from './routes.js';

// Temizlikçilerin lobide beklediği yerler (resepsiyonun kuzeyi, asansörün batısı). Lüks paketlerle
// 7.–30. temizlikçi 5. kattaki personel odasında bekler (ArchitectureService.staffSpot).
const IDLE_SPOTS = Object.freeze([
  [-7.3, 11.3], [-6.6, 11.3], [-5.9, 11.3], [-7.3, 10.5], [-6.6, 10.5], [-5.9, 10.5],
]);
const LOBBY_SPOTS = IDLE_SPOTS.length;

const W = Object.freeze({ IDLE: 'w-idle', WALK: 'w-walk', WORK: 'w-work', HOME: 'w-home' });

/** Görevin odadaki duruş noktası (yatak ayakucu, çöp, arıza önü) */
function taskSpot(layout, task) {
  const s = layout.side;
  if (task.kind === 'bed') return [s * 5.3, layout.bed.z];
  if (task.kind === 'trash') return layout.trashSpots[task.target];
  const sp = issueSpots(layout)[task.target];
  if (sp.wall === 'corridor') return [s * 2.1, sp.z];
  if (sp.wall === 'south') return [sp.x, layout.bounds.minZ + 0.95];
  return [sp.x, sp.z];
}

/**
 * Otel çalışanları (temizlikçi NPC'ler). Resepsiyon PC'den kasa parasıyla işe alınır (1★'de bile).
 *  - Boşta lobide bekler; açık katlarda kirli oda varsa (başka çalışan üstlenmediyse) oraya yürür
 *    (üst kattaysa asansörle), yatak / çöp / arıza işlerini sırayla yapar.
 *  - Her iş: 1★'de 10 sn … 5★'de 2 sn; seviye arttıkça biraz daha hızlı (shared/hotel.js).
 *  - Oda bitince misafirin bahşişi (+ tamirat teşekkürü) otelin KASASINA gider, itibar artar.
 *  - Misafirlerle aynı ağ biçimi (GUEST_UPSERT, kind: 'worker'): istemci rotayı kendisi oynatır,
 *    sunucu yalnızca faz değişimlerinde mesaj yollar. Gece işi bırakıp lobiye döner.
 */
export class WorkerService {
  constructor(sim) {
    this.sim = sim;
    this.workers = new Map();
    this.claims = new Map(); // roomId → workerId
  }

  get rng() { return this.sim.rng; }

  /** Güncel temizlikçi sınırı: 6, lüks paketlerle 15 / 30 */
  get max() { return this.sim.arch?.maxWorkers ?? WORKER_RULES.MAX; }

  // ---- Bekleme yeri: lobi ya da personel odası ------------------------------------------

  isStaffSpot(w) { return w.spot >= LOBBY_SPOTS; }

  spotPos(w) {
    return this.isStaffSpot(w) ? this.sim.arch.staffSpot(w.spot - LOBBY_SPOTS) : IDLE_SPOTS[w.spot];
  }

  /** Bekleme yerinden sahanlığa / lobiye çıkış noktaları */
  homeExit(w) {
    return this.isStaffSpot(w) ? [this.spotPos(w), ...this.sim.arch.staffExit()] : [this.lastPoint(w)];
  }

  /** Odadan bekleme yerine bacak listesi */
  homeLegs(w, fromLayout) {
    const start = [this.lastPoint(w)];
    if (!this.isStaffSpot(w)) return roomToLobby(start, fromLayout, [IDLE_SPOTS[w.spot]]);
    const enter = [...this.sim.arch.staffExit()].reverse();
    return roomToFloor(start, fromLayout, STAFF_ROOM.floor, [...enter, this.spotPos(w)]);
  }

  // ---- Kalıcılık -----------------------------------------------------------

  persisted() {
    return [...this.workers.values()].map((w) => ({ name: w.name, look: { ...w.look }, tasks: w.tasks }));
  }

  restore(list) {
    if (!Array.isArray(list)) return;
    const now = this.sim.now();
    for (const raw of list.slice(0, this.max)) {
      if (!raw || typeof raw !== 'object') continue;
      const taken = [...this.workers.values()].some((w) => w.name === raw.name);
      const name = typeof raw.name === 'string' && WORKER_NAMES.includes(raw.name) && !taken ? raw.name : this.freeName();
      if (!name) break;
      const tasks = Number.isInteger(raw.tasks) && raw.tasks >= 0 ? Math.min(raw.tasks, 1e6) : 0;
      const look = this.cleanLook(raw.look);
      this.create(name, look, tasks, now);
    }
  }

  cleanLook(l) {
    const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
    return { body: 0, skin: idx(l?.skin, 5), hair: idx(l?.hair, 5), hat: false, bag: false };
  }

  freeName() {
    const used = new Set([...this.workers.values()].map((w) => w.name));
    return WORKER_NAMES.find((n) => !used.has(n)) ?? null;
  }

  // ---- Durum / ağ ------------------------------------------------------------

  create(name, look, tasks, now) {
    const w = {
      id: this.sim.guests.nextId++, // misafirlerle ortak kimlik sayacı → çakışma yok
      name,
      look,
      tasks,
      phase: W.IDLE,
      path: null,
      legs: null,
      t0: now,
      phaseEndsAt: 0,
      face: 0,
      roomId: null, // üstlendiği oda
      task: null, // { kind: 'bed'|'trash'|'issue', target }
      spot: this.freeSpot(),
    };
    w.path = [[...this.spotPos(w)]];
    this.workers.set(w.id, w);
    return w;
  }

  freeSpot() {
    const used = new Set([...this.workers.values()].map((w) => w.spot));
    const n = LOBBY_SPOTS + STAFF_ROOM.spots.length;
    for (let i = 0; i < n; i++) if (!used.has(i)) return i;
    return 0;
  }

  level(w) { return workerLevel(w.tasks); }

  toWire(w) {
    const lv = this.level(w);
    return {
      id: w.id,
      kind: 'worker',
      look: w.look,
      phase: w.phase,
      path: w.path,
      t0: w.t0,
      speed: WORKER_RULES.SPEED,
      face: w.face,
      sit: false,
      roomId: null,
      label: `🧹 ${w.name} · Sv.${lv}${w.phase === W.WORK ? ' · çalışıyor…' : ''}`,
      work: w.phase === W.WORK ? { until: w.phaseEndsAt } : null,
    };
  }

  serializeWires() { return [...this.workers.values()].map((w) => this.toWire(w)); }

  /** Resepsiyon PC listesi */
  serialize() {
    return [...this.workers.values()].map((w) => ({
      id: w.id,
      name: w.name,
      level: this.level(w),
      tasks: w.tasks,
      roomId: w.roomId,
      busy: w.phase === W.WALK || w.phase === W.WORK,
      staff: this.isStaffSpot(w), // personel odasında bekler (lüks paket)
    }));
  }

  broadcast(w) { this.sim.out(EVT.GUEST_UPSERT, this.toWire(w)); }

  shiftTime(deltaMs) {
    for (const w of this.workers.values()) {
      w.t0 += deltaMs;
      w.phaseEndsAt += deltaMs;
    }
  }

  // ---- İşe alma / çıkarma (Resepsiyon PC) -------------------------------------------

  hire(p) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    if (this.workers.size >= this.max) return { ok: false, error: `En fazla ${this.max} temizlikçi çalışabilir.` };
    if (this.sim.money < WORKER_RULES.HIRE_PRICE) return { ok: false, error: `Kasada yeterli para yok (€${WORKER_RULES.HIRE_PRICE} gerekiyor).` };
    const name = this.freeName();
    if (!name) return { ok: false, error: 'Şu an işe alınacak aday yok.' };
    const r = this.rng;
    const look = { body: 0, skin: Math.floor(r() * 5), hair: Math.floor(r() * 5), hat: false, bag: false };
    const w = this.create(name, look, 0, this.sim.now());
    this.sim.spend(WORKER_RULES.HIRE_PRICE, `Temizlikçi ${name} işe alındı`);
    this.sim.notify(`🧹 ${p.name} temizlikçi ${name}'i işe aldı! Kirli odaları kendisi temizleyecek, bahşişler kasaya.`, 'info');
    this.broadcast(w);
    this.sim.hotelChanged();
    return { ok: true, id: w.id };
  }

  fire(p, data) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    const id = data?.id;
    const w = Number.isInteger(id) ? this.workers.get(id) : undefined;
    if (!w) return { ok: false, error: 'Böyle bir çalışan yok.' };
    this.release(w);
    this.workers.delete(w.id);
    this.sim.out(EVT.GUEST_REMOVE, w.id);
    this.sim.notify(`${w.name} işten ayrıldı.`, 'info');
    this.sim.hotelChanged();
    return { ok: true };
  }

  release(w) {
    if (w.roomId && this.claims.get(w.roomId) === w.id) this.claims.delete(w.roomId);
    w.roomId = null;
    w.task = null;
  }

  // ---- Yürüme / bekleme ---------------------------------------------------------------

  walkLegs(w, legs, now, phase = W.WALK) {
    w.phase = phase;
    w.path = legs[0].map((pt) => [pt[0], pt[1]]);
    w.legs = legs.length > 1 ? legs.slice(1) : null;
    w.t0 = now;
    w.phaseEndsAt = now + (pathLength(w.path) / WORKER_RULES.SPEED) * 1000;
    this.broadcast(w);
  }

  standAt(w, phase, point, now, ms, face = 0) {
    w.phase = phase;
    w.path = [[point[0], point[1]]];
    w.legs = null;
    w.t0 = now;
    w.face = face;
    w.phaseEndsAt = now + ms;
    this.broadcast(w);
  }

  lastPoint(w) { return w.path[w.path.length - 1]; }

  // ---- Döngü ---------------------------------------------------------------------

  update(now) {
    for (const w of this.workers.values()) this.updateWorker(w, now);
  }

  updateWorker(w, now) {
    if (w.phase === W.IDLE) {
      if (!this.sim.clock.night) this.findWork(w, now);
      return;
    }
    if (now < w.phaseEndsAt) return;
    if (w.legs) {
      // Asansör: sonraki bacağın başına ışınlan
      this.walkLegs(w, w.legs, now, w.phase);
      return;
    }
    if (w.phase === W.HOME) {
      this.standAt(w, W.IDLE, this.spotPos(w), now, 0, Math.PI);
      return;
    }
    if (w.phase === W.WALK) {
      this.arrive(w, now);
      return;
    }
    if (w.phase === W.WORK) this.finishTask(w, now);
  }

  /** Üstlenilebilecek en yakın (en alt kattaki) kirli oda */
  pickRoom() {
    const floors = this.sim.growth.floors;
    for (const room of this.sim.rooms.rooms.values()) {
      if (room.status !== ROOM_STATUS.DIRTY || roomFloor(room.id) > floors) continue;
      if (this.claims.has(room.id)) continue;
      return room;
    }
    return null;
  }

  pendingTasks(room) {
    const out = [];
    if (!room.bedMade) out.push({ kind: 'bed', target: 'bed' });
    room.trash.forEach((on, i) => { if (on) out.push({ kind: 'trash', target: i }); });
    for (const id of ISSUE_IDS) if (room.issues[id]) out.push({ kind: 'issue', target: id });
    return out;
  }

  /** Odadaki sıradaki iş (bulunduğu yere en yakın) */
  nextTask(w, room) {
    const layout = ROOM_BY_ID[room.id];
    const [x, z] = this.lastPoint(w);
    let best = null;
    let bestD = Infinity;
    for (const t of this.pendingTasks(room)) {
      const sp = taskSpot(layout, t);
      const d = Math.hypot(sp[0] - x, sp[1] - z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  findWork(w, now, fromRoom = null) {
    const room = this.pickRoom();
    if (!room) {
      if (fromRoom) this.goHome(w, now, fromRoom);
      return;
    }
    this.claims.set(room.id, w.id);
    w.roomId = room.id;
    const layout = ROOM_BY_ID[room.id];
    const task = this.nextTask(w, room);
    w.task = task;
    const end = [layout.path.stand, taskSpot(layout, task)];
    const start = [this.lastPoint(w)];
    let legs;
    if (fromRoom) legs = roomToRoom(start, fromRoom, layout, end);
    else if (this.isStaffSpot(w)) legs = floorToRoom(STAFF_ROOM.floor, this.homeExit(w), layout, end);
    else legs = lobbyToRoom(start, layout, end);
    this.walkLegs(w, legs, now);
  }

  goHome(w, now, fromLayout) {
    this.release(w);
    this.walkLegs(w, this.homeLegs(w, fromLayout), now, W.HOME);
  }

  /** Görev noktasına vardı: iş hâlâ yapılacaksa çalışmaya başla */
  arrive(w, now) {
    const room = w.roomId ? this.sim.rooms.get(w.roomId) : null;
    const layout = room && ROOM_BY_ID[room.id];
    if (!room || room.status !== ROOM_STATUS.DIRTY) {
      this.afterRoom(w, now, layout);
      return;
    }
    if (!w.task || !this.isPending(room, w.task)) {
      this.moveToNext(w, room, now);
      return;
    }
    room.startedAt ??= now;
    const ms = workerTaskMs(this.sim.growth.stars, this.level(w));
    const [x, z] = this.lastPoint(w);
    const tgt = taskSpot(layout, w.task);
    const face = w.task.kind === 'trash' ? 0 : Math.atan2(tgt[0] - x, tgt[1] - z);
    this.standAt(w, W.WORK, [x, z], now, ms, face);
  }

  isPending(room, t) {
    if (t.kind === 'bed') return !room.bedMade;
    if (t.kind === 'trash') return !!room.trash[t.target];
    return !!room.issues[t.target];
  }

  moveToNext(w, room, now) {
    const layout = ROOM_BY_ID[room.id];
    const task = this.nextTask(w, room);
    if (!task) {
      this.afterRoom(w, now, layout);
      return;
    }
    w.task = task;
    this.walkLegs(w, [[this.lastPoint(w), taskSpot(layout, task)]], now);
  }

  finishTask(w, now) {
    const room = w.roomId ? this.sim.rooms.get(w.roomId) : null;
    const layout = room && ROOM_BY_ID[room.id];
    if (!room || room.status !== ROOM_STATUS.DIRTY || !w.task || !this.isPending(room, w.task)) {
      if (room && room.status === ROOM_STATUS.DIRTY) this.moveToNext(w, room, now);
      else this.afterRoom(w, now, layout);
      return;
    }
    const t = w.task;
    const res = t.kind === 'issue' ? this.sim.rooms.repair(room, t.target) : this.sim.rooms.clean(room, t.target);
    if (!res.ok) {
      this.moveToNext(w, room, now);
      return;
    }
    const before = this.level(w);
    w.tasks += 1;
    if (this.level(w) > before) {
      const lv = this.level(w);
      this.sim.notify(`🧹 ${w.name} seviye ${lv}'${lv === 2 ? 'ye' : 'e'} yükseldi — artık daha hızlı temizliyor!`, 'info');
      this.sim.hotelChanged();
    }
    this.sim.roomsChanged();
    if (res.finished) {
      this.finishRoom(w, room);
      this.afterRoom(w, now, layout);
      return;
    }
    this.moveToNext(w, room, now);
  }

  /** Oda bitti: bahşiş + tamirat teşekkürü KASAYA, itibar artar */
  finishRoom(w, room) {
    this.sim.today.cleaned += 1;
    const tip = TIP_MIN + Math.floor(this.rng() * (TIP_MAX - TIP_MIN + 1)) + room.repairs * MAINT_RULES.REPAIR_BONUS;
    room.startedAt = null;
    room.repairs = 0;
    this.sim.earn(tip, `🧹 ${w.name} Oda ${room.id}'i temizledi (bahşiş kasaya)`, { guest: false });
    this.sim.growth.addReputation(REPUTATION.ROOM_CLEANED);
    this.sim.house.scheduleSave();
  }

  afterRoom(w, now, layout) {
    const fromLayout = layout ?? null;
    this.release(w);
    if (!fromLayout) {
      this.walkLegs(w, [[this.lastPoint(w), this.spotPos(w)]], now, W.HOME);
      return;
    }
    if (this.sim.clock.night) {
      this.goHome(w, now, fromLayout);
      return;
    }
    this.findWork(w, now, fromLayout);
  }
}

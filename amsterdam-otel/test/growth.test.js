import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, ROOM_STATUS, GUEST_PHASE } from '../shared/constants.js';
import {
  RECEPTION_PC, ELEVATOR, EXTINGUISHERS, BAR_SPILL, ROOM_BY_ID, isOnLanding, floorAt, buildWallSegments,
} from '../shared/layout.js';
import {
  STAR_THRESHOLDS, FLOOR_UPGRADES, WORKER_RULES, INSPECTION, starsFor, reputationAfterStarLoss, workerTaskMs, workerLevel,
  roomPrice,
} from '../shared/hotel.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
};
const KEY = 'b'.repeat(32);

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function seeded(seed = 11) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function setup({ store = null, hour = 11 } = {}) {
  let now = 9_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: hour }, rng: seeded(), now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  const p = sim.addPlayer('Ece', KEY);
  sim.guests.nextSpawnAt = Infinity; // misafirleri testler kendisi yönetir
  sim.bar.nextSpawnAt = Infinity;
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  const at = ([x, z]) => sim.movePlayer(p.id, x, z, 0);
  const act = (data) => sim.hotelAct(p.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  return { sim, p, tick, at, act, events, getNow: () => now, advance: (ms) => { now += ms; } };
}

test('yıldız eşikleri, yıldız kaybı, oda fiyatı ve temizlikçi süresi', () => {
  assert.equal(starsFor(0), 1);
  assert.equal(starsFor(STAR_THRESHOLDS[1] - 1), 1);
  assert.equal(starsFor(STAR_THRESHOLDS[1]), 2);
  assert.equal(starsFor(STAR_THRESHOLDS[4] + 999), 5);
  assert.equal(starsFor(reputationAfterStarLoss(STAR_THRESHOLDS[2] + 5)), 2, 'bir yıldız düşer');
  assert.equal(reputationAfterStarLoss(10), 0);
  assert.equal(roomPrice(95, 1), 95);
  assert.equal(roomPrice(95, 3), 125);
  assert.equal(workerTaskMs(1, 1), 10_000, '1★: 10 sn');
  assert.equal(workerTaskMs(5, 1), 2000, '5★: 2 sn');
  assert.ok(workerTaskMs(3, 4) < workerTaskMs(3, 1), 'seviye hızlandırır');
  assert.ok(workerTaskMs(5, 5) >= 1500);
  assert.equal(workerLevel(0), 1);
  assert.equal(workerLevel(WORKER_RULES.TASKS_PER_LEVEL), 2);
  assert.equal(workerLevel(1e6), WORKER_RULES.MAX_LEVEL);
});

test('yerleşim: üst katlar 16 oda, kat bulma, sahanlık ve duvarlar', () => {
  assert.equal(ROOM_BY_ID['204'].floor, 2);
  assert.equal(ROOM_BY_ID['401'].floor, 4);
  assert.equal(floorAt(0, 5), 1);
  assert.equal(floorAt(0, 30), 1, 'Achterstraat 1. kat');
  assert.equal(floorAt(...ELEVATOR.floor(3).spawn), 3);
  assert.ok(isOnLanding(2, ...ELEVATOR.floor(2).spawn));
  // Asansörden çıkılan nokta hiçbir duvarın içinde değil
  const walls = buildWallSegments().filter((w) => !w.lintel);
  for (const f of [2, 3, 4]) {
    const [x, z] = ELEVATOR.floor(f).spawn;
    assert.ok(!walls.some((w) => x > w.minX - 0.3 && x < w.maxX + 0.3 && z > w.minZ - 0.3 && z < w.maxZ + 0.3), `kat ${f} çıkışı serbest`);
  }
});

test('Resepsiyon PC: kat satın alma kuralları (konum, tip, yıldız, para, sıra)', () => {
  const { sim, at, act, events } = setup();
  const up2 = FLOOR_UPGRADES[0];
  sim.money = 100_000;
  at([0, 3]);
  assert.match(act({ act: 'buyFloor', floor: 2 }).error, /bilgisayar/);
  at(RECEPTION_PC.point);
  for (const bad of [{ act: 'buyFloor', floor: '2' }, { act: 'buyFloor', floor: { toString: () => '2' } }, { act: 'buyFloor', floor: 2.5 }, { act: 'buyFloor', floor: 9 }, { act: '__proto__' }, null]) {
    assert.equal(act(bad).ok, false);
  }
  assert.match(act({ act: 'buyFloor', floor: 2 }).error, /yıldız/);
  sim.growth.reputation = STAR_THRESHOLDS[up2.stars - 1];
  assert.match(act({ act: 'buyFloor', floor: 3 }).error, /alttaki|yıldız/);
  sim.money = up2.price - 1;
  assert.match(act({ act: 'buyFloor', floor: 2 }).error, /para/);
  sim.money = up2.price + 10;
  const res = act({ act: 'buyFloor', floor: 2 });
  assert.equal(res.ok, true);
  assert.equal(sim.growth.floors, 2);
  assert.equal(sim.money, 10);
  assert.ok(events(EVT.ECONOMY).some((e) => e.delta === -up2.price));
  assert.equal(events(EVT.HOTEL_STATE).at(-1).growth.floors, 2);
  assert.match(act({ act: 'buyFloor', floor: 2 }).error, /zaten/);
  assert.ok(sim.rooms.emptyRooms(sim.growth.floors).some((r) => r.id === '203'));
  assert.ok(!sim.rooms.emptyRooms(sim.growth.floors).some((r) => r.id === '301'));
});

test('asansör: yalnızca kapının önünde ve açık katlara; konumu sunucu yazar', () => {
  const { sim, p, at, act } = setup();
  at([0, 3]);
  assert.match(act({ act: 'elevator', floor: 2 }).error, /önünde/);
  at(ELEVATOR.lobby.point);
  assert.match(act({ act: 'elevator', floor: 2 }).error, /henüz yok/);
  assert.equal(act({ act: 'elevator', floor: '2' }).ok, false);
  sim.growth.floors = 3;
  assert.match(act({ act: 'elevator', floor: 1 }).error, /Zaten/);
  const r = act({ act: 'elevator', floor: 3 });
  assert.equal(r.ok, true);
  assert.deepEqual([p.x, p.z], ELEVATOR.floor(3).spawn);
  assert.ok(sim.dirtyPlayers.has(p.id));
  at(ELEVATOR.floor(3).point);
  assert.equal(act({ act: 'elevator', floor: 1 }).ok, true);
  assert.deepEqual([p.x, p.z], ELEVATOR.lobby.spawn);
});

test('misafir: zemin kat doluyken üst kattaki odaya asansörle çıkar ve inerken asansörle döner', () => {
  const { sim, tick, getNow } = setup();
  sim.growth.floors = 2;
  for (const id of ['101', '102', '103', '104']) sim.rooms.occupy(sim.rooms.get(id), 999);
  sim.guests.spawn(getNow());
  let g = [...sim.guests.guests.values()][0];
  for (let i = 0; i < 600 && g.phase !== GUEST_PHASE.TO_ROOM; i++) tick(100);
  assert.equal(g.phase, GUEST_PHASE.TO_ROOM);
  assert.equal(ROOM_BY_ID[g.roomId].floor, 2);
  assert.deepEqual(g.path.at(-1), ELEVATOR.lobby.point, 'ilk bacak lobi asansörüne');
  assert.ok(g.legs?.length === 1);
  tick(g.phaseEndsAt - getNow() + 100);
  assert.deepEqual(g.path[0], ELEVATOR.floor(2).point, 'ikinci bacak kattaki asansörden');
  tick(g.phaseEndsAt - getNow() + 100);
  assert.equal(g.phase, GUEST_PHASE.IN_ROOM);
  // Çıkış
  sim.clock.minute += g.checkoutAt - sim.clock.total + 1;
  tick(100);
  g = [...sim.guests.guests.values()][0];
  assert.equal(g.phase, GUEST_PHASE.CHECKOUT);
  assert.deepEqual(g.path.at(-1), ELEVATOR.floor(2).point);
  assert.ok(sim.money >= 95);
  assert.ok(sim.growth.reputation >= 1, 'yerleşen misafir itibar verir');
});

test('temizlikçi: işe alınır, kirli odayı kendisi temizler, bahşiş kasaya gider, seviye atlar', () => {
  const { sim, p, at, act, tick, events } = setup();
  at(RECEPTION_PC.point);
  sim.money = 150;
  assert.match(act({ act: 'hire' }).error, /para/);
  sim.money = 1000;
  const h = act({ act: 'hire' });
  assert.equal(h.ok, true);
  assert.equal(sim.money, 800);
  assert.equal(sim.workers.workers.size, 1);
  const w = sim.workers.workers.get(h.id);
  assert.ok(events(EVT.GUEST_UPSERT).some((g) => g.id === w.id && g.kind === 'worker'));
  w.tasks = WORKER_RULES.TASKS_PER_LEVEL - 1; // bir sonraki iş seviye atlatır

  const room = sim.rooms.get('102');
  sim.rooms.makeDirty(room);
  const jobs = sim.rooms.remainingTasks(room);
  const wallet = p.wallet;
  const money = sim.money;
  const t0 = sim.now();
  for (let i = 0; i < 3000 && room.status !== ROOM_STATUS.EMPTY; i++) tick(100);
  assert.equal(room.status, ROOM_STATUS.EMPTY, 'temizlikçi odayı bitirmeli');
  assert.ok(sim.now() - t0 >= jobs * workerTaskMs(1, 1) * 0.9, 'her iş süre ister');
  assert.ok(sim.money > money, 'bahşiş kasaya');
  assert.equal(p.wallet, wallet, 'oyuncunun cüzdanı değişmez');
  assert.equal(w.tasks, WORKER_RULES.TASKS_PER_LEVEL - 1 + jobs);
  assert.ok(sim.workers.level(w) >= 2);
  assert.ok(sim.growth.reputation >= 2);
  // Lobiye döner
  tick(30_000);
  assert.equal(w.phase, 'w-idle');
  // İşten çıkarma
  assert.equal(act({ act: 'fire', id: '1' }).ok, false);
  assert.equal(act({ act: 'fire', id: w.id }).ok, true);
  assert.equal(sim.workers.workers.size, 0);
  assert.ok(events(EVT.GUEST_REMOVE).includes(w.id));
});

test('temizlikçi: üst kattaki odaya asansörle gider; en fazla 6 kişi', () => {
  const { sim, at, act, tick } = setup();
  sim.growth.floors = 3;
  sim.growth.reputation = STAR_THRESHOLDS[4]; // 5★: iş başına 2 sn
  sim.money = 10_000;
  at(RECEPTION_PC.point);
  for (let i = 0; i < WORKER_RULES.MAX; i++) assert.equal(act({ act: 'hire' }).ok, true);
  assert.match(act({ act: 'hire' }).error, /En fazla/);
  const room = sim.rooms.get('302');
  sim.rooms.makeDirty(room);
  tick(200);
  const w = [...sim.workers.workers.values()].find((x) => x.roomId === '302');
  assert.ok(w, 'bir temizlikçi odayı üstlenir');
  assert.deepEqual(w.path.at(-1), ELEVATOR.lobby.point);
  assert.equal([...sim.workers.workers.values()].filter((x) => x.roomId === '302').length, 1, 'oda tek kişiye');
  for (let i = 0; i < 2000 && room.status !== ROOM_STATUS.EMPTY; i++) tick(100);
  assert.equal(room.status, ROOM_STATUS.EMPTY);
});

test('denetim: 2★ altında yok; çağrılır, gelir, 90 sn; eksikler → ceza ve yıldız kaybı', () => {
  const { sim, at, act, tick, getNow, events } = setup();
  at(RECEPTION_PC.point);
  assert.match(act({ act: 'inspect' }).error, /yıldız/);
  sim.growth.reputation = STAR_THRESHOLDS[2] + 10; // 3★
  sim.money = 1000;
  assert.equal(act({ act: 'inspect' }).ok, true);
  assert.match(act({ act: 'inspect' }).error, /sürüyor/);
  const a = sim.inspection.active;
  assert.equal(a.phase, 'arriving');
  assert.ok(events(EVT.GUEST_UPSERT).some((g) => g.kind === 'inspector'));
  assert.equal(Object.values(a.ext).filter(Boolean).length, 2, '1 katta 2 tüp kontrol ister');
  tick(a.endsAt - getNow() + 100);
  assert.equal(a.phase, 'countdown');
  sim.rooms.makeDirty(sim.rooms.get('101'));
  tick(INSPECTION.COUNTDOWN_MS + 200);
  assert.equal(sim.inspection.active, null);
  const r = events(EVT.INSPECTION_RESULT).at(-1);
  assert.equal(r.pass, false);
  assert.equal(r.checks.rooms, false);
  assert.equal(sim.money, 1000 - INSPECTION.FINE);
  assert.equal(sim.growth.stars, 2, 'bir yıldız düştü');
  assert.match(act({ act: 'inspect' }).error, /Bugün/);
});

test('denetim: tüp kontrolü ve şurup silme süre + konum ister; hepsi tamam → ödül + plaket', () => {
  const { sim, p, at, act, tick, getNow, advance, events } = setup();
  sim.growth.reputation = STAR_THRESHOLDS[1]; // 2★
  sim.money = 0;
  sim.inspection.start(getNow());
  const a = sim.inspection.active;
  assert.equal(act({ act: 'check', id: 'lobby', step: 'begin' }).ok, false, 'müfettiş gelmeden yok');
  tick(a.endsAt - getNow() + 100);
  const todo = Object.keys(a.ext).filter((id) => a.ext[id]);
  const ok = Object.keys(a.ext).find((id) => !a.ext[id]);
  assert.equal(act({ act: 'check', id: '__proto__', step: 'begin' }).ok, false);
  assert.equal(act({ act: 'check', id: { toString: () => todo[0] }, step: 'begin' }).ok, false);
  assert.equal(act({ act: 'check', id: todo[0], step: 'go' }).ok, false);
  if (ok) assert.match(act({ act: 'check', id: ok, step: 'begin' }).error, /zaten/);
  for (const id of todo) {
    const e = EXTINGUISHERS.find((x) => x.id === id);
    at([0, 3]);
    assert.match(act({ act: 'check', id, step: 'begin' }).error, /yaklaş/);
    at(e.point);
    assert.equal(act({ act: 'check', id, step: 'begin' }).ok, true);
    advance(500);
    assert.match(act({ act: 'check', id, step: 'finish' }).error, /Acele/);
    advance(INSPECTION.CHECK_MS);
    assert.equal(act({ act: 'check', id, step: 'finish' }).ok, true);
  }
  at(BAR_SPILL.point);
  assert.match(act({ act: 'mop', step: 'finish' }).error, /Önce/);
  assert.equal(act({ act: 'mop', step: 'begin' }).ok, true);
  advance(INSPECTION.MOP_MS);
  assert.equal(act({ act: 'mop', step: 'finish' }).ok, true);
  assert.equal(sim.inspection.checks().bar, true);
  tick(INSPECTION.COUNTDOWN_MS);
  const r = events(EVT.INSPECTION_RESULT).at(-1);
  assert.equal(r.pass, true);
  assert.equal(sim.growth.plaques, 1);
  assert.equal(sim.money, INSPECTION.REWARD + INSPECTION.REWARD_PER_STAR * 2);
  assert.ok(sim.growth.reputation >= STAR_THRESHOLDS[1] + 20);
  assert.equal(p.wallet, 50);
});

test('kalıcılık: yıldız, katlar, plaket, temizlikçiler ve denetim günü geri gelir; bozuk kayıt temizlenir', () => {
  const store = memoryStore();
  const a = setup({ store });
  a.sim.growth.reputation = 130;
  a.sim.growth.floors = 3;
  a.sim.growth.plaques = 2;
  a.sim.money = 500;
  a.at(RECEPTION_PC.point);
  assert.equal(a.act({ act: 'hire' }).ok, true);
  a.sim.workers.workers.values().next().value.tasks = 30;
  a.sim.inspection.doneDay = a.sim.clock.dayCount;
  a.sim.house.flush();
  const b = setup({ store });
  assert.equal(b.sim.growth.stars, 3);
  assert.equal(b.sim.growth.floors, 3);
  assert.equal(b.sim.growth.plaques, 2);
  assert.equal(b.sim.workers.workers.size, 1);
  assert.equal(b.sim.workers.workers.values().next().value.tasks, 30);
  assert.equal(b.sim.inspection.doneDay, b.sim.clock.dayCount);
  const snap = b.sim.snapshot(b.p.id);
  assert.equal(snap.hotel.growth.floors, 3);
  assert.ok(snap.guests.some((g) => g.kind === 'worker'));

  const data = JSON.parse(JSON.stringify(store.data));
  data.hotel.growth = { reputation: 'çok', floors: 99, plaques: -4 };
  data.hotel.workers = [{ name: 'Hacker', tasks: -5, look: { skin: 99 } }, null, 'x', ...Array(20).fill({ name: 'Ayla', tasks: 1 })];
  data.hotel.inspection = { doneDay: 'dün', plannedAt: 5 };
  const c = setup({ store: memoryStore(data) });
  assert.equal(c.sim.growth.reputation, 0);
  assert.equal(c.sim.growth.floors, 4, 'en fazla 4 kat');
  assert.equal(c.sim.growth.plaques, 0);
  assert.ok(c.sim.workers.workers.size <= WORKER_RULES.MAX);
  const names = [...c.sim.workers.workers.values()].map((w) => w.name);
  assert.equal(new Set(names).size, names.length, 'isimler tekrarlanmaz');
  assert.ok([...c.sim.workers.workers.values()].every((w) => w.tasks >= 0 && w.look.skin < 5));
  assert.equal(c.sim.inspection.plannedAt, null);
});

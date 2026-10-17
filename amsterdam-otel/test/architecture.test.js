import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import {
  EVT, ROOM_STATUS, GUEST_PHASE, ROOM_IDS, roomFloor,
} from '../shared/constants.js';
import {
  RECEPTION_PC, ELEVATOR, ROOF, ROOF_FLOOR, ROOM_BY_ID, FLOOR_DZ, STAFF_ROOM, LOUNGES, EXTINGUISHERS, WORLD_BOUNDS,
  floorAt, buildFloorWallSegments, buildWallSegments, isInsideRoom,
} from '../shared/layout.js';
import { STAR_THRESHOLDS, WORKER_RULES, WORKER_NAMES } from '../shared/hotel.js';
import {
  ARCH_PACKAGES, VIP, LOUNGE_RULES, isVipRoom, loungeOccupancy, loungeHourly,
} from '../shared/architecture.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
};
const KEY = 'c'.repeat(32);
const [LUX, SKY] = ARCH_PACKAGES;

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function setup({ store = null, hour = 11, rng = seeded() } = {}) {
  let now = 5_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: hour }, rng, now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  const p = sim.addPlayer('Deniz', KEY);
  sim.guests.nextSpawnAt = Infinity;
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
  return { sim, p, tick, at, act, events, getNow: () => now };
}

/** 4 kat + 5★ + bol kasa, oyuncu PC'nin başında */
function ready(o = {}) {
  const t = setup(o);
  t.sim.growth.floors = 4;
  t.sim.growth.reputation = STAR_THRESHOLDS[4];
  t.sim.money = 1_000_000;
  t.at(RECEPTION_PC.point);
  return t;
}

test('roomFloor ve oda kimlikleri: 12 kat × 4 oda, 10–12. katlar doğru', () => {
  assert.equal(ROOM_IDS.length, 48);
  assert.equal(roomFloor('101'), 1);
  assert.equal(roomFloor('904'), 9);
  assert.equal(roomFloor('1001'), 10);
  assert.equal(roomFloor('1103'), 11);
  assert.equal(roomFloor('1204'), 12);
  for (const id of ['501', '804', '1001', '1204']) assert.ok(ROOM_BY_ID[id], `oda ${id}`);
  assert.equal(ROOM_BY_ID['1204'].floor, 12);
  assert.equal(FLOOR_DZ[12], 240);
  assert.equal(FLOOR_DZ[5], 100);
  assert.ok(isVipRoom('1201') && !isVipRoom('201') && !isVipRoom('1101'));
  // Kat bulma: her katın sahanlığı ve odaları, çatı
  for (let f = 2; f <= 12; f++) {
    assert.equal(floorAt(...ELEVATOR.floor(f).spawn), f, `kat ${f} sahanlığı`);
    for (const n of [1, 2, 3, 4]) {
      const r = ROOM_BY_ID[`${f}0${n}`];
      assert.equal(floorAt(r.bed.x, r.bed.z), f);
    }
  }
  assert.equal(floorAt(...ROOF.elevator.spawn), ROOF_FLOOR);
  assert.equal(floorAt(0, 320), ROOF_FLOOR);
  // Salonlar (lounge / personel odası) kendi katlarında
  for (const l of LOUNGES) assert.equal(floorAt(12, 12 + FLOOR_DZ[l.floor]), l.floor);
  assert.equal(floorAt(-12, 12 + FLOOR_DZ[STAFF_ROOM.floor]), STAFF_ROOM.floor);
  // Çatı ve salonlar dünya sınırının içinde
  assert.ok(ROOF.bounds.minX >= WORLD_BOUNDS.minX && ROOF.bounds.maxZ <= WORLD_BOUNDS.maxZ);
  assert.ok(STAFF_ROOM.bounds.minX >= WORLD_BOUNDS.minX);
});

test('üst kat duvarları: asansör çıkışları, personel odası noktaları ve katlar birbirine girmez', () => {
  const hits = (walls, x, z, r = 0.3) => walls.some((w) => x > w.minX - r && x < w.maxX + r && z > w.minZ - r && z < w.maxZ + r);
  const all = [];
  for (let f = 2; f <= 12; f++) {
    const walls = buildFloorWallSegments(f).filter((w) => !w.lintel);
    all.push(...walls);
    assert.ok(!hits(walls, ...ELEVATOR.floor(f).spawn), `kat ${f} asansör çıkışı serbest`);
  }
  // Ana yükleme 1–4. katları içerir; 5–12. katlar ayrıca (tembel) kurulur
  const base = buildWallSegments();
  assert.ok(!base.some((w) => w.minZ > FLOOR_DZ[4] + 27), 'ana duvarlarda 5+ kat yok');
  const dz = FLOOR_DZ[STAFF_ROOM.floor];
  const staffWalls = buildFloorWallSegments(STAFF_ROOM.floor).filter((w) => !w.lintel);
  for (const [x, z] of STAFF_ROOM.spots) assert.ok(!hits(staffWalls, x, z + dz), `bekleme yeri ${x},${z}`);
  for (const [x, z] of STAFF_ROOM.exit) assert.ok(!hits(staffWalls, x, z + dz, 0.2), `çıkış noktası ${x},${z}`);
  // Bir katın duvarları komşu katın odalarına girmez
  for (let f = 2; f <= 12; f++) {
    for (const n of [1, 2, 3, 4]) {
      const r = ROOM_BY_ID[`${f}0${n}`];
      const inner = (w) => w.minX > r.bounds.minX + 0.2 && w.maxX < r.bounds.maxX - 0.2 && w.minZ > r.bounds.minZ + 0.2 && w.maxZ < r.bounds.maxZ - 0.2;
      assert.ok(!all.some(inner), `oda ${r.id} içinde duvar yok`);
    }
  }
  // Yangın tüpleri 12 kata kadar
  assert.ok(EXTINGUISHERS.some((e) => e.floor === 12));
});

test('lüks paket satın alma: PC mesafesi, tipler, sıra, kat, yıldız ve para', () => {
  const { sim, at, act, events } = setup();
  sim.money = 1_000_000;
  at([0, 3]);
  assert.match(act({ act: 'buyPackage', pkg: 'luxury' }).error, /bilgisayar/);
  at(RECEPTION_PC.point);
  for (const bad of [
    { act: 'buyPackage', pkg: 1 }, { act: 'buyPackage', pkg: { toString: () => 'luxury' } }, { act: 'buyPackage', pkg: ['luxury'] },
    { act: 'buyPackage', pkg: '__proto__' }, { act: 'buyPackage', pkg: 'constructor' }, { act: 'buyPackage', pkg: 'toString' },
    { act: 'buyPackage' }, null,
  ]) {
    assert.equal(act(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(sim.arch.level, 0);
  assert.match(act({ act: 'buyPackage', pkg: 'skyscraper' }).error, /Önce/);
  assert.match(act({ act: 'buyPackage', pkg: 'luxury' }).error, /4 katının/);
  sim.growth.floors = 4;
  sim.growth.reputation = STAR_THRESHOLDS[2]; // 3★
  assert.match(act({ act: 'buyPackage', pkg: 'luxury' }).error, /yıldız/);
  sim.growth.reputation = STAR_THRESHOLDS[3]; // 4★
  sim.money = LUX.price - 1;
  assert.match(act({ act: 'buyPackage', pkg: 'luxury' }).error, /para/);
  sim.money = LUX.price + 50;
  const r = act({ act: 'buyPackage', pkg: 'luxury' });
  assert.equal(r.ok, true);
  assert.equal(sim.arch.level, 1);
  assert.equal(sim.growth.floors, 8);
  assert.equal(sim.money, 50);
  assert.ok(events(EVT.ECONOMY).some((e) => e.delta === -LUX.price));
  const st = events(EVT.HOTEL_STATE).at(-1);
  assert.equal(st.arch.level, 1);
  assert.equal(st.arch.maxWorkers, 15);
  assert.equal(st.growth.floors, 8);
  assert.match(act({ act: 'buyPackage', pkg: 'luxury' }).error, /zaten/);
  // Gökdelen: 5★ + para
  sim.money = 1_000_000;
  assert.match(act({ act: 'buyPackage', pkg: 'skyscraper' }).error, /5 yıldız/);
  sim.growth.reputation = STAR_THRESHOLDS[4];
  assert.equal(act({ act: 'buyPackage', pkg: 'skyscraper' }).ok, true);
  assert.equal(sim.arch.level, 2);
  assert.equal(sim.growth.floors, 12);
  assert.equal(sim.money, 1_000_000 - SKY.price);
  assert.equal(events(EVT.HOTEL_STATE).at(-1).arch.roof, true);
  // Kat satın alma eski kurallarla: 5+ kat satılmaz
  assert.equal(act({ act: 'buyFloor', floor: 5 }).ok, false);
  // Odalar yayını yalnızca açık katlar
  assert.equal(events(EVT.ROOMS).at(-1).length, 48);
});

test('asansör: 5–12. katlar ve Çatı durağı pakete bağlı; konumu sunucu yazar', () => {
  const { sim, p, at, act } = ready();
  at(ELEVATOR.lobby.point);
  assert.match(act({ act: 'elevator', floor: 5 }).error, /henüz yok/);
  assert.match(act({ act: 'elevator', floor: ROOF_FLOOR }).error, /Çatı/);
  assert.equal(act({ act: 'elevator', floor: 14 }).ok, false);
  assert.equal(act({ act: 'elevator', floor: '12' }).ok, false);
  at(RECEPTION_PC.point);
  assert.equal(act({ act: 'buyPackage', pkg: 'luxury' }).ok, true);
  at(ELEVATOR.lobby.point);
  assert.equal(act({ act: 'elevator', floor: 8 }).ok, true);
  assert.deepEqual([p.x, p.z], ELEVATOR.floor(8).spawn);
  assert.match(act({ act: 'elevator', floor: 9 }).error, /henüz yok/);
  at(RECEPTION_PC.point);
  assert.equal(act({ act: 'buyPackage', pkg: 'skyscraper' }).ok, true);
  at(ELEVATOR.floor(8).point);
  assert.equal(act({ act: 'elevator', floor: 12 }).ok, true);
  assert.deepEqual([p.x, p.z], ELEVATOR.floor(12).spawn);
  at(ELEVATOR.floor(12).point);
  assert.equal(act({ act: 'elevator', floor: ROOF_FLOOR }).ok, true);
  assert.deepEqual([p.x, p.z], ROOF.elevator.spawn);
  assert.equal(floorAt(p.x, p.z), ROOF_FLOOR);
  at(ROOF.elevator.point);
  assert.equal(act({ act: 'elevator', floor: 1 }).ok, true);
  assert.deepEqual([p.x, p.z], ELEVATOR.lobby.spawn);
});

test('misafirler 5–12. katlara asansör bacaklarıyla gider; normal misafir 12. kata (VIP) hiç yerleşmez', () => {
  const { sim, at, act, tick, getNow } = ready();
  act({ act: 'buyPackage', pkg: 'luxury' });
  act({ act: 'buyPackage', pkg: 'skyscraper' });
  at([0, 3]);
  // 11. kat dışındaki tüm normal odalar dolu → yeni misafir 11. kata
  for (const r of sim.rooms.rooms.values()) if (roomFloor(r.id) < 11) sim.rooms.occupy(r, 999);
  sim.guests.spawn(getNow());
  const g = [...sim.guests.guests.values()][0];
  for (let i = 0; i < 600 && g.phase !== GUEST_PHASE.TO_ROOM; i++) tick(100);
  assert.equal(g.phase, GUEST_PHASE.TO_ROOM);
  assert.equal(roomFloor(g.roomId), 11);
  assert.deepEqual(g.path.at(-1), ELEVATOR.lobby.point, 'ilk bacak lobi asansörüne');
  tick(g.phaseEndsAt - getNow() + 100);
  assert.deepEqual(g.path[0], ELEVATOR.floor(11).point, 'ikinci bacak 11. kattaki asansörden');
  tick(g.phaseEndsAt - getNow() + 100);
  assert.equal(g.phase, GUEST_PHASE.IN_ROOM);
  assert.ok(isInsideRoom(ROOM_BY_ID[g.roomId], ...g.path.at(-1)));
  // 11. kat da dolunca: VIP suitleri boş olsa bile normal misafir yerleşemez
  for (const r of sim.rooms.rooms.values()) if (roomFloor(r.id) === 11 && r.status === ROOM_STATUS.EMPTY) sim.rooms.occupy(r, 999);
  assert.equal(sim.rooms.emptyRooms(12).length, 0);
  assert.equal(sim.rooms.emptyRooms(12, true).length, 4);
  sim.guests.spawn(getNow());
  const g2 = [...sim.guests.guests.values()].at(-1);
  for (let i = 0; i < 600 && g2.phase !== GUEST_PHASE.WAITING && g2.phase !== GUEST_PHASE.LEAVE; i++) tick(100);
  assert.equal(g2.roomId, null);
  assert.ok(![...sim.rooms.rooms.values()].some((r) => isVipRoom(r.id) && r.status !== ROOM_STATUS.EMPTY), 'VIP suitleri boş kalır');
});

test('VIP misafir: €300 öder, yalnızca 12. kata yerleşir, çatıya çıkar ve oradan ayrılır', () => {
  const { sim, at, act, tick, getNow, events } = ready();
  act({ act: 'buyPackage', pkg: 'luxury' });
  act({ act: 'buyPackage', pkg: 'skyscraper' });
  at([0, 3]);
  const money = sim.money;
  const rep = sim.growth.reputation = STAR_THRESHOLDS[4] + 10;
  sim.guests.spawn(getNow(), { vip: true });
  const g = [...sim.guests.guests.values()][0];
  assert.equal(sim.guests.toWire(g).vip, true);
  for (let i = 0; i < 600 && g.phase !== GUEST_PHASE.TO_ROOM; i++) tick(100);
  assert.equal(roomFloor(g.roomId), VIP.FLOOR);
  assert.equal(sim.money, money + VIP.PRICE);
  assert.ok(events(EVT.ECONOMY).some((e) => e.delta === VIP.PRICE && /VIP/.test(e.reason)));
  assert.equal(sim.growth.reputation, rep + VIP.REPUTATION);
  tick(g.phaseEndsAt - getNow() + 100);
  assert.deepEqual(g.path[0], ELEVATOR.floor(12).point);
  tick(g.phaseEndsAt - getNow() + 100);
  assert.equal(g.phase, GUEST_PHASE.IN_ROOM);
  assert.ok(g.roofAt > sim.clock.total);
  // Çatıya çıkış zamanı
  sim.clock.minute += g.roofAt - sim.clock.total + 0.1;
  tick(100);
  assert.equal(g.phase, VIP.PHASE_TO_ROOF);
  assert.deepEqual(g.path.at(-1), ELEVATOR.floor(12).point);
  tick(g.phaseEndsAt - getNow() + 100);
  assert.deepEqual(g.path[0], ROOF.elevator.point, 'çatı asansöründen çıkar');
  tick(g.phaseEndsAt - getNow() + 100);
  assert.equal(g.phase, VIP.PHASE_ON_ROOF);
  assert.ok(g.sit);
  const [x, z] = g.path[0];
  assert.ok(z > ROOF.vipGate.z, 'VIP bölümünde (kapının kuzeyinde)');
  assert.ok(x >= ROOF.bounds.minX && x <= ROOF.bounds.maxX);
  const roomId = g.roomId;
  // Çıkış: oda kirlenir, misafir çatıdan asansörle iner
  sim.clock.minute += g.checkoutAt - sim.clock.total + 1;
  tick(100);
  assert.equal(g.phase, GUEST_PHASE.CHECKOUT);
  assert.equal(sim.rooms.get(roomId).status, ROOM_STATUS.DIRTY);
  assert.deepEqual(g.path.at(-1), ROOF.elevator.point);
  tick(g.phaseEndsAt - getNow() + 100);
  assert.deepEqual(g.path[0], ELEVATOR.lobby.point);
});

test('VIP olasılığı yalnızca Gökdelen + boş VIP suiti varken', () => {
  const { sim, act } = ready({ rng: () => 0.01 });
  assert.equal(sim.arch.rollVip(), false, 'paket yok');
  act({ act: 'buyPackage', pkg: 'luxury' });
  assert.equal(sim.arch.rollVip(), false, 'Lüks Otel: VIP yok');
  act({ act: 'buyPackage', pkg: 'skyscraper' });
  assert.equal(sim.arch.rollVip(), true);
  for (const id of ['1201', '1202', '1203', '1204']) sim.rooms.occupy(sim.rooms.get(id), 999);
  assert.equal(sim.arch.rollVip(), false, 'suitler dolu');
});

test('temizlikçi sınırı 6 → 15 → 30; 7. temizlikçi personel odasında bekler ve oradan işe gider', () => {
  const { sim, at, act, tick } = ready();
  sim.money = 1_000_000;
  for (let i = 0; i < WORKER_RULES.MAX; i++) assert.equal(act({ act: 'hire' }).ok, true);
  assert.match(act({ act: 'hire' }).error, /En fazla 6/);
  assert.equal(act({ act: 'buyPackage', pkg: 'luxury' }).ok, true);
  for (let i = WORKER_RULES.MAX; i < 15; i++) assert.equal(act({ act: 'hire' }).ok, true, `işe alım ${i + 1}`);
  assert.match(act({ act: 'hire' }).error, /En fazla 15/);
  assert.equal(act({ act: 'buyPackage', pkg: 'skyscraper' }).ok, true);
  for (let i = 15; i < 30; i++) assert.equal(act({ act: 'hire' }).ok, true, `işe alım ${i + 1}`);
  assert.match(act({ act: 'hire' }).error, /En fazla 30/);
  const list = [...sim.workers.workers.values()];
  assert.equal(new Set(list.map((w) => w.name)).size, 30);
  assert.ok(list.every((w) => WORKER_NAMES.includes(w.name)));
  const staff = list.filter((w) => sim.workers.isStaffSpot(w));
  assert.equal(staff.length, 24);
  assert.ok(staff.every((w) => floorAt(...w.path[0]) === STAFF_ROOM.floor), 'personel odası 5. katta');
  assert.ok(sim.hotelPublic().workers.some((w) => w.staff));
  // Lobidekiler meşgulken personel odasındaki biri 9. kattaki odaya asansörle gider
  at([0, 3]);
  for (const w of list) if (!sim.workers.isStaffSpot(w)) w.phase = 'w-walk', w.phaseEndsAt = Infinity; // eslint-disable-line no-sequences
  const room = sim.rooms.get('903');
  sim.rooms.makeDirty(room);
  tick(200);
  const w = list.find((x) => x.roomId === '903');
  assert.ok(w && sim.workers.isStaffSpot(w), 'personel odasından biri üstlenir');
  assert.deepEqual(w.path.at(-1), ELEVATOR.floor(STAFF_ROOM.floor).point, '5. kat asansörüne yürür');
  for (let i = 0; i < 3000 && room.status !== ROOM_STATUS.EMPTY; i++) tick(100);
  assert.equal(room.status, ROOM_STATUS.EMPTY, 'oda temizlendi');
  for (let i = 0; i < 3000 && w.phase !== 'w-idle'; i++) tick(100);
  assert.equal(w.phase, 'w-idle');
  assert.equal(floorAt(...w.path[0]), STAFF_ROOM.floor, 'personel odasına döner');
});

test('lounge barlar: açık saatlerde pasif gelir (doluluk + bar bonusu), gece ve paketsiz yok', () => {
  assert.equal(loungeOccupancy(0, 0), 0.5);
  assert.equal(loungeOccupancy(16, 32), 0.75);
  assert.equal(loungeOccupancy(40, 32), 1);
  assert.equal(loungeHourly(2, 1, 1), 2 * LOUNGE_RULES.BASE);
  assert.equal(loungeHourly(2, 1, 2), 4 * LOUNGE_RULES.BASE);

  const { sim, act, tick, events } = ready({ hour: 9 });
  const hourTick = () => {
    sim.clock.minute += 60;
    tick(100);
  };
  // Paket yokken gelir yok
  let money = sim.money;
  for (let i = 0; i < 4; i++) hourTick();
  assert.equal(sim.money, money);
  act({ act: 'buyPackage', pkg: 'luxury' });
  sim.clock.minute = 9 * 60 + 30;
  tick(100);
  money = sim.money;
  hourTick(); // 10:30 — 9:30–10:30 kapalı saat
  hourTick(); // 11:30
  hourTick(); // 12:30
  assert.equal(sim.money, money, 'henüz ödeme yok (birikiyor)');
  hourTick(); // 13:30 → 3 açık saat → ödeme
  const pay = events(EVT.ECONOMY).filter((e) => /Lounge/.test(e.reason));
  assert.equal(pay.length, 1);
  const occ = sim.arch.occupancy();
  assert.equal(pay[0].delta, Math.round(3 * loungeHourly(2, occ, 1)));
  assert.equal(sim.money, money + pay[0].delta);
  assert.equal(sim.today.guests, 0, 'misafir sayısını artırmaz');
  // Bar bonusu (konser / reklam) geliri artırır
  sim.boosts.add({ source: 'test', label: 'Test', minutes: 600, barSpawn: 2 });
  money = sim.money;
  for (let i = 0; i < 3; i++) hourTick();
  assert.equal(sim.money - money, Math.round(3 * loungeHourly(2, occ, 2)));
  // Kapanış (23:00) birikeni öder; gece yok
  sim.clock.minute = 21 * 60 + 30;
  tick(100);
  money = sim.money;
  hourTick(); // 22:30
  hourTick(); // 23:30 → kapanış ödemesi
  assert.ok(sim.money > money);
  money = sim.money;
  hourTick();
  hourTick();
  assert.equal(sim.money, money, 'gece gelir yok');
  // Büyük zaman sıçraması (uyku) geriye dönük gelir yazmaz
  sim.clock.dayCount += 1;
  sim.clock.minute = 15 * 60;
  money = sim.money;
  tick(100);
  assert.equal(sim.money, money);
});

test('denetim: yeni katların tüpleri yalnızca açıkken, en fazla 6 tüp', () => {
  const { sim, act } = ready();
  act({ act: 'buyPackage', pkg: 'luxury' });
  sim.inspection.start(sim.now());
  const ids = Object.keys(sim.inspection.active.ext);
  assert.ok(ids.includes('floor8') && !ids.includes('floor9'), 'yalnızca açık katlar');
  assert.ok(Object.values(sim.inspection.active.ext).filter(Boolean).length <= 6);
});

test('kalıcılık: paket seviyesi, katlar ve 30 temizlikçi geri gelir; bozuk kayıt temizlenir', () => {
  const store = memoryStore();
  const a = ready({ store });
  a.act({ act: 'buyPackage', pkg: 'luxury' });
  a.act({ act: 'buyPackage', pkg: 'skyscraper' });
  for (let i = 0; i < 30; i++) a.act({ act: 'hire' });
  assert.equal(a.sim.workers.workers.size, 30);
  a.sim.house.flush();
  assert.deepEqual(store.data.hotel.arch, { level: 2 });
  const b = setup({ store });
  assert.equal(b.sim.arch.level, 2);
  assert.equal(b.sim.growth.floors, 12);
  assert.equal(b.sim.workers.workers.size, 30);
  assert.equal(b.sim.snapshot(b.p.id).hotel.arch.level, 2);
  assert.ok(b.sim.snapshot(b.p.id).hotel.arch.roof);

  // Bozuk kayıtlar
  const bad = (arch, growth) => {
    const data = JSON.parse(JSON.stringify(store.data));
    data.hotel.arch = arch;
    if (growth) data.hotel.growth = growth;
    return setup({ store: memoryStore(data) }).sim;
  };
  let s = bad({ level: 99 });
  assert.equal(s.arch.level, 2, 'en fazla 2');
  s = bad({ level: '2' }, { reputation: 500, floors: 12, plaques: 0 });
  assert.equal(s.arch.level, 0);
  assert.equal(s.growth.floors, 4, 'paket yoksa en fazla 4 kat');
  assert.ok(s.workers.workers.size <= WORKER_RULES.MAX, 'paket yoksa en fazla 6 temizlikçi');
  s = bad({ level: 1.5 }, { reputation: 500, floors: 2, plaques: 0 });
  assert.equal(s.arch.level, 0);
  s = bad({ level: 1 }, { reputation: 500, floors: 2, plaques: 0 });
  assert.equal(s.arch.level, 1);
  assert.equal(s.growth.floors, 8, 'paket açık katları geri getirir');
  assert.ok(s.workers.workers.size <= 15);
  s = bad(null, { reputation: 500, floors: 99, plaques: 0 });
  assert.equal(s.arch.level, 0);
  assert.equal(s.growth.floors, 4);
  s = bad({ level: -3, __proto__: { level: 2 } });
  assert.equal(s.arch.level, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { GameClock } from '../server/game/GameClock.js';
import { RoomManager } from '../server/game/RoomManager.js';
import {
  EVT, ROOM_STATUS, DAY_START_MIN, CHECKIN_OPEN_MIN, GUEST_PHASE,
} from '../shared/constants.js';
import { ROOM_BY_ID } from '../shared/layout.js';
import { samplePath, pathLength } from '../shared/path.js';

const baseConfig = {
  dayLengthSec: 240,
  weekendSpeed: 2,
  tickMs: 100,
  spawnMinMin: 40,
  spawnMaxMin: 90,
  stayMinMin: 150,
  stayMaxMin: 420,
  clockBroadcastMs: 5000,
  maxPlayers: 16,
};

function seeded(seed = 42) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gerçek zamanlayıcı olmadan simülasyonu sahte saatle adım adım ilerletir */
function makeSim(overrides = {}) {
  let now = 1_000_000;
  const sim = new HotelSimulation({ config: { ...baseConfig, ...overrides }, rng: seeded(), now: () => now });
  sim.start = () => { sim.lastTick = now; }; // setInterval yerine elle tick
  sim.stop = () => {};
  const events = [];
  sim.on('out', (event, payload) => events.push({ event, payload }));
  const advance = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  return { sim, events, advance, getNow: () => now };
}

test('saat: hafta içi açık, hafta sonu kapalı ve daha hızlı', () => {
  const c = new GameClock({ dayLengthSec: 240, weekendSpeed: 2, startMinute: CHECKIN_OPEN_MIN });
  assert.equal(c.dayOfWeek, 0);
  assert.equal(c.checkinOpen, true);
  const weekdayRate = c.rate;
  c.dayCount = 5; // Cumartesi
  assert.equal(c.weekend, true);
  assert.equal(c.checkinOpen, false);
  assert.equal(c.rate, weekdayRate * 2);
});

test('saat: 23:00 sonrası ertesi güne 07:00 olarak geçer, Pazar → Pazartesi', () => {
  const c = new GameClock({ dayLengthSec: 240, weekendSpeed: 2, startDay: 6, startMinute: 22 * 60 + 59 });
  assert.equal(c.advance(1), true);
  assert.equal(c.dayOfWeek, 0);
  assert.equal(c.week, 2);
  assert.equal(c.minute, DAY_START_MIN);
});

test('oda: kirlenir ve tüm işler bitince Boş olur', () => {
  const rm = new RoomManager(seeded(7));
  const room = rm.get('101');
  rm.occupy(room, 1);
  assert.equal(room.status, ROOM_STATUS.OCCUPIED);
  assert.equal(rm.clean(room, 'bed').ok, false, 'dolu oda temizlenemez');
  rm.makeDirty(room);
  assert.equal(room.status, ROOM_STATUS.DIRTY);
  assert.equal(room.bedMade, false);
  const trash = room.trash.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  assert.ok(trash.length >= 2 && trash.length <= 3);
  assert.equal(rm.clean(room, 'bed').finished, false);
  assert.equal(rm.clean(room, 'bed').ok, false, 'aynı iş iki kez yapılamaz');
  trash.forEach((i, k) => {
    const res = rm.clean(room, i);
    assert.equal(res.ok, true);
    assert.equal(res.finished, k === trash.length - 1);
  });
  assert.equal(room.status, ROOM_STATUS.EMPTY);
});

test('yol örnekleme: başlangıç, ara nokta ve bitiş', () => {
  const path = [[0, 0], [3, 0], [3, 4]];
  assert.equal(pathLength(path), 7);
  const mid = samplePath(path, 5);
  assert.deepEqual([mid.x, mid.z, mid.done], [3, 2, false]);
  const end = samplePath(path, 99);
  assert.deepEqual([end.x, end.z, end.done], [3, 4, true]);
});

test('tam döngü: misafir gelir, ödeme yapar, odaya yerleşir, çıkınca oda kirlenir', () => {
  const { sim, events, advance } = makeSim();
  sim.clock.minute = CHECKIN_OPEN_MIN; // Pazartesi 08:00
  const p = sim.addPlayer('Test');
  assert.equal(p.name, 'Test');

  // Misafir gelene ve odasına yerleşene kadar ilerle (en fazla 2 gerçek dakika)
  let guest = null;
  for (let i = 0; i < 1200 && !guest; i++) {
    advance(100);
    guest = [...sim.guests.guests.values()].find((g) => g.phase === GUEST_PHASE.IN_ROOM);
  }
  assert.ok(guest, 'misafir odasına yerleşmeli');
  assert.ok(sim.money > 0, 'oda ücreti tahsil edilmeli');
  assert.equal(sim.rooms.get(guest.roomId).status, ROOM_STATUS.OCCUPIED);
  assert.ok(events.some((e) => e.event === EVT.GUEST_UPSERT));
  assert.ok(events.some((e) => e.event === EVT.ECONOMY && e.payload.delta > 0));

  // Çıkış zamanına sar
  const roomId = guest.roomId;
  sim.clock.minute += (guest.checkoutAt - sim.clock.total) + 1;
  advance(100);
  const room = sim.rooms.get(roomId);
  assert.equal(room.status, ROOM_STATUS.DIRTY, 'çıkışta oda kirlenmeli');
  assert.equal(guest.phase, GUEST_PHASE.CHECKOUT);

  // Oyuncu odaya girip temizler
  const layout = ROOM_BY_ID[roomId];
  sim.movePlayer(p.id, layout.bed.x - layout.side * 1.6, layout.bed.z, 0);
  assert.equal(sim.interact(p.id, roomId, 'bed'), true);
  room.trash.forEach((on, i) => {
    if (!on) return;
    const [x, z] = layout.trashSpots[i];
    sim.movePlayer(p.id, x, z, 0);
    assert.equal(sim.interact(p.id, roomId, i), true);
  });
  assert.equal(room.status, ROOM_STATUS.EMPTY, 'temizlenen oda Boş olmalı');
  assert.ok(events.some((e) => e.event === EVT.NOTIFY && /temizlendi/.test(e.payload.text)));
});

test('etkileşim doğrulaması: oda dışından ya da uzaktan temizlenemez', () => {
  const { sim } = makeSim();
  const p = sim.addPlayer('');
  assert.equal(p.name, 'Görevli 1');
  const room = sim.rooms.get('103');
  sim.rooms.makeDirty(room);
  sim.movePlayer(p.id, 0, 22.5, 0); // koridorda
  assert.equal(sim.interact(p.id, '103', 'bed'), false);
  sim.movePlayer(p.id, -2.0, 25.5, 0); // odada ama yataktan uzak
  assert.equal(sim.interact(p.id, '103', 'bed'), false);
  assert.equal(sim.interact(p.id, '999', 'bed'), false);
  assert.equal(sim.interact(p.id, '103', 'kanepe'), false);
});

test('hafta sonu: misafir gelmez, otel kapalı', () => {
  const { sim, advance } = makeSim();
  sim.clock.dayCount = 5; // Cumartesi
  sim.clock.minute = 10 * 60;
  sim.addPlayer('Hafta');
  advance(30_000);
  assert.equal(sim.guests.guests.size, 0);
  assert.equal(sim.money, 0);
});

test('oda yoksa misafir lobide bekler, oda temizlenince yerleşir', () => {
  const { sim, advance } = makeSim();
  sim.clock.minute = CHECKIN_OPEN_MIN;
  const p = sim.addPlayer('Bekle');
  for (const r of sim.rooms.rooms.values()) sim.rooms.makeDirty(r);

  let waiting = null;
  for (let i = 0; i < 1200 && !waiting; i++) {
    advance(100);
    waiting = [...sim.guests.guests.values()].find((g) => g.phase === GUEST_PHASE.WAITING);
  }
  assert.ok(waiting, 'misafir kanepede beklemeli');
  assert.equal(waiting.sit, true);

  // 101'i temizle
  const room = sim.rooms.get('101');
  const layout = ROOM_BY_ID['101'];
  sim.movePlayer(p.id, layout.bed.x + 1.6, layout.bed.z, 0);
  sim.interact(p.id, '101', 'bed');
  room.trash.forEach((on, i) => {
    if (!on) return;
    const [x, z] = layout.trashSpots[i];
    sim.movePlayer(p.id, x, z, 0);
    sim.interact(p.id, '101', i);
  });
  assert.equal(room.status, ROOM_STATUS.EMPTY);
  advance(100);
  assert.equal(waiting.phase, GUEST_PHASE.TO_ROOM);
  assert.equal(waiting.roomId, '101');
  assert.equal(room.status, ROOM_STATUS.OCCUPIED);
});

test('oyuncu konumu dünya sınırına kırpılır ve toplu yayınlanır', () => {
  const { sim, events, advance } = makeSim();
  const p = sim.addPlayer('A');
  sim.movePlayer(p.id, 999, -999, 10);
  assert.equal(p.x, 18);
  assert.equal(p.z, -7.6);
  advance(100);
  const batch = events.filter((e) => e.event === EVT.PLAYERS).pop();
  assert.ok(batch);
  assert.deepEqual(batch.payload[0].slice(0, 3), [p.id, 18, -7.6]);
  sim.movePlayer(p.id, NaN, 0, 0);
  assert.equal(p.x, 18, 'geçersiz değer yok sayılmalı');
});

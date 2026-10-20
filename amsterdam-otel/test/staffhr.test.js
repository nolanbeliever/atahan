import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, BAR_RULES } from '../shared/constants.js';
import { RECEPTION_PC } from '../shared/layout.js';
import { WORKER_RULES } from '../shared/hotel.js';
import { KITCHEN_STAFF } from '../shared/restaurant.js';
import {
  NEW_STAFF, OUTFITS, HR_RULES, HR_ROLE_IDS, moraleSpeedMul, performanceScore, perfStars,
} from '../shared/staffhr.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
  restaurantDiners: false, valetCustomers: false, basementGuests: false, bouncerSeed: 5,
};

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function setup({ hour = 12, store = null } = {}) {
  let now = 6_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: hour }, rng: seeded(), now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  const p = sim.addPlayer('Deniz', 'd'.repeat(32));
  sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  sim.money = 5000;
  sim.movePlayer(p.id, RECEPTION_PC.point[0], RECEPTION_PC.point[1], 0);
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  const act = (data) => sim.staffAct(p.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  return { sim, p, tick, act, events, now: () => now };
}

test('hız / performans formülleri: moral ve prim iş süresini kısaltır; puan iş + müşteri + hatasızlık', () => {
  assert.equal(moraleSpeedMul(50, false), 1);
  assert.ok(moraleSpeedMul(100, false) < moraleSpeedMul(50, false));
  assert.ok(moraleSpeedMul(0, false) > 1);
  assert.ok(Math.abs(moraleSpeedMul(50, true) - 0.9) < 1e-9);
  assert.equal(performanceScore('worker', {}), 50, 'iş yok, puan yok (nötr 25), hatasız (25)');
  assert.equal(performanceScore('worker', { tasks: 8, ratingSum: 25, ratingN: 5 }), 100);
  assert.equal(performanceScore('waiter', { tasks: 4, mistakes: 6 }), 45);
  assert.equal(perfStars(100), 5);
  assert.equal(perfStars(0), 1);
  for (const r of HR_ROLE_IDS) assert.ok(OUTFITS[r].length >= 4, `${r} üniformaları`);
});

test('Personel 2.0: her pozisyon PC başından işe alınır; liste bütün çalışanları gösterir', () => {
  const { sim, p, act } = setup();
  for (const role of HR_ROLE_IDS) assert.equal(act({ act: 'hire', role }).ok, true, role);
  const cost = WORKER_RULES.HIRE_PRICE + KITCHEN_STAFF.chef.price + KITCHEN_STAFF.waiter.price + NEW_STAFF.barman.price + NEW_STAFF.bouncer.price;
  assert.equal(sim.money, 5000 - cost);
  const list = sim.staffhr.serialize().staff;
  assert.deepEqual(list.map((s) => s.role).sort(), [...HR_ROLE_IDS].sort());
  assert.ok(list.every((s) => s.morale === HR_RULES.MORALE_START && s.outfit === 0));
  assert.equal(act({ act: 'hire', role: 'pilot' }).ok, false);
  assert.equal(act({ act: 'hire', role: 'constructor' }).ok, false, 'prototip anahtarları kabul edilmez');
  // PC'den uzakta işlem yok
  sim.movePlayer(p.id, 0, 3, 0);
  const b = list.find((s) => s.role === 'barman');
  assert.equal(act({ act: 'bonus', role: 'barman', name: b.name, amount: 50 }).ok, false);
});

test('üniforma: herkese yayınlanır (wire outfit), geçersiz seçim reddedilir', () => {
  const { sim, act, events } = setup();
  act({ act: 'hire', role: 'waiter' });
  const w = [...sim.kitchen.staff.values()][0];
  assert.equal(act({ act: 'outfit', role: 'waiter', name: w.name, outfit: 99 }).ok, false);
  assert.equal(act({ act: 'outfit', role: 'waiter', name: w.name, outfit: '2' }).ok, false);
  assert.equal(act({ act: 'outfit', role: 'waiter', name: 'Kimse', outfit: 1 }).ok, false);
  assert.equal(act({ act: 'outfit', role: 'waiter', name: w.name, outfit: 2 }).ok, true);
  const wire = events(EVT.GUEST_UPSERT).filter((x) => x.id === w.id).at(-1);
  assert.deepEqual(wire.outfit, { c: OUTFITS.waiter[2].c, a: OUTFITS.waiter[2].a });
  assert.equal(sim.staffhr.serialize().staff[0].outfit, 2);
});

test('prim: kasadan ödenir, moral + takviye (iş süresi kısalır), günde bir kez; ertesi günler moral düşer', () => {
  const { sim, act } = setup();
  act({ act: 'hire', role: 'worker' });
  const w = [...sim.workers.workers.values()][0];
  const before = sim.staffhr.speedMul('worker', w.name);
  const money = sim.money;
  assert.equal(act({ act: 'bonus', role: 'worker', name: w.name, amount: 30 }).ok, false, 'yalnızca 25 / 50 / 100');
  assert.equal(act({ act: 'bonus', role: 'worker', name: w.name, amount: 100 }).ok, true);
  assert.equal(sim.money, money - 100);
  const s = sim.staffhr.serialize().staff[0];
  assert.equal(s.morale, HR_RULES.MORALE_START + 25);
  assert.equal(s.bonusToday, true);
  assert.equal(s.boosted, true);
  assert.ok(sim.staffhr.speedMul('worker', w.name) < before);
  assert.equal(act({ act: 'bonus', role: 'worker', name: w.name, amount: 25 }).ok, false, 'günde bir prim');
  // 3 gün prim yok → moral düşer, takviye biter; dünkü puan yazılır
  for (let d = 0; d < 3; d++) {
    sim.clock.dayCount += 1;
    sim.staffhr.onNewDay();
  }
  const s2 = sim.staffhr.serialize().staff[0];
  assert.equal(s2.boosted, false);
  assert.equal(s2.morale, HR_RULES.MORALE_START + 25 - HR_RULES.MORALE_DECAY);
  assert.equal(typeof s2.lastScore, 'number');
});

test('barmen: bekleyen müşteriye içeceğini hazırlayıp servis eder (kasa + puan), kirli bardağı yıkar; bardak sayısı korunur', () => {
  const { sim, act, tick } = setup({ hour: 12 });
  assert.equal(act({ act: 'hire', role: 'barman' }).ok, true);
  const bm = [...sim.barStaff.staff.values()][0];
  const glasses = () => assert.equal(sim.bar.glassTotal(), BAR_RULES.GLASSES);
  assert.equal(sim.bar.spawn(sim.now()), true);
  const money = sim.money;
  let served = false;
  for (let t = 0; t < 120_000 && !served; t += 500) {
    tick(500);
    glasses();
    served = sim.bar.stools.some((s) => s.state === 'drinking');
  }
  assert.ok(served, 'barmen servis etti');
  assert.ok(sim.money > money, 'satış + bahşiş kasaya');
  assert.equal(sim.today.served, 1);
  const rec = sim.staffhr.records.get(`barman:${bm.name}`);
  assert.equal(rec.ratingN, 1);
  // Müşteri içip gidince kirli bardağı toplar ve yıkar
  tick(BAR_RULES.DRINK_MS + 30_000, 250);
  glasses();
  assert.ok(sim.bar.stools.every((s) => s.glass === null), 'tezgâh temiz');
  assert.equal(sim.bar.rack, BAR_RULES.GLASSES);
  assert.equal(bm.tasks, 2);
  assert.equal(sim.staffhr.serialize().staff[0].today.tasks, 2);
  // Çıkar: İK kaydı da silinir
  assert.equal(act({ act: 'fire', role: 'barman', id: bm.id }).ok, true);
  assert.equal(sim.barStaff.staff.size, 0);
  assert.equal(sim.staffhr.records.has(`barman:${bm.name}`), false);
});

test('İK kaydı ve yeni çalışanlar (barmen / bouncer) kayıtla geri gelir', () => {
  const { sim, act } = setup();
  act({ act: 'hire', role: 'barman' });
  act({ act: 'hire', role: 'bouncer' });
  const b = [...sim.barStaff.staff.values()][0];
  act({ act: 'outfit', role: 'barman', name: b.name, outfit: 3 });
  act({ act: 'bonus', role: 'barman', name: b.name, amount: 50 });
  const saved = JSON.parse(JSON.stringify(sim.hotelState()));
  const sim2 = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 12 }, rng: seeded(), now: () => sim.now() });
  sim2.restoreHotel(saved);
  assert.equal(sim2.barStaff.staff.size, 1);
  assert.equal(sim2.bouncer.staff.size, 1);
  const s = sim2.staffhr.serialize().staff.find((x) => x.role === 'barman');
  assert.equal(s.outfit, 3);
  assert.equal(s.morale, HR_RULES.MORALE_START + 15);
  // Bozuk kayıt yok sayılır
  const sim3 = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 12 }, rng: seeded(), now: () => sim.now() });
  sim3.restoreHotel({ staffhr: { records: { 'pilot:X': { outfit: 1 }, 'barman:Jesse': { outfit: 999, morale: 'çok' } } }, barStaff: [{ name: 42 }] });
  assert.equal(sim3.staffhr.records.has('pilot:X'), false);
  assert.equal(sim3.staffhr.records.get('barman:Jesse').outfit, OUTFITS.barman.length - 1);
  assert.equal(sim3.staffhr.records.get('barman:Jesse').morale, HR_RULES.MORALE_START);
});

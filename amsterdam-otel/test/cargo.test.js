import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { GARAGE, DRAG, TELEPORTS, areaAt, RECEPTION_PC } from '../shared/layout.js';
import { bigArea } from '../shared/cars.js';
import { BASEMENT } from '../shared/basement.js';
import { BUFFET } from '../shared/restaurant.js';
import {
  CARGO_DOCK as D, CARGO_TYPES, CARGO_RULES as R, CARGO_EFFECTS, TRAILER, forkCenter, isInsideHall, isInsideCabin, trailerAt, truckPose,
} from '../shared/cargo.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
  restaurantDiners: false, basementGuests: false, valetCustomers: false, cargoSuppliers: false,
};

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function setup({ hour = 13, store = null, extra = {} } = {}) {
  let now = 5_000_000;
  const sim = new HotelSimulation({ config: { ...config, ...extra, startDay: 1, startHour: hour }, rng: seeded(), now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => out.push({ event, payload, to: id }));
  const p = sim.addPlayer('Deniz', 'd'.repeat(32));
  sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  const at = (pl, [x, z], yaw = 0) => sim.movePlayer(pl.id, x, z, yaw);
  const act = (pl, data) => sim.cargoAct(pl.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  return { sim, p, tick, at, act, events, out, now: () => now, advance: (ms) => { now += ms; } };
}

/** Oyuncuyu çatal ortası (x, z) paletin üstüne gelecek şekilde, yaw yönünde konumlar */
function behind([x, z], yaw) {
  return [x + Math.sin(yaw) * R.FORK_C, z + Math.cos(yaw) * R.FORK_C];
}

// ---- Yerleşim -----------------------------------------------------------------------------------

test('mal kabul: dünyanın ayrı köşesinde; garaj / drag / bodrum / otel ile çakışmaz; alan, ışınlanma, rampa yerleri', () => {
  const b = D.bounds;
  const overlap = (o, pad = 2) => b.minX < o.maxX + pad && b.maxX > o.minX - pad && b.minZ < o.maxZ + pad && b.maxZ > o.minZ - pad;
  assert.equal(overlap(GARAGE.bounds), false);
  assert.equal(overlap(DRAG.bounds), false);
  assert.equal(overlap(BASEMENT.bounds), false);
  assert.equal(b.minX > 20, true, 'otel / Achterstraat / üst katlar x ≤ 44');
  assert.equal(bigArea(120, 45), 'dock');
  assert.equal(areaAt(120, 45), 'dock');
  const tp = TELEPORTS.find((t) => t.id === 'dock');
  assert.ok(tp && isInsideHall(tp.point[0], tp.point[1]));
  // Rampa / dorse / asansör
  assert.deepEqual([D.truckBay.x, D.truckBay.yaw], [D.bays[0].x, 0]);
  assert.equal(D.truckBay.rearZ, TRAILER.rearZ);
  for (const bay of D.bays) {
    assert.equal(bay.slots.length, 16);
    for (const [x, z] of bay.slots) assert.equal(trailerAt(x, z), bay.id);
  }
  for (const [x, z] of D.elevator.slots) assert.equal(isInsideCabin(x, z), true);
  for (const j of D.jacks) assert.equal(isInsideHall(j.x, j.z, 0.5), true);
  assert.equal(isInsideHall(...D.door.spawn), true);
  assert.equal(isInsideHall(...D.office.point), true);
  // Tır animasyonu rampada biter
  const end = truckPose(1, 'arriving', 1);
  assert.deepEqual([end.x, end.z, end.yaw], [D.bays[1].truck.x, D.bays[1].truck.z, 0]);
  assert.equal(truckPose(0, 'leaving', 1).x, D.road.farX);
});

// ---- Sipariş + NPC tırı ---------------------------------------------------------------------------

test('sipariş: PC başında, bedel + nakliye kasadan; tır gelir, yanaşır; paletler dorsede', () => {
  const { sim, p, at, act, tick, events } = setup();
  sim.money = 1000;
  assert.match(act(p, { act: 'order', via: 'pc', items: { food: 2 } }).error, /bilgisayar/);
  at(p, RECEPTION_PC.point);
  assert.equal(act(p, { act: 'order', via: 'pc', items: { food: 5 } }).ok, false, 'tür başına en fazla 4');
  assert.equal(act(p, { act: 'order', via: 'pc', items: { beer: 1 } }).ok, false, 'bilinmeyen tür');
  const res = act(p, { act: 'order', via: 'pc', items: { food: 2, clean: 1 } });
  assert.equal(res.ok, true);
  const cost = R.DELIVERY_FEE + 2 * CARGO_TYPES.food.price + CARGO_TYPES.clean.price;
  assert.equal(res.cost, cost);
  assert.equal(sim.money, 1000 - cost);
  // Kasa yetmezse
  sim.money = 10;
  assert.match(act(p, { act: 'order', via: 'pc', items: { fun: 1 } }).error, /Kasada/);
  // Vakti gelince NPC tırı Rampa 2'ye (NPC'ler 2'yi tercih eder) girer
  tick(R.ETA_MAX_MS + 200);
  const bay = sim.cargo.bays[1];
  assert.ok(['arriving', 'docked'].includes(bay.truck?.phase));
  assert.equal(sim.cargo.palletsIn(1), 3);
  tick(R.ARRIVE_MS + 200);
  assert.equal(bay.truck.phase, 'docked');
  const st = events(EVT.CARGO_STATE).at(-1);
  assert.equal(st.pallets.filter((x) => x.where === 'trailer').length, 3);
  assert.equal(sim.cargo.orders.length, 0);
});

test('deliver(): tır sistemi API — Rampa 1, 16 paletlik dorselere bölünür, rampalar doluysa sıra', () => {
  const { sim, tick } = setup();
  const a = sim.cargo.deliver({ by: 'Deniz', items: [{ type: 'drinks', count: 3 }], source: 'truck' });
  assert.deepEqual(a, { ok: true, handled: true, bay: 0, pallets: 3 });
  assert.equal(sim.cargo.bays[0].truck.npc, false);
  const b = sim.cargo.deliver({ by: { name: 'Ece' }, items: [{ type: 'food', count: 10 }, { type: 'fun', count: 10 }], source: 'truck' });
  assert.equal(b.ok, true);
  assert.equal(b.queued, true, '20 palet: biri Rampa 2, kalanı sırada');
  assert.equal(sim.cargo.queue.length, 1);
  assert.equal(sim.cargo.deliver({ items: [{ type: 'food', count: 40 }] }).ok, false);
  assert.equal(sim.cargo.deliver({ items: [{ type: 'x', count: 1 }] }).ok, false);
  assert.equal(sim.cargo.deliver({ items: [{ type: 'food', count: 1.5 }] }).ok, false);
  // Rampa 1 boşalınca sıradaki yanaşır
  tick(R.ARRIVE_MS + 100);
  for (const pal of [...sim.cargo.pallets.values()]) if (pal.bay === 0) sim.cargo.pallets.delete(pal.id);
  sim.cargo.afterUnload(0);
  tick(R.LEAVE_MS + 200);
  assert.equal(sim.cargo.queue.length, 0);
  assert.equal(sim.cargo.bays[0].truck?.phase === 'arriving' || sim.cargo.bays[0].truck?.phase === 'docked', true);
});

// ---- Transpalet: kapı, al, hizala, kaldır, çarp, kabine indir, asansör ------------------------------

test('transpalet: servis kapısı, hizalama denetimi, çarpma hasarı, kabine indirme, asansör → stok', () => {
  const { sim, p, at, act, tick, advance } = setup();
  sim.cargo.deliver({ by: 'Toptancı', items: [{ type: 'food', count: 2 }], source: 'truck' });
  tick(R.ARRIVE_MS + 100);
  // Achterstraat → avlu
  at(p, [0, 3]);
  assert.equal(act(p, { act: 'gate' }).ok, false);
  at(p, D.cityGate.point);
  const g = act(p, { act: 'gate' });
  assert.equal(g.ok, true);
  assert.equal(g.dock, true);
  assert.deepEqual([p.x, p.z], D.door.spawn);
  advance(3000); // ışınlanma sonrası gecikmiş paket koruması (GarageService) dolsun
  // Transpaleti al
  assert.match(act(p, { act: 'take', j: 0 }).error, /yanına/);
  const J = D.jacks[0];
  at(p, [J.x, J.z]);
  assert.equal(act(p, { act: 'take', j: 0 }).ok, true);
  assert.equal(act(p, { act: 'gate' }).ok, false, 'transpaletle kapıdan geçilmez');
  const q = sim.addPlayer('Ece', 'e'.repeat(32));
  at(q, [J.x, J.z]);
  assert.match(act(q, { act: 'take', j: 0 }).error, /Deniz/);
  // Dorsedeki ilk palet (yaw 0 → güneye bakarak çatal ortası paletin üstünde)
  const pal = [...sim.cargo.pallets.values()].find((x) => x.slot === 0);
  const [px, pz] = [pal.x, pal.z];
  at(p, behind([px + 0.9, pz], 0), 0);
  assert.match(act(p, { act: 'lift', id: pal.id }).error, /ortala/);
  at(p, behind([px, pz], 0.9), 0.9);
  assert.match(act(p, { act: 'lift', id: pal.id }).error, /hiza/);
  at(p, behind([px + 0.1, pz], Math.PI / 2 + 0.05), Math.PI / 2 + 0.05); // 4 yönlü palet: yandan da girilir
  assert.equal(act(p, { act: 'lift', id: pal.id }).ok, true);
  assert.equal(pal.where, 'jack');
  // Çarpma: yavaşsa hasar yok, hızlıysa hasar (soğuma süresiyle)
  assert.equal(act(p, { act: 'bump', speed: 0.5 }).damage, 0);
  const hit = act(p, { act: 'bump', speed: 2 });
  assert.ok(hit.damage > 0.2 && hit.damage <= 0.3);
  assert.equal(act(p, { act: 'bump', speed: 2 }).damage, 0, 'soğuma');
  assert.equal(act(p, { act: 'bump', speed: 99 }).ok, false);
  advance(R.BUMP_COOLDOWN_MS + 10);
  const cond = pal.cond;
  // Salonda yere bırak, yeniden kaldır
  at(p, [112, 46], Math.PI);
  const dropped = act(p, { act: 'drop' });
  assert.deepEqual([dropped.ok, dropped.where], [true, 'floor']);
  const [fx, fz] = forkCenter(112, 46, Math.PI);
  assert.ok(Math.hypot(pal.x - fx, pal.z - fz) < 0.02);
  at(p, [112, 46], Math.PI);
  assert.equal(act(p, { act: 'lift', id: pal.id }).ok, true);
  // Kabine (çatal ortası kabindeki boş yere yakın: kuzeye bakarak)
  const [sx, sz] = D.elevator.slots[0];
  at(p, behind([sx, sz], Math.PI), Math.PI);
  const c = act(p, { act: 'drop' });
  assert.deepEqual([c.ok, c.where, c.slot], [true, 'cabin', 0]);
  // Asansörü gönder: kolonun yanında
  at(p, [J.x, J.z]);
  assert.match(act(p, { act: 'send' }).error, /kolon/);
  at(p, D.elevator.panel.point);
  assert.equal(act(p, { act: 'send' }).ok, true);
  assert.equal(act(p, { act: 'send' }).ok, false);
  tick(R.ELEV_MS + 200);
  assert.equal(sim.cargo.cabin.phase, 'open');
  assert.equal(sim.cargo.stock.food, Math.round(10 * cond));
  assert.equal(sim.cargo.pallets.has(pal.id), false);
  assert.equal(sim.cargo.stats.pallets, 1);
  assert.equal(sim.cargo.stats.damaged, 1);
  // Son palet de alınınca tır ayrılır, rampa boşalır
  const last = [...sim.cargo.pallets.values()][0];
  at(p, behind([last.x, last.z], 0), 0);
  assert.equal(act(p, { act: 'lift', id: last.id }).ok, true);
  assert.equal(sim.cargo.bays[0].truck.phase, 'leaving');
  tick(R.LEAVE_MS + 200);
  assert.equal(sim.cargo.bays[0].truck, null);
  // Oyuncu çıkarsa palet yere, transpalet serbest
  sim.removePlayer(p.id);
  assert.equal(last.where, 'floor');
  assert.equal(sim.cargo.jacks[0].by, null);
  assert.equal(sim.cargo.jacks[0].carry, null);
});

test('dorse uzun süre dolu bekletilirse bekleme ücreti, sonra paletler rampaya; sabit gün başı tüketimi', () => {
  const { sim, tick } = setup();
  sim.money = 500;
  sim.cargo.deliver({ by: 'X', items: [{ type: 'fun', count: 2 }], source: 'order' });
  tick(R.ARRIVE_MS + 100);
  sim.cargo.update(sim.now() + R.WAIT_MS + 10);
  assert.equal(sim.money, 500 - R.WAIT_FEE);
  sim.cargo.update(sim.now() + R.WAIT_MS + R.FEE_EVERY_MS + 20);
  sim.cargo.update(sim.now() + R.WAIT_MS + 2 * R.FEE_EVERY_MS + 30);
  assert.equal(sim.money, 500 - 2 * R.WAIT_FEE);
  assert.equal(sim.cargo.bays[1].truck.phase, 'leaving');
  for (const pal of sim.cargo.pallets.values()) {
    assert.equal(pal.where, 'floor');
    assert.equal(isInsideHall(pal.x, pal.z), true);
  }
  // Gün başı: stok azalır
  sim.cargo.stock.food = 40;
  sim.cargo.stock.clean = 1;
  sim.cargo.onNewDay();
  assert.equal(sim.cargo.stock.food, 32);
  assert.equal(sim.cargo.stock.clean, 0);
});

// ---- Stok etkileri ---------------------------------------------------------------------------------

test('stok etkileri: büfe tazeleme yarı fiyat, bar +€, temizlik süresi kısalır; stok biter', () => {
  const { sim } = setup();
  sim.money = 1000;
  sim.restaurant.buffet = 0;
  assert.equal(sim.restaurant.restockBuffet('Deniz'), null);
  assert.equal(sim.money, 1000 - BUFFET.REFILL_COST, 'stok yokken tam fiyat');
  sim.cargo.stock.food = 1;
  sim.restaurant.buffet = 0;
  assert.equal(sim.restaurant.restockBuffet('Deniz'), null);
  assert.equal(sim.money, 1000 - BUFFET.REFILL_COST - Math.round(BUFFET.REFILL_COST * CARGO_EFFECTS.food.costMul));
  assert.equal(sim.cargo.stock.food, 0);
  assert.equal(sim.cargo.use('food'), false);
  sim.cargo.stock.drinks = 2;
  assert.equal(sim.cargo.use('drinks'), true);
  assert.equal(sim.cargo.stock.drinks, 1);
});

test('otomatik sipariş + toptancı fırsatı (cargoSuppliers açıkken); kalıcılık', () => {
  const store = { data: null, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
  const { sim, p, at, act, tick } = setup({ store, extra: { cargoSuppliers: true } });
  sim.money = 2000;
  at(p, RECEPTION_PC.point);
  assert.equal(act(p, { act: 'auto', via: 'pc', type: 'clean', on: true }).ok, true);
  assert.equal(act(p, { act: 'auto', via: 'pc', type: 'clean', on: 'yes' }).ok, false);
  tick(200);
  assert.equal(sim.cargo.orders.length, 1, 'stok 15 altında: 2 palet otomatik');
  assert.deepEqual(sim.cargo.orders[0].items, { clean: R.AUTO_PALLETS });
  tick(200);
  assert.equal(sim.cargo.orders.length, 1, 'tekrar sipariş edilmez');
  // Fırsat
  let found = false;
  for (let k = 0; k < 12 && !found; k++) {
    sim.cargo.onNewDay();
    found = !!sim.cargo.offer;
  }
  assert.equal(found, true);
  const t = sim.cargo.offer.type;
  assert.equal(sim.cargo.quote({ [t]: 1 }), R.DELIVERY_FEE + Math.round(CARGO_TYPES[t].price * R.OFFER_MUL));
  // Kalıcılık: stok, sipariş, dorse, paletler
  sim.cargo.stock.fun = 17;
  sim.cargo.deliver({ by: 'Y', items: [{ type: 'drinks', count: 2 }], source: 'truck' });
  const saved = JSON.parse(JSON.stringify(sim.hotelState()));
  const again = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 13 }, rng: seeded(), now: () => 9_000_000, house: { store: null } });
  again.restoreHotel(saved);
  assert.equal(again.cargo.stock.fun, 17);
  assert.equal(again.cargo.auto.clean, true);
  assert.equal(again.cargo.orders.length, 1);
  assert.equal(again.cargo.bays[0].truck.phase, 'docked');
  assert.equal(again.cargo.palletsIn(0), 2);
  assert.equal(again.cargo.offer?.type, t);
});

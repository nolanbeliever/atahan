import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, GUEST_PHASE, ROOM_STATUS } from '../shared/constants.js';
import {
  RESTAURANT, RECEPTION_PC, BAR, isInsideRestaurant, buildWallSegments, areaAt, ROOM_BY_ID,
} from '../shared/layout.js';
import {
  DISHES, DISH_BY_ID, KITCHEN_INGREDIENTS, KITCHEN_INGREDIENT_BY_ID, COOK_METHODS, RESTAURANT_RULES as R, BUFFET,
  KITCHEN_STAFF, matchDish, restaurantRoute, stayFactor, chefSpeedScale, restaurantSpawnFactor,
} from '../shared/restaurant.js';
import { VIP } from '../shared/architecture.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
  valetCustomers: false, // VIP vale müşterileri kapalı: RNG dizisi bu testlerde değişmesin
  basementGuests: false, // Eğlence Katı misafirleri kapalı: RNG dizisi bu testlerde değişmesin
};
const KEY = 'c'.repeat(32);

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

function setup({ store = null, hour = 13 } = {}) {
  let now = 5_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: hour }, rng: seeded(), now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => out.push({ event, payload, to: id }));
  const p = sim.addPlayer('Deniz', KEY);
  sim.guests.nextSpawnAt = Infinity; // misafirleri, bar müşterilerini ve restoran müşterilerini testler yönetir
  sim.bar.nextSpawnAt = Infinity;
  sim.restaurant.nextSpawnAt = Infinity;
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  const at = ([x, z]) => sim.movePlayer(p.id, x, z, 0);
  /** Mutfak adımı: önceki adımın süresi dolmuş sayılır (zaman ilerletilir) */
  const step = (data) => {
    now = Math.max(now, p.kitchen.busyUntil);
    return sim.kitchenAct(p.id, data);
  };
  const hotel = (data) => sim.hotelAct(p.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  const rest = sim.restaurant;
  /** Sokaktan bir müşteri getir ve masasına oturt (rng sabitlenir: otel misafiri / büfe seçilmez) */
  const seatWalkIn = (dishId = null) => {
    const rng = sim.rng;
    sim.rng = () => 0.99;
    assert.equal(rest.spawn(now), true);
    sim.rng = rng;
    const d = [...rest.diners.values()].at(-1);
    for (let i = 0; i < 400 && d.e.phase !== 'dineSeat'; i++) tick(250);
    assert.equal(d.e.phase, 'dineSeat');
    const t = rest.tables[d.table];
    if (dishId) {
      t.order = dishId;
      rest.changed();
    }
    return { d, t, i: d.table };
  };
  /** Bir tabağı oyuncu olarak baştan sona hazırla (elde tabak kalır) */
  const cook = (dishId) => {
    const dish = DISH_BY_ID[dishId];
    at(RESTAURANT.fridge.point);
    for (const ing of dish.ingredients) assert.equal(step({ act: 'take', ing }).ok, true, ing);
    at(RESTAURANT.stations[dish.method]);
    assert.equal(step({ act: 'cook', method: dish.method }).ok, true);
    at(RESTAURANT.plates);
    const r = step({ act: 'plate' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.hold, { kind: 'dish', dish: dishId });
  };
  return {
    sim, p, rest, tick, at, step, hotel, events, seatWalkIn, cook, getNow: () => now, advance: (ms) => { now += ms; },
  };
}

/** Otel misafirini odasına yerleştir (IN_ROOM) */
function guestInRoom(t, roomId, { vip = false } = {}) {
  const { sim, getNow } = t;
  const room = sim.rooms.get(roomId);
  sim.guests.spawn(getNow(), { vip });
  const g = [...sim.guests.guests.values()].at(-1);
  sim.rooms.occupy(room, g.id);
  g.roomId = roomId;
  g.checkoutAt = sim.clock.total + 400;
  sim.guests.stand(g, GUEST_PHASE.IN_ROOM, ROOM_BY_ID[roomId].path.stand, 0, getNow());
  return g;
}

// ---- Tablolar ve yerleşim ---------------------------------------------------------------------

test('menü: 7 tabak (wagyu, pizza, burger, suşi, iki lüks tatlı, kahvaltı); malzeme ikonları benzersiz; eşleştirme', () => {
  assert.deepEqual(DISHES.map((d) => d.id), ['wagyu', 'pizza', 'burger', 'sushi', 'souffle', 'pavlova', 'breakfast']);
  assert.equal(new Set(KITCHEN_INGREDIENTS.map((i) => i.icon)).size, KITCHEN_INGREDIENTS.length);
  for (const d of DISHES) {
    assert.ok(COOK_METHODS[d.method], d.id);
    assert.ok(d.ingredients.length <= R.MAX_ITEMS);
    for (const i of d.ingredients) assert.ok(KITCHEN_INGREDIENT_BY_ID[i], i);
    assert.equal(matchDish([...d.ingredients].reverse(), d.method), d, 'sıra serbest');
  }
  assert.equal(matchDish(DISH_BY_ID.pizza.ingredients, 'pan'), null, 'yanlış yöntem');
  assert.equal(matchDish(['wagyu', 'butter'], 'pan'), null, 'eksik malzeme');
  assert.equal(KITCHEN_INGREDIENT_BY_ID.__proto__, undefined);
  assert.ok(DISHES.filter((d) => d.lux).every((d) => d.price >= 26));
});

test('yerleşim: restoran lobinin batısında, kapı otelin batı duvarında; rotalar masaların, pass\'in ve adanın içinden geçmez', () => {
  assert.equal(areaAt(-12, 14), 'restaurant');
  assert.equal(areaAt(-12, 23), 'restaurant');
  assert.equal(isInsideRestaurant(-5, 10), false);
  const walls = buildWallSegments().filter((w) => !w.lintel);
  const blocked = (x, z, r = 0.05) => walls.some((w) => x > w.minX - r && x < w.maxX + r && z > w.minZ - r && z < w.maxZ + r);
  const mid = (RESTAURANT.door.from + RESTAURANT.door.to) / 2;
  assert.equal(blocked(-8, mid), false, 'kapı açık');
  assert.equal(blocked(-8, RESTAURANT.door.from - 0.3), true);
  assert.equal(blocked(-18, 15), true, 'batı duvarı');

  const obstacles = [
    RESTAURANT.pass, RESTAURANT.island, RESTAURANT.counter,
    ...RESTAURANT.tables.map((tb) => ({ minX: tb.center[0] - 0.5, maxX: tb.center[0] + 0.5, minZ: tb.center[1] - 0.5, maxZ: tb.center[1] + 0.5 })),
  ];
  const hits = (x, z) => obstacles.some((o) => x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ) || blocked(x, z, 0);
  const pts = [
    RESTAURANT.points.doorWest, RESTAURANT.fridge.point, RESTAURANT.plates, RESTAURANT.sink, RESTAURANT.trash, RESTAURANT.buffet.point,
    ...Object.values(RESTAURANT.stations), ...RESTAURANT.chefSpots, ...RESTAURANT.waiterSpots,
    ...RESTAURANT.tables.flatMap((tb) => [tb.seat, tb.serve]),
    ...RESTAURANT.passSlots.flatMap(([x]) => [[x, 20.5], [x, 18.95]]),
  ];
  for (const a of pts) {
    for (const b of pts) {
      const path = restaurantRoute(a, b);
      assert.deepEqual(path[0], a);
      assert.deepEqual(path.at(-1), b);
      for (let k = 1; k < path.length; k++) {
        const [x0, z0] = path[k - 1];
        const [x1, z1] = path[k];
        for (let s = 0; s <= 20; s++) {
          const x = x0 + (x1 - x0) * (s / 20);
          const z = z0 + (z1 - z0) * (s / 20);
          assert.ok(!hits(x, z), `rota ${a} → ${b} engelden geçiyor (${x.toFixed(2)}, ${z.toFixed(2)})`);
          assert.ok(isInsideRestaurant(x, z), `rota restoranın dışına çıkıyor (${x}, ${z})`);
        }
      }
    }
  }
});

test('kurallar: yıldız ve doluluk müşteriyi sıklaştırır, aşçıyı hızlandırır; memnuniyet konaklamayı uzatır', () => {
  assert.ok(restaurantSpawnFactor(5, 1) < restaurantSpawnFactor(1, 0));
  assert.ok(restaurantSpawnFactor(3, 0.5) < restaurantSpawnFactor(3, 0));
  assert.ok(chefSpeedScale(5, 1) < chefSpeedScale(1, 1));
  assert.ok(chefSpeedScale(1, 5) < chefSpeedScale(1, 1));
  assert.ok(chefSpeedScale(5, 5) >= 0.4);
  assert.equal(stayFactor(40), 1);
  assert.equal(stayFactor(100), 1.4);
});

// ---- Oyuncu mutfakta --------------------------------------------------------------------------

test('müşteri sokaktan gelir, masaya oturur, sipariş verir (kind: diner); oyuncu pişirip servis eder → kasa + bahşiş', () => {
  const t = setup();
  const { sim, p, rest, at, step, events } = t;
  const { d, t: table, i } = t.seatWalkIn('pizza');
  const up = events(EVT.GUEST_UPSERT).filter((g) => g.id === d.id).at(-1);
  assert.equal(up.kind, 'diner');
  assert.equal(up.sit, true);
  assert.equal(up.face, 0);
  assert.deepEqual(up.path, [RESTAURANT.tables[i].seat]);
  assert.equal(table.state, 'waiting');
  assert.ok(!sim.guests.guests.has(d.id), 'sokaktan gelen GuestManager haritasına girmez');
  assert.equal(events(EVT.RESTAURANT_STATE).at(-1).tables[i].state, 'waiting');

  const money = sim.money;
  t.cook('pizza');
  at(RESTAURANT.tables[i].center);
  const r = step({ act: 'serve', table: i });
  assert.equal(r.ok, true);
  assert.equal(r.hold, null);
  assert.equal(table.state, 'eating');
  assert.equal(table.plate, 'full');
  assert.equal(sim.money, money + r.price + r.tip);
  assert.equal(r.price, DISH_BY_ID.pizza.price);
  assert.ok(r.tip >= 1);
  assert.equal(sim.today.meals, 1);
  assert.equal(p.wallet, 50, 'gelir kasaya, cüzdan değişmez');
  assert.ok(events(EVT.PLAYER_KITCHEN).length > 0);

  // Yemeğini bitirir, kirli tabak bırakır, gider
  t.tick(R.EAT_MS + 200);
  assert.equal(table.state, 'empty');
  assert.equal(table.plate, 'dirty');
  assert.equal(d.e.phase, 'dineOut');
  assert.equal(rest.freeTables().includes(i), false, 'kirli masaya kimse oturmaz');
  t.tick(60_000, 250);
  assert.equal(rest.diners.has(d.id), false);
  assert.ok(events(EVT.GUEST_REMOVE).includes(d.id));
  // Topla → lavabo
  at(RESTAURANT.tables[i].center);
  assert.equal(step({ act: 'clear', table: i }).ok, true);
  assert.deepEqual(p.kitchen.hold, { kind: 'dirty', count: 1 });
  assert.equal(table.plate, null);
  at(RESTAURANT.sink);
  assert.equal(step({ act: 'wash' }).ok, true);
  assert.equal(p.kitchen.hold, null);
});

test('mutfak adımları doğrulanır: konum, tip, el, süre, tarif ve yöntem', () => {
  const t = setup();
  const { p, at, step, sim } = t;
  at([-5, 5]);
  assert.match(step({ act: 'take', ing: 'egg' }).error, /restoranda/);
  at(RESTAURANT.plates);
  assert.match(step({ act: 'take', ing: 'egg' }).error, /Buzdolabına/);
  at(RESTAURANT.fridge.point);
  assert.equal(step({ act: 'fly' }).ok, false);
  assert.equal(step({ act: '__proto__' }).ok, false);
  assert.equal(step({ act: 'constructor' }).ok, false);
  assert.equal(step({ act: 'take', ing: { toString: () => 'egg' } }).ok, false);
  assert.equal(step({ act: 'take', ing: '__proto__' }).ok, false);
  assert.equal(step({ act: 'take', ing: 'egg' }).ok, true);
  // Süre dolmadan ikinci adım yok
  assert.match(sim.kitchenAct(p.id, { act: 'take', ing: 'baguette' }).error, /bitir/);
  assert.match(step({ act: 'take', ing: 'egg' }).error, /zaten/);
  for (const ing of ['baguette', 'olive', 'honey']) assert.equal(step({ act: 'take', ing }).ok, true);
  assert.match(step({ act: 'take', ing: 'wagyu' }).error, /en fazla 4/);
  // Pişirmeden tabaklama → ipucu
  at(RESTAURANT.plates);
  assert.match(step({ act: 'plate' }).error, /Kahvaltı Tabağı için önce/);
  // Uzaktaki istasyon
  at(RESTAURANT.stations.board);
  assert.match(step({ act: 'cook', method: 'oven' }).error, /yaklaş/);
  at(RESTAURANT.stations.oven);
  assert.equal(step({ act: 'cook', method: 'grill' }).ok, false);
  assert.equal(step({ act: 'cook', method: 'oven' }).ok, true);
  assert.equal(p.kitchen.busyUntil - t.getNow(), COOK_METHODS.oven.ms, 'pişirme süresi yönteme göre');
  assert.match(step({ act: 'cook', method: 'oven' }).error, /zaten/);
  at(RESTAURANT.fridge.point);
  assert.match(step({ act: 'take', ing: 'wagyu' }).error, /Pişmiş/);
  at(RESTAURANT.plates);
  assert.match(step({ act: 'plate' }).error, /Taş fırın|Ocakta tava/);
  // Çöpe at
  at(RESTAURANT.trash);
  assert.equal(step({ act: 'trash' }).ok, true);
  assert.equal(p.kitchen.hold, null);
  assert.match(step({ act: 'trash' }).error, /Atacak/);
  // Uydurma tepsi
  at(RESTAURANT.fridge.point);
  step({ act: 'take', ing: 'wagyu' });
  step({ act: 'take', ing: 'honey' });
  at(RESTAURANT.plates);
  assert.match(step({ act: 'plate' }).error, /hiçbir tarife/);
  // Bar eşyası tutan oyuncu mutfakta çalışamaz, tabak tutan barda çalışamaz
  p.kitchen.hold = null;
  p.bar.hold = { kind: 'glass', pours: [], shaken: false };
  at(RESTAURANT.fridge.point);
  assert.match(step({ act: 'take', ing: 'egg' }).error, /Ellerin dolu/);
  p.bar.hold = null;
  p.kitchen.hold = { kind: 'dish', dish: 'pizza' };
  at(BAR.glassRack);
  assert.match(sim.barAct(p.id, { act: 'take' }).error, /restoran/);
});

test('yanlış tabak reddedilir; garson tezgâhına koy / al; sabrı biten müşteri kalkar, memnuniyet düşer', () => {
  const t = setup();
  const { rest, at, step, p } = t;
  const { t: table, i } = t.seatWalkIn('burger');
  t.cook('breakfast');
  at(RESTAURANT.tables[i].center);
  assert.match(step({ act: 'serve', table: i }).error, /Gurme Burger istemiştim/);
  assert.equal(step({ act: 'serve', table: 9 }).ok, false);
  assert.equal(step({ act: 'serve', table: '0' }).ok, false);
  // Pass
  at(RESTAURANT.passSlots[1]);
  assert.equal(step({ act: 'pass', slot: 1 }).ok, true);
  assert.equal(rest.pass[1].dish, 'breakfast');
  assert.equal(p.kitchen.hold, null);
  assert.equal(t.events(EVT.RESTAURANT_STATE).at(-1).pass[1], 'breakfast');
  assert.match(step({ act: 'pick', slot: 0 }).error, /tabak yok/);
  assert.equal(step({ act: 'pick', slot: 1 }).ok, true);
  assert.deepEqual(p.kitchen.hold, { kind: 'dish', dish: 'breakfast' });
  // Sabır
  const sat = rest.sat;
  t.tick(table.waitUntil - t.getNow() + 200);
  assert.equal(table.state, 'empty');
  assert.equal(table.plate, null, 'yemeden kalkan tabak bırakmaz');
  assert.ok(rest.sat < sat);
});

// ---- Otel misafirleri, VIP, memnuniyet ------------------------------------------------------

test('odasındaki otel misafiri restorana iner (çıkış ertelenir), iyi yemek konaklamayı uzatır, odasına döner', () => {
  const t = setup();
  const { sim, rest, at, step } = t;
  const g = guestInRoom(t, '102');
  const before = g.checkoutAt;
  sim.rng = () => 0.01; // otel misafiri seçilsin
  assert.equal(rest.spawn(t.getNow()), true);
  sim.rng = seeded(3);
  const d = rest.diners.get(g.id);
  assert.ok(d?.hotel);
  assert.equal(g.dining, true);
  assert.equal(g.phase, 'dineIn');
  assert.ok(sim.guests.guests.has(g.id), 'GuestManager haritasında kalır');
  for (let k = 0; k < 400 && g.phase !== 'dineSeat'; k++) t.tick(250);
  assert.equal(g.phase, 'dineSeat');
  const table = rest.tables[d.table];
  assert.equal(table.room, '102');
  // Çıkış saati geçse de restoranda checkout olmaz
  g.checkoutAt = sim.clock.total - 1;
  t.tick(500);
  assert.equal(g.phase, 'dineSeat');
  assert.equal(sim.rooms.get('102').status, ROOM_STATUS.OCCUPIED);

  const dish = table.order;
  t.cook(dish);
  const money = sim.money;
  const rep = sim.growth.reputation;
  at(RESTAURANT.tables[d.table].center);
  const r = step({ act: 'serve', table: d.table });
  assert.equal(r.ok, true);
  assert.ok(g.checkoutAt > sim.clock.total + R.EXTEND_MIN - 1, 'konaklama uzadı');
  assert.ok(sim.money > money + r.price + r.tip, 'uzatma ücreti de kasaya');
  assert.ok(sim.growth.reputation > rep, 'hızlı servis → itibar');
  assert.ok(before > 0);
  // Yer, kalkar, asansör/koridorla odasına döner
  t.tick(R.EAT_MS + 200);
  assert.equal(g.phase, 'dineOut');
  for (let k = 0; k < 600 && g.dining; k++) t.tick(250);
  assert.equal(g.dining, false);
  assert.equal(g.phase, GUEST_PHASE.IN_ROOM);
  assert.equal(rest.diners.has(g.id), false);
  assert.ok(rest.hotelCandidates().every((x) => x.id !== g.id), 'yeni yemiş misafir hemen tekrar inmez');
});

test('VIP misafir yalnızca lüks tabak ister, fiyat ×1.5 ve bahşiş ×2; konaklama iki kat uzar', () => {
  const t = setup();
  const { sim, rest, at, step } = t;
  // 12. kat VIP suiti
  sim.arch.level = 2;
  sim.growth.floors = 12;
  const g = guestInRoom(t, '1203', { vip: true });
  for (let k = 0; k < 20; k++) assert.ok(rest.pickDish({ vip: true }).lux);
  sim.rng = () => 0.01;
  assert.equal(rest.spawn(t.getNow()), true);
  sim.rng = seeded(5);
  const d = rest.diners.get(g.id);
  assert.equal(d.vip, true);
  for (let k = 0; k < 600 && g.phase !== 'dineSeat'; k++) t.tick(250);
  assert.equal(g.phase, 'dineSeat');
  const table = rest.tables[d.table];
  assert.equal(table.vip, true);
  table.order = 'wagyu';
  t.cook('wagyu');
  at(RESTAURANT.tables[d.table].center);
  const total = sim.clock.total;
  const r = step({ act: 'serve', table: d.table });
  assert.equal(r.ok, true);
  assert.equal(r.price, Math.round(DISH_BY_ID.wagyu.price * R.VIP_PRICE_MULT));
  assert.ok(g.checkoutAt - total >= R.EXTEND_MIN * R.VIP_EXTEND_MULT - 1);
  assert.ok(VIP.PRICE > 0);
});

test('memnuniyet yüksekse yeni misafirler daha uzun kalır', () => {
  const t = setup();
  const { sim } = t;
  sim.restaurant.sat = 100;
  sim.guests.spawn(t.getNow());
  const g = [...sim.guests.guests.values()].at(-1);
  for (let k = 0; k < 400 && g.phase !== GUEST_PHASE.IN_ROOM; k++) t.tick(250);
  assert.equal(g.phase, GUEST_PHASE.IN_ROOM);
  const stay = g.checkoutAt - sim.clock.total;
  assert.ok(stay >= config.stayMinMin * 1.4 - 2, `konaklama ${stay}`);
});

// ---- Açık büfe kahvaltı ---------------------------------------------------------------------

test('kahvaltı saatinde müşteri büfeden tabağını doldurur (stok azalır, kasaya ödeme); oyuncu büfeyi tazeler', () => {
  const t = setup({ hour: 8 });
  const { sim, rest, at, step } = t;
  assert.equal(rest.breakfast, true);
  rest.buffet = 1;
  sim.rng = () => 0.5; // büfe (< 0.75), otel misafiri yok
  assert.equal(rest.spawn(t.getNow()), true);
  sim.rng = seeded(9);
  const d = [...rest.diners.values()].at(-1);
  assert.equal(d.buffet, true);
  assert.deepEqual(d.e.path.at(-1), RESTAURANT.buffet.point);
  for (let k = 0; k < 400 && d.e.phase !== 'dineBuffet'; k++) t.tick(250);
  assert.equal(d.e.phase, 'dineBuffet');
  const money = sim.money;
  for (let k = 0; k < 400 && d.e.phase !== 'dineSeat'; k++) t.tick(250);
  assert.equal(rest.buffet, 0);
  const table = rest.tables[d.table];
  assert.equal(table.state, 'eating');
  assert.equal(table.dish, 'buffet');
  assert.equal(sim.money, money + BUFFET.PRICE);

  // Tazele: kasadan malzeme parası
  sim.money = 100;
  at(RESTAURANT.buffet.point);
  assert.equal(step({ act: 'restock' }).ok, true);
  assert.equal(rest.buffet, BUFFET.REFILL);
  assert.equal(sim.money, 100 - BUFFET.REFILL_COST);
  sim.money = 0;
  assert.match(step({ act: 'restock' }).error, /malzeme parası/);
});

// ---- Aşçı ve garson NPC'leri --------------------------------------------------------------------

test('Resepsiyon PC: aşçı / garson işe alma (konum, tip, sınır, kasa) ve çıkarma', () => {
  const t = setup();
  const { sim, hotel, at, events } = t;
  sim.money = 10_000;
  assert.match(hotel({ act: 'hireStaff', role: 'chef' }).error, /bilgisayarının başında/);
  at(RECEPTION_PC.point);
  assert.equal(hotel({ act: 'hireStaff', role: 'janitor' }).ok, false);
  assert.equal(hotel({ act: 'hireStaff', role: '__proto__' }).ok, false);
  assert.equal(hotel({ act: 'hireStaff', role: { toString: () => 'chef' } }).ok, false);
  const r = hotel({ act: 'hireStaff', role: 'chef' });
  assert.equal(r.ok, true);
  assert.equal(sim.money, 10_000 - KITCHEN_STAFF.chef.price);
  const up = events(EVT.GUEST_UPSERT).filter((g) => g.id === r.id).at(-1);
  assert.equal(up.kind, 'chef');
  assert.match(up.label, /Şef Marco/);
  assert.ok(sim.hotelPublic().kitchen.some((s) => s.id === r.id && s.role === 'chef'));
  for (let k = 1; k < KITCHEN_STAFF.chef.max; k++) assert.equal(hotel({ act: 'hireStaff', role: 'chef' }).ok, true);
  assert.match(hotel({ act: 'hireStaff', role: 'chef' }).error, /En fazla 3/);
  assert.equal(hotel({ act: 'hireStaff', role: 'waiter' }).ok, true);
  sim.money = 10;
  assert.match(hotel({ act: 'hireStaff', role: 'waiter' }).error, /Kasada/);
  assert.equal(hotel({ act: 'fireStaff', id: r.id }).ok, true);
  assert.ok(events(EVT.GUEST_REMOVE).includes(r.id));
  assert.equal(hotel({ act: 'fireStaff', id: String(r.id) }).ok, false);
});

test('aşçı siparişi kendisi pişirip pass\'e koyar, garson masaya taşır (kasa + bahşiş), kirli masayı toplar', () => {
  const t = setup();
  const { sim, rest, hotel, at } = t;
  sim.money = 5000;
  at(RECEPTION_PC.point);
  const chefId = hotel({ act: 'hireStaff', role: 'chef' }).id;
  const chef = sim.kitchen.staff.get(chefId);
  const { t: table } = t.seatWalkIn('sushi');
  // Aşçı işi üstlenir: pass'te yer ayırır
  t.tick(300);
  assert.equal(chef.job?.kind, 'cook');
  assert.equal(chef.job.dish, 'sushi');
  assert.equal(rest.pass[chef.job.slot].reserved, chefId);
  for (let k = 0; k < 600 && !rest.pass.some((s) => s.dish === 'sushi'); k++) t.tick(250);
  assert.ok(rest.pass.some((s) => s.dish === 'sushi'), 'tabak pass\'te');
  assert.equal(chef.tasks, 1);
  assert.equal(table.state, 'waiting', 'garson yokken masada bekler');
  // İkinci bir kopya pişirmez (sipariş karşılandı)
  t.tick(2000);
  assert.ok(chef.job === null || chef.job.kind !== 'cook');

  const money = sim.money;
  at(RECEPTION_PC.point);
  const waiterId = hotel({ act: 'hireStaff', role: 'waiter' }).id;
  const waiter = sim.kitchen.staff.get(waiterId);
  for (let k = 0; k < 600 && table.state === 'waiting'; k++) t.tick(250);
  assert.equal(table.state, 'eating');
  assert.ok(sim.money > money - KITCHEN_STAFF.waiter.price + DISH_BY_ID.sushi.price, 'satış kasaya');
  assert.ok(rest.pass.every((s) => !s.dish));
  // Yemek biter → garson kirli tabağı toplayıp lavaboya götürür
  for (let k = 0; k < 600 && table.plate !== 'dirty'; k++) t.tick(250);
  for (let k = 0; k < 600 && table.plate === 'dirty'; k++) t.tick(250);
  assert.equal(table.plate, null);
  for (let k = 0; k < 200 && waiter.job; k++) t.tick(250);
  assert.equal(waiter.tasks, 2, 'servis + toplama');
});

test('pass kimsenin beklemediği tabaklarla doluysa aşçı birini çöpe atıp siparişi pişirir', () => {
  const t = setup();
  const { sim, rest, hotel, at } = t;
  sim.money = 5000;
  rest.pass.forEach((s) => { s.dish = 'souffle'; });
  t.seatWalkIn('pizza');
  at(RECEPTION_PC.point);
  const chef = sim.kitchen.staff.get(hotel({ act: 'hireStaff', role: 'chef' }).id);
  t.tick(300);
  assert.equal(chef.job?.kind, 'discard');
  for (let k = 0; k < 600 && !rest.pass.some((s) => s.dish === 'pizza'); k++) t.tick(250);
  assert.ok(rest.pass.some((s) => s.dish === 'pizza'));
  assert.equal(rest.pass.filter((s) => s.dish === 'souffle').length, 3);
});

test('aşçı kahvaltı saatinde azalan büfeyi tazeler (kasadan)', () => {
  const t = setup({ hour: 8 });
  const { sim, rest, hotel, at } = t;
  sim.money = 2000;
  at(RECEPTION_PC.point);
  hotel({ act: 'hireStaff', role: 'chef' });
  rest.buffet = 2;
  const money = sim.money;
  for (let k = 0; k < 400 && rest.buffet === 2; k++) t.tick(250);
  assert.equal(rest.buffet, 2 + BUFFET.REFILL);
  assert.equal(sim.money, money - BUFFET.REFILL_COST);
});

test('kalıcılık: personel, büfe stoğu ve memnuniyet geri gelir; bozuk kayıt temizlenir', () => {
  const store = memoryStore();
  const a = setup({ store });
  a.sim.money = 5000;
  a.at(RECEPTION_PC.point);
  a.hotel({ act: 'hireStaff', role: 'chef' });
  a.hotel({ act: 'hireStaff', role: 'waiter' });
  a.sim.kitchen.staff.values().next().value.tasks = 25;
  a.sim.restaurant.buffet = 5;
  a.sim.restaurant.sat = 81.3;
  a.sim.house.flush();
  const b = setup({ store });
  const staff = [...b.sim.kitchen.staff.values()];
  assert.deepEqual(staff.map((s) => s.role).sort(), ['chef', 'waiter']);
  assert.equal(staff.find((s) => s.role === 'chef').tasks, 25);
  assert.equal(b.sim.restaurant.buffet, 5);
  assert.equal(b.sim.restaurant.sat, 81.3);
  assert.ok(b.sim.snapshot(b.p.id).guests.some((g) => g.kind === 'chef'));
  assert.ok(b.sim.snapshot(b.p.id).restaurant.tables.length === 6);

  const data = JSON.parse(JSON.stringify(store.data));
  data.hotel.restaurant = {
    buffet: 999, sat: 'çok',
    staff: [{ role: 'boss', name: 'X' }, null, ...Array(10).fill({ role: 'chef', name: 'Marco', tasks: -3, look: { skin: 77 } })],
  };
  const c = setup({ store: memoryStore(data) });
  assert.equal(c.sim.restaurant.buffet, BUFFET.MAX);
  assert.equal(c.sim.restaurant.sat, R.SAT_START);
  const chefs = [...c.sim.kitchen.staff.values()];
  assert.equal(chefs.length, KITCHEN_STAFF.chef.max);
  assert.equal(new Set(chefs.map((s) => s.name)).size, chefs.length, 'isimler tekrarlanmaz');
  assert.ok(chefs.every((s) => s.tasks === 0 && s.look.skin < 5));
});

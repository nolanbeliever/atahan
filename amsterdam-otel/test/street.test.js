import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, ROOM_PRICE } from '../shared/constants.js';
import {
  RECEPTION_PC, ALLEY_EAST, PLAYER_HOUSES, buildWallSegments, isInsideAlleyEast, isOutdoors, areaAt, TELEPORTS,
} from '../shared/layout.js';
import {
  STREET_PROPS, STREET_PROP_BY_ID, STREET_RULES as R, STREET_TOTAL_PRICE, paybackDays,
} from '../shared/street.js';
import { STAGE } from '../shared/stage.js';
import { roomPrice } from '../shared/hotel.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
  restaurantDiners: false,
};
const KEY = 'd'.repeat(32);
const KEY2 = 'e'.repeat(32);

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function setup({ store = null } = {}) {
  let now = 7_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 10 }, rng: () => 0.5, now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => out.push({ event, payload, to: id }));
  const p = sim.addPlayer('Emre', KEY);
  sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  const at = ([x, z], who = p) => sim.movePlayer(who.id, x, z, 0);
  const buy = (id, via = 'door', who = p) => sim.streetAct(who.id, { act: 'buy', id, via });
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  return { sim, p, at, buy, events, out };
}

test('katalog: 10 mülk (bakkal, benzinlik, iki kafe…), benzersiz kimlik, makul fiyat / kira / geri dönüş', () => {
  assert.equal(STREET_PROPS.length, 10);
  assert.equal(new Set(STREET_PROPS.map((p) => p.id)).size, 10);
  const types = STREET_PROPS.map((p) => p.type);
  for (const t of ['Bakkal', 'Benzinlik', 'Kafe', 'Fırın', 'Çiçekçi']) assert.ok(types.includes(t), t);
  assert.equal(types.filter((t) => t === 'Kafe').length, 2);
  for (const p of STREET_PROPS) {
    assert.ok(p.price >= 4000 && p.price <= 20000, p.id);
    assert.ok(paybackDays(p) >= 10 && paybackDays(p) <= 20, `${p.id} geri dönüş ${paybackDays(p)}`);
  }
  assert.equal(STREET_TOTAL_PRICE, STREET_PROPS.reduce((a, p) => a + p.price, 0));
  assert.equal(STREET_PROP_BY_ID.__proto__, undefined);
});

test('yerleşim: Achterstraat Oost geçidi açık, dükkân kapıları sokakta; sahne, evler ve duvarlarla çakışma yok', () => {
  const walls = buildWallSegments().filter((w) => !w.lintel);
  const blocked = (x, z, r = 0.3) => walls.some((w) => x > w.minX - r && x < w.maxX + r && z > w.minZ - r && z < w.maxZ + r);
  const mid = (ALLEY_EAST.passage.from + ALLEY_EAST.passage.to) / 2;
  assert.equal(blocked(18, mid, 0.05), false, 'geçit açık');
  assert.equal(blocked(18, 27.0, 0.05), true);
  assert.equal(blocked(44, 29.5, 0.05), true, 'doğu ucu kapalı');
  assert.ok(isInsideAlleyEast(30, 29.5));
  assert.ok(isOutdoors(30, 29.5), 'bisiklet park edilebilir');
  assert.equal(areaAt(30, 29.5), 'alley');
  for (const p of STREET_PROPS) {
    const [x, z] = p.point;
    assert.equal(blocked(x, z), false, `${p.id} kapısının önü yürünebilir`);
    const inStage = x > STAGE.bounds.minX - 0.5 && x < STAGE.bounds.maxX + 0.5 && z < STAGE.bounds.maxZ + 1;
    assert.ok(!inStage, `${p.id} sahneyle çakışıyor`);
    for (const h of PLAYER_HOUSES) assert.ok(!(x > h.bounds.minX && x < h.bounds.maxX && z > h.bounds.minZ), `${p.id} evin içinde`);
  }
  assert.ok(TELEPORTS.some((t) => t.id === 'street' && isInsideAlleyEast(t.point[0], t.point[1])));
});

test('kapıdan satın alma: konum, tip, cüzdan doğrulanır; kişisel cüzdandan ödenir, mülk oyuncunun, otel tabelası', () => {
  const { sim, p, at, buy, events } = setup();
  const prop = STREET_PROP_BY_ID.super;
  p.wallet = 20_000;
  const treasury = sim.money;
  at([0, 3]);
  assert.match(buy('super').error, /kapısına yaklaş/);
  at(prop.point);
  assert.equal(sim.streetAct(p.id, { act: 'sell', id: 'super', via: 'door' }).ok, false);
  assert.equal(buy('__proto__').ok, false);
  assert.equal(buy({ toString: () => 'super' }).ok, false);
  assert.equal(buy('super', 'teleport').ok, false);
  assert.equal(buy('super', { toString: () => 'phone' }).ok, false);
  const r = buy('super');
  assert.equal(r.ok, true);
  assert.equal(r.wallet, 20_000 - prop.price);
  assert.equal(p.wallet, 20_000 - prop.price);
  assert.equal(sim.money, treasury, 'otelin kasasına dokunulmaz');
  assert.match(buy('super').error, /zaten senin/);
  const st = events(EVT.STREET_STATE).at(-1);
  assert.deepEqual(st.owned.super, { by: 'Emre', pid: p.id });
  assert.ok(events(EVT.NOTIFY).some((n) => /by Hotel De Tulp/.test(n.text)));
  // Başkasının dükkânı satılık değil
  const q = sim.addPlayer('Lale', KEY2);
  q.wallet = 50_000;
  at(prop.point, q);
  assert.match(buy('super', 'door', q).error, /Emre adına kayıtlı/);
  // Yetersiz cüzdan
  p.wallet = 100;
  at(STREET_PROP_BY_ID.tank.point);
  assert.match(buy('tank').error, /Cüzdanında yeterli para yok/);
  assert.equal(p.wallet, 100);
});

test('Resepsiyon PC ve telefon yolu: PC başında olmalı, telefon her yerden', () => {
  const { sim, p, at, buy } = setup();
  p.wallet = 50_000;
  at([0, 3]);
  assert.match(buy('kaas', 'pc').error, /bilgisayarının başında/);
  at(RECEPTION_PC.point);
  assert.equal(buy('kaas', 'pc').ok, true);
  at([-14, 30]); // Achterstraat'ın batı ucu
  assert.equal(buy('tank', 'phone').ok, true);
  assert.equal(sim.street.owned.size, 2);
  p.sleeping = { x: p.x, z: p.z };
  assert.match(buy('bloem', 'phone').error, /Uyurken/);
});

test('gün başı: kira sahibinin cüzdanına; çevrimdışı anahtarlı sahibe kayıtlı cüzdanında, anahtarsıza dönünce', () => {
  const store = memoryStore();
  const { sim, p, buy } = setup({ store });
  p.wallet = 50_000;
  assert.equal(buy('bloem', 'phone').ok, true);
  assert.equal(buy('fiets', 'phone').ok, true);
  const q = sim.addPlayer('Lale', KEY2);
  q.wallet = 10_000;
  assert.equal(buy('friet', 'phone', q).ok, true);
  const anon = sim.addPlayer('Mert'); // anahtarsız
  anon.wallet = 10_000;
  assert.equal(buy('platen', 'phone', anon).ok, true);
  sim.removePlayer(q.id);
  sim.removePlayer(anon.id);
  const treasury = sim.money;
  const w0 = p.wallet;
  sim.onNewDay(sim.clock.dayOfWeek, 0);
  assert.equal(sim.money, treasury, 'kira otel kasasına gitmez');
  assert.equal(p.wallet, w0 + STREET_PROP_BY_ID.bloem.rent + STREET_PROP_BY_ID.fiets.rent);
  const q2 = sim.addPlayer('Lale', KEY2);
  assert.equal(q2.wallet, 10_000 - STREET_PROP_BY_ID.friet.price + STREET_PROP_BY_ID.friet.rent, 'kayıtlı cüzdanına yazıldı');
  assert.equal(sim.street.pending.get('ad:Mert'), STREET_PROP_BY_ID.platen.rent);
  sim.house.flush();
  assert.equal(store.data.hotel.street.pending['ad:Mert'], STREET_PROP_BY_ID.platen.rent);
  const anon2 = sim.addPlayer('Mert');
  assert.equal(anon2.wallet, config.startWallet + STREET_PROP_BY_ID.platen.rent, 'dönünce biriken kira ödenir');
  assert.equal(sim.street.pending.size, 0);
});

test('bütün caddeye tek oyuncu sahip olunca: Achterstraat King, otel itibarı, oda ücretleri +%10', () => {
  const { sim, p, buy, events } = setup();
  p.wallet = 200_000;
  const rep = sim.growth.reputation;
  const ids = STREET_PROPS.map((x) => x.id);
  for (const id of ids.slice(0, -1)) assert.equal(buy(id, 'phone').ok, true);
  assert.equal(sim.street.king, null);
  assert.equal(sim.street.priceFactor, 1);
  const r = buy(ids.at(-1), 'phone');
  assert.equal(r.king, true);
  assert.equal(r.owned, 10);
  assert.equal(sim.street.king.name, 'Emre');
  assert.equal(sim.growth.reputation, rep + R.KING_REPUTATION);
  assert.equal(sim.street.priceFactor, R.KING_ROOM_PRICE);
  const st = events(EVT.STREET_STATE).at(-1);
  assert.equal(st.king, 'Emre');
  assert.equal(st.kingId, p.id);
  assert.ok(events(EVT.NOTIFY).some((n) => /Achterstraat King/.test(n.text)));
  // Oda ücreti prestijle artar (otelin kasası)
  sim.money = 0;
  sim.guests.spawn(sim.now());
  const g = [...sim.guests.guests.values()].at(-1);
  const room = sim.guests.pickRoom(g);
  sim.guests.assignRoom(g, room, [[0, 3]], sim.now());
  assert.equal(sim.money, Math.round(roomPrice(ROOM_PRICE, sim.growth.stars) * R.KING_ROOM_PRICE));
});

test('cadde bölünmüşse unvan yok', () => {
  const { sim, p, buy } = setup();
  p.wallet = 200_000;
  const q = sim.addPlayer('Lale', KEY2);
  q.wallet = 20_000;
  assert.equal(buy('koffie', 'phone', q).ok, true);
  for (const x of STREET_PROPS.slice(1)) assert.equal(buy(x.id, 'phone').ok, true);
  assert.equal(sim.street.owned.size, 10);
  assert.equal(sim.street.king, null);
  assert.equal(sim.street.priceFactor, 1);
});

test('kalıcılık: sahiplik ve unvan geri gelir (anahtarla tanınır); bozuk kayıt temizlenir', () => {
  const store = memoryStore();
  const a = setup({ store });
  a.p.wallet = 200_000;
  for (const x of STREET_PROPS) a.buy(x.id, 'phone');
  a.sim.house.flush();
  const b = setup({ store });
  assert.equal(b.sim.street.owned.size, 10);
  assert.equal(b.sim.street.king.name, 'Emre');
  const snap = b.sim.snapshot(b.p.id).street;
  assert.equal(snap.king, 'Emre');
  assert.equal(snap.kingId, b.p.id, 'anahtarla tanınır');
  assert.equal(snap.owned.tank.pid, b.p.id);
  assert.equal(JSON.stringify(snap).includes('dddd'), false, 'anahtar yayınlanmaz');
  assert.equal(b.p.wallet, 200_000 - STREET_TOTAL_PRICE, 'cüzdan da kalıcı');

  const data = JSON.parse(JSON.stringify(store.data));
  data.hotel.street = {
    owned: { super: { by: '<b>X</b>', key: 'yok' }, uydurma: { by: 'Y' }, kaas: 'z' },
    king: { name: 'Sahte', key: null },
    pending: { 'ad:Mert': 'çok', hack: 5, 'ad:Ece': 40 },
  };
  const c = setup({ store: memoryStore(data) });
  assert.deepEqual([...c.sim.street.owned.keys()], ['super']);
  assert.equal(c.sim.street.owned.get('super').key, null);
  assert.equal(c.sim.street.owned.get('super').by, 'bX/b');
  assert.equal(c.sim.street.king, null, 'cadde tek sahipli değilse unvan yok');
  assert.deepEqual([...c.sim.street.pending], [['ad:Ece', 40]]);
});

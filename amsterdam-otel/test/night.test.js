import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { GameClock } from '../server/game/GameClock.js';
import { EVT, DAY_START_MIN, DAY_END_MIN, NIGHT, formatClock } from '../shared/constants.js';
import { HOUSE_BY_ID } from '../shared/layout.js';
import {
  FURNITURE_BY_ID, PLANT_BY_ID, validatePlacement, candidateFromPoint, itemAtPoint, harvestValue, plantStage,
} from '../shared/house.js';

const config = {
  dayLengthSec: 240, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16,
};
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function setup({ hour = 22, store = null, cfg = {} } = {}) {
  let now = 1_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: hour, ...cfg }, now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  const events = (event) => out.filter((e) => e.event === event).map((e) => e.payload);
  const tick = (ms) => { now += ms; sim.tick(now); };
  const bedOf = (houseId) => sim.house.itemsIn(houseId).find((it) => it.type === 'bed');
  /** Oyuncuyu evindeki yatağın yanına koy */
  const toBed = (p, houseId) => {
    const bed = bedOf(houseId);
    sim.movePlayer(p.id, bed.x - 1.2, bed.z, 0);
  };
  return { sim, out, events, tick, bedOf, toBed, now: () => now };
}

test('saat: 23:00\'te gece başlar, gün değişmez; gece süresi bitince sabah 07:00', () => {
  const c = new GameClock({ dayLengthSec: 160, weekendSpeed: 2, nightLengthSec: 80, startMinute: DAY_END_MIN - 1 });
  assert.equal(c.night, false);
  assert.equal(c.advance(1), false); // 1 sn = 6 dk → 23:00'ü geçer ama gün değişmez
  assert.equal(c.night, true);
  assert.equal(c.minute, DAY_END_MIN);
  assert.equal(c.dayCount, 0);
  assert.equal(c.rate, 480 / 80);
  assert.equal(c.snapshot(0).night, true);
  assert.equal(c.advance(40), false); // gecenin yarısı → 03:00
  assert.equal(formatClock(c.minute), '03:00');
  assert.equal(c.advance(40), true);
  assert.equal(c.dayCount, 1);
  assert.equal(c.minute, DAY_START_MIN);
  assert.equal(c.night, false);
  // nightLengthSec = 0 → eski davranış: gece atlanır
  const old = new GameClock({ dayLengthSec: 160, weekendSpeed: 2, startMinute: DAY_END_MIN - 1 });
  assert.equal(old.advance(1), true);
  assert.equal(old.minute, DAY_START_MIN);
});

test('hediye yatak: yeni ev sahibine bir kez verilir, iadesi yoktur; satılırsa yenisi gelmez', () => {
  const { sim, bedOf, events } = setup({ hour: 12 });
  const a = sim.addPlayer('Ali', KEY_A);
  const bed = bedOf('h1');
  assert.ok(bed, 'yatak verildi');
  assert.equal(bed.starter, true);
  assert.ok(events(EVT.HOUSE_ADDED).some((it) => it.id === bed.id));
  assert.ok(sim.snapshot(a.id).house.items.some((it) => it.id === bed.id && it.starter));
  // Kaldırınca para gelmez
  sim.movePlayer(a.id, bed.x - 1.2, bed.z, 0);
  const w = a.wallet;
  const res = sim.houseRemove(a.id, bed.id);
  assert.ok(res.ok);
  assert.equal(res.refund, 0);
  assert.equal(a.wallet, w);
  // Yeniden girince yeni hediye yok
  sim.removePlayer(a.id);
  sim.addPlayer('Ali', KEY_A);
  assert.equal(bedOf('h1'), undefined);
  // Satın alınan yatağın iadesi normal
  const b = sim.addPlayer('Bea', KEY_B);
  assert.ok(bedOf('h2'));
  assert.equal(sim.house.owners.h2.bed, true);
  b.wallet = 100;
  const h2 = HOUSE_BY_ID.h2;
  sim.movePlayer(b.id, h2.inner.minX + 2.4, 35.5, 0);
  const bought = sim.housePlace(b.id, { type: 'bed', x: h2.inner.minX + 0.75, z: 36, rot: 0, color: 1 });
  assert.ok(bought.ok, bought.error);
  assert.equal(sim.houseRemove(b.id, bought.item.id).refund, Math.floor(FURNITURE_BY_ID.bed.price / 2));
});

test('uyku: 21:00 öncesi olmaz; yatak gerekir; yalnızca kendi evinde', () => {
  const { sim, toBed, bedOf } = setup({ hour: 15 });
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  toBed(a, 'h1');
  assert.match(sim.sleep(a.id, true).error, /21:00/);
  sim.clock.minute = NIGHT.SLEEP_FROM_MIN;
  // Otelde
  sim.movePlayer(b.id, 0, 5, 0);
  assert.match(sim.sleep(b.id, true).error, /evine git/);
  // Başkasının evinde (içeri alınmadan)
  toBed(b, 'h1');
  assert.match(sim.sleep(b.id, true).error, /senin evin değil/);
  // Yatağa uzak
  const bed = bedOf('h1');
  sim.movePlayer(a.id, bed.x - 3.2, 34.0, 0);
  assert.match(sim.sleep(a.id, true).error, /yaklaş/);
  // Geçersiz tip
  assert.equal(sim.sleep(a.id, 'evet').ok, false);
  toBed(a, 'h1');
  assert.ok(sim.sleep(a.id, true).ok);
  assert.ok(a.sleeping);
});

test('herkes uyuyunca sabah olur: gün değişir, herkes uyanır, Günaydın bildirimi', () => {
  const { sim, toBed, tick, events } = setup({ hour: 22 });
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  tick(100);
  sim.clock.minute = DAY_END_MIN - 0.01;
  tick(100);
  assert.equal(sim.clock.night, true);
  assert.ok(events(EVT.NOTIFY).some((n) => /otel kapandı/.test(n.text)));
  const day = sim.clock.dayCount;
  toBed(a, 'h1');
  toBed(b, 'h2');
  assert.ok(sim.sleep(a.id, true).ok);
  assert.deepEqual(events(EVT.SLEEP_STATE).at(-1), { ids: [a.id], total: 2 });
  assert.equal(sim.clock.dayCount, day);
  assert.ok(sim.sleep(b.id, true).ok);
  assert.equal(sim.clock.dayCount, day + 1);
  assert.equal(sim.clock.minute, DAY_START_MIN);
  assert.equal(a.sleeping, null);
  assert.equal(b.sleeping, null);
  assert.deepEqual(events(EVT.SLEEP_STATE).at(-1), { ids: [], total: 2 });
  assert.ok(events(EVT.NOTIFY).some((n) => /Günaydın/.test(n.text)));
  // Bir sonraki tick ikinci kez gün değiştirmez
  tick(100);
  assert.equal(sim.clock.dayCount, day + 1);
});

test('yürüyen uyanır; uyumayan oyuncu çıkınca kalanlar uyuyorsa sabah olur; kimse uyumazsa gece kendiliğinden biter', () => {
  const { sim, toBed, tick } = setup({ hour: 22 });
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  sim.clock.minute = DAY_END_MIN + 10;
  toBed(a, 'h1');
  assert.ok(sim.sleep(a.id, true).ok);
  sim.movePlayer(a.id, a.x + 0.3, a.z, 0); // yatakta dönmek uyandırmaz
  assert.ok(a.sleeping);
  sim.movePlayer(a.id, a.x + 1, a.z, 0);
  assert.equal(a.sleeping, null);
  assert.ok(sim.sleep(a.id, true).ok);
  const day = sim.clock.dayCount;
  sim.removePlayer(b.id); // uyumayan AFK oyuncu çıktı
  assert.equal(sim.clock.dayCount, day + 1);
  // Kimse uyumazsa: gece NIGHT_LENGTH_SEC (120 sn) sonra biter
  sim.clock.minute = DAY_END_MIN;
  sim.lastNight = true;
  for (let i = 0; i < 119; i++) tick(1000);
  assert.equal(sim.clock.dayCount, day + 1);
  tick(1500);
  assert.equal(sim.clock.dayCount, day + 2);
  assert.equal(sim.clock.night, false);
});

test('gece kaydedilirse gece olarak geri yüklenir', () => {
  const store = memoryStore();
  const a = setup({ hour: 22, store });
  a.sim.clock.minute = DAY_END_MIN + 120;
  a.sim.house.flush();
  const b = setup({ hour: 9, store });
  assert.equal(b.sim.clock.minute, DAY_END_MIN + 120);
  assert.equal(b.sim.clock.night, true);
  // Gece kapalıysa gün sonuna sıkıştırılır
  const c = setup({ hour: 9, store, cfg: { nightLengthSec: 0 } });
  assert.equal(c.sim.clock.minute, DAY_END_MIN - 1);
});

// ---- Bahçe -------------------------------------------------------------------

function gardenSetup() {
  const s = setup({ hour: 9 });
  const a = s.sim.addPlayer('Ali', KEY_A);
  const b = s.sim.addPlayer('Bea', KEY_B);
  a.wallet = 100;
  const h1 = HOUSE_BY_ID.h1;
  s.sim.movePlayer(a.id, h1.inner.minX + 1.3, 35.5, 0);
  const pot = s.sim.housePlace(a.id, { type: 'pot', x: h1.inner.minX + 0.5, z: 36.5, rot: 0, color: 0 });
  assert.ok(pot.ok, pot.error);
  return { ...s, a, b, pot: pot.item };
}

test('bahçe: tohum ek, gün geçince büyür, hasat → cüzdan; erken hasat olmaz', () => {
  const { sim, a, pot, events } = gardenSetup();
  const w = a.wallet;
  const tulip = PLANT_BY_ID.tulip;
  assert.equal(sim.gardenAct(a.id, { act: 'harvest', itemId: pot.id }).ok, false);
  const r = sim.gardenAct(a.id, { act: 'plant', itemId: pot.id, kind: 'tulip' });
  assert.ok(r.ok, r.error);
  assert.equal(a.wallet, w - tulip.seed);
  assert.deepEqual(events(EVT.HOUSE_ITEM).at(-1), { itemId: pot.id, plant: { kind: 'tulip', at: Math.round(sim.clock.total) } });
  assert.match(sim.gardenAct(a.id, { act: 'plant', itemId: pot.id, kind: 'mint' }).error, /zaten/);
  assert.equal(plantStage(pot.plant, sim.clock.total), 0);
  sim.clock.dayCount += 2;
  assert.equal(plantStage(pot.plant, sim.clock.total), 2);
  assert.match(sim.gardenAct(a.id, { act: 'harvest', itemId: pot.id }).error, /olgunlaşmadı/);
  sim.clock.dayCount += 1;
  assert.equal(plantStage(pot.plant, sim.clock.total), 3);
  const h = sim.gardenAct(a.id, { act: 'harvest', itemId: pot.id });
  assert.ok(h.ok, h.error);
  assert.equal(h.count, tulip.count);
  assert.equal(h.value, harvestValue('tulip'));
  assert.equal(a.wallet, w - tulip.seed + tulip.count * tulip.price);
  assert.equal(pot.plant, null);
});

test('bahçe: yalnızca ev sahibi, yakından; bozuk girdiler; Bizim Ev\'de yok; kayıtla birlikte yüklenir', () => {
  const { sim, a, b, pot } = gardenSetup();
  b.wallet = 100;
  b.houseAccess.add('h1'); // içeri alınmış misafir bile ekemez
  sim.movePlayer(b.id, a.x, a.z + 0.4, 0);
  assert.match(sim.gardenAct(b.id, { act: 'plant', itemId: pot.id, kind: 'mint' }).error, /ev sahibinin/);
  for (const bad of [null, {}, { act: 'plant' }, { act: 'plant', itemId: pot.id, kind: '__proto__' },
    { act: 'plant', itemId: pot.id, kind: { toString: 1 } }, { act: 'x', itemId: pot.id }, { act: 'plant', itemId: '1' }]) {
    assert.equal(sim.gardenAct(a.id, bad).ok, false, JSON.stringify(bad));
  }
  a.wallet = 1;
  assert.match(sim.gardenAct(a.id, { act: 'plant', itemId: pot.id, kind: 'mint' }).error, /gerekli/);
  a.wallet = 100;
  sim.movePlayer(a.id, 0, 5, 0);
  assert.match(sim.gardenAct(a.id, { act: 'plant', itemId: pot.id, kind: 'mint' }).error, /yaklaş/);
  // Bizim Ev'deki saksı
  const shared = HOUSE_BY_ID.shared;
  sim.movePlayer(a.id, -12, 4, 0);
  const sp = sim.housePlace(a.id, { type: 'pot', x: -13, z: 5, rot: 0, color: 0 });
  assert.ok(sp.ok, sp.error);
  assert.ok(shared);
  assert.match(sim.gardenAct(a.id, { act: 'plant', itemId: sp.item.id, kind: 'mint' }).error, /kendi evinde/);

  // Kalıcılık
  const store = memoryStore();
  const s1 = setup({ hour: 9, store });
  const p = s1.sim.addPlayer('Ali', KEY_A);
  p.wallet = 50;
  s1.sim.movePlayer(p.id, HOUSE_BY_ID.h1.inner.minX + 1.3, 35.5, 0);
  const pot1 = s1.sim.housePlace(p.id, { type: 'pot', x: HOUSE_BY_ID.h1.inner.minX + 0.5, z: 36.5, rot: 0, color: 0 }).item;
  assert.ok(s1.sim.gardenAct(p.id, { act: 'plant', itemId: pot1.id, kind: 'strawberry' }).ok);
  s1.sim.house.flush();
  const s2 = setup({ hour: 9, store });
  const back = s2.sim.house.find(pot1.id);
  assert.deepEqual(back.plant, pot1.plant);
  // Bozuk kayıt: bilinmeyen tür / sonsuz zaman yok sayılır
  const data = JSON.parse(JSON.stringify(store.data));
  data.items.find((it) => it.id === pot1.id).plant = { kind: 'constructor', at: 5 };
  const s3 = setup({ hour: 9, store: memoryStore(data) });
  assert.equal(s3.sim.house.find(pot1.id).plant, undefined);
});

// ---- Yeni dekor ---------------------------------------------------------------

test('tavan LED: tavana sığmalı, çapraz yönler, birbirini kesebilir; tablo ve LED aynı duvarda üst üste durabilir', () => {
  const h = HOUSE_BY_ID.h1;
  const I = h.inner;
  const cx = (I.minX + I.maxX) / 2;
  const items = [];
  for (const rot of [0, 1, 2, 3]) {
    const c = { type: 'ceilLed', ...candidateFromPoint(FURNITURE_BY_ID.ceilLed, cx, 36.4, rot, h), color: rot };
    assert.equal(c.rot, rot);
    assert.ok(validatePlacement(items, c, h).ok, `rot ${rot}`);
    items.push(c);
  }
  // Çapraz şerit köşeye konamaz (kapsayan kutu taşar)
  assert.equal(validatePlacement([], { type: 'ceilLed', x: I.minX + 0.3, z: 36, rot: 2, color: 0 }, h).ok, false);
  assert.equal(validatePlacement([], { type: 'ceilLed', x: cx, z: 36, rot: 4, color: 0 }, h).ok, false);
  // Tavan LED'i zemindeki eşyalarla çakışmaz
  const sofa = { type: 'sofa', x: cx, z: 36.4, rot: 0, color: 0 };
  assert.ok(validatePlacement(items, sofa, h).ok);
  // Seçim: tavana bakınca şeride en yakın, zemine bakınca tavan LED'i seçilmez
  assert.equal(itemAtPoint(items, cx + 0.6, 36.4, { ceiling: true }), items[0]);
  assert.equal(itemAtPoint([items[0]], cx + 0.6, 36.4), null);
  // Duvar: LED (üst) ve tablo (göz hizası) aynı yerde; iki tablo çakışmaz
  const led = { type: 'led', x: cx, z: I.maxZ, rot: 0, color: 0 };
  const painting = { type: 'painting', x: cx, z: I.maxZ, rot: 0, color: 2 };
  assert.ok(validatePlacement([], led, h).ok);
  assert.ok(validatePlacement([led], painting, h).ok);
  assert.match(validatePlacement([led, painting], { ...painting, x: cx + 0.4 }, h).error, /dolu/);
  assert.ok(validatePlacement([painting], { type: 'shelf', x: cx + 1.1, z: I.maxZ, rot: 0, color: 0 }, h).ok);
});

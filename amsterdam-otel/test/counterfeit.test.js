import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { HOUSE_BY_ID, GARAGE, DRAG, POINTS } from '../shared/layout.js';
import { PRESS, pressSpots } from '../shared/counterfeit.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 2000, starterBed: false,
};

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function setup({ store = null, key = 'c'.repeat(32) } = {}) {
  let now = 7_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 11 }, rng: () => 0.99, now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  const to = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  const p = sim.addPlayer('Ece', key);
  sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  const houseId = sim.house.houseIdOf(p);
  const def = HOUSE_BY_ID[houseId];
  const spots = pressSpots(def);
  const at = ([x, z]) => sim.movePlayer(p.id, x, z, 0);
  const act = (data) => sim.counterfeitAct(p.id, data);
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  return {
    sim, p, houseId, def, spots, at, act, tick, out, to, getNow: () => now, advance: (ms) => { now += ms; },
  };
}

/** Kurulum + baskı başlat; raidIn verilirse o kadar ms sonra baskın gelir, yoksa baskın yok */
function startBatch(s, raidIn = null) {
  s.at(s.spots.pressPoint);
  if (!s.sim.counterfeit.hasPress(s.houseId)) assert.equal(s.act({ act: 'buy' }).ok, true);
  assert.equal(s.act({ act: 'print' }).ok, true);
  const pr = s.sim.counterfeit.presses.get(s.houseId);
  pr.batch.raidAt = raidIn === null ? null : s.getNow() + raidIn;
  return pr;
}

test('matbaa: yalnızca kendi evinde, cüzdandan €600; baskı bitince para KİŞİSEL cüzdana (kasaya değil)', () => {
  const s = setup();
  const { sim, p, act, at, spots, tick } = s;
  at(POINTS.playerSpawn);
  assert.match(act({ act: 'buy' }).error, /kendi evinin içinde/);
  at(spots.pressPoint);
  p.wallet = 100;
  assert.match(act({ act: 'buy' }).error, /cüzdanında/);
  p.wallet = 2000;
  assert.equal(act({ act: 'buy' }).ok, true);
  assert.equal(p.wallet, 2000 - PRESS.PRICE);
  assert.match(act({ act: 'buy' }).error, /zaten/);
  for (const bad of [null, { act: '__proto__' }, { act: { toString: () => 'buy' } }, { act: 'print ' }]) assert.equal(act(bad).ok, false);
  const money0 = sim.money;
  startBatch(s);
  assert.match(act({ act: 'print' }).error, /zaten çalışıyor/);
  tick(PRESS.BATCH_MS + 200);
  assert.equal(p.wallet, 2000 - PRESS.PRICE + PRESS.BATCH_VALUE);
  assert.equal(sim.money, money0, 'otel kasası değişmez');
  assert.ok(s.out.some((e) => e.event === EVT.COUNTERFEIT_STATE));
});

test('baskın: 15 sn içinde gizlenmezsen ceza, parti yanar, matbaa 1 gün mühürlü', () => {
  const s = setup();
  const { sim, p, act, tick, out } = s;
  startBatch(s, 1000);
  const wallet = p.wallet;
  tick(1200);
  const pr = sim.counterfeit.presses.get(s.houseId);
  assert.ok(pr.raid && !pr.raid.police, 'uyarı başladı');
  tick(PRESS.WARNING_MS);
  assert.equal(pr.raid.police, true);
  assert.equal(p.wallet, wallet - PRESS.FINE);
  const raid = out.filter((e) => e.event === EVT.COUNTERFEIT_RAID).pop().payload;
  assert.equal(raid.safe, false);
  tick(PRESS.POLICE_MS + 200);
  assert.equal(pr.raid, null);
  assert.equal(pr.batch, null, 'parti yandı');
  assert.match(act({ act: 'print' }).error, /mühürlendi/);
  sim.clock.dayCount += PRESS.SEIZE_DAYS;
  assert.equal(act({ act: 'print' }).ok, true, 'ertesi gün mühür kalkar');
});

test('baskın: matbaayı gizlemek (2 sn) seni kurtarır, baskı kaldığı yerden sürer ve ödenir', () => {
  const s = setup();
  const { sim, p, act, tick, advance } = s;
  startBatch(s, 5000);
  tick(5100);
  const pr = sim.counterfeit.presses.get(s.houseId);
  assert.match(act({ act: 'stash', step: 'finish' }).error, /Önce/);
  assert.equal(act({ act: 'stash', step: 'begin' }).ok, true);
  advance(500);
  assert.match(act({ act: 'stash', step: 'finish' }).error, /Acele/);
  advance(PRESS.STASH_MS);
  assert.equal(act({ act: 'stash', step: 'finish' }).ok, true);
  const wallet = p.wallet;
  tick(PRESS.WARNING_MS + PRESS.POLICE_MS + 400);
  assert.equal(p.wallet, wallet, 'ceza yok');
  assert.ok(pr.batch, 'parti sürüyor');
  tick(PRESS.BATCH_MS);
  assert.equal(p.wallet, wallet + PRESS.BATCH_VALUE);
});

test('baskın: gizli bölmeye kaç — orada kalırsan kurtulursun, çıkarsan yakalanırsın', () => {
  const s = setup();
  const { sim, p, act, at, spots, tick } = s;
  startBatch(s, 1000);
  tick(1200);
  at([spots.pressPoint[0], spots.pressPoint[1]]);
  assert.match(act({ act: 'hide' }).error, /bölmeye yaklaş/);
  at(spots.hidePoint);
  const r = act({ act: 'hide' });
  assert.equal(r.ok, true);
  assert.deepEqual([p.x, p.z], spots.hideSpot);
  assert.ok(p.hiding);
  const wallet = p.wallet;
  tick(PRESS.WARNING_MS);
  assert.equal(p.wallet, wallet, 'saklanırken bulunmaz');
  tick(PRESS.POLICE_MS + 200);
  assert.equal(p.hiding, null, 'polis gidince bölmeden çıkar');

  // İkinci baskın: bölmeden yürüyerek çıkarsa yakalanır
  const pr = sim.counterfeit.presses.get(s.houseId);
  pr.batch.raidAt = s.getNow() + 500;
  tick(700);
  at(spots.hidePoint);
  assert.equal(act({ act: 'hide' }).ok, true);
  at(spots.pressPoint); // bölmeden çıktı
  assert.equal(p.hiding, null);
  tick(PRESS.WARNING_MS);
  assert.equal(p.wallet, wallet - PRESS.FINE);
});

test('ışınlanma: otel / ev / garaj / pist; doğrulamalar ve bekleme süresi', () => {
  const s = setup();
  const { sim, p, def, advance } = s;
  const go = (to) => sim.teleportAct(p.id, { to });
  let r = go('garage');
  assert.equal(r.ok, true);
  assert.deepEqual([p.x, p.z], GARAGE.spawn);
  assert.match(go('drag').error, /bekle/);
  advance(5000);
  assert.deepEqual([go('drag').ok, p.x, p.z], [true, ...DRAG.spawn]);
  advance(5000);
  r = go('home');
  assert.deepEqual([r.ok, p.x, p.z], [true, ...def.entry]);
  advance(5000);
  assert.equal(go('hotel').ok, true);
  for (const bad of ['__proto__', 'moon', { toString: () => 'hotel' }, 3, null]) assert.equal(go(bad).ok, false);
  advance(5000);
  p.vehicle = { id: 1, seat: 'driver' };
  assert.match(go('hotel').error, /araçtan in/);
  p.vehicle = null;
  // Evsiz oyuncu eve ışınlanamaz
  const q = sim.addPlayer('Misafir');
  assert.match(sim.teleportAct(q.id, { to: 'home' }).error, /evin yok/);
  // Baskın sürerken kaçılmaz
  const s2 = setup({ key: 'd'.repeat(32) });
  startBatch(s2, 500);
  s2.tick(700);
  s2.advance(5000);
  assert.match(s2.sim.teleportAct(s2.p.id, { to: 'hotel' }).error, /Polis kapında/);
});

test('kalıcılık: matbaa ve mühür kayıtla döner; bozuk kayıt yok sayılır; ev boşaltılınca gider', () => {
  const store = memoryStore();
  const a = setup({ store });
  startBatch(a);
  a.sim.counterfeit.presses.get(a.houseId).seizedUntilDay = a.sim.clock.dayCount + 1;
  a.sim.house.flush();
  const b = setup({ store });
  const pr = b.sim.counterfeit.presses.get(b.houseId);
  assert.ok(pr, 'matbaa geri geldi');
  assert.equal(pr.batch, null, 'süren parti kaydedilmez');
  assert.equal(pr.seizedUntilDay, b.sim.clock.dayCount + 1);
  assert.equal(b.sim.snapshot(b.p.id).counterfeit[0].seized, true);

  const data = JSON.parse(JSON.stringify(store.data));
  data.hotel.counterfeit = { __proto__: { seizedUntilDay: 1 }, h99: {}, [b.houseId]: { seizedUntilDay: 'yarın' }, shared: { seizedUntilDay: 2 } };
  const c = setup({ store: memoryStore(data) });
  assert.equal(c.sim.counterfeit.presses.size, 1);
  assert.equal(c.sim.counterfeit.presses.get(c.houseId).seizedUntilDay, 0);
  c.sim.house.evict(c.houseId);
  assert.equal(c.sim.counterfeit.hasPress(c.houseId), false);
});

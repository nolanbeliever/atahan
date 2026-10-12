import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, DAY_END_MIN, DRINKS } from '../shared/constants.js';
import { BAR, HOUSE_BY_ID, isInsideHouseDef } from '../shared/layout.js';
import { REGULAR_BY_NAME, FRIEND_RULES as F, TOPICS } from '../shared/friends.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 100,
};
const KEY = 'a'.repeat(32);

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

function setup({ store = null } = {}) {
  let now = 5_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 11 }, rng: seeded(), now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  const to = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  const p = sim.addPlayer('Ali', KEY);
  const bar = sim.bar;
  bar.nextSpawnAt = Infinity;
  const tick = (ms) => { now += ms; sim.tick(now); };
  const seat = () => {
    bar.nextSpawnAt = now;
    tick(1);
    bar.nextSpawnAt = Infinity;
    const c = [...bar.customers.values()].at(-1);
    tick(c.phaseEndsAt - now);
    assert.equal(c.sit, true);
    return c;
  };
  /** Müşterinin önüne (müşteri tarafı) git */
  const nearSeat = (c) => {
    const [x, z] = BAR.stools[c.stool].seat;
    sim.movePlayer(p.id, x, z - 0.8, 0);
  };
  const act = (data) => sim.friendAct(p.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  return { sim, p, bar, tick, seat, nearSeat, act, events, to, advance: (ms) => { now += ms; } };
}

test('sohbet: sevdiği konu artırır, sıkıldığı konu düşürür; ziyaret başına her eylem bir kez', () => {
  const { p, seat, nearSeat, act } = setup();
  const c = seat();
  const reg = REGULAR_BY_NAME[c.name];
  assert.match(act({ act: 'chat', customer: c.id, topic: reg.love }).error, /yanına git/);
  nearSeat(c);
  const r = act({ act: 'chat', customer: c.id, topic: reg.love });
  assert.ok(r.ok, r.error);
  assert.equal(r.fit, 'love');
  assert.equal(r.level, F.CHAT.love);
  assert.equal(p.friends[c.name], F.CHAT.love);
  assert.match(act({ act: 'chat', customer: c.id, topic: reg.like }).error, /zaten sohbet/);
  // Bir sonraki müşteri: sıkıldığı konu
  const c2 = seat();
  nearSeat(c2);
  const reg2 = REGULAR_BY_NAME[c2.name];
  const r2 = act({ act: 'chat', customer: c2.id, topic: reg2.dislike });
  assert.equal(r2.delta, F.CHAT.dislike);
  assert.equal(p.friends[c2.name], 0); // %0'ın altına inmez
});

test('espri ve içecek ısmarlama; en sevdiği içecek daha çok sevindirir; para düşer', () => {
  const { p, seat, nearSeat, act } = setup();
  const c = seat();
  nearSeat(c);
  const reg = REGULAR_BY_NAME[c.name];
  const j = act({ act: 'joke', customer: c.id });
  assert.ok(j.ok);
  assert.ok(typeof j.joke === 'string' && j.joke.length > 5);
  assert.match(act({ act: 'joke', customer: c.id }).error, /zaten duydu/);
  const fav = DRINKS.find((d) => d.id === reg.drink);
  const w = p.wallet;
  const t = act({ act: 'treat', customer: c.id, drink: fav.id });
  assert.ok(t.ok, t.error);
  assert.equal(t.delta, F.TREAT_FAV);
  assert.equal(p.wallet, w - fav.price);
  assert.equal(act({ act: 'treat', customer: c.id, drink: fav.id }).ok, false);
  // Bozuk girdiler
  for (const bad of [null, {}, { act: 'chat' }, { act: 'chat', customer: c.id, topic: '__proto__' },
    { act: 'chat', customer: String(c.id), topic: 'bikes' }, { act: 'treat', customer: c.id, drink: { toString: 1 } },
    { act: 'x', customer: c.id }, { act: 'invite', customer: 99999 }]) {
    assert.equal(act(bad).ok, false, JSON.stringify(bad));
  }
});

test('davet: %80 altı olmaz; %80\'de müşteri bardan kalkar, evde belirir; evde sohbet + TV; 23:00\'te gider, ertesi gün bahşiş +%20', () => {
  const { sim, p, bar, seat, nearSeat, act, events, tick, to } = setup();
  const c = seat();
  nearSeat(c);
  assert.match(act({ act: 'invite', customer: c.id }).error, /tanımıyor/);
  p.friends[c.name] = F.INVITE_AT;
  const stool = c.stool;
  const r = act({ act: 'invite', customer: c.id });
  assert.ok(r.ok, r.error);
  assert.equal(r.houseId, 'h1');
  assert.equal(bar.stools[stool].state, 'empty');
  const visits = events(EVT.FRIEND_VISITS).at(-1);
  assert.equal(visits.length, 1);
  const v = visits[0];
  assert.equal(v.name, c.name);
  assert.ok(isInsideHouseDef(HOUSE_BY_ID.h1, v.x, v.z), 'misafir evin içinde');
  assert.deepEqual(sim.snapshot(p.id).visits, visits);
  // İkinci davet olmaz
  const c2 = seat();
  nearSeat(c2);
  p.friends[c2.name] = 90;
  assert.match(act({ act: 'invite', customer: c2.id }).error, /zaten bir misafirin/);

  // Evde
  assert.match(act({ act: 'homeChat' }).error, /yanına git/);
  sim.movePlayer(p.id, v.x + 0.5, v.z, 0);
  const before = p.friends[c.name];
  assert.equal(act({ act: 'homeChat' }).delta, F.HOME_CHAT);
  assert.match(act({ act: 'homeChat' }).error, /soluklanıyor/);
  assert.match(act({ act: 'tv' }).error, /TV/);
  // TV aç
  const h1 = HOUSE_BY_ID.h1;
  const tvSpot = { type: 'tv', x: h1.inner.minX + 0.9, z: h1.inner.maxZ - 0.3, rot: 2, color: 0 };
  sim.movePlayer(p.id, tvSpot.x + 0.3, tvSpot.z - 1.4, 0);
  const placed = sim.housePlace(p.id, tvSpot);
  assert.ok(placed.ok, placed.error);
  placed.item.video = { id: 'dQw4w9WgXcQ', title: 'Şarkı', by: 'Ali', startedAt: 1 };
  sim.movePlayer(p.id, v.x + 0.5, v.z, 0);
  assert.equal(act({ act: 'tv' }).delta, F.TV_TOGETHER);
  assert.equal(p.friends[c.name], before + F.HOME_CHAT + F.TV_TOGETHER);

  // 23:00 → ziyaret biter, moral bonusu yarın
  const day = sim.clock.dayCount;
  sim.clock.minute = DAY_END_MIN - 0.01;
  sim.clock.dayLengthSec = 1;
  tick(100);
  assert.equal(sim.clock.night, true);
  assert.deepEqual(events(EVT.FRIEND_VISITS).at(-1), []);
  assert.equal(p.moodDay, day + 1);
  assert.ok(to.some((m) => m.id === p.id && /iyi geceler/.test(m.payload?.text ?? '')));
  assert.equal(sim.relations.tipMultiplier(p), 1);
  sim.clock.sleepThrough();
  sim.onNewDay(0, 0);
  assert.equal(sim.relations.tipMultiplier(p), F.MOOD_TIP);
  assert.ok(to.some((m) => m.id === p.id && /moralin yüksek/.test(m.payload?.text ?? '')));
  assert.deepEqual(sim.snapshot(p.id).self.friends.mood, true);
});

test('kalıcılık: seviyeler ve moral bonusu kayıtla geri gelir; bozuk kayıt yok sayılır; ev sahibi çıkınca misafir gider', () => {
  const store = memoryStore();
  const a = setup({ store });
  const c = a.seat();
  a.nearSeat(c);
  a.act({ act: 'chat', customer: c.id, topic: REGULAR_BY_NAME[c.name].love });
  a.sim.relations.gain(a.p, c.name, 85 - a.p.friends[c.name]);
  a.act({ act: 'invite', customer: c.id });
  assert.equal(a.sim.relations.visits.size, 1);
  a.sim.removePlayer(a.p.id);
  assert.equal(a.sim.relations.visits.size, 0);
  a.sim.house.flush();
  const b = setup({ store });
  assert.equal(b.p.friends[c.name], 85);
  // Bozuk kayıt
  const data = JSON.parse(JSON.stringify(store.data));
  const hash = Object.keys(data.friends)[0];
  data.friends[hash].levels = { __proto__: 5, Hacker: 50, [c.name]: 'çok', Sanne: 400 };
  data.friends.bozuk = { levels: { Sanne: 10 } };
  const s3 = setup({ store: memoryStore(data) });
  assert.equal(s3.p.friends[c.name], undefined);
  assert.equal(s3.p.friends.Hacker, undefined);
  assert.equal(s3.p.friends.Sanne, 100);
  assert.ok(TOPICS.length >= 6);
});

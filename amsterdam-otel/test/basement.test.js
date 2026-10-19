import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, GUEST_PHASE, ROOM_STATUS } from '../shared/constants.js';
import { ELEVATOR, TELEPORTS, areaAt, buildWallSegments, ROOM_BY_ID } from '../shared/layout.js';
import { bigArea, GARAGE_LAYOUT } from '../shared/cars.js';
import {
  BASEMENT, BASEMENT_FLOOR, BASEMENT_GAMES, BASEMENT_RULES as R, ARCADE_GAMES_DEF, AI_NAME, bowlingStatus, isInsideBasement,
  basementRouteIn, nearStation,
} from '../shared/basement.js';
import {
  POOL, poolRack, poolSimulate, poolSpeed, poolSimStart, poolStep, BOWL, ALL_PINS, BOWL_PINS, bowlSimulate, bowlSimStart, bowlStep, countPins,
} from '../shared/basementPhysics.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
  restaurantDiners: false, basementGuests: false,
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
  const at = (pl, [x, z]) => sim.movePlayer(pl.id, x, z, 0);
  const act = (pl, data) => sim.basementAct(pl.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  return { sim, p, tick, at, act, events, out, now: () => now, advance: (ms) => { now += ms; } };
}

const poolStand = (i) => [BASEMENT.pool[i].center[0] + 1.8, BASEMENT.pool[i].center[1]];

// ---- Yerleşim ------------------------------------------------------------------------------

test('bodrum: dünyanın ayrı köşesinde, garaj / otel / oyuncu evleriyle çakışmaz; alan ve ışınlanma', () => {
  const b = BASEMENT.bounds;
  assert.equal(areaAt(40, -20), 'basement');
  assert.equal(bigArea(40, -20), 'basement');
  assert.equal(bigArea(80, -10), 'garage');
  assert.equal(bigArea(0, 5), 'city');
  assert.ok(b.maxX + 2 <= GARAGE_LAYOUT.bounds.minX - 2, 'garajdan uzak');
  assert.ok(b.maxZ < -7.6 - 2, 'kanalın güneyinde');
  // Otel duvarlarının hiçbiri bodrumun içinde değil
  for (const w of buildWallSegments()) assert.ok(w.maxX < b.minX || w.minX > b.maxX || w.maxZ < b.minZ || w.minZ > b.maxZ);
  const tp = TELEPORTS.find((t) => t.id === 'basement');
  assert.ok(tp && isInsideBasement(...tp.point));
  // Bütün istasyon noktaları ve NPC rotaları bodrumun içinde
  for (const g of Object.values(BASEMENT_GAMES)) {
    for (const st of g.list) {
      assert.ok(isInsideBasement(...st.center), st.id);
      for (const sp of st.spots) for (const pt of basementRouteIn(sp)) assert.ok(isInsideBasement(...pt), `${st.id} ${pt}`);
    }
  }
  assert.equal(BASEMENT.arcade.length, 6);
  assert.equal(BASEMENT.lanes.length, 2);
});

test('merdiven: lobideki kapıdan −1. kata, bodrum merdiveninden lobiye; uzaktan olmaz', () => {
  const { p, at, act } = setup();
  at(p, [0, 3]);
  assert.equal(act(p, { act: 'stairs' }).ok, false);
  at(p, BASEMENT.lobbyStairs.point);
  const down = act(p, { act: 'stairs' });
  assert.equal(down.ok, true);
  assert.equal(down.basement, true);
  assert.ok(isInsideBasement(p.x, p.z));
  at(p, BASEMENT.stairs.point);
  const up = act(p, { act: 'stairs' });
  assert.equal(up.ok, true);
  assert.equal(areaAt(p.x, p.z), 'lobby');
});

test('asansör: lobiden "−1" durağına ve geri (her zaman açık)', () => {
  const { sim, p, at } = setup();
  at(p, ELEVATOR.lobby.point);
  const res = sim.hotelAct(p.id, { act: 'elevator', floor: BASEMENT_FLOOR });
  assert.equal(res.ok, true);
  assert.equal(res.floor, BASEMENT_FLOOR);
  assert.deepEqual([p.x, p.z], [...BASEMENT.elevator.spawn]);
  assert.equal(sim.hotelAct(p.id, { act: 'elevator', floor: BASEMENT_FLOOR }).ok, false, 'zaten burada');
  assert.equal(sim.hotelAct(p.id, { act: 'elevator', floor: -2 }).ok, false);
  const back = sim.hotelAct(p.id, { act: 'elevator', floor: 1 });
  assert.equal(back.ok, true);
  assert.deepEqual([p.x, p.z], [...ELEVATOR.lobby.spawn]);
});

// ---- Fizik ---------------------------------------------------------------------------------

test('bilardo fiziği: deterministik, adım adım ve toplu simülasyon aynı; düz atış cebe girer', () => {
  const rack = poolRack(seeded(3));
  assert.equal(rack.length, 16);
  assert.equal(new Set(rack.map((b) => b.id)).size, 16);
  const a = poolSimulate(rack, poolSpeed(1), 0.01);
  const b = poolSimulate(rack, poolSpeed(1), 0.01);
  assert.deepEqual(a, b);
  assert.equal(a.firstHit !== null, true);
  const st = poolSimStart(rack, poolSpeed(1), 0.01);
  while (poolStep(st));
  assert.equal(st.steps, a.steps);
  assert.deepEqual(st.pocketed, a.pocketed);
  // Topu doğrudan köşe cebine gönder
  const two = [{ id: 0, x: 0.6, z: 0.3 }, { id: 3, x: 1.5, z: 0.7 }];
  const dx = POOL.L - 1.5;
  const dz = POOL.W - 0.7;
  const d = Math.hypot(dx, dz);
  const gx = 1.5 - (dx / d) * 2 * POOL.R - 0.6;
  const gz = 0.7 - (dz / d) * 2 * POOL.R - 0.3;
  const g = Math.hypot(gx, gz);
  const r = poolSimulate(two, (gx / g) * poolSpeed(0.5), (gz / g) * poolSpeed(0.5));
  assert.deepEqual(r.pocketed, [3]);
  assert.equal(r.firstHit, 3);
  for (const ball of a.balls) assert.ok(ball.x > 0 && ball.x < POOL.L && ball.z > 0 && ball.z < POOL.W);
});

test('bowling fiziği: deterministik; tam ortadan güçlü atış çok labut devirir, oluk topu hiç devirmez', () => {
  const s = bowlSimulate(ALL_PINS, 0.05, -0.01, 9, 0);
  assert.deepEqual(s, bowlSimulate(ALL_PINS, 0.05, -0.01, 9, 0));
  assert.ok(s.knocked >= 6, `devrilen ${s.knocked}`);
  assert.equal(countPins(s.standing) + s.knocked, 10);
  const gutter = bowlSimulate(ALL_PINS, 0.42, 0.06, 7, 0);
  assert.equal(gutter.gutter, true);
  assert.equal(gutter.knocked, 0);
  // Yalnızca ayaktaki labutlar devrilebilir
  const one = bowlSimulate(1 << 9, 0.457, 0, 8, 0);
  assert.ok(one.knocked <= 1);
  const st = bowlSimStart(ALL_PINS, 0.05, -0.01, 9, 0);
  while (bowlStep(st));
  assert.equal(st.steps, s.steps);
  assert.equal(BOWL_PINS.length, 10);
});

test('bowling skoru: strike / spare bonusları, son çerçevede bonus atış, labut dizme', () => {
  assert.deepEqual(bowlingStatus([]).frame, 0);
  let st = bowlingStatus([7]);
  assert.deepEqual([st.frame, st.ball, st.reset, st.standing], [0, 1, false, 3]);
  st = bowlingStatus([7, 3, 5]);
  assert.equal(st.cum[0], 15);
  st = bowlingStatus([10, 10, 10, 10, 10, 10, 10], 5);
  assert.equal(st.done, true);
  assert.equal(st.total, 150);
  st = bowlingStatus([10, 10, 10, 10, 10, 10], 5);
  assert.deepEqual([st.done, st.frame, st.ball, st.reset], [false, 4, 2, true]);
  st = bowlingStatus([0, 0, 0, 0, 0, 0, 0, 0, 3, 4], 5);
  assert.equal(st.done, true);
  assert.equal(st.total, 7);
  st = bowlingStatus([0, 0, 0, 0, 0, 0, 0, 0, 6, 4], 5);
  assert.deepEqual([st.done, st.ball, st.reset], [false, 2, true]);
  st = bowlingStatus([0, 0, 0, 0, 0, 0, 0, 0, 10, 4], 5);
  assert.deepEqual([st.done, st.ball, st.reset, st.standing], [false, 2, false, 6]);
  assert.equal(bowlingStatus([0, 0, 0, 0, 0, 0, 0, 0, 6, 4, 8], 5).total, 18);
});

// ---- Bilardo maçı -------------------------------------------------------------------------

test('bilardo: masaya otur, bilgisayara karşı başla, sıra sende; atış sunucuda simüle edilir ve yayınlanır', () => {
  const { sim, p, at, act, events, tick, advance } = setup();
  at(p, [0, 3]);
  assert.equal(act(p, { act: 'join', game: 'pool', i: 0 }).ok, false, 'uzaktan oturulmaz');
  at(p, poolStand(0));
  assert.equal(act(p, { act: 'join', game: 'pool', i: 0 }).seat, 0);
  const t = sim.basement.pool[0];
  assert.equal(t.phase, 'wait');
  assert.equal(act(p, { act: 'shoot', i: 0, angle: 0, power: 0.9 }).ok, false, 'maç başlamadı');
  assert.equal(act(p, { act: 'ai', game: 'pool', i: 0 }).ok, true);
  assert.equal(t.phase, 'play');
  assert.equal(t.seats[1].name, AI_NAME);
  // Tip denetimi: sayı olmayan açı / güç reddedilir
  assert.equal(act(p, { act: 'shoot', i: 0, angle: '0', power: 0.9 }).ok, false);
  assert.equal(act(p, { act: 'shoot', i: 0, angle: 0, power: 1.5 }).ok, false);
  assert.equal(act(p, { act: 'shoot', i: 0, angle: 0.003, power: 0.95 }).ok, true);
  const shot = events(EVT.BASEMENT_SHOT).at(-1);
  assert.equal(shot.game, 'pool');
  assert.equal(shot.from.length, 16);
  // İstemci aynı simülasyonla aynı sonuca varır
  const replay = poolSimulate(shot.from.map(([id, x, z]) => ({ id, x, z })), shot.vx, shot.vz);
  assert.deepEqual(replay.pocketed, shot.pocketed);
  assert.equal(act(p, { act: 'shoot', i: 0, angle: 0, power: 0.5 }).ok, false, 'toplar dönerken atış yok');
  // Sıra bilgisayara geçtiyse kendisi atar
  if (t.turn === 1) {
    const n = events(EVT.BASEMENT_SHOT).length;
    advance(5000);
    tick(R.AI_DELAY_MS + 3000);
    assert.ok(events(EVT.BASEMENT_SHOT).length > n, 'bilgisayar attı');
    assert.equal(events(EVT.BASEMENT_SHOT).at(-1).by, AI_NAME);
  }
  // Masadan uzaklaşan oyuncu kalkar
  at(p, [0, 3]);
  tick(200);
  assert.equal(t.phase, 'idle');
});

test('bilardo kuralları: beyaz top cebe girerse faul ve sıra geçer; 8 erken girerse kaybeder', () => {
  const { sim, p, at, act } = setup();
  const q = sim.addPlayer('Ece', 'e'.repeat(32));
  at(p, poolStand(1));
  at(q, poolStand(1));
  act(p, { act: 'join', game: 'pool', i: 1 });
  assert.equal(act(q, { act: 'join', game: 'pool', i: 1 }).seat, 1);
  const t = sim.basement.pool[1];
  assert.equal(t.phase, 'play');
  t.shotNo = 3; // açılış yapılmış say
  // Beyaz topu doğrudan köşe cebine gönder (başka top yok yolda)
  t.balls = [{ id: 0, x: 0.3, z: 0.3 }, { id: 2, x: 2.0, z: 1.0 }, { id: 8, x: 1.1, z: 0.9 }];
  act(p, { act: 'shoot', i: 1, angle: Math.atan2(-0.3, -0.3), power: 0.5 });
  assert.match(t.msg, /Faul/);
  assert.equal(t.turn, 1);
  assert.ok(t.balls.some((b) => b.id === 0), 'beyaz top masaya geri konur');
  // Ece 8 numarayı (grup temizlenmeden) soker → kaybeder
  t.busyUntil = 0;
  t.groups = ['solid', 'stripe'];
  t.balls = [{ id: 0, x: 1.6, z: 0.6 }, { id: 8, x: 1.9, z: 0.9 }, { id: 12, x: 0.5, z: 0.5 }];
  const dx = POOL.L - 1.9;
  const dz = POOL.W - 0.9;
  const d = Math.hypot(dx, dz);
  const gx = 1.9 - (dx / d) * 2 * POOL.R - 1.6;
  const gz = 0.9 - (dz / d) * 2 * POOL.R - 0.6;
  act(q, { act: 'shoot', i: 1, angle: Math.atan2(gz, gx), power: 0.45 });
  assert.equal(t.phase, 'over');
  assert.equal(t.winner, 0);
  assert.match(t.msg, /kazandı/);
  // Rövanş: aynı oyuncularla yeni üçgen
  assert.equal(act(p, { act: 'join', game: 'pool', i: 1 }).ok, true);
  assert.equal(t.phase, 'play');
  assert.equal(t.balls.length, 16);
});

// ---- Masa tenisi / langırt ----------------------------------------------------------------

test('masa tenisi: iki oyuncu katılır; sayıyı yalnızca ev sahibi bildirir; 7 sayıda maç biter; RT paketleri iletilir', () => {
  const { sim, p, at, act, out, advance } = setup();
  const q = sim.addPlayer('Ece', 'e'.repeat(32));
  const T = BASEMENT.pong[0];
  at(p, T.spots[0].at);
  at(q, T.spots[1].at);
  act(p, { act: 'join', game: 'pong', i: 0 });
  act(q, { act: 'join', game: 'pong', i: 0 });
  const t = sim.basement.pong[0];
  assert.equal(t.phase, 'play');
  assert.equal(act(q, { act: 'point', game: 'pong', i: 0, side: 1 }).ok, false, 'misafir sayı bildiremez');
  assert.equal(act(p, { act: 'point', game: 'pong', i: 0, side: 2 }).ok, false);
  // Gerçek zamanlı paket: q'nun raketi p'ye gider
  assert.equal(sim.basementRt(q.id, { g: 'pong', i: 0, s: [0.2, 1] }), true);
  assert.ok(out.some((x) => x.event === EVT.BASEMENT_RT && x.to === p.id && x.payload.seat === 1));
  assert.equal(sim.basementRt(q.id, { g: 'pong', i: 0, s: ['x'] }), false);
  assert.equal(sim.basementRt(q.id, { g: 'pong', i: 0, s: new Array(40).fill(0) }), false);
  for (let k = 0; k < R.PONG_TO; k++) {
    advance(1000);
    assert.equal(act(p, { act: 'point', game: 'pong', i: 0, side: 1 }).ok, true);
  }
  assert.equal(t.phase, 'over');
  assert.equal(t.winner, 1);
  assert.equal(act(p, { act: 'point', game: 'pong', i: 0, side: 1 }).ok, false);
});

test('langırt: tek başına bilgisayara karşı; masadan kalkınca masa boşalır; rakip kalkarsa diğeri hükmen kazanır', () => {
  const { sim, p, at, act, advance } = setup();
  const T = BASEMENT.foos[0];
  at(p, T.spots[0].at);
  act(p, { act: 'join', game: 'foos', i: 0 });
  assert.equal(act(p, { act: 'ai', game: 'foos', i: 0 }).ok, true);
  const t = sim.basement.foos[0];
  advance(1000);
  assert.equal(act(p, { act: 'point', game: 'foos', i: 0, side: 0 }).ok, true);
  assert.equal(act(p, { act: 'point', game: 'foos', i: 0, side: 0 }).ok, false, 'iki gol arası en az 0.7 sn');
  act(p, { act: 'leave', game: 'foos', i: 0 });
  assert.equal(t.phase, 'idle');
  const q = sim.addPlayer('Ece', 'e'.repeat(32));
  at(q, T.spots[1].at);
  act(p, { act: 'join', game: 'foos', i: 0 });
  act(q, { act: 'join', game: 'foos', i: 0 });
  assert.equal(t.phase, 'play');
  sim.removePlayer(p.id);
  assert.equal(t.phase, 'wait');
  assert.equal(t.seats[0].name, 'Ece');
  assert.match(t.msg, /hükmen/);
});

// ---- Atari ----------------------------------------------------------------------------------

test('atari: jeton cüzdandan kasaya; puan süreye göre doğrulanır; rekor listesi kalıcı', () => {
  const store = { data: null, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
  const { sim, p, at, act, advance } = setup({ store });
  const M = BASEMENT.arcade[0];
  at(p, M.spots[0].at);
  const money = sim.money;
  const wallet = p.wallet;
  const run = act(p, { act: 'arcade', i: 0 });
  assert.equal(run.ok, true);
  assert.equal(run.game, M.game);
  assert.equal(p.wallet, wallet - R.ARCADE_PRICE);
  assert.equal(sim.money, money + R.ARCADE_PRICE);
  // İmkânsız puan reddedilir
  advance(10_000);
  const def = ARCADE_GAMES_DEF[M.game];
  assert.equal(act(p, { act: 'arcadeEnd', i: 0, run: run.run, score: def.base + def.rate * 60 }).ok, false);
  const run2 = act(p, { act: 'arcade', i: 0 });
  advance(30_000);
  const res = act(p, { act: 'arcadeEnd', i: 0, run: run2.run, score: 120 });
  assert.equal(res.ok, true);
  assert.equal(res.rank, 1);
  assert.equal(sim.basement.high[M.game][0].score, 120);
  // Parasız jeton yok
  p.wallet = 0;
  assert.equal(act(p, { act: 'arcade', i: 0 }).ok, false);
  // Kalıcılık
  const saved = sim.hotelState();
  const sim2 = new HotelSimulation({ config, rng: seeded(), now: () => 1, house: {} });
  sim2.restoreHotel(saved);
  assert.equal(sim2.basement.high[M.game][0].score, 120);
});

// ---- Bowling --------------------------------------------------------------------------------

test('bowling: kulvar ücreti cüzdandan; iki oyuncu sırayla atar; 5 çerçeve sonunda oyun biter, rekor yazılır', () => {
  const { sim, p, at, act, advance } = setup();
  const q = sim.addPlayer('Ece', 'e'.repeat(32));
  p.wallet = 100;
  q.wallet = 100;
  const L = BASEMENT.lanes[1];
  at(p, L.stand);
  at(q, L.stand);
  assert.equal(act(p, { act: 'lane', i: 1 }).ok, true);
  assert.equal(p.wallet, 100 - R.LANE_PRICE);
  assert.equal(act(q, { act: 'lane', i: 1 }).ok, true);
  const l = sim.basement.lanes[1];
  assert.equal(act(q, { act: 'bowl', i: 1, u: 0, angle: 0, power: 1 }).ok, false, 'sıra Deniz\'de');
  assert.equal(act(p, { act: 'bowl', i: 1, u: 0.9, angle: 0, power: 1 }).ok, false, 'kulvar dışından bırakılmaz');
  let guard = 0;
  while (!l.over && guard++ < 60) {
    advance(10_000);
    const cur = l.players[l.turn].id === p.id ? p : q;
    const r = act(cur, { act: 'bowl', i: 1, u: 0.05, angle: -0.004, power: 0.95, spin: 0.2 });
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  assert.equal(l.over, true);
  for (const pl of l.players) assert.equal(bowlingStatus(pl.rolls).done, true);
  assert.equal(sim.basement.bowlHigh.length, 2);
  // Yeni oyun yeniden ücretli
  const w = p.wallet;
  act(p, { act: 'lane', i: 1 });
  assert.equal(p.wallet, w - R.LANE_PRICE);
  assert.equal(l.players.length, 1);
});

// ---- NPC misafirler --------------------------------------------------------------------------

test('NPC: odasındaki misafir asansörle iner, oynar (ücret kasaya), sonra odasına döner; oyuncu gelince yer verir', () => {
  const { sim, p, at, act, tick } = setup({ extra: { basementGuests: true } });
  // Odaya bir misafir yerleştir
  const room = sim.rooms.get('101');
  room.status = ROOM_STATUS.OCCUPIED;
  sim.guests.spawn(sim.now());
  const g = [...sim.guests.guests.values()].at(-1);
  g.roomId = '101';
  g.checkoutAt = sim.clock.total + 10_000;
  sim.guests.stand(g, GUEST_PHASE.IN_ROOM, ROOM_BY_ID['101'].path.stand, 0, sim.now());
  const bm = sim.basement;
  const money = sim.money;
  sim.rng = () => 0.01; // otel misafiri seçilsin, ilk istasyon (atari 1)
  assert.equal(bm.spawnSession(sim.now()), true);
  sim.rng = seeded(11);
  bm.nextSpawnAt = Infinity;
  const sess = bm.sessions[0];
  assert.equal(g.dining, 'basement');
  assert.equal(bm.npcs.get(g.id).hotel, true);
  for (let k = 0; k < 600 && g.phase !== 'bmPlay'; k++) tick(250);
  assert.equal(g.phase, 'bmPlay');
  assert.ok(isInsideBasement(g.path[0][0], g.path[0][1]));
  assert.ok(sim.money > money, 'ücret kasaya');
  assert.ok(sim.today.earned > 0);
  // Oyuncu aynı istasyona gelince misafir yer verir
  const st = bm.stationFree(sess.game, sess.i);
  assert.equal(st, false);
  const def = BASEMENT_GAMES[sess.game].list[sess.i];
  p.wallet = 50;
  at(p, def.spots[0].at);
  const res = sess.game === 'arcade' ? act(p, { act: 'arcade', i: sess.i })
    : sess.game === 'bowling' ? act(p, { act: 'lane', i: sess.i }) : act(p, { act: 'join', game: sess.game, i: sess.i });
  assert.equal(res.ok, true);
  assert.equal(sess.cancelled, true);
  assert.equal(g.phase, 'bmOut');
  for (let k = 0; k < 800 && g.dining; k++) tick(250);
  assert.equal(g.dining, false);
  assert.equal(g.phase, GUEST_PHASE.IN_ROOM);
  assert.equal(bm.npcs.size, 0);
});

test('NPC: dışarıdan gelen ziyaretçi (kind gamer) oynayıp sokağa döner; snapshot\'ta görünür; kapanışta gelmez', () => {
  const { sim, tick, events } = setup({ extra: { basementGuests: true } });
  const bm = sim.basement;
  assert.equal(bm.spawnSession(sim.now()), true);
  bm.nextSpawnAt = Infinity;
  const ids = bm.sessions[0].members;
  assert.ok(ids.length >= 1);
  const wire = events(EVT.GUEST_UPSERT).find((w) => w.id === ids[0]);
  assert.equal(wire.kind, 'gamer');
  assert.ok(sim.snapshot(1).guests.some((w) => w.id === ids[0]));
  assert.ok(sim.snapshot(1).basement.arcade.length === 6);
  for (let k = 0; k < 2000 && bm.npcs.size; k++) tick(250);
  assert.equal(bm.npcs.size, 0);
  assert.ok(events(EVT.GUEST_REMOVE).includes(ids[0]));
  assert.ok(bm.stats.npcIncome > 0);
  // 23:00 sonrası yeni misafir inmez
  const late = setup({ hour: 23, extra: { basementGuests: true } });
  late.tick(60_000);
  assert.equal(late.sim.basement.sessions.length, 0);
});

test('yakınlık: istasyon menzili ve başka oyundayken ikinci oyuna oturulmaz', () => {
  const { sim, p, at, act } = setup();
  assert.equal(nearStation('pool', 0, ...poolStand(0)), true);
  assert.equal(nearStation('pool', 0, 0, 0), false);
  at(p, poolStand(0));
  act(p, { act: 'join', game: 'pool', i: 0 });
  // İkinci bilardo masası uzakta değil ama oyuncu zaten birinci masada
  at(p, [BASEMENT.pool[1].center[0] + 1.8, BASEMENT.pool[1].center[1]]);
  sim.basement.update(sim.now()); // uzaklaştıysa kalkar (7 m menzil içinde kalır)
  const r = act(p, { act: 'join', game: 'pool', i: 1 });
  assert.equal(r.ok, false);
});

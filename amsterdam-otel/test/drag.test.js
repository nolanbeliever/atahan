import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { CAR_BY_ID, DRAG_TRACK as T, idealRun, carAccel, carPhysics, stageLaneAt, onDragStrip } from '../shared/cars.js';

const config = {
  dayLengthSec: 100_000, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 400_000, starterBed: false,
};
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function setup({ store = null } = {}) {
  let now = 3_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 11 }, now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  const out = [];
  const to = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  const S = { sim, out, to, events, now: () => now };
  S.step = (ms) => { now += ms; sim.tick(now); };
  return S;
}

/** Arabayı satın al, şeridin sahne kutusuna koy ve bin */
function onStrip(S, p, lane, model = 'storm-390') {
  const r = S.sim.carAct(p.id, { act: 'buy', model, color: 0, source: 'wallet' });
  assert.ok(r.ok, r.error);
  const v = S.sim.vehicles.vehicles.get(r.id);
  Object.assign(v, { x: T.lanes[lane].x, z: T.startZ + 2.2, yaw: 0 });
  S.sim.movePlayer(p.id, v.x + 1.3, v.z, 0);
  assert.ok(S.sim.vehicleAct(p.id, { act: 'mount', id: v.id }).ok);
  return v;
}

const stage = (S, p, lane, mode = 'solo') => S.sim.dragAct(p.id, { act: 'stage', lane, mode });

/**
 * Yarışı 10 Hz konum paketleriyle canlandır (istemcinin sürüş fiziği): her yarışçı yeşilden rt sn sonra
 * tam gaz kalkar. jumpAt: yeşilden bu kadar ms ÖNCE kalkar. cheat: ivme yok, anında en yüksek hız.
 */
function race(S, racers, maxMs = 30_000) {
  const st = racers.map((r) => ({ ...r, v: 0, d: 0, z0: r.p.z, x: r.p.x }));
  const green = S.sim.drag.greenAt;
  for (let t = 0; t < maxMs && S.sim.drag.phase !== 'idle'; t += 100) {
    S.step(100);
    const now = S.now();
    for (const r of st) {
      const startAt = r.jumpAt != null ? green - r.jumpAt : green + r.rt * 1000;
      if (now <= startAt) continue;
      const def = CAR_BY_ID[r.model];
      const from = Math.max(startAt, now - 100);
      const dt = 1 / 400;
      for (let s = from; s < now; s += 2.5) {
        r.v = r.cheat ? carPhysics(def).vmax : Math.min(carPhysics(def).vmax, r.v + carAccel(def, r.v) * dt);
        r.d += r.v * dt;
      }
      S.sim.movePlayer(r.p.id, r.x + (r.drift ?? 0) * Math.min(1, r.d / 50), r.z0 - r.d, 0);
    }
  }
}

test('pist: çeyrek mil 402 m, iki şerit, sahne kutusu', () => {
  assert.ok(Math.abs(T.startZ - T.finishZ - 402.34) < 0.01);
  assert.equal(stageLaneAt(T.lanes.L.x, T.startZ + 2), 'L');
  assert.equal(stageLaneAt(T.lanes.R.x, T.startZ + 2), 'R');
  assert.equal(stageLaneAt(T.lanes.R.x, T.startZ + 9), null);
  assert.equal(stageLaneAt(150, T.startZ + 2), null, 'ağacın önü şerit değil');
  assert.ok(onDragStrip(147.5, -300) && !onDragStrip(170, -300));
});

test('sahneye giriş: yalnızca arabayla, şeridinde, çizginin gerisinde; hatalı girdiler', () => {
  const S = setup();
  const a = S.sim.addPlayer('Ali', KEY_A);
  S.sim.movePlayer(a.id, T.lanes.L.x, T.startZ + 2, 0);
  assert.match(stage(S, a, 'L').error, /arabanla/);
  onStrip(S, a, 'L');
  for (const bad of [null, {}, { act: 'stage' }, { act: 'stage', lane: '__proto__', mode: 'solo' }, { act: 'stage', lane: 'L', mode: 'race' },
    { act: 'stage', lane: { toString: () => 'L' }, mode: 'solo' }, { act: 'stage', lane: 'L', mode: { toString: () => 'solo' } }, { act: 'go' }]) {
    assert.equal(S.sim.dragAct(a.id, bad).ok, false, JSON.stringify(bad));
  }
  assert.match(stage(S, a, 'R').error, /çizginin/, 'yanlış şerit');
  assert.equal(S.sim.drag.phase, 'idle');
  const r = stage(S, a, 'L');
  assert.ok(r.ok, r.error);
  assert.equal(S.sim.drag.phase, 'countdown');
  assert.equal(r.greenAt - r.treeAt, T.amberMs * 3);
  assert.match(stage(S, a, 'L').error, /Zaten/);
  const st = S.events(EVT.DRAG_STATE).at(-1);
  assert.equal(st.racers[0].lane, 'L');
  assert.ok(!('k' in (st.board[0] ?? {})));
});

test('solo çeyrek mil: reaksiyon, 0–100, 1/8 ve 1/4 mil ET, hız tuzağı sunucu örneklerinden', () => {
  const S = setup();
  const a = S.sim.addPlayer('Ali', KEY_A);
  onStrip(S, a, 'L', 'storm-390');
  assert.ok(stage(S, a, 'L').ok);
  race(S, [{ p: a, model: 'storm-390', rt: 0.42 }]);
  assert.equal(S.sim.drag.phase, 'idle');
  const res = S.sim.drag.last.results[0];
  const ideal = idealRun(CAR_BY_ID['storm-390']);
  assert.equal(res.foul, null);
  // RT: tepki + sahneden 5 cm ilerleme süresi; ET bu noktadan başlar
  const roll = Math.sqrt((2 * T.rollout) / carAccel(CAR_BY_ID['storm-390'], 0));
  assert.ok(Math.abs(res.rt - (0.42 + roll)) < 0.12, `RT ${res.rt}`);
  assert.ok(Math.abs(res.et - (ideal.et - roll)) < 0.15, `ET ${res.et} / ${ideal.et}`);
  assert.ok(Math.abs(res.e8 - (ideal.e8 - roll)) < 0.15, `1/8 ${res.e8} / ${ideal.e8}`);
  assert.ok(Math.abs(res.t100 - (ideal.t100 - roll)) < 0.25, `0-100 ${res.t100} / ${ideal.t100}`);
  assert.ok(Math.abs(res.trap - ideal.trap) < 6, `trap ${res.trap} / ${ideal.trap}`);
  assert.ok(Math.abs(res.total - (res.rt + res.et)) < 0.002);
  // Liderlik tablosu + kişisel bildirim
  assert.equal(S.sim.drag.board.length, 1);
  assert.equal(S.sim.drag.board[0].et, res.et);
  assert.ok(S.to.some((m) => m.id === a.id && m.event === EVT.NOTIFY && /1\/4 mil/.test(m.payload.text)));
});

test('jump start: yeşilden önce kalkan kırmızı ışık yer; şeritten çıkan diskalifiye', () => {
  const S = setup();
  const a = S.sim.addPlayer('Ali', KEY_A);
  onStrip(S, a, 'L');
  assert.ok(stage(S, a, 'L').ok);
  race(S, [{ p: a, model: 'storm-390', jumpAt: 400 }]);
  assert.equal(S.sim.drag.last.results[0].foul, 'jump');
  assert.equal(S.sim.drag.last.results[0].et, null);
  assert.equal(S.sim.drag.board.length, 0);
  // Şerit ihlali (ikinci koşu): yanlara kayar
  const v = S.sim.vehicles.vehicles.get(a.vehicle.id);
  S.sim.vehicleAct(a.id, { act: 'dismount' });
  Object.assign(v, { x: T.lanes.L.x, z: T.startZ + 2.2, yaw: 0 });
  S.sim.movePlayer(a.id, v.x + 1.3, v.z, 0);
  S.step(3000);
  assert.ok(S.sim.vehicleAct(a.id, { act: 'mount', id: v.id }).ok);
  assert.ok(stage(S, a, 'L').ok);
  race(S, [{ p: a, model: 'storm-390', rt: 0.3, drift: 4 }]);
  assert.equal(S.sim.drag.last.results[0].foul, 'lane');
});

test('hile: anında en yüksek hız (ivmesiz) → koşu geçersiz, tabloya girmez', () => {
  const S = setup();
  const a = S.sim.addPlayer('Ali', KEY_A);
  onStrip(S, a, 'L', 'valk-tempesta');
  assert.ok(stage(S, a, 'L').ok);
  race(S, [{ p: a, model: 'valk-tempesta', rt: 0.3, cheat: true }]);
  const res = S.sim.drag.last.results[0];
  assert.equal(res.foul, 'invalid');
  assert.equal(S.sim.drag.board.length, 0);
});

test('düello: ilk gelen bekler, ikinci sahneye girince ortak geri sayım; erken kalkan (RT) kazanır', () => {
  const S = setup();
  const a = S.sim.addPlayer('Ali', KEY_A);
  const b = S.sim.addPlayer('Bea', KEY_B);
  onStrip(S, a, 'L');
  onStrip(S, b, 'R');
  assert.ok(stage(S, a, 'L', 'duel').ok);
  assert.equal(S.sim.drag.phase, 'waiting');
  assert.match(stage(S, a, 'R', 'duel').error, /Zaten/);
  assert.ok(stage(S, b, 'R', 'solo').ok, 'bekleyen varsa düelloya katılır');
  assert.equal(S.sim.drag.phase, 'countdown');
  assert.equal(S.sim.drag.mode, 'duel');
  // Yarış sürerken üçüncü kişi sahneye giremez
  const c = S.sim.addPlayer('Can', 'c'.repeat(32));
  race(S, [{ p: a, model: 'storm-390', rt: 0.62 }, { p: b, model: 'storm-390', rt: 0.25 }]);
  const last = S.sim.drag.last;
  assert.equal(last.mode, 'duel');
  assert.equal(last.winner, 'R');
  assert.ok(last.results.find((x) => x.lane === 'R').win);
  assert.ok(!last.results.find((x) => x.lane === 'L').win);
  assert.ok(S.events(EVT.NOTIFY).some((n) => /Bea kazandı/.test(n.text)));
  assert.equal(S.sim.drag.board.length, 2);
  assert.deepEqual(S.sim.drag.board.map((e) => e.name).sort(), ['Ali', 'Bea']);
  // Aynı araba: ET'ler neredeyse eşit, farkı reaksiyon yaptı
  const [ra, rb] = ['L', 'R'].map((l) => last.results.find((x) => x.lane === l));
  assert.ok(Math.abs(ra.et - rb.et) < 0.15 && ra.rt > rb.rt + 0.25);
  assert.ok(c);
});

test('düello: rakip kırmızı ışık yakarsa diğeri kazanır; rakip gelmezse bekleme iptal', () => {
  const S = setup();
  const a = S.sim.addPlayer('Ali', KEY_A);
  const b = S.sim.addPlayer('Bea', KEY_B);
  onStrip(S, a, 'L');
  onStrip(S, b, 'R');
  assert.ok(stage(S, a, 'L', 'duel').ok);
  assert.ok(stage(S, b, 'R', 'duel').ok);
  race(S, [{ p: a, model: 'storm-390', rt: 0.9 }, { p: b, model: 'storm-390', jumpAt: 300 }]);
  assert.equal(S.sim.drag.last.winner, 'L');
  assert.equal(S.sim.drag.last.results.find((x) => x.lane === 'R').foul, 'jump');
  // Bekleme süresi dolar
  const S2 = setup();
  const c = S2.sim.addPlayer('Can', KEY_A);
  onStrip(S2, c, 'L');
  assert.ok(stage(S2, c, 'L', 'duel').ok);
  S2.step(T.waitMs + 200);
  assert.equal(S2.sim.drag.phase, 'idle');
  assert.ok(S2.to.some((m) => m.id === c.id && /Rakip gelmedi/.test(m.payload.text ?? '')));
});

test('ayrılan / inen yarışçı DNF; yeşilden sonra 40 sn bitiremeyen DNF', () => {
  const S = setup();
  const a = S.sim.addPlayer('Ali', KEY_A);
  onStrip(S, a, 'L');
  assert.ok(stage(S, a, 'L').ok);
  S.step(T.treeDelayMs + T.amberMs * 3 + 200);
  assert.equal(S.sim.drag.phase, 'running');
  S.step(T.runMs);
  assert.equal(S.sim.drag.phase, 'idle');
  assert.equal(S.sim.drag.last.results[0].foul, 'dnf');
  // Oyundan çıkan
  assert.ok(stage(S, a, 'L').ok);
  S.sim.removePlayer(a.id);
  assert.equal(S.sim.drag.phase, 'idle');
});

test('liderlik tablosu: ET\'ye göre sıralı, oyuncu başına en iyi koşu, en fazla 10, kalıcı; bozuk kayıt atılır', () => {
  const store = memoryStore();
  const S = setup({ store });
  const a = S.sim.addPlayer('Ali', KEY_A);
  onStrip(S, a, 'L', 'kade-vier');
  assert.ok(stage(S, a, 'L').ok);
  race(S, [{ p: a, model: 'kade-vier', rt: 0.4 }]);
  const slow = S.sim.drag.board[0].et;
  // Aynı oyuncu daha hızlı arabayla: kaydı iyileşir (tek kayıt)
  const v = S.sim.vehicles.vehicles.get(a.vehicle.id);
  S.sim.vehicleAct(a.id, { act: 'dismount' });
  S.step(3000);
  const v2 = onStrip(S, a, 'R', 'valk-tempesta');
  assert.notEqual(v2.id, v.id);
  assert.ok(stage(S, a, 'R').ok);
  race(S, [{ p: a, model: 'valk-tempesta', rt: 0.4 }]);
  assert.equal(S.sim.drag.board.length, 1);
  assert.ok(S.sim.drag.board[0].et < slow);
  assert.equal(S.sim.drag.board[0].model, 'valk-tempesta');
  // Daha yavaş koşu kaydı bozmaz
  const best = S.sim.drag.board[0].et;
  S.sim.drag.toBoard({ k: S.sim.drag.board[0].k, name: 'Ali', model: 'kade-vier', foul: null, tFin: 20_000, launchAt: 0, et: 20_000, trap: 100 }, 1);
  assert.equal(S.sim.drag.board[0].et, best);
  // 12 farklı oyuncu → en iyi 10
  for (let i = 0; i < 12; i++) {
    S.sim.drag.toBoard({ k: String(i).padStart(64, 'c'), name: `P${i}`, model: 'kade-vier', foul: null, tFin: 13_000 + i * 100, launchAt: 0, et: 13_000 + i * 100, trap: 150 }, 2 + i);
  }
  S.sim.drag.greenAt = 0;
  const board = S.sim.drag.board;
  assert.equal(board.length, 10);
  for (let i = 1; i < board.length; i++) assert.ok(board[i - 1].et <= board[i].et);
  assert.equal(board[0].name, 'Ali');
  S.sim.house.flush();
  const saved = store.data.hotel.drag.board;
  assert.equal(saved.length, 10);
  // Yeniden açılış
  const S2 = setup({ store: memoryStore(JSON.parse(JSON.stringify(store.data))) });
  assert.deepEqual(S2.sim.drag.board.map((e) => e.et), board.map((e) => e.et));
  assert.ok(S2.events(EVT.DRAG_STATE).length === 0 && S2.sim.drag.serialize().board.every((e) => !('k' in e)));
  // Bozuk kayıtlar
  const data = JSON.parse(JSON.stringify(store.data));
  data.hotel.drag.board = [
    { k: 'a'.repeat(64), name: 'X', model: 'kade-vier', et: 12, trap: 150, rt: 0.5, at: 1 },
    { k: 'a'.repeat(64), name: 'Y', model: 'kade-vier', et: 11, trap: 150, rt: 0.5 }, // yinelenen anahtar
    { name: 'Z', model: '__proto__', et: 12, trap: 150, rt: 0.5 }, { name: 'Z', model: 'kade-vier', et: '12', trap: 150, rt: 0.5 },
    { name: 'Z', model: 'kade-vier', et: 1, trap: 150, rt: 0.5 }, { name: 'Z', model: 'kade-vier', et: 12, trap: NaN, rt: 0.5 },
    { name: 'Z', model: 'kade-vier', et: 12, trap: 150, rt: -1 }, null, 'x', { k: { toString: 1 }, name: 5, model: 'polder-p6', et: 22.5, trap: 100, rt: 0.6 },
  ];
  const S3 = setup({ store: memoryStore(data) });
  assert.deepEqual(S3.sim.drag.board.map((e) => [e.name, e.et]), [['X', 12], ['?', 22.5]]);
  for (const junk of [null, 5, 'x', { board: 'x' }, { board: {} }]) {
    const s = setup({ store: memoryStore({ hotel: { drag: junk } }) });
    assert.equal(s.sim.drag.board.length, 0);
  }
});

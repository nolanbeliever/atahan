import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import {
  EVT, TRIP, SLOT, START_WALLET, PRODUCT_BY_ID, TIP_MIN, TIP_MAX,
} from '../shared/constants.js';
import { COFFEESHOP, ROOM_BY_ID } from '../shared/layout.js';

const config = {
  dayLengthSec: 240, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16,
};

function seeded(seed = 7) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup(rng = seeded()) {
  let now = 5_000_000;
  const sim = new HotelSimulation({ config, rng, now: () => now });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  const to = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  const p = sim.addPlayer('Test');
  const atCounter = () => sim.movePlayer(p.id, COFFEESHOP.counterPoint[0], COFFEESHOP.counterPoint[1] - 0.8, 0);
  const atSlot = () => sim.movePlayer(p.id, COFFEESHOP.slot.point[0] - 0.6, COFFEESHOP.slot.point[1], 0);
  const tick = (ms) => { now += ms; sim.tick(now); };
  return { sim, p, out, to, atCounter, atSlot, tick };
}

test('satın alma: tezgâhta para düşer, envantere eklenir; uzakta / parasızken olmaz', () => {
  const { sim, p, to, atCounter } = setup();
  assert.equal(p.wallet, START_WALLET);
  assert.equal(sim.buy(p.id, 'amnesia').ok, false, 'otel lobisinden alınamaz');
  atCounter();
  const res = sim.buy(p.id, 'amnesia');
  assert.equal(res.ok, true);
  assert.equal(p.wallet, START_WALLET - PRODUCT_BY_ID.amnesia.price);
  assert.equal(p.inventory.amnesia, 1);
  assert.ok(to.some((m) => m.id === p.id && m.event === EVT.SELF && m.payload.inventory.amnesia === 1));
  assert.equal(sim.buy(p.id, 'yok-boyle-urun').ok, false);
  p.wallet = 1;
  assert.equal(sim.buy(p.id, 'spacecake').ok, false, 'yetersiz bakiye');
});

test('tüketim: trip başlar, herkese duyurulur, 2 dakika sonra biter; trip sırasında tekrar tüketilemez', () => {
  const { sim, p, out, atCounter, tick } = setup();
  atCounter();
  sim.buy(p.id, 'spacecake');
  sim.buy(p.id, 'spacecake');
  const r = sim.consume(p.id, 'spacecake');
  assert.equal(r.ok, true);
  assert.ok([TRIP.GOOD, TRIP.BAD].includes(r.type));
  assert.equal(p.inventory.spacecake, 1);
  const ev = out.find((e) => e.event === EVT.PLAYER_TRIP);
  assert.equal(ev.payload.id, p.id);
  assert.equal(ev.payload.type, r.type);
  assert.equal(sim.consume(p.id, 'spacecake').ok, false, 'trip sürerken ikinci kez tüketilemez');
  assert.equal(sim.publicPlayer(p).trip.type, r.type, 'diğer oyuncular trip türünü görür');
  tick(TRIP.DURATION_MS + 100);
  assert.equal(p.trip, null);
  assert.ok(out.some((e) => e.event === EVT.PLAYER_TRIP && e.payload.type === null));
  assert.equal(sim.consume(p.id, 'spacecake').ok, true);
  assert.equal(sim.consume(p.id, 'amnesia').ok, false, 'envanterde olmayan tüketilemez');
});

test('trip zarı yaklaşık %50 iyi / %50 kötü', () => {
  const { sim, p } = setup(seeded(99));
  let good = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    p.trip = null;
    p.inventory = { amnesia: 1 };
    if (sim.consume(p.id, 'amnesia').type === TRIP.GOOD) good++;
  }
  assert.ok(Math.abs(good / N - 0.5) < 0.03, `iyi oranı ${good / N}`);
});

test('slot: iyi trip kazanma ihtimalini ~%25 artırır', () => {
  const rate = (lucky) => {
    const { sim, p, atSlot } = setup(seeded(lucky ? 3 : 4));
    atSlot();
    let wins = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      p.wallet = 100;
      p.trip = lucky ? { type: TRIP.GOOD, endsAt: Infinity } : null;
      const r = sim.spin(p.id);
      assert.equal(r.ok, true);
      if (r.payout > 0) {
        wins++;
        assert.ok(r.reels[0] === r.reels[1] && r.reels[1] === r.reels[2]);
      } else {
        assert.ok(!(r.reels[0] === r.reels[1] && r.reels[1] === r.reels[2]), 'kaybeden çevirmede üçlü olmaz');
      }
    }
    return wins / N;
  };
  const base = rate(false);
  const lucky = rate(true);
  assert.ok(Math.abs(base - SLOT.BASE_WIN) < 0.015, `temel oran ${base}`);
  assert.ok(Math.abs(lucky - SLOT.BASE_WIN * TRIP.SLOT_LUCK) < 0.015, `şanslı oran ${lucky}`);
});

test('slot: makineden uzakta ya da parasızken çevrilemez', () => {
  const { sim, p, atSlot } = setup();
  assert.equal(sim.spin(p.id).ok, false);
  atSlot();
  p.wallet = SLOT.BET - 1;
  assert.equal(sim.spin(p.id).ok, false);
  assert.equal(p.wallet, SLOT.BET - 1, 'para düşmemeli');
});

test('bahşiş: odayı bitiren oyuncunun cüzdanına girer, iyi trip +%20', () => {
  const { sim, p, to } = setup();
  const room = sim.rooms.get('102');
  const layout = ROOM_BY_ID['102'];
  sim.rooms.makeDirty(room);
  room.trash.fill(false);
  p.trip = { type: TRIP.GOOD, endsAt: Infinity };
  sim.movePlayer(p.id, layout.bed.x - 1.6, layout.bed.z, 0);
  const before = p.wallet;
  assert.equal(sim.interact(p.id, '102', 'bed'), true);
  const gained = p.wallet - before;
  assert.ok(gained >= Math.round(TIP_MIN * TRIP.TIP_LUCK) && gained <= Math.round(TIP_MAX * TRIP.TIP_LUCK));
  assert.ok(to.some((m) => m.event === EVT.NOTIFY && /bahşiş/.test(m.payload.text) && /Şans/.test(m.payload.text)));
});

test('emote: yalnızca uygun trip türünde ve bekleme süresiyle yayınlanır', () => {
  const { sim, p, out, tick } = setup();
  assert.equal(sim.emote(p.id, 'giggle'), false, 'trip yokken olmaz');
  p.trip = { type: TRIP.BAD, endsAt: Infinity };
  assert.equal(sim.emote(p.id, 'giggle'), false, 'kötü trip kıkırdamaz');
  assert.equal(sim.emote(p.id, 'vomit'), true);
  assert.equal(sim.emote(p.id, 'vomit'), false, 'bekleme süresi');
  tick(TRIP.EMOTE_COOLDOWN_MS + 10);
  assert.equal(sim.emote(p.id, 'vomit'), true);
  assert.equal(out.filter((e) => e.event === EVT.PLAYER_EMOTE).length, 2);
});

test('welcome: kişisel cüzdan/envanter yalnızca kendi anlık görüntüsünde', () => {
  const { sim, p } = setup();
  const snap = sim.snapshot(p.id);
  assert.equal(snap.self.wallet, START_WALLET);
  assert.deepEqual(snap.self.inventory, {});
  assert.equal(snap.players[0].wallet, undefined, 'başkalarının cüzdanı paylaşılmaz');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { RECEPTION_PC } from '../shared/layout.js';
import { BASEMENT, BASEMENT_GAMES } from '../shared/basement.js';
import {
  DOOR, DRESS_CODES, BOUNCER_RULES as R, CUES_OK, CUES_BAD, VENUE_NAME, dressViolation, compliantDress, breakDress, dressCodeFor,
  ambienceFeeMul, bouncerAccuracy,
} from '../shared/bouncer.js';
import { NEW_STAFF } from '../shared/staffhr.js';
import { queueSlot } from '../server/game/BouncerService.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
  restaurantDiners: false, valetCustomers: false, basementGuests: false, bouncerSeed: 99,
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
  sim.growth.reputation = 50; // itibar düşüşleri ölçülebilsin (0'ın altına inmez)
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  const at = (pl, [x, z]) => sim.movePlayer(pl.id, x, z, 0);
  const act = (pl, data) => sim.bouncerAct(pl.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  return { sim, p, tick, at, act, events, out, now: () => now };
}

/** Sıranın başına bir misafir gelene kadar bekle */
function untilFront(sim, tick, max = 120_000) {
  for (let t = 0; t < max; t += 500) {
    const n = sim.bouncer.front;
    if (n && sim.now() >= n.e.phaseEndsAt) return n;
    tick(500);
  }
  return null;
}

// ---- Kurallar -----------------------------------------------------------------------------------

test('kıyafet kuralları: yalnızca kıyafet parçası ve renk; uyan / bozulan kıyafet üreticileri tutarlı', () => {
  const sik = { top: 'gomlek', topC: 'beyaz', bottom: 'kumas', bottomC: 'siyah', shoes: 'klasik', shoesC: 'siyah', jacket: null, jacketC: null, acc: null };
  assert.equal(dressViolation('sik', sik), null);
  assert.match(dressViolation('sik', { ...sik, shoes: 'sneaker' }), /Temiz sneaker/);
  assert.equal(dressViolation('smart', { ...sik, top: 'tisort', bottom: 'kot', shoes: 'sneaker' }), null);
  assert.match(dressViolation('smart', { ...sik, bottom: 'esofman' }), /Eşofman/);
  assert.match(dressViolation('smart', { ...sik, shoes: 'terlik' }), /Terlik/);
  assert.match(dressViolation('beyaz', sik), /Alt beyaz değil/);
  assert.equal(dressViolation('beyaz', { ...sik, bottomC: 'beyaz' }), null);
  assert.match(dressViolation('neon', sik), /neon/);
  assert.equal(dressViolation('neon', { ...sik, acc: 'neon' }), null);
  assert.equal(dressViolation('neon', { ...sik, topC: 'neonpembe' }), null);
  const rng = seeded(3);
  for (const code of DRESS_CODES) {
    for (let i = 0; i < 150; i++) {
      const d = compliantDress(rng, code.id);
      assert.equal(dressViolation(code.id, d), null, `${code.id}: ${JSON.stringify(d)}`);
      assert.notEqual(dressViolation(code.id, breakDress(rng, code.id, d)), null, `${code.id} bozulmalı`);
    }
  }
  // Kural her gün sırayla değişir; ortam → ücret çarpanı; isabet sınırlı
  assert.notEqual(dressCodeFor(0).id, dressCodeFor(1).id);
  assert.equal(dressCodeFor(4).id, dressCodeFor(0).id);
  assert.equal(ambienceFeeMul(0), 0.8);
  assert.ok(Math.abs(ambienceFeeMul(100) - 1.4) < 1e-9);
  assert.ok(bouncerAccuracy(5, 0.8) <= 0.97 && bouncerAccuracy(1, 1) === 0.7);
  // Sıra yerleri kadife ipin kuzeyinde, bodrumun içinde
  for (let i = 0; i < 9; i++) {
    const [x, z] = queueSlot(i);
    assert.ok(x > BASEMENT.bounds.minX && z > DOOR.rope.z, `yer ${i}`);
  }
});

// ---- Sıra ve kararlar --------------------------------------------------------------------------------

test('misafir asansörden sıraya girer; kürsüdeki oyuncu doğru karar verince ortam artar, haksız geri çevirince düşer', () => {
  const { sim, p, tick, at, act, events } = setup();
  const b = sim.bouncer;
  assert.equal(act(p, { act: 'post' }).ok, false, 'kürsüye uzaktan geçilmez');
  at(p, BASEMENT.spawn);
  at(p, DOOR.stand);
  assert.equal(act(p, { act: 'post' }).ok, true);
  assert.equal(b.post.id, p.id);
  assert.equal(sim.basement.spawnSession(sim.now()), true);
  const n = untilFront(sim, tick);
  assert.ok(n, 'misafir kapıya geldi');
  assert.ok(n.e.dress && n.door.card && n.door.cue, 'görünür kıyafet + kart + tavır');
  assert.equal(n.e.phase, 'bmQueue');
  const wire = events(EVT.GUEST_UPSERT).filter((w) => w.id === n.id).at(-1);
  assert.deepEqual(wire.dress, n.e.dress, 'kıyafet herkese yayınlanır');
  // Geçersiz istekler
  assert.equal(act(p, { act: 'decide', id: n.id + 999, admit: true }).ok, false);
  assert.equal(act(p, { act: 'decide', id: n.id, admit: 'evet' }).ok, false);
  // Uygun misafiri (kart / tavır / kıyafet düzeltilir) içeri al
  n.e.dress = compliantDress(seeded(5), b.code.id);
  n.door.cue = CUES_OK[0];
  n.door.card = { type: 'invite', name: n.door.name, day: sim.clock.dayCount, venue: VENUE_NAME };
  const a0 = b.ambience;
  const res = act(p, { act: 'decide', id: n.id, admit: true });
  assert.equal(res.ok, true);
  assert.equal(res.correct, true);
  assert.equal(b.ambience, a0 + R.DELTA.admitOk);
  assert.equal(n.e.phase, 'bmIn', 'salona yürür');
  // İkinci misafiri haksız yere geri çevir: ortam −3, itibar −1, oturumdan çıkar
  const m = untilFront(sim, tick, 30_000) ?? (sim.basement.spawnSession(sim.now()), untilFront(sim, tick));
  assert.ok(m);
  m.e.dress = compliantDress(seeded(6), b.code.id);
  m.door.cue = CUES_OK[1];
  m.door.card = { ...m.door.card, day: sim.clock.dayCount, venue: VENUE_NAME, name: m.door.name };
  b.blacklist = b.blacklist.filter((x) => x !== m.door.card.name);
  const rep = sim.growth.reputation;
  const a1 = b.ambience;
  tick(400);
  const r2 = act(p, { act: 'decide', id: m.id, admit: false });
  assert.equal(r2.correct, false);
  assert.equal(b.ambience, a1 + R.DELTA.rejectOk);
  assert.equal(sim.growth.reputation, rep - 1);
  assert.equal(m.e.phase, 'bmOut');
  assert.equal(m.session.members.includes(m.id), false);
  assert.ok(events(EVT.BOUNCER_STATE).length > 0);
});

test('kara listedeki / sahte davetiyeli misafir geri çevrilmeli; içeri alınırsa olay çıkarır (ortam ve itibar düşer)', () => {
  const { sim, p, tick, at, act, out } = setup();
  const b = sim.bouncer;
  at(p, BASEMENT.spawn);
  at(p, DOOR.stand);
  act(p, { act: 'post' });
  sim.basement.spawnSession(sim.now());
  const n = untilFront(sim, tick);
  n.e.dress = compliantDress(seeded(9), b.code.id);
  n.door.cue = CUES_OK[0];
  n.door.card = { type: 'invite', name: b.blacklist[0], day: sim.clock.dayCount, venue: VENUE_NAME };
  n.door.name = b.blacklist[0];
  assert.match(b.violation(n), /kara listede/);
  n.door.card.name = 'Sanne Z.';
  n.door.card.venue = 'Hotel De Tulip';
  assert.match(b.violation(n), /Sahte davetiye/);
  n.door.cue = CUES_BAD[1];
  n.door.troublemaker = true;
  const a0 = b.ambience;
  const rep = sim.growth.reputation;
  assert.equal(act(p, { act: 'decide', id: n.id, admit: true }).correct, false);
  assert.ok(b.watch.has(n));
  tick(R.INCIDENT_MAX_MS + 30_000, 250);
  assert.equal(b.watch.has(n), false);
  assert.equal(b.stats.incidents, 1);
  assert.ok(b.ambience <= a0 + R.DELTA.incident);
  assert.ok(sim.growth.reputation <= rep - 2);
  assert.ok(out.some((o) => o.event === EVT.NOTIFY && /olay çıktı/.test(o.payload.text)));
  assert.equal(n.session.cancelled, true);
});

test('kapıda kimse yokken misafir kontrolsüz girer ve oynayınca ücret ortamla ölçeklenir', () => {
  const { sim, tick } = setup();
  const b = sim.bouncer;
  b.ambience = 100;
  const money = sim.money;
  sim.basement.spawnSession(sim.now());
  const sess = sim.basement.sessions[0];
  // Hepsi kurallara uysun (olay çıkmasın)
  for (const id of sess.members) {
    const n = sim.basement.npcs.get(id);
    n.door.troublemaker = false;
  }
  const playingNow = () => sess.members.map((id) => sim.basement.npcs.get(id)).filter((n) => n?.e.phase === 'bmPlay');
  for (let t = 0; t < 120_000 && playingNow().length < sess.members.length; t += 500) tick(500, 250);
  const playing = playingNow();
  assert.ok(playing.length >= 1, 'misafirler oyuna geçti');
  const g = BASEMENT_GAMES[sess.game];
  assert.ok(sim.money - money >= Math.round(g.npcFee * 1.4) * playing.length - 1, 'ücret ×1.4');
  assert.equal(b.today.admitted, sess.members.length);
});

test('bouncer NPC işe alınır (kasadan, PC başında), kapıda kontrol eder; kayıtla geri gelir', () => {
  const store = { data: null, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
  const { sim, p, tick, at } = setup({ store });
  sim.money = 2000;
  assert.equal(sim.staffAct(p.id, { act: 'hire', role: 'bouncer' }).ok, false, 'PC başında olmalı');
  at(p, RECEPTION_PC.point);
  assert.equal(sim.staffAct(p.id, { act: 'hire', role: 'bouncer' }).ok, true);
  assert.equal(sim.money, 2000 - NEW_STAFF.bouncer.price);
  const s = [...sim.bouncer.staff.values()][0];
  assert.ok(s);
  tick(4000);
  assert.deepEqual(s.path.at(-1), [...DOOR.stand], 'kürsüye geçti');
  sim.basement.spawnSession(sim.now());
  tick(150_000, 250);
  assert.ok(s.tasks >= 1, 'en az bir misafiri kontrol etti');
  assert.ok(sim.bouncer.stats.checked >= 1);
  const rec = sim.staffhr.records.get(`bouncer:${s.name}`);
  assert.ok(rec.ratingN >= 1, 'performans puanı yazıldı');
  // Kalıcılık
  sim.house.save?.();
  const saved = sim.hotelState();
  assert.equal(saved.bouncer.staff.length, 1);
  const sim2 = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 13 }, rng: seeded(), now: () => sim.now(), house: { store } });
  sim2.restoreHotel(saved);
  assert.equal(sim2.bouncer.staff.size, 1);
  assert.equal([...sim2.bouncer.staff.values()][0].name, s.name);
  assert.equal(sim2.bouncer.ambience, sim.bouncer.ambience);
});

test('kapı sistemi kapalıyken (bouncerQueue: false) misafir doğrudan oyun yerine yürür', () => {
  const { sim, tick } = setup({ extra: { bouncerQueue: false } });
  sim.basement.spawnSession(sim.now());
  const n = [...sim.basement.npcs.values()][0];
  assert.equal(n.e.phase, 'bmIn');
  assert.equal(n.door, undefined);
  tick(150_000, 250);
  assert.equal(sim.bouncer.queue.length, 0);
});

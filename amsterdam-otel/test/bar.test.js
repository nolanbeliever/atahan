import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import {
  EVT, BAR_RULES, DRINK_BY_ID, FOOD_BY_ID, INGREDIENT_BY_ID, BAR_CUSTOMER_NAMES, START_WALLET,
} from '../shared/constants.js';
import { BAR, POINTS } from '../shared/layout.js';

const T = BAR_RULES.T;

const config = {
  dayLengthSec: 240, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16,
};

function seeded(seed = 11) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sahte saatle bar kurulumu. Varsayılan: Salı 11:00, oyun saati neredeyse donuk
 * (dayLengthSec çok büyük) ve kendiliğinden müşteri gelmez — müşteriyi test çağırır.
 */
function setup({ hour = 11, dayLengthSec = 100_000, spawning = false, rng = seeded() } = {}) {
  let now = 3_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: hour, dayLengthSec }, rng, now: () => now });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  const to = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  const p = sim.addPlayer('Barmen');
  const bar = sim.bar;
  if (!spawning) bar.nextSpawnAt = Infinity;

  const at = (pt, dz = 0) => sim.movePlayer(p.id, pt[0], pt[1] + dz, 0);
  const tick = (ms) => { now += ms; sim.tick(now); };
  const act = (data, who = p) => sim.barAct(who.id, data);
  const glasses = () => assert.equal(bar.glassTotal(), BAR_RULES.GLASSES, 'bardak toplamı korunmalı');
  /** Başarılı olması beklenen adım; ardından adımın süresi kadar bekler */
  const step = (data, who = p) => {
    const r = act(data, who);
    assert.equal(r.ok, true, `${data.act}: ${r.error}`);
    glasses();
    tick(T[data.act]);
    glasses();
    return r;
  };
  const spawnCustomer = () => {
    const before = new Set(bar.customers.keys());
    bar.nextSpawnAt = now;
    tick(1);
    bar.nextSpawnAt = Infinity;
    const c = [...bar.customers.values()].find((x) => !before.has(x.id));
    assert.ok(c, 'müşteri gelmeli');
    return c;
  };
  const seatCustomer = (order) => {
    const c = spawnCustomer();
    tick(c.phaseEndsAt - now);
    assert.equal(c.phase, 'barSeat');
    if (order) bar.stools[c.stool].order = order;
    return c;
  };
  const serveLemonade = (i) => {
    at(BAR.glassRack); step({ act: 'take' });
    at(BAR.dispensers.lemon); step({ act: 'pour', ing: 'lemon' });
    at(BAR.dispensers.soda); step({ act: 'pour', ing: 'soda' });
    at(BAR.stools[i].spot);
    return step({ act: 'serve', stool: i });
  };
  const events = (event) => out.filter((e) => e.event === event).map((e) => e.payload);
  const lastBar = () => events(EVT.BAR_STATE).pop();
  return {
    sim, p, bar, out, to, at, tick, act, step, glasses, spawnCustomer, seatCustomer, serveLemonade, events, lastBar,
    getNow: () => now, setNow: (v) => { now = v; },
  };
}

test('müşteri gelir, taburesine yürür, oturup sipariş verir (kind: bar, kimlik çakışmaz)', () => {
  const { sim, bar, tick, spawnCustomer, events, lastBar, getNow } = setup();
  sim.guests.spawn(getNow()); // bir otel misafiri de var
  const hotelIds = [...sim.guests.guests.keys()];

  const c = spawnCustomer();
  assert.ok(!hotelIds.includes(c.id), 'bar müşterisi otel misafiriyle aynı kimliği almaz');
  const st = BAR.stools[c.stool];
  let up = events(EVT.GUEST_UPSERT).filter((g) => g.id === c.id).pop();
  assert.equal(up.kind, 'bar');
  assert.equal(up.phase, 'barIn');
  assert.equal(up.roomId, null);
  assert.equal(up.sit, false);
  assert.equal(up.sitY, 0);
  assert.ok([POINTS.streetWest[0], POINTS.streetEast[0]].includes(up.path[0][0]), 'sokaktan gelir');
  assert.deepEqual(up.path.at(-2), st.approach);
  assert.deepEqual(up.path.at(-1), st.seat);
  assert.equal(bar.stools[c.stool].state, 'coming');
  assert.equal(lastBar().stools[c.stool].state, 'coming');
  assert.equal(lastBar().stools[c.stool].customer, c.id);
  assert.ok(BAR_CUSTOMER_NAMES.includes(lastBar().stools[c.stool].name));
  assert.ok(!sim.guests.guests.has(c.id), 'GuestManager haritasına konmaz');

  tick(c.phaseEndsAt - getNow() - 1);
  assert.equal(c.phase, 'barIn', 'yürüyüş bitmeden oturmaz');
  tick(1);
  up = events(EVT.GUEST_UPSERT).filter((g) => g.id === c.id).pop();
  assert.equal(up.phase, 'barSeat');
  assert.equal(up.sit, true);
  assert.equal(up.sitY, BAR_RULES.SIT_Y);
  assert.equal(up.face, 0, 'tezgâha (+Z) bakar');
  assert.deepEqual(up.path, [st.seat]);
  const s = lastBar().stools[c.stool];
  assert.equal(s.state, 'waiting');
  assert.ok(DRINK_BY_ID[s.order], 'sipariş geçerli bir içecek');
  assert.equal(s.waitUntil, getNow() + BAR_RULES.PATIENCE_MS);
  assert.equal(s.patienceMs, BAR_RULES.PATIENCE_MS);
  assert.equal(s.glass, null);

  const snap = sim.snapshot(1);
  assert.ok(snap.guests.some((g) => hotelIds.includes(g.id) && g.kind === undefined), 'otel misafirleri de anlık görüntüde');
  assert.equal(snap.guests.find((g) => g.id === c.id).kind, 'bar');

  const c2 = spawnCustomer();
  assert.notEqual(c2.id, c.id);
  assert.notEqual(c2.stool, c.stool, 'dolu tabureye ikinci müşteri oturmaz');
  assert.notEqual(c2.name, c.name);
});

test('tam servis: bardak → malzemeler → çalkala → servis (kasa, bahşiş, served; misafir sayısı değişmez)', () => {
  const { sim, p, bar, to, at, act, step, seatCustomer, events, lastBar, getNow } = setup();
  const c = seatCustomer('mocktail');
  const i = c.stool;
  const drink = DRINK_BY_ID.mocktail;
  const money0 = sim.money;
  const wallet0 = p.wallet;

  at(BAR.glassRack);
  let r = step({ act: 'take' });
  assert.deepEqual(r.hold, { kind: 'glass', pours: [], shaken: false });
  assert.equal(bar.rack, BAR_RULES.GLASSES - 1);
  assert.equal(lastBar().rack, BAR_RULES.GLASSES - 1);
  let pb = events(EVT.PLAYER_BAR).pop();
  assert.deepEqual({ ...pb, until: 0 }, { id: p.id, hold: 'glass', color: null, act: 'take', until: 0 });
  assert.equal(pb.until, r.busyUntil);
  assert.ok(to.some((m) => m.id === p.id && m.event === EVT.SELF && m.payload.bar.hold?.kind === 'glass'));

  for (const ing of drink.ingredients) {
    at(BAR.dispensers[ing]);
    r = step({ act: 'pour', ing });
    assert.equal(r.hold.pours.at(-1), ing);
  }
  pb = events(EVT.PLAYER_BAR).pop();
  assert.equal(pb.act, 'pour');
  assert.match(pb.color, /^#[0-9a-f]{6}$/);
  at(BAR.shaker);
  r = step({ act: 'shake' });
  assert.equal(r.hold.shaken, true);

  at(BAR.stools[i].spot);
  const s = bar.stools[i];
  const expectedTip = Math.round(BAR_RULES.TIP_MIN
    + (BAR_RULES.TIP_MAX - BAR_RULES.TIP_MIN) * ((s.waitUntil - getNow()) / BAR_RULES.PATIENCE_MS));
  r = act({ act: 'serve', stool: i });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.hold, null);
  assert.equal(r.tip, expectedTip);
  assert.ok(r.tip >= BAR_RULES.TIP_MIN && r.tip <= BAR_RULES.TIP_MAX);
  assert.equal(sim.money, money0 + drink.price, 'içecek ücreti otel kasasına');
  assert.equal(p.wallet, wallet0 + r.tip, 'bahşiş servis edenin cüzdanına');
  assert.equal(sim.today.guests, 0, 'bar satışı misafir sayılmaz');
  assert.equal(sim.today.served, 1);
  const eco = events(EVT.ECONOMY).pop();
  assert.equal(eco.delta, drink.price);
  assert.equal(eco.reason, `Bar: ${drink.name}`);
  assert.equal(eco.today.served, 1);
  assert.ok(to.some((m) => m.id === p.id && m.event === EVT.NOTIFY && m.payload.kind === 'money'
    && m.payload.text.includes(drink.name) && m.payload.text.includes(`+€${r.tip} bahşiş`)));
  assert.ok(!events(EVT.NOTIFY).some((n) => /bahşiş/.test(n.text)), 'bahşiş bildirimi kişisel');
  const after = lastBar().stools[i];
  assert.deepEqual(
    { state: after.state, glass: after.glass, drink: after.drink, waitUntil: after.waitUntil },
    { state: 'drinking', glass: 'full', drink: 'mocktail', waitUntil: 0 },
  );
  assert.equal(events(EVT.PLAYER_BAR).pop().act, 'serve');
  assert.equal(sim.publicPlayer(p).bar.hold, null);
});

test('earn: varsayılan misafir sayar, guest:false saymaz', () => {
  const { sim } = setup();
  sim.earn(10, 'Oda');
  sim.earn(5, 'Bar', { guest: false });
  assert.deepEqual(sim.today, { earned: 15, guests: 1, cleaned: 0, served: 0 });
});

test('yanlış tarif ve çalkalama hatası reddedilir, durum değişmez; yanlış içecek lavaboda dökülür', () => {
  const { sim, p, bar, at, act, step, seatCustomer, glasses } = setup();
  const c = seatCustomer('lemonade');
  const i = c.stool;
  const s = bar.stools[i];

  // Limonata çalkalanmaz
  at(BAR.glassRack); step({ act: 'take' });
  at(BAR.dispensers.lemon); step({ act: 'pour', ing: 'lemon' });
  at(BAR.dispensers.soda); step({ act: 'pour', ing: 'soda' });
  at(BAR.shaker); step({ act: 'shake' });
  at(BAR.stools[i].spot);
  let r = act({ act: 'serve', stool: i });
  assert.equal(r.ok, false);
  assert.match(r.error, /çalkalamamalıydın/);
  assert.ok(r.error.startsWith(`${c.name}: "`));
  assert.deepEqual(p.bar.hold, { kind: 'glass', pours: ['lemon', 'soda'], shaken: true }, 'el değişmez');
  assert.equal(s.state, 'waiting');
  assert.equal(sim.money, 0);
  glasses();
  at(BAR.sink); step({ act: 'wash' });
  assert.equal(bar.rack, BAR_RULES.GLASSES);
  assert.equal(p.bar.hold, null);

  // Yanlış malzemeler
  at(BAR.glassRack); step({ act: 'take' });
  at(BAR.dispensers.lemon); step({ act: 'pour', ing: 'lemon' });
  at(BAR.dispensers.milk); step({ act: 'pour', ing: 'milk' });
  at(BAR.stools[i].spot);
  r = act({ act: 'serve', stool: i });
  assert.equal(r.error, `${c.name}: "Bu benim siparişim değil!"`);
  at(BAR.sink); step({ act: 'wash' });

  // Çalkalanması gereken içecek çalkalanmadan
  s.order = 'milkshake';
  at(BAR.glassRack); step({ act: 'take' });
  at(BAR.dispensers.strawberry); step({ act: 'pour', ing: 'strawberry' });
  at(BAR.dispensers.milk); step({ act: 'pour', ing: 'milk' });
  at(BAR.stools[i].spot);
  assert.match(act({ act: 'serve', stool: i }).error, /çalkalanması gerekiyordu/);
  at(BAR.shaker); step({ act: 'shake' });
  at(BAR.stools[i].spot);
  assert.equal(step({ act: 'serve', stool: i }).ok, true, 'sıra serbest, çalkalanınca kabul');
  assert.equal(sim.money, DRINK_BY_ID.milkshake.price);
});

test('adım kuralları: tekrar malzeme, en fazla 3 malzeme, çalkalama koşulları, boş el', () => {
  const { at, act, step } = setup();
  at(BAR.dispensers.lemon);
  assert.match(act({ act: 'pour', ing: 'lemon' }).error, /bardak al/);
  at(BAR.shaker);
  assert.match(act({ act: 'shake' }).error, /bardak al/);
  at(BAR.glassRack); step({ act: 'take' });
  assert.match(act({ act: 'take' }).error, /zaten bir bardak/);
  at(BAR.shaker);
  assert.match(act({ act: 'shake' }).error, /malzeme koy/);
  at(BAR.dispensers.lemon); step({ act: 'pour', ing: 'lemon' });
  assert.match(act({ act: 'pour', ing: 'lemon' }).error, /zaten koydun/);
  at(BAR.dispensers.strawberry); step({ act: 'pour', ing: 'strawberry' });
  at(BAR.dispensers.soda); step({ act: 'pour', ing: 'soda' });
  at(BAR.dispensers.milk);
  assert.match(act({ act: 'pour', ing: 'milk' }).error, /en fazla 3/);
  at(BAR.shaker); step({ act: 'shake' });
  assert.match(act({ act: 'shake' }).error, /zaten çalkaladın/);
  at(BAR.sink);
  step({ act: 'wash' });
  assert.match(act({ act: 'wash' }).error, /Yıkanacak/);
});

test('meşguliyet: önceki adım bitmeden yenisi reddedilir, NET_SLACK_MS toleransı', () => {
  const { at, act, tick } = setup();
  at(BAR.glassRack);
  const r = act({ act: 'take' });
  assert.equal(r.ok, true);
  at(BAR.dispensers.lemon);
  assert.equal(act({ act: 'pour', ing: 'lemon' }).error, 'Önce elindeki işi bitir.');
  tick(T.take - BAR_RULES.NET_SLACK_MS - 1);
  assert.equal(act({ act: 'pour', ing: 'lemon' }).ok, false, 'tolerans sınırının hemen öncesi');
  tick(1);
  const r2 = act({ act: 'pour', ing: 'lemon' });
  assert.equal(r2.ok, true, 'ağ titremesi toleransı içinde kabul');
  assert.equal(r2.busyUntil - r.busyUntil, T.pour - BAR_RULES.NET_SLACK_MS);
});

test('yiyecek: satın al (kasa, misafir sayılmaz), ısırık zamanlaması, bar dışında yeme, bitiş', () => {
  const { sim, p, at, act, tick, events } = setup();
  const brownie = FOOD_BY_ID.brownie;
  at(BAR.food.brownie);
  p.wallet = NaN;
  assert.match(act({ act: 'buy', food: 'brownie' }).error, /gerekli/, 'NaN cüzdan güvenli');
  p.wallet = 1;
  assert.match(act({ act: 'buy', food: 'brownie' }).error, /gerekli/);
  assert.equal(p.wallet, 1);
  p.wallet = 10;

  let r = act({ act: 'buy', food: 'brownie' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.hold, { kind: 'food', food: 'brownie', bitesLeft: brownie.bites });
  assert.equal(p.wallet, 10 - brownie.price);
  assert.equal(sim.money, brownie.price);
  assert.equal(sim.today.guests, 0);
  assert.equal(sim.today.served, 0, 'yiyecek içecek sayılmaz');
  assert.equal(events(EVT.PLAYER_BAR).pop().hold, 'brownie');
  assert.equal(sim.publicPlayer(p).bar.hold, 'brownie');
  assert.equal(act({ act: 'bite' }).ok, false, 'satın alma animasyonu sürerken ısırılmaz');
  tick(T.buy);
  assert.equal(act({ act: 'buy', food: 'stroopwafel' }).error, 'Ellerin dolu.');
  at(BAR.glassRack);
  assert.equal(act({ act: 'take' }).error, 'Ellerin dolu.');

  // Bar dışında da yenir
  sim.movePlayer(p.id, 0, 5, 0);
  r = act({ act: 'bite' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.bitesLeft, brownie.bites - 1);
  assert.equal(r.busyUntil, sim.now() + T.bite);
  assert.equal(events(EVT.PLAYER_BAR).pop().act, 'bite');
  assert.equal(act({ act: 'bite' }).ok, false, 'ısırık 2 sn sürer');
  // Meşguliyet sıfırlansa bile ısırık zamanlayıcısı ayrıca korunur
  p.bar.busyUntil = 0;
  assert.equal(act({ act: 'bite' }).error, 'Önce ağzındakini bitir.');
  tick(T.bite - BAR_RULES.NET_SLACK_MS);
  for (let left = brownie.bites - 2; left >= 0; left--) {
    r = act({ act: 'bite' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.bitesLeft, left);
    tick(T.bite);
  }
  assert.equal(r.hold, null, 'son ısırıkta el boşalır');
  assert.equal(p.bar.hold, null);
  assert.equal(act({ act: 'bite' }).error, 'Elinde yiyecek yok.');
  assert.match(act({ act: 'buy', food: 'brownie' }).error, /barda olmalısın/, 'satın alma barda');
});

test('içip gidince kirli bardak kalır → topla → yıka → rafa döner; çıkış yürüyüşü bitince GUEST_REMOVE', () => {
  const { bar, p, at, step, tick, seatCustomer, serveLemonade, events, lastBar, glasses, getNow } = setup();
  const c = seatCustomer('lemonade');
  const i = c.stool;
  serveLemonade(i);
  assert.equal(bar.stools[i].glass, 'full');
  const drinkEnds = bar.stools[i].drinkEndsAt;
  tick(drinkEnds - getNow() - 1);
  assert.equal(c.phase, 'barSeat', 'içmeyi bitirmeden kalkmaz');
  tick(1);
  assert.equal(c.phase, 'barOut');
  const up = events(EVT.GUEST_UPSERT).filter((g) => g.id === c.id).pop();
  assert.equal(up.phase, 'barOut');
  assert.equal(up.sit, false);
  assert.deepEqual(up.path[0], BAR.stools[i].seat);
  assert.ok([POINTS.streetWest[0], POINTS.streetEast[0]].includes(up.path.at(-1)[0]), 'sokağa çıkar');
  const s = lastBar().stools[i];
  assert.deepEqual(
    { state: s.state, customer: s.customer, order: s.order, glass: s.glass, drink: s.drink },
    { state: 'empty', customer: null, order: null, glass: 'dirty', drink: null },
  );
  glasses();

  tick(c.phaseEndsAt - getNow() - 1);
  assert.ok(bar.customers.has(c.id));
  tick(1);
  assert.equal(bar.customers.size, 0);
  assert.ok(events(EVT.GUEST_REMOVE).includes(c.id));

  at(BAR.stools[i].spot);
  let r = step({ act: 'collect', stool: i });
  assert.deepEqual(r.hold, { kind: 'dirty', count: 1 });
  assert.equal(lastBar().stools[i].glass, null);
  assert.equal(events(EVT.PLAYER_BAR).pop().hold, 'dirty');
  assert.equal(bar.rack, BAR_RULES.GLASSES - 1);
  at(BAR.sink);
  r = step({ act: 'wash' });
  assert.equal(r.hold, null);
  assert.equal(bar.rack, BAR_RULES.GLASSES);
  assert.equal(lastBar().rack, BAR_RULES.GLASSES);
  assert.equal(p.bar.act, 'wash');
});

test('kirli bardaklı tabureye müşteri oturmaz; en fazla 3 kirli bardak taşınır', () => {
  const { bar, p, at, act, step, tick, spawnCustomer, glasses, getNow } = setup();
  for (const i of [0, 1, 2]) bar.stools[i].glass = 'dirty';
  bar.rack -= 3;
  glasses();
  const c = spawnCustomer();
  assert.equal(c.stool, 3, 'yalnızca temiz tabureye oturur');
  bar.nextSpawnAt = getNow();
  tick(1);
  assert.equal(bar.customers.size, 1, 'boş ve temiz tabure yoksa müşteri gelmez');
  assert.ok(bar.nextSpawnAt > getNow() && bar.nextSpawnAt < Infinity, 'daha sonra tekrar dener');
  bar.nextSpawnAt = Infinity;

  at(BAR.stools[3].spot);
  assert.match(act({ act: 'collect', stool: 3 }).error, /kirli bardak yok/);
  at(BAR.glassRack); step({ act: 'take' });
  at(BAR.stools[0].spot);
  assert.equal(act({ act: 'collect', stool: 0 }).error, 'Ellerin dolu.');
  at(BAR.sink); step({ act: 'wash' });

  // Dördüncü kirli bardak: müşteri yokken 3 numaralı tabureye de kirli bardak koy
  tick(c.phaseEndsAt - getNow());
  bar.stools[3].order = 'lemonade';
  bar.stools[3].waitUntil = getNow(); // sabrı bitsin
  tick(1);
  bar.stools[3].glass = 'dirty';
  bar.rack -= 1;
  glasses();
  for (const i of [0, 1, 2]) {
    at(BAR.stools[i].spot);
    assert.equal(step({ act: 'collect', stool: i }).hold.count, i + 1);
  }
  at(BAR.stools[3].spot);
  assert.match(act({ act: 'collect', stool: 3 }).error, /en fazla 3/);
  at(BAR.sink); step({ act: 'wash' });
  assert.equal(bar.rack, BAR_RULES.GLASSES - 1);
  at(BAR.stools[3].spot); step({ act: 'collect', stool: 3 });
  at(BAR.sink); step({ act: 'wash' });
  assert.equal(bar.rack, BAR_RULES.GLASSES);
  assert.equal(p.bar.hold, null);
});

test('sabrı biten müşteri servis edilmeden gider (waiting → empty)', () => {
  const { bar, at, act, step, tick, seatCustomer, lastBar, getNow } = setup();
  const c = seatCustomer('lemonade');
  const i = c.stool;
  tick(bar.stools[i].waitUntil - getNow() - 1);
  assert.equal(lastBar().stools[i].state, 'waiting');
  tick(1);
  assert.equal(c.phase, 'barOut');
  const s = lastBar().stools[i];
  assert.equal(s.state, 'empty');
  assert.equal(s.glass, null, 'servis edilmediyse bardak kalmaz');
  assert.equal(s.waitUntil, 0);

  at(BAR.glassRack); step({ act: 'take' });
  at(BAR.dispensers.lemon); step({ act: 'pour', ing: 'lemon' });
  at(BAR.stools[i].spot);
  assert.match(act({ act: 'serve', stool: i }).error, /sipariş bekleyen yok/);
});

test('shiftTime: duraklatma süresi müşteri, sabır, içme ve doğma zamanlarına eklenir', () => {
  const { sim, bar, tick, seatCustomer, serveLemonade, spawnCustomer, getNow, setNow } = setup();
  const waiting = seatCustomer('lemonade');
  const drinking = seatCustomer('lemonade');
  serveLemonade(drinking.stool);
  const walking = spawnCustomer();
  const sw = bar.stools[waiting.stool];
  const sd = bar.stools[drinking.stool];
  bar.nextSpawnAt = getNow() + 5000;
  const before = {
    waitUntil: sw.waitUntil, drinkEndsAt: sd.drinkEndsAt, t0: walking.t0, ends: walking.phaseEndsAt,
    seatT0: waiting.t0, spawn: bar.nextSpawnAt,
  };

  // Gerçek start/stop kancası: son oyuncu çıkınca duraklar, biri gelince kaydırır
  const PAUSE = 600_000;
  sim.pausedAt = getNow();
  setNow(getNow() + PAUSE);
  HotelSimulation.prototype.start.call(sim);
  HotelSimulation.prototype.stop.call(sim);
  assert.equal(sw.waitUntil, before.waitUntil + PAUSE);
  assert.equal(sd.drinkEndsAt, before.drinkEndsAt + PAUSE);
  assert.equal(walking.t0, before.t0 + PAUSE);
  assert.equal(walking.phaseEndsAt, before.ends + PAUSE);
  assert.equal(waiting.t0, before.seatT0 + PAUSE);
  assert.equal(bar.nextSpawnAt, before.spawn + PAUSE);

  bar.nextSpawnAt = Infinity;
  sim.lastTick = getNow();
  tick(100);
  assert.equal(sw.state, 'waiting', 'duraklama sabrı tüketmez');
  assert.equal(sd.state, 'drinking');
  assert.equal(walking.phase, 'barIn');
});

test('oyuncu ayrılınca elindeki bardaklar rafa döner (toplam GLASSES korunur)', () => {
  const { sim, p, bar, at, step, glasses, lastBar } = setup();
  at(BAR.glassRack); step({ act: 'take' });
  assert.equal(bar.rack, BAR_RULES.GLASSES - 1);

  const q = sim.addPlayer('İkinci');
  for (const i of [0, 1]) bar.stools[i].glass = 'dirty';
  bar.rack -= 2;
  glasses();
  sim.movePlayer(q.id, ...BAR.stools[0].spot, 0); step({ act: 'collect', stool: 0 }, q);
  sim.movePlayer(q.id, ...BAR.stools[1].spot, 0); step({ act: 'collect', stool: 1 }, q);
  assert.equal(q.bar.hold.count, 2);
  assert.equal(bar.rack, BAR_RULES.GLASSES - 3);

  sim.removePlayer(q.id);
  assert.equal(bar.rack, BAR_RULES.GLASSES - 1);
  assert.equal(lastBar().rack, BAR_RULES.GLASSES - 1);
  glasses();
  sim.removePlayer(p.id);
  assert.equal(bar.rack, BAR_RULES.GLASSES);
  assert.equal(sim.players.size, 0);
  glasses();

  // Yiyecek bardak sayılmaz
  const r = sim.addPlayer('Üçüncü');
  r.wallet = 10;
  sim.movePlayer(r.id, ...BAR.food.stroopwafel, 0);
  step({ act: 'buy', food: 'stroopwafel' }, r);
  sim.removePlayer(r.id);
  assert.equal(bar.rack, BAR_RULES.GLASSES);
});

test('mesafe ve konum: lobiden ya da istasyondan uzaktan yapılamaz', () => {
  const { sim, p, bar, at, act, step, seatCustomer } = setup();
  const c = seatCustomer('lemonade');
  sim.movePlayer(p.id, 0, 5, 0); // lobi
  assert.match(act({ act: 'take' }).error, /barda olmalısın/);
  sim.movePlayer(p.id, 7.9, 9.9, 0); // kapının lobi tarafı (0.3 m tolerans içinde) ama raftan uzak
  assert.equal(act({ act: 'take' }).error, 'Bardak rafına yaklaş.');
  sim.movePlayer(p.id, 15.5, 9, 0); // barın güneydoğu köşesi
  assert.equal(act({ act: 'take' }).error, 'Bardak rafına yaklaş.');
  assert.equal(bar.rack, BAR_RULES.GLASSES);
  at(BAR.glassRack); step({ act: 'take' });
  sim.movePlayer(p.id, 15.5, 9, 0);
  assert.match(act({ act: 'pour', ing: 'lemon' }).error, /dispenser/);
  at(BAR.dispensers.lemon); step({ act: 'pour', ing: 'lemon' });
  at(BAR.dispensers.soda); step({ act: 'pour', ing: 'soda' });
  sim.movePlayer(p.id, 15.5, 9, 0);
  assert.match(act({ act: 'shake' }).error, /Çalkalayıcıya/);
  sim.movePlayer(p.id, 8.6, 13.5, 0); // barın kuzeybatı köşesi
  assert.match(act({ act: 'serve', stool: 3 }).error, /önüne yaklaş/);
  sim.movePlayer(p.id, 9.0, 9.0, 0);
  assert.match(act({ act: 'wash' }).error, /Lavaboya/);
  assert.equal(p.bar.hold.pours.length, 2, 'reddedilen adımlar eli değiştirmez');
  assert.equal(bar.stools[c.stool].state, 'waiting');
  at(BAR.sink); step({ act: 'wash' });
  sim.movePlayer(p.id, 9.0, 9.0, 0);
  assert.match(act({ act: 'buy', food: 'brownie' }).error, /Vitrine/);
  sim.movePlayer(p.id, BAR.stools[0].spot[0], BAR.stools[0].spot[1] - 3, 0); // tezgâhın güneyinde ama uzak
  assert.equal(act({ act: 'collect', stool: 0 }).error, 'Burada toplanacak kirli bardak yok.');
  bar.stools[0].glass = 'dirty';
  bar.rack -= 1;
  assert.equal(act({ act: 'collect', stool: 0 }).error, 'Bardağa yaklaş.');
});

test('bozuk girdiler (prototip anahtarları, {toString:1}, yanlış tipler) çökertmez', () => {
  const { sim, p, bar, at, act, step, seatCustomer, glasses } = setup();
  seatCustomer('lemonade');
  const weird = { toString: 1 };
  const bad = [
    undefined, null, 'take', 42, [], { act: ['take'] }, { act: weird },
    ...['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', ''].map((a) => ({ act: a })),
  ];
  for (const d of bad) assert.equal(act(d).ok, false, JSON.stringify(d));
  at(BAR.glassRack); step({ act: 'take' });
  at(BAR.dispensers.lemon);
  for (const ing of ['constructor', '__proto__', 'toString', weird, ['lemon'], 1]) {
    assert.equal(act({ act: 'pour', ing }).ok, false);
  }
  step({ act: 'pour', ing: 'lemon' });
  at(BAR.stools[1].spot);
  for (const stool of ['1', 1.5, weird, -1, 4, NaN, Infinity, null, [1], true]) {
    assert.equal(act({ act: 'serve', stool }).error, 'Geçersiz tabure.');
    assert.equal(act({ act: 'collect', stool }).error, 'Geçersiz tabure.');
  }
  at(BAR.sink); step({ act: 'wash' });
  at(BAR.food.brownie);
  for (const food of ['constructor', '__proto__', 'toString', weird, ['brownie']]) {
    assert.equal(act({ act: 'buy', food }).ok, false);
  }
  assert.equal(p.wallet, START_WALLET);
  assert.equal(sim.money, 0);
  assert.equal(bar.rack, BAR_RULES.GLASSES);
  glasses();
  assert.equal(sim.barAct(999, { act: 'take' }).ok, false, 'olmayan oyuncu');
  assert.equal(INGREDIENT_BY_ID.constructor, undefined);
});

test('anlık görüntü: snapshot.bar ve self.bar var, başkalarının cüzdanı yok', () => {
  const { sim, p } = setup();
  const q = sim.addPlayer('Diğer');
  const snap = sim.snapshot(p.id);
  assert.equal(snap.bar.open, true);
  assert.equal(snap.bar.rack, BAR_RULES.GLASSES);
  assert.equal(snap.bar.stools.length, BAR.stools.length);
  assert.deepEqual(Object.keys(snap.bar.stools[0]).sort(),
    ['customer', 'drink', 'glass', 'name', 'order', 'patienceMs', 'state', 'waitUntil']);
  assert.deepEqual(snap.bar.stools[0], {
    state: 'empty', customer: null, name: null, order: null, waitUntil: 0,
    patienceMs: BAR_RULES.PATIENCE_MS, glass: null, drink: null,
  });
  assert.deepEqual(snap.self.bar, { hold: null, busyUntil: 0 });
  for (const pl of snap.players) {
    assert.equal(pl.wallet, undefined, 'cüzdan paylaşılmaz');
    assert.equal(pl.inventory, undefined);
    assert.deepEqual(pl.bar, { hold: null, color: null, act: null, until: 0 });
  }
  assert.ok(snap.players.some((pl) => pl.id === q.id));
});

test('bar kapalıyken (10:00 öncesi) müşteri gelmez; açılınca duyurulur ve müşteriler gelir', () => {
  const { sim, bar, tick, events } = setup({ hour: 9, dayLengthSec: 240, spawning: true });
  assert.equal(bar.serialize().open, false);
  // 09:00 → 09:56 (1 gerçek sn = 4 oyun dk)
  for (let i = 0; i < 140; i++) tick(100);
  assert.ok(sim.clock.minute < BAR_RULES.OPEN_MIN);
  assert.equal(bar.customers.size, 0);
  assert.equal(bar.nextSpawnAt, null);
  assert.equal(events(EVT.BAR_STATE).length, 0);
  for (let i = 0; i < 20; i++) tick(100);
  assert.ok(sim.clock.minute >= BAR_RULES.OPEN_MIN);
  const st = events(EVT.BAR_STATE).pop();
  assert.equal(st.open, true);
  assert.ok(events(EVT.NOTIFY).some((n) => /Bar De Tulp açıldı/.test(n.text)));
  for (let i = 0; i < 110 && !bar.customers.size; i++) tick(100);
  assert.equal(bar.customers.size, 1, 'açıldıktan kısa süre sonra ilk müşteri gelir');
  assert.equal(events(EVT.BAR_STATE).pop().stools.filter((s) => s.state === 'coming').length, 1);
});

test('bar kapanınca bekleyen müşteri gider; gün sonu özetinde içecek sayısı', () => {
  const { sim, bar, tick, seatCustomer, lastBar, events } = setup({ hour: 22, dayLengthSec: 240 });
  const c = seatCustomer('lemonade');
  const i = c.stool;
  sim.today.served = 3;
  sim.clock.minute = BAR_RULES.CLOSE_MIN - 0.5;
  tick(200); // 23:00'ı geçer → ertesi gün 07:00, bar kapalı
  assert.equal(sim.clock.minute, 7 * 60);
  assert.equal(c.phase, 'barOut');
  assert.equal(lastBar().open, false);
  assert.equal(lastBar().stools[i].state, 'empty');
  const day = events(EVT.NOTIFY).find((n) => n.kind === 'day');
  assert.match(day.text, /· 3 içecek/);
  assert.equal(sim.today.served, 0);
  assert.equal(bar.nextSpawnAt, null);
});

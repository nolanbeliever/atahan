import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { GARAGE, DRAG, pointInBounds } from '../shared/layout.js';
import {
  CAR_MODELS, CAR_BY_ID, CAR_BODIES, CAR_RULES, GARAGE_LAYOUT, CAR_XFERS, CAR_XFER_BY_ID, STREET_RAMP, carZone, carSpeedCap,
  carPhysics, carAccel, carPassengerSeat, idealRun, DRAG_TRACK,
} from '../shared/cars.js';

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
  let now = 5_000_000;
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
  return { sim, out, to, events, advance: (ms) => { now += ms; }, now: () => now };
}

const buy = (sim, p, model = 'kade-vier', source = 'wallet', color = 0) => sim.carAct(p.id, { act: 'buy', model, color, source });
const carsOf = (sim, p) => [...sim.vehicles.vehicles.values()].filter((v) => v.type === 'car' && v.ownerId === p.id);

/** Arabayla (x, z)'ye 25 km/s ile sür (sunucunun hız denetimine takılmadan) */
function driveTo(s, p, x, z) {
  for (let i = 0; i < 200 && Math.hypot(x - p.x, z - p.z) > 0.01; i++) {
    s.advance(1000);
    const dx = x - p.x;
    const dz = z - p.z;
    const k = Math.min(1, 7 / Math.hypot(dx, dz));
    s.sim.movePlayer(p.id, p.x + dx * k, p.z + dz * k, Math.atan2(-dx, -dz));
  }
  assert.ok(Math.hypot(x - p.x, z - p.z) < 0.05, `varılamadı: ${p.x},${p.z}`);
}

/** Arabaya bin (yanına yürüyüp) */
function mountCar(sim, p, v) {
  sim.movePlayer(p.id, v.x + 1.2, v.z, 0);
  const r = sim.vehicleAct(p.id, { act: 'mount', id: v.id });
  assert.ok(r.ok, r.error);
  return r;
}

test('katalog: ~10 kurgusal model, gerçekçi € fiyatları, tutarlı istatistikler', () => {
  assert.ok(CAR_MODELS.length >= 10);
  const ids = new Set();
  for (const m of CAR_MODELS) {
    assert.ok(!ids.has(m.id), m.id);
    ids.add(m.id);
    assert.ok(CAR_BODIES[m.body], `${m.id} kasa`);
    assert.ok(Number.isInteger(m.price) && m.price >= 10_000 && m.price <= 400_000, `${m.id} fiyat`);
    assert.ok(m.topKmh >= 100 && m.topKmh <= 360, `${m.id} hız`);
    assert.ok(m.t100 >= 2.5 && m.t100 <= 25, `${m.id} 0-100`);
    assert.ok(m.colors.length >= 4 && m.colors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex) && c.name));
    assert.ok(m.name.startsWith(m.brand) && m.desc.length > 20);
    // Fizik modeli katalogdaki 0–100 süresini tutar (±0.1 sn)
    const run = idealRun(m);
    assert.ok(Math.abs(run.t100 - m.t100) <= 0.1, `${m.id} t100 ${run.t100}`);
    assert.ok(run.et > 8 && run.et < 25 && run.trap < m.topKmh, `${m.id} ET ${run.et} trap ${run.trap}`);
    assert.ok(carAccel(m, 0) > carAccel(m, carPhysics(m).vmax * 0.8));
  }
  // Fiyat sınıfları: mikro < şehir < kompakt < … < süper araba
  const price = (id) => CAR_BY_ID[id].price;
  assert.equal(price('polder-p6'), 12_000);
  assert.equal(price('lindeman-stip'), 18_000);
  assert.equal(price('kade-vier'), 28_000);
  assert.equal(price('vonk-estad'), 36_000);
  assert.equal(price('duin-terra'), 48_000);
  assert.equal(price('graaf-regent'), 62_000);
  assert.equal(price('vonk-bliksem'), 58_000);
  assert.equal(price('storm-390'), 95_000);
  assert.equal(price('graaf-imperator'), 185_000);
  assert.equal(price('valk-tempesta'), 280_000);
  // Daha pahalı spor modeller daha hızlı koşar
  assert.ok(idealRun(CAR_BY_ID['valk-tempesta']).et < idealRun(CAR_BY_ID['storm-390']).et);
  assert.ok(idealRun(CAR_BY_ID['storm-390']).et < idealRun(CAR_BY_ID['lindeman-stip']).et);
  // Prototipsiz tablo
  assert.equal(CAR_BY_ID.__proto__, undefined);
  assert.equal(CAR_BY_ID.toString, undefined);
});

test('yerleşim: park yerleri, geçitler ve varış noktaları doğru bölgelerde', () => {
  assert.ok(GARAGE_LAYOUT.bays.length >= 30);
  const labels = new Set();
  for (const b of GARAGE_LAYOUT.bays) {
    assert.ok(pointInBounds(b.x, b.z, GARAGE.bounds), b.label);
    assert.equal(carZone(b.x, b.z), 'garage');
    assert.ok(!labels.has(b.label));
    labels.add(b.label);
  }
  // Park yerleri birbirinin üstüne binmez
  const bays = GARAGE_LAYOUT.bays;
  for (let i = 0; i < bays.length; i++) for (let j = i + 1; j < bays.length; j++) assert.ok(Math.hypot(bays[i].x - bays[j].x, bays[i].z - bays[j].z) >= 2.5);
  const areaOf = (x, z) => (pointInBounds(x, z, GARAGE.bounds) ? 'garage' : pointInBounds(x, z, DRAG.bounds) ? 'drag' : carZone(x, z) === 'street' ? 'street' : carZone(x, z) === 'highway' ? 'highway' : 'city');
  for (const t of CAR_XFERS) {
    // Varış noktası hedef bölgede ve HİÇBİR tetik alanının içinde değil (geri sekme yok)
    assert.equal(areaOf(t.to.x, t.to.z), t.area, t.id);
    for (const u of CAR_XFERS) assert.ok(!pointInBounds(t.to.x, t.to.z, u.zone), `${t.id} → ${u.id}`);
  }
  // Sokak rampası ağzı sokakta, otel kapısının önünü kapatmaz
  assert.equal(carZone((STREET_RAMP.minX + STREET_RAMP.maxX) / 2, (STREET_RAMP.minZ + STREET_RAMP.maxZ) / 2), 'street');
  assert.ok(STREET_RAMP.maxX < -1.4 && STREET_RAMP.maxZ < -2.2);
  // Hız sınırı: sokak / garaj 30 km/s, pistte modelin hızı
  const m = CAR_BY_ID['valk-tempesta'];
  assert.ok(Math.abs(carSpeedCap(m, 0, -4) * 3.6 - 30) < 1e-6);
  assert.ok(Math.abs(carSpeedCap(m, 80, -5) * 3.6 - 30) < 1e-6);
  assert.equal(carSpeedCap(m, 147.5, -100), carPhysics(m).vmax);
  assert.ok(carSpeedCap(m, 147.5, DRAG_TRACK.stopZ + 1) < 12, 'paraşüt: pist sonunda yavaş');
  // Steeg / Achterstraat / lobi araba bölgesi değil
  assert.equal(carZone(17, 10), null);
  assert.equal(carZone(0, 30), null);
  assert.equal(carZone(0, 5), null);
  const s = carPassengerSeat(0, 0, 0, 'sedan');
  assert.ok(s.x > 0.3, 'yolcu sağda (yaw 0 → sağ = +X)');
});

test('satın alma: cüzdan / kasa, yetersiz bakiye, hatalı girdiler, en fazla 6 araba', () => {
  const { sim, events } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  sim.money = 100_000;
  const w = a.wallet;
  const r = buy(sim, a, 'kade-vier', 'wallet', 2);
  assert.ok(r.ok, r.error);
  assert.equal(a.wallet, w - 28_000);
  assert.equal(r.bay, 'P-01');
  const v = sim.vehicles.vehicles.get(r.id);
  assert.equal(v.type, 'car');
  assert.equal(v.model, 'kade-vier');
  assert.equal(v.color, 2);
  assert.equal(carZone(v.x, v.z), 'garage');
  const list = events(EVT.VEHICLES).at(-1);
  assert.deepEqual(list.find((x) => x.id === r.id), { id: r.id, type: 'car', ownerId: a.id, ownerName: 'Ali', x: v.x, z: v.z, yaw: v.yaw, driver: null, passenger: null, model: 'kade-vier', color: 2 });
  // Kasadan
  const r2 = buy(sim, a, 'graaf-regent', 'kasa', 1);
  assert.ok(r2.ok, r2.error);
  assert.equal(sim.money, 100_000 - 62_000);
  assert.equal(r2.bay, 'P-02');
  const eco = events(EVT.ECONOMY).at(-1);
  assert.equal(eco.delta, -62_000);
  // Yetersiz
  assert.match(buy(sim, a, 'graaf-imperator', 'kasa').error, /kasasında/);
  a.wallet = 10;
  assert.match(buy(sim, a, 'polder-p6', 'wallet').error, /Cüzdanında/);
  assert.equal(a.wallet, 10);
  // Hatalı girdiler: prototip anahtarları, { toString }, NaN, kesirli renk, bilinmeyen kaynak
  a.wallet = 1e6;
  const bad = [
    null, {}, { act: 'buy' }, { act: 'buy', model: '__proto__', color: 0, source: 'wallet' },
    { act: 'buy', model: 'toString', color: 0, source: 'wallet' }, { act: 'buy', model: { toString: () => 'kade-vier' }, color: 0, source: 'wallet' },
    { act: 'buy', model: 'kade-vier', color: NaN, source: 'wallet' }, { act: 'buy', model: 'kade-vier', color: 1.5, source: 'wallet' },
    { act: 'buy', model: 'kade-vier', color: '1', source: 'wallet' }, { act: 'buy', model: 'kade-vier', color: 99, source: 'wallet' },
    { act: 'buy', model: 'kade-vier', color: -1, source: 'wallet' }, { act: 'buy', model: 'kade-vier', color: 0, source: 'bank' },
    { act: 'buy', model: 'kade-vier', color: 0, source: { toString: () => 'wallet' } }, { act: 'buy', model: 'kade-vier', color: 0, source: '__proto__' },
    { act: 'fly' }, { act: { toString: () => 'buy' } }, { act: 'xfer', id: '__proto__' }, { act: 'xfer', id: { toString: () => 'lobby' } },
  ];
  for (const b of bad) assert.equal(sim.carAct(a.id, b).ok, false, JSON.stringify(b));
  assert.equal(a.wallet, 1e6);
  assert.equal(carsOf(sim, a).length, 2);
  // En fazla 6
  for (let i = 0; i < 4; i++) assert.ok(buy(sim, a, 'polder-p6', 'wallet', i % 5).ok);
  assert.equal(carsOf(sim, a).length, CAR_RULES.MAX_PER_PLAYER);
  const w6 = a.wallet;
  assert.match(buy(sim, a, 'polder-p6').error, /En fazla 6/);
  assert.equal(a.wallet, w6);
  // Her araba ayrı bir park yerinde
  const spots = carsOf(sim, a).map((c) => `${c.x},${c.z}`);
  assert.equal(new Set(spots).size, spots.length);
});

test('garaj dolunca araba otelin önüne teslim edilir', () => {
  const { sim } = setup();
  const players = Array.from({ length: 7 }, (_, i) => sim.addPlayer(`P${i}`, String(i + 1).repeat(32)));
  let last = null;
  for (const p of players) for (let i = 0; i < 5; i++) last = buy(sim, p, 'polder-p6');
  assert.ok(last.ok, last.error);
  assert.equal(last.bay, null);
  assert.equal(carZone(last.x, last.z), 'street');
});

test('kalıcılık: arabalar anahtara bağlı kaydedilir, yeniden bağlanınca son yerinde; bozuk kayıtlar atılır', () => {
  const store = memoryStore();
  const s1 = setup({ store });
  const a = s1.sim.addPlayer('Ali', KEY_A);
  const r = buy(s1.sim, a, 'storm-390', 'wallet', 3);
  assert.ok(r.ok, r.error);
  const v = s1.sim.vehicles.vehicles.get(r.id);
  // Sürüp sokakta park eder (rampa ile)
  mountCar(s1.sim, a, v);
  driveTo(s1, a, 80, -4);
  driveTo(s1, a, 91, 7);
  const xo = s1.sim.carAct(a.id, { act: 'xfer', id: 'garageOut' });
  assert.ok(xo.ok, xo.error);
  s1.advance(2000);
  driveTo(s1, a, 6, -4.3);
  const d = s1.sim.vehicleAct(a.id, { act: 'dismount' });
  assert.ok(d.ok, d.error);
  assert.equal(carZone(d.x, d.z), 'street', 'sürücü kapının yanında iner');
  s1.sim.removePlayer(a.id);
  s1.sim.house.flush();
  const saved = store.data.hotel.garage.cars;
  const hash = Object.keys(saved)[0];
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(saved[hash].map((c) => [c.m, c.c, c.x, c.z]), [['storm-390', 3, 6, -4.3]]);
  // Yeniden açılış: aynı anahtarla aynı yerde
  const s2 = setup({ store: memoryStore(JSON.parse(JSON.stringify(store.data))) });
  const a2 = s2.sim.addPlayer('Ali', KEY_A);
  const cars = carsOf(s2.sim, a2);
  assert.equal(cars.length, 1);
  assert.deepEqual([cars[0].model, cars[0].color, cars[0].x, cars[0].z], ['storm-390', 3, 6, -4.3]);
  const b2 = s2.sim.addPlayer('Bea', KEY_B);
  assert.equal(carsOf(s2.sim, b2).length, 0);
  // Bozuk kayıt
  const data = JSON.parse(JSON.stringify(store.data));
  data.hotel.garage.cars = {
    [hash]: [
      { id: 'k1', m: 'storm-390', c: 3, x: 0, z: 5, yaw: 0 }, // lobi: araba bölgesi değil → park yeri
      { id: 'k1', m: 'kade-vier', c: 0, x: 80, z: -5, yaw: 1 }, // yinelenen kimlik → yeni kimlik
      { m: '__proto__', c: 0 }, { m: 'kade-vier', c: 99 }, { m: 'kade-vier', c: '1' }, { m: { toString: 1 }, c: 0 }, null, 'x', [1],
      ...Array.from({ length: 9 }, () => ({ m: 'polder-p6', c: 0, x: NaN, z: 1 })),
    ],
    ['z'.repeat(64)]: [{ m: 'kade-vier', c: 0 }],
    __proto__: [{ m: 'kade-vier', c: 0 }],
  };
  const s3 = setup({ store: memoryStore(data) });
  const a3 = s3.sim.addPlayer('Ali', KEY_A);
  const c3 = carsOf(s3.sim, a3);
  assert.equal(c3.length, CAR_RULES.MAX_PER_PLAYER);
  assert.equal(c3[0].model, 'storm-390');
  assert.equal(carZone(c3[0].x, c3[0].z), 'garage', 'geçersiz konum → park yeri');
  assert.notEqual(c3[1].rec.id, c3[0].rec.id);
  assert.equal(s3.sim.garage.saved.size, 1);
  // Tümüyle bozuk veri çökertmez
  for (const junk of [null, 5, 'x', [], { cars: [] }, { cars: 'x' }, { cars: { [hash]: 'x' } }]) {
    const s = setup({ store: memoryStore({ hotel: { garage: junk } }) });
    assert.equal(s.sim.garage.saved.size, 0);
  }
});

test('geçitler: sokak rampası ↔ garaj ↔ drag pisti, araba ve yolcuyla; asansör yalnızca yürüyerek', () => {
  const S = setup();
  const { sim, to } = S;
  sim.advance = S.advance;
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  // Yürüyerek sokaktan garaja
  sim.movePlayer(a.id, -6, -4, 0);
  const r1 = sim.carAct(a.id, { act: 'xfer', id: 'streetIn' });
  assert.ok(r1.ok, r1.error);
  assert.ok(pointInBounds(a.x, a.z, GARAGE.bounds));
  assert.equal(r1.car, false);
  // Uzaktan geçilmez
  sim.advance(2000);
  assert.match(sim.carAct(a.id, { act: 'xfer', id: 'toDrag' }).error, /yaklaş/);
  // Arabayla drag pistine, yolcuyla birlikte
  const { id } = buy(sim, a, 'storm-390');
  const v = sim.vehicles.vehicles.get(id);
  sim.movePlayer(b.id, v.x - 1.2, v.z, 0);
  assert.equal(sim.vehicleAct(b.id, { act: 'mount', id }).seat, 'passenger');
  mountCar(sim, a, v);
  // Yolcu geçit isteyemez
  assert.match(sim.carAct(b.id, { act: 'xfer', id: 'toDrag' }).error, /Yolcu/);
  // Garajda (30 km/s) tünele sür
  driveTo(S, a, 80, -21.5);
  driveTo(S, a, 97.5, -21.5);
  assert.ok(a.x > 96.6, `tünel ağzında: ${a.x}`);
  const r2 = sim.carAct(a.id, { act: 'xfer', id: 'toDrag' });
  assert.ok(r2.ok, r2.error);
  assert.equal(r2.car, true);
  assert.ok(pointInBounds(a.x, a.z, DRAG.bounds));
  assert.deepEqual([v.x, v.z], [a.x, a.z], 'araba sürücüyle');
  assert.ok(pointInBounds(b.x, b.z, DRAG.bounds), 'yolcu da');
  assert.ok(to.some((m) => m.id === b.id && m.event === EVT.NOTIFY));
  // Işınlanmadan önceki konumdan gecikmiş paket yok sayılır
  sim.movePlayer(a.id, 97.6, -21.5, 0);
  assert.ok(pointInBounds(a.x, a.z, DRAG.bounds));
  // Geri dönüş
  sim.advance(3000);
  driveTo(S, a, 187.4, 31);
  const r3 = sim.carAct(a.id, { act: 'xfer', id: 'toGarage' });
  assert.ok(r3.ok, r3.error);
  assert.ok(pointInBounds(a.x, a.z, GARAGE.bounds) && pointInBounds(v.x, v.z, GARAGE.bounds));
  // Asansöre arabayla binilmez
  sim.advance(3000);
  driveTo(S, a, 80, -4);
  driveTo(S, a, 64, 8.8);
  assert.match(sim.carAct(a.id, { act: 'xfer', id: 'lobby' }).error, /arabayla/);
  const dm = sim.vehicleAct(a.id, { act: 'dismount' });
  assert.ok(dm.ok, dm.error);
  sim.advance(3000);
  sim.movePlayer(a.id, 64, 9.2, 0);
  const r4 = sim.carAct(a.id, { act: 'xfer', id: 'lobby' });
  assert.ok(r4.ok, r4.error);
  assert.deepEqual([a.x, a.z], [CAR_XFER_BY_ID.lobby.to.x, CAR_XFER_BY_ID.lobby.to.z]);
  // Bisikletle rampa yok
  const c = sim.addPlayer('Can', 'c'.repeat(32));
  c.wallet = 1000;
  sim.movePlayer(c.id, 14.7, -1.15, 0);
  const bike = sim.vehicleAct(c.id, { act: 'buy', type: 'bike' });
  const bv = sim.vehicles.vehicles.get(bike.id);
  sim.movePlayer(c.id, bv.x, bv.z, 0);
  assert.ok(sim.vehicleAct(c.id, { act: 'mount', id: bike.id }).ok);
  sim.movePlayer(c.id, -6, -4, 0);
  assert.match(sim.carAct(c.id, { act: 'xfer', id: 'streetIn' }).error, /Bisiklet/);
});

test('hız denetimi: araba sınırın üstünde gidemez, araba bölgesinden çıkamaz', () => {
  const { sim, advance } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  const { id } = buy(sim, a, 'valk-tempesta');
  const v = sim.vehicles.vehicles.get(id);
  mountCar(sim, a, v);
  // Garajda 30 km/s: 1 sn'de 50 m ileri → kırpılır
  advance(1000);
  const [x0, z0] = [a.x, a.z];
  sim.movePlayer(a.id, 95, -21, 0);
  const lim = (30 / 3.6) * CAR_RULES.SPEED_SLACK + CAR_RULES.SPEED_ADD;
  const moved = Math.hypot(a.x - x0, a.z - z0);
  assert.ok(moved <= lim * CAR_RULES.BURST_SEC + 0.02, `kırpıldı: ${moved}`);
  assert.ok(moved > 1, 'yine de ilerler');
  assert.deepEqual([v.x, v.z], [a.x, a.z]);
  // Sürekli hile: 20 paket × 50 m — ortalama hız sınırı aşmaz
  const [sx, sz] = [a.x, a.z];
  for (let i = 0; i < 20; i++) {
    advance(100);
    sim.movePlayer(a.id, 95, -21, 0);
  }
  const far = Math.hypot(a.x - sx, a.z - sz);
  assert.ok(far <= lim * (2 + CAR_RULES.BURST_SEC), `ortalama: ${far / 2} m/sn`);
  // Normal sürüş (25 km/s) kırpılmaz
  advance(2000);
  for (let i = 0; i < 10; i++) {
    advance(100);
    const want = a.x - 0.69;
    sim.movePlayer(a.id, want, a.z, 0);
    assert.ok(Math.abs(a.x - want) < 1e-9);
  }
  // Lobiye / Achterstraat'a / steeg'e sürülmez (yok sayılır)
  const [px, pz] = [a.x, a.z];
  for (const [x, z] of [[0, 5], [0, 30], [17, 10]]) {
    advance(60_000);
    sim.movePlayer(a.id, x, z, 0);
    assert.deepEqual([a.x, a.z], [px, pz], `${x},${z}`);
  }
  // Yaya için sınır yok (bu servis yalnızca arabayı denetler)
  const b = sim.addPlayer('Bea', KEY_B);
  sim.movePlayer(b.id, 0, 5, 0);
  sim.movePlayer(b.id, 0, 25, 0);
  assert.equal(b.z, 25);
});

test('araba: yolcu ön sağ koltukta taşınır, sürücü inince yanına iner; park yalnızca araba bölgelerinde', () => {
  const S = setup();
  const { sim, to } = S;
  sim.advance = S.advance;
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  const { id } = buy(sim, a, 'graaf-regent');
  const v = sim.vehicles.vehicles.get(id);
  sim.movePlayer(b.id, v.x - 1.5, v.z, 0);
  assert.equal(sim.vehicleAct(b.id, { act: 'mount', id }).seat, 'passenger');
  mountCar(sim, a, v);
  sim.advance(1000);
  sim.movePlayer(a.id, v.x, v.z + 5, Math.PI);
  assert.equal(a.z, -22.2);
  const seat = carPassengerSeat(a.x, a.z, a.yaw, 'sedan');
  assert.deepEqual([b.x, b.z], [Math.round(seat.x * 100) / 100, Math.round(seat.z * 100) / 100]);
  // Yolcunun kendi hareketi yok sayılır
  sim.movePlayer(b.id, 0, 0, 1);
  assert.deepEqual([b.x, b.z], [Math.round(seat.x * 100) / 100, Math.round(seat.z * 100) / 100]);
  const d = sim.vehicleAct(a.id, { act: 'dismount' });
  assert.ok(d.ok, d.error);
  assert.equal(b.vehicle, null);
  assert.ok(to.some((m) => m.id === b.id && m.event === EVT.VEHICLE_SEAT && m.payload.seat === null));
  assert.ok(Math.hypot(a.x - v.x, a.z - v.z) > 1, 'sürücü arabanın yanında');
  assert.equal(carZone(a.x, a.z), 'garage');
  assert.equal(v.driver, null);
});

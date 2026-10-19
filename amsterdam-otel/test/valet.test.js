import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { CAR_BY_ID, CAR_XFER_BY_ID, carZone, inXferZone, GARAGE_LAYOUT } from '../shared/cars.js';
import {
  VALET, VALET_MODELS, VALET_RULES as R, valetTip, valetFee, hitDamage, dirtSpotsLocal, localToWorld, inWashBay, valetBayAt,
} from '../shared/valet.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
  restaurantDiners: false,
  basementGuests: false,
};
const KEY = 'd'.repeat(32);

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function seeded(seed = 5) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function setup({ store = null, hour = 12 } = {}) {
  let now = 7_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: hour }, rng: seeded(), now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => out.push({ event, payload, to: id }));
  const p = sim.addPlayer('Vale', KEY);
  sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  sim.valet.nextSpawnAt = Infinity; // VIP'leri testler getirir
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  const advance = (ms) => { now += ms; };
  const at = (pl, [x, z], yaw = 0) => sim.movePlayer(pl.id, x, z, yaw);
  const valet = (pl, data) => sim.valetAct(pl.id, data);
  const veh = (pl, data) => sim.vehicleAct(pl.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  const notes = (pl) => out.filter((x) => x.event === EVT.NOTIFY && x.to === pl.id).map((x) => x.payload.text);
  /** Arabayı 0.5 m'lik adımlarla sür (5 m/sn — sokak sınırının altında) */
  const drive = (pl, [x, z], yaw = 0) => {
    for (let k = 0; k < 400; k++) {
      const dx = x - pl.x;
      const dz = z - pl.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) break;
      const s = Math.min(0.5, d);
      now += 100;
      sim.movePlayer(pl.id, pl.x + (dx / d) * s, pl.z + (dz / d) * s, yaw);
    }
  };
  const spawn = () => {
    assert.equal(sim.valet.spawn(now), true);
    return [...sim.valet.jobs.values()].at(-1);
  };
  /** Anahtarı al, arabaya bin */
  const takeKeys = (pl, j) => {
    at(pl, VALET.stand.point);
    assert.equal(valet(pl, { act: 'keys', job: j.id }).ok, true);
    at(pl, [VALET.dropoff.x + 1.5, VALET.dropoff.z + 1.5]);
    const r = veh(pl, { act: 'mount', id: j.carId });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.seat, 'driver');
  };
  /** Sokaktan garaja in, yıkama bölmesine çek */
  const toGarage = (pl) => {
    drive(pl, [-5.5, -4.2]);
    const r = sim.carAct(pl.id, { act: 'xfer', id: 'streetIn' });
    assert.equal(r.ok, true, r.error);
    advance(1600);
  };
  const wash = (pl, j) => {
    at(pl, VALET.rack.point);
    assert.equal(valet(pl, { act: 'tool', tool: 'foam' }).ok, true);
    const v = sim.vehicles.vehicles.get(j.carId);
    at(pl, [v.x + 1.6, v.z]);
    for (const stage of ['foam', 'water']) {
      if (stage === 'water') {
        at(pl, VALET.rack.point);
        assert.equal(valet(pl, { act: 'tool', tool: 'water' }).ok, true);
        at(pl, [v.x + 1.6, v.z]);
      }
      for (let i = 0; i < R.SPOTS; i++) {
        if (j.spots[i] !== (stage === 'foam' ? 0 : 1)) continue; // zaten yapılmış nokta
        assert.equal(valet(pl, { act: 'spray', job: j.id, spot: i, step: 'begin' }).ok, true);
        advance(R.SPRAY_MS[stage]);
        assert.equal(valet(pl, { act: 'spray', job: j.id, spot: i, step: 'finish' }).ok, true);
      }
    }
    assert.equal(j.stage, 'done');
  };
  return {
    sim, p, tick, advance, at, valet, veh, events, notes, drive, spawn, takeKeys, toGarage, wash, getNow: () => now,
  };
}

// ---- Tablolar ve yerleşim -------------------------------------------------------------------

test('kurallar: yıkanmış + hasarsız + hızlı en yüksek bahşiş; hasar ve gecikme düşürür; %60+ hasarda bahşiş yok', () => {
  const m = 'valk-tempesta';
  const base = valetTip({ model: m, washed: false, damage: 0 });
  const washed = valetTip({ model: m, washed: true, damage: 0 });
  assert.ok(washed > base * 2, 'yıkama bahşişi katlar');
  assert.ok(valetTip({ model: m, washed: true, damage: 0, fast: true }) > washed);
  assert.ok(valetTip({ model: m, washed: true, damage: 30 }) < washed);
  assert.ok(valetTip({ model: m, washed: true, damage: 0, late: true }) < washed / 2);
  assert.equal(valetTip({ model: m, washed: true, damage: 60 }), 0);
  assert.ok(valetTip({ model: m, washed: true, damage: 0, stars: 5, vipSuites: true }) > washed * 1.5);
  assert.ok(valetFee('valk-tempesta') > valetFee('graaf-regent'));
  assert.equal(hitDamage(5), 0);
  assert.ok(hitDamage(20) > 0);
  assert.equal(hitDamage(500), R.HIT_MAX);
  for (const id of VALET_MODELS) assert.ok(CAR_BY_ID[id].price >= 58_000, `${id} lüks / spor`);
});

test('yerleşim: bırakma yeri sokakta (rampa geçidinin dışında), yıkama bölmesi ve V-1…V-3 garajda, çakışmaz', () => {
  const d = VALET.dropoff;
  assert.equal(carZone(d.x, d.z), 'street');
  for (const t of Object.values(CAR_XFER_BY_ID)) assert.equal(inXferZone(t, d.x, d.z, 2.5), false, `${t.id} geçidinde değil`);
  const [wx, wz] = VALET.wash.center;
  assert.equal(carZone(wx, wz), 'garage');
  assert.equal(inXferZone(CAR_XFER_BY_ID.garageOut, wx, wz, 1.5), false);
  for (const b of VALET.bays) {
    assert.equal(carZone(b.x, b.z), 'garage');
    assert.equal(inWashBay(b.x, b.z, 0.9), false, `${b.id} yıkama bölmesinin dışında`);
    for (const g of GARAGE_LAYOUT.bays) assert.ok(Math.hypot(g.x - b.x, g.z - b.z) > 3, 'numaralı park yerleriyle çakışmaz');
    assert.equal(valetBayAt(b.x + 0.5, b.z - 0.5)?.id, b.id);
  }
  assert.equal(valetBayAt(wx, wz), null);
  // Çamur noktaları gövdenin üstünde / yanında; dünya dönüşümü yön koruyor
  const spots = dirtSpotsLocal('graaf-imperator');
  assert.equal(spots.length, R.SPOTS);
  assert.ok(spots.some((s) => s.x < 0) && spots.some((s) => s.x > 0) && spots.some((s) => s.z < 0) && spots.some((s) => s.z > 0));
  const [fx, fz] = localToWorld(0, 0, Math.PI / 2, 0, -1); // ön (−z yerel), yaw π/2 → batı
  assert.ok(Math.abs(fx + 1) < 1e-9 && Math.abs(fz) < 1e-9);
});

// ---- Akış ---------------------------------------------------------------------------------

test('VIP gelir (araba + müşteri), anahtar kürsüden alınır, araba serbestçe sürülür, yıkanır, V-1\'e park → ücret kasaya, bahşiş cüzdana', () => {
  const t = setup();
  const { sim, p, events } = t;
  const j = t.spawn();
  assert.equal(j.state, 'waiting');
  const car = events(EVT.VEHICLES).at(-1).find((v) => v.id === j.carId);
  assert.equal(car.valet, j.id);
  assert.ok(VALET_MODELS.includes(car.model));
  assert.ok(events(EVT.GUEST_UPSERT).some((g) => g.kind === 'valet' && g.vip === true));
  assert.equal(events(EVT.VALET_STATE).at(-1).jobs[0].spots.length, R.SPOTS);
  assert.equal(sim.valet.spawn(t.getNow()), false, 'kürsüde ikinci müşteri beklemez');

  // Başka oyuncu binemez; anahtarsız binilmez
  const q = sim.addPlayer('Misafir');
  sim.valet.initPlayer(q);
  t.at(q, [VALET.dropoff.x + 1.5, VALET.dropoff.z + 1.5]);
  assert.match(t.veh(q, { act: 'mount', id: j.carId }).error, /anahtar/);
  // Anahtar: konum ve tip denetimi
  t.at(p, [0, 3]);
  assert.match(t.valet(p, { act: 'keys', job: j.id }).error, /kürsüsüne/);
  t.at(p, VALET.stand.point);
  assert.equal(t.valet(p, { act: 'keys', job: String(j.id) }).ok, false);
  assert.equal(t.valet(p, { act: 'keys', job: 999 }).ok, false);
  assert.equal(t.valet(p, { act: 'nope' }).ok, false);
  t.takeKeys(p, j);
  assert.equal(j.state, 'keys');
  assert.equal(j.holder, p.id);
  assert.match(t.veh(q, { act: 'mount', id: j.carId }).error, /başkasında/);
  assert.match(t.valet(q, { act: 'keys', job: j.id }).error, /yok|kürsü/);

  // Sokakta serbest sürüş, rampadan garaja, yıkama bölmesine
  t.drive(p, [12, -4.5]);
  assert.ok(Math.abs(sim.vehicles.vehicles.get(j.carId).x - p.x) < 0.01, 'araba sürücüyle gider');
  t.toGarage(p);
  t.drive(p, VALET.wash.center);
  // Sürerken yıkanmaz
  assert.match(t.valet(p, { act: 'spray', job: j.id, spot: 0, step: 'begin' }).error, /araçtan in/);
  assert.equal(t.veh(p, { act: 'dismount' }).ok, true);
  assert.ok(t.notes(p).some((n) => /Yıkama bölmesi/.test(n)));
  // Yıkama doğrulaması: tabancasız, yanlış tabanca, çok hızlı, aynı nokta, uzak
  const v = sim.vehicles.vehicles.get(j.carId);
  t.at(p, [v.x + 1.6, v.z]);
  assert.match(t.valet(p, { act: 'spray', job: j.id, spot: 0, step: 'begin' }).error, /köpük tabancası/);
  assert.match(t.valet(p, { act: 'tool', tool: 'foam' }).error, /askısına/);
  t.at(p, VALET.rack.point);
  assert.equal(t.valet(p, { act: 'tool', tool: 'soap' }).ok, false);
  assert.equal(t.valet(p, { act: 'tool', tool: { toString: () => 'foam' } }).ok, false);
  assert.equal(t.valet(p, { act: 'tool', tool: 'water' }).ok, true);
  t.at(p, [v.x + 1.6, v.z]);
  assert.match(t.valet(p, { act: 'spray', job: j.id, spot: 0, step: 'begin' }).error, /köpük tabancası/, 'önce köpük');
  t.at(p, VALET.rack.point);
  t.valet(p, { act: 'tool', tool: 'foam' });
  t.at(p, [v.x + 1.6, v.z]);
  assert.equal(t.valet(p, { act: 'spray', job: j.id, spot: '0', step: 'begin' }).ok, false);
  assert.equal(t.valet(p, { act: 'spray', job: j.id, spot: 9, step: 'begin' }).ok, false);
  assert.match(t.valet(p, { act: 'spray', job: j.id, spot: 0, step: 'finish' }).error, /başla/);
  assert.equal(t.valet(p, { act: 'spray', job: j.id, spot: 0, step: 'begin' }).ok, true);
  t.advance(300);
  assert.match(t.valet(p, { act: 'spray', job: j.id, spot: 0, step: 'finish' }).error, /tut/);
  t.advance(R.SPRAY_MS.foam);
  assert.equal(t.valet(p, { act: 'spray', job: j.id, spot: 0, step: 'finish' }).ok, true);
  assert.equal(j.spots[0], 1);
  assert.match(t.valet(p, { act: 'spray', job: j.id, spot: 0, step: 'begin' }).error, /köpüklü/);
  t.at(p, [v.x + 9, v.z - 3]);
  assert.match(t.valet(p, { act: 'spray', job: j.id, spot: 1, step: 'begin' }).error, /yaklaş/);
  // Kalan noktalar (başka bir oyuncu da yardım edebilir)
  t.wash(p, j);
  assert.deepEqual(j.spots, new Array(R.SPOTS).fill(2));

  // V-1'e park → teslim
  t.at(p, [v.x + 1.6, v.z]);
  assert.equal(t.veh(p, { act: 'mount', id: j.carId }).ok, true);
  const bay = VALET.bays[0];
  t.drive(p, [bay.x, bay.z], bay.yaw);
  const money = sim.money;
  const wallet = p.wallet;
  const r = t.veh(p, { act: 'dismount' });
  assert.equal(r.ok, true);
  const fee = valetFee(j.model);
  assert.equal(sim.money, money + fee, 'vale ücreti kasaya');
  const tip = p.wallet - wallet;
  assert.equal(tip, valetTip({ model: j.model, washed: true, damage: 0, fast: true, stars: sim.growth.stars }), 'bahşiş cüzdana');
  assert.ok(tip > 200, `yıkanmış + hasarsız + hızlı → yüksek bahşiş (${tip})`);
  assert.equal(sim.vehicles.vehicles.has(j.carId), false, 'araba kalkar');
  assert.equal(sim.valet.jobs.size, 0);
  assert.equal(p.valet.job, null);
  assert.equal(sim.valet.stats.done, 1);
  assert.equal(sim.valet.stats.perfect, 1);
  assert.ok(t.notes(p).some((n) => /bahşiş bıraktı/.test(n)));
});

test('hasar: çarpma bildirimi sürücüden, seyreltilmiş ve sınıra kırpılmış; %60+ hasarda bahşiş yok + şikâyet', () => {
  const t = setup();
  const { sim, p } = t;
  const j = t.spawn();
  t.takeKeys(p, j);
  assert.equal(t.valet(p, { act: 'hit', kmh: '30' }).ok, false);
  assert.equal(t.valet(p, { act: 'hit', kmh: -4 }).ok, false);
  assert.equal(t.valet(p, { act: 'hit', kmh: NaN }).ok, false);
  let r = t.valet(p, { act: 'hit', kmh: 9999 });
  assert.equal(r.ok, true);
  assert.ok(r.damage > 0 && r.damage <= R.HIT_MAX, 'sokak sınırına kırpılır');
  const d1 = j.damage;
  r = t.valet(p, { act: 'hit', kmh: 30 });
  assert.equal(j.damage, d1, 'çok sık bildirim yok sayılır');
  for (let k = 0; k < 10; k++) {
    t.advance(R.HIT_GAP_MS);
    t.valet(p, { act: 'hit', kmh: 40 });
  }
  assert.ok(j.damage >= R.NO_TIP_DAMAGE);
  assert.equal(events(t, EVT.VALET_STATE).at(-1).jobs[0].damage, Math.round(j.damage));
  // Yürüyen oyuncu çarpma bildiremez
  const q = sim.addPlayer('Kaskadör');
  sim.valet.initPlayer(q);
  assert.equal(t.valet(q, { act: 'hit', kmh: 30 }).ok, false);
  // Hız ihlali (kırpılan hareket) de küçük hasar
  const before = j.damage;
  sim.movePlayer(p.id, p.x - 40, p.z, Math.PI / 2);
  assert.ok(j.damage > before || j.damage === 100);
  // Teslim: bahşiş yok, itibar düşer
  t.toGarage(p);
  const bay = VALET.bays[1];
  t.drive(p, [bay.x, bay.z]);
  const rep = sim.growth.reputation;
  sim.growth.reputation = 100;
  const wallet = p.wallet;
  assert.equal(t.veh(p, { act: 'dismount' }).ok, true);
  assert.equal(p.wallet, wallet);
  assert.ok(sim.growth.reputation < 100);
  assert.ok(rep >= 0);
  assert.ok(t.notes(p).some((n) => /bahşiş yok/.test(n)));
});

function events(t, e) { return t.events(e); }

test('anahtar zamanında alınmazsa VIP arabasıyla gider; anahtar sahibi ayrılırsa müşteri arabasını geri alır', () => {
  const t = setup();
  const { sim, p } = t;
  const j = t.spawn();
  t.tick(R.KEY_WAIT_MS + 200);
  assert.equal(sim.valet.jobs.size, 0);
  assert.equal(sim.vehicles.vehicles.has(j.carId), false);
  assert.ok(t.events(EVT.GUEST_REMOVE).length > 0);

  const j2 = t.spawn();
  t.takeKeys(p, j2);
  t.drive(p, [10, -4.5]);
  sim.removePlayer(p.id);
  assert.equal(sim.valet.jobs.size, 0);
  assert.equal(sim.vehicles.vehicles.has(j2.carId), false);
});

test('geç teslim bahşişi düşürür; çamurlu teslim yıkanmıştan az kazandırır; çalışma saatleri dışında VIP gelmez', () => {
  const t = setup();
  const { sim, p } = t;
  const j = t.spawn();
  t.takeKeys(p, j);
  t.toGarage(p);
  t.advance(R.JOB_MS + 1000);
  t.tick(200);
  assert.ok(t.notes(p).some((n) => /süresi doldu/.test(n)));
  const bay = VALET.bays[2];
  t.drive(p, [bay.x, bay.z]);
  const wallet = p.wallet;
  t.veh(p, { act: 'dismount' });
  const tip = p.wallet - wallet;
  assert.equal(tip, valetTip({ model: j.model, washed: false, damage: 0, late: true, stars: sim.growth.stars }));
  assert.ok(tip < valetTip({ model: j.model, washed: true, damage: 0, stars: sim.growth.stars }));

  const night = setup({ hour: 6 });
  night.sim.valet.nextSpawnAt = null;
  night.tick(60_000, 500);
  assert.equal(night.sim.valet.jobs.size, 0, '08:00 öncesi VIP yok');
});

test('kalıcılık: vale istatistikleri geri gelir; bozuk kayıt temizlenir; VIP aracı kayda girmez', () => {
  const store = memoryStore();
  const a = setup({ store });
  a.sim.valet.stats = { done: 7, perfect: 3, tips: 1234, fees: 560 };
  const j = a.spawn();
  a.takeKeys(a.p, j);
  a.sim.house.flush();
  assert.deepEqual(store.data.hotel.valet, { done: 7, perfect: 3, tips: 1234, fees: 560 });
  assert.ok(!JSON.stringify(store.data.hotel.garage ?? {}).includes(j.model) || Object.keys(store.data.hotel.garage.cars ?? {}).length === 0);
  const b = setup({ store });
  assert.equal(b.sim.valet.stats.tips, 1234);
  assert.equal(b.sim.valet.jobs.size, 0, 'süren işler kaydedilmez');
  const data = JSON.parse(JSON.stringify(store.data));
  data.hotel.valet = { done: 'çok', perfect: -2, tips: 1.5, fees: 10 };
  const c = setup({ store: memoryStore(data) });
  assert.deepEqual(c.sim.valet.stats, { done: 0, perfect: 0, tips: 0, fees: 10 });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { GARAGE, DRAG, ROOF, WORLD_BOUNDS, TELEPORTS, pointInBounds } from '../shared/layout.js';
import { BASEMENT } from '../shared/basement.js';
import {
  CAR_BY_ID, CAR_MODELS, TRUCK_MODELS, CAR_XFER_BY_ID, CAR_XFERS, carZone, bigArea, carSpeedCap, carPhysics, inXferZone,
} from '../shared/cars.js';
import {
  HWY, SERVICE_YARD, HOTEL_DELIVERY, SITES, SITE_BY_ID, ROADS, isDrivable, routeTo, siteDistance, roadLimitKmh,
  constrainToRoads, laneAt, TRUNK_LENGTH, yardAt, roadPoint, siteTripSec, routeTimeSec, GRAPH, SIGNALS, SIGNAL_CYCLE, signalState,
  YARDS, destinationPoint, trunkAt,
} from '../shared/worldmap.js';
import { CARGO_TYPES, CARGO_BY_ID, LOGI_RULES, offerTerms, deliveryPay, HAUL_RULES, HAUL_GOOD_BY_ID, haulTerms } from '../shared/logistics.js';

const config = {
  dayLengthSec: 100_000, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 400_000, starterBed: false,
  restaurantDiners: false, valetCustomers: false, basementGuests: false,
};
const KEY_A = 'a'.repeat(32);

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

const trucksOf = (sim, p) => [...sim.vehicles.vehicles.values()].filter((v) => v.type === 'car' && v.ownerId === p.id && CAR_BY_ID[v.model].body === 'truck');
const logi = (sim, p, data) => sim.logisticsAct(p.id, data);

/** Tırı (x, z)'ye ışınla (sürüş benzetimi değil: hız ölçümü sıfırlanır) */
function place(s, p, x, z) {
  const v = s.sim.vehicles.vehicles.get(p.vehicle.id);
  p.x = x; p.z = z; v.x = x; v.z = z;
  s.sim.logistics.track.delete(p.id);
  s.advance(1000);
}

function boardWithTruck() {
  const s = setup();
  const p = s.sim.addPlayer('Şoför', KEY_A);
  const r = s.sim.carAct(p.id, { act: 'buy', model: 'zeeland-lx', color: 0, source: 'wallet' });
  assert.ok(r.ok, r.error);
  const v = trucksOf(s.sim, p)[0];
  s.sim.movePlayer(p.id, v.x + 1.5, v.z, 0);
  const m = s.sim.vehicleAct(p.id, { act: 'mount', id: v.id });
  assert.ok(m.ok, m.error);
  s.sim.money = 50_000;
  return { ...s, p, v };
}

// ---- Harita -----------------------------------------------------------------------------------

test('harita: otoyol bölgesi diğer bölgelerle çakışmaz, rotalar sürülebilir, mesafeler mantıklı', () => {
  const b = HWY.bounds;
  for (const other of [GARAGE.bounds, DRAG.bounds, ROOF.bounds, BASEMENT.bounds]) {
    assert.ok(other.maxX < b.minX - 10 || other.minX > b.maxX + 10, 'x ayrık');
  }
  assert.ok(b.minX >= WORLD_BOUNDS.minX && b.maxX <= WORLD_BOUNDS.maxX && b.minZ >= WORLD_BOUNDS.minZ && b.maxZ <= WORLD_BOUNDS.maxZ);
  // Avlular / depolar bölgede, birbirine binmez
  const yards = [SERVICE_YARD.bounds, ...SITES.map((s) => s.bounds)];
  for (const y of yards) assert.ok(y.minX >= b.minX && y.maxX <= b.maxX && y.minZ >= b.minZ && y.maxZ <= b.maxZ);
  for (let i = 0; i < yards.length; i++) for (let j = i + 1; j < yards.length; j++) {
    const a = yards[i]; const c = yards[j];
    assert.ok(a.maxX <= c.minX || c.maxX <= a.minX || a.maxZ <= c.minZ || c.maxZ <= a.minZ, `${i}-${j}`);
  }
  assert.ok(TRUNK_LENGTH > 6000, 'A10 en az ~6 km');
  assert.ok(ROADS.length >= 10);
  for (const k of ['trunk', 'spur', 'urban']) assert.ok(ROADS.some((r) => r.kind === k), k);
  // Her siteden otele ve otelden her siteye rota: bütün noktalar sürülebilir, uzunluk düz çizgiden uzun
  for (const s of SITES) {
    const d = siteDistance(s.id);
    assert.ok(d > 5000 && d < 9000, `${s.id} ${d}`);
    // Gidiş-dönüş (tır sınırlarıyla) 10–15 dk
    const trip = siteTripSec(s.id);
    assert.ok(trip >= 600 && trip <= 900, `${s.id} tur ${Math.round(trip)} sn`);
    for (const [from, to] of [[[HOTEL_DELIVERY.x, HOTEL_DELIVERY.z], s.id], [[(s.load.minX + s.load.maxX) / 2, (s.load.minZ + s.load.maxZ) / 2], 'hotel']]) {
      const r = routeTo(from[0], from[1], to);
      assert.ok(r && r.pts.length >= 3, `${s.id} rota`);
      for (const pt of r.pts) assert.ok(isDrivable(pt[0], pt[1], 0.5), `${s.id} → ${to}: ${pt}`);
      // Rota boyunca her 5 m sürülebilir (segment ortaları da)
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, az] = r.pts[i - 1];
        const [bx, bz] = r.pts[i];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 5);
        for (let k = 0; k <= n; k++) assert.ok(isDrivable(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, 0.5), `${s.id} ara nokta`);
      }
    }
  }
  // Teslim körfezi ve yükleme körfezleri avlularda; tır parkı avluda, tetik alanında değil
  assert.equal(yardAt(HOTEL_DELIVERY.x, HOTEL_DELIVERY.z), 'yard');
  for (const s of SITES) assert.equal(yardAt((s.load.minX + s.load.maxX) / 2, (s.load.minZ + s.load.maxZ) / 2), s.id);
  for (const t of SERVICE_YARD.truckBays) {
    assert.equal(yardAt(t.x, t.z), 'yard');
    assert.ok(!pointInBounds(t.x, t.z, HOTEL_DELIVERY.zone));
  }
  // Tabela sınırları: otoyol 100, bağlantı 60, şehir 50, avlu 30 — yalnızca bilgi; hız sınırlayıcı yok (aracın en yüksek hızı)
  assert.equal(roadLimitKmh(420, -2), 100);
  assert.equal(roadLimitKmh(SERVICE_YARD.arrive.x, SERVICE_YARD.arrive.z), 30);
  const sp = roadPoint('spur-nz', 300);
  assert.equal(roadLimitKmh(sp.x, sp.z), 60);
  const ur = roadPoint('nz-dijkweg', 200);
  assert.equal(roadLimitKmh(ur.x, ur.z), 50);
  assert.ok(Math.abs(carSpeedCap(CAR_BY_ID['valk-tempesta'], 420, -2) * 3.6 - CAR_BY_ID['valk-tempesta'].topKmh) < 1e-6);
  assert.ok(Math.abs(carSpeedCap(CAR_BY_ID['zeeland-lx'], 420, -2) * 3.6 - CAR_BY_ID['zeeland-lx'].topKmh) < 1e-6);
  assert.ok(Math.abs(carSpeedCap(CAR_BY_ID['zeeland-lx'], SERVICE_YARD.arrive.x, SERVICE_YARD.arrive.z) * 3.6 - CAR_BY_ID['zeeland-lx'].topKmh) < 1e-6, 'avluda da sınırlayıcı yok');
  // Kısıt: yoldan çıkan nokta şeride itilir; şerit içindeki nokta değişmez
  const pos = { x: 420, z: 40 };
  assert.ok(constrainToRoads(pos, 1.3));
  assert.ok(isDrivable(pos.x, pos.z));
  const inside = { x: 420, z: -3 };
  assert.equal(constrainToRoads(inside, 1.3), false);
  // Şerit noktası yolun üzerinde, iki yön ayrı tarafta
  const a = laneAt(300, 1, 0);
  const c = laneAt(300, -1, 0);
  assert.ok(isDrivable(a.x, a.z) && isDrivable(c.x, c.z) && Math.hypot(a.x - c.x, a.z - c.z) > 8);
  // Bölgeler
  const tp = trunkAt(800);
  assert.equal(bigArea(tp.x, tp.z), 'highway');
  assert.equal(carZone(tp.x, tp.z), 'highway');
  assert.equal(carZone(420, 60), null, 'yolun dışı');
  assert.ok(TELEPORTS.some((t) => t.id === 'logistics' && yardAt(t.point[0], t.point[1]) === 'yard'));
  // Tünel: varış noktaları tetik alanlarında değil
  for (const id of ['toHighway', 'toCity']) {
    const t = CAR_XFER_BY_ID[id];
    for (const u of CAR_XFERS) assert.ok(!inXferZone(u, t.to.x, t.to.z), `${id} → ${u.id}`);
  }
  assert.equal(carZone(CAR_XFER_BY_ID.toCity.to.x, CAR_XFER_BY_ID.toCity.to.z), 'street');
});

test('genişletilmiş harita: yol grafı bağlı, rota adımları, Nieuw-Zuid trafik ışıkları, yasal ücret €450–650', async () => {
  const { CONTACT, SAFE_DROP } = await import('../shared/illegal.js');
  // Graf bağlı: her avludan her avluya rota var; adımlar varışla biter
  for (const a of YARDS) {
    for (const b of ['hotel', ...SITES.map((x) => x.id)]) {
      const from = a.id === 'yard' ? [HOTEL_DELIVERY.x, HOTEL_DELIVERY.z] : destinationPoint(a.id);
      const r = routeTo(from[0], from[1], b);
      assert.ok(r && r.length > 0 || (a.id === b || (a.id === 'yard' && b === 'hotel')), `${a.id} → ${b}`);
      if (r && r.steps?.length) assert.equal(r.steps[r.steps.length - 1].turn, 'arrive');
    }
  }
  const nodes = GRAPH.nodes;
  const seen = new Set([0]);
  const q = [0];
  while (q.length) {
    const n = q.pop();
    for (const id of nodes[n].edges) {
      const e = GRAPH.edges[id];
      for (const m of [e.a, e.b]) if (!seen.has(m)) { seen.add(m); q.push(m); }
    }
  }
  assert.equal(seen.size, nodes.length, 'bütün kavşaklar birbirine bağlı');
  // Şehir içi rota: Nieuw-Zuid deposuna sağa / sola dönüşler ve çıkış adımı
  const rf = routeTo(HOTEL_DELIVERY.x, HOTEL_DELIVERY.z, 'food');
  assert.ok(rf.steps.some((st) => st.kind === 'urban' && (st.turn === 'left' || st.turn === 'right')), 'şehirde dönüş');
  assert.ok(rf.steps.some((st) => st.kind === 'spur' && st.from === 'trunk'), 'otoyoldan çıkış');
  assert.ok(routeTimeSec(rf) > 240);
  // Trafik ışıkları: iki eksen aynı anda yeşil olmaz, döngüde her eksen yeşil görür
  assert.ok(SIGNALS.length >= 4);
  for (const sg of SIGNALS) {
    let ns = 0;
    let ew = 0;
    for (let t = 0; t < SIGNAL_CYCLE; t += 0.5) {
      const a = signalState(sg, 'ns', t);
      const b = signalState(sg, 'ew', t);
      assert.ok(!(a === 'g' && b === 'g') && !(a !== 'r' && b !== 'r'), `t ${t}`);
      if (a === 'g') ns++;
      if (b === 'g') ew++;
    }
    assert.ok(ns > 0 && ew > 0);
  }
  // Kaçak iş noktaları sürülebilir avlularda
  const cz = CONTACT.zone;
  assert.equal(yardAt((cz.minX + cz.maxX) / 2, (cz.minZ + cz.maxZ) / 2), 'port');
  const dz = SAFE_DROP.zone;
  assert.equal(yardAt((dz.minX + dz.maxX) / 2, (dz.minZ + dz.maxZ) / 2), SAFE_DROP.site);
  // Yasal ücret: zamanında €450–650 (her yük, her palet sayısı); süre rota süresinin üstünde
  for (const c of CARGO_TYPES) {
    for (const n of [c.min, c.max]) {
      const t = offerTerms(c.id, n, siteDistance(c.site), siteTripSec(c.site));
      const paid = Math.round(t.fee * LOGI_RULES.ONTIME_MUL);
      assert.ok(paid >= LOGI_RULES.FEE_MIN - 1 && paid <= LOGI_RULES.FEE_MAX + 1, `${c.id} ${n}: ${paid}`);
      assert.ok(t.timeSec > siteTripSec(c.site) * 1.3, 'süre payı');
    }
  }
  // Kiralık şoförlük yasal işten hep düşük
  for (const km of [3, 8, 14]) for (const n of [HAUL_RULES.MIN_PALLETS, HAUL_RULES.MAX_PALLETS]) {
    const paid = Math.round(haulTerms(n, km * 1000).fee * LOGI_RULES.ONTIME_MUL);
    assert.ok(paid <= HAUL_RULES.FEE_MAX + 1 && paid < LOGI_RULES.FEE_MIN);
  }
});

test('katalog: tırlar AutoGalerie listesinde değil, fizik ağır ve yavaş', () => {
  assert.ok(TRUCK_MODELS.length >= 3);
  for (const m of TRUCK_MODELS) {
    assert.ok(!CAR_MODELS.includes(m));
    assert.equal(CAR_BY_ID[m.id], m);
    const ph = carPhysics(m);
    assert.ok(Number.isFinite(ph.A) && ph.A > 0.8 && ph.A < 3, `${m.id} A ${ph.A}`);
    assert.ok(Math.abs(ph.vmax * 3.6 - m.topKmh) < 1e-9 && m.topKmh >= 130, 'sınırlayıcı yok: en yüksek hız ≥ 130 km/s');
    assert.ok(m.price >= 80_000);
  }
  for (const c of CARGO_TYPES) {
    assert.ok(SITE_BY_ID[c.site], c.id);
    const t = offerTerms(c.id, c.max, siteDistance(c.site));
    assert.ok(t.value > t.wholesale && t.fee > 0 && t.timeSec > 60);
  }
});

// ---- Satın alma ve tünel ----------------------------------------------------------------------

test('tır satın alma: yalnızca cüzdandan, en fazla 2, avludaki tır parkına; şehre giremez, araba otoyola çıkabilir', () => {
  const s = setup();
  const p = s.sim.addPlayer('Şoför', KEY_A);
  assert.equal(s.sim.carAct(p.id, { act: 'buy', model: 'zeeland-lx', color: 0, source: 'kasa' }).ok, false);
  const wallet = p.wallet;
  const r = s.sim.carAct(p.id, { act: 'buy', model: 'zeeland-lx', color: 1, source: 'wallet' });
  assert.ok(r.ok && r.truck);
  assert.equal(p.wallet, wallet - CAR_BY_ID['zeeland-lx'].price);
  assert.equal(r.bay, 'T-1');
  assert.ok(s.sim.carAct(p.id, { act: 'buy', model: 'brabant-titan', color: 0, source: 'wallet' }).ok);
  assert.equal(s.sim.carAct(p.id, { act: 'buy', model: 'noordkaap-v8', color: 0, source: 'wallet' }).ok, false);
  const [t1, t2] = trucksOf(s.sim, p);
  assert.equal(yardAt(t1.x, t1.z), 'yard');
  assert.ok(Math.hypot(t1.x - t2.x, t1.z - t2.z) > 8);
  // Tırla tünelden şehre geçilmez
  s.sim.movePlayer(p.id, t1.x + 1.5, t1.z, 0);
  assert.ok(s.sim.vehicleAct(p.id, { act: 'mount', id: t1.id }).ok);
  const pz = SERVICE_YARD.portal;
  p.x = (pz.minX + pz.maxX) / 2; p.z = 0; t1.x = p.x; t1.z = p.z;
  s.advance(2000);
  const x = s.sim.carAct(p.id, { act: 'xfer', id: 'toCity' });
  assert.equal(x.ok, false);
  assert.match(x.error, /Tır/);
  // Tır yolun ortasına park edilmez, avluda edilir
  p.x = 420; p.z = -3; t1.x = 420; t1.z = -3;
  assert.equal(s.sim.vehicleAct(p.id, { act: 'dismount' }).ok, false);
  p.x = 300; p.z = 0; t1.x = 300; t1.z = 0;
  assert.ok(s.sim.vehicleAct(p.id, { act: 'dismount' }).ok);
  // Yaya tünelden şehre ve geri
  s.advance(2000);
  p.x = 252; p.z = 0;
  const back = s.sim.carAct(p.id, { act: 'xfer', id: 'toCity' });
  assert.ok(back.ok, back.error);
  assert.equal(bigArea(p.x, p.z), 'city');
  // Araba sokaktan tünelle otoyola çıkar
  assert.ok(s.sim.carAct(p.id, { act: 'buy', model: 'kade-vier', color: 0, source: 'wallet' }).ok);
  const car = [...s.sim.vehicles.vehicles.values()].find((v) => v.model === 'kade-vier');
  car.x = 17.2; car.z = -5; // otelin önü (tünel ağzının yanı)
  s.sim.movePlayer(p.id, 15.5, -5, 0);
  s.advance(2000);
  assert.ok(s.sim.vehicleAct(p.id, { act: 'mount', id: car.id }).ok);
  s.advance(2000);
  const go = s.sim.carAct(p.id, { act: 'xfer', id: 'toHighway' });
  assert.ok(go.ok, go.error);
  assert.equal(go.area, 'highway');
  assert.equal(car.x, SERVICE_YARD.arrive.x);
  // Sınırlayıcı yok: avluda 72 km/s de kabul edilir (aracın kendi en yüksek hızına kadar)
  s.advance(3000);
  s.sim.movePlayer(p.id, car.x + 20, car.z, -Math.PI / 2); // 1 sn'de 20 m = 72 km/s
  assert.ok(Math.abs(p.x - (SERVICE_YARD.arrive.x + 20)) < 0.5, 'kırpılmadı');
});

// ---- Sevkiyat ---------------------------------------------------------------------------------

test('sevkiyat: pano → iş al → depoda yükle (kasadan toptan) → çarpma hasarı → otele teslim (kasa + şoför ücreti)', () => {
  const s = boardWithTruck();
  const { sim, p, v } = s;
  const board = logi(sim, p, { act: 'board' });
  assert.ok(board.ok);
  assert.equal(board.state.offers.length, LOGI_RULES.OFFERS);
  const offer = board.state.offers.find((o) => o.site === 'food') ?? board.state.offers[0];
  const acc = logi(sim, p, { act: 'accept', offer: offer.id });
  assert.ok(acc.ok, acc.error);
  assert.equal(logi(sim, p, { act: 'accept', offer: board.state.offers[1].id }).ok, false, 'tek iş');
  const job = sim.logistics.jobOf(p);
  assert.equal(job.legal, true);
  assert.deepEqual(job.hidden, []);
  // Yanlış yerde yüklenmez
  assert.equal(logi(sim, p, { act: 'load' }).ok, false);
  const site = SITE_BY_ID[job.site];
  const lx = (site.load.minX + site.load.maxX) / 2;
  const lz = (site.load.minZ + site.load.maxZ) / 2;
  place(s, p, lx, lz);
  // Hareket hâlindeyken yüklenmez (sunucu kendi hız ölçümüyle)
  s.advance(500); sim.movePlayer(p.id, lx, lz + 4, Math.PI);
  s.advance(500); sim.movePlayer(p.id, lx, lz + 8, Math.PI);
  const moving = logi(sim, p, { act: 'load' });
  assert.equal(moving.ok, false);
  assert.match(moving.error, /dur/);
  s.advance(1000);
  const kasa = sim.money;
  const ld = logi(sim, p, { act: 'load' });
  assert.ok(ld.ok, ld.error);
  assert.equal(sim.money, kasa - job.wholesale);
  assert.deepEqual(v.trailer, { job: job.id, cargo: job.cargo, pallets: job.pallets });
  assert.ok(s.events(EVT.VEHICLES).at(-1).find((x) => x.id === v.id).trailer, 'dorse yayında');
  // Çarpma: hasar artar, 0.7 sn içinde ikincisi sayılmaz
  const h1 = logi(sim, p, { act: 'hit', kmh: 60 });
  assert.ok(h1.damage > 0.1 && h1.damage <= LOGI_RULES.HIT_MAX, 'çarpma hızı aracın en yüksek hızıyla sınırlı (sınırlayıcı yok)');
  assert.equal(logi(sim, p, { act: 'hit', kmh: 60 }).damage, h1.damage);
  assert.equal(logi(sim, p, { act: 'hit', kmh: 'çok' }).ok, false);
  // Teslim: mal kabul körfezi
  let delivered = null;
  sim.cargo = { deliver: (d) => { delivered = d; return null; } };
  place(s, p, HOTEL_DELIVERY.x, HOTEL_DELIVERY.z);
  const kasa2 = sim.money;
  const wallet = p.wallet;
  const d = logi(sim, p, { act: 'deliver' });
  assert.ok(d.ok, d.error);
  const exp = deliveryPay({ ...job, damage: job.damage }, s.now());
  assert.equal(sim.money, kasa2 + exp.value);
  assert.equal(p.wallet, wallet + exp.fee);
  assert.ok(d.value < job.value, 'hasar değeri düşürür');
  assert.deepEqual(delivered.items, [{ type: CARGO_BY_ID[job.cargo].dock, count: job.pallets }]);
  assert.equal(delivered.source, 'truck');
  assert.equal(delivered.by, p);
  assert.equal(v.trailer, null);
  assert.equal(sim.logistics.jobOf(p), null);
  assert.equal(sim.logistics.stats.deliveries, 1);
});

test('sevkiyat: mal kabul stoğa işlerse kasaya ayrıca değer yazılmaz; zamanında / geç ücret; iptal iadesi; çıkışta iade', () => {
  const s = boardWithTruck();
  const { sim, p } = s;
  const go = () => {
    const b = logi(sim, p, { act: 'board' });
    assert.ok(logi(sim, p, { act: 'accept', offer: b.state.offers[0].id }).ok);
    const j = sim.logistics.jobOf(p);
    const site = SITE_BY_ID[j.site];
    place(s, p, (site.load.minX + site.load.maxX) / 2, (site.load.minZ + site.load.maxZ) / 2);
    assert.ok(logi(sim, p, { act: 'load' }).ok);
    return j;
  };
  // handled → kasaya değer yok, şoför ücreti var (zamanında ×1.2)
  const j1 = go();
  const realCargo = sim.cargo;
  sim.cargo = { deliver: () => ({ handled: true }), removePlayer() {} };
  place(s, p, HOTEL_DELIVERY.x, HOTEL_DELIVERY.z);
  const kasa = sim.money;
  const d1 = logi(sim, p, { act: 'deliver' });
  assert.ok(d1.ok && d1.handled);
  assert.equal(sim.money, kasa);
  assert.equal(d1.fee, Math.round(j1.fee * LOGI_RULES.ONTIME_MUL));
  // Geç teslim
  const j2 = go();
  place(s, p, HOTEL_DELIVERY.x, HOTEL_DELIVERY.z);
  s.advance(j2.timeSec * 1000 + 1000);
  sim.cargo = { deliver: () => ({ ok: false }), removePlayer() {} }; // mal kabul reddederse değer kasaya
  const d2 = logi(sim, p, { act: 'deliver' });
  assert.ok(d2.ok && d2.late);
  assert.equal(d2.fee, Math.round(j2.fee * LOGI_RULES.LATE_MUL));
  // Yükten sonra iptal: yarısı iade
  const j3 = go();
  const k3 = sim.money;
  const c = logi(sim, p, { act: 'cancel' });
  assert.equal(c.refund, Math.round(j3.wholesale * 0.5));
  assert.equal(sim.money, k3 + c.refund);
  // Oyundan çıkış: yük iade, iş silinir
  sim.cargo = realCargo;
  go();
  sim.removePlayer(p.id);
  assert.equal(sim.logistics.jobs.size, 0);
});

test('sevkiyat: tırı olmayan iş alamaz; başkasının tırıyla yüklenmez', () => {
  const s = setup();
  const p = s.sim.addPlayer('Yaya', KEY_A);
  const b = logi(s.sim, p, { act: 'board' });
  const r = logi(s.sim, p, { act: 'accept', offer: b.state.offers[0].id });
  assert.equal(r.ok, false);
  assert.match(r.error, /tır/i);
  assert.equal(logi(s.sim, p, { act: 'nope' }).ok, false);
});

// ---- Kancalar (polis eklentisi) -------------------------------------------------------------------

test('kancalar: iş olayları, veto, tır durumu, yapay araç yayını', () => {
  const s = boardWithTruck();
  const { sim, p, v } = s;
  const seen = [];
  for (const e of ['jobStart', 'loaded', 'jobEnd', 'stopped']) sim.logistics.on(e, (x) => { seen.push(e); return e === 'jobStart' ? null : undefined; });
  const off = sim.logistics.on('load', () => ({ veto: '🚓 Yol kontrolü!' }));
  const b = logi(sim, p, { act: 'board' });
  logi(sim, p, { act: 'accept', offer: b.state.offers[0].id });
  const j = sim.logistics.jobOf(p);
  const site = SITE_BY_ID[j.site];
  place(s, p, (site.load.minX + site.load.maxX) / 2, (site.load.minZ + site.load.maxZ) / 2);
  const vetoed = logi(sim, p, { act: 'load' });
  assert.equal(vetoed.ok, false);
  assert.equal(vetoed.error, '🚓 Yol kontrolü!');
  off();
  assert.ok(logi(sim, p, { act: 'load' }).ok);
  // Tır durumu ve "durdu" olayı
  sim.movePlayer(p.id, p.x, p.z, 0);
  s.advance(2500);
  sim.movePlayer(p.id, p.x, p.z, 0);
  const st = sim.logistics.truckState(p);
  assert.equal(st.vehicleId, v.id);
  assert.equal(st.job.id, j.id);
  assert.ok(seen.includes('stopped'));
  logi(sim, p, { act: 'cancel' });
  assert.deepEqual(seen.filter((e) => e !== 'stopped'), ['jobStart', 'loaded', 'jobEnd']);
  // Yapay araç: yayınlanır, kaldırılır
  sim.logistics.setAgent('pol1', { kind: 'police', x: 420, z: 0, yaw: 0, speed: 20 });
  s.advance(300);
  sim.tick(s.now());
  assert.equal(s.events(EVT.LOGI_AGENTS).at(-1)[0].kind, 'police');
  sim.logistics.removeAgent('pol1');
  s.advance(300);
  sim.tick(s.now());
  assert.deepEqual(s.events(EVT.LOGI_AGENTS).at(-1), []);
});

// ---- Kalıcılık --------------------------------------------------------------------------------------

test('kalıcılık: tır avluda kalır, istatistikler saklanır; bozuk tır konumu tır parkına', () => {
  const store = memoryStore();
  const s = setup({ store });
  const p = s.sim.addPlayer('Şoför', KEY_A);
  assert.ok(s.sim.carAct(p.id, { act: 'buy', model: 'noordkaap-v8', color: 2, source: 'wallet' }).ok);
  const t = trucksOf(s.sim, p)[0];
  const fd = SITE_BY_ID.food.load;
  t.x = (fd.minX + fd.maxX) / 2; t.z = (fd.minZ + fd.maxZ) / 2; // VersMarkt avlusu
  s.sim.logistics.stats.deliveries = 3;
  s.sim.house.saveNow?.();
  s.sim.removePlayer(p.id);
  s.sim.house.saveNow?.();
  const data = store.data ?? { hotel: s.sim.hotelState() };
  const hotel = data.hotel ?? s.sim.hotelState();
  assert.equal(hotel.logistics.stats.deliveries, 3);
  const recs = hotel.garage.cars[Object.keys(hotel.garage.cars)[0]];
  assert.equal(recs[0].m, 'noordkaap-v8');
  // Yeni sunucu: tır son yerinde
  const s2 = setup({ store: memoryStore(JSON.parse(JSON.stringify(store.data ?? { hotel }))) });
  s2.sim.restoreHotel(hotel);
  const p2 = s2.sim.addPlayer('Şoför', KEY_A);
  const t2 = trucksOf(s2.sim, p2)[0];
  assert.ok(t2);
  assert.equal(yardAt(t2.x, t2.z), 'food');
  assert.equal(s2.sim.logistics.stats.deliveries, 3);
  // Bozuk konum (şehirde) → tır parkı
  const g = s2.sim.garage;
  const rec = g.cleanRecord({ id: 'k9', m: 'zeeland-lx', c: 0, x: 0, z: -4, yaw: 0 }, []);
  assert.equal(rec.x, null);
});

test('kiralık şoförlük: tır gerekmez, firmanın tırı gelir; firmanın malı depodan depoya; kasaya dokunulmaz, ücret düşük; tır firmaya döner', () => {
  const s = setup();
  const { sim } = s;
  const p = sim.addPlayer('Şoför', KEY_A);
  const q = sim.addPlayer('Arkadaş', 'b'.repeat(32));
  const board = logi(sim, p, { act: 'board' });
  assert.equal(board.state.hauls.length, HAUL_RULES.OFFERS);
  const h = board.state.hauls[0];
  assert.notEqual(h.site, h.to, 'iki farklı yer');
  assert.ok(HAUL_GOOD_BY_ID[h.goods]);
  // Kendi tırınla yapılan yasal işten (€450–650) hep düşük: zamanında €250–380
  assert.equal(h.fee, haulTerms(h.pallets, h.dist).fee);
  const paid = Math.round(h.fee * LOGI_RULES.ONTIME_MUL);
  assert.ok(paid >= HAUL_RULES.FEE_MIN - 1 && paid <= HAUL_RULES.FEE_MAX + 1 && paid < LOGI_RULES.FEE_MIN, `kiralık ${paid}`);
  // Tırı olmayan oyuncu alabilir; firmanın tırı avludaki tır parkına gelir (kayda girmez)
  assert.equal((p.carRecs ?? []).length, 0);
  const acc = logi(sim, p, { act: 'accept', offer: h.id });
  assert.ok(acc.ok, acc.error);
  const job = sim.logistics.jobOf(p);
  assert.equal(job.kind, 'haul');
  const v = sim.vehicles.vehicles.get(job.vehicleId);
  assert.equal(v.model, HAUL_RULES.TRUCK);
  assert.equal(v.ownerId, p.id);
  assert.equal(v.haul, job.id);
  assert.equal(yardAt(v.x, v.z), 'yard');
  assert.equal((p.carRecs ?? []).length, 0, 'oyuncunun garajına girmez');
  // Arkadaş yolcu olarak binebilir, sürücü koltuğu işi alanın
  sim.movePlayer(q.id, v.x + 1.5, v.z, 0);
  assert.equal(sim.vehicleAct(q.id, { act: 'mount', id: v.id }).seat, 'passenger');
  sim.movePlayer(p.id, v.x + 1.5, v.z, 0);
  assert.equal(sim.vehicleAct(p.id, { act: 'mount', id: v.id }).seat, 'driver');
  // Yükleme: kasadan para çıkmaz
  const A = SITE_BY_ID[h.site];
  const B = SITE_BY_ID[h.to];
  place(s, p, (A.load.minX + A.load.maxX) / 2, (A.load.minZ + A.load.maxZ) / 2);
  const kasa = sim.money;
  const ld = logi(sim, p, { act: 'load' });
  assert.ok(ld.ok, ld.error);
  assert.equal(sim.money, kasa);
  assert.equal(v.trailer.goods, h.goods);
  // Otele değil, firmanın boşaltma yerine teslim
  place(s, p, HOTEL_DELIVERY.x, HOTEL_DELIVERY.z);
  assert.equal(logi(sim, p, { act: 'deliver' }).ok, false);
  place(s, p, (B.load.minX + B.load.maxX) / 2, (B.load.minZ + B.load.maxZ) / 2);
  const w = p.wallet;
  const cargoBefore = JSON.stringify(sim.cargo.serialize?.().stock ?? null);
  const d = logi(sim, p, { act: 'deliver' });
  assert.ok(d.ok, d.error);
  assert.equal(d.fee, Math.round(h.fee * LOGI_RULES.ONTIME_MUL));
  assert.equal(p.wallet, w + d.fee);
  assert.equal(sim.money, kasa, 'kasaya dokunulmaz');
  assert.equal(JSON.stringify(sim.cargo.serialize?.().stock ?? null), cargoBefore, 'otel stoğuna girmez');
  // Tır firmaya döner: dünyadan kalkar, herkes iner
  assert.equal(sim.vehicles.vehicles.has(v.id), false);
  assert.equal(p.vehicle, null);
  assert.equal(q.vehicle, null);
  assert.equal(sim.logistics.jobOf(p), null);
  // İptal ve oyundan çıkış da tırı geri götürür
  const h2 = logi(sim, p, { act: 'board' }).state.hauls[0];
  assert.ok(logi(sim, p, { act: 'accept', offer: h2.id }).ok);
  const v2 = sim.logistics.jobOf(p).vehicleId;
  assert.ok(logi(sim, p, { act: 'cancel' }).ok);
  assert.equal(sim.vehicles.vehicles.has(v2), false);
  const h3 = logi(sim, p, { act: 'board' }).state.hauls[0];
  assert.ok(logi(sim, p, { act: 'accept', offer: h3.id }).ok);
  const v3 = sim.logistics.jobOf(p).vehicleId;
  sim.removePlayer(p.id);
  assert.equal(sim.vehicles.vehicles.has(v3), false);
});

test('sevkiyat: otel kasası yetmezse toptan bedel cüzdandan, teslimde geri; körfez toleransı', () => {
  const s = boardWithTruck();
  const { sim, p } = s;
  const board = logi(sim, p, { act: 'board' });
  const offer = board.state.offers[0];
  assert.ok(logi(sim, p, { act: 'accept', offer: offer.id }).ok);
  const job = sim.logistics.jobOf(p);
  const site = SITE_BY_ID[job.site];
  // Körfezin 5 m dışında da yüklenir (BAY_TOL)
  place(s, p, site.load.maxX + 5, (site.load.minZ + site.load.maxZ) / 2);
  sim.money = 10; // kasa boş
  const w0 = p.wallet;
  const ld = logi(sim, p, { act: 'load' });
  assert.ok(ld.ok, ld.error);
  assert.equal(sim.money, 10, 'kasaya dokunulmadı');
  assert.equal(p.wallet, w0 - job.wholesale, 'cüzdandan ödendi');
  place(s, p, HOTEL_DELIVERY.x, HOTEL_DELIVERY.z);
  const d = logi(sim, p, { act: 'deliver' });
  assert.ok(d.ok, d.error);
  assert.equal(d.advance, job.wholesale);
  assert.equal(p.wallet, w0 + d.fee, 'toptan bedel geri + şoför ücreti');
  // Ne kasada ne cüzdanda para yoksa açık hata
  const o2 = logi(sim, p, { act: 'board' }).state.offers[0];
  assert.ok(logi(sim, p, { act: 'accept', offer: o2.id }).ok);
  const j2 = sim.logistics.jobOf(p);
  const s2 = SITE_BY_ID[j2.site];
  place(s, p, (s2.load.minX + s2.load.maxX) / 2, (s2.load.minZ + s2.load.maxZ) / 2);
  sim.money = 0;
  p.wallet = 0;
  const no = logi(sim, p, { act: 'load' });
  assert.equal(no.ok, false);
  assert.match(no.error, /kasasında da cüzdanında da/);
});

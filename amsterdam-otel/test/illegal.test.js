import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { CAR_BY_ID } from '../shared/cars.js';
import { isDrivable, laneAt, SITE_BY_ID, yardAt, TRUNK_LENGTH, roadProject } from '../shared/worldmap.js';
import {
  CONTRA_GOODS, ILLEGAL_RULES as R, CONTACT, SAFE_DROP, SCANNERS, BOX_SLOTS, heatStars, policeWanted, catchFine, slotPoint,
  inContactZone, inDropZone,
} from '../shared/illegal.js';

const config = {
  dayLengthSec: 100_000, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 400_000, starterBed: false,
  restaurantDiners: false, valetCustomers: false, basementGuests: false, logisticsOffers: false,
};
const KEY_A = 'a'.repeat(32);

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function setup({ store = null, extra = {} } = {}) {
  let now = 5_000_000;
  const sim = new HotelSimulation({ config: { ...config, ...extra, startDay: 1, startHour: 11 }, now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  const to = [];
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  return { sim, to, tick, advance: (ms) => { now += ms; }, now: () => now };
}

const trucksOf = (sim, p) => [...sim.vehicles.vehicles.values()].filter((v) => v.type === 'car' && v.ownerId === p.id && CAR_BY_ID[v.model].body === 'truck');
const ill = (s, p, data) => s.sim.illegalAct(p.id, data);

/** Tırı (x, z)'ye ışınla (hız ölçümü sıfırlanır) */
function place(s, p, x, z, yaw = null) {
  const v = s.sim.vehicles.vehicles.get(p.vehicle.id);
  p.x = x; p.z = z; v.x = x; v.z = z;
  if (yaw !== null) { p.yaw = yaw; v.yaw = yaw; }
  s.sim.logistics.track.delete(p.id);
  s.advance(1000);
}

function withTruck(opts) {
  const s = setup(opts);
  const p = s.sim.addPlayer('Şoför', KEY_A);
  const r = s.sim.carAct(p.id, { act: 'buy', model: 'zeeland-lx', color: 0, source: 'wallet' });
  assert.ok(r.ok, r.error);
  const v = trucksOf(s.sim, p)[0];
  s.sim.movePlayer(p.id, v.x + 1.5, v.z, 0);
  assert.ok(s.sim.vehicleAct(p.id, { act: 'mount', id: v.id }).ok);
  s.sim.money = 50_000;
  return { ...s, p, v };
}

/** Bölmeli tır + kaçak iş alınmış + K-17'de yüklenmiş */
function loadedRun(opts) {
  const s = withTruck(opts);
  const { p, v } = s;
  assert.ok(ill(s, p, { act: 'buy', vehicle: v.id }).ok);
  const board = ill(s, p, { act: 'board' });
  const o = board.state.offers[0];
  assert.ok(ill(s, p, { act: 'accept', offer: o.id }).ok);
  place(s, p, (CONTACT.zone.minX + CONTACT.zone.maxX) / 2, (CONTACT.zone.minZ + CONTACT.zone.maxZ) / 2);
  const res = ill(s, p, { act: 'load' });
  assert.ok(res.ok, res.error);
  return { ...s, o, job: s.sim.logistics.jobOf(p), chase: () => s.sim.illegal.chases.get(p.id) };
}

// ---- Kurallar / yerleşim --------------------------------------------------------------------------

test('kaçak mallar yalnızca kurgusal gümrüksüz lüks tüketim; tanıdık ve depo sürülebilir; yuvalar dorseyle çakışmaz', () => {
  const banned = /uyuşturucu|esrar|kokain|eroin|hap|silah|tabanca|mermi|cephane|sigara|tütün|puro|alkol|bira|şarap|viski|votka|insan|göçmen/i;
  for (const g of CONTRA_GOODS) {
    assert.doesNotMatch(`${g.id} ${g.name}`, banned, g.id);
    assert.ok(g.pay > g.cost * 2, 'risk primi');
  }
  for (const z of [CONTACT.zone, SAFE_DROP.zone]) {
    for (const [x, zz] of [[z.minX + 1, z.minZ + 1], [z.maxX - 1, z.maxZ - 1], [(z.minX + z.maxX) / 2, (z.minZ + z.maxZ) / 2]]) assert.ok(isDrivable(x, zz), `${x},${zz}`);
  }
  assert.equal(yardAt(CONTACT.npc.x, CONTACT.npc.z), 'port');
  assert.equal(yardAt((SAFE_DROP.zone.minX + SAFE_DROP.zone.maxX) / 2, (SAFE_DROP.zone.minZ + SAFE_DROP.zone.maxZ) / 2), 'drinks');
  // Limanın yükleme körfeziyle çakışmaz
  const L = SITE_BY_ID.port.load;
  assert.ok(CONTACT.zone.maxX <= L.minX || CONTACT.zone.minZ >= L.maxZ);
  for (const sc of SCANNERS) assert.ok(sc.s > 0 && sc.s < TRUNK_LENGTH);
  // Isı → yıldız / polis sayısı
  assert.equal(heatStars(0), 0);
  assert.equal(heatStars(19), 1);
  assert.equal(heatStars(100), 5);
  assert.deepEqual([policeWanted(30), policeWanted(45), policeWanted(65), policeWanted(90)], [0, 1, 3, 4]);
  // Ceza cüzdanı eksiye düşürmez
  assert.deepEqual(catchFine({ pay: 1000, rams: 0 }, 99.6), { due: 1850, paid: 99 });
  assert.equal(catchFine({ pay: 1000, rams: 2 }, 1e9).paid, 1850 + 2 * R.RAM_FINE);
  // Yuvalar: arka yuva dorsenin (~−14.5 m) arkasında, yanlar tır genişliğinin dışında
  const rear = BOX_SLOTS.find((x) => x.id === 'rear');
  assert.ok(rear.f - 2.3 < -14.5 - 0.5);
  assert.ok(BOX_SLOTS.filter((x) => x.r).every((x) => Math.abs(x.r) - 0.95 > 1.25 + 1));
  const sp = slotPoint(BOX_SLOTS[0], 0, 0, 0); // yaw 0 → −z'ye bakar
  assert.ok(sp.z < 0 && Math.abs(sp.x) < 1e-9);
});

test('gizli bölme: cüzdandan, tır başına; teklifler yalnızca bölmeli tırı olana; kalıcı', () => {
  const store = memoryStore();
  const s = withTruck({ store });
  const { sim, p, v } = s;
  assert.equal(ill(s, p, { act: 'board' }).state.offers.length, 0, 'bölme yokken tanıdık yok');
  assert.equal(ill(s, p, { act: 'accept', offer: 'x1' }).ok, false);
  p.wallet = 100;
  assert.equal(ill(s, p, { act: 'buy', vehicle: v.id }).ok, false, 'para yetmez');
  p.wallet = 50_000;
  assert.equal(ill(s, p, { act: 'buy', vehicle: 999 }).ok, false);
  const r = ill(s, p, { act: 'buy', vehicle: v.id });
  assert.ok(r.ok, r.error);
  assert.equal(p.wallet, 50_000 - R.COMPARTMENT_PRICE);
  assert.equal(ill(s, p, { act: 'buy', vehicle: v.id }).ok, false, 'ikinci kez takılmaz');
  const st = ill(s, p, { act: 'board' }).state;
  assert.equal(st.offers.length, R.OFFERS);
  assert.ok(st.trucks[0].hidden);
  for (const o of st.offers) assert.ok(CONTRA_GOODS.some((g) => g.id === o.good) && o.pay > o.cost);
  // Başka oyuncu bu tıra bölme takamaz
  const q = sim.addPlayer('Başkası', 'b'.repeat(32));
  assert.equal(sim.illegalAct(q.id, { act: 'buy', vehicle: v.id }).ok, false);
  // Kalıcılık: kayıt kimliğiyle
  sim.house.flush?.();
  const saved = sim.hotelState();
  assert.deepEqual(saved.illegal.compartments[p.keyHash], [v.rec.id]);
  const s2 = setup({ store: memoryStore() });
  s2.sim.restoreHotel(saved);
  s2.sim.garage.restore(saved.garage);
  const p2 = s2.sim.addPlayer('Şoför', KEY_A);
  const v2 = trucksOf(s2.sim, p2)[0];
  assert.ok(v2 && s2.sim.illegal.hasCompartment(p2, v2));
});

test('yasal işler polis çağırmaz: hızlı sürüşte bile takip yok', () => {
  const s = withTruck();
  const { sim, p } = s;
  sim.config.logisticsOffers = true;
  const o = sim.logisticsAct(p.id, { act: 'board' }).state.offers.find((x) => x.site === 'port') ?? sim.logistics.offers[0];
  assert.ok(sim.logisticsAct(p.id, { act: 'accept', offer: o.id }).ok);
  const site = SITE_BY_ID[o.site];
  place(s, p, (site.load.minX + site.load.maxX) / 2, (site.load.minZ + site.load.maxZ) / 2);
  assert.ok(sim.logisticsAct(p.id, { act: 'load' }).ok);
  // Otoyolda sür
  for (let k = 0; k < 120; k++) {
    const l = laneAt(200 + k * 2.2, 1, 0);
    sim.movePlayer(p.id, l.x, l.z, l.yaw);
    s.tick(100);
  }
  assert.equal(sim.illegal.chases.size, 0);
  assert.equal(sim.logistics.agents.size, 0);
});

test('kaçak iş: K-17\'de yüklenir (bedel cüzdandan), otel teslimi veto, ısı sürüşle ve tarayıcıyla artar', () => {
  const s = loadedRun({ extra: { policeAgents: false } });
  const { sim, p, o, job } = s;
  assert.equal(job.legal, false);
  assert.deepEqual(job.hidden, [{ good: o.good, qty: o.qty }]);
  assert.equal(p.wallet, 400_000 - (sim.garage ? CAR_BY_ID['zeeland-lx'].price : 0) - R.COMPARTMENT_PRICE - o.cost);
  assert.ok(s.v.trailer, 'dorse görünür (örtü yük)');
  assert.ok(s.chase().heat >= R.HEAT_LOAD * R.NIGHT_HEAT_MUL - 1e-9);
  // LogisticsService'in yükle / teslim eylemleri bu iş için reddedilir
  assert.equal(sim.logisticsAct(p.id, { act: 'deliver' }).ok, false);
  // Otoyolda sür: ısı artar (zaman + tarayıcı)
  const scanS = SCANNERS.find((x) => x.id === 'scan-mid').s;
  const l0 = laneAt(scanS - 132, 1, 0);
  place(s, p, l0.x, l0.z, l0.yaw);
  const h0 = s.chase().heat;
  for (let k = 0; k < 120; k++) {
    const l = laneAt(scanS - 130 + k * 2.2, 1, 0);
    sim.movePlayer(p.id, l.x, l.z, l.yaw);
    s.tick(100);
  }
  assert.ok(s.chase().heat > h0 + 2, `ısı ${h0} → ${s.chase().heat}`);
  assert.ok(s.to.some((m) => m.event === EVT.NOTIFY && /tarayıcı|tarama/i.test(m.payload.text)), 'tarayıcı kapısı mesajı');
  // Çarpma (yük hasarı) ısıyı artırır
  const h1 = s.chase().heat;
  job.damage = 0.2;
  s.tick(200);
  assert.ok(s.chase().heat >= h1 + R.HEAT_HIT - 0.5);
});

test('polis kıskacı: ısı yüksekse ekipler yuvalara yerleşir, duran tır yakalanır; ceza cüzdanı eksiye düşürmez', () => {
  const s = loadedRun();
  const { sim, p, v } = s;
  const l = laneAt(400, 1, 1);
  place(s, p, l.x, l.z, l.yaw);
  s.chase().heat = 85;
  p.wallet = 120;
  let boxed = false;
  for (let k = 0; k < 200 && sim.illegal.chases.has(p.id); k++) {
    s.tick(100);
    const c = sim.illegal.chases.get(p.id);
    if (c && c.sides.length >= R.BOX_SIDES) boxed = true;
  }
  assert.ok(boxed, 'en az 3 taraf kapandı');
  assert.equal(sim.illegal.chases.has(p.id), false, 'yakalandı');
  assert.equal(p.wallet, 0, 'cüzdandaki her şey (eksiye düşmez)');
  assert.equal(sim.logistics.jobOf(p), null, 'mallara el konuldu');
  assert.equal(v.trailer, null);
  assert.equal(sim.logistics.agents.size, 0, 'ekipler çekildi');
  assert.equal(sim.illegal.stats.caught, 1);
  const caughtMsg = s.to.find((m) => m.event === EVT.ILLEGAL_STATE && m.payload.caught);
  assert.ok(caughtMsg && caughtMsg.payload.caught.fine === 120);
});

test('kaçış: ekipler 150 m dışında 25 sn kalırsa takip biter, ısı düşer; teslim polis yakındayken reddedilir', () => {
  const s = loadedRun();
  const { sim, p } = s;
  const l = laneAt(300, 1, 0);
  place(s, p, l.x, l.z, l.yaw);
  s.chase().heat = 45;
  s.tick(500);
  const c = s.chase();
  assert.ok(c.agents.size >= 2, 'sivil + polis');
  // Ekipleri sürekli uzakta tut (tır gözden kayboldu)
  for (let k = 0; k < 270 && c.agents.size; k++) {
    for (const a of c.agents.values()) { a.x = l.x + 400; a.z = l.z; }
    s.tick(100);
  }
  assert.equal(c.agents.size, 0);
  assert.ok(c.heat <= 15);
  assert.equal(sim.illegal.stats.escaped, 1);
  // Durunca ısı soğur
  const h = c.heat;
  s.tick(3000);
  assert.ok(c.heat < h);
  // Depoya git; polis yakındaysa kapı açılmaz
  const dz = SAFE_DROP.zone;
  place(s, p, (dz.minX + dz.maxX) / 2, (dz.minZ + dz.maxZ) / 2);
  c.agents.set('pol-test', { id: 'pol-test', kind: 'police', slot: 'rear', x: p.x + 20, z: p.z, yaw: 0, speed: 0 });
  assert.equal(ill(s, p, { act: 'drop' }).ok, false);
  c.agents.delete('pol-test');
  const w = p.wallet;
  const r = ill(s, p, { act: 'drop' });
  assert.ok(r.ok, r.error);
  assert.equal(p.wallet, w + r.pay);
  assert.ok(r.pay > s.o.cost, 'kâr');
  assert.equal(sim.logistics.jobOf(p), null);
  assert.equal(sim.illegal.chases.has(p.id), false);
  assert.equal(sim.illegal.stats.delivered, 1);
});

test('polis aracına çarpma ısıyı ve cezayı artırır; yükü boşaltmak takibi bitirmez; oyundan çıkınca ekipler kalkar', () => {
  const s = loadedRun();
  const { sim, p } = s;
  const c = s.chase();
  c.heat = 30;
  // Önündeki polis aracının içinden hızla geç
  const l0 = laneAt(500, 1, 0);
  place(s, p, l0.x, l0.z, l0.yaw);
  const ahead = laneAt(508, 1, 0);
  c.agents.set('pol-ram', { id: 'pol-ram', kind: 'police', slot: 'front', x: ahead.x, z: ahead.z, yaw: ahead.yaw, speed: 0 });
  for (let k = 1; k <= 6; k++) {
    const l = laneAt(500 + k * 2.4, 1, 0);
    sim.movePlayer(p.id, l.x, l.z, l.yaw);
    s.tick(100);
  }
  assert.ok(c.rams >= 1, 'çarpma sayıldı');
  assert.ok(c.heat >= 30 + R.HEAT_RAM - 1);
  // İptal: mallar yola dökülür ama takip sürer
  assert.ok(sim.logisticsAct(p.id, { act: 'cancel' }).ok);
  assert.ok(sim.illegal.chases.has(p.id));
  assert.equal(c.job, null);
  sim.removePlayer(p.id);
  assert.equal(sim.illegal.chases.size, 0);
  assert.equal([...sim.logistics.agents.keys()].filter((id) => id.startsWith('pol-')).length, 0);
});

test('bölge kontrolleri: yükleme K-17 dışında, teslim depo dışında reddedilir', () => {
  const s = withTruck();
  const { p, v } = s;
  ill(s, p, { act: 'buy', vehicle: v.id });
  const o = ill(s, p, { act: 'board' }).state.offers[0];
  ill(s, p, { act: 'accept', offer: o.id });
  assert.equal(ill(s, p, { act: 'load' }).ok, false);
  assert.ok(!inContactZone(p.x, p.z));
  place(s, p, CONTACT.zone.minX + 4, CONTACT.zone.minZ + 4);
  assert.ok(ill(s, p, { act: 'load' }).ok);
  assert.equal(ill(s, p, { act: 'drop' }).ok, false);
  assert.ok(!inDropZone(p.x, p.z));
});

test('polis şeritleri izler: virajda yolun dışına kaymaz, tırın yolu üzerindeki yuvasına yerleşir; hız sınırını aşmak ısı yazmaz', () => {
  const s = loadedRun();
  const { sim, p } = s;
  const c = s.chase();
  const drive = (x, z, yaw) => { sim.movePlayer(p.id, x, z, yaw); s.tick(100); };
  // En kıvrımlı yeri bul (ana gövdede yön değişimi en büyük olan nokta)
  let best = { s: 0, turn: 0 };
  for (let q = 160; q < TRUNK_LENGTH - 160; q += 10) {
    const a = laneAt(q - 25, 1, 0);
    const b = laneAt(q + 25, 1, 0);
    const turn = Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw)));
    if (turn > best.turn) best = { s: q, turn };
  }
  assert.ok(best.turn > 0.3, 'haritada belirgin bir viraj var');
  // Virajın 150 m öncesinden sağ şeritte ~16 m/sn (58 km/s) gerçekten sür; polisler her adımda yolun içinde olmalı
  let sq = best.s - 150;
  let l = laneAt(sq, 1, 0);
  const v = sim.vehicles.vehicles.get(p.vehicle.id);
  p.x = l.x; p.z = l.z; p.yaw = l.yaw; v.x = l.x; v.z = l.z; v.yaw = l.yaw;
  sim.logistics.track.delete(p.id);
  c.heat = 85; // 4 polis
  let maxOff = 0;
  for (let k = 0; k < 190; k++) {
    sq += 1.6;
    l = laneAt(sq, 1, 0);
    drive(l.x, l.z, l.yaw);
    c.heat = 85;
    for (const a of c.agents.values()) {
      const pr = roadProject(a.x, a.z, 'trunk');
      maxOff = Math.max(maxOff, pr.d - (pr.half - 1.2));
    }
  }
  assert.ok(c.agents.size >= 3, 'ekipler sahada');
  assert.ok(maxOff < 0.05, `polis yolun içinde kalır (aşım ${maxOff.toFixed(2)} m)`);
  // Arka yuvadaki polis tırın yolu üzerinde ~18 m geride (düz çizgide değil, yolun eğrisinde) ve aynı şeritte
  const rear = [...c.agents.values()].find((a) => a.slot === 'rear');
  const tp = roadProject(p.x, p.z, 'trunk');
  const rp = roadProject(rear.x, rear.z, 'trunk');
  assert.ok(Math.abs(tp.s - rp.s - 18) < 4, `arka yuva yol boyunca ~18 m geride (${(tp.s - rp.s).toFixed(1)})`);
  assert.ok(Math.abs(rp.l - tp.l) < 1.5, 'aynı şeritte');
  // Hız sınırı aşımı ısı yazmaz: hızlı sürüşte ısı yalnızca "otoyolda hareket" kadar artar
  sim.illegal.endChase(p.id);
  const c2 = sim.illegal.chaseOf(p.id, true);
  c2.job = sim.logistics.jobOf(p);
  c2.damage = c2.job.damage;
  c2.heat = 0;
  for (const sc of SCANNERS) c2.scanned[sc.id] = true; // gümrük kapısı rastgelesi bu ölçüme karışmasın
  for (let k = 0; k < 30; k++) {
    sq += 2.5; // ~25 m/sn ≈ 90 km/s
    l = laneAt(sq, 1, 0);
    drive(l.x, l.z, l.yaw);
  }
  assert.ok(c2.heat > 0, 'otoyolda hareket ısısı');
  assert.ok(c2.heat <= R.HEAT_ROAD * 3.2 + 1e-6, `yalnızca yol ısısı (${c2.heat.toFixed(2)})`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { CAR_BY_ID } from '../shared/cars.js';
import { HOTEL_DELIVERY } from '../shared/worldmap.js';
import { ILLEGAL_RULES as R, RAID_RULES as RR, DROP_SITES, CONTACT, SAFE_DROP, raidChance } from '../shared/illegal.js';

const config = {
  dayLengthSec: 100_000, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 400_000, starterBed: false,
  restaurantDiners: false, valetCustomers: false, basementGuests: false, logisticsOffers: false, policeRaids: false,
};
const KEY_A = 'a'.repeat(32);
const MIN = 60_000;

function setup({ extra = {} } = {}) {
  let now = 5_000_000;
  const sim = new HotelSimulation({ config: { ...config, ...extra, startDay: 1, startHour: 11 }, now: () => now, house: { store: null } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  const to = [];
  const out = [];
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  sim.on('out', (event, payload) => out.push({ event, payload }));
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  return { sim, to, out, tick, advance: (ms) => { now += ms; }, now: () => now };
}

const trucksOf = (sim, p) => [...sim.vehicles.vehicles.values()].filter((v) => v.type === 'car' && v.ownerId === p.id && CAR_BY_ID[v.model].body === 'truck');
const ill = (s, p, data) => s.sim.illegalAct(p.id, data);
const mid = (b) => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];

/** Tırı (x, z)'ye ışınla (hız ölçümü sıfırlanır) */
function place(s, p, x, z) {
  const v = s.sim.vehicles.vehicles.get(p.vehicle.id);
  p.x = x; p.z = z; v.x = x; v.z = z;
  s.sim.logistics.track.delete(p.id);
  s.advance(1000);
}

function withCompartment(opts) {
  const s = setup(opts);
  const p = s.sim.addPlayer('Şoför', KEY_A);
  assert.ok(s.sim.carAct(p.id, { act: 'buy', model: 'zeeland-lx', color: 0, source: 'wallet' }).ok);
  const v = trucksOf(s.sim, p)[0];
  s.sim.movePlayer(p.id, v.x + 1.5, v.z, 0);
  assert.ok(s.sim.vehicleAct(p.id, { act: 'mount', id: v.id }).ok);
  assert.ok(ill(s, p, { act: 'buy', vehicle: v.id }).ok);
  return { ...s, p, v };
}

/** Bölmeli tır + kaçak iş alınmış + K-17'de yüklenmiş */
function loadedRun(opts) {
  const s = withCompartment(opts);
  const { p } = s;
  const o = ill(s, p, { act: 'board' }).state.offers[0];
  assert.ok(ill(s, p, { act: 'accept', offer: o.id }).ok);
  place(s, p, ...mid(CONTACT.zone));
  assert.ok(ill(s, p, { act: 'load' }).ok);
  return { ...s, o, job: s.sim.logistics.jobOf(p) };
}

const session = (s, p) => s.sim.raids.sessions.get(p.id);

// ---- Teklif sıklığı + ekonomi --------------------------------------------------------------------

test('tanıdık teklifleri tek tek, 5–10 dk arayla gelir; kazanç 700–800 €; süresi dolan teklifin ardından da sayaç kurulur', () => {
  const s = withCompartment();
  const { sim, p } = s;
  const st0 = ill(s, p, { act: 'board' }).state;
  assert.equal(st0.offers.length, 1, 'bölme takılınca ilk teklif hemen');
  const o = st0.offers[0];
  assert.ok(o.pay >= R.PAY_MIN && o.pay <= R.PAY_MAX, `kazanç ${o.pay}`);
  assert.ok(o.cost >= R.COST_MIN && o.cost <= R.COST_MAX && o.cost < o.pay);
  // Teklifi al → yenisi hemen gelmez; sonraki 5–10 dk sonra
  assert.ok(ill(s, p, { act: 'accept', offer: o.id }).ok);
  const st1 = ill(s, p, { act: 'board' }).state;
  assert.equal(st1.offers.length, 0);
  assert.ok(st1.nextOfferIn >= 5 * MIN && st1.nextOfferIn <= 10 * MIN, `sonraki teklif ${st1.nextOfferIn} ms`);
  assert.ok(sim.logisticsAct(p.id, { act: 'cancel' }).ok);
  s.tick(5 * MIN - 2000, 1000);
  assert.equal(ill(s, p, { act: 'state' }).state.offers.length, 0, '5 dk dolmadan teklif yok');
  s.tick(5 * MIN + 2000, 1000);
  const st2 = ill(s, p, { act: 'state' }).state;
  assert.equal(st2.offers.length, 1, '10 dk içinde yeni teklif');
  assert.ok(s.to.some((m) => m.id === p.id && m.event === EVT.NOTIFY && /Yeni bir iş/.test(m.payload.text)), 'tanıdık haber verir');
  // Alınmayan teklif OFFER_TTL sonra kalkar; ardından yine 5–10 dk beklenir (aynı anda en çok 1 teklif)
  s.tick(R.OFFER_TTL_MS + 2000, 1000);
  const st3 = ill(s, p, { act: 'state' }).state;
  assert.ok(st3.offers.length <= 1);
  if (!st3.offers.length) assert.ok(st3.nextOfferIn > 0 && st3.nextOfferIn <= 10 * MIN);
});

test('baskın olasılığı: otel avlusu > gizli depo, saatten bağımsız, ısıyla artar, üst sınır; policeRaids:false → baskın yok', () => {
  assert.ok(raidChance('hotel') > raidChance('depot'));
  assert.equal(raidChance('depot'), DROP_SITES.depot.raid);
  assert.equal(raidChance('hotel', 0), DROP_SITES.hotel.raid, 'saatten bağımsız (gece indirimi yok)');
  assert.ok(raidChance('depot', 80) > raidChance('depot', 0));
  assert.ok(raidChance('hotel', 100) <= RR.MAX_CHANCE);
  assert.equal(raidChance('nowhere'), 0);
  // Kapalıyken onlarca indirmede bile baskın yok
  const s = loadedRun();
  const { sim, p } = s;
  place(s, p, ...mid(HOTEL_DELIVERY.zone));
  assert.ok(ill(s, p, { act: 'drop' }).ok);
  assert.equal(session(s, p).raid, false);
  assert.equal(session(s, p).chance, 0);
  sim.raids.stop(p.id);
});

// ---- İndirme -----------------------------------------------------------------------------------------

test('gizli depoda indirme ~10 sn sürer; tır kalkarsa yarıda kalır (yük tırda); bitince 700–800 € cüzdana', () => {
  const s = loadedRun();
  const { sim, p, o } = s;
  place(s, p, ...mid(SAFE_DROP.zone));
  const r = ill(s, p, { act: 'drop' });
  assert.ok(r.ok && r.unloading && r.site === 'depot', r.error);
  assert.equal(ill(s, p, { act: 'drop' }).ok, false, 'indirme zaten sürüyor');
  assert.equal(ill(s, p, { act: 'state' }).state.unload.site, 'depot');
  s.tick(4000);
  // Tır bölgeden çıkar → yarıda kalır
  place(s, p, SAFE_DROP.zone.maxX + 30, SAFE_DROP.zone.maxZ + 30);
  s.tick(300);
  assert.equal(session(s, p), undefined);
  assert.equal(sim.logistics.jobOf(p).state, 'loaded', 'mallar hâlâ bölmede');
  // Yeniden: bu kez bekle
  place(s, p, ...mid(SAFE_DROP.zone));
  const w = p.wallet;
  assert.ok(ill(s, p, { act: 'drop' }).ok);
  s.tick(RR.UNLOAD_MS - 1000);
  assert.equal(p.wallet, w, 'henüz bitmedi');
  s.tick(1500);
  assert.equal(p.wallet, w + o.pay);
  assert.ok(o.pay >= R.PAY_MIN && o.pay <= R.PAY_MAX);
  assert.equal(sim.logistics.jobOf(p), null);
  assert.equal(sim.illegal.stats.delivered, 1);
});

test('otelin mal kabul alanında da indirilir (kaçak mal otel stoğuna girmez)', () => {
  const s = loadedRun();
  const { sim, p, o } = s;
  const stock = JSON.stringify(sim.cargo.serialize?.().stock ?? null);
  place(s, p, ...mid(HOTEL_DELIVERY.zone));
  sim.raids.forceNext = 'none';
  const w = p.wallet;
  const r = ill(s, p, { act: 'drop', site: 'hotel' });
  assert.ok(r.ok && r.site === 'hotel', r.error);
  assert.equal(ill(s, p, { act: 'drop', site: 'depot' }).ok, false);
  s.tick(RR.UNLOAD_MS + 300);
  assert.equal(p.wallet, w + o.pay);
  assert.equal(JSON.stringify(sim.cargo.serialize?.().stock ?? null), stock, 'stok değişmedi');
});

// ---- Baskın ----------------------------------------------------------------------------------------------

test('otel avlusunda baskın: uyarı → ekipler körfeze gelir → mallara el, ceza (0\'ın altına inmez), otel itibarı −3, duyuru', () => {
  const s = loadedRun();
  const { sim, p, job } = s;
  place(s, p, ...mid(HOTEL_DELIVERY.zone));
  p.wallet = 120;
  sim.growth.reputation = 50;
  const rep = sim.growth.reputation;
  sim.raids.forceNext = 'raid';
  assert.ok(ill(s, p, { act: 'drop' }).ok);
  const ss = session(s, p);
  assert.equal(ss.raid, true);
  assert.equal(ill(s, p, { act: 'state' }).state.unload.raid, null, 'uyarıdan önce baskın gizli');
  // Uyarı erken gelsin: ekipler indirme bitmeden varır
  ss.warnAt = s.now() + 500;
  ss.arriveAt = ss.warnAt + RR.ETA_MS;
  s.tick(800);
  assert.ok(ss.warned);
  assert.ok(s.to.some((m) => m.id === p.id && m.event === EVT.NOTIFY && /Baskın/.test(m.payload.text)));
  const units = [...sim.logistics.agents.keys()].filter((id) => id.startsWith('raid-'));
  assert.equal(units.length, RR.UNITS);
  assert.ok(ill(s, p, { act: 'state' }).state.unload.raid.arriveAt > s.now());
  // Ekipler varıncaya kadar körfeze yaklaşır
  const d0 = Math.hypot(sim.logistics.agents.get(units[0]).x - p.x, sim.logistics.agents.get(units[0]).z - p.z);
  s.tick(3000);
  const d1 = Math.hypot(sim.logistics.agents.get(units[0]).x - p.x, sim.logistics.agents.get(units[0]).z - p.z);
  assert.ok(d1 < d0, `yaklaşır ${d0.toFixed(1)} → ${d1.toFixed(1)}`);
  s.tick(RR.ETA_MS);
  assert.equal(session(s, p), undefined);
  assert.equal(sim.logistics.jobOf(p), null, 'mallara el konuldu');
  assert.equal(job.state, 'loaded');
  assert.equal(p.wallet, 0, 'ceza cüzdanı sıfırladı, eksiye düşmedi');
  assert.equal(sim.growth.reputation, rep - RR.HOTEL_REP);
  assert.ok(s.out.some((m) => m.event === EVT.NOTIFY && /baskın/.test(m.payload.text)), 'herkese duyuru');
  assert.equal([...sim.logistics.agents.keys()].filter((id) => id.startsWith('raid-')).length, 0, 'ekipler çekildi');
  assert.equal(sim.raids.stats.busted, 1);
  const caught = s.to.find((m) => m.event === EVT.ILLEGAL_STATE && m.payload.caught);
  assert.equal(caught.payload.caught.raid, 'hotel');
});

test('gizli depoda baskında yakalanma otel itibarını etkilemez; polis geç kalırsa kazanç ödenir ve ısı kalır', () => {
  const s = loadedRun();
  const { sim, p, o } = s;
  place(s, p, ...mid(SAFE_DROP.zone));
  sim.growth.reputation = 50;
  const rep = sim.growth.reputation;
  // Geç kalan baskın: varış indirmenin bitişinden sonra
  sim.raids.forceNext = 'raid';
  assert.ok(ill(s, p, { act: 'drop' }).ok);
  const ss = session(s, p);
  ss.warnAt = s.now() + RR.WARN_MAX_MS;
  ss.arriveAt = ss.warnAt + RR.ETA_MS;
  const w = p.wallet;
  s.tick(RR.UNLOAD_MS + 300);
  assert.equal(p.wallet, w + o.pay, 'indirme bitti, kazanç ödendi');
  assert.equal(sim.raids.stats.late, 1);
  assert.ok(sim.illegal.chases.get(p.id)?.heat >= RR.SEEN_HEAT - 1, 'görüldün: ısı (birkaç adımlık soğuma payı)');
  assert.equal(sim.growth.reputation, rep);
  // İkinci tur: depoda yakalanma → itibar değişmez
  const o2 = (() => {
    sim.illegal.nextOffer.set(p.id, s.now() - 1);
    return ill(s, p, { act: 'board' }).state.offers[0];
  })();
  assert.ok(ill(s, p, { act: 'accept', offer: o2.id }).ok);
  place(s, p, ...mid(CONTACT.zone));
  sim.illegal.chases.get(p.id) && (sim.illegal.chases.get(p.id).heat = 0);
  assert.ok(ill(s, p, { act: 'load' }).ok);
  place(s, p, ...mid(SAFE_DROP.zone));
  sim.raids.forceNext = 'raid';
  assert.ok(ill(s, p, { act: 'drop' }).ok);
  const s2 = session(s, p);
  s2.warnAt = s.now() + 300;
  s2.arriveAt = s2.warnAt + RR.ETA_MS;
  s.tick(RR.ETA_MS + 800);
  assert.equal(sim.logistics.jobOf(p), null);
  assert.equal(sim.raids.stats.busted, 1);
  assert.equal(sim.growth.reputation, rep, 'depoda itibar kaybı yok');
});

test('baskın uyarısından sonra kaçmak: ekipler kıskaç takibine devrolur, ısı ≥ 70, mallar tırda', () => {
  const s = loadedRun();
  const { sim, p, job } = s;
  place(s, p, ...mid(HOTEL_DELIVERY.zone));
  sim.raids.forceNext = 'raid';
  assert.ok(ill(s, p, { act: 'drop' }).ok);
  const ss = session(s, p);
  ss.warnAt = s.now() + 300;
  ss.arriveAt = ss.warnAt + RR.ETA_MS;
  s.tick(600);
  assert.ok(ss.warned);
  const ids = ss.units.map((u) => u.id);
  // Avludan çık (sür)
  place(s, p, HOTEL_DELIVERY.zone.minX - 25, HOTEL_DELIVERY.zone.minZ - 25);
  s.tick(200);
  assert.equal(session(s, p), undefined);
  const c = sim.illegal.chases.get(p.id);
  assert.ok(c, 'takip başladı');
  assert.ok(c.heat >= RR.FLEE_HEAT - 1e-9, `ısı ${c.heat}`);
  assert.equal(c.job, job, 'mallar tırda');
  for (const id of ids) assert.ok(c.agents.has(id), 'baskın ekibi takipte');
  assert.equal(sim.raids.stats.fled, 1);
  assert.equal(sim.logistics.jobOf(p).state, 'loaded');
  // Oyundan çıkınca her şey kalkar
  sim.removePlayer(p.id);
  assert.equal(sim.logistics.agents.size, 0);
});

test('indirme doğrulaması: yanlış yerde, hareket hâlinde ya da yükü olmadan reddedilir', () => {
  const s = loadedRun();
  const { sim, p } = s;
  assert.equal(ill(s, p, { act: 'drop' }).ok, false, 'K-17 teslim yeri değil');
  place(s, p, ...mid(SAFE_DROP.zone));
  assert.equal(ill(s, p, { act: 'drop', site: 'moon' }).ok, false);
  assert.equal(ill(s, p, { act: 'drop', site: 7 }).ok, false);
  const [x, z] = mid(SAFE_DROP.zone);
  s.advance(500); sim.movePlayer(p.id, x + 3, z, 0);
  s.advance(500); sim.movePlayer(p.id, x + 6, z, 0);
  const moving = ill(s, p, { act: 'drop' });
  assert.equal(moving.ok, false);
  assert.match(moving.error, /dur/);
  sim.logisticsAct(p.id, { act: 'cancel' });
  place(s, p, x, z);
  assert.equal(ill(s, p, { act: 'drop' }).ok, false, 'yük yok');
});

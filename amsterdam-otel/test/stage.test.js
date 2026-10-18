import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { RECEPTION_PC, BAR, PLAYER_HOUSES, ALLEY, buildWallSegments, areaAt } from '../shared/layout.js';
import {
  STAGE, STAGE_ACTS, STAGE_ACT_BY_ID, STAGE_RULES, CROWD_SPOTS, stagePhaseAt, faceStage,
} from '../shared/stage.js';

// Gün 240 gerçek sn (07:00 → 23:00 = 960 oyun dk → 4 oyun dk/sn): set 240 dk = 60 sn, mola 15 sn
const config = {
  dayLengthSec: 240, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
  restaurantDiners: false, // restoran müşterileri kapalı: RNG dizisi ve kasa bu testlerde değişmesin
};
const KEY = 'c'.repeat(32);

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function setup({ store = null, hour = 10, money = 5000, day = 1, cfg = {} } = {}) {
  let now = 5_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: day, startHour: hour, ...cfg }, rng: seeded(), now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  const p = sim.addPlayer('Deniz', KEY);
  sim.guests.nextSpawnAt = Infinity; // misafirler ve bar müşterileri bu testlere karışmasın
  sim.bar.nextSpawnAt = Infinity;
  sim.money = money;
  const tick = (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
    }
  };
  const at = ([x, z]) => sim.movePlayer(p.id, x, z, 0);
  const act = (data) => sim.stageAct(p.id, data);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  const crowdWires = () => sim.stage.serializeWires();
  return { sim, p, tick, at, act, events, crowdWires, out, getNow: () => now };
}

/** Sahneyi satın alıp sahnenin önüne geç */
function owned(opts) {
  const t = setup(opts);
  t.at(RECEPTION_PC.point);
  assert.equal(t.act({ act: 'buy' }).ok, true);
  t.at(STAGE.point);
  return t;
}

test('yerleşim: sahne Achterstraat\'ta, kapıları ve duvarları kesmiyor, kalabalık sokakta', () => {
  const b = STAGE.bounds;
  assert.ok(b.minX > ALLEY.bounds.minX && b.maxX < ALLEY.bounds.maxX && b.minZ >= 26.1, 'sokağın içinde');
  assert.ok(b.maxX < ALLEY.backDoor.from - 4, 'otelin arka kapısından uzak');
  for (const h of PLAYER_HOUSES) {
    assert.ok(h.doorPoint[1] - STAGE.steps.maxZ >= 1.6, `${h.id} kapısının önü açık (≥ 1.6 m yürüme yolu)`);
  }
  assert.equal(areaAt(...STAGE.point), 'alley');
  assert.equal(areaAt(...STAGE.center), 'alley');
  const walls = buildWallSegments().filter((w) => !w.lintel);
  for (const [x, z] of [STAGE.point, ...CROWD_SPOTS]) {
    assert.equal(areaAt(x, z), 'alley', `kalabalık noktası sokakta: ${x},${z}`);
    assert.ok(z < 32.25, 'evlerin önündeki kaldırıma taşmaz');
    assert.ok(!(x > b.minX - 0.2 && x < b.maxX + 0.2 && z < STAGE.steps.maxZ + 0.2), 'sahnenin üstünde değil');
    for (const w of walls) assert.ok(!(x > w.minX - 0.25 && x < w.maxX + 0.25 && z > w.minZ - 0.25 && z < w.maxZ + 0.25), 'duvarda değil');
  }
  assert.equal(new Set(CROWD_SPOTS.map((s) => s.join())).size, CROWD_SPOTS.length, 'noktalar farklı');
  assert.ok(CROWD_SPOTS.length >= STAGE_RULES.MAX_CROWD);
  // Kalabalık sahneye bakar
  const [x, z] = CROWD_SPOTS[0];
  assert.ok(Math.abs(faceStage(x, z) - Math.PI) < 0.01, 'tam önündeki kişi kuzeyden güneye bakar');
  for (const a of STAGE_ACTS) assert.ok(a.crowd <= STAGE_RULES.MAX_CROWD && a.barTip >= 1.5 && a.barTip <= 1.8);
});

test('set / mola takvimi: SET → MOLA → SET … gün sonunda biter', () => {
  const S = STAGE_RULES.SET_MIN;
  const B = STAGE_RULES.BREAK_MIN;
  const bk = { startTotal: 1000, endTotal: 1000 + 2 * (S + B) + 100 };
  assert.deepEqual(stagePhaseAt(bk, 1000), { phase: 'set', setNo: 0, from: 1000, to: 1000 + S });
  assert.equal(stagePhaseAt(bk, 1000 + S - 1).phase, 'set');
  assert.deepEqual(stagePhaseAt(bk, 1000 + S), { phase: 'break', setNo: 0, from: 1000 + S, to: 1000 + S + B });
  assert.deepEqual(stagePhaseAt(bk, 1000 + S + B), { phase: 'set', setNo: 1, from: 1000 + S + B, to: 1000 + 2 * S + B });
  // Son set gün sonunda kesilir
  const last = stagePhaseAt(bk, bk.endTotal - 1);
  assert.equal(last.phase, 'set');
  assert.equal(last.setNo, 2);
  assert.equal(last.to, bk.endTotal);
  assert.equal(stagePhaseAt(bk, bk.endTotal).phase, 'over');
  assert.equal(stagePhaseAt(null, 5).phase, 'over');
});

test('sahne satın alma: Resepsiyon PC başında, yeterli kasa, yalnızca bir kez', () => {
  const t = setup({ money: STAGE.PRICE - 1 });
  t.at(STAGE.point);
  assert.match(t.act({ act: 'buy' }).error, /Resepsiyon bilgisayarının/);
  t.at(RECEPTION_PC.point);
  assert.match(t.act({ act: 'buy' }).error, /Kasada yeterli para yok/);
  assert.equal(t.sim.stage.owned, false);
  t.sim.money = STAGE.PRICE + 50;
  const res = t.act({ act: 'buy' });
  assert.equal(res.ok, true);
  assert.equal(t.sim.money, 50, 'fiyat kasadan düştü');
  assert.equal(t.sim.stage.owned, true);
  assert.equal(t.events(EVT.STAGE_STATE).at(-1).owned, true, 'herkese yayınlandı');
  assert.ok(t.events(EVT.ECONOMY).some((e) => e.delta === -STAGE.PRICE));
  t.sim.money = 99_999;
  assert.match(t.act({ act: 'buy' }).error, /zaten/);
  assert.equal(t.sim.money, 99_999, 'ikinci kez para alınmaz');
  // Geçersiz istekler
  for (const bad of [null, 'buy', 42, [], {}, { act: 'BUY' }, { act: { toString: () => 'buy' } }, { act: '__proto__' }]) {
    assert.equal(t.act(bad).ok, false);
  }
  assert.equal(t.sim.snapshot(t.p.id).stage.owned, true);
});

test('grup kiralama: sahne, mesafe, tip doğrulaması, kasa, günde tek grup', () => {
  const t = setup();
  t.at(STAGE.point);
  assert.match(t.act({ act: 'hire', id: 'guitar' }).error, /Önce sahne/);
  t.at(RECEPTION_PC.point);
  t.act({ act: 'buy' });
  assert.match(t.act({ act: 'hire', id: 'guitar' }).error, /Sahnenin önünde/);
  t.at(STAGE.point);
  for (const id of [undefined, null, 1, ['dj'], { toString: () => 'dj' }, 'DJ', 'piano', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const r = t.act({ act: 'hire', id });
    assert.equal(r.ok, false, `geçersiz grup: ${String(id)}`);
    assert.match(r.error, /Böyle bir grup yok/);
  }
  t.sim.money = STAGE_ACT_BY_ID.jazz.fee - 1;
  assert.match(t.act({ act: 'hire', id: 'jazz' }).error, /Kasada yeterli para yok/);
  assert.equal(t.sim.stage.booking, null);
  t.sim.money = 1000;
  const res = t.act({ act: 'hire', id: 'dj' });
  assert.equal(res.ok, true);
  assert.equal(t.sim.money, 1000 - STAGE_ACT_BY_ID.dj.fee);
  const bk = t.sim.stage.booking;
  assert.equal(bk.act, 'dj');
  assert.equal(bk.day, t.sim.clock.dayCount);
  assert.equal(bk.endTotal, t.sim.clock.dayCount * 1440 + 23 * 60, 'gün sonuna (23:00) kadar');
  assert.equal(t.sim.stage.phase, 'set', 'ilk set hemen başlar');
  assert.equal(t.sim.stage.setAt, t.getNow());
  const st = t.events(EVT.STAGE_STATE).at(-1);
  assert.equal(st.phase, 'set');
  assert.equal(st.booking.act, 'dj');
  assert.equal(st.setAt, t.getNow());
  // Aynı gün ikinci grup olmaz
  const again = t.act({ act: 'hire', id: 'guitar' });
  assert.match(again.error, /günde tek grup/);
  assert.equal(t.sim.money, 1000 - STAGE_ACT_BY_ID.dj.fee);
});

test('gece ve 22:00 sonrası grup kiralanamaz', () => {
  const late = owned({ hour: 22 });
  assert.match(late.act({ act: 'hire', id: 'guitar' }).error, /çok geç/);
  const night = owned({ hour: 22 });
  night.sim.clock.minute = 23 * 60 + 30;
  assert.equal(night.sim.clock.night, true);
  assert.match(night.act({ act: 'hire', id: 'guitar' }).error, /Gece/);
  assert.equal(night.sim.stage.booking, null);
});

test('kalabalık: set başında birer birer gelir, sayısı gruba göre; dans eder', () => {
  for (const a of STAGE_ACTS) {
    const t = owned();
    assert.equal(t.act({ act: 'hire', id: a.id }).ok, true);
    assert.equal(t.crowdWires().length, 1, 'ilk kişi hemen');
    t.tick(STAGE_RULES.CROWD_GAP_MS * (a.crowd + 1));
    const wires = t.crowdWires();
    assert.equal(wires.length, a.crowd, `${a.id}: ${a.crowd} kişi`);
    assert.ok(wires.every((w) => w.kind === 'crowd'));
    assert.equal(new Set(wires.map((w) => w.id)).size, wires.length);
    // Misafir kimlik sayacıyla ortak
    assert.ok(wires.every((w) => w.id < t.sim.guests.nextId));
    const ups = t.events(EVT.GUEST_UPSERT).filter((g) => g.kind === 'crowd');
    assert.ok(ups.some((g) => g.phase === 'c-walk' && g.path.length > 2), 'yürüyerek gelir');
    // Hepsi yerine varır (en uzun rota steeg'den ~38 m) ve sahneye bakar
    t.tick(30_000);
    for (const w of t.crowdWires()) {
      assert.ok(w.phase === 'c-dance' || w.phase === 'c-clap', w.phase);
      assert.equal(w.path.length, 1);
      const spot = CROWD_SPOTS.find((s) => s[0] === w.path[0][0] && s[1] === w.path[0][1]);
      assert.ok(spot, 'yarım çemberdeki bir noktada');
      assert.ok(Math.abs(w.face - faceStage(...spot)) < 1e-9);
    }
    if (a.id === 'dj') assert.ok(t.crowdWires().every((w) => w.phase === 'c-dance'), 'DJ: herkes dans eder');
    // Snapshot misafir listesinde de var
    assert.equal(t.sim.snapshot(t.p.id).guests.filter((g) => g.kind === 'crowd').length, a.crowd);
  }
});

test('set bitince kalabalık arka kapıdan bara yürür, bar bonusu verilir; mola sonra yeni set', () => {
  const t = owned();
  t.act({ act: 'hire', id: 'jazz' });
  const jazz = STAGE_ACT_BY_ID.jazz;
  const moneyBefore = t.sim.money;
  // Set: 240 oyun dk = 60 sn
  t.tick(59_000);
  assert.equal(t.sim.stage.phase, 'set');
  assert.equal(t.crowdWires().length, jazz.crowd);
  assert.equal(t.sim.boosts.has('stage'), false);
  t.tick(1500);
  assert.equal(t.sim.stage.phase, 'break');
  assert.equal(t.sim.stage.setAt, null);
  assert.equal(t.events(EVT.STAGE_STATE).at(-1).phase, 'break');
  const leaving = t.crowdWires();
  assert.equal(leaving.length, jazz.crowd);
  assert.ok(leaving.every((w) => w.phase === 'c-leave'));
  const toBar = leaving.filter((w) => {
    const end = w.path.at(-1);
    return end[0] === BAR.points.doorEast[0] && end[1] === BAR.points.doorEast[1];
  });
  assert.ok(toBar.length >= Math.ceil(jazz.crowd / 2), 'çoğu bara');
  assert.ok(toBar.every((w) => w.path.some((pt) => pt[0] === 0 && pt[1] > 25 && pt[1] < 26)), 'arka kapıdan geçer');
  // Bahşiş kavanozu: oyuncu sahnenin yanında → seyirci başına kasaya
  assert.equal(t.sim.money, moneyBefore + jazz.crowd * STAGE_RULES.TIP_PER_FAN);
  // İlk kişi barın kapısına varınca bonus
  t.tick(35_000);
  assert.equal(t.sim.boosts.has('stage'), true);
  const boost = t.sim.boosts.list.find((b) => b.source === 'stage');
  assert.equal(boost.barTip, jazz.barTip);
  assert.equal(boost.barSpawn, jazz.barSpawn);
  assert.equal(boost.guestSpawn, 1);
  assert.equal(boost.untilTotal > t.sim.clock.total, true);
  assert.ok(t.events(EVT.NOTIFY).some((n) => /Set bitti! Kalabalık Bar De Tulp'a akın ediyor — bar bahşişleri %80 arttı/.test(n.text)));
  assert.ok(t.events(EVT.BOOSTS).at(-1).some((b) => b.source === 'stage'));
  assert.equal(t.sim.boosts.barTip, jazz.barTip);
  // Mola bitti (15 sn) → 2. set: yeni kalabalık (eskiler gitti)
  t.tick(20_000);
  assert.equal(t.sim.stage.phase, 'set');
  assert.equal(t.sim.stage.setNo, 1);
  const removed = new Set(t.events(EVT.GUEST_REMOVE));
  assert.ok(leaving.every((w) => removed.has(w.id)), 'giden kalabalık kayboldu');
  t.tick(STAGE_RULES.CROWD_GAP_MS * (jazz.crowd + 1));
  assert.equal(t.crowdWires().length, jazz.crowd);
});

test('gün sonu (23:00): son set biter, kalabalık dağılır, bar bonusu yok; ertesi gün yeni grup', () => {
  const t = owned({ hour: 21 });
  t.act({ act: 'hire', id: 'guitar' });
  t.tick(STAGE_RULES.CROWD_GAP_MS * 6);
  assert.equal(t.crowdWires().length, STAGE_ACT_BY_ID.guitar.crowd);
  // 21:00 → 23:00 = 120 oyun dk = 30 sn (set 240 dk'dan kısa: gün sonunda kesilir)
  t.tick(31_000);
  assert.equal(t.sim.clock.night, true);
  assert.equal(t.sim.stage.phase, 'over');
  assert.ok(t.crowdWires().every((w) => w.phase === 'c-leave' && w.path.at(-1)[0] < -17));
  t.tick(20_000);
  assert.equal(t.crowdWires().length, 0);
  assert.equal(t.sim.boosts.has('stage'), false, 'bar kapalı: bonus yok');
  assert.ok(t.events(EVT.NOTIFY).some((n) => /Konser bitti/.test(n.text)));
  assert.match(t.act({ act: 'hire', id: 'dj' }).error, /Gece/);
  // Sabah: dünkü rezervasyon düşer, yeni grup tutulabilir
  t.sim.checkAllAsleep = () => {};
  t.sim.clock.sleepThrough();
  t.tick(200);
  assert.equal(t.sim.stage.booking, null);
  assert.equal(t.events(EVT.STAGE_STATE).at(-1).booking, null);
  assert.equal(t.act({ act: 'hire', id: 'dj' }).ok, true);
});

test('gece kapalıyken (23:00 → doğrudan sabah) süren setin kalabalığı da dağılır', () => {
  const t = owned({ hour: 22, cfg: { nightLengthSec: 0 } });
  t.sim.clock.minute = 21 * 60 + 50;
  t.act({ act: 'hire', id: 'dj' });
  t.tick(5000);
  assert.ok(t.crowdWires().length > 0);
  t.sim.clock.minute = 23 * 60 - 0.01;
  t.tick(300);
  assert.equal(t.sim.stage.booking, null);
  assert.ok(t.crowdWires().every((w) => w.phase === 'c-leave'));
  t.tick(25_000);
  assert.equal(t.crowdWires().length, 0);
  assert.equal(t.sim.boosts.has('stage'), false);
});

test('kalıcılık: sahne + bugünkü rezervasyon geri yüklenir; bozuk kayıt yok sayılır', () => {
  const store = memoryStore();
  const t = owned({ store });
  t.act({ act: 'hire', id: 'jazz' });
  t.sim.house.saveNow?.();
  t.sim.house.flush?.();
  const saved = t.sim.hotelState();
  assert.deepEqual(saved.stage.booking.act, 'jazz');
  assert.equal(saved.stage.owned, true);
  // Aynı gün: rezervasyon sürer, set devam eder (kalabalık yeniden gelir)
  const t2 = setup({ store: memoryStore({ hotel: saved }) });
  t2.at(STAGE.point);
  assert.equal(t2.sim.stage.owned, true);
  assert.equal(t2.sim.stage.booking.act, 'jazz');
  t2.tick(200);
  assert.equal(t2.sim.stage.phase, 'set');
  assert.ok(t2.crowdWires().length >= 1);
  assert.match(t2.act({ act: 'hire', id: 'dj' }).error, /tek grup/);
  // Başka gün: sahne kalır, rezervasyon düşer
  const t3 = setup({ store: memoryStore({ hotel: { ...saved, day: saved.day + 1, minute: 9 * 60 } }) });
  t3.tick(200);
  assert.equal(t3.sim.stage.owned, true);
  assert.equal(t3.sim.stage.booking, null);
  assert.equal(t3.crowdWires().length, 0);
  // Bozuk kayıtlar
  const bads = [
    null, 5, 'x', [], { owned: 'true' }, { owned: 1 },
    { owned: false, booking: saved.stage.booking },
    { owned: true, booking: { ...saved.stage.booking, act: '__proto__' } },
    { owned: true, booking: { ...saved.stage.booking, act: 'opera' } },
    { owned: true, booking: { ...saved.stage.booking, day: -1 } },
    { owned: true, booking: { ...saved.stage.booking, day: 1.5 } },
    { owned: true, booking: { ...saved.stage.booking, startTotal: 'x' } },
    { owned: true, booking: { ...saved.stage.booking, endTotal: saved.stage.booking.startTotal } },
    { owned: true, booking: { ...saved.stage.booking, endTotal: Infinity } },
    { owned: true, booking: { ...saved.stage.booking, endTotal: saved.stage.booking.startTotal + 5000 } },
  ];
  for (const bad of bads) {
    const tb = setup({ store: memoryStore({ hotel: { ...saved, stage: bad } }) });
    assert.equal(tb.sim.stage.booking, null, JSON.stringify(bad));
    assert.equal(tb.sim.stage.owned, bad?.owned === true);
    tb.tick(200);
    assert.equal(tb.crowdWires().length, 0);
  }
  // Eski kayıt (stage alanı yok)
  const old = { ...saved };
  delete old.stage;
  const to = setup({ store: memoryStore({ hotel: old }) });
  assert.equal(to.sim.stage.owned, false);
});

test('duraklatma: kalabalığın ve setin zaman damgaları kayar', () => {
  const t = owned();
  t.act({ act: 'hire', id: 'guitar' });
  const c = t.sim.stage.crowd.values().next().value;
  const t0 = c.t0;
  const setAt = t.sim.stage.setAt;
  t.sim.stage.shiftTime(5000);
  assert.equal(c.t0, t0 + 5000);
  assert.equal(t.sim.stage.setAt, setAt + 5000);
});

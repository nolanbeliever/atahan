import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, START_WALLET } from '../shared/constants.js';
import { HOUSE } from '../shared/layout.js';
import {
  FURNITURE_BY_ID, HOUSE_RULES, validatePlacement, candidateFromPoint, parseYouTubeId, itemAtPoint,
} from '../shared/house.js';

const config = {
  dayLengthSec: 240, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16,
};

function memoryStore(initial = null) {
  return { data: initial, saves: 0, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); this.saves++; } };
}

function setup({ store = null, fetchVideoInfo = null } = {}) {
  let now = 1_000_000;
  const sim = new HotelSimulation({ config, now: () => now, house: { store, fetchVideoInfo } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  const p = sim.addPlayer('Ev');
  const inHouse = (x = -12, z = 4) => sim.movePlayer(p.id, x, z, 0);
  return { sim, p, out, inHouse, advance: (ms) => { now += ms; } };
}

test('YouTube linki ayrıştırma', () => {
  assert.equal(parseYouTubeId('https://youtube.com/watch?v=LDvCJywosJU&is=RaXCluagdZ3lzFH3'), 'LDvCJywosJU');
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeId('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeId('javascript:alert(1)'), null);
  assert.equal(parseYouTubeId('https://youtube.com/watch?v=short'), null);
  assert.equal(parseYouTubeId(''), null);
  assert.equal(parseYouTubeId(null), null);
});

test('yerleşim kuralları: sınırlar, kapı önü, çakışma, halı, LED', () => {
  const sofa = { type: 'sofa', x: -13, z: 5, rot: 0, color: 0 };
  assert.equal(validatePlacement([], sofa).ok, true);
  assert.equal(validatePlacement([], { ...sofa, x: -15.5 }).ok, false, 'duvardan taşar');
  assert.equal(validatePlacement([], { ...sofa, x: -12, z: 0.7 }).ok, false, 'kapının önü');
  assert.equal(validatePlacement([], { ...sofa, color: 99 }).ok, false, 'geçersiz renk');
  assert.equal(validatePlacement([], { ...sofa, rot: 1.5 }).ok, false, 'geçersiz yön');
  assert.equal(validatePlacement([], { ...sofa, type: 'jacuzzi' }).ok, false);
  assert.equal(validatePlacement([sofa], { type: 'armchair', x: -13.5, z: 5, rot: 0, color: 0 }).ok, false, 'çakışma');
  assert.equal(validatePlacement([sofa], { type: 'rug', x: -13, z: 5, rot: 0, color: 0 }).ok, true, 'halı koltuğun altına girer');
  assert.equal(validatePlacement([], { type: 'rug', x: -12, z: 1.0, rot: 0, color: 0 }).ok, true, 'halı kapı önüne serilebilir');
  // Döndürülünce ayak izi değişir
  assert.equal(validatePlacement([], { ...sofa, x: -15.3, rot: 1 }).ok, true);

  const I = HOUSE.inner;
  const led = { type: 'led', x: -12, z: I.maxZ, rot: 0, color: 2 };
  assert.equal(validatePlacement([], led).ok, true, 'arka duvara LED');
  assert.equal(validatePlacement([], { ...led, z: 5 }).ok, false, 'LED havada olamaz');
  assert.equal(validatePlacement([led], { ...led, x: -11.5 }).ok, false, 'aynı duvarda üst üste LED');
  assert.equal(validatePlacement([led], { ...led, x: -14.5 }).ok, true);
  assert.equal(validatePlacement([], { type: 'led', x: -12, z: I.minZ, rot: 2, color: 0 }).ok, false, 'kapının üstüne LED yok');
  assert.equal(validatePlacement([], { type: 'led', x: I.minX, z: 4, rot: 1, color: 0 }).ok, true, 'batı duvarı');
  assert.equal(validatePlacement([sofa], led).ok, true, 'LED yerdeki eşyalarla çakışmaz');
});

test('aday üretimi: ızgaraya oturur, içeride kalır, LED en yakın duvara yapışır', () => {
  const sofa = FURNITURE_BY_ID.sofa;
  const c = candidateFromPoint(sofa, -13.11, 5.13, 0);
  assert.deepEqual([c.x, c.z], [-13, 5.25]);
  const edge = candidateFromPoint(sofa, -20, 50, 0);
  assert.equal(validatePlacement([], { ...edge, type: 'sofa', color: 0 }).ok, true, 'sınır dışı nokta içeri çekilir');
  const led = FURNITURE_BY_ID.led;
  const w = candidateFromPoint(led, -15.5, 4, 0);
  assert.equal(w.rot, 1);
  assert.equal(w.x, HOUSE.inner.minX);
  const back = candidateFromPoint(led, -12, 7.6, 3);
  assert.equal(back.rot, 0);
  assert.equal(back.z, HOUSE.inner.maxZ);
});

test('eşyanın üstündeki nokta: katı eşya halıdan önce seçilir', () => {
  const items = [
    { id: 1, type: 'rug', x: -13, z: 5, rot: 0, color: 0 },
    { id: 2, type: 'table', x: -13, z: 5, rot: 0, color: 0 },
  ];
  assert.equal(itemAtPoint(items, -13, 5).id, 2);
  assert.equal(itemAtPoint(items, -12.1, 5.6).id, 1);
  assert.equal(itemAtPoint(items, -9, 2), null);
});

test('satın alıp yerleştirme, herkese yayın, kaldırınca yarı iade', () => {
  const { sim, p, out, inHouse } = setup();
  const data = { type: 'sofa', x: -13, z: 5, rot: 0, color: 1 };
  assert.equal(sim.housePlace(p.id, data).ok, false, 'ev dışında');
  inHouse();
  const res = sim.housePlace(p.id, data);
  assert.equal(res.ok, true);
  assert.equal(p.wallet, START_WALLET - FURNITURE_BY_ID.sofa.price);
  assert.ok(out.some((e) => e.event === EVT.HOUSE_ADDED && e.payload.id === res.item.id));
  assert.equal(sim.housePlace(p.id, data).ok, false, 'aynı yere ikinci kanepe');
  p.wallet = 3;
  assert.equal(sim.housePlace(p.id, { type: 'tv', x: -14, z: 2.5, rot: 0, color: 0 }).ok, false, 'para yetmez');
  const rem = sim.houseRemove(p.id, res.item.id);
  assert.equal(rem.ok, true);
  assert.equal(rem.refund, Math.floor(FURNITURE_BY_ID.sofa.price * HOUSE_RULES.REFUND));
  assert.equal(p.wallet, 3 + rem.refund);
  assert.ok(out.some((e) => e.event === EVT.HOUSE_REMOVED && e.payload === res.item.id));
  assert.equal(sim.houseRemove(p.id, 9999).ok, false);
  assert.ok(sim.snapshot(p.id).house.items.length === 0);
});

test('prototip anahtarları (constructor, __proto__) sunucuyu çökertmez, cüzdanı bozmaz', () => {
  const { sim, p, inHouse } = setup();
  inHouse();
  for (const type of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(sim.housePlace(p.id, { type, x: -13, z: 5, rot: 0, color: 0 }).ok, false);
  }
  const weird = { toString: 1 }; // Number()/String() ile çevrilince TypeError fırlatır
  assert.equal(sim.housePlace(p.id, { type: weird, x: weird, z: -1, rot: 0, color: 0 }).ok, false);
  assert.equal(sim.houseRemove(p.id, weird).ok, false);
  assert.equal(sim.houseTvStop(p.id, weird).ok, false);
  sim.movePlayer(p.id, 12.25, 5.6, 0); // coffee shop tezgâhı
  assert.equal(sim.buy(p.id, 'constructor').ok, false);
  assert.equal(p.wallet, START_WALLET);
});

test('oyuncunun durduğu yere katı eşya konamaz (halı ve LED konabilir)', () => {
  const { sim, p, inHouse } = setup();
  const other = sim.addPlayer('Komşu');
  inHouse(-15.6, 4);
  p.wallet = 100;
  const chair = { type: 'armchair', x: -15.43, z: 4, rot: 0, color: 0 };
  assert.match(sim.housePlace(p.id, chair).error, /Durduğun yere/);
  sim.movePlayer(other.id, -13, 5, 0);
  assert.match(sim.housePlace(p.id, { type: 'sofa', x: -13, z: 5, rot: 0, color: 0 }).error, /Komşu/);
  assert.equal(sim.housePlace(p.id, { type: 'rug', x: -13, z: 5, rot: 0, color: 0 }).ok, true);
  inHouse(-14, 4);
  assert.equal(sim.housePlace(p.id, chair).ok, true, 'geri çekilince olur');
});

test('iade yalnızca eşyayı bu oturumda alan oyuncuya; kayda alıcı kimliği yazılmaz', () => {
  const store = memoryStore();
  const { sim, p, inHouse } = setup({ store });
  const other = sim.addPlayer('Komşu');
  inHouse();
  sim.movePlayer(other.id, -12.5, 4, 0);
  const sofa = sim.housePlace(p.id, { type: 'sofa', x: -14, z: 6, rot: 0, color: 0 }).item;
  const plant = sim.housePlace(p.id, { type: 'plant', x: -10, z: 6, rot: 0, color: 0 }).item;
  const before = other.wallet;
  const r = sim.houseRemove(other.id, sofa.id);
  assert.equal(r.ok, true, 'ev ortak: herkes kaldırabilir');
  assert.equal(r.refund, 0);
  assert.equal(other.wallet, before, 'başkasının eşyasından para yok');
  // Yeniden giriş = yeni oyuncu kimliği → eski eşyadan iade yok (sınırsız para döngüsü olmasın)
  sim.removePlayer(p.id);
  const again = sim.addPlayer('Ev');
  sim.movePlayer(again.id, -12, 4, 0);
  assert.equal(sim.houseRemove(again.id, plant.id).refund, 0);
  sim.house.flush();
  assert.equal(store.data.items.length, 0);
  sim.movePlayer(again.id, -12, 4, 0);
  sim.housePlace(again.id, { type: 'plant', x: -10, z: 6, rot: 0, color: 0 });
  sim.house.flush();
  assert.equal('byId' in store.data.items[0], false);
});

test('ışık anahtarı: yalnızca yakındayken, herkese yayınlanır', () => {
  const { sim, p, out, inHouse } = setup();
  inHouse(-14, 7);
  assert.equal(sim.houseLights(p.id).ok, false, 'anahtardan uzak');
  inHouse(HOUSE.lightSwitch[0], 0.6);
  const r = sim.houseLights(p.id);
  assert.equal(r.ok, true);
  assert.equal(r.lightsOn, false);
  assert.ok(out.some((e) => e.event === EVT.HOUSE_LIGHTS_STATE && e.payload === false));
});

test('TV: link doğrulama, başlık, gömülemeyen video, ağ hatası, kaldırılan TV', async () => {
  let mode = 'ok';
  const fetchVideoInfo = async () => {
    if (mode === 'ok') return { title: 'Güzel Şarkı' };
    if (mode === 'embed') return { notEmbeddable: true };
    if (mode === 'missing') return { notFound: true };
    throw new Error('ağ yok');
  };
  const { sim, p, out, inHouse } = setup({ fetchVideoInfo });
  inHouse();
  p.wallet = 100;
  const tv = sim.housePlace(p.id, { type: 'tv', x: -12, z: 6.5, rot: 2, color: 0 }).item;
  assert.ok(tv);
  assert.equal((await sim.houseTvSet(p.id, tv.id, 'merhaba')).ok, false);
  const ok = await sim.houseTvSet(p.id, tv.id, 'https://youtube.com/watch?v=LDvCJywosJU&is=x');
  assert.equal(ok.ok, true);
  assert.equal(ok.video.id, 'LDvCJywosJU');
  assert.equal(ok.video.title, 'Güzel Şarkı');
  assert.ok(out.some((e) => e.event === EVT.HOUSE_TV_STATE && e.payload.video?.id === 'LDvCJywosJU'));
  mode = 'embed';
  assert.match((await sim.houseTvSet(p.id, tv.id, 'dQw4w9WgXcQ')).error, /izin vermiyor/);
  mode = 'missing';
  assert.match((await sim.houseTvSet(p.id, tv.id, 'dQw4w9WgXcQ')).error, /bulunamadı/);
  mode = 'down';
  const offline = await sim.houseTvSet(p.id, tv.id, 'dQw4w9WgXcQ');
  assert.equal(offline.ok, true, 'YouTube erişilemezse yine de dene');
  assert.equal(offline.video.title, null);
  assert.equal(sim.houseTvStop(p.id, tv.id).ok, true);
  assert.equal(sim.house.find(tv.id).video, null);
  // Uzaktan kumanda edilemez
  inHouse(-15.4, 0.5);
  assert.equal((await sim.houseTvSet(p.id, tv.id, 'dQw4w9WgXcQ')).ok, false);
  // Başlık beklenirken TV kaldırılırsa
  inHouse();
  let release;
  sim.house.fetchVideoInfo = () => new Promise((r) => { release = r; });
  const pending = sim.houseTvSet(p.id, tv.id, 'dQw4w9WgXcQ');
  sim.houseRemove(p.id, tv.id);
  release({ title: 'x' });
  assert.equal((await pending).ok, false);
  // Kanepe TV değildir
  const sofa = sim.housePlace(p.id, { type: 'sofa', x: -14, z: 4, rot: 0, color: 0 }).item;
  assert.equal((await sim.houseTvSet(p.id, sofa.id, 'dQw4w9WgXcQ')).ok, false);
});

test('kalıcılık: kaydedilir, geri yüklenir; bozuk kayıtlar elenir', () => {
  const store = memoryStore();
  const a = setup({ store });
  a.inHouse();
  a.p.wallet = 100;
  a.sim.housePlace(a.p.id, { type: 'sofa', x: -13, z: 5, rot: 0, color: 1 });
  a.sim.housePlace(a.p.id, { type: 'led', x: -12, z: HOUSE.inner.maxZ, rot: 0, color: 3 });
  a.sim.house.flush();
  assert.equal(store.data.items.length, 2);

  store.data.items.push(
    { id: 50, type: 'sofa', x: -13, z: 5, rot: 0, color: 0 }, // çakışıyor
    { id: 51, type: 'helikopter', x: -12, z: 3, rot: 0, color: 0 },
    { id: 52, type: 'plant', x: 999, z: 3, rot: 0, color: 0 },
    { id: 53, type: 'plant', x: -15.3, z: 7.3, rot: 0, color: 0, video: { id: 'x' } },
  );
  store.data.lightsOn = false;
  const b = setup({ store });
  const items = b.sim.house.serialize().items;
  assert.deepEqual(items.map((i) => i.id).sort((x, y) => x - y), [1, 2, 53]);
  assert.equal(b.sim.house.lightsOn, false);
  assert.equal(b.sim.house.nextId, 54);
  assert.equal(items.find((i) => i.id === 53).video, null, 'TV olmayana video yüklenmez');
});

test('eşya sınırı', () => {
  const { sim, p, inHouse } = setup();
  inHouse();
  p.wallet = 10_000;
  let placed = 0;
  for (let x = -15.5; x <= -8.5 && placed < HOUSE_RULES.MAX_ITEMS + 5; x += 0.5) {
    for (let z = 1.6; z <= 7.6 && placed < HOUSE_RULES.MAX_ITEMS + 5; z += 0.5) {
      if (sim.housePlace(p.id, { type: 'plant', x, z, rot: 0, color: 0 }).ok) placed++;
    }
  }
  assert.equal(sim.house.items.length, HOUSE_RULES.MAX_ITEMS);
});

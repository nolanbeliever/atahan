import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { attachSocketHandlers } from '../server/net/socketHandlers.js';
import { EVT, START_WALLET } from '../shared/constants.js';
import { HOUSE_BY_ID, PLAYER_HOUSES } from '../shared/layout.js';
import { FURNITURE_BY_ID, HOUSE_RULES } from '../shared/house.js';

const config = {
  dayLengthSec: 240, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, starterBed: false,
};
const DAY_MS = 86_400_000;

// Geçerli anahtarlar: 32 küçük hex karakter
const key = (c) => c.repeat(32);
const KEY_A = key('a');
const KEY_B = key('b');
const KEY_C = key('c');
const sha = (k) => createHash('sha256').update(k).digest('hex');

function memoryStore(initial = null) {
  return { data: initial, saves: 0, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); this.saves++; } };
}

function setup({ store = null, fetchVideoInfo = null } = {}) {
  let now = 1_000_000;
  const sim = new HotelSimulation({ config, now: () => now, house: { store, fetchVideoInfo } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  const to = [];
  const kicks = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  sim.on('kick', (id) => kicks.push(id));
  const h = sim.house;
  /** Oyuncuyu evin ortasına (ya da ortadan dx/dz kadar öteye) koy */
  const inside = (p, houseId, dx = 0, dz = 0) => {
    const b = HOUSE_BY_ID[houseId].bounds;
    sim.movePlayer(p.id, (b.minX + b.maxX) / 2 + dx, (b.minZ + b.maxZ) / 2 + dz, 0);
  };
  const atDoor = (p, houseId) => sim.movePlayer(p.id, ...HOUSE_BY_ID[houseId].doorPoint, 0);
  const tick = (ms) => { now += ms; sim.tick(now); };
  const events = (event) => out.filter((e) => e.event === event).map((e) => e.payload);
  const sent = (p, event) => to.filter((e) => e.id === p.id && e.event === event).map((e) => e.payload);
  const lastOwners = () => events(EVT.HOUSE_OWNERS).at(-1);
  return {
    sim, h, out, to, kicks, inside, atDoor, tick, events, sent, lastOwners,
    advance: (ms) => { now += ms; }, now: () => now,
  };
}

/** Evin ortasına göre eşya konumu: TV arka duvarın önünde, bitki sağ arkada */
function spots(houseId) {
  const b = HOUSE_BY_ID[houseId].bounds;
  const cx = (b.minX + b.maxX) / 2;
  return {
    tv: { type: 'tv', x: cx, z: 39.0, rot: 0, color: 0 },
    plant: { type: 'plant', x: cx + 1.2, z: 38.0, rot: 0, color: 0 },
  };
}

test('kimlik: yalnızca geçerli anahtarın sha256 özeti tutulur; evler sırayla atanır', () => {
  const { sim, h, lastOwners } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  assert.equal(a.keyHash, sha(KEY_A));
  assert.equal(h.houseIdOf(a), 'h1');
  const b = sim.addPlayer('Bea', KEY_B);
  assert.equal(h.houseIdOf(b), 'h2');
  const anon = sim.addPlayer('Anon');
  assert.equal(anon.keyHash, null);
  assert.equal(h.houseIdOf(anon), null);
  for (const bad of ['ABC', 'A'.repeat(32), 'g'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), { toString: 1 }, [KEY_C], 42, null]) {
    const p = sim.addPlayer('Kötü', bad);
    assert.equal(p.keyHash, null, String(typeof bad));
    assert.equal(h.houseIdOf(p), null);
  }
  // snapshot.self.houseId ve owners
  assert.equal(sim.snapshot(a.id).self.houseId, 'h1');
  assert.equal(sim.snapshot(b.id).self.houseId, 'h2');
  assert.equal(sim.snapshot(anon.id).self.houseId, null);
  const owners = lastOwners();
  assert.equal(owners.length, PLAYER_HOUSES.length);
  assert.deepEqual(owners[0], { houseId: 'h1', owner: { name: 'Ali', online: true, playerId: a.id } });
  assert.deepEqual(owners[1], { houseId: 'h2', owner: { name: 'Bea', online: true, playerId: b.id } });
  assert.deepEqual(owners.slice(2).map((o) => o.owner), Array(6).fill(null));
  assert.deepEqual(sim.snapshot(a.id).house.owners, owners);
  // Ev değişmeyince (anahtarsız giriş) HOUSE_OWNERS gönderilmez
  const n = setup();
  n.sim.addPlayer('Anon');
  assert.equal(n.events(EVT.HOUSE_OWNERS).length, 0);
  // SELF de houseId taşır
  const s = setup();
  const p = s.sim.addPlayer('Ali', KEY_A);
  s.sim.shop.sendSelf(p);
  assert.equal(s.sent(p, EVT.SELF).at(-1).houseId, 'h1');
});

test('tek oturum: aynı anahtarla ikinci giriş eskisini kapatır, ev ve cüzdan yeni oturuma geçer', () => {
  const { sim, h, kicks, sent, events, lastOwners, inside } = setup();
  const a1 = sim.addPlayer('Ali', KEY_A);
  inside(a1, 'h1');
  assert.equal(sim.housePlace(a1.id, spots('h1').plant).ok, true);
  const b = sim.addPlayer('Bea', KEY_B);
  const a2 = sim.addPlayer('Ali', KEY_A);
  assert.deepEqual(kicks, [a1.id]);
  assert.deepEqual(sent(a1, EVT.NOTIFY).at(-1), { text: 'Oyun başka bir sekmede açıldı.', kind: 'warn' });
  assert.equal(sim.players.has(a1.id), false, 'eski oyuncu temizlenir');
  assert.ok(events(EVT.PLAYER_LEAVE).includes(a1.id));
  assert.equal(sim.players.size, 2);
  assert.equal(h.houseIdOf(a2), 'h1');
  assert.equal(a2.wallet, START_WALLET - FURNITURE_BY_ID.plant.price, 'cüzdan yeni oturumda');
  assert.deepEqual(lastOwners()[0].owner, { name: 'Ali', online: true, playerId: a2.id });
  assert.equal(sim.playerByKey(KEY_A), a2);
  assert.equal(sim.playerByKey(KEY_B), b);
  assert.equal(sim.playerByKey('nope'), undefined);
  assert.equal(kicks.length, 1, 'farklı anahtar kimseyi düşürmez');
});

test('kalıcılık: yeniden yükleyince aynı anahtar aynı ev, aynı cüzdan; anahtarın kendisi kayda yazılmaz', () => {
  const store = memoryStore();
  const s1 = setup({ store });
  const a = s1.sim.addPlayer('Ali', KEY_A);
  const b = s1.sim.addPlayer('Bea', KEY_B);
  s1.inside(a, 'h1');
  const tv = s1.sim.housePlace(a.id, spots('h1').tv).item;
  assert.equal(tv.houseId, 'h1');
  assert.equal(a.wallet, START_WALLET - FURNITURE_BY_ID.tv.price);
  s1.sim.removePlayer(a.id);
  assert.deepEqual(s1.lastOwners()[0].owner, { name: 'Ali', online: false, playerId: null }, 'çıkınca çevrimdışı');
  s1.sim.house.flush();
  const d = store.data;
  assert.equal(d.version, 2);
  assert.equal(d.items[0].houseId, 'h1');
  assert.equal(d.owners.h1.hash, sha(KEY_A));
  assert.equal(d.owners.h1.name, 'Ali');
  assert.equal(d.owners.h2.hash, sha(KEY_B));
  assert.equal(d.wallets[sha(KEY_A)], START_WALLET - FURNITURE_BY_ID.tv.price);
  assert.equal(sha(KEY_B) in d.wallets, false, 'başlangıç cüzdanı kayıt gerektirmez');
  const json = JSON.stringify(d);
  for (const k of [KEY_A, KEY_B]) assert.equal(json.includes(k), false, 'anahtar kayda yazılmaz');
  assert.equal(b.wallet, START_WALLET);

  // Yeniden başlatma: sahipler kayıttan, hepsi çevrimdışı
  const s2 = setup({ store });
  assert.deepEqual(s2.sim.house.serialize().owners[0], { houseId: 'h1', owner: { name: 'Ali', online: false, playerId: null } });
  const b2 = s2.sim.addPlayer('Bea', KEY_B);
  assert.equal(s2.h.houseIdOf(b2), 'h2', 'B kendi evini alır, A\'nınkini değil');
  const a2 = s2.sim.addPlayer('Ali Yeni', KEY_A);
  assert.equal(s2.h.houseIdOf(a2), 'h1');
  assert.equal(a2.wallet, START_WALLET - FURNITURE_BY_ID.tv.price, 'cüzdan geri gelir');
  assert.equal(s2.h.owners.h1.name, 'Ali Yeni', 'ad güncellenir');
  const items = s2.sim.house.serialize().items;
  assert.deepEqual(items.map((i) => [i.id, i.houseId, i.type]), [[tv.id, 'h1', 'tv']]);
  // Anahtarsız oyuncu: her girişte START_WALLET
  const anon = s2.sim.addPlayer('Anon');
  anon.wallet = 3;
  s2.sim.shop.sendSelf(anon);
  s2.sim.removePlayer(anon.id);
  assert.equal(s2.sim.addPlayer('Anon').wallet, START_WALLET);
  // Aynı sunucuda çıkıp yeniden giriş
  a2.wallet = 77;
  s2.sim.shop.sendSelf(a2);
  s2.sim.removePlayer(a2.id);
  assert.equal(s2.sim.addPlayer('Ali', KEY_A).wallet, 77);
});

test('cüzdan: bozuk değer kaydedilmez, bozuk kayıt yüklenmez; özel config.startWallet', () => {
  const store = memoryStore({
    version: 2,
    items: [],
    wallets: {
      [sha(KEY_A)]: 12,
      [sha(KEY_B)]: -5,
      [sha(KEY_C)]: 'çok',
      [sha(key('d'))]: null,
      [sha(key('e'))]: 1e400, // JSON'da Infinity olamaz ama elle düzenlenmiş olabilir
      ['__proto__']: 99, // hesaplanmış anahtar → gerçek (own) özellik
      kısa: 50,
    },
  });
  const { sim, h } = setup({ store });
  assert.deepEqual([...h.wallets.entries()], [[sha(KEY_A), 12]]);
  assert.equal(sim.addPlayer('A', KEY_A).wallet, 12);
  assert.equal(sim.addPlayer('B', KEY_B).wallet, START_WALLET);
  assert.equal(sim.addPlayer('C', KEY_C).wallet, START_WALLET);
  const e = sim.addPlayer('E', key('e'));
  e.wallet = NaN;
  sim.shop.sendSelf(e);
  assert.equal(h.wallets.has(e.keyHash), false, 'NaN yazılmaz');
  e.wallet = -1;
  sim.shop.sendSelf(e);
  assert.equal(h.wallets.has(e.keyHash), false, 'negatif yazılmaz');
  e.wallet = 5;
  sim.shop.sendSelf(e);
  assert.equal(h.wallets.get(e.keyHash), 5);
  e.wallet = Infinity;
  sim.removePlayer(e.id);
  assert.equal(h.wallets.get(e.keyHash), 5, 'çıkışta da bozuk değer yazılmaz');

  // config.startWallet: kayıt yoksa o değer
  let now = 0;
  const sim2 = new HotelSimulation({ config: { ...config, startWallet: 55 }, now: () => now });
  sim2.start = () => {};
  sim2.stop = () => {};
  assert.equal(sim2.addPlayer('X', KEY_A).wallet, 55);
});

test('evden çıkarma: evler doluyken yalnızca 3 günden uzun süredir gelmeyen (en eski) sahibin evi verilir', () => {
  const { sim, h, events, inside, advance, lastOwners } = setup();
  const keys = 'abcdef01'.split('').map(key); // 8 farklı anahtar
  const ps = keys.map((k, i) => sim.addPlayer(`P${i + 1}`, k));
  assert.deepEqual(ps.map((p) => h.houseIdOf(p)), PLAYER_HOUSES.map((x) => x.id));
  inside(ps[2], 'h3');
  ps[2].wallet = 100;
  const tv = sim.housePlace(ps[2].id, spots('h3').tv).item;
  const plant = sim.housePlace(ps[2].id, spots('h3').plant).item;
  // P3 gider (en eski); diğerleri 2 gün sonra gider; P1 çevrimiçi kalır
  sim.removePlayer(ps[2].id);
  advance(2 * DAY_MS);
  for (const p of ps.slice(1)) sim.removePlayer(p.id);
  h.owners.h1.seenAt = 0; // çevrimiçi sahip, eski seenAt'e rağmen asla çıkarılmaz

  // Henüz 3 gün olmadı → evsiz
  const k9 = key('9');
  const early = sim.addPlayer('Dokuz', k9);
  assert.equal(h.houseIdOf(early), null);
  assert.equal(sim.snapshot(early.id).self.houseId, null);
  assert.equal(events(EVT.HOUSE_REMOVED).length, 0);
  sim.removePlayer(early.id);

  advance(1 * DAY_MS + 1); // P3'ün seenAt'i 3 günü geçti, diğerleri 1 gün
  const ownersBefore = events(EVT.HOUSE_OWNERS).length;
  const nine = sim.addPlayer('Dokuz', k9);
  assert.equal(h.houseIdOf(nine), 'h3');
  assert.deepEqual(events(EVT.HOUSE_REMOVED).sort(), [tv.id, plant.id].sort(), 'eski eşyalar silinip yayınlanır');
  assert.equal(h.itemsIn('h3').length, 0);
  assert.equal(events(EVT.HOUSE_OWNERS).length, ownersBefore + 1);
  assert.deepEqual(lastOwners()[2].owner, { name: 'Dokuz', online: true, playerId: nine.id });
  // Eski sahip geri gelince evi yok (uygun boş ev de yok)
  const back = sim.addPlayer('P3', keys[2]);
  assert.equal(h.houseIdOf(back), null);
  // Bir sonraki: hiçbiri uygun değil (P1 çevrimiçi, diğerleri 1 günlük)
  assert.equal(h.houseIdOf(sim.addPlayer('On', key('7'))), null);
});

test('v1 kayıt uyumluluğu: houseId\'siz eşyalar Bizim Ev\'e; her eşya kendi evinde doğrulanır; ev başına sınır', () => {
  const h2 = HOUSE_BY_ID.h2;
  const plants = [];
  for (let x = h2.inner.minX + 0.3; x < h2.inner.maxX - 0.25 && plants.length < 31; x += 0.5) {
    for (let z = 34.7; z < 39.4 && plants.length < 31; z += 0.5) {
      plants.push({ id: 100 + plants.length, houseId: 'h2', type: 'plant', x: Math.round(x * 100) / 100, z, rot: 0, color: 0 });
    }
  }
  assert.equal(plants.length, 31);
  const v1 = memoryStore({
    items: [
      { id: 1, type: 'sofa', x: -13, z: 5, rot: 0, color: 1, by: 'Eski' },
      { id: 2, type: 'plant', x: -14.7, z: 38, rot: 0, color: 0 }, // houseId yok → Bizim Ev'e sığmaz
      { id: 3, houseId: 'h1', type: 'plant', x: -14.7, z: 38, rot: 0, color: 0 },
      { id: 4, houseId: 'h1', type: 'plant', x: -13, z: 5, rot: 0, color: 0 }, // h1'in dışında
      { id: 5, houseId: 'yok', type: 'plant', x: -13, z: 6.5, rot: 0, color: 0 },
      { id: 6, houseId: { toString: 1 }, type: 'plant', x: -13, z: 6.5, rot: 0, color: 0 },
      { id: 7, houseId: '__proto__', type: 'plant', x: -13, z: 6.5, rot: 0, color: 0 },
      { id: { toString: 1 }, type: { toString: 1 }, x: -13, z: 6.5, rot: 0, color: 0 },
      null, 'çöp', 42,
      ...plants,
    ],
    lightsOn: false,
    owners: {
      h1: { hash: sha(KEY_A), name: 'Ali', seenAt: 5 },
      h2: { hash: 'kısa', name: 'X', seenAt: 5 },
      h3: { hash: sha(KEY_A), name: 'Çift', seenAt: 5 }, // aynı anahtar ikinci ev alamaz
      h4: { hash: sha(KEY_B), name: { toString: 1 }, seenAt: 'dün' },
      shared: { hash: sha(KEY_C), name: 'Ortak', seenAt: 5 },
    },
  });
  const { sim, h } = setup({ store: v1 });
  const byId = new Map(h.items.map((i) => [i.id, i]));
  assert.equal(byId.get(1).houseId, 'shared');
  assert.equal(byId.get(1).by, 'Eski');
  assert.equal(byId.has(2), false);
  assert.equal(byId.get(3).houseId, 'h1');
  for (const id of [4, 5, 6, 7]) assert.equal(byId.has(id), false, `eşya ${id}`);
  assert.equal(h.itemsIn('h2').length, h2.maxItems, 'ev başına en fazla maxItems');
  assert.equal(h.lightsOn, false);
  assert.equal(h.nextId, 100 + h2.maxItems);
  assert.equal(h.owners.h1.name, 'Ali');
  assert.equal(h.owners.h2, null);
  assert.equal(h.owners.h3, null);
  assert.deepEqual(h.owners.h4, { hash: sha(KEY_B), name: '', seenAt: 1_000_000 });
  assert.equal(h.owners.shared, undefined, 'Bizim Ev\'in sahibi olmaz');
  // Kayıt v2 olarak yazılır
  sim.addPlayer('Ali', KEY_A);
  h.flush();
  assert.equal(v1.data.version, 2);
  assert.ok(v1.data.items.every((i) => typeof i.houseId === 'string'));
  // Tamamen bozuk kayıtlar çökertmez
  for (const data of [42, 'x', [], { items: 'x', owners: 5, wallets: [1, 2] }, { items: [{ video: 5 }] }]) {
    assert.doesNotThrow(() => setup({ store: memoryStore(data) }));
  }
});

test('yetkiler: sahibi olmayan yerleştiremez / kaldıramaz / TV açamaz; içeri alınan misafir TV açar ama eşyaya dokunamaz', async () => {
  const { sim, h, inside, atDoor } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  const anon = sim.addPlayer('Anon');
  a.wallet = 100;
  inside(a, 'h1');
  const tv = sim.housePlace(a.id, spots('h1').tv).item;
  const plant = sim.housePlace(a.id, spots('h1').plant).item;
  assert.ok(tv && plant);
  assert.equal((await sim.houseTvSet(a.id, tv.id, 'dQw4w9WgXcQ')).ok, true, 'sahibi TV açar');
  assert.equal(sim.houseTvStop(a.id, tv.id).ok, true);

  // Yabancı içeri girmiş olsa bile (sunucu kapıyı fiziksel olarak denetlemez)
  const deny = /^Bu ev Ali'nin — yalnızca ev sahibi düzenleyebilir\.$/;
  for (const who of [b, anon]) {
    inside(who, 'h1', -1, -1);
    who.wallet = 100;
    assert.match(sim.housePlace(who.id, { type: 'plant', x: -15.5, z: 37, rot: 0, color: 0 }).error, deny);
    assert.match(sim.houseRemove(who.id, plant.id).error, deny);
    assert.match((await sim.houseTvSet(who.id, tv.id, 'dQw4w9WgXcQ')).error, /yalnızca ev sahibi/);
    assert.match(sim.houseTvStop(who.id, tv.id).error, /yalnızca ev sahibi/);
    assert.equal(who.wallet, 100);
  }
  assert.equal(h.itemsIn('h1').length, 2);

  // Zil → kabul → misafir TV'yi kullanır, eşyalara yine dokunamaz
  atDoor(b, 'h1');
  const ring = sim.houseRing(b.id, 'h1');
  assert.equal(ring.pending, true);
  const ringId = [...h.rings.keys()][0];
  assert.deepEqual(sim.houseRingAnswer(a.id, ringId, true), { ok: true, granted: true });
  assert.ok(b.houseAccess.has('h1'));
  inside(b, 'h1', -1, -1);
  assert.equal((await sim.houseTvSet(b.id, tv.id, 'dQw4w9WgXcQ')).ok, true, 'misafir TV açar');
  assert.equal(sim.houseTvStop(b.id, tv.id).ok, true);
  assert.match(sim.houseRemove(b.id, plant.id).error, deny, 'misafir eşya kaldıramaz');
  assert.match(sim.housePlace(b.id, { type: 'plant', x: -15.5, z: 37, rot: 0, color: 0 }).error, deny);
  // Misafir başka evden / sokaktan kumanda edemez
  atDoor(b, 'h1');
  assert.equal((await sim.houseTvSet(b.id, tv.id, 'dQw4w9WgXcQ')).error, 'Evin içinde olmalısın.');
  inside(b, 'h2');
  assert.equal(sim.houseTvStop(b.id, tv.id).error, 'Evin içinde olmalısın.');

  // Sahibi kaldırır; iade sahibine
  const before = a.wallet;
  const rem = sim.houseRemove(a.id, plant.id);
  assert.equal(rem.ok, true);
  assert.equal(rem.refund, Math.floor(FURNITURE_BY_ID.plant.price * HOUSE_RULES.REFUND));
  assert.equal(a.wallet, before + rem.refund);

  // B kendi evinde serbest; Bizim Ev herkese açık
  assert.equal(sim.housePlace(b.id, spots('h2').plant).ok, true);
  sim.movePlayer(anon.id, -12, 4, 0);
  assert.equal(sim.housePlace(anon.id, { type: 'plant', x: -10, z: 6, rot: 0, color: 0 }).ok, true);
  // Sahipsiz ev: kimse düzenleyemez
  inside(a, 'h5');
  assert.equal(sim.housePlace(a.id, spots('h5').plant).error, 'Huis 5 şu an boş — yalnızca ev sahibi düzenleyebilir.');
  // Oyuncu evinde ışık anahtarı yok
  inside(a, 'h1');
  assert.equal(sim.houseLights(a.id).ok, false);
  // Ev başına eşya sınırı (Bizim Ev'den bağımsız)
  a.wallet = 10_000;
  const I = HOUSE_BY_ID.h1.inner;
  for (let x = I.minX + 0.3; x < I.maxX - 0.25; x += 0.5) {
    for (let z = 34.7; z < 39.4; z += 0.5) {
      inside(a, 'h1', 0, -2.9); // kapının önünde değil, eşyalardan uzak
      sim.housePlace(a.id, { type: 'plant', x: Math.round(x * 100) / 100, z, rot: 0, color: 0 });
    }
  }
  assert.equal(h.itemsIn('h1').length, HOUSE_BY_ID.h1.maxItems);
  inside(a, 'h1', 0, -2.9);
  assert.match(sim.housePlace(a.id, { type: 'rug', x: -14.7, z: 36, rot: 0, color: 0 }).error, /en fazla 30/);
});

test('kapı zili: istek, ret, bekleme süresi, zaman aşımı, kabul; sahibi kendi zilini çalar; uzaktan çalınamaz', () => {
  const { sim, h, inside, atDoor, tick, advance, sent } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);

  sim.movePlayer(b.id, 0, 5, 0); // lobi
  assert.match(sim.houseRing(b.id, 'h1').error, /kapının önüne/, 'uzaktan çalınamaz');
  inside(b, 'h1');
  assert.match(sim.houseRing(b.id, 'h1').error, /kapının önüne/, 'içeriden çalınmaz');
  atDoor(b, 'h2');
  assert.match(sim.houseRing(b.id, 'h1').error, /kapının önüne/, 'komşu kapının önünden çalınmaz');
  assert.equal(sent(a, EVT.HOUSE_RING_REQ).length, 0);

  // İstek
  atDoor(b, 'h1');
  const r1 = sim.houseRing(b.id, 'h1');
  assert.equal(r1.ok, true);
  assert.equal(r1.pending, true);
  const req = sent(a, EVT.HOUSE_RING_REQ);
  assert.equal(req.length, 1);
  assert.deepEqual(req[0], { ringId: req[0].ringId, houseId: 'h1', visitorId: b.id, visitorName: 'Bea', expiresAt: r1.expiresAt });
  assert.equal(typeof req[0].ringId, 'number');
  assert.equal(r1.expiresAt - sim.now(), HOUSE_RULES.RING_TIMEOUT_MS);
  // İkinci zil: aynı bekleyen istek, sahibine yeni bildirim yok
  assert.deepEqual(sim.houseRing(b.id, 'h1'), { ok: true, pending: true, expiresAt: r1.expiresAt });
  assert.equal(sent(a, EVT.HOUSE_RING_REQ).length, 1);

  // Bozuk yanıtlar
  const { ringId } = req[0];
  assert.equal(sim.houseRingAnswer(a.id, String(ringId), true).ok, false);
  assert.equal(sim.houseRingAnswer(a.id, ringId, 'evet').ok, false);
  assert.equal(sim.houseRingAnswer(a.id, ringId, 1).ok, false);
  assert.equal(sim.houseRingAnswer(a.id, 999, true).error, 'Bu zil artık geçerli değil.');
  assert.equal(sim.houseRingAnswer(b.id, ringId, true).error, 'Bu zil artık geçerli değil.', 'yalnızca ev sahibi yanıtlar');
  assert.equal(b.houseAccess.size, 0);

  // Ret
  assert.deepEqual(sim.houseRingAnswer(a.id, ringId, false), { ok: true, granted: false });
  assert.deepEqual(sent(b, EVT.HOUSE_ACCESS).at(-1), { houseId: 'h1', granted: false, by: 'Ali', reason: 'declined' });
  assert.equal(b.houseAccess.has('h1'), false);
  assert.equal(sim.houseRingAnswer(a.id, ringId, true).ok, false, 'yanıtlanmış zil tekrar yanıtlanmaz');

  // Bekleme süresi
  advance(HOUSE_RULES.RING_COOLDOWN_MS - 1000);
  assert.match(sim.houseRing(b.id, 'h1').error, /1 sn bekle/);
  advance(1000);

  // Zaman aşımı
  const r2 = sim.houseRing(b.id, 'h1');
  assert.equal(r2.pending, true);
  const ring2 = sent(a, EVT.HOUSE_RING_REQ).at(-1).ringId;
  tick(HOUSE_RULES.RING_TIMEOUT_MS - 100);
  assert.equal(h.rings.size, 1);
  tick(100);
  assert.equal(h.rings.size, 0);
  assert.deepEqual(sent(b, EVT.HOUSE_ACCESS).at(-1), { houseId: 'h1', granted: false, by: 'Ali', reason: 'timeout' });
  assert.equal(sim.houseRingAnswer(a.id, ring2, true).error, 'Bu zil artık geçerli değil.');

  // Kabul
  const r3 = sim.houseRing(b.id, 'h1');
  assert.equal(r3.pending, true);
  const ring3 = sent(a, EVT.HOUSE_RING_REQ).at(-1).ringId;
  assert.deepEqual(sim.houseRingAnswer(a.id, ring3, true), { ok: true, granted: true });
  assert.deepEqual(sent(b, EVT.HOUSE_ACCESS).at(-1), { houseId: 'h1', granted: true, by: 'Ali' });
  assert.ok(b.houseAccess.has('h1'));
  assert.deepEqual(sim.houseRing(b.id, 'h1'), { ok: true, granted: true }, 'erişimi olan tekrar çalınca kapı açık');

  // Sahibi kendi zilini çalar
  atDoor(a, 'h1');
  assert.deepEqual(sim.houseRing(a.id, 'h1'), { ok: true, owner: true });
  // Sahipsiz ev ve Bizim Ev
  atDoor(b, 'h5');
  assert.match(sim.houseRing(b.id, 'h5').error, /boş/);
  sim.movePlayer(b.id, ...HOUSE_BY_ID.shared.doorPoint, 0);
  assert.match(sim.houseRing(b.id, 'shared').error, /herkese açık/);

  // Sahibi çevrimdışı
  atDoor(a, 'h2');
  sim.removePlayer(b.id);
  assert.equal(sim.houseRing(a.id, 'h2').error, 'Bea şu an çevrimiçi değil.');
  // Erişim oturumluktur: yeniden girince yok
  const b2 = sim.addPlayer('Bea', KEY_B);
  assert.equal(b2.houseAccess.size, 0);
});

test('ev sahibi çıkınca bekleyen ziller owner-left; ziyaretçi çıkınca sessizce silinir', () => {
  const { sim, h, atDoor, sent, to } = setup();
  const accessEvents = () => to.filter((e) => e.event === EVT.HOUSE_ACCESS).length;
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  const c = sim.addPlayer('Can');
  atDoor(b, 'h1');
  atDoor(c, 'h1');
  assert.equal(sim.houseRing(b.id, 'h1').pending, true);
  assert.equal(sim.houseRing(c.id, 'h1').pending, true);
  assert.equal(h.rings.size, 2);
  sim.removePlayer(a.id);
  assert.equal(h.rings.size, 0);
  for (const v of [b, c]) {
    assert.deepEqual(sent(v, EVT.HOUSE_ACCESS).at(-1), { houseId: 'h1', granted: false, by: 'Ali', reason: 'owner-left' });
  }

  const a2 = sim.addPlayer('Ali', KEY_A);
  atDoor(c, 'h1');
  assert.match(sim.houseRing(c.id, 'h1').error, /sn bekle/, 'bekleme süresi ev sahibi çıksa da geçerli');
  sim.movePlayer(b.id, ...HOUSE_BY_ID.h1.doorPoint, 0);
  b.ringAt.clear();
  assert.equal(sim.houseRing(b.id, 'h1').pending, true);
  const ringId = sent(a2, EVT.HOUSE_RING_REQ).at(-1).ringId;
  const before = accessEvents();
  sim.removePlayer(b.id);
  assert.equal(h.rings.size, 0);
  assert.equal(accessEvents(), before, 'ziyaretçi çıkınca kimseye erişim olayı gitmez');
  assert.equal(sim.houseRingAnswer(a2.id, ringId, true).error, 'Bu zil artık geçerli değil.');
});

test('bozuk girdiler (prototip anahtarları, {toString:1}, bilinmeyen houseId) çökertmez', async () => {
  const { sim, h, inside, atDoor } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  atDoor(b, 'h1');
  const weird = { toString: 1 };
  for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'H1', 'h9', '', weird, ['h1'], 1, null, undefined, true]) {
    assert.equal(sim.houseRing(b.id, id).error, 'Böyle bir ev yok.', String(typeof id));
  }
  assert.equal(sim.houseRing(999, 'h1').ok, false, 'olmayan oyuncu');
  assert.equal(sim.houseRingAnswer(999, 1, true).ok, false);
  for (const [rid, acc] of [[weird, true], [1, weird], [[1], true], [NaN, false], [null, null], [undefined, undefined]]) {
    assert.equal(sim.houseRingAnswer(a.id, rid, acc).ok, false);
  }
  inside(a, 'h1');
  a.wallet = 100;
  for (const type of ['constructor', '__proto__', 'toString', weird]) {
    assert.equal(sim.housePlace(a.id, { type, x: -14, z: 37, rot: 0, color: 0 }).ok, false);
  }
  assert.equal(sim.housePlace(a.id, { type: 'plant', x: weird, z: weird, rot: weird, color: weird, houseId: 'h2' }).ok, false);
  assert.equal(sim.houseRemove(a.id, weird).ok, false);
  assert.equal((await sim.houseTvSet(a.id, weird, weird)).ok, false);
  assert.equal(sim.houseTvStop(a.id, weird).ok, false);
  assert.equal(a.wallet, 100);
  // İstemcinin gönderdiği houseId yok sayılır: eşya oyuncunun durduğu eve konur
  const r = sim.housePlace(a.id, { ...spots('h1').plant, houseId: 'shared' });
  assert.equal(r.item.houseId, 'h1');
  assert.equal(h.items.length, 1);
});

test('anahtar ve özeti hiçbir yayında, anlık görüntüde ya da kişisel mesajda yok', async () => {
  const store = memoryStore();
  const { sim, out, to, inside, atDoor, tick } = setup({ store });
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  inside(a, 'h1');
  const tv = sim.housePlace(a.id, spots('h1').tv).item;
  atDoor(b, 'h1');
  sim.houseRing(b.id, 'h1');
  sim.houseRingAnswer(a.id, sim.house.rings.keys().next().value, true);
  inside(b, 'h1', -1, -1);
  await sim.houseTvSet(b.id, tv.id, 'dQw4w9WgXcQ');
  sim.addPlayer('Ali', KEY_A); // eski oturum düşer
  tick(100);
  sim.removePlayer(b.id);
  const all = JSON.stringify([out, to, sim.snapshot(a.id), sim.snapshot(b.id), sim.house.serialize()]);
  for (const s of [KEY_A, KEY_B, sha(KEY_A), sha(KEY_B)]) assert.equal(all.includes(s), false);
  assert.equal(sim.snapshot(1).players.every((p) => !('keyHash' in p)), true);
});

/** Socket.io'suz ağ katmanı testi için en küçük sahte io / soket */
function fakeNet() {
  const broadcasts = [];
  let onConnection = null;
  const io = { on(ev, fn) { if (ev === 'connection') onConnection = fn; }, emit(event, payload) { broadcasts.push({ event, payload }); } };
  const connect = () => {
    const handlers = new Map();
    const socket = {
      sent: [],
      disconnected: false,
      on(ev, fn) { handlers.set(ev, fn); },
      emit(event, payload) { this.sent.push({ event, payload }); },
      disconnect() {
        if (this.disconnected) return;
        this.disconnected = true;
        handlers.get('disconnect')?.();
      },
      fire: (ev, ...args) => handlers.get(ev)(...args),
      request: (ev, data) => new Promise((resolve) => { handlers.get(ev)(data, resolve); }),
    };
    onConnection(socket);
    return socket;
  };
  return { io, connect, broadcasts };
}

test('ağ katmanı: JOIN anahtarı süzülür, aynı anahtar eski sekmeyi kapatır, zil olayları bağlı', async () => {
  let now = 1_000_000;
  const sim = new HotelSimulation({ config: { ...config, maxPlayers: 2 }, now: () => now });
  sim.start = () => {};
  sim.stop = () => {};
  const net = fakeNet();
  attachSocketHandlers(net.io, sim);

  const s1 = net.connect();
  await s1.fire(EVT.JOIN, { name: 'Ali', key: KEY_A });
  const w1 = s1.sent.find((e) => e.event === EVT.WELCOME).payload;
  assert.equal(w1.self.houseId, 'h1');
  assert.equal(sim.players.get(w1.selfId).keyHash, sha(KEY_A));

  const bad = net.connect();
  await bad.fire(EVT.JOIN, { name: 'Kötü', key: { toString: 1 } });
  const wb = bad.sent.find((e) => e.event === EVT.WELCOME).payload;
  assert.equal(wb.self.houseId, null);
  assert.equal(sim.players.get(wb.selfId).keyHash, null);

  // Sunucu dolu, ama aynı anahtarla gelen eski oturumun yerini alır
  const stranger = net.connect();
  await stranger.fire(EVT.JOIN, { name: 'Yabancı', key: KEY_B });
  assert.equal(stranger.disconnected, true);
  const s2 = net.connect();
  await s2.fire(EVT.JOIN, { name: 'Ali', key: KEY_A });
  assert.equal(s1.disconnected, true, 'eski sekme kapatılır');
  assert.deepEqual(s1.sent.filter((e) => e.event === EVT.NOTIFY).at(-1).payload, { text: 'Oyun başka bir sekmede açıldı.', kind: 'warn' });
  assert.equal(sim.players.has(w1.selfId), false);
  const w2 = s2.sent.find((e) => e.event === EVT.WELCOME).payload;
  assert.equal(w2.self.houseId, 'h1');
  assert.equal(sim.players.size, 2);

  // Zil: ziyaretçi → sahibi; yanıt → ziyaretçi
  const visitor = sim.players.get(wb.selfId);
  sim.movePlayer(visitor.id, ...HOUSE_BY_ID.h1.doorPoint, 0);
  const res = await bad.request(EVT.HOUSE_RING, { houseId: 'h1' });
  assert.equal(res.pending, true);
  const req = s2.sent.find((e) => e.event === EVT.HOUSE_RING_REQ).payload;
  assert.equal(req.visitorName, 'Kötü');
  assert.deepEqual(await s2.request(EVT.HOUSE_RING_ANSWER, { ringId: req.ringId, accept: true }), { ok: true, granted: true });
  assert.deepEqual(bad.sent.find((e) => e.event === EVT.HOUSE_ACCESS).payload, { houseId: 'h1', granted: true, by: 'Ali' });
  assert.equal((await bad.request(EVT.HOUSE_RING, 'h1')).ok, false, 'bozuk veri');
  assert.equal((await bad.request(EVT.HOUSE_RING_ANSWER, null)).ok, false);
  const owners = net.broadcasts.filter((e) => e.event === EVT.HOUSE_OWNERS).at(-1).payload;
  assert.deepEqual(owners[0].owner, { name: 'Ali', online: true, playerId: w2.selfId });
  const all = JSON.stringify([net.broadcasts, s1.sent, s2.sent, bad.sent]);
  for (const s of [KEY_A, sha(KEY_A)]) assert.equal(all.includes(s), false);
});

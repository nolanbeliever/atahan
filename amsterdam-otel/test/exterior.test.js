import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { attachSocketHandlers } from '../server/net/socketHandlers.js';
import { EVT } from '../shared/constants.js';
import { HOUSE_BY_ID, PLAYER_HOUSES } from '../shared/layout.js';
import {
  GRAFFITI, GRAFFITI_BY_ID, NEON_SLOT_BY_ID, BALCONY_ITEM_BY_ID, EXT_RULES, FACADE, BALCONY,
  cleanText, validateTag, tagAtPoint, tagRect, tagAspect, frontOfHouse, validNeonText,
} from '../shared/exterior.js';

const config = {
  dayLengthSec: 240, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, starterBed: false, startWallet: 200,
};
const DAY_MS = 86_400_000;
const key = (c) => c.repeat(32);
const KEY_A = key('a');
const KEY_B = key('b');

function memoryStore(initial = null) {
  return { data: initial, saves: 0, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); this.saves++; } };
}

function setup({ store = null } = {}) {
  let now = 1_000_000;
  const sim = new HotelSimulation({ config, now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  const to = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  /** Achterstraat'ta evin önüne (cephenin 2.4 m önüne, yerel x = 2.1 + dx) */
  const front = (p, houseId, dx = 0) => sim.movePlayer(p.id, HOUSE_BY_ID[houseId].bounds.minX + 2.1 + dx, 30.5, Math.PI);
  const act = (p, data) => sim.exteriorAct(p.id, data);
  const states = (houseId) => out.filter((e) => e.event === EVT.EXTERIOR_STATE && e.payload.houseId === houseId).map((e) => e.payload.exterior);
  return {
    sim, out, to, front, act, states, ext: sim.exterior,
    advance: (ms) => { now += ms; },
  };
}

// Geçerli graffiti yerleri (h1, yerel koordinat): kapı ile pencere arası alt köşe, pencerenin üstü
const HEART = { act: 'tag', d: 'heart', c: 0, s: 0, x: 2.27, y: 0.4 };
const ABOVE = { act: 'tag', d: 'amsterdam', c: 4, s: 1, x: 3.0, y: 2.7 };

// ---- Ortak doğrulama (shared/exterior.js) ----------------------------------------------

test('doğrulama: cephe sınırları, kapı / pencere / zil / fener hariç, en fazla 16 graffiti', () => {
  const T = (o) => ({ d: 'heart', c: 0, s: 0, x: 2.27, y: 0.4, ...o });
  assert.equal(validateTag([], T()).ok, true);
  assert.equal(validateTag([], { d: 'amsterdam', c: 4, s: 1, x: 3.0, y: 2.7 }).ok, true, 'pencerenin üstü');
  assert.equal(validateTag([], T({ x: 0.36, y: 1.0 })).ok, true, 'kapının solu');
  // Sınır dışı
  for (const bad of [T({ x: 0.05 }), T({ x: 4.05 }), T({ y: 0.1 }), T({ y: 2.95 }), T({ x: -3 }), T({ x: 9 })]) {
    const v = validateTag([], bad);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.match(v.error, /sığmıyor/);
  }
  assert.equal(validateTag([], { d: 'amsterdam', c: 0, s: 2, x: 3.0, y: 2.7 }).ok, false, 'büyük yazı pencere üstüne sığmaz');
  // Açıklıklar
  assert.match(validateTag([], T({ x: FACADE.doorX, y: 1.2 })).error, /Kapı/);
  assert.match(validateTag([], T({ x: 3.2, y: 1.5 })).error, /Pencere/);
  assert.match(validateTag([], T({ x: 2.28, y: 1.4 })).error, /Zil/);
  assert.match(validateTag([], T({ x: 0.37, y: 2.2 })).error, /Fener/);
  // Graffiti'ler üst üste binebilir; 16'dan fazlası olmaz
  const many = Array.from({ length: EXT_RULES.MAX_TAGS }, (_, i) => T({ id: i + 1 }));
  assert.equal(validateTag(many.slice(1), T()).ok, true);
  assert.match(validateTag(many, T()).error, /en fazla 16/);
  // Tipler: çevirme yok
  for (const bad of [T({ c: 8 }), T({ c: -1 }), T({ c: 1.5 }), T({ c: '1' }), T({ s: 3 }), T({ s: { toString: 1 } }),
    T({ x: NaN }), T({ y: Infinity }), T({ x: '2.2' }), T({ d: '__proto__' }), T({ d: 'constructor' }), T({ d: 'toString' }), null, undefined]) {
    assert.equal(validateTag([], bad).ok, false, JSON.stringify(bad));
  }
  // Yazı şablonları yazı ister ve yazı temiz olmalı
  assert.equal(validateTag([], { d: 'custom', c: 0, s: 0, x: 3.0, y: 2.7 }).ok, false);
  assert.equal(validateTag([], { d: 'custom', c: 0, s: 0, x: 3.0, y: 2.7, t: '' }).ok, false);
  assert.equal(validateTag([], { d: 'custom', c: 0, s: 0, x: 3.0, y: 2.7, t: '<b>' }).ok, false);
  assert.equal(validateTag([], { d: 'custom', c: 0, s: 0, x: 3.0, y: 2.7, t: 'Hoi' }).ok, true);
  // Kaldırma hedefi: en üstteki
  const a = { id: 1, ...T() };
  const b = { id: 2, ...T({ x: 2.3 }) };
  assert.equal(tagAtPoint([a, b], 2.28, 0.4), b);
  assert.equal(tagAtPoint([a, b], 3.5, 2.0), null);
  // Yazı uzadıkça şablon genişler (sınırlı)
  assert.ok(tagAspect(GRAFFITI_BY_ID.custom, 'AB') < tagAspect(GRAFFITI_BY_ID.custom, 'ABCDEF'));
  assert.equal(tagAspect(GRAFFITI_BY_ID.custom, 'X'.repeat(12)), 4);
  assert.equal(tagRect(T()).h, 0.3);
  assert.ok(GRAFFITI.length >= 10);
});

test('yazı temizleme: kontrol / görünmez karakterler, açılı parantezler, uzunluk; yalnızca string', () => {
  assert.equal(cleanText('  Hoi\u0000 <script>  Amsterdam​‮ ', 30), 'Hoi script Amsterdam');
  assert.equal(cleanText('ABCDEFGHIJKLMNOP', 12), 'ABCDEFGHIJKL');
  assert.equal(cleanText('🌷🌷🌷🌷', 3), '🌷🌷🌷', 'emoji yarım kesilmez');
  assert.equal(cleanText('\n\t\r', 12), '');
  for (const bad of [{ toString: () => 'x' }, ['a'], 42, null, undefined, true]) assert.equal(cleanText(bad, 12), '');
  assert.equal(validNeonText('WELKOM'), true);
  assert.equal(validNeonText(''), false);
  assert.equal(validNeonText(' x'), false);
  assert.equal(validNeonText('X'.repeat(15)), false);
});

test('evin önü: Achterstraat\'ta, ev genişliğinde; içeride / otelde değil', () => {
  const h1 = HOUSE_BY_ID.h1;
  assert.equal(frontOfHouse(h1.bounds.minX + 2, 30.5)?.id, 'h1');
  assert.equal(frontOfHouse(HOUSE_BY_ID.h5.bounds.minX + 0.1, 28)?.id, 'h5');
  assert.equal(frontOfHouse(h1.bounds.minX + 2, 35), null, 'evin içi');
  assert.equal(frontOfHouse(0, 10), null, 'otel');
  assert.equal(frontOfHouse(25, 30), null);
  assert.equal(frontOfHouse(NaN, 30), null);
});

// ---- Sunucu: yetki, para, eylemler ---------------------------------------------------------

test('yetki: yalnızca ev sahibi kendi evinin önünde; başkası, misafir, anahtarsız oyuncu reddedilir', () => {
  const { sim, front, act } = setup();
  const a = sim.addPlayer('Ali', KEY_A); // h1
  const b = sim.addPlayer('Bea', KEY_B); // h2
  const anon = sim.addPlayer('Anon');
  // Evin içindeyken ya da oteldeyken olmaz
  sim.movePlayer(a.id, -14.7, 36, 0);
  assert.match(act(a, { act: 'buyCans' }).error, /kendi evinin önüne/);
  sim.movePlayer(a.id, 0, 5, 0);
  assert.equal(act(a, { act: 'buyCans' }).ok, false);
  // Başkasının evinin önünde
  front(a, 'h2');
  assert.match(act(a, { act: 'buyCans' }).error, /Bea'nın — cepheyi yalnızca ev sahibi/);
  front(b, 'h1');
  for (const data of [{ act: 'buyCans' }, HEART, { act: 'neon', slot: 'door', text: 'HOI', c: 0 }, { act: 'balcony', c: 0 }, { act: 'untag', id: 1 }]) {
    assert.equal(act(b, data).ok, false, data.act);
  }
  // İçeri alınmış misafir de cepheye dokunamaz
  b.houseAccess.add('h1');
  assert.equal(act(b, { act: 'balcony', c: 0 }).ok, false);
  // Anahtarsız oyuncunun evi yok
  front(anon, 'h3');
  assert.match(act(anon, { act: 'buyCans' }).error, /boş/);
  sim.movePlayer(anon.id, 0, 5, 0);
  assert.match(act(anon, { act: 'buyCans' }).error, /bir evin olmalı/);
  // Sahibi kendi önünde: olur
  front(a, 'h1');
  assert.equal(act(a, { act: 'buyCans' }).ok, true);
  assert.equal(b.wallet, 200);
  assert.equal(anon.wallet, 200);
});

test('para ve sprey: kutu €3 = 4 sıkım, graffiti 1 sıkım, neon €12, balkon €25, eşyalar; iade yok', () => {
  const { sim, front, act, to, advance, states, ext } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  front(a, 'h1');
  assert.match(act(a, HEART).error, /Sprey kalmadı/);
  assert.deepEqual(act(a, { act: 'buyCans' }), { ok: true, sprays: 4 });
  assert.equal(a.wallet, 197);
  assert.equal(to.filter((e) => e.id === a.id && e.event === EVT.SELF).at(-1).payload.wallet, 197, 'SELF gönderilir');
  const r = act(a, HEART);
  assert.equal(r.ok, true);
  assert.equal(r.sprays, 3);
  assert.deepEqual(r.tag, { d: 'heart', c: 0, s: 0, x: 2.27, y: 0.4, id: 1 });
  assert.match(act(a, ABOVE).error, /hızlı/, 'iki graffiti arası bekleme');
  advance(600);
  assert.equal(act(a, ABOVE).ok, true);
  advance(600);
  // Serbest yazı temizlenir; isim etiketi yazısını sunucu koyar
  const c = act(a, { act: 'tag', d: 'custom', c: 2, s: 0, x: 0.36, y: 0.9, t: '<Hi>' });
  assert.equal(c.ok, true);
  assert.equal(c.tag.t, 'Hi');
  advance(600);
  const n = act(a, { act: 'tag', d: 'name', c: 3, s: 0, x: 3.0, y: 0.38, t: 'Sahte' });
  assert.equal(n.ok, true, n.error);
  assert.equal(n.tag.t, 'Ali');
  assert.equal(ext.houses.h1.sprays, 0);
  advance(600);
  assert.match(act(a, HEART).error, /Sprey kalmadı/);
  assert.equal(a.wallet, 197, 'graffiti para almaz, sprey alır');
  // Silme: iade yok
  assert.equal(act(a, { act: 'untag', id: 1 }).ok, true);
  assert.equal(act(a, { act: 'untag', id: 1 }).ok, false);
  assert.equal(a.wallet, 197);
  assert.deepEqual(states('h1').at(-1).tags.map((t) => t.d), ['amsterdam', 'custom', 'name']);
  // Kapı / pencere üstüne olmaz (sıkım harcanmaz)
  act(a, { act: 'buyCans' });
  assert.match(act(a, { ...HEART, x: 1.3, y: 1.2 }).error, /Kapı/);
  assert.equal(ext.houses.h1.sprays, 4);
  // Uzaktan olmaz
  sim.movePlayer(a.id, HOUSE_BY_ID.h1.bounds.maxX - 0.1, 26.7, 0);
  assert.match(act(a, { ...HEART, x: 0.36, y: 0.9 }).error, /yaklaş/);
  sim.movePlayer(a.id, HOUSE_BY_ID.h1.bounds.maxX - 0.5, 27.5, 0);
  assert.equal(act(a, { ...HEART, x: 0.36, y: 0.9 }).ok, true, 'hâlâ evin önünde ve erişimde');
  advance(600);

  // Neon
  front(a, 'h1');
  assert.match(act(a, { act: 'neon', slot: 'door', text: '   ', c: 0 }).error, /yazısını/);
  assert.match(act(a, { act: 'neon', slot: 'balcony', text: 'HOI', c: 0 }).error, /önce balkon/);
  assert.deepEqual(act(a, { act: 'neon', slot: 'door', text: 'Welkom thuis!!!!', c: 9 }), { ok: true, text: 'Welkom thuis!!' });
  assert.equal(a.wallet, 194 - 12);
  assert.match(act(a, { act: 'neon', slot: 'door', text: 'Welkom thuis!!', c: 9 }).error, /zaten/);
  assert.equal(act(a, { act: 'neon', slot: 'door', text: 'Welkom', c: 1 }).ok, true, 'değiştirmek yine €12');
  assert.equal(a.wallet, 170);
  assert.equal(act(a, { act: 'unneon', slot: 'door' }).ok, true);
  assert.equal(act(a, { act: 'unneon', slot: 'door' }).ok, false);
  assert.equal(a.wallet, 170);

  // Balkon + eşyalar
  assert.match(act(a, { act: 'item', item: 'table' }).error, /Önce balkon/);
  assert.equal(act(a, { act: 'balcony', c: 3 }).ok, false);
  assert.equal(act(a, { act: 'balcony', c: 2 }).ok, true);
  assert.equal(a.wallet, 170 - BALCONY.price);
  assert.match(act(a, { act: 'balcony', c: 0 }).error, /zaten/);
  for (const id of ['parasol', 'table', 'lights', 'flowers']) assert.equal(act(a, { act: 'item', item: id }).ok, true, id);
  assert.equal(a.wallet, 145 - 7 - 8 - 6 - 5);
  assert.deepEqual(ext.houses.h1.balcony, { c: 2, items: ['table', 'flowers', 'lights', 'parasol'] });
  assert.match(act(a, { act: 'item', item: 'table' }).error, /zaten/);
  assert.equal(act(a, { act: 'neon', slot: 'balcony', text: 'Gezellig', c: 4 }).ok, true);
  assert.equal(act(a, { act: 'unitem', item: 'table' }).ok, true);
  assert.equal(act(a, { act: 'unitem', item: 'table' }).ok, false);
  assert.equal(a.wallet, 119 - 12, 'söküm iadesiz');

  // Yetersiz para
  a.wallet = 2;
  assert.match(act(a, { act: 'buyCans' }).error, /€3 gerekli/);
  assert.match(act(a, { act: 'neon', slot: 'window', text: 'HOI', c: 0 }).error, /€12 gerekli/);
  assert.equal(a.wallet, 2);
  // Sprey stoğu sınırı
  a.wallet = 1000;
  while (act(a, { act: 'buyCans' }).ok);
  assert.ok(ext.houses.h1.sprays <= EXT_RULES.MAX_SPRAYS);
});

test('en fazla 16 graffiti; durum herkese EXTERIOR_STATE ile gider', () => {
  const { sim, front, act, advance, states } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  front(a, 'h1');
  for (let i = 0; i < 5; i++) act(a, { act: 'buyCans' });
  for (let i = 0; i < EXT_RULES.MAX_TAGS; i++) {
    assert.equal(act(a, { ...HEART, c: i % 8 }).ok, true, `#${i}`);
    advance(600);
  }
  assert.match(act(a, HEART).error, /en fazla 16/);
  const s = states('h1').at(-1);
  assert.equal(s.tags.length, 16);
  assert.equal(new Set(s.tags.map((t) => t.id)).size, 16, 'kimlikler benzersiz');
  assert.equal(s.sprays, 20 - 16);
});

test('kalıcılık: kayıt → yeniden yükleme aynı cephe; snapshot\'ta exterior; bozuk kayıt temizlenir', () => {
  const store = memoryStore();
  const s1 = setup({ store });
  const a = s1.sim.addPlayer('Ali', KEY_A);
  s1.front(a, 'h1');
  s1.act(a, { act: 'buyCans' });
  s1.act(a, HEART);
  s1.advance(600);
  s1.act(a, { act: 'tag', d: 'custom', c: 1, s: 0, x: 3.0, y: 2.7, t: 'Gezellig' });
  s1.act(a, { act: 'balcony', c: 1 });
  s1.act(a, { act: 'item', item: 'lights' });
  s1.act(a, { act: 'neon', slot: 'balcony', text: 'Hoi!', c: 9 });
  s1.act(a, { act: 'neon', slot: 'window', text: 'Open', c: 5 });
  const before = s1.sim.exterior.serialize();
  assert.deepEqual(s1.sim.snapshot(a.id).exterior, before);
  assert.deepEqual(Object.keys(before), ['h1']);
  s1.sim.house.flush();
  assert.deepEqual(store.data.exterior, before);

  const s2 = setup({ store: memoryStore(JSON.parse(JSON.stringify(store.data))) });
  assert.deepEqual(s2.sim.exterior.serialize(), before);
  // Yeni kimlikler eskilerle çakışmaz
  const a2 = s2.sim.addPlayer('Ali', KEY_A);
  s2.front(a2, 'h1');
  s2.advance(600);
  const r = s2.act(a2, { ...HEART, x: 0.36, y: 1.0 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.tag.id, 3);

  // Bozuk / elle düzenlenmiş kayıt
  const bad = JSON.parse(JSON.stringify(store.data));
  const good = bad.exterior.h1.tags[0];
  bad.exterior.h1.sprays = 1e9;
  bad.exterior.h1.tags.push(
    { ...good }, // aynı kimlik
    { ...good, id: 50, x: 1.3, y: 1.2 }, // kapının üstü
    { ...good, id: 51, c: { toString: 1 } },
    { ...good, id: 52, x: 'NaN' },
    { ...good, id: 53, d: '__proto__' },
    { ...good, id: 1e12 },
    { ...good, id: -1 },
    { ...good, id: 54, s: 7 },
    { id: 55, d: 'custom', c: 0, s: 0, x: 3.0, y: 2.7, t: { length: 3 } },
    null, 'tag', 42,
  );
  for (let i = 0; i < 40; i++) bad.exterior.h1.tags.push({ ...good, id: 100 + i });
  bad.exterior.h1.neon.__proto__ = { text: 'x', c: 0 };
  bad.exterior.h1.neon.constructor = { text: 'x', c: 0 };
  bad.exterior.h1.neon.door = { text: '<script>', c: 0 };
  bad.exterior.h1.neon.window = { text: 'Open', c: 99 };
  bad.exterior.h1.balcony.items.push('__proto__', 'hottub', 'lights');
  bad.exterior.h2 = { sprays: 4, tags: [good], neon: {}, balcony: null }; // sahipsiz ev
  bad.exterior.__proto__ = { sprays: 4 };
  const s3 = setup({ store: memoryStore(JSON.parse(JSON.stringify(bad))) });
  const e = s3.sim.exterior.serialize();
  assert.deepEqual(Object.keys(e), ['h1']);
  assert.equal(e.h1.sprays, EXT_RULES.MAX_SPRAYS);
  assert.equal(e.h1.tags.length, EXT_RULES.MAX_TAGS);
  assert.equal(new Set(e.h1.tags.map((t) => t.id)).size, EXT_RULES.MAX_TAGS);
  for (const t of e.h1.tags) assert.equal(validateTag([], t).ok, true);
  assert.deepEqual(e.h1.neon, { balcony: { text: 'Hoi!', c: 9 } });
  assert.deepEqual(e.h1.balcony, { c: 1, items: ['lights'] });
  assert.equal(Object.getPrototypeOf(s3.sim.exterior.houses), null);

  // Tamamen çöp kayıtlar çökertmez
  for (const junk of [[], 'x', 42, { h1: [] }, { h1: { tags: 'x', neon: [], balcony: { c: '1' } } }, { h1: { sprays: -5, balcony: { c: 0, items: 'table' } } }]) {
    const s = setup({ store: memoryStore({ ...JSON.parse(JSON.stringify(store.data)), exterior: junk }) });
    const out = s.sim.exterior.serialize();
    for (const ex of Object.values(out)) {
      assert.ok(Array.isArray(ex.tags));
      assert.ok(Number.isInteger(ex.sprays) && ex.sprays >= 0);
    }
  }
  const s4 = setup({ store: memoryStore({ ...JSON.parse(JSON.stringify(store.data)), exterior: { h1: { sprays: -5, balcony: { c: 0, items: 'table' } } } }) });
  assert.deepEqual(s4.sim.exterior.serialize().h1, { sprays: 0, tags: [], neon: {}, balcony: { c: 0, items: [] } });
});

test('evden çıkarma: ev boşaltılınca cephesi temizlenir ve yayınlanır; yeni sahip boş cephe görür', () => {
  const store = memoryStore();
  const { sim, front, act, states, advance } = setup({ store });
  const a = sim.addPlayer('Ali', KEY_A);
  front(a, 'h1');
  act(a, { act: 'buyCans' });
  act(a, HEART);
  act(a, { act: 'balcony', c: 0 });
  act(a, { act: 'neon', slot: 'door', text: 'Ali', c: 0 });
  assert.equal(states('h1').at(-1).tags.length, 1);
  sim.removePlayer(a.id);
  // Diğer 7 ev dolsun, Ali 3 günden uzun süre gelmesin
  for (let i = 0; i < 7; i++) sim.addPlayer(`P${i}`, key(String(i)));
  advance(4 * DAY_MS);
  const z = sim.addPlayer('Zoe', key('f'));
  assert.equal(sim.house.houseIdOf(z), 'h1');
  assert.deepEqual(states('h1').at(-1), { sprays: 0, tags: [], neon: {}, balcony: null });
  assert.equal(sim.exterior.serialize().h1, undefined);
  sim.house.flush();
  assert.equal(store.data.exterior.h1, undefined);
  // Doğrudan evict de temizler (boş cephede yayın yok)
  const n = states('h1').length;
  sim.house.evict('h1');
  assert.equal(states('h1').length, n);
});

test('kötü niyetli girdiler: prototip anahtarları, {toString:1}, NaN, dev sayılar çökertmez', () => {
  const { sim, front, act, ext } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  front(a, 'h1');
  act(a, { act: 'buyCans' });
  const evil = { toString: 1, valueOf: 1 };
  const inputs = [
    null, undefined, 42, 'tag', [], { act: evil }, { act: '__proto__' }, { act: 'constructor' }, { act: 'toString' }, { act: 'hasOwnProperty' },
    { act: 'tag', d: evil }, { act: 'tag', d: 'heart', c: evil, s: 0, x: 2.27, y: 0.4 }, { act: 'tag', d: 'heart', c: 0, s: 0, x: NaN, y: 0.4 },
    { act: 'tag', d: 'heart', c: 0, s: 0, x: 1e308, y: 1e308 }, { act: 'tag', d: 'heart', c: 0, s: 0, x: -1e308, y: 0.4 },
    { act: 'tag', d: 'heart', c: '0', s: '0', x: '2.27', y: '0.4' }, { act: 'tag', d: 'heart', c: 0, s: 0, x: [2.27], y: [0.4] },
    { act: 'tag', d: 'custom', c: 0, s: 0, x: 3, y: 2.7, t: evil }, { act: 'tag', d: 'custom', c: 0, s: 0, x: 3, y: 2.7, t: ['Hoi'] },
    { act: 'tag', d: '__proto__', c: 0, s: 0, x: 2.27, y: 0.4 }, { act: 'tag', d: 'constructor', c: 0, s: 0, x: 2.27, y: 0.4 },
    { act: 'untag', id: evil }, { act: 'untag', id: '1' }, { act: 'untag', id: NaN },
    { act: 'neon', slot: '__proto__', text: 'x', c: 0 }, { act: 'neon', slot: 'constructor', text: 'x', c: 0 }, { act: 'neon', slot: evil, text: 'x', c: 0 },
    { act: 'neon', slot: 'door', text: evil, c: 0 }, { act: 'neon', slot: 'door', text: 'x', c: evil }, { act: 'neon', slot: 'door', text: 'x', c: 1e9 },
    { act: 'neon', slot: 'door', text: 'x', c: '1' }, { act: 'unneon', slot: '__proto__' },
    { act: 'balcony', c: evil }, { act: 'balcony', c: NaN }, { act: 'balcony', c: '0' },
    { act: 'item', item: '__proto__' }, { act: 'item', item: 'constructor' }, { act: 'unitem', item: 'toString' },
  ];
  for (const data of inputs) {
    const r = act(a, data);
    assert.equal(r.ok, false, JSON.stringify(data));
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(a.wallet, 197, 'hiçbir şey ödenmedi');
  assert.equal(ext.houses.h1.tags.length, 0);
  assert.equal(ext.houses.h1.sprays, 4);
  assert.equal(GRAFFITI_BY_ID.__proto__, undefined);
  assert.equal(NEON_SLOT_BY_ID.constructor, undefined);
  assert.equal(BALCONY_ITEM_BY_ID.toString, undefined);
  assert.equal(PLAYER_HOUSES.length, 8);
});

test('ağ katmanı: EXTERIOR_ACT bağlı ve hız sınırlı; WELCOME cepheleri içerir; durum herkese yayınlanır', async () => {
  const sim = new HotelSimulation({ config, now: () => 1_000_000 });
  sim.start = () => {};
  sim.stop = () => {};
  const broadcasts = [];
  let onConnection = null;
  const io = { on(ev, fn) { if (ev === 'connection') onConnection = fn; }, emit(event, payload) { broadcasts.push({ event, payload }); } };
  attachSocketHandlers(io, sim);
  const connect = () => {
    const handlers = new Map();
    const socket = {
      sent: [],
      on(ev, fn) { handlers.set(ev, fn); },
      emit(event, payload) { this.sent.push({ event, payload }); },
      disconnect() {},
      fire: (ev, ...args) => handlers.get(ev)(...args),
      request: (ev, data) => new Promise((resolve) => { handlers.get(ev)(data, resolve); }),
    };
    onConnection(socket);
    return socket;
  };
  const s1 = connect();
  await s1.fire(EVT.JOIN, { name: 'Ali', key: KEY_A });
  const w1 = s1.sent.find((e) => e.event === EVT.WELCOME).payload;
  assert.deepEqual(w1.exterior, {});
  const ali = sim.players.get(w1.selfId);
  sim.movePlayer(ali.id, HOUSE_BY_ID.h1.bounds.minX + 2.1, 30.5, Math.PI);
  assert.deepEqual(await s1.request(EVT.EXTERIOR_ACT, { act: 'buyCans' }), { ok: true, sprays: 4 });
  assert.equal((await s1.request(EVT.EXTERIOR_ACT, { act: 'balcony', c: 0 })).ok, true);
  assert.equal((await s1.request(EVT.EXTERIOR_ACT, null)).ok, false);
  const st = broadcasts.filter((e) => e.event === EVT.EXTERIOR_STATE).at(-1).payload;
  assert.equal(st.houseId, 'h1');
  assert.deepEqual(st.exterior.balcony, { c: 0, items: [] });
  // Yeni bağlanan oyuncu mevcut cepheleri görür
  const s2 = connect();
  await s2.fire(EVT.JOIN, { name: 'Bea', key: KEY_B });
  const w2 = s2.sent.find((e) => e.event === EVT.WELCOME).payload;
  assert.deepEqual(w2.exterior.h1, { sprays: 4, tags: [], neon: {}, balcony: { c: 0, items: [] } });
  // Hız sınırı (houseGuard)
  let fast = 0;
  for (let i = 0; i < 30; i++) if ((await s2.request(EVT.EXTERIOR_ACT, { act: 'buyCans' })).error === 'Çok hızlı!') fast++;
  assert.ok(fast > 0);
});

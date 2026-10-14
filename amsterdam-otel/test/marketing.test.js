import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, ROOM_STATUS, GUEST_PHASE, CHECKIN_CLOSE_MIN } from '../shared/constants.js';
import { RECEPTION } from '../shared/layout.js';
import {
  INSTA, TOURIST, AD_BUDGETS, budgetTier, isPhotoDataUrl, cleanCaption, isPlaceId, placeLabel, queueSpot, formatCount,
} from '../shared/marketing.js';

const config = {
  dayLengthSec: 100_000, nightLengthSec: 120, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 50, starterBed: false,
};
const KEY = 'c'.repeat(32);
const KEY2 = 'd'.repeat(32);
// Geçerli biçimde küçük bir "JPEG" (FF D8 FF imzası = '/9j/'), uzunluğu 4'ün katı
const PHOTO = `data:image/jpeg;base64,/9j/${'A'.repeat(400)}`;

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

/** @param fast true → gün 240 sn (misafir akışı testleri), değilse saat neredeyse durur */
function setup({ store = null, hour = 10, fast = false, guests = false } = {}) {
  let now = 5_000_000;
  const sim = new HotelSimulation({
    config: { ...config, ...(fast ? { dayLengthSec: 240 } : {}), startDay: 1, startHour: hour },
    rng: seeded(),
    now: () => now,
    house: { store },
  });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  const toP = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => toP.push({ id, event, payload }));
  const p = sim.addPlayer('Ece', KEY);
  if (!guests) sim.guests.nextSpawnAt = Infinity;
  sim.bar.nextSpawnAt = Infinity;
  sim.money = 1000;
  const tick = (ms, step = 100, each = null) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      sim.tick(now);
      each?.();
    }
  };
  const insta = (data, who = p) => sim.instaAct(who.id, data);
  const post = (extra = {}, who = p) => insta({ act: 'post', photo: PHOTO, caption: 'Merhaba Amsterdam!', budget: 0, place: 'bar', ...extra }, who);
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  return { sim, p, tick, insta, post, events, toP, advance: (ms) => { now += ms; }, getNow: () => now };
}

test('kurallar: bütçe katı eşleşme, fotoğraf biçimi, açıklama, konum etiketi, sayaç biçimi', () => {
  assert.deepEqual(AD_BUDGETS.map((t) => t.budget), [0, 50, 150, 300]);
  assert.equal(budgetTier(150).budget, 150);
  for (const bad of ['150', NaN, 100, -50, Infinity, null, undefined, { valueOf: () => 150 }, [150]]) assert.equal(budgetTier(bad), undefined);
  assert.equal(isPhotoDataUrl(PHOTO), true);
  assert.equal(isPhotoDataUrl(PHOTO.replace('jpeg', 'png')), false);
  assert.equal(isPhotoDataUrl(`${PHOTO.slice(0, -4)}<b>x`), false);
  assert.equal(isPhotoDataUrl(`${PHOTO}A`), false, 'uzunluk 4\'ün katı olmalı');
  assert.equal(isPhotoDataUrl(`data:image/jpeg;base64,/9j/${'A'.repeat(INSTA.PHOTO_MAX_LEN)}`), false, 'çok büyük');
  assert.equal(isPhotoDataUrl({ toString: () => PHOTO }), false);
  assert.equal(cleanCaption(`  a\u0000b <script>  ${'x'.repeat(300)}`).length, INSTA.CAPTION_MAX);
  assert.equal(cleanCaption('   '), '');
  assert.equal(cleanCaption(5), null);
  assert.equal(isPlaceId('__proto__'), false);
  assert.equal(isPlaceId('constructor'), false);
  assert.equal(isPlaceId('203'), true);
  assert.equal(placeLabel('bar'), 'Bar De Tulp');
  assert.equal(placeLabel('203'), 'Oda 203');
  assert.equal(placeLabel('h3'), 'Huis 3');
  assert.equal(placeLabel('h3', { houseName: "Ece'nin evi" }), "Ece'nin evi");
  assert.equal(placeLabel({}), 'Amsterdam');
  assert.deepEqual(queueSpot(0), [RECEPTION.front[0] + TOURIST.QUEUE_GAP, RECEPTION.front[1]]);
  assert.equal(formatCount(950), '950');
  assert.equal(formatCount(1234), '1,2B');
  assert.equal(formatCount(25_300), '25B');
});

test('gönderi doğrulaması: fotoğraf, açıklama, bütçe, konum, prototip anahtarları, kasa, hız sınırı', () => {
  const { sim, insta, post, events, advance } = setup();
  const badPhotos = [
    undefined, 5, { toString: () => PHOTO }, [PHOTO],
    PHOTO.replace('image/jpeg', 'image/png'),
    PHOTO.replace('/9j/', 'AAAA'), // JPEG imzası yok
    `data:image/jpeg;base64,/9j/${'A'.repeat(INSTA.PHOTO_MAX_LEN)}`, // çok büyük
    `${PHOTO.slice(0, 60)}"><img src=x onerror=alert(1)>${'A'.repeat(200)}`,
    `javascript:alert(1)//${'A'.repeat(300)}`,
    `data:image/jpeg;base64,/9j/${'A'.repeat(399)}`, // uzunluk 4'ün katı değil
  ];
  for (const photo of badPhotos) assert.match(post({ photo }).error, /Fotoğraf/, String(photo).slice(0, 40));
  for (const caption of [5, null, { toString: () => 'x' }, ['a']]) assert.match(post({ caption }).error, /Açıklama/);
  for (const budget of ['150', NaN, 100, -50, null, undefined, { valueOf: () => 150 }, Infinity]) {
    assert.match(post({ budget }).error, /bütçe/, String(budget));
  }
  for (const place of ['__proto__', 'constructor', 'toString', 5, { x: 1 }, 'x'.repeat(30)]) assert.match(post({ place }).error, /konum/);
  for (const bad of [null, 'post', [], { act: '__proto__' }, { act: 'constructor' }, Object.create({ act: 'post' })]) {
    assert.equal(insta(bad).ok, false);
  }
  sim.money = 149;
  assert.match(post({ budget: 150 }).error, /Kasada yeterli para yok/);
  assert.equal(sim.money, 149, 'reddedilen gönderi para çekmez');
  assert.equal(events(EVT.INSTA_FEED).length, 0);

  const res = post({ caption: '<b>Kanal</b> manzarası\u202e!', place: '203' });
  assert.equal(res.ok, true);
  const feed = events(EVT.INSTA_FEED).at(-1);
  assert.equal(feed.post.caption, 'bKanal/b manzarası!');
  assert.equal(feed.post.place, 'Oda 203');
  assert.equal(feed.post.photo, PHOTO);
  assert.match(post().error, /bekle/, 'oyuncu başına 20 sn');
  advance(INSTA.POST_COOLDOWN_MS);
  assert.equal(post({ place: null }).ok, true);
  assert.equal(events(EVT.INSTA_FEED).at(-1).post.place, 'Amsterdam');
});

test('ücretli kampanya: kasadan düşer, 1 oyun günü turist akını (boost), aynı anda tek kampanya', () => {
  const { sim, p, post, events, advance } = setup();
  sim.money = 1000;
  const total0 = sim.clock.total;
  assert.equal(post({ budget: 150 }).ok, true);
  assert.equal(sim.money, 850);
  assert.ok(events(EVT.ECONOMY).some((e) => e.delta === -150));
  const b = sim.boosts.list.find((x) => x.source === 'insta');
  assert.ok(b);
  assert.ok(Math.abs(b.untilTotal - (total0 + 1440)) < 0.01, 'bitiş: 1 oyun günü sonra');
  assert.equal(b.guestSpawn, 3);
  assert.ok(b.barSpawn > 1 && b.barTip > 1);
  assert.equal(sim.marketing.rushActive, true);
  assert.equal(sim.snapshot(p.id).insta.rushUntil, b.untilTotal);
  assert.ok(events(EVT.BOOSTS).at(-1).some((x) => x.source === 'insta'));

  // Kampanya sürerken ikinci ücretli kampanya açılamaz; organik serbest
  const q = sim.addPlayer('Mert', KEY2);
  assert.match(post({ budget: 50 }, q).error, /süren bir reklam kampanyası/);
  assert.equal(sim.money, 850);
  assert.equal(post({ budget: 0 }, q).ok, true);

  // Bir oyun günü sonra biter (yarım gün sonra hâlâ sürer)
  sim.clock.minute += 720;
  sim.boosts.update();
  assert.equal(sim.marketing.rushActive, true);
  sim.clock.dayCount += 1;
  sim.boosts.update();
  assert.equal(sim.marketing.rushActive, false);
  assert.ok(events(EVT.NOTIFY).some((n) => /kampanyası — turist akını sona erdi/.test(n.text)));
  advance(INSTA.POST_COOLDOWN_MS);
  assert.equal(post({ budget: 300 }).ok, true, 'biten kampanyadan sonra yenisi');
  assert.equal(sim.boosts.list.find((x) => x.source === 'insta').guestSpawn, 4);
});

test('beğeni: oyuncu başına bir kez, geçersiz id reddedilir; akış ve fotoğraf isteği', () => {
  const { sim, p, insta, post, events } = setup();
  const { id } = post();
  for (const bad of ['1', 1.5, NaN, null, { toString: () => '1' }, 999]) assert.equal(insta({ act: 'like', id: bad }).ok, false);
  const r = insta({ act: 'like', id });
  assert.equal(r.ok, true);
  assert.equal(r.likes, 1);
  assert.match(insta({ act: 'like', id }).error, /zaten/);
  assert.deepEqual(events(EVT.INSTA_STATS).at(-1).p, [[id, 1]]);
  const q = sim.addPlayer('Mert', KEY2);
  assert.equal(insta({ act: 'like', id }, q).likes, 2);
  const feed = insta({ act: 'feed' });
  assert.equal(feed.ok, true);
  assert.equal(feed.account, '@hotel.amsterdam');
  assert.deepEqual(feed.liked, [id]);
  assert.equal(feed.posts[0].likes, 2);
  assert.equal(insta({ act: 'photo', id }).photo, PHOTO);
  assert.equal(insta({ act: 'photo', id: '1' }).ok, false);
  assert.deepEqual(sim.snapshot(p.id).insta.liked, [id]);
});

test('beğeni / takipçi artışı zamanla, bütçe ve yıldızla ölçeklenir; eşik bildirimi yazara gider', () => {
  const organic = setup();
  organic.post({ budget: 0 });
  organic.tick(120_000, 500);
  const viral = setup();
  viral.post({ budget: 300 });
  const stats = viral.events(EVT.INSTA_STATS);
  assert.equal(stats.length, 0, 'artış hemen değil, adım adım');
  viral.tick(120_000, 500);
  const oPost = organic.sim.marketing.posts[0];
  const vPost = viral.sim.marketing.posts[0];
  assert.equal(vPost.grow, null, 'artış bitti');
  assert.ok(oPost.likes >= 20 && oPost.likes <= 70, `organik ${oPost.likes}`);
  assert.ok(vPost.likes >= 1200, `viral ${vPost.likes}`);
  assert.ok(viral.sim.marketing.followers > organic.sim.marketing.followers * 5);
  const steps = viral.events(EVT.INSTA_STATS);
  assert.ok(steps.length >= 10, 'birçok küçük adım');
  assert.ok(steps.every((s) => Number.isInteger(s.f) && s.p.every(([i, l]) => i === vPost.id && Number.isInteger(l))), 'yalnızca sayaçlar');
  const likesSeq = steps.map((s) => s.p[0]?.[1]).filter((x) => x !== undefined);
  assert.ok(likesSeq.every((v, i) => i === 0 || v >= likesSeq[i - 1]), 'artış monoton');
  assert.ok(viral.toP.some((m) => m.id === viral.p.id && /Gönderin 1(,0)?B? beğeniye ulaştı|Gönderin 500 beğeniye/.test(m.payload.text)));
  assert.ok(viral.events(EVT.NOTIFY).some((n) => /takipçiye ulaştı/.test(n.text)));

  // 5★ otelin aynı bütçeli gönderisi daha çok etkileşim alır
  const star = setup();
  star.sim.growth.reputation = 500;
  star.post({ budget: 300 });
  star.tick(120_000, 500);
  assert.ok(star.sim.marketing.posts[0].likes > vPost.likes * 1.5);
});

test('turist akını: kafileler, resepsiyon kuyruğu (sınır, sıra, öne geçiş) ve 19:00\'da dağılma', () => {
  const { sim, post, tick, events } = setup({ fast: true, guests: true, hour: 9 });
  sim.growth.floors = 4; // 16 oda: kuyruk tam dolabilsin
  assert.equal(post({ budget: 300 }).ok, true);
  sim.guests.nextSpawnAt = sim.clock.total; // ilk kafile hemen
  const joinOrder = [];
  const checkinOrder = [];
  let maxQueue = 0;
  let sawStanding = false;
  tick(60_000, 100, () => {
    const gm = sim.guests;
    maxQueue = Math.max(maxQueue, gm.queue.length);
    assert.ok(gm.queue.length <= TOURIST.QUEUE_MAX, 'kuyruk sınırı aşılmaz');
    for (const id of gm.queue) if (!joinOrder.includes(id)) joinOrder.push(id);
    let atDesk = 0;
    for (const g of gm.guests.values()) {
      if (g.phase === GUEST_PHASE.CHECKIN && !checkinOrder.includes(g.id)) checkinOrder.push(g.id);
      if (g.phase === GUEST_PHASE.ARRIVE || g.phase === GUEST_PHASE.CHECKIN) atDesk++;
      if (g.phase === TOURIST.PHASE && g.path.length === 1) {
        sawStanding = true;
        const i = gm.queue.indexOf(g.id);
        assert.ok(i >= 0, 'bekleyen misafir kuyrukta');
        assert.ok(Math.abs(g.path[0][1] - RECEPTION.front[1]) < 1e-9, 'sıra masanın önünden +X yönünde');
        assert.ok(g.path[0][0] > RECEPTION.front[0]);
      }
    }
    assert.ok(atDesk <= 1, 'masada tek misafir');
  });
  assert.ok(maxQueue >= 3, `kuyruk oluştu (en fazla ${maxQueue})`);
  assert.ok(sawStanding);
  assert.ok(events(EVT.NOTIFY).some((n) => /turist kafilesi/.test(n.text)));
  const wires = events(EVT.GUEST_UPSERT);
  assert.ok(wires.some((g) => g.tourist === true && g.phase === TOURIST.PHASE));
  // Kuyruğa girenler girdikleri sırayla kayıt olur
  const queuedCheckins = checkinOrder.filter((id) => joinOrder.includes(id));
  assert.ok(queuedCheckins.length >= 3);
  assert.deepEqual(queuedCheckins, joinOrder.slice(0, queuedCheckins.length), 'ilk giren ilk kayıt olur');

  // 19:00: kabul kapanır → sıradakiler ve gelmekte olan kafile ayrılır
  sim.clock.minute = CHECKIN_CLOSE_MIN - 0.01;
  sim.guests.pending.push(Infinity);
  const queued = [...sim.guests.queue];
  assert.ok(queued.length > 0, 'kapanışta sırada misafir var');
  tick(1000);
  assert.equal(sim.guests.queue.length, 0);
  assert.equal(sim.guests.pending.length, 0);
  for (const id of queued) {
    const g = sim.guests.guests.get(id);
    if (g) assert.equal(g.phase, GUEST_PHASE.LEAVE);
  }
  assert.ok(events(EVT.NOTIFY).some((n) => /sıradaki misafirler ayrıldı/.test(n.text)));
  tick(30_000);
  assert.ok([...sim.guests.guests.values()].every((g) => g.phase !== TOURIST.PHASE));
});

test('kampanya yokken eski akış: tek tek misafir, kuyruk yok', () => {
  const { sim, tick } = setup({ fast: true, guests: true, hour: 9 });
  let max = 0;
  tick(60_000, 100, () => { max = Math.max(max, sim.guests.queue.length, sim.guests.pending.length); });
  assert.equal(max, 0);
  assert.ok([...sim.guests.guests.values()].every((g) => !g.tourist));
});

test('turist akını yeterli sürede açık katlardaki tüm odaları doldurur (%100 doluluk)', () => {
  const { sim, post, tick } = setup({ fast: true, guests: true, hour: 8 });
  sim.growth.floors = 2; // 8 oda
  sim.money = 1000;
  assert.equal(post({ budget: 300 }).ok, true);
  let full = false;
  let lost = 0;
  sim.on('out', (e, n) => { if (e === EVT.NOTIFY && /boş oda bulamadığı/.test(n.text)) lost++; });
  tick(150_000, 100, () => {
    if (full) return;
    const open = [...sim.rooms.rooms.values()].filter((r) => Number(r.id[0]) <= 2);
    full = open.every((r) => r.status === ROOM_STATUS.OCCUPIED);
  });
  assert.ok(full, 'tüm odalar dolu');
  assert.equal(lost, 0, 'kafileler oda kapasitesini aşmaz');
});

test('kalıcılık: takipçi, son gönderiler (fotoğrafıyla) ve beğenenler geri gelir; bozuk kayıt temizlenir', () => {
  const store = memoryStore();
  const a = setup({ store });
  for (let i = 0; i < 8; i++) {
    assert.equal(a.post({ caption: `Gönderi ${i}`, place: i === 7 ? a.sim.house.houseIdOf(a.p) : 'lobby' }).ok, true);
    a.advance(INSTA.POST_COOLDOWN_MS);
  }
  const lastId = a.sim.marketing.posts.at(-1).id;
  assert.match(a.sim.marketing.posts.at(-1).place, /Ece'nin evi/);
  assert.equal(a.insta({ act: 'like', id: lastId }).ok, true);
  a.tick(60_000, 1000);
  const followers = a.sim.marketing.followers;
  assert.ok(followers > 0);
  a.sim.house.flush();
  assert.equal(store.data.hotel.insta.posts.length, INSTA.PERSIST_POSTS);

  const b = setup({ store });
  const m = b.sim.marketing;
  assert.equal(m.followers, followers);
  assert.equal(m.posts.length, INSTA.PERSIST_POSTS);
  assert.equal(m.posts.at(-1).id, lastId);
  assert.equal(m.posts.at(-1).photo, PHOTO);
  assert.equal(m.posts.at(-1).caption, 'Gönderi 7');
  assert.match(b.insta({ act: 'like', id: lastId }).error, /zaten/, 'beğeni kaydı kalıcı');
  assert.ok(b.post().ok);
  assert.ok(m.posts.at(-1).id > lastId, 'id çakışmaz');
  const snap = b.sim.snapshot(b.p.id).insta;
  assert.equal(snap.posts.filter((x) => x.photo).length, INSTA.SNAPSHOT_PHOTOS, 'WELCOME\'da yalnızca en yeni 4 fotoğraf');
  assert.ok(JSON.stringify(b.sim.snapshot(b.p.id)).length < 600_000);

  const data = JSON.parse(JSON.stringify(store.data));
  data.hotel.insta = {
    followers: -5,
    nextId: 'x',
    posts: [null, 'x', { id: '1' }, { id: 2, caption: 5, budget: 0 }, { id: 3, caption: 'a', budget: 999 },
      { id: 4, caption: '<i>ok</i>', budget: 0, photo: PHOTO.replace('jpeg', 'png'), by: { x: 1 }, color: 'red', likes: -3, likers: ['x', 5] },
      { id: 4, caption: 'kopya', budget: 0 }, { ['__proto__']: { id: 9 } }],
  };
  const c = setup({ store: memoryStore(data) });
  const cm = c.sim.marketing;
  assert.equal(cm.followers, 0);
  assert.equal(cm.posts.length, 1);
  const only = cm.posts[0];
  assert.deepEqual([only.id, only.caption, only.photo, only.by, only.color, only.likes], [4, 'iok/i', null, 'Görevli', '#ff7a1a', 0]);
  assert.equal(cm.nextId, 5);
  assert.equal(c.insta({ act: 'photo', id: 4 }).ok, false);

  const d = setup({ store: memoryStore({ ...JSON.parse(JSON.stringify(store.data)), hotel: { ...store.data.hotel, insta: 'bozuk' } }) });
  assert.equal(d.sim.marketing.posts.length, 0);
});

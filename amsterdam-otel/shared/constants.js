// Sunucu ve istemci tarafından ortak kullanılan sabitler.
// Bu dosya hem Node.js (ESM) hem tarayıcı tarafından doğrudan import edilir;
// bu yüzden yalnızca saf JavaScript içerir, hiçbir ortama özgü API kullanmaz.

// Kat başına 4 oda; 1. kat hep açık, 2–4. katlar Resepsiyon PC'den satın alınır (shared/hotel.js),
// 5–12. katlar lüks paketlerle (shared/architecture.js): 101 … 404, 501 … 1204
export const ROOM_IDS = Object.freeze(Array.from({ length: 12 }, (_, i) => i + 1).flatMap((f) => [1, 2, 3, 4].map((n) => `${f}0${n}`)));
/** Odanın katı ('203' → 2, '1104' → 11) */
export const roomFloor = (id) => Number(id.slice(0, -2));

export const ROOM_STATUS = Object.freeze({
  EMPTY: 'bos',
  OCCUPIED: 'dolu',
  DIRTY: 'kirli',
});

export const ROOM_STATUS_LABEL = Object.freeze({
  bos: 'Boş',
  dolu: 'Dolu',
  kirli: 'Kirli',
});

export const DAY_NAMES = Object.freeze([
  'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar',
]);

/** 0 = Pazartesi ... 5 = Cumartesi, 6 = Pazar */
export const isWeekend = (dayOfWeek) => dayOfWeek >= 5;

// Oyun saati (gün içi dakika). Gün 07:00'de başlar, 23:00'te biter;
// gece atlanır (bir sonraki gün 07:00'ye geçilir).
export const DAY_START_MIN = 7 * 60;
export const DAY_END_MIN = 23 * 60;
export const CHECKIN_OPEN_MIN = 8 * 60;
export const CHECKIN_CLOSE_MIN = 19 * 60;
export const MINUTES_PER_DAY = 24 * 60;

export const ROOM_PRICE = 95; // € / konaklama
export const GUEST_SPEED = 1.4; // m/sn
export const CHECKIN_MS = 2500; // resepsiyonda kayıt süresi (gerçek ms)
export const MAX_WAITING = 3; // lobide bekleyebilecek misafir sayısı
export const WAIT_LIMIT_MIN = 90; // oyun dakikası

export const TRASH_SPOT_COUNT = 4;
export const INTERACT_RANGE = { bed: 2.4, trash: 1.9 };

// Ağ olayları (tek yerde tutulur, yazım hatası riskini azaltır)
export const EVT = Object.freeze({
  // istemci -> sunucu
  JOIN: 'join',
  MOVE: 'move',
  INTERACT: 'interact',
  SYNC: 'sync',
  // sunucu -> istemci
  WELCOME: 'welcome',
  CLOCK: 'clock',
  ROOMS: 'rooms',
  ECONOMY: 'economy',
  GUEST_UPSERT: 'guest:upsert',
  GUEST_REMOVE: 'guest:remove',
  PLAYER_JOIN: 'player:join',
  PLAYER_LEAVE: 'player:leave',
  PLAYERS: 'players',
  NOTIFY: 'notify',
  // Coffee shop / trip
  SHOP_BUY: 'shop:buy',
  CONSUME: 'consume',
  SLOT_SPIN: 'slot:spin',
  EMOTE: 'emote',
  SELF: 'self', // yalnızca o oyuncuya: cüzdan, envanter, trip
  PLAYER_TRIP: 'player:trip', // herkese: kimin trip'te olduğu (yavaşlama/animasyon için)
  PLAYER_EMOTE: 'player:emote', // herkese: kıkırdama / kusma animasyonu
  // Bizim Ev (istemci → sunucu, ack ile)
  HOUSE_PLACE: 'house:place',
  HOUSE_REMOVE: 'house:remove',
  HOUSE_LIGHTS: 'house:lights',
  HOUSE_TV_SET: 'house:tvSet',
  HOUSE_TV_STOP: 'house:tvStop',
  // Bizim Ev (sunucu → herkes)
  HOUSE_ADDED: 'house:added',
  HOUSE_REMOVED: 'house:removed',
  HOUSE_LIGHTS_STATE: 'house:lightsState',
  HOUSE_TV_STATE: 'house:tvState',
  // Oyuncu evleri: kapı zili ve erişim
  HOUSE_RING: 'house:ring', // ziyaretçi → sunucu (ack): { houseId }
  HOUSE_RING_REQ: 'house:ringReq', // sunucu → ev sahibi: { ringId, houseId, visitorId, visitorName, expiresAt }
  HOUSE_RING_ANSWER: 'house:ringAnswer', // ev sahibi → sunucu (ack): { ringId, accept }
  HOUSE_ACCESS: 'house:access', // sunucu → ziyaretçi: { houseId, granted, by, reason? }
  HOUSE_OWNERS: 'house:owners', // sunucu → herkes: [{ houseId, owner: { name, online, playerId } | null }]
  // Bar De Tulp (alkolsüz bar)
  BAR_ACT: 'bar:act', // istemci → sunucu (ack): { act, ing?, stool?, food? }
  BAR_STATE: 'bar:state', // sunucu → herkes: tabureler, siparişler, raf, tezgâhtaki bardaklar
  PLAYER_BAR: 'player:bar', // sunucu → herkes: { id, hold, color, act, until } (uzaktan el animasyonu)
  // Gurme Restoran & mutfak (server/game/RestaurantService.js, KitchenStaffService.js)
  KITCHEN_ACT: 'kitchen:act', // istemci → sunucu (ack): { act: 'take'|'cook'|'plate'|'pass'|'pick'|'serve'|'clear'|'wash'|'trash'|'restock', ing?, method?, slot?, table? }
  RESTAURANT_STATE: 'restaurant:state', // sunucu → herkes: masalar, siparişler, pass, büfe, memnuniyet
  PLAYER_KITCHEN: 'player:kitchen', // sunucu → herkes: { id, hold, act, until } (uzaktan elde tabak / tepsi)
  // Gece döngüsü: evde yatakta uyuma
  SLEEP: 'sleep', // istemci → sunucu (ack): { on: boolean }
  SLEEP_STATE: 'sleep:state', // sunucu → herkes: { ids: [uyuyan oyuncu id], total }
  // Ev bahçesi (saksı + tohum)
  GARDEN: 'garden', // istemci → sunucu (ack): { act: 'plant' | 'harvest', itemId, kind? }
  HOUSE_ITEM: 'house:item', // sunucu → herkes: { itemId, plant } (saksı durumu)
  // Bar müdavimleriyle arkadaşlık
  FRIEND_ACT: 'friend:act', // istemci → sunucu (ack): { act, customer?, topic?, drink? }
  FRIEND_VISITS: 'friend:visits', // sunucu → herkes: evlerdeki misafir müdavimler
  // Şehir içi ulaşım (bisiklet / scooter)
  VEHICLE_ACT: 'vehicle:act', // istemci → sunucu (ack): { act: 'buy' | 'mount' | 'dismount', type?, id? }
  VEHICLES: 'vehicles', // sunucu → herkes: araçlar (konum, sürücü, yolcu)
  VEHICLE_SEAT: 'vehicle:seat', // sunucu → yolcu: { seat: null, x, z } (sürücü inince)
  // Oda tamiratı (mini oyunlar)
  MAINT: 'maint', // istemci → sunucu (ack): { act: 'begin' | 'finish', roomId, issue }
  // Oyuncular arası sohbet
  CHAT_SEND: 'chat:send', // istemci → sunucu (ack): { text }
  CHAT: 'chat', // sunucu → herkes: { id, name, color, text, t }
  // Otelin büyümesi: Resepsiyon PC (kat, temizlikçi), asansör
  HOTEL_ACT: 'hotel:act', // istemci → sunucu (ack): { act: 'buyFloor'|'buyPackage'|'elevator'|'hire'|'fire'|'hireStaff'|'fireStaff', ... }
  HOTEL_STATE: 'hotel:state', // sunucu → herkes: { growth, workers, arch, ... }
  BOOSTS: 'boosts', // sunucu → herkes: geçici bonuslar [{ source, label, icon, untilTotal, barSpawn, barTip, guestSpawn }]
  // ---- Ev dış cephesi: graffiti (sprey), neon tabela, balkon — server/house/ExteriorService.js ----
  EXTERIOR_ACT: 'exterior:act', // istemci → sunucu (ack): { act: 'buyCans' | 'tag' | 'untag' | 'neon' | 'unneon' | 'balcony' | 'item' | 'unitem', ... }
  EXTERIOR_STATE: 'exterior:state', // sunucu → herkes: { houseId, exterior: { sprays, tags, neon, balcony } }
  // ---- Yeraltı Kart Kulübü (blackjack, poker, zar — server/game/CasinoService.js) ----
  CASINO_ACT: 'casino:act', // istemci → sunucu (ack): { act, table, seat?, amount?, source?: 'wallet' | 'kasa' }
  CASINO_STATE: 'casino:state', // sunucu → herkes: tek masanın açık durumu (başkalarının kapalı kartları YOK)
  CASINO_PRIVATE: 'casino:private', // sunucu → yalnızca o oyuncu: { table: 'poker', handNo, cards } kendi kartları
  // ---- Achterstraat Canlı Müzik Sahnesi (server/game/StageService.js, shared/stage.js) ----
  STAGE_ACT: 'stage:act', // istemci → sunucu (ack): { act: 'buy' } (Resepsiyon PC) | { act: 'hire', id: 'guitar' | 'dj' | 'jazz' } (sahnenin önü)
  STAGE_STATE: 'stage:state', // sunucu → herkes: { owned, booking, phase: 'idle'|'set'|'break'|'over', setNo, setAt, to, crowd }
  // ---- Akıllı telefon + InstaHotel reklam kampanyaları (server/game/MarketingService.js, shared/marketing.js) ----
  INSTA_ACT: 'insta:act', // istemci → sunucu (ack): { act: 'post', photo, caption, budget, place? } | { act: 'like' | 'photo', id } | { act: 'feed' }
  INSTA_FEED: 'insta:feed', // sunucu → herkes: { post: { id, by, color, caption, place, budget, likes, t, photo }, followers } yeni gönderi
  INSTA_STATS: 'insta:stats', // sunucu → herkes: { f: takipçi, p: [[postId, likes], ...] } (yalnızca sayaçlar)
  // ---- Ev matbaası + polis baskını, hızlı ışınlanma (server/house/CounterfeitService.js, server/game/TeleportService.js) ----
  COUNTERFEIT_ACT: 'counterfeit:act', // istemci → sunucu (ack): { act: 'buy'|'print'|'stash'|'hide'|'unhide', step? }
  COUNTERFEIT_STATE: 'counterfeit:state', // sunucu → herkes: [{ houseId, seized, printing, raid }]
  COUNTERFEIT_RAID: 'counterfeit:raid', // sunucu → herkes: { houseId, safe, x, z, until } (polis kapıda)
  TELEPORT: 'teleport', // istemci → sunucu (ack): { to: 'hotel'|'home'|'restaurant'|'garage'|'drag' }
  // ---- Yeraltı garajı, AutoGalerie, drag pisti (server/game/GarageService.js, DragRaceService.js, shared/cars.js) ----
  // Arabalar VEHICLES listesinde { type: 'car', model, color } olarak gelir; binme / inme VEHICLE_ACT ile.
  CAR_ACT: 'car:act', // istemci → sunucu (ack): { act: 'buy', model, color, source: 'wallet' | 'kasa' } | { act: 'xfer', id } (rampa / tünel / asansör)
  DRAG_ACT: 'drag:act', // istemci → sunucu (ack): { act: 'stage', lane: 'L' | 'R', mode: 'solo' | 'duel' } | { act: 'unstage' }
  VALET_ACT: 'valet:act', // istemci → sunucu (ack): { act: 'keys', job } | { act: 'tool', tool: 'foam'|'water'|null } | { act: 'spray', job, spot, step: 'begin'|'finish' } | { act: 'hit', kmh }
  VALET_STATE: 'valet:state', // sunucu → herkes: { jobs: [{ id, state, customer, model, carId, holder, spots, stage, damage, deadline… }], stats }
  DRAG_STATE: 'drag:state', // sunucu → herkes: { phase, mode, runNo, treeAt, greenAt, waitUntil, racers, last, board }
});

// ---- Gece döngüsü ---------------------------------------------------------
// 23:00'te otel kapanır ve gece başlar. Oyuncular Achterstraat'taki evlerine gidip
// yatağa yatar (E); çevrimiçi herkes uyuyunca sabah olur. Kimse uyumazsa gece
// NIGHT_LENGTH_SEC gerçek saniyede kendiliğinden biter (biri AFK kalırsa oyun kilitlenmesin).
export const NIGHT = Object.freeze({
  SLEEP_FROM_MIN: 21 * 60, // bu saatten sonra yatağa yatılabilir
  BED_RANGE: 1.6, // yatağın kenarına en fazla uzaklık (m)
  WAKE_MOVE: 0.6, // uyuyan oyuncu bu kadar yürürse uyanır (m)
});

// ---- Coffee shop -------------------------------------------------------
// Ürünler tamamen kurgusaldır; açıklamalar oyun içi mizah amaçlıdır.

export const PRODUCTS = Object.freeze([
  { id: 'amnesia', name: 'Amnesia Haze', price: 12, icon: '🌿', desc: 'Amsterdam klasiği. Nereye koyduğunu unuttuğun anahtarlar gibi.' },
  { id: 'spacecake', name: 'Space Cake', price: 8, icon: '🧁', desc: 'Masum görünen bir kek. Görünüşe aldanma!' },
  { id: 'whitewidow', name: 'White Widow', price: 10, icon: '🍃', desc: 'Adı korkutucu, ünü efsane.' },
  { id: 'northern', name: 'Northern Lights', price: 11, icon: '🌌', desc: 'Kuzey ışıkları kadar renkli bir yolculuk vaat eder.' },
]);
// Prototipsiz nesne: istemciden gelen 'constructor' / '__proto__' gibi anahtarlar undefined döner
export const PRODUCT_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(PRODUCTS.map((p) => [p.id, p]))));

export const START_WALLET = 30; // € — oyuncunun kişisel cüzdanı
// Tarayıcıda saklanan gizli oyuncu anahtarı (ev sahipliği + cüzdan kalıcılığı); sunucu yalnızca özetini (hash) tutar
export const PLAYER_KEY_RE = /^[0-9a-f]{32}$/;
export const TIP_MIN = 4; // € — temizlenen odada bulunan bahşiş
export const TIP_MAX = 12;

export const TRIP = Object.freeze({
  GOOD: 'good',
  BAD: 'bad',
  DURATION_MS: 120_000, // 2 dakika
  GOOD_CHANCE: 0.5, // %50 iyi / %50 kötü
  SLOT_LUCK: 1.25, // iyi trip: slot kazanma ihtimali +%25
  TIP_LUCK: 1.2, // iyi trip: bahşiş +%20
  BAD_SPEED: 0.7, // kötü trip: yürüme hızı -%30
  EMOTE_COOLDOWN_MS: 3000,
});

export const SLOT = Object.freeze({
  BET: 5,
  BASE_WIN: 0.3,
  SYMBOLS: ['🌷', '🚲', '🧀', '🌀', '💰'],
  // Kazanınca hangi kombinasyon: ağırlıklı seçim
  TIERS: [
    { mult: 2, weight: 80, symbols: [0, 1, 2] },
    { mult: 5, weight: 17, symbols: [3] },
    { mult: 20, weight: 3, symbols: [4] },
  ],
});

// ---- Bar De Tulp (alkolsüz) ----------------------------------------------
// Oyuncu barmen olur: temiz bardak al → malzemeleri koy → (gerekiyorsa) çalkala →
// müşteriye servis et. Müşteri içip gidince boş bardağı topla, lavaboda yıka.
// Barda normal yiyecekler de satılır (brownie, stroopwafel); ısırık ısırık yenir.

const byId = (list) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

// 30 alkolsüz içecek, 26 malzeme ve kategoriler: shared/drinks.js (tarif kitabı ve sunucu aynı tabloyu kullanır)
export {
  INGREDIENTS, INGREDIENT_BY_ID, DRINKS, DRINK_BY_ID, DRINK_CATEGORIES, DRINK_CATEGORY_BY_ID, drinkDifficulty, recipeText,
} from './drinks.js';

export const FOOD = Object.freeze([
  { id: 'brownie', name: 'Brownie', icon: '🍫', price: 3, bites: 4 },
  { id: 'stroopwafel', name: 'Stroopwafel', icon: '🧇', price: 2, bites: 3 },
]);
export const FOOD_BY_ID = byId(FOOD);

export const BAR_RULES = Object.freeze({
  GLASSES: 6, // bardaki toplam bardak (raf + elde + tezgâhta)
  MAX_DIRTY_HELD: 3, // aynı anda taşınabilecek kirli bardak
  MAX_POURS: 5, // kokteyller 5 malzemeye kadar (Virgin Mojito: misket + nane + şeker + soda + buz)
  OPEN_MIN: 10 * 60, // 10:00 — gün 23:00'te bittiği için kapanış = gün sonu
  CLOSE_MIN: 23 * 60,
  SPAWN_MIN_MS: 18_000, // yeni müşteri aralığı (gerçek ms)
  SPAWN_MAX_MS: 40_000,
  PATIENCE_MS: 80_000, // oturduktan sonra siparişini bekleme süresi (basit içecek)
  PATIENCE_PER_STEP_MS: 12_000, // 2'den fazla her malzeme / çalkalama için ek sabır
  DRINK_MS: 20_000, // içme süresi; sonra kirli bardak tezgâhta kalır
  // Bahşiş = fiyat × oran (yavaş servis %10 … hızlı servis %35) × bonus (konser / reklam); hepsi otel kasasına
  TIP_RATE_MIN: 0.1,
  TIP_RATE_MAX: 0.35,
  NET_SLACK_MS: 250, // zamanlı adımlarda ağ titremesi toleransı
  SIT_Y: 0.12, // taburede oturan müşterinin yükseltisi (istemci)
  // Zamanlı eylemler (ms) — sunucu doğrular, istemci animasyonu aynı süreyle oynatır
  T: Object.freeze({
    take: 600,
    pour: 1500,
    shake: 2000,
    serve: 700,
    collect: 650,
    wash: 2200,
    buy: 500,
    bite: 2000, // her ısırık 2 sn
  }),
});

export const BAR_CUSTOMER_NAMES = Object.freeze([
  'Sanne', 'Daan', 'Emma', 'Lars', 'Noor', 'Bram', 'Fleur', 'Jesse', 'Lotte', 'Thijs', 'Mila', 'Sem',
]);

export const GUEST_PHASE = Object.freeze({
  ARRIVE: 'arrive',
  CHECKIN: 'checkin',
  TO_SEAT: 'toSeat',
  WAITING: 'waiting',
  TO_ROOM: 'toRoom',
  IN_ROOM: 'inRoom',
  CHECKOUT: 'checkout',
  LEAVE: 'leave',
});

export function formatClock(minuteOfDay) {
  const m = Math.floor(minuteOfDay);
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Türkçe iyelik eki (ünlü uyumu + kaynaştırma): Ayşe → Ayşe'nin, Burak → Burak'ın,
 * Ali → Ali'nin, Noor → Noor'un, Gül → Gül'ün. Yabancı adlarda da yazımdaki son ünlüye bakar.
 */
export function possessive(name) {
  const s = String(name);
  const vowels = s.toLocaleLowerCase('tr-TR').match(/[aeıioöuü]/g);
  const last = vowels ? vowels[vowels.length - 1] : 'e';
  const v = { a: 'ı', ı: 'ı', e: 'i', i: 'i', o: 'u', u: 'u', ö: 'ü', ü: 'ü' }[last];
  const endsWithVowel = /[aeıioöuü]$/i.test(s.toLocaleLowerCase('tr-TR'));
  return `${s}'${endsWithVowel ? 'n' : ''}${v}n`;
}

export function formatMoney(value) {
  return '€ ' + Math.round(value).toLocaleString('tr-TR');
}

// Sunucu ve istemci tarafından ortak kullanılan sabitler.
// Bu dosya hem Node.js (ESM) hem tarayıcı tarafından doğrudan import edilir;
// bu yüzden yalnızca saf JavaScript içerir, hiçbir ortama özgü API kullanmaz.

export const ROOM_IDS = Object.freeze(['101', '102', '103', '104']);

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
});

// ---- Coffee shop -------------------------------------------------------
// Ürünler tamamen kurgusaldır; açıklamalar oyun içi mizah amaçlıdır.

export const PRODUCTS = Object.freeze([
  { id: 'amnesia', name: 'Amnesia Haze', price: 12, icon: '🌿', desc: 'Amsterdam klasiği. Nereye koyduğunu unuttuğun anahtarlar gibi.' },
  { id: 'spacecake', name: 'Space Cake', price: 8, icon: '🧁', desc: 'Masum görünen bir kek. Görünüşe aldanma!' },
  { id: 'whitewidow', name: 'White Widow', price: 10, icon: '🍃', desc: 'Adı korkutucu, ünü efsane.' },
  { id: 'northern', name: 'Northern Lights', price: 11, icon: '🌌', desc: 'Kuzey ışıkları kadar renkli bir yolculuk vaat eder.' },
]);
export const PRODUCT_BY_ID = Object.freeze(Object.fromEntries(PRODUCTS.map((p) => [p.id, p])));

export const START_WALLET = 30; // € — oyuncunun kişisel cüzdanı
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

export function formatMoney(value) {
  return '€ ' + Math.round(value).toLocaleString('tr-TR');
}

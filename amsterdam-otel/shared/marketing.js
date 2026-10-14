// Akıllı telefon + InstaHotel reklam kampanyaları: ortak kurallar (sunucu doğrular, istemci aynı
// sınırları uygular). Saf JavaScript — hem Node.js hem tarayıcı doğrudan import eder.
//
//  - Gönderi: oyuncunun telefon kamerasıyla çektiği JPEG fotoğraf (data URL) + açıklama + reklam bütçesi.
//  - Bütçe OTEL KASASINDAN ödenir; ücretli kampanya 1 OYUN GÜNÜ süren bir "turist akını" başlatır
//    (BoostService: misafir / bar sıklığı, bahşiş) ve misafirler kafileler hâlinde gelir.
//  - Beğeni ve takipçiler gönderiden sonra sunucuda zamanla artar (bütçe + yıldızla ölçeklenir).

import { maskRude } from './chat.js';
import { RECEPTION, ROOM_BY_ID, PLAYER_HOUSES } from './layout.js';

export const INSTA = Object.freeze({
  ACCOUNT: '@hotel.amsterdam',
  CAPTION_MAX: 200,
  // Fotoğraf: yalnızca JPEG data URL. 640×360, kalite ~0.7 → tipik 25–60 KB; üst sınır ~90 KB (base64 dahil)
  PHOTO_MAX_LEN: 90_000,
  PHOTO_MIN_LEN: 200,
  PHOTO_W: 640,
  PHOTO_H: 360,
  JPEG_QUALITY: 0.7,
  GALLERY_MAX: 12, // telefonda (istemci) saklanan fotoğraf
  POST_COOLDOWN_MS: 20_000, // oyuncu başına iki gönderi arası
  FEED_MAX: 20, // bellekte tutulan son gönderi
  PERSIST_POSTS: 6, // kalıcı kayda giren son gönderi (fotoğraflarıyla)
  PERSIST_PHOTO_BYTES: 400_000, // kayda giren fotoğrafların toplam üst sınırı (aşan eskilerin fotoğrafı düşer)
  SNAPSHOT_PHOTOS: 4, // WELCOME'da fotoğrafıyla gelen en yeni gönderi; diğerleri istenince ('photo')
  GROWTH_STEP_MS: 3000, // beğeni / takipçi artışı bu aralıkla (gerçek ms, simülasyon tick'inde)
  CAMPAIGN_MINUTES: 24 * 60, // ücretli kampanyanın turist akını: 1 oyun günü
  LIKE_MILESTONES: Object.freeze([100, 500, 1000, 2500, 5000, 10000]),
  FOLLOWER_MILESTONES: Object.freeze([100, 250, 500, 1000, 2500, 5000, 10000]),
  MAX_LIKERS: 64, // gönderi başına kayıtta tutulan beğenen oyuncu (özet) sayısı
});

/**
 * Reklam bütçeleri (kasa €). Bütçe istemciden SAYI olarak gelir ve bu listedeki bir değere
 * KATI eşit olmalıdır (=== : '150', NaN, { toString } eşleşmez).
 *  likes / followers: gönderinin toplamda kazanacağı aralık (yıldız çarpanından önce)
 *  growMs: artışın süreceği gerçek süre
 *  boost: turist akını çarpanları (BoostService) — organik gönderide yok
 */
export const AD_BUDGETS = Object.freeze([
  Object.freeze({ budget: 0, name: 'Organik', likes: [20, 60], followers: [2, 8], growMs: 45_000, boost: null }),
  Object.freeze({ budget: 50, name: 'Yerel reklam', likes: [150, 300], followers: [20, 45], growMs: 60_000,
    boost: Object.freeze({ guestSpawn: 2, barSpawn: 1.5, barTip: 1 }) }),
  Object.freeze({ budget: 150, name: 'Şehir kampanyası', likes: [500, 900], followers: [60, 120], growMs: 75_000,
    boost: Object.freeze({ guestSpawn: 3, barSpawn: 2.2, barTip: 1.15 }) }),
  Object.freeze({ budget: 300, name: 'Viral kampanya', likes: [1200, 2000], followers: [150, 260], growMs: 90_000,
    boost: Object.freeze({ guestSpawn: 4, barSpawn: 3, barTip: 1.3 }) }),
]);

/** Katı eşleşme: bilinmeyen / yanlış tipte bütçe → undefined */
export function budgetTier(budget) {
  if (typeof budget !== 'number') return undefined;
  return AD_BUDGETS.find((t) => t.budget === budget);
}

/** Yıldız çarpanı: 1★ ×1 … 5★ ×2 (iyi otelin gönderisi daha çok etkileşim alır) */
export const starMultiplier = (stars) => 1 + 0.25 * (Math.min(5, Math.max(1, stars | 0)) - 1);

// Strict JPEG data URL: yalnızca base64 alfabesi, sonda en fazla iki '='
export const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const PHOTO_PREFIX_LEN = 'data:image/jpeg;base64,'.length;

/** Biçim kontrolü (JPEG imzası sunucuda ayrıca çözülerek doğrulanır) */
export function isPhotoDataUrl(s) {
  return typeof s === 'string'
    && s.length >= INSTA.PHOTO_MIN_LEN && s.length <= INSTA.PHOTO_MAX_LEN
    && (s.length - PHOTO_PREFIX_LEN) % 4 === 0
    && PHOTO_RE.test(s);
}

/**
 * Açıklama temizleme (sohbetle aynı kurallar, 200 karakter): kontrol / yön karakterleri ve açılı
 * parantezler atılır, boşluklar sadeleşir, hakaret kelimeleri yıldızlanır.
 * @returns {string|null} string değilse null; boş açıklama '' (yalnızca fotoğraf)
 */
export function cleanCaption(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, INSTA.CAPTION_MAX);
  return text ? maskRude(text) : '';
}

// ---- Fotoğrafın konusu (📍 konum) ----------------------------------------------------
// İstemci fotoğrafı çektiği yeri shared/layout.js areaAt(x, z) ile bulur ve kimliğini gönderir;
// sunucu yalnızca bu listedeki kimlikleri kabul eder ve etiketi kendisi üretir.
const PLACE_LABELS = Object.freeze(Object.assign(Object.create(null), {
  lobby: 'Hotel De Tulp lobisi',
  corridor: 'Otel koridoru',
  bar: 'Bar De Tulp',
  shop: 'De Groene Molen',
  house: 'Bizim Ev',
  alley: 'Achterstraat',
  steeg: 'Steeg',
  street: 'Kanal kıyısı',
  casino: 'Gizli bir kulüp ♣',
  floor2: '2. kat',
  floor3: '3. kat',
  floor4: '4. kat',
}));

/** Bilinen konum kimliği mi (prototip anahtarları / yanlış tip → false) */
export function isPlaceId(id) {
  if (typeof id !== 'string' || id.length > 12) return false;
  return id in PLACE_LABELS || id in ROOM_BY_ID || PLAYER_HOUSES.some((h) => h.id === id);
}

/**
 * Konum etiketi (📍 olmadan). Oyuncu evleri için `ownHouseName` verilirse "X'in evi" yerine onu kullanır.
 * @param id  areaAt() sonucu (geçersiz / null → 'Amsterdam')
 */
export function placeLabel(id, { houseName = null } = {}) {
  if (!isPlaceId(id)) return 'Amsterdam';
  if (id in PLACE_LABELS) return PLACE_LABELS[id];
  if (id in ROOM_BY_ID) return `Oda ${id}`;
  if (houseName) return houseName;
  return PLAYER_HOUSES.find((h) => h.id === id).name;
}

// ---- Turist akını: kafileler ve resepsiyon kuyruğu -------------------------------------
// Ücretli kampanya sürerken misafirler 2–4 kişilik kafileler hâlinde (aralıklı) gelir. Masa doluyken
// gelen misafir resepsiyonun önünden +X yönünde sıraya girer; masa boşalınca sıradaki öne geçer.
export const TOURIST = Object.freeze({
  GROUP_MIN: 2,
  GROUP_MAX: 4,
  STAGGER_MS: 900, // kafiledekilerin kapıdan giriş aralığı (gerçek ms) — birlikte yürürler
  CHECKIN_MS: 4000, // turistin kaydı biraz daha uzun sürer (pasaport, soru-cevap) → sıra görünür olur
  QUEUE_MAX: 6, // sıradaki en fazla misafir (masadaki hariç)
  QUEUE_GAP: 0.8, // m
  PHASE: 'queue', // misafir fazı (GUEST_PHASE'e ek): sıraya yürüyor / sırada bekliyor
});

/** Kuyrukta i. sıranın yeri (0 = masadakinin hemen arkası) */
export function queueSpot(i) {
  return [RECEPTION.front[0] + TOURIST.QUEUE_GAP * (i + 1), RECEPTION.front[1]];
}

/** Sayaç biçimi: 950 → '950', 1234 → '1,2B', 25300 → '25,3B' */
export function formatCount(n) {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0).replace('.', ',').replace(/,0$/, '')}B`;
  return `${(v / 1_000_000).toFixed(1).replace('.', ',').replace(/,0$/, '')}M`;
}

// Otelin büyümesi: yıldız / itibar, ek katlar ve çalışanlar.
// Sunucu (kurallar, doğrulama) ve istemci (Resepsiyon PC paneli, HUD) aynı tabloları kullanır.

// ---- Yıldız / itibar ------------------------------------------------------------
// İtibar puanı temizlenen odalar, ve yerleşen / odasız kalan misafirlerle değişir.
// Yıldız = itibarın geçtiği en yüksek eşik (1★ … 5★).
export const STAR_THRESHOLDS = Object.freeze([0, 40, 120, 250, 450]);
export const MAX_STARS = STAR_THRESHOLDS.length;

export const REPUTATION = Object.freeze({
  ROOM_CLEANED: 2, // oda tamamen temizlendi (oyuncu ya da temizlikçi)
  GUEST_CHECKIN: 1, // misafir odasına yerleşti
  GUEST_LOST: -2, // boş oda bulamayan misafir gitti
  MAX: 2000,
});

/** İtibar → yıldız (1..5) */
export function starsFor(reputation) {
  let s = 1;
  for (let i = 1; i < STAR_THRESHOLDS.length; i++) if (reputation >= STAR_THRESHOLDS[i]) s = i + 1;
  return s;
}

/** Yıldıza göre oda ücreti: her yıldız +€15 */
export function roomPrice(base, stars) {
  return base + 15 * (Math.max(1, stars) - 1);
}

// ---- Ek katlar ----------------------------------------------------------------
// Zemin kat (101–104) hep açık. Resepsiyon PC'den kasa parasıyla üst kat açılır; her kat
// 4 oda ekler ve misafir gelişlerini hızlandırır. Üst katlara lobideki asansörle çıkılır.
export const FLOOR_UPGRADES = Object.freeze([
  { floor: 2, price: 1500, stars: 2 },
  { floor: 3, price: 3500, stars: 3 },
  { floor: 4, price: 7000, stars: 4 },
]);
export const MAX_FLOOR = 1 + FLOOR_UPGRADES.length;

/** Kat sayısına göre misafir geliş aralığının çarpanı (daha çok oda → daha sık misafir) */
export function spawnFactor(floors) {
  return 1 / (1 + 0.6 * (Math.max(1, floors) - 1));
}

// ---- Çalışanlar (temizlikçi) ------------------------------------------------------
export const WORKER_RULES = Object.freeze({
  HIRE_PRICE: 200, // kasadan, tek seferlik
  MAX: 6, // lüks paketlerle 15 / 30 (shared/architecture.js ARCH_MAX_WORKERS)
  TASKS_PER_LEVEL: 12, // her 12 işte bir seviye
  MAX_LEVEL: 5,
  SPEED: 1.6, // yürüme hızı (m/sn)
});

// İlk 8 isim eski kayıtlarla uyumlu; sonrakiler lüks paketlerin 30 kişilik kadrosu için
export const WORKER_NAMES = Object.freeze([
  'Fatma', 'Joost', 'Ayla', 'Pieter', 'Merve', 'Kees', 'Zeynep', 'Wouter',
  'Elif', 'Daan', 'Hatice', 'Sander', 'Derya', 'Ruud', 'Emine', 'Bas', 'Seda', 'Niels', 'Gül', 'Maarten',
  'Hülya', 'Jeroen', 'Burcu', 'Lieke', 'Nesrin', 'Thijmen', 'Cemile', 'Henk', 'Songül', 'Bram',
]);

/**
 * Temizlikçinin bir işi (yatak, çöp, arıza) bitirme süresi (ms):
 * 1★'de 10 sn → 5★'de 2 sn; her seviye ayrıca %6 hızlandırır (en az 1.5 sn).
 */
export function workerTaskMs(stars, level) {
  const s = Math.min(Math.max(stars, 1), MAX_STARS);
  const base = 10 - 2 * (s - 1);
  return Math.round(Math.max(1.5, base * (1 - 0.06 * (Math.max(1, level) - 1))) * 1000);
}

export function workerLevel(tasks) {
  return Math.min(WORKER_RULES.MAX_LEVEL, 1 + Math.floor(tasks / WORKER_RULES.TASKS_PER_LEVEL));
}

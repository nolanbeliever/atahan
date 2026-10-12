// Otelin büyümesi: yıldız / itibar, ek katlar, çalışanlar ve belediye denetimi.
// Sunucu (kurallar, doğrulama) ve istemci (Resepsiyon PC paneli, HUD) aynı tabloları kullanır.

// ---- Yıldız / itibar ------------------------------------------------------------
// İtibar puanı temizlenen odalar, yerleşen misafirler ve denetim sonuçlarıyla değişir.
// Yıldız = itibarın geçtiği en yüksek eşik (1★ … 5★).
export const STAR_THRESHOLDS = Object.freeze([0, 40, 120, 250, 450]);
export const MAX_STARS = STAR_THRESHOLDS.length;

export const REPUTATION = Object.freeze({
  ROOM_CLEANED: 2, // oda tamamen temizlendi (oyuncu ya da temizlikçi)
  GUEST_CHECKIN: 1, // misafir odasına yerleşti
  GUEST_LOST: -2, // boş oda bulamayan misafir gitti
  INSPECTION_PASS: 20,
  MAX: 2000,
});

/** İtibar → yıldız (1..5) */
export function starsFor(reputation) {
  let s = 1;
  for (let i = 1; i < STAR_THRESHOLDS.length; i++) if (reputation >= STAR_THRESHOLDS[i]) s = i + 1;
  return s;
}

/** Bir yıldız kaybettiren itibar: önceki yıldız seviyesinin ortası (1★'de 0) */
export function reputationAfterStarLoss(reputation) {
  const s = starsFor(reputation);
  if (s <= 1) return 0;
  const lo = STAR_THRESHOLDS[s - 2];
  const hi = STAR_THRESHOLDS[s - 1];
  return Math.floor((lo + hi) / 2);
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
  MAX: 6,
  TASKS_PER_LEVEL: 12, // her 12 işte bir seviye
  MAX_LEVEL: 5,
  SPEED: 1.6, // yürüme hızı (m/sn)
});

export const WORKER_NAMES = Object.freeze(['Fatma', 'Joost', 'Ayla', 'Pieter', 'Merve', 'Kees', 'Zeynep', 'Wouter']);

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

// ---- Belediye denetimi --------------------------------------------------------------
export const INSPECTION = Object.freeze({
  MIN_STARS: 2, // 2★'den itibaren müfettiş gelebilir
  COUNTDOWN_MS: 90_000,
  FROM_MIN: 10 * 60, // hafta içi 10:00–17:00 arasında gelir
  TO_MIN: 17 * 60,
  FINE: 300, // başarısız: kasadan
  REWARD: 150, // başarılı: kasaya (+ yıldız başına €25)
  REWARD_PER_STAR: 25,
  CHECK_MS: 1500, // yangın tüpü basınç kontrolü (basılı tut)
  MOP_MS: 2000, // bar zeminindeki dökülen şurubu sil
  RANGE: 1.6,
});

/** Denetim kontrol maddeleri (panel ve sonuç raporu) */
export const INSPECTION_CHECKS = Object.freeze([
  { id: 'rooms', label: 'Odalar temiz', icon: '🛏️' },
  { id: 'extinguishers', label: 'Yangın tüpleri kontrol edildi', icon: '🧯' },
  { id: 'bar', label: 'Bar hijyeni (kirli bardak yok, zemin temiz)', icon: '🍹' },
]);

/** Günün denetim olasılığı: yıldız ve kat arttıkça artar */
export function inspectionChance(stars, floors) {
  if (stars < INSPECTION.MIN_STARS) return 0;
  return Math.min(0.85, 0.3 + 0.12 * (stars - 2) + 0.1 * (floors - 1));
}

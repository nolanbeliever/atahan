// Personel Yönetimi 2.0: bütün çalışanlar için ortak tanımlar (üniforma, moral, prim, performans).
// Temizlikçi (WorkerService), aşçı + garson (KitchenStaffService), barmen (BarStaffService) ve
// bouncer (BouncerService) aynı İK kaydını paylaşır: anahtar `${rol}:${isim}` (isimler rol içinde benzersiz).

const freeze = Object.freeze;

/** Yeni pozisyonlar (temizlikçi / aşçı / garson tanımları kendi dosyalarında) */
export const NEW_STAFF = freeze({
  barman: freeze({
    role: 'barman', title: 'Barmen', icon: '🍹', price: 300, max: 3,
    names: freeze(['Jesse', 'Mila', 'Tarık', 'Sem', 'Defne', 'Luuk']),
  }),
  bouncer: freeze({
    role: 'bouncer', title: 'Bouncer', icon: '🛡️', price: 450, max: 2,
    names: freeze(['Dirk', 'Serkan', 'Bram', 'Gökhan', 'Ruud', 'Yasin']),
  }),
});

/** Paneldeki sıra ve başlıklar */
export const HR_ROLES = freeze([
  freeze({ role: 'worker', title: 'Temizlikçi', icon: '🧹' }),
  freeze({ role: 'chef', title: 'Gurme Aşçı', icon: '👨‍🍳' }),
  freeze({ role: 'waiter', title: 'Garson', icon: '🤵' }),
  freeze({ role: 'barman', title: 'Barmen', icon: '🍹' }),
  freeze({ role: 'bouncer', title: 'Bouncer', icon: '🛡️' }),
]);
export const HR_ROLE_IDS = freeze(HR_ROLES.map((r) => r.role));

/**
 * Üniformalar: c = gövde (ceket / gömlek), a = önlük / aksan (yoksa null). İlki varsayılan
 * (GuestView'daki eski renklerle aynı, kayıtsız personel değişmeden görünür).
 */
export const OUTFITS = freeze({
  worker: freeze([
    freeze({ name: 'Deniz mavisi', c: '#2b6d8a', a: '#f4f1ea' }),
    freeze({ name: 'Lacivert', c: '#1f2f56', a: '#dfe7f2' }),
    freeze({ name: 'Bordo', c: '#7a2232', a: '#f4e6e0' }),
    freeze({ name: 'Lavanta', c: '#7d6aa8', a: '#f1ecfa' }),
    freeze({ name: 'Antrasit', c: '#3b3f46', a: '#ffd23f' }),
  ]),
  chef: freeze([
    freeze({ name: 'Klasik beyaz', c: '#f3f1ea', a: null }),
    freeze({ name: 'Siyah şef', c: '#1d1e22', a: null }),
    freeze({ name: 'Bordo şef', c: '#6e1f2b', a: null }),
    freeze({ name: 'Gece mavisi', c: '#1e2c4a', a: null }),
  ]),
  waiter: freeze([
    freeze({ name: 'Siyah yelek', c: '#23262d', a: '#f4f1ea' }),
    freeze({ name: 'Bordo yelek', c: '#6b1f2a', a: '#f4f1ea' }),
    freeze({ name: 'Krem ceket', c: '#e8dcc2', a: '#2a2a2e' }),
    freeze({ name: 'Lacivert', c: '#1f2f56', a: '#d9b24a' }),
  ]),
  barman: freeze([
    freeze({ name: 'Siyah gömlek', c: '#1b1c20', a: '#c9733d' }),
    freeze({ name: 'Lale kırmızısı', c: '#c2263b', a: '#1b1c20' }),
    freeze({ name: 'Neon pembe', c: '#e23fb4', a: '#14121c' }),
    freeze({ name: 'Turuncu', c: '#e8792b', a: '#f4f1ea' }),
  ]),
  bouncer: freeze([
    freeze({ name: 'Siyah takım', c: '#111214', a: null }),
    freeze({ name: 'Lacivert takım', c: '#17203a', a: null }),
    freeze({ name: 'Bordo takım', c: '#4f1520', a: null }),
    freeze({ name: 'Neon kulüp', c: '#2a0f3d', a: '#ff4fe0' }),
  ]),
});

export const HR_RULES = freeze({
  MORALE_START: 70,
  MORALE_DECAY: 8, // son 2 günde prim almayanın morali her gün bu kadar düşer
  MORALE_MIN: 0,
  MORALE_MAX: 100,
  BONUSES: freeze([freeze({ amount: 25, morale: 8 }), freeze({ amount: 50, morale: 15 }), freeze({ amount: 100, morale: 25 })]),
  BOOST_MUL: 0.9, // prim alan bugün ve yarın %10 daha hızlı çalışır
  MISTAKE_MORALE: 2, // her hata morali biraz düşürür
  /** Günlük iş hedefi (performans puanının iş kısmı) */
  TARGET: freeze({ worker: 8, chef: 6, waiter: 8, barman: 8, bouncer: 12 }),
  BROADCAST_MS: 1500, // İK durumu en fazla bu sıklıkta yayınlanır
});

/** İK kaydı anahtarı */
export const hrKey = (role, name) => `${role}:${name}`;

/**
 * İş süresi çarpanı (küçük = hızlı): moral 50 → 1.0, 100 → 0.88, 0 → 1.12; prim takviyesi ×0.9.
 */
export function moraleSpeedMul(morale, boosted) {
  const m = Math.min(Math.max(morale, 0), 100);
  return (1.12 - 0.24 * (m / 100)) * (boosted ? HR_RULES.BOOST_MUL : 1);
}

/**
 * Günlük performans puanı (0–100): iş (40) + müşteri puanı (35) + hatasızlık (25).
 * Henüz puan yoksa müşteri kısmı nötr (25).
 */
export function performanceScore(role, { tasks = 0, mistakes = 0, ratingSum = 0, ratingN = 0 } = {}) {
  const target = HR_RULES.TARGET[role] ?? 8;
  const work = Math.min(1, tasks / target) * 40;
  const quality = ratingN ? (ratingSum / ratingN / 5) * 35 : 25;
  const clean = Math.max(0, 25 - mistakes * 5);
  return Math.round(work + quality + clean);
}

/** 0–100 → 1–5 yıldız */
export const perfStars = (score) => Math.min(5, Math.max(1, Math.round(score / 20)));

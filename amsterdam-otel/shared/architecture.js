// Otelin mimari lüks paketleri (Resepsiyon PC → 🏗️ Yükseltmeler → "Lüks paketler").
// Sunucu (server/game/ArchitectureService.js: satın alma, lounge geliri, VIP misafirler) ve
// istemci (public/js/game/HotelArchitectureUpgrades.js: panel, cephe, iç mekân, çatı) aynı tabloyu kullanır.
//
//   0. seviye: 1–4. katlar (kat satın alma), en fazla 6 temizlikçi
//   1. "Lüks Otel" (€50.000, 4 kat açık + 4★): 8 katlı lüks bina — 5–8. katlar, lüks iç mekân,
//      2 alkolsüz lounge bar (pasif gelir), personel odası, en fazla 15 temizlikçi
//   2. "Ultra Lüks Gökdelen" (€100.000, 1. paket + 5★): 12 katlı gökdelen — 9–12. katlar,
//      çatı Aqua Park + teras (asansörde "Çatı" durağı), 12. kat VIP suitleri (€300), en fazla 30 temizlikçi

export const ARCH_PACKAGES = Object.freeze([
  Object.freeze({
    id: 'luxury',
    level: 1,
    name: 'Lüks Otel',
    icon: '🏨',
    price: 50_000,
    stars: 4,
    needFloors: 4, // önce dört katın hepsi açılmış olmalı
    floors: 8,
    maxWorkers: 15,
    perks: Object.freeze([
      '8 katlı lüks bina: 5–8. katlar (16 yeni oda)',
      'Tüm odalarda balıksırtı parke, damask duvar kâğıdı, pirinç detaylar, avize ve koltuk',
      '2 alkolsüz lounge bar: Library Lounge (5. kat) ve Sky Lounge (8. kat) — kasaya pasif gelir',
      'Cephede tente ve altın "HOTEL AMSTERDAM ★" yazısı',
      'Personel odası (5. kat): en fazla 15 temizlikçi',
    ]),
  }),
  Object.freeze({
    id: 'skyscraper',
    level: 2,
    name: 'Ultra Lüks Gökdelen',
    icon: '🏙️',
    price: 100_000,
    stars: 5,
    needFloors: 8,
    floors: 12,
    maxWorkers: 30,
    perks: Object.freeze([
      '12 katlı cam gökdelen: 9–12. katlar ve çatı tacı + tabela',
      'Çatı Aqua Park ve teras: havuzlar, kaydıraklar, şezlonglar, taze meyve suyu büfesi (asansörde "Çatı")',
      '12. kat VIP suitleri (1201–1204): yalnızca VIP misafirler, konaklama €300',
      'En fazla 30 temizlikçi',
    ]),
  }),
]);
// Prototipsiz arama tablosu: istemciden gelen '__proto__' / 'constructor' undefined döner
export const ARCH_PACKAGE_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(ARCH_PACKAGES.map((p) => [p.id, p]))));
export const ARCH_MAX_LEVEL = ARCH_PACKAGES.length;

/** Seviyeye göre açık kat sayısı üst sınırı ve temizlikçi sınırı (0: paket yok) */
export const ARCH_FLOORS = Object.freeze([4, 8, 12]);
export const ARCH_MAX_WORKERS = Object.freeze([6, 15, 30]);

// ---- VIP suitleri (Ultra Lüks Gökdelen) -------------------------------------------------
export const VIP = Object.freeze({
  FLOOR: 12, // 1201–1204 yalnızca VIP misafirlere
  PRICE: 300, // € / konaklama (yıldız fiyatı yerine)
  CHANCE: 0.35, // boş VIP suiti varken yeni misafirin VIP olma olasılığı
  REPUTATION: 3, // yerleşen VIP misafir (normal misafir +1)
  ROOF_AT: 0.4, // konaklamanın bu oranı geçince çatıdaki VIP bölümüne çıkar, çıkışı oradan yapar
  PHASE_TO_ROOF: 'vipToRoof',
  PHASE_ON_ROOF: 'vipRoof',
});

/** VIP suiti mi ('1203' → true) */
export const isVipRoom = (id) => typeof id === 'string' && id.length === 4 && id.startsWith(String(VIP.FLOOR));

// ---- Lounge barlar (alkolsüz; pasif gelir) -----------------------------------------------------
// Her açık oyun saatinde (10:00–23:00, her gün) her lounge: BASE × doluluk çarpanı × bar bonusu
// (konser / reklam: sim.boosts.barSpawn). Doluluk çarpanı = 0.5 + 0.5 × (dolu oda / açık oda).
// Gelir birikir ve PAYOUT_HOURS saatte bir (ya da kapanışta) tek bildirimle kasaya geçer.
// Örnek: 2 lounge × €30 × ~0.75 × 13 saat ≈ €585 / gün (modest: VIP suit + oda geliri asıl kaynak).
export const LOUNGE_RULES = Object.freeze({
  OPEN_MIN: 10 * 60,
  CLOSE_MIN: 23 * 60,
  BASE: 30, // € / saat / lounge
  PAYOUT_HOURS: 3,
  MAX_CATCHUP_HOURS: 3, // daha büyük zaman sıçramaları (uyku, kayıttan dönüş) gelir yazmaz
});

/** Doluluk çarpanı 0.5 … 1 */
export function loungeOccupancy(occupied, open) {
  if (!(open > 0)) return 0.5;
  return 0.5 + 0.5 * Math.min(1, Math.max(0, occupied / open));
}

/** Bir oyun saatinde tüm lounge'ların getirisi (yuvarlanmamış) */
export function loungeHourly(lounges, occupancy, barBoost = 1) {
  return lounges * LOUNGE_RULES.BASE * occupancy * Math.max(1, barBoost);
}

/** Denetimde kontrol edilecek tüp sayısı: 2 + kat başına 1, en fazla 6 (12 katta 90 sn'ye sığsın) */
export const INSPECTION_EXT_MAX = 6;

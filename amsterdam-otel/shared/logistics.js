// Lojistik sevkiyatları (tır işleri): yük türleri, ekonomi kuralları, süre / ücret hesapları.
// Sunucu (LogisticsService) ve istemci (LargeWorldMap: PC / telefon "Lojistik" sekmesi) aynı değerleri kullanır.
//
// Ekonomi (açık ve belgeli):
//  - Sözleşme panosunda yük teklifleri: yükleme yeri (depo / liman), yük türü, palet sayısı.
//  - Yüklemede (depodaki körfezde E) toptan fiyat W = palet × birim fiyat OTEL KASASINDAN ödenir.
//  - Otele teslimde (avludaki mal kabul körfezinde E) yükün otele değeri V = W × VALUE_MUL; kasaya
//    V × durum (hasar) × zaman çarpanı yazılır ("tedarik değeri" — NPC tedarikçiye ödenmeyen para).
//    Mükemmel teslimde otel ~%45 kâr eder; ağır hasarda zarar eder. Mal kabul sistemi (sim.cargo.deliver)
//    yükü stoğa kendisi işlerse ({ handled: true } döner) kasaya ayrıca değer yazılmaz.
//  - Şoför ücreti (oyuncunun cüzdanına): ZAMANINDA teslimde €450–650 (rota uzunluğu + palete göre; temel
//    ücret × ONTIME_MUL 1.2), geç kalınca ×0.6, hasarla azalır. Süre: rotanın tır sınırlarıyla sürüş süresi
//    (gidiş-dönüş ~10–15 dk) × TIME_MUL + pay.
//  - Yükten önce iptal ücretsiz; yükten sonra iptal / oyundan çıkış → yük depoya iade, W'nin yarısı geri.
//  - Kiralık şoförlük (HAUL_*): tır gerekmez — nakliye firmasının tırı avludaki tır parkına getirilir; başka
//    firmanın malını bir depodan / limandan diğerine taşırsın. Kasaya dokunulmaz (mal senin / otelin değil);
//    şoför ücreti cüzdana, kendi tırınla yapılan işten DÜŞÜK (zamanında €250–380). Teslimden sonra tır firmaya döner.

const freeze = Object.freeze;
const byId = (list) => freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

/** Yük türleri (hepsi alkolsüz / yasal; site: yüklendiği yer; dock: Mal Kabul (sim.cargo) palet türü) */
export const CARGO_TYPES = freeze([
  freeze({ id: 'food', site: 'food', icon: '🥩', name: 'Restoran malzemesi', desc: 'Et, taze sebze, un, süt ürünleri (soğuk zincir)', unit: 70, min: 8, max: 16, dock: 'food' }),
  freeze({ id: 'drinks', site: 'drinks', icon: '🧃', name: 'Alkolsüz içecek', desc: 'Meyve suyu, maden suyu, soda, şurup kasaları', unit: 45, min: 10, max: 20, dock: 'drinks' }),
  freeze({ id: 'fun', site: 'fun', icon: '🎳', name: 'Eğlence katı malzemesi', desc: 'Bowling labutları, atari jetonları, bilardo çuhası, yedek parça', unit: 90, min: 4, max: 10, dock: 'fun' }),
  freeze({ id: 'import', site: 'port', icon: '⚓', name: 'İthal gurme ürün', desc: 'Wagyu, deniz ürünleri, kahve çekirdeği (konteyner)', unit: 120, min: 6, max: 14, dock: 'food' }),
]);
export const CARGO_BY_ID = byId(CARGO_TYPES);

export const LOGI_RULES = freeze({
  OFFERS: 6, // panodaki teklif sayısı
  OFFER_TTL_MS: 12 * 60_000, // alınmayan teklif bu kadar sonra yenilenir
  REFILL_MS: 20_000, // eksik teklif tamamlama aralığı
  VALUE_MUL: 1.45, // yükün otele değeri / toptan fiyat
  FEE_MIN: 450, // zamanında teslimde şoför ücreti aralığı (€, cüzdana)
  FEE_MAX: 650,
  FEE_KM_FROM: 12, // gidiş-dönüş rota uzunluğu (km) bu aralıkta ücret aralığına yayılır
  FEE_KM_TO: 15.5,
  ONTIME_MUL: 1.2,
  LATE_MUL: 0.6,
  AVG_KMH: 55, // süre hesabı (rota süresi verilmezse): ortalama hız
  TIME_MUL: 1.45, // süre = tır sınırlarıyla rota süresi × bu + pay (trafik, ışıklar, manevra)
  SLACK_SEC: 150, // süreye eklenen pay (yükleme, manevra)
  STOP_KMH: 6, // yükleme / teslim için durmuş sayılma hızı (sunucu ölçümü)
  CANCEL_REFUND: 0.5, // yükten sonra iptalde toptan fiyatın geri dönen kısmı
  HIT_MIN_MS: 700, // iki çarpma bildirimi arası en az süre
  HIT_MAX: 0.3, // tek çarpmada en fazla hasar
  MAX_DAMAGE: 1,
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Hedef (zamanında) ücretten temel ücret: teslimde × ONTIME_MUL ile tam hedefe döner (yuvarlama payı içinde)
 * @param f 0..1 (kısa / az palet → uzun / çok palet)
 */
function feeFor(f, min, max) {
  return Math.round((min + (max - min) * clamp01(f)) / LOGI_RULES.ONTIME_MUL);
}

/**
 * Sözleşme rakamları: palet sayısından toptan fiyat, değer, şoför ücreti (temel; zamanında ×1.2 → €450–650), süre.
 * @param distM avludan siteye rota uzunluğu (m)
 * @param tripSec gidiş-dönüş tır sınırlarıyla sürüş süresi (sn, worldmap.siteTripSec); yoksa ortalama hızdan
 */
export function offerTerms(cargoId, pallets, distM, tripSec = null) {
  const c = CARGO_BY_ID[cargoId];
  const R = LOGI_RULES;
  const wholesale = Math.round(c.unit * pallets);
  const value = Math.round(wholesale * R.VALUE_MUL);
  const km = (2 * distM) / 1000;
  const fd = (km - R.FEE_KM_FROM) / (R.FEE_KM_TO - R.FEE_KM_FROM);
  const fp = (pallets - c.min) / Math.max(1, c.max - c.min);
  const fee = feeFor(0.6 * clamp01(fd) + 0.4 * clamp01(fp), R.FEE_MIN, R.FEE_MAX);
  const drive = tripSec ?? (2 * distM) / (R.AVG_KMH / 3.6);
  const timeSec = Math.round(drive * R.TIME_MUL + R.SLACK_SEC);
  return { wholesale, value, fee, timeSec };
}

/** Teklifin zamanında teslimde ödeyeceği şoför ücreti (panoda gösterilen) */
export const onTimeFee = (fee) => Math.round(fee * LOGI_RULES.ONTIME_MUL);

/** Hasar (0..1) ve zamana göre teslim: kasaya giden değer + şoför ücreti */
export function deliveryPay(job, now) {
  const R = LOGI_RULES;
  const cond = Math.max(0, 1 - job.damage);
  const late = now > job.deadline;
  const tmul = late ? R.LATE_MUL : R.ONTIME_MUL;
  return {
    value: Math.round(job.value * cond * (late ? 0.9 : 1)),
    fee: Math.round(job.fee * cond * tmul),
    late,
    cond,
  };
}

/** Çarpma hızından hasar payı */
export function hitDamage(kmh) {
  return Math.min(LOGI_RULES.HIT_MAX, 0.02 + (kmh / 90) ** 2 * 0.32);
}

// ---- Kiralık şoförlük: başkalarının tırı, başkalarının malı -------------------------------------------

/** Nakliye firmaları (kurgusal) */
export const HAUL_COMPANIES = freeze(['Van Dijk Transport', 'Oranje Logistiek', 'Kaasland Vracht', 'Tulpen Express', 'Noordzee Cargo']);

/** Firmaların taşıttığı (otelle ilgisi olmayan) yükler */
export const HAUL_GOODS = freeze([
  freeze({ id: 'furniture', icon: '🛋️', name: 'Mobilya' }),
  freeze({ id: 'appliances', icon: '📺', name: 'Beyaz eşya & elektronik' }),
  freeze({ id: 'flowers', icon: '💐', name: 'Çiçek & fide' }),
  freeze({ id: 'textile', icon: '👕', name: 'Tekstil' }),
  freeze({ id: 'paper', icon: '📦', name: 'Karton & kâğıt' }),
  freeze({ id: 'tiles', icon: '🧱', name: 'Yapı malzemesi' }),
]);
export const HAUL_GOOD_BY_ID = byId(HAUL_GOODS);

export const HAUL_RULES = freeze({
  OFFERS: 3, // panodaki kiralık şoförlük ilanı
  FEE_MIN: 250, // zamanında teslimde ücret aralığı (€): kendi tırınla yapılan yasal işten (450–650) hep düşük
  FEE_MAX: 380,
  FEE_KM_FROM: 6, // rota (avlu → yükleme → boşaltma) bu aralıkta ücret aralığına yayılır
  FEE_KM_TO: 12,
  TRUCK: 'brabant-titan', // firmanın verdiği tır
  SITES: freeze(['food', 'drinks', 'fun', 'port']), // yükleme / boşaltma yerleri (iki farklı yer)
  MIN_PALLETS: 8,
  MAX_PALLETS: 18,
});

/**
 * Kiralık şoförlük ücreti (temel; zamanında ×1.2 → €250–380) + süre: dist = avlu → yükleme + yükleme → boşaltma (m)
 * @param driveSec aynı rotanın tır sınırlarıyla sürüş süresi (sn); yoksa ortalama hızdan
 */
export function haulTerms(pallets, distM, driveSec = null) {
  const R = LOGI_RULES;
  const H = HAUL_RULES;
  const km = distM / 1000;
  const f = 0.7 * clamp01((km - H.FEE_KM_FROM) / (H.FEE_KM_TO - H.FEE_KM_FROM)) + 0.3 * clamp01((pallets - H.MIN_PALLETS) / (H.MAX_PALLETS - H.MIN_PALLETS));
  const fee = feeFor(f, H.FEE_MIN, H.FEE_MAX);
  const drive = driveSec ?? distM / (R.AVG_KMH / 3.6);
  const timeSec = Math.round(drive * R.TIME_MUL + R.SLACK_SEC);
  return { wholesale: 0, value: 0, fee, timeSec };
}

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
//  - Şoför ücreti (oyuncunun cüzdanına): mesafe ve palete göre; zamanında +%20, geç −%40, hasarla azalır.
//  - Yükten önce iptal ücretsiz; yükten sonra iptal / oyundan çıkış → yük depoya iade, W'nin yarısı geri.

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
  FEE_BASE: 30, // şoför ücreti tabanı (€)
  FEE_PER_KM: 70, // € / km (gidiş-dönüş rota mesafesi, 12 palet başına)
  ONTIME_MUL: 1.2,
  LATE_MUL: 0.6,
  AVG_KMH: 55, // süre hesabı: ortalama hız
  SLACK_SEC: 150, // süreye eklenen pay (yükleme, manevra)
  STOP_KMH: 6, // yükleme / teslim için durmuş sayılma hızı (sunucu ölçümü)
  CANCEL_REFUND: 0.5, // yükten sonra iptalde toptan fiyatın geri dönen kısmı
  HIT_MIN_MS: 700, // iki çarpma bildirimi arası en az süre
  HIT_MAX: 0.3, // tek çarpmada en fazla hasar
  MAX_DAMAGE: 1,
});

/** Sözleşme rakamları: palet sayısından toptan fiyat, değer, şoför ücreti, süre */
export function offerTerms(cargoId, pallets, distM) {
  const c = CARGO_BY_ID[cargoId];
  const R = LOGI_RULES;
  const wholesale = Math.round(c.unit * pallets);
  const value = Math.round(wholesale * R.VALUE_MUL);
  const km = (2 * distM) / 1000;
  const fee = Math.round(R.FEE_BASE + R.FEE_PER_KM * km * (0.5 + pallets / 24));
  const timeSec = Math.round((2 * distM) / (R.AVG_KMH / 3.6) + R.SLACK_SEC);
  return { wholesale, value, fee, timeSec };
}

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

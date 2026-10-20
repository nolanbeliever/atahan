// İllegal sevkiyat + dinamik polis kıskacı: gizli zula bölmesi, kaçak (gümrüksüz) mal teklifleri, "aranma"
// ısısı, sivil / resmi polis araçlarının tırı dört yandan sıkıştırma yuvaları. Sunucu (IllegalLogisticsService)
// ve istemci (IllegalLogistics.js) AYNI değerleri kullanır. Saf JavaScript.
//
// İçerik kuralı: kaçak yük yalnızca kurgusal "gümrüksüz lüks mallar"dır (saat, parfüm, elektronik, tasarım
// çanta). Uyuşturucu, silah, tütün, alkol ya da insan YOKTUR. Polisle şiddet yoktur: yakalanınca mallara el
// konur ve ceza kesilir; polis aracına çarpmak yalnızca ısıyı ve cezayı artırır.
//
// Akış: TruckCenter / Lojistik panosundan tıra gizli bölme takılır (cüzdandan) → bölmeli tırı olan oyuncu
// panoda "🕶️ Limandaki tanıdık" tekliflerini görür → tekliflerden birini alır → limandaki K-17 konteynerinin
// önünde durup E (malların bedeli cüzdandan) → FrisDepot'un batı köşesindeki Eski Kantar Deposu'na götürür,
// polis yakında değilken durup E → kazanç cüzdana. Yük tırdayken "ısı" (0–100, 5 yıldız) yükselir; sivil
// araç önce izler, sonra resmi polis tırı önden / arkadan / iki yandan sıkıştırır.

import { trunkAt, TRUNK_LENGTH } from './worldmap.js';

const freeze = Object.freeze;
const byId = (list) => freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

/** Kaçak mallar (kurgusal, gümrüksüz lüks tüketim) — bedel / kazanç kasa başına */
export const CONTRA_GOODS = freeze([
  freeze({ id: 'watch', icon: '⌚', name: 'Gümrüksüz İsviçre saati', unit: 'kutu', cost: 420, pay: 1150, min: 4, max: 9 }),
  freeze({ id: 'perfume', icon: '🌸', name: 'Gümrüksüz marka parfüm', unit: 'koli', cost: 160, pay: 430, min: 8, max: 18 }),
  freeze({ id: 'electronics', icon: '📱', name: 'Faturasız elektronik', unit: 'koli', cost: 300, pay: 820, min: 5, max: 12 }),
  freeze({ id: 'bags', icon: '👜', name: 'Gümrüksüz tasarım çanta', unit: 'koli', cost: 260, pay: 700, min: 5, max: 12 }),
]);
export const CONTRA_BY_ID = byId(CONTRA_GOODS);

/** Kurallar / ekonomi */
export const ILLEGAL_RULES = freeze({
  COMPARTMENT_PRICE: 12_000, // gizli bölme (tır başına, cüzdandan)
  OFFERS: 3, // oyuncu başına tanıdık teklifi
  OFFER_TTL_MS: 10 * 60_000,
  NIGHT_PAY_MUL: 1.25, // gece (20:00–07:00) kazanç ×1.25, ısı artışı ×0.6
  NIGHT_HEAT_MUL: 0.6,
  TIME_SEC: 420, // teslim süresi (geç kalınırsa kazanç ×0.7)
  LATE_MUL: 0.7,
  STOP_KMH: 6, // yükleme / teslim için durmuş sayılma
  // Isı (0–100) → yıldız = ceil(ısı / 20)
  HEAT_LOAD: 6, // yükleyince
  HEAT_ROAD: 0.22, // otoyolda hareket ederken / sn
  HEAT_HIT: 7, // yükte hasar (çarpma)
  HEAT_SCAN: 26, // tarayıcı kapısı yakalarsa
  SCAN_CHANCE: 0.55, // gece 0.35
  SCAN_CHANCE_NIGHT: 0.35,
  HEAT_RAM: 12, // polis aracına çarpma
  RAM_FINE: 400, // çarpma başına ek ceza
  RAM_COOLDOWN_MS: 2000,
  // Polis
  CIVIL_AT: 20, // ≥1★: sivil (işaretsiz) araç izler
  POLICE_AT: [40, 60, 80], // ≥2★: 1, ≥3★: 3, ≥4★: 4 resmi polis
  POLICE_COUNT: [1, 3, 4],
  SPAWN_BEHIND: 150, // ana gövdede tırın bu kadar gerisinde belirir (önde: ileride)
  CHASE_MAX: 42, // m/sn (~150 km/s) yaklaşma hızı
  LANE_CHANGE: 4, // m/sn: polisin şerit değiştirme (yanal) hızı — yol boyunca şeridi izler
  SLOT_TOL: 2.6, // yuvaya bu kadar yakın polis o tarafı "kapatır"
  BOX_SIDES: 3, // en az bu kadar taraf kapalıysa kıskaç
  CATCH_KMH: 8, // kıskaçtayken bu hızın altında
  CATCH_SEC: 4, // bu kadar kalırsa yakalanır
  PULL_SEC: 6, // ya da tamamen durup (3 km/s) polis 8 m içindeyse
  PULL_DIST: 8,
  ESCAPE_DIST: 150, // hiçbir polis / sivil bu mesafede değilse
  ESCAPE_SEC: 25, // bu kadar kalırsa takip bırakılır (ısı 15'e iner)
  DROP_POLICE_DIST: 60, // teslimde bu mesafede polis olmamalı
  DECAY: 1.5, // takip yokken ısı düşüşü / sn (ısı < 40 iken)
  FINE_BASE: 1500, // yakalanma cezası: taban + kazancın %35'i + çarpma cezaları (cüzdan 0'ın altına inmez)
  FINE_SHARE: 0.35,
  AGENT_RADIUS: 2.4, // istemci çarpışması (polis aracı katı)
  BODY_FRONT: 3.5, // tır gövdesi (çarpma algısı): çekici önü …
  BODY_REAR: -15, // … dorse arkası (m, ileri eksende)
  RAM_LAT: 3.1, // gövde eksenine bu kadar yakın polis aracı = çarpma
});

/** Sıkıştırma yuvaları: çekicinin merkezine göre (ileri: f metre, sağ: r metre). Çekici ±3.15 m, dorse ~−14.5 m'ye uzanır */
export const BOX_SLOTS = freeze([
  freeze({ id: 'front', name: 'ön', f: 11, r: 0 }),
  freeze({ id: 'rear', name: 'arka', f: -18, r: 0 }), // dorsenin arkası ~−14.5 m
  freeze({ id: 'left', name: 'sol', f: -1, r: -4.2 }),
  freeze({ id: 'right', name: 'sağ', f: -1, r: 4.2 }),
]);

/** Yeni polis aracına verilen yuva sırası (önce arka, sonra yanlar, en son ön: önden frenle durdurur) */
export const SLOT_ORDER = freeze(['rear', 'left', 'right', 'front']);

/** Limandaki tanıdık (K-17 konteyneri): tırın merkezi bu dikdörtgende durunca E ile yüklenir */
export const CONTACT = freeze({
  name: 'K-17 konteyneri — limandaki tanıdık',
  zone: freeze({ minX: 7578, maxX: 7598, minZ: 12, maxZ: 30 }),
  npc: freeze({ x: 7601.5, z: 21 }),
  container: freeze({ x: 7604.5, z: 21 }),
  site: 'port',
});

/** Eski Kantar Deposu (FrisDepot avlusunun batı köşesi): kaçak malın teslim yeri */
export const SAFE_DROP = freeze({
  name: 'Eski Kantar Deposu',
  zone: freeze({ minX: 5263, maxX: 5281, minZ: -2094, maxZ: -2070 }),
  shed: freeze({ minX: 5261.5, maxX: 5277, minZ: -2101.6, maxZ: -2096 }),
  site: 'drinks',
});

/** Tarayıcı kapıları (otoyolun üstünde köprü): ana gövdede s (m) */
export const SCANNERS = freeze([
  freeze({ id: 'scan-port', name: 'Liman çıkışı tarayıcısı', s: Math.round(TRUNK_LENGTH - 55) }),
  freeze({ id: 'scan-mid', name: 'A10 orta tarayıcı', s: Math.round(TRUNK_LENGTH * 0.52) }),
]);

const inRect = (b, x, z, tol = 0) => x > b.minX - tol && x < b.maxX + tol && z > b.minZ - tol && z < b.maxZ + tol;
export const inContactZone = (x, z, tol = 0) => inRect(CONTACT.zone, x, z, tol);
export const inDropZone = (x, z, tol = 0) => inRect(SAFE_DROP.zone, x, z, tol);

/** Isıdan yıldız (0–5) */
export const heatStars = (heat) => Math.max(0, Math.min(5, Math.ceil(heat / 20 - 1e-9)));

/** Isıya göre istenen resmi polis sayısı */
export function policeWanted(heat) {
  const R = ILLEGAL_RULES;
  let n = 0;
  R.POLICE_AT.forEach((t, i) => { if (heat >= t) n = R.POLICE_COUNT[i]; });
  return n;
}

/** Teklif rakamları */
export function contraTerms(goodId, qty) {
  const g = CONTRA_BY_ID[goodId];
  return { cost: Math.round(g.cost * qty), pay: Math.round(g.pay * qty) };
}

/** Yakalanma cezası (cüzdan 0'ın altına inmez) */
export function catchFine(job, wallet) {
  const R = ILLEGAL_RULES;
  const due = Math.round(R.FINE_BASE + job.pay * R.FINE_SHARE + (job.rams ?? 0) * R.RAM_FINE);
  return { due, paid: Math.max(0, Math.min(due, Math.floor(wallet))) };
}

/** Gece mi (oyun saati dakikası): 20:00–07:00 */
export const isDark = (minute) => minute >= 20 * 60 || minute < 7 * 60;

/** Tırın ileri / sağ birim vektörleri (yaw 0 → −z'ye bakar) */
export function frame(yaw) {
  return { fx: -Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: -Math.sin(yaw) };
}

/** Yuvanın dünya konumu */
export function slotPoint(slot, x, z, yaw) {
  const { fx, fz, rx, rz } = frame(yaw);
  return { x: x + fx * slot.f + rx * slot.r, z: z + fz * slot.f + rz * slot.r };
}

// Ana gövdede s araması (5 m'lik örnek tablosu)
const S_TABLE = [];
for (let s = 0; s <= TRUNK_LENGTH; s += 5) {
  const p = trunkAt(s);
  S_TABLE.push([s, p.x, p.z]);
}
/** Ana gövdeye en yakın örneğin s'si ve uzaklığı */
export function trunkNear(x, z) {
  let best = S_TABLE[0];
  let bd = Infinity;
  for (const e of S_TABLE) {
    const d = (e[1] - x) ** 2 + (e[2] - z) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return { s: best[0], d: Math.sqrt(bd) };
}

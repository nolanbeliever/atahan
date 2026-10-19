// VIP Vale & Tazyikli Su Oto Yıkama: teslim noktası, yıkama bölmesi, vale park yerleri, VIP araçları,
// kir noktaları, süreler ve ödül kuralları. Sunucu (ValetService) ve istemci (ValetCarWash) AYNI
// değerleri kullanır. Koordinatlar shared/cars.js ile aynı düzlemde (yaw: ileri = (−sin yaw, −cos yaw)).
//
//  Sokak (otelin önü, garaj rampasının doğusu):
//    [🔑 VALE kürsüsü (6.6, −0.75)]  ⭐ VIP müşteri bekler
//    [VIP aracı (5.0, −5.0), batıya — rampaya — bakar]  ⇠ rampa ağzı (x −4)
//  Garaj (−1, rampadan inince kuzey koridor, rampanın batısı):
//    [V-1][V-2][V-3] vale park yerleri (x 72–80.4)   [🫧 OTO YIKAMA bölmesi (x 80.6–87.8)]

import { CAR_BY_ID, CAR_BODIES } from './cars.js';

const freeze = Object.freeze;
const r2 = (v) => Math.round(v * 100) / 100;

export const VALET = freeze({
  // Sokaktaki vale kürsüsü: anahtar burada teslim alınır
  stand: freeze({ x: 6.6, z: -0.75, point: freeze([6.6, -1.55]), range: 2.2 }),
  vipSpot: freeze([7.6, -1.6]), // VIP müşterinin beklediği yer (kürsünün doğusu)
  // VIP aracının bırakıldığı yer (burnu batıya, garaj rampasına dönük)
  dropoff: freeze({ x: 5.0, z: -5.0, yaw: Math.PI / 2 }),
  // Garajdaki yıkama bölmesi (araç gövdesinin merkezi bu kutuda olmalı; yön serbest)
  wash: freeze({ minX: 80.6, maxX: 87.8, minZ: 3.2, maxZ: 9.7, center: freeze([84.2, 6.4]) }),
  // Köpük / tazyikli su tabancası askısı (bölmenin batı bölmesinde)
  rack: freeze({ x: 80.75, z: 8.6, point: freeze([81.4, 8.6]), range: 1.9 }),
  // Vale park yerleri: burunlar kuzeye (duvara)
  bays: freeze([
    freeze({ id: 'V-1', to: "V-1'e", x: 73.4, z: 7.2, yaw: Math.PI }),
    freeze({ id: 'V-2', to: "V-2'ye", x: 76.2, z: 7.2, yaw: Math.PI }),
    freeze({ id: 'V-3', to: "V-3'e", x: 79.0, z: 7.2, yaw: Math.PI }),
  ]),
  bayTol: 1.4, // park yerinin merkezine en fazla uzaklık (araç merkezi)
});

/** Lüks / spor VIP araçları (AutoGalerie kataloğundan) */
export const VALET_MODELS = freeze(['graaf-regent', 'vonk-bliksem', 'storm-390', 'graaf-imperator', 'valk-tempesta']);

export const VALET_CUSTOMERS = freeze([
  'Mr. van der Berg', 'Mevr. de Vries', 'Bay Aksoy', 'Mme. Laurent', 'Sig. Romano', 'Mr. Okafor',
  'Mevr. Jansen', 'Bayan Yıldız', 'Herr Becker', 'Ms. Kensington',
]);

export const VALET_RULES = freeze({
  OPEN_FROM: 8 * 60, // VIP müşteriler 08:00–22:00 arasında gelir
  OPEN_TO: 22 * 60,
  SPAWN_MIN_MS: 60_000, // yeni VIP aralığı (gerçek ms) — yıldız ve VIP suitleri kısaltır
  SPAWN_MAX_MS: 110_000,
  FIRST_MS: 25_000,
  MAX_JOBS: 3, // aynı anda en fazla iş (kürsüde bekleyen en fazla 1)
  KEY_WAIT_MS: 90_000, // anahtar bu sürede alınmazsa müşteri kendisi park eder, gider
  JOB_MS: 300_000, // anahtardan sonra teslim süresi (geçerse bahşiş ×0.3)
  FAST_MS: 120_000, // bu sürede teslim: bahşiş +%25
  SPOTS: 6, // çamur noktası
  SPRAY_MS: freeze({ foam: 900, water: 1300 }), // nokta başına basılı tutma (sunucu en az bu kadar bekler)
  SLACK_MS: 250,
  WASH_RANGE: 3.8, // yıkarken araç merkezine en fazla uzaklık (+1 m tolerans)
  HIT_MIN_KMH: 6, // bunun altındaki sürtünmeler hasar sayılmaz
  HIT_PCT_PER_KMH: 1.2, // (km/s − 6) × 1.2 → hasar % (30 km/s'te tam hızla çarpma ≈ %29)
  HIT_MAX: 30, // tek çarpmada en fazla %
  HIT_GAP_MS: 700, // iki çarpma bildirimi arası en az süre
  CLIP_PCT: 1, // hız denetimine takılan (kırpılan) her hareket: +%1 (en fazla %10), saniyede bir
  CLIP_MAX: 10,
  NO_TIP_DAMAGE: 60, // bu hasarın üstünde bahşiş yok, müşteri şikâyet eder
  REP_PERFECT: 2, // yıkanmış + hasarsız → itibar
  REP_COMPLAINT: -2,
});

/** Vale ücreti (otel kasasına): aracın değerine göre */
export const valetFee = (model) => Math.round(40 + CAR_BY_ID[model].price / 5000);

/** Bahşişin tabanı (yıkanmamış, hasarsız) */
export const valetBaseTip = (model) => Math.round(30 + CAR_BY_ID[model].price / 4000);

/**
 * VIP bahşişi (oyuncunun cüzdanına).
 * @param o { model, washed, damage (0..100), late, fast, stars, vipSuites }
 */
export function valetTip({ model, washed, damage, late, fast, stars = 1, vipSuites = false }) {
  if (damage >= VALET_RULES.NO_TIP_DAMAGE) return 0;
  let tip = valetBaseTip(model);
  if (washed) tip = tip * 2.5 + 50;
  const k = 1 - Math.min(100, Math.max(0, damage)) / 100;
  tip *= k * k;
  if (late) tip *= 0.3;
  else if (fast) tip *= 1.25;
  if (vipSuites) tip *= 1.25;
  tip *= 1 + 0.1 * (Math.min(Math.max(stars, 1), 5) - 1);
  return Math.max(0, Math.round(tip));
}

/** Tek çarpmanın hasarı (%) */
export function hitDamage(kmh) {
  return Math.min(VALET_RULES.HIT_MAX, Math.max(0, kmh - VALET_RULES.HIT_MIN_KMH) * VALET_RULES.HIT_PCT_PER_KMH);
}

/** VIP aralığı çarpanı (küçük = sık): otel yıldızı ve Gökdelen VIP suitleri */
export function valetSpawnFactor(stars, vipSuites) {
  const s = Math.min(Math.max(stars, 1), 5);
  return 1 / (1 + 0.12 * (s - 1) + (vipSuites ? 0.4 : 0));
}

// Çamur noktaları: gövde yerel koordinatı (side: −1 sol / +1 sağ / 0 üst; f: gövde boyunun yarısına oran,
// + ön; h: yükseklik — 'nose' / 'tail' tampon üstü)
const SPOT_TEMPLATES = freeze([
  freeze({ side: -1, f: 0.5, h: 0.5 }),
  freeze({ side: -1, f: -0.45, h: 0.45 }),
  freeze({ side: 1, f: 0.35, h: 0.55 }),
  freeze({ side: 1, f: -0.5, h: 0.42 }),
  freeze({ side: 0, f: 0.78, h: 'nose' }),
  freeze({ side: 0, f: -0.86, h: 'tail' }),
]);

/**
 * Kir noktalarının aracın yerel koordinatları (sağ +x, ön −z, y yukarı) — istemci çamuru çizer ve
 * nişan alınacak dünya noktasını hesaplar.
 */
export function dirtSpotsLocal(model) {
  const b = CAR_BODIES[CAR_BY_ID[model]?.body] ?? CAR_BODIES.sedan;
  return SPOT_TEMPLATES.slice(0, VALET_RULES.SPOTS).map((s) => ({
    x: r2(s.side * (b.W / 2 + 0.01)),
    y: r2(s.h === 'nose' ? b.nose + 0.03 : s.h === 'tail' ? b.tail + 0.03 : s.h),
    z: r2(-s.f * (b.L / 2)),
    side: s.side,
  }));
}

/** Yerel nokta → dünya (x, z) */
export function localToWorld(cx, cz, yaw, lx, lz) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // sağ = (cos, −sin), ileri (−z yerel) = (−sin, −cos)
  return [cx + c * lx + s * lz, cz - s * lx + c * lz];
}

/** Araç merkezi yıkama bölmesinde mi */
export function inWashBay(x, z, tol = 0) {
  const w = VALET.wash;
  return x >= w.minX - tol && x <= w.maxX + tol && z >= w.minZ - tol && z <= w.maxZ + tol;
}

/** Bu noktadaki vale park yeri (yoksa null) */
export function valetBayAt(x, z, tol = VALET.bayTol) {
  for (const b of VALET.bays) if (Math.hypot(x - b.x, z - b.z) <= tol) return b;
  return null;
}

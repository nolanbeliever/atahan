// Arabalar, yeraltı garajı ve drag pisti: katalog (AutoGalerie), fizik, bölgeler, geçitler.
// Sunucu (satın alma, hız denetimi, drag zamanlaması) ve istemci (modeller, sürüş, sahne) AYNI
// değerleri kullanır. Saf JavaScript: hem Node.js hem tarayıcı doğrudan import eder.
//
// Markalar ve modeller tamamen KURGUSALDIR (gerçek ticari marka yok). Fiyatlar Hollanda pazarındaki
// benzer sınıf araçların yaklaşık anahtar teslim fiyatlarıdır (€, BPM/KDV dahil gibi düşünülmüş).
//
// Koordinatlar (2B dünya, +Z kuzey, yaw: ileri = (−sin yaw, −cos yaw)):
//   garaj  x 60..100,  z −30..10   (layout.GARAGE)  — sokaktaki rampadan inilir
//   drag   x 140..190, z −460..40  (layout.DRAG)    — garajdaki "🏁 Drag pisti" şeridinden sürülür
//   otoyol x 240..1260, z −440..330 (worldmap.HWY)  — sokağın doğu ucundaki tünelden; avlu, depolar, liman

import { GARAGE, DRAG, isOutdoors, isInsideSteeg, isInsideAlley, pointInBounds } from './layout.js';
import { BASEMENT } from './basement.js';
import { HWY, SERVICE_YARD, isDrivable, inHighwayRegion, highwayCap, yardAt } from './worldmap.js';

const KMH = 3.6;
const r2 = (v) => Math.round(v * 100) / 100;
const freeze = Object.freeze;
const byId = (list) => freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

// ---- Kasa tipleri (gövde ölçüleri, metre) ------------------------------------------------------
// L: uzunluk · W: genişlik · H: tavan · belt: kapı çizgisi · ws: ön cam tabanı (z, önü +) · rf/rr: tavanın
// ön / arka ucu · deck: arka cam tabanı · wr: tekerlek yarıçapı · wf/wb: ön / arka aks (z) · eye: sürücü göz
// yüksekliği · seat: sürücü koltuğu (x: sol +, z: merkeze göre) · nose/tail: tampon üstü yüksekliği
export const CAR_BODIES = freeze({
  micro: freeze({ L: 3.05, W: 1.5, H: 1.38, belt: 0.84, ws: 0.72, rf: 0.25, rr: -1.0, deck: -1.42, nose: 0.66, tail: 0.74, clear: 0.2, wr: 0.27, wf: 1.0, wb: -1.0, eye: 1.13, seat: freeze({ x: 0.3, z: -0.38 }) }),
  city: freeze({ L: 3.65, W: 1.66, H: 1.5, belt: 0.9, ws: 0.95, rf: 0.18, rr: -1.4, deck: -1.75, nose: 0.72, tail: 0.86, clear: 0.2, wr: 0.3, wf: 1.2, wb: -1.2, eye: 1.17, seat: freeze({ x: 0.33, z: -0.42 }) }),
  hatch: freeze({ L: 4.1, W: 1.78, H: 1.47, belt: 0.9, ws: 1.0, rf: 0.12, rr: -1.55, deck: -1.95, nose: 0.74, tail: 0.88, clear: 0.19, wr: 0.32, wf: 1.32, wb: -1.32, eye: 1.15, seat: freeze({ x: 0.36, z: -0.5 }) }),
  suv: freeze({ L: 4.7, W: 1.92, H: 1.72, belt: 1.08, ws: 1.12, rf: 0.28, rr: -1.95, deck: -2.22, nose: 0.92, tail: 1.02, clear: 0.26, wr: 0.38, wf: 1.45, wb: -1.45, eye: 1.42, seat: freeze({ x: 0.39, z: -0.4 }) }),
  sedan: freeze({ L: 4.92, W: 1.86, H: 1.45, belt: 0.9, ws: 0.95, rf: 0.1, rr: -1.05, deck: -1.72, nose: 0.72, tail: 0.88, clear: 0.17, wr: 0.33, wf: 1.5, wb: -1.45, eye: 1.13, seat: freeze({ x: 0.38, z: -0.55 }) }),
  coupe: freeze({ L: 4.55, W: 1.88, H: 1.3, belt: 0.82, ws: 0.72, rf: -0.18, rr: -0.95, deck: -1.85, nose: 0.66, tail: 0.82, clear: 0.15, wr: 0.34, wf: 1.42, wb: -1.35, eye: 1.03, seat: freeze({ x: 0.39, z: -0.72 }) }),
  gt: freeze({ L: 4.88, W: 1.96, H: 1.32, belt: 0.82, ws: 0.52, rf: -0.38, rr: -1.18, deck: -2.02, nose: 0.68, tail: 0.84, clear: 0.15, wr: 0.35, wf: 1.58, wb: -1.42, eye: 1.04, seat: freeze({ x: 0.4, z: -0.92 }) }),
  super: freeze({ L: 4.62, W: 2.02, H: 1.15, belt: 0.74, ws: 0.95, rf: 0.22, rr: -0.62, deck: -1.95, nose: 0.55, tail: 0.86, clear: 0.12, wr: 0.35, wf: 1.42, wb: -1.36, eye: 0.96, seat: freeze({ x: 0.4, z: -0.32 }), wing: true }),
  // Çekici (tır): kabin önde (motor kabinin altında); dorse beşinci tekerden (fifth) arkaya uzanır
  truck: freeze({ L: 6.3, W: 2.5, H: 3.85, belt: 1.95, ws: 2.95, rf: 2.9, rr: 0.95, deck: 0.9, nose: 1.4, tail: 1.2, clear: 0.42, wr: 0.52, wf: 1.95, wb: -1.85, eye: 2.55, seat: freeze({ x: 0.56, z: 1.75 }), fifth: -1.55, trailer: 13.6 }),
});

// ---- AutoGalerie kataloğu ---------------------------------------------------------------------
// topKmh: en yüksek hız · t100: 0–100 km/s (sn) · hp: güç (beygir) · gears: vites sayısı (1 → EV / varyomatik)
// cyl: motor sesi için silindir sayısı (0 → elektrik) · redline: devir sınırı
const C = (id, name, hex) => freeze({ id, name, hex });
const PALETTE = {
  red: C('red', 'Kırmızı', '#c3202f'), orange: C('orange', 'Turuncu', '#ff7a1a'), yellow: C('yellow', 'Sarı', '#f2c230'),
  green: C('green', 'Kanal yeşili', '#1f5d43'), mint: C('mint', 'Nane', '#8fd3bf'), blue: C('blue', 'Delft mavisi', '#24508f'),
  sky: C('sky', 'Gök mavisi', '#6fa8dc'), white: C('white', 'Beyaz', '#eef0f2'), silver: C('silver', 'Gümüş', '#a9b0b8'),
  grey: C('grey', 'Antrasit', '#3d434b'), black: C('black', 'Siyah', '#121417'), cream: C('cream', 'Krem', '#efe3c4'),
  bronze: C('bronze', 'Bronz', '#8a5a32'), purple: C('purple', 'Mor', '#5b3a8c'), lime: C('lime', 'Limon', '#a6d13b'),
};
const pal = (...ids) => freeze(ids.map((k) => PALETTE[k]));

export const CAR_MODELS = freeze([
  freeze({
    id: 'polder-p6', brand: 'Polder', model: 'P6 “Kikker”', body: 'micro', price: 12_000, topKmh: 120, t100: 19.5, hp: 33, gears: 1, cyl: 2, redline: 5200,
    colors: pal('mint', 'cream', 'orange', 'sky', 'red'),
    desc: 'Klasik Hollanda usulü mikro araba: varyomatik kayış şanzıman, kanal kenarına bile sığar.',
  }),
  freeze({
    id: 'lindeman-stip', brand: 'Lindeman', model: 'Stip 1.0', body: 'city', price: 18_000, topKmh: 160, t100: 12.4, hp: 72, gears: 5, cyl: 3, redline: 6300,
    colors: pal('yellow', 'white', 'red', 'blue', 'lime'),
    desc: 'Şehir arabası: üç silindir, dar sokaklarda park etmesi kolay, az yakar.',
  }),
  freeze({
    id: 'kade-vier', brand: 'Kade', model: 'Vier 1.5', body: 'hatch', price: 28_000, topKmh: 205, t100: 8.9, hp: 150, gears: 6, cyl: 4, redline: 6500,
    colors: pal('blue', 'silver', 'red', 'white', 'grey'),
    desc: 'Kompakt hatchback: ailenin her işini görür, otobanda da rahattır.',
  }),
  freeze({
    id: 'vonk-estad', brand: 'Vonk', model: 'e-Stad', body: 'hatch', price: 36_000, topKmh: 160, t100: 7.3, hp: 204, gears: 1, cyl: 0, redline: 12000,
    colors: pal('mint', 'white', 'grey', 'orange', 'sky'),
    desc: 'Elektrikli hatchback: sessiz, ani tork, 410 km menzil. Garajda şarj olur.',
  }),
  freeze({
    id: 'duin-terra', brand: 'Duinwagen', model: 'Terra 7', body: 'suv', price: 48_000, topKmh: 200, t100: 8.4, hp: 190, gears: 8, cyl: 4, redline: 6200,
    colors: pal('green', 'silver', 'black', 'bronze', 'white'),
    desc: 'Yedi koltuklu aile SUV\'u: yüksek oturuş, geniş bagaj, kumsal yollarına hazır.',
  }),
  freeze({
    id: 'graaf-regent', brand: 'Graaf', model: 'Regent 540', body: 'sedan', price: 62_000, topKmh: 250, t100: 5.6, hp: 333, gears: 8, cyl: 6, redline: 6800,
    colors: pal('black', 'grey', 'silver', 'blue', 'white'),
    desc: 'Yönetici sedanı: sıralı altı silindir, deri koltuklar, sessiz kabin.',
  }),
  freeze({
    id: 'vonk-bliksem', brand: 'Vonk', model: 'Bliksem Performance', body: 'sedan', price: 58_000, topKmh: 225, t100: 4.4, hp: 460, gears: 1, cyl: 0, redline: 16000,
    colors: pal('white', 'black', 'red', 'sky', 'grey'),
    desc: 'Elektrikli performans sedanı: çift motor, dört çeker; yeşil ışıkta herkesi şaşırtır.',
  }),
  freeze({
    id: 'storm-390', brand: 'Stormvogel', model: '390 Coupé', body: 'coupe', price: 95_000, topKmh: 280, t100: 4.1, hp: 390, gears: 7, cyl: 6, redline: 7400,
    colors: pal('orange', 'yellow', 'black', 'silver', 'blue'),
    desc: 'Spor coupé: arkadan itiş, çift turbo; virajları ve drag pistini sever.',
  }),
  freeze({
    id: 'graaf-imperator', brand: 'Graaf', model: 'Imperator GT V12', body: 'gt', price: 185_000, topKmh: 320, t100: 3.6, hp: 630, gears: 8, cyl: 12, redline: 7000,
    colors: pal('green', 'bronze', 'grey', 'black', 'cream'),
    desc: 'Lüks GT: uzun kaput, V12, el dikimi deri — Amsterdam\'dan Monako\'ya tek depoda.',
  }),
  freeze({
    id: 'valk-tempesta', brand: 'Valkenier', model: 'Tempesta', body: 'super', price: 280_000, topKmh: 340, t100: 2.9, hp: 780, gears: 7, cyl: 8, redline: 8500,
    colors: pal('red', 'yellow', 'lime', 'purple', 'white'),
    desc: 'Süper araba: orta motor, karbon gövde, arka kanat. Çeyrek mili 10 saniyenin altında koşar.',
  }),
].map((m) => freeze({ ...m, name: `${m.brand} ${m.model}` })));

// ---- Tırlar (TruckCenter, lojistik avlusu) — AutoGalerie listesinde değil; CAR_BY_ID'de (sürüş, kayıt) ----
// t60: 0–60 km/s (sn, boş) · topKmh: hız sınırlayıcı · gears: vites · cyl: silindir · redline: dizel devir sınırı
export const TRUCK_MODELS = freeze([
  freeze({
    id: 'zeeland-lx', brand: 'Zeeland', model: 'LX 460', body: 'truck', price: 95_000, topKmh: 90, t60: 14, hp: 460, gears: 12, cyl: 6, redline: 2300,
    colors: pal('white', 'blue', 'red', 'silver', 'green'), cap: 26,
    desc: 'Güvenilir uzun yol çekicisi: 12 ileri otomatik şanzıman, geniş yataklı kabin, az yakar.',
  }),
  freeze({
    id: 'brabant-titan', brand: 'Brabant', model: 'Titan XF 530', body: 'truck', price: 128_000, topKmh: 90, t60: 12, hp: 530, gears: 12, cyl: 6, redline: 2300,
    colors: pal('orange', 'black', 'white', 'sky', 'yellow'), cap: 30,
    desc: 'Yüksek tavanlı Space kabin, retarder, şerit asistanı. Ağır yükte bile yokuş sevmez değil.',
  }),
  freeze({
    id: 'noordkaap-v8', brand: 'Noordkaap', model: 'V8 Royal 660', body: 'truck', price: 175_000, topKmh: 90, t60: 10, hp: 660, gears: 14, cyl: 8, redline: 2200,
    colors: pal('black', 'red', 'purple', 'cream', 'blue'), cap: 34,
    desc: 'Krom ızgara, V8 gürlemesi, deri kabin. Limandan otele en ağır konteyneri bile çeker.',
  }),
].map((m) => freeze({ ...m, name: `${m.brand} ${m.model}` })));

export const TRUCK_RULES = freeze({
  MAX_PER_PLAYER: 2, // oyuncu başına en fazla tır (arabalarla birlikte CAR_RULES.MAX_PER_PLAYER içinde)
  LOADED_ACCEL: 0.58, // dorse yüklüyken ivme çarpanı
  BRAKE: 5.2, // boş tır frenleme (m/sn²)
  BRAKE_LOADED: 4.2,
  COAST: 0.35,
  REVERSE: 3.2,
});

export const CAR_BY_ID = byId([...CAR_MODELS, ...TRUCK_MODELS]);
export const isTruck = (model) => (typeof model === 'string' ? CAR_BY_ID[model] : model)?.body === 'truck';

export const CAR_RULES = freeze({
  MAX_PER_PLAYER: 6, // oyuncu başına en fazla araba
  MOUNT_RANGE: 2.7, // arabaya binmek için merkezine en fazla uzaklık (sunucu + 1 m tolerans)
  CITY_KMH: 30, // garajda ve otelin önündeki sokakta hız sınırı
  REVERSE: 4.5, // geri vites en yüksek hız (m/sn)
  BRAKE: 9.5, // fren yavaşlaması (m/sn²)
  COAST: 0.9, // gaz bırakınca yavaşlama (m/sn², hızla artar)
  CHUTE: 35, // drag pisti bitişinden sonra paraşüt + fren (m/sn²) → pist sonundaki kum havuzundan önce durulur
  USD: 1.08, // € → $ yaklaşık kur (yalnızca bilgi)
  SPEED_SLACK: 1.15, // sunucu hız denetimi: sınır × 1.15 + 1.5 m/sn
  SPEED_ADD: 1.5,
  BURST_SEC: 0.8, // ağ gecikmesi için en fazla bu kadar saniyelik yol birikebilir
  XFER_GRACE_MS: 1500, // ışınlanmadan sonra eski konumdan gelen gecikmiş paketler yok sayılır
});

/** Model fiziği: vmax (m/sn), A (ivme katsayısı) — a(v) = A·(1 − (v/vmax)²) ⇒ 0–100 süresi t100 tutar */
const PHYS = new Map();
export function carPhysics(model) {
  let ph = PHYS.get(model.id);
  if (!ph) {
    const vmax = model.topKmh / KMH;
    // Tır: 0–60 km/s süresinden (en yüksek hız 100'ün altında)
    const vRef = (model.t60 ? 60 : 100) / KMH;
    const A = (vmax * Math.atanh(vRef / vmax)) / (model.t60 ?? model.t100);
    ph = freeze({ vmax, A });
    PHYS.set(model.id, ph);
  }
  return ph;
}

/** Hızın (m/sn) fonksiyonu olarak tam gazda ivme */
export function carAccel(model, v) {
  const { vmax, A } = carPhysics(model);
  const k = Math.min(1, Math.abs(v) / vmax);
  return A * (1 - k * k);
}

/** Dönüş hızı (rad/sn): yavaşta dönüş yarıçapı, hızlıda yanal tutunma sınırlar */
export function carTurnRate(v) {
  const s = Math.abs(v);
  return Math.min(s / 5.2, 8.5 / Math.max(s, 1), 1.55);
}

/** Tır dönüşü: uzun dingil mesafesi → geniş dönüş yarıçapı (~9 m), hızda yanal sınır düşük */
export function truckTurnRate(v) {
  const s = Math.abs(v);
  return Math.min(s / 9.5, 3.6 / Math.max(s, 1), 0.62);
}

// ---- Drag pisti ---------------------------------------------------------------------------------
// Çeyrek mil = 402.34 m, −Z yönünde. İki şerit (Sol / Sağ); ağaç (start ışıkları) şeritlerin arasında.
const START_Z = 20;
export const DRAG_TRACK = freeze({
  startZ: START_Z,
  quarter: 402.34,
  eighth: 201.17,
  trap: 20.12, // hız tuzağı: son 20 m (66 ft)
  finishZ: r2(START_Z - 402.34),
  eighthZ: r2(START_Z - 201.17),
  stopZ: -455, // kum havuzunun başı (paraşüt hesabı)
  lanes: freeze({ L: freeze({ id: 'L', name: 'Sol şerit', x: 147.5 }), R: freeze({ id: 'R', name: 'Sağ şerit', x: 152.5 }) }),
  laneHalf: 2.3, // şerit merkezinden en fazla sapma (yarışta)
  strip: freeze({ minX: 143.5, maxX: 156.5 }), // beton bariyerlerin iç yüzü
  wallFromZ: 22, // bariyerler bu z'den güneye
  tree: freeze({ x: 150, z: 14.5 }),
  stage: freeze({ min: 1.1, max: 4.2 }), // araba merkezi çizginin bu kadar gerisinde → sahnede
  prestage: 8, // ön sahne (sarı-beyaz ampuller)
  rollout: 0.05, // sahneden bu kadar ilerleyince "kalktı" sayılır (sahne ışığı söner)
  markers: freeze([100, 200, 300]),
  // Işık ağacı: sahneden 1 sn sonra 3 sarı (0.5 sn arayla), sonra yeşil
  treeDelayMs: 1000,
  amberMs: 500,
  waitMs: 90_000, // düello: rakip bekleme süresi
  runMs: 40_000, // yeşilden sonra en fazla süre (DNF)
  resultMs: 8000, // sonuç ekranda kalma süresi (bilgi)
});
export const DRAG_LANES = freeze(['L', 'R']);

/** Pist şeridinde mi (bariyerlerin arasında, çizginin güneyi dahil) */
export function onDragStrip(x, z) {
  const s = DRAG_TRACK.strip;
  return x > s.minX && x < s.maxX && z < DRAG_TRACK.wallFromZ + 0.5;
}

/** Hangi şeridin sahne kutusunda (yoksa null) */
export function stageLaneAt(x, z, box = DRAG_TRACK.stage) {
  const dz = z - DRAG_TRACK.startZ;
  if (dz < box.min || dz > box.max) return null;
  for (const id of DRAG_LANES) if (Math.abs(x - DRAG_TRACK.lanes[id].x) <= 1.25) return id;
  return null;
}

/**
 * Tam gazda kuramsal en iyi koşu (hile denetimi ve katalog bilgisi): { t100, e8, et, trap }
 * İstemcinin sürüş fiziğiyle aynı ivme eğrisi; reaksiyon süresi dahil değil.
 */
const RUNS = new Map();
export function idealRun(model) {
  let r = RUNS.get(model.id);
  if (r) return r;
  const T = DRAG_TRACK;
  let v = 0; let d = 0; let t = 0; let t100 = null; let e8 = null; let tTrap = null;
  const dt = 1 / 400;
  const vmax = carPhysics(model).vmax;
  while (d < T.quarter && t < 90) {
    v = Math.min(vmax, v + carAccel(model, v) * dt);
    d += v * dt;
    t += dt;
    if (t100 === null && v >= 100 / KMH) t100 = t;
    if (e8 === null && d >= T.eighth) e8 = t;
    if (tTrap === null && d >= T.quarter - T.trap) tTrap = t;
  }
  r = freeze({ t100: r2(t100 ?? t), e8: r2(e8), et: Math.round(t * 1000) / 1000, trap: Math.round((T.trap / (t - tTrap)) * KMH) });
  RUNS.set(model.id, r);
  return r;
}

// ---- Garaj yerleşimi ---------------------------------------------------------------------------
//   z=10 ┌─[🛗]──[AutoGalerie]───────────[çıkış ⇡ | giriş ⇣]┐  ← sokağa rampa (kuzey duvarı)
//        │  asansör    P · HOTEL AMSTERDAM GARAGE     (rampa)│
//   z=0  │                    ana koridor                    │
//   z=-8 │ [C sırası 12 park yeri, burunlar kuzeye]          │
//  z=-13 │ ───── sütunlar ──────                             │
//        │ [B sırası 12 park yeri, burunlar güneye]          │
//  z=-18 │                    alt koridor        🏁 Drag ⇢  │  ← doğu duvarında drag pisti şeridi
//  z=-25 │ [A sırası 10 park yeri, burunlar kuzeye] [−2 ⇣ kapalı]
//  z=-30 └───────────────────────────────────────────────────┘
//        x=60                                               x=100
const BAY_W = 2.6;
const BAY_X0 = 64;
function makeBays() {
  const out = [];
  const row = (n, z, yaw, rowId) => {
    for (let i = 0; i < n; i++) out.push({ x: r2(BAY_X0 + BAY_W * (i + 0.5)), z, yaw, row: rowId });
  };
  row(10, -27.2, Math.PI, 'A'); // güney duvarı, burun kuzeye (koridora)
  row(12, -15.8, 0, 'B'); // çift sıranın güneyi, burun güneye
  row(12, -10.6, Math.PI, 'C'); // çift sıranın kuzeyi, burun kuzeye
  return freeze(out.map((b, i) => freeze({ ...b, no: i + 1, label: `P-${String(i + 1).padStart(2, '0')}` })));
}

export const GARAGE_LAYOUT = freeze({
  bounds: GARAGE.bounds,
  ceiling: 3.0,
  bayW: BAY_W,
  bayDepth: 5.2,
  bays: makeBays(),
  rows: freeze({ A: freeze({ minZ: -29.8, maxZ: -24.6, x0: BAY_X0, n: 10 }), B: freeze({ minZ: -18.4, maxZ: -13.2, x0: BAY_X0, n: 12 }), C: freeze({ minZ: -13.2, maxZ: -8.0, x0: BAY_X0, n: 12 }) }),
  pillars: freeze([...[64, 74.4, 84.8, 95.2].map((x) => freeze([x, -13.2])), freeze([77, 0.6]), freeze([85, 0.6]), freeze([69.2, -24.6]), freeze([79.6, -24.6])]),
  elevator: freeze({ x: 64, z: 10, point: freeze([64, 9.1]), range: 1.9 }),
  kiosk: freeze({ x: 70.5, z: 9.55, point: freeze([70.5, 8.7]), range: 2.0 }),
  ramp: freeze({ outX: freeze([88.5, 93.5]), inX: freeze([94.5, 99.5]), divider: freeze([93.5, 94.5]), slopeZ: 7.4, gateZ: 5.0 }),
  down2: freeze({ minX: 90, maxX: 99.8, minZ: -29.8, maxZ: -24.6 }), // −2'ye inen (kapalı, dekor) rampa
  dragLane: freeze({ minZ: -24.4, maxZ: -18.6 }), // doğu duvarındaki tünel ağzı
});

/** Sokaktaki garaj rampası ağzı (otelin önü, batı tarafı; ağız doğuya açılır) */
export const STREET_RAMP = freeze({
  minX: -8.2, maxX: -4.0, minZ: -5.6, maxZ: -2.8,
  gateX: -4.25,
  sign: freeze([-3.85, -5.85]), // "P ↓" tabela direği
});

/**
 * Işınlanan geçitler. zone: tetik alanı (oyuncu merkezi) · to: varış noktası · area: varış bölgesi.
 * foot: yalnızca yürüyerek (asansör) · walk: yürürken de kendiliğinden tetiklenir (rampa / tünel).
 */
export const CAR_XFERS = freeze([
  freeze({ id: 'streetIn', icon: '🅿️', label: 'Garaja in', zone: freeze({ minX: -7.9, maxX: -5.0, minZ: -5.4, maxZ: -3.0 }), to: freeze({ x: 97, z: 2.8, yaw: 0 }), area: 'garage', walk: true }),
  freeze({ id: 'garageOut', icon: '⇡', label: 'Sokağa çık', zone: freeze({ minX: 88.6, maxX: 99.4, minZ: 6.2, maxZ: 9.9 }), to: freeze({ x: -2.5, z: -4.2, yaw: -Math.PI / 2 }), area: 'street', walk: true }),
  freeze({ id: 'toDrag', icon: '🏁', label: 'Drag pistine sür', zone: freeze({ minX: 96.6, maxX: 99.9, minZ: -24.4, maxZ: -18.6 }), to: freeze({ x: 165, z: 32, yaw: Math.PI / 2 }), area: 'drag', walk: true }),
  freeze({ id: 'toGarage', icon: '🅿️', label: 'Garaja dön', zone: freeze({ minX: 186.6, maxX: 189.9, minZ: 25, maxZ: 37 }), to: freeze({ x: 92.5, z: -21.5, yaw: Math.PI / 2 }), area: 'garage', walk: true }),
  freeze({ id: 'lobby', icon: '🛗', label: 'Asansörle lobiye çık', zone: freeze({ minX: 62.1, maxX: 65.9, minZ: 7.6, maxZ: 9.95 }), to: freeze({ x: 0, z: 3.0, yaw: Math.PI }), area: 'city', foot: true }),
  // Otoyol tüneli: sokağın doğu ucu ⇄ lojistik avlusunun batı duvarı (tır şehre giremez: GarageService)
  freeze({ id: 'toHighway', icon: '🛣️', label: 'A10 Ring — lojistik avlusuna', zone: freeze({ minX: 16.6, maxX: 17.95, minZ: -6.9, maxZ: -3.2 }), to: SERVICE_YARD.arrive, area: 'highway', walk: true }),
  freeze({ id: 'toCity', icon: '🏙️', label: 'Şehre dön — otelin önü', zone: SERVICE_YARD.portal, to: freeze({ x: 14.6, z: -5.0, yaw: Math.PI / 2 }), area: 'street', walk: true }),
]);
export const CAR_XFER_BY_ID = byId(CAR_XFERS);

/** Tetik alanının içinde mi (tol: sunucu gecikme toleransı) */
export function inXferZone(t, x, z, tol = 0) {
  return pointInBounds(x, z, t.zone, tol);
}

/** Otelin önündeki sokak (araba için; steeg ve Achterstraat hariç) */
export function isCarStreet(x, z) {
  return isOutdoors(x, z) && !isInsideSteeg(x, z) && !isInsideAlley(x, z) && z < -0.1;
}

/** Arabanın bulunabileceği bölge: 'garage' | 'street' | 'drag' | 'highway' | null */
export function carZone(x, z) {
  if (pointInBounds(x, z, GARAGE.bounds)) return 'garage';
  if (pointInBounds(x, z, DRAG.bounds)) return 'drag';
  if (inHighwayRegion(x, z) && isDrivable(x, z, 1.2)) return 'highway'; // otoyol, avlu, depolar, liman
  if (isCarStreet(x, z)) return 'street';
  return null;
}

/** Oyuncunun bulunduğu geniş alan (istemcide görünürlük, sunucuda drag ayrılışı) */
export function bigArea(x, z) {
  if (pointInBounds(x, z, GARAGE.bounds, 2)) return 'garage';
  if (pointInBounds(x, z, DRAG.bounds, 2)) return 'drag';
  if (pointInBounds(x, z, BASEMENT.bounds, 2)) return 'basement'; // −1. Kat Eğlence Katı
  if (inHighwayRegion(x, z, 2)) return 'highway'; // şehir dışı: otoyol, depolar, liman (LargeWorldMap)
  return 'city';
}

/**
 * Konumdaki hız sınırı (m/sn). Garaj ve sokak: 30 km/s. Drag alanı: modelin en yüksek hızı;
 * pist bitişinden sonra paraşüt (kum havuzundan önce durabilecek hız).
 */
export function carSpeedCap(model, x, z) {
  const vmax = carPhysics(model).vmax;
  if (inHighwayRegion(x, z, 2)) return highwayCap(vmax, x, z); // otoyol 100, bağlantı yolu 60, avlu 30 km/s
  if (carZone(x, z) !== 'drag') return CAR_RULES.CITY_KMH / KMH;
  const T = DRAG_TRACK;
  if (z < T.finishZ && x > T.strip.minX && x < T.strip.maxX) {
    return Math.min(vmax, Math.sqrt(2 * CAR_RULES.CHUTE * Math.max(0, z - T.stopZ)) + 2);
  }
  return vmax;
}

/** Tırın park edebileceği yer: avlu / depo / liman (otoyolun ortası değil) */
export function canParkTruck(x, z) {
  return yardAt(x, z) !== null;
}

/** Ön yolcu koltuğu (sağ): sürücünün konumu = arabanın merkezi */
export function carPassengerSeat(x, z, yaw, body) {
  const b = CAR_BODIES[body] ?? CAR_BODIES.sedan;
  const s = b.seat;
  // sağ = (cos, −sin), ileri = (−sin, −cos)
  return { x: x + Math.cos(yaw) * s.x - Math.sin(yaw) * s.z, z: z - Math.sin(yaw) * s.x - Math.cos(yaw) * s.z };
}

/** Arabadan inen sürücünün yeri: sol kapının yanı (yoksa sağ, yoksa merkez) */
export function carExitSpots(x, z, yaw, body) {
  const b = CAR_BODIES[body] ?? CAR_BODIES.sedan;
  const off = b.W / 2 + 0.55;
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return [
    { x: r2(x - rx * off), z: r2(z - rz * off) }, // sol (sürücü kapısı)
    { x: r2(x + rx * off), z: r2(z + rz * off) },
  ];
}

/** Para birimi: €18.000 (Hollanda biçimi) ve yaklaşık $ */
export function formatEuro(v) {
  return `€${Math.round(v).toLocaleString('nl-NL')}`;
}
export function formatUsd(v) {
  return `≈ $${(Math.round((v * CAR_RULES.USD) / 100) * 100).toLocaleString('en-US')}`;
}

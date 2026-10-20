// Mal Kabul Rampası & Transpalet: otelin arka avlusundaki yükleme rampası, toptancı tırları, paletler,
// yük asansörü ve depo stokları. Sunucu (CargoDockService) ve istemci (CargoDockManagement) bu tek kaynağı kullanır.
//
// Fizik / çarpışma 2B olduğu için avlu dünyanın ayrı bir köşesindedir (x 104..136, z 14..54; garajın doğusu,
// drag pistinin batısı). Achterstraat'ın batı ucundaki demir servis kapısı (E) ve hızlı ışınlanma (🚚) buraya getirir.
//
//   z=54 ┌──[transpalet park]────────[🛗 YÜK ASANSÖRÜ]──[kolon]──────[ofis]─┐
//        │                                                                  │  ← mal kabul salonu (zemin y = 0)
//   z=47 [kapı → Achterstraat]                                              │
//        │                                                                  │
//   z=40 └──────────[ RAMPA 1 ]──────────────[ RAMPA 2 ]────────────────────┘  ← rampa kenarı (avlu y = −1.25)
//                  ║ dorse ║               ║ dorse ║
//                  ║ 13.6m ║               ║       ║                ← tır dorseye geri geri yanaşır
//   z=26           ╚═[çekici]              ╚═[çekici]
//   z=14  ─────────────────────────────── avlu ────────────────────── [giriş kapısı x = 136] → yol
//       x=104             x=114                    x=126                       x=136

const freeze = Object.freeze;
const r2 = (v) => Math.round(v * 100) / 100;

const AREA = freeze({ minX: 104, maxX: 136, minZ: 14, maxZ: 54 });
const HALL = freeze({ minX: 104, maxX: 136, minZ: 40, maxZ: 54 });
const DOCK_Z = HALL.minZ; // rampa kenarı (salonun güney duvarı)
const BAY_X = [114, 126];

/** Dorse ölçüleri (iç taban rampa ile aynı yükseklikte: y = 0) */
export const TRAILER = freeze({
  length: 13.6,
  halfW: 1.3, // dış yarı genişlik
  innerHalfW: 1.2, // iç yarı genişlik (yürünebilir)
  rearZ: DOCK_Z + 0.05, // rampaya dayanan arka kapı
  frontZ: r2(DOCK_Z + 0.05 - 13.6),
  height: 2.7,
  cols: freeze([-0.6, 0.6]), // palet sütunları (dorse ekseninden x)
  rows: 8, // 2 × 8 = 16 palet
  rowPitch: 1.3,
});

/** Dorsedeki palet yeri: arkadan (rampa tarafından) öne doğru; slot = satır × 2 + sütun */
function trailerSlot(x, k) {
  const row = Math.floor(k / 2);
  const col = k % 2;
  return freeze([r2(x + TRAILER.cols[col]), r2(DOCK_Z - 0.75 - row * TRAILER.rowPitch)]);
}

const BAYS = freeze(BAY_X.map((x, i) => freeze({
  id: i,
  name: `Rampa ${i + 1}`,
  x,
  door: freeze({ from: x - 1.5, to: x + 1.5, top: 3.2 }), // salonun güney duvarındaki kapı açıklığı
  // Yanaşmış tırın dorse merkezi + yönü (yaw 0: çekici güneye / −z'ye bakar, dorse arkası rampada)
  truck: freeze({ x, z: r2(DOCK_Z + 0.05 - 13.6 / 2), yaw: 0 }),
  // Dorse içi (yürünebilir kutu)
  inside: freeze({ minX: x - TRAILER.innerHalfW, maxX: x + TRAILER.innerHalfW, minZ: r2(DOCK_Z + 0.05 - 13.6), maxZ: DOCK_Z }),
  slots: freeze(Array.from({ length: TRAILER.cols.length * TRAILER.rows }, (_, k) => trailerSlot(x, k))),
})));

const CABIN = freeze({ minX: 118.6, maxX: 121.4, minZ: 51.2, maxZ: 53.8 });

export const CARGO_DOCK = freeze({
  bounds: AREA,
  hall: HALL,
  dockZ: DOCK_Z,
  yardY: -1.25, // avlu zemini (rampa yüksekliği kadar aşağıda)
  hallH: 4.2,
  bays: BAYS,
  /**
   * Teslimat yapan tırın park ettiği yer (Rampa 1): dorse merkezi (x, z) ve yönü. yaw 0 → tırın önü (çekici)
   * −z'ye bakar; dorsenin arka kapısı z = rearZ'de rampaya dayanır. Tır sistemi `sim.cargo.deliver(...)`
   * çağırdığında yük bu rampadaki dorseye palet olarak yerleşir (Rampa 1 doluysa Rampa 2, o da doluysa sıra).
   */
  truckBay: freeze({ x: BAYS[0].truck.x, z: BAYS[0].truck.z, yaw: 0, rearZ: TRAILER.rearZ, bay: 0 }),
  // Avlunun giriş kapısı (doğu duvarı) ve tırların geldiği / gittiği yol
  yardGate: freeze({ x: AREA.maxX, from: 16.5, to: 25.5 }),
  road: freeze({ z: 21, farX: 152 }),
  // Yük asansörü: kabin (içine 2 palet), kapı güneye (salona) açılır
  elevator: freeze({
    cabin: CABIN,
    door: freeze({ from: 118.75, to: 121.25, z: CABIN.minZ }),
    slots: freeze([freeze([119.4, 52.55]), freeze([120.6, 52.55])]),
    panel: freeze({ x: 122.6, z: 50.6, point: freeze([122.6, 50.0]), range: 2.4 }), // çağrı kolonu
  }),
  // Transpaletlerin şarj / park yeri (güneye, rampalara bakar)
  jacks: freeze([freeze({ x: 107.2, z: 51.6, yaw: 0 }), freeze({ x: 109.0, z: 51.6, yaw: 0 })]),
  office: freeze({ point: freeze([132.4, 52.0]), desk: freeze({ minX: 131.4, maxX: 133.4, minZ: 52.9, maxZ: 53.8 }), range: 1.8 }),
  // Salonun batı duvarındaki kapı ↔ Achterstraat'ın batı ucundaki demir servis kapısı
  door: freeze({ x: HALL.minX, z: 47, point: freeze([104.75, 47]), spawn: freeze([105.4, 47]), yaw: -Math.PI / 2 }),
  cityGate: freeze({ x: -17.9, z: 29.5, point: freeze([-17.15, 29.5]), spawn: freeze([-16.75, 29.5]), yaw: -Math.PI / 2 }),
  spawn: freeze([106.2, 47]), // hızlı ışınlanma hedefi
  range: 1.9, // kapı etkileşim menzili
});

/** Palet türleri (alkolsüz içecekler!). price: palet başı toptan fiyat (kasadan) */
export const CARGO_TYPES = freeze({
  food: freeze({ name: 'Restoran malzemesi', short: 'Mutfak', icon: '🥩', price: 90, color: '#c0392b', effect: 'Açık büfe tazeleme yarı fiyatına (€24 → €12)' }),
  drinks: freeze({ name: 'Bar içecekleri (alkolsüz)', short: 'Bar', icon: '🥤', price: 70, color: '#2e86de', effect: 'Her bar içeceğinde +€1 kâr' }),
  fun: freeze({ name: 'Eğlence katı malzemesi', short: 'Eğlence', icon: '🎳', price: 80, color: '#8e44ad', effect: 'Eğlence Katı misafirleri +€2 öder' }),
  clean: freeze({ name: 'Temizlik & oda malzemesi', short: 'Temizlik', icon: '🧴', price: 50, color: '#16a085', effect: 'Temizlikçiler %30 daha hızlı' }),
});
export const CARGO_TYPE_IDS = freeze(Object.keys(CARGO_TYPES));

/** Stok etkileri (her kullanım 1 birim stok harcar; bir palet 10 birim) */
export const CARGO_EFFECTS = freeze({
  food: freeze({ costMul: 0.5 }), // açık büfe tazeleme maliyeti
  drinks: freeze({ bonus: 1 }), // € / bar içeceği
  fun: freeze({ bonus: 2 }), // € / Eğlence Katı NPC ücreti
  clean: freeze({ timeMul: 0.7 }), // temizlikçi iş süresi
});

export const CARGO_RULES = freeze({
  UNITS_PER_PALLET: 10, // hasarsız palet stok birimi (hasarlı palet: × durum)
  STOCK_MAX: 80,
  DELIVERY_FEE: 40, // € / sipariş (nakliye)
  MAX_PER_TYPE: 4, // bir siparişte tür başına en fazla palet
  MAX_ORDERS: 3, // aynı anda yolda olan sipariş
  MAX_DELIVERY: 32, // deliver() tek seferde en fazla palet (2 tır)
  ETA_MIN_MS: 20_000, // sipariş → tırın avluya girişi (gerçek süre)
  ETA_MAX_MS: 40_000,
  ARRIVE_MS: 9_000, // avlu kapısından rampaya yanaşma animasyonu
  LEAVE_MS: 7_000,
  ELEV_MS: 7_000, // yük asansörünün depoya gidip gelmesi
  CABIN_CAP: 2,
  WAIT_MS: 6 * 60_000, // dorse bu kadar dolu bekletilirse şoför bekleme ücreti ister
  FEE_EVERY_MS: 3 * 60_000,
  WAIT_FEE: 25, // € / bekleme ücreti (kasadan)
  MAX_FEES: 2, // sonra kalan paletleri rampaya indirip gider
  AUTO_BELOW: 15, // otomatik sipariş: stok bu birimin altına inince 2 palet
  AUTO_PALLETS: 2,
  OFFER_CHANCE: 0.35, // her sabah toptancı fırsatı (bir türde indirim)
  OFFER_MUL: 0.7,
  DECAY: freeze({ food: 0.2, drinks: 0.1, fun: 0.05, clean: 0.05 }), // gün başı bozulma / tüketim oranı
  // Transpalet
  FORK_C: 1.0, // pivot (operatör) → çatal ortası (palet merkezi) mesafesi
  LIFT_TOL: 0.6, // sunucu toleransı (gecikme payı): çatal ortası ↔ palet merkezi
  LIFT_ANGLE: 0.5, // rad (palet 4 yönlü: π/2'nin katlarına göre)
  CABIN_TOL: 1.0,
  REACH: 2.6, // transpalete / kolona en fazla uzaklık (+1 m gecikme toleransı sunucuda)
  BUMP_MIN: 1.1, // m/sn: bu hızın altındaki sürtünme hasar vermez
  BUMP_COOLDOWN_MS: 700,
  MIN_COND: 0.2,
});

/** Transpalet sürüşü (istemci): yavaş, yerinde dönebilen */
export const JACK = freeze({
  SPEED: 1.8, // m/sn ileri
  REVERSE: 1.2,
  ACCEL: 2.4,
  TURN: 1.9, // rad/sn (yerinde de döner)
  RADIUS: 0.38, // operatör + gövde
  EYE: 1.72, // operatör paletin üstünden görür
  LOAD_R: 0.46, // taşınan paletin çarpışma yarıçapı (çatal ortasında)
});

/** Palet ayak izi (m): 1.2 × 0.8 Euro palet; uzun kenar paletin yönünde (yaw 0 → z ekseni) */
export const PALLET = freeze({ L: 1.2, W: 0.8, H: 0.144, LOAD_H: 0.72 });

export function isInsideCargoArea(x, z, pad = 0) {
  return x > AREA.minX - pad && x < AREA.maxX + pad && z > AREA.minZ - pad && z < AREA.maxZ + pad;
}

/** Mal kabul salonunun içi (rampa zemini) */
export function isInsideHall(x, z, pad = 0.05) {
  return x > HALL.minX + pad && x < HALL.maxX - pad && z > HALL.minZ + pad && z < HALL.maxZ - pad;
}

/** Kabinin içi */
export function isInsideCabin(x, z) {
  return x > CABIN.minX && x < CABIN.maxX && z > CABIN.minZ - 0.2 && z < CABIN.maxZ;
}

/** Yanaşmış dorsenin içi (rampa no; yoksa −1) */
export function trailerAt(x, z) {
  for (const b of BAYS) {
    const s = b.inside;
    if (x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ + 0.3) return b.id;
  }
  return -1;
}

/** Operatörün (pivot) önündeki çatal ortası */
export function forkCenter(x, z, yaw, d = CARGO_RULES.FORK_C) {
  return [x - Math.sin(yaw) * d, z - Math.cos(yaw) * d];
}

/** İki yön arasındaki fark (π/2'nin katlarına göre; 4 yönlü palet) */
export function palletAngleDiff(a, b) {
  const q = Math.PI / 2;
  const d = ((((a - b) % q) + q) % q);
  return Math.min(d, q - d);
}

/** Paletin taşıyıcıya göre bağıl yönü (π/2'ye yuvarlı) */
export function snapRel(palletYaw, jackYaw) {
  const q = Math.PI / 2;
  return Math.round((palletYaw - jackYaw) / q) * q;
}

/** Palet stok değeri (birim): hasar oranında düşer */
export function palletUnits(cond) {
  return Math.max(1, Math.round(CARGO_RULES.UNITS_PER_PALLET * Math.min(1, Math.max(0, cond))));
}

/**
 * Tırın dorse merkezi + yönü (animasyon): faz 'arriving' (0→1), 'docked', 'leaving' (0→1).
 * Avlu kapısından batıya gelir, rampaya geri geri yanaşır; çıkışta öne çekip doğuya döner.
 */
export function truckPose(bayId, phase, t, out = { x: 0, z: 0, yaw: 0 }) {
  const b = BAYS[bayId];
  const dock = b.truck;
  const roadZ = CARGO_DOCK.road.z;
  const far = CARGO_DOCK.road.farX;
  const s = (u) => u * u * (3 - 2 * u);
  if (phase === 'docked' || (phase === 'arriving' && t >= 1)) {
    out.x = dock.x;
    out.z = dock.z;
    out.yaw = dock.yaw;
    return out;
  }
  if (phase === 'arriving') {
    // 0..0.55: yolda batıya (yaw π/2: önü −x), 0.55..1: geri geri rampaya (yaw π/2 → 0)
    const turnX = dock.x + 9;
    if (t < 0.55) {
      const u = s(t / 0.55);
      out.x = far + (turnX - far) * u;
      out.z = roadZ;
      out.yaw = Math.PI / 2;
    } else {
      const u = s((t - 0.55) / 0.45);
      out.x = turnX + (dock.x - turnX) * u;
      out.z = roadZ + (dock.z - roadZ) * u;
      out.yaw = (Math.PI / 2) * (1 - u);
    }
    return out;
  }
  // leaving: 0..0.45 öne çekip doğuya döner (yaw 0 → −π/2: önü +x), sonra yolda doğuya
  const turnX = dock.x + 7;
  if (t < 0.45) {
    const u = s(t / 0.45);
    out.x = dock.x + (turnX - dock.x) * u;
    out.z = dock.z + (roadZ - dock.z) * u;
    out.yaw = (-Math.PI / 2) * u;
  } else {
    const u = s(Math.min(1, (t - 0.45) / 0.55));
    out.x = turnX + (far - turnX) * u;
    out.z = roadZ;
    out.yaw = -Math.PI / 2;
  }
  return out;
}

/** Toptancı adları (NPC tırları) */
export const SUPPLIERS = freeze({
  food: 'Versmarkt Holland',
  drinks: 'Tulp Dranken (alkolsüz)',
  fun: 'Arcade Supply NL',
  clean: 'Schoon & Fris BV',
  mixed: 'Groothandel De Haven',
});

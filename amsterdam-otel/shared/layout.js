// Otelin dünya yerleşimi (metre cinsinden, Y yukarı, +Z kuzey).
// Sunucu misafir rotalarını ve etkileşim doğrulamasını, istemci ise
// geometriyi ve çarpışma kutularını bu tek kaynaktan üretir.
//
//            z=26 ┌──────────┬───┬──────────┐
//                 │   103    │ K │   104    │
//            z=19 ├──────────┤ O ├──────────┤
//                 │   101    │ R │   102    │
//            z=12 ├──────────┘   └──────────┤
//                 │          LOBİ           │
//                 │ [Resepsiyon]    [Kanepe]│
//             z=0 └──────────┐   ┌──────────┘
//                         SOKAK / KANAL
//                x=-8      -1.5  1.5        8

import { BASEMENT, isInsideBasement } from './basement.js';
import { CARGO_DOCK, isInsideCargoArea } from './cargo.js';

export const WALL_H = 3.2;
export const WALL_T = 0.2;
export const EYE_HEIGHT = 1.65;
export const PLAYER_RADIUS = 0.3;
export const DOOR_W = 1.1;
export const DOOR_H = 2.2;
export const ENTRANCE_HALF = 1.2;

export const AREAS = Object.freeze({
  lobby: { minX: -8, maxX: 8, minZ: 0, maxZ: 12 },
  corridor: { minX: -1.5, maxX: 1.5, minZ: 12, maxZ: 26 },
  street: { minX: -18, maxX: 18, minZ: -7.4, maxZ: 0 },
});

// Oyuncunun gidebileceği en geniş alan (sunucu konum doğrulaması için);
// kuzeyde otelin arkasındaki Achterstraat ve oyuncu evleri (z 26..39.8), onun da kuzeyinde
// (dünyanın görünmeyen bir köşesinde) asansörle çıkılan üst katlar (z 48..106)
// Uzak bölgeler (ışınlanma / asansör / rampa ile gidilir, aynı 2B dünyada ama birbirinden uzak):
//   üst katlar 2–12 + çatı (x −20..20, z 46..340) · yeraltı garajı (x 60..100) · drag pisti (x 140..190)
export const WORLD_BOUNDS = Object.freeze({ minX: -18, maxX: 190, minZ: -460, maxZ: 340 });

// Yeraltı otoparkı / garajı (otelin "altında": sokaktaki rampadan inilir; bkz. UndergroundGarage)
export const GARAGE = Object.freeze({
  bounds: { minX: 60, maxX: 100, minZ: -30, maxZ: 10 },
  spawn: [64, 6], // ışınlanma / rampadan inişte oyuncunun belirdiği yer (kuzeye değil, garaja bakar)
  yaw: 0, // güneye, park sıralarına bakar (asansör kapısı arkada)
});

// Şehir kenarındaki drag pisti ve sürüş alanı (bkz. DragRaceTrack)
export const DRAG = Object.freeze({
  bounds: { minX: 140, maxX: 190, minZ: -460, maxZ: 40 },
  spawn: [150, 30],
  yaw: 0, // pistin başlangıcına (−Z) bakar
});

/** Hızlı ışınlanma hedefleri (ev hedefi oyuncunun kendi evinin girişidir; sunucu çözer) */
export const TELEPORTS = Object.freeze([
  { id: 'hotel', name: 'Otel lobisi', icon: '🏨', point: [0, 3.0], yaw: Math.PI },
  { id: 'home', name: 'Evim', icon: '🏡', point: null, yaw: Math.PI },
  { id: 'restaurant', name: 'Gurme Restoran', icon: '🍽️', point: [-9.6, 11.2], yaw: Math.PI / 2 }, // lobinin batısı, salona bakar
  { id: 'street', name: 'Achterstraat Oost', icon: '🏘️', point: [20.6, 29.5], yaw: -Math.PI / 2 }, // cadde dükkânları, doğuya bakar
  { id: 'garage', name: 'Yeraltı garajı', icon: '🅿️', point: GARAGE.spawn, yaw: GARAGE.yaw },
  { id: 'drag', name: 'Drag pisti', icon: '🏁', point: DRAG.spawn, yaw: DRAG.yaw },
  { id: 'basement', name: 'Eğlence Katı', icon: '🎳', point: BASEMENT.spawn, yaw: 0 }, // −1. Kat (bkz. shared/basement.js)
  { id: 'dock', name: 'Mal Kabul Rampası', icon: '🚚', point: CARGO_DOCK.spawn, yaw: CARGO_DOCK.door.yaw }, // arka avlu (bkz. shared/cargo.js)
]);

// ---- Üst katlar --------------------------------------------------------------
// Fizik / çarpışma 2B olduğu için üst katlar gerçekten üst üste değil: her kat zemin katın
// oda kanadının (koridor + 4 oda) dz kadar kuzeye kaydırılmış bir kopyasıdır ve önünde küçük
// bir asansör sahanlığı vardır. Lobideki asansör oyuncuyu (ve misafirleri) sahanlığa ışınlar.
//
//   z=26+dz ┌──────┬───┬──────┐
//           │ k03  │ K │ k04  │
//   z=19+dz ├──────┤ O ├──────┤
//           │ k01  │ R │ k02  │
//   z=12+dz └────┬─┘   └─┬────┘
//                │ SAHANLIK│
//   z=8+dz       └──[▤]───┘   ← asansör kapısı (x = 0)
// Kat f'nin kaydırması: 2. kat 40 m, sonra her kat 20 m (5–12. katlar lüks paketlerle açılır:
// shared/architecture.js) → 12. kat dz = 240 (oda kanadı z 252..266). Çatı (Aqua Park) ayrı bölge: ROOF.
export const TOP_FLOOR = 12;
export const FLOOR_DZ = Object.freeze(Object.fromEntries(
  Array.from({ length: TOP_FLOOR }, (_, i) => [i + 1, i === 0 ? 0 : 40 + (i - 1) * 20]),
));
export const FLOOR_NUMBERS = Object.freeze(Array.from({ length: TOP_FLOOR }, (_, i) => i + 1));
/** Kat satın alma ile açılan (ilk yüklemede çizilen) katlar; 5–12 lüks paketlerle */
export const BASE_FLOORS = 4;
/** Asansörün "Çatı" durağı (kat numarası gibi taşınır; bkz. ROOF) */
export const ROOF_FLOOR = TOP_FLOOR + 1;
export const LANDING = Object.freeze({ minX: -3.5, maxX: 3.5, minZ: 8, maxZ: 12 }); // dz eklenir

// Çatı terası + Aqua Park (Ultra Lüks Gökdelen paketi): x −18..18, z 280..330. Asansör kulübesi
// güney kenarda (kapı kuzeye bakar); orta yürüyüş yolu (x −2..2) VIP kapısına (z 314) gider.
export const ROOF = Object.freeze({
  bounds: { minX: -18, maxX: 18, minZ: 280, maxZ: 330 },
  elevator: { x: 0, z: 282.4, point: [0, 283.1], spawn: [0, 283.5], yaw: Math.PI },
  hub: [0, 286],
  vipGate: { from: -1, to: 1, z: 314 }, // VIP bölümüne geçit (cam korkuluktaki boşluk)
  vipIn: [0, 316.5],
  // VIP şezlongları (VIP misafirlerin oturduğu yer; suit numarasına göre): seat + face (yaw)
  vipSpots: Object.freeze([
    { seat: [5.2, 322.6], approach: [5.2, 319.2], face: Math.PI },
    { seat: [8.6, 322.6], approach: [8.6, 319.2], face: Math.PI },
    { seat: [12.0, 322.6], approach: [12.0, 319.2], face: Math.PI },
    { seat: [15.4, 322.6], approach: [15.4, 319.2], face: Math.PI },
  ]),
});

// Lüks katların yan salonları (z değerleri kata göre: FLOOR_DZ eklenir). Sahanlığın yanından kısa bir
// hol (x 3.5..8 / −8..−3.5, z 8..12) oda kanadının dışına (|x| > 8, z 6.5..18) açılır: başka hiçbir
// katın geometrisi orada olmadığından salonlar katlar arası 20 m aralığa sığar (2B dünya) ve floorAt
// sınırlarının (dz + 6) içinde kalır.
//   - LOUNGES: alkolsüz lounge barlar (5. kat Library Lounge, 8. kat Sky Lounge) — pasif gelir
//   - STAFF_ROOM: personel odası (5. kat), 7.–30. temizlikçinin bekleme yeri
export const LOUNGES = Object.freeze([
  Object.freeze({ id: 'library', name: 'Library Lounge', floor: 5, bounds: { minX: 8, maxX: 17, minZ: 6.5, maxZ: 18 }, door: { from: 8.8, to: 11.2 } }),
  Object.freeze({ id: 'sky', name: 'Sky Lounge', floor: 8, bounds: { minX: 8, maxX: 17, minZ: 6.5, maxZ: 18 }, door: { from: 8.8, to: 11.2 } }),
]);
const STAFF_SPOTS = [12.4, 13.6, 14.8, 16.0].flatMap((z) => [-15.8, -14.6, -13.4, -12.2, -11.0, -9.8].map((x) => [x, z]));
export const STAFF_ROOM = Object.freeze({
  floor: 5,
  bounds: { minX: -17, maxX: -8, minZ: 6.5, maxZ: 18 },
  door: { from: 8.45, to: 9.55 }, // sahanlığın batı duvarında (x = −3.5)
  // Odadan sahanlığa yürüyüş noktaları (z'ye FLOOR_DZ eklenir); tersi içeri giriştir
  exit: Object.freeze([[-9.2, 10.0], [-4.3, 9.0], [-2.8, 9.0]]),
  spots: Object.freeze(STAFF_SPOTS),
});

export const ELEVATOR = Object.freeze({
  // Lobi: kuzey duvarında (101'in güney duvarı), resepsiyonun karşısında
  lobby: { x: -4.6, z: 12, point: [-4.6, 11.3], spawn: [-4.6, 10.9], yaw: Math.PI },
  // Üst katlar: sahanlığın güney duvarında (x = 0); spawn: kapının önü, kuzeye bakar
  floor: (f) => (f === ROOF_FLOOR ? ROOF.elevator
    : ({ x: 0, z: 8 + FLOOR_DZ[f], point: [0, 8.7 + FLOOR_DZ[f]], spawn: [0, 9.1 + FLOOR_DZ[f]], yaw: Math.PI })),
  range: 1.7,
  width: 1.2,
});

/** Üst kat sahanlığının hub noktası (misafir rotaları) */
export const floorHub = (f) => (f === ROOF_FLOOR ? ROOF.hub : [0, 10.6 + FLOOR_DZ[f]]);

/** (x, z) hangi katta (otelin oda kanadı / sahanlık için); dışarısı 1, çatı ROOF_FLOOR */
export function floorAt(x, z) {
  if (z < 46) return 1;
  if (z >= ROOF.bounds.minZ - 4) return ROOF_FLOOR;
  return Math.min(TOP_FLOOR, Math.max(2, Math.floor((z - 46) / 20) + 2));
}

// Otelin doğusunda, sokağa açılan Amsterdam coffee shop'u
export const COFFEESHOP = Object.freeze({
  bounds: { minX: 8.1, maxX: 16, minZ: 0, maxZ: 8 },
  door: { from: 10.8, to: 12.2 },
  counter: { minX: 10.2, maxX: 14.3, minZ: 6.0, maxZ: 6.7 },
  counterPoint: [12.25, 6.0], // etkileşim mesafesi bu noktaya göre ölçülür
  budtender: [12.25, 7.25],
  slot: { x: 15.45, z: 2.2, point: [15.1, 2.2] },
  range: 2.3,
});

export function isInsideShop(x, z) {
  return x > 8.15 && x < 15.9 && z > 0.12 && z < 7.9;
}

// Otelin batısında, sokağa açılan ortak ev ("Bizim Ev") — oyuncular dekore eder
export const HOUSE = Object.freeze({
  bounds: { minX: -16, maxX: -8.1, minZ: 0, maxZ: 8 },
  // Eşyaların yerleştirilebileceği iç alan; duvar eşyaları (LED) bu çizgilere monte edilir.
  // Her çizgi duvarın görünen iç yüzünden 2 cm içeride (ön duvarın kaplaması z=0.13'te biter;
  // daha geride kalırsa LED ışığı kaplamanın arkasında gizlenir).
  inner: { minX: -15.88, maxX: -8.16, minZ: 0.15, maxZ: 7.88 },
  door: { from: -12.6, to: -11.4 },
  lightSwitch: [-11.0, 0.12], // kapının yanında, ön duvarın iç yüzü
});

export function isInsideHouse(x, z) {
  return x > -15.9 && x < -8.14 && z > 0.12 && z < 7.9;
}

// ---- Achterstraat ve oyuncu evleri ----------------------------------------
// Otelin koridorunun sonundaki arka kapıdan çıkılan dar sokak; kuzeyinde 8 dar
// kanal evi (Huis 1–8). Her oyuncuya bir ev verilir; kapı yalnızca ev sahibine ve
// zili çalıp içeri alınan misafirlere açılır. Evlerin kapısı güney (sokak) duvarında,
// yani Bizim Ev ile aynı yönde: aynı yerleşim kuralları (validatePlacement) çalışır.
export const ALLEY = Object.freeze({
  bounds: { minX: -18, maxX: 18, minZ: 26, maxZ: 33 },
  backDoor: { from: -0.55, to: 0.55 }, // otelin arka duvarında (z = 26), koridorun sonu
});

const PH = Object.freeze({ count: 8, width: 4.2, x0: -16.8, z0: 33, z1: 39.8 });

const r2 = (v) => Math.round(v * 100) / 100;

function makePlayerHouse(i) {
  const minX = r2(PH.x0 + i * PH.width);
  const maxX = r2(minX + PH.width);
  const door = { from: r2(minX + 0.75), to: r2(minX + 1.85) }; // sol tarafta; sağda pencere
  const cx = r2((door.from + door.to) / 2);
  return Object.freeze({
    id: `h${i + 1}`,
    name: `Huis ${i + 1}`,
    owned: true,
    maxItems: 30,
    bounds: { minX, maxX, minZ: PH.z0, maxZ: PH.z1 },
    // Eşyaların yerleşebileceği iç alan (duvar yüzlerinden 2 cm içeride)
    inner: { minX: r2(minX + 0.12), maxX: r2(maxX - 0.12), minZ: r2(PH.z0 + 0.15), maxZ: r2(PH.z1 - 0.12) },
    // "Evin içinde mi" testi (sunucu + istemci)
    inside: { minX: r2(minX + 0.1), maxX: r2(maxX - 0.1), minZ: r2(PH.z0 + 0.12), maxZ: r2(PH.z1 - 0.1) },
    door,
    doorPoint: [cx, r2(PH.z0 - 0.45)], // kapının önü (sokakta): zil / giriş etkileşimi
    entry: [cx, r2(PH.z0 + 0.9)], // içeri alınan misafirin ışınlandığı nokta
    bell: [r2(door.to + 0.22), r2(PH.z0 - 0.11)], // cephedeki zil düğmesi (y ≈ 1.25)
    lightSwitch: null,
  });
}

export const PLAYER_HOUSES = Object.freeze(Array.from({ length: PH.count }, (_, i) => makePlayerHouse(i)));

/** Bizim Ev (ortak, herkes dekore eder) + oyuncu evleri — aynı yapı */
export const SHARED_HOUSE_ID = 'shared';
export const HOUSES = Object.freeze([
  Object.freeze({
    id: SHARED_HOUSE_ID,
    name: 'Bizim Ev',
    owned: false,
    maxItems: 80,
    ...HOUSE,
    inside: { minX: -15.9, maxX: -8.14, minZ: 0.12, maxZ: 7.9 },
    doorPoint: [(HOUSE.door.from + HOUSE.door.to) / 2, -0.45],
    entry: [(HOUSE.door.from + HOUSE.door.to) / 2, 0.9],
  }),
  ...PLAYER_HOUSES,
]);
export const HOUSE_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(HOUSES.map((h) => [h.id, h]))));

export function isInsideHouseDef(h, x, z) {
  const b = h.inside;
  return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
}

/** (x, z) hangi evin içinde (yoksa null) */
export function houseAt(x, z) {
  for (const h of HOUSES) if (isInsideHouseDef(h, x, z)) return h;
  return null;
}

export function isInsideAlley(x, z) {
  return x > -17.9 && x < 17.9 && z > 26.1 && z < 32.9;
}

// ---- Achterstraat Oost: caddenin doğu uzantısı (dükkânlar + benzinlik) ----------------------
// Sokağın doğu ucundaki köşe binasının altındaki geçitten (x = 18) devam eden, iki yanı dükkân
// cepheli kısım; en doğusunda benzinlik. Mülkler ve satın alma: shared/street.js (Cadde İmparatorluğu).
export const ALLEY_EAST = Object.freeze({
  bounds: { minX: 18, maxX: 44, minZ: 26, maxZ: 33 },
  passage: { from: 28.3, to: 30.7, top: 2.6 }, // x = 18 duvarındaki geçit (z aralığı)
});

export function isInsideAlleyEast(x, z) {
  return x > 17.9 && x < 43.9 && z > 26.1 && z < 32.9;
}

// ---- Steeg: sokaktan Achterstraat'a açık hava ara sokağı ----------------------
// Coffee shop ve barın doğusundan geçen dar geçit (bisiklet / scooter yolu). Sokak ucunda
// komşu cephesinin altından, Achterstraat ucunda komşu binanın altındaki kemerden geçilir.
export const STEEG = Object.freeze({
  bounds: { minX: 16.1, maxX: 17.9, minZ: -0.15, maxZ: 26.2 },
  gate: { from: 16.1, to: 17.9, top: 2.8 }, // Achterstraat'taki kemer (z = 26)
});

export function isInsideSteeg(x, z) {
  return x > 16.05 && x < 17.95 && z > -0.2 && z < 26.25;
}

/** Açık hava: sokak, steeg, Achterstraat — araç sürülebilir / park edilebilir yerler */
export function isOutdoors(x, z) {
  if (isInsideSteeg(x, z) || isInsideAlley(x, z) || isInsideAlleyEast(x, z)) return true;
  return z < -0.12 && z > -7.6 && x > -18 && x < 18;
}

// Bisiklet / scooter kiralama-satış büfesi (sokakta, steeg ağzının yanında)
export const VEHICLE_KIOSK = Object.freeze({
  pos: [14.7, -1.15], // büfenin önü (etkileşim noktası)
  range: 1.9,
  spawn: [15.6, -2.9], // satın alınan aracın park edildiği yer
});

// Bar De Tulp — otelin doğusunda, coffee shop'un arkasındaki ek bina (alkolsüz bar).
// Girişi lobinin doğu duvarındaki kapıdan (x = 8). Müşteriler tezgâhın güneyindeki
// taburelere oturur; barmen tezgâhla arka tezgâh arasındaki koridorda çalışır
// (koridora tezgâhın iki ucundan girilir).
export const BAR = Object.freeze({
  bounds: { minX: 8.1, maxX: 16, minZ: 8, maxZ: 14 },
  door: { from: 9.2, to: 10.6 }, // otelin doğu duvarında (z aralığı)
  counter: { minX: 10.0, maxX: 14.6, minZ: 11.4, maxZ: 12.0, top: 1.05 },
  backBar: { minX: 9.6, maxX: 15.88, minZ: 13.3, maxZ: 13.88, top: 0.95 },
  // Etkileşim noktaları (arka tezgâhın ön kenarında; barmen koridordan uzanır)
  glassRack: [10.2, 13.3],
  dispensers: Object.freeze({
    lemon: [11.0, 13.3],
    strawberry: [11.6, 13.3],
    milk: [12.2, 13.3],
    cocoa: [12.8, 13.3],
    soda: [13.4, 13.3],
  }),
  shaker: [14.2, 13.3],
  // Batı ucundaki camlı soğutucu dolap (meyve suları, şuruplar, nane, buz, kahve) ve tezgâhtaki fıçı kulesi
  cooler: [9.05, 13.25],
  taps: [10.17, 11.75],
  recipeBook: [15.55, 10.9], // doğu duvarındaki menü panosunun önünde kürsüde tarif kitabı
  sink: [15.1, 13.3],
  // Yiyecek vitrini tezgâhın doğu ucunda (iki taraftan da alınabilir)
  food: Object.freeze({ brownie: [13.95, 11.7], stroopwafel: [14.4, 11.7] }),
  // spot: tezgâhta müşterinin önü (servis edilen / kirli bardak burada durur)
  stools: Object.freeze([
    { seat: [10.5, 10.85], approach: [10.5, 10.2], spot: [10.5, 11.62] },
    { seat: [11.4, 10.85], approach: [11.4, 10.2], spot: [11.4, 11.62] },
    { seat: [12.3, 10.85], approach: [12.3, 10.2], spot: [12.3, 11.62] },
    { seat: [13.2, 10.85], approach: [13.2, 10.2], spot: [13.2, 11.62] },
  ]),
  // Müşteri rotası: lobi → kapı → taburenin önü (kanepe ve saksılardan uzak)
  points: Object.freeze({ lobby: [6.4, 9.9], doorWest: [7.4, 9.9], doorEast: [8.8, 9.9] }),
  range: 1.8, // istasyona en fazla uzaklık (sunucu + 1 m gecikme toleransı ekler)
});

export function isInsideBar(x, z) {
  return x > 8.15 && x < 15.85 && z > 8.15 && z < 13.85;
}

// Yeraltı Kart Kulübü — barın kuzeyindeki kapalı avlu (102/104'ün doğusu). Girişi steeg'deki
// tabelasız kapıdan (x = 16 duvarında). Masalar ve kurallar: shared/casino.js
export const CASINO = Object.freeze({
  bounds: { minX: 8.2, maxX: 16, minZ: 14.1, maxZ: 25.9 },
  door: { from: 19.45, to: 20.55 }, // steeg'in batı duvarında (z aralığı)
  doorPoint: [16.55, 20], // kapının önü (steeg tarafı)
});

export function isInsideCasino(x, z) {
  return x > 8.25 && x < 15.95 && z > 14.15 && z < 25.85;
}

// Gurme Restoran "De Gouden Lepel" — lobinin batısında, resepsiyonun arkasındaki komşu binada
// (Bizim Ev'in kuzeyi, Achterstraat'ın güneyi). Girişi lobinin batı duvarındaki kapıdan (x = −8).
// Güneyi yemek salonu (6 lüks masa + batı duvarında açık büfe), kuzeyi açık mutfak: aralarında
// garson tezgâhı ("pass", 4 tabak yeri); mutfağa pass'in doğu ucundaki geçitten girilir.
//
//   z=26 ┌[dolap][tahta][ocak][fırın][tabak][çöp]┐
//        │          [  ada  ]                lavabo│  ← mutfak
//   z=20 ├[======= pass (garson tezgâhı) ===]   │
//        │▌ [M5]      [M6]                       │
//        │▌ [M3]      [M4]     (büfe: batı)      │  ← yemek salonu
//        │▌ [M1]      [M2]                   kapı│→ lobi
//   z=8  └────────────────────────────────────────┘
//      x=−18                                  x=−8
const REST_TABLE_X = [-14.6, -11.4];
const REST_TABLE_Z = [10.8, 13.9, 17.0];
export const RESTAURANT = Object.freeze({
  bounds: { minX: -18, maxX: -8.1, minZ: 8.1, maxZ: 26 },
  door: { from: 9.3, to: 10.7 }, // otelin batı duvarında (z aralığı)
  pass: { minX: -17.9, maxX: -10.9, minZ: 19.4, maxZ: 20.0, top: 1.0 },
  // Pass üstündeki tabak yerleri (iki taraftan da uzanılır: aşçı kuzeyden, garson güneyden)
  passSlots: Object.freeze([[-16.6, 19.7], [-15.0, 19.7], [-13.4, 19.7], [-11.8, 19.7]]),
  island: { minX: -16.4, maxX: -12.6, minZ: 22.3, maxZ: 23.1, top: 0.92 },
  counter: { minX: -17.9, maxX: -9.9, minZ: 25.2, maxZ: 25.9, top: 0.92 }, // kuzey duvarı boyunca tezgâh
  fridge: { minX: -17.9, maxX: -16.5, minZ: 24.85, maxZ: 25.9, point: [-17.2, 24.4] },
  // Pişirme istasyonları (tezgâhın önündeki duruş noktaları)
  stations: Object.freeze({ board: [-15.6, 24.55], pan: [-13.9, 24.55], oven: [-12.1, 24.55] }),
  plates: [-10.5, 24.55], // tabak rafı + tabaklama tezgâhı
  trash: [-9.3, 24.6], // çöp kovası (tezgâhın doğu ucunda)
  sink: [-9.2, 22.0], // doğu duvarındaki bulaşık lavabosu (x −8.72…−8.1)
  buffet: { minX: -17.9, maxX: -17.1, minZ: 10.2, maxZ: 17.6, point: [-16.35, 13.9] },
  // Masalar: seat = güneydeki sandalye (müşteri kuzeye, masaya bakar), approach = sandalyenin arkası,
  // serve = masanın doğu yanı (garsonun durduğu yer)
  tables: Object.freeze(REST_TABLE_Z.flatMap((z) => REST_TABLE_X.map((x) => Object.freeze({
    center: [x, z], seat: [x, r2(z - 0.62)], approach: [x, r2(z - 1.25)], serve: [r2(x + 0.85), z],
  })))),
  // Lobi → kapı yürüyüş noktaları
  points: Object.freeze({ lobby: [-5.4, 10.0], doorEast: [-7.4, 10.0], doorWest: [-8.7, 10.0] }),
  // Yürüyüş şeritleri (NPC rotaları masaların ve adanın içinden geçmesin): doğu koridoru (x),
  // pass önü, masa sıralarının güney şeritleri, mutfağın güney / kuzey şeritleri ve adanın doğusu
  lanes: Object.freeze({ aisleX: -9.6, pass: 18.95, rows: Object.freeze(REST_TABLE_Z.map((z) => r2(z - 1.25))), kitchenS: 21.3, kitchenN: 24.4, kitchenCol: -11.9 }),
  chefSpots: Object.freeze([[-14.6, 21.3], [-13.4, 21.3], [-15.8, 21.3]]),
  waiterSpots: Object.freeze([[-10.2, 18.35], [-9.25, 18.35], [-10.2, 17.5], [-9.25, 17.5]]),
  range: 1.8, // istasyona en fazla uzaklık (sunucu + 1 m gecikme toleransı ekler)
});

export function isInsideRestaurant(x, z) {
  return x > -17.85 && x < -8.15 && z > 8.15 && z < 25.85;
}

export const RECEPTION = Object.freeze({
  desk: { minX: -7.0, maxX: -6.2, minZ: 5.2, maxZ: 8.8 },
  clerk: [-7.45, 7.0],
  front: [-5.5, 7.0],
});

// Resepsiyon bilgisayarı (masanın kuzey ucundaki monitör): Resepsiyon PC paneli
export const RECEPTION_PC = Object.freeze({ monitor: [-6.94, 8.1], point: [-5.85, 8.15], range: 1.3 });

export const SOFA = Object.freeze({ minX: 6.9, maxX: 7.85, minZ: 3.6, maxZ: 7.6 });

// Bekleyen misafirlerin oturduğu kanepe noktaları ve oraya yaklaşma noktaları
export const SEATS = Object.freeze([
  { seat: [7.3, 4.3], approach: [6.1, 4.3] },
  { seat: [7.3, 5.6], approach: [6.1, 5.6] },
  { seat: [7.3, 6.9], approach: [6.1, 6.9] },
]);

export const POINTS = Object.freeze({
  streetWest: [-23, -3.6],
  streetEast: [23, -3.6],
  doorOutside: [0, -1.4],
  doorInside: [0, 1.0],
  hub: [0, 10.6],
  playerSpawn: [0, 3.0],
});

function makeRoom(id, side, z0, floor = 1) {
  const s = side; // -1: batı (sol), +1: doğu (sağ)
  const xIn = 1.5 * s;
  const xOut = 8 * s;
  const doorZ = z0 + 3.5;
  return Object.freeze({
    id,
    floor,
    side: s,
    bounds: { minX: Math.min(xIn, xOut), maxX: Math.max(xIn, xOut), minZ: z0, maxZ: z0 + 7 },
    door: { x: xIn, z: doorZ },
    path: {
      corridor: [0, doorZ],
      doorOut: [0.75 * s, doorZ],
      doorIn: [2.3 * s, doorZ],
      stand: [3.6 * s, z0 + 1.8],
    },
    bed: { x: 6.85 * s, z: z0 + 4.6, len: 2.1, wid: 1.6 },
    trashSpots: [
      [2.4 * s, z0 + 1.0],
      [5.2 * s, z0 + 1.6],
      [3.4 * s, z0 + 6.1],
      [4.8 * s, z0 + 3.2],
    ],
    windowZ: z0 + 1.8,
  });
}

// Kat başına 4 oda: k01 (batı, ön), k02 (doğu, ön), k03 (batı, arka), k04 (doğu, arka)
export const ROOMS = Object.freeze(FLOOR_NUMBERS.flatMap((f) => {
  const dz = FLOOR_DZ[f];
  return [
    makeRoom(`${f}01`, -1, 12 + dz, f),
    makeRoom(`${f}02`, 1, 12 + dz, f),
    makeRoom(`${f}03`, -1, 19 + dz, f),
    makeRoom(`${f}04`, 1, 19 + dz, f),
  ];
}));

export const ROOM_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(ROOMS.map((r) => [r.id, r]))));

export function pointInBounds(x, z, b, margin = 0) {
  return x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin;
}

/** Oyuncu odanın içinde mi? (koridor duvarının oda tarafında) */
export function isInsideRoom(room, x, z) {
  const b = room.bounds;
  return x * room.side > 1.5 + 0.05 && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

// ---- Duvar parçaları ---------------------------------------------------
// Her parça eksene hizalı bir kutudur. Kapı boşluklarının üstü "lento"
// (tepe parçası) olarak eklenir; lentolar çarpışmaya dahil edilmez.

function wallAlongX(out, z, x1, x2, gaps, mat) {
  const h = WALL_T / 2;
  let cursor = x1 - h;
  const end = x2 + h;
  for (const g of gaps) {
    if (g.from > cursor) out.push({ minX: cursor, maxX: g.from, minZ: z - h, maxZ: z + h, minY: 0, maxY: WALL_H, mat });
    out.push({ minX: g.from, maxX: g.to, minZ: z - h, maxZ: z + h, minY: g.top, maxY: WALL_H, mat, lintel: true });
    cursor = g.to;
  }
  if (end > cursor) out.push({ minX: cursor, maxX: end, minZ: z - h, maxZ: z + h, minY: 0, maxY: WALL_H, mat });
}

function wallAlongZ(out, x, z1, z2, gaps, mat) {
  const h = WALL_T / 2;
  let cursor = z1 - h;
  const end = z2 + h;
  for (const g of gaps) {
    if (g.from > cursor) out.push({ minX: x - h, maxX: x + h, minZ: cursor, maxZ: g.from, minY: 0, maxY: WALL_H, mat });
    out.push({ minX: x - h, maxX: x + h, minZ: g.from, maxZ: g.to, minY: g.top, maxY: WALL_H, mat, lintel: true });
    cursor = g.to;
  }
  if (end > cursor) out.push({ minX: x - h, maxX: x + h, minZ: cursor, maxZ: end, minY: 0, maxY: WALL_H, mat });
}

const doorGap = (z) => ({ from: z - DOOR_W / 2, to: z + DOOR_W / 2, top: DOOR_H });

export function buildWallSegments() {
  const w = [];
  // Ön cephe (tuğla) — ortada giriş kapısı
  wallAlongX(w, 0, -8, 8, [{ from: -ENTRANCE_HALF, to: ENTRANCE_HALF, top: 2.6 }], 'brick');
  // Yan dış duvarlar
  // Batı duvarı: lobiden Gurme Restoran'a açılan kapı (z 0..8 arası Bizim Ev'in doğu duvarı)
  wallAlongZ(w, -8, 0, 26, [{ from: RESTAURANT.door.from, to: RESTAURANT.door.to, top: DOOR_H }], 'wall');
  // Doğu duvarı: lobiden Bar De Tulp'a açılan kapı
  wallAlongZ(w, 8, 0, 26, [{ from: BAR.door.from, to: BAR.door.to, top: DOOR_H }], 'wall');
  // Lobi kuzey duvarı (101/102'nin güney duvarı), ortada koridor ağzı
  wallAlongX(w, 12, -8, 8, [{ from: -1.5, to: 1.5, top: 2.7 }], 'wall');
  roomWing(w, 0);
  // Arka duvar — koridorun sonunda Achterstraat'a açılan arka kapı
  wallAlongX(w, 26, -8, 8, [{ from: ALLEY.backDoor.from, to: ALLEY.backDoor.to, top: DOOR_H }], 'wall');
  // Coffee shop: ön cephe (kapılı), doğu ve arka duvar; batı duvarı otelin doğu duvarı
  const shop = COFFEESHOP;
  wallAlongX(w, 0, 8.2, 16, [{ from: shop.door.from, to: shop.door.to, top: 2.5 }], 'shopWall');
  wallAlongZ(w, 16, 0, 8, [], 'shopWall');
  wallAlongX(w, 8, 8.2, 16, [], 'shopWall');
  // Bizim Ev: ön cephe (kapılı), batı ve arka duvar; doğu duvarı otelin batı duvarı
  const house = HOUSE;
  wallAlongX(w, 0, -16, -8.2, [{ from: house.door.from, to: house.door.to, top: 2.5 }], 'brick');
  wallAlongZ(w, -16, 0, 8, [], 'houseWall');
  wallAlongX(w, 8, -16, -8.2, [], 'houseWall');
  // Bar De Tulp: kuzey ve doğu duvarı; güneyi coffee shop'un arka duvarı, batısı otelin doğu duvarı
  wallAlongX(w, 14, 8.2, 16, [], 'barWall');
  wallAlongZ(w, 16, 8.1, 14, [], 'barWall');
  // Gurme Restoran: batı duvarı ve Bizim Ev'in batısında kalan güney duvarı; kuzeyi Achterstraat'ın
  // güney duvarı, doğusu otelin batı duvarı, güneyinin geri kalanı Bizim Ev'in arka duvarı
  wallAlongZ(w, -18, 8.1, 25.9, [], 'restWall');
  wallAlongX(w, 8, -18, -16.1, [], 'restWall');
  // Achterstraat: güneyde komşu binaların arka duvarları, iki uçta duvar
  wallAlongX(w, 26, -18, -8.2, [], 'brick');
  wallAlongX(w, 26, 8.2, 18, [STEEG.gate], 'brick'); // steeg kemeri
  // Steeg: doğuda komşu bina, batıda (barın arkasında) avlu duvarı
  wallAlongZ(w, 18, 0.1, 25.9, [], 'brick');
  wallAlongZ(w, 16, 14.1, 25.9, [{ from: CASINO.door.from, to: CASINO.door.to, top: DOOR_H }], 'brick'); // Kart Kulübü kapısı
  wallAlongZ(w, -18, 26.1, 33, [], 'brick');
  wallAlongZ(w, 18, 26.1, 33, [ALLEY_EAST.passage], 'brick'); // Achterstraat Oost'a geçit
  // Achterstraat Oost: güney ve kuzey cephe hatları, doğu ucu (benzinlik kulübesinin arkası)
  wallAlongX(w, 26, 18.1, 44, [], 'brick');
  wallAlongX(w, 33, 18.1, 44, [], 'brick');
  wallAlongZ(w, 44, 26.1, 33, [], 'brick');
  // Oyuncu evleri: sokağa bakan cephe (her evin kapısıyla), aralarındaki ve arka duvarlar
  wallAlongX(w, PH.z0, -18, 18, PLAYER_HOUSES.map((h) => ({ from: h.door.from, to: h.door.to, top: DOOR_H })), 'brick');
  for (let i = 0; i <= PH.count; i++) wallAlongZ(w, PH.x0 + i * PH.width, PH.z0 + 0.1, PH.z1, [], 'phWall');
  wallAlongX(w, PH.z1, PH.x0 + 0.1, -PH.x0 - 0.1, [], 'phWall');
  // Üst katlar 2–4: sahanlık + oda kanadı (5–12. katlar lüks paketle, ayrıca: buildFloorWallSegments)
  for (let f = 2; f <= BASE_FLOORS; f++) w.push(...buildFloorWallSegments(f));
  return w;
}

/**
 * Tek bir üst katın duvarları: sahanlık + oda kanadı (dış duvarlar ve arka duvar dahil, arka kapı yok).
 * Lüks katlarda sahanlığın yanlarında personel odası (batı, 5. kat) ve lounge bar (doğu, 5. ve 8. kat).
 */
export function buildFloorWallSegments(f) {
  const w = [];
  const dz = FLOOR_DZ[f];
  const L = LANDING;
  const lounge = LOUNGES.find((l) => l.floor === f);
  const staff = STAFF_ROOM.floor === f ? STAFF_ROOM : null;
  wallAlongX(w, L.minZ + dz, L.minX, L.maxX, [], 'wall'); // asansör kapısı duvara gömülü (dekor)
  // Batı: personel odası (sahanlığın batı duvarındaki kapı → giriş holü → oda)
  if (staff) {
    const b = staff.bounds;
    wallAlongZ(w, L.minX, L.minZ + dz, L.maxZ + dz, [{ from: staff.door.from + dz, to: staff.door.to + dz, top: DOOR_H }], 'wall');
    wallAlongX(w, L.minZ + dz, -8, L.minX - 0.1, [], 'wall'); // hol güneyi
    wallAlongZ(w, -8, b.minZ + dz, L.minZ + dz, [], 'wall'); // oda doğusu (holün güneyinde; kuzeyi kanadın batı duvarı)
    wallAlongX(w, b.minZ + dz, b.minX, -8.1, [], 'wall');
    wallAlongZ(w, b.minX, b.minZ + dz + 0.1, b.maxZ + dz, [], 'wall');
    wallAlongX(w, b.maxZ + dz, b.minX, -8.1, [], 'wall');
  } else {
    wallAlongZ(w, L.minX, L.minZ + dz, L.maxZ + dz, [], 'wall');
  }
  // Doğu: lounge bar (sahanlığın doğu duvarındaki kemer → giriş holü → bar salonu)
  if (lounge) {
    const b = lounge.bounds;
    wallAlongZ(w, L.maxX, L.minZ + dz, L.maxZ + dz, [{ from: lounge.door.from + dz, to: lounge.door.to + dz, top: 2.7 }], 'wall');
    wallAlongX(w, L.minZ + dz, L.maxX + 0.1, 8, [], 'wall'); // hol güneyi
    wallAlongZ(w, 8, b.minZ + dz, L.minZ + dz, [], 'wall'); // salonun batısı (holün güneyinde; kuzeyi kanadın doğu duvarı)
    wallAlongX(w, b.minZ + dz, 8.1, b.maxX, [], 'wall');
    wallAlongZ(w, b.maxX, b.minZ + dz + 0.1, b.maxZ + dz, [], 'wall');
    wallAlongX(w, b.maxZ + dz, 8.1, b.maxX - 0.1, [], 'wall');
  } else {
    wallAlongZ(w, L.maxX, L.minZ + dz, L.maxZ + dz, [], 'wall');
  }
  wallAlongX(w, 12 + dz, -8, 8, [{ from: -1.5, to: 1.5, top: 2.7 }], 'wall');
  wallAlongZ(w, -8, 12 + dz, 26 + dz, [], 'wall');
  wallAlongZ(w, 8, 12 + dz, 26 + dz, [], 'wall');
  wallAlongX(w, 26 + dz, -8, 8, [], 'wall');
  roomWing(w, dz);
  return w;
}

/** Oda kanadının iç duvarları: koridor duvarları (oda kapılarıyla) ve odalar arası duvarlar */
function roomWing(w, dz) {
  wallAlongZ(w, -1.5, 12 + dz, 26 + dz, [doorGap(15.5 + dz), doorGap(22.5 + dz)], 'wall');
  wallAlongZ(w, 1.5, 12 + dz, 26 + dz, [doorGap(15.5 + dz), doorGap(22.5 + dz)], 'wall');
  wallAlongX(w, 19 + dz, -8, -1.5, [], 'wall');
  wallAlongX(w, 19 + dz, 1.5, 8, [], 'wall');
}

/** Üst katın sahanlığında mı (asansör önü) */
export function isOnLanding(f, x, z) {
  const dz = FLOOR_DZ[f];
  return f > 1 && x > LANDING.minX && x < LANDING.maxX && z > LANDING.minZ + dz && z < LANDING.maxZ + dz;
}

/** Oyuncunun bulunduğu bölge (halüsinasyonları aynı bölgede tutmak için) */
export function areaAt(x, z) {
  if (isInsideShop(x, z)) return 'shop';
  if (isInsideHouse(x, z)) return 'house';
  if (isInsideBar(x, z)) return 'bar';
  if (isInsideCasino(x, z)) return 'casino';
  if (isInsideRestaurant(x, z)) return 'restaurant';
  if (isInsideBasement(x, z)) return 'basement';
  if (isInsideCargoArea(x, z)) return 'dock';
  if (isInsideAlley(x, z) || isInsideAlleyEast(x, z)) return 'alley';
  if (isInsideSteeg(x, z)) return 'steeg';
  for (const h of PLAYER_HOUSES) if (isInsideHouseDef(h, x, z)) return h.id;
  for (const r of ROOMS) if (isInsideRoom(r, x, z)) return r.id;
  if (pointInBounds(x, z, AREAS.corridor) && Math.abs(x) < 1.4) return 'corridor';
  if (z > 46) return `floor${floorAt(x, z)}`;
  if (pointInBounds(x, z, AREAS.lobby) && z > 0.1 && Math.abs(x) < 7.9) return 'lobby';
  if (z < -0.1 && pointInBounds(x, z, AREAS.street)) return 'street';
  return null;
}

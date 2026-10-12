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
// kuzeyde otelin arkasındaki Achterstraat ve oyuncu evleri (z 26..39.8)
export const WORLD_BOUNDS = Object.freeze({ minX: -18, maxX: 18, minZ: -7.6, maxZ: 40 });

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
  if (isInsideSteeg(x, z) || isInsideAlley(x, z)) return true;
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

export const RECEPTION = Object.freeze({
  desk: { minX: -7.0, maxX: -6.2, minZ: 5.2, maxZ: 8.8 },
  clerk: [-7.45, 7.0],
  front: [-5.5, 7.0],
});

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

function makeRoom(id, side, z0) {
  const s = side; // -1: batı (sol), +1: doğu (sağ)
  const xIn = 1.5 * s;
  const xOut = 8 * s;
  const doorZ = z0 + 3.5;
  return Object.freeze({
    id,
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

export const ROOMS = Object.freeze([
  makeRoom('101', -1, 12),
  makeRoom('102', 1, 12),
  makeRoom('103', -1, 19),
  makeRoom('104', 1, 19),
]);

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
  wallAlongZ(w, -8, 0, 26, [], 'wall');
  // Doğu duvarı: lobiden Bar De Tulp'a açılan kapı
  wallAlongZ(w, 8, 0, 26, [{ from: BAR.door.from, to: BAR.door.to, top: DOOR_H }], 'wall');
  // Lobi kuzey duvarı (101/102'nin güney duvarı), ortada koridor ağzı
  wallAlongX(w, 12, -8, 8, [{ from: -1.5, to: 1.5, top: 2.7 }], 'wall');
  // Koridor duvarları + oda kapıları
  wallAlongZ(w, -1.5, 12, 26, [doorGap(15.5), doorGap(22.5)], 'wall');
  wallAlongZ(w, 1.5, 12, 26, [doorGap(15.5), doorGap(22.5)], 'wall');
  // Odalar arası duvarlar
  wallAlongX(w, 19, -8, -1.5, [], 'wall');
  wallAlongX(w, 19, 1.5, 8, [], 'wall');
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
  // Achterstraat: güneyde komşu binaların arka duvarları, iki uçta duvar
  wallAlongX(w, 26, -18, -8.2, [], 'brick');
  wallAlongX(w, 26, 8.2, 18, [STEEG.gate], 'brick'); // steeg kemeri
  // Steeg: doğuda komşu bina, batıda (barın arkasında) avlu duvarı
  wallAlongZ(w, 18, 0.1, 25.9, [], 'brick');
  wallAlongZ(w, 16, 14.1, 25.9, [{ from: CASINO.door.from, to: CASINO.door.to, top: DOOR_H }], 'brick'); // Kart Kulübü kapısı
  wallAlongZ(w, -18, 26.1, 33, [], 'brick');
  wallAlongZ(w, 18, 26.1, 33, [], 'brick');
  // Oyuncu evleri: sokağa bakan cephe (her evin kapısıyla), aralarındaki ve arka duvarlar
  wallAlongX(w, PH.z0, -18, 18, PLAYER_HOUSES.map((h) => ({ from: h.door.from, to: h.door.to, top: DOOR_H })), 'brick');
  for (let i = 0; i <= PH.count; i++) wallAlongZ(w, PH.x0 + i * PH.width, PH.z0 + 0.1, PH.z1, [], 'phWall');
  wallAlongX(w, PH.z1, PH.x0 + 0.1, -PH.x0 - 0.1, [], 'phWall');
  return w;
}

/** Oyuncunun bulunduğu bölge (halüsinasyonları aynı bölgede tutmak için) */
export function areaAt(x, z) {
  if (isInsideShop(x, z)) return 'shop';
  if (isInsideHouse(x, z)) return 'house';
  if (isInsideBar(x, z)) return 'bar';
  if (isInsideCasino(x, z)) return 'casino';
  if (isInsideAlley(x, z)) return 'alley';
  if (isInsideSteeg(x, z)) return 'steeg';
  for (const h of PLAYER_HOUSES) if (isInsideHouseDef(h, x, z)) return h.id;
  for (const r of ROOMS) if (isInsideRoom(r, x, z)) return r.id;
  if (pointInBounds(x, z, AREAS.corridor) && Math.abs(x) < 1.4) return 'corridor';
  if (pointInBounds(x, z, AREAS.lobby) && z > 0.1 && Math.abs(x) < 7.9) return 'lobby';
  if (z < -0.1 && pointInBounds(x, z, AREAS.street)) return 'street';
  return null;
}

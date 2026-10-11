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

// Oyuncunun gidebileceği en geniş alan (sunucu konum doğrulaması için)
export const WORLD_BOUNDS = Object.freeze({ minX: -18, maxX: 18, minZ: -7.6, maxZ: 26 });

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
  // Arka duvar
  wallAlongX(w, 26, -8, 8, [], 'wall');
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
  return w;
}

/** Oyuncunun bulunduğu bölge (halüsinasyonları aynı bölgede tutmak için) */
export function areaAt(x, z) {
  if (isInsideShop(x, z)) return 'shop';
  if (isInsideHouse(x, z)) return 'house';
  if (isInsideBar(x, z)) return 'bar';
  for (const r of ROOMS) if (isInsideRoom(r, x, z)) return r.id;
  if (pointInBounds(x, z, AREAS.corridor) && Math.abs(x) < 1.4) return 'corridor';
  if (pointInBounds(x, z, AREAS.lobby) && z > 0.1 && Math.abs(x) < 7.9) return 'lobby';
  if (z < -0.1 && pointInBounds(x, z, AREAS.street)) return 'street';
  return null;
}

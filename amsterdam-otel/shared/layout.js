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
  street: { minX: -12, maxX: 12, minZ: -7.4, maxZ: 0 },
});

// Oyuncunun gidebileceği en geniş alan (sunucu konum doğrulaması için)
export const WORLD_BOUNDS = Object.freeze({ minX: -12, maxX: 12, minZ: -7.6, maxZ: 26 });

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
  streetWest: [-19, -3.6],
  streetEast: [19, -3.6],
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

export const ROOM_BY_ID = Object.freeze(Object.fromEntries(ROOMS.map((r) => [r.id, r])));

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
  wallAlongZ(w, 8, 0, 26, [], 'wall');
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
  return w;
}

import { POINTS, ELEVATOR, floorHub } from '../../shared/layout.js';

// Otel içi yürüyüş rotaları (misafirler ve temizlikçiler). Üst kattaki bir odaya giden rota
// iki "bacak"tan oluşur: lobide asansörün önüne kadar, sonra kattaki asansör kapısından odaya.
// Bacaklar arasında NPC ışınlanır (oyuncunun asansörü gibi).

/** Kattaki asansör önü (1. kat: lobi) */
export const elevatorPoint = (f) => (f === 1 ? ELEVATOR.lobby.point : ELEVATOR.floor(f).point);

/** Kat hub'ı (1. kat: lobinin kuzeyi, koridor ağzı) */
export const hubOf = (f) => (f === 1 ? POINTS.hub : floorHub(f));

/** Oda kapısından içeri: koridor → kapı → içerisi */
export const roomEntry = (layout) => {
  const rp = layout.path;
  return [rp.corridor, rp.doorOut, rp.doorIn];
};

/** Odadan çıkış: içerisi → kapı → koridor */
export const roomExit = (layout) => {
  const rp = layout.path;
  return [rp.doorIn, rp.doorOut, rp.corridor];
};

/**
 * Lobideki bir noktadan (fromPath'in sonu) odaya: bacak listesi.
 * @param fromPath lobide başlayan noktalar
 * @param end odanın içindeki hedef nokta(lar)
 */
export function lobbyToRoom(fromPath, layout, end) {
  const f = layout.floor;
  if (f === 1) return [[...fromPath, POINTS.hub, ...roomEntry(layout), ...end]];
  return [
    [...fromPath, elevatorPoint(1)],
    [elevatorPoint(f), hubOf(f), ...roomEntry(layout), ...end],
  ];
}

/** Odadan lobideki bir noktaya (toPath lobide başlar) */
export function roomToLobby(startPath, layout, toPath) {
  const f = layout.floor;
  if (f === 1) return [[...startPath, ...roomExit(layout), POINTS.hub, ...toPath]];
  return [
    [...startPath, ...roomExit(layout), hubOf(f), elevatorPoint(f)],
    [elevatorPoint(1), ...toPath],
  ];
}

// ---- Lüks paketler: personel odası (5. kat) ve çatı (VIP misafirler) ---------------------------

/**
 * Bir kattaki noktadan (fromPath o katta, hub'a doğrudan yürünebilir) odaya.
 * 1. katta lobbyToRoom ile aynıdır.
 */
export function floorToRoom(f, fromPath, layout, end) {
  if (f === 1) return lobbyToRoom(fromPath, layout, end);
  if (f === layout.floor) return [[...fromPath, hubOf(f), ...roomEntry(layout), ...end]];
  return [
    [...fromPath, hubOf(f), elevatorPoint(f)],
    [elevatorPoint(layout.floor), hubOf(layout.floor), ...roomEntry(layout), ...end],
  ];
}

/** Odadan bir kattaki noktaya (toPath o katın hub'ından yürünür). 1. katta roomToLobby. */
export function roomToFloor(startPath, layout, f, toPath) {
  if (f === 1) return roomToLobby(startPath, layout, toPath);
  if (layout.floor === f) return [[...startPath, ...roomExit(layout), hubOf(f), ...toPath]];
  return [
    [...startPath, ...roomExit(layout), hubOf(layout.floor), elevatorPoint(layout.floor)],
    [elevatorPoint(f), hubOf(f), ...toPath],
  ];
}

/** Odadan başka bir odaya (aynı ya da farklı kat) */
export function roomToRoom(startPath, from, to, end) {
  if (from.id === to.id) return [[...startPath, ...end]];
  if (from.floor === to.floor) {
    return [[...startPath, ...roomExit(from), ...roomEntry(to), ...end]];
  }
  return [
    [...startPath, ...roomExit(from), hubOf(from.floor), elevatorPoint(from.floor)],
    [elevatorPoint(to.floor), hubOf(to.floor), ...roomEntry(to), ...end],
  ];
}

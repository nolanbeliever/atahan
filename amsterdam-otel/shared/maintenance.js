// Otel odalarında temizlik ve tamirat işleri (mini oyunlar). Sunucu (konum + süre doğrulaması)
// ve istemci (görseller, mini oyunlar) AYNI noktaları ve süreleri kullanır.
//
// Misafir çıkınca oda kirlenir (dağınık yatak + çöpler) ve buna ek olarak 1–2 arıza çıkar:
//   stainFloor: yerde içecek / çamur lekesi       → bezle ovarak sil
//   stainWall:  duvarda leke                      → bezle ovarak sil
//   bulb:       tavan lambasının ampulü patlamış  → eskisini çıkar, yenisini tak
//   faucet:     lavabonun musluğu damlatıyor      → anahtarı doğru anda sıkıştır
//   fuse:       sigorta atmış                     → kutudaki şalterleri kaldır

export const ISSUES = Object.freeze([
  { id: 'stainFloor', label: 'Yerdeki lekeyi sil', icon: '🧽', game: 'scrub', minMs: 1800 },
  { id: 'stainWall', label: 'Duvardaki lekeyi sil', icon: '🧽', game: 'scrub', minMs: 1800 },
  { id: 'bulb', label: 'Patlak ampulü değiştir', icon: '💡', game: 'bulb', minMs: 1500 },
  { id: 'faucet', label: 'Damlayan musluğu sık', icon: '🔧', game: 'faucet', minMs: 1500 },
  { id: 'fuse', label: 'Atan sigortayı kaldır', icon: '⚡', game: 'fuse', minMs: 1000 },
]);
export const ISSUE_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(ISSUES.map((i) => [i.id, i]))));
export const ISSUE_IDS = Object.freeze(ISSUES.map((i) => i.id));

export const MAINT_RULES = Object.freeze({
  RANGE: 1.8, // arızaya en fazla uzaklık (sunucu + 1 m tolerans)
  MIN_ISSUES: 1,
  MAX_ISSUES: 2,
  REPAIR_BONUS: 2, // tamir edilen her arıza için misafirin ek bahşişi (€)
  FAST_BONUS: 5, // oda (ilk işten itibaren) bu sürede biterse hız bonusu (€)
  FAST_MS: 90_000,
  SLACK_MS: 250, // ağ titremesi toleransı
});

/**
 * Odanın arıza noktaları (oyuncunun durup etkileşeceği zemin noktası + görselin yeri).
 * @param room shared/layout.js ROOMS öğesi
 * @returns {{ [issueId]: { x, z, y, wall?: 'corridor'|'south' } }}
 */
export function issueSpots(room) {
  const s = room.side;
  const z0 = room.bounds.minZ;
  return {
    stainFloor: { x: s * 3.0, z: z0 + 3.9, y: 0 },
    stainWall: { x: s * 1.62, z: z0 + 5.6, y: 1.15, wall: 'corridor' },
    bulb: { x: s * 4.75, z: z0 + 3.5, y: 3.12 },
    faucet: { x: s * 4.4, z: z0 + 0.38, y: 0.95, wall: 'south' },
    fuse: { x: s * 1.62, z: z0 + 1.35, y: 1.45, wall: 'corridor' },
  };
}

/** Lavabo (her odada; statik mobilya, çarpışma kutusu) */
export function sinkBox(room) {
  const s = room.side;
  const z0 = room.bounds.minZ;
  const x = s * 4.4;
  return { minX: x - 0.32, maxX: x + 0.32, minZ: z0 + 0.1, maxZ: z0 + 0.55 };
}

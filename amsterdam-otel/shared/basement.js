// −1. Kat VIP Eğlence Katı ("Neon Kelder"): yerleşim, istasyonlar, fiyatlar, NPC rotaları, bowling skoru.
// Fizik / çarpışma 2B olduğu için bodrum dünyanın ayrı bir köşesindedir (x 26..56, z −34..−10; garajın batısı,
// otel dünyasından uzak). Lobideki merdiven kapısı (E) ve asansörün "−1" durağı buraya ışınlar.
// Bu dosya layout.js'i içe aktarmaz (layout.js bodrumun sınırlarını buradan alır).
//
//   z=−10 ┌──[asansör]──[merdiven]─────────────────────────────┐
//         │                       hub        ┌─skor─┐┌─skor─┐  │
//         │  [Bilardo 1]           │  [Ping pong] │ ║ L1 ║ L2 │  ← bowling kulvarları (güneye)
//         │                        │          │ ║    ║    │  │
//         │  [Bilardo 2]           │ [lounge] │ ║    ║    │  │
//         │                        │          │ ║ ▲▲ ║ ▲▲ │  │
//         │ [Langırt 1][Langırt 2] │ [Arcade ×6]  ║    ║    │  │
//   z=−34 └──────────────────────────────────────────────────┘
//       x=26                     x=40                        x=56

export const BASEMENT_FLOOR = -1; // asansör durağı (kat numarası gibi taşınır)

const r2 = (v) => Math.round(v * 100) / 100;
const freeze = Object.freeze;

const B = freeze({ minX: 26, maxX: 56, minZ: -34, maxZ: -10 });
const AISLE_X = 40;

// ---- İstasyonlar ------------------------------------------------------------------------------
// face: NPC'nin baktığı yön (GuestView: rotation.y; 0 = +Z, π/2 = +X). via: hub'dan sonra yürüyüş noktaları.

const POOL_TABLES = [[32, -17], [32, -24]];
const FOOS_TABLES = [[29.5, -30], [34.5, -30]];
const PONG = [45, -19.5];
const ARCADE_X = [42.4, 43.5, 44.6, 45.7, 46.8, 47.9];
const ARCADE_GAMES = ['snake', 'breakout', 'invaders', 'snake', 'breakout', 'invaders'];
const LANE_X = [51.4, 53.9];

const spot = (x, z, face, via) => freeze({ at: freeze([x, z]), face, via: freeze(via.map((p) => freeze(p))) });

export const BASEMENT = freeze({
  bounds: B,
  ceiling: 3.4,
  // Kuzey duvarında asansör ve merdiven; varışta güneye (salona) bakılır
  elevator: freeze({ x: 32, z: B.maxZ, point: freeze([32, -10.7]), spawn: freeze([32, -11.2]), yaw: 0 }),
  stairs: freeze({ x: 37, z: B.maxZ, point: freeze([37, -10.7]), spawn: freeze([37, -11.3]), yaw: 0 }),
  // Lobideki merdiven kapısı (lobinin kuzey duvarı, asansörün simetriği); dönüşte lobiye (güneye) bakılır
  lobbyStairs: freeze({ x: 4.6, z: 12, point: freeze([4.6, 11.3]), spawn: freeze([4.6, 10.7]), yaw: 0 }),
  spawn: freeze([34.5, -11.6]), // ışınlanma hedefi
  hub: freeze([AISLE_X, -12.6]),
  aisleX: AISLE_X,
  range: 1.8, // asansör / merdiven etkileşim menzili
  pool: freeze(POOL_TABLES.map(([x, z], i) => freeze({
    id: `pool${i + 1}`, name: `Bilardo ${i + 1}`, center: freeze([x, z]), L: 2.24, W: 1.12, outerL: 2.74, outerW: 1.52,
    spots: freeze([
      spot(x + 2.0, z, -Math.PI / 2, [[AISLE_X, z]]),
      spot(x - 2.0, z, Math.PI / 2, [[AISLE_X, z + 1.6], [x - 2.0, z + 1.6]]),
    ]),
  }))),
  foos: freeze(FOOS_TABLES.map(([x, z], i) => freeze({
    id: `foos${i + 1}`, name: `Langırt ${i + 1}`, center: freeze([x, z]), L: 1.2, W: 0.7,
    // seat 0: güney kenarı (kuzeye bakar), seat 1: kuzey kenarı
    spots: freeze([
      spot(x, z - 1.0, 0, [[AISLE_X, -32.2], [x, -32.2]]),
      spot(x, z + 1.0, Math.PI, [[AISLE_X, -28.2], [x, -28.2]]),
    ]),
  }))),
  pong: freeze([freeze({
    id: 'pong1', name: 'Masa tenisi', center: freeze(PONG), L: 2.74, W: 1.525,
    // seat 0: batı ucu (doğuya bakar), seat 1: doğu ucu
    spots: freeze([
      spot(PONG[0] - 2.4, PONG[1], Math.PI / 2, [[AISLE_X, PONG[1]]]),
      spot(PONG[0] + 2.4, PONG[1], -Math.PI / 2, [[AISLE_X, PONG[1] + 1.9], [PONG[0] + 2.4, PONG[1] + 1.9]]),
    ]),
  })]),
  arcade: freeze(ARCADE_X.map((x, i) => freeze({
    id: `arc${i + 1}`, name: `Atari ${i + 1}`, game: ARCADE_GAMES[i], center: freeze([x, -33.55]),
    spots: freeze([spot(x, -32.6, Math.PI, [[AISLE_X, -31.6], [x, -31.6]])]),
  }))),
  lanes: freeze(LANE_X.map((x, i) => freeze({
    id: `lane${i + 1}`, name: `Kulvar ${i + 1}`, center: freeze([x, -13.6]), x, foulZ: -15.0, // center: atış yeri (menzil buna göre)
    stand: freeze([x, -13.6]), // atış yerinin ortası (oyuncu kamerası buradan güneye bakar)
    spots: freeze([
      spot(r2(x - 0.45), -13.4, Math.PI, [[r2(x - 0.45), -12.6]]),
      spot(r2(x + 0.45), -12.9, Math.PI, [[r2(x + 0.45), -12.6]]),
    ]),
  }))),
  lounge: freeze({ minX: 43.4, maxX: 46.6, minZ: -26.8, maxZ: -24.4 }),
});

export function isInsideBasement(x, z) {
  return x > B.minX + 0.05 && x < B.maxX - 0.05 && z > B.minZ + 0.05 && z < B.maxZ - 0.05;
}

/** Oyun türleri: istasyon listesi, menzil (merkeze), NPC ücreti (kişi başı, kasaya), etiket */
export const BASEMENT_GAMES = freeze({
  pool: freeze({ name: 'Bilardo', icon: '🎱', list: BASEMENT.pool, range: 2.6, npcFee: 6, seats: 2 }),
  foos: freeze({ name: 'Langırt', icon: '⚽', list: BASEMENT.foos, range: 1.9, npcFee: 3, seats: 2 }),
  pong: freeze({ name: 'Masa tenisi', icon: '🏓', list: BASEMENT.pong, range: 3.0, npcFee: 4, seats: 2 }),
  arcade: freeze({ name: 'Atari', icon: '🕹️', list: BASEMENT.arcade, range: 1.4, npcFee: 4, seats: 1 }),
  bowling: freeze({ name: 'Bowling', icon: '🎳', list: BASEMENT.lanes, range: 2.2, npcFee: 10, seats: 2 }),
});
export const BASEMENT_GAME_IDS = freeze(Object.keys(BASEMENT_GAMES));

/** Kurallar, fiyatlar, süreler */
export const BASEMENT_RULES = freeze({
  ARCADE_PRICE: 1, // € / jeton (oyuncunun cüzdanından, otel kasasına)
  LANE_PRICE: 8, // € / bowling oyunu (oyuncu başı, cüzdandan kasaya)
  VIP_MUL: 2, // VIP misafir ücreti çarpanı
  OPEN_MIN: 9 * 60, // NPC misafirler 09:00–23:00 arası iner (oyuncular her zaman oynar)
  CLOSE_MIN: 23 * 60,
  NPC_PLAY_MIN_MS: 45_000,
  NPC_PLAY_MAX_MS: 95_000,
  FIRST_SPAWN_MS: 12_000,
  SPAWN_MIN_MS: 25_000,
  SPAWN_MAX_MS: 60_000,
  RETRY_MS: 8_000,
  GUEST_MIN_LEFT_MIN: 90, // çıkışına bu kadar oyun dakikası kalan misafir aşağı iner
  GUEST_REPEAT_MIN: 240,
  MAX_NPC_SESSIONS: 6,
  LEAVE_DIST: 7, // masadan bu kadar uzaklaşan oyuncu maçtan çıkar
  PONG_TO: 7, // masa tenisi: 7 sayıya
  FOOS_TO: 5, // langırt: 5 gole
  BOWL_FRAMES: 5, // VIP hızlı oyun: 5 çerçeve (son çerçevede bonus atışlar)
  BOWL_MAX_PLAYERS: 4,
  AI_DELAY_MS: 1600, // bilgisayarın bilardo atışından önce düşünme süresi
  ARCADE_MAX_RUN_MS: 15 * 60_000,
  HIGH_SCORES: 5,
  RT_MAX: 16, // gerçek zamanlı paket: en fazla bu kadar sayı
});

/** Atari oyunları: en yüksek makul puan hızı (puan / sn) + taban — sunucu doğrulaması */
export const ARCADE_GAMES_DEF = freeze({
  snake: freeze({ name: 'Neon Yılan', icon: '🐍', rate: 12, base: 60 }),
  breakout: freeze({ name: 'Tuğla Kırıcı', icon: '🧱', rate: 60, base: 300 }),
  invaders: freeze({ name: 'Lale İstilası', icon: '👾', rate: 90, base: 400 }),
});

export const BASEMENT_NPC_NAMES = freeze([
  'Sanne', 'Daan', 'Lotte', 'Bram', 'Fenna', 'Joris', 'Ilse', 'Thijs', 'Noor', 'Ruben', 'Elif', 'Kerem', 'Zeynep', 'Mert',
]);

/** Bilgisayar rakip (bilardo, masa tenisi, langırt) */
export const AI_NAME = '🤖 Robo Ruud';

/** İstasyon (game, index) tanımı */
export function stationDef(game, i) {
  const g = BASEMENT_GAMES[game];
  return g && Number.isInteger(i) ? g.list[i] : undefined;
}

/** Oyuncu (x,z) bu istasyonun yanında mı (tol: ağ gecikmesi) */
export function nearStation(game, i, x, z, tol = 0) {
  const g = BASEMENT_GAMES[game];
  const st = stationDef(game, i);
  if (!st) return false;
  return Math.hypot(x - st.center[0], z - st.center[1]) <= g.range + (game === 'pool' ? 1.0 : 0) + tol;
}

// ---- Bowling skoru ----------------------------------------------------------------------------

/**
 * Atış listesinden çerçeve durumu (n çerçeve; sonuncu 10. çerçeve kurallarıyla).
 * @returns {{ done, frame, ball, reset, standing, total, cum: (number|null)[], frames: number[][] }}
 *   frame/ball: sıradaki atışın çerçevesi ve çerçeve içindeki sırası; reset: sıradaki atıştan önce
 *   10 labut dizilir mi; standing: sıradaki atışta ayakta kalması gereken labut sayısı.
 */
export function bowlingStatus(rolls, n = BASEMENT_RULES.BOWL_FRAMES) {
  const frames = [];
  let i = 0;
  let next = null;
  for (let f = 0; f < n; f++) {
    const last = f === n - 1;
    const a = rolls[i];
    const b = rolls[i + 1];
    const c = rolls[i + 2];
    if (a === undefined) {
      next ??= { frame: f, ball: 0, reset: true, standing: 10 };
      frames.push([]);
      break;
    }
    if (!last) {
      if (a === 10) {
        frames.push([10]);
        i += 1;
        continue;
      }
      if (b === undefined) {
        next ??= { frame: f, ball: 1, reset: false, standing: 10 - a };
        frames.push([a]);
        break;
      }
      frames.push([a, b]);
      i += 2;
      continue;
    }
    // Son çerçeve: strike / spare bonus atış hakkı verir
    if (b === undefined) {
      next ??= { frame: f, ball: 1, reset: a === 10, standing: a === 10 ? 10 : 10 - a };
      frames.push([a]);
      break;
    }
    const bonus = a === 10 || a + b === 10;
    if (bonus && c === undefined) {
      const reset = (a === 10 && b === 10) || (a !== 10 && a + b === 10);
      next ??= { frame: f, ball: 2, reset, standing: reset ? 10 : 10 - b };
      frames.push([a, b]);
      break;
    }
    frames.push(bonus ? [a, b, c] : [a, b]);
    i += bonus ? 3 : 2;
  }
  // Toplam (bonuslar bilinmiyorsa o çerçevenin puanı null)
  const cum = [];
  let total = 0;
  let k = 0;
  for (let f = 0; f < frames.length; f++) {
    const fr = frames[f];
    const last = f === n - 1;
    let score = null;
    if (last) {
      const need = fr[0] === 10 || fr[0] + (fr[1] ?? 0) === 10 ? 3 : 2;
      if (fr.length >= need) score = fr.reduce((s, v) => s + v, 0);
    } else if (fr[0] === 10) {
      const x = rolls[k + 1];
      const y = rolls[k + 2];
      if (x !== undefined && y !== undefined) score = 10 + x + y;
    } else if (fr.length === 2) {
      if (fr[0] + fr[1] === 10) {
        const x = rolls[k + 2];
        if (x !== undefined) score = 10 + x;
      } else score = fr[0] + fr[1];
    }
    k += fr.length;
    if (score === null) {
      cum.push(null);
      for (let g = f + 1; g < frames.length; g++) cum.push(null);
      break;
    }
    total += score;
    cum.push(total);
  }
  if (!next) return { done: true, frame: n, ball: 0, reset: true, standing: 10, total, cum, frames };
  return { done: false, ...next, total, cum, frames };
}

// ---- NPC rotaları -----------------------------------------------------------------------------

/** Bodrum asansöründen bir oyun yerine (tek bacak) */
export function basementRouteIn(sp) {
  return [BASEMENT.elevator.point, BASEMENT.hub, ...sp.via, sp.at];
}

/** Oyun yerinden bodrum asansörüne */
export function basementRouteOut(sp) {
  return [sp.at, ...[...sp.via].reverse(), BASEMENT.hub, BASEMENT.elevator.point];
}

/** Doluluk + yıldıza göre NPC gelme sıklığı çarpanı (küçük = daha sık) */
export function basementSpawnFactor(stars, occupancy) {
  return Math.max(0.45, 1.25 - 0.1 * stars - 0.5 * occupancy);
}

import * as THREE from 'three';
import { BASEMENT } from '/shared/basement.js';
import { POOL, BOWL, BOWL_PINS } from '/shared/basementPhysics.js';
import { StaticBatcher } from './StaticBatcher.js';
import { canvasTexture, rng, signMaterial, panel } from './CarWorldKit.js';

/**
 * −1. Kat VIP Eğlence Katı ("Neon Kelder") geometrisi + lobideki merdiven kapısı.
 * Fizik 2B olduğu için bodrum dünyanın ayrı bir köşesindedir (x 26..56, z −34..−10); "otelin altında" hissini
 * kapalı, alçak tavanlı, koyu renkli salon ve neon şeritler verir.
 *
 * Pil: statik her şey StaticBatcher ile malzeme başına tek mesh; neon şeritler ışıktan etkilenmeyen MeshBasic
 * (gerçek ışık eklenmez → shader yeniden derlenmez). Hareketli parçalar (bilardo topları, labutlar, langırt
 * çubukları, raketler) ayrı küçük mesh'lerdir ve yalnızca bir oyun / animasyon sürerken güncellenir.
 * Bodrum grubu yalnızca oyuncu oradayken görünür (UndergroundGarage alan yöneticisi).
 */

const B = BASEMENT.bounds;
const H = BASEMENT.ceiling;
const T = 0.25;
const flat = { cast: false, receive: false };

export const POOL_TOP = 0.8; // çuha yüksekliği
export const PONG_TOP = 0.76;
export const FOOS_TOP = 0.86;

const BALL_COLORS = ['#f8f6ee', '#f2c200', '#1747c9', '#d1271b', '#5b2a86', '#f07b16', '#1b8a3c', '#7a1a1a', '#111111',
  '#f2c200', '#1747c9', '#d1271b', '#5b2a86', '#f07b16', '#1b8a3c', '#7a1a1a'];

/** Neon desenli halı (arcade klasiği) */
function drawCarpet(g, w, h) {
  const r = rng(41);
  g.fillStyle = '#120a24';
  g.fillRect(0, 0, w, h);
  const cols = ['#ff2bd6', '#28e7ff', '#ffd23f', '#7cff4f', '#8a5bff'];
  g.lineWidth = 3;
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = cols[i % cols.length];
    g.globalAlpha = 0.32;
    const x = r() * w;
    const y = r() * h;
    const k = r();
    g.beginPath();
    if (k < 0.33) g.arc(x, y, 8 + r() * 14, r() * 6, r() * 6 + 2.5);
    else if (k < 0.66) { g.moveTo(x, y); g.lineTo(x + 18 - r() * 36, y + 18 - r() * 36); g.lineTo(x + 18 - r() * 36, y + 18 - r() * 36); }
    else { g.moveTo(x - 9, y); g.lineTo(x, y - 12); g.lineTo(x + 9, y); g.closePath(); }
    g.stroke();
  }
  g.globalAlpha = 1;
}

function drawWall(g, w, h) {
  const r = rng(9);
  g.fillStyle = '#1b1830';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.04})`;
    g.fillRect(r() * w, r() * h, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let y = 0; y < h; y += h / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
}

function drawLaneWood(g, w, h) {
  const r = rng(5);
  g.fillStyle = '#d8a86a';
  g.fillRect(0, 0, w, h);
  const boards = 13;
  for (let i = 0; i < boards; i++) {
    const v = Math.floor(r() * 30 - 15);
    g.fillStyle = `rgb(${216 + v},${168 + v},${106 + v / 2})`;
    g.fillRect((i * w) / boards, 0, w / boards - 1, h);
  }
  g.fillStyle = 'rgba(90,50,20,0.35)';
  for (let i = 0; i < boards; i++) g.fillRect((i * w) / boards - 0.5, 0, 1, h);
}

function drawCloth(color) {
  return (g, w, h) => {
    const r = rng(17);
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
      g.fillRect(r() * w, r() * h, 1, 1);
    }
  };
}

/** Bilardo topu dokusu: düz renk ya da parçalı bant + numara dairesi */
function ballTexture(id) {
  return canvasTexture(64, 32, (g, w, h) => {
    const c = BALL_COLORS[id];
    g.fillStyle = id >= 9 ? '#f8f6ee' : c;
    g.fillRect(0, 0, w, h);
    if (id >= 9) {
      g.fillStyle = c;
      g.fillRect(0, h * 0.28, w, h * 0.44);
    }
    if (id > 0) {
      for (const cx of [w * 0.25, w * 0.75]) {
        g.fillStyle = '#f8f6ee';
        g.beginPath();
        g.arc(cx, h / 2, h * 0.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#111';
        g.font = `bold ${Math.round(h * 0.28)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(id), cx, h / 2 + 1);
      }
    } else {
      g.fillStyle = '#d11';
      g.beginPath();
      g.arc(w * 0.25, h / 2, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }, { repeat: false });
}

function basementMaterials() {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const Bm = (o) => new THREE.MeshBasicMaterial(o);
  return {
    bCarpet: L({ map: canvasTexture(256, 256, drawCarpet), color: 0xb8b0c8, emissive: 0x100a20 }),
    bWall: L({ map: canvasTexture(128, 128, drawWall), emissive: 0x15122a }),
    bCeil: L({ color: 0x0c0a16, emissive: 0x06050c }),
    bWood: L({ color: 0x4a2a17, emissive: 0x1a0d06 }),
    bWoodLight: L({ color: 0x8a5a33, emissive: 0x24160b }),
    bLane: L({ map: canvasTexture(128, 256, drawLaneWood), emissive: 0x3a2a18 }),
    bClothG: L({ map: canvasTexture(128, 64, drawCloth('#11734a')), emissive: 0x06301c }),
    bClothB: L({ map: canvasTexture(128, 64, drawCloth('#1a4fa0')), emissive: 0x0a1e42 }),
    bPong: L({ color: 0x1d4f8f, emissive: 0x0b2142 }),
    bFoos: L({ color: 0x1e8a3c, emissive: 0x0b3a17 }),
    bWhite: L({ color: 0xf2f2f2, emissive: 0x505050 }),
    bBlack: L({ color: 0x0b0b0e }),
    bMetal: L({ color: 0x9aa3ab, emissive: 0x1c1f22 }),
    bGutter: L({ color: 0x2a2d33, emissive: 0x0d0e10 }),
    bSofa: L({ color: 0x5b1f6e, emissive: 0x220a2a }),
    bCab: L({ color: 0x1a1a2e, emissive: 0x0a0a14 }),
    bPit: Bm({ color: 0x050507 }),
    // Neon şeritler (ışıktan bağımsız parlak renk)
    nPink: Bm({ color: 0xff2bd6 }),
    nCyan: Bm({ color: 0x28e7ff }),
    nPurple: Bm({ color: 0x8a5bff }),
    nYellow: Bm({ color: 0xffd23f }),
    nLamp: Bm({ color: 0xfff4d6 }),
  };
}

export function buildBasement({ collision }) {
  const group = new THREE.Group();
  group.name = 'basement';
  const mats = basementMaterials();
  const b = new StaticBatcher();
  const box = (m, x0, x1, y0, y1, z0, z1, o = flat) => b.box(m, x0, x1, y0, y1, z0, z1, o);

  // ---- Zemin, tavan, duvarlar ---------------------------------------------------------------------
  b.floor('bCarpet', B.minX, B.maxX, B.minZ, B.maxZ, 0, { uvScale: 0.55, ...flat });
  b.floor('bCeil', B.minX, B.maxX, B.minZ, B.maxZ, H, { facingDown: true, ...flat });
  const wall = (x0, x1, z0, z1) => box('bWall', x0, x1, 0, H, z0, z1, { uvScale: 0.5, ...flat });
  wall(B.minX, B.maxX, B.maxZ - T, B.maxZ);
  wall(B.minX, B.maxX, B.minZ, B.minZ + T);
  wall(B.minX, B.minX + T, B.minZ, B.maxZ);
  wall(B.maxX - T, B.maxX, B.minZ, B.maxZ);
  collision.add(B.minX - 1, B.maxX + 1, B.maxZ - T, B.maxZ + 1);
  collision.add(B.minX - 1, B.maxX + 1, B.minZ - 1, B.minZ + T);
  collision.add(B.minX - 1, B.minX + T, B.minZ, B.maxZ);
  collision.add(B.maxX - T, B.maxX + 1, B.minZ, B.maxZ);
  // Neon şeritler: tavan kenarında pembe, süpürgelikte mor, salon ortasında camgöbeği çizgiler
  const ix0 = B.minX + T;
  const ix1 = B.maxX - T;
  const iz0 = B.minZ + T;
  const iz1 = B.maxZ - T;
  for (const [m, y0, y1] of [['nPink', H - 0.22, H - 0.17], ['nPurple', 0.08, 0.12]]) {
    box(m, ix0, ix1, y0, y1, iz1 - 0.02, iz1);
    box(m, ix0, ix1, y0, y1, iz0, iz0 + 0.02);
    box(m, ix0, ix0 + 0.02, y0, y1, iz0, iz1);
    box(m, ix1 - 0.02, ix1, y0, y1, iz0, iz1);
  }
  // Tavanda kısa neon tüpler (ızgara)
  for (const z of [-14.2, -21.2, -28.2]) for (let x = 28.5; x < 49; x += 4) box((x / 4) % 2 < 1 ? 'nCyan' : 'nPink', x, x + 1.6, H - 0.03, H - 0.01, z - 0.025, z + 0.025);
  box('nYellow', BASEMENT.aisleX - 0.04, BASEMENT.aisleX + 0.04, 0.004, 0.008, -31.8, -12.0); // koridor çizgisi (zeminde)

  // ---- Asansör ve merdiven (kuzey duvarı) ---------------------------------------------------------
  const E = BASEMENT.elevator;
  box('bMetal', E.x - 0.65, E.x + 0.65, 0, 2.3, iz1 - 0.04, iz1);
  box('bBlack', E.x - 0.015, E.x + 0.015, 0, 2.2, iz1 - 0.06, iz1 - 0.04);
  box('nCyan', E.x - 0.7, E.x + 0.7, 2.32, 2.36, iz1 - 0.06, iz1);
  const S = BASEMENT.stairs;
  box('bBlack', S.x - 0.7, S.x + 0.7, 0, 2.3, iz1 - 0.03, iz1); // merdiven boşluğu (karanlık)
  for (let k = 0; k < 6; k++) box('bWoodLight', S.x - 0.62, S.x + 0.62, 0.0 + k * 0.18, 0.04 + k * 0.18, iz1 - 0.06 - (5 - k) * 0.05, iz1 - 0.04); // basamak ağzı
  box('nPink', S.x - 0.75, S.x + 0.75, 2.32, 2.36, iz1 - 0.06, iz1);
  group.add(panel(signMaterial(['🛗 ASANSÖR', 'Lobi · Katlar'], { bg: '#0d1b2a', fg: '#9fe8ff', glow: true, w: 256, h: 96 }), 1.0, 0.38, E.x, 2.62, iz1 - 0.02, 'z-'));
  group.add(panel(signMaterial(['⬆ MERDİVEN', 'Lobiye çık'], { bg: '#2a0d24', fg: '#ff9be8', glow: true, w: 256, h: 96 }), 1.0, 0.38, S.x, 2.62, iz1 - 0.02, 'z-'));
  // Büyük neon tabela (kuzey duvarı, girişin karşısı) ve bölüm tabelaları
  group.add(panel(signMaterial(['NEON KELDER', '−1 · VIP EĞLENCE KATI'], { bg: '#0b0716', fg: '#ff4fe0', glow: true, w: 768, h: 192 }), 4.2, 1.05, 44, 2.45, iz1 - 0.02, 'z-'));
  group.add(panel(signMaterial(['🎱 BİLARDO'], { bg: '#071a12', fg: '#5dffb0', glow: true, w: 384, h: 96 }), 2.0, 0.5, ix0 + 0.02, 2.5, -20.5, 'x+'));
  group.add(panel(signMaterial(['⚽ LANGIRT'], { bg: '#0a1020', fg: '#7cc4ff', glow: true, w: 384, h: 96 }), 1.8, 0.45, 32, 2.5, iz0 + 0.02, 'z+'));
  group.add(panel(signMaterial(['🕹️ ARCADE'], { bg: '#1a0a20', fg: '#ffd23f', glow: true, w: 384, h: 96 }), 2.2, 0.55, 45.15, 2.75, iz0 + 0.02, 'z+'));
  group.add(panel(signMaterial(['🏓 MASA TENİSİ'], { bg: '#071420', fg: '#6fe3ff', glow: true, w: 384, h: 96 }), 1.9, 0.48, 45, 2.75, -16.0, 'z-'));

  // ---- Bilardo masaları ----------------------------------------------------------------------------
  const pool = BASEMENT.pool.map((t, ti) => {
    const [cx, cz] = t.center;
    const hx = t.outerL / 2;
    const hz = t.outerW / 2;
    const cloth = ti === 0 ? 'bClothG' : 'bClothB';
    box('bWood', cx - hx, cx + hx, 0.62, POOL_TOP - 0.01, cz - hz, cz + hz); // gövde
    b.floor(cloth, cx - t.L / 2 - 0.02, cx + t.L / 2 + 0.02, cz - t.W / 2 - 0.02, cz + t.W / 2 + 0.02, POOL_TOP, flat);
    // Bantlar (ahşap çerçeve + çuha bant)
    const rail = (x0, x1, z0, z1) => box('bWood', x0, x1, POOL_TOP, POOL_TOP + 0.045, z0, z1);
    rail(cx - hx, cx + hx, cz - hz, cz - t.W / 2 - 0.02);
    rail(cx - hx, cx + hx, cz + t.W / 2 + 0.02, cz + hz);
    rail(cx - hx, cx - t.L / 2 - 0.02, cz - t.W / 2 - 0.02, cz + t.W / 2 + 0.02);
    rail(cx + t.L / 2 + 0.02, cx + hx, cz - t.W / 2 - 0.02, cz + t.W / 2 + 0.02);
    for (const [px, pz] of [[0, 0], [0.5, -0.01], [1, 0], [0, 1], [0.5, 1.01], [1, 1]]) {
      b.add('bBlack', new THREE.CylinderGeometry(0.058, 0.058, 0.012, 14), { position: [cx - t.L / 2 + px * t.L, POOL_TOP + 0.002, cz - t.W / 2 + pz * t.W], ...flat });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('bWood', cx + sx * (hx - 0.18) - 0.07, cx + sx * (hx - 0.18) + 0.07, 0, 0.62, cz + sz * (hz - 0.15) - 0.07, cz + sz * (hz - 0.15) + 0.07);
    // Masa lambası (asılı, parlak)
    box('bBlack', cx - 0.9, cx + 0.9, H - 0.95, H - 0.85, cz - 0.18, cz + 0.18);
    box('nLamp', cx - 0.85, cx + 0.85, H - 0.96, H - 0.95, cz - 0.14, cz + 0.14);
    box('bMetal', cx - 0.01, cx + 0.01, H - 0.85, H, cz - 0.01, cz + 0.01);
    collision.add(cx - hx, cx + hx, cz - hz, cz + hz);
    // Toplar (dinamik)
    const balls = new Map();
    for (let id = 0; id < 16; id++) {
      const m = new THREE.Mesh(ballGeo(), ballMat(id));
      m.position.set(cx, POOL_TOP + POOL.R, cz);
      group.add(m);
      balls.set(id, m);
    }
    return { def: t, cx, cz, x0: cx - t.L / 2, z0: cz - t.W / 2, balls };
  });
  // Istaka rafı (batı duvarı)
  box('bWood', ix0, ix0 + 0.08, 0.3, 1.9, -21.2, -19.8);
  for (let k = 0; k < 6; k++) box('bWoodLight', ix0 + 0.08, ix0 + 0.1, 0.35, 1.85, -21.0 + k * 0.22, -20.98 + k * 0.22 + 0.025);

  // ---- Langırt masaları ------------------------------------------------------------------------------
  const foos = BASEMENT.foos.map((t) => {
    const [cx, cz] = t.center;
    // Kasa: saha zemininin altı + dört yan duvar (saha görünür kalsın)
    box('bCab', cx - 0.7, cx + 0.7, 0.55, FOOS_TOP - 0.065, cz - 0.42, cz + 0.42);
    box('bCab', cx - 0.7, cx + 0.7, FOOS_TOP - 0.065, FOOS_TOP, cz - 0.42, cz - 0.35);
    box('bCab', cx - 0.7, cx + 0.7, FOOS_TOP - 0.065, FOOS_TOP, cz + 0.35, cz + 0.42);
    box('bCab', cx - 0.7, cx - 0.66, FOOS_TOP - 0.065, FOOS_TOP, cz - 0.35, cz + 0.35);
    box('bCab', cx + 0.66, cx + 0.7, FOOS_TOP - 0.065, FOOS_TOP, cz - 0.35, cz + 0.35);
    b.floor('bFoos', cx - 0.6, cx + 0.6, cz - 0.35, cz + 0.35, FOOS_TOP - 0.06, flat);
    box('bWhite', cx - 0.004, cx + 0.004, FOOS_TOP - 0.059, FOOS_TOP - 0.057, cz - 0.35, cz + 0.35);
    for (const sx of [-1, 1]) {
      box('bBlack', cx + sx * 0.6, cx + sx * 0.66, FOOS_TOP - 0.06, FOOS_TOP, cz - 0.1, cz + 0.1); // kale ağzı
      for (const sz of [-1, 1]) box('bCab', cx + sx * 0.58 - 0.05, cx + sx * 0.58 + 0.05, 0, 0.55, cz + sz * 0.33 - 0.05, cz + sz * 0.33 + 0.05);
    }
    box('nCyan', cx - 0.7, cx + 0.7, FOOS_TOP, FOOS_TOP + 0.015, cz - 0.42, cz - 0.4);
    box('nCyan', cx - 0.7, cx + 0.7, FOOS_TOP, FOOS_TOP + 0.015, cz + 0.4, cz + 0.42);
    collision.add(cx - 0.72, cx + 0.72, cz - 0.6, cz + 0.6);
    return { def: t, cx, cz, rods: makeRods(group, cx, cz), ball: addBall(group, 0.017, 0xffffff, cx, FOOS_TOP - 0.043, cz) };
  });

  // ---- Masa tenisi -------------------------------------------------------------------------------------
  const pong = BASEMENT.pong.map((t) => {
    const [cx, cz] = t.center;
    const hx = t.L / 2;
    const hz = t.W / 2;
    box('bPong', cx - hx, cx + hx, PONG_TOP - 0.03, PONG_TOP, cz - hz, cz + hz);
    box('bWhite', cx - hx, cx + hx, PONG_TOP, PONG_TOP + 0.002, cz - hz, cz - hz + 0.02);
    box('bWhite', cx - hx, cx + hx, PONG_TOP, PONG_TOP + 0.002, cz + hz - 0.02, cz + hz);
    box('bWhite', cx - hx, cx - hx + 0.02, PONG_TOP, PONG_TOP + 0.002, cz - hz, cz + hz);
    box('bWhite', cx + hx - 0.02, cx + hx, PONG_TOP, PONG_TOP + 0.002, cz - hz, cz + hz);
    box('bWhite', cx - hx, cx + hx, PONG_TOP, PONG_TOP + 0.002, cz - 0.0015, cz + 0.0015);
    box('bBlack', cx - 0.006, cx + 0.006, PONG_TOP, PONG_TOP + 0.1525, cz - hz - 0.1, cz + hz + 0.1); // file
    box('bWhite', cx - 0.007, cx + 0.007, PONG_TOP + 0.14, PONG_TOP + 0.153, cz - hz - 0.1, cz + hz + 0.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('bMetal', cx + sx * (hx - 0.3) - 0.03, cx + sx * (hx - 0.3) + 0.03, 0, PONG_TOP - 0.03, cz + sz * (hz - 0.2) - 0.03, cz + sz * (hz - 0.2) + 0.03);
    collision.add(cx - hx, cx + hx, cz - hz, cz + hz);
    const paddle = (color) => {
      const g = new THREE.Group();
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 16).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color, emissive: 0x220000 }));
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.03), mats.bWoodLight);
      grip.position.y = -0.13;
      g.add(head, grip);
      g.position.set(cx, PONG_TOP + 0.2, cz);
      group.add(g);
      return g;
    };
    return {
      def: t, cx, cz, ball: addBall(group, 0.02, 0xff8a1e, cx, PONG_TOP + 0.3, cz),
      paddles: [paddle(0xd1271b), paddle(0x111111)],
    };
  });

  // ---- Lounge ------------------------------------------------------------------------------------------
  const Lg = BASEMENT.lounge;
  box('bSofa', Lg.minX, Lg.maxX, 0, 0.45, Lg.minZ + 1.6, Lg.maxZ);
  box('bSofa', Lg.minX, Lg.maxX, 0.45, 0.9, Lg.maxZ - 0.22, Lg.maxZ);
  box('bWood', Lg.minX + 0.8, Lg.maxX - 0.8, 0, 0.38, Lg.minZ + 0.4, Lg.minZ + 1.1);
  box('nPurple', Lg.minX, Lg.maxX, 0.02, 0.04, Lg.minZ + 1.58, Lg.minZ + 1.6);
  collision.add(Lg.minX, Lg.maxX, Lg.minZ + 0.35, Lg.maxZ);

  // ---- Atari makineleri --------------------------------------------------------------------------------
  const marquees = Object.create(null);
  const arcade = BASEMENT.arcade.map((m) => {
    const [x, z] = m.center;
    box('bCab', x - 0.38, x + 0.38, 0, 1.85, z - 0.3, z + 0.35);
    box('bCab', x - 0.38, x + 0.38, 0, 0.95, z + 0.35, z + 0.55); // kontrol paneli altı
    box('bBlack', x - 0.36, x + 0.36, 0.95, 1.0, z + 0.3, z + 0.58); // kontrol paneli
    box('nYellow', x - 0.39, x - 0.37, 0, 1.85, z + 0.3, z + 0.36);
    box('nYellow', x + 0.37, x + 0.39, 0, 1.85, z + 0.3, z + 0.36);
    marquees[m.game] ??= signMaterial([GAME_TITLE[m.game]], { bg: '#12021e', fg: '#ffd23f', glow: true, w: 256, h: 64, border: false });
    group.add(panel(marquees[m.game], 0.7, 0.18, x, 1.74, z + 0.36, 'z+'));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.44), null);
    screen.position.set(x, 1.32, z + 0.37);
    screen.rotation.x = -0.12;
    group.add(screen);
    collision.add(x - 0.4, x + 0.4, z - 0.32, z + 0.58);
    return { def: m, screen };
  });

  // ---- Bowling kulvarları ------------------------------------------------------------------------------
  const lanes = BASEMENT.lanes.map((l, li) => {
    const x = l.x;
    const half = BOWL.LANE_W / 2;
    const fz = l.foulZ;
    const zPin = fz - BOWL.HEAD_V;
    const zDeck = fz - BOWL.DECK_END;
    // Kulvar zemini (faul çizgisinden labut alanının sonuna) + yaklaşma alanı
    b.add('bLane', new THREE.PlaneGeometry(BOWL.LANE_W, fz - zDeck).rotateX(-Math.PI / 2), { position: [x, 0.01, (fz + zDeck) / 2], ...flat });
    b.add('bLane', new THREE.PlaneGeometry(BOWL.LANE_W + 0.48, 3.5).rotateX(-Math.PI / 2), { position: [x, 0.012, fz + 1.75], ...flat });
    box('nPink', x - half - 0.24, x + half + 0.24, 0.013, 0.016, fz - 0.02, fz + 0.02); // faul çizgisi
    // Oklar ve noktalar
    for (let k = -2; k <= 2; k++) {
      b.add('bWood', new THREE.ConeGeometry(0.035, 0.16, 3).rotateX(-Math.PI / 2), { position: [x + k * 0.13, 0.014, fz - 4.6 - Math.abs(k) * 0.3], ...flat });
    }
    // Oluklar (koyu) + kenarlar
    for (const s of [-1, 1]) {
      box('bGutter', x + s * half + (s < 0 ? -0.24 : 0), x + s * half + (s > 0 ? 0.24 : 0), -0.0, 0.006, zDeck, fz);
      box('bMetal', x + s * (half + 0.24) - 0.03, x + s * (half + 0.24) + 0.03, 0, 0.12, zDeck - 2.0, fz);
    }
    // Çukur ve maske (labutların üstünde neon şerit + numara)
    box('bPit', x - half - 0.24, x + half + 0.24, 0.0, 0.004, B.minZ + T, zDeck);
    box('bCab', x - half - 0.3, x + half + 0.3, 1.0, H, zDeck - 0.5, zDeck - 0.3);
    box(li ? 'nCyan' : 'nPink', x - half - 0.3, x + half + 0.3, 0.98, 1.02, zDeck - 0.32, zDeck - 0.28);
    group.add(panel(signMaterial([`🎳 ${li + 1}`], { bg: '#0b0716', fg: li ? '#7ff3ff' : '#ff8ae8', glow: true, w: 256, h: 96, border: false }), 0.9, 0.34, x, 1.5, zDeck - 0.29, 'z+'));
    // Labutlar (dinamik)
    const pins = BOWL_PINS.map(([u, v]) => {
      const m = new THREE.Mesh(pinGeo(), pinMat());
      m.position.set(x + u, 0, fz - v);
      group.add(m);
      return m;
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BOWL.BALL_R, 16, 12), new THREE.MeshLambertMaterial({ color: li ? 0x1e7bff : 0xff2bd6, emissive: li ? 0x061a44 : 0x440a3a }));
    ball.position.set(x + 0.4, BOWL.BALL_R + 0.75, fz + 1.4);
    ball.visible = false;
    group.add(ball);
    // Skor ekranı (atış yerinin üstünde, tavandan asılı; durum değişince yeniden çizilir)
    const sc = document.createElement('canvas');
    sc.width = 512;
    sc.height = 192;
    const stex = new THREE.CanvasTexture(sc);
    stex.colorSpace = THREE.SRGBColorSpace;
    const screen = panel(new THREE.MeshBasicMaterial({ map: stex }), 1.5, 0.56, x, 2.55, fz + 0.6, 'z+');
    group.add(screen);
    box('bBlack', x - 0.8, x + 0.8, 2.24, 2.86, fz + 0.54, fz + 0.58);
    return { def: l, x, fz, pins, ball, score: { canvas: sc, tex: stex } };
  });
  // Ayırıcı / top dönüşü (kulvarlar arası) ve doğu duvarı yanı
  const midX = (BASEMENT.lanes[0].x + BASEMENT.lanes[1].x) / 2;
  box('bCab', midX - 0.42, midX + 0.42, 0, 0.35, B.minZ + T, BASEMENT.lanes[0].foulZ + 0.2);
  for (const s of [-1, 1]) box('nPurple', midX + s * 0.42 - 0.02, midX + s * 0.42 + 0.02, 0.35, 0.37, B.minZ + T, BASEMENT.lanes[0].foulZ + 0.2);
  box('bMetal', midX - 0.3, midX + 0.3, 0, 0.75, -12.2, -11.6); // top dönüş makinesi (atış yerinin arkasında)
  box('nCyan', midX - 0.3, midX + 0.3, 0.75, 0.78, -12.2, -11.6);
  collision.add(BASEMENT.lanes[0].x - 0.9, B.maxX, B.minZ, BASEMENT.lanes[0].foulZ - 0.1);
  collision.add(midX - 0.32, midX + 0.32, -12.22, -11.58);
  group.add(panel(signMaterial(['🎳 VIP BOWLING'], { bg: '#160622', fg: '#ff7ae6', glow: true, w: 512, h: 96 }), 2.6, 0.5, 52.65, 3.0, iz1 - 0.02, 'z-'));

  const meshes = b.build(mats, group);
  for (const m of meshes) {
    m.castShadow = false;
    m.receiveShadow = false;
  }
  return { group, mats, pool, foos, pong, arcade, lanes };
}

const GAME_TITLE = { snake: '🐍 NEON YILAN', breakout: '🧱 TUĞLA KIRICI', invaders: '👾 LALE İSTİLASI' };

let _ballGeo = null;
const ballGeo = () => (_ballGeo ??= new THREE.SphereGeometry(POOL.R, 14, 10));
const _ballMats = [];
function ballMat(id) {
  return (_ballMats[id] ??= new THREE.MeshLambertMaterial({ map: ballTexture(id), emissive: 0x202020 }));
}

let _pinGeo = null;
function pinGeo() {
  if (_pinGeo) return _pinGeo;
  const pts = [[0.0, 0], [0.03, 0], [0.045, 0.04], [0.06, 0.11], [0.058, 0.16], [0.04, 0.22], [0.03, 0.27], [0.034, 0.31], [0.032, 0.35], [0.02, 0.38], [0, 0.385]];
  _pinGeo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 12);
  return _pinGeo;
}
let _pinMat = null;
function pinMat() {
  if (_pinMat) return _pinMat;
  const tex = canvasTexture(8, 64, (g, w, h) => {
    g.fillStyle = '#f6f4ef';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d11f2a';
    g.fillRect(0, h * 0.18, w, h * 0.05);
    g.fillRect(0, h * 0.26, w, h * 0.05);
  }, { repeat: false });
  tex.flipY = false;
  _pinMat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a2a2a });
  return _pinMat;
}

function addBall(group, r, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshLambertMaterial({ color, emissive: color === 0xffffff ? 0x444444 : 0x552200 }));
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

/**
 * Langırt çubukları (yerel x: +0.525 … −0.525). seat 0 (güney) +X kalesini savunur.
 * Sıra: kaleci0, defans0, forvet1, orta0, orta1, forvet0, defans1, kaleci1.
 */
export const FOOS_RODS = Object.freeze([
  { x: 0.525, owner: 0, n: 1, sp: 0, range: 0.11 },
  { x: 0.375, owner: 0, n: 2, sp: 0.24, range: 0.12 },
  { x: 0.225, owner: 1, n: 3, sp: 0.2, range: 0.1 },
  { x: 0.075, owner: 0, n: 5, sp: 0.12, range: 0.055 },
  { x: -0.075, owner: 1, n: 5, sp: 0.12, range: 0.055 },
  { x: -0.225, owner: 0, n: 3, sp: 0.2, range: 0.1 },
  { x: -0.375, owner: 1, n: 2, sp: 0.24, range: 0.12 },
  { x: -0.525, owner: 1, n: 1, sp: 0, range: 0.11 },
]);

function makeRods(group, cx, cz) {
  const rodMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2, emissive: 0x222222 });
  const figMats = [new THREE.MeshLambertMaterial({ color: 0xd1271b, emissive: 0x330000 }), new THREE.MeshLambertMaterial({ color: 0x1747c9, emissive: 0x000a33 })];
  const rodGeo = new THREE.CylinderGeometry(0.008, 0.008, 1.05, 6).rotateX(Math.PI / 2);
  const figGeo = new THREE.BoxGeometry(0.022, 0.09, 0.03).translate(0, -0.025, 0);
  const markGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.07, 10).rotateX(Math.PI / 2);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  return FOOS_RODS.map((r) => {
    const g = new THREE.Group();
    g.position.set(cx + r.x, FOOS_TOP + 0.01, cz);
    g.add(new THREE.Mesh(rodGeo, rodMat));
    for (let k = 0; k < r.n; k++) {
      const f = new THREE.Mesh(figGeo, figMats[r.owner]);
      f.position.z = (k - (r.n - 1) / 2) * r.sp;
      g.add(f);
    }
    // Seçili çubuk işareti: sahibinin tarafındaki tutamakta neon halka (FoosGame açar / kapatır)
    const mark = new THREE.Mesh(markGeo, markMat);
    mark.position.z = r.owner === 0 ? -0.47 : 0.47;
    mark.visible = false;
    g.add(mark);
    g.userData.mark = mark;
    group.add(g);
    return g;
  });
}

import * as THREE from 'three';
import { WALL_H, DOOR_H, CASINO } from '/shared/layout.js';
import { CASINO_TABLES } from '/shared/casino.js';
import { UV } from './Materials.js';
import { makeCharacter } from '../game/Characters.js';

// Yeraltı Kart Kulübü: barın kuzeyindeki eski avluya kurulmuş gizli, loş bir oda.
// Steeg'deki tabelasız koyu kapıdan girilir (önünde bir fedai, kapının yanında küçük pirinç "♣" levha).
// İçeride koyu ahşap zemin, bordo damask duvarlar, yeşil çuha masalar (blackjack yarım ay,
// oval poker, ayakta zar masası), sarkıt lambalar, şişe rafı, kırmızı kadife perdeler.
// Statik her şey otelin StaticBatcher'ına eklenir; yeni malzemeler:
//  - casinoColor: köşe renkli (vertex color) TEK malzeme → mobilya, çuha, perde, şişe… tek draw call
//  - casinoWall / casinoFloor / casinoCeil: duvar, zemin, tavan (tavan gölge atar → oda loş kalır)
//  - casinoGlow: lambaların altındaki ışık konisi (additive, ucuz; gerçek ışık kaynağı yok)
// Dinamik olan yalnızca kapı kanadı (yaklaşınca açılır) — UndergroundCasino sistemi oynatır.

const _c = new THREE.Color();

/** Geometriye tek renkli köşe rengi ekler (casinoColor malzemesi için) */
function tint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Bordo damask duvar kâğıdı: ince altın kafes, her baklavanın ortasında dört yapraklı süs */
function drawDamask(ctx, w, h) {
  ctx.fillStyle = '#5a1a1e';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let x = 0; x < w; x += w / 16) ctx.fillRect(x, 0, w / 32, h);
  const n = 4;
  const cell = w / n;
  ctx.strokeStyle = 'rgba(214,170,92,0.22)';
  ctx.lineWidth = Math.max(1, w / 200);
  ctx.beginPath();
  for (let i = -n; i <= n * 2; i++) {
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell + h, h);
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell - h, h);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(214,170,92,0.3)';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = x * cell + cell / 2;
      const cy = y * cell + cell / 2;
      const r = cell * 0.09;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx * r, cy + dy * r, r * (dx ? 1 : 0.55), r * (dy ? 1 : 0.55), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Steeg tarafındaki küçük pirinç levha: yalnızca "♣" */
function plateMaterial() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 160;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 128, 160);
  g.addColorStop(0, '#e3c27a');
  g.addColorStop(0.5, '#b38a3e');
  g.addColorStop(1, '#d9b468');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 160);
  ctx.strokeStyle = '#6b4f1f';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 116, 148);
  ctx.fillStyle = '#2b1e0b';
  ctx.font = '700 104px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♣', 64, 86);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: tex });
}

const FELT = '#1f6b3f';
const FELT_DARK = '#17542f';
const RIM = '#3b2216';
const WOOD_DARK = '#2e1a10';
const VELVET = '#7d1020';
const VELVET_DARK = '#5a0b17';
const BRASS = '#c9a25e';
const LEATHER = '#6e1a1c';

/**
 * @returns {{ door: { pivot, t }, setDoor(t), doorCenter: [x, z] }}
 */
export function buildCasino({ batcher: b, collision, scene, mats, factory }) {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const B = (o) => new THREE.MeshBasicMaterial(o);
  Object.assign(mats, {
    casinoColor: L({ vertexColors: true }),
    casinoWall: L({ map: factory.make(drawDamask, { seed: 71, w: 1, h: 1, minSize: 128 }) }),
    casinoFloor: L({ map: mats.wood.map, color: 0x6e4a33 }),
    casinoCeil: B({ color: 0x1b1310 }),
    casinoGlow: B({ color: 0xffc77a, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  });

  const { minX, maxX, minZ, maxZ } = CASINO.bounds; // 8.2..16, 14.1..25.9
  const IN = { x0: 8.1, x1: 15.9, z0: minZ, z1: maxZ }; // duvarların iç yüzleri
  const D = CASINO.door;
  const flat = { cast: false };
  const noShadow = { cast: false, receive: false };

  const paint = (hex, geo, o = {}) => b.add('casinoColor', tint(geo, hex), o);
  const vbox = (hex, x0, x1, y0, y1, z0, z1, o = {}) => paint(hex, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), {
    ...o, position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  });
  const cyl = (hex, rTop, rBot, h, x, y, z, seg = 12, o = {}) => paint(hex, new THREE.CylinderGeometry(rTop, rBot, h, seg), { ...o, position: [x, y + h / 2, z] });

  // ---- Kabuk: zemin, tavan, duvar kaplamaları ---------------------------------------
  b.floor('casinoFloor', IN.x0, 16.05, IN.z0, IN.z1, 0, { uvScale: UV.floorRoom * 1.4 });
  // Tavan gölge atar: güneş içeri girmez, oda gerçekten loş kalır
  b.floor('casinoCeil', IN.x0, IN.x1 + 0.1, IN.z0, IN.z1, WALL_H, { facingDown: true, cast: true, receive: false });
  for (const z of [16.4, 19.2, 22.0, 24.8]) vbox(WOOD_DARK, IN.x0, IN.x1, WALL_H - 0.18, WALL_H, z - 0.08, z + 0.08, flat);

  const wall = { uvScale: 0.55, cast: false };
  const wain = (x0, x1, z0, z1) => {
    vbox(WOOD_DARK, x0, x1, 0, 0.95, z0, z1, flat);
  };
  // Güney (barın kuzey duvarı), kuzey, batı (otelin doğu duvarı)
  b.box('casinoWall', IN.x0, IN.x1, 0, WALL_H, IN.z0, IN.z0 + 0.03, wall);
  b.box('casinoWall', IN.x0, IN.x1, 0, WALL_H, IN.z1 - 0.03, IN.z1, wall);
  b.box('casinoWall', IN.x0, IN.x0 + 0.03, 0, WALL_H, IN.z0, IN.z1, wall);
  wain(IN.x0, IN.x1, IN.z0, IN.z0 + 0.06);
  wain(IN.x0, IN.x1, IN.z1 - 0.06, IN.z1);
  wain(IN.x0, IN.x0 + 0.06, IN.z0, IN.z1);
  // Doğu (steeg duvarı, kapı boşluklu)
  b.box('casinoWall', IN.x1 - 0.03, IN.x1, 0, WALL_H, IN.z0, D.from, wall);
  b.box('casinoWall', IN.x1 - 0.03, IN.x1, 0, WALL_H, D.to, IN.z1, wall);
  b.box('casinoWall', IN.x1 - 0.03, IN.x1, DOOR_H, WALL_H, D.from, D.to, wall);
  wain(IN.x1 - 0.06, IN.x1, IN.z0, D.from - 0.1);
  wain(IN.x1 - 0.06, IN.x1, D.to + 0.1, IN.z1);
  // Lambri üstünde pirinç çıta
  for (const [x0, x1, z0, z1] of [[IN.x0, IN.x1, IN.z0, IN.z0 + 0.07], [IN.x0, IN.x1, IN.z1 - 0.07, IN.z1], [IN.x0, IN.x0 + 0.07, IN.z0, IN.z1]]) {
    vbox(BRASS, x0, x1, 0.95, 0.98, z0, z1, flat);
  }

  // ---- Kapı: iki yüzde kasa, eşik, kanat (dinamik) ----------------------------------
  vbox(WOOD_DARK, 15.88, 16.14, 0, DOOR_H + 0.08, D.from - 0.08, D.from, flat);
  vbox(WOOD_DARK, 15.88, 16.14, 0, DOOR_H + 0.08, D.to, D.to + 0.08, flat);
  vbox(WOOD_DARK, 15.88, 16.14, DOOR_H, DOOR_H + 0.08, D.from - 0.08, D.to + 0.08, flat);
  vbox('#3a3530', 15.9, 16.12, 0, 0.012, D.from, D.to, flat);
  // İçeride kapının iki yanında kırmızı kadife perde ve pelmet
  drape(15.78, D.from - 0.55, D.from - 0.05, 'x');
  drape(15.78, D.to + 0.05, D.to + 0.55, 'x');
  vbox(VELVET_DARK, 15.7, 15.88, DOOR_H + 0.1, DOOR_H + 0.42, D.from - 0.65, D.to + 0.65, flat);
  vbox(BRASS, 15.68, 15.7, DOOR_H + 0.1, DOOR_H + 0.13, D.from - 0.65, D.to + 0.65, flat);

  // Steeg tarafı: pirinç "♣" levha ve küçük bir lamba (kapının üstünde, loş)
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18), plateMaterial());
  plate.position.set(16.115, 1.55, D.to + 0.22);
  plate.rotation.y = Math.PI / 2;
  plate.matrixAutoUpdate = false;
  plate.updateMatrix();
  scene.add(plate);
  b.add('metal', new THREE.CylinderGeometry(0.05, 0.08, 0.1, 10), { cast: false, position: [16.2, DOOR_H + 0.35, (D.from + D.to) / 2] });
  b.add('lamp', new THREE.SphereGeometry(0.045, 8, 6), { ...noShadow, position: [16.2, DOOR_H + 0.28, (D.from + D.to) / 2] });

  const leafMat = L({ color: 0x2a211c });
  const pivot = new THREE.Group();
  pivot.position.set(16.0, 0, D.from);
  const leafW = D.to - D.from - 0.02;
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, DOOR_H - 0.02, leafW), leafMat);
  leaf.position.set(0, (DOOR_H - 0.02) / 2, leafW / 2 + 0.01);
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.04), mats.brass);
  knob.position.set(0, 1.02, leafW - 0.1);
  // Göz hizasında sürgülü gözetleme deliği (steeg tarafı)
  const peep = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.2), mats.brass);
  peep.position.set(0.02, 1.62, leafW / 2);
  pivot.add(leaf, knob, peep);
  scene.add(pivot);
  const door = { pivot, t: 0 };
  const setDoor = (t) => {
    door.t = t;
    pivot.rotation.y = -1.45 * t; // içeri (−x) doğru açılır
  };

  // Fedai: kapının önünde, koyu takım elbise, şapka; yoldan geçeni süzer
  const bouncer = makeCharacter({ skin: 3, hat: true }, { color: '#16171b' });
  bouncer.position.set(16.5, 0, D.to + 1.05);
  bouncer.rotation.y = Math.PI * 0.75;
  freeze(bouncer);
  scene.add(bouncer);
  collision.addAround(16.5, D.to + 1.05, 0.24);

  // ---- Masalar ------------------------------------------------------------------------
  buildBlackjack();
  buildPoker();
  buildDice();
  buildBarShelf();
  buildLounge();
  buildLamps();

  function chair(x, z, yaw) {
    // Masadan biraz geride, arkalıklı koyu deri sandalye (çarpışmasız: oyuncu koltuğa ışınlanır)
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const cx = x + dx * 0.32; // masaya bakan oyuncunun arkası
    const cz = z + dz * 0.32;
    cyl(WOOD_DARK, 0.03, 0.035, 0.45, cx, 0, cz, 6);
    cyl(LEATHER, 0.22, 0.2, 0.08, cx, 0.45, cz, 14);
    const back = new THREE.BoxGeometry(0.4, 0.42, 0.06);
    back.rotateY(yaw);
    paint(LEATHER, back, { position: [cx + dx * 0.2, 0.74, cz + dz * 0.2] });
  }

  function buildBlackjack() {
    const T = CASINO_TABLES.bj;
    const [cx] = T.center;
    const cz = 16.5; // düz kenar (krupiye tarafı)
    const half = (r, h, y, hex) => paint(hex, new THREE.CylinderGeometry(r, r, h, 28, 1, false, -Math.PI / 2, Math.PI), { position: [cx, y + h / 2, cz] });
    half(1.24, 0.07, 0.72, RIM);
    half(1.15, 0.03, 0.775, FELT);
    // Çuhada yarım ay çizgisi ve oyuncu kutuları
    paint('#d8c07a', new THREE.TorusGeometry(0.78, 0.006, 3, 32, Math.PI), { ...flat, position: [cx, 0.807, cz], rotation: [-Math.PI / 2, 0, 0] });
    for (const s of T.seats) {
      const a = Math.atan2(s.x - cx, s.z - cz);
      const bx = cx + Math.sin(a) * 0.92;
      const bz = cz + Math.cos(a) * 0.92;
      const g = new THREE.BoxGeometry(0.2, 0.004, 0.14);
      g.rotateY(a);
      paint('#2a7f4c', g, { ...flat, position: [bx, 0.806, bz] });
      chair(s.x, s.z, Math.atan2(s.x - cx, s.z - cz));
    }
    vbox(WOOD_DARK, cx - 0.9, cx + 0.9, 0, 0.72, cz, cz + 0.55);
    // Krupiye tarafı: fiş rafı ve kart ayakkabısı
    vbox('#1d1d1f', cx - 0.32, cx + 0.32, 0.805, 0.85, cz + 0.05, cz + 0.22, flat);
    const chipCols = ['#d7263d', '#2b5ea7', '#1f8a4c', '#f2efe8', '#151515', '#d9a441'];
    chipCols.forEach((hex, i) => vbox(hex, cx - 0.3 + i * 0.1, cx - 0.22 + i * 0.1, 0.85, 0.87, cz + 0.07, cz + 0.2, flat));
    vbox('#4b2a1a', cx + 0.5, cx + 0.72, 0.805, 0.9, cz + 0.06, cz + 0.2, flat);
    collision.add(cx - 0.8, cx + 0.8, cz - 0.05, cz + 1.05);
    collision.add(cx - 1.1, cx + 1.1, cz - 0.05, cz + 0.6);
    // Krupiye
    const dealer = makeCharacter({ skin: 0, hair: 0 }, { color: '#151518', staff: true });
    dealer.position.set(T.dealer[0], 0, T.dealer[1]);
    freeze(dealer);
    scene.add(dealer);
    collision.addAround(T.dealer[0], T.dealer[1], 0.24);
  }

  function buildPoker() {
    const T = CASINO_TABLES.poker;
    const [cx, cz] = T.center;
    paint(RIM, new THREE.CylinderGeometry(1, 1, 0.07, 32), { position: [cx, 0.755, cz], scale: [1.38, 1, 0.82] });
    paint(FELT, new THREE.CylinderGeometry(1, 1, 0.03, 32), { position: [cx, 0.79, cz], scale: [1.27, 1, 0.72] });
    paint(FELT_DARK, new THREE.TorusGeometry(0.62, 0.006, 3, 40), { ...flat, position: [cx, 0.806, cz], rotation: [-Math.PI / 2, 0, 0], scale: [1.6, 1.15, 1] });
    cyl(WOOD_DARK, 0.18, 0.4, 0.72, cx, 0, cz, 14);
    for (const s of T.seats) chair(s.x, s.z, Math.atan2(s.x - cx, s.z - cz));
    collision.add(cx - 1.2, cx + 1.2, cz - 0.65, cz + 0.65);
    b.floor('rugRed', cx - 2.3, cx + 2.3, cz - 1.9, cz + 1.9, 0.006, { cast: false });
  }

  function buildDice() {
    const T = CASINO_TABLES.dice;
    const [cx, cz] = T.center;
    cyl(RIM, 0.56, 0.56, 0.09, cx, 0.9, cz, 24);
    cyl('#7a1626', 0.48, 0.48, 0.02, cx, 0.985, cz, 24);
    cyl(WOOD_DARK, 0.06, 0.08, 0.9, cx, 0, cz, 8);
    cyl(WOOD_DARK, 0.3, 0.32, 0.04, cx, 0, cz, 14);
    // İki fildişi zar ve deri zar kabı
    vbox('#f4efe2', cx - 0.06, cx - 0.01, 1.005, 1.055, cz - 0.03, cz + 0.02, flat);
    vbox('#f4efe2', cx + 0.04, cx + 0.09, 1.005, 1.055, cz + 0.02, cz + 0.07, flat);
    cyl(LEATHER, 0.05, 0.045, 0.12, cx - 0.22, 1.005, cz + 0.14, 10);
    collision.addAround(cx, cz, 0.5);
  }

  function buildBarShelf() {
    // Batı duvarında şişe rafı + alçak dolap (şişeler meyve şurubu / soda: alkol etiketi yok)
    const z0 = 19.6;
    const z1 = 25.3;
    const x0 = IN.x0 + 0.03;
    vbox(WOOD_DARK, x0, x0 + 0.5, 0, 0.92, z0, z1);
    vbox('#4a2b1a', x0, x0 + 0.56, 0.92, 0.97, z0 - 0.03, z1 + 0.03, flat);
    vbox('#22262b', x0, x0 + 0.02, 1.1, 2.6, z0 + 0.1, z1 - 0.1, flat); // arka ayna (koyu)
    const cols = ['#e23a4e', '#f2df4a', '#f39a2b', '#7cbf3a', '#7a2e6e', '#dff1f6', '#c43c2c', '#8a4b1a'];
    let k = 0;
    for (const y of [1.3, 1.85, 2.4]) {
      vbox('#4a2b1a', x0, x0 + 0.3, y - 0.03, y, z0 + 0.1, z1 - 0.1, flat);
      for (let z = z0 + 0.3; z < z1 - 0.25; z += 0.24) {
        const hex = cols[k++ % cols.length];
        const h = 0.22 + ((k * 7) % 5) * 0.02;
        cyl(hex, 0.035, 0.045, h, x0 + 0.16, y, z, 7, flat);
        cyl('#2a2a2a', 0.016, 0.02, 0.05, x0 + 0.16, y + h, z, 5, flat);
      }
    }
    collision.add(IN.x0, x0 + 0.6, z0 - 0.05, z1 + 0.05);
    // Rafın yanlarında perdeler
    drape(IN.x0 + 0.12, z0 - 0.75, z0 - 0.15, 'z');
    drape(IN.x0 + 0.12, 15.0, 15.7, 'z');
  }

  function buildLounge() {
    // Kuzey duvarında chesterfield kanepe + sehpa; köşelerde perde
    const x0 = 13.9;
    const x1 = 15.7;
    const z1 = IN.z1 - 0.05;
    vbox(LEATHER, x0, x1, 0.1, 0.45, z1 - 0.75, z1);
    vbox('#5a1416', x0, x1, 0.45, 0.95, z1 - 0.2, z1);
    vbox('#5a1416', x0 - 0.05, x0 + 0.15, 0.45, 0.7, z1 - 0.75, z1);
    vbox('#5a1416', x1 - 0.15, x1 + 0.05, 0.45, 0.7, z1 - 0.75, z1);
    for (let x = x0 + 0.25; x < x1 - 0.2; x += 0.3) cyl('#3a0c0e', 0.012, 0.012, 0.01, x, 0.7, z1 - 0.2, 5, flat);
    collision.add(x0 - 0.05, x1 + 0.05, z1 - 0.78, z1);
    cyl(WOOD_DARK, 0.3, 0.3, 0.04, 14.8, 0.48, 24.35, 16);
    cyl(WOOD_DARK, 0.04, 0.05, 0.48, 14.8, 0, 24.35, 6);
    collision.addAround(14.8, 24.35, 0.3);
    drape(9.0, IN.z1 - 0.12, 9.7, 'xz');
    drape(13.2, IN.z1 - 0.12, 13.8, 'xz');
    // Kuzey duvarında altın çerçeveli tablo
    vbox('#a8823e', 11.0, 13.0, 1.35, 2.45, IN.z1 - 0.06, IN.z1 - 0.03, flat);
    b.add('painting', new THREE.PlaneGeometry(1.84, 0.94), { cast: false, position: [12.0, 1.9, IN.z1 - 0.065], rotation: [0, Math.PI, 0] });
    // Güney duvarında (krupiyenin arkası) aplikler ve tablo
    vbox('#a8823e', 13.0, 14.0, 1.4, 2.2, IN.z0 + 0.03, IN.z0 + 0.06, flat);
    b.add('painting', new THREE.PlaneGeometry(0.88, 0.68), { cast: false, position: [13.5, 1.8, IN.z0 + 0.065] });
    drape(9.0, IN.z0 + 0.12, 9.6, 'xz');
  }

  /**
   * Kadife perde: dikey kıvrımlar. axis 'x' → doğu/batı duvarında (z0..z1 boyunca, x sabit);
   * 'z' aynısı; 'xz' → kuzey/güney duvarında (x0 = a, z = b, x1 = c).
   */
  function drape(a, b0, c, axis) {
    const top = WALL_H - 0.2;
    if (axis === 'xz') {
      const z = b0;
      for (let x = a; x < c; x += 0.12) cyl(VELVET, 0.07, 0.08, top, x + 0.06, 0, z, 7, flat);
      vbox(BRASS, a - 0.05, c + 0.05, top, top + 0.03, z - 0.02, z + 0.02, flat);
      return;
    }
    for (let z = b0; z < c; z += 0.12) cyl(VELVET, 0.07, 0.08, top, a, 0, z + 0.06, 7, flat);
    vbox(BRASS, a - 0.02, a + 0.02, top, top + 0.03, b0 - 0.05, c + 0.05, flat);
  }

  function buildLamps() {
    const pendant = (x, z, len = 1.15) => {
      b.add('black', new THREE.CylinderGeometry(0.006, 0.006, len, 4), { cast: false, position: [x, WALL_H - len / 2, z] });
      paint('#173c26', new THREE.CylinderGeometry(0.07, 0.26, 0.2, 18, 1, true), { ...flat, position: [x, WALL_H - len - 0.08, z] });
      paint(BRASS, new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8), { ...flat, position: [x, WALL_H - len + 0.02, z] });
      b.add('lamp', new THREE.CircleGeometry(0.255, 18), { ...noShadow, position: [x, WALL_H - len - 0.175, z], rotation: [Math.PI / 2, 0, 0] });
      // Masaya düşen sıcak ışık konisi (tek additive malzeme)
      const coneH = WALL_H - len - 0.18 - 0.8;
      b.add('casinoGlow', new THREE.CylinderGeometry(0.25, 0.6, coneH, 18, 1, true), { ...noShadow, position: [x, 0.8 + coneH / 2, z] });
    };
    pendant(CASINO_TABLES.bj.center[0], 16.95);
    pendant(CASINO_TABLES.poker.center[0] - 0.6, CASINO_TABLES.poker.center[1]);
    pendant(CASINO_TABLES.poker.center[0] + 0.6, CASINO_TABLES.poker.center[1]);
    pendant(CASINO_TABLES.dice.center[0], CASINO_TABLES.dice.center[1], 1.0);
    // Raf ve kanepe üstünde küçük aplikler
    for (const z of [20.6, 22.45, 24.3]) {
      vbox(BRASS, IN.x0 + 0.03, IN.x0 + 0.08, 2.75, 2.85, z - 0.03, z + 0.03, flat);
      b.add('lamp', new THREE.CylinderGeometry(0.04, 0.07, 0.1, 10), { ...noShadow, position: [IN.x0 + 0.17, 2.85, z] });
    }
    for (const x of [14.3, 15.3]) {
      vbox(BRASS, x - 0.03, x + 0.03, 1.95, 2.05, IN.z1 - 0.08, IN.z1 - 0.03, flat);
      b.add('lamp', new THREE.CylinderGeometry(0.04, 0.07, 0.1, 10), { ...noShadow, position: [x, 2.05, IN.z1 - 0.17] });
    }
  }

  return {
    door,
    setDoor,
    doorCenter: [16.0, (D.from + D.to) / 2],
    bounds: { minX, maxX, minZ, maxZ },
  };
}

function freeze(obj) {
  obj.updateMatrixWorld(true);
  obj.traverse((o) => { o.matrixAutoUpdate = false; });
}

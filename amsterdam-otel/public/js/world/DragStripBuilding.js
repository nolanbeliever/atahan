import * as THREE from 'three';
import { DRAG } from '/shared/layout.js';
import { DRAG_TRACK as T, CAR_XFER_BY_ID } from '/shared/cars.js';
import { StaticBatcher } from './StaticBatcher.js';
import { canvasTexture, drawAsphalt, drawChecker, drawHazard, rng, signMaterial, panel } from './CarWorldKit.js';

/**
 * Drag pisti ve sürüş alanı (şehir kenarı, x 140..190, z −460..40):
 *  - Çeyrek mil (402 m) iki şeritli düzlük: burnout kutusu, start çizgisi, ışık ağacı (ayrı,
 *    DragRaceTrack yakar), 100 / 200 / 300 m ve 1/8 mil işaretleri, satranç desenli bitiş, bitiş
 *    köprüsünde şerit zaman tabloları, beton bariyerler, kum havuzu + lastik duvar.
 *  - Serbest sürüş alanı: boyalı oval, çim iç saha, slalom dubaları; pist başında ızgara (paddock),
 *    garaja dönüş tüneli.
 *  - Manzara: tribün ve seyirciler, lale tarlaları, iki yel değirmeni, ağaç sırası, projektörler.
 * Pil: hepsi StaticBatcher ile malzeme başına tek mesh; grup yalnızca oyuncu pistteyken görünür.
 * Projektör ve tabela "ışıkları" ışıktan etkilenmeyen malzemelerdir (gerçek ışık yok).
 */

const D = DRAG.bounds;
const flat = { cast: false, receive: false };

function mats() {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const Bm = (o) => new THREE.MeshBasicMaterial(o);
  const asph = canvasTexture(256, 256, drawAsphalt('#3b3d40', 4));
  const strip = canvasTexture(256, 256, drawAsphalt('#2c2e31', 9));
  const grass = canvasTexture(128, 128, (g, w, h) => {
    const r = rng(12);
    g.fillStyle = '#4f7d3a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(120,170,80,0.25)' : 'rgba(30,60,20,0.25)';
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 3);
    }
  });
  // Lale tarlası: renkli sıralar
  const tulips = canvasTexture(256, 64, (g, w, h) => {
    const cols = ['#d7263d', '#f2c230', '#e36fa8', '#ff7a1a', '#f4f1e8', '#8a2be2'];
    const stripe = w / cols.length;
    cols.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(i * stripe, 0, stripe * 0.8, h);
      g.fillStyle = '#3d6b2e';
      g.fillRect(i * stripe + stripe * 0.8, 0, stripe * 0.2, h);
    });
  });
  const barrier = canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = '#e8e6e0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c3202f';
    g.fillRect(0, 0, w / 2, h * 0.22);
    g.fillStyle = '#2b5ea7';
    g.fillRect(w / 2, 0, w / 2, h * 0.22);
  });
  return {
    dGrass: L({ map: grass }),
    dTulip: L({ map: tulips }),
    dAsph: L({ map: asph }),
    dStrip: L({ map: strip }),
    dRubber: L({ color: 0x1b1c1e }),
    dWhite: L({ color: 0xf2f2ee, emissive: 0x202020 }),
    dYellow: L({ color: 0xf2c230 }),
    dChecker: L({ map: canvasTexture(64, 64, drawChecker) }),
    dBarrier: L({ map: barrier }),
    dHazard: L({ map: canvasTexture(128, 32, drawHazard) }),
    dSand: L({ color: 0xd9c08a }),
    dTyre: L({ color: 0x141414 }),
    dSteel: L({ color: 0x8f969c }),
    dDark: L({ color: 0x2a2c2f }),
    dStand: L({ color: 0xa7a59f }),
    dSeatO: L({ color: 0xff7a1a }),
    dSeatB: L({ color: 0x2b5ea7 }),
    dCrowd: L({ vertexColors: true }),
    dLamp: Bm({ color: 0xfff8e0 }),
    dTree: L({ color: 0x2f5a2a }),
    dTrunk: L({ color: 0x5a3d26 }),
    dMill: L({ color: 0x7a4a2c }),
    dMillCap: L({ color: 0x3b3b3b }),
    dSail: L({ color: 0xf1ebdc }),
    dCone: L({ color: 0xff6a00 }),
    dFence: L({ color: 0x5c6670 }),
    dPortal: L({ color: 0x9d9b95 }),
    dVoid: Bm({ color: 0x0a0b0d }),
    dBlack: L({ color: 0x15171a }),
  };
}

/** Renkli tepe noktaları (seyirci kalabalığı tek mesh'te) */
function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function buildDragStrip({ collision }) {
  const group = new THREE.Group();
  group.name = 'drag';
  const M = mats();
  const b = new StaticBatcher();
  const S = T.strip;
  const startZ = T.startZ;
  const wallTop = T.wallFromZ;
  const endZ = D.minZ + 0.2;

  // ---- Zemin --------------------------------------------------------------------------------
  b.floor('dGrass', -60, 360, -720, 260, -0.02, { uvScale: 0.12, ...flat });
  b.floor('dTulip', 104, 136, -440, -60, -0.01, { uvScale: 0.08, ...flat });
  b.floor('dTulip', 196, 236, -420, -140, -0.01, { uvScale: 0.08, ...flat });
  b.floor('dTulip', 196, 236, -110, 30, -0.01, { uvScale: 0.08, ...flat });
  b.floor('dAsph', D.minX, D.maxX, wallTop, D.maxZ, 0, { uvScale: 0.2, ...flat }); // paddock
  b.floor('dAsph', S.maxX, D.maxX, D.minZ, wallTop, 0, { uvScale: 0.2, ...flat }); // serbest alan
  b.floor('dAsph', D.minX, S.minX, D.minZ, wallTop, 0, { uvScale: 0.2, ...flat }); // batı servis yolu
  b.floor('dStrip', S.minX, S.maxX, -452, wallTop, 0.004, { uvScale: 0.2, ...flat });
  b.floor('dSand', S.minX, S.maxX, -458.5, -452, 0.006, flat);

  // ---- Pist çizgileri -------------------------------------------------------------------------
  const paint = (key, x0, x1, z0, z1, y = 0.012) => b.box(key, x0, x1, y - 0.004, y, z0, z1, flat);
  for (const x of [S.minX + 1.4, 150, S.maxX - 1.4]) {
    if (x === 150) for (let z = startZ - 6; z > T.finishZ; z -= 6) paint('dWhite', x - 0.06, x + 0.06, z - 3, z); // kesik orta çizgi
    else paint('dWhite', x - 0.07, x + 0.07, -452, startZ);
  }
  paint('dWhite', S.minX + 1.4, S.maxX - 1.4, startZ - 0.15, startZ + 0.15, 0.014); // start
  paint('dWhite', S.minX + 1.4, S.maxX - 1.4, T.eighthZ - 0.1, T.eighthZ + 0.1, 0.014); // 1/8 mil
  b.floor('dChecker', S.minX + 1.4, S.maxX - 1.4, T.finishZ - 1.2, T.finishZ, 0.015, { uvScale: 0.8, ...flat });
  // Burnout lastik izleri + kalkış bölgesindeki koyu kauçuk
  for (const id of ['L', 'R']) {
    const x = T.lanes[id].x;
    for (const dx of [-0.8, 0.8]) b.box('dRubber', x + dx - 0.18, x + dx + 0.18, 0.006, 0.01, startZ - 70, startZ + 9, flat);
  }
  // Mesafe işaretleri (yere boyalı + bariyer tabelaları)
  const markerMat = (t) => signMaterial([t], { bg: '#111', fg: '#ffd27a', w: 256, h: 128, glow: true });
  for (const m of T.markers) {
    const z = startZ - m;
    paint('dYellow', S.minX + 0.3, S.minX + 1.2, z - 0.2, z + 0.2);
    paint('dYellow', S.maxX - 1.2, S.maxX - 0.3, z - 0.2, z + 0.2);
    const mat = markerMat(`${m} m`);
    group.add(panel(mat, 1.6, 0.8, S.minX - 0.65, 1.6, z, 'z+'));
    group.add(panel(mat, 1.6, 0.8, S.maxX + 0.65, 1.6, z, 'z+'));
    for (const x of [S.minX - 0.65, S.maxX + 0.65]) b.box('dSteel', x - 0.04, x + 0.04, 0.9, 1.2, z - 0.04, z + 0.04, flat);
  }
  const m8 = markerMat('⅛ mil');
  group.add(panel(m8, 1.6, 0.8, S.minX - 0.65, 1.6, T.eighthZ, 'z+'));
  group.add(panel(m8, 1.6, 0.8, S.maxX + 0.65, 1.6, T.eighthZ, 'z+'));
  // Şerit adları (zemin)
  for (const id of ['L', 'R']) {
    group.add(panel(signMaterial([id === 'L' ? 'SOL' : 'SAĞ'], { bg: '#2c2e31', fg: '#f2f2ee', w: 256, h: 128, border: false }), 2.4, 1.2, T.lanes[id].x, 0.016, startZ + 6, 'up'));
  }
  group.add(panel(signMaterial(['BURNOUT'], { bg: '#2c2e31', fg: '#ffd27a', w: 512, h: 96, border: false }), 6, 1.1, 150, 0.016, startZ + 9.5, 'up'));

  // ---- Beton bariyerler (çarpışmalı) ---------------------------------------------------------------
  for (const [x0, x1] of [[S.minX - 0.6, S.minX], [S.maxX, S.maxX + 0.6]]) {
    b.box('dBarrier', x0, x1, 0, 0.95, endZ, wallTop, { uvScale: 0.6, ...flat });
    collision.add(x0, x1, endZ, wallTop);
  }
  // Pist sonu: kum havuzu, lastik duvar, ağ
  for (let x = S.minX + 0.4; x < S.maxX; x += 0.72) {
    for (let y = 0; y < 3; y++) b.add('dTyre', new THREE.TorusGeometry(0.28, 0.12, 6, 10).rotateX(Math.PI / 2), { position: [x, 0.12 + y * 0.24, -459.1], ...flat });
  }
  b.box('dFence', S.minX - 0.6, S.maxX + 0.6, 0, 4, -459.85, -459.75, flat);

  // ---- Bitiş köprüsü + şerit tabloları ---------------------------------------------------------------
  const fz = T.finishZ;
  for (const x of [S.minX - 1.2, S.maxX + 1.2]) b.box('dSteel', x - 0.25, x + 0.25, 0, 7.2, fz - 0.25, fz + 0.25, flat);
  b.box('dSteel', S.minX - 1.4, S.maxX + 1.4, 6.4, 7.4, fz - 0.3, fz + 0.3, flat);
  group.add(panel(signMaterial(['FINISH · ¼ MİL · 402 m'], { bg: '#111', fg: '#ffffff', w: 1024, h: 128, glow: true }), 13.5, 0.95, 150, 6.9, fz + 0.32, 'z+'));
  // Başlangıç tarafında da büyük tabela
  for (const x of [S.minX - 1.2, S.maxX + 1.2]) b.box('dSteel', x - 0.2, x + 0.2, 0, 6.2, startZ - 30.2, startZ - 29.8, flat);
  b.box('dSteel', S.minX - 1.4, S.maxX + 1.4, 5.4, 6.3, startZ - 30.25, startZ - 29.75, flat);
  group.add(panel(signMaterial(['DRAG PİSTİ · ¼ MİL', 'Amsterdam-Noord · Sol & Sağ şerit'], { bg: '#ff7a1a', fg: '#111', w: 1024, h: 160, glow: true }), 13.5, 1.0, 150, 5.85, startZ - 29.7, 'z+'));
  b.box('dDark', 150 - 0.4, 150 + 0.4, 0, 0.35, T.tree.z - 0.4, T.tree.z + 0.4, flat); // ağaç kaidesi
  collision.addAround(T.tree.x, T.tree.z, 0.42);

  // ---- Paddock: başlangıç tabelası (son yarış + liderlik) — doku DragRaceTrack'te ------------------------
  b.box('dSteel', 158.6, 158.8, 0, 5.2, 9.0, 9.2, flat);
  b.box('dSteel', 167.2, 167.4, 0, 5.2, 9.0, 9.2, flat);
  collision.add(158.5, 158.9, 8.9, 9.3);
  collision.add(167.1, 167.5, 8.9, 9.3);

  // ---- Serbest sürüş alanı: boyalı oval + çim iç saha + slalom ---------------------------------------
  const ox0 = 161;
  const ox1 = 187;
  const oz0 = -420;
  const oz1 = -60;
  const rIn = 5;
  const cx = (ox0 + ox1) / 2;
  // İç saha (çim, kaldırımlı) — çarpışmalı
  b.box('dGrass', cx - rIn, cx + rIn, 0, 0.12, oz0 + 13, oz1 - 13, { uvScale: 0.2, ...flat });
  b.box('dHazard', cx - rIn - 0.25, cx - rIn, 0, 0.14, oz0 + 13, oz1 - 13, { uvScale: 1, ...flat });
  b.box('dHazard', cx + rIn, cx + rIn + 0.25, 0, 0.14, oz0 + 13, oz1 - 13, { uvScale: 1, ...flat });
  collision.add(cx - rIn - 0.25, cx + rIn + 0.25, oz0 + 13, oz1 - 13);
  // Oval kenar çizgileri (iki düz + iki yarım halka)
  paint('dWhite', ox0, ox0 + 0.15, oz0 + 13, oz1 - 13);
  paint('dWhite', ox1 - 0.15, ox1, oz0 + 13, oz1 - 13);
  // CircleGeometry'nin üst yarısı rotateX sonrası −Z'ye düşer: kuzey ucu π döndürülür (iç sahanın dışına taşar)
  for (const [z, rot] of [[oz1 - 13, Math.PI], [oz0 + 13, 0]]) {
    b.add('dWhite', new THREE.RingGeometry(12.85, 13, 32, 1, 0, Math.PI).rotateX(-Math.PI / 2).rotateY(rot), { position: [cx, 0.012, z], ...flat });
    b.add('dGrass', new THREE.CircleGeometry(rIn, 20, 0, Math.PI).rotateX(-Math.PI / 2).rotateY(rot), { position: [cx, 0.11, z], ...flat });
    collision.addAround(cx, z + (rot ? 2.5 : -2.5), 3.4);
  }
  // Slalom dubaları (çarpışmasız: yumuşak)
  for (let i = 0; i < 9; i++) {
    const z = -8 - i * 5;
    const x = 174 + (i % 2 ? 2.5 : -2.5);
    b.add('dCone', new THREE.ConeGeometry(0.22, 0.6, 8), { position: [x, 0.3, z], ...flat });
    b.box('dCone', x - 0.25, x + 0.25, 0, 0.04, z - 0.25, z + 0.25, flat);
  }
  group.add(panel(signMaterial(['SERBEST SÜRÜŞ', 'oval · slalom'], { bg: '#1f7a45', glow: true }), 3.2, 0.9, 174, 2.6, -4, 'z+'));
  b.box('dSteel', 172.4, 172.5, 0, 2.2, -4.05, -3.95, flat);
  b.box('dSteel', 175.5, 175.6, 0, 2.2, -4.05, -3.95, flat);

  // ---- Çevre çiti (çarpışmalı) ------------------------------------------------------------------------
  const fence = (x0, x1, z0, z1) => {
    b.box('dFence', x0, x1, 1.9, 2.0, z0, z1, flat);
    const along = x1 - x0 > z1 - z0;
    const len = along ? x1 - x0 : z1 - z0;
    for (let t = 0; t <= len; t += 6) {
      const x = along ? x0 + t : (x0 + x1) / 2;
      const z = along ? (z0 + z1) / 2 : z0 + t;
      b.box('dFence', x - 0.05, x + 0.05, 0, 2.0, z - 0.05, z + 0.05, flat);
    }
  };
  fence(D.minX, D.maxX, D.maxZ - 0.1, D.maxZ);
  fence(D.minX, D.maxX, D.minZ, D.minZ + 0.1);
  fence(D.minX, D.minX + 0.1, D.minZ, D.maxZ);
  fence(D.maxX - 0.1, D.maxX, D.minZ, D.maxZ);
  collision.add(D.minX - 2, D.maxX + 2, D.maxZ - 0.2, D.maxZ + 2);
  collision.add(D.minX - 2, D.maxX + 2, D.minZ - 2, D.minZ + 0.2);
  collision.add(D.minX - 2, D.minX + 0.2, D.minZ, D.maxZ);
  collision.add(D.maxX - 0.2, D.maxX + 2, D.minZ, D.maxZ);

  // ---- Garaja dönüş tüneli (kuzeydoğu) ------------------------------------------------------------------
  const gz = CAR_XFER_BY_ID.toGarage.zone;
  b.box('dPortal', D.maxX, D.maxX + 5, 0, 5, gz.minZ - 1.5, gz.minZ, flat);
  b.box('dPortal', D.maxX, D.maxX + 5, 0, 5, gz.maxZ, gz.maxZ + 1.5, flat);
  b.box('dPortal', D.maxX, D.maxX + 5, 3.4, 5, gz.minZ, gz.maxZ, flat);
  b.add('dVoid', new THREE.PlaneGeometry(gz.maxZ - gz.minZ, 3.4).rotateY(-Math.PI / 2), { position: [D.maxX + 0.6, 1.7, (gz.minZ + gz.maxZ) / 2], ...flat });
  b.floor('dDark', gz.minX, D.maxX + 0.6, gz.minZ, gz.maxZ, 0.006, flat);
  group.add(panel(signMaterial(['🅿️ GARAJA DÖN', 'Hotel Amsterdam Garage'], { bg: '#2b5ea7', glow: true }), 4.4, 1.2, D.maxX - 0.15, 4.1, (gz.minZ + gz.maxZ) / 2, 'x-'));

  // ---- Tribün ve seyirciler (batı, çitin dışında) -------------------------------------------------------
  const crowd = [];
  const rr = rng(77);
  const shirt = ['#ff7a1a', '#2b5ea7', '#f4f1e8', '#c3202f', '#1f5d43', '#f2c230', '#111111'];
  for (let step = 0; step < 6; step++) {
    const x0 = 126 + step * 1.6;
    const y = 0.45 + step * 0.55;
    b.box('dStand', x0, 140 - 0.2, 0, y, -175, -45, flat);
    b.box(step % 2 ? 'dSeatB' : 'dSeatO', x0 + 0.1, x0 + 0.7, y, y + 0.18, -174.5, -45.5, flat);
    for (let z = -174; z < -46; z += 0.9) {
      if (rr() < 0.42) continue;
      const geo = colored(new THREE.BoxGeometry(0.42, 0.62, 0.36), shirt[Math.floor(rr() * shirt.length)]);
      geo.translate(x0 + 0.4, y + 0.5, z);
      crowd.push(geo);
      const head = colored(new THREE.BoxGeometry(0.22, 0.22, 0.22), ['#f1c9a5', '#c99a6e', '#7a5232'][Math.floor(rr() * 3)]);
      head.translate(x0 + 0.4, y + 0.93, z);
      crowd.push(head);
    }
  }
  for (const g of crowd) b.add('dCrowd', g, flat);
  b.box('dSteel', 125.5, 140, 7.5, 7.7, -176, -44, flat); // çatı
  for (const z of [-175, -140, -110, -80, -45]) b.box('dSteel', 125.6, 125.9, 0, 7.5, z - 0.15, z + 0.15, flat);
  group.add(panel(signMaterial(['TRİBÜN · DRAGWEEKEND'], { bg: '#111', fg: '#ff7a1a', w: 1024, h: 128, glow: true }), 16, 1.4, 139.9, 8.5, -110, 'x+'));

  // ---- Projektörler ----------------------------------------------------------------------------------------
  for (let z = startZ - 10; z > -450; z -= 80) {
    for (const x of [S.minX - 2.4, S.maxX + 2.4]) {
      b.box('dSteel', x - 0.12, x + 0.12, 0, 11, z - 0.12, z + 0.12, flat);
      b.box('dLamp', x - 0.9, x + 0.9, 11, 11.6, z - 0.3, z + 0.3, flat);
    }
  }

  // ---- Manzara: ağaç sırası, yel değirmenleri ---------------------------------------------------------------
  const tree = (x, z, s = 1) => {
    b.add('dTrunk', new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 2.2 * s, 6), { position: [x, 1.1 * s, z], ...flat });
    b.add('dTree', new THREE.SphereGeometry(1.7 * s, 7, 5), { position: [x, 3.2 * s, z], ...flat });
  };
  const tr = rng(5);
  for (let z = 80; z > -640; z -= 9) {
    tree(96 + tr() * 4, z, 0.9 + tr() * 0.6);
    tree(244 + tr() * 4, z, 0.9 + tr() * 0.6);
  }
  for (let x = 100; x < 244; x += 9) {
    tree(x, -560 - tr() * 4, 0.9 + tr() * 0.6);
    tree(x, 120 + tr() * 4, 0.9 + tr() * 0.6);
  }
  const sails = [];
  for (const [x, z, s] of [[118, -250, 1], [222, -150, 0.85], [214, -360, 0.7]]) {
    b.add('dMill', new THREE.CylinderGeometry(2.4 * s, 4.2 * s, 14 * s, 8), { position: [x, 7 * s, z], ...flat });
    b.add('dMillCap', new THREE.ConeGeometry(3.0 * s, 3.4 * s, 8), { position: [x, 15.7 * s, z], ...flat });
    b.box('dWhite', x - 2.5 * s, x + 2.5 * s, 4.5 * s, 4.8 * s, z - 2.5 * s, z + 2.5 * s, flat); // galeri
    // Kanatlar ayrı (sürüş sırasında yavaşça döner)
    const hub = new THREE.Group();
    hub.position.set(x + (x < 150 ? 3.3 : -3.3) * s, 14 * s, z);
    hub.rotation.y = x < 150 ? Math.PI / 2 : -Math.PI / 2;
    const sail = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 11 * s, 0.12), M.dSail);
      arm.position.y = 5.5 * s;
      const pivot = new THREE.Group();
      pivot.rotation.z = (i * Math.PI) / 2;
      pivot.add(arm);
      sail.add(pivot);
    }
    hub.add(sail);
    group.add(hub);
    sails.push(sail);
  }

  b.build(M, group);
  for (const o of group.children) {
    if (o.isMesh) {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    }
  }
  group.visible = false;

  const lampBase = M.dLamp.color.clone();
  const emissive = ['dAsph', 'dStrip', 'dWhite'].map((k) => ({ m: M[k], base: (M[k].emissive ?? new THREE.Color(0)).clone() }));
  return {
    group,
    sails,
    setNight(t) {
      M.dLamp.color.copy(lampBase).multiplyScalar(1 + t * 0.2);
      // Gece projektörler pisti aydınlatıyormuş gibi: asfalt ve çizgiler hafif kendiliğinden ışır
      for (const e of emissive) e.m.emissive.copy(e.base).lerp(new THREE.Color(0x2a2a2a), t);
    },
  };
}

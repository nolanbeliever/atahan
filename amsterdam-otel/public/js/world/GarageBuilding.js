import * as THREE from 'three';
import { GARAGE_LAYOUT as G, STREET_RAMP as SR, CAR_XFER_BY_ID } from '/shared/cars.js';
import { StaticBatcher } from './StaticBatcher.js';
import { canvasTexture, drawConcrete, drawHazard, drawChecker, signMaterial, panel } from './CarWorldKit.js';

/**
 * Yeraltı garajı ("Hotel Amsterdam Garage", katman −1) ve sokaktaki rampa ağzı.
 * Fizik 2B olduğu için garaj dünyanın ayrı bir köşesindedir (x 60..100, z −30..10); "otelin altında"
 * hissini kapalı beton kutu, tavan kirişleri, rampa tünelleri ve −2'ye inen (kapalı) rampa verir.
 *
 * Pil: her şey StaticBatcher ile malzeme başına tek mesh (≈ 20 draw call); flüoresan lambalar
 * gerçek ışık değil, ışıktan etkilenmeyen beyaz şeritlerdir (MeshBasic). Garaj grubu yalnızca
 * oyuncu garajdayken görünür (UndergroundGarage alan yöneticisi).
 */

const B = G.bounds;
const H = G.ceiling;
const T = 0.3; // duvar kalınlığı
const flat = { cast: false, receive: false };

function garageMaterials() {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const Bm = (o) => new THREE.MeshBasicMaterial(o);
  const floorTex = canvasTexture(256, 256, drawConcrete('#6c6e70', 21, 0.35));
  const wallTex = canvasTexture(256, 256, drawConcrete('#b5b3ad', 22, 0.12));
  const hazard = canvasTexture(128, 32, drawHazard);
  const checker = canvasTexture(64, 64, drawChecker);
  return {
    gFloor: L({ map: floorTex, emissive: 0x1a1a1a }),
    gCeil: L({ map: wallTex, color: 0x6f6e6a, emissive: 0x3c3b38 }),
    gWall: L({ map: wallTex, emissive: 0x202020 }),
    gStripe: L({ color: 0x2b5ea7, emissive: 0x0a1a33 }),
    gBeam: L({ color: 0x9a9894, emissive: 0x141414 }),
    gLamp: Bm({ color: 0xf4f8ff }),
    gPipe: L({ color: 0xb22a2a }),
    gPipe2: L({ color: 0x8a9096 }),
    gPaint: L({ color: 0xf2f2ee, emissive: 0x303030 }),
    gYellow: L({ color: 0xf2c230, emissive: 0x302400 }),
    gHazard: L({ map: hazard, emissive: 0x202020 }),
    gPillar: L({ color: 0xc9c6bf, emissive: 0x1c1c1c }),
    gSteel: L({ color: 0x9aa3ab }),
    gDoor: L({ color: 0x6f7880 }),
    gDay: Bm({ color: 0xe8f0f6 }), // tünel ucundaki gün ışığı (gece koyulaşır)
    gDark: L({ color: 0x2a2b2d }),
    gChecker: L({ map: checker }),
    gRed: L({ color: 0xc3202f }),
    gGreen: Bm({ color: 0x29c46a }),
    gScreen: Bm({ color: 0x9fe2ff }),
    gBlack: L({ color: 0x15171a }),
  };
}

/** Park yeri numaraları: tek atlas dokusu (P-01…), her etiket kendi hücresinin UV'si */
function numberAtlas() {
  const cols = 8;
  const rows = Math.ceil(G.bays.length / cols);
  const cw = 128;
  const ch = 64;
  const tex = canvasTexture(cols * cw, rows * ch, (g) => {
    g.fillStyle = '#585a5c';
    g.fillRect(0, 0, cols * cw, rows * ch);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 40px system-ui, sans-serif';
    G.bays.forEach((b, i) => g.fillText(b.label, (i % cols) * cw + cw / 2, Math.floor(i / cols) * ch + ch / 2 + 2));
  }, { repeat: false });
  return { tex, cols, rows };
}

export function buildGarage({ collision }) {
  const group = new THREE.Group();
  group.name = 'garage';
  const mats = garageMaterials();
  const b = new StaticBatcher();

  // ---- Zemin, tavan, duvarlar --------------------------------------------------------------
  b.floor('gFloor', B.minX, B.maxX, B.minZ, B.maxZ, 0, { uvScale: 0.25, ...flat });
  b.floor('gCeil', B.minX, B.maxX, B.minZ, B.maxZ, H, { facingDown: true, uvScale: 0.25, ...flat });
  const R = G.ramp;
  const DL = G.dragLane;
  const wall = (x0, x1, z0, z1, y0 = 0, y1 = H) => b.box('gWall', x0, x1, y0, y1, z0, z1, { uvScale: 0.35, ...flat });
  // Kuzey: rampa ağzı (x 88.5..99.5) açık; üstünde lento
  wall(B.minX, R.outX[0], B.maxZ - T, B.maxZ);
  wall(R.inX[1], B.maxX, B.maxZ - T, B.maxZ);
  wall(R.outX[0], R.inX[1], B.maxZ - T, B.maxZ, 2.6, H);
  // Doğu: drag tüneli (z −24.4..−18.6) açık
  wall(B.maxX - T, B.maxX, B.minZ, DL.minZ);
  wall(B.maxX - T, B.maxX, DL.maxZ, B.maxZ);
  wall(B.maxX - T, B.maxX, DL.minZ, DL.maxZ, 2.6, H);
  wall(B.minX, B.minX + T, B.minZ, B.maxZ);
  wall(B.minX, B.maxX, B.minZ, B.minZ + T);
  // Çarpışma: dört duvar tam (tetik alanları duvarın önünde)
  collision.add(B.minX - 1, B.maxX + 1, B.maxZ - T, B.maxZ + 1);
  collision.add(B.minX - 1, B.maxX + 1, B.minZ - 1, B.minZ + T);
  collision.add(B.minX - 1, B.minX + T, B.minZ, B.maxZ);
  collision.add(B.maxX - T, B.maxX + 1, B.minZ, B.maxZ);
  // Mavi şerit bandı (otopark klasiği)
  const band = (x0, x1, z0, z1) => b.box('gStripe', x0, x1, 0.95, 1.2, z0, z1, flat);
  band(B.minX + T, B.minX + T + 0.01, B.minZ + T, B.maxZ - T);
  band(B.minX + T, B.maxX - T, B.minZ + T, B.minZ + T + 0.01);
  band(B.minX + T, R.outX[0], B.maxZ - T - 0.01, B.maxZ - T);
  band(B.maxX - T - 0.01, B.maxX - T, B.minZ + T, DL.minZ);
  band(B.maxX - T - 0.01, B.maxX - T, DL.maxZ, B.maxZ - T);

  // ---- Tavan: kirişler, flüoresan şeritler, borular ------------------------------------------
  for (const x of [64, 74.4, 84.8, 95.2]) b.box('gBeam', x - 0.2, x + 0.2, H - 0.32, H, B.minZ + T, B.maxZ - T, flat);
  for (const z of [5.2, -4, -13.2, -21.5, -27.2]) {
    for (let x = 62.5; x < 98; x += 5.2) b.box('gLamp', x - 0.7, x + 0.7, H - 0.06, H - 0.02, z - 0.07, z + 0.07, flat);
  }
  b.add('gPipe', new THREE.CylinderGeometry(0.06, 0.06, B.maxX - B.minX - 0.6, 8).rotateZ(Math.PI / 2), { position: [80, H - 0.45, B.maxZ - 0.6], ...flat });
  b.add('gPipe2', new THREE.CylinderGeometry(0.09, 0.09, B.maxX - B.minX - 0.6, 8).rotateZ(Math.PI / 2), { position: [80, H - 0.2, B.maxZ - 0.9], ...flat });
  b.add('gPipe', new THREE.CylinderGeometry(0.05, 0.05, B.maxZ - B.minZ - 0.6, 8).rotateX(Math.PI / 2), { position: [B.minX + 0.6, H - 0.4, -10], ...flat });

  // ---- Park yerleri: çizgiler ve numaralar ------------------------------------------------------
  const line = (x0, x1, z0, z1) => b.box('gPaint', x0, x1, 0.004, 0.01, z0, z1, flat);
  for (const [id, row] of Object.entries(G.rows)) {
    for (let i = 0; i <= row.n; i++) {
      const x = row.x0 + i * G.bayW;
      line(x - 0.05, x + 0.05, row.minZ + 0.1, row.maxZ - 0.15);
    }
    if (id === 'B') line(row.x0, row.x0 + row.n * G.bayW, row.maxZ - 0.05, row.maxZ + 0.05);
  }
  // Numaralar (tek atlas mesh'i): okuyucu koridordan bakar
  const atlas = numberAtlas();
  const numMat = new THREE.MeshLambertMaterial({ map: atlas.tex });
  const numGeos = [];
  G.bays.forEach((bay, i) => {
    const g = new THREE.PlaneGeometry(1.2, 0.6);
    const uv = g.attributes.uv;
    const c = i % atlas.cols;
    const r = Math.floor(i / atlas.cols);
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, (c + uv.getX(k)) / atlas.cols, 1 - (r + 1 - uv.getY(k)) / atlas.rows);
    }
    const row = G.rows[bay.row];
    const nearAisle = bay.row === 'B' ? row.minZ + 0.7 : row.maxZ - 0.7;
    g.rotateX(-Math.PI / 2);
    if (bay.row === 'B') g.rotateY(Math.PI);
    g.translate(bay.x, 0.012, nearAisle);
    numGeos.push(g);
  });
  const nb = new StaticBatcher();
  for (const g of numGeos) nb.add('nums', g, flat);
  nb.build({ nums: numMat }, group);
  // Koridor okları (sarı)
  const arrow = (x, z, rot) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.9);
    s.lineTo(0.5, 0.2);
    s.lineTo(0.18, 0.2);
    s.lineTo(0.18, -0.8);
    s.lineTo(-0.18, -0.8);
    s.lineTo(-0.18, 0.2);
    s.lineTo(-0.5, 0.2);
    s.closePath();
    const g = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).rotateY(rot);
    b.add('gYellow', g, { position: [x, 0.011, z], ...flat });
  };
  arrow(97, 1.6, 0); // girişten aşağı (güneye)
  arrow(91, 3.5, Math.PI); // çıkışa (kuzeye)
  arrow(80, -4, Math.PI / 2); // ana koridor batıya
  arrow(70, -21.5, -Math.PI / 2); // alt koridor doğuya (drag tüneline)
  arrow(90, -21.5, -Math.PI / 2);

  // ---- Sütunlar (ikaz şeritli tabanlı) ------------------------------------------------------------
  for (const [x, z] of G.pillars) {
    b.box('gPillar', x - 0.25, x + 0.25, 0, H, z - 0.25, z + 0.25, flat);
    b.box('gHazard', x - 0.27, x + 0.27, 0, 0.8, z - 0.27, z + 0.27, { uvScale: 2.2, ...flat });
    collision.addAround(x, z, 0.27);
  }
  const lvl = signMaterial(['P −1'], { bg: '#2b5ea7', w: 256, h: 128 });
  for (const [x, z] of G.pillars.slice(0, 4)) {
    group.add(panel(lvl, 0.44, 0.22, x, 1.9, z + 0.26, 'z+'));
    group.add(panel(lvl, 0.44, 0.22, x, 1.9, z - 0.26, 'z-'));
  }

  // ---- Asansör + merdiven kapısı (lobiye) -------------------------------------------------------
  const E = G.elevator;
  const zw = B.maxZ - T;
  b.box('gSteel', E.x - 1.3, E.x + 1.3, 0, 2.5, zw - 0.06, zw, flat); // çerçeve
  b.box('gDoor', E.x - 1.05, E.x - 0.02, 0.02, 2.3, zw - 0.09, zw - 0.06, flat);
  b.box('gDoor', E.x + 0.02, E.x + 1.05, 0.02, 2.3, zw - 0.09, zw - 0.06, flat);
  b.box('gBlack', E.x + 1.35, E.x + 1.5, 1.1, 1.35, zw - 0.05, zw, flat); // çağırma düğmesi
  b.box('gGreen', E.x + 1.39, E.x + 1.46, 1.18, 1.27, zw - 0.07, zw - 0.05, flat);
  group.add(panel(signMaterial(['🛗 LIFT · LOBİ', 'Hotel De Tulp ↑'], { bg: '#203a5c', glow: true }), 1.6, 0.5, E.x, 2.72, zw - 0.02, 'z-'));
  b.box('gGreen', E.x + 2.0, E.x + 3.0, 0.02, 2.2, zw - 0.06, zw, flat); // acil çıkış / merdiven
  group.add(panel(signMaterial(['🚶 TRAP · MERDİVEN'], { bg: '#1f7a45', glow: true, w: 384, h: 96 }), 1.0, 0.25, E.x + 2.5, 2.45, zw - 0.02, 'z-'));

  // ---- AutoGalerie terminali ------------------------------------------------------------------
  const K = G.kiosk;
  b.box('gBlack', K.x - 0.32, K.x + 0.32, 0, 1.0, K.z - 0.18, K.z + 0.12, flat);
  const screenMat = new THREE.MeshBasicMaterial({ map: kioskTexture() });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.46), screenMat);
  screen.position.set(K.x, 1.22, K.z - 0.05);
  screen.rotation.set(-0.5, Math.PI, 0);
  group.add(screen);
  b.box('gBlack', K.x - 0.4, K.x + 0.4, 0.95, 1.5, K.z + 0.05, K.z + 0.14, { ...flat, rotation: [0, 0, 0] });
  collision.add(K.x - 0.4, K.x + 0.4, K.z - 0.25, B.maxZ);
  group.add(panel(signMaterial(['AutoGalerie', 'online autodealer · telefondan da açılır'], { bg: '#0f2f4f', glow: true }), 2.2, 0.66, K.x, 2.35, zw - 0.02, 'z-'));
  // Büyük tabela
  group.add(panel(signMaterial(['P · HOTEL AMSTERDAM GARAGE', 'Hotel De Tulp · niveau −1 · 30 km/s'], { bg: '#2b5ea7', glow: true, w: 1024, h: 180 }), 6.4, 1.12, 80.5, 2.1, zw - 0.02, 'z-'));

  // ---- Sokağa rampa (kuzey) -------------------------------------------------------------------
  // Eğimli rampa tünelin içine doğru yükselir; tünelin ucunda gün ışığı
  const len = 14 - R.slopeZ;
  const rise = 2.1;
  const ang = Math.atan2(rise, len);
  const slope = new THREE.PlaneGeometry(R.inX[1] - R.outX[0], Math.hypot(len, rise)).rotateX(-Math.PI / 2 + ang);
  b.add('gDark', slope, { position: [(R.outX[0] + R.inX[1]) / 2, rise / 2, R.slopeZ + len / 2], ...flat });
  b.box('gWall', R.outX[0] - 0.3, R.outX[0], 0, 2.6, B.maxZ, 14, { uvScale: 0.35, ...flat });
  b.box('gWall', R.inX[1], R.inX[1] + 0.3, 0, 2.6, B.maxZ, 14, { uvScale: 0.35, ...flat });
  b.box('gWall', R.outX[0] - 0.3, R.inX[1] + 0.3, 2.6, 2.9, B.maxZ, 14, flat);
  b.add('gDay', new THREE.PlaneGeometry(R.inX[1] - R.outX[0], 2.6).rotateY(Math.PI), { position: [(R.outX[0] + R.inX[1]) / 2, 1.3, 13.9], ...flat });
  b.box('gHazard', R.divider[0], R.divider[1], 0, 0.16, 2.5, B.maxZ - T, { uvScale: 2, ...flat });
  collision.add(R.divider[0], R.divider[1], 2.5, B.maxZ);
  // Bariyer kolları (kalkık) ve şerit tabelaları
  for (const [x, dir] of [[R.outX[0] + 0.15, 1], [R.inX[1] - 0.15, -1]]) {
    b.box('gBlack', x - 0.15, x + 0.15, 0, 1.05, R.gateZ - 0.15, R.gateZ + 0.15, flat);
    b.add('gHazard', new THREE.BoxGeometry(3.6, 0.09, 0.06), { position: [x + dir * 0.5, 2.6, R.gateZ], rotation: [0, 0, dir * 1.2], uvScale: 2, ...flat });
    collision.addAround(x, R.gateZ, 0.16);
  }
  group.add(panel(signMaterial(['⇡ UITRIT · ÇIKIŞ', 'sokağa / naar straat'], { bg: '#1f7a45', glow: true }), 2.6, 0.62, (R.outX[0] + R.outX[1]) / 2, 2.25, zw - 0.32, 'z-'));
  group.add(panel(signMaterial(['⇣ INRIT · GİRİŞ', 'Hotel Amsterdam Garage'], { bg: '#2b5ea7', glow: true }), 2.6, 0.62, (R.inX[0] + R.inX[1]) / 2, 2.25, zw - 0.32, 'z-'));
  b.box('gBlack', R.outX[0], R.inX[1], 2.55, 2.62, zw - 0.36, zw - 0.3, flat);

  // ---- Drag pisti tüneli (doğu duvarı) -----------------------------------------------------------
  const xw = B.maxX - T;
  b.box('gWall', B.maxX, 104, 0, 2.6, DL.minZ - 0.3, DL.minZ, { uvScale: 0.35, ...flat });
  b.box('gWall', B.maxX, 104, 0, 2.6, DL.maxZ, DL.maxZ + 0.3, { uvScale: 0.35, ...flat });
  b.box('gWall', B.maxX, 104, 2.6, 2.9, DL.minZ - 0.3, DL.maxZ + 0.3, flat);
  b.floor('gDark', B.maxX - T, 104, DL.minZ, DL.maxZ, 0.002, flat);
  b.add('gDay', new THREE.PlaneGeometry(DL.maxZ - DL.minZ, 2.6).rotateY(-Math.PI / 2), { position: [103.9, 1.3, (DL.minZ + DL.maxZ) / 2], ...flat });
  const dz = CAR_XFER_BY_ID.toDrag.zone;
  b.floor('gChecker', dz.minX, xw, DL.minZ + 0.2, DL.maxZ - 0.2, 0.008, { uvScale: 1, ...flat });
  group.add(panel(signMaterial(['🏁 DRAG PİSTİ →', 'arabanla sür · drive to the strip'], { bg: '#111', glow: true }), 3.2, 0.8, xw - 0.02, 2.35, (DL.minZ + DL.maxZ) / 2, 'x-'));

  // ---- −2 katına inen rampa (kapalı, dekor) ---------------------------------------------------------
  const D2 = G.down2;
  b.floor('gDark', D2.minX, D2.maxX, D2.minZ, D2.maxZ, 0.006, flat);
  for (let x = D2.minX + 1; x < D2.maxX - 0.5; x += 1.6) arrowChevron(b, x, (D2.minZ + D2.maxZ) / 2);
  b.box('gHazard', D2.minX, D2.minX + 0.25, 0, 0.3, D2.minZ, D2.maxZ, { uvScale: 2, ...flat });
  b.add('gHazard', new THREE.BoxGeometry(D2.maxX - D2.minX - 0.5, 0.1, 0.06), { position: [(D2.minX + D2.maxX) / 2, 1.0, D2.maxZ - 0.1], uvScale: 2, ...flat });
  b.box('gBlack', D2.minX + 0.05, D2.minX + 0.3, 0, 1.1, D2.maxZ - 0.25, D2.maxZ, flat);
  collision.add(D2.minX, D2.maxX + 0.5, D2.minZ - 0.5, D2.maxZ);
  group.add(panel(signMaterial(['−2 · VOL / DOLU', 'alt kat kapalı'], { bg: '#8f2420', glow: true }), 1.8, 0.5, (D2.minX + D2.maxX) / 2, 1.55, D2.maxZ - 0.05, 'z+'));

  // ---- Küçük ayrıntılar: yangın tüpleri, şarj istasyonu, acil çıkış ışıkları ---------------------------
  for (const [x, z] of [[60.35, -5], [60.35, -20], [B.maxX - 0.35, 0]]) {
    b.box('gRed', x - 0.06, x + 0.06, 0.9, 1.4, z - 0.09, z + 0.09, flat);
  }
  for (const x of [66.6, 69.2]) { // A sırasının ilk iki yerinde EV şarj direkleri
    b.box('gSteel', x - 0.2, x + 0.2, 0, 1.4, B.minZ + T, B.minZ + T + 0.25, flat);
    b.box('gGreen', x - 0.12, x + 0.12, 1.0, 1.25, B.minZ + T + 0.25, B.minZ + T + 0.27, flat);
  }
  for (const z of [-4, -21.5]) b.box('gGreen', B.minX + T, B.minX + T + 0.03, 2.3, 2.5, z - 0.4, z + 0.4, flat);

  b.build(mats, group);
  group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  group.visible = false;

  const day = { base: mats.gDay.color.clone(), night: new THREE.Color(0x1a2848) };
  const nightGlow = new THREE.Color(0x5a5852); // gece ay ışığı (mavi, loş) yerine flüoresanın sıcak grisi
  const emissives = ['gFloor', 'gCeil', 'gWall', 'gBeam', 'gPillar', 'gPaint'].map((k) => ({ m: mats[k], base: mats[k].emissive.clone() }));
  return {
    group,
    /** Gece: tünel ucundaki gün ışığı koyulaşır; flüoresan "ışığı" (emissive) gündüzü taklit eder */
    setNight(t) {
      mats.gDay.color.copy(day.base).lerp(day.night, t);
      for (const e of emissives) e.m.emissive.copy(e.base).lerp(nightGlow, t * 0.85);
    },
  };
}

function arrowChevron(b, x, z) {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0.35);
  s.lineTo(0, -0.35);
  s.lineTo(0.5, 0.35);
  s.lineTo(0.3, 0.35);
  s.lineTo(0, -0.05);
  s.lineTo(-0.3, 0.35);
  s.closePath();
  b.add('gYellow', new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), { position: [x, 0.012, z], cast: false, receive: false });
}

function kioskTexture() {
  return canvasTexture(256, 160, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0f2f4f');
    grd.addColorStop(1, '#071526');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9fe2ff';
    g.font = '800 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('AutoGalerie', w / 2, 44);
    g.font = '600 15px system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('10 model · €12.000 – €280.000', w / 2, 72);
    // Basit araba silueti
    g.fillStyle = '#ff7a1a';
    g.beginPath();
    g.moveTo(60, 125);
    g.lineTo(70, 105);
    g.lineTo(110, 92);
    g.lineTo(160, 92);
    g.lineTo(190, 108);
    g.lineTo(200, 125);
    g.closePath();
    g.fill();
    g.fillStyle = '#111';
    for (const x of [88, 172]) {
      g.beginPath();
      g.arc(x, 126, 11, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#9fe2ff';
    g.font = '600 13px system-ui, sans-serif';
    g.fillText('E · dokun', w / 2, 152);
  }, { repeat: false });
}

/**
 * Sokaktaki rampa ağzı (otelin önü, batı): alçak beton duvarlar, aşağı inen koyu rampa yüzeyi,
 * kalkık bariyer kolu ve "P ↓" tabelası. Ağız doğuya açılır; içine yürüyen / süren garaja iner.
 */
export function buildStreetRamp({ scene, collision }) {
  const group = new THREE.Group();
  group.name = 'street-ramp';
  const conc = canvasTexture(128, 128, drawConcrete('#9d9b95', 5, 0.15));
  const mats = {
    rConc: new THREE.MeshLambertMaterial({ map: conc }),
    rRamp: new THREE.MeshLambertMaterial({ map: canvasTexture(256, 64, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, '#050506');
      grd.addColorStop(0.55, '#2a2b2e');
      grd.addColorStop(1, '#55575a');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(242,194,48,0.85)';
      for (let x = 30; x < w; x += 46) g.fillRect(x, h * 0.46, 22, h * 0.08);
    }, { repeat: false }) }),
    rHazard: new THREE.MeshLambertMaterial({ map: canvasTexture(128, 32, drawHazard) }),
    rDark: new THREE.MeshBasicMaterial({ color: 0x050607 }),
    rSteel: new THREE.MeshLambertMaterial({ color: 0x8a9096 }),
  };
  const b = new StaticBatcher();
  const { minX, maxX, minZ, maxZ } = SR;
  // Rampa yüzeyi: ağızdan (doğu) içeri doğru kararır → aşağı iniyormuş hissi
  const ramp = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2);
  b.add('rRamp', ramp, { position: [(minX + maxX) / 2, 0.012, (minZ + maxZ) / 2], cast: false });
  // Alçak duvarlar (kuzey, güney, arka) + ikaz şeritli üst kenar
  const wallH = 0.75;
  b.box('rConc', minX, maxX, 0, wallH, maxZ - 0.1, maxZ + 0.1, { uvScale: 1 });
  b.box('rConc', minX, maxX, 0, wallH, minZ - 0.1, minZ + 0.1, { uvScale: 1 });
  b.box('rHazard', minX, maxX, wallH, wallH + 0.06, maxZ - 0.11, maxZ + 0.11, { uvScale: 2, cast: false });
  b.box('rHazard', minX, maxX, wallH, wallH + 0.06, minZ - 0.11, minZ + 0.11, { uvScale: 2, cast: false });
  // Arka: tünel ağzı (yerin altına iniyormuş gibi kapkara) ve üstünde beton lento
  b.box('rConc', minX - 0.3, minX, 0, 2.4, minZ - 0.1, maxZ + 0.1, { uvScale: 1 });
  b.add('rDark', new THREE.PlaneGeometry(maxZ - minZ - 0.2, 1.9).rotateY(Math.PI / 2), { position: [minX + 0.01, 0.95, (minZ + maxZ) / 2], cast: false, receive: false });
  collision.add(minX, maxX, maxZ - 0.1, maxZ + 0.1);
  collision.add(minX, maxX, minZ - 0.1, minZ + 0.1);
  collision.add(minX - 0.3, minX, minZ - 0.1, maxZ + 0.1);
  // Bariyer: direk + kalkık kol
  b.box('rSteel', SR.gateX - 0.12, SR.gateX + 0.12, 0, 1.0, minZ + 0.12, minZ + 0.34);
  b.add('rHazard', new THREE.BoxGeometry(0.07, 0.08, 2.9), { position: [SR.gateX, 2.25, minZ + 0.6], rotation: [1.15, 0, 0], uvScale: 2, cast: false });
  // "P ↓" tabela direği (rampanın güneydoğu köşesi)
  const [sx, sz] = SR.sign;
  b.add('rSteel', new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), { position: [sx, 1.3, sz] });
  collision.addAround(sx, sz, 0.08);
  b.build(mats, group);
  group.add(panel(signMaterial(['P ↓'], { bg: '#2b5ea7', w: 256, h: 256, glow: true }), 0.62, 0.62, sx, 2.35, sz - 0.05, 'z-'));
  group.add(panel(signMaterial(['P ↓'], { bg: '#2b5ea7', w: 256, h: 256, glow: true }), 0.62, 0.62, sx + 0.05, 2.35, sz, 'x+'));
  group.add(panel(signMaterial(['HOTEL AMSTERDAM GARAGE', 'garaj · 24/7 · 30 km/s'], { bg: '#1b2430', glow: true }), 2.4, 0.42, minX + 0.02, 2.15, (minZ + maxZ) / 2, 'x+'));
  group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  scene.add(group);
  return group;
}

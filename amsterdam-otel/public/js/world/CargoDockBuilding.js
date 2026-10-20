import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARGO_DOCK as D, CARGO_TYPES, CARGO_TYPE_IDS, TRAILER, PALLET } from '/shared/cargo.js';
import { StaticBatcher } from './StaticBatcher.js';
import { canvasTexture, drawConcrete, drawAsphalt, drawHazard, rng, signMaterial, panel } from './CarWorldKit.js';

/**
 * Mal Kabul Rampası geometrisi: mal kabul salonu (zemin y = 0), rampa kenarı + 2 rampa kapısı, yük asansörü
 * kabini, transpalet park yeri, sevkiyat ofisi ve aşağıdaki avlu (y = −1.25) + giriş kapısı.
 * Fizik 2B olduğu için avlu dünyanın ayrı bir köşesindedir (x 104..136, z 14..54); grup yalnızca oyuncu
 * oradayken görünür (UndergroundGarage alan yöneticisi).
 *
 * Pil: statik her şey StaticBatcher ile malzeme başına tek mesh; lambalar ışıksız MeshBasic (gerçek ışık
 * eklenmez). Hareketli parçalar (tırlar, paletler, transpaletler, asansör kapıları) küçük ayrı gruplardır.
 */

const H = D.hallH;
const Y = D.yardY;
const T = 0.22;
const flat = { cast: false, receive: false };

function drawBrick(g, w, h) {
  const r = rng(11);
  g.fillStyle = '#6e3b2a';
  g.fillRect(0, 0, w, h);
  const bh = h / 8;
  const bw = w / 4;
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let c = -1; c < 5; c++) {
      const v = Math.floor(r() * 30 - 15);
      g.fillStyle = `rgb(${132 + v},${66 + v / 2},${46 + v / 3})`;
      g.fillRect(c * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
}

function drawShutter(g, w, h) {
  g.fillStyle = '#9aa1a8';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 6) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, y, w, 1);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, y + 1, w, 1);
  }
}

export function cargoMaterials() {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const B = (o) => new THREE.MeshBasicMaterial(o);
  return {
    cFloor: L({ map: canvasTexture(256, 256, drawConcrete('#a5a7a6', 21, 0.18)), emissive: 0x2a2a2a }),
    cYard: L({ map: canvasTexture(256, 256, drawAsphalt('#3b3d40', 8)), emissive: 0x111214 }),
    cRoad: L({ map: canvasTexture(256, 256, drawAsphalt('#2f3033', 9)), emissive: 0x0d0d0f }),
    cWall: L({ color: 0xd9d4c7, emissive: 0x2f2d28 }),
    cBrick: L({ map: canvasTexture(128, 128, drawBrick), emissive: 0x1d0f0a }),
    cCeil: L({ color: 0x6f7378, emissive: 0x1a1b1c }),
    cConcrete: L({ map: canvasTexture(128, 128, drawConcrete('#8d8f91', 5, 0.3)), emissive: 0x1a1a1a }),
    cSteel: L({ color: 0x9aa3ab, emissive: 0x24272a }),
    cDark: L({ color: 0x24272b, emissive: 0x08090a }),
    cRubber: L({ color: 0x141414 }),
    cHazard: L({ map: canvasTexture(256, 32, drawHazard), emissive: 0x2a2208 }),
    cYellow: L({ color: 0xf2c230, emissive: 0x3a2e08 }),
    cWhite: L({ color: 0xf2f2f2, emissive: 0x3c3c3c }),
    cShutter: L({ map: canvasTexture(64, 128, drawShutter), emissive: 0x202326 }),
    cWood: L({ color: 0x9c6b3c, emissive: 0x24170c }),
    cGreen: L({ color: 0x2f6b3a, emissive: 0x0c1c0f }),
    cLamp: B({ color: 0xfff4d6 }),
    cGlow: B({ color: 0x9fe8ff }),
  };
}

/**
 * @returns {{ group, bayBlocks, trailerWalls, cabin, panelLight, screen }}
 *   bayBlocks[i]: rampa kapısını kapatan çarpışma kutusu (tır yanaşınca kapanır)
 *   trailerWalls[i]: yanaşmış dorsenin duvarları (yalnızca tır rampadayken etkin)
 */
export function buildCargoDock({ collision }) {
  const group = new THREE.Group();
  group.name = 'cargo-dock';
  const mats = cargoMaterials();
  const b = new StaticBatcher();
  const box = (m, x0, x1, y0, y1, z0, z1, o = flat) => b.box(m, x0, x1, y0, y1, z0, z1, o);
  const A = D.bounds;
  const HL = D.hall;
  const dz = D.dockZ;

  // ---- Avlu (aşağıda) ---------------------------------------------------------------------------
  b.floor('cYard', A.minX, A.maxX, A.minZ, dz, Y, { uvScale: 0.25, ...flat });
  b.floor('cRoad', A.maxX, D.road.farX + 10, D.yardGate.from - 1, D.yardGate.to + 1, Y - 0.01, { uvScale: 0.25, ...flat });
  // Yol çizgisi ve rampa şeritleri
  box('cWhite', A.maxX - 26, D.road.farX + 10, Y + 0.002, Y + 0.006, D.road.z - 0.06, D.road.z + 0.06);
  for (const bay of D.bays) {
    for (const s of [-1, 1]) box('cYellow', bay.x + s * 1.75 - 0.06, bay.x + s * 1.75 + 0.06, Y + 0.002, Y + 0.006, dz - 15, dz - 0.3);
    box('cWhite', bay.x - 1.75, bay.x + 1.75, Y + 0.002, Y + 0.006, dz - 15.06, dz - 14.94);
  }
  // Avlu duvarları (tuğla) ve doğudaki giriş kapısı açıklığı
  const yw = (x0, x1, z0, z1) => box('cBrick', x0, x1, Y, 4.6, z0, z1, { uvScale: 0.4, ...flat });
  yw(A.minX - 0.3, A.minX, A.minZ, dz);
  yw(A.minX - 0.3, A.maxX + 0.3, A.minZ - 0.3, A.minZ);
  yw(A.maxX, A.maxX + 0.3, A.minZ, D.yardGate.from);
  yw(A.maxX, A.maxX + 0.3, D.yardGate.to, dz);
  for (const z of [D.yardGate.from, D.yardGate.to]) box('cSteel', A.maxX - 0.1, A.maxX + 0.4, Y, 5.2, z - 0.25, z + 0.25);
  group.add(panel(signMaterial(['🚚 HOTEL DE TULP', 'Leveranciers · Tedarikçi girişi'], { bg: '#14324a', fg: '#ffffff', w: 512, h: 160 }), 4.2, 1.3, A.maxX - 0.36, 3.4, D.yardGate.to + 1.6, 'x-'));
  // Rampa yüzü: beton, tampon lastikler, sarı-siyah kenar şeridi
  box('cConcrete', A.minX, A.maxX, Y, 0, dz - 0.25, dz, { uvScale: 0.5, ...flat });
  box('cHazard', A.minX, A.maxX, -0.12, 0, dz - 0.27, dz - 0.25, flat);
  for (const bay of D.bays) {
    for (const s of [-1, 1]) box('cRubber', bay.x + s * 1.45 - 0.14, bay.x + s * 1.45 + 0.14, -0.95, -0.3, dz - 0.45, dz - 0.25);
    // Rampa köprüsü (dock leveler): dorseye uzanan çelik plaka
    box('cSteel', bay.x - 1.1, bay.x + 1.1, -0.04, 0.0, dz - 0.4, dz + 0.3);
  }

  // ---- Mal kabul salonu --------------------------------------------------------------------------
  b.floor('cFloor', HL.minX, HL.maxX, dz, HL.maxZ, 0, { uvScale: 0.5, ...flat });
  b.floor('cCeil', HL.minX, HL.maxX, dz, HL.maxZ, H, { facingDown: true, ...flat });
  const wall = (m, x0, x1, z0, z1, y0 = 0, y1 = H) => box(m, x0, x1, y0, y1, z0, z1, { uvScale: 0.5, ...flat });
  wall('cWall', HL.minX, HL.maxX, HL.maxZ - T, HL.maxZ); // kuzey (otelin depo tarafı)
  wall('cWall', HL.maxX - T, HL.maxX, dz, HL.maxZ); // doğu
  // Batı duvarı: Achterstraat kapısı (kapalı kanat, ışınlanma kapısı)
  const DZ = D.door.z;
  wall('cWall', HL.minX, HL.minX + T, dz, DZ - 0.7);
  wall('cWall', HL.minX, HL.minX + T, DZ + 0.7, HL.maxZ);
  wall('cWall', HL.minX, HL.minX + T, DZ - 0.7, DZ + 0.7, 2.25, H);
  box('cGreen', HL.minX + T - 0.02, HL.minX + T + 0.03, 0, 2.2, DZ - 0.62, DZ + 0.62);
  box('cSteel', HL.minX + T + 0.03, HL.minX + T + 0.07, 1.0, 1.06, DZ + 0.35, DZ + 0.5); // kol
  // Güney duvarı: rampa kapıları (açık panjur) arasında
  let x0 = HL.minX;
  for (const bay of D.bays) {
    wall('cWall', x0, bay.door.from, dz, dz + T);
    wall('cWall', bay.door.from, bay.door.to, dz, dz + T, bay.door.top, H);
    box('cShutter', bay.door.from, bay.door.to, bay.door.top - 0.45, bay.door.top, dz + 0.05, dz + 0.17, { uvScale: 0, ...flat }); // toplanmış panjur
    box('cYellow', bay.door.from - 0.12, bay.door.from, 0, bay.door.top, dz, dz + T + 0.02); // kapı pervazı
    box('cYellow', bay.door.to, bay.door.to + 0.12, 0, bay.door.top, dz, dz + T + 0.02);
    group.add(panel(signMaterial([bay.name.toUpperCase()], { bg: '#202a35', fg: '#ffd23f', w: 256, h: 64 }), 1.4, 0.35, bay.x, bay.door.top + 0.35, dz + T + 0.01, 'z+'));
    // Zeminde ikaz şeridi (rampa kenarı)
    box('cHazard', bay.door.from, bay.door.to, 0.002, 0.006, dz + T, dz + T + 0.3);
    x0 = bay.door.to;
  }
  wall('cWall', x0, HL.maxX, dz, dz + T);
  collision.add(HL.minX - 1, HL.maxX + 1, HL.maxZ - T, HL.maxZ + 1);
  collision.add(HL.minX - 1, HL.minX + T, dz - 1, HL.maxZ);
  collision.add(HL.maxX - T, HL.maxX + 1, dz - 1, HL.maxZ);
  x0 = HL.minX;
  for (const bay of D.bays) {
    collision.add(x0, bay.door.from, dz - 1, dz + T);
    x0 = bay.door.to;
  }
  collision.add(x0, HL.maxX, dz - 1, dz + T);
  // Rampa kapıları: tır yokken kapalı (avluya düşülmez)
  const bayBlocks = D.bays.map((bay) => collision.add(bay.door.from, bay.door.to, dz - 1, dz + 0.05));

  // Yürüme yolları (sarı çizgiler) + transpalet park yerleri
  box('cYellow', HL.minX + 0.8, HL.maxX - 0.8, 0.002, 0.005, dz + 1.9, dz + 1.98);
  box('cYellow', HL.minX + 0.8, HL.maxX - 0.8, 0.002, 0.005, HL.maxZ - 3.9, HL.maxZ - 3.82);
  for (const j of D.jacks) {
    for (const s of [-1, 1]) box('cYellow', j.x + s * 0.45 - 0.03, j.x + s * 0.45 + 0.03, 0.002, 0.005, j.z - 2.0, j.z + 0.5);
    box('cYellow', j.x - 0.45, j.x + 0.45, 0.002, 0.005, j.z + 0.47, j.z + 0.53);
  }
  group.add(panel(signMaterial(['🛻 TRANSPALET', 'E: al · Q: bırak'], { bg: '#2b2b2b', fg: '#ffd23f', w: 256, h: 96 }), 1.5, 0.56, (D.jacks[0].x + D.jacks[1].x) / 2, 2.2, HL.maxZ - T - 0.01, 'z-'));
  // Tavan lambaları
  for (let x = HL.minX + 4; x < HL.maxX - 2; x += 6) for (const z of [dz + 3.5, HL.maxZ - 4]) box('cLamp', x - 0.9, x + 0.9, H - 0.06, H - 0.02, z - 0.12, z + 0.12);
  // Büyük tabela (kuzey duvarı)
  group.add(panel(signMaterial(['MAL KABUL · GOEDERENONTVANGST', 'Hotel De Tulp — depo & yük asansörü'], { bg: '#14324a', fg: '#ffffff', w: 1024, h: 160 }), 7.4, 1.16, 128.5, 3.35, HL.maxZ - T - 0.01, 'z-'));

  // ---- Yük asansörü ------------------------------------------------------------------------------
  const E = D.elevator;
  const C = E.cabin;
  box('cSteel', C.minX - 0.2, C.minX, 0, H, C.minZ, C.maxZ);
  box('cSteel', C.maxX, C.maxX + 0.2, 0, H, C.minZ, C.maxZ);
  box('cSteel', C.minX - 0.2, E.door.from, 0, H, C.minZ - 0.2, C.minZ);
  box('cSteel', E.door.to, C.maxX + 0.2, 0, H, C.minZ - 0.2, C.minZ);
  box('cSteel', E.door.from, E.door.to, 2.6, H, C.minZ - 0.2, C.minZ);
  b.floor('cDark', C.minX, C.maxX, C.minZ, C.maxZ, 0.004);
  box('cHazard', E.door.from, E.door.to, 0.003, 0.007, C.minZ - 0.5, C.minZ - 0.2);
  collision.add(C.minX - 0.25, C.minX, C.minZ - 0.2, C.maxZ);
  collision.add(C.maxX, C.maxX + 0.25, C.minZ - 0.2, C.maxZ);
  collision.add(C.minX - 0.25, E.door.from, C.minZ - 0.25, C.minZ);
  collision.add(E.door.to, C.maxX + 0.25, C.minZ - 0.25, C.minZ);
  group.add(panel(signMaterial(['🛗 YÜK ASANSÖRÜ', 'Kabin: 2 palet → depo'], { bg: '#202a35', fg: '#9fe8ff', w: 384, h: 96 }), 2.2, 0.55, (C.minX + C.maxX) / 2, 3.1, C.minZ - 0.21, 'z-'));
  // Kapı kanatları (hareketli)
  const doorMat = mats.cSteel.clone();
  doorMat.color.set(0xb7bec5);
  const leafW = (E.door.to - E.door.from) / 2;
  const leafGeo = new THREE.BoxGeometry(leafW, 2.55, 0.05);
  const doorL = new THREE.Mesh(leafGeo, doorMat);
  const doorR = new THREE.Mesh(leafGeo, doorMat);
  for (const d of [doorL, doorR]) {
    d.position.set(0, 1.28, C.minZ - 0.08);
    group.add(d);
  }
  // Çağrı kolonu (gönder düğmesi + durum ışığı)
  const P = E.panel;
  box('cDark', P.x - 0.14, P.x + 0.14, 0, 1.25, P.z - 0.1, P.z + 0.1);
  box('cSteel', P.x - 0.17, P.x + 0.17, 1.25, 1.55, P.z - 0.13, P.z + 0.13);
  collision.add(P.x - 0.2, P.x + 0.2, P.z - 0.15, P.z + 0.15);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0x3ad16b });
  const panelLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.02), lightMat);
  panelLight.position.set(P.x, 1.42, P.z - 0.14);
  group.add(panelLight);
  group.add(panel(signMaterial(['GÖNDER ▲'], { bg: '#111', fg: '#3ad16b', w: 128, h: 48, border: false }), 0.3, 0.11, P.x, 1.29, P.z - 0.135, 'z-'));

  // ---- Sevkiyat ofisi (terminal) -----------------------------------------------------------------
  const O = D.office.desk;
  box('cWood', O.minX, O.maxX, 0.72, 0.78, O.minZ, O.maxZ);
  box('cDark', O.minX + 0.05, O.minX + 0.1, 0, 0.72, O.minZ + 0.05, O.maxZ - 0.05);
  box('cDark', O.maxX - 0.1, O.maxX - 0.05, 0, 0.72, O.minZ + 0.05, O.maxZ - 0.05);
  box('cDark', (O.minX + O.maxX) / 2 - 0.3, (O.minX + O.maxX) / 2 + 0.3, 0.8, 1.2, O.maxZ - 0.3, O.maxZ - 0.25);
  collision.add(O.minX, O.maxX, O.minZ, O.maxZ);
  const screen = panel(signMaterial(['📋 SEVKİYAT', 'Sipariş · Stok'], { bg: '#0d1b2a', fg: '#9fe8ff', glow: true, w: 256, h: 128, border: false }), 0.56, 0.36, (O.minX + O.maxX) / 2, 1.0, O.maxZ - 0.31, 'z-');
  group.add(screen);
  // Raflar (dekor) doğu duvarı boyunca
  for (let z = dz + 3; z < HL.maxZ - 5; z += 2.6) {
    box('cSteel', HL.maxX - T - 1.1, HL.maxX - T - 0.05, 0, 0.05, z, z + 1.9);
    for (const y of [0.9, 1.8, 2.7]) box('cSteel', HL.maxX - T - 1.1, HL.maxX - T - 0.05, y, y + 0.05, z, z + 1.9);
    for (const zz of [z, z + 1.85]) for (const xx of [HL.maxX - T - 1.1, HL.maxX - T - 0.1]) box('cDark', xx, xx + 0.05, 0, 2.8, zz, zz + 0.05);
    collision.add(HL.maxX - T - 1.15, HL.maxX - T, z - 0.05, z + 1.95);
    const r = rng(Math.round(z * 10));
    for (const y of [0.95, 1.85]) for (let k = 0; k < 3; k++) {
      const zz = z + 0.15 + k * 0.6;
      box(['cWood', 'cShutter', 'cGreen'][Math.floor(r() * 3)], HL.maxX - T - 1.0, HL.maxX - T - 0.2, y, y + 0.35 + r() * 0.3, zz, zz + 0.45);
    }
  }

  b.build(mats, group);

  // Dorse duvarları (tır yanaşınca etkin): yanlar + ön duvar
  const trailerWalls = D.bays.map((bay) => {
    const s = bay.inside;
    return [
      collision.add(s.minX - 0.15, s.minX, s.minZ - 0.2, dz, false),
      collision.add(s.maxX, s.maxX + 0.15, s.minZ - 0.2, dz, false),
      collision.add(s.minX - 0.15, s.maxX + 0.15, s.minZ - 0.2, s.minZ, false),
    ];
  });

  return { group, bayBlocks, trailerWalls, cabin: { doorL, doorR, leafW }, panelLight, screen };
}

// ---- Hareketli modeller ----------------------------------------------------------------------------

function boxGeo(x0, x1, y0, y1, z0, z1) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

function merged(parts) {
  const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of list) g.deleteAttribute('uv');
  return mergeGeometries(list, false);
}

/**
 * Tır (çekici + dorse). Yerel çerçeve: orijin dorse ortası, dorse tabanı y = 0, önü (çekici) −z.
 * Dorsenin arka kapıları açık (içi yürünebilir); yan panelde toptancı adı (sideCanvas yeniden çizilir).
 */
export function makeTruck(color = 0xe8e8e8) {
  const g = new THREE.Group();
  const L = TRAILER.length / 2;
  const w = TRAILER.halfW;
  const iw = TRAILER.innerHalfW;
  const h = TRAILER.height;
  const body = new THREE.MeshLambertMaterial({ color, emissive: 0x2a2a2a });
  const inner = new THREE.MeshLambertMaterial({ color: 0xc9cdd1, emissive: 0x4a4c4e, side: THREE.DoubleSide });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1d1f22 });
  const cabMat = new THREE.MeshLambertMaterial({ color: 0x1f5fa8, emissive: 0x0a1c33 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x223844, emissive: 0x0b1a22 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
  const red = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  // Dorse: dış kabuk (yanlar, tavan, ön) + iç kaplama + taban
  g.add(new THREE.Mesh(merged([
    boxGeo(-w, -iw, 0, h, -L, L), boxGeo(iw, w, 0, h, -L, L), boxGeo(-w, w, h - 0.1, h, -L, L), boxGeo(-w, w, 0, h, -L, -L + 0.1),
  ]), body));
  g.add(new THREE.Mesh(merged([
    boxGeo(-iw, -iw + 0.01, 0, h - 0.1, -L + 0.1, L), boxGeo(iw - 0.01, iw, 0, h - 0.1, -L + 0.1, L), boxGeo(-iw, iw, h - 0.11, h - 0.1, -L + 0.1, L),
    boxGeo(-iw, iw, 0, 0.01, -L + 0.1, L),
  ]), inner));
  // Şasi, tekerlekler (dorse arka aksları + çekici), açık arka kapılar, stop lambaları
  const wheel = (x, z) => new THREE.CylinderGeometry(0.5, 0.5, 0.36, 12).rotateZ(Math.PI / 2).translate(x, D.yardY + 0.5, z);
  const wheels = [];
  for (const z of [L - 1.6, L - 2.9, L - 4.2]) for (const s of [-1, 1]) wheels.push(wheel(s * 1.0, z));
  for (const z of [-L - 1.4, -L - 2.9, -L - 5.0]) for (const s of [-1, 1]) wheels.push(wheel(s * 1.0, z));
  g.add(new THREE.Mesh(merged([
    ...wheels,
    boxGeo(-0.9, 0.9, -0.55, 0, -L, L), // dorse şasisi
    boxGeo(-0.6, 0.6, D.yardY + 0.6, -0.6, -L - 6, -L + 1.2), // çekici şasisi
    boxGeo(-w - 0.04, -w, 0, h, L - 1.25, L), boxGeo(w, w + 0.04, 0, h, L - 1.25, L), // açık kapılar (yanlara katlı)
    boxGeo(-1.25, 1.25, -1.0, -0.6, L - 0.25, L), // tampon
  ]), dark));
  g.add(new THREE.Mesh(merged([boxGeo(-1.2, -0.9, -0.5, -0.32, L - 0.02, L + 0.01), boxGeo(0.9, 1.2, -0.5, -0.32, L - 0.02, L + 0.01)]), red));
  // Çekici kabini
  const cz0 = -L - 6.2;
  const cz1 = -L - 3.6;
  g.add(new THREE.Mesh(merged([boxGeo(-1.25, 1.25, D.yardY + 1.0, 2.35, cz0, cz1), boxGeo(-1.1, 1.1, 2.35, 2.8, cz0 + 0.3, cz1 - 0.2)]), cabMat));
  g.add(new THREE.Mesh(merged([boxGeo(-1.15, 1.15, 0.95, 2.05, cz0 - 0.02, cz0 + 0.02), boxGeo(-1.27, -1.23, 1.0, 2.0, cz0 + 0.3, cz1 - 0.6), boxGeo(1.23, 1.27, 1.0, 2.0, cz0 + 0.3, cz1 - 0.6)]), glass));
  g.add(new THREE.Mesh(merged([boxGeo(-1.1, -0.75, D.yardY + 1.25, D.yardY + 1.45, cz0 - 0.05, cz0), boxGeo(0.75, 1.1, D.yardY + 1.25, D.yardY + 1.45, cz0 - 0.05, cz0)]), lamp));
  // Yan reklam paneli (iki yanda): toptancı adı
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sideMat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x222222 });
  const sideGeo = new THREE.PlaneGeometry(TRAILER.length - 1.2, h - 0.6);
  const left = new THREE.Mesh(sideGeo, sideMat);
  left.position.set(-w - 0.01, h / 2, 0);
  left.rotation.y = -Math.PI / 2;
  const right = new THREE.Mesh(sideGeo, sideMat);
  right.position.set(w + 0.01, h / 2, 0);
  right.rotation.y = Math.PI / 2;
  g.add(left, right);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  const setSupplier = (name) => {
    const x = c.getContext('2d');
    x.fillStyle = '#f4f4f2';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#1f5fa8';
    x.fillRect(0, c.height - 34, c.width, 34);
    x.fillStyle = '#e8590c';
    x.fillRect(0, 0, 22, c.height);
    x.fillStyle = '#14324a';
    x.font = '800 78px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(`🚚 ${name}`, c.width / 2, 74, c.width - 60);
    x.fillStyle = '#ffffff';
    x.font = '700 22px system-ui, sans-serif';
    x.fillText('GROOTHANDEL · AMSTERDAM · leveringen aan Hotel De Tulp', c.width / 2, c.height - 17, c.width - 40);
    tex.needsUpdate = true;
  };
  setSupplier('Groothandel');
  return { obj: g, setSupplier };
}

/** Palet geometrileri / malzemeleri (tür başına) */
export function makePalletKit() {
  const base = merged([
    boxGeo(-PALLET.W / 2, PALLET.W / 2, 0.1, PALLET.H, -PALLET.L / 2, PALLET.L / 2),
    ...[-1, 0, 1].map((k) => boxGeo(k * 0.34 - 0.05, k * 0.34 + 0.05, 0, 0.1, -PALLET.L / 2, PALLET.L / 2)),
  ]);
  const load = boxGeo(-PALLET.W / 2 + 0.03, PALLET.W / 2 - 0.03, PALLET.H, PALLET.H + PALLET.LOAD_H, -PALLET.L / 2 + 0.04, PALLET.L / 2 - 0.04);
  const wood = new THREE.MeshLambertMaterial({ color: 0xb98a55, emissive: 0x2a1c0e });
  const loads = Object.create(null);
  for (const t of CARGO_TYPE_IDS) {
    const T = CARGO_TYPES[t];
    const tex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = T.color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2); // streç film
      g.fillStyle = '#fff';
      g.fillRect(w * 0.18, h * 0.3, w * 0.64, h * 0.4);
      g.font = '56px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(T.icon, w / 2, h / 2 + 2);
    }, { repeat: false });
    loads[t] = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x1c1c1c });
  }
  // Kutu yüzleri için UV gerekiyor: yük geometrisinde uv korunur
  return { base, load, wood, loads };
}

export function makePallet(kit, type) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(kit.base, kit.wood));
  const m = new THREE.Mesh(kit.load, kit.loads[type]);
  g.add(m);
  g.userData.load = m;
  return g;
}

/**
 * Transpalet (elektrikli, yaya kumandalı). Yerel çerçeve: orijin operatörün durduğu yer, çatallar ileride (−z).
 * forks: kaldırılınca y'si artan çatal grubu (taşınan palet buna bağlanır).
 */
export function makeJack(color = 0xe8590c) {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color, emissive: 0x2a1004 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1d1f22 });
  const steel = new THREE.MeshLambertMaterial({ color: 0xaab2ba, emissive: 0x22262a });
  g.add(new THREE.Mesh(merged([boxGeo(-0.36, 0.36, 0.06, 0.62, -0.62, -0.32), boxGeo(-0.3, 0.3, 0.62, 0.72, -0.6, -0.36)]), body));
  // Kumanda kolu (operatöre doğru eğik) + tutamak
  const arm = new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6).rotateX(-0.55).translate(0, 0.98, -0.32);
  const handle = new THREE.Mesh(merged([arm, boxGeo(-0.17, 0.17, 1.27, 1.33, -0.17, -0.11)]), dark);
  g.add(handle, new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10).rotateZ(Math.PI / 2).translate(0, 0.09, -0.47), dark));
  g.userData.handle = handle; // kendi transpaletimde (FPV) gizlenir: görüşü kapatmasın
  const forks = new THREE.Group();
  forks.add(new THREE.Mesh(merged([boxGeo(-0.28, -0.12, 0.03, 0.09, -1.72, -0.6), boxGeo(0.12, 0.28, 0.03, 0.09, -1.72, -0.6), boxGeo(-0.3, 0.3, 0.03, 0.4, -0.66, -0.6)]), steel));
  g.add(forks);
  g.userData.forks = forks;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

/** Achterstraat'ın batı ucundaki demir kapının üstüne "Mal Kabul" tabelası (otel dünyası) */
export function buildCityGateSign() {
  const G = D.cityGate;
  return panel(signMaterial(['🚚 MAL KABUL', 'Servis kapısı · rampa'], { bg: '#14324a', fg: '#ffffff', w: 384, h: 128 }), 1.5, 0.5, G.x + 0.02, 2.75, G.z, 'x+');
}

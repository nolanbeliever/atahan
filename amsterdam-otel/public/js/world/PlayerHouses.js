import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WALL_H, DOOR_H, ALLEY, PLAYER_HOUSES } from '/shared/layout.js';
import { UV } from './Materials.js';
import { drawPlanks, signDrawer } from './Textures.js';
import { addWindow, addPlanter, addBike, addTree, addStreetLamp } from './Props.js';

// Achterstraat ve oyuncu evleri (Huis 1–8).
// Otelin koridorunun sonundaki arka kapıdan çıkılan, gökyüzüne açık dar arka sokak;
// kuzeyinde 8 dar Amsterdam kanal evi. Evlerin içi boş gelir (sahibi dekore eder).
// Statik her şey otelin StaticBatcher'ına eklenir; yeni malzeme anahtarları az tutuldu:
//  - phFacade: köşe renkli (vertex color) tuğla → 8 evin ve komşu binaların farklı renkli
//              cepheleri, kaldırım klinkeri TEK draw call (derzler açık renk: küçük shader eki)
//  - phWall:   evlerin iç duvarları (buildWallSegments de kullanır)
//  - phFloor:  evlerin ahşap zemini (Bizim Ev'in dokusunu paylaşır, malzemesi ayrı)
//  - phPlates: isim levhaları + kapı üstü numaralar + tabelalar TEK doku atlasında
// Dinamik olan yalnızca kapı kanatları: 9 kapı (8 ev + otel arka kapısı) iki InstancedMesh
// (kanat + aksesuar) → en fazla 2 draw call. Gölge atmazlar.

const FACE = 33; // ev cephesinin duvar merkezi (z)
const OUT = FACE - 0.12; // 32.88: renkli cephe kaplamasının dış yüzü
const IN = FACE + 0.13; // 33.13: cephenin iç kaplamasının yüzü
const BACK = 26; // otel arka duvarının merkezi (z)
const BACK_OUT = BACK + 0.14; // 26.14: arka duvarın sokak tarafındaki tuğla kaplaması

const DOOR_OPEN = (Math.PI / 2) * 0.92;
const DOOR_SPEED = 2.6; // geçiş/sn (Bizim Ev kapısıyla aynı)
const LEAF_W = 1.03; // kapı boşluğu 1.1 m: iki yanda 3 cm kasa + aralık
const LEAF_H = 2.16;
const LEAF_T = 0.05;
const BACK_DOOR_RANGE = 2.4;

// Atlas bölgeleri, kare kanvas oranıyla: [x0, y0, x1, y1] (y aşağı doğru)
const ATLAS = Object.freeze({
  plate: (i) => [(i % 2) * 0.5, (i >> 1) * 0.125, (i % 2) * 0.5 + 0.5, (i >> 1) * 0.125 + 0.125], // 4:1 isim levhası
  transom: (i) => [(i % 4) * 0.25, 0.5 + (i >> 2) * 0.125, (i % 4) * 0.25 + 0.25, 0.625 + (i >> 2) * 0.125], // 2:1 kapı üstü camı
  alleySign: [0, 0.75, 0.5, 0.875], // koridor tarafı: '🏘 Achterstraat'
  hotelSign: [0.5, 0.75, 1, 0.875], // sokak tarafı: 'Hotel De Tulp · achteringang'
  streetSign: [0, 0.875, 0.5, 1], // sokak adı levhası
});

// Her evin karakteri: tuğla rengi, kapı rengi, tepe biçimi, gövde yüksekliği
const STYLES = Object.freeze([
  { brick: '#9a4630', door: '#1f4d3a', gable: 'step', body: 4.75, steps: 3 },
  { brick: '#e4dac2', door: '#23395b', gable: 'bell', body: 4.8 },
  { brick: '#5e3326', door: '#8f2420', gable: 'neck', body: 4.7 },
  { brick: '#b5603a', door: '#1f1f22', gable: 'step', body: 4.9, steps: 4 },
  { brick: '#3c3a38', door: '#d9a21b', gable: 'neck', body: 4.75 },
  { brick: '#7a3e34', door: '#1f5a5a', gable: 'bell', body: 4.7 },
  { brick: '#8b989c', door: '#7a1f23', gable: 'step', body: 4.8, steps: 3 },
  { brick: '#a7764f', door: '#2d4f7c', gable: 'neck', body: 4.85 },
]);

// Komşu binaların arka cepheleri (sokağın güneyi; otelin iki yanı)
const NEIGHBOURS = Object.freeze([
  { x0: -18.1, x1: -14.4, top: 7.2, tint: '#6b4a3a' },
  { x0: -14.4, x1: -11.0, top: 6.7, tint: '#a35a3c', door: -13.6 },
  { x0: -11.0, x1: -8.1, top: 7.6, tint: '#4a3a33', door: -9.6 },
  { x0: 8.1, x1: 11.6, top: 7.0, tint: '#7a3a2a', door: 10.0 },
  { x0: 11.6, x1: 15.0, top: 7.8, tint: '#7f8a78', door: 13.6 },
  { x0: 15.0, x1: 18.1, top: 6.9, tint: '#9c6b4a' },
]);
const HOTEL_TOP = 8.6; // otelin arka cephesi (ön cepheyle aynı yükseklik)
const END_TOP = 6.6; // sokağın iki ucundaki köşe binaları

// ---- Yardımcılar ------------------------------------------------------------

const _c = new THREE.Color();

/** Geometriye tek renkli köşe rengi ekler (phFacade / kapı geometrileri için) */
function tint(geo, hex, f = 1) {
  _c.set(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r * f;
    arr[i * 3 + 1] = _c.g * f;
    arr[i * 3 + 2] = _c.b * f;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function boxGeo(x0, x1, y0, y1, z0, z1) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Atlas bölgesini gösteren düzlem (UV'ler bölgeye sıkıştırılır) */
function atlasPlane(r, w, h) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  const e = 0.002; // komşu bölgeden renk sızmasın
  const u0 = r[0] + e;
  const u1 = r[2] - e;
  const v0 = 1 - r[3] + e;
  const v1 = 1 - r[1] - e;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Atlas bölgesine kırpılmış çizim (bölge içinde yerel koordinatlar) */
function inRegion(ctx, W, H, r, fn) {
  const x = Math.round(r[0] * W);
  const y = Math.round(r[1] * H);
  const w = Math.round(r[2] * W) - x;
  const h = Math.round(r[3] * H) - y;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  fn(w, h);
  ctx.restore();
}

const FACING = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 };
const SERIF = 'Georgia, "Times New Roman", serif';

// ---- Dokular -------------------------------------------------------------------

/**
 * Nötr tuğla dokusu: tuğlalar açık gri (renk köşe renginden gelir), derzler koyu.
 * phFacade shader'ı koyu pikselleri açık renkli harca çevirir → her renkte gerçekçi tuğla.
 */
function drawFacadeBrick(ctx, w, h, rnd) {
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, w, h);
  const rows = 8;
  const cols = 4;
  const bh = h / rows;
  const bw = w / cols;
  const m = Math.max(1, w / 110);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let c = -1; c < cols; c++) {
      const v = 212 + Math.floor(rnd() * 43);
      const warm = Math.floor(rnd() * 8);
      ctx.fillStyle = `rgb(${v},${v - warm},${v - warm * 2})`;
      ctx.fillRect(c * bw + off + m / 2, r * bh + m / 2, bw - m, bh - m);
    }
  }
}

// ---- Ana kurulum -------------------------------------------------------------------

/**
 * Achterstraat'ı ve 8 oyuncu evini kurar.
 * @returns {{ doors: Map, animateDoor: Function, setNameplate: Function, backDoor: object, updateBackDoor: Function }}
 */
export function buildPlayerHouses({ batcher: b, collision, scene, mats, factory, engine = null }) {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const B = (o) => new THREE.MeshBasicMaterial(o);

  // İsim levhaları (setNameplate ile değişir; atlas çizimi bu diziden okur)
  const owners = PLAYER_HOUSES.map(() => null);

  const facade = L({ map: factory.make(drawFacadeBrick, { seed: 61 }), vertexColors: true });
  // Derzler: dokudaki koyu pikseller köşe renginin açık, grimsi bir tonuna (harç) çevrilir
  facade.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#if defined( USE_COLOR ) && defined( USE_MAP )
        float brickMask = smoothstep( 0.12, 0.32, sampledDiffuseColor.g );
        vec3 mortar = mix( vColor.rgb, vec3( 0.56, 0.54, 0.5 ), 0.7 );
        diffuseColor.rgb = mix( mortar, diffuseColor.rgb * vColor.rgb, brickMask );
      #endif`,
    );
  };
  facade.customProgramCacheKey = () => 'phFacade';

  const atlas = factory.make((ctx, w, h) => drawAtlas(ctx, w, h), { w: 2, h: 2, repeat: false, minSize: 512, seed: 63 });

  Object.assign(mats, {
    phFacade: facade,
    phWall: L({ color: 0xfff1d8, emissive: 0x2e2418 }), // sıcak açık ton; hafif öz ışık gölgede kalan duvarları kirletmesin
    phFloor: L({
      map: mats.houseFloor?.map ?? factory.make((ctx, w, h, rnd) => drawPlanks(ctx, w, h, rnd, '#c9a074'), { seed: 64 }),
      color: 0xf6ebdc,
    }),
    phPlates: B({ map: atlas }),
    phDoor: L({ vertexColors: true }),
    phDoorFit: L({ vertexColors: true }),
  });

  const flat = { cast: false };
  const noShadow = { cast: false, receive: false };
  const brickUV = { cast: false, uvScale: UV.brick };

  /** Renkli tuğla kutusu (phFacade) */
  const fbox = (hex, x0, x1, y0, y1, z0, z1, uvScale = UV.brick) => b.add('phFacade', tint(boxGeo(x0, x1, y0, y1, z0, z1), hex), { cast: false, uvScale });
  /** Atlas tabelası: (x, y, z) merkez, yüzü `facing` yönüne bakar */
  const sign = (r, w, h, x, y, z, facing) => b.add('phPlates', atlasPlane(r, w, h), { ...noShadow, position: [x, y, z], rotation: [0, FACING[facing], 0] });

  buildAlley();
  PLAYER_HOUSES.forEach((h, i) => buildHouse(h, i));
  const { doors, backDoor } = buildDoors();

  // ---- Achterstraat ------------------------------------------------------------
  function buildAlley() {
    const { minX, maxX, minZ } = ALLEY.bounds;
    const bd = ALLEY.backDoor;

    // Zemin: parke taşı; evlerin önünde klinker kaldırım (tavan yok → gökyüzü görünür)
    b.floor('cobble', minX, maxX, minZ, OUT, 0, { uvScale: UV.cobble });
    fbox('#8a6656', minX + 0.1, maxX - 0.1, 0, 0.02, 32.3, OUT, 1.25);
    b.box('stone', minX + 0.1, maxX - 0.1, 0, 0.02, 32.27, 32.3, flat); // kaldırım taşı

    // ---- Otelin arka cephesi (sokak tarafı tuğla; kapı boşluğu açık) ------------------
    b.box('brick', -8.1, bd.from, 0, WALL_H, BACK + 0.1, BACK_OUT, brickUV);
    b.box('brick', bd.to, 8.1, 0, WALL_H, BACK + 0.1, BACK_OUT, brickUV);
    b.box('brick', bd.from, bd.to, DOOR_H, WALL_H, BACK + 0.1, BACK_OUT, brickUV);
    // Üst katlar (dekoratif, çarpışmasız): ön cepheyle aynı yükseklik ve pencere düzeni
    b.box('brick', -8.1, 8.1, WALL_H, HOTEL_TOP, BACK - 0.04, BACK_OUT, brickUV);
    b.box('white', -8.2, 8.2, WALL_H - 0.02, WALL_H + 0.12, BACK_OUT, BACK_OUT + 0.06, flat);
    b.box('white', -8.2, 8.2, HOTEL_TOP - 0.12, HOTEL_TOP + 0.05, BACK_OUT - 0.1, BACK_OUT + 0.08, flat);
    for (const y of [4.9, 7.1]) {
      for (const x of [-6, -3, 0, 3, 6]) addWindow(b, { x, y, z: BACK_OUT, w: 1.1, h: 1.5, facing: 'z+' });
    }
    // Otelin yan duvarları komşulardan yüksekte kalan kısımda (sokaktan çapraz bakınca boşluk görünmesin)
    b.box('brick', -8.1, -7.9, 7.0, HOTEL_TOP, 21.5, BACK - 0.04, brickUV);
    b.box('brick', 7.9, 8.1, 6.6, HOTEL_TOP, 21.5, BACK - 0.04, brickUV);
    // Yağmur iniş boruları
    for (const x of [-7.92, 7.92]) b.add('metal', new THREE.CylinderGeometry(0.045, 0.045, HOTEL_TOP, 6), { position: [x, HOTEL_TOP / 2, BACK_OUT + 0.06] });

    // ---- Otel arka kapısı: kasa, pervaz, eşik, tabelalar, aplikler -------------------
    const casing = (z0, z1) => {
      b.box('white', bd.from - 0.12, bd.from, 0, DOOR_H + 0.12, z0, z1, flat);
      b.box('white', bd.to, bd.to + 0.12, 0, DOOR_H + 0.12, z0, z1, flat);
      b.box('white', bd.from - 0.12, bd.to + 0.12, DOOR_H, DOOR_H + 0.12, z0, z1, flat);
    };
    casing(BACK - 0.14, BACK - 0.1); // koridor tarafı
    casing(BACK_OUT, BACK_OUT + 0.04); // sokak tarafı
    // Boşluğun içi (duvar kesitini örten pervaz)
    b.box('white', bd.from, bd.from + 0.03, 0, DOOR_H, BACK - 0.1, BACK_OUT, flat);
    b.box('white', bd.to - 0.03, bd.to, 0, DOOR_H, BACK - 0.1, BACK_OUT, flat);
    b.box('white', bd.from, bd.to, DOOR_H - 0.03, DOOR_H, BACK - 0.1, BACK_OUT, flat);
    b.box('stone', bd.from, bd.to, 0, 0.015, BACK - 0.1, BACK_OUT, flat);
    b.box('stone', bd.from - 0.3, bd.to + 0.3, 0, 0.05, BACK_OUT, BACK_OUT + 0.45, flat);
    sign(ATLAS.alleySign, 1.12, 0.28, 0, 2.62, BACK - 0.145, 'z-');
    sign(ATLAS.hotelSign, 1.3, 0.325, 0, 2.66, BACK_OUT + 0.005, 'z+');
    addWallLantern(b, bd.from - 0.42, 2.2, BACK_OUT, 1);
    addWallLantern(b, bd.to + 0.42, 2.2, BACK_OUT, 1);
    sign(ATLAS.streetSign, 0.84, 0.21, 2.6, 2.7, BACK_OUT + 0.005, 'z+');
    sign(ATLAS.streetSign, 0.84, 0.21, 17.895, 2.7, 29.5, 'x-');
    sign(ATLAS.streetSign, 0.84, 0.21, -17.895, 2.7, 29.5, 'x+');

    // ---- Komşu binaların arka cepheleri (güney) ----------------------------------
    for (const n of NEIGHBOURS) {
      fbox(n.tint, n.x0, n.x1, 0, n.top, BACK - 0.1, BACK + 0.12);
      b.box('white', n.x0, n.x1, n.top - 0.1, n.top + 0.04, BACK + 0.04, BACK + 0.2, flat);
      const cols = Math.max(1, Math.round((n.x1 - n.x0) / 1.7));
      const step = (n.x1 - n.x0) / cols;
      for (let k = 0; k < cols; k++) {
        const x = n.x0 + step * (k + 0.5);
        addWindow(b, { x, y: 4.35, z: BACK + 0.12, w: 0.9, h: 1.15, facing: 'z+' });
        if (n.top > 6.9) addWindow(b, { x, y: 6.05, z: BACK + 0.12, w: 0.9, h: 1.0, facing: 'z+' });
      }
      if (n.door !== undefined) {
        // Kullanılmayan arka kapı (dekor): kasa, kulp, basamak
        b.box('paintGreen', n.door - 0.48, n.door + 0.48, 0, 2.1, BACK + 0.12, BACK + 0.15);
        b.box('white', n.door - 0.56, n.door + 0.56, 2.1, 2.2, BACK + 0.12, BACK + 0.16, flat);
        b.box('brass', n.door + 0.32, n.door + 0.37, 0.98, 1.04, BACK + 0.15, BACK + 0.19, flat);
        b.box('stone', n.door - 0.6, n.door + 0.6, 0, 0.05, BACK + 0.12, BACK + 0.5, flat);
      }
    }
    // Komşular arasındaki yükseklik farkları: taşan yan duvarlar (sokaktan çapraz görünür)
    for (let k = 0; k < NEIGHBOURS.length - 1; k++) {
      const a = NEIGHBOURS[k];
      const c = NEIGHBOURS[k + 1];
      if (a.x1 !== c.x0) continue;
      const hi = a.top > c.top ? a : c;
      const lo = hi === a ? c : a;
      fbox(hi.tint, a.x1 - 0.1, a.x1 + 0.1, lo.top, hi.top, 22.5, BACK - 0.1);
    }

    // ---- Sokağın iki ucu: köşe binalarının yan duvarları ------------------------------
    for (const s of [-1, 1]) {
      const xIn = s * (maxX - 0.1);
      const xOut = s * (maxX + 0.1);
      b.box('brick', Math.min(xIn, xOut), Math.max(xIn, xOut), WALL_H, END_TOP, minZ - 0.1, FACE + 0.1, brickUV);
      // Evlerin cephe hattında köşe binası (Huis 1'in batısı / Huis 8'in doğusu)
      const xh = s * 16.8;
      b.box('brick', Math.min(xh, xOut), Math.max(xh, xOut), WALL_H, END_TOP, FACE - 0.1, FACE + 0.1, brickUV);
      b.box('brick', Math.min(xh, xh + s * 0.2), Math.max(xh, xh + s * 0.2), WALL_H, END_TOP, FACE - 0.1, 36.5, brickUV);
      b.box('white', Math.min(xIn, xOut) - 0.02, Math.max(xIn, xOut) + 0.02, END_TOP - 0.1, END_TOP + 0.04, minZ - 0.1, FACE + 0.1, flat);
      const face = s < 0 ? 'x+' : 'x-';
      for (const z of [28.0, 31.0]) addWindow(b, { x: xIn, y: 4.6, z, w: 0.9, h: 1.15, facing: face });
      addGate(b, xIn, 29.5, s);
    }

    // ---- Sokak eşyaları (statik) ----------------------------------------------------
    // Otel kapısının iki yanında Delft saksıları
    addPlanter(b, collision, bd.from - 0.5, BACK_OUT + 0.33, 1);
    addPlanter(b, collision, bd.to + 0.5, BACK_OUT + 0.33, 2);
    // Sokak lambaları (güney kenar)
    addStreetLamp(b, collision, -12.6, 26.48);
    addStreetLamp(b, collision, 12.6, 26.48);
    // Bisikletler duvara dayalı
    addBike(b, collision, -5.4, 26.55, 0, 'paintGreen');
    addBike(b, collision, -7.35, 26.55, Math.PI, 'fabricBlue');
    addBike(b, collision, 5.7, 26.55, Math.PI, 'black');
    addBike(b, collision, 15.1, 26.55, 0, 'fabricRed');
    // Bank (otel duvarının önünde)
    addBench(b, collision, -3.3, 26.42);
    // Çiçek kasaları
    addFlowerCrate(b, collision, -10.9, 26.36, 3);
    addFlowerCrate(b, collision, 11.3, 26.36, 5);
    // Köşelerde küçük ağaçlar (taş çerçeveli toprak)
    for (const x of [-16.45, 16.45]) {
      addTree(b, collision, x, 27.6, 0.62);
      b.floor('soil', x - 0.45, x + 0.45, 27.15, 28.05, 0.012);
      for (const [x0, x1, z0, z1] of [[-0.5, 0.5, -0.5, -0.45], [-0.5, 0.5, 0.45, 0.5], [-0.5, -0.45, -0.45, 0.45], [0.45, 0.5, -0.45, 0.45]]) {
        b.box('stone', x + x0, x + x1, 0, 0.06, 27.6 + z0, 27.6 + z1, flat);
      }
    }
  }

  // ---- Oyuncu evi ------------------------------------------------------------------
  function buildHouse(h, i) {
    const st = STYLES[i % STYLES.length];
    const { minX, maxX } = h.bounds;
    const X = (minX + maxX) / 2;
    const d = h.door;
    const dcx = (d.from + d.to) / 2;
    const winX = minX + 3.22; // kapının sağındaki pencere
    const winW = 1.15;
    const col = st.brick;

    // ---- İç mekân -------------------------------------------------------------
    b.floor('phFloor', minX, maxX, FACE - 0.1, h.bounds.maxZ, 0, { uvScale: UV.floorRoom });
    b.floor('ceiling', minX, maxX, FACE, h.bounds.maxZ, WALL_H, { facingDown: true, cast: false, receive: false });
    // Cephenin iç yüzü (kapı boşluğu açık kalır)
    b.box('phWall', minX + 0.1, d.from, 0, WALL_H, FACE + 0.1, IN);
    b.box('phWall', d.to, maxX - 0.1, 0, WALL_H, FACE + 0.1, IN);
    b.box('phWall', d.from, d.to, DOOR_H, WALL_H, FACE + 0.1, IN);
    // Süpürgelik (2 cm; yerleşim alanının kenarına kadar)
    const sk = { cast: false, uvScale: UV.wood };
    const z1 = h.bounds.maxZ - 0.1;
    b.box('wood', minX + 0.1, maxX - 0.1, 0, 0.1, z1 - 0.02, z1, sk);
    b.box('wood', minX + 0.1, minX + 0.12, 0, 0.1, IN, z1 - 0.02, sk);
    b.box('wood', maxX - 0.12, maxX - 0.1, 0, 0.1, IN, z1 - 0.02, sk);
    b.box('wood', minX + 0.12, d.from - 0.1, 0, 0.1, IN, IN + 0.02, sk);
    b.box('wood', d.to + 0.1, maxX - 0.12, 0, 0.1, IN, IN + 0.02, sk);
    // İç kapı pervazı
    b.box('white', d.from - 0.1, d.from, 0, DOOR_H + 0.1, IN, IN + 0.025, flat);
    b.box('white', d.to, d.to + 0.1, 0, DOOR_H + 0.1, IN, IN + 0.025, flat);
    b.box('white', d.from - 0.1, d.to + 0.1, DOOR_H, DOOR_H + 0.1, IN, IN + 0.025, flat);
    // İçeriden pencere (gün ışığı); yerleşim alanı (h.inner) bilerek boş bırakılır
    addWindow(b, { x: winX, y: 1.6, z: IN, w: winW, h: 1.45, facing: 'z+', glass: 'glassDay' });
    // Tavan lambası (sarkıt)
    const lz = (FACE + h.bounds.maxZ) / 2;
    b.add('black', new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4), { ...noShadow, position: [X, WALL_H - 0.21, lz] });
    b.add('brass', new THREE.ConeGeometry(0.2, 0.16, 12, 1, true), { ...noShadow, position: [X, WALL_H - 0.47, lz] });
    b.add('lamp', new THREE.SphereGeometry(0.075, 8, 6), { ...noShadow, position: [X, WALL_H - 0.55, lz] });

    // ---- Dış cephe: zemin kat (renkli tuğla kaplama, kapı boşluğu açık) ----------------
    fbox(col, minX, d.from, 0, WALL_H, OUT, FACE - 0.1);
    fbox(col, d.to, maxX, 0, WALL_H, OUT, FACE - 0.1);
    fbox(col, d.from, d.to, DOOR_H, WALL_H, OUT, FACE - 0.1);
    // Taş subasman
    b.box('stone', minX, d.from - 0.12, 0, 0.32, OUT - 0.02, OUT, flat);
    b.box('stone', d.to + 0.12, maxX, 0, 0.32, OUT - 0.02, OUT, flat);
    // Kapı kasası, boşluk pervazı, eşik, basamak
    b.box('white', d.from - 0.12, d.from, 0, DOOR_H + 0.12, OUT - 0.04, OUT, flat);
    b.box('white', d.to, d.to + 0.12, 0, DOOR_H + 0.12, OUT - 0.04, OUT, flat);
    b.box('white', d.from - 0.12, d.to + 0.12, DOOR_H, DOOR_H + 0.12, OUT - 0.04, OUT, flat);
    b.box('white', d.from, d.from + 0.03, 0, DOOR_H, OUT, IN, flat);
    b.box('white', d.to - 0.03, d.to, 0, DOOR_H, OUT, IN, flat);
    b.box('white', d.from, d.to, DOOR_H - 0.03, DOOR_H, OUT, IN, flat);
    b.box('stone', d.from, d.to, 0, 0.015, OUT, IN, flat);
    b.box('stone', d.from - 0.22, d.to + 0.22, 0, 0.07, 32.48, OUT, flat);
    // Kapı üstü camı (bovenlicht) — ev numarası atlasta
    b.box('white', dcx - 0.46, dcx + 0.46, 2.36, 2.88, OUT - 0.03, OUT, flat);
    sign(ATLAS.transom(i), 0.8, 0.4, dcx, 2.62, OUT - 0.034, 'z-');
    // Pencere + çiçek kutusu
    addWindow(b, { x: winX, y: 1.6, z: OUT, w: winW, h: 1.45, facing: 'z-' });
    addWindowBox(b, winX, winW, 0.8, OUT, i * 7 + 1);
    // Zil (pirinç düğme) ve isim levhası
    const [bx] = h.bell;
    b.box('black', bx - 0.035, bx + 0.035, 1.18, 1.32, OUT - 0.012, OUT, flat);
    b.add('brass', new THREE.CylinderGeometry(0.019, 0.019, 0.016, 10), { ...flat, position: [bx, 1.25, OUT - 0.018], rotation: [Math.PI / 2, 0, 0] });
    const px = bx + 0.205;
    b.box('brass', px - 0.26, px + 0.26, 1.465, 1.615, OUT - 0.012, OUT, flat);
    sign(ATLAS.plate(i), 0.5, 0.125, px, 1.54, OUT - 0.014, 'z-');
    // Kapı yanında fener
    addWallLantern(b, d.from - 0.38, 2.15, OUT, -1);
    // Cephe bahçesi: hatmi çiçekleri (evler arasındaki köşede)
    addHollyhock(b, collision, minX + 0.13, 32.62, i * 13 + 5);

    // ---- Dış cephe: üst kat + tepe (dekoratif, çarpışmasız) ---------------------------
    const top = st.body;
    b.box('white', minX, maxX, WALL_H - 0.02, WALL_H + 0.1, OUT - 0.04, OUT, flat);
    fbox(col, minX, maxX, WALL_H, top, OUT, FACE + 0.1);
    for (const x of [X - 0.95, X + 0.95]) addWindow(b, { x, y: (WALL_H + top) / 2 + 0.06, z: OUT, w: 0.92, h: top - WALL_H - 0.5, facing: 'z-' });
    b.box('white', minX + 0.03, maxX - 0.03, top - 0.03, top + 0.07, OUT - 0.05, FACE + 0.1, flat);
    if (st.gable === 'step') stepGable(X, top, col, st.steps);
    else if (st.gable === 'bell') bellGable(X, top, col);
    else neckGable(X, top, col);
  }

  /** Basamaklı tepe (trapgevel): her basamağın omzunda beyaz taş başlık */
  function stepGable(X, y0, col, steps) {
    const sh = steps > 3 ? 0.3 : 0.36;
    const widths = steps > 3 ? [3.6, 2.8, 2.0, 1.2] : [3.4, 2.4, 1.4];
    widths.forEach((w, k) => {
      const ya = y0 + k * sh;
      const yb = ya + sh;
      fbox(col, X - w / 2, X + w / 2, ya, yb, OUT, FACE + 0.1);
      const next = widths[k + 1];
      if (next) {
        for (const s of [-1, 1]) {
          const xa = X + s * (w / 2 + 0.03);
          const xb = X + s * (next / 2);
          b.box('white', Math.min(xa, xb), Math.max(xa, xb), yb - 0.01, yb + 0.05, OUT - 0.03, FACE + 0.12, flat);
        }
      } else {
        b.box('white', X - w / 2 - 0.03, X + w / 2 + 0.03, yb - 0.01, yb + 0.05, OUT - 0.03, FACE + 0.12, flat);
        b.box('white', X - 0.06, X + 0.06, yb + 0.05, yb + 0.25, OUT + 0.02, OUT + 0.14, flat);
      }
    });
    addWindow(b, { x: X, y: y0 + sh * 1.45, z: OUT, w: 0.5, h: 0.55, facing: 'z-' });
  }

  /** Çan biçimli tepe (klokgevel): beyaz kenar silmesi arkada, 2 cm geride */
  function bellGable(X, y0, col) {
    const shape = (a, c, H, arch) => {
      const s = new THREE.Shape();
      s.moveTo(-a, 0);
      s.bezierCurveTo(-a, H * 0.55, -c - 0.05, H * 0.45, -c, H);
      s.bezierCurveTo(-c, H + arch * 1.33, c, H + arch * 1.33, c, H);
      s.bezierCurveTo(c + 0.05, H * 0.45, a, H * 0.55, a, 0);
      s.lineTo(-a, 0);
      return s;
    };
    const ex = { bevelEnabled: false, curveSegments: 10 };
    const brick = new THREE.ExtrudeGeometry(shape(1.7, 0.6, 1.0, 0.36), { ...ex, depth: FACE + 0.1 - OUT });
    b.add('phFacade', tint(brick, col), { cast: false, uvScale: UV.brick, position: [X, y0, OUT] });
    const rim = new THREE.ExtrudeGeometry(shape(1.78, 0.67, 1.04, 0.4), { ...ex, depth: 0.16 });
    b.add('white', rim, { ...flat, position: [X, y0, OUT + 0.02] });
    b.box('white', X - 0.07, X + 0.07, y0 + 1.36, y0 + 1.5, OUT - 0.03, OUT + 0.12, flat); // tepe taşı
    addWindow(b, { x: X, y: y0 + 0.52, z: OUT, w: 0.55, h: 0.62, facing: 'z-' });
  }

  /** Boyunlu tepe (halsgevel): kıvrımlı omuzlar, üstte beyaz alınlık ve vinç kirişi */
  function neckGable(X, y0, col) {
    const shape = (a, c, H, hs) => {
      const s = new THREE.Shape();
      s.moveTo(-a, 0);
      s.quadraticCurveTo(-a + 0.05, hs * 0.95, -c, hs);
      s.lineTo(-c, H);
      s.lineTo(c, H);
      s.lineTo(c, hs);
      s.quadraticCurveTo(a - 0.05, hs * 0.95, a, 0);
      s.lineTo(-a, 0);
      return s;
    };
    const H = 1.25;
    const ex = { bevelEnabled: false, curveSegments: 10 };
    const brick = new THREE.ExtrudeGeometry(shape(1.85, 0.75, H, 0.62), { ...ex, depth: FACE + 0.1 - OUT });
    b.add('phFacade', tint(brick, col), { cast: false, uvScale: UV.brick, position: [X, y0, OUT] });
    const rim = new THREE.ExtrudeGeometry(shape(1.92, 0.81, H, 0.66), { ...ex, depth: 0.16 });
    b.add('white', rim, { ...flat, position: [X, y0, OUT + 0.02] });
    // Alınlık (üçgen) + silme
    b.box('white', X - 0.88, X + 0.88, y0 + H - 0.02, y0 + H + 0.06, OUT - 0.05, FACE + 0.12, flat);
    const ped = new THREE.Shape();
    ped.moveTo(-0.86, 0);
    ped.lineTo(0, 0.42);
    ped.lineTo(0.86, 0);
    ped.lineTo(-0.86, 0);
    b.add('white', new THREE.ExtrudeGeometry(ped, { bevelEnabled: false, depth: 0.2 }), { ...flat, position: [X, y0 + H + 0.06, OUT - 0.04] });
    // Pencere ve vinç kirişi (hijsbalk)
    addWindow(b, { x: X, y: y0 + 0.66, z: OUT, w: 0.6, h: 0.64, facing: 'z-' });
    b.box('wood', X - 0.045, X + 0.045, y0 + 1.1, y0 + 1.19, OUT - 0.5, OUT, { cast: false, uvScale: UV.wood });
    b.box('black', X - 0.012, X + 0.012, y0 + 0.98, y0 + 1.1, OUT - 0.46, OUT - 0.43, flat);
  }

  // ---- Kapılar (dinamik, 2 InstancedMesh) -------------------------------------------
  function buildDoors() {
    const specs = PLAYER_HOUSES.map((h, i) => ({ x: h.door.from + 0.035, z: FACE + 0.065, color: STYLES[i % STYLES.length].door }));
    // Otel arka kapısı: 180° çevrik takılır (dış yüzü — koyu cam, mektup yarığı — sokağa bakar),
    // menteşe doğu kenarında; sokağa doğru açılır. Kanat sokak yüzüyle hizalı.
    specs.push({ x: ALLEY.backDoor.to - 0.035, z: BACK_OUT - 0.03, color: '#1f4d3a', base: Math.PI });
    const n = specs.length;
    const leaves = new THREE.InstancedMesh(leafGeometry(), mats.phDoor, n);
    const fittings = new THREE.InstancedMesh(fittingsGeometry(), mats.phDoorFit, n);
    leaves.name = 'playerHouses:doors';
    fittings.name = 'playerHouses:doorFittings';
    const meshes = [leaves, fittings];
    const color = new THREE.Color();

    const pivots = specs.map((s, i) => {
      leaves.setColorAt(i, color.set(s.color));
      const pivot = new THREE.Object3D();
      pivot.position.set(s.x, 0, s.z);
      pivot.rotation.y = s.base ?? 0;
      pivot.matrixAutoUpdate = false;
      // updateMatrix kapının örnek (instance) matrisini de yazar: dışarıdan
      // pivot.rotation.y değiştirilip pivot.updateMatrix() çağrılırsa da çalışır
      pivot.updateMatrix = function updateDoorMatrix() {
        THREE.Object3D.prototype.updateMatrix.call(this);
        for (const m of meshes) {
          m.setMatrixAt(i, this.matrix);
          m.instanceMatrix.needsUpdate = true;
        }
      };
      pivot.updateMatrix();
      return pivot;
    });
    for (const m of meshes) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.computeBoundingSphere();
      m.boundingSphere.radius += LEAF_W + 0.2; // açılan kanatlar da kapsansın
      scene.add(m);
    }
    leaves.instanceColor.needsUpdate = true;

    const doorMap = new Map();
    PLAYER_HOUSES.forEach((h, i) => {
      const collider = collision.add(h.door.from, h.door.to, FACE - 0.1, FACE + 0.1, true);
      doorMap.set(h.id, { pivot: pivots[i], t: 0, collider });
    });
    return { doors: doorMap, backDoor: { pivot: pivots[n - 1], t: 0 } };
  }

  // ---- Atlas çizimi ---------------------------------------------------------------
  function drawAtlas(ctx, W, H) {
    ctx.fillStyle = '#2a2f33';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < PLAYER_HOUSES.length; i++) {
      drawPlate(ctx, W, H, i);
      drawTransom(ctx, W, H, i);
    }
    inRegion(ctx, W, H, ATLAS.alleySign, (w, h) => signDrawer({ title: '🏘 Achterstraat', sub: 'Huis 1–8 · oyuncu evleri', bg: '#1f3b5a' })(ctx, w, h));
    inRegion(ctx, W, H, ATLAS.hotelSign, (w, h) => signDrawer({ title: 'Hotel De Tulp', sub: 'achteringang · arka giriş' })(ctx, w, h));
    inRegion(ctx, W, H, ATLAS.streetSign, (w, h) => drawStreetSign(ctx, w, h));
  }

  function drawPlate(ctx, W, H, i) {
    inRegion(ctx, W, H, ATLAS.plate(i), (w, h) => {
      const o = owners[i];
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#e9cd8a');
      g.addColorStop(0.5, '#bf9a55');
      g.addColorStop(1, '#8f6d36');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const m = Math.max(2, h * 0.1);
      ctx.fillStyle = o ? '#f8f3e7' : '#e6dfd1';
      ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
      // Köşe vidaları
      ctx.fillStyle = '#9c7a3f';
      for (const x of [m * 0.5, w - m * 0.5]) {
        ctx.beginPath();
        ctx.arc(x, h / 2, m * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textBaseline = 'middle';
      const label = `Huis ${i + 1} · ${o ? o.name : 'boş'}`;
      if (o) {
        // Çevrimiçi: yeşil nokta; çevrimdışı: gri
        const r = h * 0.17;
        const cx = m + h * 0.36;
        ctx.beginPath();
        ctx.arc(cx, h / 2, r, 0, Math.PI * 2);
        ctx.fillStyle = o.online ? '#22b25f' : '#a39d92';
        ctx.fill();
        ctx.lineWidth = Math.max(1, h * 0.04);
        ctx.strokeStyle = o.online ? '#0f6b36' : '#7d776d';
        ctx.stroke();
        const x0 = cx + r + h * 0.16;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#1f3b5a';
        ctx.font = `700 ${Math.round(h * 0.44)}px ${SERIF}`;
        ctx.fillText(label, x0, h * 0.53, w - x0 - m * 1.6);
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7a7164';
        ctx.font = `italic 600 ${Math.round(h * 0.42)}px ${SERIF}`;
        ctx.fillText(label, w / 2, h * 0.53, w - m * 4);
      }
    });
  }

  function drawTransom(ctx, W, H, i) {
    inRegion(ctx, W, H, ATLAS.transom(i), (w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#3b4e59');
      g.addColorStop(1, '#18232a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Yelpaze kayıtları
      ctx.strokeStyle = 'rgba(242,239,232,0.85)';
      ctx.lineWidth = Math.max(1, h * 0.035);
      ctx.beginPath();
      for (const f of [0.18, 0.82]) {
        ctx.moveTo(w / 2, h);
        ctx.lineTo(w * f, 0);
      }
      ctx.stroke();
      // Cam parıltısı
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.moveTo(w * 0.05, h);
      ctx.lineTo(w * 0.3, 0);
      ctx.lineTo(w * 0.42, 0);
      ctx.lineTo(w * 0.17, h);
      ctx.fill();
      // Altın varaklı ev numarası
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(h * 0.7)}px ${SERIF}`;
      ctx.lineWidth = Math.max(1, h * 0.05);
      ctx.strokeStyle = 'rgba(40,24,8,0.8)';
      ctx.strokeText(String(i + 1), w / 2, h * 0.56);
      ctx.fillStyle = '#efc86a';
      ctx.fillText(String(i + 1), w / 2, h * 0.56);
    });
  }

  /** Amsterdam sokak levhası: beyaz emaye, koyu mavi kenar, üç Andreas haçı */
  function drawStreetSign(ctx, w, h) {
    ctx.fillStyle = '#1f3b5a';
    ctx.fillRect(0, 0, w, h);
    const m = Math.max(2, h * 0.09);
    ctx.fillStyle = '#f7f5ef';
    ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
    ctx.strokeStyle = '#c8202f';
    ctx.lineWidth = Math.max(1, h * 0.05);
    const s = h * 0.09;
    const cx = m + h * 0.38;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const cy = h * (0.27 + k * 0.23);
      ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
      ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
    }
    ctx.stroke();
    ctx.fillStyle = '#1c2a3a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(h * 0.5)}px ${SERIF}`;
    ctx.fillText('Achterstraat', (cx + h * 0.2 + w - m) / 2, h * 0.54, w - cx - h * 0.4);
  }

  // ---- API ----------------------------------------------------------------------

  /** Kanadı t'ye (0 kapalı .. 1 açık) göre döndürür */
  function pose(d) {
    // Ev kapıları içeri (+z) açılır: −θ. Arka kapı π çevrik: π + θ yine +z'ye (sokağa) açar.
    d.pivot.rotation.y = d === backDoor ? Math.PI + DOOR_OPEN * d.t : -DOOR_OPEN * d.t;
    d.pivot.updateMatrix();
  }

  /** @returns {boolean} bu karede hareket etti mi (son adım dahil → çağıran bir kare daha çizer) */
  function swing(d, target, dt) {
    const goal = target > 0.5 ? 1 : 0;
    if (d.t === goal) return false;
    const step = dt * DOOR_SPEED;
    d.t = Math.abs(goal - d.t) <= step ? goal : d.t + Math.sign(goal - d.t) * step;
    pose(d);
    return true;
  }

  return {
    doors,
    backDoor,

    /**
     * Ev kapısını yumuşakça açar/kapatır (kanat içeri, +z yönüne açılır).
     * requestRender çağırmaz: dönüş değeri true ise çağıran bir kare daha çizmeli.
     * @returns {boolean} kapı bu karede hareket etti mi
     */
    animateDoor(houseId, target, dt) {
      const d = doors.get(houseId);
      return d ? swing(d, target, dt) : false;
    },

    /** Kapıyı animasyonsuz konuma getirir (ör. ışınlanma sonrası) */
    snapDoor(houseId, t) {
      const d = doors.get(houseId);
      if (!d) return;
      d.t = t > 0.5 ? 1 : 0;
      pose(d);
    },

    /** Otel arka kapısı: oyuncu yaklaşınca sokağa doğru açılır. @returns {boolean} hareket etti mi */
    updateBackDoor(dt, px, pz) {
      const bd = ALLEY.backDoor;
      const near = Math.hypot(px - (bd.from + bd.to) / 2, pz - BACK) < BACK_DOOR_RANGE;
      return swing(backDoor, near ? 1 : 0, dt);
    },

    /**
     * Kapı yanındaki isim levhası: owner = { name, online } | null → 'Huis 3 · Ali' / 'Huis 3 · boş'.
     * Yalnızca o evin atlas bölgesi yeniden çizilir (tek doku yüklemesi); motor uyuyorsa bir kare ister.
     */
    setNameplate(houseId, owner) {
      const i = PLAYER_HOUSES.findIndex((h) => h.id === houseId);
      if (i < 0) return;
      const next = owner ? { name: String(owner.name ?? '').trim().slice(0, 20) || '?', online: !!owner.online } : null;
      const cur = owners[i];
      if (cur === next || (cur && next && cur.name === next.name && cur.online === next.online)) return;
      owners[i] = next;
      const canvas = atlas.image;
      drawPlate(canvas.getContext('2d'), canvas.width, canvas.height, i);
      atlas.needsUpdate = true;
      engine?.requestRender();
    },
  };
}

// ---- Dekor üreticileri (statik, batch'e eklenir) -------------------------------------

/** Kapı kanadı: hücre (menteşe) orijinde, kanat +x yönünde, dış yüz −z. Renk örnek (instance) renginden */
function leafGeometry() {
  const w = LEAF_W;
  const zo = LEAF_T / 2;
  const parts = [tint(boxGeo(0, w, 0.01, 0.01 + LEAF_H, -zo, zo), '#ffffff')];
  // İki yüzde kabartma paneller (biraz koyu ton)
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -zo - 0.012 : zo;
    const z1 = z0 + 0.012;
    parts.push(tint(boxGeo(0.13, w - 0.13, 0.18, 0.92, z0, z1), '#ffffff', 0.78));
    parts.push(tint(boxGeo(0.2, w - 0.2, 1.24, 2.0, z0, z1), '#ffffff', 0.78));
  }
  return mergeGeometries(parts, false);
}

/** Kapı aksesuarları: camlar, pirinç kulp ve mektup yarığı (köşe renkli) */
function fittingsGeometry() {
  const w = LEAF_W;
  const zo = LEAF_T / 2 + 0.012;
  const parts = [
    tint(boxGeo(0.26, w - 0.26, 1.3, 1.94, -zo - 0.004, -zo), '#2c3a46'), // dış cam (koyu)
    tint(boxGeo(0.26, w - 0.26, 1.3, 1.94, zo, zo + 0.004), '#cfe3ef'), // iç cam (gün ışığı)
    tint(boxGeo(w - 0.13, w - 0.08, 1.02, 1.08, -LEAF_T / 2 - 0.07, LEAF_T / 2 + 0.07), '#c9a25e'), // kulp
    tint(boxGeo(w / 2 - 0.15, w / 2 + 0.15, 1.04, 1.1, -zo - 0.008, -zo + 0.012), '#c9a25e'), // mektup yarığı
    tint(boxGeo(w / 2 - 0.12, w / 2 + 0.12, 1.062, 1.078, -zo - 0.011, -zo - 0.008), '#1c1c1f'),
  ];
  return mergeGeometries(parts, false);
}

/**
 * Sokağın ucundaki kapalı demir kapı: taş çerçeve, ardında uzaktaki kanal evleri
 * (manzara dokusu) — sokak bir sonraki sokağa açılıyormuş gibi görünür. Duvar çarpışması yerinde kalır.
 * s = −1 batı ucu (yüz +x), +1 doğu ucu (yüz −x)
 */
function addGate(b, xFace, zc, s) {
  const o = { cast: false };
  const W = 1.5;
  const H = 2.25;
  const x = (d) => xFace - s * d; // duvardan içeri doğru
  const xr = (d0, d1) => [Math.min(x(d0), x(d1)), Math.max(x(d0), x(d1))];
  const g = new THREE.PlaneGeometry(W, H);
  const uv = g.attributes.uv;
  const span = W / (H * 2); // manzara dokusu 2:1
  const off = s < 0 ? 0.15 : 0.6;
  for (let i = 0; i < uv.count; i++) uv.setX(i, off + uv.getX(i) * span);
  b.add('skyline', g, { cast: false, receive: false, position: [x(0.004), H / 2, zc], rotation: [0, s < 0 ? Math.PI / 2 : -Math.PI / 2, 0] });
  // Taş çerçeve + kilit taşı
  const [f0, f1] = xr(0, 0.07);
  b.box('stone', f0, f1, 0, H + 0.02, zc - W / 2 - 0.14, zc - W / 2, o);
  b.box('stone', f0, f1, 0, H + 0.02, zc + W / 2, zc + W / 2 + 0.14, o);
  b.box('stone', f0, f1, H, H + 0.16, zc - W / 2 - 0.14, zc + W / 2 + 0.14, o);
  const [k0, k1] = xr(0, 0.09);
  b.box('white', k0, k1, H - 0.02, H + 0.2, zc - 0.09, zc + 0.09, o);
  // Demir parmaklık
  const [r0, r1] = xr(0.03, 0.05);
  for (const y of [0.12, 1.05, 2.05]) b.box('black', r0, r1, y, y + 0.04, zc - W / 2, zc + W / 2, o);
  const n = 13;
  for (let k = 0; k < n; k++) {
    const z = zc - W / 2 + 0.06 + k * ((W - 0.12) / (n - 1));
    b.add('black', new THREE.CylinderGeometry(0.011, 0.011, H - 0.08, 5), { ...o, position: [x(0.04), (H - 0.08) / 2 + 0.02, z] });
    b.add('black', new THREE.ConeGeometry(0.022, 0.07, 4), { ...o, position: [x(0.04), H - 0.02, z] });
  }
}

/** Duvar feneri: dir = −1 → −z'ye (sokağa) uzanır, +1 → +z'ye */
function addWallLantern(b, x, y, zFace, dir) {
  const o = { cast: false };
  const zc = zFace + dir * 0.2;
  const z = (a, c) => [Math.min(zFace + dir * a, zFace + dir * c), Math.max(zFace + dir * a, zFace + dir * c)];
  const [p0, p1] = z(0, 0.02);
  b.box('black', x - 0.035, x + 0.035, y + 0.04, y + 0.24, p0, p1, o);
  const [a0, a1] = z(0.02, 0.2);
  b.box('black', x - 0.012, x + 0.012, y + 0.17, y + 0.2, a0, a1, o);
  b.box('black', x - 0.075, x + 0.075, y - 0.14, y - 0.11, zc - 0.075, zc + 0.075, o);
  b.box('lamp', x - 0.06, x + 0.06, y - 0.11, y + 0.07, zc - 0.06, zc + 0.06, o);
  b.add('black', new THREE.ConeGeometry(0.105, 0.11, 4), { ...o, position: [x, y + 0.125, zc], rotation: [0, Math.PI / 4, 0] });
}

/** Pencere önü çiçek kutusu (cepheye asılı, yüz −z) */
function addWindowBox(b, x, w, yTop, zFace, seed) {
  const r = rng(seed);
  const o = { cast: false };
  b.box('wood', x - w / 2, x + w / 2, yTop - 0.15, yTop, zFace - 0.19, zFace, { ...o, uvScale: UV.wood });
  b.floor('soil', x - w / 2 + 0.02, x + w / 2 - 0.02, zFace - 0.17, zFace - 0.02, yTop + 0.002);
  const colors = ['tulipRed', 'tulipYellow', 'tulipPink'];
  const n = Math.floor((w - 0.1) / 0.1);
  for (let k = 0; k < n; k++) {
    const sx = x - w / 2 + 0.1 + k * ((w - 0.2) / (n - 1));
    const sz = zFace - 0.06 - r() * 0.08;
    const h = 0.14 + r() * 0.08;
    b.add('leaf', new THREE.CylinderGeometry(0.008, 0.008, h, 4), { ...o, position: [sx, yTop + h / 2, sz] });
    b.add(colors[Math.floor(r() * 3)], new THREE.CylinderGeometry(0.035, 0.02, 0.07, 6), { ...o, position: [sx, yTop + h + 0.025, sz] });
    if (k % 2 === 0) b.add('leaf', new THREE.SphereGeometry(0.06, 6, 4), { ...o, position: [sx + 0.04, yTop + 0.04, zFace - 0.1], scale: [1, 0.5, 0.8] });
  }
}

/** Hatmi çiçeği (stokroos) — Amsterdam cephe bahçelerinin uzun çiçekleri */
function addHollyhock(b, col, x, z, seed) {
  const r = rng(seed);
  const o = { cast: false };
  const bloom = ['tulipPink', 'tulipRed', 'linen', 'tulipPink'];
  for (let k = 0; k < 3; k++) {
    const sx = x + (k - 1) * 0.09 + (r() - 0.5) * 0.03;
    const sz = z + (r() - 0.5) * 0.08;
    const h = 1.3 + r() * 0.55;
    const mat = bloom[Math.floor(r() * bloom.length)];
    b.add('leaf', new THREE.CylinderGeometry(0.01, 0.014, h, 4), { ...o, position: [sx, h / 2, sz] });
    for (let j = 0; j < 3; j++) {
      b.add('leaf', new THREE.SphereGeometry(0.085, 6, 4), { ...o, position: [sx + (j % 2 ? 0.06 : -0.06), 0.18 + j * 0.28, sz], scale: [1, 0.35, 0.9] });
    }
    for (let j = 0; j < 5; j++) {
      const y = h * 0.55 + j * (h * 0.42 / 4);
      const a = j * 2.4 + k;
      b.add(mat, new THREE.SphereGeometry(0.048 - j * 0.006, 6, 4), { ...o, position: [sx + Math.cos(a) * 0.03, y, sz - 0.02 + Math.sin(a) * 0.02] });
    }
  }
  if (col) col.add(x - 0.17, x + 0.17, z - 0.1, FACE - 0.1);
}

/** Ahşap çiçek kasası (lale dolu) */
function addFlowerCrate(b, col, x, z, seed) {
  const r = rng(seed);
  b.box('wood', x - 0.5, x + 0.5, 0, 0.42, z - 0.2, z + 0.2);
  b.floor('soil', x - 0.47, x + 0.47, z - 0.17, z + 0.17, 0.425);
  const colors = ['tulipRed', 'tulipYellow', 'tulipPink'];
  for (let k = 0; k < 12; k++) {
    const sx = x - 0.4 + (k % 6) * 0.16 + (r() - 0.5) * 0.04;
    const sz = z - 0.07 + Math.floor(k / 6) * 0.14;
    const h = 0.25 + r() * 0.1;
    b.add('leaf', new THREE.CylinderGeometry(0.01, 0.01, h, 4), { cast: false, position: [sx, 0.42 + h / 2, sz] });
    b.add(colors[Math.floor(r() * 3)], new THREE.CylinderGeometry(0.045, 0.026, 0.09, 6), { cast: false, position: [sx, 0.42 + h + 0.03, sz] });
  }
  if (col) col.add(x - 0.52, x + 0.52, z - 0.22, z + 0.22);
}

/** Sokak bankı: sırtı güneydeki duvara dönük, oturan +z'ye (sokağa) bakar */
function addBench(b, col, x, z) {
  for (const lx of [x - 0.68, x + 0.68]) {
    b.box('black', lx - 0.025, lx + 0.025, 0, 0.43, z - 0.19, z + 0.19);
    b.box('black', lx - 0.025, lx + 0.025, 0.43, 0.9, z - 0.23, z - 0.19);
  }
  for (const dz of [-0.13, 0.0, 0.13]) b.box('wood', x - 0.82, x + 0.82, 0.43, 0.47, z + dz - 0.055, z + dz + 0.055, { uvScale: UV.wood });
  for (const y of [0.58, 0.76]) b.box('wood', x - 0.82, x + 0.82, y, y + 0.1, z - 0.25, z - 0.21, { uvScale: UV.wood });
  if (col) col.add(x - 0.84, x + 0.84, z - 0.26, z + 0.22);
}

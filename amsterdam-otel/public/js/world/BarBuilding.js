import * as THREE from 'three';
import { WALL_H, BAR } from '/shared/layout.js';
import { FOOD, INGREDIENTS, BAR_RULES } from '/shared/constants.js';
import { UV } from './Materials.js';
import { addPlanter } from './Props.js';
import { ATLAS, drawBarAtlas, drawBarWall } from './BarTextures.js';

// Bar De Tulp: otelin doğusunda, lobiden kapıyla girilen ALKOLSÜZ "bruin café".
// Koyu ahşap tezgâh, pirinç ayak rayı, okra duvarlar, sarkıt lambalar.
// Statik parçalar otelin StaticBatcher'ına eklenir; yeni malzeme anahtarları az tutuldu:
//  - barColor: köşe renkli (vertex color) tek malzeme → şişeler, meyveler, tabureler vb. TEK draw call
//  - barSign:  tüm tabela/menü/etiketler tek doku atlasında → TEK draw call
//  - barGlass: saydam cam (fanus, hazneler, dolap kapağı)
//  - barWall:  duvar dokusu (buildWallSegments de kullanır)
// Dinamik olan yalnızca bardaklar: iki InstancedMesh (cam + sıvı) → en fazla 2 draw call.

// ---- Yardımcılar ------------------------------------------------------------

const _c = new THREE.Color();

/** Geometriye tek renkli köşe rengi ekler (barColor malzemesi için) */
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

/** Atlas bölgesini gösteren düzlem (UV'ler bölgeye sıkıştırılır) */
function atlasPlane(r, w, h, circle = false) {
  const geo = circle ? new THREE.CircleGeometry(w / 2, 28) : new THREE.PlaneGeometry(w, h);
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

const FACING = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 };

// Şurup / meyve suyu renkleri (alkol çağrıştıran etiket ya da şişe yok)
const SYRUPS = ['#e23a4e', '#f2df4a', '#f39a2b', '#7cbf3a', '#7a2e6e', '#f6a6b8', '#c43c2c', '#ffe9b0', '#8a4b1a', '#dff1f6'];
const CAPS = ['#efeadf', '#c9a25e', '#2a2a2a', '#d7263d', '#2f6b3a'];
const STEEL = '#b4bac2';
const IRON = '#2a2523';
const LEATHER = '#7a1f23';

const GLASS_H = 0.115;
const LIQUID_FULL = 0.085;
const LIQUID_DIRTY = 0.012;
const GLASS_BASE = 0.012; // bardak dibinin kalınlığı (sıvı bunun üstünden başlar)

/**
 * Bar De Tulp'u kurar.
 * @returns BarView: setRack(n), setStoolGlass(i, kind, color), stoolTop(i), bubbleAnchor(i)
 */
export function buildBar({ batcher: b, collision, scene, mats, factory }) {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const B = (o) => new THREE.MeshBasicMaterial(o);
  Object.assign(mats, {
    barWall: L({ map: factory.make(drawBarWall, { seed: 51, w: 2, h: 2, minSize: 256 }) }),
    barColor: L({ vertexColors: true }),
    barGlass: L({ color: 0xe4f4fb, transparent: true, opacity: 0.26, depthWrite: false }),
    barSign: B({ map: factory.make(drawBarAtlas, { seed: 52, w: 2, h: 2, repeat: false, minSize: 512 }) }),
  });

  const C = BAR.counter;
  const BB = BAR.backBar;
  const noShadow = { cast: false, receive: false };
  const flat = { cast: false };

  /** Köşe renkli parça (tek draw call'lık barColor grubu) */
  const paint = (hex, geo, o = {}) => b.add('barColor', tint(geo, hex), o);
  const vbox = (hex, x0, x1, y0, y1, z0, z1, o = {}) => paint(hex, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), {
    ...o, position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  });
  const cyl = (hex, rTop, rBot, h, x, y, z, seg = 10) => paint(hex, new THREE.CylinderGeometry(rTop, rBot, h, seg), { position: [x, y + h / 2, z] });
  /** Atlas tabelası: (x, y, z) merkez, yüzü `facing` yönüne bakar */
  const sign = (r, w, h, x, y, z, facing, tilt = 0) => {
    const geo = atlasPlane(r, w, h);
    if (tilt) geo.rotateX(tilt);
    b.add('barSign', geo, { ...noShadow, position: [x, y, z], rotation: [0, FACING[facing], 0] });
  };

  buildShell();
  buildLobbySide();
  buildCounter();
  buildBackBar();
  buildFood();
  buildStools();
  buildSeating();
  buildLamps();

  // ---- Kabuk ------------------------------------------------------------------
  function buildShell() {
    const d = BAR.door;
    // Zemin (kapı eşiğinin altına kadar uzanır) ve koyu, kirişli tavan — coffee shop'la aynı malzemeler
    b.floor('floorShop', 8.0, 16, 8.0, 14, 0, { uvScale: UV.floorRoom });
    b.floor('shopCeiling', 8.1, 16, 8.0, 14, WALL_H, { facingDown: true, cast: false, receive: false });
    for (const x of [9.3, 11.1, 12.9, 14.7]) b.box('wainscot', x - 0.09, x + 0.09, WALL_H - 0.2, WALL_H, 8.1, 13.9, { ...flat, uvScale: UV.wainscot });
    b.box('wainscot', 8.14, 15.9, WALL_H - 0.12, WALL_H, 8.14, 8.26, { ...flat, uvScale: UV.wainscot });
    b.box('wainscot', 8.14, 15.9, WALL_H - 0.12, WALL_H, 13.78, 13.9, { ...flat, uvScale: UV.wainscot });

    // Komşu duvarların bar yüzleri: coffee shop'un arka duvarı (güney) ve otelin doğu duvarı (batı, kapı boşluklu)
    const wall = { uvScale: UV.barWall };
    b.box('barWall', 8.14, 15.9, 0, WALL_H, 8.1, 8.14, wall);
    b.box('barWall', 8.1, 8.14, 0, WALL_H, 8.14, d.from, wall);
    b.box('barWall', 8.1, 8.14, 0, WALL_H, d.to, 13.9, wall);
    b.box('barWall', 8.1, 8.14, 2.2, WALL_H, d.from, d.to, wall);

    // Kapı: pervaz kaplaması (duvar kesitini örter), eşik, iki yüzde kasa
    b.box('wood', 7.9, 8.1, 0, 2.2, d.from, d.from + 0.025, { uvScale: UV.wood });
    b.box('wood', 7.9, 8.1, 0, 2.2, d.to - 0.025, d.to, { uvScale: UV.wood });
    b.box('wood', 7.9, 8.1, 2.175, 2.2, d.from, d.to, { uvScale: UV.wood });
    b.box('wood', 7.88, 8.16, 0, 0.015, d.from, d.to, { ...flat, uvScale: UV.wood });
    for (const [x0, x1, mat] of [[7.86, 7.9, 'white'], [8.14, 8.18, 'wainscot']]) {
      const o = mat === 'white' ? flat : { ...flat, uvScale: UV.wainscot };
      b.box(mat, x0, x1, 0, 2.32, d.from - 0.12, d.from, o);
      b.box(mat, x0, x1, 0, 2.32, d.to, d.to + 0.12, o);
      b.box(mat, x0, x1, 2.2, 2.32, d.from - 0.12, d.to + 0.12, o);
    }
    // Paspas
    b.floor('black', 8.25, 8.95, d.from + 0.15, d.to - 0.15, 0.008, { cast: false });
    // Barmen koridorunda kauçuk paspas
    b.floor('black', 10.0, 15.5, 12.25, 13.15, 0.006, { cast: false });
  }

  // ---- Lobi tarafı: tabela, aplikler, ayaklı kara tahta --------------------------
  function buildLobbySide() {
    const zc = (BAR.door.from + BAR.door.to) / 2;
    sign(ATLAS.door, 1.44, 0.36, 7.855, 2.64, zc, 'x-');
    for (const z of [zc - 0.98, zc + 0.98]) {
      b.box('brass', 7.84, 7.9, 2.56, 2.7, z - 0.04, z + 0.04, { cast: false });
      b.add('lamp', new THREE.SphereGeometry(0.055, 8, 6), { ...noShadow, position: [7.77, 2.66, z] });
    }
    // Ayaklı kara tahta ("Günün içeceği") — lobi merkezine dönük, misafir rotasından uzakta
    const px = 7.38;
    const pz = 11.2;
    const rotY = -Math.PI / 2 - 0.35;
    const place = (mat, geo, o) => {
      geo.rotateY(rotY).translate(px, 0, pz);
      b.add(mat, geo, o);
    };
    const tiltF = -0.2;
    const front = atlasPlane(ATLAS.board, 0.46, 0.69).rotateX(tiltF).translate(0, 0.44, 0.085);
    place('barSign', front, noShadow);
    place('wood', new THREE.BoxGeometry(0.54, 0.8, 0.025).rotateX(tiltF).translate(0, 0.44, 0.07), {});
    place('wood', new THREE.BoxGeometry(0.54, 0.8, 0.025).rotateX(-tiltF).translate(0, 0.44, -0.07), {});
    collision.addAround(px, pz, 0.26);
  }

  // ---- Tezgâh -------------------------------------------------------------------
  function buildCounter() {
    const wz = { uvScale: UV.wainscot, cast: false };
    b.box('black', C.minX + 0.03, C.maxX - 0.03, 0, 0.1, C.minZ + 0.03, C.maxZ - 0.03);
    b.box('wainscot', C.minX, C.maxX, 0.1, C.top - 0.07, C.minZ, C.maxZ, wz);
    // Müşteri yüzünde kabartma paneller
    const n = 8;
    const pw = (C.maxX - C.minX) / n;
    for (let i = 0; i < n; i++) {
      const x0 = C.minX + i * pw + 0.06;
      b.box('wood', x0, x0 + pw - 0.12, 0.2, 0.86, C.minZ - 0.018, C.minZ, { uvScale: UV.wood, cast: false });
    }
    // Uçlarda da panel
    for (const x of [C.minX - 0.018, C.maxX]) b.box('wood', x, x + 0.018, 0.2, 0.86, C.minZ + 0.08, C.maxZ - 0.08, { uvScale: UV.wood, cast: false });
    // Kalın üst tabla (müşteri tarafında taşkın)
    b.box('wood', C.minX - 0.06, C.maxX + 0.06, C.top - 0.07, C.top, C.minZ - 0.12, C.maxZ + 0.08, { uvScale: UV.wood });
    b.box('brass', C.minX - 0.06, C.maxX + 0.06, C.top - 0.05, C.top - 0.035, C.minZ - 0.125, C.minZ - 0.12, { cast: false });

    // Pirinç ayak rayı + taşıyıcılar
    const railZ = C.minZ - 0.17;
    b.add('brass', new THREE.CylinderGeometry(0.022, 0.022, C.maxX - C.minX - 0.1, 8), {
      position: [(C.minX + C.maxX) / 2, 0.2, railZ], rotation: [0, 0, Math.PI / 2],
    });
    for (let x = C.minX + 0.1; x <= C.maxX - 0.09; x += (C.maxX - C.minX - 0.2) / 5) {
      b.box('brass', x - 0.012, x + 0.012, 0.19, 0.21, railZ, C.minZ, { cast: false });
    }
    for (const x of [C.minX + 0.05, C.maxX - 0.05]) b.add('brass', new THREE.SphereGeometry(0.03, 8, 6), { position: [x, 0.2, railZ], cast: false });

    // Barmen tarafı: çekmeceler + buz dolabı kapağı
    for (let i = 0; i < 6; i++) {
      const x0 = C.minX + 0.15 + i * 0.72;
      const iceBox = i === 3;
      if (iceBox) vbox(STEEL, x0, x0 + 0.62, 0.2, 0.8, C.maxZ, C.maxZ + 0.015);
      else b.box('wood', x0, x0 + 0.62, 0.55, 0.85, C.maxZ, C.maxZ + 0.015, { uvScale: UV.wood, cast: false });
      b.box('brass', x0 + 0.26, x0 + 0.36, 0.72, 0.74, C.maxZ + 0.015, C.maxZ + 0.035, { cast: false });
    }

    // Tezgâh üstü: bahşiş kavanozu, lale vazosu, pipet kabı, peçetelik, servis zili
    const t = C.top;
    b.add('barGlass', new THREE.CylinderGeometry(0.05, 0.05, 0.13, 12, 1, true), { ...noShadow, position: [10.13, t + 0.065, 11.78] });
    cyl('#d8b24a', 0.046, 0.046, 0.035, 10.13, t, 11.78);
    cyl('#2b5ea7', 0.035, 0.03, 0.12, 10.95, t, 11.9);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      b.add('leaf', new THREE.CylinderGeometry(0.004, 0.004, 0.16, 4), { ...flat, position: [10.95 + Math.cos(a) * 0.012, t + 0.2, 11.9 + Math.sin(a) * 0.012] });
      b.add(['tulipRed', 'tulipYellow', 'tulipPink'][i], new THREE.CylinderGeometry(0.022, 0.014, 0.05, 6), { ...flat, position: [10.95 + Math.cos(a) * 0.02, t + 0.3, 11.9 + Math.sin(a) * 0.02] });
    }
    cyl(STEEL, 0.032, 0.03, 0.1, 11.85, t, 11.9);
    const straws = ['#e23a4e', '#f2df4a', '#3f9fd8', '#7cbf3a', '#f39a2b', '#efeadf'];
    straws.forEach((col, i) => {
      const a = (i / straws.length) * Math.PI * 2;
      paint(col, new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), {
        position: [11.85 + Math.cos(a) * 0.014, t + 0.13, 11.9 + Math.sin(a) * 0.014], rotation: [Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15],
      });
    });
    vbox(STEEL, 12.7, 12.8, t, t + 0.1, 11.86, 11.94);
    vbox('#fbfaf6', 12.715, 12.785, t + 0.02, t + 0.12, 11.875, 11.925);
    paint('#c9a25e', new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), { position: [13.55, t + 0.012, 11.86] });
    cyl(IRON, 0.04, 0.042, 0.012, 13.55, t, 11.86);

    collision.add(C.minX - 0.06, C.maxX + 0.06, C.minZ - 0.12, C.maxZ + 0.08);
  }

  // ---- Arka tezgâh, raflar, istasyonlar --------------------------------------------
  function buildBackBar() {
    const top = BB.top;
    const wz = { uvScale: UV.wainscot, cast: false };
    const sink = { x0: 14.8, x1: 15.4, z0: BB.minZ + 0.08, z1: BB.maxZ - 0.08 };
    // Gövde: lavabo çukuru açık kalacak şekilde parçalı
    b.box('wainscot', BB.minX, sink.x0, 0, top - 0.03, BB.minZ, BB.maxZ, wz);
    b.box('wainscot', sink.x1, BB.maxX, 0, top - 0.03, BB.minZ, BB.maxZ, wz);
    b.box('wainscot', sink.x0, sink.x1, 0, 0.74, BB.minZ, BB.maxZ, wz);
    b.box('wainscot', sink.x0, sink.x1, 0.74, top - 0.03, BB.minZ, sink.z0, wz);
    b.box('wainscot', sink.x0, sink.x1, 0.74, top - 0.03, sink.z1, BB.maxZ, wz);
    // Siyah taş tabla
    const slab = (x0, x1, z0, z1) => b.box('black', x0, x1, top - 0.03, top, z0, z1);
    slab(BB.minX - 0.02, sink.x0, BB.minZ - 0.03, BB.maxZ);
    slab(sink.x1, BB.maxX, BB.minZ - 0.03, BB.maxZ);
    slab(sink.x0, sink.x1, BB.minZ - 0.03, sink.z0);
    slab(sink.x0, sink.x1, sink.z1, BB.maxZ);
    // Dolap kapakları (koridor yüzü)
    for (let x = BB.minX + 0.06; x + 0.5 <= BB.maxX; x += 0.56) {
      b.box('wood', x, x + 0.5, 0.12, 0.8, BB.minZ - 0.015, BB.minZ, { uvScale: UV.wood, cast: false });
      b.box('brass', x + 0.4, x + 0.43, 0.62, 0.7, BB.minZ - 0.03, BB.minZ - 0.015, { cast: false });
    }
    collision.add(BB.minX - 0.02, BB.maxX, BB.minZ - 0.03, 13.9);

    // Arka duvar: aynalı pano + raflar + şişeler
    const mx0 = BB.minX + 0.1;
    const mx1 = 14.6;
    b.add('glassDark', new THREE.PlaneGeometry(mx1 - mx0, 1.75), { ...noShadow, position: [(mx0 + mx1) / 2, top + 0.05 + 0.875, 13.895], rotation: [0, Math.PI, 0] });
    b.box('wainscot', mx0 - 0.06, mx1 + 0.06, top + 1.8, top + 1.9, 13.84, 13.9, wz);
    b.box('wainscot', mx0 - 0.06, mx0, top, top + 1.9, 13.84, 13.9, wz);
    b.box('wainscot', mx1, mx1 + 0.06, top, top + 1.9, 13.84, 13.9, wz);
    const rnd = rng(7);
    for (const y of [1.82, 2.3]) {
      b.box('wood', mx0, mx1, y, y + 0.04, 13.6, 13.9, { uvScale: UV.wood, cast: false });
      for (let x = mx0 + 0.3; x < mx1; x += 1.2) b.box('wainscot', x - 0.008, x + 0.008, y - 0.08, y, 13.78, 13.9, wz);
      let x = mx0 + 0.08;
      while (x < mx1 - 0.08) {
        // Şişe kümeleri arasında boşluk bırak (doğal raf görüntüsü)
        if (rnd() < 0.12) {
          x += 0.16 + rnd() * 0.12;
          continue;
        }
        const r = bottle(x, y + 0.04, 13.73 + (rnd() - 0.5) * 0.06, rnd);
        x += r * 2 + 0.03 + rnd() * 0.03;
      }
    }
    // Üst rafta saksı sarmaşık
    for (const [x, s] of [[9.95, 1], [13.9, 0.85]]) {
      cyl('#8a5a3a', 0.07 * s, 0.055 * s, 0.11 * s, x, 2.34, 13.75);
      for (let i = 0; i < 6; i++) {
        b.add('leaf', new THREE.SphereGeometry(0.06 * s, 6, 4), { ...flat, position: [x + (rnd() - 0.5) * 0.18, 2.42 - i * 0.07 * s * (rnd() + 0.6), 13.66 + rnd() * 0.06] });
      }
    }

    // Eski usul yazar kasa (batı ucunda): gövde, eğik tuş takımı, ekran kulesi
    vbox('#2f4a3a', 9.65, 9.95, top, top + 0.1, 13.48, 13.84);
    vbox('#c9a25e', 9.65, 9.95, top + 0.03, top + 0.04, 13.475, 13.48);
    // Tuş takımı barmene doğru eğik (ön kenar alçak)
    const keypad = (hex, geo) => paint(hex, geo.rotateX(-0.45).translate(9.8, top + 0.13, 13.6));
    keypad('#2f4a3a', new THREE.BoxGeometry(0.3, 0.025, 0.2));
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) keypad('#efeadf', new THREE.BoxGeometry(0.035, 0.012, 0.035).translate(-0.11 + c * 0.073, 0.018, -0.06 + r * 0.06));
    }
    vbox('#2f4a3a', 9.72, 9.88, top + 0.1, top + 0.3, 13.72, 13.82);
    vbox('#ffb347', 9.74, 9.86, top + 0.23, top + 0.28, 13.715, 13.72);

    // Bardak rafı: lastik damlalık (bardaklar dinamik)
    const [gx, gz] = BAR.glassRack;
    b.box('black', gx - 0.22, gx + 0.22, top, top + 0.012, gz + 0.06, gz + 0.34, { cast: false });
    // Meyve kâseleri
    fruitBowl(10.68, 13.58, '#f2df4a', 0.034);
    fruitBowl(13.8, 13.6, '#e23a4e', 0.022);

    // Dispenserler (malzeme renginde hazne + üstte ikonlu etiket)
    INGREDIENTS.forEach((ing, i) => {
      const [dx, dz] = BAR.dispensers[ing.id];
      const zc = dz + 0.36;
      vbox(STEEL, dx - 0.085, dx + 0.085, top, top + 0.02, dz + 0.02, dz + 0.2);
      b.box('black', dx - 0.07, dx + 0.07, top + 0.02, top + 0.024, dz + 0.035, dz + 0.185, { cast: false });
      vbox(STEEL, dx - 0.11, dx + 0.11, top, top + 0.17, dz + 0.2, dz + 0.52);
      vbox(STEEL, dx - 0.022, dx + 0.022, top + 0.1, top + 0.15, dz + 0.1, dz + 0.2);
      cyl(STEEL, 0.009, 0.009, 0.05, dx, top + 0.06, dz + 0.14, 6);
      b.box('black', dx - 0.008, dx + 0.008, top + 0.15, top + 0.24, dz + 0.13, dz + 0.15, { cast: false });
      paint(ing.color, new THREE.SphereGeometry(0.02, 8, 6), { position: [dx, top + 0.25, dz + 0.14] });
      cyl(ing.color, 0.088, 0.088, 0.3, dx, top + 0.17, zc, 14);
      b.add('barGlass', new THREE.CylinderGeometry(0.1, 0.1, 0.38, 14, 1, true), { ...noShadow, position: [dx, top + 0.36, zc] });
      cyl(STEEL, 0.104, 0.104, 0.03, dx, top + 0.55, zc, 14);
      cyl(STEEL, 0.006, 0.006, 0.07, dx, top + 0.58, zc, 5);
      vbox(STEEL, dx - 0.092, dx + 0.092, top + 0.62, top + 0.78, zc - 0.012, zc - 0.004);
      sign(ATLAS.label(i), 0.17, 0.142, dx, top + 0.7, zc - 0.014, 'z-');
    });

    // Çalkalama istasyonu: kokteyl çalkalayıcı, ölçü kabı, bar kaşığı
    const [sx, sz] = BAR.shaker;
    b.box('black', sx - 0.2, sx + 0.2, top, top + 0.008, sz + 0.06, sz + 0.36, { cast: false });
    paint(STEEL, new THREE.CylinderGeometry(0.044, 0.036, 0.17, 14), { position: [sx - 0.04, top + 0.008 + 0.085, sz + 0.2] });
    paint(STEEL, new THREE.CylinderGeometry(0.022, 0.044, 0.06, 14), { position: [sx - 0.04, top + 0.008 + 0.2, sz + 0.2] });
    cyl(STEEL, 0.016, 0.02, 0.025, sx - 0.04, top + 0.238, sz + 0.2, 10);
    paint('#c9a25e', new THREE.CylinderGeometry(0.022, 0.012, 0.04, 10), { position: [sx + 0.09, top + 0.028, sz + 0.16] });
    paint('#c9a25e', new THREE.CylinderGeometry(0.012, 0.018, 0.03, 10), { position: [sx + 0.09, top + 0.063, sz + 0.16] });
    paint(STEEL, new THREE.CylinderGeometry(0.003, 0.003, 0.28, 4), { position: [sx + 0.08, top + 0.012, sz + 0.28], rotation: [0, 0.3, Math.PI / 2] });

    // Lavabo: çelik hazne, kaz boynu musluk, sabunluk, havlu
    const [kx] = BAR.sink;
    const st = (x0, x1, y0, y1, z0, z1) => vbox(STEEL, x0, x1, y0, y1, z0, z1);
    st(sink.x0, sink.x1, 0.74, 0.76, sink.z0, sink.z1);
    st(sink.x0, sink.x0 + 0.015, 0.76, top, sink.z0, sink.z1);
    st(sink.x1 - 0.015, sink.x1, 0.76, top, sink.z0, sink.z1);
    st(sink.x0, sink.x1, 0.76, top, sink.z0, sink.z0 + 0.015);
    st(sink.x0, sink.x1, 0.76, top, sink.z1 - 0.015, sink.z1);
    st(sink.x0 - 0.02, sink.x1 + 0.02, top, top + 0.008, sink.z0 - 0.02, sink.z0 + 0.01);
    st(sink.x0 - 0.02, sink.x1 + 0.02, top, top + 0.008, sink.z1 - 0.01, sink.z1 + 0.02);
    st(sink.x0 - 0.02, sink.x0 + 0.01, top, top + 0.008, sink.z0, sink.z1);
    st(sink.x1 - 0.01, sink.x1 + 0.02, top, top + 0.008, sink.z0, sink.z1);
    cyl(IRON, 0.03, 0.03, 0.004, kx, 0.76, (sink.z0 + sink.z1) / 2, 12);
    const fz = BB.maxZ - 0.05;
    cyl(STEEL, 0.026, 0.03, 0.04, kx, top, fz, 12);
    cyl(STEEL, 0.014, 0.014, 0.33, kx, top + 0.04, fz, 8);
    paint(STEEL, new THREE.TorusGeometry(0.1, 0.014, 6, 14, Math.PI), { position: [kx, top + 0.37, fz - 0.1], rotation: [0, Math.PI / 2, 0] });
    cyl(STEEL, 0.016, 0.014, 0.05, kx, top + 0.32, fz - 0.2, 8);
    for (const [dx, col] of [[-0.08, '#d7263d'], [0.08, '#2b5ea7']]) {
      paint(STEEL, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), { position: [kx + dx, top + 0.05, fz], rotation: [0, 0, Math.PI / 2] });
      paint(col, new THREE.SphereGeometry(0.014, 8, 4), { position: [kx + dx * 1.45, top + 0.05, fz] });
    }
    cyl('#5fa86a', 0.03, 0.03, 0.12, 15.62, top, 13.74, 10);
    cyl('#efeadf', 0.01, 0.01, 0.05, 15.62, top + 0.12, 13.74, 6);
    vbox('#e7d34a', 15.56, 15.66, top, top + 0.03, 13.42, 13.48);
    vbox('#4f9a52', 15.56, 15.66, top + 0.03, top + 0.04, 13.42, 13.48);
    vbox('#f4f1ea', 15.52, 15.78, 0.58, top - 0.02, BB.minZ - 0.03, BB.minZ - 0.018);
    vbox('#2b5ea7', 15.52, 15.78, 0.66, 0.69, BB.minZ - 0.034, BB.minZ - 0.03);
    // Lavabonun arkasında Delft çinileri + duvar saati
    sign(ATLAS.tiles, 1.2, 0.6, 15.25, top + 0.31, 13.893, 'z-');
    b.box('wainscot', 14.63, 15.87, top + 0.6, top + 0.64, 13.86, 13.9, wz);
    b.add('wainscot', new THREE.CylinderGeometry(0.23, 0.23, 0.04, 24), { ...flat, position: [15.25, 2.3, 13.88], rotation: [Math.PI / 2, 0, 0] });
    b.add('barSign', atlasPlane(ATLAS.clock, 0.4, 0.4, true), { ...noShadow, position: [15.25, 2.3, 13.855], rotation: [0, Math.PI, 0] });

    // Batı girintisinde camlı meyve suyu dolabı
    buildFridge();
  }

  /** Raftaki tek şişe; yarıçapını döndürür */
  function bottle(x, y, z, rnd) {
    const col = SYRUPS[Math.floor(rnd() * SYRUPS.length)];
    const kind = rnd();
    if (kind < 0.5) {
      // İnce uzun şurup şişesi
      const r = 0.032 + rnd() * 0.006;
      const h = 0.24 + rnd() * 0.05;
      const pts = [[0, 0], [r, 0], [r, h * 0.62], [r * 0.5, h * 0.8], [r * 0.34, h * 0.84], [r * 0.34, h], [0, h]].map(([a, c]) => new THREE.Vector2(a, c));
      paint(col, new THREE.LatheGeometry(pts, 8), { position: [x, y, z] });
      paint('#f6efdc', new THREE.CylinderGeometry(r * 1.04, r * 1.04, h * 0.26, 8, 1, true), { position: [x, y + h * 0.36, z] });
      cyl(CAPS[Math.floor(rnd() * CAPS.length)], r * 0.38, r * 0.38, 0.02, x, y + h, z, 6);
      return r;
    }
    if (kind < 0.82) {
      // Tombul meyve suyu şişesi
      const r = 0.04 + rnd() * 0.008;
      const h = 0.18 + rnd() * 0.03;
      const pts = [[0, 0], [r, 0], [r, h * 0.7], [r * 0.45, h * 0.88], [r * 0.45, h], [0, h]].map(([a, c]) => new THREE.Vector2(a, c));
      paint(col, new THREE.LatheGeometry(pts, 8), { position: [x, y, z] });
      paint(rnd() < 0.5 ? '#f6efdc' : '#2f6b3a', new THREE.CylinderGeometry(r * 1.03, r * 1.03, h * 0.3, 8, 1, true), { position: [x, y + h * 0.38, z] });
      cyl(CAPS[Math.floor(rnd() * CAPS.length)], r * 0.5, r * 0.5, 0.022, x, y + h, z, 6);
      return r;
    }
    // Kavanoz (meyve / kurabiye)
    const r = 0.05;
    cyl(col, r * 0.92, r * 0.92, 0.1, x, y, z, 10);
    b.add('barGlass', new THREE.CylinderGeometry(r, r, 0.13, 10, 1, true), { ...noShadow, position: [x, y + 0.065, z] });
    cyl('#c9a25e', r * 1.02, r * 1.02, 0.02, x, y + 0.13, z, 10);
    return r;
  }

  function fruitBowl(x, z, color, r) {
    const top = BB.top;
    paint('#f4f1ea', new THREE.SphereGeometry(0.1, 12, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), { position: [x, top + 0.07, z] });
    const rnd = rng(Math.round(x * 100));
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI * 2;
      const d = i === 0 ? 0 : 0.05;
      paint(color, new THREE.SphereGeometry(r, 8, 6), { position: [x + Math.cos(a) * d, top + 0.06 + (i === 0 ? 0.03 : 0) + rnd() * 0.01, z + Math.sin(a) * d], scale: [1, 0.85, 1.2] });
    }
  }

  function buildFridge() {
    const x0 = 8.16;
    const x1 = 8.84;
    const z0 = 13.1;
    const z1 = 13.88;
    const h = 1.9;
    const shell = '#ded7c6';
    const trim = '#1f4d3a';
    vbox(shell, x0, x1, 0, 0.14, z0, z1);
    vbox(trim, x0, x1, h - 0.24, h, z0, z1);
    vbox('#c9a25e', x1, x1 + 0.006, h - 0.13, h - 0.11, z0 + 0.06, z1 - 0.06);
    vbox(shell, x0, x0 + 0.04, 0.14, h - 0.24, z0, z1);
    vbox(shell, x0, x1, 0.14, h - 0.24, z0, z0 + 0.04);
    vbox(shell, x0, x1, 0.14, h - 0.24, z1 - 0.04, z1);
    vbox('#f4f7f6', x0 + 0.04, x0 + 0.05, 0.14, h - 0.24, z0 + 0.04, z1 - 0.04);
    const rnd = rng(23);
    for (const y of [0.14, 0.6, 1.06]) {
      b.box('white', x0 + 0.05, x1 - 0.04, y, y + 0.015, z0 + 0.04, z1 - 0.04, { cast: false });
      for (let z = z0 + 0.1; z < z1 - 0.08; z += 0.1) {
        const col = SYRUPS[Math.floor(rnd() * 8)];
        const pts = [[0, 0], [0.032, 0], [0.032, 0.17], [0.014, 0.23], [0.014, 0.27], [0, 0.27]].map(([a, c]) => new THREE.Vector2(a, c));
        paint(col, new THREE.LatheGeometry(pts, 7), { position: [x0 + 0.42, y + 0.015, z] });
        cyl(CAPS[Math.floor(rnd() * CAPS.length)], 0.015, 0.015, 0.015, x0 + 0.42, y + 0.285, z, 6);
      }
    }
    // Cam kapak + çerçeve + kulp
    b.add('barGlass', new THREE.PlaneGeometry(z1 - z0 - 0.1, h - 0.4), { ...noShadow, position: [x1 + 0.01, 0.14 + (h - 0.38) / 2, (z0 + z1) / 2], rotation: [0, Math.PI / 2, 0] });
    vbox(trim, x1, x1 + 0.025, 0.14, h - 0.24, z0, z0 + 0.05);
    vbox(trim, x1, x1 + 0.025, 0.14, h - 0.24, z1 - 0.05, z1);
    vbox(trim, x1, x1 + 0.025, 0.14, 0.2, z0, z1);
    vbox(trim, x1, x1 + 0.025, h - 0.3, h - 0.24, z0, z1);
    b.box('brass', x1 + 0.025, x1 + 0.045, 0.75, 1.25, z0 + 0.08, z0 + 0.1, { cast: false });
    collision.add(8.1, x1 + 0.05, z0 - 0.02, 13.9);
  }

  // ---- Yiyecek vitrini (tezgâhın doğu ucu) -------------------------------------------
  function buildFood() {
    const t = C.top;
    const fz = BAR.food.brownie[1];
    b.box('wood', 13.72, C.maxX + 0.03, t, t + 0.025, fz - 0.25, fz + 0.25, { uvScale: UV.wood, cast: false });
    const base = t + 0.025;
    FOOD.forEach((f, i) => {
      const [x, z] = BAR.food[f.id];
      cyl('#f6f3ea', 0.16, 0.14, 0.014, x, base, z, 18);
      if (f.id === 'brownie') {
        for (const [dx, dz] of [[-0.045, -0.045], [0.045, -0.045], [-0.045, 0.045], [0.045, 0.045]]) {
          vbox('#4a2716', x + dx - 0.038, x + dx + 0.038, base + 0.014, base + 0.05, z + dz - 0.038, z + dz + 0.038);
          vbox('#2e160b', x + dx - 0.036, x + dx + 0.036, base + 0.05, base + 0.058, z + dz - 0.036, z + dz + 0.036);
        }
        paint('#4a2716', new THREE.BoxGeometry(0.076, 0.044, 0.076), { position: [x, base + 0.08, z], rotation: [0, 0.5, 0] });
      } else {
        for (let k = 0; k < 4; k++) {
          const ox = k === 3 ? 0.03 : (k % 2) * 0.006;
          cyl('#cf9446', 0.066, 0.066, 0.011, x + ox, base + 0.014 + k * 0.014, z - ox * 0.5, 16);
          cyl('#8a4b1a', 0.064, 0.064, 0.003, x + ox, base + 0.018 + k * 0.014, z - ox * 0.5, 16);
        }
      }
      // Cam fanus + topuz
      b.add('barGlass', new THREE.SphereGeometry(0.19, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), { ...noShadow, position: [x, base + 0.012, z], scale: [1, 0.9, 1] });
      paint('#c9a25e', new THREE.SphereGeometry(0.018, 8, 6), { position: [x, base + 0.012 + 0.19 * 0.9 + 0.012, z] });
      sign(ATLAS.tag(i), 0.13, 0.065, x, base + 0.045, C.minZ - 0.045, 'z-', -0.35);
      vbox('#c9a25e', x - 0.005, x + 0.005, base, base + 0.03, C.minZ - 0.03, C.minZ - 0.02);
    });
  }

  // ---- Bar tabureleri ---------------------------------------------------------------
  function buildStools() {
    for (const st of BAR.stools) {
      const [x, z] = st.seat;
      cyl(IRON, 0.19, 0.21, 0.03, x, 0, z, 16);
      b.add('brass', new THREE.CylinderGeometry(0.026, 0.03, 0.66, 8), { position: [x, 0.36, z] });
      b.add('brass', new THREE.TorusGeometry(0.15, 0.011, 5, 18), { position: [x, 0.3, z], rotation: [Math.PI / 2, 0, 0] });
      b.box('brass', x - 0.15, x + 0.15, 0.295, 0.305, z - 0.008, z + 0.008, { cast: false });
      b.box('brass', x - 0.008, x + 0.008, 0.295, 0.305, z - 0.15, z + 0.15, { cast: false });
      b.add('wood', new THREE.CylinderGeometry(0.17, 0.15, 0.03, 16), { position: [x, 0.68, z] });
      cyl(LEATHER, 0.19, 0.18, 0.06, x, 0.69, z, 18);
      collision.addAround(x, z, 0.2);
    }
  }

  // ---- Oturma köşesi: duvar dibinde sedir, masalar, tablolar, saksılar, menü panosu ------
  function buildSeating() {
    const wz = { uvScale: UV.wainscot, cast: false };
    const bx0 = 10.4;
    const bx1 = 14.8;
    b.box('wainscot', bx0, bx1, 0, 0.42, 8.14, 8.62, wz);
    vbox('#2f4d3a', bx0 + 0.02, bx1 - 0.02, 0.42, 0.49, 8.16, 8.6);
    vbox('#2f4d3a', bx0 + 0.02, bx1 - 0.02, 0.49, 0.98, 8.14, 8.26);
    for (let x = bx0 + 0.55; x < bx1 - 0.3; x += 0.55) vbox('#24392c', x - 0.008, x + 0.008, 0.52, 0.95, 8.26, 8.27);
    b.box('wood', bx0, bx1, 0.98, 1.02, 8.14, 8.3, { uvScale: UV.wood, cast: false });
    collision.add(bx0, bx1, 8.1, 8.64);

    for (const tx of [11.5, 13.7]) {
      const tz = 9.05;
      b.add('wood', new THREE.CylinderGeometry(0.32, 0.32, 0.04, 18), { position: [tx, 0.74, tz] });
      cyl(IRON, 0.03, 0.04, 0.72, tx, 0.0, tz, 8);
      cyl(IRON, 0.18, 0.2, 0.025, tx, 0, tz, 12);
      // Masada "Perzisch tapijtje" (masa halısı) + lale
      b.add('rugRed', new THREE.PlaneGeometry(0.42, 0.42), { cast: false, position: [tx, 0.762, tz], rotation: [-Math.PI / 2, 0, 0.6] });
      b.add('rugBlue', new THREE.PlaneGeometry(0.3, 0.3), { cast: false, position: [tx, 0.764, tz], rotation: [-Math.PI / 2, 0, 0.6] });
      cyl('#efeadf', 0.03, 0.026, 0.1, tx + 0.08, 0.764, tz - 0.05, 8);
      b.add('leaf', new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4), { ...flat, position: [tx + 0.08, 0.9, tz - 0.05] });
      b.add('tulipRed', new THREE.CylinderGeometry(0.022, 0.014, 0.05, 6), { ...flat, position: [tx + 0.08, 0.98, tz - 0.05] });
      collision.addAround(tx, tz, 0.32);
    }

    // Tablolar + aplikler (sedirin üstünde)
    const frame = '#a8823e';
    for (const [x, r] of [[11.5, ATLAS.tulips], [13.7, ATLAS.canal]]) {
      vbox(frame, x - 0.33, x + 0.33, 1.42, 2.08, 8.14, 8.17);
      vbox('#2a1a10', x - 0.29, x + 0.29, 1.46, 2.04, 8.17, 8.175);
      sign(r, 0.54, 0.54, x, 1.75, 8.178, 'z+');
    }
    for (const x of [10.5, 12.6, 14.75]) sconce(x, 8.14, 'z+');
    sconce(8.14, 12.0, 'x+');

    // Saksılar: kapının güneyinde laleler, doğu köşede büyük bitki
    addPlanter(b, collision, 8.52, 8.52, 2);
    b.add('delft', new THREE.CylinderGeometry(0.28, 0.22, 0.55, 12), { position: [15.5, 0.275, 8.52] });
    b.add('leaf', new THREE.SphereGeometry(0.42, 8, 6), { position: [15.5, 1.05, 8.52], scale: [1, 1.35, 1] });
    b.add('leaf', new THREE.SphereGeometry(0.26, 7, 5), { position: [15.4, 1.62, 8.6] });
    collision.addAround(15.5, 8.52, 0.3);

    // Menü panosu (doğu duvarı) — kapıdan girince karşıda, köşedeki bitkinin kuzeyinde
    const mz = 10.2;
    b.box('wainscot', 15.86, 15.9, 1.2, 2.3, mz - 1.03, mz + 1.03, wz);
    sign(ATLAS.menu, 1.96, 0.98, 15.855, 1.75, mz, 'x-');
    b.box('brass', 15.78, 15.9, 2.36, 2.39, mz - 0.02, mz + 0.02, { cast: false });
    b.add('lamp', new THREE.CylinderGeometry(0.025, 0.025, 1.1, 8), { ...noShadow, position: [15.76, 2.37, mz], rotation: [Math.PI / 2, 0, 0] });
  }

  /** Pirinç duvar apliği (gerçek ışık yok: parlayan abajur); facing duvarın iç yüzünün normali */
  function sconce(x, z, facing) {
    const fx = facing === 'x+' ? 1 : 0;
    const fz = facing === 'z+' ? 1 : 0;
    const y = 2.02;
    b.box('brass', x - 0.04 * fz, x + 0.04 * fz + 0.02 * fx, y - 0.07, y + 0.07, z - 0.04 * fx, z + 0.04 * fx + 0.02 * fz, { cast: false });
    b.add('brass', new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), {
      cast: false, position: [x + fx * 0.08, y, z + fz * 0.08], rotation: [fz * Math.PI / 2, 0, fx * Math.PI / 2],
    });
    b.add('lamp', new THREE.CylinderGeometry(0.04, 0.07, 0.1, 10), { ...noShadow, position: [x + fx * 0.16, y + 0.05, z + fz * 0.16] });
  }

  // ---- Sarkıt lambalar (tezgâh üstü) ----------------------------------------------------
  function buildLamps() {
    const z = (C.minZ + C.maxZ) / 2;
    for (const x of [10.7, 11.85, 13.0, 14.15]) {
      b.add('black', new THREE.CylinderGeometry(0.006, 0.006, 0.95, 4), { cast: false, position: [x, WALL_H - 0.475, z] });
      b.add('brass', new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), { cast: false, position: [x, WALL_H - 0.98, z] });
      b.add('brass', new THREE.CylinderGeometry(0.045, 0.18, 0.17, 16, 1, true), { cast: false, position: [x, WALL_H - 1.09, z] });
      b.add('lamp', new THREE.CircleGeometry(0.175, 16), { ...noShadow, position: [x, WALL_H - 1.17, z], rotation: [Math.PI / 2, 0, 0] });
      b.add('lamp', new THREE.SphereGeometry(0.06, 8, 6), { ...noShadow, position: [x, WALL_H - 1.14, z] });
    }
    // Müşteri alanında kirişlerin arasında tavan lambaları
    for (const x of [10.2, 12.0, 13.8]) {
      b.add('brass', new THREE.CylinderGeometry(0.13, 0.13, 0.02, 14), { cast: false, position: [x, WALL_H - 0.01, 9.6] });
      b.add('lamp', new THREE.SphereGeometry(0.11, 12, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), { ...noShadow, position: [x, WALL_H - 0.02, 9.6] });
    }
  }

  // ---- Dinamik bardaklar ------------------------------------------------------------
  // Raftaki temiz bardaklar (ters çevrilmiş) + tezgâhtaki bardaklar tek InstancedMesh;
  // sıvılar ikinci InstancedMesh (bardak başına renk). Görünmeyenler `count` ile kırpılır.
  const glassPts = [[0, 0], [0.034, 0], [0.04, GLASS_H], [0.036, GLASS_H], [0.031, GLASS_BASE], [0, GLASS_BASE]].map(([a, c]) => new THREE.Vector2(a, c));
  const glassGeo = new THREE.LatheGeometry(glassPts, 14);
  // Tek yüz: kalın cidarlı profilde dış yüz dışa, iç yüz içe bakar → sıvının önünde tek cam katmanı kalır
  const glassMat = new THREE.MeshLambertMaterial({ color: 0xeaf7fc, transparent: true, opacity: 0.3, depthWrite: false });
  const stoolCount = BAR.stools.length;
  const glasses = new THREE.InstancedMesh(glassGeo, glassMat, BAR_RULES.GLASSES + stoolCount);
  const liquidGeo = new THREE.CylinderGeometry(0.031, 0.027, 1, 12).translate(0, 0.5, 0);
  // Yanlar biraz koyu, üst yüz açık: koyu içecek (kakao) ahşap tezgâhta da seçilsin
  const shadeArr = [];
  const nor = liquidGeo.attributes.normal;
  for (let i = 0; i < nor.count; i++) {
    const v = nor.getY(i) > 0.5 ? 1 : 0.72;
    shadeArr.push(v, v, v);
  }
  liquidGeo.setAttribute('color', new THREE.Float32BufferAttribute(shadeArr, 3));
  const liquidMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  // Sıvı rengi koyu barda ve camın ardında da okunsun: örnek rengini hafif öz ışık olarak ekle
  liquidMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.35;',
    );
  };
  const liquid = new THREE.InstancedMesh(liquidGeo, liquidMat, stoolCount);
  glasses.name = 'bar:glasses';
  liquid.name = 'bar:liquid';
  for (const m of [glasses, liquid]) {
    m.castShadow = false;
    m.receiveShadow = false;
    m.matrixAutoUpdate = false;
    scene.add(m);
  }

  const CLEAN = new THREE.Color(0xffffff);
  const DIRTY = new THREE.Color('#b9a78a');
  const RESIDUE = new THREE.Color('#8a7a66');
  const [rx, rz] = BAR.glassRack;
  const rackTop = BB.top + 0.012;
  // Arka sıra önce: bardak alındıkça ön sıradakiler (barmene yakın olanlar) önce eksilir
  const rackSlots = [];
  for (const dz of [0.26, 0.14]) for (const dx of [-0.13, 0, 0.13]) rackSlots.push(new THREE.Vector3(rx + dx, rackTop + GLASS_H, rz + dz));
  const inverted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const upright = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _col = new THREE.Color();

  let rack = BAR_RULES.GLASSES;
  const onCounter = BAR.stools.map(() => ({ kind: null, color: new THREE.Color() }));

  function refresh() {
    let k = 0;
    for (let i = 0; i < rack; i++) {
      glasses.setMatrixAt(k, _m.compose(rackSlots[i], inverted, one));
      glasses.setColorAt(k, CLEAN);
      k++;
    }
    let l = 0;
    onCounter.forEach((g, i) => {
      if (!g.kind) return;
      const [sx, sz] = BAR.stools[i].spot;
      glasses.setMatrixAt(k, _m.compose(_p.set(sx, C.top, sz), upright, one));
      glasses.setColorAt(k, g.kind === 'dirty' ? DIRTY : CLEAN);
      k++;
      const fill = g.kind === 'full' ? LIQUID_FULL : LIQUID_DIRTY;
      liquid.setMatrixAt(l, _m.compose(_p.set(sx, C.top + GLASS_BASE, sz), upright, _s.set(1, fill, 1)));
      liquid.setColorAt(l, g.kind === 'full' ? g.color : _col.copy(g.color).lerp(RESIDUE, 0.55));
      l++;
    });
    for (const [m, n] of [[glasses, k], [liquid, l]]) {
      m.count = n;
      m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      if (n > 0) m.computeBoundingSphere();
    }
  }
  // instanceColor tamponlarını baştan oluştur (shader bir kez derlensin)
  for (let i = 0; i < glasses.instanceMatrix.count; i++) glasses.setColorAt(i, CLEAN);
  for (let i = 0; i < stoolCount; i++) liquid.setColorAt(i, CLEAN);
  refresh();

  return {
    glasses,
    liquid,

    /** Raftaki temiz bardak sayısı (0..6) */
    setRack(n) {
      const v = Math.max(0, Math.min(BAR_RULES.GLASSES, Math.floor(Number(n) || 0)));
      if (v === rack) return;
      rack = v;
      refresh();
    },

    /** Tezgâhta taburenin önündeki bardak: kind null | 'full' | 'dirty'; color sıvı rengi ('#hex') */
    setStoolGlass(i, kind, color) {
      const g = onCounter[i];
      if (!g) return;
      const k = kind === 'full' || kind === 'dirty' ? kind : null;
      if (color) g.color.set(color);
      else g.color.set(k === 'dirty' ? '#c9b48f' : '#f4e46c');
      g.kind = k;
      refresh();
    },

    /** Tezgâhta taburenin önündeki bardak noktası (y = tezgâh üstü) */
    stoolTop(i) {
      const s = BAR.stools[i];
      return s ? new THREE.Vector3(s.spot[0], C.top, s.spot[1]) : null;
    },

    /** Oturan müşterinin başının üstü (sipariş baloncuğu) */
    bubbleAnchor(i) {
      const s = BAR.stools[i];
      return s ? new THREE.Vector3(s.seat[0], 2.0, s.seat[1]) : null;
    },
  };
}

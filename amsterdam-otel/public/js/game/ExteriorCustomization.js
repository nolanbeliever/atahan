import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EVT } from '/shared/constants.js';
import { PLAYER_HOUSES, HOUSE_BY_ID } from '/shared/layout.js';
import {
  FACADE, GRAFFITI, GRAFFITI_BY_ID, SPRAY_COLORS, TAG_SIZES, NEON_SLOTS, NEON_COLORS,
  BALCONY, BALCONY_ITEMS, EXT_RULES,
  cleanText, tagAspect, tagRect, validateTag, tagAtPoint, frontOfHouse, emptyExterior, roundPos,
} from '/shared/exterior.js';

const OUT = FACADE.OUT;
const W = FACADE.WIDTH;
// Graffiti dokusunun kapsadığı cephe şeridi (sınırların biraz dışı: sprey hâlesi kesilmesin)
const GY0 = 0.12;
const GY1 = 3.08;
const DECAL_Z = OUT - 0.022; // taş subasmanın (2 cm) da önünde
const REACH_MARGIN = 0.3; // sunucu konumu geriden gelir: istemci biraz daha katı
const TABS = ['graffiti', 'neon', 'balcony'];
const TAB_NAMES = { graffiti: '🎨 Graffiti', neon: '💡 Neon', balcony: '🏗️ Balkon' };
const PARTICLES = 28;
const SANS = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const BLOCK = 'Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif';

const _dir = new THREE.Vector3();
const _c = new THREE.Color();

/** Deterministik sayı üreteci: aynı graffiti her istemcide aynı damlalarla çizilir */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Geometriye tek renk köşe rengi (birleştirilen mesh'ler için) */
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

const boxGeo = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Yumuşak, yuvarlak parıltı (beyaz; renk köşe renginden gelir; tabelada elipse uzar) */
function makeSoftGlow() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = Math.abs((x / (S - 1)) * 2 - 1);
      const v = Math.abs((y / (S - 1)) * 2 - 1);
      const a = Math.max(0, 1 - Math.hypot(u, v)) ** 1.8;
      const i = (y * S + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- Graffiti şablonları (canvas'ta prosedürel) ---------------------------------------

const outlineFor = (hex) => (hex === '#17171a' ? '#f4f4f0' : '#121214');

function shade(hex, f) {
  _c.set(hex);
  if (f < 1) _c.multiplyScalar(f);
  else _c.lerp(new THREE.Color(1, 1, 1), f - 1);
  return `#${_c.getHexString()}`;
}

function fitFont(ctx, text, weight, family, maxW, maxH) {
  let fs = maxH;
  ctx.font = `${weight} ${fs}px ${family}`;
  const m = ctx.measureText(text).width;
  if (m > maxW) fs = Math.max(6, fs * (maxW / m));
  ctx.font = `${weight} ${Math.floor(fs)}px ${family}`;
  return Math.floor(fs);
}

/** Boya damlaları: şeklin alt kenarından aşağı akan ince çizgiler */
function drips(ctx, rnd, color, x0, x1, yBase, h, n) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  for (let k = 0; k < n; k++) {
    const x = x0 + rnd() * (x1 - x0);
    const len = h * (0.06 + rnd() * 0.16);
    const lw = Math.max(1, h * (0.012 + rnd() * 0.014));
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, yBase - h * 0.02);
    ctx.lineTo(x, yBase + len);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, yBase + len, lw * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Sprey sisi: şeklin etrafına serpilmiş ince boya noktaları */
function speckle(ctx, rnd, color, w, h, n) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.36 + rnd() * 0.16;
    const x = w / 2 + Math.cos(a) * r * w;
    const y = h / 2 + Math.sin(a) * r * h;
    ctx.fillRect(x, y, Math.max(1, h * 0.008), Math.max(1, h * 0.008));
  }
  ctx.restore();
}

function heartPath(ctx, cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.42);
  ctx.bezierCurveTo(cx - s * 0.62, cy - s * 0.02, cx - s * 0.42, cy - s * 0.52, cx, cy - s * 0.2);
  ctx.bezierCurveTo(cx + s * 0.42, cy - s * 0.52, cx + s * 0.62, cy - s * 0.02, cx, cy + s * 0.42);
  ctx.closePath();
}

function starPath(ctx, cx, cy, ro, ri, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = rot + (i * Math.PI) / n;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** Dolgu + kontur + parlama (stencil görünümü) */
function paint(ctx, color, outline, lw) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawText(ctx, w, h, text, color, rnd, style) {
  const out = outlineFor(color);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = w / 2;
  const cy = h * 0.47;
  if (style === 'bubble') {
    const fs = fitFont(ctx, text, 900, `"Arial Rounded MT Bold", ${BLOCK}`, w * 0.8, h * 0.62);
    ctx.lineJoin = 'round';
    // 3B gölge, kalın dış kontur (balon harf), dolgu, parlama
    ctx.lineWidth = fs * 0.34;
    ctx.strokeStyle = out;
    ctx.strokeText(text, cx + fs * 0.06, cy + fs * 0.08);
    ctx.lineWidth = fs * 0.22;
    ctx.strokeStyle = shade(color, 1.55);
    ctx.strokeText(text, cx, cy);
    ctx.lineWidth = fs * 0.08;
    ctx.strokeStyle = out;
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.rect(0, cy - fs * 0.42, w, fs * 0.16);
    ctx.clip();
    ctx.fillText(text, cx, cy);
    ctx.restore();
    drips(ctx, rnd, color, w * 0.2, w * 0.8, cy + fs * 0.42, h, 3);
    return;
  }
  // Blok harf (sprey): kontur + dolgu + damlalar
  const fs = fitFont(ctx, text, 900, BLOCK, w * 0.84, h * 0.66);
  ctx.lineJoin = 'miter';
  ctx.lineWidth = fs * 0.14;
  ctx.strokeStyle = out;
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = shade(color, 0.6);
  ctx.beginPath();
  ctx.rect(0, cy + fs * 0.08, w, fs * 0.5);
  ctx.clip();
  ctx.fillText(text, cx, cy);
  ctx.restore();
  drips(ctx, rnd, color, w * 0.12, w * 0.88, cy + fs * 0.36, h, 5);
}

/**
 * Şablonu (w × h) kanvasa çizer. Canvas kenarında ~%10 boşluk bırakılır (sprey hâlesi);
 * sunucunun çakışma testi de bu payı düşer (shared/exterior.js coreRect).
 */
function drawDesign(ctx, w, h, d, color, text, seed) {
  const rnd = rng(seed);
  const out = outlineFor(color);
  ctx.save();
  // Hafif eğiklik: elle sıkılmış gibi
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rnd() - 0.5) * 0.08);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(1, h * 0.035); // püskürtme kenarı (yumuşak)
  const s = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const lw = s * 0.06;
  switch (d.id) {
    case 'heart':
      heartPath(ctx, cx, cy + s * 0.04, s * 0.98);
      paint(ctx, color, out, lw);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = s * 0.04;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx - s * 0.2, cy - s * 0.1, s * 0.12, Math.PI * 1.1, Math.PI * 1.6);
      ctx.stroke();
      drips(ctx, rnd, color, cx - s * 0.15, cx + s * 0.15, cy + s * 0.3, h, 3);
      break;
    case 'tulip': {
      const stem = color === '#35d46a' ? '#1d6b35' : '#2f9e44';
      ctx.strokeStyle = out;
      ctx.lineCap = 'round';
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx, h * 0.88);
      ctx.quadraticCurveTo(cx - w * 0.02, h * 0.62, cx, h * 0.4);
      ctx.stroke();
      ctx.strokeStyle = stem;
      ctx.lineWidth = s * 0.055;
      ctx.stroke();
      // Yapraklar
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, h * 0.84);
        ctx.quadraticCurveTo(cx + sgn * w * 0.42, h * 0.72, cx + sgn * w * 0.3, h * 0.5);
        ctx.quadraticCurveTo(cx + sgn * w * 0.12, h * 0.66, cx, h * 0.84);
        paint(ctx, stem, out, lw * 0.6);
      }
      // Çiçek: üç taç yaprağı
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.28, h * 0.14);
      ctx.lineTo(cx - w * 0.12, h * 0.26);
      ctx.lineTo(cx, h * 0.1);
      ctx.lineTo(cx + w * 0.12, h * 0.26);
      ctx.lineTo(cx + w * 0.28, h * 0.14);
      ctx.quadraticCurveTo(cx + w * 0.32, h * 0.44, cx, h * 0.46);
      ctx.quadraticCurveTo(cx - w * 0.32, h * 0.44, cx - w * 0.28, h * 0.14);
      ctx.closePath();
      paint(ctx, color, out, lw);
      break;
    }
    case 'star':
      starPath(ctx, cx, cy + s * 0.03, s * 0.44, s * 0.19);
      paint(ctx, color, out, lw);
      ctx.shadowBlur = 0;
      starPath(ctx, cx - s * 0.04, cy - s * 0.02, s * 0.12, s * 0.05, 4, 0);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fill();
      break;
    case 'crown': {
      const x0 = w * 0.12;
      const x1 = w * 0.88;
      const yb = h * 0.78;
      ctx.beginPath();
      ctx.moveTo(x0, yb);
      ctx.lineTo(x0, h * 0.3);
      ctx.lineTo(w * 0.31, h * 0.55);
      ctx.lineTo(cx, h * 0.2);
      ctx.lineTo(w * 0.69, h * 0.55);
      ctx.lineTo(x1, h * 0.3);
      ctx.lineTo(x1, yb);
      ctx.closePath();
      paint(ctx, color, out, lw);
      for (const [x, y] of [[x0, h * 0.27], [cx, h * 0.17], [x1, h * 0.27]]) {
        ctx.beginPath();
        ctx.arc(x, y, s * 0.07, 0, Math.PI * 2);
        paint(ctx, color, out, lw * 0.7);
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = out;
      ctx.fillRect(x0, yb - h * 0.12, x1 - x0, h * 0.04);
      drips(ctx, rnd, color, x0 + w * 0.05, x1 - w * 0.05, yb, h, 3);
      break;
    }
    case 'smiley': {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
      paint(ctx, color, out, lw);
      ctx.shadowBlur = 0;
      ctx.fillStyle = out;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + sgn * s * 0.13, cy - s * 0.1, s * 0.045, s * 0.075, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = out;
      ctx.lineWidth = s * 0.055;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.02, s * 0.22, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
      drips(ctx, rnd, color, cx - s * 0.25, cx + s * 0.25, cy + s * 0.36, h, 3);
      break;
    }
    case 'wave':
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const y = h * (0.3 + k * 0.2);
        ctx.beginPath();
        ctx.moveTo(w * 0.08, y);
        for (let i = 1; i <= 4; i++) {
          const x = w * (0.08 + i * 0.21);
          ctx.quadraticCurveTo(x - w * 0.105, y + (i % 2 ? -1 : 1) * h * 0.16, x, y);
        }
        ctx.lineWidth = h * 0.13;
        ctx.strokeStyle = out;
        ctx.stroke();
        ctx.lineWidth = h * 0.08;
        ctx.strokeStyle = k === 1 ? shade(color, 1.4) : color;
        ctx.stroke();
      }
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(w * 0.62, h * 0.06);
      ctx.lineTo(w * 0.16, h * 0.56);
      ctx.lineTo(w * 0.46, h * 0.56);
      ctx.lineTo(w * 0.32, h * 0.94);
      ctx.lineTo(w * 0.86, h * 0.4);
      ctx.lineTo(w * 0.55, h * 0.4);
      ctx.closePath();
      paint(ctx, color, out, lw);
      break;
    case 'xxx':
      // Amsterdam'ın üç Andreas haçı
      for (let k = 0; k < 3; k++) {
        const x = w * (0.2 + k * 0.3);
        const r = h * 0.3;
        ctx.beginPath();
        ctx.save();
        ctx.translate(x, cy);
        ctx.rotate(Math.PI / 4);
        const a = r * 0.3;
        ctx.rect(-a / 2, -r, a, r * 2);
        ctx.rect(-r, -a / 2, r * 2, a);
        ctx.restore();
        ctx.lineWidth = lw;
        ctx.strokeStyle = out;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fill('nonzero');
      }
      drips(ctx, rnd, color, w * 0.1, w * 0.9, cy + h * 0.25, h, 4);
      break;
    case 'amsterdam':
    case 'hoi':
      drawText(ctx, w, h, d.label, color, rnd, d.id === 'hoi' ? 'bubble' : 'block');
      break;
    case 'name':
      drawText(ctx, w, h, text || '?', color, rnd, 'bubble');
      break;
    default:
      drawText(ctx, w, h, text || '?', color, rnd, 'block');
  }
  speckle(ctx, rnd, color, w, h, 24);
  ctx.restore();
}

/** Neon yazısı: koyu akrilik arka plaka, renkli tüp (kontur + hâle), açık renkli çekirdek */
function drawNeon(ctx, w, h, text, colorDef) {
  ctx.clearRect(0, 0, w, h);
  const r = h * 0.22;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(w * 0.02, h * 0.06, w * 0.96, h * 0.88, r);
  else ctx.rect(w * 0.02, h * 0.06, w * 0.96, h * 0.88);
  ctx.fillStyle = 'rgba(10,12,22,0.6)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, h * 0.025);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = fitFont(ctx, text, 700, SANS, w * 0.86, h * 0.6);
  let tube = colorDef.hex;
  let core = shade(colorDef.hex, 1.7);
  if (colorDef.rainbow) {
    const tw = ctx.measureText(text).width;
    const g = ctx.createLinearGradient(w / 2 - tw / 2, 0, w / 2 + tw / 2, 0);
    const hues = ['#ff3344', '#ff9a1a', '#ffe23f', '#3cff7a', '#00e5ff', '#3d7bff', '#c03cff'];
    hues.forEach((c, i) => g.addColorStop(i / (hues.length - 1), c));
    tube = g;
    core = g;
  }
  ctx.lineJoin = 'round';
  ctx.shadowColor = colorDef.rainbow ? '#ff5fd2' : colorDef.hex;
  ctx.shadowBlur = fs * 0.45;
  ctx.lineWidth = fs * 0.13;
  ctx.strokeStyle = tube;
  ctx.strokeText(text, w / 2, h * 0.52);
  ctx.shadowBlur = fs * 0.2;
  ctx.strokeText(text, w / 2, h * 0.52);
  ctx.shadowBlur = 0;
  ctx.lineWidth = fs * 0.05;
  ctx.strokeStyle = core;
  ctx.globalAlpha = colorDef.rainbow ? 0.9 : 1;
  ctx.strokeText(text, w / 2, h * 0.52);
  if (!colorDef.rainbow) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillText(text, w / 2, h * 0.52);
  }
  ctx.globalAlpha = 1;
}

// ---- Sistem -------------------------------------------------------------------------------

/**
 * Oyuncu evlerinin dış cephesi: graffiti (sprey kutusu), neon tabela ve balkon.
 * Achterstraat'ta KENDİ evinin önünde B / 🛠 Dekor → dış cephe modu (evin içinde HouseSystem'in
 * iç dekorasyon modu aynen çalışır). Kamera ışını cephe düzlemini (z = FACADE.OUT) keser,
 * şablonun hayaleti duvarda görünür; E / Aksiyon basılı tutulunca (~0.8 sn, ilerleme halkası,
 * boya zerrecikleri, "pssst") sunucuya gider. Sunucu yetkilidir (server/house/ExteriorService.js);
 * kurallar shared/exterior.js'te ortaktır. Herkes tüm cepheleri görür.
 *
 * Pil / performans:
 *  - Her evin cephesi bir THREE.Group: TÜM graffiti'ler tek bir kanvas dokusuna çizilir ve tek
 *    bir düzlemde (polygonOffset) gösterilir; balkon + eşyalar tek mesh, ampuller tek mesh, tüm
 *    neon / ampul parıltıları tek additive mesh (köşe rengi). Neon yazıları tabela başına bir
 *    düzlem (en fazla 3). Yalnızca o evin durumu değişince yeniden kurulur; dokular / geometriler
 *    eskisinden atılır (dispose).
 *  - Boştayken kare başı iş yok: sistem yalnızca dış cephe modu açıkken (hayalet / hedef) ve
 *    sprey sürerken çalışır; sprey bitince motor yine uyur. Mod kapalıyken yalnızca oyuncu
 *    hareket ettiğinde "evinin önünde mi" (🛠 butonu) bakılır.
 *  - Neon parıltısı statik (kare başı animasyon yok); gece seviyesi değiştiğinde (NightCycle'ın tek
 *    seferlik geçişi) yalnızca ortak parıltı malzemesinin opaklığı değişir. Gökkuşağı neon da statik.
 */
export class ExteriorCustomization {
  constructor({ engine, net, hud, interaction, player, house, device, touch, modal, sfx, settings, getWallet }) {
    this.engine = engine;
    this.scene = engine.scene;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.house = house;
    this.device = device;
    this.touch = touch;
    this.modal = modal;
    this.sfx = sfx;
    this.settings = settings;
    this.getWallet = getWallet || (() => Infinity);

    this.ext = new Map(); // houseId → { sprays, tags, neon, balcony }
    this.groups = new Map(); // houseId → { group, dispose: [] }
    this.active = false;
    this.tab = 'graffiti';
    this.sel = { graffiti: 0, neon: 0, balcony: 0 };
    this.color = { graffiti: 0, neon: 0, balcony: 0 };
    this.size = 1;
    this.tagText = '';
    this.neonText = 'WELKOM';
    this.cand = null;
    this.check = null;
    this.target = null; // kaldırılacak graffiti
    this.spray = null; // { t0, cand, x, z, sound }
    this.pending = false; // sunucu yanıtı bekleniyor
    this.greeted = false;
    this.ghostKey = '';
    this.night = 0;

    // Ortak malzemeler (tüm evler)
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.unlitMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.glowMat = new THREE.MeshBasicMaterial({
      map: makeSoftGlow(), vertexColors: true, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.setNight(0);

    // Hayalet önizleme + çerçeveler
    this.ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.ghost = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ghostMat);
    this.ghost.rotation.y = Math.PI;
    this.ghost.renderOrder = 4;
    this.ghost.visible = false;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.frame = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x3cff7a, depthTest: false, transparent: true }));
    this.frame.renderOrder = 5;
    this.frame.visible = false;
    this.targetFrame = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff4f4f, depthTest: false, transparent: true }));
    this.targetFrame.renderOrder = 5;
    this.targetFrame.visible = false;
    this.ghostCanvas = document.createElement('canvas');
    this.ghostTex = null;

    // Sprey zerrecikleri (yalnızca sprey sürerken görünür)
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.03, transparent: true, opacity: 0.9, depthWrite: false }));
    this.particles.visible = false;
    this.particles.frustumCulled = false;
    this.scene.add(this.ghost, this.frame, this.targetFrame, this.particles);

    this.bindUi();
  }

  get ownedHouseId() { return this.house.ownedHouseId; }

  // ---- Arayüz -------------------------------------------------------------------------

  bindUi() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      btn: $('btn-build'),
      bar: $('ext-bar'),
      tabs: $('ext-tabs'),
      info: $('ext-info'),
      items: $('ext-items'),
      colors: $('ext-colors'),
      sizes: $('ext-sizes'),
      text: $('ext-text'),
      cans: $('ext-cans'),
      remove: $('ext-remove'),
      close: $('ext-close'),
      hint: $('ext-hint'),
      ring: $('ext-spray'),
      panel: $('ext-text-panel'),
      panelTitle: $('ext-text-title'),
      panelSub: $('ext-text-sub'),
      input: $('ext-text-input'),
      save: $('ext-text-save'),
      cancel: $('ext-text-cancel'),
    };
    const e = this.el;
    e.tabs.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-tab]');
      if (b) this.setTab(b.dataset.tab);
    });
    e.items.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-i]');
      if (b) this.command(`select:${b.dataset.i}`);
    });
    e.colors.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-c]');
      if (!b) return;
      this.color[this.tab] = Number(b.dataset.c);
      this.changed();
    });
    e.sizes.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-s]');
      if (!b) return;
      this.size = Number(b.dataset.s);
      this.changed();
    });
    e.text.addEventListener('click', () => this.openText());
    e.cans.addEventListener('click', () => this.buyCans());
    e.remove.addEventListener('click', () => this.command('remove'));
    e.close.addEventListener('click', () => this.toggle(false));
    // Yazı paneli: yazarken oyun tuşları çalışmasın (Esc yine paneli kapatır)
    e.input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.saveText();
      }
    });
    e.save.addEventListener('click', () => this.saveText());
    e.cancel.addEventListener('click', () => this.modal.close(e.panel));
    // Basılı tutma: bırakılınca sprey yarım kalır
    const release = () => this.releaseSpray();
    window.addEventListener('keyup', (ev) => {
      if (ev.code === 'KeyE' || ev.code === 'Space') release();
    });
    window.addEventListener('mouseup', (ev) => { if (ev.button === 0) release(); });
    const act = document.getElementById('btn-action');
    for (const t of ['pointerup', 'pointercancel']) act?.addEventListener(t, release);
  }

  setTab(tab) {
    if (!TABS.includes(tab) || tab === this.tab) return;
    this.cancelSpray();
    this.tab = tab;
    this.changed();
  }

  changed() {
    this.renderCatalog();
    this.ghostKey = '';
    this.engine.requestRender();
  }

  renderCatalog() {
    if (!this.active) return;
    const e = this.el;
    const tab = this.tab;
    for (const b of e.tabs.querySelectorAll('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === tab);
    const ext = this.mine();
    e.items.replaceChildren();
    const cell = (i, icon, label, sel, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.i = String(i);
      b.className = sel ? 'sel' : '';
      b.title = title || label;
      if (icon instanceof HTMLCanvasElement) b.append(icon);
      else {
        const ic = document.createElement('span');
        ic.className = 'ic';
        ic.textContent = icon;
        b.append(ic);
      }
      const pr = document.createElement('span');
      pr.className = 'pr';
      pr.textContent = label;
      b.append(pr);
      e.items.append(b);
      if (sel) requestAnimationFrame(() => b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
    };
    const keyNo = (i) => (this.device.touch || i > 9 ? '' : `${(i + 1) % 10}·`);
    if (tab === 'graffiti') {
      const hex = SPRAY_COLORS[this.color.graffiti].hex;
      GRAFFITI.forEach((d, i) => {
        const c = document.createElement('canvas');
        c.width = 84;
        c.height = 46;
        const ctx = c.getContext('2d');
        const asp = d.text ? 2.4 : d.aspect;
        const h = Math.min(46, 84 / asp);
        ctx.translate((84 - h * asp) / 2, (46 - h) / 2);
        drawDesign(ctx, h * asp, h, d, hex, d.id === 'name' ? this.ownerName() : (this.tagText || 'Tag'), 7);
        cell(i, c, `${keyNo(i)}${d.name}`, i === this.sel.graffiti, d.name);
      });
    } else if (tab === 'neon') {
      NEON_SLOTS.forEach((s, i) => {
        const has = ext.neon[s.id];
        const locked = s.balcony && !ext.balcony;
        cell(i, s.icon, `${keyNo(i)}${has ? '✓ ' : ''}${s.name}`, i === this.sel.neon, locked ? `${s.name} (önce balkon)` : s.name);
      });
    } else {
      cell(0, '🏗️', ext.balcony ? '✓ Balkon' : `${keyNo(0)}€${BALCONY.price}`, this.sel.balcony === 0, 'Balkon');
      BALCONY_ITEMS.forEach((it, k) => {
        const own = ext.balcony?.items.includes(it.id);
        cell(k + 1, it.icon, own ? `✓ ${it.name}` : `${keyNo(k + 1)}€${it.price}`, this.sel.balcony === k + 1, `${it.name} · €${it.price}`);
      });
    }
    // Renkler
    const palette = tab === 'graffiti' ? SPRAY_COLORS : tab === 'neon' ? NEON_COLORS : BALCONY.colors;
    e.colors.replaceChildren();
    palette.forEach((c, i) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.dataset.c = String(i);
      sw.className = `sw${i === this.color[tab] ? ' sel' : ''}${c.rainbow ? ' rainbow' : ''}`;
      if (!c.rainbow) sw.style.background = c.hex;
      sw.title = c.name;
      sw.setAttribute('aria-label', c.name);
      e.colors.append(sw);
    });
    // Boyut (yalnızca graffiti)
    e.sizes.hidden = tab !== 'graffiti';
    e.sizes.replaceChildren();
    TAG_SIZES.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.s = String(i);
      b.className = i === this.size ? 'sel' : '';
      b.textContent = s.id.toUpperCase();
      b.title = s.name;
      e.sizes.append(b);
    });
    const d = GRAFFITI[this.sel.graffiti];
    e.text.hidden = !(tab === 'neon' || (tab === 'graffiti' && d.id === 'custom'));
    e.cans.hidden = tab !== 'graffiti';
    e.remove.hidden = false;
    this.renderInfo();
  }

  renderInfo() {
    if (!this.active) return;
    const ext = this.mine();
    const wallet = this.getWallet();
    const w = Number.isFinite(wallet) ? ` · 🎒 €${Math.floor(wallet)}` : '';
    this.el.info.textContent = this.tab === 'graffiti' ? `🧴 ${ext.sprays} sıkım${w}` : w.slice(3);
  }

  hintText() {
    if (this.device.touch) {
      return this.tab === 'graffiti' ? 'Duvara bak, Aksiyon\'u basılı tut: sprey. Sağ taraftan sürükleyerek nişan al.' : 'Seç, Aksiyon ile al / yerleştir.';
    }
    const common = '1-9 / tekerlek seç · C renk · Q sekme · B çık';
    if (this.tab === 'graffiti') return `E basılı tut: sprey · R boyut · T yazı · X sil · ${common}`;
    if (this.tab === 'neon') return `E tabela koy (€${EXT_RULES.NEON_PRICE}) · T yazı · X kaldır · ${common}`;
    return `E satın al · X eşyayı sök (iadesiz) · ${common}`;
  }

  ownerName() {
    return cleanText(this.house.ownerName(this.ownedHouseId) || this.settings?.name || '', EXT_RULES.TAG_TEXT_MAX) || 'Ik';
  }

  // ---- Yazı paneli --------------------------------------------------------------------

  openText() {
    if (!this.active) return;
    const neon = this.tab === 'neon';
    if (!neon && this.tab === 'graffiti' && GRAFFITI[this.sel.graffiti].id !== 'custom') {
      this.sel.graffiti = GRAFFITI.findIndex((d) => d.id === 'custom');
      this.changed();
    } else if (!neon && this.tab !== 'graffiti') return;
    this.cancelSpray();
    const e = this.el;
    e.panelTitle.textContent = neon ? '💡 Neon tabela yazısı' : '✍️ Graffiti yazısı';
    e.panelSub.textContent = neon
      ? `En fazla ${EXT_RULES.NEON_TEXT_MAX} karakter. Tabela €${EXT_RULES.NEON_PRICE}; yazıyı sonra değiştirmek de €${EXT_RULES.NEON_PRICE}.`
      : `En fazla ${EXT_RULES.TAG_TEXT_MAX} karakter — sprey yazısı olarak duvara çıkar.`;
    e.input.maxLength = neon ? EXT_RULES.NEON_TEXT_MAX : EXT_RULES.TAG_TEXT_MAX;
    e.input.value = neon ? this.neonText : this.tagText;
    this.modal.open(e.panel);
    setTimeout(() => {
      e.input.focus();
      e.input.select();
    }, 30);
  }

  saveText() {
    const neon = this.tab === 'neon';
    const t = cleanText(this.el.input.value, neon ? EXT_RULES.NEON_TEXT_MAX : EXT_RULES.TAG_TEXT_MAX);
    if (neon) this.neonText = t;
    else this.tagText = t;
    this.modal.close(this.el.panel);
    this.changed();
  }

  // ---- Sunucu durumu -------------------------------------------------------------------

  /** WELCOME snapshot.exterior: { [houseId]: cephe } (boş cepheler gelmez) */
  applySnapshot(map) {
    const src = map && typeof map === 'object' ? map : {};
    for (const h of PLAYER_HOUSES) {
      const next = src[h.id] ?? null;
      const had = this.ext.has(h.id);
      if (!next && !had) continue;
      if (next) this.ext.set(h.id, next);
      else this.ext.delete(h.id);
      this.rebuild(h.id);
    }
    this.changed();
  }

  /** EVT.EXTERIOR_STATE */
  onState({ houseId, exterior }) {
    if (!HOUSE_BY_ID[houseId]) return;
    this.ext.set(houseId, exterior ?? emptyExterior());
    this.rebuild(houseId);
    if (this.active && houseId === this.ownedHouseId) this.changed();
  }

  /** EVT.SELF: cüzdan değişti */
  onSelf() {
    if (!this.active) return;
    this.renderInfo();
    this.engine.requestRender();
  }

  mine() {
    return this.ext.get(this.ownedHouseId) ?? emptyExterior();
  }

  /** Gece seviyesi 0 … 1 (dünyanın tek seferlik ışık geçişiyle birlikte) */
  setNight(t) {
    this.night = t;
    this.glowMat.opacity = 0.3 + 0.5 * t;
  }

  // ---- Çizim (ev başına bir grup) ------------------------------------------------------------

  rebuild(houseId) {
    const old = this.groups.get(houseId);
    if (old) {
      this.scene.remove(old.group);
      for (const x of old.dispose) x.dispose();
      this.groups.delete(houseId);
    }
    const ext = this.ext.get(houseId);
    const def = HOUSE_BY_ID[houseId];
    if (!ext || !def) {
      this.engine.requestRender();
      return;
    }
    const minX = def.bounds.minX;
    const X = minX + FACADE.centerX;
    const hi = PLAYER_HOUSES.indexOf(def);
    const group = new THREE.Group();
    group.name = `exterior:${houseId}`;
    const dispose = [];
    const lists = { solid: [], unlit: [], glow: [] };
    const add = (mesh) => {
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    };

    // Graffiti: hepsi tek dokuda, tek düzlemde
    if (ext.tags.length) {
      const ppm = this.engine.quality?.texSize >= 512 ? 170 : 128;
      const cw = Math.round(W * ppm);
      const ch = Math.round((GY1 - GY0) * ppm);
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      for (const t of ext.tags) {
        const d = GRAFFITI_BY_ID[t.d];
        if (!d) continue;
        const r = tagRect(t);
        // Düzlem π döndürülü: kanvasın solu yerel x = W (sokaktan bakana göre sol)
        ctx.save();
        ctx.translate((W - r.x1) * ppm, (GY1 - r.y1) * ppm);
        drawDesign(ctx, r.w * ppm, r.h * ppm, d, SPRAY_COLORS[t.c]?.hex ?? '#ffffff', t.t, t.id * 7919 + hi * 131);
        ctx.restore();
      }
      const tex = canvasTexture(canvas);
      tex.anisotropy = 4;
      const mat = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, GY1 - GY0), mat);
      mesh.position.set(minX + W / 2, (GY0 + GY1) / 2, DECAL_Z);
      mesh.rotation.y = Math.PI;
      mesh.renderOrder = 1;
      add(mesh);
      dispose.push(tex, mat, mesh.geometry);
    }

    // Balkon
    if (ext.balcony) this.buildBalcony(lists, X, ext.balcony, hi);

    // Neon tabelalar: yazı düzlemi + duvara vuran parıltı
    for (const s of NEON_SLOTS) {
      const n = ext.neon[s.id];
      if (!n || (s.balcony && !ext.balcony)) continue;
      const cdef = NEON_COLORS[n.c] ?? NEON_COLORS[0];
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = Math.max(32, Math.round((512 * s.h) / s.w));
      drawNeon(canvas.getContext('2d'), canvas.width, canvas.height, n.text, cdef);
      const tex = canvasTexture(canvas);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
      mesh.position.set(minX + s.x, s.y, OUT - s.dz);
      mesh.rotation.y = Math.PI;
      mesh.renderOrder = 3; // parıltının ÜSTÜNDE: yazı okunur kalsın
      add(mesh);
      dispose.push(tex, mat, mesh.geometry);
      lists.glow.push(this.glowQuad(minX + s.x, s.y, OUT - s.dz + 0.006, s.w * 1.5, s.h * 2.6, cdef));
    }

    for (const [key, mat] of [['solid', this.solidMat], ['unlit', this.unlitMat], ['glow', this.glowMat]]) {
      const list = lists[key];
      if (!list.length) continue;
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      if (key === 'glow') mesh.renderOrder = 2;
      add(mesh);
      dispose.push(geo);
    }
    this.scene.add(group);
    this.groups.set(houseId, { group, dispose });
    this.engine.requestRender();
  }

  /** Parıltı dörtgeni (sokağa bakar); gökkuşağında sütun sütun renk */
  glowQuad(x, y, z, w, h, cdef) {
    const seg = cdef.rainbow ? 6 : 1;
    const geo = new THREE.PlaneGeometry(w, h, seg, 1);
    geo.rotateY(Math.PI).translate(x, y, z);
    const pos = geo.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      if (cdef.rainbow) _c.setHSL(((x + w / 2 - pos.getX(i)) / w) * 0.8, 1, 0.55);
      else _c.set(cdef.hex);
      arr[i * 3] = _c.r;
      arr[i * 3 + 1] = _c.g;
      arr[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  /** Balkon: döşeme, korkuluk, konsollar + seçili eşyalar (hepsi köşe renkli kutular) */
  buildBalcony(lists, X, b, seed) {
    const S = (g, hex) => lists.solid.push(tint(g, hex));
    const rail = BALCONY.colors[b.c]?.hex ?? BALCONY.colors[0].hex;
    const x0 = X - BALCONY.w / 2;
    const x1 = X + BALCONY.w / 2;
    const zF = OUT - BALCONY.depth; // ön kenar
    const y0 = BALCONY.y;
    const yF = y0 + BALCONY.slab; // döşeme üstü
    const yT = yF + BALCONY.railH; // küpeşte
    // Döşeme: taş plak + ahşap deck
    S(boxGeo(x0, x1, y0, yF, zF, OUT), '#d8d2c4');
    S(boxGeo(x0 + 0.04, x1 - 0.04, yF, yF + 0.012, zF + 0.04, OUT - 0.005), '#9a7350');
    // Konsollar (çapraz demir payandalar)
    const len = Math.hypot(0.6, 0.4);
    for (const x of [x0 + 0.35, x1 - 0.35]) {
      S(new THREE.BoxGeometry(0.04, len, 0.04).rotateX(Math.atan2(-0.6, 0.4)).translate(x, y0 - 0.2, OUT - 0.3), rail);
      S(boxGeo(x - 0.05, x + 0.05, y0 - 0.46, y0, OUT - 0.02, OUT), rail);
    }
    // Korkuluk: küpeşte, alt kuşak, dikmeler (ön + yanlar)
    S(boxGeo(x0, x1, yT - 0.04, yT, zF, zF + 0.05), rail);
    S(boxGeo(x0, x1, yF + 0.06, yF + 0.09, zF + 0.005, zF + 0.035), rail);
    for (const xs of [x0, x1 - 0.05]) {
      S(boxGeo(xs, xs + 0.05, yT - 0.04, yT, zF, OUT), rail);
      S(boxGeo(xs + 0.01, xs + 0.04, yF + 0.06, yF + 0.09, zF, OUT), rail);
    }
    const n = Math.round(BALCONY.w / 0.11);
    for (let k = 0; k <= n; k++) {
      const x = x0 + 0.025 + (k * (BALCONY.w - 0.05)) / n;
      S(boxGeo(x - 0.009, x + 0.009, yF, yT - 0.04, zF + 0.012, zF + 0.03), rail);
    }
    for (const xs of [x0 + 0.025, x1 - 0.025]) {
      for (let k = 1; k < 6; k++) {
        const z = zF + (k * BALCONY.depth) / 6;
        S(boxGeo(xs - 0.009, xs + 0.009, yF, yT - 0.04, z - 0.009, z + 0.009), rail);
      }
    }
    const has = (id) => b.items.includes(id);
    // Masa + 2 sandalye (bistro)
    if (has('table')) {
      const tx = X + 0.95;
      const tz = OUT - 0.38;
      const mc = '#2f5d4a';
      S(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 16).translate(tx, yF + 0.72, tz), '#e9e2d0');
      S(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6).translate(tx, yF + 0.36, tz), mc);
      S(new THREE.CylinderGeometry(0.14, 0.16, 0.02, 12).translate(tx, yF + 0.01, tz), mc);
      for (const sgn of [-1, 1]) {
        const cx = tx + sgn * 0.42;
        S(boxGeo(cx - 0.17, cx + 0.17, yF + 0.44, yF + 0.47, tz - 0.17, tz + 0.17), mc);
        const bx = cx + sgn * 0.15;
        S(boxGeo(bx - 0.015, bx + 0.015, yF + 0.47, yF + 0.86, tz - 0.17, tz + 0.17), mc);
        for (const lx of [cx - 0.15, cx + 0.15]) {
          for (const lz of [tz - 0.15, tz + 0.15]) S(boxGeo(lx - 0.012, lx + 0.012, yF, yF + 0.44, lz - 0.012, lz + 0.012), mc);
        }
      }
      // Masada küçük bir lale vazosu
      S(new THREE.CylinderGeometry(0.03, 0.025, 0.1, 8).translate(tx, yF + 0.785, tz), '#2b5ea7');
      S(new THREE.SphereGeometry(0.035, 6, 4).translate(tx, yF + 0.87, tz), '#d7263d');
    }
    // Lale kutuları: korkuluğun dışına asılı iki ahşap kutu
    if (has('flowers')) {
      const r = rng(seed * 17 + 3);
      const colors = ['#d7263d', '#ffd23f', '#f28ab2', '#ff7a1a'];
      for (const bx of [x0 + 0.5, x1 - 0.5]) {
        const zb = zF - 0.2;
        S(boxGeo(bx - 0.38, bx + 0.38, yT - 0.18, yT - 0.02, zb, zF - 0.01), '#7a4f2e');
        S(boxGeo(bx - 0.36, bx + 0.36, yT - 0.025, yT - 0.015, zb + 0.02, zF - 0.03), '#3d2a1c');
        for (let k = 0; k < 7; k++) {
          const sx = bx - 0.3 + k * 0.1 + (r() - 0.5) * 0.03;
          const sz = zb + 0.05 + r() * 0.1;
          const h = 0.16 + r() * 0.1;
          S(new THREE.CylinderGeometry(0.008, 0.008, h, 4).translate(sx, yT - 0.02 + h / 2, sz), '#3f8f3a');
          S(new THREE.CylinderGeometry(0.035, 0.02, 0.07, 6).translate(sx, yT - 0.02 + h + 0.025, sz), colors[Math.floor(r() * colors.length)]);
          if (k % 2 === 0) S(new THREE.SphereGeometry(0.05, 6, 4).scale(1, 0.5, 0.8).translate(sx + 0.04, yT + 0.02, sz), '#3f8f3a');
        }
      }
    }
    // Işık zinciri: ön köşelerdeki iki direk arasında sarkan tel + ampuller
    if (has('lights')) {
      const top = yT + 0.62;
      for (const px of [x0 + 0.025, x1 - 0.025]) {
        S(boxGeo(px - 0.012, px + 0.012, yT, top, zF + 0.012, zF + 0.036), rail);
        // Direkten duvara giden tel
        S(boxGeo(px - 0.004, px + 0.004, top - 0.004, top + 0.004, zF + 0.02, OUT), '#222222');
      }
      const N = 14;
      const bulbs = ['#ffe3a1', '#ffd27a', '#ffb3d9', '#b3e8ff', '#ffe3a1'];
      let prev = null;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const x = x0 + 0.025 + u * (BALCONY.w - 0.05);
        const y = top - 0.22 * Math.sin(Math.PI * u);
        if (prev) {
          const dx = x - prev[0];
          const dy = y - prev[1];
          S(new THREE.BoxGeometry(Math.hypot(dx, dy), 0.006, 0.006).rotateZ(Math.atan2(dy, dx)).translate((x + prev[0]) / 2, (y + prev[1]) / 2, zF + 0.024), '#222222');
        }
        prev = [x, y];
        if (k === 0 || k === N) continue;
        const col = bulbs[k % bulbs.length];
        lists.unlit.push(tint(new THREE.SphereGeometry(0.026, 6, 4).translate(x, y - 0.04, zF + 0.024), col));
        lists.glow.push(this.glowQuad(x, y - 0.04, zF + 0.02, 0.26, 0.26, { hex: col }));
      }
    }
    // Şemsiye
    if (has('parasol')) {
      const px = X - 1.05;
      const pz = OUT - 0.42;
      S(boxGeo(px - 0.13, px + 0.13, yF, yF + 0.06, pz - 0.13, pz + 0.13), '#3a3a3a');
      S(new THREE.CylinderGeometry(0.018, 0.018, 1.95, 6).translate(px, yF + 0.975, pz), '#d9d4c8');
      const cone = new THREE.ConeGeometry(0.42, 0.26, 10, 1, true).translate(px, yF + 1.8, pz);
      // Turuncu-beyaz dilimler (köşe rengi dilim dilim)
      const pos = cone.attributes.position;
      const arr = new Float32Array(pos.count * 3);
      const a = new THREE.Color('#ff7a1a');
      const w = new THREE.Color('#f5efe2');
      for (let i = 0; i < pos.count; i++) {
        const ang = Math.atan2(pos.getZ(i) - pz, pos.getX(i) - px);
        const c = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 10 + 0.5) % 2 ? a : w;
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      cone.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      lists.solid.push(cone);
      S(new THREE.SphereGeometry(0.03, 6, 4).translate(px, yF + 1.95, pz), '#d9d4c8');
    }
  }

  // ---- Mod ------------------------------------------------------------------------------------

  /** Dış cephe moduna girilebilir mi: kendi evinin önünde (evin içinde değil) */
  canEnter() {
    const own = this.ownedHouseId;
    if (!own || this.house.houseId !== null || this.player.drive || this.player.follow) return false;
    const { x, z } = this.player.pos;
    return frontOfHouse(x, z)?.id === own;
  }

  /** @returns {boolean} komut işlendi mi */
  command(cmd) {
    if (cmd === 'build') {
      if (this.active) {
        this.toggle(false);
        return true;
      }
      if (this.house.houseId === null && this.canEnter()) {
        this.toggle(true);
        return true;
      }
      return false;
    }
    if (!this.active) return false;
    const tab = this.tab;
    const count = tab === 'graffiti' ? GRAFFITI.length : tab === 'neon' ? NEON_SLOTS.length : BALCONY_ITEMS.length + 1;
    const palette = tab === 'graffiti' ? SPRAY_COLORS : tab === 'neon' ? NEON_COLORS : BALCONY.colors;
    if (cmd === 'selNext' || cmd === 'selPrev') this.sel[tab] = (this.sel[tab] + (cmd === 'selNext' ? 1 : count - 1)) % count;
    else if (cmd.startsWith('select:')) {
      const i = Number(cmd.slice(7));
      if (!(i >= 0 && i < count)) return true;
      this.sel[tab] = i;
    } else if (cmd === 'color') this.color[tab] = (this.color[tab] + 1) % palette.length;
    else if (cmd === 'rotate') {
      if (tab !== 'graffiti') return true;
      this.size = (this.size + 1) % TAG_SIZES.length;
    } else if (cmd === 'cycle') {
      this.setTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length]);
      return true;
    } else if (cmd === 'tv') {
      this.openText();
      return true;
    } else if (cmd === 'remove') {
      this.remove();
      return true;
    } else {
      return false;
    }
    this.cancelSpray();
    this.changed();
    return true;
  }

  toggle(on = !this.active) {
    if (on === this.active) return;
    if (on && !this.canEnter()) return;
    this.active = on;
    this.el.bar.hidden = !on;
    document.body.classList.toggle('building', on);
    document.body.classList.toggle('ext-building', on);
    this.el.btn.classList.toggle('on', on);
    this.interaction.setEnabled(!on);
    if (on) {
      this.el.hint.textContent = this.hintText();
      this.changed();
      this.hud.toast('🎨 Dış cephe modu: graffiti, neon tabela ve balkonla evini süsle. Herkes görür!', 'info');
    } else {
      this.cancelSpray();
      this.ghost.visible = false;
      this.frame.visible = false;
      this.targetFrame.visible = false;
      this.hud.setPrompt(null);
      this.touch?.setLabel(null);
      this.touch?.setReady(false);
      this.interaction.invalidate();
    }
    this.engine.requestRender();
  }

  // ---- Kare güncellemesi ----------------------------------------------------------------

  /** @returns {boolean} animasyon (sprey) sürüyor mu */
  update() {
    // 🛠 butonu: evlerin dışında, kendi evinin önündeyken görünür (içeride HouseSystem yönetir)
    // (8 evlik ucuz bir aralık testi; motor uyurken hiç çağrılmaz)
    if (this.house.houseId === null) {
      const front = this.canEnter();
      if (this.el.btn.hidden === front) this.el.btn.hidden = !front;
      if (front && !this.greeted) {
        this.greeted = true;
        const key = this.device.touch ? '🛠 Dekor butonu' : 'B tuşu';
        this.hud.toast(`🏡 Evinin önündesin! ${key} ile dış cepheyi süsle: graffiti, neon tabela, balkon.`, 'info');
      }
      if (this.active && !front) {
        this.toggle(false);
        this.hud.toast('Evinin önünden ayrıldın — dış cephe modu kapandı.', 'info');
        return false;
      }
    }
    if (!this.active) return false;
    if (this.house.houseId !== null) {
      this.toggle(false); // eve girdi: içeride HouseSystem'in dekor modu geçerli
      return false;
    }
    if (this.spray) return this.updateSpray();
    this.updateMode();
    return false;
  }

  /** Kameradan cephe düzlemine ışın → { houseId, x (yerel), y, dist } | null */
  aim() {
    const cam = this.engine.camera;
    cam.getWorldDirection(_dir);
    if (_dir.z < 0.08) return null;
    const t = (OUT - cam.position.z) / _dir.z;
    if (t <= 0 || t > EXT_RULES.REACH + 2) return null;
    const x = cam.position.x + _dir.x * t;
    const y = cam.position.y + _dir.y * t;
    const h = PLAYER_HOUSES.find((d) => x >= d.bounds.minX && x < d.bounds.maxX);
    if (!h) return null;
    return { houseId: h.id, x: x - h.bounds.minX, y, wx: x };
  }

  updateMode() {
    const own = this.ownedHouseId;
    const ext = this.mine();
    const def = HOUSE_BY_ID[own];
    const touchKey = this.device.touch ? null : 'E';
    this.frame.visible = false;
    this.ghost.visible = false;
    this.targetFrame.visible = false;
    this.target = null;
    this.cand = null;
    this.el.hint.textContent = this.hintText();

    if (this.tab === 'graffiti') {
      const a = this.aim();
      const onMine = a && a.houseId === own;
      if (onMine) {
        this.target = tagAtPoint(ext.tags, a.x, a.y);
        if (this.target) {
          const r = tagRect(this.target);
          this.showFrame(this.targetFrame, def.bounds.minX, r, 0.03);
          this.el.hint.textContent = `${this.device.touch ? '🗑' : 'X'}: bu graffiti'yi sil (iade yok)`;
        }
      }
      if (!ext.sprays) {
        this.check = { ok: true, buy: true };
        this.prompt({ key: touchKey, text: `🧴 Sprey kutusu al · €${EXT_RULES.CAN_PRICE} (${EXT_RULES.CAN_SPRAYS} sıkım)` }, 'Al', true);
        if (onMine) this.previewTag(a, ext, def, false);
        return;
      }
      if (!a) {
        this.prompt({ info: 'Evinin duvarına bak — şablon duvarda önizlenir.' }, null, false);
        return;
      }
      if (!onMine) {
        this.prompt({ info: '⚠ Bu duvar senin değil — yalnızca kendi cepheni boyayabilirsin.' }, null, false);
        return;
      }
      this.previewTag(a, ext, def, true);
      return;
    }

    if (this.tab === 'neon') {
      const s = NEON_SLOTS[this.sel.neon];
      const cdef = NEON_COLORS[this.color.neon];
      const text = cleanText(this.neonText, EXT_RULES.NEON_TEXT_MAX);
      const cur = ext.neon[s.id];
      let check = { ok: true };
      if (s.balcony && !ext.balcony) check = { ok: false, error: 'Korkuluğa tabela için önce balkon al (Balkon sekmesi).' };
      else if (!text) check = { ok: false, error: 'Önce tabelanın yazısını yaz (T / ✏️).' };
      else if (cur && cur.text === text && cur.c === this.color.neon) check = { ok: false, error: 'Bu tabela zaten orada.' };
      else if (this.getWallet() < EXT_RULES.NEON_PRICE) check = { ok: false, error: `Neon tabela €${EXT_RULES.NEON_PRICE} — cüzdanda yeterli para yok.` };
      this.check = check;
      const r = { x0: s.x - s.w / 2, x1: s.x + s.w / 2, y0: s.y - s.h / 2, y1: s.y + s.h / 2, w: s.w, h: s.h };
      if (text) {
        const key = `neon:${text}:${this.color.neon}:${s.id}`;
        if (this.ghostKey !== key) {
          this.ghostKey = key;
          const c = this.ghostCanvas;
          c.width = 512;
          c.height = Math.max(32, Math.round((512 * s.h) / s.w));
          drawNeon(c.getContext('2d'), c.width, c.height, text, cdef);
          this.setGhostTexture(c);
        }
        this.placeGhost(def.bounds.minX, r, s.dz + 0.01);
      }
      this.showFrame(this.frame, def.bounds.minX, r, s.dz + 0.012, check.ok);
      if (cur) this.el.hint.textContent = `${this.device.touch ? '🗑' : 'X'}: "${cur.text}" tabelasını kaldır (iade yok) · ${this.hintText()}`;
      this.prompt(check.ok
        ? { key: touchKey, text: `💡 ${s.name}: "${text}" ${cur ? 'ile değiştir' : 'tabelası koy'} · €${EXT_RULES.NEON_PRICE}` }
        : { info: `⚠ ${check.error}` }, 'Koy', check.ok);
      return;
    }

    // Balkon
    const i = this.sel.balcony;
    const X = def.bounds.minX + FACADE.centerX;
    const box = { x: X, y: BALCONY.y + 0.5, z: OUT - BALCONY.depth / 2, w: BALCONY.w + 0.06, h: 1.05, d: BALCONY.depth + 0.06 };
    let check;
    let text;
    if (i === 0) {
      const col = BALCONY.colors[this.color.balcony];
      text = `🏗️ Balkon (${col.name}) · €${BALCONY.price}`;
      if (ext.balcony) check = { ok: false, error: 'Evinin zaten bir balkonu var — eşyaları seç (2-5).' };
      else if (this.getWallet() < BALCONY.price) check = { ok: false, error: `Balkon €${BALCONY.price} — cüzdanda yeterli para yok.` };
      else check = { ok: true };
    } else {
      const it = BALCONY_ITEMS[i - 1];
      text = `${it.icon} ${it.name} · €${it.price}`;
      if (!ext.balcony) check = { ok: false, error: `Önce balkon al (€${BALCONY.price}).` };
      else if (ext.balcony.items.includes(it.id)) {
        check = { ok: false, error: `${it.name} balkonda.` };
        this.el.hint.textContent = `${this.device.touch ? '🗑' : 'X'}: ${it.name} sök (iade yok) · ${this.hintText()}`;
      } else if (this.getWallet() < it.price) check = { ok: false, error: `${it.name} €${it.price} — cüzdanda yeterli para yok.` };
      else check = { ok: true };
    }
    this.check = check;
    this.frame.position.set(box.x, box.y, box.z);
    this.frame.scale.set(box.w, box.h, box.d);
    this.frame.material.color.setHex(check.ok ? 0x3cff7a : 0xff4f4f);
    this.frame.visible = true;
    this.prompt(check.ok ? { key: touchKey, text: `${text} — satın al` } : { info: `⚠ ${check.error}` }, 'Al', check.ok);
  }

  previewTag(a, ext, def, full) {
    const d = GRAFFITI[this.sel.graffiti];
    const cand = {
      d: d.id, c: this.color.graffiti, s: this.size, x: roundPos(a.x), y: roundPos(a.y),
    };
    if (d.text) cand.t = d.auto ? this.ownerName() : cleanText(this.tagText, EXT_RULES.TAG_TEXT_MAX);
    let check = validateTag(ext.tags, cand);
    const me = this.player.pos;
    if (check.ok && Math.hypot(me.x - a.wx, me.z - OUT) > EXT_RULES.REACH - REACH_MARGIN) check = { ok: false, error: 'Çok uzak — duvara yaklaş.' };
    const r = tagRect(cand);
    const key = `tag:${d.id}:${cand.c}:${cand.t ?? ''}`;
    if (this.ghostKey !== key) {
      this.ghostKey = key;
      const c = this.ghostCanvas;
      const asp = tagAspect(d, cand.t);
      c.height = 192;
      c.width = Math.round(192 * asp);
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      drawDesign(ctx, c.width, c.height, d, SPRAY_COLORS[cand.c].hex, cand.t, 99);
      this.setGhostTexture(c);
    }
    this.placeGhost(def.bounds.minX, r, 0.03);
    this.showFrame(this.frame, def.bounds.minX, r, 0.032, check.ok);
    if (!full) return;
    this.cand = check.ok ? cand : null;
    this.check = check;
    const left = this.mine().sprays;
    const holdKey = this.device.touch ? null : 'E';
    this.prompt(check.ok
      ? { key: holdKey, text: `basılı tut: ${d.icon} ${d.name} spreyle · 🧴 ${left} sıkım` }
      : { info: `⚠ ${check.error}` }, 'Sprey', check.ok);
  }

  setGhostTexture(canvas) {
    this.ghostTex?.dispose();
    this.ghostTex = canvasTexture(canvas);
    this.ghostMat.map = this.ghostTex;
    this.ghostMat.needsUpdate = true;
  }

  placeGhost(minX, r, dz) {
    this.ghost.position.set(minX + (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, OUT - dz);
    this.ghost.scale.set(r.w, r.h, 1);
    this.ghost.updateMatrix();
    this.ghost.visible = true;
  }

  showFrame(frame, minX, r, dz, ok = false) {
    frame.position.set(minX + (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, OUT - dz);
    frame.scale.set(r.w, r.h, 0.002);
    if (frame === this.frame) frame.material.color.setHex(ok ? 0x3cff7a : 0xff4f4f);
    frame.visible = true;
  }

  prompt(p, short, ready) {
    this.hud.setPrompt(p);
    this.touch?.setLabel(short);
    this.touch?.setReady(!!ready);
  }

  // ---- Eylemler --------------------------------------------------------------------------------

  /** E / Aksiyon / sol tık (dış cephe modu açıkken) */
  action() {
    if (!this.active || this.spray || this.pending) return;
    this.updateMode();
    const ext = this.mine();
    if (this.tab === 'graffiti') {
      if (!ext.sprays) {
        this.buyCans();
        return;
      }
      if (!this.cand) {
        this.hud.toast(this.check?.error || 'Duvara bak.', 'warn');
        return;
      }
      this.startSpray(this.cand);
      return;
    }
    if (!this.check?.ok) {
      this.hud.toast(this.check?.error || 'Olmaz.', 'warn');
      return;
    }
    if (this.tab === 'neon') {
      const s = NEON_SLOTS[this.sel.neon];
      this.send({ act: 'neon', slot: s.id, text: cleanText(this.neonText, EXT_RULES.NEON_TEXT_MAX), c: this.color.neon }, `💡 Neon tabela yandı (−€${EXT_RULES.NEON_PRICE})`);
    } else if (this.sel.balcony === 0) {
      this.send({ act: 'balcony', c: this.color.balcony }, `🏗️ Balkon yapıldı (−€${BALCONY.price}) — şimdi eşyaları seç!`);
    } else {
      const it = BALCONY_ITEMS[this.sel.balcony - 1];
      this.send({ act: 'item', item: it.id }, `${it.icon} ${it.name} balkona kondu (−€${it.price})`);
    }
  }

  async send(data, okText) {
    this.pending = true;
    const res = await this.net.request(EVT.EXTERIOR_ACT, data);
    this.pending = false;
    if (res?.ok) {
      if (okText) this.hud.toast(okText, data.act === 'untag' || data.act.startsWith('un') ? 'info' : 'money');
      if (this.settings?.sound && data.act !== 'untag') this.sfx?.coin?.();
    } else {
      this.hud.toast(res?.error || 'Olmadı.', 'warn');
    }
    this.engine.requestRender();
    return res;
  }

  buyCans() {
    if (!this.active || this.pending) return;
    this.send({ act: 'buyCans' }, `🧴 Sprey kutusu alındı: +${EXT_RULES.CAN_SPRAYS} sıkım (−€${EXT_RULES.CAN_PRICE})`);
  }

  remove() {
    if (this.pending) return;
    const ext = this.mine();
    if (this.tab === 'graffiti') {
      this.updateMode();
      const t = this.target;
      if (!t) {
        this.hud.toast('Silmek için graffiti\'ye bak.', 'info');
        return;
      }
      this.send({ act: 'untag', id: t.id }, `🧽 ${GRAFFITI_BY_ID[t.d]?.name ?? 'Graffiti'} silindi`);
    } else if (this.tab === 'neon') {
      const s = NEON_SLOTS[this.sel.neon];
      if (!ext.neon[s.id]) {
        this.hud.toast(`${s.name}: tabela yok.`, 'info');
        return;
      }
      this.send({ act: 'unneon', slot: s.id }, `💡 ${s.name} tabelası kaldırıldı`);
    } else {
      const it = BALCONY_ITEMS[this.sel.balcony - 1];
      if (!it || !ext.balcony?.items.includes(it.id)) {
        this.hud.toast(it ? `${it.name} balkonda değil.` : 'Balkon kaldırılamaz — eşyaları seçip sökebilirsin.', 'info');
        return;
      }
      this.send({ act: 'unitem', item: it.id }, `${it.icon} ${it.name} söküldü`);
    }
  }

  // ---- Sprey (basılı tut ~0.8 sn) ----------------------------------------------------------------

  startSpray(cand) {
    const p = this.player.pos;
    this.spray = { t0: performance.now(), cand, x: p.x, z: p.z, sound: this.playSpray() };
    const hex = SPRAY_COLORS[cand.c].hex;
    this.particles.material.color.set(hex);
    this.particles.visible = true;
    this.el.ring.hidden = false;
    this.el.ring.style.setProperty('--p', '0');
    this.el.ring.style.setProperty('--c', hex);
    this.engine.requestRender();
  }

  releaseSpray() {
    if (!this.spray) return;
    if (performance.now() - this.spray.t0 < EXT_RULES.SPRAY_MS - 60) {
      this.cancelSpray();
      this.hud.toast('Sprey yarım kaldı — tuşu basılı tut.', 'info');
    }
  }

  cancelSpray() {
    const s = this.spray;
    if (!s) return;
    this.spray = null;
    this.stopSound(s.sound);
    this.particles.visible = false;
    this.el.ring.hidden = true;
    this.engine.requestRender();
  }

  updateSpray() {
    const s = this.spray;
    const k = (performance.now() - s.t0) / EXT_RULES.SPRAY_MS;
    const p = this.player.pos;
    if (Math.hypot(p.x - s.x, p.z - s.z) > 0.4) {
      this.cancelSpray();
      this.hud.toast('Sprey sırasında yürüme — yarım kaldı.', 'info');
      return false;
    }
    this.el.ring.style.setProperty('--p', Math.min(1, k).toFixed(3));
    // Zerrecikler: kameranın sağ altındaki ağızlıktan duvardaki noktaya
    const def = HOUSE_BY_ID[this.ownedHouseId];
    const cam = this.engine.camera;
    const tx = def.bounds.minX + s.cand.x;
    const ty = s.cand.y;
    const tz = OUT - 0.03;
    const nx = cam.position.x - 0.18;
    const ny = cam.position.y - 0.25;
    const nz = cam.position.z + 0.35;
    const arr = this.particles.geometry.attributes.position.array;
    const spread = tagRect(s.cand).h * 0.45;
    for (let i = 0; i < PARTICLES; i++) {
      const u = (i / PARTICLES + k * 2.7) % 1;
      const j = Math.sin(i * 12.9898 + k * 40) * 0.5;
      const q = Math.cos(i * 78.233 + k * 33) * 0.5;
      arr[i * 3] = nx + (tx - nx) * u + j * spread * u;
      arr[i * 3 + 1] = ny + (ty - ny) * u + q * spread * u;
      arr[i * 3 + 2] = nz + (tz - nz) * u;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    if (k < 1) return true;
    const cand = s.cand;
    this.cancelSpray();
    const d = GRAFFITI_BY_ID[cand.d];
    this.send({ act: 'tag', ...cand }, null).then((res) => {
      if (res?.ok) this.hud.toast(`🎨 ${d.name} spreylendi · 🧴 ${res.sprays} sıkım kaldı`, 'info');
    });
    return true;
  }

  /** 'Pssst': yüksek geçiren beyaz gürültü (Sfx'in paylaşılan bağlamı; ses kapalıysa sessiz) */
  playSpray() {
    if (!this.settings?.sound || !this.sfx?.begin) return null;
    try {
      const sec = EXT_RULES.SPRAY_MS / 1000;
      const ctx = this.sfx.begin(EXT_RULES.SPRAY_MS + 150);
      if (!ctx) return null;
      const t = ctx.currentTime + 0.01;
      const out = this.sfx.output(ctx, 0.0001);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3200;
      const src = this.sfx.noiseSource(ctx, t, sec);
      src.connect(hp).connect(out);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
      out.gain.setValueAtTime(0.16, t + sec * 0.85);
      out.gain.exponentialRampToValueAtTime(0.0001, t + sec);
      return { ctx, out, src };
    } catch {
      return null;
    }
  }

  stopSound(s) {
    if (!s) return;
    try {
      const t = s.ctx.currentTime;
      s.out.gain.cancelScheduledValues(t);
      s.out.gain.setValueAtTime(0.0001, t + 0.01);
      s.src.stop(t + 0.03);
    } catch { /* zaten durdu */ }
  }
}


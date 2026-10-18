import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { formatMoney } from '/shared/constants.js';
import { WALL_H, RESTAURANT, isInsideRestaurant } from '/shared/layout.js';
import {
  DISHES, DISH_BY_ID, KITCHEN_INGREDIENT_BY_ID, COOK_METHODS, BUFFET, KITCHEN_STAFF, RESTAURANT_RULES,
  STAFF_TASKS_PER_LEVEL, STAFF_MAX_LEVEL, chefSpeedScale, stayFactor,
} from '/shared/restaurant.js';
import { UV } from '../world/Materials.js';
import { addPlanter, addPainting, addWindow, makePanel } from '../world/Props.js';
import { signDrawer } from '../world/Textures.js';

// Gurme Restoran "De Gouden Lepel" — istemci: bina (yemek salonu, açık büfe, garson tezgâhı, açık mutfak),
// masalardaki / pass'teki tabaklar, sipariş baloncukları, HUD sipariş listesi, aşçı / garson aksesuarları ve
// Resepsiyon PC'nin Çalışanlar sekmesindeki restoran personeli bölümü. FPV mutfak etkileşimi: KitchenSystem.js.
// Statik parçalar otelin StaticBatcher'ına (köşe renkli tek malzeme: restColor → tek draw call); dinamik olan
// yalnızca tabaklar, büfe tepsileri ve ocak / fırın ateşi.

const _c = new THREE.Color();
const FACING = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 };
const STEEL = '#b7bec6';
const STEEL_DARK = '#7d858e';
const VELVET = '#7a1f2b';
const DARK_WOOD = '#3b2618';
const BRICK = '#8e4a32';
const PATIENCE_URGENT = 0.35;

/** Geometriye tek renkli köşe rengi ekler */
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

/** Köşe renkli parçaları tek geometride birleştir */
function mergeParts(parts) {
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    if (f !== g) g.dispose();
    f.deleteAttribute('uv');
    return f;
  });
  const m = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  return m;
}

const P = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  if (rx || ry || rz) geo.rotateX(rx).rotateY(ry).rotateZ(rz);
  return tint(geo.translate(x, y, z), hex);
};

// ---- Tabak modelleri (masa, pass, aşçı / garson elinde, birinci şahıs elde) ---------------------

let dishMat = null;
const dishGeos = new Map();

function plateParts(r = 0.13) {
  return [
    P(new THREE.CylinderGeometry(r, r * 0.82, 0.016, 22), '#fbfaf6', 0, 0.008, 0),
    P(new THREE.TorusGeometry(r * 0.93, 0.006, 4, 22), '#e9e4d8', 0, 0.016, 0, Math.PI / 2),
  ];
}

function dishParts(id) {
  const parts = plateParts();
  const sphere = (r, hex, x, y, z, sy = 1) => parts.push(P(new THREE.SphereGeometry(r, 8, 6).scale(1, sy, 1), hex, x, y, z));
  switch (id) {
    case 'wagyu':
      parts.push(P(new THREE.BoxGeometry(0.12, 0.032, 0.075), '#5a2418', -0.01, 0.034, 0.01, 0, 0.3));
      parts.push(P(new THREE.BoxGeometry(0.11, 0.006, 0.065), '#a8452e', -0.01, 0.051, 0.01, 0, 0.3));
      for (const [x, z] of [[0.065, -0.035], [0.075, 0.025], [0.04, 0.06]]) sphere(0.02, '#d9b45a', x, 0.03, z);
      parts.push(P(new THREE.BoxGeometry(0.06, 0.006, 0.008), '#4f8a3c', -0.02, 0.056, 0.0, 0, 0.9));
      break;
    case 'pizza':
      parts.push(P(new THREE.CylinderGeometry(0.115, 0.115, 0.012, 20), '#d9a24e', 0, 0.022, 0));
      parts.push(P(new THREE.CylinderGeometry(0.098, 0.098, 0.004, 20), '#c8382a', 0, 0.03, 0));
      for (const [x, z] of [[0.03, 0.02], [-0.04, 0.03], [0.0, -0.05], [-0.03, -0.02], [0.05, -0.03]]) sphere(0.018, '#f6f1df', x, 0.032, z, 0.4);
      for (const [x, z] of [[0.045, 0.045], [-0.055, -0.04], [0.01, 0.06]]) sphere(0.012, '#3f9b46', x, 0.036, z, 0.3);
      break;
    case 'burger':
      parts.push(P(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14), '#d39646', 0, 0.026, 0));
      parts.push(P(new THREE.CylinderGeometry(0.064, 0.064, 0.022, 14), '#5a3020', 0, 0.047, 0));
      parts.push(P(new THREE.CylinderGeometry(0.068, 0.068, 0.006, 14), '#6fbf4a', 0, 0.061, 0));
      parts.push(P(new THREE.SphereGeometry(0.062, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1), '#d9a04e', 0, 0.063, 0));
      for (const [x, z] of [[0.09, -0.02], [0.085, 0.03]]) parts.push(P(new THREE.BoxGeometry(0.05, 0.012, 0.012), '#f2c94c', x, 0.025, z, 0, 0.4));
      break;
    case 'sushi':
      for (let i = 0; i < 3; i++) {
        const x = -0.06 + i * 0.05;
        parts.push(P(new THREE.BoxGeometry(0.035, 0.022, 0.06), '#f4f2ea', x, 0.028, -0.03));
        parts.push(P(new THREE.BoxGeometry(0.038, 0.008, 0.064), '#f2875a', x, 0.043, -0.03));
      }
      for (let i = 0; i < 3; i++) {
        const x = -0.055 + i * 0.045;
        parts.push(P(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 10), '#2c4a2a', x, 0.032, 0.045));
        parts.push(P(new THREE.CylinderGeometry(0.014, 0.014, 0.031, 10), '#8fbf4a', x, 0.032, 0.045));
      }
      break;
    case 'souffle':
      parts.push(P(new THREE.CylinderGeometry(0.05, 0.045, 0.06, 16), '#fbfaf6', 0, 0.045, 0));
      parts.push(P(new THREE.SphereGeometry(0.05, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1), '#5a3020', 0, 0.075, 0));
      sphere(0.012, '#e2334a', 0.06, 0.025, 0.05);
      sphere(0.01, '#fbf6ea', 0.0, 0.11, 0.0, 0.6);
      break;
    case 'pavlova':
      parts.push(P(new THREE.CylinderGeometry(0.07, 0.078, 0.045, 14), '#fdf4f0', 0, 0.036, 0));
      parts.push(P(new THREE.CylinderGeometry(0.06, 0.066, 0.02, 14), '#fbf6ea', 0, 0.068, 0));
      for (const [x, z] of [[0.025, 0.02], [-0.03, 0.01], [0.0, -0.035], [-0.01, 0.04], [0.035, -0.02]]) sphere(0.016, '#e2334a', x, 0.085, z);
      break;
    case 'breakfast':
      for (const [x, z] of [[-0.035, -0.02], [0.03, -0.035]]) {
        parts.push(P(new THREE.CylinderGeometry(0.04, 0.042, 0.006, 14), '#fbfaf2', x, 0.02, z));
        sphere(0.016, '#f2b51c', x, 0.026, z, 0.6);
      }
      for (const x of [-0.05, -0.01, 0.03]) parts.push(P(new THREE.BoxGeometry(0.035, 0.018, 0.022), '#d29a4a', x, 0.026, 0.06, 0, 0.2));
      for (const [x, z] of [[0.08, 0.02], [0.085, 0.045], [0.07, 0.06]]) sphere(0.009, '#56632a', x, 0.022, z);
      parts.push(P(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10), '#e8a42a', 0.085, 0.022, -0.04));
      break;
    case 'buffet':
      sphere(0.03, '#f2b51c', -0.04, 0.026, -0.02, 0.5);
      for (const x of [0.0, 0.04]) parts.push(P(new THREE.BoxGeometry(0.035, 0.016, 0.03), '#d29a4a', x, 0.025, 0.04));
      for (const [x, z] of [[0.05, -0.03], [0.07, 0.0], [0.03, -0.06]]) sphere(0.014, ['#e2334a', '#f39a2b', '#8fbf4a'][Math.round(x * 100) % 3], x, 0.026, z);
      parts.push(P(new THREE.BoxGeometry(0.05, 0.01, 0.04), '#f6e7a8', -0.05, 0.022, 0.04));
      break;
    case 'dirty':
      for (const [x, z, r] of [[0.03, 0.02, 0.025], [-0.04, -0.01, 0.018], [0.0, -0.05, 0.014]]) {
        parts.push(P(new THREE.CylinderGeometry(r, r, 0.002, 10), '#9a7a52', x, 0.018, z));
      }
      parts.push(P(new THREE.BoxGeometry(0.11, 0.004, 0.012), '#c4cad2', 0.0, 0.022, 0.03, 0, 0.6));
      sphere(0.008, '#7a4a2a', -0.02, 0.022, 0.05, 0.5);
      break;
    default:
      break;
  }
  return parts;
}

/** Tabak geometrisi (önbellekli, köşe renkli tek mesh) */
export function dishGeometry(id) {
  let g = dishGeos.get(id);
  if (!g) {
    g = mergeParts(dishParts(id));
    dishGeos.set(id, g);
  }
  return g;
}

export function dishMaterial() {
  if (!dishMat) dishMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return dishMat;
}

/** id: tabak kimliği | 'buffet' | 'dirty' */
export function makeDishMesh(id) {
  const m = new THREE.Mesh(dishGeometry(id), dishMaterial());
  m.castShadow = false;
  return m;
}

/** Tepsi (tahta) + üzerinde malzemeler; cooked: tava / fırın tepsisi / hazırlık tahtası görünümü */
export function trayGeometry(items, cooked) {
  const key = `tray:${cooked || ''}:${items.join(',')}`;
  let g = dishGeos.get(key);
  if (g) return g;
  const parts = [];
  if (cooked === 'pan') {
    parts.push(P(new THREE.CylinderGeometry(0.11, 0.095, 0.03, 20), '#2a2a2c', 0, 0.015, 0));
    parts.push(P(new THREE.BoxGeometry(0.03, 0.014, 0.16), '#1c1c1f', 0, 0.022, 0.17));
    parts.push(P(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 16), '#8a5a2a', 0, 0.034, 0));
  } else if (cooked === 'oven') {
    parts.push(P(new THREE.CylinderGeometry(0.13, 0.13, 0.008, 20), '#9aa1a8', 0, 0.004, 0));
    parts.push(P(new THREE.BoxGeometry(0.05, 0.008, 0.16), '#c9a063', 0, 0.004, 0.17));
    parts.push(P(new THREE.CylinderGeometry(0.1, 0.1, 0.018, 18), '#c98a3d', 0, 0.016, 0));
  } else {
    parts.push(P(new THREE.BoxGeometry(0.24, 0.014, 0.16), cooked === 'board' ? '#b08850' : '#c9a063', 0, 0.007, 0));
  }
  const n = items.length;
  items.forEach((id, i) => {
    const ing = KITCHEN_INGREDIENT_BY_ID[id];
    if (!ing) return;
    const a = (i / Math.max(1, n)) * Math.PI * 2 + 0.4;
    const r = n > 1 ? 0.05 : 0;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.7;
    const y = cooked === 'pan' ? 0.045 : cooked === 'oven' ? 0.03 : 0.024;
    const col = cooked && cooked !== 'board' ? new THREE.Color(ing.color).lerp(new THREE.Color('#7a4a22'), 0.35).getStyle() : ing.color;
    parts.push(P(new THREE.SphereGeometry(0.026, 8, 6).scale(1, 0.6, 1), col, x, y, z));
  });
  g = mergeParts(parts);
  dishGeos.set(key, g);
  return g;
}

/** Kirli tabak yığını (1..3) */
export function dirtyStackGeometry(count) {
  const key = `dirty:${count}`;
  let g = dishGeos.get(key);
  if (g) return g;
  const parts = [];
  for (let i = 0; i < Math.max(1, Math.min(3, count)); i++) {
    for (const p of dishParts('dirty')) parts.push(p.translate(0.004 * i, i * 0.022, -0.003 * i));
  }
  g = mergeParts(parts);
  dishGeos.set(key, g);
  return g;
}

// ---- Dokular ----------------------------------------------------------------------------------

function drawRestWall(ctx, w, h, rnd) {
  ctx.fillStyle = '#1f3d35';
  ctx.fillRect(0, 0, w, h);
  // Hafif dikey çizgili ipek duvar kâğıdı + ince altın çizgiler
  for (let x = 0; x < w; x += w / 16) {
    ctx.fillStyle = `rgba(255,255,255,${0.025 + rnd() * 0.02})`;
    ctx.fillRect(x, 0, w / 32, h);
  }
  ctx.fillStyle = 'rgba(201,162,94,.35)';
  for (let x = 0; x < w; x += w / 4) ctx.fillRect(x, 0, Math.max(1, w / 256), h);
  // Küçük madalyon deseni
  ctx.fillStyle = 'rgba(201,162,94,.18)';
  for (let y = h / 8; y < h; y += h / 4) {
    for (let x = w / 8; x < w; x += w / 4) {
      ctx.beginPath();
      ctx.ellipse(x, y, w / 40, h / 28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawKitchenFloor(ctx, w, h, rnd) {
  const n = 8;
  const s = w / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dark = (x + y) % 2 === 1;
      const v = (dark ? 38 : 226) + Math.round((rnd() - 0.5) * 10);
      ctx.fillStyle = `rgb(${v},${v},${v + (dark ? 4 : 0)})`;
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
  ctx.strokeStyle = 'rgba(120,120,120,.5)';
  ctx.lineWidth = Math.max(1, w / 256);
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke();
  }
}

function drawSubway(ctx, w, h, rnd) {
  ctx.fillStyle = '#c9cdd0';
  ctx.fillRect(0, 0, w, h);
  const rows = 8;
  const cols = 4;
  const th = h / rows;
  const tw = w / cols;
  const g = Math.max(1, w / 128);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * tw * 0.5;
    for (let c = -1; c <= cols; c++) {
      const v = 238 + Math.round((rnd() - 0.5) * 10);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 3})`;
      ctx.fillRect(c * tw + off + g, r * th + g, tw - 2 * g, th - 2 * g);
    }
  }
}

/** Kara tahta menü (salon) ve tarif panosu (mutfak) */
function drawBoard(kind) {
  return (ctx, w, h) => {
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(0, 0, w, h);
    const m = h * 0.04;
    ctx.fillStyle = '#1d2a24';
    ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
    ctx.fillStyle = '#f2e6c8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const emoji = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"';
    if (kind === 'menu') {
      ctx.font = `700 ${Math.round(h * 0.085)}px Georgia, serif`;
      ctx.fillText('De Gouden Lepel · Menü', w / 2, h * 0.11);
      ctx.font = `${Math.round(h * 0.052)}px Georgia, serif, ${emoji}`;
      ctx.textAlign = 'left';
      DISHES.forEach((d, i) => {
        const y = h * (0.22 + i * 0.095);
        ctx.fillText(`${d.icon}  ${d.name}${d.lux ? ' ★' : ''}`, w * 0.07, y);
        ctx.textAlign = 'right';
        ctx.fillText(formatMoney(d.price), w * 0.93, y);
        ctx.textAlign = 'left';
      });
      ctx.textAlign = 'center';
      ctx.font = `italic ${Math.round(h * 0.045)}px Georgia, serif`;
      ctx.fillText(`🍳 Açık büfe kahvaltı 07:00–11:00 · ${formatMoney(BUFFET.PRICE)}`, w / 2, h * 0.9);
    } else {
      ctx.font = `700 ${Math.round(h * 0.08)}px Georgia, serif`;
      ctx.fillText('📖 Menü kütüphanesi · Tarifler', w / 2, h * 0.1);
      ctx.font = `${Math.round(h * 0.06)}px sans-serif, ${emoji}`;
      ctx.textAlign = 'left';
      DISHES.forEach((d, i) => {
        const y = h * (0.22 + i * 0.1);
        const ings = d.ingredients.map((x) => KITCHEN_INGREDIENT_BY_ID[x].icon).join(' ');
        ctx.fillText(`${d.icon} ${d.name}`, w * 0.05, y);
        ctx.fillText(`${ings}  →  ${COOK_METHODS[d.method].icon}`, w * 0.5, y);
      });
    }
  };
}

// ---- Bina ------------------------------------------------------------------------------------

/**
 * Restoranı kurar (otelin StaticBatcher'ına). @returns RestaurantView:
 *  setTable(i, plate, dish), setPass(i, dish), setBuffet(stock), setFx(method, untilServerMs), update(serverNow)
 */
export function buildRestaurant({ batcher: b, collision, scene, mats, factory }) {
  const L = (o) => new THREE.MeshLambertMaterial(o);
  Object.assign(mats, {
    restWall: L({ map: factory.make(drawRestWall, { seed: 81, w: 1, h: 1 }) }),
    restTile: L({ map: factory.make(drawKitchenFloor, { seed: 82, w: 1, h: 1 }) }),
    restTileWall: L({ map: factory.make(drawSubway, { seed: 83, w: 1, h: 1 }) }),
    restColor: L({ vertexColors: true }),
    restGlass: L({ color: 0xe4f4fb, transparent: true, opacity: 0.25, depthWrite: false }),
    restMenu: new THREE.MeshBasicMaterial({ map: factory.make(drawBoard('menu'), { w: 1.5, h: 1, repeat: false, minSize: 256 }) }),
    restRecipes: new THREE.MeshBasicMaterial({ map: factory.make(drawBoard('recipes'), { w: 2, h: 1, repeat: false, minSize: 256 }) }),
  });
  const R = RESTAURANT;
  const flat = { cast: false };
  const noShadow = { cast: false, receive: false };
  const paint = (hex, geo, o = {}) => b.add('restColor', tint(geo, hex), o);
  const vbox = (hex, x0, x1, y0, y1, z0, z1, o = {}) => paint(hex, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), {
    ...o, position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  });
  const cyl = (hex, rT, rB, h, x, y, z, seg = 12, o = {}) => paint(hex, new THREE.CylinderGeometry(rT, rB, h, seg), { ...o, position: [x, y + h / 2, z] });
  const KZ = R.pass.minZ; // salon / mutfak sınırı

  // ---- Kabuk: zemin, tavan, duvar kaplamaları, kapı ----
  b.floor('floorRoom', -17.9, -8.0, 8.1, KZ, 0, { uvScale: UV.floorRoom });
  b.floor('restTile', -17.9, -8.1, KZ, 25.9, 0, { uvScale: 0.9 });
  b.floor('ceiling', -18, -8.1, 8.1, 25.9, WALL_H, { facingDown: true, cast: false, receive: false });
  const d = R.door;
  const wall = (mat, x0, x1, y0, y1, z0, z1) => b.box(mat, x0, x1, y0, y1, z0, z1, { ...flat, uvScale: UV[mat] ?? 0.8 });
  // Doğu (otelin batı duvarının restoran yüzü, kapı boşluklu): salonda duvar kâğıdı, mutfakta fayans
  wall('restWall', -8.13, -8.1, 0, WALL_H, 8.13, d.from);
  wall('restWall', -8.13, -8.1, 0, WALL_H, d.to, KZ);
  wall('restWall', -8.13, -8.1, 2.2, WALL_H, d.from, d.to);
  wall('restTileWall', -8.13, -8.1, 0, WALL_H, KZ, 25.87);
  // Güney (Bizim Ev'in arka duvarı) ve kuzey (Achterstraat'ın güney duvarı) yüzleri, mutfakta batı yüzü
  wall('restWall', -17.9, -8.13, 0, WALL_H, 8.1, 8.13);
  wall('restTileWall', -17.9, -8.13, 0, WALL_H, 25.87, 25.9);
  wall('restTileWall', -17.9, -17.87, 0, WALL_H, KZ, 25.87);
  // Salon lambrisi (koyu ahşap) ve tavan silmesi
  const wz = { uvScale: UV.wainscot, cast: false };
  b.box('wainscot', -17.9, -8.13, 0, 0.9, 8.13, 8.16, wz);
  b.box('wainscot', -17.9, -17.87, 0, 0.9, 8.13, KZ, wz);
  b.box('wainscot', -8.16, -8.13, 0, 0.9, 8.16, d.from - 0.12, wz);
  b.box('wainscot', -8.16, -8.13, 0, 0.9, d.to + 0.12, KZ, wz);
  for (const [x0, x1, z0, z1] of [[-17.9, -8.13, 8.13, 8.2], [-17.9, -17.83, 8.13, KZ], [-8.2, -8.13, 8.13, KZ]]) {
    vbox('#c9a25e', x0, x1, WALL_H - 0.12, WALL_H - 0.06, z0, z1, flat);
  }
  // Kapı: pervaz, eşik, iki yüzde kasa
  b.box('wood', -8.1, -7.9, 0, 2.2, d.from, d.from + 0.025, { uvScale: UV.wood });
  b.box('wood', -8.1, -7.9, 0, 2.2, d.to - 0.025, d.to, { uvScale: UV.wood });
  b.box('wood', -8.1, -7.9, 2.175, 2.2, d.from, d.to, { uvScale: UV.wood });
  b.box('wood', -8.16, -7.88, 0, 0.015, d.from, d.to, { ...flat, uvScale: UV.wood });
  for (const [x0, x1, mat] of [[-7.9, -7.86, 'white'], [-8.18, -8.14, 'wainscot']]) {
    const o = mat === 'white' ? flat : wz;
    b.box(mat, x0, x1, 0, 2.32, d.from - 0.12, d.from, o);
    b.box(mat, x0, x1, 0, 2.32, d.to, d.to + 0.12, o);
    b.box(mat, x0, x1, 2.2, 2.32, d.from - 0.12, d.to + 0.12, o);
  }
  b.floor('rugRed', -9.3, -8.25, d.from + 0.1, d.to - 0.1, 0.008, flat);
  // Lobi tarafı: tabela + aplikler
  const zc = (d.from + d.to) / 2;
  const signMat = new THREE.MeshLambertMaterial({
    map: factory.make(signDrawer({ title: 'De Gouden Lepel', sub: 'Gurme Restoran · Açık Büfe', bg: '#1f3d35', fg: '#f2d48a' }), { w: 1.8, h: 0.4, repeat: false }),
  });
  scene.add(makePanel(signMat, 1.7, 0.38, -7.855, 2.64, zc, 'x+'));
  for (const z of [zc - 1.05, zc + 1.05]) {
    b.box('brass', -7.9, -7.84, 2.56, 2.7, z - 0.04, z + 0.04, flat);
    b.add('lamp', new THREE.SphereGeometry(0.055, 8, 6), { ...noShadow, position: [-7.77, 2.66, z] });
  }

  // ---- Yemek salonu ----
  buildTables();
  buildBuffet();
  // Duvarlar: sahte pencereler (güney), tablolar ve menü panosu (doğu), resepsiyon kürsüsü, bitkiler
  for (const x of [-15.6, -12.6]) addWindow(b, { x, y: 1.75, z: 8.13, w: 1.3, h: 1.35, facing: 'z+', glass: 'skyline', uOffset: x * 0.07 });
  addPainting(b, { x: -8.14, y: 1.8, z: 13.0, w: 1.2, h: 0.9, facing: 'x-' });
  b.add('restMenu', new THREE.PlaneGeometry(1.5, 1.0), { ...noShadow, position: [-8.145, 1.75, 16.4], rotation: [0, FACING['x-'], 0] });
  vbox(DARK_WOOD, -8.16, -8.14, 1.2, 2.3, 15.6, 17.2, flat);
  vbox(DARK_WOOD, -8.85, -8.35, 0, 1.05, 12.15, 12.65); // resepsiyon kürsüsü
  vbox('#c9a25e', -8.9, -8.3, 1.05, 1.08, 12.1, 12.7, flat);
  paint('#f4efe2', new THREE.BoxGeometry(0.28, 0.02, 0.2).rotateZ(0.2), { position: [-8.6, 1.1, 12.4] });
  collision.add(-8.9, -8.3, 12.1, 12.7);
  addPlanter(b, collision, -17.35, 8.75, 1);
  addPlanter(b, collision, -9.0, 8.7, 2);
  addPlanter(b, collision, -17.4, 18.85, 0);
  // Masaların üstünde sarkıt lambalar
  for (const tb of R.tables) {
    const [x, z] = tb.center;
    cyl('#2a2523', 0.006, 0.006, WALL_H - 2.25, x, 2.25, z, 4, flat);
    paint('#c9a25e', new THREE.ConeGeometry(0.2, 0.18, 14, 1, true), { ...flat, position: [x, 2.2, z] });
    b.add('lamp', new THREE.SphereGeometry(0.07, 8, 6), { ...noShadow, position: [x, 2.13, z] });
  }

  // ---- Garson tezgâhı (pass) + ısıtıcı lambalar ----
  const PS = R.pass;
  vbox(STEEL_DARK, PS.minX, PS.maxX, 0, PS.top - 0.04, PS.minZ, PS.maxZ);
  vbox(STEEL, PS.minX - 0.02, PS.maxX + 0.02, PS.top - 0.04, PS.top, PS.minZ - 0.04, PS.maxZ + 0.04);
  for (const x of [PS.minX + 0.25, PS.maxX - 0.25]) vbox(STEEL, x - 0.025, x + 0.025, PS.top, 1.86, 19.68, 19.73, flat);
  vbox(STEEL, PS.minX + 0.2, PS.maxX - 0.2, 1.84, 1.9, 19.64, 19.76, flat);
  for (const [x] of R.passSlots) {
    paint('#2a2523', new THREE.ConeGeometry(0.13, 0.12, 12, 1, true), { ...flat, position: [x, 1.77, 19.7] });
    b.add('lamp', new THREE.CircleGeometry(0.1, 12).rotateX(Math.PI / 2), { ...noShadow, position: [x, 1.715, 19.7] });
  }
  paint('#c9a25e', new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), { position: [-11.15, PS.top, 19.52] });
  // Sipariş fişi rayı
  vbox(STEEL, -17.4, -11.6, 1.52, 1.54, 19.95, 20.0, flat);
  for (const x of [-16.9, -15.7, -14.2, -12.9]) vbox('#f4efe2', x - 0.05, x + 0.05, 1.38, 1.52, 19.99, 20.0, flat);
  collision.add(PS.minX - 0.02, PS.maxX + 0.02, PS.minZ - 0.04, PS.maxZ + 0.04);

  // ---- Mutfak ----
  buildKitchen();

  // ---- Dinamik: masadaki / pass'teki tabaklar, büfe tepsileri, ocak ateşi, fırın parıltısı ----
  const dyn = new THREE.Group();
  dyn.name = 'restaurant-dynamic';
  scene.add(dyn);
  const tablePlates = R.tables.map((tb) => {
    const g = new THREE.Group();
    g.position.set(tb.center[0], 0.765, tb.center[1] - 0.24);
    dyn.add(g);
    return { g, key: '' };
  });
  const passPlates = R.passSlots.map(([x, z]) => {
    const g = new THREE.Group();
    g.position.set(x, PS.top + 0.002, z);
    dyn.add(g);
    return { g, key: '' };
  });
  const B = R.buffet;
  const bx = (B.minX + B.maxX) / 2 - 0.05;
  const trayZ = [11.3, 13.9, 16.5];
  const buffetFood = trayZ.map((z, i) => {
    const parts = [];
    const cols = [['#f2b51c', '#fbfaf2'], ['#d29a4a', '#b8783a'], ['#e2334a', '#f39a2b', '#8fbf4a']][i];
    for (let k = 0; k < 14; k++) {
      const x = (k % 2) * 0.14 - 0.07 + (k % 3) * 0.02;
      const zz = (Math.floor(k / 2) - 3) * 0.1;
      parts.push(P(new THREE.SphereGeometry(0.045, 8, 5).scale(1, 0.5, 1), cols[k % cols.length], x, 0, zz));
    }
    const m = new THREE.Mesh(mergeParts(parts), dishMaterial());
    m.position.set(bx, 0.99, z);
    dyn.add(m);
    return m;
  });
  // Ocak alevi (ön sol göz) ve fırın ağzı parıltısı
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.85, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.03, 0.09, 6, 1, true).translate(0, 0.045, 0);
  const flames = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const f = new THREE.Mesh(flameGeo, fireMat);
    f.position.set(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
    flames.add(f);
  }
  flames.position.set(-14.25, 0.96, 25.45);
  flames.visible = false;
  dyn.add(flames);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.35, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16, 0, Math.PI), glowMat);
  glow.position.set(-12.1, 0.86, 25.02);
  glow.rotation.y = Math.PI;
  dyn.add(glow);
  // Hazırlık tezgâhında bıçak (hazırlarken iner kalkar)
  const knife = new THREE.Mesh(mergeParts([
    P(new THREE.BoxGeometry(0.2, 0.004, 0.035), '#d8dde2', 0.06, 0, 0),
    P(new THREE.BoxGeometry(0.1, 0.02, 0.025), '#2a2523', -0.09, 0, 0),
  ]), dishMaterial());
  knife.position.set(-15.55, 0.97, 25.5);
  dyn.add(knife);
  const fxUntil = { pan: 0, oven: 0, board: 0 };

  function setMesh(slot, id) {
    const key = id || '';
    if (slot.key === key) return;
    slot.key = key;
    slot.g.clear();
    if (id) slot.g.add(makeDishMesh(id));
  }

  return {
    tableAnchor: (i) => {
      const [x, z] = R.tables[i].seat;
      return new THREE.Vector3(x, 1.95, z);
    },
    setTable(i, plate, dish) {
      const id = plate === 'dirty' ? 'dirty' : plate === 'full' ? (dish === 'buffet' ? 'buffet' : DISH_BY_ID[dish] ? dish : null) : null;
      setMesh(tablePlates[i], id);
    },
    setPass(i, dish) { setMesh(passPlates[i], DISH_BY_ID[dish] ? dish : null); },
    setBuffet(stock) {
      const trays = stock <= 0 ? 0 : stock <= BUFFET.MAX / 3 ? 1 : stock <= (BUFFET.MAX * 2) / 3 ? 2 : 3;
      buffetFood.forEach((m, i) => { m.visible = i < trays; });
    },
    /** Bir istasyonun ateşi / hareketi bu sunucu zamanına kadar sürsün */
    setFx(method, until) { if (method in fxUntil) fxUntil[method] = Math.max(fxUntil[method], until); },
    /** @returns {boolean} ateş / bıçak hareket ediyor mu */
    update(serverNow) {
      const t = serverNow / 1000;
      const pan = serverNow < fxUntil.pan;
      flames.visible = pan;
      if (pan) {
        flames.children.forEach((f, i) => { f.scale.y = 0.75 + 0.45 * Math.abs(Math.sin(t * 13 + i * 1.7)); });
      }
      const oven = serverNow < fxUntil.oven;
      glowMat.opacity = oven ? 0.75 + 0.2 * Math.sin(t * 9) : 0.3;
      glowMat.color.setHex(oven ? 0xffa040 : 0xff6a10);
      const board = serverNow < fxUntil.board;
      knife.position.y = board ? 0.97 + Math.abs(Math.sin(t * 10)) * 0.07 : 0.97;
      knife.rotation.z = board ? Math.sin(t * 10) * 0.25 : 0;
      return pan || oven || board;
    },
  };

  // ---- Parçalar ---------------------------------------------------------------------------

  function buildTables() {
    for (const tb of R.tables) {
      const [x, z] = tb.center;
      // Yere kadar inen beyaz örtü, ortada mum + lale, iki kişilik servis
      b.box('linen', x - 0.52, x + 0.52, 0.42, 0.76, z - 0.52, z + 0.52);
      b.box('linen', x - 0.5, x + 0.5, 0.05, 0.42, z - 0.5, z + 0.5, flat);
      vbox(DARK_WOOD, x - 0.06, x + 0.06, 0, 0.05, z - 0.06, z + 0.06);
      cyl('#fbfaf2', 0.018, 0.018, 0.1, x, 0.76, z + 0.05, 8, flat);
      b.add('lamp', new THREE.SphereGeometry(0.014, 6, 4), { ...noShadow, position: [x, 0.875, z + 0.05] });
      cyl('#2b5ea7', 0.025, 0.02, 0.09, x + 0.12, 0.76, z + 0.08, 8, flat);
      b.add('tulipRed', new THREE.CylinderGeometry(0.018, 0.012, 0.04, 6), { ...flat, position: [x + 0.12, 0.885, z + 0.08] });
      for (const sz of [-1, 1]) {
        const zz = z + sz * 0.24;
        vbox('#c4cad2', x - 0.19, x - 0.17, 0.762, 0.766, zz - 0.08, zz + 0.08, flat);
        vbox('#c4cad2', x + 0.17, x + 0.19, 0.762, 0.766, zz - 0.08, zz + 0.08, flat);
        b.add('restGlass', new THREE.CylinderGeometry(0.03, 0.026, 0.1, 10, 1, true), { ...noShadow, position: [x + 0.2, 0.81, zz + sz * -0.12] });
        if (sz === 1) {
          // Karşı taraftaki (boş sandalye) servis tabağı statik
          for (const part of plateParts()) b.add('restColor', part, { ...flat, position: [x, 0.762, zz] });
        }
      }
      // Sandalyeler: güneydeki (müşterinin oturduğu) ve kuzeydeki, sırtları masadan dışarı
      for (const sz of [-1, 1]) {
        const cz = z + sz * 0.62;
        vbox(DARK_WOOD, x - 0.22, x + 0.22, 0.4, 0.45, cz - 0.22, cz + 0.22);
        vbox(VELVET, x - 0.2, x + 0.2, 0.45, 0.49, cz - 0.2, cz + 0.2);
        for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) vbox(DARK_WOOD, x + lx - 0.02, x + lx + 0.02, 0, 0.4, cz + lz - 0.02, cz + lz + 0.02, flat);
        const bz = cz + sz * 0.2;
        vbox(DARK_WOOD, x - 0.22, x + 0.22, 0.45, 1.0, bz - 0.025, bz + 0.025);
        const pz0 = bz - sz * 0.045;
        const pz1 = bz - sz * 0.025;
        vbox(VELVET, x - 0.18, x + 0.18, 0.55, 0.95, Math.min(pz0, pz1), Math.max(pz0, pz1), flat);
        collision.add(x - 0.24, x + 0.24, cz - 0.24, cz + 0.24);
      }
      collision.add(x - 0.54, x + 0.54, z - 0.54, z + 0.54);
    }
  }

  function buildBuffet() {
    const B = R.buffet;
    b.box('wainscot', B.minX, B.maxX, 0, 0.9, B.minZ, B.maxZ, wz);
    for (let z = B.minZ + 0.1; z + 0.6 <= B.maxZ; z += 0.74) b.box('wood', B.maxX, B.maxX + 0.015, 0.15, 0.78, z, z + 0.6, { uvScale: UV.wood, cast: false });
    b.box('white', B.minX, B.maxX + 0.06, 0.9, 0.94, B.minZ - 0.04, B.maxZ + 0.04);
    // Isıtmalı servis kapları (yemek dinamik), yarı açık kapaklar
    for (const z of [11.3, 13.9, 16.5]) {
      vbox(STEEL, -17.83, -17.17, 0.94, 0.99, z - 0.42, z + 0.42);
      paint(STEEL, new THREE.CylinderGeometry(0.33, 0.33, 0.84, 14, 1, true, 0, Math.PI / 2).rotateX(Math.PI / 2).rotateY(Math.PI / 2), { ...flat, position: [-17.5, 1.0, z] });
      for (const dz of [-0.36, 0.36]) cyl('#2a2523', 0.03, 0.03, 0.05, -17.25, 0.94, z + dz, 8, flat);
    }
    // Hapşırık camı (eğik) + pirinç dikmeler
    b.add('restGlass', new THREE.PlaneGeometry(B.maxZ - B.minZ - 0.2, 0.4).rotateX(-0.5).rotateY(Math.PI / 2), { ...noShadow, position: [-17.05, 1.32, (B.minZ + B.maxZ) / 2] });
    for (const z of [B.minZ + 0.15, (B.minZ + B.maxZ) / 2, B.maxZ - 0.15]) b.box('brass', -17.1, -17.06, 0.94, 1.5, z - 0.02, z + 0.02, flat);
    // Tabak yığını (kuzey ucu) ve büfe tabelası
    for (let i = 0; i < 8; i++) cyl('#fbfaf6', 0.12, 0.1, 0.014, -17.5, 0.94 + i * 0.016, 17.4, 16, flat);
    const buffetSign = new THREE.MeshLambertMaterial({
      map: factory.make(signDrawer({ title: 'Açık Büfe · Ontbijt', sub: `Kahvaltı 07:00–11:00 · ${formatMoney(BUFFET.PRICE)}`, bg: '#6b2a1f', fg: '#f6e7c1' }), { w: 1.6, h: 0.4, repeat: false }),
    });
    scene.add(makePanel(buffetSign, 1.6, 0.4, -17.87, 2.15, 13.9, 'x+'));
    collision.add(B.minX, B.maxX + 0.06, B.minZ - 0.04, B.maxZ + 0.04);
  }

  function buildKitchen() {
    const C = R.counter;
    const top = C.top;
    // Kuzey duvarı tezgâhı (fırının olduğu yer boş): çelik dolaplar + tabla
    for (const [x0, x1] of [[-16.5, -12.95], [-11.25, C.maxX]]) {
      vbox(STEEL_DARK, x0, x1, 0, top - 0.04, C.minZ, C.maxZ);
      vbox(STEEL, x0, x1, top - 0.04, top, C.minZ - 0.03, C.maxZ);
      for (let x = x0 + 0.06; x + 0.45 <= x1; x += 0.5) {
        vbox(STEEL, x, x + 0.44, 0.1, top - 0.1, C.minZ - 0.012, C.minZ, flat);
        vbox('#2a2523', x + 0.17, x + 0.27, top - 0.2, top - 0.18, C.minZ - 0.03, C.minZ - 0.012, flat);
      }
    }
    collision.add(-17.9, C.maxX, C.minZ - 0.03, 25.9);
    // Buzdolabı (çift kapılı, çelik)
    const F = R.fridge;
    vbox(STEEL, F.minX, F.maxX, 0, 2.1, F.minZ, F.maxZ);
    vbox(STEEL_DARK, -17.21, -17.19, 0.05, 2.05, F.minZ - 0.005, F.minZ, flat);
    for (const x of [-17.32, -17.08]) vbox('#d8dde2', x - 0.015, x + 0.015, 0.8, 1.6, F.minZ - 0.06, F.minZ - 0.01);
    vbox('#1f6fb2', -17.7, -17.45, 1.7, 1.8, F.minZ - 0.006, F.minZ, flat);
    collision.add(F.minX, F.maxX, F.minZ - 0.06, F.maxZ);
    // Hazırlık tezgâhı: kesme tahtası, suşi hasırı, pirinç kâsesi
    const [bx0] = R.stations.board;
    vbox('#c9a063', bx0 - 0.3, bx0 + 0.3, top, top + 0.03, 25.3, 25.7);
    vbox('#4f7a3a', bx0 + 0.32, bx0 + 0.56, top, top + 0.008, 25.35, 25.65, flat);
    paint('#fbfaf6', new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), { position: [bx0 - 0.48, top + 0.1, 25.5] });
    paint('#f4f2ea', new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), { position: [bx0 - 0.48, top + 0.05, 25.5] });
    // Ocak: siyah ocak tablası, 4 göz, düğmeler, arkada tencere + duvarda davlumbaz
    const [sx] = R.stations.pan;
    vbox('#1c1c1f', sx - 0.75, sx + 0.75, top, top + 0.03, 25.22, 25.85);
    for (const [ox, oz] of [[-0.35, -0.2], [0.35, -0.2], [-0.35, 0.2], [0.35, 0.2]]) {
      paint('#4a4a4e', new THREE.TorusGeometry(0.1, 0.012, 4, 16).rotateX(Math.PI / 2), { ...flat, position: [sx + ox, top + 0.035, 25.535 + oz] });
    }
    for (let i = 0; i < 4; i++) cyl('#d8dde2', 0.022, 0.022, 0.03, sx - 0.45 + i * 0.3, 0.7, C.minZ - 0.03, 8, { ...flat, rotation: [Math.PI / 2, 0, 0] });
    cyl('#9aa1a8', 0.12, 0.11, 0.18, sx + 0.35, top + 0.03, 25.735);
    cyl('#2a2a2c', 0.11, 0.095, 0.03, sx + 0.35, top + 0.03, 25.335);
    vbox('#1c1c1f', sx + 0.33, sx + 0.37, top + 0.05, top + 0.064, 25.05, 25.25, flat);
    paint(STEEL, new THREE.CylinderGeometry(0.35, 0.95, 0.45, 4, 1, true).rotateY(Math.PI / 4).scale(1, 1, 0.6), { ...flat, position: [sx, 2.3, 25.45] });
    vbox(STEEL, sx - 0.2, sx + 0.2, 2.52, WALL_H, 25.4, 25.8, flat);
    // Taş pizza fırını: tuğla kaide, kubbe, kemerli ağız, baca
    const ox = R.stations.oven[0];
    vbox(BRICK, ox - 0.8, ox + 0.8, 0, 0.82, 24.95, 25.9);
    vbox('#d8cfc0', ox - 0.82, ox + 0.82, 0.82, 0.86, 24.92, 25.9);
    paint(BRICK, new THREE.SphereGeometry(0.75, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 0.62), { position: [ox, 0.86, 25.45] });
    paint('#140c08', new THREE.CircleGeometry(0.3, 16, 0, Math.PI).rotateY(Math.PI), { ...flat, position: [ox, 0.861, 25.0] });
    for (const lx of [-0.12, 0.05, 0.16]) paint('#4a2716', new THREE.CylinderGeometry(0.025, 0.025, 0.2, 6).rotateZ(Math.PI / 2).rotateY(lx * 3), { ...flat, position: [ox + lx, 0.9, 25.25] });
    cyl('#3b3d42', 0.12, 0.12, WALL_H - 1.5, ox, 1.5, 25.55, 10, flat);
    vbox('#c9a25e', ox - 0.5, ox + 0.5, 1.42, 1.5, 25.0, 25.08, flat);
    collision.add(ox - 0.82, ox + 0.82, 24.92, 25.9);
    // Tabak rafı: tabak yığınları + duvarda tabaklık
    const [px] = R.plates;
    for (const dx of [-0.25, 0.2]) for (let i = 0; i < 10; i++) cyl('#fbfaf6', 0.13, 0.11, 0.014, px + dx, top + i * 0.016, 25.5, 16, flat);
    vbox(STEEL, px - 0.55, px + 0.55, 1.55, 1.58, 25.55, 25.87, flat);
    for (let i = 0; i < 7; i++) paint('#fbfaf6', new THREE.CylinderGeometry(0.12, 0.12, 0.012, 14).rotateX(Math.PI / 2 - 0.25), { ...flat, position: [px - 0.42 + i * 0.14, 1.7, 25.72] });
    // Üst raf: kavanozlar ve tencereler (buzdolabıyla ocak arası)
    vbox(STEEL, -16.45, -14.9, 1.62, 1.65, 25.55, 25.87, flat);
    ['#e8a42a', '#c8382a', '#4f8a3c', '#f4f2ea', '#8a5a2a', '#56632a'].forEach((col, i) => {
      cyl(col, 0.05, 0.05, 0.14, -16.3 + i * 0.25, 1.65, 25.72, 8, flat);
      cyl('#c4cad2', 0.052, 0.052, 0.02, -16.3 + i * 0.25, 1.79, 25.72, 8, flat);
    });
    // Çöp kovası
    const [tx] = R.trash;
    cyl('#2f6b3a', 0.24, 0.21, 0.72, tx, 0, 25.4, 14);
    cyl('#24552e', 0.25, 0.25, 0.04, tx, 0.72, 25.4, 14, flat);
    collision.addAround(tx, 25.4, 0.26);
    // Bulaşık lavabosu (doğu duvarı) + bulaşık sepeti
    vbox(STEEL_DARK, -8.72, -8.1, 0, 0.86, 21.3, 22.7);
    vbox(STEEL, -8.75, -8.1, 0.86, 0.9, 21.28, 22.72);
    paint('#3b4048', new THREE.PlaneGeometry(0.42, 0.9).rotateX(-Math.PI / 2), { ...flat, position: [-8.42, 0.902, 22.0] });
    cyl('#d8dde2', 0.015, 0.015, 0.35, -8.2, 0.9, 22.0, 8, flat);
    paint('#d8dde2', new THREE.TorusGeometry(0.1, 0.012, 4, 10, Math.PI).rotateY(Math.PI / 2), { ...flat, position: [-8.3, 1.25, 22.0] });
    for (let i = 0; i < 5; i++) paint('#fbfaf6', new THREE.CylinderGeometry(0.11, 0.11, 0.01, 12).rotateZ(Math.PI / 2 - 0.2), { ...flat, position: [-8.4, 1.0, 22.45 - i * 0.05] });
    collision.add(-8.75, -8.1, 21.28, 22.72);
    // Orta ada: çelik masa, alt raf; üstünde fesleğen saksıları, zeytinyağı, kâseler
    const I = R.island;
    vbox(STEEL, I.minX, I.maxX, I.top - 0.04, I.top, I.minZ, I.maxZ);
    vbox(STEEL_DARK, I.minX + 0.05, I.maxX - 0.05, 0.2, 0.23, I.minZ + 0.05, I.maxZ - 0.05);
    for (const lx of [I.minX + 0.05, I.maxX - 0.05]) for (const lz of [I.minZ + 0.05, I.maxZ - 0.05]) vbox(STEEL_DARK, lx - 0.025, lx + 0.025, 0, I.top - 0.04, lz - 0.025, lz + 0.025, flat);
    for (let i = 0; i < 3; i++) {
      const x = I.minX + 0.4 + i * 0.3;
      cyl('#a35a3c', 0.07, 0.055, 0.1, x, I.top, 22.7, 8);
      paint('#3f9b46', new THREE.SphereGeometry(0.08, 8, 6), { position: [x, I.top + 0.16, 22.7] });
    }
    for (let i = 0; i < 2; i++) cyl(['#9aa83a', '#2a5a2a'][i], 0.03, 0.035, 0.24, I.maxX - 0.4 - i * 0.12, I.top, 22.55, 8);
    for (let i = 0; i < 3; i++) cyl('#fbfaf6', 0.1 - i * 0.012, 0.07 - i * 0.008, 0.06, I.maxX - 1.0, I.top + i * 0.05, 22.75, 12, flat);
    for (let i = 0; i < 3; i++) cyl('#7d858e', 0.15, 0.15, 0.16, I.minX + 0.6 + i * 1.1, 0.23, 22.7, 12, flat);
    collision.add(I.minX, I.maxX, I.minZ, I.maxZ);
    // Tarif panosu (batı duvarı) — "Menü kütüphanesi"
    b.add('restRecipes', new THREE.PlaneGeometry(2.4, 1.2), { ...noShadow, position: [-17.86, 1.75, 22.4], rotation: [0, FACING['x+'], 0] });
    vbox('#6b4a2a', -17.88, -17.86, 1.1, 2.4, 21.15, 23.65, flat);
  }
}

// ---- İstemci durumu, sipariş baloncukları, HUD, personel ------------------------------------------

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const recipeIcons = (d) => d.ingredients.map((i) => KITCHEN_INGREDIENT_BY_ID[i].icon).join('') + COOK_METHODS[d.method].icon;

/**
 * Restoranın istemci durumu (EVT.RESTAURANT_STATE): masalardaki / pass'teki tabaklar, büfe tepsileri,
 * müşteri başlarında sipariş baloncukları, HUD sipariş listesi (sabır çubukları CSS transition'la — kare başı
 * DOM yok), aşçı / garson aksesuarları (şef şapkası, papyon, elde tabak) ve Resepsiyon PC'deki personel bölümü.
 */
export class GourmetRestaurant {
  constructor({ engine, net, hud, interaction, player, guests, view, workers }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.guests = guests;
    this.view = view;
    this.state = null;
    this.inside = false;
    this.greeted = false;
    this.bubbles = [];
    this.bubbleTex = new Map();
    this.rowEls = new Map();
    this.onMenu = null; // KitchenSystem: menü kütüphanesini aç
    const $ = (id) => document.getElementById(id);
    this.el = { panel: $('rest-orders'), title: $('rest-title'), list: $('rest-order-list'), meta: $('rest-meta') };
    $('rest-menu').addEventListener('click', () => this.onMenu?.());

    this.buildBubbles();
    setInterval(() => this.tickPatience(), 1000);

    // Aşçı / garson aksesuarları: GuestView'a kanca (HotelWorkerSystem kalıbı)
    const orig = guests.upsert.bind(guests);
    guests.upsert = (data) => {
      orig(data);
      if (data.kind === 'chef' || data.kind === 'waiter') this.decorate(guests.items.get(data.id), data);
    };
    // Resepsiyon PC → Çalışanlar sekmesine restoran personeli bölümü
    if (workers) {
      const render = workers.renderTab.bind(workers);
      workers.renderTab = (body, pc) => {
        render(body, pc);
        this.renderStaff(body, pc);
      };
    }
  }

  // ---- Durum ----------------------------------------------------------------------------

  onState(s, silent = false) {
    const prev = this.state;
    this.state = s;
    if (!silent && prev && this.inside) this.announce(prev, s);
    s.tables.forEach((t, i) => this.view?.setTable(i, t.plate, t.dish));
    s.pass.forEach((d, i) => this.view?.setPass(i, d));
    this.view?.setBuffet(s.buffet);
    this.renderOrders();
    this.renderBubbles();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  announce(prev, s) {
    s.tables.forEach((t, i) => {
      const p = prev.tables[i];
      if (!p) return;
      if (t.state === 'waiting' && p.state !== 'waiting') {
        const d = DISH_BY_ID[t.order];
        if (d) this.hud.toast(`${d.icon} ${t.name}: "Bir ${d.name} lütfen!"${t.vip ? ' ⭐' : ''}`, 'info');
      } else if (p.state === 'waiting' && t.state === 'empty') {
        this.hud.toast(`😤 ${p.name} beklemekten sıkıldı ve restorandan çıktı.`, 'warn');
      } else if (p.state === 'eating' && t.state === 'empty' && t.plate === 'dirty') {
        this.hud.toast('🍽️ Masada kirli tabak kaldı — topla, bulaşık lavabosuna götür.', 'info');
      }
    });
    if (prev.buffet > 0 && s.buffet === 0 && s.breakfast) this.hud.toast('🍳 Açık büfe bitti — büfeyi tazele!', 'warn');
  }

  /** Bekleyen siparişler (en eski önce): KitchenSystem buzdolabı kısayolları için */
  waitingOrders() {
    return (this.state?.tables ?? [])
      .map((t, i) => ({ ...t, i }))
      .filter((t) => t.state === 'waiting' && DISH_BY_ID[t.order])
      .sort((a, b) => a.waitUntil - b.waitUntil);
  }

  // ---- Kare -----------------------------------------------------------------------------

  /** @returns {boolean} ateş / bıçak animasyonu sürüyor mu */
  update() {
    const { x, z } = this.player.pos;
    const inside = isInsideRestaurant(x, z);
    if (inside !== this.inside) this.onInsideChange(inside);
    if (!inside || !this.view) return false;
    // Çalışan aşçıların istasyonunda ateş (aşçı istasyonun önünde 'k-work' fazındayken)
    const now = this.net.serverNow();
    for (const it of this.guests.items.values()) {
      const dd = it.data;
      if (dd?.kind !== 'chef' || dd.phase !== 'k-work' || !dd.work) continue;
      const [cx, cz] = dd.path[0];
      for (const [m, pt] of Object.entries(RESTAURANT.stations)) {
        if (Math.hypot(cx - pt[0], cz - pt[1]) < 0.3) this.view.setFx(m, dd.work.until);
      }
    }
    return this.view.update(now);
  }

  onInsideChange(inside) {
    this.inside = inside;
    this.el.panel.hidden = !inside;
    document.body.classList.toggle('at-restaurant', inside);
    if (inside) {
      this.renderOrders();
      if (!this.greeted) {
        this.greeted = true;
        this.hud.toast('🍽️ De Gouden Lepel! Buzdolabından malzeme al, tava / fırın / tezgâhta hazırla, tabakla, servis et.', 'info');
      }
    }
  }

  // ---- HUD --------------------------------------------------------------------------------

  renderOrders() {
    const s = this.state;
    if (!s || !this.inside) return;
    let title = '🍽️ De Gouden Lepel';
    if (!s.open) title += ' · kapalı (07:00)';
    else if (s.breakfast) title += ' · kahvaltı';
    if (this.el.title.textContent !== title) this.el.title.textContent = title;
    const meta = `😊 Memnuniyet %${s.sat} · 🍳 Büfe ${s.buffet}/${BUFFET.MAX}`;
    if (this.el.meta.textContent !== meta) this.el.meta.textContent = meta;
    const serverNow = this.net.serverNow();
    const rows = [];
    s.tables.forEach((t, i) => { if (t.state === 'waiting' || t.state === 'eating' || t.plate === 'dirty') rows.push(i); });
    const keep = new Set(rows);
    for (const [i, row] of this.rowEls) {
      if (!keep.has(i)) {
        row.el.remove();
        this.rowEls.delete(i);
      }
    }
    for (const i of rows) {
      const t = s.tables[i];
      let row = this.rowEls.get(i);
      if (!row) {
        const e = el('div', 'order');
        const ic = el('span', 'ic');
        const nm = el('span', 'nm');
        const pat = el('span', 'pat');
        const fill = el('i');
        pat.append(fill);
        e.append(ic, nm, pat);
        row = { el: e, ic, nm, pat, fill, key: '' };
        this.rowEls.set(i, row);
      }
      this.el.list.append(row.el);
      const d = DISH_BY_ID[t.order];
      let key;
      if (t.state === 'waiting' && d) key = `w:${t.diner}:${t.waitUntil}`;
      else if (t.state === 'eating') key = `e:${t.diner}`;
      else key = 'dirty';
      if (row.key === key) continue;
      row.key = key;
      row.el.classList.toggle('waiting', t.state === 'waiting');
      row.el.classList.toggle('vip', !!t.vip);
      if (t.state === 'waiting' && d) {
        row.ic.textContent = d.icon;
        row.nm.textContent = `M${i + 1} ${recipeIcons(d)} ${d.name} · ${t.name}`;
        row.pat.hidden = false;
        this.startPatienceBar(row, t, serverNow);
      } else if (t.state === 'eating') {
        row.ic.textContent = '✓';
        row.nm.textContent = `M${i + 1} ${t.name} ${t.dish === 'buffet' ? 'kahvaltı ediyor' : 'yiyor'}`;
        row.pat.hidden = true;
      } else {
        row.ic.textContent = '🍽️';
        row.nm.textContent = `M${i + 1} kirli tabak — topla`;
        row.pat.hidden = true;
      }
    }
    this.el.list.classList.toggle('empty', !rows.length);
    this.tickPatience();
  }

  startPatienceBar(row, t, serverNow) {
    const left = Math.max(0, t.waitUntil - serverNow);
    const frac = t.patienceMs > 0 ? Math.min(1, left / t.patienceMs) : 0;
    const i = row.fill;
    i.style.transition = 'none';
    i.style.transform = `scaleX(${frac.toFixed(3)})`;
    void i.offsetWidth;
    i.style.transition = `transform ${left}ms linear`;
    i.style.transform = 'scaleX(0)';
  }

  tickPatience() {
    const s = this.state;
    if (!s) return;
    const serverNow = this.net.serverNow();
    let changed = false;
    s.tables.forEach((t, i) => {
      const urgent = t.state === 'waiting' && t.patienceMs > 0 && (t.waitUntil - serverNow) / t.patienceMs < PATIENCE_URGENT;
      const row = this.rowEls.get(i);
      if (row && row.el.classList.contains('urgent') !== urgent) row.el.classList.toggle('urgent', urgent);
      const b = this.bubbles[i];
      if (b && b.visible && b.userData.urgent !== urgent) {
        b.userData.urgent = urgent;
        b.material.map = this.bubbleTexture(t.order, urgent, t.vip);
        changed = true;
      }
    });
    if (changed) this.engine.requestRender();
  }

  // ---- Sipariş baloncukları ------------------------------------------------------------------

  buildBubbles() {
    RESTAURANT.tables.forEach((tb, i) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
      const a = this.view?.tableAnchor(i);
      sprite.position.set(a ? a.x : tb.seat[0], a ? a.y : 1.95, a ? a.z : tb.seat[1]);
      sprite.scale.set(0.42, 0.42, 1);
      sprite.renderOrder = 4;
      sprite.visible = false;
      sprite.userData = { key: '', urgent: false };
      this.engine.scene.add(sprite);
      this.bubbles.push(sprite);
    });
  }

  bubbleTexture(order, urgent, vip) {
    const key = `${order}:${urgent}:${vip}`;
    let tex = this.bubbleTex.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = urgent ? '#ffd6d2' : vip ? '#fff3cf' : '#fffaf0';
    g.strokeStyle = urgent ? '#e5534b' : vip ? '#c9a25e' : '#2f7a5a';
    g.lineWidth = 7;
    g.beginPath();
    g.roundRect(10, 8, 108, 88, 26);
    g.moveTo(52, 96);
    g.lineTo(64, 120);
    g.lineTo(76, 96);
    g.fill();
    g.stroke();
    g.font = '58px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#222';
    g.fillText(DISH_BY_ID[order]?.icon ?? '?', 64, 54);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.bubbleTex.set(key, tex);
    return tex;
  }

  renderBubbles() {
    this.state.tables.forEach((t, i) => {
      const b = this.bubbles[i];
      const show = t.state === 'waiting' && !!DISH_BY_ID[t.order];
      b.visible = show;
      const key = `${t.order}:${t.vip}`;
      if (show && b.userData.key !== key) {
        b.userData.key = key;
        b.userData.urgent = false;
        b.material.map = this.bubbleTexture(t.order, false, t.vip);
        b.material.needsUpdate = true;
      }
    });
  }

  // ---- Aşçı / garson aksesuarları ------------------------------------------------------------

  decorate(it, data) {
    if (!it) return;
    const u = it.obj.userData;
    if (!u.staffKit) {
      if (!GourmetRestaurant.kit) {
        const white = new THREE.MeshLambertMaterial({ color: '#fbfaf6' });
        GourmetRestaurant.kit = {
          toque: mergeGeometries([
            new THREE.CylinderGeometry(0.12, 0.13, 0.2, 12).translate(0, 1.6, 0),
            new THREE.SphereGeometry(0.15, 12, 6).scale(1, 0.6, 1).translate(0, 1.72, 0),
          ]),
          scarf: new THREE.BoxGeometry(0.2, 0.05, 0.06).translate(0, 1.18, 0.17),
          bow: new THREE.BoxGeometry(0.12, 0.04, 0.03).translate(0, 1.17, 0.2),
          shirt: new THREE.BoxGeometry(0.14, 0.3, 0.02).translate(0, 1.0, 0.205),
          white,
          red: new THREE.MeshLambertMaterial({ color: '#c8382a' }),
          black: new THREE.MeshLambertMaterial({ color: '#111' }),
        };
      }
      const k = GourmetRestaurant.kit;
      const inner = u.inner;
      if (data.kind === 'chef') inner.add(new THREE.Mesh(k.toque, k.white), new THREE.Mesh(k.scarf, k.red));
      else inner.add(new THREE.Mesh(k.shirt, k.white), new THREE.Mesh(k.bow, k.black));
      const hand = new THREE.Group();
      hand.position.set(0.12, 1.04, 0.3);
      inner.add(hand);
      u.staffKit = { hand, carry: undefined };
    }
    const kit = u.staffKit;
    const carry = data.carry ?? null;
    if (kit.carry === carry) return;
    kit.carry = carry;
    kit.hand.clear();
    if (!carry) return;
    let mesh;
    if (carry === 'tray') mesh = new THREE.Mesh(trayGeometry(['egg', 'tomato', 'basil'], null), dishMaterial());
    else if (carry === 'dirty') mesh = new THREE.Mesh(dirtyStackGeometry(2), dishMaterial());
    else mesh = makeDishMesh(DISH_BY_ID[carry] ? carry : 'dirty');
    mesh.scale.setScalar(1.3);
    kit.hand.add(mesh);
  }

  // ---- Resepsiyon PC → Çalışanlar: restoran personeli ------------------------------------------

  renderStaff(body, pc) {
    const money = pc.state.economy?.money ?? 0;
    const staff = pc.hotel.kitchen ?? [];
    const stars = pc.hotel.growth?.stars ?? 1;
    const sat = this.state?.sat ?? RESTAURANT_RULES.SAT_START;
    body.append(el('h3', 'pc-sub', '🍽️ Gurme Restoran personeli'));
    body.append(el('p', 'pc-small', `Aşçılar siparişleri kendileri pişirip garson tezgâhına koyar, açık büfeyi tazeler; garsonlar tabakları masalara taşır ve kirli masaları toplar. Otelin yıldızı arttıkça mutfak hızlanır (şu an iş süresi ×${chefSpeedScale(stars, 1).toFixed(2)}), doluluk arttıkça restoran kalabalıklaşır. Satışlar ve bahşişler otelin kasasına gider.`));
    body.append(el('p', 'pc-small', `😊 Memnuniyet %${sat} → yeni misafirler ×${stayFactor(sat).toFixed(2)} uzun kalıyor. İyi yemek odadaki misafirin (VIP'lerde iki kat) konaklamasını uzatır.`));
    const list = el('div', 'pc-list');
    for (const def of Object.values(KITCHEN_STAFF)) {
      const n = staff.filter((s) => s.role === def.role).length;
      const row = el('div', 'product');
      const info = el('div');
      info.append(el('div', 'name', `${def.icon} ${def.title} işe al`), el('div', 'desc', `${formatMoney(def.price)} (kasadan, bir kerelik) · ${n}/${def.max}`));
      const btn = el('button', null, 'İşe al');
      btn.type = 'button';
      btn.disabled = n >= def.max || money < def.price;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await pc.act({ act: 'hireStaff', role: def.role }, `${def.icon} Yeni ${def.title.toLocaleLowerCase('tr')} restoranda işe başladı!`);
        if (!res?.ok) btn.disabled = false;
      });
      row.append(el('div', 'icon', def.icon), info, btn);
      list.append(row);
    }
    for (const s of staff) {
      const def = KITCHEN_STAFF[s.role];
      if (!def) continue;
      const row = el('div', 'product');
      const d = el('div');
      const left = STAFF_TASKS_PER_LEVEL - (s.tasks % STAFF_TASKS_PER_LEVEL);
      const lv = s.level >= STAFF_MAX_LEVEL ? 'en yüksek seviye' : `sonraki seviyeye ${left} iş`;
      d.append(
        el('div', 'name', `${def.title} ${s.name} · Seviye ${s.level}`),
        el('div', 'desc', `${s.tasks} iş · ${lv}`),
        el('div', s.busy ? 'owned' : 'desc', s.busy && s.doing ? `Şu an: ${s.doing}` : s.role === 'chef' ? 'Mutfakta sipariş bekliyor' : 'Salonda bekliyor'),
      );
      const fire = el('button', 'danger', 'Çıkar');
      fire.type = 'button';
      fire.addEventListener('click', async () => {
        if (fire.dataset.sure !== '1') {
          fire.dataset.sure = '1';
          fire.textContent = 'Emin misin?';
          return;
        }
        fire.disabled = true;
        await pc.act({ act: 'fireStaff', id: s.id }, `${s.name} restorandan ayrıldı.`);
      });
      row.append(el('div', 'icon', def.icon), d, fire);
      list.append(row);
    }
    body.append(list);
  }
}

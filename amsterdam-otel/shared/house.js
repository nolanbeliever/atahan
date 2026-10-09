// "Bizim Ev" — dekorasyon kataloğu ve yerleştirme kuralları.
// Sunucu (yetkili doğrulama) ve istemci (önizleme / hayalet) AYNI fonksiyonları
// kullanır; böylece istemcide yeşil görünen yerleşim sunucuda da kabul edilir.

import { HOUSE, PLAYER_RADIUS } from './layout.js';

/**
 * w: genişlik (rot 0'da X ekseni), d: derinlik (rot 0'da Z ekseni), metre.
 * layer: 'floor' (katı, çarpışır) | 'rug' (yerde düz, eşyaların altına girer) | 'wall' (duvara monte)
 */
export const FURNITURE = Object.freeze([
  { id: 'sofa', name: 'Kanepe', icon: '🛋️', price: 18, w: 2.0, d: 0.9, h: 0.95, layer: 'floor',
    colors: ['#2d4f7c', '#9c2f2f', '#5b5f66', '#3e6b48', '#e36f1e', '#6a4c93', '#e8e4dc'] },
  { id: 'armchair', name: 'Berjer', icon: '💺', price: 10, w: 0.9, d: 0.9, h: 0.95, layer: 'floor',
    colors: ['#9c2f2f', '#2d4f7c', '#5b5f66', '#3e6b48', '#d9a441', '#e8e4dc'] },
  { id: 'beanbag', name: 'Armut koltuk', icon: '🫘', price: 7, w: 0.85, d: 0.85, h: 0.65, layer: 'floor',
    colors: ['#e36f1e', '#6a4c93', '#2b8a8a', '#d7263d', '#3a3a3a', '#f28ab2'] },
  { id: 'tv', name: 'Televizyon', icon: '📺', price: 25, w: 1.6, d: 0.5, h: 1.45, layer: 'floor',
    colors: ['#1c1c1f', '#e8e4dc', '#7a4f2e'] },
  { id: 'table', name: 'Sehpa', icon: '🪵', price: 8, w: 1.1, d: 0.6, h: 0.45, layer: 'floor',
    colors: ['#7a4f2e', '#1c1c1f', '#e8e4dc', '#c9a25e'] },
  { id: 'rug', name: 'Halı', icon: '🟫', price: 6, w: 2.2, d: 1.5, h: 0.02, layer: 'rug',
    colors: ['#7d2433', '#23395b', '#3e6b48', '#d9a441', '#5b5f66', '#f28ab2'] },
  { id: 'plant', name: 'Bitki', icon: '🪴', price: 4, w: 0.5, d: 0.5, h: 1.1, layer: 'floor',
    colors: ['#2b5ea7', '#e8e4dc', '#b5462f', '#1c1c1f'] },
  { id: 'lamp', name: 'Ayaklı lamba', icon: '💡', price: 6, w: 0.45, d: 0.45, h: 1.8, layer: 'floor',
    colors: ['#fff1c8', '#ffb3d9', '#b3e0ff', '#c8ffb3'] },
  { id: 'led', name: 'LED şerit', icon: '🌈', price: 5, w: 2.0, d: 0.06, h: 0.05, layer: 'wall',
    colors: ['#b03cff', '#2f7bff', '#ff3fa4', '#3cff7a', '#ff3b3b', '#00e5ff', '#ffd23f', '#ffffff'] },
]);
// Prototipsiz nesne: istemciden gelen 'constructor' / '__proto__' gibi anahtarlar undefined döner
export const FURNITURE_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(FURNITURE.map((f) => [f.id, f]))));

export const HOUSE_RULES = Object.freeze({
  MAX_ITEMS: 80,
  REFUND: 0.5, // kaldırınca fiyatın yarısı geri gelir
  REACH: 6, // yerleştirme/kaldırma için oyuncuya en fazla uzaklık (m)
  TV_RANGE: 4, // TV'yi kumanda etmek için en fazla uzaklık
  SWITCH_RANGE: 2.2,
  LED_HEIGHT: 2.95,
});

// Kapının önü her zaman boş kalmalı (halı hariç)
const DOOR_ZONE = Object.freeze({
  minX: HOUSE.door.from - 0.45,
  maxX: HOUSE.door.to + 0.65, // ışık anahtarı da burada
  minZ: HOUSE.inner.minZ,
  maxZ: 1.35,
});

export function footprint(def, rot) {
  return rot % 2 === 1 ? { w: def.d, d: def.w } : { w: def.w, d: def.d };
}

export function itemBox(def, it) {
  const f = footprint(def, it.rot);
  return { minX: it.x - f.w / 2, maxX: it.x + f.w / 2, minZ: it.z - f.d / 2, maxZ: it.z + f.d / 2 };
}

const overlaps = (a, b) => a.minX < b.maxX - 0.001 && a.maxX > b.minX + 0.001
  && a.minZ < b.maxZ - 0.001 && a.maxZ > b.minZ + 0.001;

/** Duvar eşyası için: rot → hangi duvar. 0 arka, 1 batı, 2 ön, 3 doğu */
export function wallLine(rot) {
  const I = HOUSE.inner;
  return [
    { axis: 'z', value: I.maxZ },
    { axis: 'x', value: I.minX },
    { axis: 'z', value: I.minZ },
    { axis: 'x', value: I.maxX },
  ][rot];
}

/** Görselde kullanılan Y dönüşü (yerde: rot·90°, duvarda: odaya bakacak şekilde) */
export function itemRotationY(def, rot) {
  if (def.layer === 'wall') return [Math.PI, Math.PI / 2, 0, -Math.PI / 2][rot];
  return rot * (Math.PI / 2);
}

/**
 * Zemindeki bir noktadan aday yerleşim üretir (istemci önizlemesi için).
 * Duvar eşyaları en yakın duvara yapışır; yerdekiler 0.25 m ızgaraya oturur.
 */
export function candidateFromPoint(def, px, pz, rot) {
  const I = HOUSE.inner;
  const snap = (v) => Math.round(v * 4) / 4;
  if (def.layer === 'wall') {
    const dists = [I.maxZ - pz, px - I.minX, pz - I.minZ, I.maxX - px];
    let wall = 0;
    for (let i = 1; i < 4; i++) if (dists[i] < dists[wall]) wall = i;
    const line = wallLine(wall);
    const half = def.w / 2;
    if (line.axis === 'z') {
      const x = Math.min(Math.max(snap(px), I.minX + half), I.maxX - half);
      return { x, z: line.value, rot: wall };
    }
    const z = Math.min(Math.max(snap(pz), I.minZ + half), I.maxZ - half);
    return { x: line.value, z, rot: wall };
  }
  const f = footprint(def, rot);
  const x = Math.min(Math.max(snap(px), I.minX + f.w / 2), I.maxX - f.w / 2);
  const z = Math.min(Math.max(snap(pz), I.minZ + f.d / 2), I.maxZ - f.d / 2);
  return { x, z, rot };
}

/**
 * Yerleşimi doğrular.
 * @param items mevcut eşyalar [{ type, x, z, rot }]
 * @param c aday { type, x, z, rot, color }
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePlacement(items, c) {
  const def = FURNITURE_BY_ID[c?.type];
  if (!def) return { ok: false, error: 'Böyle bir eşya yok.' };
  if (!Number.isInteger(c.rot) || c.rot < 0 || c.rot > 3) return { ok: false, error: 'Geçersiz yön.' };
  if (!Number.isInteger(c.color) || c.color < 0 || c.color >= def.colors.length) return { ok: false, error: 'Geçersiz renk.' };
  if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) return { ok: false, error: 'Geçersiz konum.' };
  const I = HOUSE.inner;
  const eps = 0.02;
  const box = itemBox(def, c);

  if (def.layer === 'wall') {
    const line = wallLine(c.rot);
    const v = line.axis === 'z' ? c.z : c.x;
    if (Math.abs(v - line.value) > eps) return { ok: false, error: 'LED şerit duvara monte edilmeli.' };
    const along = line.axis === 'z' ? [box.minX, box.maxX, I.minX, I.maxX] : [box.minZ, box.maxZ, I.minZ, I.maxZ];
    if (along[0] < along[2] - eps || along[1] > along[3] + eps) return { ok: false, error: 'Duvara sığmıyor.' };
    if (c.rot === 2 && box.minX < HOUSE.door.to + 0.65 && box.maxX > HOUSE.door.from - 0.1) {
      return { ok: false, error: 'Kapının üstüne LED takılamaz.' };
    }
    for (const o of items) {
      const od = FURNITURE_BY_ID[o.type];
      if (od?.layer === 'wall' && o.rot === c.rot && overlaps(box, itemBox(od, o))) {
        return { ok: false, error: 'Bu duvarda başka bir LED var.' };
      }
    }
    return { ok: true };
  }

  if (box.minX < I.minX - eps || box.maxX > I.maxX + eps || box.minZ < I.minZ - eps || box.maxZ > I.maxZ + eps) {
    return { ok: false, error: 'Evin içine sığmıyor.' };
  }
  if (def.layer === 'floor' && overlaps(box, DOOR_ZONE)) return { ok: false, error: 'Kapının önü boş kalmalı.' };
  for (const o of items) {
    const od = FURNITURE_BY_ID[o.type];
    if (!od || od.layer === 'wall') continue;
    if (od.layer !== def.layer) continue; // halılar eşyaların altına girebilir
    if (overlaps(box, itemBox(od, o))) return { ok: false, error: 'Başka bir eşyayla çakışıyor.' };
  }
  return { ok: true };
}

/**
 * Katı eşya, bir oyuncunun durduğu yere konamaz: çarpışma çözümü oyuncuyu en
 * yakın kenardan dışarı iter ve eşya duvara yakınsa duvarın öbür tarafına atabilir.
 * @param margin istemcinin ek payı (ağ gecikmesi)
 */
export function blocksPlayer(def, c, x, z, margin = 0) {
  if (def.layer !== 'floor') return false;
  const b = itemBox(def, c);
  const dx = x - Math.min(Math.max(x, b.minX), b.maxX);
  const dz = z - Math.min(Math.max(z, b.minZ), b.maxZ);
  const r = PLAYER_RADIUS + margin;
  return dx * dx + dz * dz < r * r;
}

/**
 * Zemindeki noktanın üstündeki / yakınındaki eşya (kaldırma hedefi).
 * Öncelik: katı eşya (küçük eşyalar için 0.3 m tolerans, en yakını) → duvar → halı.
 */
export function itemAtPoint(items, px, pz) {
  const TOL = 0.3;
  let best = null;
  let bestD = Infinity;
  let rug = null;
  let wall = null;
  for (const it of items) {
    const def = FURNITURE_BY_ID[it.type];
    if (!def) continue;
    const b = itemBox(def, it);
    if (def.layer === 'wall') {
      const m = 0.6; // duvara bakarken zemindeki nokta duvarın dibinde olur
      if (px > b.minX - m && px < b.maxX + m && pz > b.minZ - m && pz < b.maxZ + m) wall = wall || it;
      continue;
    }
    if (def.layer === 'rug') {
      if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) rug = rug || it;
      continue;
    }
    if (px >= b.minX - TOL && px <= b.maxX + TOL && pz >= b.minZ - TOL && pz <= b.maxZ + TOL) {
      const d = Math.hypot(px - it.x, pz - it.z);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
  }
  return best || wall || rug;
}

// ---- YouTube --------------------------------------------------------------

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function isYouTubeId(id) {
  return typeof id === 'string' && YT_ID.test(id);
}

/**
 * YouTube linkinden video kimliğini çıkarır.
 * Desteklenen: youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/, m./music. alt alanları
 * ya da doğrudan 11 karakterlik kimlik.
 */
export function parseYouTubeId(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > 300) return null;
  if (YT_ID.test(s)) return s;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1] || '';
    return YT_ID.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v && YT_ID.test(v)) return v;
    const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
    if (m) return m[1];
  }
  return null;
}

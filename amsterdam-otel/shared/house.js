// "Bizim Ev" — dekorasyon kataloğu ve yerleştirme kuralları.
// Sunucu (yetkili doğrulama) ve istemci (önizleme / hayalet) AYNI fonksiyonları
// kullanır; böylece istemcide yeşil görünen yerleşim sunucuda da kabul edilir.

import { HOUSE, PLAYER_RADIUS, WALL_H } from './layout.js';

/**
 * w: genişlik (rot 0'da X ekseni), d: derinlik (rot 0'da Z ekseni), metre.
 * layer: 'floor' (katı, çarpışır) | 'rug' (yerde düz, eşyaların altına girer)
 *      | 'wall' (duvara monte; slot: 'top' tavan hizası, 'mid' göz hizası — aynı slotta çakışmaz)
 *      | 'ceiling' (tavana yapışır; rot 0 X ekseni, 1 Z ekseni, 2-3 çapraz; birbirini kesebilir)
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
  { id: 'led', name: 'LED şerit', icon: '🌈', price: 5, w: 2.0, d: 0.06, h: 0.05, layer: 'wall', slot: 'top',
    colors: ['#b03cff', '#2f7bff', '#ff3fa4', '#3cff7a', '#ff3b3b', '#00e5ff', '#ffd23f', '#ffffff'] },
  { id: 'ceilLed', name: 'Tavan RGB LED', icon: '✨', price: 6, w: 2.0, d: 0.06, h: 0.04, layer: 'ceiling',
    colors: ['#ff3fa4', '#2f7bff', '#b03cff', '#3cff7a', '#00e5ff', '#ffd23f', '#ff3b3b', '#ffffff'] },
  { id: 'bed', name: 'Yatak', icon: '🛏️', price: 15, w: 1.5, d: 2.1, h: 0.75, layer: 'floor',
    colors: ['#2d4f7c', '#e8e4dc', '#9c2f2f', '#3e6b48', '#f28ab2', '#5b5f66'] },
  { id: 'cornerSofa', name: 'Köşe koltuk', icon: '🛋️', price: 24, w: 2.0, d: 2.0, h: 0.95, layer: 'floor',
    colors: ['#5b5f66', '#2d4f7c', '#9c2f2f', '#3e6b48', '#d9a441', '#e8e4dc', '#6a4c93'] },
  { id: 'bookcase', name: 'Kitaplık', icon: '📚', price: 12, w: 1.2, d: 0.4, h: 2.0, layer: 'floor',
    colors: ['#7a4f2e', '#e8e4dc', '#1c1c1f', '#c9a25e'] },
  { id: 'shelf', name: 'Duvar rafı', icon: '🪜', price: 5, w: 1.2, d: 0.25, h: 0.3, layer: 'wall', slot: 'mid',
    colors: ['#7a4f2e', '#e8e4dc', '#1c1c1f', '#c9a25e'] },
  // Tablolar: her renk ayrı bir eser (renk = paletin baskın rengi)
  { id: 'painting', name: 'Tablo', icon: '🖼️', price: 6, w: 0.9, d: 0.05, h: 0.7, layer: 'wall', slot: 'mid',
    colors: ['#d7263d', '#e36f1e', '#2f7bff', '#1d2a4a', '#3e6b48', '#f2d06b'],
    art: ['Mondriaan', 'Lale tarlası', 'Kanal evleri', 'Yıldızlı gece', 'Yel değirmeni', 'Ayçiçekleri'] },
  { id: 'pot', name: 'Saksı', icon: '🪴', price: 5, w: 0.5, d: 0.5, h: 0.42, layer: 'floor',
    colors: ['#b5462f', '#e8e4dc', '#2b5ea7', '#1c1c1f', '#3e6b48'] },
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
  PAINT_HEIGHT: 1.6, // göz hizasındaki duvar eşyalarının (tablo, raf) orta yüksekliği
  CEIL_HEIGHT: WALL_H - 0.02, // tavan LED'inin yüksekliği
  // Oyuncu evleri
  DOOR_RANGE: 2.0, // zil / kapı etkileşimi için kapının önüne en fazla uzaklık
  RING_TIMEOUT_MS: 25_000, // ev sahibi bu sürede yanıtlamazsa zil düşer
  RING_COOLDOWN_MS: 8_000, // aynı ziyaretçi aynı kapıyı bu aralıktan sık çalamaz
  OWNER_EVICT_DAYS: 3, // tüm evler doluysa bu kadar gündür gelmeyen sahibin evi yeni oyuncuya verilir
});

// Kapının önü her zaman boş kalmalı (halı hariç). Her ev (Bizim Ev + oyuncu evleri)
// aynı yerleşim kurallarını kullanır; `h` parametresi verilmezse Bizim Ev.
export function doorZone(h = HOUSE) {
  return {
    minX: h.door.from - 0.45,
    maxX: h.door.to + 0.65, // ışık anahtarı da burada
    minZ: h.inner.minZ,
    maxZ: h.inner.minZ + 1.2,
  };
}

const DIAG = Math.SQRT1_2;

export function footprint(def, rot) {
  if (def.layer === 'ceiling' && rot >= 2) {
    const s = (def.w + def.d) * DIAG; // 45° dönmüş şeridin kapsayan kutusu
    return { w: s, d: s };
  }
  return rot % 2 === 1 ? { w: def.d, d: def.w } : { w: def.w, d: def.d };
}

export function itemBox(def, it) {
  const f = footprint(def, it.rot);
  return { minX: it.x - f.w / 2, maxX: it.x + f.w / 2, minZ: it.z - f.d / 2, maxZ: it.z + f.d / 2 };
}

const overlaps = (a, b) => a.minX < b.maxX - 0.001 && a.maxX > b.minX + 0.001
  && a.minZ < b.maxZ - 0.001 && a.maxZ > b.minZ + 0.001;

/** Duvar eşyası için: rot → hangi duvar. 0 arka, 1 batı, 2 ön, 3 doğu */
export function wallLine(rot, h = HOUSE) {
  const I = h.inner;
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
  if (def.layer === 'ceiling') return [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4][rot];
  return rot * (Math.PI / 2);
}

/** Duvar eşyasının orta yüksekliği (seçim kutusu vb.) */
export function wallItemY(def) {
  return def.slot === 'mid' ? HOUSE_RULES.PAINT_HEIGHT : HOUSE_RULES.LED_HEIGHT;
}

/**
 * Zemindeki bir noktadan aday yerleşim üretir (istemci önizlemesi için).
 * Duvar eşyaları en yakın duvara yapışır; yerdekiler 0.25 m ızgaraya oturur.
 */
export function candidateFromPoint(def, px, pz, rot, h = HOUSE) {
  const I = h.inner;
  const snap = (v) => Math.round(v * 4) / 4;
  if (def.layer === 'wall') {
    const dists = [I.maxZ - pz, px - I.minX, pz - I.minZ, I.maxX - px];
    let wall = 0;
    for (let i = 1; i < 4; i++) if (dists[i] < dists[wall]) wall = i;
    const line = wallLine(wall, h);
    const half = def.w / 2;
    if (line.axis === 'z') {
      const x = Math.min(Math.max(snap(px), I.minX + half), I.maxX - half);
      return { x, z: line.value, rot: wall };
    }
    const z = Math.min(Math.max(snap(pz), I.minZ + half), I.maxZ - half);
    return { x: line.value, z, rot: wall };
  }
  if (def.layer === 'ceiling') rot = Math.min(Math.max(rot, 0), 3);
  const f = footprint(def, rot);
  const x = Math.min(Math.max(snap(px), I.minX + f.w / 2), I.maxX - f.w / 2);
  const z = Math.min(Math.max(snap(pz), I.minZ + f.d / 2), I.maxZ - f.d / 2);
  return { x, z, rot };
}

/**
 * Yerleşimi doğrular.
 * @param items mevcut eşyalar [{ type, x, z, rot }]
 * @param c aday { type, x, z, rot, color }
 * @param h ev tanımı (shared/layout.js HOUSES); varsayılan Bizim Ev
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePlacement(items, c, h = HOUSE) {
  const def = FURNITURE_BY_ID[c?.type];
  if (!def) return { ok: false, error: 'Böyle bir eşya yok.' };
  if (!Number.isInteger(c.rot) || c.rot < 0 || c.rot > 3) return { ok: false, error: 'Geçersiz yön.' };
  if (!Number.isInteger(c.color) || c.color < 0 || c.color >= def.colors.length) return { ok: false, error: 'Geçersiz renk.' };
  if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) return { ok: false, error: 'Geçersiz konum.' };
  const I = h.inner;
  const eps = 0.02;
  const box = itemBox(def, c);

  if (def.layer === 'wall') {
    const line = wallLine(c.rot, h);
    const v = line.axis === 'z' ? c.z : c.x;
    if (Math.abs(v - line.value) > eps) return { ok: false, error: `${def.name} duvara monte edilmeli.` };
    const along = line.axis === 'z' ? [box.minX, box.maxX, I.minX, I.maxX] : [box.minZ, box.maxZ, I.minZ, I.maxZ];
    if (along[0] < along[2] - eps || along[1] > along[3] + eps) return { ok: false, error: 'Duvara sığmıyor.' };
    if (c.rot === 2 && box.minX < h.door.to + 0.65 && box.maxX > h.door.from - 0.1) {
      return { ok: false, error: `Kapının üstüne ${def.name.toLocaleLowerCase('tr-TR')} takılamaz.` };
    }
    for (const o of items) {
      const od = FURNITURE_BY_ID[o.type];
      if (od?.layer === 'wall' && od.slot === def.slot && o.rot === c.rot && overlaps(box, itemBox(od, o))) {
        return { ok: false, error: 'Duvarın bu kısmı dolu.' };
      }
    }
    return { ok: true };
  }

  if (def.layer === 'ceiling') {
    // Tavan LED'leri birbirini kesebilir (çapraz desenler); yalnızca tavana sığmalı
    if (box.minX < I.minX - eps || box.maxX > I.maxX + eps || box.minZ < I.minZ - eps || box.maxZ > I.maxZ + eps) {
      return { ok: false, error: 'Tavana sığmıyor.' };
    }
    return { ok: true };
  }

  if (box.minX < I.minX - eps || box.maxX > I.maxX + eps || box.minZ < I.minZ - eps || box.maxZ > I.maxZ + eps) {
    return { ok: false, error: 'Evin içine sığmıyor.' };
  }
  if (def.layer === 'floor' && overlaps(box, doorZone(h))) return { ok: false, error: 'Kapının önü boş kalmalı.' };
  for (const o of items) {
    const od = FURNITURE_BY_ID[o.type];
    if (!od || od.layer === 'wall' || od.layer === 'ceiling') continue;
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
 * ceiling: true → tavandaki nokta; yalnızca tavan LED'leri (şeride en yakın olan).
 */
export function itemAtPoint(items, px, pz, { ceiling = false } = {}) {
  const TOL = 0.3;
  let best = null;
  let bestD = Infinity;
  let rug = null;
  let wall = null;
  for (const it of items) {
    const def = FURNITURE_BY_ID[it.type];
    if (!def) continue;
    // Tavana bakarken yalnızca tavan eşyaları, zemine bakarken yalnızca diğerleri
    if ((def.layer === 'ceiling') !== ceiling) continue;
    if (def.layer === 'ceiling') {
      const ry = itemRotationY(def, it.rot);
      const ax = Math.cos(ry);
      const az = -Math.sin(ry);
      const t = Math.min(Math.max((px - it.x) * ax + (pz - it.z) * az, -def.w / 2), def.w / 2);
      const d = Math.hypot(it.x + ax * t - px, it.z + az * t - pz);
      if (d < 0.35 && d < bestD) {
        bestD = d;
        best = it;
      }
      continue;
    }
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

// ---- Ev bahçesi --------------------------------------------------------------
// Kendi evindeki saksıya tohum ekilir; bitki oyun saatiyle (gece ve uyku dahil) kendiliğinden
// büyür. Olgunlaşınca hasat edilir ve ürün Bloemenmarkt'a (çiçek pazarı) satılır → cüzdan.

export const PLANTS = Object.freeze([
  { id: 'mint', name: 'Nane', icon: '🌿', seed: 2, days: 1, count: 6, unit: 'demet', price: 1, color: '#4fae4a' },
  { id: 'strawberry', name: 'Çilek', icon: '🍓', seed: 2, days: 2, count: 6, unit: 'kase', price: 2, color: '#e23a4e' },
  { id: 'tulip', name: 'Lale', icon: '🌷', seed: 2, days: 3, count: 14, unit: 'dal', price: 2, color: '#e8384f' },
]);
export const PLANT_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(PLANTS.map((p) => [p.id, p]))));
export const GARDEN_RULES = Object.freeze({ RANGE: 1.8 });
const DAY_MIN = 24 * 60;

/** Büyüme oranı 0..1 (total: mutlak oyun dakikası) */
export function plantProgress(plant, total) {
  const def = PLANT_BY_ID[plant?.kind];
  if (!def) return 0;
  return Math.min(1, Math.max(0, (total - plant.at) / (def.days * DAY_MIN)));
}

/** 0 tohum · 1 filiz · 2 büyüyor · 3 hasada hazır */
export function plantStage(plant, total) {
  const t = plantProgress(plant, total);
  if (t >= 1) return 3;
  if (t >= 0.5) return 2;
  if (t >= 0.12) return 1;
  return 0;
}

export function harvestValue(kind) {
  const def = PLANT_BY_ID[kind];
  return def ? def.count * def.price : 0;
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

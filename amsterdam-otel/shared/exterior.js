// Oyuncu evlerinin DIŞ CEPHESİ — graffiti (sprey), neon tabela, balkon ve balkon eşyaları.
// Sunucu (yetkili doğrulama, ExteriorService) ve istemci (önizleme / hayalet,
// ExteriorCustomization) AYNI katalog ve kuralları kullanır; böylece istemcide yeşil
// görünen sprey sunucuda da kabul edilir (shared/house.js ile aynı yaklaşım).
//
// Koordinatlar: cephe düzleminde, evin batı kenarından (h.bounds.minX) ölçülen yerel x
// (0 … 4.2 m) ve zeminden y (m). Cephenin dış yüzü z = FACADE.OUT'tadır ve sokağa (−z) bakar.
// Kapı / pencere / zil / fener ölçüleri public/js/world/PlayerHouses.js'teki buildHouse ile
// aynıdır (orada değişirse burası da güncellenmeli).

import { PLAYER_HOUSES, HOUSE_BY_ID, WALL_H } from './layout.js';

const r2 = (v) => Math.round(v * 100) / 100;

/** Prototipsiz arama tablosu: '__proto__' / 'constructor' gibi anahtarlar undefined döner */
const byId = (list) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

export const FACADE = Object.freeze({
  OUT: 32.88, // renkli cephe kaplamasının dış yüzü (PlayerHouses.js: OUT = FACE − 0.12)
  WIDTH: 4.2,
  // Graffiti alanı (yerel): ev sınırından 10 cm içeride, zeminden 0.2 m … 3.0 m (üst kat silmesinin altı)
  bounds: Object.freeze({ x0: 0.1, x1: 4.1, y0: 0.2, y1: 3.0 }),
  // Boya tutmayan / önünde başka şey olan bölgeler (yerel x, y) — biraz pay bırakılmış
  openings: Object.freeze([
    Object.freeze({ id: 'door', name: 'kapı', x0: 0.62, x1: 1.98, y0: 0, y1: 2.9 }), // kasa + kapı üstü camı
    Object.freeze({ id: 'window', name: 'pencere', x0: 2.56, x1: 3.88, y0: 0.6, y1: 2.42 }), // çerçeve + çiçek kutusu
    Object.freeze({ id: 'bell', name: 'zil ve isim levhası', x0: 2.0, x1: 2.56, y0: 1.14, y1: 1.65 }),
    Object.freeze({ id: 'lantern', name: 'fener', x0: 0.25, x1: 0.49, y0: 1.96, y1: 2.44 }),
  ]),
  doorX: 1.3, // kapının ortası (yerel)
  centerX: 2.1,
});

// ---- Graffiti -----------------------------------------------------------------------

/**
 * Şablonlar (canvas'ta prosedürel çizilir). aspect: genişlik / yükseklik.
 * text: true → yazı şablonu (en-boy oranı yazının uzunluğundan hesaplanır).
 */
export const GRAFFITI = Object.freeze([
  { id: 'heart', name: 'Kalp', icon: '❤️', aspect: 1.1 },
  { id: 'tulip', name: 'Lale', icon: '🌷', aspect: 0.8 },
  { id: 'star', name: 'Yıldız', icon: '⭐', aspect: 1 },
  { id: 'crown', name: 'Taç', icon: '👑', aspect: 1.3 },
  { id: 'smiley', name: 'Gülen yüz', icon: '🙂', aspect: 1 },
  { id: 'wave', name: 'Dalga', icon: '🌊', aspect: 1.8 },
  { id: 'bolt', name: 'Şimşek', icon: '⚡', aspect: 0.7 },
  { id: 'xxx', name: 'XXX (Amsterdam haçları)', icon: '❌', aspect: 2.2 },
  { id: 'amsterdam', name: 'AMSTERDAM', icon: '🔤', aspect: 3.4, label: 'AMSTERDAM' },
  { id: 'hoi', name: 'HOI!', icon: '👋', aspect: 1.9, label: 'HOI!' },
  { id: 'name', name: 'İsim etiketi', icon: '🫧', text: true, auto: true }, // ev sahibinin adı (sunucu yazar)
  { id: 'custom', name: 'Serbest yazı', icon: '✍️', text: true },
].map((d) => Object.freeze(d)));
export const GRAFFITI_BY_ID = byId(GRAFFITI);

export const SPRAY_COLORS = Object.freeze([
  { id: 'pink', name: 'Pembe', hex: '#ff2d78' },
  { id: 'orange', name: 'Turuncu', hex: '#ff7a1a' },
  { id: 'yellow', name: 'Sarı', hex: '#ffd23f' },
  { id: 'green', name: 'Yeşil', hex: '#35d46a' },
  { id: 'blue', name: 'Mavi', hex: '#1fa8ff' },
  { id: 'purple', name: 'Mor', hex: '#9b3cff' },
  { id: 'white', name: 'Beyaz', hex: '#f6f6f2' },
  { id: 'black', name: 'Siyah', hex: '#17171a' },
].map((c) => Object.freeze(c)));

export const TAG_SIZES = Object.freeze([
  Object.freeze({ id: 's', name: 'Küçük', h: 0.3 }),
  Object.freeze({ id: 'm', name: 'Orta', h: 0.45 }),
  Object.freeze({ id: 'l', name: 'Büyük', h: 0.65 }),
]);

// ---- Neon tabela --------------------------------------------------------------------

/**
 * Cephedeki sabit yuvalar (yerel x, merkez y, genişlik, yükseklik, cepheden öne çıkma dz).
 * x: null → cephenin ortası. Balkon yuvası için önce balkon alınmalı.
 */
export const NEON_SLOTS = Object.freeze([
  { id: 'door', name: 'Kapı üstü', icon: '🚪', x: FACADE.doorX, y: 3.03, w: 1.2, h: 0.24, dz: 0.03 },
  { id: 'window', name: 'Üst pencere', icon: '🪟', x: FACADE.centerX - 0.95, y: 4.32, w: 0.82, h: 0.26, dz: 0.075 },
  { id: 'balcony', name: 'Balkon korkuluğu', icon: '🏗️', x: FACADE.centerX, y: 3.8, w: 1.6, h: 0.34, dz: 0.75, balcony: true },
].map((s) => Object.freeze(s)));
export const NEON_SLOT_BY_ID = byId(NEON_SLOTS);

/** Son renk 'rainbow': harfler gökkuşağı renginde (statik — kare başı animasyon yok) */
export const NEON_COLORS = Object.freeze([
  { id: 'pink', name: 'Pembe', hex: '#ff2d95' },
  { id: 'red', name: 'Kırmızı', hex: '#ff3344' },
  { id: 'orange', name: 'Turuncu', hex: '#ff9a1a' },
  { id: 'yellow', name: 'Sarı', hex: '#ffe23f' },
  { id: 'green', name: 'Yeşil', hex: '#3cff7a' },
  { id: 'cyan', name: 'Turkuaz', hex: '#00e5ff' },
  { id: 'blue', name: 'Mavi', hex: '#3d7bff' },
  { id: 'purple', name: 'Mor', hex: '#c03cff' },
  { id: 'white', name: 'Beyaz', hex: '#f4f7ff' },
  { id: 'rainbow', name: 'Gökkuşağı', hex: '#ffffff', rainbow: true },
].map((c) => Object.freeze(c)));

// ---- Balkon -------------------------------------------------------------------------

export const BALCONY = Object.freeze({
  price: 25,
  // Üst kat penceresinin altında, kat silmesinin üstünde (yerel x: cephe ortası ± w/2)
  w: 3.3,
  depth: 0.72,
  y: WALL_H + 0.04, // döşemenin alt yüzü (3.24)
  slab: 0.1,
  railH: 0.86,
  colors: Object.freeze([
    Object.freeze({ id: 'iron', name: 'Siyah ferforje', hex: '#1d1d21' }),
    Object.freeze({ id: 'white', name: 'Beyaz', hex: '#eeeae0' }),
    Object.freeze({ id: 'green', name: 'Kanal yeşili', hex: '#1f5a43' }),
  ]),
});

export const BALCONY_ITEMS = Object.freeze([
  { id: 'table', name: 'Masa + 2 sandalye', icon: '🪑', price: 8 },
  { id: 'flowers', name: 'Lale kutuları', icon: '🌷', price: 5 },
  { id: 'lights', name: 'Işık zinciri', icon: '💡', price: 6 },
  { id: 'parasol', name: 'Şemsiye', icon: '⛱️', price: 7 },
].map((i) => Object.freeze(i)));
export const BALCONY_ITEM_BY_ID = byId(BALCONY_ITEMS);

// ---- Kurallar -------------------------------------------------------------------------

export const EXT_RULES = Object.freeze({
  MAX_TAGS: 16, // ev başına graffiti
  TAG_TEXT_MAX: 12,
  NEON_TEXT_MAX: 14,
  CAN_PRICE: 3, // bir sprey kutusu €3 …
  CAN_SPRAYS: 4, // … 4 sıkım (her graffiti 1 sıkım, boyutu fark etmez)
  MAX_SPRAYS: 40, // evde biriktirilebilecek sıkım
  NEON_PRICE: 12, // yeni tabela ya da yazısını / rengini değiştirmek
  REACH: 6, // oyuncu ile spreylenen nokta arası en fazla (m, yerde)
  SPRAY_MS: 800, // istemci: basılı tutma süresi (pssst)
  SPRAY_GAP_MS: 500, // sunucu: iki graffiti arası en az
  // "Evinin önünde": Achterstraat'ta, ev genişliğinde (± pay), cepheye en fazla ~6 m
  FRONT: Object.freeze({ margin: 0.35, minZ: 26.6, maxZ: 33.0 }),
});

// ---- Yardımcılar ----------------------------------------------------------------------

// Kontrol karakterleri, açılı parantezler, görünmez / yön değiştiren karakterler
// (sıfır genişlikli boşluk, LRM/RLM, bidi gömme ve yalıtımları)
const STRIP_RE = /[\u0000-\u001f\u007f-\u009f<>\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/**
 * İstemci yazısını temizler: yalnızca string kabul edilir (çevirme yok), yasak karakterler
 * atılır, boşluklar sadeleşir, en fazla `max` karakter (kod noktası; emoji yarım kesilmez).
 */
export function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  const s = raw.slice(0, 200).replace(STRIP_RE, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('').trim();
}

/** Şablonun genişlik / yükseklik oranı (yazı şablonlarında yazının uzunluğuna göre) */
export function tagAspect(design, text = '') {
  if (!design) return 1;
  if (!design.text) return design.aspect;
  const n = [...text].length;
  return Math.min(4, Math.max(1.3, 0.62 * n + 0.4));
}

/** Graffiti'nin cephedeki dikdörtgeni (yerel koordinatlar) */
export function tagRect(tag) {
  const d = GRAFFITI_BY_ID[tag.d];
  const h = TAG_SIZES[tag.s]?.h ?? TAG_SIZES[0].h;
  const w = h * tagAspect(d, tag.t);
  return { x0: tag.x - w / 2, x1: tag.x + w / 2, y0: tag.y - h / 2, y1: tag.y + h / 2, w, h };
}

/** Çakışma testi için: şablonun kenar boşluğu (sprey hâlesi) kadar küçültülmüş dikdörtgen */
function coreRect(r) {
  const mx = r.w * 0.12;
  const my = r.h * 0.12;
  return { x0: r.x0 + mx, x1: r.x1 - mx, y0: r.y0 + my, y1: r.y1 - my };
}

const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const isIndex = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

/**
 * Graffiti yerleşim kuralları (alanlar önceden tip denetiminden geçmiş olmalı; yine de
 * her şey burada bir kez daha sınanır). Sınır: cephe alanı; kapı / pencere / zil / fener
 * üstüne boya yok; ev başına en fazla MAX_TAGS. Graffiti'ler birbirinin üstüne binebilir.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateTag(tags, tag) {
  const d = typeof tag?.d === 'string' ? GRAFFITI_BY_ID[tag.d] : undefined;
  if (!d) return { ok: false, error: 'Böyle bir şablon yok.' };
  if (!isIndex(tag.c, SPRAY_COLORS.length)) return { ok: false, error: 'Geçersiz renk.' };
  if (!isIndex(tag.s, TAG_SIZES.length)) return { ok: false, error: 'Geçersiz boyut.' };
  if (typeof tag.x !== 'number' || typeof tag.y !== 'number' || !Number.isFinite(tag.x) || !Number.isFinite(tag.y)) {
    return { ok: false, error: 'Geçersiz konum.' };
  }
  if (d.text && (typeof tag.t !== 'string' || !tag.t || cleanText(tag.t, EXT_RULES.TAG_TEXT_MAX) !== tag.t)) {
    return { ok: false, error: 'Önce bir yazı yaz (T / ✏️).' };
  }
  if (Array.isArray(tags) && tags.length >= EXT_RULES.MAX_TAGS) {
    return { ok: false, error: `Bir cephede en fazla ${EXT_RULES.MAX_TAGS} graffiti olabilir — önce birini sil (X).` };
  }
  const r = tagRect(tag);
  const B = FACADE.bounds;
  if (r.x0 < B.x0 - 1e-6 || r.x1 > B.x1 + 1e-6 || r.y0 < B.y0 - 1e-6 || r.y1 > B.y1 + 1e-6) {
    return { ok: false, error: 'Duvara sığmıyor — kendi cephende kal (ya da daha küçük boyut seç).' };
  }
  const core = coreRect(r);
  for (const o of FACADE.openings) {
    if (hit(core, o)) return { ok: false, error: `${o.name[0].toLocaleUpperCase('tr-TR')}${o.name.slice(1)} üstüne boya olmaz.` };
  }
  return { ok: true };
}

/** Yerel noktadaki en üstteki graffiti (kaldırma hedefi) */
export function tagAtPoint(tags, x, y) {
  for (let i = tags.length - 1; i >= 0; i--) {
    const r = tagRect(tags[i]);
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return tags[i];
  }
  return null;
}

/** Neon yazısı geçerli mi (temiz, boş değil) */
export function validNeonText(text) {
  return typeof text === 'string' && text.length > 0 && cleanText(text, EXT_RULES.NEON_TEXT_MAX) === text;
}

/** (x, z) hangi evin önünde (Achterstraat'ta) — yoksa null */
export function frontOfHouse(x, z) {
  const F = EXT_RULES.FRONT;
  if (!(z > F.minZ && z < F.maxZ)) return null;
  let best = null;
  let bestD = Infinity;
  for (const h of PLAYER_HOUSES) {
    const { minX, maxX } = h.bounds;
    if (x < minX - F.margin || x > maxX + F.margin) continue;
    const d = Math.abs(x - (minX + maxX) / 2);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** Yerel x → dünya x */
export function facadeX(houseId, x) {
  return (HOUSE_BY_ID[houseId]?.bounds.minX ?? 0) + x;
}

/** Boş cephe (her ev bununla başlar; tahliyede buna döner) */
export function emptyExterior() {
  return { sprays: 0, tags: [], neon: {}, balcony: null };
}

export function isEmptyExterior(e) {
  return !e || (!e.sprays && !e.tags.length && !Object.keys(e.neon).length && !e.balcony);
}

/** Yerel konumu santimetreye yuvarlar (sunucu + istemci aynı değeri görür) */
export const roundPos = r2;

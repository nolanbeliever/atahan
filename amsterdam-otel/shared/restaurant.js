// Gurme Restoran "De Gouden Lepel" & mutfak: malzemeler, menü kütüphanesi, kurallar, personel ve
// NPC yürüyüş rotaları. Sunucu (RestaurantService, KitchenStaffService) ve istemci (GourmetRestaurant,
// KitchenSystem) AYNI tabloları kullanır. Yerleşim: shared/layout.js RESTAURANT.
import { RESTAURANT } from './layout.js';

/** Buzdolabındaki malzemeler (icon tarif şeritlerinde benzersiz olmalı) */
export const KITCHEN_INGREDIENTS = Object.freeze([
  { id: 'wagyu', name: 'Wagyu bonfile', icon: '🥩', color: '#9b2f2f' },
  { id: 'butter', name: 'Tereyağı', icon: '🧈', color: '#f3d36b' },
  { id: 'rosemary', name: 'Biberiye', icon: '🌿', color: '#4f8a3c' },
  { id: 'potato', name: 'Bebek patates', icon: '🥔', color: '#c9a35a' },
  { id: 'dough', name: 'Pizza hamuru', icon: '🫓', color: '#ecd9a8' },
  { id: 'tomato', name: 'Domates sosu', icon: '🍅', color: '#d23a2a' },
  { id: 'mozzarella', name: 'Mozzarella', icon: '🧀', color: '#f6f1df' },
  { id: 'basil', name: 'Fesleğen', icon: '🌱', color: '#3f9b46' },
  { id: 'bun', name: 'Brioche ekmeği', icon: '🍞', color: '#d9a04e' },
  { id: 'patty', name: 'Dana köfte', icon: '🍖', color: '#6b3a24' },
  { id: 'onion', name: 'Karamelize soğan', icon: '🧅', color: '#b98244' },
  { id: 'lettuce', name: 'Marul', icon: '🥬', color: '#6fbf4a' },
  { id: 'rice', name: 'Suşi pirinci', icon: '🍚', color: '#f4f2ea' },
  { id: 'salmon', name: 'Norveç somonu', icon: '🐟', color: '#f2875a' },
  { id: 'avocado', name: 'Avokado', icon: '🥑', color: '#8fbf4a' },
  { id: 'cucumber', name: 'Salatalık', icon: '🥒', color: '#4f9a4a' },
  { id: 'egg', name: 'Yumurta', icon: '🥚', color: '#f6e7c8' },
  { id: 'baguette', name: 'Baget', icon: '🥖', color: '#d29a4a' },
  { id: 'olive', name: 'Zeytin', icon: '🫒', color: '#56632a' },
  { id: 'honey', name: 'Bal', icon: '🍯', color: '#e8a42a' },
  { id: 'chocolate', name: 'Bitter çikolata', icon: '🍫', color: '#4a2716' },
  { id: 'strawberry', name: 'Çilek', icon: '🍓', color: '#e2334a' },
  { id: 'cream', name: 'Krema', icon: '🍦', color: '#fbf6ea' },
  { id: 'meringue', name: 'Beze', icon: '🍥', color: '#fdf4f0' },
]);
export const KITCHEN_INGREDIENT_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(KITCHEN_INGREDIENTS.map((i) => [i.id, i]))));

/** Pişirme yöntemleri: istasyon (layout RESTAURANT.stations) ve oyuncunun pişirme süresi */
export const COOK_METHODS = Object.freeze({
  pan: { id: 'pan', name: 'Ocakta tava', icon: '🍳', verb: 'Tavada pişir', ms: 4000 },
  oven: { id: 'oven', name: 'Taş fırın', icon: '🔥', verb: 'Fırına sür', ms: 5000 },
  board: { id: 'board', name: 'Hazırlık tezgâhı', icon: '🔪', verb: 'Tezgâhta hazırla', ms: 3000 },
});
export const COOK_METHOD_IDS = Object.freeze(Object.keys(COOK_METHODS));

/**
 * Menü kütüphanesi. Malzeme sırası serbest; yöntem tarifle aynı olmalı.
 * lux: VIP misafirlerin seçtiği lüks tabaklar. sat: memnuniyete katkısı (kalite çarpanıyla).
 */
export const DISHES = Object.freeze([
  {
    id: 'wagyu', name: 'Wagyu Biftek', icon: '🥩', cat: 'main', price: 120, method: 'pan', lux: true,
    ingredients: ['wagyu', 'butter', 'rosemary', 'potato'], color: '#7a2a22', desc: 'A5 wagyu, biberiyeli tereyağında, bebek patatesle',
  },
  {
    id: 'pizza', name: 'İtalyan Pizzası', icon: '🍕', cat: 'main', price: 38, method: 'oven', lux: false,
    ingredients: ['dough', 'tomato', 'mozzarella', 'basil'], color: '#e0a040', desc: 'Taş fırında Margherita',
  },
  {
    id: 'burger', name: 'Gurme Burger', icon: '🍔', cat: 'main', price: 45, method: 'pan', lux: false,
    ingredients: ['bun', 'patty', 'onion', 'lettuce'], color: '#a8642c', desc: 'Brioche, dana köfte, karamelize soğan',
  },
  {
    id: 'sushi', name: 'Suşi Tabağı', icon: '🍣', cat: 'main', price: 75, method: 'board', lux: true,
    ingredients: ['rice', 'salmon', 'avocado', 'cucumber'], color: '#f2875a', desc: 'Somonlu nigiri ve avokadolu maki',
  },
  {
    id: 'souffle', name: 'Çikolatalı Sufle', icon: '🧁', cat: 'dessert', price: 28, method: 'oven', lux: true,
    ingredients: ['chocolate', 'egg', 'butter'], color: '#4a2716', desc: 'Akışkan bitter çikolata kalbiyle',
  },
  {
    id: 'pavlova', name: 'Çilekli Pavlova', icon: '🍰', cat: 'dessert', price: 26, method: 'board', lux: true,
    ingredients: ['strawberry', 'cream', 'meringue'], color: '#e2334a', desc: 'Çıtır beze, krema ve taze çilek',
  },
  {
    id: 'breakfast', name: 'Kahvaltı Tabağı', icon: '🍳', cat: 'breakfast', price: 32, method: 'pan', lux: false,
    ingredients: ['egg', 'baguette', 'olive', 'honey'], color: '#f2c94c', desc: 'Sahanda yumurta, baget, zeytin ve bal',
  },
]);
export const DISH_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(DISHES.map((d) => [d.id, d]))));
export const DISH_CATS = Object.freeze({ main: 'Ana yemekler', dessert: 'Lüks tatlılar', breakfast: 'Kahvaltı' });

/** Eldeki malzemeler + yöntem hangi tabağa denk geliyor (yoksa null) */
export function matchDish(items, method) {
  const key = [...items].sort().join(',');
  return DISHES.find((d) => d.method === method && [...d.ingredients].sort().join(',') === key) ?? null;
}

/** Aynı malzemelerle (yöntemden bağımsız) eşleşen tabak — "yanlış yöntem" uyarısı için */
export function dishByIngredients(items) {
  const key = [...items].sort().join(',');
  return DISHES.find((d) => [...d.ingredients].sort().join(',') === key) ?? null;
}

export const RESTAURANT_RULES = Object.freeze({
  OPEN_MIN: 7 * 60, // 07:00 kahvaltıyla açılır
  CLOSE_MIN: 22 * 60 + 30, // 22:30 son sipariş (bekleyenler kalkar, yiyenler bitirir)
  BREAKFAST_TO: 11 * 60, // 07:00–11:00 açık büfe kahvaltı
  SPAWN_MIN_MS: 20_000, // yeni müşteri aralığı (gerçek ms) — yıldız ve doluluk kısaltır
  SPAWN_MAX_MS: 40_000,
  FIRST_SPAWN_MS: 6000,
  RETRY_MS: 5000,
  PATIENCE_MS: 100_000, // masada siparişini bekleme süresi
  PATIENCE_LUX_MS: 20_000, // lüks tabaklar için ek sabır
  EAT_MS: 24_000,
  BUFFET_MS: 2500, // büfeden tabak doldurma
  MAX_ITEMS: 4, // tepside en fazla malzeme
  MAX_DIRTY: 3, // aynı anda taşınabilecek kirli tabak
  // Bahşiş = fiyat × oran (yavaş %8 … hızlı %25) × bonus (konser / reklam); VIP fiyat ×1.5, bahşiş ×2
  TIP_RATE_MIN: 0.08,
  TIP_RATE_MAX: 0.25,
  VIP_PRICE_MULT: 1.5,
  VIP_TIP_MULT: 2,
  // Otel misafirleri (odasında olanlar) aşağı inip yer; VIP'ler lüks tabak sipariş eder
  GUEST_MIN_LEFT_MIN: 30, // çıkışına en az 30 oyun dakikası kalmış olmalı
  GUEST_REPEAT_MIN: 300, // aynı misafir en erken 5 oyun saati sonra tekrar iner
  // Memnuniyet: iyi yemek misafirin konaklamasını uzatır (oyun dakikası; kalite 0..1 ile ölçeklenir)
  EXTEND_MIN: 60,
  EXTEND_MAX: 180,
  VIP_EXTEND_MULT: 2,
  EXTEND_PRICE_PER_MIN: 1 / 240, // uzatma ücreti: oda fiyatı × dakika / 240 (dört saat = bir gece)
  GOOD_MEAL: 0.5, // bu kalitenin üstü +itibar
  REP_GOOD: 1,
  REP_VIP: 2,
  SAT_START: 60, // otel geneli memnuniyet (0..100), yemek başına hareketli ortalama
  SAT_ALPHA: 0.2,
  NET_SLACK_MS: 250,
  // Oyuncunun zamanlı eylemleri (ms); pişirme süresi COOK_METHODS'ta
  T: Object.freeze({
    take: 550, plate: 900, pass: 600, pick: 600, serve: 800, clear: 900, wash: 1800, trash: 700, restock: 2500,
  }),
});

/** Açık büfe: porsiyon stoğu, tazeleme (kasadan malzeme), kişi başı ücret */
export const BUFFET = Object.freeze({
  MAX: 24,
  REFILL: 8,
  LOW: 6, // aşçı bu stoğun altında büfeyi tazeler
  REFILL_COST: 24,
  PRICE: 22,
  VIP_PRICE: 40,
});

/** Mutfak personeli: Resepsiyon PC → Çalışanlar sekmesinden kasa parasıyla işe alınır */
export const KITCHEN_STAFF = Object.freeze({
  chef: {
    role: 'chef', title: 'Gurme Aşçı', icon: '👨‍🍳', price: 600, max: 3,
    names: Object.freeze(['Marco', 'Yuki', 'Ayşe', 'Pierre', 'Sofia', 'Hasan']),
  },
  waiter: {
    role: 'waiter', title: 'Garson', icon: '🤵', price: 350, max: 4,
    names: Object.freeze(['Lotte', 'Emre', 'Joris', 'Nina', 'Kerem', 'Fenna']),
  },
});
export const STAFF_ROLES = Object.freeze(Object.assign(Object.create(null), KITCHEN_STAFF));
export const STAFF_SPEED = 1.5; // m/sn
export const STAFF_TASKS_PER_LEVEL = 10;
export const STAFF_MAX_LEVEL = 5;

export function staffLevel(tasks) {
  return Math.min(STAFF_MAX_LEVEL, 1 + Math.floor(Math.max(0, tasks) / STAFF_TASKS_PER_LEVEL));
}

/**
 * Aşçının iş süresi çarpanı: 1★'de 1.0 → 5★'de 0.6; her seviye ayrıca %6 hızlandırır (en az 0.4).
 * Otel yıldızı arttıkça mutfak hızlanır.
 */
export function chefSpeedScale(stars, level) {
  const s = Math.min(Math.max(stars, 1), 5);
  return Math.max(0.4, (1 - 0.1 * (s - 1)) * (1 - 0.06 * (Math.max(1, level) - 1)));
}

/** Aşçının bir işteki adım süreleri (ms, 1★ / seviye 1) */
export const CHEF_MS = Object.freeze({ fridge: 1800, plate: 1400, pass: 600, restock: 2500 });
export const CHEF_COOK_MULT = 1.6; // aşçı pişirmeyi özenli yapar (oyuncudan biraz uzun)

/**
 * Müşteri gelme aralığı çarpanı (küçük = sık): yıldız ve otel doluluğu arttıkça restoran kalabalıklaşır.
 * @param occupancy 0..1 (açık katlardaki dolu oda oranı)
 */
export function restaurantSpawnFactor(stars, occupancy) {
  const s = Math.min(Math.max(stars, 1), 5);
  return 1 / (1 + 0.15 * (s - 1) + 0.8 * Math.min(Math.max(occupancy, 0), 1));
}

/** Memnuniyet (0..100) → yeni misafirlerin konaklama çarpanı: 50'nin üstü uzatır (en çok ×1.4) */
export function stayFactor(sat) {
  return 1 + 0.4 * Math.max(0, Math.min(100, sat) - 50) / 50;
}

export const RESTAURANT_DINER_NAMES = Object.freeze([
  'Sophie', 'Ruben', 'Julia', 'Finn', 'Eva', 'Luuk', 'Anna', 'Milan', 'Lisa', 'Thomas', 'Sara', 'Max',
]);

// ---- NPC rotaları -------------------------------------------------------------------------
// Restoranın içinde yürüyüş şeritleri: doğu koridoru (x = aisleX) tüm salon şeritlerini ve mutfağın güney
// şeridini bağlar; mutfağın kuzey şeridine adanın doğusundaki sütundan (kitchenCol) geçilir. Her nokta
// en yakın şeride iner, şeritler boyunca yürür, hedefin şeridinden hedefe çıkar → masaların, pass'in ve
// adanın içinden geçilmez.

const LN = RESTAURANT.lanes;

function laneOf([, z]) {
  if (z > 22.7) return { id: 'N', z: LN.kitchenN };
  if (z > 20.0) return { id: 'S', z: LN.kitchenS };
  let best = { id: 'P', z: LN.pass };
  let d = Math.abs(z - LN.pass);
  LN.rows.forEach((rz, i) => {
    const dd = Math.abs(z - rz);
    if (dd < d) {
      d = dd;
      best = { id: `R${i}`, z: rz };
    }
  });
  return best;
}

/** Şeritteki noktadan doğu koridoruna (gövde) bağlantı */
function toTrunk(lane) {
  if (lane.id === 'N') return [[LN.kitchenCol, LN.kitchenN], [LN.kitchenCol, LN.kitchenS], [LN.aisleX, LN.kitchenS]];
  return [[LN.aisleX, lane.z]];
}

/** Restoran içinde a → b yürüyüş rotası (a ve b dahil) */
export function restaurantRoute(a, b) {
  const la = laneOf(a);
  const lb = laneOf(b);
  const pts = [a, [a[0], la.z]];
  if (la.id === lb.id) {
    pts.push([b[0], lb.z]);
  } else if ((la.id === 'N' && lb.id === 'S') || (la.id === 'S' && lb.id === 'N')) {
    pts.push([LN.kitchenCol, la.z], [LN.kitchenCol, lb.z], [b[0], lb.z]);
  } else {
    pts.push(...toTrunk(la), ...toTrunk(lb).reverse(), [b[0], lb.z]);
  }
  pts.push(b);
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) out.push([p[0], p[1]]);
  }
  return out;
}

/** Lobiden restoran kapısından içeri (kapının iç yüzüne kadar) */
export const LOBBY_TO_RESTAURANT = Object.freeze([RESTAURANT.points.lobby, RESTAURANT.points.doorEast, RESTAURANT.points.doorWest]);

/** Aşçının pass'e tabak koyduğu nokta (mutfak tarafı) / garsonun aldığı nokta (salon tarafı) */
export const passChefPoint = (i) => [RESTAURANT.passSlots[i][0], 20.5];
export const passWaiterPoint = (i) => [RESTAURANT.passSlots[i][0], LN.pass];

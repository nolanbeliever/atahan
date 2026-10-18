import {
  EVT, GUEST_SPEED, GUEST_PHASE as GP, ROOM_PRICE, ROOM_STATUS, roomFloor,
} from '../../shared/constants.js';
import { RESTAURANT, POINTS, ROOM_BY_ID, pointInBounds } from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';
import { roomPrice } from '../../shared/hotel.js';
import { VIP } from '../../shared/architecture.js';
import {
  RESTAURANT_RULES as R, BUFFET, DISHES, DISH_BY_ID, KITCHEN_INGREDIENT_BY_ID, COOK_METHODS, RESTAURANT_DINER_NAMES,
  LOBBY_TO_RESTAURANT, matchDish, dishByIngredients, restaurantRoute, restaurantSpawnFactor, stayFactor,
} from '../../shared/restaurant.js';
import { roomToLobby, lobbyToRoom } from './routes.js';

// Müşteri fazları (otel misafirleri de bu fazlarla restorana iner; GuestManager g.dining varken dokunmaz)
const PH = Object.freeze({ IN: 'dineIn', BUFFET: 'dineBuffet', SEAT: 'dineSeat', OUT: 'dineOut' });
// Masa durumları (RESTAURANT_STATE'te aynen gider)
const S = Object.freeze({ EMPTY: 'empty', COMING: 'coming', WAITING: 'waiting', EATING: 'eating' });

const REACH = RESTAURANT.range + 1; // istasyon menzili + ağ gecikmesi toleransı
const ACTS = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(['cook', ...Object.keys(R.T)].map((k) => [k, true]))));

// İstemci girdileri: yalnızca doğru tipteki değer kabul edilir (Number()/String() ile çevrilmez)
const str = (v) => (typeof v === 'string' ? v : '');
const int = (v) => (Number.isInteger(v) ? v : -1);
const near = (p, [x, z], range = REACH) => Math.hypot(p.x - x, p.z - z) <= range;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

const emptyTable = () => ({
  state: S.EMPTY, diner: null, name: null, vip: false, room: null, buffet: false,
  order: null, waitUntil: 0, patienceMs: 0, eatEndsAt: 0, plate: null, dish: null,
});

/** Müşteri kalkınca masayı boşalt — tabak (plate/dish) yerinde kalır */
function resetTable(t) {
  Object.assign(t, {
    state: S.EMPTY, diner: null, name: null, vip: false, room: null, buffet: false, order: null, waitUntil: 0, patienceMs: 0, eatEndsAt: 0,
  });
}

/** Sipariş ağırlıkları: kahvaltı saatinde kahvaltı tabağı öne çıkar; VIP yalnızca lüks tabak ister */
function orderWeights(breakfast, vip) {
  return DISHES.map((d) => {
    if (vip) return d.lux ? 1 : 0;
    if (d.cat === 'breakfast') return breakfast ? 4 : 0.6;
    if (d.cat === 'dessert') return breakfast ? 0.4 : 1.2;
    return breakfast ? 0.6 : 2.2;
  });
}

/**
 * Gurme Restoran "De Gouden Lepel" — sunucu yetkili.
 *  - Masalar: 6 lüks masa. Müşteriler sokaktan gelir ya da odasındaki otel misafirleri (özellikle 12. kattaki
 *    VIP'ler) asansörle iner; oturur, sipariş verir; sabrı biterse kalkar, yemeğini bitirince kirli tabak bırakır.
 *    07:00–11:00 açık büfe kahvaltı: müşteri önce büfeden tabağını doldurur (stok porsiyonla).
 *  - Mutfak adımları (take / cook / plate / pass / pick / serve / clear / wash / trash / restock) konum, el ve
 *    zaman açısından burada doğrulanır; istemci (KitchenSystem) animasyonu aynı süreyle iyimser oynatır.
 *  - Satış + bahşiş otelin KASASINA. İyi yemek otel misafirinin konaklamasını uzatır (uzatma ücreti de kasaya),
 *    otelin memnuniyet puanını artırır; memnuniyet yeni misafirlerin konaklama süresini uzatır.
 *  - Aşçı ve garson NPC'leri KitchenStaffService'tedir; bu servisin tablolarını (masa, pass, büfe) kullanır.
 */
export class RestaurantService {
  constructor(sim) {
    this.sim = sim;
    this.tables = RESTAURANT.tables.map(emptyTable);
    // Pass (garson tezgâhı): tabak yerleri; reserved = tabağı oraya koyacak aşçının kimliği
    this.pass = RESTAURANT.passSlots.map(() => ({ dish: null, reserved: 0 }));
    this.diners = new Map(); // id → { id, hotel, e (varlık: otel misafiri g ya da kendisi), name, vip, room, table, buffet }
    this.buffet = BUFFET.MAX;
    this.sat = R.SAT_START;
    this.nextSpawnAt = null; // gerçek ms; kapalıyken null
    this.lastOpen = this.open;
  }

  get rng() { return this.sim.rng; }

  get open() {
    const m = this.sim.clock.minute;
    return m >= R.OPEN_MIN && m < R.CLOSE_MIN;
  }

  get breakfast() {
    const m = this.sim.clock.minute;
    return m >= R.OPEN_MIN && m < R.BREAKFAST_TO;
  }

  /** Memnuniyete göre yeni misafirlerin konaklama çarpanı (GuestManager) */
  stayFactor() { return stayFactor(this.sat); }

  // ---- Kalıcılık ---------------------------------------------------------------------

  persisted() {
    return { buffet: this.buffet, sat: Math.round(this.sat * 10) / 10 };
  }

  restore(r) {
    if (!r || typeof r !== 'object') return;
    if (Number.isInteger(r.buffet)) this.buffet = Math.min(Math.max(r.buffet, 0), BUFFET.MAX);
    if (Number.isFinite(r.sat)) this.sat = Math.min(Math.max(r.sat, 0), 100);
  }

  // ---- Oyuncu durumu -------------------------------------------------------------------

  initPlayer(p) {
    p.kitchen = { hold: null, busyUntil: 0, act: null };
  }

  /** Oyuncu ayrılınca elindeki tepsi / tabak kaybolur (kirli tabaklar bulaşığa gitmiş sayılır) */
  removePlayer(p) {
    if (p.kitchen) p.kitchen.hold = null;
  }

  privateState(p) {
    return { hold: this.holdState(p), busyUntil: p.kitchen.busyUntil };
  }

  holdState(p) {
    const h = p.kitchen.hold;
    if (!h) return null;
    if (h.kind === 'tray') return { kind: 'tray', items: [...h.items], cooked: h.cooked };
    return { ...h };
  }

  /** Diğer oyuncuların gördüğü: elde ne var (tabak kimliği / 'tray' / 'dirty'), hangi eylem ne zamana kadar */
  publicState(p, now = this.sim.now()) {
    const k = p.kitchen;
    const h = k?.hold;
    return {
      hold: !h ? null : h.kind === 'dish' ? h.dish : h.kind,
      act: k && now < k.busyUntil ? k.act : null,
      until: k?.busyUntil ?? 0,
    };
  }

  // ---- Paylaşılan durum ---------------------------------------------------------------

  serialize() {
    return {
      open: this.open,
      breakfast: this.breakfast,
      buffet: this.buffet,
      sat: Math.round(this.sat),
      pass: this.pass.map((s) => s.dish),
      tables: this.tables.map((t) => ({
        state: t.state,
        diner: t.diner,
        name: t.name,
        vip: t.vip,
        room: t.room,
        buffet: t.buffet,
        order: t.order,
        waitUntil: t.state === S.WAITING ? t.waitUntil : 0,
        patienceMs: t.patienceMs,
        plate: t.plate,
        dish: t.dish,
      })),
    };
  }

  changed() {
    this.sim.out(EVT.RESTAURANT_STATE, this.serialize());
  }

  /** Sokaktan gelen müşteriler (otel misafirleri GuestManager.serialize içinde zaten var) */
  serializeDiners() {
    const out = [];
    for (const d of this.diners.values()) if (!d.hotel) out.push(this.toWire(d));
    return out;
  }

  toWire(d) {
    return {
      id: d.id, look: d.look, phase: d.phase, path: d.path, t0: d.t0,
      speed: GUEST_SPEED, face: d.face, sit: d.sit, roomId: null, kind: 'diner',
    };
  }

  shiftTime(deltaMs) {
    for (const d of this.diners.values()) {
      if (d.hotel) continue; // otel misafirlerini GuestManager kaydırır
      d.t0 += deltaMs;
      d.phaseEndsAt += deltaMs;
    }
    for (const t of this.tables) {
      if (t.waitUntil) t.waitUntil += deltaMs;
      if (t.eatEndsAt) t.eatEndsAt += deltaMs;
    }
    if (this.nextSpawnAt !== null) this.nextSpawnAt += deltaMs;
  }

  // ---- Döngü -----------------------------------------------------------------------------

  update(now) {
    let changed = false;
    const open = this.open;
    if (open !== this.lastOpen) {
      this.lastOpen = open;
      changed = true;
      if (open) this.sim.notify('🍽️ De Gouden Lepel açıldı — açık büfe kahvaltı başladı! (Restoran: lobinin batısı)', 'info');
    }
    if (open && this.sim.config.restaurantDiners !== false) {
      if (this.nextSpawnAt === null) this.nextSpawnAt = now + R.FIRST_SPAWN_MS * (0.5 + this.rng());
      if (now >= this.nextSpawnAt) {
        if (this.spawn(now)) {
          changed = true;
          const f = restaurantSpawnFactor(this.sim.growth.stars, this.occupancy());
          this.nextSpawnAt = now + (R.SPAWN_MIN_MS + this.rng() * (R.SPAWN_MAX_MS - R.SPAWN_MIN_MS)) * f / this.sim.boosts.barSpawn;
        } else {
          this.nextSpawnAt = now + R.RETRY_MS;
        }
      }
    } else {
      this.nextSpawnAt = null;
    }
    for (const d of [...this.diners.values()]) {
      if (this.updateDiner(d, now, open)) changed = true;
    }
    if (changed) this.changed();
  }

  /** Açık katlardaki dolu oda oranı (0..1) */
  occupancy() {
    const floors = this.sim.growth.floors;
    let total = 0;
    let busy = 0;
    for (const room of this.sim.rooms.rooms.values()) {
      if (roomFloor(room.id) > floors) continue;
      total++;
      if (room.status === ROOM_STATUS.OCCUPIED) busy++;
    }
    return total ? busy / total : 0;
  }

  /** Yalnızca boş VE temiz (üstünde tabak olmayan) masalara müşteri oturur */
  freeTables() {
    const out = [];
    this.tables.forEach((t, i) => { if (t.state === S.EMPTY && t.plate === null) out.push(i); });
    return out;
  }

  /** Aşağı inip yemek yiyebilecek otel misafirleri (odasında, çıkışına zaman var, yakın zamanda yememiş) */
  hotelCandidates() {
    const total = this.sim.clock.total;
    const out = [];
    for (const g of this.sim.guests.guests.values()) {
      if (g.phase !== GP.IN_ROOM || g.dining || !g.roomId) continue;
      if (g.checkoutAt - total < R.GUEST_MIN_LEFT_MIN) continue;
      if (g.ateAt != null && total - g.ateAt < R.GUEST_REPEAT_MIN) continue;
      out.push(g);
    }
    return out;
  }

  pickName() {
    const used = new Set([...this.diners.values()].map((d) => d.name));
    const free = RESTAURANT_DINER_NAMES.filter((n) => !used.has(n));
    const list = free.length ? free : RESTAURANT_DINER_NAMES;
    return list[Math.floor(this.rng() * list.length)];
  }

  street() { return this.rng() < 0.5 ? POINTS.streetWest : POINTS.streetEast; }

  spawn(now) {
    const free = this.freeTables();
    if (!free.length) return false;
    const table = free[Math.floor(this.rng() * free.length)];
    const st = RESTAURANT.tables[table];
    const buffet = this.breakfast && this.buffet > 0 && this.rng() < 0.75;
    const target = buffet ? RESTAURANT.buffet.point : st.seat;
    const inner = restaurantRoute(RESTAURANT.points.doorWest, target);
    const toPath = [RESTAURANT.points.lobby, RESTAURANT.points.doorEast, ...inner];

    // Otel misafiri mi? Doluluk arttıkça daha çok misafir aşağı iner; VIP varsa öncelik onda
    const cands = this.hotelCandidates();
    const hotelChance = cands.length ? 0.35 + 0.4 * this.occupancy() : 0;
    let d;
    if (this.rng() < hotelChance) {
      const vips = cands.filter((g) => g.vip);
      const pool = vips.length && this.rng() < 0.6 ? vips : cands;
      const g = pool[Math.floor(this.rng() * pool.length)];
      g.dining = true;
      d = {
        id: g.id, hotel: true, e: g, vip: !!g.vip, room: g.roomId, table, buffet,
        name: g.vip ? `⭐ VIP · Oda ${g.roomId}` : `Oda ${g.roomId} misafiri`,
      };
      const layout = ROOM_BY_ID[g.roomId];
      this.diners.set(d.id, d);
      this.walk(d, PH.IN, roomToLobby([layout.path.stand], layout, toPath), now);
    } else {
      d = {
        id: this.sim.guests.nextId++, // otel misafirleriyle ortak sayaç → kimlikler çakışmaz
        hotel: false,
        look: this.sim.guests.randomLook(),
        name: this.pickName(),
        vip: false,
        room: null,
        table,
        buffet,
        phase: null,
        path: null,
        legs: null,
        t0: now,
        phaseEndsAt: 0,
        face: 0,
        sit: false,
      };
      d.e = d;
      this.diners.set(d.id, d);
      this.walk(d, PH.IN, [[this.street(), POINTS.doorOutside, POINTS.doorInside, ...toPath]], now);
    }
    Object.assign(this.tables[table], {
      state: S.COMING, diner: d.id, name: d.name, vip: d.vip, room: d.room, buffet,
    });
    if (d.vip) this.sim.notify(`⭐ VIP misafir (Oda ${d.room}) restorana iniyor — lüks bir tabak isteyecek!`, 'info');
    return true;
  }

  // ---- Yürüyüş ------------------------------------------------------------------------

  walk(d, phase, legs, now) {
    const e = d.e;
    e.legs = legs.length > 1 ? legs.slice(1) : null;
    e.phase = phase;
    e.path = legs[0].map((pt) => [pt[0], pt[1]]);
    e.t0 = now;
    e.sit = false;
    e.phaseEndsAt = now + (pathLength(e.path) / GUEST_SPEED) * 1000;
    this.broadcast(d);
  }

  stand(d, phase, point, face, now, ms = 0, sit = false) {
    const e = d.e;
    e.legs = null;
    e.phase = phase;
    e.path = [[point[0], point[1]]];
    e.t0 = now;
    e.face = face;
    e.sit = sit;
    e.phaseEndsAt = now + ms;
    this.broadcast(d);
  }

  broadcast(d) {
    if (d.hotel) this.sim.guests.broadcast(d.e);
    else this.sim.out(EVT.GUEST_UPSERT, this.toWire(d));
  }

  /** @returns {boolean} RESTAURANT_STATE değişti mi */
  updateDiner(d, now, open) {
    const e = d.e;
    if (e.phase === PH.SEAT) return this.updateSeated(d, now, open);
    if (now < e.phaseEndsAt) return false;
    if (e.legs) {
      // Asansör: sonraki bacağın başına ışınlan
      const legs = e.legs;
      this.walk(d, e.phase, legs, now);
      return false;
    }
    if (e.phase === PH.IN) {
      if (!open) {
        this.leave(d, now, false);
        return true;
      }
      if (d.buffet && !d.buffetDone) {
        // Büfenin önünde (batıya dönük) tabağını doldurur
        this.stand(d, PH.BUFFET, RESTAURANT.buffet.point, -Math.PI / 2, now, R.BUFFET_MS);
        return false;
      }
      this.seat(d, now);
      return true;
    }
    if (e.phase === PH.BUFFET) {
      d.buffetDone = true;
      if (this.buffet > 0) this.buffet -= 1;
      else d.buffet = false; // büfe boşaldı: kahvaltı tabağını mutfaktan sipariş eder
      this.tables[d.table].buffet = d.buffet;
      this.walk(d, PH.IN, [restaurantRoute(RESTAURANT.buffet.point, RESTAURANT.tables[d.table].seat)], now);
      return true;
    }
    if (e.phase === PH.OUT) this.finishLeave(d, now);
    return false;
  }

  updateSeated(d, now, open) {
    const t = this.tables[d.table];
    if (t.state === S.WAITING && (now >= t.waitUntil || !open)) {
      // Sabrı tükendi (ya da restoran kapandı): servis edilmeden kalkar
      this.rate(0);
      this.leave(d, now, false);
      return true;
    }
    if (t.state === S.EATING && now >= t.eatEndsAt) {
      t.plate = 'dirty';
      this.leave(d, now, true);
      return true;
    }
    return false;
  }

  /** Masasına vardı: oturur (masaya, +Z'ye dönük); büfe tabağı varsa yemeye başlar, yoksa sipariş verir */
  seat(d, now) {
    const t = this.tables[d.table];
    this.stand(d, PH.SEAT, RESTAURANT.tables[d.table].seat, 0, now, 0, true);
    if (d.buffet) {
      const price = d.vip ? BUFFET.VIP_PRICE : BUFFET.PRICE;
      Object.assign(t, { state: S.EATING, eatEndsAt: now + R.EAT_MS, plate: 'full', dish: 'buffet' });
      this.sim.today.meals += 1;
      this.sim.earn(price, `🍳 Açık büfe kahvaltı (${d.name})`, { guest: false });
      this.afterMeal(d, 0.7);
      return;
    }
    const dish = this.pickDish(d);
    const patienceMs = R.PATIENCE_MS + (dish.lux ? R.PATIENCE_LUX_MS : 0);
    Object.assign(t, { state: S.WAITING, order: dish.id, waitUntil: now + patienceMs, patienceMs });
  }

  pickDish(d) {
    const w = orderWeights(this.breakfast, d.vip);
    let r = this.rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < DISHES.length; i++) {
      r -= w[i];
      if (r < 0) return DISHES[i];
    }
    return DISHES[0];
  }

  /** Masadan kalk: sokaktan gelen sokağa, otel misafiri odasına döner */
  leave(d, now, ate) {
    const t = this.tables[d.table];
    const seat = RESTAURANT.tables[d.table].seat;
    resetTable(t);
    if (!ate && t.plate !== 'dirty') {
      t.plate = null;
      t.dish = null;
    }
    d.table = -1;
    const inner = restaurantRoute(seat, RESTAURANT.points.doorWest);
    const out = [...inner, RESTAURANT.points.doorEast, RESTAURANT.points.lobby];
    if (d.hotel) {
      const layout = ROOM_BY_ID[d.room];
      this.walk(d, PH.OUT, lobbyToRoom(out, layout, [layout.path.stand]), now);
    } else {
      this.walk(d, PH.OUT, [[...out, POINTS.doorInside, POINTS.doorOutside, this.street()]], now);
    }
  }

  finishLeave(d, now) {
    this.diners.delete(d.id);
    if (d.hotel) {
      const g = d.e;
      g.dining = false;
      const layout = ROOM_BY_ID[d.room];
      this.sim.guests.stand(g, GP.IN_ROOM, layout.path.stand, 0, now);
      return;
    }
    this.sim.out(EVT.GUEST_REMOVE, d.id);
  }

  // ---- Servis, memnuniyet, konaklama uzatma ---------------------------------------------

  /** Memnuniyet puanı: yemek başına hareketli ortalama (kalite 0 = kalkıp giden müşteri) */
  rate(quality) {
    this.sat = this.sat * (1 - R.SAT_ALPHA) + R.SAT_ALPHA * (quality > 0 ? 40 + 60 * quality : 0);
  }

  /**
   * Bekleyen masaya tabağı servis et (oyuncu ya da garson). Satış + bahşiş kasaya.
   * @returns {{ price, tip, quality } | null}
   */
  serveTable(i, dishId, now) {
    const t = this.tables[i];
    const dish = DISH_BY_ID[dishId];
    if (!t || !dish || t.state !== S.WAITING || t.order !== dishId) return null;
    const quality = t.patienceMs > 0 ? clamp01((t.waitUntil - now) / t.patienceMs) : 0;
    const vip = t.vip;
    const price = Math.round(dish.price * (vip ? R.VIP_PRICE_MULT : 1));
    const rate = R.TIP_RATE_MIN + (R.TIP_RATE_MAX - R.TIP_RATE_MIN) * quality;
    const tip = Math.max(1, Math.round(price * rate * (vip ? R.VIP_TIP_MULT : 1) * this.sim.boosts.barTip));
    Object.assign(t, { state: S.EATING, waitUntil: 0, eatEndsAt: now + R.EAT_MS, plate: 'full', dish: dish.id });
    this.sim.today.meals += 1;
    this.sim.earn(price + tip, `🍽️ Restoran: ${dish.name}${vip ? ' (VIP)' : ''} (+€${tip} bahşiş)`, { guest: false });
    const d = this.diners.get(t.diner);
    if (d) this.afterMeal(d, quality);
    this.changed();
    return { price, tip, quality };
  }

  /**
   * Yemeğin etkisi: memnuniyet; otel misafiriyse konaklamasını uzatır (uzatma ücreti kasaya) ve iyi yemek
   * itibar kazandırır. VIP'lerde uzatma ve itibar iki kat.
   */
  afterMeal(d, quality) {
    this.rate(quality);
    if (!d.hotel) return;
    const g = d.e;
    const clock = this.sim.clock;
    g.ateAt = clock.total;
    const ext = Math.round((R.EXTEND_MIN + (R.EXTEND_MAX - R.EXTEND_MIN) * quality) * (d.vip ? R.VIP_EXTEND_MULT : 1));
    const nightly = d.vip ? VIP.PRICE : roomPrice(ROOM_PRICE, this.sim.growth.stars);
    const fee = Math.round(nightly * ext * R.EXTEND_PRICE_PER_MIN);
    g.checkoutAt = Math.max(g.checkoutAt, clock.total) + ext;
    if (fee > 0) this.sim.earn(fee, `🛏️ Oda ${d.room} konaklamasını uzattı (${Math.round(ext / 60 * 10) / 10} saat)`, { guest: false });
    if (quality >= R.GOOD_MEAL) this.sim.growth.addReputation(d.vip ? R.REP_VIP : R.REP_GOOD);
    const hours = Math.round(ext / 6) / 10;
    if (d.vip) this.sim.notify(`⭐ VIP misafir (Oda ${d.room}) yemeğe bayıldı ve konaklamasını ${hours} saat uzattı! +€${fee} kasaya`, 'money');
    else if (quality >= R.GOOD_MEAL) this.sim.notify(`😋 Oda ${d.room} misafiri yemekten memnun: konaklamasını ${hours} saat uzattı (+€${fee}).`, 'info');
  }

  /** Masadaki kirli tabağı kaldır (oyuncu ya da garson) */
  clearTable(i) {
    const t = this.tables[i];
    if (!t || t.plate !== 'dirty') return false;
    t.plate = null;
    t.dish = null;
    this.changed();
    return true;
  }

  /** Büfeyi tazele: kasadan malzeme parası; @returns hata metni ya da null */
  restockBuffet(byName) {
    if (this.buffet >= BUFFET.MAX) return 'Büfe zaten dolu.';
    if (this.sim.money < BUFFET.REFILL_COST) return `Kasada malzeme parası yok (€${BUFFET.REFILL_COST}).`;
    this.buffet = Math.min(BUFFET.MAX, this.buffet + BUFFET.REFILL);
    this.sim.spend(BUFFET.REFILL_COST, `🍳 Açık büfe tazelendi (${byName})`);
    this.changed();
    return null;
  }

  // ---- Oyuncunun mutfak adımları ----------------------------------------------------------

  inside(p) {
    return pointInBounds(p.x, p.z, RESTAURANT.bounds, 0.3);
  }

  /**
   * İstemciden gelen tek bir mutfak / servis adımı.
   * @returns {{ ok: true, hold, busyUntil, tip?, price? } | { ok: false, error: string }}
   */
  act(p, data, now) {
    const act = str(data?.act);
    if (!ACTS[act]) return { ok: false, error: 'Bilinmeyen işlem.' };
    if (!this.inside(p)) return { ok: false, error: 'Bunun için restoranda olmalısın.' };
    if (now < p.kitchen.busyUntil - R.NET_SLACK_MS) return { ok: false, error: 'Önce elindeki işi bitir.' };
    if (p.bar?.hold) return { ok: false, error: 'Ellerin dolu — önce bardan aldığını bitir / bırak.' };

    const res = this[`do_${act}`](p, data, now);
    if (res.error) return { ok: false, error: res.error };

    const dur = act === 'cook' ? COOK_METHODS[res.method].ms : R.T[act];
    p.kitchen.busyUntil = now + dur;
    p.kitchen.act = act;
    this.sim.out(EVT.PLAYER_KITCHEN, { id: p.id, ...this.publicState(p, now) });
    this.sim.shop.sendSelf(p);
    return { ok: true, hold: this.holdState(p), busyUntil: p.kitchen.busyUntil, ...res };
  }

  handsFull(h) {
    if (h.kind === 'dirty') return 'Önce kirli tabakları bulaşık lavabosuna bırak.';
    if (h.kind === 'dish') return 'Elinde bir tabak var — servis et ya da garson tezgâhına koy.';
    return 'Ellerin dolu.';
  }

  do_take(p, data) {
    const ing = KITCHEN_INGREDIENT_BY_ID[str(data?.ing)];
    if (!ing) return { error: 'Böyle bir malzeme yok.' };
    if (!near(p, RESTAURANT.fridge.point)) return { error: 'Buzdolabına yaklaş.' };
    const h = p.kitchen.hold;
    if (!h) {
      p.kitchen.hold = { kind: 'tray', items: [ing.id], cooked: null };
      return {};
    }
    if (h.kind !== 'tray') return { error: this.handsFull(h) };
    if (h.cooked) return { error: 'Pişmiş tepsiye çiğ malzeme eklenmez — önce tabakla ya da çöpe at.' };
    if (h.items.includes(ing.id)) return { error: `${ing.icon} ${ing.name} zaten tepside.` };
    if (h.items.length >= R.MAX_ITEMS) return { error: `Tepsiye en fazla ${R.MAX_ITEMS} malzeme sığar.` };
    h.items.push(ing.id);
    return {};
  }

  do_cook(p, data) {
    const m = COOK_METHODS[str(data?.method)];
    if (!m) return { error: 'Böyle bir istasyon yok.' };
    const h = p.kitchen.hold;
    if (h?.kind !== 'tray' || !h.items.length) return { error: 'Önce buzdolabından malzeme al.' };
    if (h.cooked) return { error: 'Bu tepsi zaten hazırlandı — şimdi tabakla.' };
    if (!near(p, RESTAURANT.stations[m.id])) return { error: `${m.name} istasyonuna yaklaş.` };
    h.cooked = m.id;
    return { method: m.id };
  }

  do_plate(p) {
    const h = p.kitchen.hold;
    if (h?.kind !== 'tray' || !h.items.length) return { error: 'Tabaklanacak bir şey yok — önce malzeme al ve pişir.' };
    if (!near(p, RESTAURANT.plates)) return { error: 'Tabak rafına yaklaş.' };
    const dish = matchDish(h.items, h.cooked);
    if (!dish) {
      const want = dishByIngredients(h.items);
      if (want && !h.cooked) return { error: `${want.icon} ${want.name} için önce: ${COOK_METHODS[want.method].verb.toLowerCase()}.` };
      if (want) return { error: `${want.icon} ${want.name} ${COOK_METHODS[want.method].name} ile hazırlanır — bu tepsiyi çöpe at.` };
      return { error: 'Bu malzemeler hiçbir tarife uymuyor — tarif panosuna bak, tepsiyi çöpe at.' };
    }
    p.kitchen.hold = { kind: 'dish', dish: dish.id };
    return { dish: dish.id };
  }

  do_pass(p, data) {
    const i = int(data?.slot);
    const slot = this.pass[i];
    if (!slot) return { error: 'Geçersiz tezgâh yeri.' };
    const h = p.kitchen.hold;
    if (h?.kind !== 'dish') return { error: 'Garson tezgâhına koyacak hazır tabağın yok.' };
    if (!near(p, RESTAURANT.passSlots[i])) return { error: 'Garson tezgâhına yaklaş.' };
    if (slot.dish || slot.reserved) return { error: 'Bu yer dolu — başka bir yere koy.' };
    slot.dish = h.dish;
    p.kitchen.hold = null;
    this.changed();
    return {};
  }

  do_pick(p, data) {
    const i = int(data?.slot);
    const slot = this.pass[i];
    if (!slot) return { error: 'Geçersiz tezgâh yeri.' };
    if (p.kitchen.hold) return { error: this.handsFull(p.kitchen.hold) };
    if (!slot.dish) return { error: 'Burada tabak yok.' };
    if (!near(p, RESTAURANT.passSlots[i])) return { error: 'Garson tezgâhına yaklaş.' };
    p.kitchen.hold = { kind: 'dish', dish: slot.dish };
    slot.dish = null;
    this.changed();
    return {};
  }

  do_serve(p, data, now) {
    const i = int(data?.table);
    const t = this.tables[i];
    if (!t) return { error: 'Geçersiz masa.' };
    const h = p.kitchen.hold;
    if (h?.kind !== 'dish') return { error: 'Servis için önce bir tabak hazırla.' };
    if (!near(p, RESTAURANT.tables[i].center)) return { error: 'Masaya yaklaş.' };
    if (t.state !== S.WAITING) return { error: 'Bu masada sipariş bekleyen yok.' };
    if (t.order !== h.dish) {
      const want = DISH_BY_ID[t.order];
      return { error: `${t.name}: "Ben ${want.icon} ${want.name} istemiştim!"` };
    }
    const r = this.serveTable(i, h.dish, now);
    if (!r) return { error: 'Servis edilemedi.' };
    p.kitchen.hold = null;
    const d = DISH_BY_ID[t.dish];
    this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `${d.icon} ${d.name} servis edildi · €${r.price} + €${r.tip} bahşiş kasaya`, kind: 'money' });
    return { tip: r.tip, price: r.price };
  }

  do_clear(p, data) {
    const i = int(data?.table);
    const t = this.tables[i];
    if (!t) return { error: 'Geçersiz masa.' };
    if (t.plate !== 'dirty') return { error: 'Bu masada toplanacak tabak yok.' };
    if (!near(p, RESTAURANT.tables[i].center)) return { error: 'Masaya yaklaş.' };
    const h = p.kitchen.hold;
    if (h && h.kind !== 'dirty') return { error: this.handsFull(h) };
    if (h && h.count >= R.MAX_DIRTY) return { error: `Aynı anda en fazla ${R.MAX_DIRTY} kirli tabak taşıyabilirsin — önce lavaboya bırak.` };
    this.clearTable(i);
    p.kitchen.hold = { kind: 'dirty', count: (h?.count ?? 0) + 1 };
    return {};
  }

  do_wash(p) {
    const h = p.kitchen.hold;
    if (h?.kind !== 'dirty') return { error: 'Yıkanacak tabağın yok.' };
    if (!near(p, RESTAURANT.sink)) return { error: 'Bulaşık lavabosuna yaklaş.' };
    p.kitchen.hold = null;
    return {};
  }

  do_trash(p) {
    const h = p.kitchen.hold;
    if (h?.kind !== 'tray' && h?.kind !== 'dish') return { error: 'Atacak bir şeyin yok.' };
    if (!near(p, RESTAURANT.trash)) return { error: 'Çöp kovasına yaklaş.' };
    p.kitchen.hold = null;
    return {};
  }

  do_restock(p) {
    if (p.kitchen.hold) return { error: this.handsFull(p.kitchen.hold) };
    if (!near(p, RESTAURANT.buffet.point)) return { error: 'Büfeye yaklaş.' };
    const err = this.restockBuffet(p.name);
    return err ? { error: err } : {};
  }
}

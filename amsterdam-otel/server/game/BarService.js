import {
  EVT, GUEST_SPEED, BAR_RULES as R, DRINKS, DRINK_BY_ID, FOOD_BY_ID, INGREDIENT_BY_ID, BAR_CUSTOMER_NAMES,
} from '../../shared/constants.js';
import { BAR, POINTS, pointInBounds } from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';

// Bar müşterisinin fazları (istemci GUEST_UPSERT'teki kind: 'bar' ile ayırt eder)
const PH = Object.freeze({ IN: 'barIn', SEAT: 'barSeat', OUT: 'barOut' });
// Tabure durumları (BAR_STATE'te aynen gider)
const S = Object.freeze({ EMPTY: 'empty', COMING: 'coming', WAITING: 'waiting', DRINKING: 'drinking' });

const REACH = BAR.range + 1; // istasyon menzili + ağ gecikmesi toleransı
const FIRST_SPAWN_MIN_MS = 4000; // bar açılınca (ya da ilk oyuncu gelince) ilk müşteri daha çabuk gelir
const FIRST_SPAWN_MAX_MS = 10_000;
const RETRY_MS = 5000; // boş + temiz tabure yoksa tekrar deneme aralığı

// Geçerli eylemler — prototipsiz: 'constructor' / '__proto__' gibi anahtarlar undefined döner
const ACTS = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(Object.keys(R.T).map((k) => [k, true]))));

// İstemci girdileri: yalnızca doğru tipteki değer kabul edilir. Number()/String() ile ÇEVRİLMEZ
// ({ toString: 1 } gibi bir nesne çevrilirken TypeError fırlatır).
const str = (v) => (typeof v === 'string' ? v : '');
const int = (v) => (Number.isInteger(v) ? v : -1);
const near = (p, [x, z], range) => Math.hypot(p.x - x, p.z - z) <= range;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

const emptyStool = () => ({
  state: S.EMPTY, customer: null, name: null, order: null, waitUntil: 0, drinkEndsAt: 0, glass: null, drink: null,
});

/** Müşteri kalkınca tabureyi boşalt — tezgâhtaki bardak (glass/drink) yerinde kalır */
function resetStool(s) {
  Object.assign(s, { state: S.EMPTY, customer: null, name: null, order: null, waitUntil: 0, drinkEndsAt: 0 });
}

/** Bardaktaki malzemelerin ortalama rengi (uzak oyuncunun elindeki bardak için) */
function mixColor(pours) {
  if (!pours.length) return null;
  let r = 0; let g = 0; let b = 0;
  for (const id of pours) {
    const c = parseInt(INGREDIENT_BY_ID[id].color.slice(1), 16);
    r += c >> 16; g += (c >> 8) & 255; b += c & 255;
  }
  const n = pours.length;
  return '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
}

/** Tarif doğru mu? Malzeme sırası serbest; çalkalama tarifle birebir eşleşmeli. Yanlışsa müşterinin tepkisi. */
function recipeError(hold, drink) {
  const a = [...hold.pours].sort().join(',');
  const b = [...drink.ingredients].sort().join(',');
  if (a !== b) return 'Bu benim siparişim değil!';
  if (hold.shaken !== drink.shake) return drink.shake ? 'Bunun çalkalanması gerekiyordu!' : 'Bunu çalkalamamalıydın!';
  return null;
}

/**
 * Bar De Tulp (alkolsüz bar) — sunucu yetkili.
 *  - Müşteri NPC'leri: bar açıkken boş ve temiz bir tabure varsa gelir, oturur, sipariş verir;
 *    sabrı biterse ya da içeceğini bitirince kalkıp gider (tezgâhta kirli bardak kalır).
 *    GuestManager'dan ayrı tutulur ama aynı kimlik sayacını ve aynı ağ biçimini kullanır.
 *  - Barmen adımları (take/pour/shake/serve/collect/wash/buy/bite) konum, el ve zaman
 *    açısından burada doğrulanır; istemci animasyonu aynı süreyle iyimser oynatır.
 *  - Bardak muhasebesi: raf + eldeki (glass/dirty) + tezgâhtaki (full/dirty) her zaman R.GLASSES.
 */
export class BarService {
  constructor(sim) {
    this.sim = sim;
    this.rack = R.GLASSES;
    this.stools = BAR.stools.map(emptyStool);
    this.customers = new Map();
    this.nextSpawnAt = null; // gerçek ms; bar kapalıyken null
    this.lastOpen = this.open;
  }

  get rng() { return this.sim.rng; }

  /** Bar açık mı (oyun saatine göre; hafta sonu da açık) */
  get open() {
    const m = this.sim.clock.minute;
    return m >= R.OPEN_MIN && m < R.CLOSE_MIN;
  }

  // ---- Oyuncu durumu ---------------------------------------------------------

  initPlayer(p) {
    p.bar = { hold: null, busyUntil: 0, act: null, nextBiteAt: 0 };
  }

  /** Oyuncu ayrılırken elindeki bardaklar rafa döner (toplam korunur); yiyecek kaybolur */
  removePlayer(p) {
    const h = p.bar?.hold;
    if (!h) return;
    p.bar.hold = null;
    if (h.kind === 'glass') this.rack += 1;
    else if (h.kind === 'dirty') this.rack += h.count;
    else return;
    this.barChanged();
  }

  /** Kişisel durum (SELF / WELCOME.self içinde `bar`) */
  privateState(p) {
    return { hold: this.holdState(p), busyUntil: p.bar.busyUntil };
  }

  holdState(p) {
    const h = p.bar.hold;
    if (!h) return null;
    if (h.kind === 'glass') return { kind: 'glass', pours: [...h.pours], shaken: h.shaken };
    return { ...h };
  }

  /** Diğer oyuncuların gördüğü hâli: elde ne var, hangi renk, hangi animasyon ne zamana kadar */
  publicState(p, now = this.sim.now()) {
    const b = p.bar;
    const h = b.hold;
    return {
      hold: !h ? null : h.kind === 'food' ? h.food : h.kind,
      color: h?.kind === 'glass' ? mixColor(h.pours) : null,
      act: now < b.busyUntil ? b.act : null,
      until: b.busyUntil,
    };
  }

  // ---- Paylaşılan durum ve yayınlar --------------------------------------------

  serialize() {
    return {
      open: this.open,
      rack: this.rack,
      stools: this.stools.map((s) => ({
        state: s.state,
        customer: s.customer,
        name: s.name,
        order: s.order,
        waitUntil: s.state === S.WAITING ? s.waitUntil : 0,
        patienceMs: R.PATIENCE_MS,
        glass: s.glass,
        drink: s.drink,
      })),
    };
  }

  serializeCustomers() {
    return [...this.customers.values()].map((c) => this.toWire(c));
  }

  barChanged() {
    this.sim.out(EVT.BAR_STATE, this.serialize());
  }

  /** Raf + eldeki + tezgâhtaki bardaklar (testler ve tutarlılık denetimi için) */
  glassTotal() {
    let n = this.rack;
    for (const s of this.stools) if (s.glass) n++;
    for (const p of this.sim.players.values()) {
      const h = p.bar?.hold;
      if (h?.kind === 'glass') n++;
      else if (h?.kind === 'dirty') n += h.count;
    }
    return n;
  }

  /** Simülasyon duraklatılıp devam ettirildiğinde gerçek zaman damgalarını kaydır */
  shiftTime(deltaMs) {
    for (const c of this.customers.values()) {
      c.t0 += deltaMs;
      c.phaseEndsAt += deltaMs;
    }
    for (const s of this.stools) {
      if (s.waitUntil) s.waitUntil += deltaMs;
      if (s.drinkEndsAt) s.drinkEndsAt += deltaMs;
    }
    if (this.nextSpawnAt !== null) this.nextSpawnAt += deltaMs;
  }

  // ---- Müşteriler ----------------------------------------------------------------

  toWire(c) {
    return {
      id: c.id, look: c.look, phase: c.phase, path: c.path, t0: c.t0,
      speed: GUEST_SPEED, face: c.face, sit: c.sit, roomId: null, kind: 'bar', sitY: c.sit ? R.SIT_Y : 0,
    };
  }

  update(now) {
    let changed = false;
    const open = this.open;
    if (open !== this.lastOpen) {
      this.lastOpen = open;
      changed = true;
      if (open) this.sim.notify('Bar De Tulp açıldı — müşteriler gelmeye başlıyor. 🍹', 'info');
    }

    if (open) {
      if (this.nextSpawnAt === null) {
        this.nextSpawnAt = now + FIRST_SPAWN_MIN_MS + this.rng() * (FIRST_SPAWN_MAX_MS - FIRST_SPAWN_MIN_MS);
      }
      if (now >= this.nextSpawnAt) {
        if (this.spawn(now)) {
          changed = true;
          this.nextSpawnAt = now + R.SPAWN_MIN_MS + this.rng() * (R.SPAWN_MAX_MS - R.SPAWN_MIN_MS);
        } else {
          this.nextSpawnAt = now + RETRY_MS;
        }
      }
    } else {
      this.nextSpawnAt = null;
    }

    for (const c of this.customers.values()) {
      if (this.updateCustomer(c, now, open)) changed = true;
    }
    if (changed) this.barChanged();
  }

  /** @returns {boolean} BAR_STATE değişti mi */
  updateCustomer(c, now, open) {
    if (c.phase === PH.OUT) {
      if (now >= c.phaseEndsAt) this.remove(c);
      return false;
    }
    if (c.phase === PH.IN) {
      if (now < c.phaseEndsAt) return false;
      if (open) this.seat(c, now);
      else this.leave(c, now); // yolda bar kapandı
      return true;
    }
    const s = this.stools[c.stool];
    // Sabrı tükendi (ya da bar kapandı): servis edilmeden kalkar → istemci 'waiting' → 'empty' geçişinden anlar
    if (s.state === S.WAITING && (now >= s.waitUntil || !open)) {
      this.leave(c, now);
      return true;
    }
    if (s.state === S.DRINKING && now >= s.drinkEndsAt) {
      s.glass = 'dirty';
      s.drink = null;
      this.leave(c, now);
      return true;
    }
    return false;
  }

  /** Yalnızca boş VE temiz (önünde bardak olmayan) taburelere müşteri oturur */
  freeStools() {
    const out = [];
    this.stools.forEach((s, i) => { if (s.state === S.EMPTY && s.glass === null) out.push(i); });
    return out;
  }

  pickName() {
    const used = new Set([...this.customers.values()].map((c) => c.name));
    const free = BAR_CUSTOMER_NAMES.filter((n) => !used.has(n));
    const list = free.length ? free : BAR_CUSTOMER_NAMES;
    return list[Math.floor(this.rng() * list.length)];
  }

  street() {
    return this.rng() < 0.5 ? POINTS.streetWest : POINTS.streetEast;
  }

  spawn(now) {
    const free = this.freeStools();
    if (!free.length) return false;
    const i = free[Math.floor(this.rng() * free.length)];
    const st = BAR.stools[i];
    const c = {
      id: this.sim.guests.nextId++, // otel misafirleriyle ortak sayaç → kimlikler çakışmaz
      look: this.sim.guests.randomLook(),
      name: this.pickName(),
      phase: null,
      path: null,
      t0: now,
      phaseEndsAt: 0,
      face: 0,
      sit: false,
      stool: i,
    };
    this.customers.set(c.id, c);
    Object.assign(this.stools[i], { state: S.COMING, customer: c.id, name: c.name });
    this.walk(c, PH.IN, [
      this.street(), POINTS.doorOutside, POINTS.doorInside,
      BAR.points.lobby, BAR.points.doorWest, BAR.points.doorEast, st.approach, st.seat,
    ], now);
    return true;
  }

  /** Taburesine vardı: oturur (tezgâha, +Z'ye bakar) ve siparişini verir */
  seat(c, now) {
    const drink = DRINKS[Math.floor(this.rng() * DRINKS.length)];
    Object.assign(this.stools[c.stool], { state: S.WAITING, order: drink.id, waitUntil: now + R.PATIENCE_MS });
    c.phase = PH.SEAT;
    c.path = [[...BAR.stools[c.stool].seat]];
    c.t0 = now;
    c.face = 0;
    c.sit = true;
    c.phaseEndsAt = now;
    this.broadcast(c);
  }

  leave(c, now) {
    const st = BAR.stools[c.stool];
    resetStool(this.stools[c.stool]);
    c.stool = -1;
    this.walk(c, PH.OUT, [
      st.seat, st.approach, BAR.points.doorEast, BAR.points.doorWest, BAR.points.lobby,
      POINTS.doorInside, POINTS.doorOutside, this.street(),
    ], now);
  }

  walk(c, phase, path, now) {
    c.phase = phase;
    c.path = path.map((pt) => [pt[0], pt[1]]);
    c.t0 = now;
    c.sit = false;
    c.phaseEndsAt = now + (pathLength(c.path) / GUEST_SPEED) * 1000;
    this.broadcast(c);
  }

  broadcast(c) {
    this.sim.out(EVT.GUEST_UPSERT, this.toWire(c));
  }

  remove(c) {
    this.customers.delete(c.id);
    this.sim.out(EVT.GUEST_REMOVE, c.id);
  }

  // ---- Barmen adımları --------------------------------------------------------------

  /** Oyuncu barın içinde mi (son bildirdiği konum; ağ gecikmesi için 0.3 m tolerans) */
  inside(p) {
    return pointInBounds(p.x, p.z, BAR.bounds, 0.3);
  }

  /**
   * İstemciden gelen tek bir barmen adımı.
   * @returns {{ ok: true, hold, busyUntil, tip?, bitesLeft? } | { ok: false, error: string }}
   */
  act(p, data, now) {
    const act = str(data?.act);
    if (!ACTS[act]) return { ok: false, error: 'Bilinmeyen işlem.' };
    if (act !== 'bite' && !this.inside(p)) return { ok: false, error: 'Bunun için barda olmalısın.' };
    if (now < p.bar.busyUntil - R.NET_SLACK_MS) return { ok: false, error: 'Önce elindeki işi bitir.' };

    const res = this[act](p, data, now);
    if (res.error) return { ok: false, error: res.error };

    p.bar.busyUntil = now + R.T[act];
    p.bar.act = act;
    this.sim.out(EVT.PLAYER_BAR, { id: p.id, ...this.publicState(p, now) });
    this.sim.shop.sendSelf(p);
    return { ok: true, hold: this.holdState(p), busyUntil: p.bar.busyUntil, ...res };
  }

  /** Eli dolu oyuncuya ne yapması gerektiğini söyle */
  handsFull(h) {
    if (h.kind === 'dirty') return 'Önce kirli bardakları lavaboda yıka.';
    if (h.kind === 'glass') return 'Elinde zaten bir bardak var.';
    return 'Ellerin dolu.';
  }

  take(p) {
    if (p.bar.hold) return { error: this.handsFull(p.bar.hold) };
    if (!near(p, BAR.glassRack, REACH)) return { error: 'Bardak rafına yaklaş.' };
    if (this.rack <= 0) return { error: 'Temiz bardak kalmadı — kirli bardakları toplayıp lavaboda yıka.' };
    this.rack -= 1;
    p.bar.hold = { kind: 'glass', pours: [], shaken: false };
    this.barChanged();
    return {};
  }

  pour(p, data) {
    const h = p.bar.hold;
    if (h?.kind !== 'glass') return { error: 'Önce raftan temiz bir bardak al.' };
    const ing = INGREDIENT_BY_ID[str(data?.ing)];
    if (!ing) return { error: 'Böyle bir malzeme yok.' };
    if (h.pours.includes(ing.id)) return { error: `${ing.icon} ${ing.name} zaten koydun.` };
    if (h.pours.length >= R.MAX_POURS) return { error: `Bir bardağa en fazla ${R.MAX_POURS} malzeme koyabilirsin.` };
    if (!near(p, BAR.dispensers[ing.id], REACH)) return { error: 'Malzeme dispenserlerine yaklaş.' };
    h.pours.push(ing.id);
    return {};
  }

  shake(p) {
    const h = p.bar.hold;
    if (h?.kind !== 'glass') return { error: 'Önce raftan temiz bir bardak al.' };
    if (!h.pours.length) return { error: 'Önce bardağa malzeme koy.' };
    if (h.shaken) return { error: 'Bunu zaten çalkaladın.' };
    if (!near(p, BAR.shaker, REACH)) return { error: 'Çalkalayıcıya yaklaş.' };
    h.shaken = true;
    return {};
  }

  serve(p, data, now) {
    const i = int(data?.stool);
    if (i < 0 || i >= this.stools.length) return { error: 'Geçersiz tabure.' };
    const h = p.bar.hold;
    if (h?.kind !== 'glass' || !h.pours.length) return { error: 'Servis için önce bir içecek hazırla.' };
    if (!near(p, BAR.stools[i].spot, REACH)) return { error: 'Müşterinin önüne yaklaş.' };
    const s = this.stools[i];
    if (s.state !== S.WAITING) return { error: 'Bu taburede sipariş bekleyen yok.' };
    const drink = DRINK_BY_ID[s.order];
    const wrong = recipeError(h, drink);
    if (wrong) return { error: `${s.name}: "${wrong}"` };

    // Hızlı servis → daha çok bahşiş (kalan sabır oranıyla doğrusal)
    const tip = Math.round(R.TIP_MIN + (R.TIP_MAX - R.TIP_MIN) * clamp01((s.waitUntil - now) / R.PATIENCE_MS));
    p.bar.hold = null;
    Object.assign(s, { state: S.DRINKING, waitUntil: 0, drinkEndsAt: now + R.DRINK_MS, glass: 'full', drink: drink.id });
    this.sim.today.served += 1;
    this.sim.earn(drink.price, `Bar: ${drink.name}`, { guest: false });
    p.wallet += tip;
    this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `${drink.icon} ${drink.name} servis edildi · +€${tip} bahşiş`, kind: 'money' });
    this.barChanged();
    return { tip };
  }

  collect(p, data) {
    const i = int(data?.stool);
    if (i < 0 || i >= this.stools.length) return { error: 'Geçersiz tabure.' };
    const s = this.stools[i];
    if (s.glass !== 'dirty') return { error: 'Burada toplanacak kirli bardak yok.' };
    if (!near(p, BAR.stools[i].spot, REACH)) return { error: 'Bardağa yaklaş.' };
    const h = p.bar.hold;
    if (h && h.kind !== 'dirty') return { error: 'Ellerin dolu.' };
    if (h && h.count >= R.MAX_DIRTY_HELD) {
      return { error: `Aynı anda en fazla ${R.MAX_DIRTY_HELD} kirli bardak taşıyabilirsin — önce lavaboda yıka.` };
    }
    s.glass = null;
    p.bar.hold = { kind: 'dirty', count: (h?.count ?? 0) + 1 };
    this.barChanged();
    return {};
  }

  wash(p) {
    const h = p.bar.hold;
    if (h?.kind !== 'dirty' && h?.kind !== 'glass') return { error: 'Yıkanacak bardağın yok.' };
    if (!near(p, BAR.sink, REACH)) return { error: 'Lavaboya yaklaş.' };
    // Kirli bardaklar ya da istenmeyen/yanlış hazırlanmış içecek: boşalt, yıka, rafa koy
    this.rack += h.kind === 'dirty' ? h.count : 1;
    p.bar.hold = null;
    this.barChanged();
    return {};
  }

  buy(p, data) {
    const food = FOOD_BY_ID[str(data?.food)];
    if (!food) return { error: 'Böyle bir yiyecek yok.' };
    if (p.bar.hold) return { error: 'Ellerin dolu.' };
    if (!near(p, BAR.food[food.id], REACH)) return { error: 'Vitrine yaklaş.' };
    if (!(p.wallet >= food.price)) return { error: `${food.name} için €${food.price} gerekli.` };
    p.wallet -= food.price;
    this.sim.earn(food.price, `Bar: ${food.name}`, { guest: false });
    p.bar.hold = { kind: 'food', food: food.id, bitesLeft: food.bites };
    return {};
  }

  /** Her ısırık T.bite sürer; bar dışında da yenebilir */
  bite(p, _data, now) {
    const h = p.bar.hold;
    if (h?.kind !== 'food') return { error: 'Elinde yiyecek yok.' };
    if (now < p.bar.nextBiteAt - R.NET_SLACK_MS) return { error: 'Önce ağzındakini bitir.' };
    h.bitesLeft -= 1;
    p.bar.nextBiteAt = now + R.T.bite;
    if (h.bitesLeft <= 0) p.bar.hold = null;
    return { bitesLeft: Math.max(h.bitesLeft, 0) };
  }
}

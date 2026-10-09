import {
  EVT, PRODUCT_BY_ID, START_WALLET, TIP_MIN, TIP_MAX, TRIP, SLOT,
} from '../../shared/constants.js';
import { COFFEESHOP, isInsideShop } from '../../shared/layout.js';

const near = (p, [x, z], range) => Math.hypot(p.x - x, p.z - z) <= range;

/**
 * Coffee shop ekonomisi ve trip durumu (sunucu yetkili).
 *  - Her oyuncunun kişisel cüzdanı ve envanteri vardır (otel kasasından ayrı).
 *  - Tüketimde %50 iyi / %50 kötü trip zarı SUNUCUDA atılır.
 *  - İyi trip şans bonusları (slot, bahşiş) sunucuda uygulanır.
 * Görsel efektler istemcide ve kişiye özeldir; diğer oyunculara yalnızca
 * trip türü (yavaşlama için) ve kıkırdama/kusma animasyonları iletilir.
 */
export class CoffeeShopService {
  constructor(sim) {
    this.sim = sim;
  }

  get rng() { return this.sim.rng; }

  initPlayer(p) {
    p.wallet = this.sim.config.startWallet ?? START_WALLET;
    p.inventory = {};
    p.trip = null;
    p.lastEmote = 0;
  }

  privateState(p) {
    return { wallet: p.wallet, inventory: { ...p.inventory }, trip: this.publicTrip(p) };
  }

  publicTrip(p) {
    return p.trip ? { type: p.trip.type, endsAt: p.trip.endsAt } : null;
  }

  sendSelf(p) {
    this.sim.toPlayer(p.id, EVT.SELF, this.privateState(p));
  }

  isLucky(p) {
    return p.trip?.type === TRIP.GOOD;
  }

  /** Tezgâhtan ürün satın al */
  buy(p, productId) {
    const product = PRODUCT_BY_ID[productId];
    if (!product) return { ok: false, error: 'Böyle bir ürün yok.' };
    if (!isInsideShop(p.x, p.z) || !near(p, COFFEESHOP.counterPoint, COFFEESHOP.range + 1)) {
      return { ok: false, error: 'Satın almak için tezgâha yaklaş.' };
    }
    if (p.wallet < product.price) return { ok: false, error: 'Cüzdanında yeterli para yok.' };
    p.wallet -= product.price;
    p.inventory[product.id] = (p.inventory[product.id] || 0) + 1;
    this.sendSelf(p);
    return { ok: true, product: product.id };
  }

  /** Envanterdeki ürünü tüket → 2 dakikalık iyi ya da kötü trip */
  consume(p, productId, now) {
    const product = PRODUCT_BY_ID[productId];
    if (!product || !(p.inventory[productId] > 0)) return { ok: false, error: 'Envanterinde bu ürün yok.' };
    if (p.trip) return { ok: false, error: 'Zaten etkisi altındasın, biraz bekle.' };
    p.inventory[productId] -= 1;
    if (p.inventory[productId] <= 0) delete p.inventory[productId];
    const type = this.rng() < TRIP.GOOD_CHANCE ? TRIP.GOOD : TRIP.BAD;
    p.trip = { type, endsAt: now + TRIP.DURATION_MS, product: productId };
    this.sim.out(EVT.PLAYER_TRIP, { id: p.id, ...this.publicTrip(p) });
    this.sendSelf(p);
    return { ok: true, type };
  }

  /** Slot makinesi: iyi trip'te kazanma ihtimali +%25 */
  spin(p) {
    if (!isInsideShop(p.x, p.z) || !near(p, COFFEESHOP.slot.point, COFFEESHOP.range + 1)) {
      return { ok: false, error: 'Slot makinesine yaklaş.' };
    }
    if (p.wallet < SLOT.BET) return { ok: false, error: `Çevirmek için en az €${SLOT.BET} gerekli.` };
    const lucky = this.isLucky(p);
    const chance = SLOT.BASE_WIN * (lucky ? TRIP.SLOT_LUCK : 1);
    p.wallet -= SLOT.BET;

    let reels;
    let payout = 0;
    if (this.rng() < chance) {
      const tier = this.pickTier();
      const sym = tier.symbols[Math.floor(this.rng() * tier.symbols.length)];
      reels = [sym, sym, sym];
      payout = SLOT.BET * tier.mult;
      p.wallet += payout;
    } else {
      do {
        reels = [0, 1, 2].map(() => Math.floor(this.rng() * SLOT.SYMBOLS.length));
      } while (reels[0] === reels[1] && reels[1] === reels[2]);
    }
    this.sendSelf(p);
    return { ok: true, reels, payout, lucky, wallet: p.wallet };
  }

  pickTier() {
    const total = SLOT.TIERS.reduce((s, t) => s + t.weight, 0);
    let r = this.rng() * total;
    for (const t of SLOT.TIERS) {
      r -= t.weight;
      if (r < 0) return t;
    }
    return SLOT.TIERS[0];
  }

  /** Odayı temizleyen oyuncu misafirin bıraktığı bahşişi bulur (iyi trip: +%20) */
  tip(p) {
    const base = TIP_MIN + Math.floor(this.rng() * (TIP_MAX - TIP_MIN + 1));
    const lucky = this.isLucky(p);
    const amount = Math.round(base * (lucky ? TRIP.TIP_LUCK : 1));
    p.wallet += amount;
    this.sendSelf(p);
    return { amount, lucky };
  }

  /** Kıkırdama (iyi trip) / kusma (kötü trip) animasyonunu diğer oyunculara ilet */
  emote(p, type, now) {
    const allowed = (type === 'giggle' && p.trip?.type === TRIP.GOOD)
      || (type === 'vomit' && p.trip?.type === TRIP.BAD);
    if (!allowed || now - p.lastEmote < TRIP.EMOTE_COOLDOWN_MS) return false;
    p.lastEmote = now;
    this.sim.out(EVT.PLAYER_EMOTE, { id: p.id, type });
    return true;
  }

  /** Süresi dolan trip'leri bitir */
  update(now) {
    for (const p of this.sim.players.values()) {
      if (p.trip && now >= p.trip.endsAt) {
        p.trip = null;
        this.sim.out(EVT.PLAYER_TRIP, { id: p.id, type: null, endsAt: 0 });
        this.sendSelf(p);
      }
    }
  }
}

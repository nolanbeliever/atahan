// Telegram dealing (shared/telegram.ts): the supplier's car with the package, your channel's
// customers, the cockpit handovers (one customer in seven is an undercover cop) and dead drops.
// The goods are kept in the player's inventory (`deal_goods`, grams); buying costs clean money,
// selling pays dirty money (shared/underworld.ts).

import { DEAD_DROPS, DEALS, DEAL_COLORS, DEAL_MODELS, DEAL_SPOTS, STICKERS, dropPrice, findDrop, type DealCar, type DealOrder, type DealScene, type TgMessage, type TgState } from '../../../shared/telegram';
import { formatMoney } from '../../../shared/util';
import { SECURITY } from '../../../shared/security';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import type { CombatService } from './combat';
import type { CrimeService } from './crime';
import type { PoliceService } from './police';

const log = createLogger('telegram');
const D = DEALS;
export const GOODS_ITEM = 'deal_goods';

const HANDLES = ['gececi34', 'kuzeyli_ali', 'mavi_kedi', 'baron07', 'sessiz_k', 'yorgun_dj', 'turbo_selin', 'emo_burak', 'karaca', 'silver_fox', 'zeyno.x', 'ozi_06'];

interface Car extends DealCar {
  cop: boolean;
  orderId?: string;
}

interface Phone {
  messages: TgMessage[];
  seq: number;
  unread: number;
  orders: DealOrder[];
  pickup: { carId: string; until: number } | null;
  nextOrderAt: number;
  /** A handover going on (no second one meanwhile). */
  inScene: boolean;
  /** Dead drops waiting to be collected: order id -> when the customer pays. */
  payAt: Map<string, number>;
}

let seq = 1;

export class DealService {
  private phones = new Map<string, Phone>();
  private cars = new Map<string, Car>();

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
    combat: CombatService,
    private readonly crime: CrimeService,
  ) {
    // Arrested: the police take the goods you carry. Wasted: they're gone.
    police.bustListeners.push((pid, vehicleId) => void this.search(pid, vehicleId));
    combat.wastedListeners.push((pid) => void this.takeGoods(pid, 'Yere düşünce paket kayboldu.'));
  }

  // ---------------------------------------------------------------- state

  private phone(playerId: string): Phone {
    let p = this.phones.get(playerId);
    if (!p) {
      p = { messages: [], seq: 1, unread: 0, orders: [], pickup: null, nextOrderAt: Date.now() + 20_000, inScene: false, payAt: new Map() };
      this.phones.set(playerId, p);
      this.say(playerId, p, { chat: 'supplier', from: 'them', text: 'Selam. Mal lazımsa yaz: 10 gr $500. Konum atarım, arabaya binersin, iş biter.' }, false);
      this.say(playerId, p, { chat: 'channel', from: 'system', text: 'Kanalın açıldı. Müşteriler sipariş bırakınca burada görünür: elden teslim (arabalarına bin) ya da ölü nokta (paketi gizli bir yere bırak).' }, false);
    }
    return p;
  }

  goods(playerId: string): number {
    return this.ctx.state.players.get(playerId)?.inventory[GOODS_ITEM] ?? 0;
  }

  state(playerId: string): TgState {
    const p = this.phone(playerId);
    return { goods: this.goods(playerId), messages: p.messages, orders: p.orders, pickup: p.pickup, unread: p.unread };
  }

  /** Opened the phone: everything read. */
  read(playerId: string): TgState {
    const p = this.phone(playerId);
    p.unread = 0;
    return this.state(playerId);
  }

  private say(playerId: string, p: Phone, m: Omit<TgMessage, 'id' | 'at'>, notify = true): void {
    p.messages.push({ ...m, id: p.seq++, at: Date.now() });
    if (p.messages.length > 60) p.messages.splice(0, p.messages.length - 60);
    if (m.from !== 'me') p.unread++;
    if (notify) this.send(playerId);
  }

  send(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'tg.update', this.state(playerId));
  }

  /** All deal cars (everyone sees them parked). */
  carList(): DealCar[] {
    return [...this.cars.values()].map(({ cop: _c, orderId: _o, ...c }) => c);
  }

  private publishCars(): void {
    this.ctx.hub.broadcast('deal.cars', this.carList());
    this.ctx.sim.setExtraObstacles(
      'deals',
      [...this.cars.values()].map((c) => ({ id: `dl:${c.id}`, modelId: c.modelId, x: c.x, z: c.z, rot: c.rot })),
    );
    this.ctx.sim.rebuildDynamic();
  }

  /** A free kerb spot some way from the player. */
  private spotFor(playerId: string): (typeof DEAL_SPOTS)[number] {
    const c = this.ctx.sim.chars.get(playerId);
    const taken = [...this.cars.values()];
    const free = DEAL_SPOTS.filter((s) => !taken.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < 8));
    const far = free.filter((s) => !c || Math.hypot(s.x - c.x, s.z - c.z) >= D.minSpotDist);
    const pool = far.length > 0 ? far : free.length > 0 ? free : DEAL_SPOTS;
    // Prefer the same side of the water.
    const side = pool.filter((s) => !c || (s.x > 548) === (c.x > 548));
    const list = side.length > 0 ? side : pool;
    return list[Math.floor(this.ctx.rng() * list.length)]!;
  }

  private newCar(playerId: string, kind: Car['kind'], cop: boolean): Car {
    const spot = this.spotFor(playerId);
    const rng = this.ctx.rng;
    const color = DEAL_COLORS[Math.floor(rng() * DEAL_COLORS.length)]!;
    const car: Car = {
      id: `dc_${seq++}`,
      forId: playerId,
      kind,
      modelId: DEAL_MODELS[Math.floor(rng() * DEAL_MODELS.length)]!,
      color: color.hex,
      colorName: color.name,
      sticker: STICKERS[Math.floor(rng() * STICKERS.length)]!,
      x: spot.x,
      z: spot.z,
      rot: spot.rot,
      cop,
    };
    this.cars.set(car.id, car);
    this.publishCars();
    return car;
  }

  private removeCar(id: string | undefined): void {
    if (!id || !this.cars.delete(id)) return;
    this.publishCars();
  }

  // ---------------------------------------------------------------- the supplier

  /** Order a package: the supplier sends the car's location and a picture of it. */
  order(playerId: string): TgState {
    const p = this.phone(playerId);
    if (p.pickup) throw new GameError('conflict', 'Önceki paket hâlâ arabada seni bekliyor.');
    const car = this.newCar(playerId, 'supplier', false);
    p.pickup = { carId: car.id, until: Date.now() + D.pickupSec * 1000 };
    this.say(playerId, p, { chat: 'supplier', from: 'me', text: `${D.grams} gr lazım.` }, false);
    this.say(
      playerId,
      p,
      {
        chat: 'supplier',
        from: 'them',
        text: `Tamam. ${car.colorName} araç, arka camında ${car.sticker} etiketi var. Yolcu koltuğuna bin, ${formatMoney(D.buyPrice)} nakit hazır olsun. ${Math.round(D.pickupSec / 60)} dakika beklerim.`,
        car: { modelId: car.modelId, color: car.color, colorName: car.colorName, sticker: car.sticker, x: car.x, z: car.z },
        pin: { x: car.x, z: car.z, label: 'Tedarikçi' },
      },
      false,
    );
    p.unread = 0;
    this.send(playerId);
    log.info('supplier order', { playerId, car: car.id });
    return this.state(playerId);
  }

  // ---------------------------------------------------------------- your channel

  /** Take an order: by hand (their car comes) or through a dead drop. */
  accept(playerId: string, params: unknown): TgState {
    const q = val.obj(params);
    const orderId = val.id(q.orderId, 'order');
    const mode = val.oneOf(q.mode, 'mode', ['hand', 'drop'] as const);
    const p = this.phone(playerId);
    const o = p.orders.find((x) => x.id === orderId);
    if (!o || o.status !== 'open') throw new GameError('not_found', 'Bu sipariş artık yok.');
    o.until = Date.now() + D.deliverSec * 1000;
    if (mode === 'hand') {
      const cop = this.ctx.rng() < D.copChance;
      const car = this.newCar(playerId, 'customer', cop);
      car.orderId = o.id;
      o.status = 'hand';
      o.carId = car.id;
      this.say(playerId, p, { chat: 'channel', from: 'me', name: o.name, orderId: o.id, text: `@${o.name} elden teslim. Neredesin?` }, false);
      this.say(
        playerId,
        p,
        {
          chat: 'channel',
          from: 'them',
          name: o.name,
          orderId: o.id,
          text: `${car.colorName} arabadayım, camda ${car.sticker} var. Gel bin, parası hazır: ${formatMoney(o.price)}.`,
          car: { modelId: car.modelId, color: car.color, colorName: car.colorName, sticker: car.sticker, x: car.x, z: car.z },
          pin: { x: car.x, z: car.z, label: `@${o.name}` },
        },
        false,
      );
    } else {
      const c = this.ctx.sim.chars.get(playerId);
      const drops = [...DEAD_DROPS].sort((a, b) => (c ? Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z) : 0));
      // One of the closer ones, not always the closest.
      const drop = drops[Math.floor(this.ctx.rng() * Math.min(3, drops.length))]!;
      o.status = 'drop';
      o.dropId = drop.id;
      this.say(playerId, p, { chat: 'channel', from: 'me', name: o.name, orderId: o.id, text: `@${o.name} ölü nokta: ${drop.name}. Paketi bırakınca haber veririm.`, pin: { x: drop.x, z: drop.z, label: 'Ölü nokta' } }, false);
    }
    p.unread = 0;
    this.send(playerId);
    return this.state(playerId);
  }

  /** Turn an order down. */
  decline(playerId: string, params: unknown): TgState {
    const orderId = val.id(val.obj(params).orderId, 'order');
    const p = this.phone(playerId);
    const o = p.orders.find((x) => x.id === orderId);
    if (o && o.status !== 'dropped') this.dropOrder(p, o);
    this.send(playerId);
    return this.state(playerId);
  }

  private dropOrder(p: Phone, o: DealOrder): void {
    p.orders = p.orders.filter((x) => x !== o);
    p.payAt.delete(o.id);
    this.removeCar(o.carId);
  }

  /** Leave the package at the order's dead drop. */
  async drop(playerId: string, params: unknown): Promise<TgState> {
    const orderId = val.id(val.obj(params).orderId, 'order');
    return this.ctx.locks.run([K.player(playerId)], async () => {
      const p = this.phone(playerId);
      const o = p.orders.find((x) => x.id === orderId);
      const spot = o?.dropId ? findDrop(o.dropId) : undefined;
      if (!o || o.status !== 'drop' || !spot) throw new GameError('not_found', 'Bu sipariş için ölü nokta yok.');
      const c = this.ctx.sim.chars.get(playerId);
      if (!c || c.drivingId || c.ridingId || Math.hypot(c.x - spot.x, c.z - spot.z) > D.dropRadius) throw new GameError('too_far', 'Ölü noktaya yürü (araçtan in).');
      if (this.goods(playerId) < o.grams) throw new GameError('conflict', `Üzerinde ${o.grams} gr yok.`);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      player.inventory[GOODS_ITEM] = (player.inventory[GOODS_ITEM] ?? 0) - o.grams;
      if (player.inventory[GOODS_ITEM]! <= 0) delete player.inventory[GOODS_ITEM];
      await uow.commit();
      o.status = 'dropped';
      const [lo, hi] = D.pickupDelay;
      p.payAt.set(o.id, Date.now() + (lo + this.ctx.rng() * (hi - lo)) * 1000);
      this.ctx.sim.markInteract(playerId);
      this.say(playerId, p, { chat: 'channel', from: 'me', name: o.name, orderId: o.id, text: `@${o.name} paket bırakıldı 📦` });
      return this.state(playerId);
    });
  }

  // ---------------------------------------------------------------- the handover in the car

  /** Get into a deal car: the cockpit handover (the client plays it; the outcome lands after it). */
  enter(playerId: string, params: unknown): DealScene {
    const carId = val.id(val.obj(params).carId, 'car');
    const car = this.cars.get(carId);
    if (!car || car.forId !== playerId) throw new GameError('not_found', 'Bu araç seni beklemiyor.');
    const p = this.phone(playerId);
    if (p.inScene) throw new GameError('conflict', 'Zaten bir teslimattasın.');
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead || c.drivingId || c.ridingId) throw new GameError('conflict', 'Önce araçtan in.');
    if (Math.hypot(c.x - car.x, c.z - car.z) > D.enterRadius) throw new GameError('too_far', 'Arabaya yaklaş.');
    const player = this.ctx.state.players.get(playerId)!;
    let grams = D.grams;
    let money = D.buyPrice;
    let order: DealOrder | undefined;
    if (car.kind === 'supplier') {
      if (player.money < D.buyPrice) throw new GameError('insufficient_funds', `${formatMoney(D.buyPrice)} nakit lazım.`);
    } else {
      order = p.orders.find((o) => o.id === car.orderId);
      if (!order) throw new GameError('not_found', 'Sipariş kalmamış.');
      grams = order.grams;
      money = order.price;
      if (this.goods(playerId) < grams) throw new GameError('conflict', `Üzerinde ${grams} gr yok: önce tedarikçiden al.`);
    }
    p.inScene = true;
    const scene: DealScene = { carId, kind: car.kind === 'supplier' ? 'buy' : 'sell', cop: car.cop, modelId: car.modelId, color: car.color, x: car.x, z: car.z, rot: car.rot, grams, money, ms: D.sceneSec * 1000 };
    setTimeout(() => void this.finish(playerId, car, order).finally(() => (p.inScene = false)), scene.ms).unref?.();
    log.info('deal handover', { playerId, kind: scene.kind, cop: scene.cop });
    return scene;
  }

  private async finish(playerId: string, car: Car, order: DealOrder | undefined): Promise<void> {
    const p = this.phone(playerId);
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const player = uow.player(playerId);
        const inv = player.inventory;
        if (car.kind === 'supplier') {
          uow.debit(player, D.buyPrice, 'deal_buy', 'Telegram: tedarikçi');
          inv[GOODS_ITEM] = (inv[GOODS_ITEM] ?? 0) + D.grams;
          await uow.commit();
          p.pickup = null;
          this.say(playerId, p, { chat: 'supplier', from: 'them', text: `Siyah poşette ${D.grams} gr. Kolay gelsin. 🤝` });
          this.ctx.hub.sendTo(playerId, 'deal.done', { kind: 'buy', cop: false, grams: D.grams, money: D.buyPrice });
          return;
        }
        const o = order!;
        inv[GOODS_ITEM] = Math.max(0, (inv[GOODS_ITEM] ?? 0) - o.grams);
        if (inv[GOODS_ITEM] === 0) delete inv[GOODS_ITEM];
        if (car.cop) {
          await uow.commit();
          this.police.raiseHeat(playerId, D.copStars * 100 - 50);
          this.say(playerId, p, { chat: 'channel', from: 'system', name: o.name, text: `⚠️ @${o.name} GİZLİ POLİS çıktı! ${o.grams} gr el konuldu. Kaç!` });
          this.ctx.hub.sendTo(playerId, 'deal.done', { kind: 'sell', cop: true, grams: o.grams, money: 0 });
        } else {
          this.crime.edit(uow, playerId, (s) => (s.dirty += o.price));
          uow.grantXp(player, 25);
          await this.crime.commit(uow);
          this.say(playerId, p, { chat: 'channel', from: 'them', name: o.name, text: `Eline sağlık 👍 ${formatMoney(o.price)} sende.` });
          this.ctx.hub.sendTo(playerId, 'deal.done', { kind: 'sell', cop: false, grams: o.grams, money: o.price });
        }
        p.orders = p.orders.filter((x) => x !== o);
      });
    } catch (err) {
      this.ctx.hub.notify(playerId, { kind: 'error', title: 'Teslimat olmadı', text: (err as Error).message });
      log.warn('deal failed', { playerId, err: String(err) });
    }
    // The car drives off.
    this.removeCar(car.id);
    this.send(playerId);
  }

  // ---------------------------------------------------------------- over time

  /** Once a second: new orders, things running out, dead drops collected. */
  async tick(now = Date.now()): Promise<void> {
    for (const [playerId, p] of this.phones) {
      if (!this.ctx.hub.isOnline(playerId)) continue;
      let changed = false;
      if (p.pickup && now > p.pickup.until && !p.inScene) {
        this.removeCar(p.pickup.carId);
        p.pickup = null;
        this.say(playerId, p, { chat: 'supplier', from: 'them', text: 'Gelmedin, gittim. Bir dahakine.' }, false);
        changed = true;
      }
      for (const o of [...p.orders]) {
        if (o.status === 'dropped') continue;
        if (now <= o.until || p.inScene) continue;
        this.dropOrder(p, o);
        this.say(playerId, p, { chat: 'channel', from: 'them', name: o.name, text: o.status === 'open' ? 'Neyse, başkasından alırım.' : 'Bekledim, gelmedin. İptal.' }, false);
        changed = true;
      }
      for (const [orderId, at] of [...p.payAt]) {
        if (now < at) continue;
        p.payAt.delete(orderId);
        const o = p.orders.find((x) => x.id === orderId);
        if (!o) continue;
        const amount = dropPrice(o.price);
        try {
          await this.ctx.locks.run([K.player(playerId)], async () => {
            const uow = this.ctx.state.begin();
            uow.grantXp(uow.player(playerId), 15);
            this.crime.edit(uow, playerId, (s) => (s.dirty += amount));
            await this.crime.commit(uow);
          });
          p.orders = p.orders.filter((x) => x !== o);
          this.say(playerId, p, { chat: 'channel', from: 'them', name: o.name, text: `Paketi aldım 👍 ${formatMoney(amount)} gönderdim.` }, false);
          this.ctx.hub.sendTo(playerId, 'deal.paid', { amount, name: o.name });
          changed = true;
        } catch (err) {
          log.warn('drop payout failed', { playerId, err: String(err) });
        }
      }
      if (now >= p.nextOrderAt) {
        const [lo, hi] = D.orderEvery;
        p.nextOrderAt = now + (lo + this.ctx.rng() * (hi - lo)) * 1000;
        if (p.orders.filter((o) => o.status === 'open').length < D.maxOrders) {
          const rng = this.ctx.rng;
          const grams = rng() < 0.65 ? D.orderGrams[0] : D.orderGrams[1];
          const perGram = D.perGram[0] + rng() * (D.perGram[1] - D.perGram[0]);
          const o: DealOrder = { id: `ord_${seq++}`, name: HANDLES[Math.floor(rng() * HANDLES.length)]!, grams, price: Math.round((grams * perGram) / 10) * 10, status: 'open', until: now + D.orderSec * 1000 };
          p.orders.push(o);
          this.say(playerId, p, { chat: 'channel', from: 'them', name: o.name, orderId: o.id, text: `${grams} gr lazım. Elden ${formatMoney(o.price)}, ölü noktaya ${formatMoney(dropPrice(o.price))}.` }, false);
          this.ctx.hub.notify(playerId, { kind: 'info', title: `📨 Telegram · @${o.name}`, text: `${grams} gr sipariş: ${formatMoney(o.price)}. Telefonu aç (Y).` });
          changed = true;
        }
      }
      if (changed) this.send(playerId);
    }
  }

  /** Arrested: the police search you and the car you were in. The goods on you (or loose in the
   *  car, in the boot) are always found; a hidden compartment only one time in ten. */
  async search(playerId: string, vehicleId: string | null): Promise<void> {
    const v = vehicleId ? this.ctx.state.vehicles.get(vehicleId) : undefined;
    const hidden = v && v.ownerId === playerId ? v.mods.stashGrams ?? 0 : 0;
    if (this.goods(playerId) <= 0 && hidden <= 0) return;
    const found = hidden > 0 && this.ctx.rng() < SECURITY.stashFindChance;
    try {
      await this.ctx.locks.run([K.player(playerId), ...(found && vehicleId ? [K.vehicle(vehicleId)] : [])], async () => {
        const uow = this.ctx.state.begin();
        const player = uow.player(playerId);
        const grams = player.inventory[GOODS_ITEM] ?? 0;
        if (grams > 0) {
          delete player.inventory[GOODS_ITEM];
          uow.notify(playerId, { kind: 'error', title: `${grams} gr mal bulundu`, text: vehicleId ? 'Polis aracı aradı: üzerindeki ve bagajdaki mala el konuldu.' : 'Polis üstünü aradı: mala el konuldu.' });
        }
        if (found && vehicleId) {
          const veh = uow.vehicle(vehicleId);
          veh.mods = { ...veh.mods, stashGrams: 0 };
          uow.notify(playerId, { kind: 'error', title: 'GİZLİ ZULA BULUNDU!', text: `Polis bagaj tabanını söktü: ${hidden} gr mala el konuldu.` });
        } else if (hidden > 0) {
          uow.notify(playerId, { kind: 'success', title: 'Zula bulunamadı', text: `Polis aracı didik didik aradı ama gizli bölmeyi bulamadı: ${hidden} gr güvende.` });
        }
        await uow.commit();
      });
      this.send(playerId);
      log.info('police search', { playerId, vehicleId, hidden, found });
    } catch (err) {
      log.warn('police search failed', { playerId, err: String(err) });
    }
  }

  /** Wasted: the goods on you are gone. */
  private async takeGoods(playerId: string, text: string): Promise<void> {
    if (this.goods(playerId) <= 0) return;
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        const uow = this.ctx.state.begin();
        const player = uow.player(playerId);
        const grams = player.inventory[GOODS_ITEM] ?? 0;
        if (grams <= 0) return;
        delete player.inventory[GOODS_ITEM];
        uow.notify(playerId, { kind: 'error', title: `${grams} gr mal gitti`, text });
        await uow.commit();
      });
      this.send(playerId);
    } catch (err) {
      log.warn('taking goods failed', { playerId, err: String(err) });
    }
  }

  /** Connected: the deal cars parked around. */
  welcome(playerId: string): void {
    this.phone(playerId);
    this.ctx.hub.sendTo(playerId, 'deal.cars', this.carList());
  }

  /** Logged off: their cars go, the phone is forgotten. */
  forget(playerId: string): void {
    const p = this.phones.get(playerId);
    if (!p) return;
    for (const c of [...this.cars.values()]) if (c.forId === playerId) this.cars.delete(c.id);
    this.phones.delete(playerId);
    this.publishCars();
  }

  /** A player's cars (tests). */
  carsOf(playerId: string): readonly Readonly<Car>[] {
    return [...this.cars.values()].filter((c) => c.forId === playerId);
  }
}

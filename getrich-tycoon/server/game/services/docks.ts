// The docks at night (shared/docks.ts): containers to cut open between 23:00 and 05:00, bulk imports
// ordered on the phone, the gantry crane loading a container onto a flatbed truck for the depot, and
// the trap when somebody talked.
//
// Cutting: E at a green-lit container's doors opens the grinder (the client's mini-game); the cut
// has to take a few seconds at least; finished, the doors swing open and the loot is given out: a
// hypercar rolls out (a stolen car), an arms crate (Micro-Uzi, sniper rifle and their ammo, C4,
// body armour) or a load of goods.
//
// Imports: $100,000+ from the phone ("Toplu İthalat"); after the ship is in, a free container is the
// player's and its number and place come on the phone. A hypercar or an arms crate opens on the
// spot. Bulk goods: drive the flatbed up to the container, stop, the crane lifts it on; drive it to
// the depot and unload (the goods go into the inventory).
//
// The trap (25% of cuts and orders): "Bölgeye tüm birimler intikal etsin, hedef kapanda" on the
// radio, 5 s later floodlights and sirens, concrete barricades and SWAT vans shut both gates, 4
// stars and a pursuit at once (the helicopter comes), SWAT officers in cover among the stacks shoot.
// A heavy truck (or anything very fast) knocks a barricade block aside.

import {
  DEPOT,
  DOCK_CONTAINERS,
  HYPERCARS,
  IMPORTS,
  SWAT_COVER,
  containerCarSpot,
  containerDoor,
  docksOpen,
  findContainer,
  findImport,
  gateBarricades,
  isFlatbed,
  type Barricade,
  type ContainerLoot,
  type ContainerView,
  type DockContainer,
  type DocksState,
  type ImportOrderView,
} from '../../../shared/docks';
import { KMH_PER_MS } from '../../../shared/drivetrain';
import { ECONOMY } from '../../../shared/economy.config';
import { newShowroomCar } from '../../../shared/showrooms';
import { Anim, type Vehicle } from '../../../shared/types';
import { angleDiff, formatMoney } from '../../../shared/util';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { ARMOR_ITEM, C4_ITEM, weaponItem } from '../../../shared/weapons';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import type { NpcEntity } from '../simulation';
import type { CombatService } from './combat';
import type { PoliceService, Unit } from './police';
import { GOODS_ITEM } from './telegram';
import type { TheftService } from './theft';

const log = createLogger('docks');
const D = ECONOMY.docks;
const IDS = DOCK_CONTAINERS.map((k) => k.id);
const KINDS = IMPORTS.map((i) => i.id);

interface Box {
  def: DockContainer;
  /** Done: open (doors aside) until then (ms). */
  openUntil: number;
  cut: { playerId: string; startedAt: number; trap: boolean } | null;
  /** An import order waiting in it. */
  order: Order | null;
}

interface Order {
  id: string;
  playerId: string;
  kind: ImportOrderView['kind'];
  status: ImportOrderView['status'];
  containerId: string | null;
  arriveAt: number;
  /** The flatbed carrying it. */
  truckId: string | null;
  trap: boolean;
}

interface Message {
  at: number;
  text: string;
  containerId?: string;
}

interface Swat {
  npc: NpcEntity;
  hp: number;
  fireAt: number;
  deadAt: number;
}

interface Ambush {
  playerId: string;
  /** Sprung at (ms; the radio warned before), and over at. */
  at: number;
  until: number;
  sprung: boolean;
  barricades: Barricade[];
  vans: Unit[];
  swat: Map<string, Swat>;
}

let seq = 1;

export class DocksService {
  private boxes = new Map<string, Box>();
  private orders = new Map<string, Order>();
  private messages = new Map<string, Message[]>();
  private ambush: Ambush | null = null;
  private lastState = '';
  /** The game hour (tests set it; -1: the clock). */
  hour: () => number = () => -1;

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
    private readonly combat: CombatService,
    private readonly theft: TheftService,
  ) {
    for (const def of DOCK_CONTAINERS) this.boxes.set(def.id, { def, openUntil: 0, cut: null, order: null });
    police.unitSources.push(() => (this.ambush?.sprung ? this.ambush.vans : []));
    police.officerSources.push({
      list: () => (this.ambush ? [...this.ambush.swat.values()].filter((s) => !s.deadAt).map((s) => s.npc) : []),
      hit: (id, amount) => {
        const s = this.ambush?.swat.get(id);
        if (!s) return false;
        if (s.deadAt) return true;
        s.hp -= amount;
        if (s.hp <= 0) {
          s.deadAt = Date.now();
          s.npc.anim = Anim.Dead;
        }
        return true;
      },
    });
    police.clearedListeners.push((pid) => {
      if (this.ambush?.playerId === pid && this.ambush.sprung) this.endAmbush('escaped');
    });
    police.bustListeners.push((pid) => {
      if (this.ambush?.playerId === pid) this.endAmbush('busted');
    });
    combat.wastedListeners.push((pid) => {
      if (this.ambush?.playerId === pid) this.endAmbush('wasted');
    });
  }

  private night(now: number): boolean {
    const h = this.hour();
    return h < 0 ? docksOpen(now) : docksOpen(now, h);
  }

  // ---------------------------------------------------------------- views

  views(now = Date.now()): DocksState {
    const containers: ContainerView[] = [...this.boxes.values()].map((b) => ({
      id: b.def.id,
      ready: this.night(now) && b.openUntil <= now && !b.order,
      open: b.openUntil > now,
      cutting: !!b.cut,
      orderFor: b.order?.playerId ?? null,
    }));
    const a = this.ambush;
    return { containers, ambush: a?.sprung ? { until: a.until, barricades: a.barricades.map((x) => x.id), playerId: a.playerId } : null };
  }

  private publish(force = false): void {
    const v = this.views();
    const key = JSON.stringify(v);
    if (!force && key === this.lastState) return;
    this.lastState = key;
    this.ctx.hub.broadcast('docks.state', v);
  }

  orderViews(playerId: string): { orders: ImportOrderView[]; messages: Message[] } {
    const orders = [...this.orders.values()]
      .filter((o) => o.playerId === playerId)
      .map((o) => ({ id: o.id, kind: o.kind, name: findImport(o.kind)!.name, status: o.status, containerId: o.containerId, arriveAt: o.arriveAt }));
    return { orders, messages: this.messages.get(playerId) ?? [] };
  }

  private sendOrders(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'docks.orders', this.orderViews(playerId));
  }

  /** The loads riding on trucks (drawn on their beds). */
  private sendLoads(): void {
    const loads = [...this.orders.values()].filter((o) => o.status === 'loaded' && o.truckId).map((o) => ({ vehicleId: o.truckId!, color: findContainer(o.containerId!)?.color ?? '#888' }));
    this.ctx.hub.broadcast('docks.loads', loads);
  }

  welcome(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'docks.state', this.views());
    this.sendOrders(playerId);
    this.sendLoads();
  }

  forget(playerId: string): void {
    for (const b of this.boxes.values()) if (b.cut?.playerId === playerId) b.cut = null;
    if (this.ambush?.playerId === playerId) this.endAmbush('gone');
  }

  private message(playerId: string, text: string, containerId?: string): void {
    const list = this.messages.get(playerId) ?? [];
    list.push({ at: Date.now(), text, ...(containerId ? { containerId } : {}) });
    while (list.length > 20) list.shift();
    this.messages.set(playerId, list);
    this.sendOrders(playerId);
  }

  // ---------------------------------------------------------------- cutting / opening

  private atDoor(playerId: string, b: Box): void {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead) throw new GameError('conflict', 'Önce ayağa kalk.');
    if (c.drivingId || c.ridingId) throw new GameError('conflict', 'Araçtan in.');
    const d = containerDoor(b.def);
    if (Math.hypot(c.x - d.stand.x, c.z - d.stand.z) > 2.6) throw new GameError('too_far', 'Konteyner kapısına yaklaş.');
  }

  /** E at the doors: the grinder starts (a robbery), or my import's doors open. */
  async start(playerId: string, params: unknown): Promise<{ containerId: string; mode: 'cut' | 'open'; cutSec: number; minSec: number }> {
    const p = val.obj(params);
    const b = this.boxes.get(val.oneOf(p.containerId, 'container', IDS))!;
    const now = Date.now();
    this.atDoor(playerId, b);
    if (b.openUntil > now) throw new GameError('conflict', 'Bu konteyner boşaltılmış.');
    if (b.order) {
      if (b.order.playerId !== playerId) throw new GameError('forbidden', 'Bu konteyner başkasının siparişi.');
      const o = b.order;
      if (o.kind === 'goods') throw new GameError('conflict', 'Toplu mal kamyonla taşınır: kamyonunu (Hauler) konteynerin yanına getir, vinç yüklesin.');
      await this.openBox(playerId, b, o.kind === 'hypercar' ? 'car' : 'arms', true);
      return { containerId: b.def.id, mode: 'open', cutSec: 0, minSec: 0 };
    }
    if (!this.night(now)) throw new GameError('conflict', 'Konteynerler gece 23:00 ile 05:00 arası açılır: gündüz liman çok kalabalık.');
    if (b.cut && b.cut.playerId !== playerId) throw new GameError('conflict', 'Bu kilidi başkası kesiyor.');
    const trap = this.ctx.rng() < D.snitch;
    b.cut = { playerId, startedAt: now, trap };
    if (trap) this.setTrap(playerId);
    this.ctx.sim.markInteract(playerId);
    this.publish(true);
    return { containerId: b.def.id, mode: 'cut', cutSec: D.cutSec, minSec: D.cutMinSec };
  }

  /** The grinder is through: the doors open. */
  async finish(playerId: string, params: unknown): Promise<{ loot: ContainerLoot; text: string }> {
    const p = val.obj(params);
    const b = this.boxes.get(val.oneOf(p.containerId, 'container', IDS))!;
    const now = Date.now();
    if (!b.cut || b.cut.playerId !== playerId) throw new GameError('not_found', 'Burada kesme işi yok.');
    if (now - b.cut.startedAt < D.cutMinSec * 1000) throw new GameError('rate_limited', 'Kilit henüz kesilmedi.');
    if (now - b.cut.startedAt > (D.cutSec + 10) * 1000) {
      b.cut = null;
      this.publish(true);
      throw new GameError('conflict', 'Çok uzun sürdü: disk köreldi.');
    }
    this.atDoor(playerId, b);
    b.cut = null;
    const r = this.ctx.rng();
    const odds = D.lootOdds;
    const loot: ContainerLoot = r < odds.car ? 'car' : r < odds.car + odds.arms ? 'arms' : 'goods';
    const text = await this.openBox(playerId, b, loot, false);
    return { loot, text };
  }

  cancel(playerId: string, params: unknown): { ok: true } {
    const p = val.obj(params);
    const b = this.boxes.get(val.oneOf(p.containerId, 'container', IDS))!;
    if (b.cut?.playerId === playerId) b.cut = null;
    this.publish(true);
    return { ok: true };
  }

  /** The doors swing open: what's inside goes to the player. */
  private async openBox(playerId: string, b: Box, loot: ContainerLoot, ordered: boolean): Promise<string> {
    const now = Date.now();
    b.openUntil = now + D.cooldownSec * 1000;
    const order = b.order;
    b.order = null;
    let text = '';
    if (loot === 'car') {
      const spot = containerCarSpot(b.def);
      const modelId = HYPERCARS[Math.floor(this.ctx.rng() * HYPERCARS.length)]!;
      const base = newShowroomCar(modelId, ['#111111', '#f2f2f2', '#c1121f', '#ffb703'][Math.floor(this.ctx.rng() * 4)]!);
      const vehicle: Vehicle = { ...base, id: newId('veh'), ownerId: playerId, status: ordered ? 'world' : 'stolen', fuel: 80, x: spot.x, z: spot.z, rotation: spot.rot, createdAt: now };
      await this.ctx.locks.run([K.player(playerId), K.vehicle(vehicle.id)], async () => {
        const uow = this.ctx.state.begin();
        uow.createVehicle(vehicle);
        uow.grantXp(uow.player(playerId), D.xp);
        await uow.commit();
      });
      if (!ordered) this.theft.touch(vehicle.id);
      this.ctx.hub.broadcast('vehicle.upsert', this.ctx.state.toPublicVehicle(this.ctx.state.vehicles.get(vehicle.id)!));
      this.ctx.sim.rebuildDynamic();
      text = `${modelDisplayName(modelId)} konteynerden çıktı${ordered ? ': artık senin.' : ' (çalıntı): bin ve kaç!'}`;
    } else {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        const inv = p.inventory;
        if (loot === 'arms') {
          const a = D.arms;
          inv[weaponItem('uzi')] = 1;
          inv[weaponItem('sniper')] = 1;
          inv.ammo_smg = (inv.ammo_smg ?? 0) + a.ammo_smg;
          inv.ammo_sniper = (inv.ammo_sniper ?? 0) + a.ammo_sniper;
          inv[C4_ITEM] = (inv[C4_ITEM] ?? 0) + a.c4;
          inv[ARMOR_ITEM] = (inv[ARMOR_ITEM] ?? 0) + a.body_armor;
        } else inv[GOODS_ITEM] = (inv[GOODS_ITEM] ?? 0) + D.lootGrams;
        uow.grantXp(p, D.xp);
        await uow.commit();
      });
      text =
        loot === 'arms'
          ? `Silah sandığı: Micro-Uzi (7), keskin nişancı tüfeği (8), ${D.arms.c4} C4 (X), ${D.arms.body_armor} çelik yelek (envanterden giy).`
          : `${D.lootGrams} gr mal çantada (Telegram'dan satabilirsin).`;
    }
    if (order) {
      order.status = 'done';
      this.sendOrders(playerId);
    }
    this.ctx.hub.notify(playerId, { kind: 'success', title: '📦 Konteyner açıldı!', text });
    this.ctx.hub.broadcast('docks.opened', { id: b.def.id, loot });
    this.publish(true);
    log.info('container opened', { playerId, id: b.def.id, loot, ordered });
    return text;
  }

  // ---------------------------------------------------------------- imports

  async order(playerId: string, params: unknown): Promise<{ orders: ImportOrderView[]; messages: Message[] }> {
    const p = val.obj(params);
    const def = findImport(val.oneOf(p.kind, 'kind', KINDS))!;
    await this.ctx.locks.run([K.player(playerId)], async () => {
      if ([...this.orders.values()].some((o) => o.playerId === playerId && o.status !== 'done')) throw new GameError('conflict', 'Önce bekleyen siparişini teslim al.');
      const uow = this.ctx.state.begin();
      uow.debit(uow.player(playerId), def.price, 'import', `Toplu İthalat: ${def.name}`);
      await uow.commit();
    });
    const now = Date.now();
    const o: Order = { id: newId('imp'), playerId, kind: def.id, status: 'ship', containerId: null, arriveAt: now + D.shipSec * 1000, truckId: null, trap: this.ctx.rng() < D.snitch };
    this.orders.set(o.id, o);
    this.message(playerId, `Sipariş alındı: ${def.name} (${formatMoney(def.price)}). Gemi yolda, yanaşınca konteyner numarasını yazacağım.`);
    log.info('import ordered', { playerId, kind: def.id });
    return this.orderViews(playerId);
  }

  /** A ship is in: the order gets a free container. */
  private land(o: Order): void {
    const free = [...this.boxes.values()].filter((b) => !b.order && !b.cut && b.openUntil <= Date.now());
    if (free.length === 0) {
      o.arriveAt = Date.now() + 15_000;
      return;
    }
    const b = free[Math.floor(this.ctx.rng() * free.length)]!;
    b.order = o;
    o.containerId = b.def.id;
    o.status = 'ready';
    const d = containerDoor(b.def);
    const how = o.kind === 'goods' ? 'Kamyonunla (Hauler) gel, vinç yüklesin; sonra Sanayi\'deki depoya götür.' : 'Kapıyı aç, mal senin.';
    this.message(o.playerId, `Konteyner limana yanaştı: ${b.def.id} · liman sahası (${Math.round(d.x)}, ${Math.round(d.z)}). ${how}`, b.def.id);
    this.ctx.hub.notify(o.playerId, { kind: 'info', title: `📦 ${b.def.id} limanda`, text: `Toplu İthalat siparişin geldi: haritada işaretli. ${how}` });
    this.publish(true);
  }

  /** E while driving a flatbed next to my goods container: the crane loads it. */
  async crane(playerId: string): Promise<{ orders: ImportOrderView[]; messages: Message[] }> {
    const o = [...this.orders.values()].find((x) => x.playerId === playerId && x.status === 'ready' && x.kind === 'goods');
    if (!o || !o.containerId) throw new GameError('not_found', 'Yüklenecek bir konteynerin yok.');
    const c = this.ctx.sim.chars.get(playerId);
    const d = c?.drivingId ? this.ctx.sim.drives.get(c.drivingId) : undefined;
    const v = c?.drivingId ? this.ctx.state.vehicles.get(c.drivingId) : undefined;
    if (!d || !v || !isFlatbed(v.modelId)) throw new GameError('forbidden', 'Vinç sadece kasalı kamyona (Granforge Hauler) yükler.');
    const b = this.boxes.get(o.containerId)!;
    const cx = (b.def.box.minX + b.def.box.maxX) / 2;
    const cz = (b.def.box.minZ + b.def.box.maxZ) / 2;
    if (Math.hypot(d.dyn.x - cx, d.dyn.z - cz) > 12) throw new GameError('too_far', 'Kamyonu konteynerin yanına getir.');
    if (Math.abs(d.dyn.speed) * KMH_PER_MS > 3) throw new GameError('conflict', 'Kamyonu durdur.');
    if (o.trap) {
      o.trap = false;
      this.setTrap(playerId);
    }
    this.ctx.hub.broadcast('docks.crane', { containerId: b.def.id, vehicleId: v.id, sec: D.craneSec });
    await new Promise((r) => setTimeout(r, D.craneSec * 1000));
    o.status = 'loaded';
    o.truckId = v.id;
    b.order = null;
    b.openUntil = Date.now() + D.cooldownSec * 1000;
    this.message(playerId, `${b.def.id} kamyonunda. Depoya götür: ${DEPOT.name}.`);
    this.sendLoads();
    this.publish(true);
    return this.orderViews(playerId);
  }

  /** E with the loaded truck at the depot: the goods go into the inventory. */
  async unload(playerId: string): Promise<{ orders: ImportOrderView[]; messages: Message[] }> {
    const o = [...this.orders.values()].find((x) => x.playerId === playerId && x.status === 'loaded');
    if (!o) throw new GameError('not_found', 'Kamyonunda yük yok.');
    const c = this.ctx.sim.chars.get(playerId);
    const d = c?.drivingId === o.truckId ? this.ctx.sim.drives.get(o.truckId!) : undefined;
    if (!d) throw new GameError('conflict', 'Yüklü kamyonu sürüyor olmalısın.');
    if (Math.hypot(d.dyn.x - DEPOT.x, d.dyn.z - DEPOT.z) > DEPOT.radius + 4) throw new GameError('too_far', `Depoya git: ${DEPOT.name}.`);
    if (Math.abs(d.dyn.speed) * KMH_PER_MS > 3) throw new GameError('conflict', 'Kamyonu durdur.');
    await this.ctx.locks.run([K.player(playerId)], async () => {
      const uow = this.ctx.state.begin();
      const p = uow.player(playerId);
      p.inventory[GOODS_ITEM] = (p.inventory[GOODS_ITEM] ?? 0) + D.bulkGrams;
      uow.grantXp(p, D.xp);
      await uow.commit();
    });
    o.status = 'done';
    o.truckId = null;
    this.message(playerId, `Teslim alındı: ${D.bulkGrams} gr mal depoda, envanterinde. İyi iş.`);
    this.ctx.hub.notify(playerId, { kind: 'success', title: 'Depoya teslim edildi', text: `${D.bulkGrams} gr mal envanterinde (Telegram'dan sat).` });
    this.sendLoads();
    return this.orderViews(playerId);
  }

  // ---------------------------------------------------------------- the trap

  private setTrap(playerId: string): void {
    if (this.ambush) return;
    const now = Date.now();
    this.ambush = { playerId, at: now + D.warnSec * 1000, until: now + (D.warnSec + D.ambushSec) * 1000, sprung: false, barricades: [], vans: [], swat: new Map() };
    const line = 'Bölgeye tüm birimler intikal etsin, hedef kapanda.';
    this.ctx.hub.sendTo(playerId, 'police.radio', { tone: 'alert', text: line });
    this.ctx.hub.sendTo(playerId, 'docks.warn', { text: line, at: this.ambush.at });
    log.info('docks trap set', { playerId });
  }

  private spring(a: Ambush): void {
    a.sprung = true;
    a.barricades = gateBarricades();
    this.ctx.sim.setExtraBoxes('docks', a.barricades.map(barricadeBox));
    // SWAT vans parked behind each gate's barricade.
    for (const [x, z, rot] of [
      [708, 196, Math.PI / 2],
      [708, 204, Math.PI / 2],
      [872, 146, 0],
      [878, 146, 0],
    ] as const) {
      const u = this.police.standingUnit(x, z, rot);
      u.swat = true;
      a.vans.push(u);
    }
    // SWAT officers in cover round the player.
    const me = this.ctx.sim.position(a.playerId);
    const spots = [...SWAT_COVER].sort((p, q) => Math.hypot(p.x - (me?.x ?? 0), p.z - (me?.z ?? 0)) - Math.hypot(q.x - (me?.x ?? 0), q.z - (me?.z ?? 0))).slice(0, D.swat);
    for (const s of spots) {
      const id = `cop_dk${seq++}`;
      const npc: NpcEntity = { id, x: s.x, z: s.z, rot: 0, anim: Anim.Kneel, style: 1 };
      a.swat.set(id, { npc, hp: D.swatHp, fireAt: Date.now() + D.swatCoverSec * 1000 + this.ctx.rng() * 1500, deadAt: 0 });
      this.ctx.sim.npcs.set(id, npc);
    }
    // One van at each gate comes after the suspect; the other stays parked behind its barricade.
    const chasers = [a.vans[0]!, a.vans[2]!];
    a.vans = [a.vans[1]!, a.vans[3]!];
    this.police.engageWith(a.playerId, chasers, D.ambushHeat, 'Liman kuşatıldı! Tüm birimler: şüpheli kapanda, kaçmasına izin vermeyin!', 0.5);
    this.ctx.hub.notify(a.playerId, { kind: 'error', title: '🚨 TUZAK! Liman kuşatıldı', text: 'Biri ötmüş: kapılar barikatla kapandı, SWAT konteynerlerin arasında. Hiper araçla kaç ya da kamyonla barikatı yar!' });
    this.publish(true);
    log.info('docks trap sprung', { playerId: a.playerId });
  }

  private endAmbush(why: string): void {
    const a = this.ambush;
    if (!a) return;
    this.ambush = null;
    this.ctx.sim.setExtraBoxes('docks', []);
    for (const id of a.swat.keys()) this.ctx.sim.npcs.delete(id);
    this.police.sendHome(a.vans);
    this.publish(true);
    log.info('docks trap over', { playerId: a.playerId, why });
  }

  /** Heavy or very fast vehicles knock barricade blocks aside. */
  private ram(a: Ambush, dt: number): void {
    let broke = false;
    for (const d of this.ctx.sim.drives.values()) {
      const kmh = Math.abs(d.dyn.speed) * KMH_PER_MS;
      if (kmh < D.ramKmh) continue;
      const v = this.ctx.state.vehicles.get(d.vehicleId);
      const heavy = v ? getModel(v.modelId).specs.weight >= D.ramMass : false;
      if (!heavy && kmh < D.ramFastKmh) continue;
      const reach = d.params.halfLength + Math.abs(d.dyn.speed) * dt * 2 + 1.2;
      const hx = Math.sin(d.dyn.rot);
      const hz = Math.cos(d.dyn.rot);
      for (const b of [...a.barricades]) {
        const dx = b.x - d.dyn.x;
        const dz = b.z - d.dyn.z;
        // Ahead of the car and close.
        if (Math.hypot(dx, dz) > reach + 1 || dx * hx + dz * hz < 0) continue;
        a.barricades = a.barricades.filter((x) => x !== b);
        d.dyn.speed *= heavy ? 0.85 : 0.7;
        this.ctx.hub.broadcast('docks.ram', { id: b.id, x: b.x, z: b.z, dir: d.dyn.rot });
        broke = true;
      }
    }
    if (broke) {
      this.ctx.sim.setExtraBoxes('docks', a.barricades.map(barricadeBox));
      this.publish(true);
    }
  }

  private tickSwat(a: Ambush, dt: number, now: number): void {
    const target = this.ctx.sim.chars.get(a.playerId);
    for (const [id, s] of a.swat) {
      if (s.deadAt) {
        if (now - s.deadAt > 15_000) {
          a.swat.delete(id);
          this.ctx.sim.npcs.delete(id);
        }
        continue;
      }
      if (!target || target.dead) continue;
      const vid = target.drivingId ?? target.ridingId;
      const pos = vid ? this.ctx.sim.drives.get(vid)?.dyn ?? target : target;
      const dx = pos.x - s.npc.x;
      const dz = pos.z - s.npc.z;
      s.npc.rot += angleDiff(s.npc.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
      const d = Math.hypot(dx, dz);
      // Kneeling in cover; up to shoot.
      s.npc.anim = now % 3000 < 2000 && d < D.swatRange ? Anim.Aim : Anim.Kneel;
      if (now >= s.fireAt && d < D.swatRange) {
        s.fireAt = now + D.swatFireSec * 1000 * (0.8 + this.ctx.rng() * 0.5);
        this.combat.npcFire(id, s.npc, a.playerId, { accuracy: D.swatAccuracy, range: D.swatRange, damage: D.swatDamage, weapon: 'rifle' }, now);
      }
    }
  }

  // ---------------------------------------------------------------- per tick

  tick(dt: number, now: number): void {
    for (const o of this.orders.values()) {
      if (o.status === 'ship' && now >= o.arriveAt) this.land(o);
      // The loaded truck gone (wrecked, towed): the load is lost.
      if (o.status === 'loaded' && o.truckId && !this.ctx.state.vehicles.get(o.truckId)) {
        o.status = 'done';
        this.message(o.playerId, 'Kamyon gitti, yük de gitti.');
        this.sendLoads();
      }
    }
    // Opening my import while somebody talked.
    for (const b of this.boxes.values()) {
      const o = b.order;
      if (!o?.trap || o.kind === 'goods') continue;
      const c = this.ctx.sim.chars.get(o.playerId);
      const d = containerDoor(b.def);
      if (c && Math.hypot(c.x - d.stand.x, c.z - d.stand.z) < 25) {
        o.trap = false;
        this.setTrap(o.playerId);
      }
    }
    const a = this.ambush;
    if (a) {
      if (!a.sprung && now >= a.at) this.spring(a);
      if (a.sprung) {
        this.ram(a, dt);
        this.tickSwat(a, dt, now);
      }
      if (now >= a.until) this.endAmbush('time');
    }
    this.publish();
  }

  // ---------------------------------------------------------------- tests

  ambushOf(): Readonly<Ambush> | null {
    return this.ambush;
  }

  box(id: string): Readonly<Box> | undefined {
    return this.boxes.get(id);
  }
}

/** A barricade block's collider. */
function barricadeBox(b: Barricade): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const hl = b.len / 2;
  const hw = 0.35;
  return b.axis === 'x' ? { minX: b.x - hl, maxX: b.x + hl, minZ: b.z - hw, maxZ: b.z + hw } : { minX: b.x - hw, maxX: b.x + hw, minZ: b.z - hl, maxZ: b.z + hl };
}

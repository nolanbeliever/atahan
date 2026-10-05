// Client side of the docks at night (shared/docks.ts): the containers' state, the trap, my import
// orders and the messages from the docks contact (the phone's Toplu İthalat tab), containers on
// trucks; the prompts at a container's doors (cut it, open my order), the crane (driving my flatbed
// next to my goods container) and the depot (unloading), the sounds.

import { DEPOT, DOCK_CONTAINERS, containerDoor, findContainer, gateBarricades, isFlatbed, type DocksState } from '../../../shared/docks';
import { ECONOMY } from '../../../shared/economy.config';
import { gameHour } from '../../../shared/environment';
import type { DocksOrders } from '../../../shared/protocol';
import { DocksView } from '../render/Docks';
import { groundHeight } from '../render/City';
import type { Game, Interaction } from './Game';

const D = ECONOMY.docks;

export class DocksClient {
  state: DocksState | null = null;
  orders: DocksOrders = { orders: [], messages: [] };
  readonly view: DocksView;

  constructor(private readonly game: Game) {
    this.view = new DocksView(game.renderer.scene);
    this.view.vehicleAt = (id) => {
      const e = game.entities.vehicles.get(id);
      return e ? { x: e.x, y: groundHeight(e.x, e.z), z: e.z, rot: e.rot } : null;
    };
    const net = game.net;
    net.on('docks.state', (s) => {
      const was = !!this.state?.ambush;
      const before = (this.state?.ambush?.barricades ?? []).join();
      this.state = s;
      if ((s.ambush?.barricades ?? []).join() !== before) game.rebuildBoxes();
      this.view.set(s);
      if (s.ambush && !was && s.ambush.playerId === game.store.playerId) game.audio.play('error');
    });
    net.on('docks.orders', (d) => {
      const before = this.orders.messages.length;
      this.orders = d;
      if (d.messages.length > before) game.audio.play('notify');
      game.ui?.refreshPanel();
    });
    net.on('docks.loads', (l) => this.view.setLoads(l));
    net.on('docks.crane', (c) => {
      this.view.craneLift(c.containerId, c.vehicleId, c.sec);
      game.audio.play('lift');
    });
    net.on('docks.opened', () => game.audio.play('creak'));
    net.on('docks.warn', (w) => game.ui?.toast({ kind: 'warning', title: '📻 Telsiz', text: w.text }));
    net.on('docks.ram', (r) => {
      this.view.knock(r.id, r.dir);
      game.audio.play('crash');
    });
  }

  /** The barricade blocks standing (solid on the client too). */
  barricadeBoxes(): { minX: number; maxX: number; minZ: number; maxZ: number }[] {
    const up = new Set(this.state?.ambush?.barricades ?? []);
    return gateBarricades()
      .filter((b) => up.has(b.id))
      .map((b) => (b.axis === 'x' ? { minX: b.x - b.len / 2, maxX: b.x + b.len / 2, minZ: b.z - 0.35, maxZ: b.z + 0.35 } : { minX: b.x - 0.35, maxX: b.x + 0.35, minZ: b.z - b.len / 2, maxZ: b.z + b.len / 2 }));
  }

  /** My order waiting in a container. */
  private myOrder(containerId: string) {
    return this.orders.orders.find((o) => o.containerId === containerId && o.status === 'ready');
  }

  private night(): boolean {
    const h = this.game.forcedHour ?? gameHour(this.game.store.serverNow());
    return h >= D.fromHour || h < D.toHour;
  }

  /** On foot at a container's doors. */
  interactions(x: number, z: number, consider: (d: number, it: Interaction) => void): void {
    for (const k of DOCK_CONTAINERS) {
      const door = containerDoor(k);
      const d = Math.hypot(door.stand.x - x, door.stand.z - z);
      if (d > 2.4) continue;
      const v = this.state?.containers.find((c) => c.id === k.id);
      const mine = this.myOrder(k.id);
      if (v?.open) consider(d, { id: `dk-${k.id}`, label: `${k.id} · boş`, sub: 'Kapılar açık: içi boşaltılmış', action: () => undefined });
      else if (mine) consider(d, mine.kind === 'goods' ? { id: `dk-${k.id}`, label: `${k.id} · Toplu Mal siparişin`, sub: 'Kamyonunla (Granforge Hauler) gel: vinç yükler', action: () => this.game.audio.play('error'), tone: 'green' } : { id: `dk-${k.id}`, label: `Siparişini Aç: ${k.id}`, sub: mine.name, action: () => void this.start(k.id), tone: 'green' });
      else if (v?.orderFor) consider(d, { id: `dk-${k.id}`, label: `${k.id} · başkasının siparişi`, sub: 'Mühürlü', action: () => undefined, tone: 'red' });
      else if (v?.cutting) consider(d, { id: `dk-${k.id}`, label: `${k.id} · kesiliyor`, sub: 'Kıvılcımlar...', action: () => undefined });
      else if (this.night()) consider(d, { id: `dk-${k.id}`, label: `Konteyneri Kes [E] · ${k.id}`, sub: 'Avuç taşlama ile 3 kilit kolu · içinde hiper araç, silah sandığı ya da mal olabilir', action: () => void this.start(k.id), tone: 'green' });
      else consider(d, { id: `dk-${k.id}`, label: `${k.id} · kilitli`, sub: 'Konteynerler gece 23:00-05:00 arası açılır', action: () => this.game.audio.play('error'), tone: 'red' });
    }
  }

  /** Driving: the crane (my flatbed next to my goods container), the depot (unloading). */
  drivingAction(vehicleId: string, modelId: string, x: number, z: number, speed: number): Interaction | null {
    if (Math.abs(speed) > 1) return null;
    const loaded = this.orders.orders.find((o) => o.status === 'loaded');
    if (loaded && Math.hypot(DEPOT.x - x, DEPOT.z - z) <= DEPOT.radius + 3) return { id: 'dk-unload', label: 'Depoya Boşalt', sub: `${D.bulkGrams} gr mal · ${DEPOT.name}`, action: () => void this.unload() };
    if (!isFlatbed(modelId)) return null;
    const goods = this.orders.orders.find((o) => o.kind === 'goods' && o.status === 'ready' && o.containerId);
    const k = goods ? findContainer(goods.containerId!) : undefined;
    if (!k) return null;
    const cx = (k.box.minX + k.box.maxX) / 2;
    const cz = (k.box.minZ + k.box.maxZ) / 2;
    if (Math.hypot(cx - x, cz - z) > 12) return null;
    void vehicleId;
    return { id: 'dk-crane', label: 'Vinçle Yükle', sub: `${k.id} kamyonuna · ${D.craneSec} sn`, action: () => void this.crane() };
  }

  private async start(containerId: string): Promise<void> {
    try {
      const r = await this.game.net.rpc('docks.start', { containerId });
      if (r.mode === 'cut') this.game.ui.open('grinder', { containerId, cutSec: r.cutSec });
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  private async crane(): Promise<void> {
    try {
      this.orders = await this.game.net.rpc('docks.crane', {});
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  private async unload(): Promise<void> {
    try {
      this.orders = await this.game.net.rpc('docks.unload', {});
      this.game.audio.play('coin');
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  async order(kind: 'hypercar' | 'arms' | 'goods'): Promise<void> {
    this.orders = await this.game.net.rpc('docks.order', { kind });
  }

  /** The grinder's done: the doors open. */
  onOpened(text: string): void {
    this.game.ui?.toast({ kind: 'success', title: '📦 Konteyner açıldı!', text });
  }

  update(dt: number): void {
    this.view.update(dt, this.game.store.serverNow(), this.game.night);
  }
}

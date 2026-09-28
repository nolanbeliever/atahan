// The game client: prediction/reconciliation, rendering loop, interactions.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { vehicleObstacles, worldBoxes, STATIC_CIRCLES, type ObstacleVehicle } from '../../../shared/collision';
import { ECONOMY, dealershipLevel } from '../../../shared/economy.config';
import {
  KEY,
  SIM_DT,
  stepCharacter,
  stepVehicle,
  vehicleParams,
  type CharacterState,
  type CollisionWorld,
  type DynamicCircle,
  type InputCmd,
  type VehicleDyn,
} from '../../../shared/physics';
import type { PrivateState } from '../../../shared/protocol';
import { Anim, type Auction, type PlayerSettings, type Snapshot } from '../../../shared/types';
import { formatMoney } from '../../../shared/util';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import {
  INTERACTABLES,
  MARKET_LOT_SLOTS,
  PLOTS,
  findPlot,
  isInsidePlot,
  plotEntrance,
  zoneAt,
  type AABB,
  type InteractKind,
} from '../../../shared/world';
import { AudioSystem } from '../audio/Audio';
import { Network, RpcError } from '../net/Network';
import { City, groundHeight } from '../render/City';
import { DealershipsView } from '../render/Dealerships';
import { Effects } from '../render/Effects';
import { Renderer } from '../render/Renderer';
import { VehicleView } from '../render/VehicleMesh';
import { Store } from '../state/Store';
import type { UI } from '../ui/UI';
import { CameraController } from './CameraController';
import { EntityViews } from './EntityViews';
import { Input } from './Input';

export interface Interaction {
  id: string;
  label: string;
  sub?: string;
  action: () => void;
}

const MAX_PENDING = 150;

export class Game {
  readonly renderer: Renderer;
  readonly city = new City();
  readonly dealerships = new DealershipsView();
  readonly effects: Effects;
  readonly entities: EntityViews;
  readonly input: Input;
  readonly cam: CameraController;
  readonly audio = new AudioSystem();
  readonly store = new Store();
  readonly net: Network;
  ui!: UI;

  // Local prediction state
  private char: CharacterState = { x: 0, z: 0, rot: 0, gait: 0 };
  private dyn: VehicleDyn | null = null;
  driving: string | null = null;
  private prev = { x: 0, z: 0, rot: 0 };
  private curr = { x: 0, z: 0, rot: 0 };
  private offset = new THREE.Vector2();
  private pending: InputCmd[] = [];
  private outbox: InputCmd[] = [];
  private seq = 0;
  private acc = 0;
  private last = performance.now();
  private world: CollisionWorld = { boxes: [], circles: STATIC_CIRCLES, dynamic: [] };
  private boxes: AABB[] = [];
  private dynamic: DynamicCircle[] = [];
  private snapshotsReceived = 0;
  private hasWelcome = false;
  private interaction: Interaction | null = null;
  private secondary: Interaction | null = null;
  private lastMoney: number | null = null;
  private lastLevel: number | null = null;
  private minimapTimer = 0;
  private auctionTimer = 0;
  private featured: { id: string; view: VehicleView } | null = null;
  auctions: Auction[] = [];
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  running = true;
  /** Optional fixed camera for screenshots/debugging: ?cam=x,y,z,lookX,lookY,lookZ */
  private debugCam: number[] | null = (() => {
    const v = new URLSearchParams(location.search).get('cam');
    const nums = v?.split(',').map(Number);
    return nums && nums.length === 6 && nums.every(Number.isFinite) ? nums : null;
  })();

  constructor(
    container: HTMLElement,
    token: string,
  ) {
    this.renderer = new Renderer(container);
    const pmrem = new THREE.PMREMGenerator(this.renderer.renderer);
    this.renderer.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.renderer.scene.add(this.city.group, this.dealerships.group);
    this.effects = new Effects(this.renderer.scene);
    this.entities = new EntityViews(this.renderer.scene, () => this.store.playerId);
    this.input = new Input(this.renderer.renderer.domElement);
    this.cam = new CameraController(this.renderer.camera);
    this.net = new Network(token);
    this.rebuildBoxes();
    this.bindNetwork();
    this.bindStore();
    this.input.onPressed((code, e) => this.onKey(code, e));
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    window.addEventListener('keydown', () => this.audio.unlock());
  }

  attachUI(ui: UI): void {
    this.ui = ui;
  }

  start(): void {
    const loop = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    this.net.close();
  }

  // ------------------------------------------------------------ network

  private bindNetwork(): void {
    const net = this.net;
    net.on('welcome', (w) => {
      this.hasWelcome = true;
      this.entities.clear();
      this.store.applyWelcome(w.playerId, w.self, w.world);
      this.pending = [];
      this.outbox = [];
      this.driving = w.self.driving;
      this.lastMoney = w.self.player.money;
      this.lastLevel = w.self.player.level;
      this.applySettings(w.self.player.settings);
      this.ui?.setReconnecting(false);
      this.ui?.onWelcome();
      void this.refreshAuctions();
    });
    net.on('self', (s) => this.store.applySelf(s));
    net.on('snapshot', (s) => this.onSnapshot(s));
    net.on('player.upsert', (p) => this.store.upsertPlayer(p));
    net.on('player.remove', (id) => {
      this.store.removePlayer(id);
      this.entities.removePlayer(id);
    });
    net.on('vehicle.upsert', (v) => this.store.upsertVehicle(v));
    net.on('vehicle.remove', (id) => this.store.removeVehicle(id));
    net.on('dealership.upsert', (d) => this.store.upsertDealership(d));
    net.on('market.update', (m) => this.store.setMarket(m.listings));
    net.on('listings.changed', () => this.store.emit('listingsChanged', undefined));
    net.on('trends', (t) => this.store.setTrends(t));
    net.on('auction.update', (a) => {
      const idx = this.auctions.findIndex((x) => x.id === a.id);
      if (a.status !== 'active') {
        if (idx >= 0) this.auctions.splice(idx, 1);
      } else if (a.vehicle) {
        if (idx >= 0) this.auctions[idx] = a;
        else this.auctions.push(a);
      }
      this.ui?.onAuctions();
      this.updateFeatured();
    });
    net.on('chat', (m) => this.ui?.chat.add(m));
    net.on('notify', (n) => {
      this.ui?.toast(n);
      if (n.kind === 'money') this.audio.play('purchase');
      else if (n.kind === 'levelup' || n.kind === 'achievement') this.audio.play('levelup');
      else if (n.title.includes('outbid')) this.audio.play('outbid');
      else this.audio.play('notify');
    });
    net.on('offer', (o) => {
      this.store.offers.set(o.id, o);
      this.store.emit('offers', undefined);
      this.audio.play('notify');
    });
    net.on('offer.closed', (id) => {
      this.store.offers.delete(id);
      this.store.emit('offers', undefined);
    });
    net.on('kicked', (reason) => {
      this.running = false;
      this.ui?.fatal(reason);
    });
    net.socket.on('disconnect', () => {
      if (this.running) this.ui?.setReconnecting(true);
    });
    net.socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        this.running = false;
        this.ui?.fatal('Your session has expired. Please log in again.', true);
      }
    });
  }

  private bindStore(): void {
    const s = this.store;
    s.on('self', (st) => this.onSelf(st));
    s.on('players', () => {
      for (const p of s.players.values()) this.entities.ensurePlayer(p.id, p.name, p.level, p.appearance);
      for (const id of [...this.entities.players.keys()]) if (!s.players.has(id)) this.entities.removePlayer(id);
      this.refreshDealerships();
    });
    s.on('vehicle', (v) => {
      this.entities.upsertVehicle(v, 'public', undefined, v.ownerName);
    });
    s.on('vehicleRemoved', (id) => this.entities.removeVehicle(id));
    s.on('vehicles', () => {
      for (const [id, e] of this.entities.vehicles) if (e.kind === 'public' && !s.vehicles.has(id)) this.entities.removeVehicle(id);
      for (const v of s.vehicles.values()) this.entities.upsertVehicle(v, 'public', undefined, v.ownerName);
    });
    s.on('market', (listings) => this.entities.syncMarket(listings));
    s.on('dealerships', () => {
      this.refreshDealerships();
      this.rebuildBoxes();
    });
  }

  private refreshDealerships(): void {
    const me = this.store.playerId;
    for (const plot of PLOTS) {
      const d = this.store.dealerships.get(plot.id);
      this.dealerships.update(plot, d, d?.ownerId === me, dealershipLevel(1).price);
    }
  }

  private rebuildBoxes(): void {
    const levels = new Map<string, number>();
    for (const d of this.store.dealerships.values()) levels.set(d.plotId, d.level);
    this.boxes = worldBoxes(levels);
    this.world = { boxes: this.boxes, circles: STATIC_CIRCLES, dynamic: this.dynamic };
  }

  private onSelf(st: PrivateState): void {
    const p = st.player;
    const me = this.store.players.get(p.id);
    this.entities.ensurePlayer(p.id, p.name, p.level, p.appearance);
    if (me) me.appearance = p.appearance;
    if (this.lastMoney !== null && p.money !== this.lastMoney) {
      const delta = p.money - this.lastMoney;
      const pos = new THREE.Vector3(this.curr.x, groundHeight(this.curr.x, this.curr.z) + 2.6, this.curr.z);
      this.effects.floatText(`${delta > 0 ? '+' : '-'}${formatMoney(Math.abs(delta)).replace('-', '')}`, pos, delta > 0 ? '#2ee59d' : '#ff5c7a');
      if (delta > 0) this.audio.play('coin');
      this.ui?.bumpMoney();
    }
    if (this.lastLevel !== null && p.level > this.lastLevel) {
      this.effects.sparkle(new THREE.Vector3(this.curr.x, groundHeight(this.curr.x, this.curr.z) + 1.5, this.curr.z), '#ffd35a', 90);
    }
    this.lastMoney = p.money;
    this.lastLevel = p.level;
    this.ui?.updateHud();
  }

  applySettings(s: PlayerSettings): void {
    this.cam.sensitivity = s.mouseSensitivity;
    this.cam.invertY = s.invertY;
    this.entities.showNames = s.showNames;
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.ambientVolume);
    const forced = new URLSearchParams(location.search).get('gfx');
    const quality = forced === 'low' || forced === 'medium' || forced === 'high' ? forced : s.graphics;
    if (this.renderer.graphics !== quality) this.renderer.setQuality(quality);
  }

  // ------------------------------------------------------------ snapshots & reconciliation

  private onSnapshot(s: Snapshot): void {
    this.snapshotsReceived++;
    const now = performance.now();
    const me = this.store.playerId;
    for (const p of s.p) {
      if (p[0] === me) continue;
      const pub = this.store.players.get(p[0]);
      const e = this.entities.players.get(p[0]) ?? (pub ? this.entities.ensurePlayer(pub.id, pub.name, pub.level, pub.appearance) : undefined);
      if (!e) continue;
      e.buffer.push({ t: now, x: p[1], z: p[2], r: p[3], a: p[4], b: 0 });
      e.driving = p[5];
      e.lastSeen = now;
    }
    for (const v of s.v) {
      if (v[0] === this.driving) continue;
      const e = this.entities.vehicles.get(v[0]);
      if (!e) continue;
      e.driven = true;
      e.lastDriven = now;
      e.buffer.push({ t: now, x: v[1], z: v[2], r: v[3], a: v[4], b: v[5] });
    }
    const alive = new Set<string>();
    for (const n of s.n) {
      alive.add(n[0]);
      this.entities.upsertNpc(n[0], n[5], now, n[1], n[2], n[3], n[4]);
    }
    this.entities.pruneNpcs(alive);
    if (s.self) this.reconcile(s.ack, s.self);
  }

  private reconcile(ack: number, self: NonNullable<Snapshot['self']>): void {
    const [x, z, rot, speed, steer, drivingId] = self;
    this.pending = this.pending.filter((c) => c.seq > ack);
    const before = { x: this.curr.x, z: this.curr.z };
    if (drivingId !== this.driving) {
      // Mode switch (entered / exited a vehicle): adopt the server state.
      this.driving = drivingId;
      this.pending = [];
      this.offset.set(0, 0);
      if (drivingId) this.dyn = { x, z, rot, speed, steer };
      else {
        this.dyn = null;
        this.char = { x, z, rot, gait: 0 };
      }
      this.curr = { x, z, rot };
      this.prev = { ...this.curr };
      this.audio.play('door');
      return;
    }
    if (this.driving) {
      const v = this.store.myVehicle(this.driving);
      if (!v) return;
      this.dyn = { x, z, rot, speed, steer };
      const params = vehicleParams(getModel(v.modelId), v.condition, v.fuel);
      for (const c of this.pending) stepVehicle(this.dyn, c, params, this.world, this.driving);
      this.curr = { x: this.dyn.x, z: this.dyn.z, rot: this.dyn.rot };
    } else {
      this.char.x = x;
      this.char.z = z;
      for (const c of this.pending) stepCharacter(this.char, c, this.world, this.store.playerId);
      this.curr = { x: this.char.x, z: this.char.z, rot: this.char.rot };
    }
    const dx = before.x - this.curr.x;
    const dz = before.z - this.curr.z;
    if (Math.hypot(dx, dz) > 6 || this.snapshotsReceived < 3) {
      this.offset.set(0, 0);
      this.prev = { ...this.curr };
      if (this.snapshotsReceived < 3) this.cam.snap();
    } else {
      this.offset.x += dx;
      this.offset.y += dz;
    }
  }

  // ------------------------------------------------------------ simulation

  private rebuildDynamic(): void {
    const list: ObstacleVehicle[] = [];
    for (const e of this.entities.vehicles.values()) {
      if (e.data.id === this.driving) continue;
      if (e.kind === 'market' && e.listing) {
        const slot = MARKET_LOT_SLOTS[e.listing.lotSlot];
        if (slot) list.push({ id: e.data.id, modelId: e.data.modelId, x: slot.x, z: slot.z, rot: slot.rot });
      } else list.push({ id: e.data.id, modelId: e.data.modelId, x: e.x, z: e.z, rot: e.rot });
    }
    this.dynamic.length = 0;
    vehicleObstacles(list, this.dynamic);
  }

  private step(): void {
    const keys = this.input.keys();
    const cmd: InputCmd = { seq: ++this.seq, dt: SIM_DT, keys, yaw: this.cam.yaw };
    this.prev = { ...this.curr };
    if (this.driving && this.dyn) {
      const v = this.store.myVehicle(this.driving);
      if (v) {
        const params = vehicleParams(getModel(v.modelId), v.condition, v.fuel);
        stepVehicle(this.dyn, cmd, params, this.world, this.driving);
        this.curr = { x: this.dyn.x, z: this.dyn.z, rot: this.dyn.rot };
      }
    } else {
      stepCharacter(this.char, cmd, this.world, this.store.playerId);
      this.curr = { x: this.char.x, z: this.char.z, rot: this.char.rot };
    }
    this.pending.push(cmd);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    this.outbox.push(cmd);
    if (this.outbox.length >= 2) {
      this.net.sendInputs(this.outbox);
      this.outbox = [];
    }
  }

  private frame(now: number): void {
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.1, raw);
    this.last = now;
    this.fpsAcc += raw;
    this.fpsFrames++;
    if (this.fpsAcc >= 1) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (!this.hasWelcome) {
      this.renderer.render();
      return;
    }
    const mouse = this.input.consumeMouse();
    if (this.input.enabled) this.cam.applyMouse(mouse.dx, mouse.dy);

    this.rebuildDynamic();
    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 6) {
      this.step();
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps >= 6) this.acc = 0;
    const alpha = this.acc / SIM_DT;
    this.offset.multiplyScalar(Math.exp(-dt * 10));
    const rx = this.prev.x + (this.curr.x - this.prev.x) * alpha + this.offset.x;
    const rz = this.prev.z + (this.curr.z - this.prev.z) * alpha + this.offset.y;
    const rrot = this.curr.rot;

    const keys = this.input.keys();
    const moving = (keys & (KEY.FORWARD | KEY.BACK | KEY.LEFT | KEY.RIGHT)) !== 0;
    const anim = moving ? (keys & KEY.SPRINT ? Anim.Run : Anim.Walk) : Anim.Idle;
    this.entities.update(dt, now, {
      id: this.store.playerId,
      x: rx,
      z: rz,
      rot: rrot,
      anim,
      driving: this.driving,
      speed: this.dyn?.speed ?? 0,
      steer: this.dyn?.steer ?? 0,
    });

    if (this.driving && this.dyn && performance.now() - this.input.lastMouseMove > 1500) this.cam.follow(this.dyn.rot, dt);
    const target = new THREE.Vector3(rx, groundHeight(rx, rz), rz);
    this.cam.update(target, dt, !!this.driving, this.dyn?.speed ?? 0, this.boxes);
    if (this.debugCam) {
      const [cx, cy, cz, lx, ly, lz] = this.debugCam as [number, number, number, number, number, number];
      this.renderer.camera.position.set(cx, cy, cz);
      this.renderer.camera.lookAt(lx, ly, lz);
      this.renderer.followShadows(lx, lz);
    } else this.renderer.followShadows(rx, rz);

    this.updateInteraction(rx, rz);
    this.audio.engine(!!this.driving, this.dyn?.speed ?? 0, (keys & KEY.FORWARD) !== 0, dt);
    this.effects.update(dt);
    this.city.update(dt);
    this.featured?.view.animate(0, 0, dt);

    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1;
      this.ui?.minimap.draw(this, rx, rz, this.cam.yaw);
      this.ui?.updateDriving();
      this.ui?.setZone(zoneAt(rx, rz)?.name ?? '');
    }
    this.auctionTimer -= dt;
    if (this.auctionTimer <= 0) {
      this.auctionTimer = 20;
      void this.refreshAuctions();
    }
    this.renderer.render();
  }

  // ------------------------------------------------------------ public helpers

  position(): { x: number; z: number; rot: number } {
    return { x: this.curr.x, z: this.curr.z, rot: this.curr.rot };
  }

  get speed(): number {
    return this.dyn?.speed ?? 0;
  }

  nearKind(kind: InteractKind, slack = 4): boolean {
    const p = this.curr;
    return INTERACTABLES.some((i) => i.kind === kind && Math.hypot(i.x - p.x, i.z - p.z) <= i.radius + slack);
  }

  nearOwnDealership(): boolean {
    const d = this.store.myDealership();
    const plot = d ? findPlot(d.plotId) : undefined;
    return !!plot && isInsidePlot(plot, this.curr.x, this.curr.z, ECONOMY.dealership.manageRadius - 19 - 1);
  }

  async refreshAuctions(): Promise<void> {
    try {
      const { auctions } = await this.net.rpc('auction.list', {});
      this.auctions = auctions;
      this.ui?.onAuctions();
      this.updateFeatured();
    } catch {
      /* offline */
    }
  }

  private updateFeatured(): void {
    const best = [...this.auctions].filter((a) => a.vehicle).sort((a, b) => b.bidCount - a.bidCount || a.endsAt - b.endsAt)[0];
    if (!best) {
      if (this.featured) {
        this.city.turntable.remove(this.featured.view.root);
        this.featured.view.dispose();
        this.featured = null;
      }
      return;
    }
    if (this.featured?.id === best.vehicle.id) return;
    if (this.featured) {
      this.city.turntable.remove(this.featured.view.root);
      this.featured.view.dispose();
    }
    const view = new VehicleView(best.vehicle);
    this.city.turntable.add(view.root);
    this.featured = { id: best.vehicle.id, view };
  }

  // ------------------------------------------------------------ interactions

  private updateInteraction(x: number, z: number): void {
    let best: Interaction | null = null;
    let bestD = Infinity;
    let secondary: Interaction | null = null;
    const consider = (d: number, it: Interaction) => {
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    };
    const me = this.store.playerId;
    if (this.driving) {
      const v = this.store.myVehicle(this.driving);
      best = { id: 'exit', label: `Exit ${v ? modelDisplayName(v.modelId) : 'vehicle'}`, action: () => void this.exitVehicle() };
      for (const i of INTERACTABLES) {
        if ((i.kind === 'fuel' || i.kind === 'wash') && Math.hypot(i.x - x, i.z - z) <= i.radius + 3) {
          secondary = { id: i.id, label: i.kind === 'fuel' ? 'Refuel this vehicle' : 'Drive-through wash', action: () => this.ui.open(i.kind, { vehicleId: this.driving }) };
        }
      }
    } else {
      for (const i of INTERACTABLES) {
        const d = Math.hypot(i.x - x, i.z - z);
        if (d <= i.radius) consider(d, { id: i.id, label: i.label, action: () => this.ui.open(i.kind) });
      }
      for (const plot of PLOTS) {
        const e = plotEntrance(plot);
        const d = Math.hypot(e.x - x, e.z - z);
        if (d > 7) continue;
        const dealer = this.store.dealerships.get(plot.id);
        if (!dealer) {
          const hasOwn = !!this.store.myDealership();
          consider(d, {
            id: plot.id,
            label: hasOwn ? `Plot ${plot.index} is for sale` : `Buy dealership plot ${plot.index}`,
            sub: formatMoney(dealershipLevel(1).price),
            action: () => this.ui.open('plot', { plotId: plot.id }),
          });
        } else if (dealer.ownerId === me) {
          consider(d, { id: plot.id, label: `Manage ${dealer.name}`, sub: dealershipLevel(dealer.level).name, action: () => this.ui.open('dealership') });
        } else {
          consider(d + 2, { id: plot.id, label: `${dealer.name}`, sub: `Owned by ${dealer.ownerName}`, action: () => this.ui.open('market', { tab: 'players' }) });
        }
      }
      for (const e of this.entities.vehicles.values()) {
        const reach = e.view.length / 2 + 1.4;
        const d = Math.hypot(e.x - x, e.z - z);
        if (d > reach) continue;
        const v = e.data;
        if (e.kind === 'market' && e.listing) {
          const l = e.listing;
          consider(d, { id: v.id, label: `Inspect ${modelDisplayName(v.modelId)}`, sub: `Asking ${formatMoney(l.askingPrice)} - seller: ${l.sellerName}`, action: () => this.ui.open('inspect', { listingId: l.id }) });
        } else if (v.ownerId === me && v.status === 'world') {
          consider(d, { id: v.id, label: `Drive ${modelDisplayName(v.modelId)}`, sub: `Fuel ${Math.round(v.fuel)}%`, action: () => void this.enterVehicle(v.id) });
        } else if (v.ownerId === me && v.status === 'displayed') {
          consider(d, { id: v.id, label: `Manage display: ${modelDisplayName(v.modelId)}`, sub: v.salePrice ? `Listed at ${formatMoney(v.salePrice)}` : 'Not for sale', action: () => this.ui.open('dealership') });
        } else if (v.status === 'displayed' && v.salePrice !== null) {
          consider(d, { id: v.id, label: `View ${modelDisplayName(v.modelId)}`, sub: `For sale: ${formatMoney(v.salePrice)}`, action: () => this.ui.open('playerListing', { vehicleId: v.id }) });
        }
      }
    }
    this.interaction = best;
    this.secondary = secondary;
    this.ui?.setPrompt(best, secondary);
  }

  private onKey(code: string, e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (!this.ui) return;
    if (code === 'Escape') {
      e.preventDefault();
      if (this.ui.chat.active) this.ui.chat.close();
      else if (this.ui.anyOpen()) this.ui.closeAll();
      else this.ui.open('menu');
      return;
    }
    if (typing) return;
    if ((code === 'Enter' || code === 'KeyT') && !this.ui.anyOpen()) {
      e.preventDefault();
      this.ui.chat.open();
      return;
    }
    if (this.ui.anyOpen()) return;
    const hot: Record<string, Parameters<UI['open']>[0]> = {
      KeyB: 'market',
      KeyI: 'inventory',
      KeyJ: 'dealership',
      KeyK: 'auctions',
      KeyM: 'map',
      KeyO: 'profile',
    };
    if (hot[code]) {
      this.ui.open(hot[code]!);
      return;
    }
    if (code === 'KeyE' && this.interaction) {
      this.audio.play('click');
      this.interaction.action();
    } else if (code === 'KeyF' && this.secondary) {
      this.audio.play('click');
      this.secondary.action();
    }
  }

  async enterVehicle(id: string): Promise<void> {
    try {
      await this.net.rpc('vehicle.enter', { vehicleId: id });
    } catch (err) {
      this.ui.error(err);
    }
  }

  async exitVehicle(): Promise<void> {
    try {
      await this.net.rpc('vehicle.exit', {});
    } catch (err) {
      this.ui.error(err);
    }
  }

  /** Test/debug hook: read-only snapshot of client state. */
  debugState() {
    return {
      playerId: this.store.playerId,
      connected: this.net.socket.connected,
      snapshots: this.snapshotsReceived,
      position: { ...this.curr },
      driving: this.driving,
      money: this.store.me?.money ?? null,
      bank: this.store.me?.bank ?? null,
      level: this.store.me?.level ?? null,
      vehicles: this.store.myVehicles().map((v) => ({ id: v.id, modelId: v.modelId, status: v.status, salePrice: v.salePrice })),
      otherPlayers: [...this.entities.players.keys()].filter((id) => id !== this.store.playerId),
      visiblePlayers: [...this.entities.players.entries()].filter(([id, e]) => id !== this.store.playerId && e.buffer.latest).map(([id]) => id),
      marketListings: this.store.marketListings.map((l) => ({ id: l.id, price: l.askingPrice, modelId: l.vehicle.modelId, vehicleId: l.vehicle.id })),
      publicVehicles: [...this.store.vehicles.values()].map((v) => ({ id: v.id, ownerId: v.ownerId, status: v.status, salePrice: v.salePrice })),
      fps: this.fps,
      drawCalls: this.renderer.renderer.info.render.calls,
      triangles: this.renderer.renderer.info.render.triangles,
    };
  }
}

export { RpcError };

// The game client: prediction/reconciliation, rendering loop, interactions.

import { calculateVehicleStats } from '../../../shared/tuningSystem';
import { passengerSeats } from '../../../shared/passengers';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { vehicleObstacles, worldBoxes, STATIC_CIRCLES, type ObstacleVehicle } from '../../../shared/collision';
import { ECONOMY, dealershipLevel } from '../../../shared/economy.config';
import {
  KEY,
  SIM_DT,
  dynFromTuple,
  stepCharacter,
  stepVehicle,
  vehicleParams,
  type CharacterState,
  type CollisionWorld,
  type DynamicBox,
  type InputCmd,
  type VehicleDyn,
} from '../../../shared/physics';
import { KMH_PER_MS } from '../../../shared/drivetrain';
import { rainAt, surfaceGrip, wetnessAt } from '../../../shared/environment';
import type { MissionView } from '../../../shared/missions';
import type { BustedEvent, WantedState } from '../../../shared/police';
import type { DragRaceView } from '../../../shared/drag';
import { DRAG_STRIP, gameHour } from '../../../shared/highway';
import type { PrivateState } from '../../../shared/protocol';
import { SANAYI, isLifted, partLabelTr, type StreetCar } from '../../../shared/theft';
import { AIR_LEVELS, hasAirRide } from '../../../shared/modificationsData';
import { NITRO_ITEM } from '../../../shared/rewards';
import { Anim, VF, type Auction, type PlayerSettings, type Snapshot } from '../../../shared/types';
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
import { HighwayView } from '../render/Highway';
import { TrafficView } from '../render/TrafficView';
import { Effects } from '../render/Effects';
import { Renderer } from '../render/Renderer';
import { createVehicleView, type AnyVehicleView, type VehicleView } from '../render/VehicleMesh';
import { CockpitRig } from '../render/Cockpit';
import { Rain, setRoadWetness } from '../render/Weather';
import { SanayiView } from '../render/Sanayi';
import { Store } from '../state/Store';
import type { UI } from '../ui/UI';
import { CameraController } from './CameraController';
import { EntityViews, LIFT_DELAY } from './EntityViews';
import { Input } from './Input';
import { BustedCutscene } from './Busted';
import { PoliceClient } from './Police';
import { TheftClient } from './Theft';
import { TrafficClient } from './Traffic';

export interface Interaction {
  id: string;
  label: string;
  sub?: string;
  action: () => void;
  /** Getting into / out of a vehicle (the F key). */
  vehicle?: boolean;
}

const COCKPIT_FOV = 74;
const CHASE_FOV = 62;

const MAX_PENDING = 150;

export class Game {
  readonly renderer: Renderer;
  readonly city = new City();
  readonly dealerships = new DealershipsView();
  readonly highway = new HighwayView();
  readonly traffic = new TrafficClient();
  readonly trafficView = new TrafficView();
  readonly sanayi = new SanayiView();
  /** Street cars, alarms, the lifts and stripping. */
  readonly theft: TheftClient;
  /** Hands busy (lockpicking, working on a car): the character plays its work animation. */
  working = false;
  /** The drag race on the strip (null when it is free). */
  drag: DragRaceView | null = null;
  private dragBots = new Map<number, { view: AnyVehicleView; z: number; speed: number; rz: number }>();
  private dayTimer = 0;
  night = 0;
  private hornOn = false;
  private flash = 0;
  /** Fixed time of day for screenshots/debugging: ?hour=22 */
  private forcedHour: number | null = (() => {
    const v = Number(new URLSearchParams(location.search).get('hour'));
    return new URLSearchParams(location.search).has('hour') && Number.isFinite(v) ? v : null;
  })();
  readonly effects: Effects;
  readonly entities: EntityViews;
  readonly police: PoliceClient;
  private rain = new Rain();
  /** Rain now (0-1) and how wet the roads are. */
  weather = { rain: 0, wet: 0 };
  private forcedRain: number | null = (() => {
    const v = new URLSearchParams(location.search).get('rain');
    return v !== null && Number.isFinite(Number(v)) ? Number(v) : null;
  })();
  /** First-person cockpit chosen (C key / camera button). */
  cockpitOn = new URLSearchParams(location.search).get('cockpit') === '1';
  private cockpit: { id: string; rig: CockpitRig } | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private busted: BustedCutscene | null = null;
  wanted: WantedState = { stars: 0, units: 0, escapeLeft: null, bust: 0 };
  /** What the physics did since the last frame (gauge lights, tyre sounds, shifts). */
  private stepInfo = { abs: false, wheelspin: 0, sliding: false, locked: false, shifted: 0 };
  private vehicleAction: Interaction | null = null;
  private missionTimer = 0;
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
  /** Riding along as a passenger in someone else's car. */
  riding: { vehicleId: string; seat: number } | null = null;
  private prev = { x: 0, z: 0, rot: 0 };
  private curr = { x: 0, z: 0, rot: 0 };
  private offset = new THREE.Vector2();
  private pending: InputCmd[] = [];
  private outbox: InputCmd[] = [];
  private seq = 0;
  /** Last time the player did something (playtime rewards count active time only). */
  private activeAt = 0;
  private fovKick = 0;
  private lastYaw = 0;
  private acc = 0;
  private last = performance.now();
  private dynamic: DynamicBox[] = [];
  private world: CollisionWorld = { boxes: [], circles: STATIC_CIRCLES, dynamic: [], vehicles: this.dynamic, grip: 1 };
  private boxes: AABB[] = [];
  private snapshotsReceived = 0;
  private hasWelcome = false;
  private interaction: Interaction | null = null;
  private secondary: Interaction | null = null;
  private lastMoney: number | null = null;
  private lastLevel: number | null = null;
  private minimapTimer = 0;
  private auctionTimer = 0;
  private featured: { id: string; view: AnyVehicleView } | null = null;
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
    this.renderer.scene.add(this.city.group, this.dealerships.group, this.highway.group, this.trafficView.group, this.sanayi.group);
    this.effects = new Effects(this.renderer.scene);
    this.entities = new EntityViews(this.renderer.scene, () => this.store.playerId);
    this.police = new PoliceClient(this.renderer.scene);
    this.entities.serverNow = () => this.store.serverNow();
    this.theft = new TheftClient(this);
    this.renderer.scene.add(this.theft.group);
    this.renderer.scene.add(this.rain.mesh);
    // Pops & bangs from our own exhaust flash flames at the tips.
    this.audio.onPop = (strength) => {
      if (this.driving) this.entities.vehicles.get(this.driving)?.view.pop(strength);
    };
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
    const mark = (): void => {
      this.activeAt = performance.now();
    };
    window.addEventListener('pointerdown', mark, true);
    window.addEventListener('keydown', mark, true);
    window.addEventListener('wheel', mark, { capture: true, passive: true });
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
      this.endBusted();
      this.police.clear();
      void this.net
        .rpc('missions.list', {})
        .then((r) => this.onMissions(r.missions))
        .catch(() => undefined);
      void this.net
        .rpc('rare.list', {})
        .then((s) => this.store.setRare(s))
        .catch(() => undefined);
      this.theft.clear();
      void this.net
        .rpc('street.list', {})
        .then((r) => this.store.setStreet(r.cars))
        .catch(() => undefined);
      void this.net
        .rpc('blackmarket.info', {})
        .then((r) => this.store.setBlackMarket(r))
        .catch(() => undefined);
      void this.net
        .rpc('rewards.info', {})
        .then((r) => this.store.setRewards(r))
        .catch(() => undefined);
    });
    net.on('rewards.update', (v) => this.store.setRewards(v));
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
    net.on('rare.update', (s) => this.store.setRare(s));
    net.on('street.cars', (cars) => this.store.setStreet(cars));
    net.on('car.alarm', (d) => this.theft.onAlarm(d));
    net.on('blackmarket.update', (d) => this.store.setBlackMarket(d));
    net.on('highway.nearmiss', (e) => {
      this.ui?.nearMiss.nearMiss(e);
      this.audio.play('nearmiss');
    });
    net.on('highway.combo', (e) => {
      this.ui?.nearMiss.ended(e.reason, e.count, e.earned);
      if (e.reason === 'crash' && e.count > 0) this.audio.play('crash');
    });
    net.on('drag.update', (d) => this.onDrag(d));
    net.on('drive.bonus', (d) => this.ui?.cluster.showBonus(d.amount));
    net.on('missions.update', (d) => this.onMissions(d.missions));
    net.on('missions.complete', (d) => {
      this.ui?.wanted.mission(d.title, d.reward);
      this.audio.play('levelup');
    });
    net.on('police.wanted', (w) => {
      if (w.stars > this.wanted.stars) this.audio.play(w.stars >= 2 ? 'foul' : 'notify');
      this.wanted = w;
      this.ui?.wanted.set(w);
    });
    net.on('police.busted', (e) => this.startBusted(e));
    net.on('police.escaped', (d) => {
      this.ui?.wanted.escaped(d.reward, d.xp);
      this.audio.play('levelup');
    });
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
    s.on('street', (cars) => this.theft.sync(cars));
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
    this.world = { boxes: this.boxes, circles: STATIC_CIRCLES, dynamic: [], vehicles: this.dynamic, grip: this.world.grip };
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
      e.riding = p[6] ? { vehicleId: p[6], seat: p[7] ?? 0 } : null;
      e.lastSeen = now;
    }
    for (const v of s.v) {
      if (v[0] === this.driving) continue;
      const e = this.entities.vehicles.get(v[0]);
      if (!e) continue;
      e.driven = true;
      e.lastDriven = now;
      e.buffer.push({ t: now, x: v[1], z: v[2], r: v[3], a: v[4], b: v[5], rpm: v[6], gear: v[7], f: v[8] });
    }
    const alive = new Set<string>();
    for (const n of s.n) {
      alive.add(n[0]);
      this.entities.upsertNpc(n[0], n[5], now, n[1], n[2], n[3], n[4]);
    }
    this.entities.pruneNpcs(alive);
    if (s.tr) this.traffic.apply(s.tr, (this.store.serverNow() - s.t) / 1000);
    if (s.po) this.police.apply(s.po, now);
    if (s.dr && this.drag && s.dr.id === this.drag.id) {
      for (const [lane, z, speed] of s.dr.cars) {
        const bot = this.dragBots.get(lane);
        if (bot) {
          bot.z = z;
          bot.speed = speed;
        }
      }
    }
    if (s.self) this.reconcile(s.ack, s.self);
  }

  private reconcile(ack: number, self: NonNullable<Snapshot['self']>): void {
    const [x, z, rot, drivingId, dynT, ridingId, seat] = self;
    this.pending = this.pending.filter((c) => c.seq > ack);
    const before = { x: this.curr.x, z: this.curr.z };
    // Riding along: the server places us with the car; no prediction.
    const riding = ridingId ? { vehicleId: ridingId, seat: seat ?? 0 } : null;
    if ((riding?.vehicleId ?? null) !== (this.riding?.vehicleId ?? null)) {
      this.riding = riding;
      this.pending = [];
      this.offset.set(0, 0);
      this.char = { x, z, rot, gait: 0 };
      this.curr = { x, z, rot };
      this.prev = { ...this.curr };
      this.audio.play('door');
      if (!riding) this.cam.snap();
    }
    if (this.riding) {
      this.curr = { x, z, rot };
      this.char = { x, z, rot, gait: 0 };
      return;
    }
    if (drivingId !== this.driving) {
      // Mode switch (entered / exited a vehicle): adopt the server state.
      this.driving = drivingId;
      this.pending = [];
      this.offset.set(0, 0);
      if (drivingId && dynT) this.dyn = dynFromTuple(dynT);
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
      if (!v || !dynT) return;
      const dyn = dynFromTuple(dynT);
      const params = vehicleParams(getModel(v.modelId), v.condition, v.fuel, v.mods);
      for (const c of this.pending) stepVehicle(dyn, c, params, this.world, this.driving);
      this.dyn = dyn;
      this.curr = { x: dyn.x, z: dyn.z, rot: dyn.rot };
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
    for (const [lane, bot] of this.dragBots) {
      const racer = this.drag?.racers.find((r) => r.lane === lane);
      if (racer) list.push({ id: `drag-bot-${lane}`, modelId: racer.modelId, x: DRAG_STRIP.laneX[lane as 0 | 1], z: bot.rz, rot: DRAG_STRIP.yaw });
    }
    this.dynamic.length = 0;
    this.theft.obstacles(list);
    vehicleObstacles(list, this.dynamic);
    this.traffic.boxesNear(this.curr.x, this.curr.z, 70, this.dynamic);
    this.police.boxesNear(this.curr.x, this.curr.z, 70, this.dynamic);
    this.world.grip = this.forcedRain !== null ? 1 - 0.2 * Math.min(1, this.forcedRain / 0.7) : surfaceGrip(this.store.serverNow());
  }

  /** Lined up on the drag strip while staging: only the brakes work (the server does the same). */
  private get dragHold(): boolean {
    return !!this.drag && this.drag.phase === 'staging' && this.drag.racers.some((r) => r.playerId === this.store.playerId);
  }

  private step(): void {
    // A passenger has nothing to steer.
    if (this.riding) {
      this.prev = { ...this.curr };
      return;
    }
    let keys = this.input.keys();
    if (this.dragHold && this.driving) keys = (keys & KEY.HORN) | KEY.BRAKE;
    // Hands off while getting in / out, and during the arrest.
    if (this.busted || this.entities.boardingBusy(this.store.playerId)) keys = 0;
    const cmd: InputCmd = { seq: ++this.seq, dt: SIM_DT, keys, yaw: this.cam.yaw };
    if (keys !== 0 || Math.abs(cmd.yaw - this.lastYaw) > 1e-3) this.activeAt = performance.now();
    this.lastYaw = cmd.yaw;
    this.prev = { ...this.curr };
    if (this.driving && this.dyn) {
      const v = this.store.myVehicle(this.driving);
      if (v) {
        const params = vehicleParams(getModel(v.modelId), v.condition, v.fuel, v.mods);
        const r = stepVehicle(this.dyn, cmd, params, this.world, this.driving);
        const info = this.stepInfo;
        info.abs ||= r.abs;
        info.locked ||= r.locked;
        info.sliding ||= r.sliding;
        info.wheelspin = Math.max(info.wheelspin, r.wheelspin);
        info.shifted += r.shifted;
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
    const cockpit = this.cockpitActive();
    if (this.input.enabled && !this.busted) {
      if (cockpit) {
        const k = 0.0025 * this.cam.sensitivity;
        this.lookYaw = Math.max(-1.9, Math.min(1.9, this.lookYaw - mouse.dx * k));
        this.lookPitch = Math.max(-0.7, Math.min(0.5, this.lookPitch - mouse.dy * k * (this.cam.invertY ? -1 : 1)));
      } else this.cam.applyMouse(mouse.dx, mouse.dy);
    }

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
    let rx = this.prev.x + (this.curr.x - this.prev.x) * alpha + this.offset.x;
    let rz = this.prev.z + (this.curr.z - this.prev.z) * alpha + this.offset.y;
    const rrot = this.curr.rot;
    // A passenger is wherever the car is drawn.
    const carried = this.riding ? this.entities.vehicles.get(this.riding.vehicleId) : undefined;
    if (carried) {
      rx = carried.x;
      rz = carried.z;
    }

    const keys = this.input.keys();
    const moving = (keys & (KEY.FORWARD | KEY.BACK | KEY.LEFT | KEY.RIGHT)) !== 0;
    const busyHands = (this.working || !!this.theft.job) && !this.driving;
    const anim = moving ? (keys & KEY.SPRINT ? Anim.Run : Anim.Walk) : busyHands ? Anim.Interact : Anim.Idle;
    let flags = 0;
    if (this.dyn && this.driving) {
      if (this.dyn.brk > 0.05) flags |= VF.BRAKE;
      if (this.dyn.gear < 0) flags |= VF.REVERSE;
      if ((this.dyn.nitro ?? 0) > 0) flags |= VF.NITRO;
    }
    this.entities.hideLocalDriver = cockpit && !this.busted;
    document.body.classList.toggle('cockpit-view', cockpit && !this.busted);
    this.renderer.overlay = cockpit && !this.busted;
    this.entities.update(dt, now, {
      id: this.store.playerId,
      x: rx,
      z: rz,
      rot: rrot,
      anim,
      driving: this.driving,
      riding: this.riding,
      speed: this.dyn?.speed ?? 0,
      steer: this.dyn?.steer ?? 0,
      flags,
    });

    const camera = this.renderer.camera;
    const fov = cockpit && !this.busted ? COCKPIT_FOV : CHASE_FOV;
    // A nitrous shot widens the view a little (speed rush).
    this.fovKick += ((this.nitroLeft() > 0 ? 9 : 0) - this.fovKick) * Math.min(1, dt * 4);
    if (this.fovKick < 0.05) this.fovKick = 0;
    if (camera.fov !== fov + this.fovKick) {
      const switched = Math.abs(camera.fov - (fov + this.fovKick)) > 10;
      camera.fov = fov + this.fovKick;
      camera.updateProjectionMatrix();
      if (switched) this.cam.snap();
    }
    if (this.busted) {
      this.busted.update(dt, camera);
      if (this.busted.done && (!this.driving || this.busted.t > this.busted.duration + 1.5)) this.endBusted();
    } else if (cockpit) this.updateCockpitCamera(dt);
    else if (carried) {
      // Riding along: the chase camera follows the car (it has just been placed this frame).
      if (performance.now() - this.input.lastMouseMove > 1500) this.cam.follow(carried.rot, dt);
      this.cam.update(new THREE.Vector3(carried.x, groundHeight(carried.x, carried.z), carried.z), dt, true, carried.lastSpeed, this.boxes);
    } else {
      if (this.driving && this.dyn && performance.now() - this.input.lastMouseMove > 1500) this.cam.follow(this.dyn.rot, dt);
      const target = new THREE.Vector3(rx, groundHeight(rx, rz), rz);
      this.cam.update(target, dt, !!this.driving, this.dyn?.speed ?? 0, this.boxes);
    }
    if (this.debugCam) {
      const [cx, cy, cz, lx, ly, lz] = this.debugCam as [number, number, number, number, number, number];
      this.renderer.camera.position.set(cx, cy, cz);
      this.renderer.camera.lookAt(lx, ly, lz);
      this.renderer.followShadows(lx, lz);
    } else this.renderer.followShadows(rx, rz);

    this.updateInteraction(rx, rz);
    const drivenVeh = this.driving ? this.store.myVehicle(this.driving) : undefined;
    const drivenModel = drivenVeh ? getModel(drivenVeh.modelId) : null;
    const drivenStats = drivenModel && drivenVeh ? calculateVehicleStats(drivenModel, drivenVeh.mods.tuning) : null;
    const params = drivenModel && drivenVeh ? vehicleParams(drivenModel, drivenVeh.condition, drivenVeh.fuel, drivenVeh.mods) : null;
    const stage = Number(/stage(\d)/.exec(drivenVeh?.mods.tuning?.perf.ecu ?? '')?.[1] ?? 0);
    const info = this.stepInfo;
    const dyn = this.dyn;
    // Riding along: hear the car's engine from what the snapshots say.
    const rideSnap = carried?.buffer.latest;
    const rideStats = carried ? calculateVehicleStats(getModel(carried.data.modelId), carried.data.mods.tuning) : null;
    this.audio.engine({
      driving: (!!this.driving && !!dyn) || !!rideSnap,
      speed: dyn?.speed ?? carried?.lastSpeed ?? 0,
      topSpeed: params?.topSpeed ?? 30,
      throttle: (dyn?.thr ?? 0) > 0.2 || (!!carried && carried.accel > 0.5),
      profile: drivenStats?.sound ?? rideStats?.sound ?? null,
      redline: drivenStats?.redline ?? rideStats?.redline ?? 6500,
      dt,
      rpm: dyn?.rpm ?? rideSnap?.rpm,
      gear: dyn?.gear ?? rideSnap?.gear,
      boost: dyn?.boost,
      pedal: dyn?.thr,
      shifted: info.shifted,
      stage,
      wheelspin: info.wheelspin,
      sliding: info.sliding,
      locked: info.locked,
    });
    // Cockpit gauge cluster and the first-person interior.
    if (dyn && params) {
      const pt = params.pt;
      const kmh = Math.abs(dyn.speed) * KMH_PER_MS;
      const maxPsi = pt.turbo?.maxPsi ?? 0;
      this.ui?.cluster.draw({ kmh, rpm: dyn.rpm, redline: pt.redline, gear: dyn.gear, psi: maxPsi * dyn.boost, maxPsi, electric: pt.electric, stage, abs: info.abs || info.locked, slip: info.wheelspin > 0.12, limiter: dyn.rpm >= pt.redline * 0.995 }, dt);
      this.cockpit?.rig.update({ kmh, rpm: dyn.rpm, gear: dyn.gear, steer: dyn.input, wheelTurns: pt.wheelTurns, throttle: dyn.thr, brake: dyn.brk, automatic: !/manual/i.test(pt.gearbox), electric: pt.electric, dt });
    }
    this.stepInfo = { abs: false, wheelspin: 0, sliding: false, locked: false, shifted: 0 };
    // Police cars, their sirens, and the rain.
    this.police.night = this.night;
    this.police.update(dt, now);
    this.audio.siren(this.police.nearestSiren(rx, rz));
    this.audio.rain(this.weather.rain);
    this.rain.update(dt, camera, this.weather.rain, this.renderer.graphics === 'low' ? 0.35 : this.renderer.graphics === 'medium' ? 0.65 : 1);
    this.missionTimer -= dt;
    if (this.missionTimer <= 0) {
      this.missionTimer = 1;
      this.ui?.missions.tick(this.store.serverNow());
    }
    // The gift box's playtime clock runs on while the player is active (the server counts the same way).
    const active = now - this.activeAt < ECONOMY.rewards.activeTimeoutSec * 1000 || Math.abs(carried?.lastSpeed ?? 0) > 1;
    this.ui?.rewardsHud.update(Math.min(1, raw), active);
    this.effects.update(dt);
    this.city.update(dt);
    // Car theft: street cars and alarms, the work on lifted cars, the lifts' arms.
    this.theft.update(dt, { x: rx, z: rz });
    const lifts = [0, 0];
    for (const e of this.entities.vehicles.values()) if (e.data.mods.strip) lifts[e.data.mods.strip.bay] = e.lift;
    lifts.forEach((y, bay) => this.sanayi.setLift(bay, y));
    this.sanayi.update(dt, rx, rz, this.night);
    // Horn + headlight flash (traffic ahead moves over).
    const horn = !!this.driving && (keys & KEY.HORN) !== 0 && this.input.enabled;
    if (horn !== this.hornOn) {
      this.hornOn = horn;
      this.audio.horn(horn);
    }
    this.flash = horn ? 1 : Math.max(0, this.flash - dt * 4);
    this.entities.flash = this.flash;
    this.traffic.update(dt);
    this.trafficView.update(this.traffic.cars.values(), this.renderer.camera, dt);
    this.updateDragBots(dt);
    this.dayTimer -= dt;
    if (this.dayTimer <= 0) {
      this.dayTimer = 0.5;
      this.updateDayNight();
    }
    this.ui?.nearMiss.update();
    this.ui?.dragHud.update(this.store.serverNow());
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

  // ------------------------------------------------------------ highway, drag strip, time of day

  private updateDayNight(): void {
    const now = this.store.serverNow();
    const hour = this.forcedHour ?? gameHour(now);
    this.weather = this.forcedRain !== null ? { rain: this.forcedRain, wet: this.forcedRain } : { rain: rainAt(now), wet: wetnessAt(now) };
    setRoadWetness(this.weather.wet);
    const night = this.renderer.setTime(hour, this.weather.rain);
    this.night = night;
    this.city.setNight(night);
    this.highway.setNight(night);
    this.trafficView.setNight(night);
    this.entities.night = night;
  }

  private onDrag(d: DragRaceView | null): void {
    const prev = this.drag;
    this.drag = d;
    const me = this.store.playerId;
    const mine = !!d && d.racers.some((r) => r.playerId === me);
    if (mine && d) {
      if (d.lights !== (prev?.id === d.id ? prev.lights : 0)) {
        if (d.lights >= 1 && d.lights <= 3) this.audio.play('treeRed');
        else if (d.lights === 4) this.audio.play('treeGreen');
      }
      const my = d.racers.find((r) => r.playerId === me);
      const prevMy = prev?.racers.find((r) => r.playerId === me);
      if (my?.result?.outcome === 'false_start' && prevMy?.result?.outcome !== 'false_start') this.audio.play('foul');
      if (d.phase === 'finished' && prev?.phase !== 'finished') this.audio.play(d.winner !== null && my?.lane === d.winner ? 'levelup' : 'error');
    }
    // 3D tree lights (everyone near the strip sees them).
    const foul: [boolean, boolean] = [0, 1].map((lane) => d?.racers.find((r) => r.lane === lane)?.result?.outcome === 'false_start') as [boolean, boolean];
    this.highway.tree.set(d && d.phase !== 'finished' ? d.lights : 0, foul);
    this.ui?.dragHud.set(d, me);
    // Bot cars.
    const wanted = new Set((d?.racers ?? []).filter((r) => r.bot).map((r) => r.lane as number));
    for (const [lane, bot] of this.dragBots) {
      if (!wanted.has(lane) || !d) {
        bot.view.root.removeFromParent();
        bot.view.dispose();
        this.dragBots.delete(lane);
      }
    }
    for (const r of d?.racers ?? []) {
      if (!r.bot || this.dragBots.has(r.lane)) continue;
      const view = createVehicleView({
        modelId: r.modelId,
        color: r.color,
        mods: { paint: null, wheels: 'stock', tint: 'none', bodyKit: 'none', headlights: 'stock', accessory: 'none', tuning: r.tuning ?? undefined },
        condition: { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 },
      });
      const z = DRAG_STRIP.startZ + getModel(r.modelId).shape.length / 2;
      this.renderer.scene.add(view.root);
      this.dragBots.set(r.lane, { view, z, speed: 0, rz: z });
    }
    // Close panels once when the race starts (the tree and results are on the HUD).
    if (mine && prev?.id !== d?.id) this.ui?.closeAll();
  }

  private updateDragBots(dt: number): void {
    for (const [lane, bot] of this.dragBots) {
      // Extrapolate between the 20 Hz updates, then ease towards them.
      bot.z -= bot.speed * dt;
      bot.rz += (bot.z - bot.rz) * Math.min(1, dt * 12);
      bot.view.root.position.set(DRAG_STRIP.laneX[lane as 0 | 1], 0, bot.rz);
      bot.view.root.rotation.y = DRAG_STRIP.yaw;
      bot.view.animate(bot.speed, 0, dt);
    }
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
    const view = createVehicleView(best.vehicle);
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
    let vehicleAction: Interaction | null = null;
    let vehicleD = Infinity;
    if (this.riding) {
      // A passenger can only get out.
      const ride = this.entities.vehicles.get(this.riding.vehicleId);
      const driverId = [...this.entities.players.entries()].find(([, p]) => p.driving === this.riding?.vehicleId)?.[0] ?? null;
      best = { id: 'exit-ride', label: 'Arabadan in', sub: `Yolcu: ${ride ? modelDisplayName(ride.data.modelId) : ''}${driverId ? ` · ${this.store.playerName(driverId)}` : ''}`, action: () => void this.exitVehicle(), vehicle: true };
      vehicleAction = best;
    } else if (this.driving) {
      const v = this.store.myVehicle(this.driving);
      best = { id: 'exit', label: `Exit ${v ? modelDisplayName(v.modelId) : 'vehicle'}`, action: () => void this.exitVehicle(), vehicle: true };
      vehicleAction = best;
      for (const i of INTERACTABLES) {
        if ((i.kind === 'fuel' || i.kind === 'wash') && Math.hypot(i.x - x, i.z - z) <= i.radius + 3) {
          secondary = { id: i.id, label: i.kind === 'fuel' ? 'Refuel this vehicle' : 'Drive-through wash', action: () => this.ui.open(i.kind, { vehicleId: this.driving }) };
        }
        if (i.kind === 'drag' && Math.hypot(i.x - x, i.z - z) <= i.radius + 2 && !this.drag?.racers.some((r) => r.playerId === me)) {
          secondary = { id: i.id, label: 'Drag race: $250 entry, win $500', action: () => this.ui.open('drag') };
        }
      }
      // A stolen car lined up between a Sanayi lift's posts: F puts it up (exit moves to G).
      if (v?.status === 'stolen' && !isLifted(v.mods) && this.dyn) {
        const bay = this.theft.bayFor(this.dyn.x, this.dyn.z, this.dyn.rot);
        const id = v.id;
        if (bay >= 0) {
          const exit = best;
          best = { id: `lift-${bay}`, label: 'Aracı Lifte Kaldır', sub: `Lift ${bay + 1}`, action: () => void this.liftCar(id), vehicle: true };
          vehicleAction = best;
          secondary = { ...exit, label: 'Exit', vehicle: false };
        } else if (this.inHall(x, z)) {
          secondary = { id: 'lift-hint', label: 'Stop between the lift posts', action: () => this.ui.toast({ kind: 'info', title: 'Sanayi lift', text: 'Drive in straight between the two yellow posts of a free lift, stop, then press F.' }) };
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
      // Lockpicking a parked car.
      const street = this.theft.nearestCar(x, z);
      if (street) consider(street.d, this.lockpickInteraction(street.car));
      // Working on my car on a Sanayi lift: the part at this spot, or the engine bay.
      const spot = this.theft.nearestTarget(x, z);
      if (spot) {
        const job = this.theft.job;
        const it: Interaction = job
          ? { id: 'strip-busy', label: `Sökülüyor: ${partLabelTr(job.part)}`, sub: 'Stay here until it comes off', action: () => undefined }
          : spot.part === 'bay'
            ? { id: `bay-${spot.vehicleId}`, label: 'Motor Bölmesini Aç', sub: 'Engine block, gearbox, turbo, ECU, radiator...', action: () => this.ui.open('engineBay', { vehicleId: spot.vehicleId }) }
            : { id: `strip-${spot.part}`, label: `Sök: ${spot.label}`, sub: `${spot.seconds}s · Sökülmüş Parça for the Pawn Shop`, action: () => void this.theft.startStrip(spot.vehicleId, spot.part as Exclude<typeof spot.part, 'bay'>) };
        consider(Math.max(0, Math.hypot(spot.x - x, spot.z - z) - 1), it);
      }
      // Someone else's car with the driver in it: get in as a passenger.
      const riders = new Map<string, number>();
      for (const p of this.entities.players.values()) if (p.riding) riders.set(p.riding.vehicleId, (riders.get(p.riding.vehicleId) ?? 0) + 1);
      for (const [pid, p] of this.entities.players) {
        if (pid === me || !p.driving) continue;
        const e = this.entities.vehicles.get(p.driving);
        if (!e || e.view.isBike) continue;
        const seats = passengerSeats(getModel(e.data.modelId));
        const free = seats - (riders.get(e.data.id) ?? 0);
        const d = Math.hypot(e.x - x, e.z - z);
        if (free <= 0 || d > e.view.length / 2 + 2.6 || Math.abs(e.lastSpeed) > 2) continue;
        const vid = e.data.id;
        const it: Interaction = { id: `ride-${vid}`, label: 'Yolcu olarak bin', sub: `${this.store.playerName(pid)} · ${modelDisplayName(e.data.modelId)} · ${free} boş koltuk`, action: () => void this.rideVehicle(vid), vehicle: true };
        consider(d, it);
        if (d < vehicleD) {
          vehicleD = d;
          vehicleAction = it;
        }
      }
      for (const e of this.entities.vehicles.values()) {
        const stolen = e.data.ownerId === me && e.data.status === 'stolen';
        const ownParked = e.data.ownerId === me && (e.data.status === 'world' || (stolen && !isLifted(e.data.mods)));
        // Own parked vehicles can be entered from a little further away (server allows 5m + half length).
        const reach = e.view.length / 2 + (ownParked ? 3.4 : 1.4);
        const d = Math.hypot(e.x - x, e.z - z);
        if (d > reach) continue;
        const v = e.data;
        if (e.kind === 'market' && e.listing) {
          const l = e.listing;
          consider(d, { id: v.id, label: `Inspect ${modelDisplayName(v.modelId)}`, sub: `Asking ${formatMoney(l.askingPrice)} - seller: ${l.sellerName}`, action: () => this.ui.open('inspect', { listingId: l.id }) });
        } else if (ownParked) {
          const it: Interaction = { id: v.id, label: `Drive ${modelDisplayName(v.modelId)}`, sub: stolen ? 'Stolen - take it to the Sanayi (🔧 on the map)' : `Fuel ${Math.round(v.fuel)}%`, action: () => void this.enterVehicle(v.id), vehicle: true };
          consider(d, it);
          if (d < vehicleD) {
            vehicleD = d;
            vehicleAction = it;
          }
        } else if (v.ownerId === me && v.status === 'displayed') {
          consider(d, { id: v.id, label: `Manage display: ${modelDisplayName(v.modelId)}`, sub: v.salePrice ? `Listed at ${formatMoney(v.salePrice)}` : 'Not for sale', action: () => this.ui.open('dealership') });
        } else if (v.status === 'displayed' && v.salePrice !== null) {
          consider(d, { id: v.id, label: `View ${modelDisplayName(v.modelId)}`, sub: `For sale: ${formatMoney(v.salePrice)}`, action: () => this.ui.open('playerListing', { vehicleId: v.id }) });
        }
      }
    }
    this.interaction = best;
    this.secondary = secondary;
    this.vehicleAction = this.busted ? null : vehicleAction;
    if (this.busted) {
      this.interaction = null;
      this.secondary = null;
    }
    this.ui?.setPrompt(this.interaction, this.secondary);
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
    // Behind the wheel: N fires a nitrous shot, K works the air ride.
    if (this.driving && code === 'KeyN') {
      void this.useNitro();
      return;
    }
    if (this.driving && code === 'KeyK') {
      void this.airRide();
      return;
    }
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
    if (code === 'KeyE') this.interact();
    else if (code === 'KeyF') this.vehicleKey();
    else if (code === 'KeyG') this.interactSecondary();
    else if (code === 'KeyC') this.toggleCockpit();
    else if (code === 'KeyL') this.ui.missions.toggle();
  }

  /** Seconds left of the nitrous shot burning in the car being driven. */
  nitroLeft(): number {
    return this.driving ? (this.dyn?.nitro ?? 0) : 0;
  }

  /** Special Nitro: a few seconds of extra torque (one item per shot). */
  async useNitro(): Promise<void> {
    if (!this.driving || !this.dyn || (this.dyn.nitro ?? 0) > 0) return;
    if ((this.store.me?.inventory[NITRO_ITEM] ?? 0) < 1) {
      this.ui?.toast({ kind: 'info', title: 'Special Nitro yok', text: '7 günlük giriş serisinin 6. gün ödülü: 3 tüp Special Nitro.' });
      this.audio.play('error');
      return;
    }
    try {
      const r = await this.net.rpc('vehicle.nitro', {});
      // The server burns the same shot; predict it right away.
      if (this.dyn) this.dyn.nitro = r.seconds;
      this.audio.play('nitro');
    } catch (err) {
      this.ui?.error(err);
    }
  }

  /** Air ride: normal, low, slammed (K while driving). */
  async airRide(): Promise<void> {
    const id = this.driving;
    const v = id ? this.store.myVehicle(id) : undefined;
    if (!v) return;
    if (!hasAirRide(v.mods.tuning)) {
      this.ui?.toast({ kind: 'info', title: 'Air süspansiyon yok', text: 'Chroma Customs > Performance > Suspension: "Air Ride Suspension" tak, sonra sürerken K ile indir / kaldır.' });
      return;
    }
    try {
      const r = await this.net.rpc('vehicle.air', {});
      this.audio.play('air');
      this.ui?.toast({ kind: 'info', title: `Air ride: ${AIR_LEVELS[r.level]}`, text: r.level === 2 ? 'Yere yapıştı!' : r.level === 1 ? 'Alçaltıldı.' : 'Normal sürüş yüksekliği.' });
    } catch (err) {
      this.ui?.error(err);
    }
  }

  private inHall(x: number, z: number): boolean {
    const h = SANAYI.hall;
    return x > h.minX && x < h.maxX && z > h.minZ - 4 && z < h.maxZ;
  }

  /** The prompt next to a parked car: pick its lock (with a set), or where to get a set. */
  private lockpickInteraction(car: StreetCar): Interaction {
    const name = modelDisplayName(car.modelId);
    if (this.theft.alarmOn(car.id)) return { id: `lp-${car.id}`, label: 'Alarm çalıyor!', sub: `${name} - come back when it stops`, action: () => this.audio.play('error') };
    const sets = this.store.lockpicks();
    if (sets <= 0) return { id: `lp-${car.id}`, label: 'Lockpick Et', sub: `${name} - you need a Lockpick & Testere Seti (Black Market)`, action: () => this.ui.open('market', { tab: 'black' }) };
    return { id: `lp-${car.id}`, label: 'Lockpick Et', sub: `${name} · ${sets} set${sets === 1 ? '' : 's'}${car.highway ? ' · broken down' : ''}`, action: () => void this.startLockpick(car.id) };
  }

  /** Start picking a parked car's lock (uses a set) and open the mini-game. */
  async startLockpick(carId: string): Promise<void> {
    try {
      const r = await this.net.rpc('lockpick.start', { carId });
      this.ui.open('lockpick', { ...r, carId });
    } catch (err) {
      this.ui.error(err);
    }
  }

  /** Put the stolen car being driven up on the lift it is lined up in. */
  async liftCar(vehicleId: string): Promise<void> {
    try {
      const { vehicle } = await this.net.rpc('sanayi.lift', { vehicleId });
      setTimeout(() => this.audio.play('lift'), LIFT_DELAY * 1000);
      this.ui.toast({ kind: 'success', title: 'Araç lifte kaldırıldı', text: `${modelDisplayName(vehicle.modelId)} is going up. Walk to the glowing markers and press E to strip it.` });
    } catch (err) {
      this.ui.error(err);
    }
  }

  /** F: get into the nearest own car, or out of the one being driven. */
  vehicleKey(): void {
    if (!this.vehicleAction || this.ui?.anyOpen() || this.busted) return;
    this.audio.play('click');
    this.vehicleAction.action();
  }

  /** C / camera button: chase camera <-> first-person cockpit. */
  toggleCockpit(): void {
    this.cockpitOn = !this.cockpitOn;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.audio.play('click');
  }

  /** Is the cockpit view on this frame (driving a car, seated, no cutscene)? Builds / drops the rig. */
  private cockpitActive(): boolean {
    const id = this.driving;
    const e = id ? this.entities.vehicles.get(id) : undefined;
    const on = this.cockpitOn && !!id && !!e && !e.view.isBike && !this.busted && this.entities.boardingLeft(this.store.playerId) === 0;
    if (!on || !e || !id) {
      if (this.cockpit) {
        this.cockpit.rig.dispose();
        this.cockpit = null;
      }
      return false;
    }
    if (this.cockpit?.id !== id) {
      this.cockpit?.rig.dispose();
      this.cockpit = { id, rig: new CockpitRig(e.view as VehicleView) };
    }
    return true;
  }

  /** First person: the camera at the driver's eyes, moving with the body; the mouse looks around. */
  private updateCockpitCamera(dt: number): void {
    const e = this.driving ? this.entities.vehicles.get(this.driving) : undefined;
    if (!e) return;
    const view = e.view as VehicleView;
    if (performance.now() - this.input.lastMouseMove > 1500) {
      this.lookYaw *= Math.exp(-dt * 3);
      this.lookPitch *= Math.exp(-dt * 3);
    }
    view.root.updateMatrixWorld(true);
    // A touch above and behind the eye point, so the wheel and dials are in view.
    const eye = (view.info?.seat ?? new THREE.Vector3(0.38, 1.15, 0)).clone().add(new THREE.Vector3(0, 0.05, -0.12));
    const camera = this.renderer.camera;
    camera.position.copy(view.body.localToWorld(eye));
    const body = view.body.getWorldQuaternion(new THREE.Quaternion());
    // Glance into the corner a little with the steering.
    const glance = (this.dyn?.input ?? 0) * 0.12;
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch - 0.15, Math.PI + this.lookYaw + glance, 0, 'YXZ'));
    camera.quaternion.copy(body).multiply(look);
  }

  private onMissions(missions: MissionView[]): void {
    this.ui?.missions.set(missions);
    this.ui?.setMissionsPending(missions.filter((m) => !m.done).length);
  }

  /** Arrested: play the cutscene (the server releases the player at a garage when it ends). */
  private startBusted(e: BustedEvent): void {
    this.endBusted();
    const id = this.driving;
    const view = id ? this.entities.vehicles.get(id)?.view : undefined;
    this.ui?.closeAll();
    this.audio.horn(false);
    this.busted = new BustedCutscene(e, this.store.playerId, this.renderer.scene, this.entities, this.police, view ? id : null, view ? view.width / 2 : 0.3, () => {
      this.ui?.wanted.busted(e);
      this.audio.play('foul');
    });
  }

  private endBusted(): void {
    if (!this.busted) return;
    this.busted.dispose();
    this.busted = null;
    this.cam.snap();
  }

  /** Run the current primary interaction (E key, prompt tap, touch action button). */
  interact(): void {
    if (!this.interaction || this.ui?.anyOpen()) return;
    this.audio.play('click');
    this.interaction.action();
  }

  /** Run the current secondary interaction (F key: fuel station or car wash while driving). */
  interactSecondary(): void {
    if (!this.secondary || this.ui?.anyOpen()) return;
    this.audio.play('click');
    this.secondary.action();
  }

  async enterVehicle(id: string): Promise<void> {
    try {
      await this.net.rpc('vehicle.enter', { vehicleId: id });
    } catch (err) {
      this.ui.error(err);
    }
  }

  /** Get into someone else's car as a passenger. */
  async rideVehicle(id: string): Promise<void> {
    try {
      await this.net.rpc('vehicle.ride', { vehicleId: id });
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

  /** An arrest cutscene is playing. */
  get inCutscene(): boolean {
    return this.busted !== null;
  }

  /** Debug: what the camera sees at a screen point (normalised -1..1), nearest first. */
  debugPick(x: number, y: number): { name: string; parent: string; material: string; distance: number }[] {
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(x, y), this.renderer.camera);
    return r
      .intersectObjects(this.renderer.scene.children, true)
      .filter((h) => (h.object as THREE.Mesh).isMesh && h.object.visible)
      .slice(0, 5)
      .map((h) => ({ name: h.object.name, parent: h.object.parent?.name ?? '', material: ((h.object as THREE.Mesh).material as THREE.Material).name, distance: Math.round(h.distance * 100) / 100 }));
  }

  /** Test/debug hook: read-only snapshot of client state. */
  debugState() {
    return {
      playerId: this.store.playerId,
      connected: this.net.socket.connected,
      snapshots: this.snapshotsReceived,
      position: { ...this.curr },
      yaw: this.cam.yaw,
      driving: this.driving,
      riding: this.riding,
      money: this.store.me?.money ?? null,
      bank: this.store.me?.bank ?? null,
      level: this.store.me?.level ?? null,
      vehicles: this.store.myVehicles().map((v) => ({ id: v.id, modelId: v.modelId, status: v.status, salePrice: v.salePrice, strip: v.mods.strip ?? null })),
      streetCars: [...this.store.street.values()].map((c) => ({ id: c.id, modelId: c.modelId, x: c.x, z: c.z, rot: c.rot, highway: c.highway })),
      lockpicks: this.store.lockpicks(),
      inventory: { ...(this.store.me?.inventory ?? {}) },
      stripJob: this.theft.job ? { part: this.theft.job.part, vehicleId: this.theft.job.vehicleId } : null,
      prompt: this.interaction ? { label: this.interaction.label, sub: this.interaction.sub ?? null, vehicle: !!this.interaction.vehicle } : null,
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

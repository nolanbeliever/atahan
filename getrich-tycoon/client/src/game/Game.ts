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
import { LIFT_BAYS, SANAYI, isLifted, partLabelTr, type StreetCar } from '../../../shared/theft';
import { AIR_LEVELS, hasAirRide } from '../../../shared/modificationsData';
import { NITRO_ITEM } from '../../../shared/rewards';
import { cameraSeeing } from '../../../shared/cctv';
import { RACE, raceRoute, type StreetRaceView } from '../../../shared/streetRace';
import { recoilKick, type WeaponDef } from '../../../shared/weapons';
import { confetti } from '../ui/confetti';
import { Anim, VF, type Auction, type PlayerSettings, type Snapshot } from '../../../shared/types';
import { findShowroom, type TestDriveEnd } from '../../../shared/showrooms';
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
import { City, groundHeight, surfaceY } from '../render/City';
import { FarShoreView } from '../render/FarShore';
import { ShowroomsView } from '../render/Showrooms';
import { TollsView } from '../render/Tolls';
import { AlleysView } from '../render/Alleys';
import { HeistsView } from '../render/Heists';
import { DealCarsView } from '../render/DealCars';
import { RepairCarsView } from '../render/RepairCars';
import { JOB_BOARD, MECH, TASK_LABEL, taskPoint, type MechanicView, type RepairTask } from '../../../shared/mechanic';
import { DealCutscene } from './DealScene';
import { DEALS, findDrop, type TgState } from '../../../shared/telegram';
import { HEISTS, type HeistId, type HeistView } from '../../../shared/heists';
import { StraitView } from '../render/Strait';
import { DealershipsView } from '../render/Dealerships';
import { HighwayView } from '../render/Highway';
import { TrafficView } from '../render/TrafficView';
import { Effects } from '../render/Effects';
import { Renderer } from '../render/Renderer';
import { BikeView, createVehicleView, type AnyVehicleView, type VehicleView } from '../render/VehicleMesh';
import { CockpitRig } from '../render/Cockpit';
import { GunView } from '../render/GunView';
import { Rain, setRoadWetness } from '../render/Weather';
import { SanayiView } from '../render/Sanayi';
import { CctvView } from '../render/Cctv';
import { RaceClient } from './StreetRace';
import { CombatClient } from './Combat';
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
/** Looking down the sights: a touch narrower than the chase view. */
const SIGHTS_FOV = 56;
/** Eye height on foot (m). */
const EYE_HEIGHT = 1.62;

const MAX_PENDING = 150;

export class Game {
  readonly renderer: Renderer;
  readonly city = new City();
  readonly dealerships = new DealershipsView();
  readonly highway = new HighwayView();
  readonly strait = new StraitView();
  readonly farShore = new FarShoreView();
  readonly showrooms = new ShowroomsView();
  readonly tolls = new TollsView();
  readonly alleys = new AlleysView();
  readonly heistsView = new HeistsView();
  /** Telegram deal cars, and the cockpit handover going on (null: none). */
  readonly dealCars = new DealCarsView(() => this.store.playerId);
  readonly repairCars = new RepairCarsView(() => this.store.playerId);
  /** My shift as the Sanayi's part-time mechanic. */
  mech: MechanicView | null = null;
  private dealScene: DealCutscene | null = null;
  /** Heist targets whose alarm is ringing; my dirty money. */
  readonly heistAlarms = new Set<HeistId>();
  dirty = 0;
  /** 0 in the city - 1 on the far shore (sky and fog tint). */
  private zone = 0;
  private zoneAt = performance.now();
  readonly traffic = new TrafficClient();
  readonly trafficView = new TrafficView();
  readonly sanayi = new SanayiView();
  readonly cctv = new CctvView();
  readonly race = new RaceClient(() => this.store.playerId);
  combat!: CombatClient;
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
  /** First person with a gun drawn: up / down aim (rad), the recoil on top of it, the gun model. */
  private aimPitch = 0;
  private recoil = { pitch: 0, yaw: 0, burst: 0, at: 0, recover: 4 };
  private fpsWas = false;
  private gunView!: GunView;
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
    this.renderer.scene.add(this.city.group, this.dealerships.group, this.highway.group, this.strait.group, this.farShore.group, this.showrooms.group, this.tolls.group, this.alleys.group, this.heistsView.group, this.dealCars.group, this.repairCars.group, this.trafficView.group, this.sanayi.group, this.cctv.group, this.race.group);
    this.effects = new Effects(this.renderer.scene);
    this.combat = new CombatClient(this);
    this.gunView = new GunView(this.renderer.scene);
    this.combat.onChange = () => this.updateGunHud();
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
      this.ui?.pursuit.set(null);
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
      this.combat.equipped = null;
      this.entities.players.get(w.playerId)?.view.setWeapon(0);
      void this.net
        .rpc('combat.health', {})
        .then((v) => this.store.setHealth(v))
        .catch(() => undefined);
      void this.net
        .rpc('race.info', {})
        .then((r) => this.onRace(r.race))
        .catch(() => undefined);
      void this.net
        .rpc('rewards.info', {})
        .then((r) => this.store.setRewards(r))
        .catch(() => undefined);
      void this.net
        .rpc('hitman.info', {})
        .then((r) => this.store.setContract(r.contract))
        .catch(() => undefined);
      void this.net
        .rpc('tg.state', {})
        .then((t) => this.onTg(t))
        .catch(() => undefined);
      void this.net
        .rpc('heist.status', {})
        .then((r) => {
          for (const id of [...this.heistAlarms]) this.setHeistAlarm(id, false);
          for (const id of r.alarms) this.setHeistAlarm(id, true);
          this.onHeist(r.heist);
        })
        .catch(() => undefined);
      // A test drive never survives a reconnect (the car went back when the connection dropped).
      this.store.setTestDrive(null);
      // Nor a mechanic's shift.
      this.onMech(null);
    });
    this.store.on('contract', (c) => {
      this.ui?.hitman.set(c);
      this.entities.contractMark = c?.markId ?? null;
    });
    net.on('hitman.update', (c) => this.store.setContract(c));
    // Heists: my job, the alarms, the loot, the dirty money.
    net.on('heist.update', (v) => this.onHeist(v));
    net.on('heist.alarm', (a) => {
      this.setHeistAlarm(a.id, a.on);
    });
    net.on('heist.done', (d) => {
      this.ui?.wanted.heistDone(d.title, d.loot);
      this.audio.play('reward');
    });
    net.on('heist.cashed', (d) => {
      // After the ESCAPED banner that comes with it.
      window.setTimeout(() => {
        this.ui?.wanted.heistCashed(d.amount, d.xp);
        confetti(window.innerWidth / 2, window.innerHeight * 0.4, 120);
        this.audio.play('levelup');
      }, 3200);
    });
    net.on('heist.lost', (d) => {
      this.ui?.wanted.heistLost(d.reason === 'busted' ? 'GANİMETE EL KONULDU' : d.reason === 'wasted' ? 'ÇANTA GİTTİ' : 'SOYGUN YATTI', d.text);
      this.audio.play('error');
    });
    net.on('crime.update', (c) => {
      this.dirty = c.dirty;
      this.store.setCrime(c);
      this.ui?.setDirty(c.dirty);
    });
    // Telegram dealing: the phone, the deal cars, the handovers.
    net.on('tg.update', (t) => this.onTg(t));
    net.on('deal.cars', (list) => this.dealCars.set(list));
    net.on('deal.done', (d) => {
      if (d.cop) this.audio.play('error');
      else this.audio.play(d.kind === 'buy' ? 'purchase' : 'coin');
    });
    net.on('deal.paid', (d) => {
      this.audio.play('coin');
      this.ui?.toast({ kind: 'success', title: `📦 @${d.name} paketi aldı`, text: `+${formatMoney(d.amount)} kara para` });
    });
    // The part-time mechanic at the Sanayi.
    net.on('mech.cars', (list) => this.repairCars.set(list));
    net.on('mech.update', (v) => this.onMech(v));
    net.on('mech.paid', (d) => {
      this.ui?.wanted.mechPaid(d.amount, d.owner, modelDisplayName(d.modelId));
      this.audio.play('coin');
    });
    net.on('crime.laundered', (d) => {
      this.audio.play('coin');
      this.effects.floatText(`+${formatMoney(d.amount)}`, new THREE.Vector3(this.localPosition().x, 2.4, this.localPosition().z), '#2ee59d');
    });
    this.store.on('testDrive', (v) => this.ui?.testDrive.set(v));
    net.on('testdrive.update', (v) => this.store.setTestDrive(v));
    net.on('testdrive.end', (d) => this.onTestDriveEnd(d.reason, d.modelId, d.fee));
    net.on('showroom.update', (d) => this.store.setShowroom(d));
    // Tolls, number-plate cameras and the police checkpoints at the bridges.
    net.on('toll.event', (e) => {
      this.store.addTollEvent(e);
      this.ui?.tollFeed.push(e, this.store.tollEvents);
      if (e.kind === 'toll') this.audio.play('toll');
      else if (e.kind === 'evasion') this.audio.play('tollFine');
      else if (e.kind === 'anpr' && e.stars > 0) this.audio.play('shutter');
    });
    net.on('toll.pass', (d) => this.tolls.pass(d.n, d.z, d.evaded));
    net.on('anpr.flash', (d) => this.tolls.flash(d.id));
    net.on('police.checkpoint', (d) => {
      this.ui?.wanted.checkpoint(d.name);
      this.audio.play('checkpoint');
    });
    net.on('police.breakthrough', (d) => {
      this.ui?.wanted.breakthrough(d.reward);
      if (d.reward > 0) {
        confetti(window.innerWidth / 2, window.innerHeight * 0.4, 90);
        this.audio.play('reward');
      }
    });
    net.on('police.crash', (d) => {
      const me = this.localPosition();
      if (Math.hypot(d.x - me.x, d.z - me.z) > 160) return;
      this.audio.play('crash');
      const at = new THREE.Vector3(d.x, surfaceY(d.x, d.z) + 0.7, d.z);
      this.combat.fx.sparks(at, 40);
      this.combat.fx.shards(at);
    });
    net.on('police.ram', (d) => {
      const me = this.localPosition();
      if (Math.hypot(d.x - me.x, d.z - me.z) < 120) this.audio.play('crash');
    });
    net.on('radar.flash', (f) => {
      this.ui?.flash();
      this.ui?.wanted.radar(f);
      this.strait.flash(f.radar);
      this.audio.play('shutter');
      if (f.newBest) this.audio.play('levelup');
    });
    net.on('hitman.done', (d) => {
      this.ui?.wanted.contract(d.title, `+${formatMoney(d.reward)} & ${d.xp} XP`);
      confetti(window.innerWidth / 2, window.innerHeight * 0.4, 90);
      this.audio.play('reward');
    });
    net.on('rewards.update', (v) => this.store.setRewards(v));
    net.on('race.update', (r) => this.onRace(r));
    net.on('race.checkpoint', () => this.audio.play('coin'));
    net.on('combat.shot', (sh) => this.combat.onShot(sh));
    net.on('combat.explosion', (e) => this.combat.onExplosion(e));
    net.on('combat.carHp', (d) => this.combat.onCarHp(d.id, d.hp, d.armor));
    net.on('combat.health', (v) => this.combat.onHealth(v));
    net.on('combat.wasted', (d) => this.combat.onWasted(d.lost, d.respawnInMs));
    net.on('pursuit.update', (p) => this.ui?.pursuit.set(p));
    net.on('pursuit.result', (r) => {
      if (r.outcome === 'success') {
        this.ui?.wanted.stolenOk(modelDisplayName(r.modelId));
        confetti(window.innerWidth / 2, window.innerHeight * 0.4, 120);
        this.audio.play('reward');
      } else if (r.outcome === 'seized') this.audio.play('error');
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
    net.on('police.spiked', (e) => {
      // Bang-bang: the tyres go, sparks fly.
      const me = this.localPosition();
      const d = Math.hypot(me.x - e.x, me.z - e.z);
      if (d > 140) return;
      // Run-flats: a few sparks off the spikes, no bang.
      this.combat.fx.sparks(new THREE.Vector3(e.x, 0.25, e.z), e.held ? 8 : 30);
      if (!e.held) this.audio.shot('pistol', Math.max(0.1, 0.6 * (1 - d / 140)));
    });
    net.on('moto.crash', (e) => {
      // Sparks off the tarmac (a shower of them from a helmet scraping along), a thud.
      const me = this.localPosition();
      const d = Math.hypot(me.x - e.x, me.z - e.z);
      if (d > 160) return;
      const helmet = e.riders.some((r) => r.helmet);
      this.combat.fx.sparks(new THREE.Vector3(e.x, 0.3, e.z), helmet ? 46 : 26);
      this.audio.boom(Math.max(0.05, 0.45 * (1 - d / 160)));
      if (e.riders.some((r) => r.id === this.store.playerId)) {
        this.combat.fx.shake = Math.max(this.combat.fx.shake, 0.5);
        this.ui?.toast({ kind: 'warning', title: e.flipped ? 'Motor devrildi!' : 'KAZA!', text: `${e.kmh} km/s` });
      }
    });
    net.on('police.escaped', (d) => {
      this.ui?.wanted.escaped(d.reward, d.xp, d.cars);
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
    s.on('health', (v) => this.ui?.combat.setHealth(v));
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
    this.combat?.onInventory();
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
      e.view.setWeapon(p[8] ?? 0);
      e.deck = p[9] ?? 0;
      e.lastSeen = now;
    }
    for (const v of s.v) {
      if (v[0] === this.driving) continue;
      const e = this.entities.vehicles.get(v[0]);
      if (!e) continue;
      e.driven = true;
      e.lastDriven = now;
      e.buffer.push({ t: now, x: v[1], z: v[2], r: v[3], a: v[4], b: v[5], rpm: v[6], gear: v[7], f: v[8] });
      e.wheelie = v[9] ?? 0;
      e.deck = v[8] & VF.DECK ? v[10] ?? 0 : 0;
    }
    const alive = new Set<string>();
    for (const n of s.n) {
      alive.add(n[0]);
      this.entities.upsertNpc(n[0], n[5], now, n[1], n[2], n[3], n[4]);
    }
    this.entities.pruneNpcs(alive);
    if (s.tr) this.traffic.apply(s.tr, (this.store.serverNow() - s.t) / 1000);
    if (s.po) this.police.apply(s.po, now);
    this.police.applySpikes(s.sp ?? [], now);
    if (s.ph) this.police.applyHelis(s.ph, now);
    if (s.sr) this.race.apply(s.sr);
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
    const [x, z, rot, drivingId, dynT, ridingId, seat, footDeck] = self;
    this.pending = this.pending.filter((c) => c.seq > ack);
    const before = { x: this.curr.x, z: this.curr.z };
    // Riding along: the server places us with the car; no prediction.
    const riding = ridingId ? { vehicleId: ridingId, seat: seat ?? 0 } : null;
    if ((riding?.vehicleId ?? null) !== (this.riding?.vehicleId ?? null)) {
      this.riding = riding;
      this.pending = [];
      this.offset.set(0, 0);
      this.char = { x, z, rot, gait: 0, deck: footDeck ?? 0 };
      this.curr = { x, z, rot };
      this.prev = { ...this.curr };
      this.audio.play('door');
      if (!riding) this.cam.snap();
    }
    if (this.riding) {
      this.curr = { x, z, rot };
      this.char = { x, z, rot, gait: 0, deck: this.entities.vehicles.get(this.riding.vehicleId)?.deck ?? 0 };
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
        this.char = { x, z, rot, gait: 0, deck: footDeck ?? 0 };
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
      this.char.deck = footDeck ?? 0;
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
      } else list.push({ id: e.data.id, modelId: e.data.modelId, x: e.x, z: e.z, rot: e.rot, deck: e.deck });
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
    if (this.busted || this.dealScene || this.entities.boardingBusy(this.store.playerId)) keys = 0;
    // A gun drawn on foot: face where the camera looks.
    if (this.combat.equipped && !this.driving && !this.combat.dead) keys |= KEY.AIM;
    if (this.combat.dead) keys = 0;
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
    const fps = this.sightsActive();
    if (fps !== this.fpsWas) {
      // Into the sights: keep looking the same way; back out: the chase camera starts over.
      this.fpsWas = fps;
      this.aimPitch = 0;
      this.recoil.pitch = this.recoil.yaw = 0;
      if (!fps) this.cam.snap();
    }
    if (this.input.enabled && !this.busted) {
      if (fps) {
        const k = 0.0025 * this.cam.sensitivity * 0.8;
        this.cam.yaw -= mouse.dx * k;
        this.aimPitch = Math.max(-1.3, Math.min(1.3, this.aimPitch - mouse.dy * k * (this.cam.invertY ? -1 : 1)));
      } else if (cockpit) {
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
    const busyHands = (this.working || !!this.theft.job || !!this.mech?.working) && !this.driving;
    const anim = moving ? (keys & KEY.SPRINT ? Anim.Run : Anim.Walk) : busyHands ? Anim.Interact : Anim.Idle;
    let flags = 0;
    if (this.dyn && this.driving) {
      if (this.dyn.brk > 0.05) flags |= VF.BRAKE;
      if (this.dyn.gear < 0) flags |= VF.REVERSE;
      if ((this.dyn.nitro ?? 0) > 0) flags |= VF.NITRO;
    }
    this.entities.hideLocalDriver = cockpit && !this.busted;
    this.entities.hideLocalBody = fps || !!this.dealScene;
    document.body.classList.toggle('cockpit-view', cockpit && !this.busted);
    document.body.classList.toggle('sights-view', fps);
    this.renderer.overlay = (cockpit || fps) && !this.busted;
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
      wheelie: this.dyn?.wheelie ?? 0,
      deck: this.dyn?.deck ?? 0,
      charDeck: this.char.deck ?? 0,
    });

    const camera = this.renderer.camera;
    const fov = (cockpit && !this.busted) || this.dealScene ? COCKPIT_FOV : fps ? SIGHTS_FOV : CHASE_FOV;
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
    } else if (this.dealScene) {
      this.dealScene.update(dt, camera);
      if (this.dealScene.done) this.endDealScene();
    } else if (cockpit) this.updateCockpitCamera(dt);
    else if (fps) this.updateSightsCamera(rx, rz, dt);
    else if (carried) {
      // Riding along: the chase camera follows the car (it has just been placed this frame).
      if (performance.now() - this.input.lastMouseMove > 1500) this.cam.follow(carried.rot, dt);
      this.cam.update(new THREE.Vector3(carried.x, surfaceY(carried.x, carried.z, carried.deck), carried.z), dt, true, carried.lastSpeed, this.boxes);
    } else {
      if (this.driving && this.dyn && performance.now() - this.input.lastMouseMove > 1500) this.cam.follow(this.dyn.rot, dt);
      const target = new THREE.Vector3(rx, surfaceY(rx, rz, this.localDeck()), rz);
      this.cam.update(target, dt, !!this.driving, this.dyn?.speed ?? 0, this.boxes);
    }
    const me = this.store.me?.appearance;
    this.gunView.set(fps ? this.combat.equipped?.slot ?? 0 : 0, me?.skin, me?.shirt);
    this.gunView.update(camera, fps, dt, moving, (keys & KEY.SPRINT) !== 0);
    // Cars on their rims throw sparks off the road.
    for (const [id, e] of this.entities.vehicles) {
      if (!e.view.flat || !e.driven) continue;
      const kmh = Math.abs(id === this.driving ? this.dyn?.speed ?? 0 : e.lastSpeed) * KMH_PER_MS;
      if (kmh < 8 || Math.random() > Math.min(1, kmh / 60)) continue;
      const side = Math.random() < 0.5 ? 1 : -1;
      const back = Math.random() < 0.5 ? 1 : -1;
      const p = new THREE.Vector3(side * e.view.width * 0.42, 0.05, back * e.view.length * 0.33).applyAxisAngle(new THREE.Vector3(0, 1, 0), e.rot).add(new THREE.Vector3(e.x, groundHeight(e.x, e.z), e.z));
      this.combat.fx.sparks(p, 3);
    }
    // A blast nearby shakes the camera.
    const shake = this.combat.fx.shake;
    if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.4, (Math.random() - 0.5) * shake * 0.6));
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
    this.audio.siren(Math.min(this.police.nearestSiren(rx, rz), this.dealScene?.sirenDistance ?? Infinity));
    this.audio.rotor(this.police.nearestHeli(rx, rz));
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
    this.strait.update(dt);
    this.farShore.update(dt);
    this.showrooms.update(dt, rx, rz);
    this.tolls.update(dt);
    this.heistsView.update(dt);
    this.dealCars.update(dt);
    this.repairCars.update(dt, this.store.serverNow(), (at, level, step) => this.combat.fx.smoke(at, level, false, step));
    // Car theft: street cars and alarms, the work on lifted cars, the lifts' arms.
    this.theft.update(dt, { x: rx, z: rz });
    const lifts = LIFT_BAYS.map(() => 0);
    for (const e of this.entities.vehicles.values()) if (e.data.mods.strip) lifts[e.data.mods.strip.bay] = e.lift;
    for (const c of this.repairCars.list()) lifts[c.bay] = this.repairCars.liftOf(c.id, this.store.serverNow());
    lifts.forEach((y, bay) => this.sanayi.setLift(bay, y));
    this.sanayi.update(dt, rx, rz, this.night);
    // CCTV: the cameras turn; the one that has you in a stolen car flares up.
    const myCar = this.driving ? this.store.myVehicle(this.driving) : undefined;
    const watched = myCar?.status === 'stolen' ? cameraSeeing(rx, rz, this.store.serverNow())?.id ?? null : null;
    this.cctv.update(dt, this.store.serverNow(), watched, this.night);
    this.ui?.pursuit.update(dt);
    if (this.ui?.mechanic.current) this.ui.mechanic.update(this.store.serverNow());
    if (this.ui?.heist.current) {
      const me = this.localPosition();
      this.ui.heist.update(this.store.serverNow(), me.x, me.z);
    }
    if (this.store.contract) {
      const me = this.localPosition();
      this.ui?.hitman.update(this.store.serverNow(), me.x, me.z);
    }
    if (this.store.testDrive) this.ui?.testDrive.update(this.store.serverNow());
    // Guns: firing, effects, damaged cars.
    this.combat.update(dt);
    this.updateGunHud();
    // Street race: rings, bots and the HUD.
    this.race.update(dt);
    const meRacer = this.race.me();
    const pos = meRacer ? this.race.position(rx, rz, (id) => this.whereIs(id)) : { place: 0, of: 0 };
    this.ui?.race.update(this.race.view, this.store.serverNow(), { joined: !!meRacer, next: meRacer?.next ?? 0, place: pos.place, of: pos.of, dnf: !!meRacer?.dnf, finished: meRacer?.timeMs ?? null });
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
      this.combat.refreshViews();
      this.ui?.updateDriving();
      this.ui?.setZone(zoneAt(rx, rz)?.name ?? '');
    }
    this.auctionTimer -= dt;
    if (this.auctionTimer <= 0) {
      this.auctionTimer = 20;
      void this.refreshAuctions();
    }
    // Post effects: the speed blur and the wet-road reflections.
    this.renderer.kmh = this.driving && !this.dealScene ? Math.abs(this.dyn?.speed ?? 0) * KMH_PER_MS : 0;
    this.renderer.wet = this.weather.wet;
    this.renderer.render();
  }

  // ------------------------------------------------------------ highway, drag strip, time of day

  private updateDayNight(): void {
    const now = this.store.serverNow();
    const hour = this.forcedHour ?? gameHour(now);
    this.weather = this.forcedRain !== null ? { rain: this.forcedRain, wet: this.forcedRain } : { rain: rainAt(now), wet: wetnessAt(now) };
    setRoadWetness(this.weather.wet);
    // Crossing to the far shore the air changes (over the second half of the bridge).
    const zoneT = Math.max(0, Math.min(1, (this.localPosition().x - 420) / 200));
    const t = performance.now();
    this.zone += (zoneT - this.zone) * Math.min(1, ((t - this.zoneAt) / 1000) * 0.8);
    this.zoneAt = t;
    const night = this.renderer.setTime(hour, this.weather.rain, this.zone);
    this.night = night;
    this.city.setNight(night);
    this.highway.setNight(night);
    this.strait.setNight(night);
    this.farShore.setNight(night);
    this.showrooms.setNight(night);
    this.tolls.setNight(night);
    this.alleys.setNight(night);
    this.heistsView.setNight(night);
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

  // ------------------------------------------------------------ Telegram

  private onTg(t: TgState): void {
    this.store.setTg(t);
    this.ui?.setGoods(t.goods);
    this.ui?.setPhoneUnread(t.unread);
  }

  /** Into a deal car's passenger seat: the cockpit handover. */
  private enterDeal(carId: string): void {
    if (this.dealScene) return;
    void this.net
      .rpc('tg.enter', { carId })
      .then((scene) => {
        const car = this.dealCars.get(carId);
        if (!car) return;
        this.ui?.closeAll();
        this.dealScene = new DealCutscene(scene, car.view, (sc) => this.ui?.wanted.deal(sc));
        this.audio.play('door');
      })
      .catch((err) => this.ui.error(err));
  }

  private endDealScene(): void {
    this.dealScene?.dispose();
    this.dealScene = null;
    this.cam.snap();
  }

  /** Leave the package at a dead drop. */
  private dropPackage(orderId: string): void {
    void this.net
      .rpc('tg.drop', { orderId })
      .then((t) => {
        this.onTg(t);
        this.audio.play('door');
        this.ui?.toast({ kind: 'success', title: '📦 Paket bırakıldı', text: 'Müşteri birazdan alacak; para Telegram\'dan gelir.' });
      })
      .catch((err) => this.ui.error(err));
  }

  // ------------------------------------------------------------ the Sanayi mechanic

  private onMech(v: MechanicView | null): void {
    this.mech = v?.onDuty ? v : null;
    this.ui?.mechanic.set(this.mech);
    this.repairCars.showBoard(!this.mech);
  }

  /** "Tamirci Olarak Çalış" at the job board (or end the shift there). */
  private mechShift(on: boolean): void {
    void this.net
      .rpc(on ? 'mech.start' : 'mech.stop', {})
      .then((v) => {
        this.onMech(v);
        this.audio.play(on ? 'purchase' : 'click');
      })
      .catch((err) => this.ui.error(err));
  }

  /** A job on the customer's car, at its spot. */
  private mechWork(task: RepairTask): void {
    void this.net
      .rpc('mech.work', { task })
      .then((v) => {
        this.onMech(v);
        this.audio.play('door');
      })
      .catch((err) => this.ui.error(err));
  }

  // ------------------------------------------------------------ heists

  private setHeistAlarm(id: HeistId, on: boolean): void {
    if (on) this.heistAlarms.add(id);
    else this.heistAlarms.delete(id);
    this.heistsView.setAlarm(id, on);
  }

  private onHeist(v: HeistView | null): void {
    this.ui?.heist.set(v);
    this.heistsView.showDrop(v?.phase === 'drive');
  }

  /** E at a heist target's door. */
  private startHeist(id: HeistId): void {
    void this.net
      .rpc('heist.start', { heistId: id })
      .then((v) => this.onHeist(v))
      .catch((err) => this.ui.error(err));
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
      best =
        v?.status === 'testdrive'
          ? { id: 'exit', label: 'Test sürüşünü bitir', sub: 'Araç galeriye döner', action: () => void this.exitVehicle(), vehicle: true }
          : { id: 'exit', label: `Exit ${v ? modelDisplayName(v.modelId) : 'vehicle'}`, action: () => void this.exitVehicle(), vehicle: true };
      vehicleAction = best;
      for (const i of INTERACTABLES) {
        if ((i.kind === 'fuel' || i.kind === 'wash') && Math.hypot(i.x - x, i.z - z) <= i.radius + 3) {
          secondary = { id: i.id, label: i.kind === 'fuel' ? 'Refuel this vehicle' : 'Drive-through wash', action: () => this.ui.open(i.kind, { vehicleId: this.driving }) };
        }
        if (i.kind === 'drag' && Math.hypot(i.x - x, i.z - z) <= i.radius + 2 && !this.drag?.racers.some((r) => r.playerId === me)) {
          secondary = { id: i.id, label: 'Drag race: $250 entry, win $500', action: () => this.ui.open('drag') };
        }
      }
      // An open street race: join at the start line.
      const rv = this.race.view;
      const start = this.race.route?.points[0];
      if (rv?.phase === 'open' && start && !this.race.joined && Math.hypot(start.x - x, start.z - z) <= RACE.joinRadius) {
        secondary = { id: `race-${rv.id}`, label: `Sokak yarışına katıl (1.'ye ${formatMoney(rv.prize)})`, action: () => void this.joinRace() };
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
        if (d > i.radius) continue;
        if (i.showroomId) {
          const showroomId = i.showroomId;
          consider(d, { id: i.id, label: i.label, sub: findShowroom(showroomId)?.name, action: () => this.ui.open('showroom', { showroomId }) });
        } else consider(d, { id: i.id, label: i.label, action: () => this.ui.open(i.kind) });
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
      // Telegram: the deal cars waiting for me, and the dead drops of my orders.
      for (const car of this.dealCars.mine()) {
        const d = Math.hypot(car.x - x, car.z - z);
        if (d > 3.4) continue;
        const order = this.store.tg?.orders.find((o) => o.carId === car.id);
        consider(Math.max(0, d - 1), {
          id: `deal-${car.id}`,
          label: car.kind === 'supplier' ? 'Tedarikçinin arabasına bin' : `@${order?.name ?? 'müşteri'} arabasına bin`,
          sub: car.kind === 'supplier' ? `Yolcu koltuğu · ${DEALS.grams} gr için ${formatMoney(DEALS.buyPrice)}` : `Yolcu koltuğu · ${order?.grams ?? ''} gr teslim, ${formatMoney(order?.price ?? 0)}`,
          action: () => this.enterDeal(car.id),
        });
      }
      for (const o of this.store.tg?.orders ?? []) {
        const drop = o.status === 'drop' && o.dropId ? findDrop(o.dropId) : undefined;
        if (!drop) continue;
        const d = Math.hypot(drop.x - x, drop.z - z);
        if (d > DEALS.dropRadius) continue;
        consider(d, { id: `drop-${o.id}`, label: 'Paketi sakla (ölü nokta)', sub: `${o.grams} gr · @${o.name}`, action: () => this.dropPackage(o.id) });
      }
      // The Sanayi job board, and the jobs on my customer's car.
      const board = Math.hypot(JOB_BOARD.x - x, JOB_BOARD.z - z);
      if (board <= JOB_BOARD.radius) {
        if (this.mech) consider(board, { id: 'mech-stop', label: 'Mesaiyi Bitir', sub: `Bu mesai: ${this.mech.cars} araç · ${formatMoney(this.mech.earned)}`, action: () => this.mechShift(false) });
        else consider(board, { id: 'mech-start', label: 'Tamirci Olarak Çalış', sub: `Araç başı ${formatMoney(MECH.pay)} · motor, kaporta, lastik`, action: () => this.mechShift(true) });
      }
      const repair = this.mech?.car;
      if (repair && this.mech) {
        const m = getModel(repair.modelId);
        for (const task of repair.todo) {
          const p = taskPoint(repair.bay, task, m.shape.length, m.shape.width);
          const d = Math.hypot(p.x - x, p.z - z);
          if (d > MECH.workRadius) continue;
          const w = this.mech.working;
          if (w?.task === task) consider(d, { id: `mech-${task}`, label: `${TASK_LABEL[task]} · %${Math.round(Math.min(1, 1 - (w.until - this.store.serverNow()) / (w.sec * 1000)) * 100)}`, sub: 'Başından ayrılma', action: () => undefined });
          else if (!w) consider(d, { id: `mech-${task}`, label: TASK_LABEL[task], sub: `${MECH.taskSec[task]} sn · ${repair.owner}`, action: () => this.mechWork(task) });
        }
      }
      // Heist targets' doors: E starts the job (and shows how it is going).
      const job = this.ui?.heist.current;
      for (const hs of HEISTS) {
        const d = Math.hypot(hs.stand.x - x, hs.stand.z - z);
        if (d > 2.4 || (job && (job.id !== hs.id || job.phase !== 'work'))) continue;
        if (job) consider(d, { id: `heist-${hs.id}`, label: `${hs.title} sürüyor · %${Math.round(job.progress * 100)}`, sub: hs.task, action: () => undefined });
        else consider(d, { id: `heist-${hs.id}`, label: `Soygunu Başlat: ${hs.name}`, sub: `${formatMoney(hs.loot[0])}-${formatMoney(hs.loot[1])} · ${hs.workSec} sn · polis ${'★'.repeat(hs.stars)}`, action: () => this.startHeist(hs.id) });
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
        if (!e) continue;
        const seats = passengerSeats(getModel(e.data.modelId));
        const free = seats - (riders.get(e.data.id) ?? 0);
        const d = Math.hypot(e.x - x, e.z - z);
        if (free <= 0 || d > e.view.length / 2 + 2.6 || Math.abs(e.lastSpeed) > 2) continue;
        const vid = e.data.id;
        const it: Interaction = e.view.isBike
          ? { id: `ride-${vid}`, label: 'Artçı olarak bin', sub: `${this.store.playerName(pid)} · ${modelDisplayName(e.data.modelId)} · arka koltuk`, action: () => void this.rideVehicle(vid), vehicle: true }
          : { id: `ride-${vid}`, label: 'Yolcu olarak bin', sub: `${this.store.playerName(pid)} · ${modelDisplayName(e.data.modelId)} · ${free} boş koltuk`, action: () => void this.rideVehicle(vid), vehicle: true };
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
          const heistCar = this.ui?.heist.current?.carId === v.id;
          const it: Interaction = { id: v.id, label: `Drive ${modelDisplayName(v.modelId)}`, sub: heistCar ? 'Galeri soygunu: limana teslim et (🏁 haritada)' : stolen ? 'Stolen - take it to the Sanayi (🔧 on the map)' : `Fuel ${Math.round(v.fuel)}%`, action: () => void this.enterVehicle(v.id), vehicle: true };
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
    this.vehicleAction = this.busted || this.dealScene ? null : vehicleAction;
    if (this.busted || this.dealScene) {
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
    // Z: the hidden compartment (Gizli Zula): hide the goods in it, or take them back out.
    if (code === 'KeyZ' && (this.driving || this.riding)) {
      void this.useStash();
      return;
    }
    // P: the Black Market's plate flipper turns the plate away (number-plate cameras can't read it).
    if (this.driving && code === 'KeyP') {
      void this.flipPlate();
      return;
    }
    if (this.combat.onKey(code)) return;
    const hot: Record<string, Parameters<UI['open']>[0]> = {
      KeyB: 'market',
      KeyI: 'inventory',
      KeyJ: 'dealership',
      KeyK: 'auctions',
      KeyM: 'map',
      KeyO: 'profile',
      KeyY: 'phone',
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

  private onRace(r: StreetRaceView | null): void {
    const before = this.race.view;
    this.race.set(r);
    // A new race opens: tell everyone once.
    if (r && r.phase === 'open' && before?.id !== r.id) {
      this.ui?.toast({ kind: 'info', title: '🏁 Sokak yarışı açıldı!', text: `${raceRoute(r.routeId)?.name}: start line marked on the map. Winner takes ${formatMoney(r.prize)}.` });
      this.audio.play('notify');
    }
  }

  /** Where the local player is (predicted). */
  localPosition(): { x: number; z: number; rot: number } {
    return { x: this.curr.x, z: this.curr.z, rot: this.curr.rot };
  }

  private gunKey = '';

  private updateGunHud(): void {
    const w = this.combat.equipped;
    const onFoot = !this.driving && !this.riding;
    const ammo = this.combat.ammo();
    const key = `${w?.id}|${ammo}|${onFoot}`;
    if (key === this.gunKey) return;
    this.gunKey = key;
    this.ui?.combat.setGun(w, ammo, onFoot);
  }

  /** Where another player is (their car while driving). */
  private whereIs(id: string): { x: number; z: number } | null {
    const p = this.entities.players.get(id);
    if (!p) return null;
    const car = p.driving ? this.entities.vehicles.get(p.driving) : undefined;
    if (car) return { x: car.x, z: car.z };
    const l = p.buffer.latest;
    return l ? { x: l.x, z: l.z } : null;
  }

  private async joinRace(): Promise<void> {
    try {
      const r = await this.net.rpc('race.join', {});
      this.race.set(r.race);
      this.audio.play('unlock');
      this.ui?.toast({ kind: 'success', title: 'Yarışa katıldın!', text: 'Wait at the start line: you go on the grid for the countdown.' });
    } catch (err) {
      this.ui?.error(err);
    }
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
  async flipPlate(): Promise<void> {
    const id = this.driving;
    const v = id ? this.store.myVehicle(id) : undefined;
    if (!v) return;
    if (!v.mods.flipper) {
      this.ui?.toast({ kind: 'info', title: 'Plaka çevirme aparatı yok', text: 'Galeri Bulvarı\'ndaki Black Market\'ta takılır; sonra sürerken P ile plakayı çevirirsin.' });
      return;
    }
    try {
      const r = await this.net.rpc('vehicle.flipPlate', {});
      this.audio.play('clunk');
      this.ui?.toast({ kind: 'info', title: r.flipped ? 'Plaka çevrildi' : 'Plaka geri çevrildi', text: r.flipped ? 'Kameralar plakanı okuyamaz.' : 'Plakan yine görünüyor.' });
    } catch (err) {
      this.ui?.error(err);
    }
  }

  /** "Zulaya Sakla (Z)": the goods you carry into the car's hidden compartment, or back out. */
  async useStash(): Promise<void> {
    const id = this.driving ?? this.riding?.vehicleId ?? null;
    const v = id ? this.store.myVehicle(id) : undefined;
    if (!v) return;
    if (!v.mods.stash) {
      this.ui?.toast({ kind: 'info', title: 'Gizli zula yok', text: 'Chroma Customs > Güvenlik: "Gizli Zula" taktır, sonra araçtayken Z ile malı sakla.' });
      return;
    }
    try {
      const r = await this.net.rpc('security.stash', { vehicleId: v.id });
      this.audio.play('clunk');
      this.ui?.toast(
        r.moved > 0
          ? { kind: 'success', title: `🗄️ ${r.moved} gr zulaya saklandı`, text: `Zulada ${r.vehicle.mods.stashGrams ?? 0} gr. Polis aramasında bulunma ihtimali %10.` }
          : { kind: 'info', title: `🗄️ ${-r.moved} gr zuladan alındı`, text: 'Mal artık üzerinde (satış için gerekli).' },
      );
    } catch (err) {
      this.ui?.error(err);
    }
  }

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

  /** A gun drawn on foot, as a passenger (car window, bike pillion) or riding a bike with a pistol:
   *  first person, looking down the sights. */
  private sightsActive(): boolean {
    const w = this.combat.equipped;
    return !!w && this.canShoot(w) && !this.combat.dead && !this.busted;
  }

  /** Can this gun be used where we are? Anywhere, any gun: on foot, as a passenger, and at the
   *  wheel or the bars (one hand steers, the other shoots; the server agrees). */
  canShoot(_w: WeaponDef): boolean {
    return true;
  }

  /** The front wheel's height on our wheelie (rad), if riding. */
  wheelieAngle(): number | null {
    return this.driving && this.dyn ? this.dyn.wheelie ?? 0 : null;
  }

  /** Riding a two-wheeler (it can wheelie), not a quad. */
  onTwoWheeler(): boolean {
    const v = this.driving ? this.entities.vehicles.get(this.driving)?.view : undefined;
    return v instanceof BikeView && !v.quad;
  }

  /** The bridge deck the local player is on (driving, riding or on foot), 0 on the ground. */
  localDeck(): number {
    if (this.driving) return this.dyn?.deck ?? 0;
    if (this.riding) return this.entities.vehicles.get(this.riding.vehicleId)?.deck ?? 0;
    return this.char.deck ?? 0;
  }

  /** Riding on the back of a motorcycle or a quad. */
  onPillion(): boolean {
    const e = this.riding ? this.entities.vehicles.get(this.riding.vehicleId) : undefined;
    return !!e?.view.isBike;
  }

  /** First person on foot (or on the pillion): the camera at the eyes, the recoil kicking it up and settling slowly. */
  private updateSightsCamera(x: number, z: number, dt: number): void {
    const r = this.recoil;
    const settle = Math.exp(-dt * r.recover);
    r.pitch *= settle;
    r.yaw *= settle;
    if (performance.now() - r.at > 350) r.burst = 0;
    const camera = this.renderer.camera;
    const yaw = this.cam.yaw;
    const carried = this.riding ? this.entities.vehicles.get(this.riding.vehicleId)?.view : undefined;
    const ridden = this.driving ? this.entities.vehicles.get(this.driving)?.view : undefined;
    if (carried instanceof BikeView) {
      // Seated behind the rider, looking over their shoulder; free to look all round.
      carried.root.updateMatrixWorld(true);
      carried.passengerMount().localToWorld(camera.position.set(-0.2, 0.9, 0.05));
    } else if (carried) {
      // A car passenger leaning to the window: the eyes in their seat.
      carried.root.updateMatrixWorld(true);
      carried.passengerMount(this.riding!.seat).localToWorld(camera.position.set(0, 1.72, 0.05));
    } else if (ridden instanceof BikeView) {
      // Riding with a gun in one hand: the rider's eyes.
      ridden.root.updateMatrixWorld(true);
      ridden.riderMount.localToWorld(camera.position.set(0, 0.86, 0.1));
    } else if (ridden) {
      // At the wheel, one hand out of the window: the driver's eyes.
      ridden.root.updateMatrixWorld(true);
      ridden.driverMount.localToWorld(camera.position.set(0, 1.72, 0.05));
    } else camera.position.set(x + Math.sin(yaw) * 0.12, surfaceY(x, z, this.localDeck()) + EYE_HEIGHT, z + Math.cos(yaw) * 0.12);
    camera.quaternion.setFromEuler(new THREE.Euler(this.aimPitch + r.pitch, yaw + Math.PI + r.yaw, 0, 'YXZ'));
  }

  /** A shot: the view kicks (pistol straight up, shotgun hard, rifles spray) and the gun comes back. */
  recoilKick(w: WeaponDef): void {
    const r = this.recoil;
    const k = recoilKick(w, r.burst, Math.random);
    r.burst++;
    r.at = performance.now();
    r.recover = w.recoil.recover;
    r.pitch = Math.min(0.45, r.pitch + k.pitch);
    r.yaw = Math.max(-0.2, Math.min(0.2, r.yaw + k.yaw));
    this.gunView.kick(k.shove, k.pitch);
    // The shotgun and the RPG also shove you back a little.
    if (k.shove > 0.09) this.offset.add(new THREE.Vector2(-Math.sin(this.cam.yaw), -Math.cos(this.cam.yaw)).multiplyScalar(k.shove * 0.6));
  }

  /** The drawn gun's muzzle in the world while looking down the sights (for the tracer). */
  sightsMuzzle(out: THREE.Vector3): THREE.Vector3 | null {
    return this.fpsWas ? this.gunView.muzzleWorld(out) : null;
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

  /** Hand the test-drive car back early. */
  async endTestDrive(): Promise<void> {
    try {
      await this.net.rpc('showroom.endTestDrive', {});
    } catch (err) {
      this.ui?.error(err);
    }
  }

  private onTestDriveEnd(reason: TestDriveEnd, modelId: string, fee: number): void {
    this.store.setTestDrive(null);
    const why: Record<TestDriveEnd, string> = {
      time: 'Süre doldu: araç galeriye teslim edildi.',
      cancel: 'Araç galeriye teslim edildi.',
      exit: 'Araçtan indin: araç galeriye döndü.',
      busted: 'Polis yakaladı: test aracı galeriye geri götürüldü.',
      lost: 'Araç galeriye teslim edildi.',
    };
    const m = getModel(modelId);
    this.ui?.toast({ kind: fee > 0 ? 'warning' : 'info', title: `Test sürüşü bitti · ${m.brand} ${m.name}`, text: `${why[reason]}${fee > 0 ? ` Hasar bedeli: ${formatMoney(fee)}.` : ' Beğendiysen galeriden satın alabilirsin.'}` });
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

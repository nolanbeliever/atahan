// Wanted level and police pursuits.
//
// Reckless driving builds heat: near misses above 180 km/h, crashing into traffic, ramming a police
// car. Heat becomes 1-5 stars; from 2 stars police interceptors (real physics cars, same collision
// boxes as everyone) spawn behind the player and chase them: along the highway lanes, and through
// the city on the road grid (line of sight or a route over the junctions). Police only know where
// you are while one of them can actually see you (shared/sight.ts: a cone ahead of the car, the
// line to you clear of buildings and piers) or right after an offence is reported; otherwise they
// drive to where you were last seen and search round it (yellow lights). Out of sight for 45 s
// (a glimpse doesn't count: a car has to keep you in sight for 2 s) is an escape (cash + XP).
// A police car right beside you while you are (nearly) stopped
// for 3 s is an arrest: a fixed $3,000 fine (cash, then bank), the car is towed to your
// garage, and you walk out of the nearest garage after a short cutscene.

import { ALLEYS, BOLLARDS, alleyAt, alleyBox, alleyMouths } from '../../../shared/alleys';
import { KMH_PER_MS } from '../../../shared/drivetrain';
import { ECONOMY } from '../../../shared/economy.config';
import { CARRIAGEWAY_EDGE, laneOffset, offsetToLane, pathPoint, pathYaw, projectToHighway, travelDir, wrapS, type Carriageway } from '../../../shared/highway';
import { obbDistance } from '../../../shared/obb';
import { KEY, newVehicleDyn, stepVehicle, vehicleBox, vehicleParams, type VehicleDyn, type VehicleParams } from '../../../shared/physics';
import { PF, type BustedEvent, type PoliceSnap, type WantedState } from '../../../shared/police';
import { angleDiff } from '../../../shared/util';
import { isCovered, onSpikes, spikePlacement, tyrePoints, type HeliSnap, type SpikeSnap, type SpikeStrip } from '../../../shared/policeGear';
import { POLICE_MODEL, modelDisplayName, type VehicleModel } from '../../../shared/vehicles';
import { crossesWall } from '../../../shared/farShore';
import { NAV_EDGES, NAV_NODES, navRoadPoints } from '../../../shared/roadGraph';
import { bridgeByN, bridgeEnds, crossesWater, BRIDGE_HALF } from '../../../shared/strait';
import { DOCK_FENCES } from '../../../shared/farShore';
import { policeSees, type SightWorld } from '../../../shared/sight';
import { checkpointPlan, TOLL_BOXES, type CheckpointPlan } from '../../../shared/tolls';
import { INTERACTABLES, type AABB } from '../../../shared/world';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';
import type { VehicleService } from './vehicles';

const log = createLogger('police');

/** Road points police cars can join a chase from (city and far shore), and the road graph. */
const ROAD_POINTS = navRoadPoints(10);
const NAV_ADJ: number[][] = NAV_NODES.map(() => []);
for (const e of NAV_EDGES) {
  NAV_ADJ[e.a]!.push(e.b);
  NAV_ADJ[e.b]!.push(e.a);
}

const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

/** The back alleys' passages (police cars don't plan routes through them). */
const ALLEY_PASSAGES = ALLEYS.map(alleyBox);

/** How far ahead of the player each car in a pursuit aims (x chase.lead): one straight at them,
 *  one cutting them off, one hanging back... so they come from different angles instead of in a queue. */
const LEAD_K = [1, 1.7, 0.45, 1.3];

/** The wanted player as the police see them: their car, or themselves on foot. */
interface Target {
  x: number;
  z: number;
  rot: number;
  speed: number;
  vx: number;
  vz: number;
  hl: number;
  hw: number;
  onFoot: boolean;
  vehicleId: string | null;
  deck: number;
}

interface Unit {
  id: number;
  dyn: VehicleDyn;
  /** Seconds it has been stuck (throttle on, not moving). */
  stuck: number;
  /** Reversing out of a jam until this time (s of the service clock). */
  reverseUntil: number;
  /** Route waypoint through the city (recomputed twice a second). */
  waypoint: { x: number; z: number } | null;
  replanAt: number;
  /** Side it tries to pull up on when close (+1 / -1). */
  side: number;
  /** Parked beside the player for the arrest. */
  parked: boolean;
  /** Has the wanted player in sight right now, and for how long without a break (s). */
  sees: boolean;
  seeT: number;
  /** Searching (lost the player): the road point it is heading for and until when (s). */
  searching: boolean;
  searchAt: { x: number; z: number; deck: number } | null;
  searchUntil: number;
  /** How far ahead of the player it aims (each car a little different, so they don't queue up). */
  leadK: number;
  /** Right behind the player when they dived into this back alley: it follows straight in. */
  followIn: string | null;
  /** Hit the bollards: sitting there, dazed, until then (s). */
  crashUntil: number;
}

/** A police checkpoint at a bridge's far end, set up for one wanted driver (see shared/tolls.ts). */
interface Checkpoint {
  playerId: string;
  name: string;
  plan: CheckpointPlan;
  units: Unit[];
  spikeId: number;
  until: number;
  /** The driver got through it (paid once). */
  passed: boolean;
  /** Cars already shoved aside. */
  rammed: Set<number>;
}

interface Heli {
  id: number;
  player: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  /** Where it circles, and where it last saw the player. */
  orbitA: number;
  lastX: number;
  lastZ: number;
  /** Seconds since it last saw the player (under cover). */
  lostT: number;
  /** Still tracking (reporting the player's position); sees them right now. */
  sees: boolean;
  visible: boolean;
  aimX: number;
  aimZ: number;
  /** Shot down (ms), falling. */
  downAt: number;
}

interface Wanted {
  heat: number;
  lastOffence: number;
  /** Seconds out of police sight without being spotted (the hidden countdown). */
  hiddenT: number;
  /** An offence was just reported: the police know where you are until then (ms). */
  dispatchUntil: number;
  /** The police know where you are right now (a car or the helicopter sees you, or a report). */
  knows: boolean;
  /** Where they last knew you were (and which way you were going). */
  lastKnown: { x: number; z: number; deck: number; vx: number; vz: number } | null;
  /** How close the best-placed car is to spotting you (0-1), and the helicopter's sight time (s). */
  seen: number;
  heliSeeT: number;
  /** Next sight check, and when the next police car may join (service clock, s). */
  sightAt: number;
  nextSpawnAt: number;
  /** The back alley the player is in (to see them dive into one). */
  inAlley: string | null;
  /** Last "police hit the bollards" message (ms). */
  crashNoteAt: number;
  bustT: number;
  units: Unit[];
  /** Police have been after this player (an escape pays). */
  pursued: boolean;
  /** Last hit already counted (DriveState.lastHitAt). */
  seenHitAt: number;
  busted: { until: number; event: BustedEvent } | null;
  sent: string;
  sentAt: number;
  /** Every police car that took part in the pursuit (the escape pays per car). */
  chasers: Set<number>;
}

export function starsFor(heat: number): number {
  return Math.min(5, Math.max(0, Math.ceil(heat / 100)));
}

/** Fine for an arrest: a fixed $3,000, however many stars or police cars. It comes out of the cash,
 *  and out of the bank when the cash isn't enough (never below zero). */
export function policeFine(cash: number, bank = 0): { cash: number; bank: number; total: number } {
  const fine = ECONOMY.police.fine;
  const fromCash = Math.max(0, Math.min(cash, fine));
  const fromBank = Math.max(0, Math.min(bank, fine - fromCash));
  return { cash: fromCash, bank: fromBank, total: fromCash + fromBank };
}

const GARAGES = INTERACTABLES.filter((i) => i.kind === 'repair' || i.kind === 'custom').map((i) => ({ x: i.x, z: i.z + 6 }));

let nextUnitId = 1;

/** The pursuit car: the interceptor's body with the chase toned down (ECONOMY.police.chase). */
const CH = ECONOMY.police.chase;
export const PURSUIT_MODEL: VehicleModel = {
  ...POLICE_MODEL,
  id: 'police_pursuit',
  specs: {
    ...POLICE_MODEL.specs,
    hp: Math.round(POLICE_MODEL.specs.hp * CH.power),
    torque: Math.round(POLICE_MODEL.specs.torque * CH.power),
    topSpeed: Math.round(POLICE_MODEL.specs.topSpeed * CH.topSpeed),
    accel: Math.round((POLICE_MODEL.specs.accel / CH.power) * 10) / 10,
  },
};

export class PoliceService {
  private wanted = new Map<string, Wanted>();
  private sightCache: { src: readonly AABB[]; world: SightWorld } | null = null;
  private params: VehicleParams = vehicleParams(PURSUIT_MODEL, PERFECT, 100);
  private time = 0;
  /** Missions and others hear about escapes (from a pursuit). */
  readonly escapeListeners: ((playerId: string) => void)[] = [];
  /** The wanted level wiped by an escape (pursuit or not), and arrests: heists hear about them. */
  readonly clearedListeners: ((playerId: string) => void)[] = [];
  readonly bustListeners: ((playerId: string) => void)[] = [];
  /** A stolen car taken off an arrested thief. */
  readonly seizeListeners: ((playerId: string, vehicleId: string) => void)[] = [];
  /** Spike strips on the roads (they burst anybody's tyres) and when each wanted driver last got one. */
  private spikes = new Map<number, SpikeStrip & { id: number; until: number }>();
  private spikeSeq = 1;
  private spikeAt = new Map<string, number>();
  private bursting = new Set<string>();
  /** Helicopters (one per wanted player from 3 stars) and when the last one was shot down. */
  private helis = new Map<string, Heli>();
  private heliSeq = 1;
  private heliGone = new Map<string, number>();
  /** Checkpoints by the driver they were set up for, when each driver may get the next one, and
   *  the deck each wanted driver was on last tick (to see them drive onto a bridge). */
  private checkpoints = new Map<string, Checkpoint>();
  private checkpointAt = new Map<string, number>();
  private lastDeck = new Map<string, number>();
  /** Checkpoint news: set up for a driver, rammed through (the toll history listens). */
  readonly checkpointListeners: ((playerId: string, e: { kind: 'checkpoint' | 'breakthrough'; name: string; reward: number }) => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly vehicles: VehicleService,
  ) {}

  // ---------------------------------------------------------------- offences

  private get(playerId: string): Wanted {
    let w = this.wanted.get(playerId);
    if (!w) {
      w = { heat: 0, lastOffence: 0, hiddenT: 0, dispatchUntil: 0, knows: true, lastKnown: null, seen: 0, heliSeeT: 0, sightAt: 0, nextSpawnAt: 0, inAlley: null, crashNoteAt: 0, bustT: 0, units: [], pursued: false, seenHitAt: Date.now(), busted: null, sent: '', sentAt: 0, chasers: new Set() };
      this.wanted.set(playerId, w);
    }
    return w;
  }

  /** Everyone in the same car as a player (driver and passengers): partners in crime. */
  crew(playerId: string): string[] {
    const c = this.ctx.sim.chars.get(playerId);
    const vehicleId = c?.drivingId ?? c?.ridingId;
    if (!vehicleId) return [playerId];
    const out = new Set([playerId]);
    const driver = this.ctx.sim.driverOf(vehicleId);
    if (driver) out.add(driver);
    for (const r of this.ctx.sim.ridersOf(vehicleId)) out.add(r.id);
    return [...out];
  }

  /** Add heat for an offence (also used by tests). Everyone in the same car shares it. */
  addHeat(playerId: string, amount: number): void {
    for (const id of this.crew(playerId)) {
      const w = this.get(id);
      if (w.busted) continue;
      w.heat = Math.min(ECONOMY.police.maxHeat, w.heat + amount);
      this.reported(w);
    }
  }

  /** Police cars come only after `sec` (a heist alarm: they know, and they're on their way). */
  holdUnits(playerId: string, sec: number): void {
    const w = this.wanted.get(playerId);
    if (w) w.nextSpawnAt = Math.max(w.nextSpawnAt, this.time + sec);
  }

  /** Raise the heat to at least this much (e.g. a car alarm: straight to 2 stars). Shared with
   *  everyone in the same car. */
  raiseHeat(playerId: string, atLeast: number): void {
    for (const id of this.crew(playerId)) {
      const w = this.get(id);
      if (w.busted) continue;
      w.heat = Math.min(ECONOMY.police.maxHeat, Math.max(w.heat, atLeast));
      this.reported(w);
    }
  }

  /** An offence is reported: the police get your position for a few seconds and the hidden
   *  countdown starts over. */
  private reported(w: Wanted): void {
    const now = Date.now();
    w.lastOffence = now;
    w.dispatchUntil = now + ECONOMY.police.sight.dispatchSec * 1000;
    w.hiddenT = 0;
  }

  /** A near miss at speed (from the highway service). */
  onNearMiss(playerId: string, kmh: number): void {
    if (kmh >= ECONOMY.police.fastNearMissKmh) this.addHeat(playerId, ECONOMY.police.heatNearMissFast);
  }

  /** Wanted stars of a player (0: none). */
  starsOf(playerId: string): number {
    const w = this.wanted.get(playerId);
    return w && !w.busted ? starsFor(w.heat) : 0;
  }

  /** The police cars after a player (combat: officers get out of them). */
  unitsOf(playerId: string): readonly { id: number; dyn: VehicleDyn }[] {
    return this.wanted.get(playerId)?.units ?? [];
  }

  /** A police car destroyed (it is replaced later while the pursuit goes on). */
  removeUnit(unitId: number): void {
    for (const w of this.wanted.values()) w.units = w.units.filter((u) => u.id !== unitId);
    this.publishObstacles();
  }

  /** Drop a player's wanted level (wasted: they wake up in hospital with a clean slate). */
  clearWanted(playerId: string): void {
    if (!this.wanted.has(playerId)) return;
    const w = this.wanted.get(playerId)!;
    w.heat = 0;
    w.units = [];
    this.send(playerId, w, true);
    this.wanted.delete(playerId);
    this.publishObstacles();
  }

  /** Distance from a point to the player's nearest pursuing police car (Infinity: none). */
  nearestUnit(playerId: string, x: number, z: number): number {
    const w = this.wanted.get(playerId);
    let best = Infinity;
    for (const u of w?.units ?? []) best = Math.min(best, Math.hypot(u.dyn.x - x, u.dyn.z - z));
    return best;
  }

  wantedOf(playerId: string): Readonly<Wanted> | undefined {
    return this.wanted.get(playerId);
  }

  forget(playerId: string): void {
    this.wanted.delete(playerId);
    this.closeCheckpoint(playerId);
    this.lastDeck.delete(playerId);
    this.checkpointAt.delete(playerId);
    this.publishObstacles();
  }

  // ---------------------------------------------------------------- tick

  tick(dt: number, now = Date.now()): void {
    this.time += dt;
    const cfg = ECONOMY.police;
    // Crashes into traffic / police count as offences.
    for (const d of this.ctx.sim.drives.values()) {
      if (!d.lastHitId || d.lastHitAt <= 0) continue;
      const w = this.wanted.get(d.playerId);
      const seen = w?.seenHitAt ?? 0;
      if (d.lastHitAt <= seen) continue;
      if (d.lastHitId.startsWith('tr:')) this.addHeat(d.playerId, cfg.heatTrafficCrash);
      else if (d.lastHitId.startsWith('po:')) this.addHeat(d.playerId, cfg.heatHitPolice);
      else continue;
      this.get(d.playerId).seenHitAt = d.lastHitAt;
    }
    for (const [playerId, w] of this.wanted) {
      if (!this.ctx.sim.chars.has(playerId)) {
        this.wanted.delete(playerId);
        continue;
      }
      if (w.busted) {
        if (now >= w.busted.until) void this.release(playerId, w);
        continue;
      }
      const stars = starsFor(w.heat);
      if (stars === 0) {
        if (w.units.length === 0) this.wanted.delete(playerId);
        else w.units = [];
        this.send(playerId, w, true);
        continue;
      }
      const me = this.target(playerId);
      if (!me) continue;
      this.watchBridges(playerId, stars, me, now);
      // Into a back alley: the cars right behind follow straight in (and meet the bollards); the
      // others go round to the far end.
      const alley = me.deck ? undefined : alleyAt(me.x, me.z);
      if (alley && w.inAlley !== alley.id) for (const u of w.units) if (Math.hypot(u.dyn.x - me.x, u.dyn.z - me.z) < 40) u.followIn = alley.id;
      if (!alley) for (const u of w.units) u.followIn = null;
      w.inAlley = alley?.id ?? null;
      // From 3 stars the helicopter comes (it looks from above first).
      this.flyHeli(playerId, stars, me, dt, now);
      // Who can see the player? (Every car on the radio hears it.)
      const spotted = this.look(playerId, w, me, dt, now);
      // Spawn / retire police cars to match the wanted level: one at a time, a few seconds apart,
      // from behind the player while the police know where they are, near the last sighting otherwise.
      const want = stars >= cfg.pursuitStars ? cfg.unitsByStars[stars] ?? 0 : 0;
      if (w.units.length < want && this.time >= w.nextSpawnAt) {
        const u = this.spawn(this.anchor(w, me), w.units.length);
        if (u) {
          w.units.push(u);
          w.chasers.add(u.id);
          w.pursued = true;
          w.nextSpawnAt = this.time + cfg.sight.spawnGapSec;
        }
      }
      if (w.units.length > want) w.units.length = want;
      // Drive them.
      let nearestSame = Infinity;
      let nearestGap = Infinity;
      const myBox = vehicleBox('me', me.x, me.z, me.rot, me.hl, me.hw);
      for (const u of w.units) {
        this.drive(playerId, u, w, me, dt);
        const dist = Math.hypot(u.dyn.x - me.x, u.dyn.z - me.z);
        // Only a car on the same level can stop you (not one on the highway under a bridge).
        const same = (u.dyn.deck ?? 0) === me.deck;
        if (same) nearestSame = Math.min(nearestSame, dist);
        if (same && dist < 12) nearestGap = Math.min(nearestGap, obbDistance(myBox, vehicleBox('u', u.dyn.x, u.dyn.z, u.dyn.rot, this.params.halfLength, this.params.halfWidth)));
        // Hopelessly stuck, or (only while they know where you are) lost far behind: a fresh car
        // comes from behind you. While searching they don't magically catch up.
        if (u.stuck > CH.stuckSec || (w.knows && dist > CH.respawnDist)) {
          const fresh = this.spawn(this.anchor(w, me), u.side > 0 ? 0 : 1);
          if (fresh) Object.assign(u, fresh, { id: u.id, leadK: u.leadK });
        }
      }
      // The cars at a checkpoint can stop you too.
      for (const u of this.checkpoints.get(playerId)?.units ?? []) {
        if ((u.dyn.deck ?? 0) !== me.deck) continue;
        const dist = Math.hypot(u.dyn.x - me.x, u.dyn.z - me.z);
        nearestSame = Math.min(nearestSame, dist);
        if (dist < 12) nearestGap = Math.min(nearestGap, obbDistance(myBox, vehicleBox('u', u.dyn.x, u.dyn.z, u.dyn.rot, this.params.halfLength, this.params.halfWidth)));
      }
      // From 3 stars a spike strip goes down across the road ahead of a wanted driver.
      this.throwSpikes(playerId, stars, me, now);
      // Escape: out of sight for hiddenSec (pursuit), or no new offence for calmSec (1 star).
      if (stars >= cfg.pursuitStars) {
        w.hiddenT = spotted ? 0 : w.hiddenT + dt;
        if (w.hiddenT >= cfg.sight.hiddenSec) {
          void this.escaped(playerId, w);
          continue;
        }
      } else if (now - w.lastOffence > cfg.calmSec * 1000) {
        w.heat = 0;
        this.send(playerId, w, true);
        this.wanted.delete(playerId);
        continue;
      }
      // Arrest: a police car right beside you while you're (nearly) stopped.
      const slow = Math.abs(me.speed) * KMH_PER_MS < cfg.bustKmh;
      const close = me.onFoot ? nearestSame < 6 : nearestGap < cfg.bustGap;
      w.bustT = slow && close ? w.bustT + dt : Math.max(0, w.bustT - dt * 0.5);
      if (w.bustT >= cfg.bustSec) {
        void this.bust(playerId, w, me);
        continue;
      }
      this.send(playerId, w);
    }
    this.tickCheckpoints(dt, now);
    this.checkSpikes(now);
    this.tickHelis(dt, now);
    this.publishObstacles();
  }

  // ---------------------------------------------------------------- line of sight

  /** What blocks a police officer's view: the solid colliders minus the see-through ones (the dock
   *  fences, the low toll islands). Rebuilt when the world's boxes change (dealership upgrades). */
  private sightWorld(): SightWorld {
    const world = this.ctx.sim.collisionWorld;
    if (this.sightCache?.src !== world.boxes) {
      const skip = new Set<AABB>([...DOCK_FENCES, ...TOLL_BOXES]);
      this.sightCache = { src: world.boxes, world: { boxes: world.boxes.filter((b) => !skip.has(b)), circles: world.circles } };
    }
    return this.sightCache.world;
  }

  /**
   * Sight checks for one wanted player (a few times a second): each police car (pursuit and
   * checkpoint) sees them or not, and how long it has without a break; the helicopter too. While
   * anyone sees them, or right after a reported offence, the police know where they are. Returns
   * whether they are spotted: reported, or kept in sight for spotSec by a car or the helicopter.
   */
  private look(playerId: string, w: Wanted, me: Target, dt: number, now: number): boolean {
    const sc = ECONOMY.police.sight;
    const cars = [...w.units, ...(this.checkpoints.get(playerId)?.units ?? [])];
    if (this.time >= w.sightAt) {
      w.sightAt = this.time + 1 / sc.checkHz;
      const world = this.sightWorld();
      for (const u of cars) u.sees = policeSees(u.dyn.x, u.dyn.z, u.dyn.deck ?? 0, u.dyn.rot, me.x, me.z, me.deck, world);
    }
    let best = 0;
    let sees = false;
    for (const u of cars) {
      u.seeT = u.sees ? u.seeT + dt : 0;
      sees ||= u.sees;
      best = Math.max(best, u.seeT);
    }
    const h = this.helis.get(playerId);
    const heliSees = !!h && !h.downAt && h.visible;
    w.heliSeeT = heliSees ? w.heliSeeT + dt : 0;
    const reported = now < w.dispatchUntil;
    w.knows = sees || heliSees || reported;
    if (w.knows) w.lastKnown = { x: me.x, z: me.z, deck: me.deck, vx: me.vx, vz: me.vz };
    w.seen = reported ? 0 : Math.min(1, Math.max(best, w.heliSeeT) / sc.spotSec);
    return reported || best >= sc.spotSec || w.heliSeeT >= sc.spotSec;
  }

  /** Where new police cars head from: the player while they know where they are, the last sighting otherwise. */
  private anchor(w: Wanted, me: Target): { x: number; z: number; rot: number; deck: number } {
    const k = w.lastKnown;
    if (w.knows || !k) return me;
    return { x: k.x, z: k.z, rot: Math.hypot(k.vx, k.vz) > 1 ? Math.atan2(k.vx, k.vz) : me.rot, deck: k.deck };
  }

  // ---------------------------------------------------------------- bridge checkpoints

  /** A wanted driver (2 stars or more) driving onto a bridge finds a checkpoint at its far end. */
  private watchBridges(playerId: string, stars: number, me: { x: number; rot: number; deck: number; onFoot: boolean }, now: number): void {
    const prev = this.lastDeck.get(playerId) ?? me.deck;
    this.lastDeck.set(playerId, me.deck);
    const cc = ECONOMY.tolls.checkpoint;
    if (prev !== 0 || me.deck === 0 || me.onFoot || stars < cc.stars || this.checkpoints.has(playerId) || now < (this.checkpointAt.get(playerId) ?? 0)) return;
    const b = bridgeByN(me.deck);
    if (!b) return;
    const dir: 1 | -1 = Math.sin(me.rot) >= 0 ? 1 : -1;
    const plan = checkpointPlan(b, dir);
    // Only when the driver is still well short of it.
    if ((plan.x - me.x) * dir < 60) return;
    this.openCheckpoint(playerId, plan, b.name.split(' · ')[0]!, now);
  }

  /** Put the checkpoint up (also used by tests). */
  openCheckpoint(playerId: string, plan: CheckpointPlan, name: string, now = Date.now()): void {
    const cc = ECONOMY.tolls.checkpoint;
    this.closeCheckpoint(playerId);
    const units: Unit[] = plan.cars.map((c, i) => {
      const dyn = newVehicleDyn(c.x, c.z, c.rot);
      dyn.deck = plan.n;
      return { id: nextUnitId++, dyn, stuck: 0, reverseUntil: 0, waypoint: null, replanAt: 0, side: i % 2 ? 1 : -1, parked: true, sees: false, seeT: 0, searching: false, searchAt: null, searchUntil: 0, leadK: 1, followIn: null, crashUntil: 0 };
    });
    const spikeId = this.addSpikes({ ...plan.spikes, deck: plan.n }, now);
    const until = now + cc.lifeSec * 1000;
    this.spikes.get(spikeId)!.until = until;
    this.checkpoints.set(playerId, { playerId, name, plan, units, spikeId, until, passed: false, rammed: new Set() });
    this.checkpointAt.set(playerId, now + cc.cooldownSec * 1000);
    for (const p of this.crew(playerId)) {
      this.ctx.hub.sendTo(p, 'police.checkpoint', { n: plan.n, name, x: plan.x, z: plan.z, dir: plan.dir, until });
      this.ctx.hub.notify(p, { kind: 'warning', title: 'POLİS KONTROL NOKTASI', text: `${name} çıkışında barikat var: BARİKATI YAR VEYA KAÇ!` });
    }
    for (const l of this.checkpointListeners) l(playerId, { kind: 'checkpoint', name, reward: 0 });
    log.info('checkpoint', { playerId, bridge: plan.n, dir: plan.dir });
  }

  private closeCheckpoint(playerId: string): void {
    const cp = this.checkpoints.get(playerId);
    if (!cp) return;
    this.spikes.delete(cp.spikeId);
    this.checkpoints.delete(playerId);
  }

  /** Checkpoint cars stand (braked); a car hitting one fast enough shoves it aside; getting past pays. */
  private tickCheckpoints(dt: number, now: number): void {
    const cc = ECONOMY.tolls.checkpoint;
    for (const [playerId, cp] of [...this.checkpoints]) {
      if (now > cp.until || !this.ctx.sim.chars.has(playerId)) {
        this.closeCheckpoint(playerId);
        continue;
      }
      const me = this.target(playerId);
      for (const u of cp.units) {
        stepVehicle(u.dyn, { keys: KEY.BRAKE, dt }, this.params, this.ctx.sim.collisionWorld, `po:${u.id}`);
        if (!me || me.onFoot || me.deck !== cp.plan.n || cp.rammed.has(u.id)) continue;
        const kmh = Math.abs(me.speed) * KMH_PER_MS;
        if (kmh < cc.smashKmh) continue;
        const gap = obbDistance(vehicleBox('me', me.x, me.z, me.rot, me.hl + 0.3, me.hw + 0.3), vehicleBox('u', u.dyn.x, u.dyn.z, u.dyn.rot, this.params.halfLength, this.params.halfWidth));
        if (gap > 0.05) continue;
        // Rammed: it spins away in the direction the car was going; the car loses some speed.
        cp.rammed.add(u.id);
        const heading = me.rot;
        const side = Math.sign((u.dyn.z - me.z) * Math.sin(heading) - (u.dyn.x - me.x) * Math.cos(heading)) || 1;
        u.dyn.rot = heading - side * 0.7;
        u.dyn.speed = Math.abs(me.speed) * 0.55;
        u.dyn.yaw = side * 2.4;
        u.dyn.slip = side * 0.5;
        const d = me.vehicleId ? this.ctx.sim.drives.get(me.vehicleId) : undefined;
        if (d) d.dyn.speed *= 0.72;
        this.ctx.hub.broadcast('police.ram', { x: u.dyn.x, z: u.dyn.z, deck: cp.plan.n });
      }
      // Past the line, still on the bridge: through.
      if (me && !cp.passed && !me.onFoot && me.deck === cp.plan.n && (me.x - cp.plan.x) * cp.plan.dir > 6 && Math.abs(me.z - cp.plan.z) < BRIDGE_HALF + 1) {
        cp.passed = true;
        cp.until = Math.min(cp.until, now + 8000);
        void this.payBreakthrough(playerId, cp);
      }
    }
  }

  private async payBreakthrough(playerId: string, cp: Checkpoint): Promise<void> {
    const reward = ECONOMY.tolls.checkpoint.reward;
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        uow.credit(p, reward, 'checkpoint', `Barikat yarıldı: ${cp.name}`);
        uow.grantXp(p, 40);
        await uow.commit();
      });
      for (const p of this.crew(playerId)) this.ctx.hub.sendTo(p, 'police.breakthrough', { reward: p === playerId ? reward : 0, name: cp.name });
      for (const l of this.checkpointListeners) l(playerId, { kind: 'breakthrough', name: cp.name, reward });
      log.info('checkpoint broken through', { playerId, bridge: cp.plan.n });
    } catch (err) {
      log.error('checkpoint reward failed', { playerId, error: (err as Error).message });
    }
  }

  /** The checkpoint set up for a player (tests). */
  checkpointOf(playerId: string): Readonly<{ plan: CheckpointPlan; units: readonly { id: number; dyn: VehicleDyn }[]; passed: boolean }> | undefined {
    return this.checkpoints.get(playerId);
  }

  // ---------------------------------------------------------------- helicopter

  private flyHeli(playerId: string, stars: number, me: { x: number; z: number; deck: number }, dt: number, now: number): void {
    const hc = ECONOMY.police.heli;
    let h = this.helis.get(playerId);
    if (stars < hc.stars) {
      if (h && !h.downAt) this.helis.delete(playerId);
      return;
    }
    if (!h) {
      if (now - (this.heliGone.get(playerId) ?? -Infinity) < hc.respawnSec * 1000) return;
      const a = (this.time * 1.7 + playerId.length) % (Math.PI * 2);
      h = { id: this.heliSeq++, player: playerId, x: me.x + Math.cos(a) * hc.spawnDist, y: hc.altitude, z: me.z + Math.sin(a) * hc.spawnDist, yaw: 0, hp: hc.hp, orbitA: a, lastX: me.x, lastZ: me.z, lostT: 0, sees: true, visible: false, aimX: me.x, aimZ: me.z, downAt: 0 };
      this.helis.set(playerId, h);
      for (const p of this.crew(playerId)) this.ctx.hub.notify(p, { kind: 'warning', title: '🚁 Polis helikopteri!', text: 'Helikopter seni yukarıdan izliyor ve yerini ekiplere bildiriyor. Köprü altına, tünele ya da kapalı bir alana gir!' });
    }
    if (h.downAt) return;
    const dist = Math.hypot(h.x - me.x, h.z - me.z);
    h.visible = !isCovered(me.x, me.z, me.deck) && dist < hc.sight;
    if (h.visible) {
      h.lastX = me.x;
      h.lastZ = me.z;
      h.lostT = 0;
    } else h.lostT += dt;
    const was = h.sees;
    h.sees = h.lostT < hc.lostSec;
    if (was && !h.sees) for (const p of this.crew(playerId)) this.ctx.hub.notify(p, { kind: 'success', title: 'Helikopter izini kaybetti', text: 'Seni göremiyor: şimdi ekiplerden de kurtul.' });
    else if (!was && h.visible) for (const p of this.crew(playerId)) this.ctx.hub.notify(p, { kind: 'warning', title: '🚁 Helikopter seni yine buldu', text: 'Projektör üzerinde!' });
    // Circle where it last saw you, catching up fast when far away.
    h.orbitA += dt * (hc.speed / hc.orbit) * 0.35;
    const tx = h.lastX + Math.cos(h.orbitA) * hc.orbit;
    const tz = h.lastZ + Math.sin(h.orbitA) * hc.orbit;
    const dx = tx - h.x;
    const dz = tz - h.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) {
      const step = Math.min(d, hc.speed * (d > 60 ? 1.8 : 1) * dt);
      h.x += (dx / d) * step;
      h.z += (dz / d) * step;
    }
    h.yaw += angleDiff(h.yaw, Math.atan2(h.lastX - h.x, h.lastZ - h.z)) * Math.min(1, dt * 2);
    h.y += (hc.altitude - h.y) * Math.min(1, dt);
    // The searchlight: on you while it sees you, sweeping round the last place otherwise.
    if (h.visible) {
      h.aimX = me.x;
      h.aimZ = me.z;
    } else {
      h.aimX = h.lastX + Math.cos(this.time * 0.9) * 12;
      h.aimZ = h.lastZ + Math.sin(this.time * 0.9) * 12;
    }
  }

  /** Shot-down helicopters fall and blow up; the ones nobody needs leave. */
  private tickHelis(dt: number, now: number): void {
    for (const [playerId, h] of this.helis) {
      if (!h.downAt) {
        if (!this.wanted.has(playerId)) this.helis.delete(playerId);
        continue;
      }
      const t = (now - h.downAt) / 1000;
      h.y -= dt * (4 + t * 9);
      h.yaw += dt * 5;
      if (h.y > 1.5) continue;
      this.helis.delete(playerId);
      this.heliGone.set(playerId, now);
      this.ctx.hub.broadcast('combat.explosion', { x: h.x, y: 1, z: h.z, radius: 8 });
    }
  }

  /** Helicopters that can be shot (for the bullets). */
  heliTargets(): { id: number; x: number; y: number; z: number }[] {
    return [...this.helis.values()].filter((h) => !h.downAt).map((h) => ({ id: h.id, x: h.x, y: h.y, z: h.z }));
  }

  /** A bullet hit a helicopter; returns true when that shot brought it down. */
  damageHeli(id: number, amount: number, now = Date.now()): boolean {
    for (const h of this.helis.values()) {
      if (h.id !== id || h.downAt) continue;
      h.hp = Math.max(0, h.hp - amount);
      if (h.hp > 0) return false;
      h.downAt = now;
      h.sees = false;
      for (const p of this.crew(h.player)) this.ctx.hub.notify(p, { kind: 'success', title: '🚁 Helikopter düşürüldü!', text: 'Bir süre gökyüzü temiz.' });
      log.info('helicopter down', { player: h.player });
      return true;
    }
    return false;
  }

  /** The helicopter after a player (tests, HUD). */
  heliOf(playerId: string): Readonly<Heli> | undefined {
    return this.helis.get(playerId);
  }

  /** Helicopters within `radius` of a point (for snapshots); searchlight 9999 = off. */
  heliSnapshot(x: number, z: number, radius: number): HeliSnap[] {
    const out: HeliSnap[] = [];
    const r = (v: number) => Math.round(v * 100) / 100;
    for (const h of this.helis.values()) {
      if (Math.hypot(h.x - x, h.z - z) > radius) continue;
      const lit = h.sees && !h.downAt;
      out.push([h.id, r(h.x), r(h.y), r(h.z), Math.round(h.yaw * 1000) / 1000, lit ? r(h.aimX) : 9999, lit ? r(h.aimZ) : 9999, Math.round((h.hp / ECONOMY.police.heli.hp) * 100) / 100]);
    }
    return out;
  }

  // ---------------------------------------------------------------- spike strips

  private throwSpikes(playerId: string, stars: number, me: { x: number; z: number; rot: number; onFoot: boolean; deck: number }, now: number): void {
    const sc = ECONOMY.police.spikes;
    if (stars < sc.stars || me.onFoot) return;
    // The first one a few seconds after the third star, then every `everySec`.
    if (!this.spikeAt.has(playerId)) this.spikeAt.set(playerId, now - (sc.everySec - 6) * 1000);
    if (now - this.spikeAt.get(playerId)! < sc.everySec * 1000) return;
    const strip = spikePlacement(me.x, me.z, me.rot, sc.ahead, me.deck);
    if (!strip) return;
    const id = this.spikeSeq++;
    this.spikes.set(id, { ...strip, id, until: now + sc.lifeSec * 1000 });
    this.spikeAt.set(playerId, now);
    for (const p of this.crew(playerId)) this.ctx.hub.notify(p, { kind: 'warning', title: 'Çivili barikat!', text: 'Polis ileriye çivili şerit attı: üstünden geçersen lastikler patlar.' });
  }

  /** Put a strip down (tests, events). */
  addSpikes(strip: SpikeStrip, now = Date.now()): number {
    const id = this.spikeSeq++;
    this.spikes.set(id, { ...strip, id, until: now + ECONOMY.police.spikes.lifeSec * 1000 });
    return id;
  }

  /** Any tyre on a strip bursts (whoever is driving). */
  private checkSpikes(now: number): void {
    for (const [id, s] of this.spikes) if (now > s.until) this.spikes.delete(id);
    if (this.spikes.size === 0) return;
    for (const d of this.ctx.sim.drives.values()) {
      const v = this.ctx.state.vehicles.get(d.vehicleId);
      if (!v || v.mods.blown || this.bursting.has(d.vehicleId)) continue;
      const tyres = tyrePoints(d.dyn.x, d.dyn.z, d.dyn.rot, d.params.halfLength, d.params.halfWidth);
      for (const s of this.spikes.values()) {
        if ((s.deck ?? 0) !== (d.dyn.deck ?? 0) || !tyres.some((t) => onSpikes(s, t.x, t.z))) continue;
        void this.burst(d.vehicleId, d.playerId, d.dyn.x, d.dyn.z);
        break;
      }
    }
  }

  private async burst(vehicleId: string, playerId: string, x: number, z: number): Promise<void> {
    this.bursting.add(vehicleId);
    try {
      await this.ctx.locks.run([K.vehicle(vehicleId)], async () => {
        const live = this.ctx.state.vehicles.get(vehicleId);
        if (!live || live.mods.blown) return;
        const uow = this.ctx.state.begin();
        const veh = uow.vehicle(vehicleId);
        veh.mods = { ...veh.mods, blown: true };
        veh.condition = { ...veh.condition, tires: 0 };
        uow.notify(playerId, { kind: 'error', title: 'LASTİKLER PATLADI!', text: `${modelDisplayName(veh.modelId)} jantların üstünde (tutuş -%90). Wrench Bros'ta lastikleri yenilet.` });
        await uow.commit();
        this.ctx.sim.refreshParams(this.ctx.state.vehicles.get(vehicleId)!);
      });
      this.ctx.hub.broadcast('police.spiked', { vehicleId, x, z });
      log.info('tyres burst', { vehicleId, playerId });
    } catch (err) {
      log.warn('burst failed', { vehicleId, err: String(err) });
    } finally {
      this.bursting.delete(vehicleId);
    }
  }

  /** Spike strips within `radius` of a point (for snapshots). */
  spikeSnapshot(x: number, z: number, radius: number): SpikeSnap[] {
    const out: SpikeSnap[] = [];
    for (const s of this.spikes.values()) {
      if (Math.hypot(s.x - x, s.z - z) > radius) continue;
      const snap: SpikeSnap = [s.id, Math.round(s.x * 100) / 100, Math.round(s.z * 100) / 100, Math.round(s.rot * 1000) / 1000, Math.round(s.half * 100) / 100];
      if (s.deck) snap.push(s.deck);
      out.push(snap);
    }
    return out;
  }

  /** Where the wanted player is: their car or themselves on foot. */
  private target(playerId: string): Target | null {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c) return null;
    // A passenger is wherever the car is.
    const vid = c.drivingId ?? c.ridingId;
    const d = vid ? this.ctx.sim.drives.get(vid) : undefined;
    if (d) {
      const h = d.dyn.speed >= 0 ? d.dyn.rot + d.dyn.slip : d.dyn.rot;
      return { x: d.dyn.x, z: d.dyn.z, rot: d.dyn.rot, speed: d.dyn.speed, vx: Math.sin(h) * d.dyn.speed, vz: Math.cos(h) * d.dyn.speed, hl: d.params.halfLength, hw: d.params.halfWidth, onFoot: false, vehicleId: d.vehicleId, deck: d.dyn.deck ?? 0 };
    }
    return { x: c.x, z: c.z, rot: c.rot, speed: 0, vx: 0, vz: 0, hl: 0.4, hw: 0.4, onFoot: true, vehicleId: null, deck: c.deck ?? 0 };
  }

  // ---------------------------------------------------------------- spawning

  /** A police car some way behind the player (ECONOMY.police.chase.spawnDist), on the same road (or the same bridge). */
  private spawn(me: { x: number; z: number; rot: number; deck: number }, index: number): Unit | null {
    const side = index % 2 === 0 ? 1 : -1;
    const hp = projectToHighway(me.x, me.z);
    let x: number;
    let z: number;
    let rot: number;
    let deck = 0;
    const bridge = me.deck ? bridgeByN(me.deck) : undefined;
    if (bridge) {
      // Up on the bridge behind the player.
      const dir = Math.sin(me.rot) >= 0 ? 1 : -1;
      x = Math.max(bridge.x0 + 2, Math.min(bridge.x1 - 2, me.x - dir * (CH.spawnDist - 15 + index * 14)));
      z = bridge.z + (index % 2 ? 4 : -4);
      rot = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      deck = bridge.n;
    } else if (Math.abs(hp.offset) < CARRIAGEWAY_EDGE) {
      const cw: Carriageway = hp.offset < 0 ? 0 : 1;
      const lane = Math.max(0, Math.min(3, Math.round(offsetToLane(hp.offset)) + (index % 2 ? 1 : -1)));
      const s = wrapS(hp.s - travelDir(cw) * (CH.spawnDist + index * 14));
      const p = pathPoint(s, laneOffset(cw, lane));
      x = p.x;
      z = p.z;
      rot = pathYaw(p, cw === 1);
    } else {
      // A road point 100-160 m away (city or far shore), preferably behind the player, on their side of the water.
      const fx = Math.sin(me.rot);
      const fz = Math.cos(me.rot);
      let best: { x: number; z: number; score: number } | null = null;
      for (const p of ROAD_POINTS) {
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < CH.spawnDist - 45 || d > CH.spawnDist + 55 || crossesWater(p.x, p.z, me.x, me.z)) continue;
        const behind = -((p.x - me.x) * fx + (p.z - me.z) * fz) / d;
        const score = Math.abs(d - CH.spawnDist) - behind * 40 + ((index * 17 + Math.round(p.x + p.z)) % 7 + 7) % 7;
        if (!best || score < best.score) best = { x: p.x, z: p.z, score };
      }
      if (!best) return null;
      x = best.x;
      z = best.z;
      rot = Math.atan2(me.x - x, me.z - z);
    }
    const dyn = newVehicleDyn(x, z, rot);
    dyn.deck = deck;
    // Arrive at speed.
    dyn.speed = 80 / KMH_PER_MS;
    dyn.gear = 3;
    return { id: nextUnitId++, dyn, stuck: 0, reverseUntil: 0, waypoint: null, replanAt: 0, side, parked: false, sees: false, seeT: 0, searching: false, searchAt: null, searchUntil: 0, leadK: LEAD_K[index % LEAD_K.length]!, followIn: null, crashUntil: 0 };
  }

  // ---------------------------------------------------------------- driving

  /**
   * One police car's driving for a tick. While the police know where the player is it chases them
   * (aiming a little ahead, alongside when close, to box them in); otherwise it searches: first to
   * where they were last seen (and a little further the way they were going), then from road point
   * to road point round there, slower, with its lights yellow. Cars keep their distance from each
   * other instead of driving nose to tail.
   */
  private drive(playerId: string, u: Unit, w: Wanted, me: Target, dt: number): void {
    if (u.parked || this.time < u.crashUntil) {
      stepVehicle(u.dyn, { keys: KEY.BRAKE, dt }, this.params, this.ctx.sim.collisionWorld, `po:${u.id}`);
      return;
    }
    const sc = ECONOMY.police.sight;
    u.searching = !w.knows && !!w.lastKnown;
    let goal: { x: number; z: number; deck: number; vx: number; vz: number; rot: number; hw: number };
    if (u.searching) {
      if (!u.searchAt || this.time >= u.searchUntil || Math.hypot(u.searchAt.x - u.dyn.x, u.searchAt.z - u.dyn.z) < 12) {
        u.searchAt = this.searchPoint(u, w.lastKnown!);
        u.searchUntil = this.time + 14;
      }
      goal = { ...u.searchAt, vx: 0, vz: 0, rot: u.dyn.rot, hw: 0 };
    } else {
      u.searchAt = null;
      goal = me;
    }
    const chase = !u.searching;
    // The player in a back alley: straight in after them only if it was right behind them,
    // otherwise round to the end they are heading for (the nearer one if they stopped).
    let direct = false;
    let boxIn = chase;
    const alley = chase && !goal.deck ? alleyAt(goal.x, goal.z) : undefined;
    if (alley && u.followIn === alley.id) direct = true;
    else if (alley) {
      const [m0, m1] = alleyMouths(alley, 8);
      const v = alley.axis === 'x' ? goal.vx : goal.vz;
      const mouth = Math.abs(v) > 1 ? (v > 0 ? m1 : m0) : Math.hypot(m0.x - u.dyn.x, m0.z - u.dyn.z) < Math.hypot(m1.x - u.dyn.x, m1.z - u.dyn.z) ? m0 : m1;
      goal = { x: mouth.x, z: mouth.z, deck: 0, vx: 0, vz: 0, rot: u.dyn.rot, hw: 0 };
      boxIn = false;
    }
    const dist = Math.hypot(goal.x - u.dyn.x, goal.z - u.dyn.z);
    // Aim: ahead of the player when far, alongside them when close (to box them in).
    const lead = chase ? Math.min(CH.lead * u.leadK, dist / 45) : 0;
    let tx = goal.x + goal.vx * lead;
    let tz = goal.z + goal.vz * lead;
    if (boxIn && dist < 22) {
      const rx = Math.cos(goal.rot);
      const rz = -Math.sin(goal.rot);
      const side = (goal.hw + this.params.halfWidth + 0.6) * u.side;
      tx = goal.x + rx * side + Math.sin(goal.rot) * 1.5;
      tz = goal.z + rz * side + Math.cos(goal.rot) * 1.5;
    }
    // Not on the same level (one up on a bridge, the other below or elsewhere): via the bridge's end.
    const uDeck = u.dyn.deck ?? 0;
    const levels = uDeck !== goal.deck;
    if (levels) {
      const b = bridgeByN(uDeck || goal.deck)!;
      const [wEnd, eEnd] = bridgeEnds(b);
      if (uDeck) {
        // Off the bridge at the end nearer the goal.
        const end = Math.hypot(goal.x - wEnd.x, goal.z - wEnd.z) < Math.hypot(goal.x - eEnd.x, goal.z - eEnd.z) ? wEnd : eEnd;
        tx = end.x + (end === wEnd ? -20 : 20);
        tz = end.z;
      } else {
        // Onto the bridge at the end nearer this car.
        const end = Math.hypot(u.dyn.x - wEnd.x, u.dyn.z - wEnd.z) < Math.hypot(u.dyn.x - eEnd.x, u.dyn.z - eEnd.z) ? wEnd : eEnd;
        const onto = Math.hypot(u.dyn.x - end.x, u.dyn.z - end.z) < 14;
        tx = onto ? end.x + (end === wEnd ? 30 : -30) : end.x;
        tz = end.z;
      }
    }
    const hp = projectToHighway(u.dyn.x, u.dyn.z);
    const onHighway = !uDeck && Math.abs(hp.offset) < CARRIAGEWAY_EDGE;
    const goalHp = projectToHighway(goal.x, goal.z);
    if (!levels && onHighway && !goal.deck && Math.abs(goalHp.offset) < CARRIAGEWAY_EDGE && dist > 22) {
      // Follow the lanes round the ring towards the goal.
      const cw: Carriageway = hp.offset < 0 ? 0 : 1;
      const p = pathPoint(wrapS(hp.s + travelDir(cw) * Math.min(28, dist)), (hp.offset + goalHp.offset) / 2);
      tx = p.x;
      tz = p.z;
    } else if (!onHighway && !direct && !this.clear(u.dyn.x, u.dyn.z, tx, tz)) {
      if (this.time >= u.replanAt) {
        u.replanAt = this.time + 0.5;
        u.waypoint = this.route(u.dyn.x, u.dyn.z, tx, tz);
      }
      if (u.waypoint) {
        tx = u.waypoint.x;
        tz = u.waypoint.z;
      }
    }
    const want = Math.atan2(tx - u.dyn.x, tz - u.dyn.z);
    const turn = angleDiff(u.dyn.rot, want);
    let keys = 0;
    if (this.time < u.reverseUntil) {
      keys = KEY.BACK | (turn > 0 ? KEY.RIGHT : KEY.LEFT);
    } else {
      if (turn > 0.04) keys |= KEY.LEFT;
      else if (turn < -0.04) keys |= KEY.RIGHT;
      const kmh = u.dyn.speed * KMH_PER_MS;
      const tooFast = chase && dist < 16 && u.dyn.speed > Math.hypot(goal.vx, goal.vz) + 3;
      const sharp = Math.abs(turn) > 1.1 && u.dyn.speed > 11;
      // Searching: a slow patrol, not a race.
      const slowDown = !chase && kmh > sc.searchKmh + 12;
      const coast = !chase && kmh > sc.searchKmh;
      // Keep a gap to the police car ahead (not while boxing the player in).
      const gap = dist > 25 ? this.gapAhead(u, w) : Infinity;
      const tailgating = gap < sc.spacing;
      if (tooFast || sharp || slowDown || (tailgating && gap < sc.spacing * 0.5 && u.dyn.speed > 4)) keys |= KEY.BACK;
      else if (!coast && !tailgating) keys |= KEY.FORWARD;
      // Stuck against something: back out.
      if (u.dyn.speed < 0.8 && (keys & KEY.FORWARD) !== 0) u.stuck += dt;
      else u.stuck = Math.max(0, u.stuck - dt);
      if (u.stuck > 1.6) {
        u.reverseUntil = this.time + 1.3;
        u.stuck += 0.5;
      }
    }
    const v0 = Math.abs(u.dyn.speed);
    stepVehicle(u.dyn, { keys, dt }, this.params, this.ctx.sim.collisionWorld, `po:${u.id}`);
    // Into the bollards at speed: a crash.
    if (v0 * KMH_PER_MS > 35 && Math.abs(u.dyn.speed) < v0 * 0.55 && BOLLARDS.some((b) => Math.hypot(b.x - u.dyn.x, b.z - u.dyn.z) < this.params.halfLength + 1)) this.crash(playerId, u, w, v0);
  }

  /** A police car hit the bollards at the end of a back alley: it sits there a few seconds, then
   *  goes round. */
  private crash(playerId: string, u: Unit, w: Wanted, speed: number): void {
    u.crashUntil = this.time + ECONOMY.police.alleys.crashSec;
    u.followIn = null;
    u.stuck = 0;
    u.reverseUntil = 0;
    this.ctx.hub.broadcast('police.crash', { x: u.dyn.x, z: u.dyn.z, kmh: Math.round(speed * KMH_PER_MS) });
    const now = Date.now();
    if (now - w.crashNoteAt < 5000) return;
    w.crashNoteAt = now;
    for (const p of this.crew(playerId)) this.ctx.hub.notify(p, { kind: 'success', title: '🚧 Polis direğe çarptı!', text: 'Ara sokağın bariyer direkleri polis aracını durdurdu. Diğer ekipler öbür uçtan dolanacak!' });
    log.info('police hit the bollards', { playerId, unit: u.id });
  }

  /** Distance to the nearest other police car of the pursuit straight ahead of this one (Infinity: none). */
  private gapAhead(u: Unit, w: Wanted): number {
    const fx = Math.sin(u.dyn.rot);
    const fz = Math.cos(u.dyn.rot);
    let best = Infinity;
    for (const o of w.units) {
      if (o === u || (o.dyn.deck ?? 0) !== (u.dyn.deck ?? 0)) continue;
      const dx = o.dyn.x - u.dyn.x;
      const dz = o.dyn.z - u.dyn.z;
      const d = Math.hypot(dx, dz);
      // Ahead of it and roughly in its lane.
      if (d < 0.1 || (dx * fx + dz * fz) / d < 0.75) continue;
      best = Math.min(best, d);
    }
    return best;
  }

  /** Where a searching car goes next: where the player was last seen (and a bit further the way
   *  they were going), then road points round there, each car its own way. */
  private searchPoint(u: Unit, k: NonNullable<Wanted['lastKnown']>): { x: number; z: number; deck: number } {
    const sc = ECONOMY.police.sight;
    // First stop: the last sighting, pushed on a couple of seconds.
    const ahead = { x: k.x + k.vx * 2, z: k.z + k.vz * 2 };
    if (!u.searchAt && Math.hypot(ahead.x - u.dyn.x, ahead.z - u.dyn.z) > 15) return { ...ahead, deck: k.deck };
    // On a bridge: up and down the deck.
    if (k.deck) {
      const b = bridgeByN(k.deck);
      if (b) {
        const x = Math.max(b.x0 + 10, Math.min(b.x1 - 10, k.x + (this.rng() - 0.5) * sc.searchRadius * 2));
        return { x, z: b.z, deck: k.deck };
      }
    }
    const pts = ROAD_POINTS.filter((p) => {
      const d = Math.hypot(p.x - k.x, p.z - k.z);
      return d < sc.searchRadius && Math.hypot(p.x - u.dyn.x, p.z - u.dyn.z) > 15 && !crossesWater(p.x, p.z, k.x, k.z);
    });
    if (pts.length === 0) return { x: k.x + (this.rng() - 0.5) * 30, z: k.z + (this.rng() - 0.5) * 30, deck: 0 };
    const p = pts[Math.floor(this.rng() * pts.length)]!;
    return { x: p.x, z: p.z, deck: 0 };
  }

  private rng(): number {
    return this.ctx.rng();
  }

  /** Is the straight line between two points free of buildings, open water and back alleys (a
   *  car can't get through those)? */
  private clear(ax: number, az: number, bx: number, bz: number): boolean {
    if (crossesWater(ax, az, bx, bz) || crossesWall(ax, az, bx, bz)) return false;
    for (const b of this.ctx.sim.collisionWorld.boxes) if (segmentHitsBox(ax, az, bx, bz, b, 1.4)) return false;
    for (const b of ALLEY_PASSAGES) if (segmentHitsBox(ax, az, bx, bz, b, 0.5)) return false;
    return true;
  }

  /** Next waypoint on the road network (junctions, bridges) towards a target. */
  private route(ax: number, az: number, tx: number, tz: number): { x: number; z: number } | null {
    const nodes = NAV_NODES;
    const n = nodes.length;
    const dist = new Array<number>(n).fill(Infinity);
    const first = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (this.clear(ax, az, nodes[i]!.x, nodes[i]!.z)) {
        dist[i] = Math.hypot(nodes[i]!.x - ax, nodes[i]!.z - az);
        first[i] = i;
      }
    }
    let best = -1;
    let bestCost = Infinity;
    for (;;) {
      let i = -1;
      for (let k = 0; k < n; k++) if (!done[k] && dist[k]! < Infinity && (i < 0 || dist[k]! < dist[i]!)) i = k;
      if (i < 0) break;
      done[i] = true;
      const a = nodes[i]!;
      if (this.clear(a.x, a.z, tx, tz)) {
        const c = dist[i]! + Math.hypot(tx - a.x, tz - a.z);
        if (c < bestCost) {
          bestCost = c;
          best = i;
        }
      }
      for (const k of NAV_ADJ[i]!) {
        if (done[k]) continue;
        const b = nodes[k]!;
        const c = dist[i]! + Math.hypot(b.x - a.x, b.z - a.z);
        if (c < dist[k]!) {
          dist[k] = c;
          first[k] = first[i]!;
        }
      }
    }
    return best >= 0 ? nodes[first[best]!]! : null;
  }

  // ---------------------------------------------------------------- outcomes

  private async escaped(playerId: string, w: Wanted): Promise<void> {
    const cfg = ECONOMY.police;
    // The wanted level is wiped clean: no stars, no cars, no checkpoint waiting at the bridge.
    this.wanted.delete(playerId);
    this.closeCheckpoint(playerId);
    this.publishObstacles();
    this.ctx.hub.sendTo(playerId, 'police.wanted', { stars: 0, units: 0, escapeLeft: null, bust: 0 });
    for (const l of this.clearedListeners) l(playerId);
    if (!w.pursued) return;
    // $2,000, or $1,000 for every police car you got away from when that is more.
    const cars = Math.max(1, w.chasers.size);
    const reward = Math.max(cfg.escapeReward, cfg.escapePerCar * cars);
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        uow.credit(p, reward, 'police_escape', `Escaped ${cars} police car${cars === 1 ? '' : 's'}`);
        uow.grantXp(p, cfg.escapeXp);
        await uow.commit();
      });
      this.ctx.hub.sendTo(playerId, 'police.escaped', { reward, xp: cfg.escapeXp, cars });
      for (const l of this.escapeListeners) l(playerId);
    } catch (err) {
      log.error('escape reward failed', { playerId, error: (err as Error).message });
    }
  }

  private async bust(playerId: string, w: Wanted, me: { x: number; z: number; rot: number; vehicleId: string | null; hl: number; hw: number }): Promise<void> {
    const cfg = ECONOMY.police;
    // The nearest police car pulls up beside the player; the others leave.
    let nearest: Unit | null = null;
    for (const u of w.units) if (!nearest || Math.hypot(u.dyn.x - me.x, u.dyn.z - me.z) < Math.hypot(nearest.dyn.x - me.x, nearest.dyn.z - me.z)) nearest = u;
    w.units = nearest ? [nearest] : [];
    if (nearest) {
      // Stopped alongside on the driver's (left) side, a little ahead, leaving room for the door.
      const rx = Math.cos(me.rot);
      const rz = -Math.sin(me.rot);
      const side = me.hw + this.params.halfWidth + 2.4;
      Object.assign(nearest.dyn, newVehicleDyn(me.x + rx * side + Math.sin(me.rot) * 1.8, me.z + rz * side + Math.cos(me.rot) * 1.8, me.rot));
      nearest.parked = true;
    }
    const d = me.vehicleId ? this.ctx.sim.drives.get(me.vehicleId) : undefined;
    if (d) {
      d.hold = true;
      d.dyn.speed = 0;
    }
    const garage = GARAGES.reduce((a, b) => (Math.hypot(b.x - me.x, b.z - me.z) < Math.hypot(a.x - me.x, a.z - me.z) ? b : a));
    let fine = 0;
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        const f = policeFine(p.money, p.bank);
        fine = f.total;
        if (f.cash > 0) uow.debit(p, f.cash, 'police_fine', 'Arrested: police fine');
        if (f.bank > 0) {
          p.bank -= f.bank;
          uow.log(p, 'police_fine', -f.bank, 'Arrested: police fine (from the bank)');
        }
        uow.notify(playerId, { kind: 'warning', title: 'POLİSE YAKALANDIN!', text: `$${fine.toLocaleString('en-US')} ceza ödendi. Araç bağlandı, en yakın garajdan çıkıyorsun.` }, false, (id) => this.ctx.hub.isOnline(id));
        await uow.commit();
      });
    } catch (err) {
      log.error('police fine failed', { playerId, error: (err as Error).message });
    }
    const event: BustedEvent = {
      fine,
      at: { x: me.x, z: me.z, rot: me.rot },
      police: nearest ? { x: nearest.dyn.x, z: nearest.dyn.z, rot: nearest.dyn.rot } : null,
      respawn: { x: garage.x, z: garage.z, rot: 0 },
      vehicleId: me.vehicleId,
      cutsceneMs: cfg.cutsceneSec * 1000,
    };
    w.busted = { until: Date.now() + event.cutsceneMs, event };
    w.heat = 0;
    for (const l of this.bustListeners) l(playerId);
    this.ctx.hub.sendTo(playerId, 'police.busted', event);
    this.ctx.hub.sendTo(playerId, 'police.wanted', { stars: 0, units: 0, escapeLeft: null, bust: 1 });
    log.info('player arrested', { playerId, fine });
  }

  /** After the cutscene: the car goes to the garage, the player walks out of the nearest garage. */
  private async release(playerId: string, w: Wanted): Promise<void> {
    const ev = w.busted?.event;
    this.wanted.delete(playerId);
    this.publishObstacles();
    if (!ev) return;
    try {
      const c = this.ctx.sim.chars.get(playerId);
      const vehicleId = c?.drivingId ?? ev.vehicleId;
      if (c?.drivingId) {
        await this.ctx.locks.run([K.player(playerId), K.vehicle(c.drivingId)], async () => {
          await this.vehicles.flushDrive(c.drivingId!, true);
          this.ctx.sim.stopDriving(playerId);
        });
      }
      if (vehicleId) {
        await this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
          const v = this.ctx.state.vehicles.get(vehicleId);
          if (!v || v.ownerId !== playerId || this.ctx.sim.isDriven(vehicleId)) return;
          if (v.status === 'stolen') {
            // A stolen car goes back to its real owner.
            const uow = this.ctx.state.begin();
            uow.deleteVehicle(vehicleId);
            uow.notify(playerId, { kind: 'warning', title: 'Araç bağlandı', text: `Stolen ${modelDisplayName(v.modelId)} seized: towed to the police station and returned to its owner.` }, false, (id) => this.ctx.hub.isOnline(id));
            await uow.commit();
            for (const l of this.seizeListeners) l(playerId, vehicleId);
            return;
          }
          if (v.status !== 'world') return;
          const uow = this.ctx.state.begin();
          uow.vehicle(vehicleId).status = 'stored';
          uow.notify(playerId, { kind: 'info', title: 'Impounded', text: `Your ${modelDisplayName(v.modelId)} was towed to your garage.` }, false, (id) => this.ctx.hub.isOnline(id));
          await uow.commit();
        });
      }
      this.ctx.sim.teleport(playerId, ev.respawn.x, ev.respawn.z);
      this.ctx.sim.rebuildDynamic();
    } catch (err) {
      log.error('release after arrest failed', { playerId, error: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------- network

  private send(playerId: string, w: Wanted, force = false): void {
    const cfg = ECONOMY.police;
    const stars = starsFor(w.heat);
    const escapeLeft = stars >= cfg.pursuitStars && w.hiddenT > 0.4 ? Math.max(0, Math.ceil(cfg.sight.hiddenSec - w.hiddenT)) : null;
    const h = this.helis.get(playerId);
    const state: WantedState = { stars, units: w.units.length, escapeLeft, bust: Math.round(Math.min(1, w.bustT / cfg.bustSec) * 10) / 10, heli: h && !h.downAt ? (h.sees ? 'seen' : 'lost') : null };
    if (w.seen > 0) state.seen = Math.round(w.seen * 10) / 10;
    if (w.units.some((u) => u.searching)) state.search = true;
    const key = JSON.stringify(state);
    const now = Date.now();
    if (!force && (key === w.sent || now - w.sentAt < 200)) return;
    w.sent = key;
    w.sentAt = now;
    this.ctx.hub.sendTo(playerId, 'police.wanted', state);
  }

  /** Police cars are obstacles for everyone (and traffic brakes for them). */
  private publishObstacles(): void {
    const list = [];
    const groups = [...[...this.wanted.values()].map((w) => w.units), ...[...this.checkpoints.values()].map((c) => c.units)];
    for (const units of groups) {
      for (const u of units) {
        const h = u.dyn.speed >= 0 ? u.dyn.rot + u.dyn.slip : u.dyn.rot;
        list.push({ id: `po:${u.id}`, modelId: POLICE_MODEL.id, x: u.dyn.x, z: u.dyn.z, rot: u.dyn.rot, vx: Math.sin(h) * u.dyn.speed, vz: Math.cos(h) * u.dyn.speed, deck: u.dyn.deck ?? 0 });
      }
    }
    this.ctx.sim.setExtraObstacles('police', list);
  }

  /** Police cars within `radius` of a point (for snapshots). */
  snapshot(x: number, z: number, radius: number): PoliceSnap[] {
    const out: PoliceSnap[] = [];
    const r2 = radius * radius;
    const groups = [...[...this.wanted.values()].map((w) => w.units), ...[...this.checkpoints.values()].map((c) => c.units)];
    for (const units of groups) {
      for (const u of units) {
        const d = u.dyn;
        if ((d.x - x) ** 2 + (d.z - z) ** 2 > r2) continue;
        const snap: PoliceSnap = [u.id, Math.round(d.x * 100) / 100, Math.round(d.z * 100) / 100, Math.round(d.rot * 1000) / 1000, Math.round(d.speed * 100) / 100, Math.round(d.steer * 1000) / 1000, (u.searching ? PF.SEARCH : PF.SIREN) | (d.brk > 0.1 ? PF.BRAKE : 0)];
        if (d.deck) snap.push(d.deck);
        out.push(snap);
      }
    }
    return out;
  }

  /** Any police car, spike strip or helicopter in the world (tick fast path). */
  get active(): boolean {
    return this.wanted.size > 0 || this.spikes.size > 0 || this.helis.size > 0;
  }
}

/** Does a segment pass through an axis-aligned box (grown by `pad`)? */
function segmentHitsBox(ax: number, az: number, bx: number, bz: number, b: AABB, pad: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const slab = (p: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return p >= lo && p <= hi;
    let ta = (lo - p) / d;
    let tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    return t0 <= t1;
  };
  return slab(ax, dx, b.minX - pad, b.maxX + pad) && slab(az, dz, b.minZ - pad, b.maxZ + pad);
}

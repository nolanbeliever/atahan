// Highway traffic driver model (server-authoritative).
//
// Each vehicle follows the one ahead with the Intelligent Driver Model and changes lanes with a
// MOBIL-style rule: it moves left when that lane lets it go meaningfully faster, moves back right
// when it can do so without slowing down (keep right), and always checks the gap behind in the
// target lane first. Before moving it blinks for SIGNAL_TIME seconds. Players are obstacles too:
// traffic brakes for them and, when a fast car comes up behind (or honks / flashes), moves over.

import {
  LANES,
  LOOP_LEN,
  centrelineStep,
  deltaS,
  laneOffset,
  offsetToLane,
  projectToHighway,
  travelDir,
  wrapS,
  CARRIAGEWAY_EDGE,
  type Carriageway,
} from '../../shared/highway';
import {
  LANE_CHANGE_RATE,
  SIGNAL_TIME,
  TF,
  TRAFFIC_KINDS,
  initialTraffic,
  laneSpeed,
  trafficCircles,
  trafficPose,
  trafficSpec,
  type TrafficSnap,
  type TrafficSpec,
} from '../../shared/traffic';
import type { DynamicCircle } from '../../shared/physics';

export interface TrafficCar {
  spec: TrafficSpec;
  s: number;
  /** Current lateral offset and the offset it is moving to (lane changes). */
  off: number;
  toff: number;
  /** Lane it is in (or moving to). */
  lane: number;
  v: number;
  /** Indicator: 0 off, TF.LEFT or TF.RIGHT. */
  signal: number;
  /** Lane it is signalling for and when it will start to move. */
  pendingLane: number | null;
  moveAt: number;
  braking: boolean;
  nextDecision: number;
  /** Moving over for a faster player until this time. */
  yieldUntil: number;
  x: number;
  z: number;
  yaw: number;
}

/** Something else on the highway (a player's car, a walker, a parked car). */
export interface HighwayBody {
  id: string;
  x: number;
  z: number;
  rot: number;
  /** Signed speed along its heading (m/s). */
  speed: number;
  halfLength: number;
  halfWidth: number;
}

interface Occupant {
  s: number;
  lo: number;
  hi: number;
  halfLen: number;
  /** Speed along the carriageway's travel direction. */
  v: number;
  car: TrafficCar | null;
}

const IDM_T = 1.25;
const IDM_S0 = 3;
const MAX_BRAKE = 9;
const DECISION_EVERY = 0.5;

export class TrafficSystem {
  readonly cars: TrafficCar[] = [];
  private time = 0;

  constructor(private readonly rng: () => number = Math.random) {
    for (const t of initialTraffic(LOOP_LEN)) {
      const spec = trafficSpec(t.id);
      const off = laneOffset(spec.cw, t.lane);
      const car: TrafficCar = {
        spec,
        s: t.s,
        off,
        toff: off,
        lane: t.lane,
        v: laneSpeed(spec, t.lane) * 0.9,
        signal: 0,
        pendingLane: null,
        moveAt: 0,
        braking: false,
        nextDecision: (t.id % 10) * 0.05 + 1,
        yieldUntil: 0,
        x: 0,
        z: 0,
        yaw: 0,
      };
      this.pose(car);
      this.cars.push(car);
    }
  }

  get now(): number {
    return this.time;
  }

  private pose(c: TrafficCar): void {
    const p = trafficPose(c.spec.cw, c.s, c.off);
    c.x = p.x;
    c.z = p.z;
    c.yaw = p.yaw;
  }

  /** Occupants of each carriageway (traffic plus other bodies on the road). */
  private occupants(bodies: readonly HighwayBody[]): [Occupant[], Occupant[]] {
    const out: [Occupant[], Occupant[]] = [[], []];
    for (const c of this.cars) {
      const hw = c.spec.width / 2;
      out[c.spec.cw].push({ s: c.s, lo: Math.min(c.off, c.toff) - hw, hi: Math.max(c.off, c.toff) + hw, halfLen: c.spec.length / 2, v: c.v, car: c });
    }
    for (const b of bodies) {
      const hp = projectToHighway(b.x, b.z);
      if (Math.abs(hp.offset) > CARRIAGEWAY_EDGE + 1) continue;
      const cw: Carriageway = hp.offset < 0 ? 0 : 1;
      // Heading relative to the travel direction: its footprint across and along the road.
      const p = trafficPose(cw, hp.s, hp.offset);
      const along = Math.sin(b.rot) * Math.sin(p.yaw) + Math.cos(b.rot) * Math.cos(p.yaw);
      const across = Math.sqrt(Math.max(0, 1 - along * along));
      const halfLat = b.halfWidth * Math.abs(along) + b.halfLength * across;
      const halfLen = b.halfLength * Math.abs(along) + b.halfWidth * across;
      out[cw].push({ s: hp.s, lo: hp.offset - halfLat, hi: hp.offset + halfLat, halfLen, v: b.speed * along, car: null });
    }
    return out;
  }

  /** Nearest occupant ahead of (or behind) position s within a lateral band. */
  private neighbour(occ: Occupant[], self: TrafficCar | null, s: number, halfLen: number, lo: number, hi: number, dir: 1 | -1, ahead: boolean): { gap: number; v: number } | null {
    let best: { gap: number; v: number } | null = null;
    for (const o of occ) {
      if (o.car === self || o.hi <= lo || o.lo >= hi) continue;
      const d = deltaS(s, o.s) * dir * (ahead ? 1 : -1);
      if (d < -0.5) continue;
      const gap = d - halfLen - o.halfLen;
      if (!best || gap < best.gap) best = { gap, v: o.v };
    }
    return best;
  }

  private idm(c: TrafficCar, v0: number, leader: { gap: number; v: number } | null, v = c.v): number {
    const def = TRAFFIC_KINDS[c.spec.kind];
    const free = def.accel * (1 - Math.pow(v / Math.max(0.1, v0), 4));
    if (!leader || leader.gap > 160) return free;
    const sStar = IDM_S0 + Math.max(0, v * IDM_T + (v * (v - leader.v)) / (2 * Math.sqrt(def.accel * def.decel)));
    const gap = Math.max(0.1, leader.gap);
    return free - def.accel * (sStar / gap) * (sStar / gap);
  }

  private laneBand(c: TrafficCar, lane: number): [number, number] {
    const o = laneOffset(c.spec.cw, lane);
    const hw = c.spec.width / 2;
    return [o - hw, o + hw];
  }

  /** Would moving into `lane` be safe, and how much faster could the car go there? */
  private evaluate(c: TrafficCar, occ: Occupant[], lane: number): { safe: boolean; gain: number } {
    const dir = travelDir(c.spec.cw);
    const [lo, hi] = this.laneBand(c, lane);
    const halfLen = c.spec.length / 2;
    const ahead = this.neighbour(occ, c, c.s, halfLen, lo, hi, dir, true);
    const behind = this.neighbour(occ, c, c.s, halfLen, lo, hi, dir, false);
    if (ahead && ahead.gap < 4 + c.v * 0.4) return { safe: false, gain: -Infinity };
    if (behind) {
      if (behind.gap < 5) return { safe: false, gain: -Infinity };
      // Deceleration the follower would need with us cutting in (IDM with a generic car).
      const vf = Math.max(0, behind.v);
      const sStar = IDM_S0 + Math.max(0, vf * IDM_T + (vf * (vf - c.v)) / (2 * Math.sqrt(2 * 3.5)));
      const needed = 2 * (sStar / Math.max(0.1, behind.gap)) ** 2;
      if (needed > 3 || (vf - c.v) * 2.2 > behind.gap) return { safe: false, gain: -Infinity };
    }
    const curLeader = this.neighbour(occ, c, c.s, halfLen, ...this.laneBand(c, c.lane), dir, true);
    const now = this.idm(c, laneSpeed(c.spec, c.lane), curLeader);
    const there = this.idm(c, laneSpeed(c.spec, lane), ahead);
    return { safe: true, gain: there - now };
  }

  private decide(c: TrafficCar, occ: Occupant[]): void {
    const def = TRAFFIC_KINDS[c.spec.kind];
    const left = c.lane - 1;
    const right = c.lane + 1;
    const yielding = this.time < c.yieldUntil;
    let target: number | null = null;
    if (right <= def.lanes[1]) {
      const r = this.evaluate(c, occ, right);
      // Keep right: move back when it costs (almost) nothing, or right away when yielding.
      if (r.safe && (yielding || (c.lane < c.spec.homeLane && r.gain > -0.25) || r.gain > 0.9)) target = right;
    }
    if (target === null && !yielding && left >= def.lanes[0]) {
      const l = this.evaluate(c, occ, left);
      if (l.safe && l.gain > 0.45 && this.rng() < 0.75) target = left;
    }
    // Now and then drivers change lanes for no particular reason.
    if (target === null && !yielding && this.rng() < 0.01) {
      const pick = this.rng() < 0.5 ? left : right;
      if (pick >= def.lanes[0] && pick <= def.lanes[1] && this.evaluate(c, occ, pick).safe) target = pick;
    }
    if (target !== null) {
      c.pendingLane = target;
      c.signal = target < c.lane ? TF.LEFT : TF.RIGHT;
      c.moveAt = this.time + SIGNAL_TIME * (yielding ? 0.6 : 1);
    }
  }

  /** Ask a car to move over (a faster player behind it). */
  requestYield(c: TrafficCar, seconds = 5): void {
    if (this.time < c.yieldUntil) return;
    c.yieldUntil = this.time + seconds;
    if (c.pendingLane === null && c.off === c.toff) c.nextDecision = Math.min(c.nextDecision, this.time + 0.15);
  }

  step(dt: number, bodies: readonly HighwayBody[] = []): void {
    this.time += dt;
    const occ = this.occupants(bodies);
    for (const c of this.cars) {
      const o = occ[c.spec.cw];
      const dir = travelDir(c.spec.cw);
      const hw = c.spec.width / 2;
      // Car following: watch the lane it is in and, while changing, the one it is moving into.
      const leader = this.neighbour(o, c, c.s, c.spec.length / 2, Math.min(c.off, c.toff) - hw, Math.max(c.off, c.toff) + hw, dir, true);
      let acc = this.idm(c, laneSpeed(c.spec, c.lane), leader);
      acc = Math.max(-MAX_BRAKE, acc);
      if (leader && leader.gap < 0.3) c.v = Math.min(c.v, Math.max(0, leader.v));
      c.v = Math.max(0, c.v + acc * dt);
      c.braking = acc < -1.2 || (c.v < 0.5 && !!leader && leader.gap < 8);

      // Lane change: blink first, then drift across.
      if (c.pendingLane !== null && this.time >= c.moveAt) {
        if (this.evaluate(c, o, c.pendingLane).safe) {
          c.lane = c.pendingLane;
          c.toff = laneOffset(c.spec.cw, c.lane);
        } else c.signal = 0;
        c.pendingLane = null;
      }
      if (c.off !== c.toff) {
        const d = c.toff - c.off;
        const stepOff = LANE_CHANGE_RATE * dt * Math.min(1, 0.4 + c.v / 8);
        if (Math.abs(d) <= stepOff) {
          c.off = c.toff;
          c.signal = 0;
        } else c.off += Math.sign(d) * stepOff;
      }
      if (c.pendingLane === null && c.off === c.toff && this.time >= c.nextDecision) {
        c.nextDecision = this.time + DECISION_EVERY * (0.8 + 0.4 * this.rng());
        this.decide(c, o);
      }
      c.s = wrapS(c.s + dir * centrelineStep(c.s, c.off, c.v * dt));
      this.pose(c);
    }
  }

  /** The traffic car directly ahead of a body (same carriageway, overlapping laterally). */
  carAhead(x: number, z: number, rot: number, halfWidth: number, maxGap: number): { car: TrafficCar; gap: number; along: number } | null {
    const hp = projectToHighway(x, z);
    if (Math.abs(hp.offset) > CARRIAGEWAY_EDGE) return null;
    const cw: Carriageway = hp.offset < 0 ? 0 : 1;
    const dir = travelDir(cw);
    const p = trafficPose(cw, hp.s, hp.offset);
    const along = Math.sin(rot) * Math.sin(p.yaw) + Math.cos(rot) * Math.cos(p.yaw);
    if (along < 0.7) return null;
    let best: { car: TrafficCar; gap: number; along: number } | null = null;
    for (const c of this.cars) {
      if (c.spec.cw !== cw) continue;
      const hw = c.spec.width / 2;
      if (Math.max(c.off, c.toff) + hw < hp.offset - halfWidth || Math.min(c.off, c.toff) - hw > hp.offset + halfWidth) continue;
      const d = deltaS(hp.s, c.s) * dir;
      if (d <= 0) continue;
      const gap = d - c.spec.length / 2 - 2.3;
      if (gap < maxGap && (!best || gap < best.gap)) best = { car: c, gap, along };
    }
    return best;
  }

  /** Collider circles of the traffic near any of the given points. */
  circlesNear(points: readonly { x: number; z: number }[], radius: number, out: DynamicCircle[]): void {
    if (points.length === 0) return;
    const r2 = radius * radius;
    const tmp: { x: number; z: number; r: number }[] = [];
    for (const c of this.cars) {
      if (!points.some((p) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < r2)) continue;
      tmp.length = 0;
      for (const circle of trafficCircles(c.spec, c.s, c.off, tmp)) out.push({ ...circle, id: `tr:${c.spec.id}` });
    }
  }

  /** Compact updates for the cars within `radius` of a point. */
  snapshot(x: number, z: number, radius: number): TrafficSnap[] {
    const r2 = radius * radius;
    const out: TrafficSnap[] = [];
    for (const c of this.cars) {
      if ((c.x - x) ** 2 + (c.z - z) ** 2 > r2) continue;
      const flags = c.signal | (c.braking ? TF.BRAKE : 0);
      out.push([c.spec.id, Math.round(c.s * 100) / 100, Math.round(c.off * 100) / 100, Math.round(c.toff * 100) / 100, Math.round(c.v * 100) / 100, flags]);
    }
    return out;
  }

  /** Current lane index (fractional while changing) - for tests and debugging. */
  laneOf(c: TrafficCar): number {
    return offsetToLane(c.off);
  }
}

export { LANES };

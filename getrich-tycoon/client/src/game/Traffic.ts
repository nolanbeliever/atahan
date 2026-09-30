// Client-side highway traffic: server updates (10 Hz nearby, 2 Hz further out) extrapolated along
// the lanes every frame, with small corrections blended out so cars never jump. Also provides the
// traffic colliders for local driving prediction.

import { deltaS, travelDir, wrapS, centrelineStep } from '../../../shared/highway';
import type { DynamicBox } from '../../../shared/physics';
import { LANE_CHANGE_RATE, TF, trafficBoxes, trafficPose, trafficSpec, type TrafficSnap, type TrafficSpec } from '../../../shared/traffic';

export interface ClientTrafficCar {
  spec: TrafficSpec;
  s: number;
  off: number;
  toff: number;
  v: number;
  flags: number;
  /** Render-only corrections that fade out. */
  es: number;
  eo: number;
  seen: number;
  /** Pose for rendering (updated every frame). */
  x: number;
  z: number;
  yaw: number;
}

const STALE_MS = 1600;

export class TrafficClient {
  readonly cars = new Map<number, ClientTrafficCar>();

  /** Apply a server update; `ageSec` is how old it already is (latency). */
  apply(snaps: TrafficSnap[], ageSec: number, now = performance.now()): void {
    const age = Math.max(0, Math.min(0.35, ageSec));
    for (const [id, s, off, toff, v, flags] of snaps) {
      const spec = trafficSpec(id);
      const dir = travelDir(spec.cw);
      // Move the update forward by its age so it matches "now".
      const ns = wrapS(s + dir * centrelineStep(s, off, v * age));
      let noff = off;
      if (off !== toff) {
        const d = toff - off;
        const step = LANE_CHANGE_RATE * age;
        noff = Math.abs(d) <= step ? toff : off + Math.sign(d) * step;
      }
      const car = this.cars.get(id);
      if (!car) {
        const p = trafficPose(spec.cw, ns, noff);
        this.cars.set(id, { spec, s: ns, off: noff, toff, v, flags, es: 0, eo: 0, seen: now, x: p.x, z: p.z, yaw: p.yaw });
        continue;
      }
      // Keep the rendered position continuous; the error fades out in update().
      let es = deltaS(ns, car.s + car.es);
      let eo = car.off + car.eo - noff;
      if (Math.abs(es) > 12 || Math.abs(eo) > 4) {
        es = 0;
        eo = 0;
      }
      car.s = ns;
      car.off = noff;
      car.toff = toff;
      car.v = v;
      car.flags = flags;
      car.es = es;
      car.eo = eo;
      car.seen = now;
    }
  }

  update(dt: number, now = performance.now()): void {
    const fade = Math.exp(-dt * 5);
    for (const [id, c] of this.cars) {
      if (now - c.seen > STALE_MS) {
        this.cars.delete(id);
        continue;
      }
      const dir = travelDir(c.spec.cw);
      c.s = wrapS(c.s + dir * centrelineStep(c.s, c.off, c.v * dt));
      if (c.off !== c.toff) {
        const d = c.toff - c.off;
        const step = LANE_CHANGE_RATE * dt * Math.min(1, 0.4 + c.v / 8);
        c.off = Math.abs(d) <= step ? c.toff : c.off + Math.sign(d) * step;
      }
      c.es *= fade;
      c.eo *= fade;
      const p = trafficPose(c.spec.cw, wrapS(c.s + c.es), c.off + c.eo);
      c.x = p.x;
      c.z = p.z;
      c.yaw = p.yaw;
    }
  }

  /** Traffic collision boxes near a point (for local prediction; same ids as the server's). */
  boxesNear(x: number, z: number, radius: number, out: DynamicBox[]): void {
    const r2 = radius * radius;
    for (const c of this.cars.values()) {
      if ((c.x - x) ** 2 + (c.z - z) ** 2 > r2) continue;
      trafficBoxes(c.spec, c.s, c.off, c.v, out);
    }
  }

  signal(c: ClientTrafficCar): number {
    return c.flags & (TF.LEFT | TF.RIGHT);
  }

  clear(): void {
    this.cars.clear();
  }
}

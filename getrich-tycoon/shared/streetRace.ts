// Illegal street races through the city: every few minutes a race opens at a start line somewhere on
// the road grid (a flag on the map). Drivers who line up in time race through the checkpoints against
// each other and a few street racers (bots); the first one over the line wins $20,000. The police
// know: every racer is wanted (2 stars) from the green light.
//
// Routes follow road centre lines (ROAD_LINES); each corner is a checkpoint. Pure rules here, the
// server runs the races (server/game/services/streetRace.ts).

import { ECONOMY } from './economy.config';

export interface RacePoint {
  x: number;
  z: number;
}

export interface RaceRoute {
  id: string;
  name: string;
  /** points[0] is the start line; every later point is a checkpoint, the last one the finish. */
  points: RacePoint[];
}

const p = (x: number, z: number): RacePoint => ({ x, z });

export const RACE_ROUTES: RaceRoute[] = [
  {
    id: 'downtown',
    name: 'Downtown Loop',
    points: [p(-150, -105), p(-150, -50), p(-50, -50), p(-50, 50), p(50, 50), p(50, 150), p(150, 150), p(150, 50), p(150, -50), p(50, -50), p(50, -150), p(150, -150)],
  },
  {
    id: 'westside',
    name: 'Westside Sprint',
    points: [p(-105, 150), p(-150, 150), p(-150, 50), p(-50, 50), p(-50, -50), p(-150, -50), p(-150, -150), p(-50, -150), p(50, -150), p(50, -50)],
  },
  {
    id: 'eastside',
    name: 'Eastside Run',
    points: [p(105, -50), p(50, -50), p(50, 50), p(150, 50), p(150, 150), p(50, 150), p(-50, 150), p(-50, 50), p(-150, 50), p(-150, 150)],
  },
];

export function raceRoute(id: string): RaceRoute | undefined {
  return RACE_ROUTES.find((r) => r.id === id);
}

/** Length of each leg (point i to i+1) and the total. */
export function routeLegs(r: RaceRoute): { legs: number[]; total: number } {
  const legs: number[] = [];
  for (let i = 0; i + 1 < r.points.length; i++) legs.push(Math.hypot(r.points[i + 1]!.x - r.points[i]!.x, r.points[i + 1]!.z - r.points[i]!.z));
  return { legs, total: legs.reduce((a, b) => a + b, 0) };
}

/** Distance along the route to a point (index) from the start. */
export function routeDistanceTo(r: RaceRoute, index: number): number {
  const { legs } = routeLegs(r);
  let d = 0;
  for (let i = 0; i < Math.min(index, legs.length); i++) d += legs[i]!;
  return d;
}

/** Where a car is after `s` metres along the route, and the way it faces (heading: x = sin, z = cos). */
export function routePose(r: RaceRoute, s: number): { x: number; z: number; rot: number; leg: number } {
  const { legs } = routeLegs(r);
  let left = Math.max(0, s);
  for (let i = 0; i < legs.length; i++) {
    const a = r.points[i]!;
    const b = r.points[i + 1]!;
    const len = legs[i]!;
    if (left <= len || i === legs.length - 1) {
      const k = Math.min(1, left / Math.max(1e-6, len));
      let rot = Math.atan2(b.x - a.x, b.z - a.z);
      // Turn into the next leg over the last few metres (a smooth corner).
      const next = r.points[i + 2];
      const turnIn = 7;
      if (next && len - left < turnIn) {
        const rot2 = Math.atan2(next.x - b.x, next.z - b.z);
        let d = rot2 - rot;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        rot += d * 0.5 * (1 - (len - left) / turnIn);
      }
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, rot, leg: i };
    }
    left -= len;
  }
  const last = r.points[r.points.length - 1]!;
  return { x: last.x, z: last.z, rot: 0, leg: legs.length - 1 };
}

/** Grid slot `i` behind the start line (two columns, 7 m apart row to row). */
export function gridSlot(r: RaceRoute, i: number): { x: number; z: number; rot: number } {
  const a = r.points[0]!;
  const b = r.points[1]!;
  const rot = Math.atan2(b.x - a.x, b.z - a.z);
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  // Right of the heading (x = cos, z = -sin is left).
  const lx = Math.cos(rot);
  const lz = -Math.sin(rot);
  const row = Math.floor(i / 2);
  const side = i % 2 === 0 ? 2.6 : -2.6;
  const back = 4 + row * 7.5;
  return { x: a.x - fx * back + lx * side, z: a.z - fz * back + lz * side, rot };
}

export type RacePhase = 'open' | 'countdown' | 'racing' | 'results';

export interface RacerView {
  id: string;
  name: string;
  bot: boolean;
  modelId: string;
  /** Paint of a bot's car. */
  color?: string;
  /** Next checkpoint index (1 .. points.length - 1); points.length when finished. */
  next: number;
  /** Finishing place (1 = winner) and time (ms from the green light). */
  place: number | null;
  timeMs: number | null;
  dnf: boolean;
}

export interface StreetRaceView {
  id: string;
  routeId: string;
  phase: RacePhase;
  /** Server ms: the green light (open/countdown), when the race is called off (racing), when the results go. */
  startsAt: number;
  endsAt: number;
  prize: number;
  racers: RacerView[];
}

/** A street racer bot on the road: [index, x, z, rot, speed]. */
export type RaceBotSnap = [number, number, number, number, number];

/** Current standing: finished first (by place), then by progress. */
export function standings(v: StreetRaceView, progress: (r: RacerView) => number): RacerView[] {
  return [...v.racers].sort((a, b) => {
    if (a.place !== null || b.place !== null) return (a.place ?? 99) - (b.place ?? 99);
    if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
    return progress(b) - progress(a);
  });
}

export const RACE = ECONOMY.streetRace;

// CCTV cameras at city junctions: each one turns slowly back and forth on its pole and watches a
// cone of the road (shown as a red light on the ground). Driving a stolen car into a cone, or being
// seen by a police car, (re)starts the 3-minute police tracking (server/game/services/pursuit.ts).
//
// Where a camera points is a pure function of the clock, so the server and every client agree on it
// without sending anything.

import { ECONOMY } from './economy.config';
import { angleDiff } from './util';
import { ROAD_WIDTH, SIDEWALK } from './world';

export interface Cctv {
  id: string;
  /** Pole position (on a sidewalk corner) and camera height (m). */
  x: number;
  z: number;
  height: number;
  /** Middle of the sweep (heading: 0 = +z, x = sin, z = cos) and how far it turns either way (rad). */
  yaw0: number;
  sweep: number;
  /** Seconds for a full sweep there and back, and where in it the camera starts. */
  period: number;
  phase: number;
  /** How far it sees (m) and half its field of view (rad). */
  range: number;
  fov: number;
}

const CORNER = ROAD_WIDTH / 2 + SIDEWALK * 0.6;

/** Junctions with a camera and the corner it stands on (sign of x, sign of z). */
const SPOTS: [number, number, number, number][] = [
  [-50, -50, 1, 1],
  [50, -50, -1, 1],
  [-50, 50, 1, -1],
  [50, 50, -1, -1],
  [-150, -50, 1, -1],
  [150, 50, -1, 1],
  [-50, 150, -1, -1],
  [50, -150, 1, 1],
  [150, -150, -1, 1],
  [-150, 150, 1, -1],
];

export const CCTV_CAMERAS: Cctv[] = SPOTS.map(([jx, jz, sx, sz], i) => ({
  id: `cam${i + 1}`,
  x: jx + sx * CORNER,
  z: jz + sz * CORNER,
  height: 6.2,
  // Facing the middle of the junction.
  yaw0: Math.atan2(-sx, -sz),
  sweep: 0.95,
  period: 11 + (i % 3) * 2.5,
  phase: i * 1.7,
  range: ECONOMY.pursuit.cameraRange,
  fov: ECONOMY.pursuit.cameraFov,
}));

/** Where a camera looks at a moment (ms, server clock). */
export function cameraYaw(c: Cctv, t: number): number {
  return c.yaw0 + c.sweep * Math.sin(((t / 1000) * Math.PI * 2) / c.period + c.phase);
}

/** Is a point inside a camera's cone at a moment? */
export function cameraSees(c: Cctv, x: number, z: number, t: number): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  const d = Math.hypot(dx, dz);
  if (d > c.range) return false;
  // Right under the pole counts as seen.
  if (d < 2) return true;
  return Math.abs(angleDiff(Math.atan2(dx, dz), cameraYaw(c, t))) <= c.fov;
}

/** The camera that sees a point, if any. */
export function cameraSeeing(x: number, z: number, t: number): Cctv | null {
  for (const c of CCTV_CAMERAS) if (cameraSees(c, x, z, t)) return c;
  return null;
}

/** Police tracking of a stolen car as the player sees it. */
export interface PursuitView {
  vehicleId: string;
  modelId: string;
  /** Seconds left without being seen. */
  left: number;
  total: number;
  /** The countdown waits while the player is out of the car. */
  paused: boolean;
  /** Last time a camera or the police saw the car (server ms), and by what. */
  seenAt: number;
  seenBy: 'camera' | 'police' | 'lockpick' | null;
}

export type PursuitOutcome = 'success' | 'seized' | 'garage_full' | 'ended';

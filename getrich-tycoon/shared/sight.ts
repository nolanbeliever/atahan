// Can a police officer see the player? A strict line of sight: the straight line from the police
// car's windscreen to the player must not pass through a building, a wall, a ramp's embankment, a
// bridge pier or the hill, and the player has to be inside the car's field of view (a cone ahead
// of it) and within range. Things on different levels (up on a bridge deck and down below) don't
// see each other. Shared so tests and the client's debug view agree with the server.

import { ECONOMY } from './economy.config';
import { rayHitsHill, standHeight } from './farShore';
import { RAMP_BLOCKS } from './strait';
import { angleDiff } from './util';
import type { AABB, Circle } from './world';

/** Does the segment a-b pass through the box (2D, slab test)? */
export function segmentHitsAabb(ax: number, az: number, bx: number, bz: number, b: AABB): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  for (const [p, d, lo, hi] of [
    [ax, dx, b.minX, b.maxX],
    [az, dz, b.minZ, b.maxZ],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p <= lo || p >= hi) return false;
      continue;
    }
    let a = (lo - p) / d;
    let c = (hi - p) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 >= t1) return false;
  }
  return true;
}

function segmentHitsCircle(ax: number, az: number, bx: number, bz: number, c: Circle): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / l2));
  return Math.hypot(ax + dx * t - c.x, az + dz * t - c.z) < c.r;
}

export interface SightWorld {
  /** Solid boxes that block the view (buildings, walls). */
  boxes: readonly AABB[];
  /** Columns and piers (thin ones like trees and lamp posts are left out by the caller). */
  circles: readonly Circle[];
}

/** Columns this thick or thicker block the view (piers, the fountain, crane legs); trees don't. */
export const SIGHT_MIN_RADIUS = 0.9;

/** Is the straight line between the two points clear (same level only)? */
export function lineOfSight(ax: number, az: number, aDeck: number, bx: number, bz: number, bDeck: number, world: SightWorld): boolean {
  if (aDeck !== bDeck) return false;
  // On a deck only the deck's rails are in the way, and they are low.
  if (aDeck > 0) return true;
  for (const b of world.boxes) if (segmentHitsAabb(ax, az, bx, bz, b)) return false;
  for (const b of RAMP_BLOCKS) if (segmentHitsAabb(ax, az, bx, bz, b)) return false;
  for (const c of world.circles) if (c.r >= SIGHT_MIN_RADIUS && segmentHitsCircle(ax, az, bx, bz, c)) return false;
  // Over the hill: a ray from eye height to the player's chest.
  const d = Math.hypot(bx - ax, bz - az);
  if (d > 1) {
    const y0 = standHeight(0, ax, az) + 1.3;
    const y1 = standHeight(0, bx, bz) + 1.0;
    const hit = rayHitsHill(ax, y0, az, (bx - ax) / d, (bz - az) / d, (y1 - y0) / d, d);
    if (hit !== null && hit < d - 0.5) return false;
  }
  return true;
}

/** Inside a police car's field of view: ahead within the cone and range, or right next to it. */
export function inFieldOfView(px: number, pz: number, rot: number, tx: number, tz: number): boolean {
  const s = ECONOMY.police.sight;
  const d = Math.hypot(tx - px, tz - pz);
  if (d <= s.nearSense) return true;
  if (d > s.range) return false;
  const bearing = Math.atan2(tx - px, tz - pz);
  return Math.abs(angleDiff(rot, bearing)) <= ((s.fovDeg / 2) * Math.PI) / 180;
}

/** A police car at (px, pz) heading `rot` sees the target: in its field of view and in clear sight. */
export function policeSees(px: number, pz: number, pDeck: number, rot: number, tx: number, tz: number, tDeck: number, world: SightWorld): boolean {
  return inFieldOfView(px, pz, rot, tx, tz) && lineOfSight(px, pz, pDeck, tx, tz, tDeck, world);
}

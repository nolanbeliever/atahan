// Police kit for 3+ star pursuits (the logic lives in server/game/services/police.ts):
//  - spike strips thrown across the road ahead of a wanted driver: across the whole carriageway on
//    the highway, across a city street on the main roads. Driving over one bursts the tyres: the
//    car runs on its rims (sparks) with almost no grip until the tyres are fixed at Wrench Bros;
//  - the helicopter: it tracks you from above with its searchlight and tells the cars where you
//    are, unless you get under cover (an overpass or bridge, a tunnel, the car wash, the Sanayi
//    hall) long enough for it to lose you.

import { ECONOMY } from './economy.config';
import { CARRIAGEWAY_EDGE, LANES, LANE_WIDTH, MEDIAN_HALF, OVERPASSES, OVERPASS_DECK, OVERPASS_WIDTH, deltaS, pathPoint, projectToHighway } from './highway';
import { SANAYI } from './sanayiLayout';
import { angleDiff } from './util';
import { CITY_HALF, ROAD_LINES, ROAD_WIDTH, type AABB } from './world';

/** A spike strip: centre, the direction it runs (yaw, 0 = +z) and half its length. */
export interface SpikeStrip {
  x: number;
  z: number;
  rot: number;
  half: number;
}

/** A spike strip in a snapshot: [id, x, z, rot, half length]. */
export type SpikeSnap = [number, number, number, number, number];

/** A police helicopter in a snapshot: [id, x, y, z, yaw, searchlight x, z (9999: off), health 0-1]. */
export type HeliSnap = [number, number, number, number, number, number, number, number];

/** Half the width of a strip (the spikes). */
export const SPIKE_HALF_WIDTH = 0.45;

/** Is a point on the strip? */
export function onSpikes(s: SpikeStrip, x: number, z: number): boolean {
  const ax = Math.sin(s.rot);
  const az = Math.cos(s.rot);
  const dx = x - s.x;
  const dz = z - s.z;
  const along = dx * ax + dz * az;
  const across = -dx * az + dz * ax;
  return Math.abs(along) <= s.half && Math.abs(across) <= SPIKE_HALF_WIDTH;
}

/** The four tyres of a vehicle (world points) from its centre, heading and half extents. */
export function tyrePoints(x: number, z: number, rot: number, hl: number, hw: number): { x: number; z: number }[] {
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  const lx = Math.cos(rot);
  const lz = -Math.sin(rot);
  const out: { x: number; z: number }[] = [];
  for (const a of [hl * 0.7, -hl * 0.7]) for (const b of [hw * 0.85, -hw * 0.85]) out.push({ x: x + fx * a + lx * b, z: z + fz * a + lz * b });
  return out;
}

/**
 * Where to throw a strip ahead of a car at (x, z) heading `rot`: `ahead` metres down the road it is
 * on, across the carriageway (highway) or the street (city). Null off the roads.
 */
export function spikePlacement(x: number, z: number, rot: number, ahead = ECONOMY.police.spikes.ahead): SpikeStrip | null {
  // Highway: across the carriageway the car is on, further along in its direction of travel.
  const h = projectToHighway(x, z);
  const off = Math.abs(h.offset);
  if (off > MEDIAN_HALF && off < CARRIAGEWAY_EDGE) {
    const p = pathPoint(h.s);
    const along = Math.atan2(p.tx, p.tz);
    const dir = Math.abs(angleDiff(along, rot)) < Math.PI / 2 ? 1 : -1;
    const side = h.offset < 0 ? -1 : 1;
    const centre = side * (MEDIAN_HALF + (LANES * LANE_WIDTH) / 2);
    const q = pathPoint(h.s + dir * ahead, centre);
    return { x: q.x, z: q.z, rot: Math.atan2(q.nx, q.nz), half: (LANES * LANE_WIDTH) / 2 + 0.6 };
  }
  // City: the road along which the car is heading.
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  const half = ROAD_WIDTH / 2;
  const limit = CITY_HALF - 10;
  for (const l of ROAD_LINES) {
    if (Math.abs(x - l) < half && Math.abs(fz) > 0.7) {
      const tz = z + Math.sign(fz) * ahead;
      if (Math.abs(tz) > limit) return null;
      return { x: l, z: tz, rot: Math.PI / 2, half };
    }
    if (Math.abs(z - l) < half && Math.abs(fx) > 0.7) {
      const tx = x + Math.sign(fx) * ahead;
      if (Math.abs(tx) > limit) return null;
      return { x: tx, z: l, rot: 0, half };
    }
  }
  return null;
}

/** Places with a roof over them (the helicopter can't see in). */
export const COVERED_BOXES: AABB[] = [
  // Sparkle Wash tunnel and the Sanayi hall.
  { minX: -34, maxX: -18, minZ: 64, maxZ: 90 },
  { ...SANAYI.hall },
];

/** Under cover from the helicopter: under an overpass deck, in the car wash or the Sanayi hall. */
export function isCovered(x: number, z: number): boolean {
  if (COVERED_BOXES.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) return true;
  const h = projectToHighway(x, z);
  if (Math.abs(h.offset) > OVERPASS_DECK) return false;
  return OVERPASSES.some((o) => Math.abs(deltaS(o.s, h.s)) < OVERPASS_WIDTH / 2 + 0.5);
}

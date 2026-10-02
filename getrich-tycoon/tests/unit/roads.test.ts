// Nothing stands on a road: street lamps, camera poles and colliders stay on sidewalks, verges and the
// median; the highway ramps are smooth and clear all the way.

import { describe, expect, it } from 'vitest';
import { CCTV_CAMERAS } from '../../shared/cctv';
import {
  CARRIAGEWAY_EDGE,
  GUARDRAIL_OFFSET,
  JUNCTIONS,
  JUNCTION_APRON,
  MEDIAN_HALF,
  RAMP_EDGE,
  RAMP_SPAN,
  RAMP_WIDTH,
  STREET_LIGHTS,
  pathPoint,
  projectToHighway,
  rampOffset,
} from '../../shared/highway';
import { CITY_LAMPS, ROAD_LINES, ROAD_WIDTH, SIDEWALK, STATIC_CIRCLES, isOnRoad } from '../../shared/world';

/** On a highway lane (either carriageway, shoulder included). */
function onHighwayLanes(x: number, z: number, r = 0): boolean {
  const h = projectToHighway(x, z);
  const a = Math.abs(h.offset);
  return a + r > MEDIAN_HALF && a - r < CARRIAGEWAY_EDGE;
}

/** On a ramp or a connector road (to the city). */
function onRamp(x: number, z: number, r = 0): boolean {
  return JUNCTIONS.some((j) => {
    for (let ds = -RAMP_SPAN[0]; ds <= RAMP_SPAN[1]; ds += 1) {
      if (Math.abs(ds) < 2) continue;
      const p = pathPoint(j.s + ds, rampOffset(ds));
      if (Math.hypot(p.x - x, p.z - z) < RAMP_WIDTH / 2 + r) return true;
    }
    return false;
  });
}

describe('nothing on the roads', () => {
  it('street lamps stand on the sidewalks, never in a road or a crossing', () => {
    expect(CITY_LAMPS.length).toBeGreaterThan(150);
    for (const [x, z] of CITY_LAMPS) {
      expect(isOnRoad(x, z), `lamp at ${x},${z}`).toBe(false);
      // Within the sidewalk next to some road.
      const fromKerb = Math.min(...ROAD_LINES.map((l) => Math.min(Math.abs(Math.abs(x - l) - ROAD_WIDTH / 2), Math.abs(Math.abs(z - l) - ROAD_WIDTH / 2))));
      expect(fromKerb, `lamp at ${x},${z}`).toBeLessThanOrEqual(SIDEWALK);
      expect(onRamp(x, z, 0.3), `lamp at ${x},${z}`).toBe(false);
    }
  });

  it('camera poles are on corners, highway lights in the middle of the median', () => {
    for (const c of CCTV_CAMERAS) expect(isOnRoad(c.x, c.z), c.id).toBe(false);
    for (const s of STREET_LIGHTS) {
      const p = pathPoint(s, 0);
      expect(Math.abs(projectToHighway(p.x, p.z).offset)).toBeLessThan(0.01);
    }
  });

  it('no collider stands on a city road, a highway lane or a ramp', () => {
    for (const c of STATIC_CIRCLES) {
      expect(isOnRoad(c.x, c.z), `circle at ${c.x.toFixed(1)},${c.z.toFixed(1)}`).toBe(false);
      // Barrier end caps sit on the barrier lines themselves (median / guardrail), not in a lane.
      const off = Math.abs(projectToHighway(c.x, c.z).offset);
      const onBarrier = off < MEDIAN_HALF || Math.abs(off - GUARDRAIL_OFFSET) < 0.5;
      if (!onBarrier) expect(onHighwayLanes(c.x, c.z, c.r), `circle at ${c.x.toFixed(1)},${c.z.toFixed(1)}`).toBe(false);
      expect(onRamp(c.x, c.z, c.r), `circle at ${c.x.toFixed(1)},${c.z.toFixed(1)} r ${c.r}`).toBe(false);
    }
  });
});

describe('highway ramps', () => {
  it('leave the slow lane and reach the connector in a gentle S-curve', () => {
    expect(rampOffset(-RAMP_SPAN[0])).toBeCloseTo(RAMP_EDGE, 5);
    expect(rampOffset(-4)).toBeCloseTo(-JUNCTION_APRON, 5);
    expect(rampOffset(4)).toBeCloseTo(-JUNCTION_APRON, 5);
    expect(rampOffset(RAMP_SPAN[1])).toBeCloseTo(RAMP_EDGE, 5);
    // Never steeper than ~27° to the traffic, and no kinks.
    let prev = rampOffset(-RAMP_SPAN[0]);
    let prevSlope = 0;
    for (let ds = -RAMP_SPAN[0] + 0.5; ds <= RAMP_SPAN[1]; ds += 0.5) {
      if (Math.abs(ds) < 4.5) {
        prev = rampOffset(ds);
        continue;
      }
      const o = rampOffset(ds);
      const slope = (o - prev) / 0.5;
      expect(Math.abs(slope), `at ${ds}`).toBeLessThan(0.52);
      if (Math.abs(ds) > 5) expect(Math.abs(slope - prevSlope), `at ${ds}`).toBeLessThan(0.05);
      prev = o;
      prevSlope = slope;
    }
  });

  it('the guardrail is open along the whole ramp', () => {
    for (const j of JUNCTIONS) {
      for (let ds = -RAMP_SPAN[0] - 10; ds <= RAMP_SPAN[1] + 10; ds += 2) {
        const p = pathPoint(j.s + ds, -GUARDRAIL_OFFSET);
        expect(STATIC_CIRCLES.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.r + 1), `junction ${j.id} at ${ds}`).toBe(false);
      }
    }
  });
});

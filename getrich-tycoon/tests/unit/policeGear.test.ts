// Police kit: where spike strips go, who they catch, what burst tyres do, and where the helicopter
// can't see you.

import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { CARRIAGEWAY_EDGE, MEDIAN_HALF, OVERPASSES, pathPoint, projectToHighway } from '../../shared/highway';
import { DEFAULT_MODS } from '../../shared/customization';
import { vehicleParams } from '../../shared/physics';
import { isCovered, onSpikes, spikePlacement, tyrePoints } from '../../shared/policeGear';
import { getModel } from '../../shared/vehicles';
import { ROAD_WIDTH, isOnRoad } from '../../shared/world';

const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

describe('spike strips', () => {
  it('go across a city street, ahead in the direction of travel', () => {
    // Heading north (-z) on the x = 50 road.
    const s = spikePlacement(50, 40, Math.PI)!;
    expect(s).not.toBeNull();
    expect(s.x).toBe(50);
    expect(s.z).toBeCloseTo(40 - ECONOMY.police.spikes.ahead, 5);
    expect(s.half).toBe(ROAD_WIDTH / 2);
    // It spans the street: both kerbs are on the strip, the sidewalk isn't.
    expect(onSpikes(s, 50 - ROAD_WIDTH / 2 + 0.2, s.z)).toBe(true);
    expect(onSpikes(s, 50 + ROAD_WIDTH / 2 - 0.2, s.z)).toBe(true);
    expect(onSpikes(s, 50, s.z + 1)).toBe(false);
    expect(isOnRoad(s.x, s.z)).toBe(true);
    // Heading east on the z = -50 road.
    const e = spikePlacement(-100, -50, Math.PI / 2)!;
    expect(e.z).toBe(-50);
    expect(e.x).toBeCloseTo(-100 + ECONOMY.police.spikes.ahead, 5);
    // Off the roads, or running out of the city: none.
    expect(spikePlacement(0, 0, 0)).toBeNull();
    expect(spikePlacement(50, -100, Math.PI)).toBeNull();
  });

  it('cover the whole carriageway on the highway', () => {
    const p = pathPoint(500, -(MEDIAN_HALF + 5));
    const yaw = Math.atan2(p.tx, p.tz);
    const s = spikePlacement(p.x, p.z, yaw)!;
    const h = projectToHighway(s.x, s.z);
    expect(h.s).toBeGreaterThan(500 + ECONOMY.police.spikes.ahead - 2);
    // Every lane of that carriageway is covered.
    for (const off of [-(MEDIAN_HALF + 0.5), -(MEDIAN_HALF + 7), -(CARRIAGEWAY_EDGE - 3)]) {
      const q = pathPoint(h.s, off);
      expect(onSpikes(s, q.x, q.z), `offset ${off}`).toBe(true);
    }
    // Not the other carriageway.
    const other = pathPoint(h.s, MEDIAN_HALF + 5);
    expect(onSpikes(s, other.x, other.z)).toBe(false);
  });

  it('catch a car whose tyres roll over them', () => {
    const s = { x: 0, z: 10, rot: Math.PI / 2, half: 6 };
    const at = (z: number) => tyrePoints(0, z, 0, 2.2, 0.9).some((t) => onSpikes(s, t.x, t.z));
    expect(at(10 - 1.54)).toBe(true);
    expect(at(10 + 1.54)).toBe(true);
    expect(at(10)).toBe(false);
    expect(at(4)).toBe(false);
  });

  it('burst tyres: 90% less grip, much less traction', () => {
    const m = getModel('norda_arlo');
    const ok = vehicleParams(m, PERFECT, 100, DEFAULT_MODS);
    const flat = vehicleParams(m, PERFECT, 100, { ...DEFAULT_MODS, blown: true });
    expect(flat.pt.latGrip).toBeCloseTo(ok.pt.latGrip * 0.1, 6);
    expect(flat.pt.mu).toBeCloseTo(ok.pt.mu * ECONOMY.police.spikes.traction, 6);
  });
});

describe('helicopter cover', () => {
  it('under an overpass, in the car wash and the Sanayi hall', () => {
    for (const o of OVERPASSES) {
      const p = pathPoint(o.s, -(MEDIAN_HALF + 5));
      expect(isCovered(p.x, p.z)).toBe(true);
      const q = pathPoint(o.s + 30, -(MEDIAN_HALF + 5));
      expect(isCovered(q.x, q.z)).toBe(false);
    }
    expect(isCovered(-26, 77)).toBe(true);
    expect(isCovered(0, 0)).toBe(false);
  });
});

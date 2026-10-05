// Toll plazas, number-plate cameras and police checkpoints at the bridges (shared/tolls.ts).

import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { obbDistance } from '../../shared/obb';
import { vehicleBox } from '../../shared/physics';
import { NAV_EDGES, NAV_NODES } from '../../shared/roadGraph';
import { BRIDGES, BRIDGE_HALF, CLEARANCE, FAR_ROADS, deckHeight, inFootprint } from '../../shared/strait';
import { ANPR_CAMERAS, TOLL_BOXES, TOLL_PLAZAS, TOLL_X, anprCrossed, checkpointPlan, crossesTollEast, plateRead, tollOutcome, tollPlazaAt } from '../../shared/tolls';
import { POLICE_MODEL } from '../../shared/vehicles';

const segHitsBox = (ax: number, az: number, bx: number, bz: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
  for (let t = 0; t <= 1; t += 0.01) {
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  return false;
};

describe('toll plazas', () => {
  it('stand across each bridge road on the far shore, with lanes a car fits through', () => {
    expect(TOLL_PLAZAS).toHaveLength(2);
    for (const p of TOLL_PLAZAS) {
      const road = FAR_ROADS.find((r) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ);
      expect(road).toBeDefined();
      expect(tollPlazaAt(p.x, p.z)).toBe(p);
      // Islands sit on the road, the lanes between them are at least 3.3 m.
      const edges = [-BRIDGE_HALF, ...p.islands.flatMap((i) => [i.minZ - p.z, i.maxZ - p.z]), BRIDGE_HALF].sort((a, b) => a - b);
      for (const z of [...p.east, ...p.west]) {
        const lo = Math.max(...edges.filter((e) => e <= z - p.z));
        const hi = Math.min(...edges.filter((e) => e >= z - p.z));
        expect(hi - lo, `lane at ${z}`).toBeGreaterThan(3.3);
      }
    }
  });

  it('never stand in the way of a police route', () => {
    for (const { a, b } of NAV_EDGES) {
      const na = NAV_NODES[a]!;
      const nb = NAV_NODES[b]!;
      for (const box of TOLL_BOXES) expect(segHitsBox(na.x, na.z, nb.x, nb.z, box), `edge ${a}-${b}`).toBe(false);
    }
  });

  it('charge eastbound only, and a pass is paid up to the speed limit', () => {
    expect(crossesTollEast(TOLL_X - 1, TOLL_X + 0.2)).toBe(true);
    expect(crossesTollEast(TOLL_X + 1, TOLL_X - 0.2)).toBe(false);
    expect(crossesTollEast(TOLL_X - 3, TOLL_X - 1)).toBe(false);
    expect(tollOutcome(ECONOMY.tolls.maxKmh)).toBe('paid');
    expect(tollOutcome(ECONOMY.tolls.maxKmh + 1)).toBe('evaded');
  });
});

describe('number-plate cameras', () => {
  it('read both ways, only on their own level', () => {
    for (const c of ANPR_CAMERAS) {
      expect(anprCrossed(c.x - 1, c.x + 1, c.z + 5, c.deck)?.id).toBe(c.id);
      expect(anprCrossed(c.x + 1, c.x - 1, c.z - 5, c.deck)?.id).toBe(c.id);
      expect(anprCrossed(c.x - 1, c.x + 1, c.z, c.deck ? 0 : 1)?.id).not.toBe(c.id);
      expect(anprCrossed(c.x - 3, c.x - 1, c.z, c.deck)).toBeUndefined();
      if (c.deck) expect(deckHeight(BRIDGES[c.n - 1]!, c.x)).toBeGreaterThan(CLEARANCE);
    }
  });

  it('a flipped plate is unreadable, a fake one reads (clean), otherwise the real plate', () => {
    expect(plateRead({})).toBe('real');
    expect(plateRead({ fakePlate: '34 XX 123' })).toBe('fake');
    expect(plateRead({ plateFlipped: true, fakePlate: '34 XX 123' })).toBe('none');
  });
});

describe('police checkpoints', () => {
  it('stand on the deck near the far end, four cars in a V that closes the road, spikes in the middle only', () => {
    for (const b of BRIDGES) {
      for (const dir of [1, -1] as const) {
        const plan = checkpointPlan(b, dir);
        expect(inFootprint(b, plan.x, plan.z)).toBe(true);
        expect(deckHeight(b, plan.x)).toBeGreaterThan(CLEARANCE);
        // Near the end the driver is heading to.
        expect(dir > 0 ? b.x1 - plan.x : plan.x - b.x0).toBeLessThan(60);
        expect(plan.cars).toHaveLength(4);
        const hl = POLICE_MODEL.shape.length / 2;
        const hw = POLICE_MODEL.shape.width / 2;
        const boxes = plan.cars.map((c, i) => vehicleBox(`c${i}`, c.x, c.z, c.rot, hl, hw));
        for (const c of plan.cars) expect(Math.abs(c.z - b.z) + hw).toBeLessThan(BRIDGE_HALF + 1);
        // No gap a car (1.9 m wide) can get through: between neighbours and to the rails.
        const sorted = [...plan.cars.keys()].sort((i, j) => plan.cars[i]!.z - plan.cars[j]!.z);
        for (let k = 1; k < sorted.length; k++) expect(obbDistance(boxes[sorted[k - 1]!]!, boxes[sorted[k]!]!)).toBeLessThan(1.9);
        // The spikes cover the middle lanes, ahead of the V (towards the driver).
        expect((plan.x - plan.spikes.x) * dir).toBeGreaterThan(5);
        expect(plan.spikes.half).toBeLessThan(BRIDGE_HALF - 4);
      }
    }
  });
});

// Street race routes (shared/streetRace.ts): on the roads, poses along the route, the grid.

import { describe, expect, it } from 'vitest';
import { RACE_ROUTES, gridSlot, routeDistanceTo, routeLegs, routePose, standings, type StreetRaceView } from '../../shared/streetRace';
import { CITY_HALF, ROAD_LINES } from '../../shared/world';

const onLine = (v: number) => (ROAD_LINES as readonly number[]).includes(v);

describe('street race routes', () => {
  it('run along the road grid inside the city, corner to corner', () => {
    expect(RACE_ROUTES.length).toBeGreaterThanOrEqual(3);
    for (const r of RACE_ROUTES) {
      expect(r.points.length, r.id).toBeGreaterThanOrEqual(6);
      for (let i = 0; i + 1 < r.points.length; i++) {
        const a = r.points[i]!;
        const b = r.points[i + 1]!;
        // Each leg is straight along one road (same x on a north-south road, or same z on an east-west one).
        expect((a.x === b.x && onLine(a.x)) || (a.z === b.z && onLine(a.z)), `${r.id} leg ${i}`).toBe(true);
        for (const p of [a, b]) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(CITY_HALF);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(CITY_HALF);
        }
      }
      const { legs, total } = routeLegs(r);
      expect(total).toBeGreaterThan(600);
      expect(routeDistanceTo(r, r.points.length - 1)).toBeCloseTo(total, 6);
      expect(legs.every((l) => l > 20)).toBe(true);
    }
  });

  it('places a car smoothly along the route', () => {
    const r = RACE_ROUTES[0]!;
    const { total } = routeLegs(r);
    const start = routePose(r, 0);
    expect(start.x).toBeCloseTo(r.points[0]!.x);
    expect(start.z).toBeCloseTo(r.points[0]!.z);
    const end = routePose(r, total);
    expect(end.x).toBeCloseTo(r.points[r.points.length - 1]!.x);
    expect(end.z).toBeCloseTo(r.points[r.points.length - 1]!.z);
    let prev = routePose(r, 0);
    for (let s = 0.5; s < total; s += 0.5) {
      const p = routePose(r, s);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThanOrEqual(0.5 + 1e-6);
      prev = p;
    }
  });

  it('lines the grid up behind the start line, two abreast', () => {
    for (const r of RACE_ROUTES) {
      const a = r.points[0]!;
      const b = r.points[1]!;
      const fx = Math.sign(b.x - a.x);
      const fz = Math.sign(b.z - a.z);
      const slots = [0, 1, 2, 3, 4, 5].map((i) => gridSlot(r, i));
      for (const s of slots) {
        // Behind the line.
        expect((s.x - a.x) * fx + (s.z - a.z) * fz).toBeLessThan(0);
        expect(Math.abs(s.rot - Math.atan2(b.x - a.x, b.z - a.z))).toBeLessThan(1e-9);
      }
      for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) expect(Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.z - slots[j]!.z)).toBeGreaterThan(4.5);
    }
  });

  it('ranks finishers first, then by progress, DNFs last', () => {
    const v: StreetRaceView = {
      id: 'r',
      routeId: 'downtown',
      phase: 'racing',
      startsAt: 0,
      endsAt: 0,
      prize: 20_000,
      racers: [
        { id: 'a', name: 'A', bot: false, modelId: 'x', next: 3, place: null, timeMs: null, dnf: false },
        { id: 'b', name: 'B', bot: true, modelId: 'x', next: 12, place: 1, timeMs: 50_000, dnf: false },
        { id: 'c', name: 'C', bot: false, modelId: 'x', next: 5, place: null, timeMs: null, dnf: true },
        { id: 'd', name: 'D', bot: true, modelId: 'x', next: 4, place: null, timeMs: null, dnf: false },
      ],
    };
    const prog: Record<string, number> = { a: 300, c: 500, d: 350 };
    expect(standings(v, (r) => prog[r.id] ?? 0).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

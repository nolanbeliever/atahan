// The strait, the far shore and the two suspension bridges: geometry, the deck rule (on a bridge
// you only meet the rails and what is on the same deck; the highway runs underneath), the banks,
// the road graph the police use.

import { describe, expect, it } from 'vitest';
import { CARRIAGEWAY_EDGE, MEDIAN_HALF, OVERPASS_HEIGHT, projectToHighway } from '../../shared/highway';
import { KEY, newVehicleDyn, resolveCircle, stepVehicle, vehicleBox, vehicleParams, type CollisionWorld, type VehicleDyn } from '../../shared/physics';
import { isCovered, spikePlacement } from '../../shared/policeGear';
import {
  BRIDGES,
  BRIDGE_HALF,
  BRIDGE_PIERS,
  DECK_HEIGHT,
  RAMP_BLOCKS,
  WATER,
  crossesWater,
  deckAt,
  deckHeight,
  nextDeck,
  underBridge,
} from '../../shared/strait';
import { NAV_EDGES, NAV_NODES } from '../../shared/roadGraph';
import { getModel } from '../../shared/vehicles';

const empty: CollisionWorld = { boxes: [], circles: [], dynamic: [], vehicles: [] };
const good = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
const car = vehicleParams(getModel('norda_arlo'), good, 100);
const north = BRIDGES[0]!;

/** Drive with fixed keys until a condition holds (or time runs out); returns the seconds taken. */
function drive(v: VehicleDyn, keys: number, sec: number, world = empty, until?: (v: VehicleDyn) => boolean): number {
  for (let t = 0; t < sec; t += 1 / 30) {
    stepVehicle(v, { keys, dt: 1 / 30 }, car, world);
    if (until?.(v)) return t;
  }
  return sec;
}

describe('bridge geometry', () => {
  it('ramps up from the city edge, clears the highway, arches over the water and comes down on the far shore', () => {
    for (const b of BRIDGES) {
      expect(deckHeight(b, b.x0)).toBe(0);
      expect(deckHeight(b, b.x1)).toBe(0);
      // Over the highway (x = 221..259) with room for the trucks underneath.
      for (let x = 216; x <= 264; x += 4) expect(deckHeight(b, x)).toBeGreaterThanOrEqual(OVERPASS_HEIGHT);
      expect(deckHeight(b, (WATER.west + WATER.east) / 2)).toBeGreaterThan(DECK_HEIGHT + 3);
      // Smooth: never steeper than ~16% between neighbouring metres.
      for (let x = b.x0; x < b.x1; x++) expect(Math.abs(deckHeight(b, x + 1) - deckHeight(b, x))).toBeLessThan(0.3);
    }
  });

  it('nothing stands in a highway lane: piers on the median or beyond the shoulders', () => {
    for (const p of BRIDGE_PIERS) {
      const hp = projectToHighway(p.x, p.z);
      const off = Math.abs(hp.offset);
      if (off < 40) expect(off + p.r < MEDIAN_HALF || off - p.r > CARRIAGEWAY_EDGE).toBe(true);
      // Never in the water, never on the deck's road.
      expect(p.x < WATER.west || p.x > WATER.east).toBe(true);
    }
    for (const r of RAMP_BLOCKS) expect(r.maxX < WATER.west || r.minX > WATER.east).toBe(true);
  });

  it('the road graph is connected, both bridges included', () => {
    const adj = NAV_NODES.map(() => [] as number[]);
    for (const e of NAV_EDGES) {
      adj[e.a]!.push(e.b);
      adj[e.b]!.push(e.a);
    }
    const seen = new Set([0]);
    const q = [0];
    while (q.length) for (const k of adj[q.shift()!]!) if (!seen.has(k)) (seen.add(k), q.push(k));
    expect(seen.size).toBe(NAV_NODES.length);
    expect(NAV_EDGES.filter((e) => e.bridge).map((e) => e.bridge)).toEqual([1, 2]);
    // Straight lines over the water only along a bridge.
    expect(crossesWater(150, north.z, 700, north.z)).toBe(false);
    expect(crossesWater(150, 0, 700, 0)).toBe(true);
    expect(crossesWater(-100, 0, 100, 0)).toBe(false);
  });
});

describe('the deck rule', () => {
  it('you get on at an end, stay on while on the deck, and are back on the ground past the far end', () => {
    expect(nextDeck(0, north.x0 + 2, north.z)).toBe(north.n);
    expect(nextDeck(north.n, 240, north.z + 5)).toBe(north.n);
    // From the side (e.g. the highway underneath): not on the deck.
    expect(nextDeck(0, 240, north.z + 5)).toBe(0);
    expect(nextDeck(north.n, north.x1 + 1, north.z)).toBe(0);
    // A guess for something placed without a history: over the water and on the ramps it is the deck.
    expect(deckAt(420, north.z)).toBe(north.n);
    expect(deckAt(240, north.z)).toBe(0);
  });

  it('a car drives from the city over the highway and the water to the far shore', () => {
    const v = newVehicleDyn(150, north.z, Math.PI / 2);
    const decks = new Set<number>();
    drive(v, KEY.FORWARD, 90, empty, (d) => (decks.add(d.deck ?? 0), d.x > north.x1 + 20));
    // The guardrails at x ≈ 221 and 259 did not stop it: it was above them.
    expect(v.x).toBeGreaterThan(north.x1 + 20);
    expect(decks.has(north.n)).toBe(true);
    expect(v.deck).toBe(0);
  });

  it('the rails keep a car on the deck', () => {
    const v = { ...newVehicleDyn(330, north.z, Math.PI / 2), deck: north.n };
    v.speed = 25;
    drive(v, KEY.FORWARD | KEY.LEFT, 4);
    expect(Math.abs(v.z - north.z)).toBeLessThan(BRIDGE_HALF);
    expect(v.deck).toBe(north.n);
  });

  it('a car on the highway under the bridge drives straight through; one up on the deck does not touch it', () => {
    // Inner carriageway lane 2, heading south (+z), under the North Bridge.
    const v = newVehicleDyn(240 - MEDIAN_HALF - 2.5 * 3.6, north.z - 40, 0);
    v.speed = 25;
    const t = drive(v, KEY.FORWARD, 5, empty, (d) => d.z > north.z + 40);
    expect(v.z).toBeGreaterThan(north.z + 40);
    expect(t).toBeLessThan(5);
    expect(v.deck).toBe(0);
    // A car parked on the deck right above the lane is no obstacle for it.
    const above = vehicleBox('above', v.x, north.z, 0, 2.3, 0.9, 0, 0, north.n);
    const w: CollisionWorld = { ...empty, vehicles: [above] };
    const u = newVehicleDyn(v.x, north.z - 30, 0);
    u.speed = 20;
    drive(u, KEY.FORWARD, 4, w, (d) => d.z > north.z + 20);
    expect(u.z).toBeGreaterThan(north.z + 20);
    // Up on the deck it is in the way.
    const d = { ...newVehicleDyn(v.x - 12, north.z, Math.PI / 2), deck: north.n };
    d.speed = 15;
    const hits: string[] = [];
    for (let i = 0; i < 90; i++) {
      const r = stepVehicle(d, { keys: KEY.FORWARD, dt: 1 / 30 }, car, w);
      if (r.hitId) hits.push(r.hitId);
    }
    expect(hits).toContain('above');
  });

  it('the water stops a car on the ground, and a low ramp is solid from the side', () => {
    const v = newVehicleDyn(WATER.west - 20, 0, Math.PI / 2);
    v.speed = 20;
    drive(v, KEY.FORWARD, 4);
    expect(v.x).toBeLessThan(WATER.west);
    // Walking into the side of the North Bridge's ramp near the city end.
    const ramp = RAMP_BLOCKS.find((r) => r.n === north.n && r.maxX < 200)!;
    const x = (ramp.minX + ramp.maxX) / 2;
    const res = resolveCircle(x, ramp.minZ + 0.2, 0.45, empty, undefined, { x, z: ramp.minZ - 1 });
    expect(res.hit).toBe(true);
    expect(res.z).toBeLessThan(ramp.minZ);
  });
});

describe('police gear and the bridges', () => {
  it('under a bridge the helicopter loses you; up on the deck it does not', () => {
    expect(underBridge(240, north.z)).toBe(true);
    expect(isCovered(240, north.z)).toBe(true);
    expect(isCovered(240, north.z, north.n)).toBe(false);
    expect(isCovered(400, 20)).toBe(false);
  });

  it('spike strips go across the deck ahead of a car on a bridge', () => {
    const s = spikePlacement(330, north.z + 3, Math.PI / 2, 80, north.n)!;
    expect(s).toMatchObject({ x: 410, z: north.z, rot: 0, deck: north.n });
    expect(s.half).toBeCloseTo(BRIDGE_HALF - 0.3, 5);
    // Not on the ramps at the ends.
    expect(spikePlacement(560, north.z, Math.PI / 2, 80, north.n)).toBeNull();
  });
});

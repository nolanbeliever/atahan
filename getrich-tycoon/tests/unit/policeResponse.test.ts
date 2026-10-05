// The police response time and crime scenes, the pure parts: the arrival times by stars, the
// stations (clear of everything, a free forecourt facing a road), the radio's place names, and the
// cordon layout (cones on a ring pulled in out of walls, tape left open through a wall, flares
// outside, evidence inside).

import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { CARRIAGEWAY_EDGE, projectToHighway } from '../../shared/highway';
import { OFFENCES, POLICE_STATIONS, insideCordon, placeName, planCordon, radioCall } from '../../shared/police';
import { SECURITY_DEFS, SECURITY_ITEMS } from '../../shared/security';
import { BUILDINGS, STATIC_BOXES, isOnRoad } from '../../shared/world';
import { nearestStation } from '../../server/game/services/police';

const R = ECONOMY.police.response;

describe('response time', () => {
  it('1 star: one car in 45-60 s; 2 stars: two cars in 30-40 s; 3+: SWAT and the helicopter in 15-20 s', () => {
    expect(R.etaSec[1]).toEqual([45, 60]);
    expect(R.cars[1]).toBe(1);
    expect(R.etaSec[2]).toEqual([30, 40]);
    expect(R.cars[2]).toBe(2);
    for (const s of [3, 4, 5]) {
      expect(R.etaSec[s]).toEqual([15, 20]);
      expect(R.swat[s]).toBeGreaterThanOrEqual(1);
      expect(R.cars[s]).toBeGreaterThan(R.swat[s]!);
    }
    expect(R.heliStars).toBe(3);
    expect(ECONOMY.police.scene.lifeSec).toBe(180);
    expect(ECONOMY.police.scene.tamperHeat).toBe(100);
  });

  it('the stations stand clear in the world with a free forecourt, one on each side of the water', () => {
    expect(POLICE_STATIONS).toHaveLength(2);
    for (const st of POLICE_STATIONS) {
      expect(BUILDINGS.some((b) => b.id === `police_${st.id}`)).toBe(true);
      const others = STATIC_BOXES.filter((b) => b !== st.box && !(b.minX === st.box.minX && b.maxZ === st.box.maxZ));
      for (const b of others) {
        const overlap = b.minX < st.box.maxX && b.maxX > st.box.minX && b.minZ < st.box.maxZ && b.maxZ > st.box.minZ;
        expect(overlap, `${st.id} overlaps a box`).toBe(false);
        expect(st.bay.x > b.minX - 3 && st.bay.x < b.maxX + 3 && st.bay.z > b.minZ - 3 && st.bay.z < b.maxZ + 3, `${st.id} bay blocked`).toBe(false);
      }
      expect(Math.abs(projectToHighway(st.bay.x, st.bay.z).offset)).toBeGreaterThan(CARRIAGEWAY_EDGE + 10);
    }
    // The city station's forecourt opens onto the city's south road.
    const city = POLICE_STATIONS[0]!;
    expect(isOnRoad(city.bay.x + Math.sin(city.bay.rot) * 14, city.bay.z + Math.cos(city.bay.rot) * 14)).toBe(true);
    expect(nearestStation(0, 0).id).toBe('merkez');
    expect(nearestStation(900, 0).id).toBe('kiyi');
    // Across the water the far one is never chosen for the city.
    expect(nearestStation(280, 0).id).toBe('merkez');
  });

  it('the radio says where and what: "Tüm birimlerin dikkatine, ... ihbarı!"', () => {
    expect(placeName(0, 0)).toBe('Fortune Plaza civarında');
    expect(placeName(-240, 0)).toBe('otoyolda');
    expect(placeName(900, 0)).toBe('Karşı Kıyı civarında');
    expect(placeName(400, -50, 1)).toBe('Kuzey Köprüsü üzerinde');
    expect(radioCall('gunshot', 0, 0)).toBe('Tüm birimlerin dikkatine, Fortune Plaza civarında silah sesi ihbarı!');
    // Traffic offences get no crime scene; crimes leave evidence.
    expect(OFFENCES.crash.kind).toBe('traffic');
    expect(OFFENCES.reckless.kind).toBe('traffic');
    expect(OFFENCES.heist.kind).toBe('crime');
    expect(OFFENCES.shooting.evidence).toContain('blood');
    expect(OFFENCES.gunshot.evidence).toContain('casing');
  });

  it('the police scanner is sold with the security gear', () => {
    expect(SECURITY_ITEMS).toContain('scanner');
    expect(SECURITY_DEFS.scanner.price).toBe(ECONOMY.security.scannerPrice);
    expect(SECURITY_DEFS.scanner.name).toContain('Polis Telsiz');
  });
});

describe('crime scene cordon', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  it('in the open: cones on a ring, tape all round, flares outside, evidence inside', () => {
    const c = planCordon(10, 20, 9, 10, ['casing', 'blood', 'glass'], () => false, rng);
    expect(c.posts).toHaveLength(10);
    for (const [x, z] of c.posts) expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(9, 1);
    expect(c.gaps).toEqual([]);
    expect(c.flares).toHaveLength(4);
    for (const [x, z] of c.flares) expect(insideCordon(c.posts, x, z)).toBe(false);
    expect(c.evidence).toHaveLength(3);
    for (const [x, z] of c.evidence) expect(insideCordon(c.posts, x, z)).toBe(true);
    expect(c.evidence.map((e) => e[2]).sort()).toEqual(['blood', 'casing', 'glass']);
    expect(insideCordon(c.posts, 10, 20)).toBe(true);
    expect(insideCordon(c.posts, 30, 20)).toBe(false);
  });

  it('against a wall: the cones stop at it and the tape is left open through it', () => {
    // A wall 4 m east of the centre.
    const blocked = (x: number) => x > 4;
    const c = planCordon(0, 0, 9, 12, ['casing'], blocked, rng);
    for (const [x] of c.posts) expect(x).toBeLessThanOrEqual(4);
    for (const [x] of c.flares) expect(x).toBeLessThanOrEqual(4);
    for (const [x] of c.evidence) expect(x).toBeLessThanOrEqual(4);
    // Every taped segment stays out of the wall.
    for (let k = 0; k < c.posts.length; k++) {
      if (c.gaps.includes(k)) continue;
      const [ax] = c.posts[k]!;
      const [bx] = c.posts[(k + 1) % c.posts.length]!;
      expect((ax + bx) / 2).toBeLessThanOrEqual(4);
    }
  });
});

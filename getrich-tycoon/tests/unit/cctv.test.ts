// CCTV cameras (shared/cctv.ts): placement, sweep and what they see.

import { describe, expect, it } from 'vitest';
import { CCTV_CAMERAS, cameraSeeing, cameraSees, cameraYaw } from '../../shared/cctv';
import { ECONOMY } from '../../shared/economy.config';
import { BUILDINGS, ROAD_LINES, ROAD_WIDTH } from '../../shared/world';
import { angleDiff } from '../../shared/util';

describe('CCTV cameras', () => {
  it('stand on sidewalk corners at junctions, clear of buildings', () => {
    expect(CCTV_CAMERAS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(CCTV_CAMERAS.map((c) => c.id)).size).toBe(CCTV_CAMERAS.length);
    for (const c of CCTV_CAMERAS) {
      const jx = ROAD_LINES.reduce((a, b) => (Math.abs(b - c.x) < Math.abs(a - c.x) ? b : a));
      const jz = ROAD_LINES.reduce((a, b) => (Math.abs(b - c.z) < Math.abs(a - c.z) ? b : a));
      // Off the carriageway, close to the junction.
      expect(Math.abs(c.x - jx), c.id).toBeGreaterThan(ROAD_WIDTH / 2);
      expect(Math.abs(c.z - jz), c.id).toBeGreaterThan(ROAD_WIDTH / 2);
      expect(Math.hypot(c.x - jx, c.z - jz), c.id).toBeLessThan(15);
      for (const b of BUILDINGS) {
        const inside = c.x > b.box.minX - 0.5 && c.x < b.box.maxX + 0.5 && c.z > b.box.minZ - 0.5 && c.z < b.box.maxZ + 0.5;
        expect(inside, `${c.id} inside a building`).toBe(false);
      }
      // Looking at the middle of its junction.
      expect(Math.abs(angleDiff(Math.atan2(jx - c.x, jz - c.z), c.yaw0))).toBeLessThan(0.01);
    }
  });

  it('sweep back and forth, the same for everyone at the same moment', () => {
    const c = CCTV_CAMERAS[0]!;
    const yaws = Array.from({ length: 60 }, (_, i) => cameraYaw(c, i * 500));
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(c.sweep * 1.5);
    for (const y of yaws) expect(Math.abs(y - c.yaw0)).toBeLessThanOrEqual(c.sweep + 1e-9);
    expect(cameraYaw(c, 123_456)).toBe(cameraYaw(c, 123_456));
  });

  it('see what is in the cone and nothing else', () => {
    const c = CCTV_CAMERAS[2]!;
    const t = 50_000;
    const yaw = cameraYaw(c, t);
    const at = (d: number, off: number) => ({ x: c.x + Math.sin(yaw + off) * d, z: c.z + Math.cos(yaw + off) * d });
    let p = at(15, 0);
    expect(cameraSees(c, p.x, p.z, t)).toBe(true);
    expect(cameraSeeing(p.x, p.z, t)?.id).toBe(c.id);
    p = at(15, c.fov * 0.9);
    expect(cameraSees(c, p.x, p.z, t)).toBe(true);
    p = at(15, c.fov * 1.3);
    expect(cameraSees(c, p.x, p.z, t)).toBe(false);
    p = at(ECONOMY.pursuit.cameraRange + 2, 0);
    expect(cameraSees(c, p.x, p.z, t)).toBe(false);
    p = at(15, Math.PI);
    expect(cameraSees(c, p.x, p.z, t)).toBe(false);
  });
});

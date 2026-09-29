import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLE_MODELS } from '../../shared/vehicles';
import { bikeBody } from '../../client/src/render/bikeBody';
import { carBody, rimGeometry, tireGeometry } from '../../client/src/render/carBody';
import { DESIGNS } from '../../client/src/render/carDesigns';

const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

describe('procedural vehicle models', () => {
  const cars = VEHICLE_MODELS.filter((m) => m.specs.kind === 'car');

  it('every car model has its own design', () => {
    for (const m of cars) expect(DESIGNS[m.id], m.id).toBeDefined();
  });

  for (const m of cars) {
    it(`${m.id} builds a valid body that matches its physical size`, () => {
      const body = carBody(m.id);
      const box = new THREE.Box3();
      let tris = 0;
      for (const [part, g] of body.parts) {
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `${m.id}/${part}`).toBe(true);
        }
        g.computeBoundingBox();
        box.union(g.boundingBox!);
        tris += triangles(g);
      }
      // Close to the collision box used by the physics (mirrors, exhausts and a rear spare wheel stick out a little).
      expect(box.max.z).toBeLessThanOrEqual(m.shape.length / 2 + 0.1);
      expect(box.min.z).toBeGreaterThanOrEqual(-m.shape.length / 2 - (body.d.spare ? body.d.wheelW + 0.1 : 0.1));
      expect(box.max.x).toBeLessThanOrEqual(m.shape.width / 2 + 0.25);
      expect(box.min.y).toBeGreaterThanOrEqual(0);
      expect(box.max.y).toBeLessThanOrEqual(body.height + 0.25);
      expect(body.height).toBeGreaterThan(1);
      expect(body.height).toBeLessThan(2.4);
      // Wheels sit inside the body width.
      expect(body.trackX + body.d.wheelW / 2).toBeLessThanOrEqual(m.shape.width / 2 + 0.06);
      // Cheap enough to fill a car park on a tablet.
      expect(tris).toBeLessThan(12_000);
      for (const part of ['paint', 'trim', 'lamp', 'chrome'] as const) {
        if (part === 'chrome' && !body.parts.has('chrome')) continue;
        expect(body.parts.has(part), `${m.id} ${part}`).toBe(true);
      }
      if (body.d.open?.kind !== 'cockpit') expect(body.parts.has('glass')).toBe(true);
    });

    it(`${m.id} has head lamps at the front and tail lamps at the back`, () => {
      const lamp = carBody(m.id).parts.get('lamp')!;
      const pos = lamp.getAttribute('position');
      const col = lamp.getAttribute('color');
      let front = 0;
      let rear = 0;
      for (let i = 0; i < pos.count; i++) {
        const red = col.getX(i) > 0.9 && col.getY(i) < 0.3;
        if (!red && pos.getZ(i) > 0) front++;
        if (red && pos.getZ(i) < 0) rear++;
      }
      expect(front, 'head lamps').toBeGreaterThan(0);
      expect(rear, 'tail lamps').toBeGreaterThan(0);
    });
  }

  it('wheel parts are shared and small', () => {
    expect(tireGeometry(0.62)).toBe(tireGeometry(0.62));
    for (const s of ['five', 'multi', 'aero', 'hubcap', 'wire', 'steel', 'mesh', 'sixspoke', 'turbofan', 'deepdish'] as const) expect(triangles(rimGeometry(s).face)).toBeLessThan(1000);
  });

  it('exhaust tips sit at the rear of cars with exhausts', () => {
    for (const m of cars) {
      const b = carBody(m.id);
      if (b.d.exhaust === 'none') continue;
      expect(b.exhausts.length, m.id).toBeGreaterThan(0);
      for (const [, , z] of b.exhausts) expect(z, m.id).toBeLessThan(-m.shape.length / 2 + 0.3);
    }
  });

  for (const m of VEHICLE_MODELS.filter((x) => x.specs.kind === 'bike')) {
    it(`${m.id} builds a motorcycle within its size`, () => {
      const b = bikeBody(m.id, m.shape.length, m.shape.wheelRadius, m.shape.wheelWidth);
      const box = new THREE.Box3();
      for (const g of [...b.parts.values(), ...b.steerParts.values()]) {
        g.computeBoundingBox();
        box.union(g.boundingBox!);
      }
      expect(b.parts.has('paint') && b.parts.has('lamp') && b.parts.has('glass')).toBe(true);
      expect(box.max.x - box.min.x).toBeLessThan(m.shape.width + 0.1);
      expect(b.front.z + b.front.r).toBeLessThanOrEqual(m.shape.length / 2 + 0.05);
      expect(b.rear.z - b.rear.r).toBeGreaterThanOrEqual(-m.shape.length / 2 - 0.05);
      expect(b.exhausts.length).toBeGreaterThan(0);
    });
  }
});

// The Sanayi part-time mechanic: the job board and every job's spot round a car on any lift are
// inside the hall, clear of the lift posts and the walls, and $1,000 is paid per car.

import { describe, expect, it } from 'vitest';
import { HALL_CENTRE, JOB_BOARD, MECH, REPAIR_TASKS, taskPoint } from '../../shared/mechanic';
import { CHAR_RADIUS } from '../../shared/physics';
import { LIFT_BAYS, SANAYI, SANAYI_BOXES, SANAYI_CIRCLES } from '../../shared/theft';
import { CATALOG_MODELS } from '../../shared/vehicles';

const inHall = (p: { x: number; z: number }, m = 0) => p.x > SANAYI.hall.minX + m && p.x < SANAYI.hall.maxX - m && p.z > SANAYI.hall.minZ + m && p.z < SANAYI.hall.maxZ - m;
const clearOfPosts = (p: { x: number; z: number }) => SANAYI_CIRCLES.every((c) => Math.hypot(p.x - c.x, p.z - c.z) > c.r + CHAR_RADIUS + 0.1);
const clearOfWalls = (p: { x: number; z: number }) => SANAYI_BOXES.every((b) => p.x < b.minX - CHAR_RADIUS || p.x > b.maxX + CHAR_RADIUS || p.z < b.minZ - CHAR_RADIUS || p.z > b.maxZ + CHAR_RADIUS);

describe('the Sanayi mechanic', () => {
  it('$1,000 per car, paid on the spot', () => {
    expect(MECH.pay).toBe(1_000);
    expect(MECH.shiftRadius).toBeGreaterThan(Math.hypot(JOB_BOARD.x - HALL_CENTRE.x, JOB_BOARD.z - HALL_CENTRE.z) + 10);
  });

  it('four lifts in the hall, side by side without overlapping', () => {
    expect(LIFT_BAYS).toHaveLength(4);
    for (const b of LIFT_BAYS) expect(inHall(b, 3)).toBe(true);
    const xs = LIFT_BAYS.map((b) => b.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(5.4);
  });

  it('the job board is inside the hall and reachable', () => {
    expect(inHall(JOB_BOARD, 1)).toBe(true);
    expect(clearOfWalls(JOB_BOARD)).toBe(true);
    expect(clearOfPosts(JOB_BOARD)).toBe(true);
  });

  it('every job spot round every everyday car on every lift can be stood on', () => {
    const cars = CATALOG_MODELS.filter((m) => m.specs.kind === 'car' && m.basePrice < 60_000);
    expect(cars.length).toBeGreaterThan(3);
    for (let bay = 0; bay < LIFT_BAYS.length; bay++) {
      for (const m of cars) {
        for (const task of REPAIR_TASKS) {
          const p = taskPoint(bay, task, m.shape.length, m.shape.width);
          expect(inHall(p, 0.6), `${task} at lift ${bay} (${m.id})`).toBe(true);
          expect(clearOfPosts(p), `${task} at lift ${bay} (${m.id}) clear of the posts`).toBe(true);
          expect(clearOfWalls(p)).toBe(true);
          // Not in another lift's car.
          for (const o of LIFT_BAYS) if (o !== LIFT_BAYS[bay]) expect(Math.abs(p.x - o.x) > m.shape.width / 2 + 0.3 || Math.abs(p.z - o.z) > m.shape.length / 2 + 0.3).toBe(true);
        }
      }
    }
  });
});

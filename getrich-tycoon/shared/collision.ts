// Builds the collision world from shared data so client prediction and server
// simulation use identical obstacles.

import type { DynamicCircle } from './physics';
import { vehicleCircles } from './physics';
import { findModel } from './vehicles';
import { PLOTS, STATIC_BOXES, STATIC_CIRCLES, plotStructuresWorld, type AABB } from './world';

export function worldBoxes(dealershipLevels: ReadonlyMap<string, number>): AABB[] {
  const boxes: AABB[] = [...STATIC_BOXES];
  for (const plot of PLOTS) {
    const level = dealershipLevels.get(plot.id) ?? 0;
    for (const s of plotStructuresWorld(plot, level)) boxes.push(s.box);
  }
  return boxes;
}

export { STATIC_CIRCLES };

export interface ObstacleVehicle {
  id: string;
  modelId: string;
  x: number;
  z: number;
  rot: number;
}

export function vehicleObstacles(vehicles: Iterable<ObstacleVehicle>, out: DynamicCircle[] = []): DynamicCircle[] {
  for (const v of vehicles) {
    const m = findModel(v.modelId);
    if (!m) continue;
    for (const c of vehicleCircles(v.x, v.z, v.rot, m.shape.length / 2, m.shape.width / 2)) out.push({ ...c, id: v.id });
  }
  return out;
}

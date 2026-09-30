// Builds the collision world from shared data so client prediction and server
// simulation use identical obstacles.

import { vehicleBox, type DynamicBox } from './physics';
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
  /** Velocity (game m/s) of a moving vehicle. */
  vx?: number;
  vz?: number;
}

/** Tight collision box of a catalogue vehicle (same extents as physics.vehicleParams). */
export function modelBoxHalfExtents(modelId: string): { hl: number; hw: number } | null {
  const m = findModel(modelId);
  if (!m) return null;
  return { hl: m.shape.length / 2 - 0.03, hw: m.shape.width / 2 - (m.specs.kind === 'bike' ? 0.1 : 0.04) };
}

export function vehicleObstacles(vehicles: Iterable<ObstacleVehicle>, out: DynamicBox[] = []): DynamicBox[] {
  for (const v of vehicles) {
    const e = modelBoxHalfExtents(v.modelId);
    if (!e) continue;
    out.push(vehicleBox(v.id, v.x, v.z, v.rot, e.hl, e.hw, v.vx ?? 0, v.vz ?? 0));
  }
  return out;
}

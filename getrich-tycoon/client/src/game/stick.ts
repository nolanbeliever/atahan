// Maps an on-screen joystick deflection to movement key bits. The server simulates movement
// from key masks only, so the stick is quantized into the same 8 directions as WASD.

import { KEY } from '../../../shared/physics';

/** Deflections below this fraction of the stick radius are ignored. */
export const STICK_DEAD_ZONE = 0.22;
/** Pushing the stick at least this far while on foot also sprints. */
export const STICK_SPRINT = 0.9;
// sin(22.5°): splits the circle into 8 equal sectors.
const AXIS = 0.3827;

/**
 * `nx`/`ny` are the stick deflection divided by its radius (clamped to the unit circle);
 * positive `ny` points down the screen, i.e. backwards.
 */
export function stickKeys(nx: number, ny: number, driving: boolean): number {
  const mag = Math.hypot(nx, ny);
  if (mag < STICK_DEAD_ZONE) return 0;
  const ux = nx / mag;
  const uy = ny / mag;
  let keys = 0;
  if (uy < -AXIS) keys |= KEY.FORWARD;
  if (uy > AXIS) keys |= KEY.BACK;
  if (ux < -AXIS) keys |= KEY.LEFT;
  if (ux > AXIS) keys |= KEY.RIGHT;
  if (!driving && mag >= STICK_SPRINT) keys |= KEY.SPRINT;
  return keys;
}

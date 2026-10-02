// Riding along in another player's car: how many passengers a vehicle takes and where they sit.

import type { VehicleModel } from './vehicles';

/** Passenger seats besides the driver: the pillion on a motorcycle or quad, one in a coupe, three
 *  in anything else. */
export function passengerSeats(model: VehicleModel): number {
  if (model.specs.kind === 'bike') return 1;
  return model.shape.style === 'coupe' ? 1 : 3;
}

/**
 * A passenger seat relative to the driver's seat, in the car's frame (x left, z forward):
 * 0 front passenger, 1 rear right, 2 rear left.
 */
export function seatOffset(seat: number, driverX: number, length: number): { x: number; dz: number } {
  const rear = Math.max(0.75, Math.min(1.05, length * 0.19));
  if (seat === 0) return { x: -driverX, dz: 0 };
  if (seat === 1) return { x: -driverX * 0.95, dz: -rear };
  return { x: driverX * 0.95, dz: -rear };
}

/** Passengers get out on their own side: the right for seats 0 and 1, the left for seat 2. */
export function exitSide(seat: number): 1 | -1 {
  return seat === 2 ? 1 : -1;
}

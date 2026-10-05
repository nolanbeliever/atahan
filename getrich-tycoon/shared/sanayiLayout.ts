// Footprint of the Sanayi (industrial estate) south of the city: the garage hall with its lifts and
// the Pawn Shop. No imports, so highway.ts can keep its belt trees out of it (see shared/theft.ts).

export const SANAYI = {
  /** Paved yard between the city's outer road and the highway. */
  yard: { minX: 56, maxX: 152, minZ: 156, maxZ: 212 },
  /** Garage hall: open on the north side (facing the city), walls on the other three. */
  hall: { minX: 64, maxX: 124, minZ: 170, maxZ: 199 },
  wallHeight: 6.5,
  /** Pawn Shop building (door on its west side). */
  pawn: { minX: 133, maxX: 149, minZ: 176, maxZ: 194 },
  /** Driveway from the city's outer road (gap in the kerb ring). */
  entry: { x: 94, width: 16 },
};

/** Inside the estate (trees and decoration stay out). */
export function inSanayi(x: number, z: number, margin = 0): boolean {
  const y = SANAYI.yard;
  return x > y.minX - margin && x < y.maxX + margin && z > y.minZ - margin && z < y.maxZ + margin;
}

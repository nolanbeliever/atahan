// Footprints of the places out in the green belt between the city and the highway (no imports, so
// highway.ts can keep its belt trees out of them): the hospital to the north, where players wake up
// after being WASTED, and the Ammu-Nation gun shop to the east.

export const HOSPITAL = {
  box: { minX: -54, maxX: -10, minZ: -208, maxZ: -184 },
  /** Where a wasted player walks out (in front of the doors, facing the city). */
  respawn: { x: -32, z: -176 },
};

export const AMMU_NATION = {
  box: { minX: 178, maxX: 202, minZ: -42, maxZ: -14 },
  door: { x: 174, z: -28 },
};

/** Inside one of the compounds (trees stay out). */
export function inCompound(x: number, z: number, margin = 0): boolean {
  return [HOSPITAL.box, AMMU_NATION.box].some((b) => x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin);
}

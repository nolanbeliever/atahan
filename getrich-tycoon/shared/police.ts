// Wanted level and police pursuits: what the client needs to know (the logic lives in
// server/game/services/police.ts).

/** A police car in a snapshot: [id, x, z, rot, speed, steer, flags (PF), bridge deck?]. */
export type PoliceSnap = [number, number, number, number, number, number, number, number?];

export const PF = {
  /** Lights and siren on. */
  SIREN: 1,
  BRAKE: 2,
  /** Lost you: searching round where you were last seen (yellow lights). */
  SEARCH: 4,
} as const;

export interface WantedState {
  /** 0-5 stars. */
  stars: number;
  /** Police cars after you. */
  units: number;
  /** Hidden from the police: seconds left on the escape countdown (it only starts over when a
   *  police car keeps you in sight for 2 s); null while they can see you. */
  escapeLeft: number | null;
  /** A police car has you in its sight right now: how close it is to spotting you (0-1). */
  seen?: number;
  /** The units lost you and are searching round where you were last seen. */
  search?: boolean;
  /** How close you are to being arrested (0-1). */
  bust: number;
  /** The helicopter: tracking you, or lost you (under cover); null: none. */
  heli?: 'seen' | 'lost' | null;
}

export interface BustedEvent {
  fine: number;
  /** Where it happened (the car or the player on foot) and the police car beside it. */
  at: { x: number; z: number; rot: number };
  police: { x: number; z: number; rot: number } | null;
  /** Where the player walks out afterwards. */
  respawn: { x: number; z: number; rot: number };
  /** The car that was towed to the garage (impounded). */
  vehicleId: string | null;
  cutsceneMs: number;
}

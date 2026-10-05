// Drag strip races: shared types and timing (server runs the race, clients show the tree).

import type { VehicleTuning } from './modificationsData';

export type DragPhase = 'staging' | 'countdown' | 'racing' | 'finished';

export type DragOutcome = 'finished' | 'false_start' | 'dnf' | 'dq';

export interface DragResult {
  outcome: DragOutcome;
  /** Seconds from green to launch. */
  reaction: number | null;
  /** Elapsed time from launch to the finish line. */
  et: number | null;
  /** Reaction + elapsed time: the lower one wins. */
  total: number | null;
  /** Speedometer reading at the finish line (km/h). */
  trapKmh: number | null;
}

export interface DragRacer {
  lane: 0 | 1;
  playerId: string | null;
  name: string;
  modelId: string;
  color: string;
  tuning: VehicleTuning | null;
  bot: boolean;
  /** From the tuning stats of the car (calculateVehicleStats). */
  zeroTo100: number;
  topSpeedKmh: number;
  hp: number;
  result: DragResult | null;
}

export interface DragRaceView {
  id: string;
  phase: DragPhase;
  /** 0 dark, 1-3 red lights lit, 4 green. */
  lights: number;
  /** Server time when the light went green. */
  greenAt: number | null;
  racers: DragRacer[];
  /** Winning lane, or null (nobody / a tie). */
  winner: 0 | 1 | null;
  entry: number;
  pool: number;
}

export interface DragQueueEntry {
  playerId: string;
  name: string;
  modelId: string;
  since: number;
}

export interface DragInfo {
  /** Players waiting for an opponent. */
  queue: DragQueueEntry[];
  /** The race on the strip right now (if any). */
  race: DragRaceView | null;
  entry: number;
  prize: number;
}

/** Bot (and remote) car positions during a race: [lane, z, speed]. */
export type DragBotSnap = [number, number, number];

/** Seconds from staging to the first red light, between the red lights, and the random green delay. */
export const DRAG_TIMING = {
  staging: 2.0,
  redStep: 0.8,
  greenDelay: [0.35, 1.25] as [number, number],
  /** A racer that hasn't finished this long after green is out (DNF). */
  timeout: 30,
  /** The result stays on the strip this long before it frees up. */
  results: 6,
  /** Rolling forward this far past the line before green is a false start (m). */
  falseStartDist: 0.45,
  /** Wandering this far from the lane centre is a disqualification (m). */
  laneTolerance: 3.3,
};

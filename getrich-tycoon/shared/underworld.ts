// The underworld side of a player: dirty money (Kara Para) from heists and dealing, which can't be
// spent until it has been laundered through a legal business, and the heist record. One JSON
// document per player (player_crime), written in the same transaction as the money it moves.

export interface CrimeState {
  v: 1;
  /** Dirty cash on hand (from heists and dealing): can't be spent; launder it through a business. */
  dirty: number;
  /** Heists pulled off, and the biggest haul. */
  heists: number;
  bestHeist: number;
  /** Dirty money laundered into clean money, all time. */
  laundered: number;
}

/** What the client is shown. */
export interface CrimeView {
  dirty: number;
  heists: number;
  bestHeist: number;
  laundered: number;
}

export function emptyCrimeState(): CrimeState {
  return { v: 1, dirty: 0, heists: 0, bestHeist: 0, laundered: 0 };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** A stored document (or nothing) as a valid state. */
export function normalizeCrimeState(raw: unknown): CrimeState {
  const s = emptyCrimeState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  s.dirty = num(r.dirty);
  s.heists = num(r.heists);
  s.bestHeist = num(r.bestHeist);
  s.laundered = num(r.laundered);
  return s;
}

export function crimeView(s: CrimeState): CrimeView {
  return { dirty: s.dirty, heists: s.heists, bestHeist: s.bestHeist, laundered: s.laundered };
}

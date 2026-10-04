// The underworld side of a player: dirty money (Kara Para) from heists and dealing, which can't be
// spent until it has been laundered through a legal business, the businesses, and the heist record.
// One JSON document per player (player_crime), written in the same transaction as the money it moves.

import { ECONOMY } from './economy.config';
import { BUSINESSES, BUSINESS_IDS, type BusinessId, type BusinessView, type OwnedBusiness } from './realestate';

export interface CrimeState {
  v: 1;
  /** Dirty cash on hand (from heists and dealing): can't be spent; launder it through a business. */
  dirty: number;
  /** Heists pulled off, and the biggest haul. */
  heists: number;
  bestHeist: number;
  /** Dirty money laundered into clean money, all time. */
  laundered: number;
  /** Businesses bought at the estate agent (the laundry). */
  businesses: OwnedBusiness[];
}

/** What the client is shown. */
export interface CrimeView {
  dirty: number;
  heists: number;
  bestHeist: number;
  laundered: number;
  /** Every business at the estate agent: owned or not, the dirty money waiting, the next cycle. */
  businesses: BusinessView[];
}

export function emptyCrimeState(): CrimeState {
  return { v: 1, dirty: 0, heists: 0, bestHeist: 0, laundered: 0, businesses: [] };
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
  if (Array.isArray(r.businesses)) {
    for (const b of r.businesses as Record<string, unknown>[]) {
      if (!b || !BUSINESS_IDS.includes(b.id as BusinessId) || s.businesses.some((x) => x.id === b.id)) continue;
      s.businesses.push({ id: b.id as BusinessId, boughtAt: num(b.boughtAt), pending: num(b.pending), cycleAt: num(b.cycleAt) });
    }
  }
  return s;
}

export function crimeView(s: CrimeState): CrimeView {
  const ms = ECONOMY.laundering.cycleSec * 1000;
  const businesses = BUSINESSES.map((b): BusinessView => {
    const own = s.businesses.find((x) => x.id === b.id);
    return { id: b.id, owned: !!own, pending: own?.pending ?? 0, nextAt: own ? own.cycleAt + ms : null };
  });
  return { dirty: s.dirty, heists: s.heists, bestHeist: s.bestHeist, laundered: s.laundered, businesses };
}

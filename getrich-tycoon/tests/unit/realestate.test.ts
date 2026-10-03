// Laundering: every business turns up to $100,000 of the dirty money paid into it clean every
// 10 minutes; cycles that ran while you were away are paid all at once.

import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { BUSINESSES, launder, type OwnedBusiness } from '../../shared/realestate';
import { crimeView, normalizeCrimeState } from '../../shared/underworld';

const L = ECONOMY.laundering;
const MIN = 60_000;

describe('laundering', () => {
  it('$100,000 per business every 10 minutes', () => {
    expect(L.perCycle).toBe(100_000);
    expect(L.cycleSec).toBe(600);
    const b: OwnedBusiness = { id: 'laundromat', boughtAt: 0, pending: 250_000, cycleAt: 0 };
    expect(launder(b, 9 * MIN)).toBe(0);
    expect(launder(b, 10 * MIN)).toBe(100_000);
    expect(b).toMatchObject({ pending: 150_000, cycleAt: 10 * MIN });
    // Away for 25 minutes: two more cycles.
    expect(launder(b, 35 * MIN)).toBe(150_000);
    expect(b).toMatchObject({ pending: 0, cycleAt: 30 * MIN });
  });

  it('a stored document comes back clean (unknown or repeated businesses dropped)', () => {
    const s = normalizeCrimeState({ dirty: 5000.7, heists: -2, businesses: [{ id: 'carwash', pending: 10, cycleAt: 5 }, { id: 'carwash', pending: 99 }, { id: 'nope' }] });
    expect(s).toMatchObject({ dirty: 5000, heists: 0, businesses: [{ id: 'carwash', pending: 10, cycleAt: 5 }] });
    const v = crimeView(s);
    expect(v.businesses).toHaveLength(BUSINESSES.length);
    expect(v.businesses.find((b) => b.id === 'carwash')).toMatchObject({ owned: true, pending: 10, nextAt: 5 + L.cycleSec * 1000 });
    expect(v.businesses.find((b) => b.id === 'nightclub')).toMatchObject({ owned: false, nextAt: null });
  });
});

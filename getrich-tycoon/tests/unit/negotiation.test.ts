import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { applyOffer, createSellerSession, toNegotiationState } from '../../shared/negotiation';
import { mulberry32 } from '../../shared/util';

describe('negotiation', () => {
  it('accepts offers at or above the current counter (never charging more than the counter)', () => {
    const s = createSellerSession('l', 'friendly', 10_000, 8_500, 0);
    expect(applyOffer(s, 12_000)).toBe('accept');
    expect(s.counterOffer).toBe(10_000);
  });

  it('counters offers between min and counter and loses patience', () => {
    const s = createSellerSession('l', 'friendly', 10_000, 8_500, 0);
    const out = applyOffer(s, 9_000);
    expect(out).toBe('counter');
    expect(s.counterOffer).toBeLessThan(10_000);
    expect(s.counterOffer).toBeGreaterThanOrEqual(9_000);
    expect(toNegotiationState(s).patience).toBeLessThan(1);
  });

  it('insulting offers cost extra patience and the seller eventually walks off', () => {
    const s = createSellerSession('l', 'stubborn', 10_000, 9_500, 0);
    const outcomes = [];
    for (let i = 0; i < 5 && s.status === 'open'; i++) outcomes.push(applyOffer(s, 1_000));
    expect(outcomes).toContain('insulted');
    expect(s.status).toBe('rejected');
    // After walking off the full asking price stands.
    expect(s.counterOffer).toBe(10_000);
    expect(applyOffer(s, 9_999)).toBe('walked_off');
  });

  it('never sells below the hidden minimum price (randomized)', () => {
    const rng = mulberry32(1234);
    for (let trial = 0; trial < 2000; trial++) {
      const p = ECONOMY.sellerPersonalities[trial % ECONOMY.sellerPersonalities.length]!;
      const ask = 5_000 + Math.floor(rng() * 100_000);
      const min = Math.floor(ask * (0.7 + rng() * 0.3));
      const s = createSellerSession('l', p.id, ask, min, 0);
      for (let i = 0; i < 10 && s.status === 'open'; i++) {
        applyOffer(s, Math.floor(ask * (0.5 + rng() * 0.6)));
      }
      if (s.status === 'accepted') expect(s.counterOffer).toBeGreaterThanOrEqual(min);
      expect(s.counterOffer).toBeLessThanOrEqual(ask);
    }
  });
});

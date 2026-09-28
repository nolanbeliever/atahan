// Data-driven NPC seller negotiation. Pure logic; the server owns the state
// (including the hidden minimum price) and only sends NegotiationState to clients.

import { ECONOMY, type SellerPersonalityConfig } from './economy.config';
import type { NegotiationState, SellerPersonalityId } from './types';

export interface SellerSession {
  listingId: string;
  personality: SellerPersonalityId;
  askingPrice: number;
  /** Hidden: lowest price the seller will ever accept. */
  minPrice: number;
  counterOffer: number;
  lastOffer: number | null;
  /** Remaining patience (offers). */
  patience: number;
  maxPatience: number;
  round: number;
  status: NegotiationState['status'];
  message: string;
  createdAt: number;
}

export type OfferOutcome = 'accept' | 'counter' | 'reject' | 'insulted' | 'walked_off';

export function personalityConfig(id: SellerPersonalityId): SellerPersonalityConfig {
  const p = ECONOMY.sellerPersonalities.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown personality ${id}`);
  return p;
}

export function createSellerSession(
  listingId: string,
  personality: SellerPersonalityId,
  askingPrice: number,
  minPrice: number,
  now: number,
): SellerSession {
  const cfg = personalityConfig(personality);
  return {
    listingId,
    personality,
    askingPrice,
    minPrice: Math.min(minPrice, askingPrice),
    counterOffer: askingPrice,
    lastOffer: null,
    patience: cfg.patience,
    maxPatience: cfg.patience,
    round: 0,
    status: 'open',
    message: cfg.lines.greet,
    createdAt: now,
  };
}

function roundPrice(v: number): number {
  if (v >= 20_000) return Math.round(v / 100) * 100;
  if (v >= 2_000) return Math.round(v / 50) * 50;
  return Math.round(v / 10) * 10;
}

/**
 * Apply a player offer to a seller session. Mutates and returns the outcome.
 * When the outcome is 'accept', `session.counterOffer` holds the agreed price.
 */
export function applyOffer(session: SellerSession, offer: number): OfferOutcome {
  const cfg = personalityConfig(session.personality);
  if (session.status !== 'open') return session.status === 'accepted' ? 'accept' : 'walked_off';
  session.round++;
  session.lastOffer = offer;

  // Offer at or above the current counter: instant deal at the offer (never above counter).
  if (offer >= session.counterOffer) {
    session.counterOffer = Math.min(session.counterOffer, offer);
    session.status = 'accepted';
    session.message = cfg.lines.accept;
    return 'accept';
  }

  if (offer >= session.minPrice) {
    const gap = session.counterOffer - offer;
    // Close enough (within 2.5% of asking) or seller is flexible enough: accept.
    if (gap <= session.askingPrice * 0.025) {
      session.counterOffer = offer;
      session.status = 'accepted';
      session.message = cfg.lines.accept;
      return 'accept';
    }
    session.patience -= 1;
    const next = Math.max(session.minPrice, roundPrice(session.counterOffer - gap * cfg.flexibility));
    session.counterOffer = Math.max(offer, next);
    session.message = cfg.lines.counter;
    if (session.patience <= 0) return walkOff(session, cfg);
    return 'counter';
  }

  // Below the hidden minimum.
  const insulting = offer < session.minPrice * cfg.insultThreshold;
  session.patience -= insulting ? 2 : 1;
  if (session.patience <= 0) return walkOff(session, cfg);
  const next = roundPrice(session.counterOffer - (session.counterOffer - session.minPrice) * cfg.flexibility * 0.5);
  session.counterOffer = Math.max(session.minPrice, next);
  session.message = insulting ? cfg.lines.insulted : cfg.lines.reject;
  return insulting ? 'insulted' : 'reject';
}

function walkOff(session: SellerSession, cfg: SellerPersonalityConfig): OfferOutcome {
  session.patience = 0;
  session.status = 'rejected';
  session.counterOffer = session.askingPrice;
  session.message = `${cfg.lines.reject} (The seller is done negotiating - the full asking price stands.)`;
  return 'walked_off';
}

export function toNegotiationState(s: SellerSession): NegotiationState {
  return {
    listingId: s.listingId,
    status: s.status,
    round: s.round,
    askingPrice: s.askingPrice,
    counterOffer: s.counterOffer,
    lastOffer: s.lastOffer,
    patience: s.maxPatience > 0 ? Math.max(0, s.patience) / s.maxPatience : 0,
    message: s.message,
    personality: s.personality,
  };
}

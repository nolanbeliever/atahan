// Server-side record types (superset of the shared types with private fields).

import type { AuctionStatus, Dealership, PlayerPrivate, SellerPersonalityId } from '../../shared/types';

export interface PlayerRecord extends PlayerPrivate {
  nameLower: string;
  passwordHash: string;
  posX: number;
  posZ: number;
  rot: number;
  lastInterestAt: number;
  lastSeenAt: number;
}

export interface ListingRecord {
  id: string;
  vehicleId: string;
  askingPrice: number;
  /** Hidden minimum price for negotiation. Never sent to clients. */
  minPrice: number;
  sellerName: string;
  personality: SellerPersonalityId;
  lotSlot: number;
  expiresAt: number;
  createdAt: number;
}

export interface AuctionRecord {
  id: string;
  vehicleId: string;
  sellerId: string | null;
  sellerName: string;
  startingBid: number;
  currentBid: number | null;
  currentBidderId: string | null;
  currentBidderName: string | null;
  bidCount: number;
  /** Hidden maximum NPC bidders will pay. */
  npcCap: number;
  endsAt: number;
  status: AuctionStatus;
  createdAt: number;
}

export type DealershipRecord = Dealership;

export interface NoticeRecord {
  id: string;
  playerId: string;
  kind: string;
  title: string;
  text: string;
  createdAt: number;
}

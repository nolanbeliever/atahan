// Network protocol between browser clients and the game server.
// Everything the client asks for goes through a single validated `rpc` channel;
// high-frequency movement goes through `input`.

import type { InputCmd } from './physics';
import type {
  Appearance,
  Auction,
  CategoryTrends,
  ChatMessage,
  CustomerOffer,
  Dealership,
  LeaderboardEntry,
  MarketListing,
  NegotiationState,
  Notification,
  PlayerListing,
  PlayerPrivate,
  PlayerPublic,
  PlayerSettings,
  PublicVehicle,
  RepairPart,
  Snapshot,
  Transaction,
  Vehicle,
  VehicleMods,
  WorldInit,
} from './types';

export const PROTOCOL_VERSION = 1;

type Empty = Record<string, never>;

export interface PrivateState {
  player: PlayerPrivate;
  vehicles: Vehicle[];
  /** Vehicle id the player is currently driving. */
  driving: string | null;
}

export interface RpcMethods {
  'market.list': { params: Empty; result: { listings: MarketListing[]; playerListings: PlayerListing[]; trends: CategoryTrends } };
  'market.buy': { params: { listingId: string; expectedPrice: number }; result: { vehicle: Vehicle; price: number } };
  'market.negotiate': { params: { listingId: string }; result: NegotiationState };
  'market.offer': { params: { listingId: string; offer: number }; result: { state: NegotiationState; vehicle: Vehicle | null; price: number | null } };
  'market.buyPlayer': { params: { vehicleId: string; expectedPrice: number }; result: { vehicle: Vehicle; price: number } };

  'vehicle.list': { params: { vehicleId: string; price: number }; result: { vehicle: Vehicle } };
  'vehicle.unlist': { params: { vehicleId: string }; result: { vehicle: Vehicle } };
  'vehicle.quickSell': { params: { vehicleId: string; expectedPrice: number }; result: { price: number } };
  'vehicle.spawn': { params: { vehicleId: string }; result: { vehicle: Vehicle } };
  'vehicle.store': { params: { vehicleId: string }; result: { vehicle: Vehicle } };
  'vehicle.enter': { params: { vehicleId: string }; result: { vehicleId: string } };
  'vehicle.exit': { params: Empty; result: { x: number; z: number } };

  'dealership.buy': { params: { plotId: string; name: string }; result: { dealership: Dealership } };
  'dealership.upgrade': { params: Empty; result: { dealership: Dealership } };
  'dealership.rename': { params: { name: string }; result: { dealership: Dealership } };
  'dealership.place': { params: { vehicleId: string; slot: number; price: number | null; rotation: number }; result: { vehicle: Vehicle } };
  'dealership.remove': { params: { vehicleId: string }; result: { vehicle: Vehicle } };
  'dealership.price': { params: { vehicleId: string; price: number | null; rotation?: number }; result: { vehicle: Vehicle } };

  'repair.start': { params: { vehicleId: string; parts: RepairPart[]; useKits: boolean }; result: { vehicle: Vehicle; cost: number; seconds: number } };
  'wash.start': { params: { vehicleId: string; tier: string }; result: { vehicle: Vehicle; cost: number } };
  'fuel.refill': { params: { vehicleId: string }; result: { vehicle: Vehicle; cost: number } };
  'custom.apply': { params: { vehicleId: string; mods: Partial<VehicleMods> }; result: { vehicle: Vehicle; cost: number } };
  'parts.buy': { params: { itemId: string; qty: number }; result: { inventory: Record<string, number>; cost: number } };

  'bank.deposit': { params: { amount: number }; result: { money: number; bank: number } };
  'bank.withdraw': { params: { amount: number }; result: { money: number; bank: number } };

  'auction.list': { params: Empty; result: { auctions: Auction[] } };
  'auction.create': { params: { vehicleId: string; startingBid: number; durationSec: number }; result: { auction: Auction } };
  'auction.bid': { params: { auctionId: string; amount: number }; result: { auction: Auction } };

  'chat.send': { params: { channel: 'global' | 'nearby'; text: string }; result: { ok: true } };
  'offer.respond': { params: { offerId: string; accept: boolean }; result: { sold: boolean } };
  'settings.save': { params: { settings: PlayerSettings }; result: { settings: PlayerSettings } };
  'appearance.save': { params: { appearance: Appearance }; result: { appearance: Appearance } };
  'leaderboard': { params: Empty; result: { entries: LeaderboardEntry[] } };
  'transactions': { params: Empty; result: { transactions: Transaction[] } };
}

export type RpcName = keyof RpcMethods;
export type RpcParams<K extends RpcName> = RpcMethods[K]['params'];
export type RpcResult<K extends RpcName> = RpcMethods[K]['result'];

export interface RpcRequest<K extends RpcName = RpcName> {
  /** Client generated id; duplicates of a recent id return the cached response. */
  id: string;
  method: K;
  params: RpcParams<K>;
}

export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'forbidden'
  | 'insufficient_funds'
  | 'conflict'
  | 'rate_limited'
  | 'too_far'
  | 'locked'
  | 'server_error';

export type RpcResponse<K extends RpcName = RpcName> =
  | { ok: true; result: RpcResult<K> }
  | { ok: false; error: string; code: ErrorCode };

export interface ServerToClientEvents {
  welcome: (d: { playerId: string; self: PrivateState; world: WorldInit; protocol: number }) => void;
  self: (d: PrivateState) => void;
  snapshot: (s: Snapshot) => void;
  'player.upsert': (p: PlayerPublic) => void;
  'player.remove': (id: string) => void;
  'vehicle.upsert': (v: PublicVehicle) => void;
  'vehicle.remove': (id: string) => void;
  'dealership.upsert': (d: Dealership) => void;
  'market.update': (d: { listings: MarketListing[] }) => void;
  'listings.changed': () => void;
  'auction.update': (a: Auction) => void;
  chat: (m: ChatMessage) => void;
  notify: (n: Notification) => void;
  offer: (o: CustomerOffer) => void;
  'offer.closed': (id: string) => void;
  trends: (t: CategoryTrends) => void;
  kicked: (reason: string) => void;
}

export interface ClientToServerEvents {
  input: (cmds: InputCmd[]) => void;
  rpc: (req: RpcRequest, ack: (res: RpcResponse) => void) => void;
}

// ----------------------------------------------------------------------------
// Shared validation helpers (the server re-validates everything)
// ----------------------------------------------------------------------------

export const NAME_RULES = { min: 3, max: 16, pattern: /^[A-Za-z0-9_\-]+$/ };
export const PASSWORD_RULES = { min: 6, max: 72 };
export const CHAT_MAX = 200;

export function validatePlayerName(name: unknown): string | null {
  if (typeof name !== 'string') return 'Name is required.';
  const n = name.trim();
  if (n.length < NAME_RULES.min || n.length > NAME_RULES.max) return `Name must be ${NAME_RULES.min}-${NAME_RULES.max} characters.`;
  if (!NAME_RULES.pattern.test(n)) return 'Name may only contain letters, numbers, _ and -.';
  return null;
}

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < PASSWORD_RULES.min || pw.length > PASSWORD_RULES.max)
    return `Password must be ${PASSWORD_RULES.min}-${PASSWORD_RULES.max} characters.`;
  return null;
}

/** Remove control characters and collapse whitespace. */
export function sanitizeText(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

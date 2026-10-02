// Core domain types shared by the client and the server.
// The server is authoritative for every value in here; the client only renders them.

import type { VehicleTuning } from './modificationsData';
import type { DragBotSnap } from './drag';
import type { RaceBotSnap } from './streetRace';
import type { TrafficSnap } from './traffic';
import type { PoliceSnap } from './police';
import type { HeliSnap, SpikeSnap } from './policeGear';

export type VehicleCategory =
  | 'compact'
  | 'sedan'
  | 'suv'
  | 'sports'
  | 'luxury'
  | 'truck'
  | 'classic'
  | 'utility'
  | 'moto';

export const VEHICLE_CATEGORIES: readonly VehicleCategory[] = [
  'compact',
  'sedan',
  'suv',
  'sports',
  'luxury',
  'truck',
  'classic',
  'utility',
  'moto',
];

/** Mechanical/cosmetic parts that can be repaired. */
export type RepairPart = 'engine' | 'transmission' | 'brakes' | 'tires' | 'body' | 'interior';
export const REPAIR_PARTS: readonly RepairPart[] = ['engine', 'transmission', 'brakes', 'tires', 'body', 'interior'];

/** All condition values are integers 0-100. */
export interface VehicleCondition {
  engine: number;
  transmission: number;
  brakes: number;
  tires: number;
  body: number;
  interior: number;
  cleanliness: number;
}

export interface VehicleMods {
  /** Customization paint id, or null to keep the factory colour. */
  paint: string | null;
  wheels: string;
  tint: string;
  bodyKit: string;
  headlights: string;
  accessory: string;
  /** Neon underglow kit (older vehicles have none). */
  underglow?: string;
  /** Performance parts, body parts, custom paint, wheels and stance (see modificationsData.ts). */
  tuning?: VehicleTuning;
  /** A stolen car up on a Sanayi lift and the parts taken off it (see shared/theft.ts). */
  strip?: StripState;
  /** Custom number plate text (shared/plates.ts); none = the car's own registration. */
  plate?: string;
  /** Air ride height 0-2 (with the Air Ride suspension, K while driving). */
  air?: number;
  /** Tyres burst on a police spike strip: on the rims until repaired at Wrench Bros. */
  blown?: boolean;
}

export interface StripState {
  /** Lift bay index (shared/theft.ts LIFT_BAYS). */
  bay: number;
  /** When it went up (epoch ms). */
  liftedAt: number;
  removed: string[];
}

/**
 * stored    - in the owner's garage (inventory), not in the 3D world
 * world     - spawned/parked in the world (can be driven by its owner)
 * displayed - parked on a dealership display slot (optionally for sale)
 * listed    - listed on the online classifieds
 * auction   - consigned to an active auction
 * market    - owned by an NPC seller at the used vehicle market
 * stolen    - broken into by the player: drivable, can only be stripped at the Sanayi (never sold whole)
 */
export type VehicleStatus = 'stored' | 'world' | 'displayed' | 'listed' | 'auction' | 'market' | 'stolen';

export interface Vehicle {
  id: string;
  modelId: string;
  ownerId: string | null;
  color: string;
  mileage: number;
  fuel: number;
  condition: VehicleCondition;
  mods: VehicleMods;
  status: VehicleStatus;
  /** What the current owner paid (private to the owner, 0 in public views). */
  purchasePrice: number;
  /** Asking price when for sale (dealership display or classifieds). */
  salePrice: number | null;
  plotId: string | null;
  slot: number | null;
  /** Parked / displayed yaw in radians. */
  rotation: number;
  x: number;
  z: number;
  /** Epoch ms. While in the future the vehicle is at the repair shop and cannot be used. */
  serviceUntil: number;
  createdAt: number;
}

/** A vehicle as other players see it (no private purchase price). */
export interface PublicVehicle extends Vehicle {
  ownerName: string | null;
}

export type SellerPersonalityId = 'friendly' | 'stubborn' | 'desperate' | 'shrewd' | 'collector';

export interface MarketListing {
  id: string;
  vehicle: Vehicle;
  askingPrice: number;
  sellerName: string;
  personality: SellerPersonalityId;
  /** Physical parking slot in the Used Vehicle Market lot. */
  lotSlot: number;
  expiresAt: number;
}

export interface PlayerListing {
  vehicle: PublicVehicle;
  price: number;
  sellerId: string;
  sellerName: string;
  location: 'dealership' | 'classifieds';
  plotId: string | null;
}

export type NegotiationStatus = 'open' | 'accepted' | 'rejected' | 'walked';

export interface NegotiationState {
  listingId: string;
  status: NegotiationStatus;
  round: number;
  askingPrice: number;
  /** Seller's latest counter offer (what the player may buy at right now). */
  counterOffer: number;
  lastOffer: number | null;
  /** 0-1: how much patience the seller has left. */
  patience: number;
  message: string;
  personality: SellerPersonalityId;
}

export interface Dealership {
  plotId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  level: number;
  createdAt: number;
}

export type AuctionStatus = 'active' | 'sold' | 'unsold';

export interface Auction {
  id: string;
  vehicle: PublicVehicle;
  sellerId: string | null;
  sellerName: string;
  startingBid: number;
  currentBid: number | null;
  currentBidderId: string | null;
  currentBidderName: string | null;
  bidCount: number;
  endsAt: number;
  status: AuctionStatus;
}

export interface PlayerStats {
  vehiclesBought: number;
  vehiclesSold: number;
  totalRevenue: number;
  totalProfit: number;
  spentOnRepairs: number;
  spentOnCustomization: number;
  auctionsWon: number;
  auctionsSold: number;
  customersServed: number;
  negotiationsWon: number;
  distanceDriven: number;
  bestFlipProfit: number;
}

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface PlayerSettings {
  masterVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  mouseSensitivity: number;
  invertY: boolean;
  graphics: GraphicsQuality;
  showNames: boolean;
}

export interface Appearance {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  /** Motorcycle helmet (shared/helmets.ts) worn on bikes and quads, its visor and paint. */
  helmet?: string | null;
  visor?: string | null;
  helmetColor?: string | null;
}

/** Public information about a player that everyone can see. */
export interface PlayerPublic {
  id: string;
  name: string;
  level: number;
  appearance: Appearance;
  dealershipPlotId: string | null;
  online: boolean;
}

/** Full private player state, only ever sent to the owning client. */
export interface PlayerPrivate {
  id: string;
  name: string;
  money: number;
  bank: number;
  xp: number;
  level: number;
  reputation: number;
  stats: PlayerStats;
  achievements: string[];
  settings: PlayerSettings;
  /** Parts inventory: itemId -> quantity. */
  inventory: Record<string, number>;
  appearance: Appearance;
  dealershipPlotId: string | null;
  createdAt: number;
}

export type TransactionKind =
  | 'papers'
  | 'market_buy'
  | 'player_buy'
  | 'player_sale'
  | 'customer_sale'
  | 'quick_sell'
  | 'repair'
  | 'wash'
  | 'fuel'
  | 'customize'
  | 'tuning'
  | 'rare_buy'
  | 'parts'
  | 'dealership_buy'
  | 'dealership_upgrade'
  | 'listing_fee'
  | 'auction_bid_hold'
  | 'auction_refund'
  | 'auction_win'
  | 'auction_sale'
  | 'bank_deposit'
  | 'bank_withdraw'
  | 'bank_interest'
  | 'achievement'
  | 'near_miss'
  | 'drag_entry'
  | 'drag_win'
  | 'drag_refund'
  | 'drive_bonus'
  | 'mission'
  | 'police_fine'
  | 'black_market'
  | 'pawn_sale'
  | 'reward'
  | 'race'
  | 'weapon'
  | 'hospital'
  | 'police_escape'
  | 'moto_gear'
  | 'hitman';

export interface Transaction {
  id: string;
  playerId: string;
  kind: TransactionKind;
  /** Signed change of cash money. */
  amount: number;
  vehicleId: string | null;
  counterpartyId: string | null;
  note: string;
  createdAt: number;
}

export type CategoryTrends = Record<VehicleCategory, number>;

export interface WorldInit {
  serverTime: number;
  tickRate: number;
  players: PlayerPublic[];
  vehicles: PublicVehicle[];
  dealerships: Dealership[];
  marketListings: MarketListing[];
  trends: CategoryTrends;
}

/** Animation states for characters. */
export const Anim = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  Drive: 3,
  Interact: 4,
  /** Down on the ground (shot). */
  Dead: 5,
  /** Gun up, aiming. */
  Aim: 6,
} as const;
export type AnimState = (typeof Anim)[keyof typeof Anim];

/** Compact snapshot tuples (bandwidth): [id, x, z, rot, anim, drivingVehicleId, ridingVehicleId, passenger seat, gun slot, bridge deck (on foot)] */
export type PlayerSnap = [string, number, number, number, number, string | null, (string | null)?, number?, number?, number?];
/**
 * [id, x, z, rot, speed, steer, rpm, gear, flags (VF), wheelie (rad, motorcycles with the front
 * up)?, bridge deck?] - only vehicles that are currently being driven.
 */
export type VehicleSnap = [string, number, number, number, number, number, number, number, number, number?, number?];
/** Flags of a driven vehicle in a snapshot. */
export const VF = {
  BRAKE: 1,
  REVERSE: 2,
  /** Tyres sliding (skid marks, smoke, screech). */
  SLIDE: 4,
  /** Big turbo boost (whistle). */
  BOOST: 8,
  HORN: 16,
  /** A nitrous shot is burning (blue exhaust flames). */
  NITRO: 32,
  /** Up on a bridge deck (VehicleSnap[10] says which). */
  DECK: 64,
} as const;
/** [id, x, z, rot, anim, appearanceStyle] - NPC customers */
export type NpcSnap = [string, number, number, number, number, number];
/**
 * Authoritative state of the receiving client: [x, z, rot, drivingVehicleId, vehicle state, ridingVehicleId,
 * passenger seat, bridge deck on foot]. The vehicle state is physics.DynTuple (see dynToTuple) while driving.
 */
export type SelfSnap = [number, number, number, string | null, number[] | null, (string | null)?, number?, number?];

export interface Snapshot {
  /** Server time (ms). */
  t: number;
  /** Last input sequence processed for the receiving player. */
  ack: number;
  p: PlayerSnap[];
  v: VehicleSnap[];
  n: NpcSnap[];
  self: SelfSnap | null;
  /** Highway traffic near the player (10 Hz close by, 2 Hz further out). */
  tr?: TrafficSnap[];
  /** Drag strip bot positions while a race is on (players near the strip). */
  dr?: { id: string; cars: DragBotSnap[] };
  /** Street race bots near the player. */
  sr?: { id: string; cars: RaceBotSnap[] };
  /** Police cars near the player. */
  po?: PoliceSnap[];
  /** Police spike strips near the player (shared/policeGear.ts). */
  sp?: SpikeSnap[];
  /** Police helicopters near the player. */
  ph?: HeliSnap[];
}

export interface CustomerOffer {
  id: string;
  vehicleId: string;
  customerName: string;
  amount: number;
  askingPrice: number;
  expiresAt: number;
  message: string;
}

export type ChatChannel = 'global' | 'nearby' | 'system';

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  fromId: string | null;
  fromName: string;
  text: string;
  at: number;
}

export type NotifyKind = 'info' | 'success' | 'warning' | 'error' | 'money' | 'achievement' | 'levelup';

export interface Notification {
  kind: NotifyKind;
  title: string;
  text: string;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  level: number;
  netWorth: number;
  vehiclesSold: number;
}

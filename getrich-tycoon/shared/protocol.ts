// Network protocol between browser clients and the game server.
// Everything the client asks for goes through a single validated `rpc` channel;
// high-frequency movement goes through `input`.

import type { DragInfo, DragRaceView } from './drag';
import type { MissionView } from './missions';
import type { BustedEvent, WantedState } from './police';
import type { InputCmd } from './physics';
import type { RareMarketState } from './rareMarket';
import type { ShowroomId, ShowroomInfo, TestDriveEnd, TestDriveView } from './showrooms';
import type { TollEvent } from './tolls';
import type { MegaChoice, RewardsView } from './rewards';
import type { PursuitOutcome, PursuitView } from './cctv';
import type { StreetRaceView } from './streetRace';
import type { ExplosionFx, HealthView, ShotFx, WeaponId } from './weapons';
import type { CrashEvent, HelmetId, VisorId } from './helmets';
import type { ContractView } from './hitman';
import type { HeistId, HeistView } from './heists';
import type { CrimeView } from './underworld';
import type { BusinessId } from './realestate';
import type { DealCar, DealScene, TgState } from './telegram';
import type { MechanicView, RepairCar, RepairTask } from './mechanic';
import type { BlackMarketInfo, LockDifficulty, StreetCar, StripPart } from './theft';
import type { TuningChange } from './tuningSystem';
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

/** A pass under a bridge speed radar. */
export interface RadarFlash {
  radar: string;
  bridge: string;
  kmh: number;
  best: number;
  newBest: boolean;
  record: { name: string; kmh: number } | null;
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
  /** Ride along as a passenger in a car someone else is driving. */
  'vehicle.ride': { params: { vehicleId: string }; result: { vehicleId: string; seat: number } };
  /** Fire a nitrous shot (one Special Nitro from the inventory) in the car being driven. */
  'vehicle.nitro': { params: Empty; result: { left: number; seconds: number } };
  /** Air ride: next height (or a given one) for the car being driven. */
  'vehicle.air': { params: { level?: number }; result: { level: number } };
  /** Press a custom number plate at Chroma Customs ('' puts the car's own registration back). */
  'vehicle.plate': { params: { vehicleId: string; text: string }; result: { plate: string | null } };

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
  /** Tuning garage: performance parts, body parts, paint, wheels, stance and classic options in one job. */
  'tuning.apply': {
    params: { vehicleId: string; change: TuningChange; legacy?: Partial<Pick<VehicleMods, 'tint' | 'headlights' | 'accessory' | 'underglow'>> };
    result: { vehicle: Vehicle; cost: number; seconds: number };
  };
  'rare.list': { params: Empty; result: RareMarketState };
  'rare.buy': { params: { offerId: string; expectedPrice: number }; result: { vehicle: Vehicle; price: number } };
  'parts.buy': { params: { itemId: string; qty: number }; result: { inventory: Record<string, number>; cost: number } };
  /** Drag strip: race a bot now, or wait for / accept another player. */
  'drag.info': { params: Empty; result: DragInfo };
  'drag.join': { params: { mode: 'bot' | 'player' }; result: DragInfo };
  'drag.leave': { params: Empty; result: DragInfo };
  /** Black Market: lockpick sets (shared stock, refilled every 10 minutes). */
  'blackmarket.info': { params: Empty; result: BlackMarketInfo };
  'blackmarket.buy': { params: Empty; result: BlackMarketInfo };
  /** Cars parked on the street / highway shoulder that can be broken into. */
  'street.list': { params: Empty; result: { cars: StreetCar[] } };
  /** Lockpick mini-game: start on a street car (uses a set), turn the pick at an angle (0-180). */
  'lockpick.start': { params: { carId: string }; result: { sessionId: string; picks: number; difficulty: LockDifficulty; modelId: string } };
  'lockpick.try': { params: { sessionId: string; angle: number }; result: LockpickResult };
  'lockpick.cancel': { params: { sessionId: string }; result: { ok: true } };
  /** Sanayi: put the stolen car you are driving up on the lift in this bay; strip a part. */
  'sanayi.lift': { params: { vehicleId: string }; result: { vehicle: Vehicle } };
  'sanayi.strip': { params: { vehicleId: string; part: StripPart }; result: StripResult };
  'ammu.buy': { params: { item: string }; result: { item: string; money: number } };
  'hospital.heal': { params: Empty; result: HealthView };
  'weapon.equip': { params: { weapon: WeaponId | null }; result: { weapon: WeaponId | null } };
  'combat.health': { params: Empty; result: HealthView };
  'hitman.take': { params: Empty; result: { contract: ContractView } };
  'hitman.info': { params: Empty; result: { contract: ContractView | null } };
  'hitman.drop': { params: Empty; result: { ok: true } };
  /** Heists: start one at the target's door (E), give it up; the dirty money. */
  'heist.start': { params: { heistId: HeistId }; result: HeistView };
  'heist.abort': { params: Empty; result: { ok: true } };
  'heist.status': { params: Empty; result: { heist: HeistView | null; alarms: HeistId[]; cooldowns: Partial<Record<HeistId, number>> } };
  'crime.info': { params: Empty; result: CrimeView };
  /** Emlak Dünyası: buy a business, pay dirty money into one to launder it. */
  'realestate.buy': { params: { businessId: BusinessId }; result: CrimeView };
  'realestate.deposit': { params: { businessId: BusinessId; amount: number }; result: CrimeView };
  /** Telegram (the phone): the chats and orders; order from the supplier; take, turn down or drop
   *  off a customer's order; get into a deal car (the cockpit handover). */
  'tg.state': { params: Empty; result: TgState };
  'tg.read': { params: Empty; result: TgState };
  'tg.order': { params: Empty; result: TgState };
  'tg.accept': { params: { orderId: string; mode: 'hand' | 'drop' }; result: TgState };
  'tg.decline': { params: { orderId: string }; result: TgState };
  'tg.drop': { params: { orderId: string }; result: TgState };
  'tg.enter': { params: { carId: string }; result: DealScene };
  /** The part-time mechanic at the Sanayi (shared/mechanic.ts). */
  'mech.start': { params: Empty; result: MechanicView };
  'mech.stop': { params: Empty; result: MechanicView };
  'mech.work': { params: { task: RepairTask }; result: MechanicView };
  'helmet.buy': { params: { kind: 'helmet' | 'visor'; id: string }; result: { appearance: Appearance } };
  'showroom.info': { params: { showroomId: ShowroomId }; result: ShowroomInfo };
  'showroom.buy': { params: { showroomId: ShowroomId; offerId: string; color?: string; expectedPrice: number }; result: { vehicle: Vehicle; price: number } };
  'showroom.testDrive': { params: { showroomId: ShowroomId; offerId: string; color?: string }; result: TestDriveView };
  'showroom.endTestDrive': { params: Empty; result: { ok: true } };
  'showroom.plateGear': { params: { vehicleId: string; item: 'flipper' | 'fake' }; result: { vehicle: Vehicle } };
  'vehicle.flipPlate': { params: Empty; result: { flipped: boolean } };
  'toll.history': { params: Empty; result: { events: TollEvent[] } };
  'helmet.wear': { params: { helmet: HelmetId | null; visor?: VisorId; color?: string }; result: { appearance: Appearance } };
  'race.info': { params: Empty; result: { race: StreetRaceView | null } };
  'race.join': { params: Empty; result: { race: StreetRaceView } };
  'race.leave': { params: Empty; result: { ok: true } };
  /** Forged papers: a stolen car in the Sanayi yard becomes the player's own. */
  'sanayi.papers': { params: { vehicleId: string }; result: { vehicle: Vehicle; price: number } };
  /** Pawn Shop: sell stripped parts (one kind, or all of them). */
  'pawn.sell': { params: { part?: StripPart }; result: { amount: number; count: number } };
  /** Today's missions (and start a timed one). */
  'missions.list': { params: Empty; result: { missions: MissionView[] } };
  /** Daily login streak and playtime milestones. */
  'rewards.info': { params: Empty; result: RewardsView };
  'rewards.daily': { params: Empty; result: { day: number; reward: string; view: RewardsView } };
  'rewards.playtime': { params: { minutes: number; choice?: MegaChoice }; result: { minutes: number; reward: string; view: RewardsView } };
  'missions.start': { params: { id: string }; result: { missions: MissionView[] } };

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
  /** Rare Dealer stock changed (new rotation or an offer was sold). */
  'rare.update': (s: RareMarketState) => void;
  /** A near miss paid out (combo count and multiplier included). */
  'highway.nearmiss': (d: NearMissEvent) => void;
  /** The near-miss combo ended. */
  'highway.combo': (d: { reason: 'crash' | 'expired'; count: number; earned: number }) => void;
  /** Drag strip race state (null when the strip is free). */
  'drag.update': (d: DragRaceView | null) => void;
  /** Passive income while driving (every 10 s, by the car's value). */
  'drive.bonus': (d: { amount: number; value: number }) => void;
  'missions.update': (d: { missions: MissionView[] }) => void;
  'rewards.update': (d: RewardsView) => void;
  /** Shots, blasts, car damage, health and WASTED. */
  'combat.shot': (d: ShotFx) => void;
  'combat.explosion': (d: ExplosionFx) => void;
  /** A motorcycle or quad went down: sparks, and who came off. */
  'moto.crash': (d: CrashEvent) => void;
  /** The hitman contract changed (null: none). */
  'hitman.update': (d: ContractView | null) => void;
  'hitman.done': (d: { title: string; reward: number; xp: number }) => void;
  /** Your heist (null: none). */
  'heist.update': (d: HeistView | null) => void;
  /** A target's alarm went on or off (everyone sees the lights). */
  'heist.alarm': (d: { id: HeistId; on: boolean }) => void;
  /** The job is done: the loot is in the bag (lose the police to keep it). */
  'heist.done': (d: { id: HeistId; title: string; loot: number }) => void;
  /** The loot is yours (dirty money), taken by the police, or lost; or the job fell through. */
  'heist.cashed': (d: { id: HeistId; amount: number; xp: number }) => void;
  'heist.lost': (d: { id: HeistId; amount: number; reason: 'busted' | 'wasted' | 'failed'; text: string }) => void;
  /** Your dirty money and heist record. */
  'crime.update': (d: CrimeView) => void;
  /** Telegram: your phone changed (a message, an order...). */
  'tg.update': (d: TgState) => void;
  /** The deal cars parked around the city (supplier's and customers'). */
  'deal.cars': (d: DealCar[]) => void;
  /** A handover is over: bought, sold, or the customer was a cop. */
  'deal.done': (d: { kind: 'buy' | 'sell'; cop: boolean; grams: number; money: number }) => void;
  /** A dead drop was collected and paid (dirty money). */
  'deal.paid': (d: { amount: number; name: string }) => void;
  /** The customers' cars up on the Sanayi lifts (everyone sees them). */
  'mech.cars': (d: RepairCar[]) => void;
  /** Your shift as a mechanic. */
  'mech.update': (d: MechanicView) => void;
  /** A car repaired: the customer paid. */
  'mech.paid': (d: { amount: number; owner: string; modelId: string }) => void;
  /** Your businesses turned dirty money into clean cash. */
  'crime.laundered': (d: { amount: number }) => void;
  /** Tyres burst on a spike strip. */
  'police.spiked': (d: { vehicleId: string; x: number; z: number }) => void;
  /** Under a bridge speed radar: the speed, your best, whether it is a new best, the server record. */
  'radar.flash': (d: RadarFlash) => void;
  /** A test drive started or is in progress (null: none). */
  'testdrive.update': (d: TestDriveView | null) => void;
  /** The test drive is over: the car went back to the showroom (and any damage bill). */
  'testdrive.end': (d: { reason: TestDriveEnd; modelId: string; fee: number }) => void;
  /** A line for the toll / fine / camera history (also shown as it happens). */
  'toll.event': (e: TollEvent) => void;
  /** A car went through a toll plaza's barrier (the arm lifts, or breaks when evaded). */
  'toll.pass': (d: { n: number; z: number; evaded: boolean }) => void;
  /** A number-plate camera flashed on a flagged car. */
  'anpr.flash': (d: { id: string }) => void;
  /** A police checkpoint is set up at a bridge's far end for you (until: epoch ms). */
  'police.checkpoint': (d: { n: number; name: string; x: number; z: number; dir: 1 | -1; until: number }) => void;
  /** You got through a checkpoint (the reward goes to the driver). */
  'police.breakthrough': (d: { reward: number; name: string }) => void;
  /** A checkpoint car was rammed aside. */
  'police.ram': (d: { x: number; z: number; deck: number }) => void;
  /** A police car hit the bollards at the end of a back alley. */
  'police.crash': (d: { x: number; z: number; kmh: number }) => void;
  /** A showroom's stock changed (the Black Market restocked or sold a car). */
  'showroom.update': (d: ShowroomInfo) => void;
  'combat.carHp': (d: { id: string; hp: number }) => void;
  'combat.health': (d: HealthView) => void;
  'combat.wasted': (d: { lost: string[]; respawnInMs: number }) => void;
  /** The street race (null: none open). */
  'race.update': (d: StreetRaceView | null) => void;
  'race.checkpoint': (d: { next: number; of: number }) => void;
  /** Police tracking of a stolen car (null: none). */
  'pursuit.update': (d: PursuitView | null) => void;
  'pursuit.result': (d: { outcome: PursuitOutcome; vehicleId: string; modelId: string }) => void;
  /** A mission was completed (the reward is already paid). */
  'missions.complete': (d: { id: string; title: string; reward: string }) => void;
  'police.wanted': (d: WantedState) => void;
  'police.busted': (d: BustedEvent) => void;
  'police.escaped': (d: { reward: number; xp: number; cars: number }) => void;
  /** Street-parked cars changed (one was stolen, a new one parked, an alarm started). */
  'street.cars': (cars: StreetCar[]) => void;
  /** A car alarm went off nearby. */
  'car.alarm': (d: { carId: string; x: number; z: number; until: number }) => void;
  /** Black Market stock changed. */
  'blackmarket.update': (d: Omit<BlackMarketInfo, 'owned'>) => void;
  kicked: (reason: string) => void;
}

export interface LockpickResult {
  /** How far the cylinder turned (0-1); 1 = open. */
  turn: number;
  opened: boolean;
  /** Picks left in the set. */
  picksLeft: number;
  /** All picks snapped: the set is gone, the alarm sounds, police are coming. */
  failed: boolean;
  /** Missed: which way the sweet spot is (+1 a bigger angle, to the right) and how far (band, see hintBands). */
  dir: -1 | 0 | 1;
  band: number;
  /** The stolen car (now yours to drive) when opened. */
  vehicleId: string | null;
}

export interface StripResult {
  /** False on the first call: work started, call again at readyAt to finish. */
  done: boolean;
  readyAt: number;
  /** The car after the part came off (null when it was the last part and the shell was scrapped). */
  vehicle: Vehicle | null;
  scrapped: boolean;
}

export interface NearMissEvent {
  /** Cash for this near miss (after the multiplier; 0 when the hourly cap is reached). */
  amount: number;
  xp: number;
  mult: number;
  /** Near misses in the current combo. */
  combo: number;
  /** Cash and XP earned in this combo so far. */
  comboMoney: number;
  comboXp: number;
  /** Gap to the other vehicle (m). */
  gap: number;
  kind: string;
  capped: boolean;
  /** Hair's-breadth pass (bonus applied). */
  close?: boolean;
}

export interface ClientToServerEvents {
  input: (cmds: InputCmd[]) => void;
  /** A shot: [weapon, muzzle x, y, z, yaw, pitch, shot number]. */
  fire: (shot: unknown[]) => void;
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

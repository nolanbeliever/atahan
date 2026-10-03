// Authoritative in-memory game state + write-through persistence.
//
// All economic mutations go through a UnitOfWork:
//   1. drafts are cloned from live records (under the caller's KeyedMutex locks)
//   2. drafts are validated/mutated by the service
//   3. commit() writes every draft in ONE database transaction
//   4. only after the DB commit succeeds are drafts applied to live memory
// If the database write fails nothing changes in memory, so memory and the
// database can never disagree about money or ownership.

import { ECONOMY, dealershipLevel } from '../../shared/economy.config';
import { levelFromXp, ACHIEVEMENTS } from '../../shared/progression';
import type {
  CategoryTrends,
  Dealership,
  Notification,
  PublicVehicle,
  Transaction,
  TransactionKind,
  Vehicle,
} from '../../shared/types';
import { marketValue, neutralTrends } from '../../shared/valuation';
import type { Database } from '../db';
import * as repo from '../db/repo';
import { GameError } from '../errors';
import { newId } from '../ids';
import { createLogger } from '../logger';
import type { AuctionRecord, DealershipRecord, ListingRecord, NoticeRecord, PlayerRecord } from './records';

const log = createLogger('state');

export interface VehicleChange {
  id: string;
  before: Vehicle | null;
  after: Vehicle | null;
}

export interface CommitResult {
  players: Set<string>;
  publicPlayers: Set<string>;
  vehicles: VehicleChange[];
  dealerships: DealershipRecord[];
  listingsChanged: boolean;
  auctions: AuctionRecord[];
  playerListingsChanged: boolean;
  notifications: { playerId: string; n: Notification }[];
  /** Money movements in this commit (missions listen for sales, drag wins...). */
  transactions: Transaction[];
}

export function isPublicVehicle(v: Vehicle | null | undefined): boolean {
  return !!v && (v.status === 'world' || v.status === 'displayed' || v.status === 'stolen' || v.status === 'testdrive');
}

export function isPlayerListing(v: Vehicle | null | undefined): boolean {
  return !!v && v.salePrice !== null && (v.status === 'listed' || v.status === 'displayed');
}

export class GameState {
  readonly players = new Map<string, PlayerRecord>();
  readonly playersByName = new Map<string, PlayerRecord>();
  readonly vehicles = new Map<string, Vehicle>();
  readonly ownerIndex = new Map<string, Set<string>>();
  readonly dealerships = new Map<string, DealershipRecord>();
  readonly listings = new Map<string, ListingRecord>();
  readonly auctions = new Map<string, AuctionRecord>();
  trends: CategoryTrends = neutralTrends();
  onCommit: (r: CommitResult) => void = () => {};

  constructor(readonly db: Database) {}

  async load(): Promise<void> {
    const data = await repo.loadAll(this.db);
    for (const p of data.players) {
      this.players.set(p.id, p);
      this.playersByName.set(p.nameLower, p);
    }
    for (const v of data.vehicles) this.putVehicle(v);
    for (const d of data.dealerships) {
      const owner = this.players.get(d.ownerId);
      this.dealerships.set(d.plotId, { ...d, ownerName: owner?.name ?? 'Unknown' });
      if (owner) owner.dealershipPlotId = d.plotId;
    }
    for (const l of data.listings) this.listings.set(l.id, l);
    for (const a of data.auctions) this.auctions.set(a.id, a);
    const trends = await repo.getWorldValue(this.db, 'trends');
    if (trends) {
      try {
        this.trends = { ...neutralTrends(), ...(JSON.parse(trends) as CategoryTrends) };
      } catch {
        /* keep neutral */
      }
    }
    // Vehicles that were being driven when the server stopped stay parked where they were.
    log.info('state loaded', {
      players: this.players.size,
      vehicles: this.vehicles.size,
      dealerships: this.dealerships.size,
      listings: this.listings.size,
      auctions: this.auctions.size,
    });
  }

  private putVehicle(v: Vehicle): void {
    const prev = this.vehicles.get(v.id);
    if (prev?.ownerId && prev.ownerId !== v.ownerId) this.ownerIndex.get(prev.ownerId)?.delete(v.id);
    this.vehicles.set(v.id, v);
    if (v.ownerId) {
      let set = this.ownerIndex.get(v.ownerId);
      if (!set) this.ownerIndex.set(v.ownerId, (set = new Set()));
      set.add(v.id);
    }
  }

  private removeVehicle(id: string): void {
    const prev = this.vehicles.get(id);
    if (prev?.ownerId) this.ownerIndex.get(prev.ownerId)?.delete(id);
    this.vehicles.delete(id);
  }

  vehiclesOf(ownerId: string): Vehicle[] {
    const ids = this.ownerIndex.get(ownerId);
    if (!ids) return [];
    const out: Vehicle[] = [];
    for (const id of ids) {
      const v = this.vehicles.get(id);
      if (v && v.ownerId === ownerId) out.push(v);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  dealershipOf(playerId: string): DealershipRecord | undefined {
    const p = this.players.get(playerId);
    return p?.dealershipPlotId ? this.dealerships.get(p.dealershipPlotId) : undefined;
  }

  toPublicVehicle(v: Vehicle): PublicVehicle {
    // A hidden compartment stays hidden: only the owner knows about it.
    const { stash: _stash, stashGrams: _grams, ...mods } = v.mods;
    return { ...v, mods, purchasePrice: 0, ownerName: v.ownerId ? this.players.get(v.ownerId)?.name ?? null : null };
  }

  netWorth(playerId: string): number {
    const p = this.players.get(playerId);
    if (!p) return 0;
    let worth = p.money + p.bank;
    for (const v of this.vehiclesOf(playerId)) if (v.status !== 'stolen' && v.status !== 'testdrive') worth += marketValue(v, this.trends);
    const d = this.dealershipOf(playerId);
    if (d) for (let l = 1; l <= d.level; l++) worth += Math.round(dealershipLevel(l).price * 0.6);
    // Money held in auction bids still belongs to the bidder.
    for (const a of this.auctions.values()) if (a.status === 'active' && a.currentBidderId === playerId) worth += a.currentBid ?? 0;
    return worth;
  }

  begin(): UnitOfWork {
    return new UnitOfWork(this);
  }

  /** Internal: apply a successful commit to memory. */
  apply(uow: UnitOfWork): CommitResult {
    const result: CommitResult = {
      players: new Set(),
      publicPlayers: new Set(),
      vehicles: [],
      dealerships: [],
      listingsChanged: false,
      auctions: [],
      playerListingsChanged: false,
      notifications: uow.notifications,
      transactions: uow.transactions,
    };
    for (const [id, draft] of uow.playerDrafts) {
      const live = this.players.get(id);
      if (!live) continue;
      if (
        live.name !== draft.name ||
        live.level !== draft.level ||
        JSON.stringify(live.appearance) !== JSON.stringify(draft.appearance) ||
        live.dealershipPlotId !== draft.dealershipPlotId
      )
        result.publicPlayers.add(id);
      Object.assign(live, draft);
      result.players.add(id);
    }
    for (const [id, draft] of uow.vehicleDrafts) {
      const before = this.vehicles.get(id) ?? null;
      const beforeCopy = before ? { ...before } : null;
      if (draft === null) this.removeVehicle(id);
      else if (before) {
        // Drop the previous owner's index entry before the owner field is overwritten.
        if (before.ownerId && before.ownerId !== draft.ownerId) this.ownerIndex.get(before.ownerId)?.delete(id);
        Object.assign(before, draft);
        this.putVehicle(before);
      } else this.putVehicle(draft);
      const after = draft === null ? null : this.vehicles.get(id)!;
      result.vehicles.push({ id, before: beforeCopy, after });
      if (beforeCopy?.ownerId) result.players.add(beforeCopy.ownerId);
      if (after?.ownerId) result.players.add(after.ownerId);
      if (isPlayerListing(beforeCopy) || isPlayerListing(after)) result.playerListingsChanged = true;
    }
    for (const [plotId, d] of uow.dealershipDrafts) {
      this.dealerships.set(plotId, d);
      const owner = this.players.get(d.ownerId);
      if (owner) owner.dealershipPlotId = plotId;
      result.dealerships.push(d);
      result.publicPlayers.add(d.ownerId);
    }
    for (const [id, l] of uow.listingDrafts) {
      if (l === null) this.listings.delete(id);
      else this.listings.set(id, l);
      result.listingsChanged = true;
    }
    for (const [id, a] of uow.auctionDrafts) {
      if (a.status === 'active') this.auctions.set(id, a);
      else this.auctions.delete(id);
      result.auctions.push(a);
    }
    if (uow.newTrends) this.trends = uow.newTrends;
    return result;
  }
}

export class UnitOfWork {
  readonly playerDrafts = new Map<string, PlayerRecord>();
  readonly vehicleDrafts = new Map<string, Vehicle | null>();
  readonly dealershipDrafts = new Map<string, DealershipRecord>();
  readonly listingDrafts = new Map<string, ListingRecord | null>();
  readonly auctionDrafts = new Map<string, AuctionRecord>();
  readonly transactions: Transaction[] = [];
  readonly notices: NoticeRecord[] = [];
  readonly notifications: { playerId: string; n: Notification }[] = [];
  readonly worldValues = new Map<string, string>();
  /** Reward state documents written in the same transaction (player id -> state). */
  readonly rewardWrites = new Map<string, unknown>();
  readonly crimeWrites = new Map<string, unknown>();
  newTrends: CategoryTrends | null = null;
  private committed = false;
  readonly now = Date.now();

  constructor(private readonly state: GameState) {}

  player(id: string): PlayerRecord {
    let d = this.playerDrafts.get(id);
    if (!d) {
      const live = this.state.players.get(id);
      if (!live) throw new GameError('not_found', 'Player not found.');
      d = structuredClone(live);
      this.playerDrafts.set(id, d);
    }
    return d;
  }

  vehicle(id: string): Vehicle {
    const existing = this.vehicleDrafts.get(id);
    if (existing === null) throw new GameError('not_found', 'Vehicle not found.');
    if (existing) return existing;
    const live = this.state.vehicles.get(id);
    if (!live) throw new GameError('not_found', 'Vehicle not found.');
    const d = structuredClone(live);
    this.vehicleDrafts.set(id, d);
    return d;
  }

  createVehicle(v: Vehicle): Vehicle {
    if (this.state.vehicles.has(v.id) || this.vehicleDrafts.has(v.id)) throw new GameError('conflict', 'Duplicate vehicle.');
    this.vehicleDrafts.set(v.id, v);
    return v;
  }

  deleteVehicle(id: string): void {
    this.vehicleDrafts.set(id, null);
  }

  setDealership(d: DealershipRecord): void {
    this.dealershipDrafts.set(d.plotId, d);
  }

  dealership(plotId: string): DealershipRecord {
    let d = this.dealershipDrafts.get(plotId);
    if (!d) {
      const live = this.state.dealerships.get(plotId);
      if (!live) throw new GameError('not_found', 'Dealership not found.');
      d = { ...live };
      this.dealershipDrafts.set(plotId, d);
    }
    return d;
  }

  createListing(l: ListingRecord): void {
    this.listingDrafts.set(l.id, l);
  }

  deleteListing(id: string): void {
    this.listingDrafts.set(id, null);
  }

  auction(id: string): AuctionRecord {
    let a = this.auctionDrafts.get(id);
    if (!a) {
      const live = this.state.auctions.get(id);
      if (!live) throw new GameError('not_found', 'Auction not found.');
      a = { ...live };
      this.auctionDrafts.set(id, a);
    }
    return a;
  }

  createAuction(a: AuctionRecord): void {
    this.auctionDrafts.set(a.id, a);
  }

  /** Persist a small piece of world state (JSON string) with this unit of work. */
  setWorldValue(key: string, value: string): void {
    this.worldValues.set(key, value);
  }

  /** Save a player's reward state with this transaction (a claim and its payout are one write). */
  setRewardState(playerId: string, state: unknown): void {
    this.rewardWrites.set(playerId, structuredClone(state));
  }

  /** Save a player's underworld state (dirty money) with this transaction. */
  setCrimeState(playerId: string, state: unknown): void {
    this.crimeWrites.set(playerId, structuredClone(state));
  }

  setTrends(t: CategoryTrends): void {
    this.newTrends = t;
    this.worldValues.set('trends', JSON.stringify(t));
  }

  notify(playerId: string, n: Notification, persistIfOffline = false, isOnline?: (id: string) => boolean): void {
    this.notifications.push({ playerId, n });
    if (persistIfOffline && isOnline && !isOnline(playerId)) {
      this.notices.push({ id: newId('ntc'), playerId, kind: n.kind, title: n.title, text: n.text, createdAt: this.now });
    }
  }

  // ------------------------------------------------------------ money helpers

  private record(playerId: string, kind: TransactionKind, amount: number, note: string, vehicleId: string | null, counterpartyId: string | null) {
    this.transactions.push({ id: newId('tx'), playerId, kind, amount, vehicleId, counterpartyId, note, createdAt: this.now });
  }

  debit(p: PlayerRecord, amount: number, kind: TransactionKind, note: string, vehicleId: string | null = null, counterpartyId: string | null = null): void {
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) throw new GameError('bad_request', 'Invalid amount.');
    if (p.money < amount) throw new GameError('insufficient_funds', `You need ${fmt(amount)} but only have ${fmt(p.money)} in cash.`);
    p.money -= amount;
    this.record(p.id, kind, -amount, note, vehicleId, counterpartyId);
  }

  credit(p: PlayerRecord, amount: number, kind: TransactionKind, note: string, vehicleId: string | null = null, counterpartyId: string | null = null): void {
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) throw new GameError('bad_request', 'Invalid amount.');
    p.money = Math.min(ECONOMY.player.maxMoney, p.money + amount);
    this.record(p.id, kind, amount, note, vehicleId, counterpartyId);
  }

  /** Log a non-cash transaction (e.g. bank transfers). */
  log(p: PlayerRecord, kind: TransactionKind, amount: number, note: string): void {
    this.record(p.id, kind, amount, note, null, null);
  }

  grantXp(p: PlayerRecord, amount: number): void {
    if (amount <= 0) return;
    const before = p.level;
    p.xp += Math.round(amount);
    p.level = levelFromXp(p.xp);
    if (p.level > before) {
      this.notify(p.id, { kind: 'levelup', title: `Level ${p.level}!`, text: 'New vehicles and upgrades may now be available.' });
    }
  }

  adjustReputation(p: PlayerRecord, delta: number): void {
    const r = ECONOMY.reputation;
    p.reputation = Math.max(r.min, Math.min(r.max, p.reputation + delta));
  }

  /** Net worth as it will be after this unit of work commits (drafts override live state). */
  private draftNetWorth(p: PlayerRecord, dealershipLevelNow: number): number {
    const trends = this.newTrends ?? this.state.trends;
    let worth = p.money + p.bank;
    const seen = new Set<string>();
    for (const v of this.state.vehiclesOf(p.id)) {
      seen.add(v.id);
      const d = this.vehicleDrafts.has(v.id) ? this.vehicleDrafts.get(v.id)! : v;
      if (d && d.ownerId === p.id) worth += marketValue(d, trends);
    }
    for (const [id, d] of this.vehicleDrafts) if (!seen.has(id) && d && d.ownerId === p.id) worth += marketValue(d, trends);
    for (let l = 1; l <= dealershipLevelNow; l++) worth += Math.round(dealershipLevel(l).price * 0.6);
    const auctionIds = new Set([...this.state.auctions.keys(), ...this.auctionDrafts.keys()]);
    for (const id of auctionIds) {
      const a = this.auctionDrafts.get(id) ?? this.state.auctions.get(id);
      if (a && a.status === 'active' && a.currentBidderId === p.id) worth += a.currentBid ?? 0;
    }
    return worth;
  }

  /** Check & award achievements for a player draft (call last, before commit). */
  checkAchievements(p: PlayerRecord): void {
    const dealership = this.dealershipDrafts.get(p.dealershipPlotId ?? '') ?? this.state.dealershipOf(p.id);
    const level = dealership?.level ?? 0;
    const ctx = {
      stats: p.stats,
      netWorth: this.draftNetWorth(p, level),
      dealershipLevel: level,
    };
    for (const a of ACHIEVEMENTS) {
      if (p.achievements.includes(a.id)) continue;
      if (!a.check(ctx)) continue;
      p.achievements.push(a.id);
      if (a.reward > 0) this.credit(p, a.reward, 'achievement', `Achievement reward: ${a.title}`);
      this.notify(p.id, { kind: 'achievement', title: `Achievement: ${a.title}`, text: `${a.description} Reward: ${fmt(a.reward)}` });
    }
  }

  // ------------------------------------------------------------ commit

  async commit(): Promise<CommitResult> {
    if (this.committed) throw new Error('UnitOfWork already committed');
    this.committed = true;
    // Final invariant checks - never persist negative balances or duplicate slots.
    for (const p of this.playerDrafts.values()) {
      if (p.money < 0 || p.bank < 0 || !Number.isFinite(p.money) || !Number.isFinite(p.bank)) {
        throw new GameError('insufficient_funds', 'Insufficient funds.');
      }
    }
    const now = this.now;
    const db = this.state.db;
    const vehicleWrites: Vehicle[] = [];
    const vehicleDeletes: string[] = [];
    for (const [id, v] of this.vehicleDrafts) {
      if (v === null) vehicleDeletes.push(id);
      else vehicleWrites.push(v);
    }
    await db.tx(async (q) => {
      for (const d of this.dealershipDrafts.values()) await repo.upsertDealership(q, d);
      for (const p of this.playerDrafts.values()) await repo.updatePlayer(q, p);
      // Free display slots before occupying them (unique plot/slot index).
      const sorted = [...vehicleWrites].sort((a, b) => (a.plotId ? 1 : 0) - (b.plotId ? 1 : 0));
      for (const [id, l] of this.listingDrafts) if (l === null) await repo.deleteListing(q, id);
      for (const v of sorted) await repo.upsertVehicle(q, v, now);
      for (const [, l] of this.listingDrafts) if (l !== null) await repo.insertListing(q, l);
      for (const a of this.auctionDrafts.values()) await repo.upsertAuction(q, a);
      for (const id of vehicleDeletes) await repo.deleteVehicle(q, id);
      for (const t of this.transactions) await repo.insertTransaction(q, t);
      for (const n of this.notices) await repo.insertNotice(q, n);
      for (const [k, v] of this.worldValues) await repo.setWorldValue(q, k, v);
      for (const [pid, data] of this.rewardWrites) await repo.saveRewards(q, pid, data, now);
      for (const [pid, data] of this.crimeWrites) await repo.saveCrime(q, pid, data, now);
    });
    const result = this.state.apply(this);
    this.state.onCommit(result);
    return result;
  }
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export type { Dealership };

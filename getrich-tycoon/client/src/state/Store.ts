// Client-side mirror of the authoritative server state.

import type { PrivateState } from '../../../shared/protocol';
import type { RareMarketState } from '../../../shared/rareMarket';
import type {
  CategoryTrends,
  CustomerOffer,
  Dealership,
  MarketListing,
  PlayerPublic,
  PublicVehicle,
  Vehicle,
  WorldInit,
} from '../../../shared/types';
import { neutralTrends } from '../../../shared/valuation';
import { Emitter } from './Emitter';

export interface StoreEvents extends Record<string, unknown> {
  self: PrivateState;
  players: void;
  vehicles: void;
  vehicle: PublicVehicle;
  vehicleRemoved: string;
  dealerships: Dealership | null;
  market: MarketListing[];
  trends: CategoryTrends;
  listingsChanged: void;
  offers: void;
  rare: RareMarketState;
}

export class Store extends Emitter<StoreEvents> {
  playerId = '';
  self: PrivateState | null = null;
  players = new Map<string, PlayerPublic>();
  vehicles = new Map<string, PublicVehicle>();
  dealerships = new Map<string, Dealership>();
  marketListings: MarketListing[] = [];
  trends: CategoryTrends = neutralTrends();
  offers = new Map<string, CustomerOffer>();
  /** Rare Dealer stock (null until fetched). */
  rare: RareMarketState | null = null;
  /** Server clock minus local clock (ms), learned from Rare Dealer updates. */
  clockOffset = 0;

  applyWelcome(playerId: string, self: PrivateState, world: WorldInit): void {
    this.playerId = playerId;
    this.self = self;
    this.players = new Map(world.players.map((p) => [p.id, p]));
    this.vehicles = new Map(world.vehicles.map((v) => [v.id, v]));
    this.dealerships = new Map(world.dealerships.map((d) => [d.plotId, d]));
    this.marketListings = world.marketListings;
    this.trends = world.trends;
    this.emit('self', self);
    this.emit('players', undefined);
    this.emit('vehicles', undefined);
    this.emit('dealerships', null);
    this.emit('market', this.marketListings);
    this.emit('trends', this.trends);
  }

  applySelf(s: PrivateState): void {
    this.self = s;
    this.emit('self', s);
  }

  upsertPlayer(p: PlayerPublic): void {
    this.players.set(p.id, p);
    this.emit('players', undefined);
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.emit('players', undefined);
  }

  upsertVehicle(v: PublicVehicle): void {
    this.vehicles.set(v.id, v);
    this.emit('vehicle', v);
  }

  removeVehicle(id: string): void {
    this.vehicles.delete(id);
    this.emit('vehicleRemoved', id);
  }

  upsertDealership(d: Dealership): void {
    this.dealerships.set(d.plotId, d);
    this.emit('dealerships', d);
  }

  setMarket(listings: MarketListing[]): void {
    this.marketListings = listings;
    this.emit('market', listings);
  }

  setTrends(t: CategoryTrends): void {
    this.trends = t;
    this.emit('trends', t);
  }

  setRare(s: RareMarketState): void {
    this.clockOffset = s.serverTime - Date.now();
    this.rare = s;
    this.emit('rare', s);
  }

  /** Best estimate of the server clock (ms). */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  // ---------------------------------------------------------------- helpers

  get me() {
    return this.self?.player ?? null;
  }

  myVehicles(): Vehicle[] {
    return this.self?.vehicles ?? [];
  }

  myVehicle(id: string): Vehicle | undefined {
    return this.self?.vehicles.find((v) => v.id === id);
  }

  myDealership(): Dealership | undefined {
    const plotId = this.self?.player.dealershipPlotId;
    return plotId ? this.dealerships.get(plotId) : undefined;
  }

  playerName(id: string | null): string {
    if (!id) return 'Unknown';
    if (id === this.playerId) return this.self?.player.name ?? 'You';
    return this.players.get(id)?.name ?? 'Unknown';
  }
}

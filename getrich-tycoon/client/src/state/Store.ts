// Client-side mirror of the authoritative server state.

import type { PrivateState } from '../../../shared/protocol';
import type { RareMarketState } from '../../../shared/rareMarket';
import { LOCKPICK_ITEM, type BlackMarketInfo, type StreetCar } from '../../../shared/theft';
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
  street: StreetCar[];
  blackMarket: BlackMarketInfo;
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
  /** Cars parked on the street / highway shoulder that can be broken into. */
  street = new Map<string, StreetCar>();
  /** Black Market lockpick stock (null until fetched). */
  blackMarket: BlackMarketInfo | null = null;
  /** Server clock minus local clock (ms), learned from the welcome and Rare Dealer updates. */
  clockOffset = 0;

  applyWelcome(playerId: string, self: PrivateState, world: WorldInit): void {
    this.playerId = playerId;
    this.clockOffset = world.serverTime - Date.now();
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

  setStreet(cars: StreetCar[]): void {
    this.street = new Map(cars.map((c) => [c.id, c]));
    this.emit('street', cars);
  }

  /** Black Market stock (the owned count comes from our own inventory). */
  setBlackMarket(info: Omit<BlackMarketInfo, 'owned'> & { owned?: number }): void {
    this.blackMarket = { ...info, owned: info.owned ?? this.lockpicks() };
    this.emit('blackMarket', this.blackMarket);
  }

  /** Lockpick & saw sets in the inventory. */
  lockpicks(): number {
    return this.self?.player.inventory[LOCKPICK_ITEM] ?? 0;
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

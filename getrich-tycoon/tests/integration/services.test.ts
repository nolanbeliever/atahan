// Dealership, NPC customers, garage services, bank and auctions.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MODS } from '../../shared/customization';
import { ECONOMY } from '../../shared/economy.config';
import { isCategoryUnlocked } from '../../shared/progression';
import { fuelCost, marketValue, quickSellPrice, repairQuote } from '../../shared/valuation';
import { getModel } from '../../shared/vehicles';
import { INTERACTABLES, PLOTS, plotEntrance } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setLevel, setMoney, sleep, startServer, TestClient } from '../helpers/server';

let server: RunningServer;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

function goTo(client: TestClient, kind: string) {
  const i = INTERACTABLES.find((x) => x.kind === kind)!;
  server.game.sim.teleport(client.playerId, i.x, i.z);
}

async function buyCheapest(client: TestClient) {
  const { listings } = await client.rpc('market.list', {});
  const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  return (await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice })).vehicle;
}

describe('dealership', () => {
  it('buys a plot, upgrades, places a vehicle for sale and an NPC customer buys it', async () => {
    const { client } = await connectNew(server);
    const observer = await connectNew(server);
    const plot = PLOTS.find((p) => !server.game.state.dealerships.has(p.id))!;
    // Too far away
    const far = await client.rpcRaw('dealership.buy', { plotId: plot.id, name: 'Far Motors' });
    expect(far).toMatchObject({ ok: false, code: 'too_far' });
    const e = plotEntrance(plot);
    server.game.sim.teleport(client.playerId, e.x, e.z);
    const bad = await client.rpcRaw('dealership.buy', { plotId: plot.id, name: '<script>' });
    expect(bad.ok).toBe(false);
    const { dealership } = await client.rpc('dealership.buy', { plotId: plot.id, name: 'Test Motors' });
    expect(dealership.level).toBe(1);
    await observer.client.waitFor<{ plotId: string }>('dealership.upsert', (d) => d.plotId === plot.id);
    // Second plot is not allowed
    const other = PLOTS.find((p) => p.id !== plot.id && !server.game.state.dealerships.has(p.id))!;
    const o = plotEntrance(other);
    server.game.sim.teleport(client.playerId, o.x, o.z);
    expect((await client.rpcRaw('dealership.buy', { plotId: other.id, name: 'Second' })).ok).toBe(false);
    server.game.sim.teleport(client.playerId, e.x, e.z);

    // Upgrade requires player level 3
    await setMoney(server, client.playerId, 200_000);
    expect(await client.rpcRaw('dealership.upgrade', {})).toMatchObject({ ok: false, code: 'forbidden' });
    await setLevel(server, client.playerId, 3);
    const up = await client.rpc('dealership.upgrade', {});
    expect(up.dealership.level).toBe(2);

    const vehicle = await buyCheapest(client);
    {
      const uow = server.game.state.begin();
      const v = uow.vehicle(vehicle.id);
      v.mileage = 20_000;
      for (const k of ['engine', 'transmission', 'brakes', 'tires', 'body', 'interior', 'cleanliness'] as const) v.condition[k] = 90;
      await uow.commit();
    }
    // Occupied/invalid slots are rejected; prices below the wholesale floor are rejected.
    expect((await client.rpcRaw('dealership.place', { vehicleId: vehicle.id, slot: 11, price: 5000, rotation: 0 })).ok).toBe(false);
    expect((await client.rpcRaw('dealership.place', { vehicleId: vehicle.id, slot: 0, price: 100, rotation: 0 })).ok).toBe(false);
    const cheap = quickSellPrice(server.game.state.vehicles.get(vehicle.id)!, server.game.state.trends) + 1;
    await client.rpc('dealership.place', { vehicleId: vehicle.id, slot: 0, price: cheap, rotation: 0.5 });
    const seen = await observer.client.waitFor<{ id: string; status: string; salePrice: number }>('vehicle.upsert', (v) => v.id === vehicle.id && v.status === 'displayed');
    expect(seen).toMatchObject({ status: 'displayed', salePrice: cheap });

    // Force an NPC customer visit and decision (price far below value => buys).
    const customers = server.game.customers as unknown as {
      spawn(plotId: string, inv: unknown[]): void;
      customers: Map<string, { state: string; timer: number; path: unknown[]; archetype: unknown; budget: number }>;
      tick(): Promise<void>;
    };
    const before = server.game.state.players.get(client.playerId)!.money;
    customers.spawn(plot.id, [server.game.state.vehicles.get(vehicle.id)]);
    for (const c of customers.customers.values()) {
      c.path = [];
      c.state = 'browsing';
      c.timer = 0;
      c.archetype = ECONOMY.customers.archetypes.find((a) => a.id === 'bargain');
      c.budget = 1_000_000;
    }
    await customers.tick();
    await sleep(50);
    expect(server.game.state.vehicles.has(vehicle.id)).toBe(false);
    const after = server.game.state.players.get(client.playerId)!.money;
    expect(after).toBeGreaterThan(before);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Customer purchase!');
    expect(server.game.state.players.get(client.playerId)!.stats.customersServed).toBe(1);
    client.close();
    observer.client.close();
  });
});

describe('garage services', () => {
  it('repairs, washes, refuels and customizes with correct charges', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    const vehicle = await buyCheapest(client);
    const live = () => server.game.state.vehicles.get(vehicle.id)!;
    const money = () => server.game.state.players.get(client.playerId)!.money;

    // Must be at the garage.
    expect(await client.rpcRaw('repair.start', { vehicleId: vehicle.id, parts: ['engine'], useKits: false })).toMatchObject({ code: 'too_far' });
    goTo(client, 'repair');
    const parts = (['engine', 'brakes', 'body'] as const).filter((p) => live()[`condition`][p] < 100);
    if (parts.length > 0) {
      const quote = repairQuote(live(), [...parts]);
      const m0 = money();
      const res = await client.rpc('repair.start', { vehicleId: vehicle.id, parts: [...parts], useKits: false });
      expect(res.cost).toBe(quote.total);
      expect(money()).toBe(m0 - quote.total + (server.game.state.players.get(client.playerId)!.achievements.includes('grease_monkey') ? 800 : 0));
      for (const p of parts) expect(live().condition[p]).toBe(100);
      // Vehicle is in the shop for a few seconds.
      expect(await client.rpcRaw('repair.start', { vehicleId: vehicle.id, parts: ['tires'], useKits: false })).toMatchObject({ code: 'conflict' });
      // Service time is bounded
      expect(res.seconds).toBeLessThanOrEqual(ECONOMY.repair.maxSeconds + 2);
      const uow = server.game.state.begin();
      uow.vehicle(vehicle.id).serviceUntil = 0;
      await uow.commit();
    }

    // Parts kit discount
    goTo(client, 'parts');
    await client.rpc('parts.buy', { itemId: 'kit_tires', qty: 1 });
    expect(server.game.state.players.get(client.playerId)!.inventory.kit_tires).toBe(1);
    goTo(client, 'repair');
    if (live().condition.tires < 100) {
      const withKit = repairQuote(live(), ['tires'], { inventory: { kit_tires: 1 }, useKits: true });
      const withoutKit = repairQuote(live(), ['tires']);
      expect(withKit.total).toBeLessThan(withoutKit.total);
      const res = await client.rpc('repair.start', { vehicleId: vehicle.id, parts: ['tires'], useKits: true });
      expect(res.cost).toBe(withKit.total);
      expect(server.game.state.players.get(client.playerId)!.inventory.kit_tires ?? 0).toBe(0);
      const uow = server.game.state.begin();
      uow.vehicle(vehicle.id).serviceUntil = 0;
      await uow.commit();
    }

    // Wash
    {
      const uow = server.game.state.begin();
      uow.vehicle(vehicle.id).condition.cleanliness = 20;
      await uow.commit();
    }
    goTo(client, 'wash');
    const m1 = money();
    await client.rpc('wash.start', { vehicleId: vehicle.id, tier: 'deluxe' });
    expect(live().condition.cleanliness).toBe(100);
    expect(money()).toBe(m1 - 140);
    {
      const uow = server.game.state.begin();
      uow.vehicle(vehicle.id).serviceUntil = 0;
      uow.vehicle(vehicle.id).fuel = 40;
      await uow.commit();
    }

    // Fuel
    goTo(client, 'fuel');
    const cost = fuelCost(40);
    const m2 = money();
    const fuel = await client.rpc('fuel.refill', { vehicleId: vehicle.id });
    expect(fuel.cost).toBe(cost);
    expect(live().fuel).toBe(100);
    expect(money()).toBe(m2 - cost);
    expect((await client.rpcRaw('fuel.refill', { vehicleId: vehicle.id })).ok).toBe(false);

    // Customization: value increases, invalid options rejected. NPC cars sometimes come with
    // custom paint or wheels, so start from stock to make the expected charge exact.
    {
      const uow = server.game.state.begin();
      uow.vehicle(vehicle.id).mods = { ...DEFAULT_MODS };
      await uow.commit();
    }
    goTo(client, 'custom');
    const valueBefore = marketValue(live());
    expect((await client.rpcRaw('custom.apply', { vehicleId: vehicle.id, mods: { wheels: 'wheel_fake' } })).ok).toBe(false);
    expect((await client.rpcRaw('custom.apply', { vehicleId: vehicle.id, mods: { owner: 'x' } as never })).ok).toBe(false);
    const m3 = money();
    const c = await client.rpc('custom.apply', { vehicleId: vehicle.id, mods: { paint: 'paint_gold', wheels: 'wheel_chrome' } });
    expect(c.cost).toBe(2400 + 2200);
    expect(money()).toBe(m3 - c.cost);
    expect(live().mods.paint).toBe('paint_gold');
    expect(marketValue(live())).toBeGreaterThan(valueBefore);
    client.close();
  });
});

describe('bank', () => {
  it('deposits and withdraws only with sufficient funds and at the bank', async () => {
    const { client } = await connectNew(server);
    expect(await client.rpcRaw('bank.deposit', { amount: 1000 })).toMatchObject({ code: 'too_far' });
    goTo(client, 'bank');
    const r = await client.rpc('bank.deposit', { amount: 10_000 });
    expect(r).toEqual({ money: 15_000, bank: 10_000 });
    expect(await client.rpcRaw('bank.withdraw', { amount: 10_001 })).toMatchObject({ code: 'insufficient_funds' });
    expect(await client.rpcRaw('bank.deposit', { amount: -5 })).toMatchObject({ code: 'bad_request' });
    expect(await client.rpcRaw('bank.deposit', { amount: 1.5 })).toMatchObject({ code: 'bad_request' });
    const w = await client.rpc('bank.withdraw', { amount: 4_000 });
    expect(w).toEqual({ money: 19_000, bank: 6_000 });
    client.close();
  });
});

describe('auctions', () => {
  it('escrows bids, refunds outbid players and transfers the vehicle to the winner', async () => {
    const seller = await connectNew(server);
    const b1 = await connectNew(server);
    const b2 = await connectNew(server);
    // Bidding on other players' auctions requires some play (anti alt-account farming).
    for (const b of [b1, b2]) await setLevel(server, b.client.playerId, ECONOMY.trading.minLevelToBuyFromPlayers);
    const vehicle = await buyCheapest(seller.client);
    goTo(seller.client, 'auction');
    const value = marketValue(vehicle, server.game.state.trends);
    const start = Math.max(100, Math.round(value * 0.5));
    // Manipulation: absurd starting bids are rejected
    expect((await seller.client.rpcRaw('auction.create', { vehicleId: vehicle.id, startingBid: value * 10, durationSec: 120 })).ok).toBe(false);
    const { auction } = await seller.client.rpc('auction.create', { vehicleId: vehicle.id, startingBid: start, durationSec: 60 });
    expect(auction.status).toBe('active');
    // Seller can't bid on own auction; bids below minimum rejected.
    expect(await seller.client.rpcRaw('auction.bid', { auctionId: auction.id, amount: start })).toMatchObject({ code: 'forbidden' });
    expect((await b1.client.rpcRaw('auction.bid', { auctionId: auction.id, amount: start - 1 })).ok).toBe(false);
    await b1.client.rpc('auction.bid', { auctionId: auction.id, amount: start });
    expect(server.game.state.players.get(b1.client.playerId)!.money).toBe(25_000 - start);
    const second = start + Math.max(100, Math.ceil((start * 0.03) / 10) * 10);
    await b2.client.rpc('auction.bid', { auctionId: auction.id, amount: second });
    expect(server.game.state.players.get(b1.client.playerId)!.money).toBe(25_000);
    expect(server.game.state.players.get(b2.client.playerId)!.money).toBe(25_000 - second);
    await b1.client.waitFor<{ title: string }>('notify', (n) => n.title === 'You were outbid!');

    // Prevent NPC interference for a deterministic result, then end the auction.
    const uow = server.game.state.begin();
    const a = uow.auction(auction.id);
    a.npcCap = 0;
    a.endsAt = Date.now() - 1;
    await uow.commit();
    const sellerBefore = server.game.state.players.get(seller.client.playerId)!.money;
    await server.game.auctions.finalize(auction.id);
    const v = server.game.state.vehicles.get(vehicle.id)!;
    expect(v.ownerId).toBe(b2.client.playerId);
    expect(v.status).toBe('stored');
    const net = second - Math.round(second * ECONOMY.fees.auctionFeeRate);
    const sellerAfter = server.game.state.players.get(seller.client.playerId)!.money;
    expect(sellerAfter - sellerBefore).toBeGreaterThanOrEqual(net);
    expect(server.game.state.auctions.has(auction.id)).toBe(false);
    for (const c of [seller, b1, b2]) c.client.close();
  });
});

describe('auction edge cases', () => {
  it('does not settle an auction that a last-second bid extended', async () => {
    const seller = await connectNew(server);
    const bidder = await connectNew(server);
    await setLevel(server, bidder.client.playerId, ECONOMY.trading.minLevelToBuyFromPlayers);
    const vehicle = await buyCheapest(seller.client);
    goTo(seller.client, 'auction');
    const value = marketValue(vehicle, server.game.state.trends);
    const start = Math.max(100, Math.round(value * 0.5));
    const { auction } = await seller.client.rpc('auction.create', { vehicleId: vehicle.id, startingBid: start, durationSec: 60 });
    {
      const uow = server.game.state.begin();
      const a = uow.auction(auction.id);
      a.npcCap = 0;
      a.endsAt = Date.now() + 2_000; // inside the anti-snipe window
      await uow.commit();
    }
    const r = await bidder.client.rpc('auction.bid', { auctionId: auction.id, amount: start });
    expect(r.auction.endsAt).toBeGreaterThan(Date.now() + ECONOMY.auction.antiSnipeSec * 1000 - 2_000);
    await server.game.auctions.finalize(auction.id);
    expect(server.game.state.auctions.get(auction.id)?.status).toBe('active');
    expect(server.game.state.vehicles.get(vehicle.id)!.ownerId).toBe(seller.client.playerId);
    seller.client.close();
    bidder.client.close();
  });
});

describe('sessions', () => {
  it('a second login for the same account kicks the first socket', async () => {
    const { client, reg } = await connectNew(server);
    const second = await new TestClient(server.url, reg.token).connect();
    await client.waitFor<string>('kicked');
    await sleep(100);
    const r = await second.rpc('market.list', {});
    expect(r.listings.length).toBeGreaterThan(0);
    expect(server.game.onlineCount).toBeGreaterThan(0);
    second.close();
    client.close();
  });
});

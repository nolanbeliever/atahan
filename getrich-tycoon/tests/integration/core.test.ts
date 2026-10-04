// Core multiplayer + economy flows over real Socket.IO connections.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { KEY } from '../../shared/physics';
import { findAchievement, isCategoryUnlocked } from '../../shared/progression';
import { getModel } from '../../shared/vehicles';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setLevel, setMoney, sleep, startServer, TestClient } from '../helpers/server';

let server: RunningServer;
const reward = (id: string) => findAchievement(id)!.reward;
const FIRST_BUY = reward('first_purchase');
const FIRST_SALE = reward('first_sale');

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

async function cheapestListing(client: TestClient) {
  const { listings } = await client.rpc('market.list', {});
  const affordable = listings
    .filter((l) => isCategoryUnlocked(getModel(l.vehicle.modelId).category, 1))
    .sort((a, b) => a.askingPrice - b.askingPrice);
  expect(affordable.length).toBeGreaterThan(0);
  return affordable[0]!;
}

describe('connection & world', () => {
  it('connects, receives welcome with starting state and a populated market', async () => {
    const { client } = await connectNew(server);
    expect(client.self.player.money).toBe(25_000);
    expect(client.self.player.level).toBe(1);
    expect(client.world.marketListings.length).toBe(16);
    expect(client.world.players.some((p) => p.id === client.playerId)).toBe(true);
    client.close();
  });

  it('rejects sockets without a valid token', async () => {
    const bad = new TestClient(server.url, 'not-a-real-token-xxxxxxxxxxxxxxxx');
    await expect(bad.connect()).rejects.toThrow();
    bad.close();
  });

  it('moves the player server-authoritatively and rejects speed hacks', async () => {
    const { client } = await connectNew(server);
    await client.waitSnapshot((s) => s.self !== null);
    const start = client.lastSnapshot!.self!;
    client.sendInputs(KEY.FORWARD, 15);
    await sleep(700);
    const after = await client.waitSnapshot((s) => s.ack >= 15);
    const moved = Math.hypot(after.self![0] - start[0], after.self![1] - start[1]);
    expect(moved).toBeGreaterThan(0.5);
    expect(moved).toBeLessThan(15 * (1 / 30) * 8 + 0.5);

    // Speed hack: 200 commands of 0.1s each sent at once can't move more than ~1s worth.
    const before = client.lastSnapshot!.self!;
    client.sendInputs(KEY.FORWARD | KEY.SPRINT, 128, 0, 0.1);
    await sleep(600);
    const hacked = client.lastSnapshot!.self!;
    const d = Math.hypot(hacked[0] - before[0], hacked[1] - before[1]);
    expect(d).toBeLessThan(7.8 * 2.5);
    client.close();
  });

  it('two clients see each other and synchronize movement', async () => {
    const a = await connectNew(server);
    const b = await connectNew(server);
    await b.client.waitSnapshot((s) => s.p.some((p) => p[0] === a.client.playerId));
    const initial = b.client.lastSnapshot!.p.find((p) => p[0] === a.client.playerId)!;
    a.client.sendInputs(KEY.FORWARD, 30);
    const moved = await b.client.waitSnapshot((s) => {
      const p = s.p.find((x) => x[0] === a.client.playerId);
      return !!p && Math.hypot(p[1] - initial[1], p[2] - initial[2]) > 1;
    });
    expect(moved).toBeTruthy();
    a.client.close();
    await b.client.waitFor<string>('player.remove', (id) => id === a.client.playerId);
    b.client.close();
  });
});

describe('marketplace', () => {
  it('buys a vehicle: money decreases, vehicle appears in inventory, listing disappears for everyone', async () => {
    const a = await connectNew(server);
    const b = await connectNew(server);
    const listing = await cheapestListing(a.client);
    const res = await a.client.rpc('market.buy', { listingId: listing.id, expectedPrice: listing.askingPrice });
    expect(res.price).toBe(listing.askingPrice);
    expect(res.vehicle.ownerId).toBe(a.client.playerId);
    await a.client.waitFor('self', () => a.client.self.vehicles.some((v) => v.id === listing.vehicle.id));
    expect(a.client.self.player.money).toBe(25_000 - listing.askingPrice + FIRST_BUY);
    // Client B sees the listing removed from the market.
    const update = await b.client.waitFor<{ listings: { id: string }[] }>('market.update', (d) => !d.listings.some((l) => l.id === listing.id));
    expect(update.listings.some((l) => l.id === listing.id)).toBe(false);
    // Persisted in the database.
    const rows = await server.db.query('SELECT owner_id, status FROM vehicles WHERE id=$1', [listing.vehicle.id]);
    expect(rows[0]).toMatchObject({ owner_id: a.client.playerId, status: 'stored' });
    const tx = await server.db.query('SELECT amount FROM transactions WHERE player_id=$1 AND kind=$2', [a.client.playerId, 'market_buy']);
    expect(Number(tx[0]!.amount)).toBe(-listing.askingPrice);
    a.client.close();
    b.client.close();
  });

  it('prevents double purchases under a race: exactly one buyer wins', async () => {
    const a = await connectNew(server);
    const b = await connectNew(server);
    const listing = await cheapestListing(a.client);
    const [ra, rb] = await Promise.all([
      a.client.rpcRaw('market.buy', { listingId: listing.id, expectedPrice: listing.askingPrice }),
      b.client.rpcRaw('market.buy', { listingId: listing.id, expectedPrice: listing.askingPrice }),
    ]);
    const wins = [ra, rb].filter((r) => r.ok);
    expect(wins.length).toBe(1);
    const rows = await server.db.query('SELECT COUNT(*) AS n FROM vehicles WHERE id=$1', [listing.vehicle.id]);
    expect(Number(rows[0]!.n)).toBe(1);
    const moneyA = server.game.state.players.get(a.client.playerId)!.money;
    const moneyB = server.game.state.players.get(b.client.playerId)!.money;
    expect(moneyA + moneyB).toBe(50_000 - listing.askingPrice + FIRST_BUY);
    a.client.close();
    b.client.close();
  });

  it('rejects invalid and manipulated transactions', async () => {
    const { client } = await connectNew(server);
    const listing = await cheapestListing(client);
    const wrongPrice = await client.rpcRaw('market.buy', { listingId: listing.id, expectedPrice: 1 });
    expect(wrongPrice.ok).toBe(false);
    const negative = await client.rpcRaw('market.buy', { listingId: listing.id, expectedPrice: -500 });
    expect(negative).toMatchObject({ ok: false, code: 'bad_request' });
    const bogus = await client.rpcRaw('market.buy', { listingId: 'lst_doesnotexist', expectedPrice: 100 });
    expect(bogus).toMatchObject({ ok: false, code: 'not_found' });
    const malformed = await client.rpcRaw('market.buy', 'garbage' as never);
    expect(malformed.ok).toBe(false);
    const unknown = await client.rpcRaw('admin.giveMoney' as never, { amount: 1e9 } as never);
    expect(unknown.ok).toBe(false);
    await setMoney(server, client.playerId, 100);
    const poor = await client.rpcRaw('market.buy', { listingId: listing.id, expectedPrice: listing.askingPrice });
    expect(poor).toMatchObject({ ok: false, code: 'insufficient_funds' });
    const locked = (await client.rpc('market.list', {})).listings.find((l) => !isCategoryUnlocked(getModel(l.vehicle.modelId).category, 1));
    if (locked) {
      await setMoney(server, client.playerId, 5_000_000);
      const res = await client.rpcRaw('market.buy', { listingId: locked.id, expectedPrice: locked.askingPrice });
      expect(res).toMatchObject({ ok: false, code: 'forbidden' });
    }
    // Money unchanged by failed attempts.
    expect(server.game.state.players.get(client.playerId)!.money).toBe(locked ? 5_000_000 : 100);
    client.close();
  });

  it('deduplicates repeated request ids (network retries cannot double-charge)', async () => {
    const { client } = await connectNew(server);
    const listing = await cheapestListing(client);
    const params = { listingId: listing.id, expectedPrice: listing.askingPrice };
    const [r1, r2] = await Promise.all([client.rpcRaw('market.buy', params, 'same-id-1'), client.rpcRaw('market.buy', params, 'same-id-1')]);
    expect(r1.ok).toBe(true);
    expect(r2).toEqual(r1);
    expect(server.game.state.players.get(client.playerId)!.money).toBe(25_000 - listing.askingPrice + FIRST_BUY);
    client.close();
  });

  it('negotiates with an NPC seller', async () => {
    const { client } = await connectNew(server);
    const listing = await cheapestListing(client);
    const state = await client.rpc('market.negotiate', { listingId: listing.id });
    expect(state.status).toBe('open');
    expect(state.counterOffer).toBe(listing.askingPrice);
    // A lowball offer is never accepted and costs patience.
    const low = await client.rpc('market.offer', { listingId: listing.id, offer: Math.max(1, Math.round(listing.askingPrice * 0.3)) });
    expect(low.vehicle).toBeNull();
    expect(low.state.patience).toBeLessThan(1);
    // Offering the current counter always closes the deal at that price.
    if (low.state.status === 'open') {
      const deal = await client.rpc('market.offer', { listingId: listing.id, offer: low.state.counterOffer });
      expect(deal.state.status).toBe('accepted');
      expect(deal.vehicle?.ownerId).toBe(client.playerId);
      expect(deal.price).toBeLessThanOrEqual(listing.askingPrice);
    }
    client.close();
  });
});

describe('player listings & selling', () => {
  it('lists a vehicle on the classifieds and another player buys it', async () => {
    const seller = await connectNew(server);
    const buyer = await connectNew(server);
    const listing = await cheapestListing(seller.client);
    const { vehicle } = await seller.client.rpc('market.buy', { listingId: listing.id, expectedPrice: listing.askingPrice });
    const price = Math.min(listing.askingPrice + 500, 24_000);
    await seller.client.rpc('vehicle.list', { vehicleId: vehicle.id, price });
    const sellerMoneyBefore = server.game.state.players.get(seller.client.playerId)!.money;
    await buyer.client.waitFor('listings.changed');
    const { playerListings } = await buyer.client.rpc('market.list', {});
    const pl = playerListings.find((x) => x.vehicle.id === vehicle.id);
    expect(pl).toBeTruthy();
    expect(pl!.vehicle.purchasePrice).toBe(0); // private data is not leaked
    // Seller cannot buy own vehicle; brand-new accounts cannot buy from players (anti alt-farming);
    // the buyer must confirm the exact price.
    expect((await seller.client.rpcRaw('market.buyPlayer', { vehicleId: vehicle.id, expectedPrice: price })).ok).toBe(false);
    expect(await buyer.client.rpcRaw('market.buyPlayer', { vehicleId: vehicle.id, expectedPrice: price })).toMatchObject({ ok: false, code: 'forbidden' });
    await setLevel(server, buyer.client.playerId, ECONOMY.trading.minLevelToBuyFromPlayers);
    expect((await buyer.client.rpcRaw('market.buyPlayer', { vehicleId: vehicle.id, expectedPrice: price - 100 })).ok).toBe(false);
    const sellerXpBefore = server.game.state.players.get(seller.client.playerId)!.xp;
    await buyer.client.rpc('market.buyPlayer', { vehicleId: vehicle.id, expectedPrice: price });
    const fee = Math.round(price * 0.05);
    // Sales to players pay money but no XP / sales achievements.
    const sellerAfter = server.game.state.players.get(seller.client.playerId)!;
    expect(sellerAfter.money).toBe(sellerMoneyBefore + price - fee);
    expect(sellerAfter.xp).toBe(sellerXpBefore);
    expect(sellerAfter.stats.vehiclesSold).toBe(0);
    expect(server.game.state.players.get(buyer.client.playerId)!.money).toBe(25_000 - price + FIRST_BUY);
    expect(server.game.state.vehicles.get(vehicle.id)!.ownerId).toBe(buyer.client.playerId);
    await seller.client.waitFor<{ title: string }>('notify', (n) => n.title === 'Vehicle sold!');
    seller.client.close();
    buyer.client.close();
  });

  it('quick-sells a vehicle to the wholesaler at the quoted price', async () => {
    const { client } = await connectNew(server);
    const listing = await cheapestListing(client);
    const { vehicle } = await client.rpc('market.buy', { listingId: listing.id, expectedPrice: listing.askingPrice });
    const { quickSellPrice } = await import('../../shared/valuation');
    const quote = quickSellPrice(vehicle, server.game.state.trends);
    const before = server.game.state.players.get(client.playerId)!.money;
    const res = await client.rpc('vehicle.quickSell', { vehicleId: vehicle.id, expectedPrice: quote });
    expect(res.price).toBe(quote);
    expect(server.game.state.players.get(client.playerId)!.money).toBe(before + quote + FIRST_SALE);
    expect(server.game.state.vehicles.has(vehicle.id)).toBe(false);
    client.close();
  });
});

describe('chat', () => {
  it('delivers global chat and rate-limits spam', async () => {
    const a = await connectNew(server);
    const b = await connectNew(server);
    await a.client.rpc('chat.send', { channel: 'global', text: 'hello <b>world</b>' });
    const msg = await b.client.waitFor<{ text: string; fromName: string }>('chat', (m) => m.fromName === a.reg.name);
    expect(msg.text).toBe('hello <b>world</b>');
    let limited = false;
    for (let i = 0; i < 10; i++) {
      const r = await a.client.rpcRaw('chat.send', { channel: 'global', text: `spam ${i}` });
      if (!r.ok && r.code === 'rate_limited') limited = true;
    }
    expect(limited).toBe(true);
    a.client.close();
    b.client.close();
  });
});

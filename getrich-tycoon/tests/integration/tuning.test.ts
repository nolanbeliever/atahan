// Tuning garage and Rare Dealer against a real server over sockets.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vehicleParams } from '../../shared/physics';
import { RARE_ROTATION_MS, rareEpochEnd, type RareMarketState, type RareOffer } from '../../shared/rareMarket';
import { calculateVehicleStats, quoteTuning, tuningOf, type TuningChange } from '../../shared/tuningSystem';
import { marketValue } from '../../shared/valuation';
import { findOption } from '../../shared/customization';
import { getModel } from '../../shared/vehicles';
import { isCategoryUnlocked } from '../../shared/progression';
import { INTERACTABLES } from '../../shared/world';
import * as repo from '../../server/db/repo';
import { RareMarketService } from '../../server/game/services/rareMarket';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setLevel, setMoney, sleep, startServer, type TestClient } from '../helpers/server';

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

async function buyCheapestCar(client: TestClient) {
  const { listings } = await client.rpc('market.list', {});
  const l = listings
    .filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.aspiration !== 'electric' && getModel(x.vehicle.modelId).specs.kind !== 'bike')
    .sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  return (await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice })).vehicle;
}

async function endService(vehicleId: string) {
  const uow = server.game.state.begin();
  uow.vehicle(vehicleId).serviceUntil = 0;
  await uow.commit();
}

describe('tuning garage', () => {
  it('installs parts, paint, wheels and stance with authoritative pricing and rules', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 500_000);
    const vehicle = await buyCheapestCar(client);
    const live = () => server.game.state.vehicles.get(vehicle.id)!;
    const money = () => server.game.state.players.get(client.playerId)!.money;
    const model = getModel(vehicle.modelId);
    const change: TuningChange = {
      perf: { ecu: 'ecu_stage2', exhaust: 'exh_downpipe', suspension: 'susp_coilover' },
      body: { wing: 'wing_gt' },
      paint: { finish: 'chameleon', color: '#5b2a86', color2: '#1f9e89' },
      rim: { design: 'rim_mesh', finish: 'gold' },
      camber: 3,
      drop: 6,
    };

    // Only at Chroma Customs.
    expect(await client.rpcRaw('tuning.apply', { vehicleId: vehicle.id, change })).toMatchObject({ ok: false, code: 'too_far' });
    goTo(client, 'custom');

    // Malformed or invalid requests are rejected without charging anything.
    const m0 = money();
    for (const bad of [
      { perf: { ecu: 'ecu_stage9' } },
      { perf: { turbo: 'ind_single' } },
      { perf: { ecu: 'exh_catback' } },
      { perf: { ecu: 'ecu_stage2' } },
      { paint: { finish: 'gloss', color: 'red' } },
      { paint: { finish: 'glitter', color: '#ffffff' } },
      { rim: { design: 'rim_mesh', finish: 'rainbow' } },
      { drop: 5 },
      { camber: -2 },
      { owner: 'someone' },
    ]) {
      const res = await client.rpcRaw('tuning.apply', { vehicleId: vehicle.id, change: bad });
      expect(res, JSON.stringify(bad)).toMatchObject({ ok: false, code: 'bad_request' });
    }
    expect((await client.rpcRaw('tuning.apply', { vehicleId: vehicle.id, change: {}, legacy: { tint: 'tint_fake' } })).ok).toBe(false);
    expect((await client.rpcRaw('tuning.apply', { vehicleId: vehicle.id, change: {} })).ok).toBe(false);
    expect(money()).toBe(m0);

    const quote = quoteTuning(model, tuningOf(live().mods), change);
    const valueBefore = marketValue(live());
    const paidBefore = live().purchasePrice;
    const res = await client.rpc('tuning.apply', { vehicleId: vehicle.id, change, legacy: { tint: 'tint_dark' } });
    const tint = findOption('tint_dark')!.price;
    expect(res.cost).toBe(quote.total + tint);
    expect(money()).toBe(m0 - res.cost);
    expect(live().mods.tuning).toEqual(quote.next);
    expect(live().mods.tint).toBe('tint_dark');
    expect(live().purchasePrice).toBe(paidBefore + res.cost);
    expect(live().serviceUntil).toBeGreaterThan(Date.now());
    expect(marketValue(live())).toBeGreaterThan(valueBefore);
    // The owner's client gets the updated vehicle.
    await client.waitFor('self', (s: { vehicles: { id: string; mods: { tuning?: unknown } }[] }) => !!s.vehicles.find((v) => v.id === vehicle.id)?.mods.tuning);

    // In the workshop: no second job until it is done.
    expect(await client.rpcRaw('tuning.apply', { vehicleId: vehicle.id, change: { perf: { intake: 'intake_cai' } } })).toMatchObject({ ok: false, code: 'conflict' });
    await endService(vehicle.id);

    // Prerequisites are enforced on removal too.
    expect(await client.rpcRaw('tuning.apply', { vehicleId: vehicle.id, change: { perf: { exhaust: null } } })).toMatchObject({ ok: false, code: 'bad_request' });

    // The tuned figures drive the server physics.
    const tuned = vehicleParams(model, live().condition, live().fuel, live().mods);
    const stock = vehicleParams(model, live().condition, live().fuel);
    expect(tuned.topSpeed).toBeGreaterThan(stock.topSpeed);
    server.game.sim.startDriving(client.playerId, live());
    const drive = server.game.sim.drives.get(vehicle.id)!;
    expect(drive.params.topSpeed).toBeCloseTo(tuned.topSpeed, 6);
    expect(drive.params.pt.latGrip).toBeCloseTo(tuned.pt.latGrip, 6);
    // Tuned engines wear faster when driven.
    const engine0 = live().condition.engine;
    const stress = calculateVehicleStats(model, live().mods.tuning).stress;
    expect(stress).toBeGreaterThan(1);
    drive.pendingDistance = 50_000;
    await server.game.locks.run([`p:${client.playerId}`, `v:${vehicle.id}`], () => server.game.vehicles.flushDrive(vehicle.id, true));
    expect(live().condition.engine).toBeLessThan(engine0);
    server.game.sim.stopDriving(client.playerId);
    goTo(client, 'custom'); // stepping out leaves us next to the car

    // Back to stock suspension: free, and the stance settles to the stock limits.
    const m1 = money();
    const back = await client.rpc('tuning.apply', { vehicleId: vehicle.id, change: { perf: { suspension: null } } });
    expect(back.cost).toBe(0);
    expect(money()).toBe(m1);
    expect(live().mods.tuning!.drop).toBe(0);
    expect(live().mods.tuning!.camber).toBe(1.5);
    client.close();
  });

  it('keeps working for vehicles saved before tuning existed', async () => {
    const { client } = await connectNew(server);
    const vehicle = await buyCheapestCar(client);
    const row = (await server.game.state.db.query('SELECT mods FROM vehicles WHERE id=$1', [vehicle.id]))[0]!;
    const mods = repo.rowToVehicle({ ...row, id: vehicle.id, model_id: vehicle.modelId, condition: '{}', mods: JSON.stringify({ paint: 'paint_gold' }) } as never).mods;
    expect(mods.paint).toBe('paint_gold');
    expect(mods.wheels).toBe('wheel_stock');
    expect(mods.tuning).toBeUndefined();
    client.close();
  });
});

describe('rare dealer', () => {
  it('serves the same 120-second stock to everyone and sells each offer once', async () => {
    const a = (await connectNew(server)).client;
    const b = (await connectNew(server)).client;
    // The stock is tied to the clock: don't start in the last seconds of a rotation.
    const left = rareEpochEnd(Math.floor(Date.now() / RARE_ROTATION_MS)) - Date.now();
    if (left < 15_000) await sleep(left + 500);
    const s1: RareMarketState = await a.rpc('rare.list', {});
    const s2: RareMarketState = await b.rpc('rare.list', {});
    expect(s1.offers).toHaveLength(6);
    expect(s2.offers.map((o) => [o.id, o.vehicle.modelId, o.price])).toEqual(s1.offers.map((o) => [o.id, o.vehicle.modelId, o.price]));
    expect(s1.endsAt).toBe(rareEpochEnd(s1.epoch));
    expect(s1.endsAt - s1.serverTime).toBeGreaterThan(0);
    expect(s1.endsAt - s1.serverTime).toBeLessThanOrEqual(120_000);

    // A restarted service (same database secret) rebuilds exactly the same stock.
    const again = new RareMarketService(server.game.ctx);
    await again.init();
    expect(again.list().offers.map((o) => [o.vehicle.modelId, o.price])).toEqual(s1.offers.map((o) => [o.vehicle.modelId, o.price]));

    const offer = [...s1.offers].sort((x, y) => x.price - y.price)[0]!;
    await setLevel(server, a.playerId, 20);
    await setMoney(server, a.playerId, 0);
    expect(await a.rpcRaw('rare.buy', { offerId: offer.id, expectedPrice: offer.price })).toMatchObject({ ok: false, code: 'insufficient_funds' });
    await setMoney(server, a.playerId, 5_000_000);
    await setMoney(server, b.playerId, 5_000_000);
    await setLevel(server, b.playerId, 20);
    expect(await a.rpcRaw('rare.buy', { offerId: offer.id, expectedPrice: offer.price + 1 })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await a.rpcRaw('rare.buy', { offerId: `${s1.epoch - 1}:${offer.slot}`, expectedPrice: offer.price })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await a.rpcRaw('rare.buy', { offerId: 'nope', expectedPrice: offer.price })).toMatchObject({ ok: false, code: 'bad_request' });

    const m0 = server.game.state.players.get(a.playerId)!.money;
    const bought = await a.rpc('rare.buy', { offerId: offer.id, expectedPrice: offer.price });
    expect(bought.price).toBe(offer.price);
    expect(bought.vehicle.ownerId).toBe(a.playerId);
    expect(bought.vehicle.modelId).toBe(offer.vehicle.modelId);
    expect(bought.vehicle.status).toBe('stored');
    expect(bought.vehicle.id).not.toBe(offer.vehicle.id);
    // (Achievements may pay out on top, so check the purchase transaction itself.)
    const tx = (await repo.recentTransactions(server.game.state.db, a.playerId, 20)).find((t) => t.kind === 'rare_buy');
    expect(tx?.amount).toBe(-offer.price);
    expect(server.game.state.players.get(a.playerId)!.money).toBeLessThanOrEqual(m0 - offer.price + 50_000);
    // Everyone sees it sold; nobody can buy it again.
    const upd = await b.waitFor<RareMarketState>('rare.update', (s) => s.offers.some((o) => o.id === offer.id && o.soldTo !== null));
    expect(upd.offers.find((o) => o.id === offer.id)!.soldTo).toBe(server.game.state.players.get(a.playerId)!.name);
    expect(await b.rpcRaw('rare.buy', { offerId: offer.id, expectedPrice: offer.price })).toMatchObject({ ok: false, code: 'conflict' });
    // Sold slots are saved with the purchase.
    const saved = JSON.parse((await repo.getWorldValue(server.game.state.db, 'rare_sold'))!) as { epoch: number; sold: Record<string, string> };
    expect(saved.epoch).toBe(s1.epoch);
    expect(saved.sold[String(offer.slot)]).toBeTruthy();
    a.close();
    b.close();
  });

  it('announces legendary purchases', async () => {
    const { client } = await connectNew(server);
    const left = rareEpochEnd(Math.floor(Date.now() / RARE_ROTATION_MS)) - Date.now();
    if (left < 15_000) await sleep(left + 500);
    await setMoney(server, client.playerId, 5_000_000);
    await setLevel(server, client.playerId, 20);
    const state: RareMarketState = await client.rpc('rare.list', {});
    // Test-only: turn a free slot into a legendary offer.
    const offers = (server.game.rare as unknown as { offers: RareOffer[] }).offers;
    const sold = (server.game.rare as unknown as { sold: Map<number, string> }).sold;
    const slot = state.offers.find((o) => !sold.has(o.slot))!.slot;
    offers[slot] = { ...offers[slot]!, tier: 'legendary', price: 330_000, vehicle: { ...offers[slot]!.vehicle, modelId: 'mercedes_g_class', mods: { ...offers[slot]!.vehicle.mods, tuning: undefined } } };
    const res = await client.rpc('rare.buy', { offerId: offers[slot]!.id, expectedPrice: 330_000 });
    expect(res.vehicle.modelId).toBe('mercedes_g_class');
    const chat = await client.waitFor<{ text: string; channel: string }>('chat', (m) => m.channel === 'system' && m.text.includes('legendary'));
    expect(chat.text).toContain('Mercedes-AMG G 63');
    client.close();
  });
});

// Car theft against a real server: Black Market stock, the lockpick (success and failure with the
// alarm and police), the Sanayi lift and stripping, the Pawn Shop, and the rules for stolen cars.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { starsFor } from '../../server/game/services/police';
import { TheftService } from '../../server/game/services/theft';
import { LIFT_BAYS, LOCKPICK_ITEM, SANAYI, STRIP_PARTS, lockTolerance, papersPrice, parsePartItem, partProfile, partShare, partsFor, removedParts, type BlackMarketInfo, type StreetCar, type StripPart } from '../../shared/theft';
import { getModel } from '../../shared/vehicles';
import { marketValue } from '../../shared/valuation';
import { INTERACTABLES } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setMoney, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const T = ECONOMY.theft;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
  // Quick strip jobs for the test.
  for (const p of STRIP_PARTS) p.seconds = 0.3;
});

afterAll(async () => {
  await server?.close();
});

const cash = (client: TestClient) => server.game.state.players.get(client.playerId)!.money;
const inv = (client: TestClient) => server.game.state.players.get(client.playerId)!.inventory;
const theftInternals = () => server.game.theft as unknown as { sessions: Map<string, { sweet: number; tolerance: number }>; cars: Map<string, StreetCar> };

/** Stand the player next to a street car (city kerb). */
async function besideStreetCar(client: TestClient, highway = false): Promise<StreetCar> {
  const { cars } = await client.rpc('street.list', {});
  const car = cars.find((c) => c.highway === highway && c.alarmUntil === 0)!;
  expect(car).toBeDefined();
  const side = getModel(car.modelId).shape.width / 2 + 0.8;
  server.game.sim.teleport(client.playerId, car.x + Math.cos(car.rot) * side, car.z - Math.sin(car.rot) * side);
  return car;
}

async function giveSets(client: TestClient, n: number): Promise<void> {
  const uow = server.game.state.begin();
  uow.player(client.playerId).inventory[LOCKPICK_ITEM] = n;
  await uow.commit();
}

/** Pick a lock with the right angle (read from the server, standing in for a skilled player). */
async function stealCar(client: TestClient): Promise<string> {
  await giveSets(client, (inv(client)[LOCKPICK_ITEM] ?? 0) + 1);
  const car = await besideStreetCar(client);
  const { sessionId } = await client.rpc('lockpick.start', { carId: car.id });
  const s = theftInternals().sessions.get(client.playerId)!;
  const r = await client.rpc('lockpick.try', { sessionId, angle: s.sweet });
  expect(r.opened).toBe(true);
  return r.vehicleId!;
}

describe('Black Market', () => {
  it('sells lockpick sets from a shared stock of 5 that refills every 10 minutes', async () => {
    const { client: a } = await connectNew(server);
    const { client: b } = await connectNew(server);
    await setMoney(server, a.playerId, 100_000);
    await setMoney(server, b.playerId, 1_000);
    const info0 = await a.rpc('blackmarket.info', {});
    expect(info0.price).toBe(2_500);
    expect(info0.max).toBe(5);
    expect(info0.restockAt - Date.now()).toBeLessThanOrEqual(600_000);
    expect(info0.restockAt).toBeGreaterThan(Date.now());
    // Not enough cash.
    expect(await b.rpcRaw('blackmarket.buy', {})).toMatchObject({ ok: false, code: 'insufficient_funds' });
    const money0 = cash(a);
    let last: BlackMarketInfo = info0;
    for (let i = 0; i < info0.stock; i++) last = await a.rpc('blackmarket.buy', {});
    expect(last.stock).toBe(0);
    expect(last.owned).toBe(info0.stock);
    expect(cash(a)).toBe(money0 - 2_500 * info0.stock);
    // Everyone sees the stock change; and it's sold out.
    await b.waitFor<{ stock: number }>('blackmarket.update', (d) => d.stock === 0);
    const out = await a.rpcRaw('blackmarket.buy', {});
    expect(out).toMatchObject({ ok: false, code: 'conflict' });
    a.close();
    b.close();
  });
});

describe('lockpicking', () => {
  it('needs a set and to be next to the car; the right angle opens it and you drive off', async () => {
    const { client } = await connectNew(server);
    const car = await besideStreetCar(client);
    expect(await client.rpcRaw('lockpick.start', { carId: car.id })).toMatchObject({ ok: false, code: 'forbidden' });
    await giveSets(client, 1);
    server.game.sim.teleport(client.playerId, car.x + 30, car.z + 30);
    expect(await client.rpcRaw('lockpick.start', { carId: car.id })).toMatchObject({ ok: false, code: 'too_far' });
    await besideStreetCar(client);
    const started = await client.rpc('lockpick.start', { carId: car.id });
    expect(started.picks).toBe(3);
    expect(inv(client)[LOCKPICK_ITEM] ?? 0).toBe(0);
    const s = theftInternals().sessions.get(client.playerId)!;
    expect(s.tolerance).toBe(lockTolerance(getModel(car.modelId)));
    // A wrong turn snaps a pick; the cylinder turned part of the way.
    const off = s.sweet > 90 ? s.sweet - 25 : s.sweet + 25;
    const miss = await client.rpc('lockpick.try', { sessionId: started.sessionId, angle: off });
    expect(miss.opened).toBe(false);
    expect(miss.picksLeft).toBe(2);
    expect(miss.turn).toBeGreaterThan(0);
    expect(miss.turn).toBeLessThan(1);
    // ... and the lock says which way the sweet spot is and roughly how far (15-30 degrees).
    expect(miss.dir).toBe(s.sweet > off ? 1 : -1);
    expect(miss.band).toBe(1);
    // Too fast: one turn at a time.
    expect(await client.rpcRaw('lockpick.try', { sessionId: started.sessionId, angle: s.sweet })).toMatchObject({ ok: false, code: 'rate_limited' });
    await sleep(T.tryCooldownMs + 50);
    const hit = await client.rpc('lockpick.try', { sessionId: started.sessionId, angle: s.sweet });
    expect(hit.opened).toBe(true);
    const v = server.game.state.vehicles.get(hit.vehicleId!)!;
    expect(v.status).toBe('stolen');
    expect(v.ownerId).toBe(client.playerId);
    expect(server.game.sim.chars.get(client.playerId)!.drivingId).toBe(v.id);
    // The street car is gone for everyone.
    expect(theftInternals().cars.has(car.id)).toBe(false);
    await client.waitFor<StreetCar[]>('street.cars', (cars) => !cars.some((c) => c.id === car.id));
    client.close();
  });

  it('three wrong turns: the set is lost, the alarm goes off and the police come (2 stars)', async () => {
    const { client } = await connectNew(server);
    await giveSets(client, 1);
    const car = await besideStreetCar(client);
    const { sessionId } = await client.rpc('lockpick.start', { carId: car.id });
    const s = theftInternals().sessions.get(client.playerId)!;
    const wrong = s.sweet > 90 ? 5 : 175;
    let r = await client.rpc('lockpick.try', { sessionId, angle: wrong });
    for (let i = 0; i < 2; i++) {
      await sleep(T.tryCooldownMs + 50);
      r = await client.rpc('lockpick.try', { sessionId, angle: wrong });
    }
    expect(r.failed).toBe(true);
    expect(r.picksLeft).toBe(0);
    expect(inv(client)[LOCKPICK_ITEM] ?? 0).toBe(0);
    const alarm = await client.waitFor<{ carId: string }>('car.alarm', (d) => d.carId === car.id);
    expect(alarm.carId).toBe(car.id);
    expect(starsFor(server.game.police.wantedOf(client.playerId)!.heat)).toBeGreaterThanOrEqual(2);
    // The car is alarmed for a while: no new attempt.
    await giveSets(client, 1);
    expect(await client.rpcRaw('lockpick.start', { carId: car.id })).toMatchObject({ ok: false, code: 'conflict' });
    client.close();
  });
});

describe('Sanayi and the Pawn Shop', () => {
  it('forged papers make a stolen car yours, to keep or list on the Marketplace', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 200_000);
    const vehicleId = await stealCar(client);
    if (server.game.sim.isDriven(vehicleId)) await client.rpc('vehicle.exit', {});
    // A stolen car can't go on the classifieds.
    expect((await client.rpcRaw('vehicle.list', { vehicleId, price: 20_000 })).ok).toBe(false);
    expect(await client.rpcRaw('sanayi.papers', { vehicleId })).toMatchObject({ ok: false, code: 'too_far' });
    const office = INTERACTABLES.find((i) => i.kind === 'sanayi')!;
    server.game.sim.teleport(client.playerId, office.x, office.z);
    // The car has to be in the yard.
    expect(await client.rpcRaw('sanayi.papers', { vehicleId })).toMatchObject({ ok: false, code: 'too_far' });
    const move = server.game.state.begin();
    const mv = move.vehicle(vehicleId);
    mv.x = (SANAYI.yard.minX + SANAYI.yard.maxX) / 2;
    mv.z = SANAYI.yard.minZ + 4;
    await move.commit();
    const live = server.game.state.vehicles.get(vehicleId)!;
    const price = papersPrice(marketValue(live, server.game.state.trends));
    expect(price).toBeGreaterThanOrEqual(T.papersMin);
    const m0 = cash(client);
    const r = await client.rpc('sanayi.papers', { vehicleId });
    expect(r.price).toBe(price);
    expect(r.vehicle.status).toBe('world');
    expect(cash(client)).toBe(m0 - price);
    const { transactions } = await client.rpc('transactions', {});
    expect(transactions.find((t) => t.kind === 'papers')?.amount).toBe(-price);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Araç tamamen senin!');
    // Only once; now it lists like any other car.
    expect(await client.rpcRaw('sanayi.papers', { vehicleId })).toMatchObject({ ok: false, code: 'conflict' });
    const listed = await client.rpc('vehicle.list', { vehicleId, price: Math.round(marketValue(live, server.game.state.trends)) });
    expect(listed.vehicle.status).toBe('listed');
    // And the police no longer take it back when left alone.
    expect(server.game.state.vehicles.get(vehicleId)!.status).toBe('listed');
    client.close();
  });

  it('lift, strip every part (the car loses them), scrap the shell and sell the car\u2019s parts for $25,000 in all', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await stealCar(client);
    const model = getModel(server.game.state.vehicles.get(vehicleId)!.modelId);
    // A stolen car can't be stored, quick-sold or listed.
    expect(await client.rpcRaw('vehicle.store', { vehicleId })).toMatchObject({ ok: false });
    expect(await client.rpcRaw('vehicle.quickSell', { vehicleId, expectedPrice: 1000 })).toMatchObject({ ok: false });
    // Not on a lift yet.
    expect(await client.rpcRaw('sanayi.lift', { vehicleId })).toMatchObject({ ok: false, code: 'too_far' });
    const bay = LIFT_BAYS[1]!;
    server.game.sim.placeDrive(vehicleId, bay.x, bay.z, bay.yaw);
    const { vehicle } = await client.rpc('sanayi.lift', { vehicleId });
    expect(vehicle.mods.strip?.bay).toBe(1);
    expect(vehicle.x).toBeCloseTo(bay.x, 5);
    expect(server.game.sim.chars.get(client.playerId)!.drivingId).toBeNull();
    // Can't drive it off the lift.
    expect(await client.rpcRaw('vehicle.enter', { vehicleId })).toMatchObject({ ok: false });
    const parts = partsFor(model);
    let scrapped = false;
    for (const part of parts) {
      const live = server.game.state.vehicles.get(vehicleId)!;
      const at = TheftService.stripPoint(live, part);
      server.game.sim.teleport(client.playerId, at.x, at.z);
      const first = await client.rpc('sanayi.strip', { vehicleId, part });
      expect(first.done).toBe(false);
      // Finishing early is refused (the server times the work).
      const early = await client.rpc('sanayi.strip', { vehicleId, part });
      expect(early.done).toBe(false);
      await sleep(first.readyAt - Date.now() + 30);
      const done = await client.rpc('sanayi.strip', { vehicleId, part });
      expect(done.done).toBe(true);
      scrapped = done.scrapped;
      if (!scrapped) expect(removedParts(done.vehicle!.mods)).toContain(part);
    }
    expect(scrapped).toBe(true);
    expect(server.game.state.vehicles.has(vehicleId)).toBe(false);
    const items = Object.entries(inv(client)).filter(([id]) => parsePartItem(id));
    expect(items.reduce((a, [, n]) => a + n, 0)).toBe(parts.length);
    // Sell them at the Pawn Shop.
    expect(await client.rpcRaw('pawn.sell', {})).toMatchObject({ ok: false, code: 'too_far' });
    const pawn = INTERACTABLES.find((i) => i.kind === 'pawn')!;
    server.game.sim.teleport(client.playerId, pawn.x, pawn.z);
    const money0 = cash(client);
    // One part fetches its share of the car's price; the whole car's parts $10,000-$15,000 together (araç başı).
    const one = await client.rpc('pawn.sell', { part: parts[0] as StripPart });
    expect(one.count).toBe(1);
    const share = partShare(parts[0]!, partProfile(model));
    expect(one.amount).toBeGreaterThanOrEqual(Math.floor(T.pawnMin * share));
    expect(one.amount).toBeLessThanOrEqual(Math.ceil(T.pawnMax * share));
    const rest = await client.rpc('pawn.sell', {});
    expect(rest.count).toBe(parts.length - 1);
    expect(one.amount + rest.amount).toBeGreaterThanOrEqual(T.pawnMin - 1);
    expect(one.amount + rest.amount).toBeLessThanOrEqual(T.pawnMax + 1);
    expect(cash(client)).toBe(money0 + one.amount + rest.amount);
    expect(Object.keys(inv(client)).some((id) => parsePartItem(id))).toBe(false);
    const n = await client.waitFor<{ title: string; text: string }>('notify', (d) => d.title.includes('Pawn Shop'));
    expect(n.title).toMatch(/^Parçalar Pawn Shop'a satıldı: \+\$[\d,]+$/);
    expect(await client.rpcRaw('pawn.sell', {})).toMatchObject({ ok: false, code: 'bad_request' });
    client.close();
  }, 30_000);

  it('only stolen cars go on the lift; stripping needs you at the part', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await stealCar(client);
    const bay = LIFT_BAYS[0]!;
    server.game.sim.placeDrive(vehicleId, bay.x, bay.z, bay.yaw);
    await client.rpc('sanayi.lift', { vehicleId });
    // Standing at the wrong part.
    const v = server.game.state.vehicles.get(vehicleId)!;
    const at = TheftService.stripPoint(v, 'engine');
    server.game.sim.teleport(client.playerId, at.x, at.z);
    expect(await client.rpcRaw('sanayi.strip', { vehicleId, part: 'mirrors' })).toMatchObject({ ok: false, code: 'too_far' });
    // A part this car doesn't have (electric cars have no exhaust, naturally aspirated ones no turbo).
    const model = getModel(v.modelId);
    const missing = (['exhaust', 'turbo', 'alternator'] as const).find((p) => !partsFor(model).includes(p));
    if (missing) expect(await client.rpcRaw('sanayi.strip', { vehicleId, part: missing })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await client.rpcRaw('sanayi.strip', { vehicleId, part: 'wheels' })).toMatchObject({ ok: false, code: 'bad_request' });
    // The other bay can't take a second car on the same lift.
    const second = await stealCar(client).catch(() => null);
    if (second) {
      server.game.sim.placeDrive(second, bay.x, bay.z, bay.yaw);
      expect(await client.rpcRaw('sanayi.lift', { vehicleId: second })).toMatchObject({ ok: false, code: 'conflict' });
    }
    client.close();
  }, 20_000);
});

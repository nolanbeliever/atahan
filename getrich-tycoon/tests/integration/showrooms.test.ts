// The themed showrooms on the far shore: new cars at the showroom price in a factory colour, the
// Black Market's one-of-a-kind cars with a theft record, and test drives (a temporary car that goes
// back when the time is up or the driver gets out; damage is billed).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MODS } from '../../shared/customization';
import { ECONOMY } from '../../shared/economy.config';
import { findShowroom, showroomPrice, type ShowroomId } from '../../shared/showrooms';
import type { Vehicle } from '../../shared/types';
import { quickSellPrice } from '../../shared/valuation';
import { getModel } from '../../shared/vehicles';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setLevel, setMoney, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

function toDoor(client: TestClient, id: ShowroomId): void {
  const s = findShowroom(id)!;
  server.game.sim.teleport(client.playerId, s.door.x, s.door.z);
}

const owned = (client: TestClient) => server.game.state.vehiclesOf(client.playerId);
const money = (client: TestClient) => server.game.state.players.get(client.playerId)!.money;

describe('showrooms: buying', () => {
  it('sells new cars at the door, at the showroom price, in the colour you pick', async () => {
    const { client } = await connectNew(server);
    await setLevel(server, client.playerId, 12);
    await setMoney(server, client.playerId, 1_000_000);
    const info = await client.rpc('showroom.info', { showroomId: 'jdm' });
    expect(info.offers.map((o) => o.modelId)).toEqual(['toyota_supra_a80', 'nissan_skyline_r34', 'mazda_rx7_fd']);
    const supra = info.offers[0]!;
    expect(supra.price).toBe(showroomPrice('toyota_supra_a80', server.game.state.trends));
    // Away from the showroom: no sale.
    await expect(client.rpc('showroom.buy', { showroomId: 'jdm', offerId: supra.id, expectedPrice: supra.price })).rejects.toThrow(/too_far/);
    toDoor(client, 'jdm');
    await expect(client.rpc('showroom.buy', { showroomId: 'jdm', offerId: supra.id, expectedPrice: supra.price - 100 })).rejects.toThrow(/conflict/);
    // Another showroom's car can't be bought here.
    await expect(client.rpc('showroom.buy', { showroomId: 'jdm', offerId: 'new:bugatti_chiron', expectedPrice: 1 })).rejects.toThrow(/not_found/);
    const color = getModel('toyota_supra_a80').colors[2]!;
    const before = money(client);
    const { vehicle, price } = await client.rpc('showroom.buy', { showroomId: 'jdm', offerId: supra.id, color, expectedPrice: supra.price });
    expect(price).toBe(supra.price);
    expect(vehicle.color).toBe(color);
    expect(vehicle.status).toBe('stored');
    expect(vehicle.condition.engine).toBe(100);
    expect(vehicle.mods.hot).toBeUndefined();
    const { transactions } = await client.rpc('transactions', {});
    expect(transactions.find((t) => t.kind === 'showroom')?.amount).toBe(-price);
    expect(money(client)).toBeLessThanOrEqual(before - price + 1_000);
    // Selling it straight back always loses money.
    expect(quickSellPrice(vehicle, server.game.state.trends)).toBeLessThan(price);
    client.close();
  });

  it('keeps level locks: a level-1 player cannot buy a hypercar', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 5_000_000);
    toDoor(client, 'hyper');
    const info = await client.rpc('showroom.info', { showroomId: 'hyper' });
    const chiron = info.offers.find((o) => o.modelId === 'bugatti_chiron')!;
    await expect(client.rpc('showroom.buy', { showroomId: 'hyper', offerId: chiron.id, expectedPrice: chiron.price })).rejects.toThrow(/forbidden/);
    client.close();
  });

  it('Black Market: used cars with a theft record, each sold once, above the quick-sell payout', async () => {
    const a = (await connectNew(server)).client;
    const b = (await connectNew(server)).client;
    for (const c of [a, b]) {
      await setLevel(server, c.playerId, 12);
      await setMoney(server, c.playerId, 2_000_000);
      toDoor(c, 'blackmarket');
    }
    const info = await a.rpc('showroom.info', { showroomId: 'blackmarket' });
    expect(info.offers).toHaveLength(ECONOMY.showrooms.blackMarket.slots);
    expect(info.restockAt).toBeGreaterThan(Date.now());
    for (const o of info.offers) {
      expect(o.hot).toBe(true);
      expect(getModel(o.modelId).specs.kind).not.toBe('bike');
      expect(getModel(o.modelId).exclusive).toBeFalsy();
      expect(o.price).toBeGreaterThan(quickSellPrice(o.vehicle, server.game.state.trends));
      expect(o.vehicle.mileage).toBeGreaterThanOrEqual(ECONOMY.showrooms.blackMarket.mileage[0]);
    }
    const o = info.offers[0]!;
    const { vehicle } = await a.rpc('showroom.buy', { showroomId: 'blackmarket', offerId: o.id, expectedPrice: o.price });
    expect(vehicle.mods.hot).toBe(true);
    expect(vehicle.modelId).toBe(o.modelId);
    expect(vehicle.mileage).toBe(o.vehicle.mileage);
    // Gone for everyone else.
    await expect(b.rpc('showroom.buy', { showroomId: 'blackmarket', offerId: o.id, expectedPrice: o.price })).rejects.toThrow(/conflict/);
    const after = await b.rpc('showroom.info', { showroomId: 'blackmarket' });
    expect(after.offers[0]!.soldTo).toBe(server.game.state.players.get(a.playerId)!.name);
    a.close();
    b.close();
  });
});

describe('showrooms: test drives', () => {
  const testCar = (client: TestClient): Vehicle | undefined => [...server.game.state.vehicles.values()].find((v) => v.ownerId === client.playerId && v.status === 'testdrive');

  it('puts you behind the wheel of a temporary car that goes back when you get out', async () => {
    const { client } = await connectNew(server);
    toDoor(client, 'hyper');
    const garage = owned(client).length;
    // A level-1 player may test-drive a hypercar (just not buy one).
    const view = await client.rpc('showroom.testDrive', { showroomId: 'hyper', offerId: 'new:bugatti_chiron' });
    expect(view.modelId).toBe('bugatti_chiron');
    expect(view.endsAt - Date.now()).toBeGreaterThan((ECONOMY.showrooms.testDriveSec - 2) * 1000);
    const car = testCar(client)!;
    expect(car).toBeDefined();
    expect(server.game.sim.chars.get(client.playerId)!.drivingId).toBe(car.id);
    const bay = findShowroom('hyper')!.testDrive;
    expect(Math.hypot(car.x - bay.x, car.z - bay.z)).toBeLessThan(0.5);
    // It is not the player's: it can't be stored, sold or listed, and doesn't take a garage slot.
    await expect(client.rpc('vehicle.quickSell', { vehicleId: car.id, expectedPrice: quickSellPrice(car, server.game.state.trends) })).rejects.toThrow(/test-drive|Exit the vehicle/);
    await expect(client.rpc('vehicle.store', { vehicleId: car.id })).rejects.toThrow(/test-drive|Exit the vehicle/);
    expect(server.game.state.netWorth(client.playerId)).toBe(server.game.state.players.get(client.playerId)!.money + server.game.state.players.get(client.playerId)!.bank);
    // One at a time.
    await expect(client.rpc('showroom.testDrive', { showroomId: 'hyper', offerId: 'new:ferrari_sf90' })).rejects.toThrow(/conflict/);
    // Get out: the car goes back.
    await client.rpc('vehicle.exit', {});
    await server.game.showrooms.tick();
    expect(testCar(client)).toBeUndefined();
    expect(server.game.state.vehicles.has(car.id)).toBe(false);
    const end = await client.waitFor<{ reason: string; fee: number }>('testdrive.end');
    expect(end.reason).toBe('exit');
    expect(end.fee).toBe(0);
    expect(owned(client).length).toBe(garage);
    // A short wait before the next one.
    await expect(client.rpc('showroom.testDrive', { showroomId: 'hyper', offerId: 'new:ferrari_sf90' })).rejects.toThrow(/ready in/);
    client.close();
  }, 20_000);

  it('when the time is up the car and the driver return to the showroom, and damage is billed', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    toDoor(client, 'ev');
    await client.rpc('showroom.testDrive', { showroomId: 'ev', offerId: 'new:tesla_model_s_plaid', color: getModel('tesla_model_s_plaid').colors[1] });
    const car = testCar(client)!;
    expect(car.color).toBe(getModel('tesla_model_s_plaid').colors[1]);
    // Drive off somewhere and dent it.
    server.game.sim.placeDrive(car.id, 820, 40, Math.PI / 2);
    server.game.sim.drives.get(car.id)!.pendingDamage = 20;
    (server.game.showrooms as unknown as { drives: Map<string, { endsAt: number }> }).drives.get(client.playerId)!.endsAt = Date.now() - 1;
    const before = money(client);
    await server.game.showrooms.tick();
    expect(server.game.state.vehicles.has(car.id)).toBe(false);
    const end = await client.waitFor<{ reason: string; fee: number }>('testdrive.end');
    expect(end.reason).toBe('time');
    const price = showroomPrice('tesla_model_s_plaid', server.game.state.trends);
    expect(end.fee).toBe(Math.min(Math.round(price * ECONOMY.showrooms.damageMax), Math.round(price * ECONOMY.showrooms.damagePerPoint * 20)));
    expect(money(client)).toBe(before - end.fee);
    // Walked back to the door.
    const door = findShowroom('ev')!.door;
    const pos = server.game.sim.position(client.playerId)!;
    expect(Math.hypot(pos.x - door.x, pos.z - door.z)).toBeLessThan(3);
    expect(server.game.sim.chars.get(client.playerId)!.drivingId).toBeNull();
    client.close();
  }, 20_000);

  it('no test drive while wanted, and none from far away', async () => {
    const { client } = await connectNew(server);
    await expect(client.rpc('showroom.testDrive', { showroomId: 'moto', offerId: 'new:yamaha_mt09' })).rejects.toThrow(/too_far/);
    toDoor(client, 'moto');
    server.game.police.addHeat(client.playerId, 60);
    expect(server.game.police.starsOf(client.playerId)).toBeGreaterThan(0);
    await expect(client.rpc('showroom.testDrive', { showroomId: 'moto', offerId: 'new:yamaha_mt09' })).rejects.toThrow(/forbidden/);
    server.game.police.clearWanted(client.playerId);
    const v = await client.rpc('showroom.testDrive', { showroomId: 'moto', offerId: 'new:yamaha_mt09' });
    expect(v.modelId).toBe('yamaha_mt09');
    // Logging off hands it back.
    const car = testCar(client)!;
    client.close();
    const t0 = Date.now();
    while (server.game.state.vehicles.has(car.id) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    expect(server.game.state.vehicles.has(car.id)).toBe(false);
  }, 20_000);

  it('test-drive cars left over from a restart are removed', async () => {
    const { client } = await connectNew(server);
    const uow = server.game.state.begin();
    uow.createVehicle({ id: 'veh_leftover_test', modelId: 'rimac_nevera', ownerId: client.playerId, color: '#ffffff', mileage: 10, fuel: 100, condition: { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 }, mods: { ...DEFAULT_MODS }, status: 'testdrive', purchasePrice: 0, salePrice: null, plotId: null, slot: null, rotation: 0, x: 950, z: 60, serviceUntil: 0, createdAt: Date.now() });
    await uow.commit();
    await server.game.showrooms.init();
    expect(server.game.state.vehicles.has('veh_leftover_test')).toBe(false);
    client.close();
  });
});

// Special Nitro, air ride (K) and custom number plates against a real server.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { AIR_PART } from '../../shared/modificationsData';
import { KEY } from '../../shared/physics';
import { isCategoryUnlocked } from '../../shared/progression';
import { NITRO_ITEM } from '../../shared/rewards';
import { tuningOf } from '../../shared/tuningSystem';
import { VF, type PublicVehicle } from '../../shared/types';
import { getModel } from '../../shared/vehicles';
import { INTERACTABLES } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setMoney, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

const money = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;
const inv = (c: TestClient) => server.game.state.players.get(c.playerId)!.inventory;

async function buyCar(client: TestClient): Promise<string> {
  const { listings } = await client.rpc('market.list', {});
  const l = listings
    .filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind !== 'bike')
    .sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
  const uow = server.game.state.begin();
  const v = uow.vehicle(vehicle.id);
  v.condition = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
  v.fuel = 100;
  v.serviceUntil = 0;
  await uow.commit();
  return vehicle.id;
}

async function drive(client: TestClient, vehicleId: string): Promise<void> {
  await client.rpc('vehicle.spawn', { vehicleId });
  await client.rpc('vehicle.enter', { vehicleId });
}

describe('special nitro', () => {
  it('burns one shot from the inventory and shows blue flames to everyone', async () => {
    const { client } = await connectNew(server);
    const { client: other } = await connectNew(server);
    const vehicleId = await buyCar(client);
    expect(await client.rpcRaw('vehicle.nitro', {})).toMatchObject({ ok: false, code: 'conflict' });
    await drive(client, vehicleId);
    // None in the inventory.
    expect(await client.rpcRaw('vehicle.nitro', {})).toMatchObject({ ok: false, code: 'conflict' });
    const uow = server.game.state.begin();
    uow.player(client.playerId).inventory[NITRO_ITEM] = 2;
    await uow.commit();
    const r = await client.rpc('vehicle.nitro', {});
    expect(r).toEqual({ left: 1, seconds: ECONOMY.nitro.seconds });
    expect(inv(client)[NITRO_ITEM]).toBe(1);
    expect(server.game.sim.drives.get(vehicleId)!.dyn.nitro).toBeGreaterThan(ECONOMY.nitro.seconds - 1);
    // One at a time.
    expect(await client.rpcRaw('vehicle.nitro', {})).toMatchObject({ ok: false, code: 'conflict' });
    client.sendInputs(KEY.FORWARD, 10);
    const snap = await other.waitSnapshot((s) => s.v.some((v) => v[0] === vehicleId && (v[8] & VF.NITRO) !== 0));
    expect(snap).toBeTruthy();
    // It burns out.
    const until = Date.now() + (ECONOMY.nitro.seconds + 3) * 1000;
    while (Date.now() < until && (server.game.sim.drives.get(vehicleId)!.dyn.nitro ?? 0) > 0) {
      client.sendInputs(KEY.FORWARD, 6);
      await sleep(200);
    }
    expect(server.game.sim.drives.get(vehicleId)!.dyn.nitro).toBe(0);
    // The last shot goes too.
    await client.rpc('vehicle.nitro', {});
    expect(inv(client)[NITRO_ITEM]).toBeUndefined();
    client.close();
    other.close();
  }, 30_000);
});

describe('air ride', () => {
  it('needs the kit; K steps through normal, low and slammed, seen by everyone', async () => {
    const { client } = await connectNew(server);
    const { client: other } = await connectNew(server);
    const vehicleId = await buyCar(client);
    await drive(client, vehicleId);
    expect(await client.rpcRaw('vehicle.air', {})).toMatchObject({ ok: false, code: 'conflict' });
    const uow = server.game.state.begin();
    const v = uow.vehicle(vehicleId);
    const t = tuningOf(v.mods);
    v.mods.tuning = { ...t, perf: { ...t.perf, suspension: AIR_PART } };
    await uow.commit();
    expect((await client.rpc('vehicle.air', {})).level).toBe(1);
    expect(server.game.state.vehicles.get(vehicleId)!.mods.air).toBe(1);
    await other.waitFor<PublicVehicle>('vehicle.upsert', (u) => u.id === vehicleId && u.mods.air === 1);
    // The compressor needs a moment.
    expect(await client.rpcRaw('vehicle.air', {})).toMatchObject({ ok: false, code: 'rate_limited' });
    await sleep(550);
    expect((await client.rpc('vehicle.air', {})).level).toBe(2);
    await sleep(550);
    expect((await client.rpc('vehicle.air', {})).level).toBe(0);
    expect(server.game.state.vehicles.get(vehicleId)!.mods.air).toBeUndefined();
    await sleep(550);
    expect((await client.rpc('vehicle.air', { level: 2 })).level).toBe(2);
    await sleep(550);
    expect(await client.rpcRaw('vehicle.air', { level: 5 })).toMatchObject({ ok: false, code: 'bad_request' });
    // Saved with the car.
    const rows = await server.db.query('SELECT mods FROM vehicles WHERE id=$1', [vehicleId]);
    expect(JSON.parse(String(rows[0]!.mods)).air).toBe(2);
    client.close();
    other.close();
  });
});

describe('custom plates', () => {
  it('presses a plate at Chroma Customs for $2,500 and puts the original back for free', async () => {
    const { client } = await connectNew(server);
    const { client: stranger } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    const vehicleId = await buyCar(client);
    expect(await client.rpcRaw('vehicle.plate', { vehicleId, text: 'GETRICH' })).toMatchObject({ ok: false, code: 'too_far' });
    const custom = INTERACTABLES.find((i) => i.kind === 'custom')!;
    server.game.sim.teleport(client.playerId, custom.x, custom.z);
    server.game.sim.teleport(stranger.playerId, custom.x, custom.z);
    for (const bad of ['A', 'X'.repeat(12), '!!!', '34 AMK 34']) {
      expect(await client.rpcRaw('vehicle.plate', { vehicleId, text: bad }), bad).toMatchObject({ ok: false, code: 'bad_request' });
    }
    expect(await client.rpcRaw('vehicle.plate', { vehicleId, text: 42 })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await stranger.rpcRaw('vehicle.plate', { vehicleId, text: 'MINE' })).toMatchObject({ ok: false });
    const m0 = money(client);
    expect(await client.rpc('vehicle.plate', { vehicleId, text: ' 34 get  rich ' })).toEqual({ plate: '34 GET RICH' });
    expect(money(client)).toBe(m0 - ECONOMY.plates.price);
    expect(server.game.state.vehicles.get(vehicleId)!.mods.plate).toBe('34 GET RICH');
    expect(await client.rpcRaw('vehicle.plate', { vehicleId, text: '34 GET RICH' })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await client.rpc('vehicle.plate', { vehicleId, text: '' })).toEqual({ plate: null });
    expect(money(client)).toBe(m0 - ECONOMY.plates.price);
    expect(server.game.state.vehicles.get(vehicleId)!.mods.plate).toBeUndefined();
    client.close();
    stranger.close();
  });
});

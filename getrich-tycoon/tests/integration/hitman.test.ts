// Hitman contracts over real sockets: the contact in the alley hands out a drive-by (a passenger
// shoots up a venue from a moving car) or a hit (find and shoot a named mark); $1,000 each.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { HITMAN_ALLEY, type ContractView } from '../../shared/hitman';
import { passengerSeats } from '../../shared/passengers';
import { isCategoryUnlocked } from '../../shared/progression';
import { getModel } from '../../shared/vehicles';
import { BUILDINGS } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

const H = ECONOMY.hitman;
const cash = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;

async function give(playerId: string, items: Record<string, number>): Promise<void> {
  const uow = server.game.state.begin();
  Object.assign(uow.player(playerId).inventory, items);
  await uow.commit();
}

/** At the contact; take contracts until one of the wanted kind comes up. */
async function contract(client: TestClient, kind: ContractView['kind']): Promise<ContractView> {
  server.game.sim.teleport(client.playerId, HITMAN_ALLEY.contact.x, HITMAN_ALLEY.contact.z - 1.6);
  for (let i = 0; i < 40; i++) {
    const { contract: c } = await client.rpc('hitman.take', {});
    if (c.kind === kind) return c;
    await client.rpc('hitman.drop', {});
  }
  throw new Error(`no ${kind} contract`);
}

describe('hitman contracts', () => {
  it('only from the contact in the alley, one at a time', async () => {
    const { client } = await connectNew(server);
    expect(await client.rpcRaw('hitman.take', {})).toMatchObject({ ok: false, code: 'too_far' });
    const c = await contract(client, 'hit');
    expect(await client.rpcRaw('hitman.take', {})).toMatchObject({ ok: false, code: 'conflict' });
    expect((await client.rpc('hitman.info', {})).contract?.id).toBe(c.id);
    await client.rpc('hitman.drop', {});
    expect((await client.rpc('hitman.info', {})).contract).toBeNull();
    client.close();
  }, 30_000);

  it('a hit: the mark walks in the search area; shooting them pays $1,000', async () => {
    const { client } = await connectNew(server);
    const c = await contract(client, 'hit');
    const mark = server.game.sim.npcs.get(c.markId!)!;
    expect(mark).toBeDefined();
    expect(Math.hypot(mark.x - c.x, mark.z - c.z)).toBeLessThanOrEqual(c.radius);
    await give(client.playerId, { weapon_pistol: 1, ammo_pistol: 20 });
    await client.rpc('weapon.equip', { weapon: 'pistol' });
    const money0 = cash(client);
    let n = 1;
    let t = Date.now();
    while (server.game.sim.npcs.get(c.markId!)?.anim !== 6 && n < 12) {
      const m = server.game.sim.npcs.get(c.markId!)!;
      if (m.anim === 5) break;
      server.game.sim.teleport(client.playerId, m.x + 3, m.z);
      const me = server.game.sim.chars.get(client.playerId)!;
      server.game.combat.fire(client.playerId, ['pistol', me.x, 1.4, me.z, Math.atan2(m.x - me.x, m.z - me.z), -0.02, n++], (t += 500));
    }
    const done = await client.waitFor<{ reward: number }>('hitman.done', () => true, 5000);
    expect(done.reward).toBe(H.reward);
    await sleep(200);
    expect(cash(client)).toBe(money0 + H.reward);
    expect((await client.rpc('hitman.info', {})).contract).toBeNull();
    server.game.police.clearWanted(client.playerId);
    client.close();
  }, 30_000);

  it('a drive-by: the passenger of a moving car shoots up the venue; standing still does not count', async () => {
    const { client: driver } = await connectNew(server);
    const { client: gunner } = await connectNew(server);
    const start = { ...server.game.sim.chars.get(driver.playerId)! };
    const c = await contract(driver, 'driveby');
    // A car with a passenger seat.
    const { listings } = await driver.rpc('market.list', {});
    const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && passengerSeats(getModel(x.vehicle.modelId)) > 0 && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
    const { vehicle } = await driver.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
    const venue = BUILDINGS.find((b) => Math.abs((b.box.minX + b.box.maxX) / 2 - c.x) < 0.2 && Math.abs((b.box.minZ + b.box.maxZ) / 2 - c.z) < 0.2)!;
    const at = { x: venue.box.minX - 7, z: c.z };
    // Out of the alley first: there is no room to park a car in it.
    server.game.sim.teleport(driver.playerId, start.x, start.z);
    await driver.rpc('vehicle.spawn', { vehicleId: vehicle.id });
    await driver.rpc('vehicle.enter', { vehicleId: vehicle.id });
    const d = server.game.sim.drives.get(vehicle.id)!;
    server.game.sim.placeDrive(vehicle.id, at.x, at.z, 0);
    server.game.sim.teleport(gunner.playerId, at.x + 1.8, at.z);
    await gunner.rpc('vehicle.ride', { vehicleId: vehicle.id });
    await give(gunner.playerId, { weapon_pistol: 1, ammo_pistol: 40 });
    await gunner.rpc('weapon.equip', { weapon: 'pistol' });
    const shoot = (n: number, t: number) => server.game.combat.fire(gunner.playerId, ['pistol', d.dyn.x, 1.4, d.dyn.z, Math.PI / 2, 0, n], t);
    // Parked: no count.
    d.dyn.speed = 0;
    let t = Date.now();
    expect(shoot(1, (t += 500))).toBe(true);
    await sleep(100);
    expect((await driver.rpc('hitman.info', {})).contract?.hits).toBe(0);
    // Rolling past: every hit counts, and the sixth pays the driver who took the job.
    const money0 = cash(driver);
    for (let i = 0; i < H.drivebyHits; i++) {
      d.dyn.speed = 5;
      expect(shoot(10 + i, (t += 500))).toBe(true);
    }
    const done = await driver.waitFor<{ reward: number }>('hitman.done', () => true, 5000);
    expect(done.reward).toBe(H.reward);
    await sleep(200);
    expect(cash(driver)).toBe(money0 + H.reward);
    server.game.police.clearWanted(driver.playerId);
    driver.close();
    gunner.close();
  }, 30_000);
});

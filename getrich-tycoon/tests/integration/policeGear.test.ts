// Police kit over real sockets: spike strips ahead of a 3-star driver, tyres bursting on one (the
// car on its rims until the tyres are repaired), and the helicopter (tracking, losing you under
// cover, shot down).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { isCategoryUnlocked } from '../../shared/progression';
import { KEY } from '../../shared/physics';
import { getModel } from '../../shared/vehicles';
import { INTERACTABLES } from '../../shared/world';
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

async function driveCar(client: TestClient): Promise<string> {
  const { listings } = await client.rpc('market.list', {});
  const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
  const uow = server.game.state.begin();
  const v = uow.vehicle(vehicle.id);
  v.condition = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
  v.fuel = 100;
  uow.player(client.playerId).money = 50_000;
  await uow.commit();
  await client.rpc('vehicle.spawn', { vehicleId: vehicle.id });
  await client.rpc('vehicle.enter', { vehicleId: vehicle.id });
  return vehicle.id;
}

describe('spike strips', () => {
  it('3 stars bring a strip down the road ahead; driving over it bursts the tyres until they are repaired', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await driveCar(client);
    // North up the x = 50 street, wanted at 3 stars.
    server.game.sim.placeDrive(vehicleId, 50, 60, Math.PI);
    server.game.police.raiseHeat(client.playerId, 250);
    // Spike strips are for a pursuit: the police have seen the car.
    server.game.police.engageNow(client.playerId);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Çivili barikat!', 12_000);
    const snap = await client.waitSnapshot((s) => (s.sp?.length ?? 0) > 0, 3000);
    const [, sx, sz] = snap.sp![0]!;
    expect(sx).toBeCloseTo(50, 0);
    expect(sz).toBeLessThan(server.game.sim.drives.get(vehicleId)!.dyn.z);
    // The strip stays when the police are gone; line up 30 m before it and drive at it.
    server.game.police.clearWanted(client.playerId);
    server.game.sim.placeDrive(vehicleId, sx, sz + 30, Math.PI);
    const t0 = Date.now();
    while (Date.now() - t0 < 12_000 && !server.game.state.vehicles.get(vehicleId)!.mods.blown) {
      client.sendInputs(KEY.FORWARD, 3);
      await sleep(100);
    }
    const v = server.game.state.vehicles.get(vehicleId)!;
    expect(v.mods.blown).toBe(true);
    expect(v.condition.tires).toBe(0);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'LASTİKLER PATLADI!', 3000);
    expect(server.game.sim.drives.get(vehicleId)!.params.pt.latGrip).toBeLessThan(0.2);
    // The tyres are fixed at Wrench Bros.
    await client.rpc('vehicle.exit', {});
    const shop = INTERACTABLES.find((i) => i.kind === 'repair')!;
    server.game.sim.teleport(client.playerId, shop.x, shop.z);
    await client.rpc('repair.start', { vehicleId, parts: ['tires'], useKits: false });
    expect(server.game.state.vehicles.get(vehicleId)!.mods.blown).toBeUndefined();
    client.close();
  }, 40_000);

  it('the helicopter tracks a 3-star player, loses them under cover and can be shot down', async () => {
    const { client } = await connectNew(server);
    const police = server.game.police;
    server.game.sim.teleport(client.playerId, -26, 40);
    police.raiseHeat(client.playerId, 250);
    police.engageNow(client.playerId);
    // It takes off a few seconds into the pursuit and flies over.
    await client.waitFor<{ title: string }>('notify', (n) => n.title === '🚁 Polis helikopteri yolda!', 9000);
    const h = police.heliOf(client.playerId)!;
    expect(h).toBeDefined();
    expect(h.y).toBeGreaterThan(30);
    await client.waitFor<{ heli?: string }>('police.wanted', (w) => w.heli === 'seen', 8000);
    const snap = await client.waitSnapshot((sn) => (sn.ph?.length ?? 0) > 0, 3000);
    expect(snap.ph![0]![0]).toBe(h.id);
    // Into the car wash tunnel: after a while it loses you.
    server.game.sim.teleport(client.playerId, -26, 77);
    (h as { lostT: number }).lostT = ECONOMY.police.heli.lostSec - 0.3;
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Helikopter izini kaybetti', 5000);
    await client.waitFor<{ heli?: string }>('police.wanted', (w) => w.heli === 'lost', 3000);
    // Out in the open again, and a rifle shot at it.
    server.game.sim.teleport(client.playerId, -26, 40);
    await sleep(300);
    const uow = server.game.state.begin();
    Object.assign(uow.player(client.playerId).inventory, { weapon_rifle: 1, ammo_rifle: 30 });
    await uow.commit();
    await client.rpc('weapon.equip', { weapon: 'rifle' });
    const c = server.game.sim.chars.get(client.playerId)!;
    // (Overhead: it starts far out and closes in.)
    Object.assign(h, { x: c.x + 20, z: c.z + 5, y: ECONOMY.police.heli.altitude });
    const hp0 = h.hp;
    const yaw = Math.atan2(h.x - c.x, h.z - c.z);
    const pitch = Math.atan2(h.y - 1.5, Math.hypot(h.x - c.x, h.z - c.z));
    expect(server.game.combat.fire(client.playerId, ['rifle', c.x, 1.5, c.z, yaw, pitch, 1], Date.now())).toBe(true);
    expect(h.hp).toBeLessThan(hp0);
    // Finished off: it comes down, blows up, and no new one comes for a while.
    expect(police.damageHeli(h.id, 10_000)).toBe(true);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === '🚁 Helikopter düşürüldü!', 3000);
    await client.waitFor('combat.explosion', () => true, 10_000);
    expect(police.heliOf(client.playerId)).toBeUndefined();
    await sleep(500);
    expect(police.heliOf(client.playerId)).toBeUndefined();
    police.clearWanted(client.playerId);
    client.close();
  }, 40_000);
});

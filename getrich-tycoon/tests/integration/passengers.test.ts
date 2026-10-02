// Riding along: a player gets into a car someone else is driving, is carried with it, and gets out
// again (or is let out when the driver gets out).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KEY } from '../../shared/physics';
import { passengerSeats } from '../../shared/passengers';
import { isCategoryUnlocked } from '../../shared/progression';
import { getModel } from '../../shared/vehicles';
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

/** Buy the cheapest car with passenger seats, bring it out and get in. */
async function driveCar(client: TestClient): Promise<string> {
  const { listings } = await client.rpc('market.list', {});
  const l = listings
    .filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && passengerSeats(getModel(x.vehicle.modelId)) > 0)
    .sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
  const uow = server.game.state.begin();
  const v = uow.vehicle(vehicle.id);
  v.condition = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
  v.fuel = 100;
  await uow.commit();
  await client.rpc('vehicle.spawn', { vehicleId: vehicle.id });
  await client.rpc('vehicle.enter', { vehicleId: vehicle.id });
  return vehicle.id;
}

/** Stand a player beside a car. */
function besideCar(client: TestClient, vehicleId: string): void {
  const d = server.game.sim.drives.get(vehicleId);
  const v = server.game.state.vehicles.get(vehicleId)!;
  const at = d ? { x: d.dyn.x, z: d.dyn.z, rot: d.dyn.rot } : { x: v.x, z: v.z, rot: v.rotation };
  server.game.sim.teleport(client.playerId, at.x + Math.cos(at.rot) * 2.2, at.z - Math.sin(at.rot) * 2.2);
}

describe('passengers', () => {
  it('rides along in someone else’s car, moves with it and gets out', async () => {
    const { client: driver } = await connectNew(server);
    const { client: rider } = await connectNew(server);
    const vehicleId = await driveCar(driver);
    // Nobody drives a parked car; you can't ride in your own.
    expect(await driver.rpcRaw('vehicle.ride', { vehicleId })).toMatchObject({ ok: false, code: 'conflict' });
    // Too far away (new players appear around the same spot, so move the rider off first).
    const at = server.game.sim.drives.get(vehicleId)!.dyn;
    server.game.sim.teleport(rider.playerId, at.x + 30, at.z + 30);
    expect(await rider.rpcRaw('vehicle.ride', { vehicleId })).toMatchObject({ ok: false, code: 'too_far' });
    besideCar(rider, vehicleId);
    const r = await rider.rpc('vehicle.ride', { vehicleId });
    expect(r.seat).toBe(0);
    const c = server.game.sim.chars.get(rider.playerId)!;
    expect(c.ridingId).toBe(vehicleId);
    // Both see it: the rider's own snapshot and everyone's player list.
    const own = await rider.waitSnapshot((s) => s.self?.[5] === vehicleId);
    expect(own.self?.[6]).toBe(0);
    await driver.waitSnapshot((s) => s.p.some((p) => p[0] === rider.playerId && p[6] === vehicleId && p[7] === 0));
    // A passenger can't take the wheel of their own car or steer this one.
    expect(await rider.rpcRaw('vehicle.ride', { vehicleId })).toMatchObject({ ok: false, code: 'conflict' });
    rider.sendInputs(KEY.FORWARD | KEY.LEFT, 6);
    // The driver drives off and takes the passenger along.
    const start = { ...server.game.sim.drives.get(vehicleId)!.dyn };
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      driver.sendInputs(KEY.FORWARD, 3);
      await sleep(100);
    }
    const d = server.game.sim.drives.get(vehicleId)!;
    expect(Math.hypot(d.dyn.x - start.x, d.dyn.z - start.z)).toBeGreaterThan(3);
    await rider.waitSnapshot((s) => !!s.self && Math.hypot(s.self[0] - d.dyn.x, s.self[1] - d.dyn.z) < 3);
    // Getting in while it moves is refused for a second passenger.
    const { client: late } = await connectNew(server);
    besideCar(late, vehicleId);
    expect(await late.rpcRaw('vehicle.ride', { vehicleId })).toMatchObject({ ok: false, code: 'conflict' });
    // Stop, and the passenger gets out on the right-hand side.
    const t1 = Date.now();
    while (Date.now() - t1 < 4000 && Math.abs(server.game.sim.drives.get(vehicleId)!.dyn.speed) > 0.2) {
      driver.sendInputs(KEY.BRAKE, 3);
      await sleep(100);
    }
    const out = await rider.rpc('vehicle.exit', {});
    expect(c.ridingId).toBeNull();
    const car = server.game.sim.drives.get(vehicleId)!.dyn;
    expect(Math.hypot(out.x - car.x, out.z - car.z)).toBeGreaterThan(1);
    expect(Math.hypot(out.x - car.x, out.z - car.z)).toBeLessThan(5);
    await rider.waitSnapshot((s) => s.self?.[5] == null);
    driver.close();
    rider.close();
    late.close();
  }, 30_000);

  it('fills the free seats and lets everyone out when the driver gets out', async () => {
    const { client: driver } = await connectNew(server);
    const vehicleId = await driveCar(driver);
    const seats = passengerSeats(getModel(server.game.state.vehicles.get(vehicleId)!.modelId));
    const riders: TestClient[] = [];
    for (let i = 0; i < seats; i++) {
      const { client } = await connectNew(server);
      besideCar(client, vehicleId);
      const r = await client.rpc('vehicle.ride', { vehicleId });
      expect(r.seat).toBe(i);
      riders.push(client);
    }
    const { client: extra } = await connectNew(server);
    besideCar(extra, vehicleId);
    expect(await extra.rpcRaw('vehicle.ride', { vehicleId })).toMatchObject({ ok: false, code: 'conflict' });
    // A passenger can't do things that need you on foot.
    expect(await riders[0]!.rpcRaw('vehicle.enter', { vehicleId })).toMatchObject({ ok: false });
    // The driver gets out: everybody is out, standing beside the car.
    await driver.rpc('vehicle.exit', {});
    const v = server.game.state.vehicles.get(vehicleId)!;
    for (const r of riders) {
      const c = server.game.sim.chars.get(r.playerId)!;
      expect(c.ridingId).toBeNull();
      expect(Math.hypot(c.x - v.x, c.z - v.z)).toBeLessThan(6);
    }
    expect(server.game.sim.ridersOf(vehicleId)).toHaveLength(0);
    // Riding needs a driver.
    besideCar(extra, vehicleId);
    expect(await extra.rpcRaw('vehicle.ride', { vehicleId })).toMatchObject({ ok: false, code: 'conflict' });
    for (const r of [driver, extra, ...riders]) r.close();
  }, 30_000);

  it('partners in crime: a crime by anyone in the car makes everyone in it wanted', async () => {
    const { client: driver } = await connectNew(server);
    const { client: rider } = await connectNew(server);
    const { client: bystander } = await connectNew(server);
    const vehicleId = await driveCar(driver);
    besideCar(rider, vehicleId);
    await rider.rpc('vehicle.ride', { vehicleId });
    const police = server.game.police;
    expect(police.crew(rider.playerId).sort()).toEqual([driver.playerId, rider.playerId].sort());
    // The passenger commits the crime; the driver is just as wanted, the player outside isn't.
    police.raiseHeat(rider.playerId, 250);
    expect(police.starsOf(driver.playerId)).toBe(3);
    expect(police.starsOf(rider.playerId)).toBe(3);
    expect(police.starsOf(bystander.playerId)).toBe(0);
    // And the other way round.
    police.addHeat(driver.playerId, 100);
    expect(police.starsOf(rider.playerId)).toBe(4);
    await rider.waitFor<{ stars: number }>('police.wanted', (w) => w.stars === 4, 5000);
    for (const c of [driver, rider, bystander]) c.close();
  }, 30_000);
});

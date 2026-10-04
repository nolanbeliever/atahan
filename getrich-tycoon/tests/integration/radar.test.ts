// Bridge speed radars: a car passing under a gantry gets its speed measured, a personal best is
// saved, and the server record is reported.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RadarFlash } from '../../shared/protocol';
import { isCategoryUnlocked } from '../../shared/progression';
import { KEY } from '../../shared/physics';
import { BRIDGES, RADARS } from '../../shared/strait';
import { getModel } from '../../shared/vehicles';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, startServer, type TestClient } from '../helpers/server';

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
  await uow.commit();
  await client.rpc('vehicle.spawn', { vehicleId: vehicle.id });
  await client.rpc('vehicle.enter', { vehicleId: vehicle.id });
  return vehicle.id;
}

describe('bridge speed radars', () => {
  it('measures a pass under the gantry and keeps the best', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await driveCar(client);
    const b = BRIDGES[0]!;
    const radar = RADARS.find((r) => r.n === b.n)!;
    // Up on the deck, 30 m before the gantry, heading east at speed.
    server.game.sim.placeDrive(vehicleId, radar.x - 30, b.z - 5, Math.PI / 2, b.n);
    const d = server.game.sim.drives.get(vehicleId)!;
    d.dyn.speed = 30;
    d.dyn.gear = 4;
    const t0 = Date.now();
    let flash: RadarFlash | undefined;
    while (!flash && Date.now() - t0 < 6000) {
      client.sendInputs(KEY.FORWARD, 3);
      await new Promise((r) => setTimeout(r, 100));
      flash = client.events.find((e) => e.event === 'radar.flash')?.data as RadarFlash | undefined;
    }
    expect(flash).toBeDefined();
    expect(flash!.radar).toBe(radar.id);
    expect(flash!.kmh).toBeGreaterThan(60);
    expect(flash!.newBest).toBe(true);
    expect(flash!.record?.kmh).toBe(flash!.kmh);
    expect(server.game.state.players.get(client.playerId)!.stats.radarBest).toBe(flash!.kmh);
    // The server record is theirs now.
    expect(server.game.radar.record()?.kmh).toBe(flash!.kmh);
    client.close();
  }, 30_000);
});

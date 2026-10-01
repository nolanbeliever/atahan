// Illegal street races against a real server: joining at the start line, the grid and the countdown,
// checkpoints in order, the $20,000 prize and the police, a DNF, and a race nobody came to.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { starsFor } from '../../server/game/services/police';
import { isCategoryUnlocked } from '../../shared/progression';
import { gridSlot, raceRoute, type StreetRaceView } from '../../shared/streetRace';
import { getModel } from '../../shared/vehicles';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const R = ECONOMY.streetRace;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

type Internals = { race: { view: StreetRaceView } | null; nextAt: number };
const svc = () => server.game.streetRace as unknown as Internals;
const money = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;

async function driveCar(client: TestClient): Promise<string> {
  const { listings } = await client.rpc('market.list', {});
  const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
  const uow = server.game.state.begin();
  const v = uow.vehicle(vehicle.id);
  v.fuel = 100;
  v.serviceUntil = 0;
  await uow.commit();
  await client.rpc('vehicle.spawn', { vehicleId: vehicle.id });
  await client.rpc('vehicle.enter', { vehicleId: vehicle.id });
  return vehicle.id;
}

/** Skip the join window: the countdown starts on the next tick. */
function skipToCountdown(): void {
  svc().race!.view.startsAt = Date.now() + R.countdownSec * 1000 + 150;
}

describe('street races', () => {
  it('join at the start line, grid and countdown, checkpoints in order, the winner takes $20,000 and the police come', async () => {
    const { client } = await connectNew(server);
    const { client: watcher } = await connectNew(server);
    const vehicleId = await driveCar(client);
    const route = raceRoute('downtown')!;
    expect(await client.rpcRaw('race.join', {})).toMatchObject({ ok: false, code: 'conflict' });
    server.game.streetRace.open(Date.now(), 'downtown');
    const opened = await watcher.waitFor<StreetRaceView>('race.update', (v) => v?.phase === 'open');
    expect(opened.routeId).toBe('downtown');
    expect(opened.prize).toBe(20_000);
    // Too far from the start line.
    expect(await client.rpcRaw('race.join', {})).toMatchObject({ ok: false, code: 'too_far' });
    const start = route.points[0]!;
    server.game.sim.placeDrive(vehicleId, start.x, start.z - 10, 0);
    const joined = await client.rpc('race.join', {});
    expect(joined.race.racers.map((r) => r.id)).toEqual([client.playerId]);
    expect(await client.rpcRaw('race.join', {})).toMatchObject({ ok: false, code: 'conflict' });
    // Countdown: on the grid, held, bots fill the field.
    skipToCountdown();
    const counting = await client.waitFor<StreetRaceView>('race.update', (v) => v?.phase === 'countdown', 3000);
    expect(counting.racers.length).toBeGreaterThanOrEqual(R.fieldSize);
    expect(counting.racers.filter((r) => r.bot).length).toBeGreaterThanOrEqual(2);
    const d = server.game.sim.drives.get(vehicleId)!;
    const slot = gridSlot(route, 0);
    expect(Math.hypot(d.dyn.x - slot.x, d.dyn.z - slot.z)).toBeLessThan(1);
    expect(d.hold).toBe(true);
    // Green light: released; a few seconds later the police are on to it.
    await client.waitFor<StreetRaceView>('race.update', (v) => v?.phase === 'racing', R.countdownSec * 1000 + 2000);
    expect(d.hold).toBe(false);
    const heat = () => (server.game.police as unknown as { wanted: Map<string, { heat: number }> }).wanted.get(client.playerId)?.heat ?? 0;
    expect(heat()).toBe(0);
    svc().race!.view.startsAt -= R.policeDelaySec * 1000;
    await sleep(150);
    expect(starsFor(heat())).toBeGreaterThanOrEqual(2);
    // Skipping a checkpoint doesn't count.
    const m0 = money(client);
    server.game.sim.placeDrive(vehicleId, route.points[2]!.x, route.points[2]!.z, 0);
    await sleep(150);
    expect(svc().race!.view.racers.find((r) => r.id === client.playerId)!.next).toBe(1);
    for (let i = 1; i < route.points.length; i++) {
      server.game.sim.placeDrive(vehicleId, route.points[i]!.x, route.points[i]!.z, 0);
      await sleep(120);
    }
    const me = svc().race!.view.racers.find((r) => r.id === client.playerId)!;
    expect(me.place).toBe(1);
    await sleep(200);
    expect(money(client)).toBe(m0 + R.prize);
    const { transactions } = await client.rpc('transactions', {});
    expect(transactions.find((t) => t.kind === 'race')?.amount).toBe(R.prize);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'SOKAK YARIŞINI KAZANDIN!');
    // The only human is done: results, then the race is over.
    const results = await watcher.waitFor<StreetRaceView>('race.update', (v) => v?.phase === 'results', 3000);
    expect(results.racers.find((r) => r.place === 1)?.id).toBe(client.playerId);
    svc().race!.view.endsAt = Date.now();
    await watcher.waitFor('race.update', (v) => v === null, 3000);
    expect(svc().nextAt).toBeGreaterThan(Date.now() + (R.intervalSec - 5) * 1000);
    client.close();
    watcher.close();
  }, 30_000);

  it('getting out of the car is a DNF; a race nobody joins is called off', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await driveCar(client);
    server.game.streetRace.open(Date.now(), 'eastside');
    const start = raceRoute('eastside')!.points[0]!;
    server.game.sim.placeDrive(vehicleId, start.x + 8, start.z, 0);
    await client.rpc('race.join', {});
    skipToCountdown();
    await client.waitFor<StreetRaceView>('race.update', (v) => v?.phase === 'racing', R.countdownSec * 1000 + 3000);
    await client.rpc('vehicle.exit', {});
    const out = await client.waitFor<StreetRaceView>('race.update', (v) => !!v?.racers.find((r) => r.id === client.playerId)?.dnf, 3000);
    expect(out.racers.find((r) => r.id === client.playerId)!.place).toBeNull();
    // No humans left racing: results.
    await client.waitFor<StreetRaceView>('race.update', (v) => v?.phase === 'results', 3000);
    svc().race!.view.endsAt = Date.now();
    await client.waitFor('race.update', (v) => v === null, 3000);
    // Nobody comes.
    client.events = [];
    server.game.streetRace.open(Date.now(), 'westside');
    skipToCountdown();
    await client.waitFor('race.update', (v) => v === null, 3000);
    expect(svc().race).toBeNull();
    client.close();
  }, 30_000);
});

// Highway (traffic, near misses, combo) and the drag strip against a real server over sockets.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DragRaceView } from '../../shared/drag';
import { ECONOMY } from '../../shared/economy.config';
import { DRAG_STRIP, STRAIGHT_LEN, CORNER_LEN, deltaS, laneOffset, pathPoint, pathYaw, travelDir, wrapS } from '../../shared/highway';
import { KEY } from '../../shared/physics';
import type { NearMissEvent } from '../../shared/protocol';
import { isCategoryUnlocked } from '../../shared/progression';
import { getModel } from '../../shared/vehicles';
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

/** Buy the cheapest car, park it next to the player and get in. */
async function driveNewCar(client: TestClient): Promise<string> {
  const { listings } = await client.rpc('market.list', {});
  // A car (a motorcycle that rams traffic throws its rider off instead).
  const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
  // Market cars can be wrecks: put it in perfect shape so it can reach highway speeds.
  const uow = server.game.state.begin();
  const v = uow.vehicle(vehicle.id);
  v.condition = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
  v.fuel = 100;
  await uow.commit();
  await client.rpc('vehicle.spawn', { vehicleId: vehicle.id });
  await client.rpc('vehicle.enter', { vehicleId: vehicle.id });
  return vehicle.id;
}

/** Feed inputs in real time (the server only accepts as much simulated time as has passed). */
async function drive(client: TestClient, keys: () => number, ms: number, until?: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (until?.()) return;
    client.sendInputs(keys(), 3);
    await sleep(100);
  }
}

const races = (client: TestClient) => client.events.filter((e) => e.event === 'drag.update' && e.data).map((e) => e.data as DragRaceView);

async function waitStripFree(): Promise<void> {
  const start = Date.now();
  while (server.game.drag.info().race && Date.now() - start < 40_000) await sleep(100);
}

const cash = (client: TestClient) => server.game.state.players.get(client.playerId)!.money;

describe('drag strip', () => {
  it('needs a car at the strip and the entry fee', async () => {
    const { client } = await connectNew(server);
    expect(await client.rpcRaw('drag.join', { mode: 'bot' })).toMatchObject({ ok: false, code: 'conflict' });
    await setMoney(server, client.playerId, 100_000);
    await driveNewCar(client);
    expect(await client.rpcRaw('drag.join', { mode: 'bot' })).toMatchObject({ ok: false, code: 'too_far' });
    expect(await client.rpcRaw('drag.join', { mode: 'turbo' })).toMatchObject({ ok: false, code: 'bad_request' });
    const d = [...server.game.sim.drives.values()].find((x) => x.playerId === client.playerId)!;
    server.game.sim.placeDrive(d.vehicleId, DRAG_STRIP.stage.x, DRAG_STRIP.stage.z, DRAG_STRIP.yaw);
    await setMoney(server, client.playerId, 100);
    expect(await client.rpcRaw('drag.join', { mode: 'bot' })).toMatchObject({ ok: false, code: 'insufficient_funds' });
    client.close();
  });

  it('a false start loses the entry', async () => {
    await waitStripFree();
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    const vehicleId = await driveNewCar(client);
    server.game.sim.placeDrive(vehicleId, DRAG_STRIP.stage.x, DRAG_STRIP.stage.z, DRAG_STRIP.yaw);
    const money0 = cash(client);
    await client.rpc('drag.join', { mode: 'bot' });
    expect(cash(client)).toBe(money0 - ECONOMY.drag.entryFee);
    // Lined up in lane 0 at the start line, held while staging.
    const d = server.game.sim.drives.get(vehicleId)!;
    expect(d.dyn.x).toBeCloseTo(DRAG_STRIP.laneX[0], 5);
    expect(d.hold).toBe(true);
    await drive(client, () => KEY.BRAKE, 8000, () => races(client).some((r) => r.lights >= 1));
    // Go on the first red light.
    await drive(client, () => KEY.FORWARD, 6000, () => races(client).some((r) => r.racers[0]!.result?.outcome === 'false_start'));
    const fouled = races(client).find((r) => r.racers[0]!.result?.outcome === 'false_start');
    expect(fouled, 'false start detected').toBeDefined();
    expect(fouled!.greenAt ?? 0).toBe(0);
    await drive(client, () => KEY.BRAKE, 25_000, () => races(client).some((r) => r.phase === 'finished'));
    const done = races(client).find((r) => r.phase === 'finished')!;
    expect(done.winner).not.toBe(0);
    await sleep(500);
    expect(cash(client)).toBe(money0 - ECONOMY.drag.entryFee);
    client.close();
  }, 90_000);

  it('races a matched bot: lights, times, and the pool to the winner', async () => {
    await waitStripFree();
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    const vehicleId = await driveNewCar(client);
    server.game.sim.placeDrive(vehicleId, DRAG_STRIP.stage.x, DRAG_STRIP.stage.z, DRAG_STRIP.yaw);
    const money0 = cash(client);
    const raceStart = Date.now() - 1000;
    const info = await client.rpc('drag.join', { mode: 'bot' });
    expect(info.race?.racers).toHaveLength(2);
    expect(info.race?.racers[1]!.bot).toBe(true);
    // Hold the brake through the reds, launch on green.
    await drive(client, () => (races(client).some((r) => r.lights === 4) ? KEY.FORWARD : KEY.BRAKE), 30_000, () => races(client).some((r) => r.phase === 'finished'));
    const seen = new Set(races(client).map((r) => r.lights));
    for (const l of [1, 2, 3, 4]) expect(seen.has(l), `light ${l}`).toBe(true);
    const done = races(client).find((r) => r.phase === 'finished')!;
    const me = done.racers[0]!;
    expect(me.result?.outcome).toBe('finished');
    // A quarter mile: ~10 s for a supercar, ~18 s for a small hatchback.
    expect(me.result!.et!).toBeGreaterThan(8);
    expect(me.result!.et!).toBeLessThan(24);
    expect(me.result!.trapKmh!).toBeGreaterThan(80);
    expect(me.zeroTo100).toBeGreaterThan(0);
    await sleep(600);
    const won = done.winner === 0;
    // Driving bonuses (paid every 10 s of driving) may land during the run, and the win pays the "Christmas Tree" mission
    // when it is one of the player's missions today.
    const { transactions } = await client.rpc('transactions', {});
    const bonus = transactions.filter((t) => (t.kind === 'drive_bonus' || t.kind === 'mission') && t.createdAt >= raceStart).reduce((a, t) => a + t.amount, 0);
    expect(cash(client)).toBe(money0 - ECONOMY.drag.entryFee + (won ? ECONOMY.drag.prize : 0) + bonus);
    client.close();
  }, 90_000);
});

describe('highway', () => {
  it('streams traffic and pays for a near miss, and a crash resets the combo', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 50_000);
    let seen = 0;
    client.socket.on('snapshot', (s) => (seen = Math.max(seen, s.tr?.length ?? 0)));
    const vehicleId = await driveNewCar(client);
    const t0 = Date.now();
    while (seen < 20 && Date.now() - t0 < 5000) await sleep(50);
    expect(seen).toBeGreaterThan(20);

    // Pick a car on a straight in the inner carriageway's lane 1 with clear road in lane 0 ahead.
    const traffic = server.game.sim.traffic;
    const seg = STRAIGHT_LEN + CORNER_LEN;
    // Pass it in the lane to its left, 30 cm from its side (a near miss is 50 cm or less).
    const clearLeft = (c: (typeof traffic.cars)[number]) =>
      !traffic.cars.some((o) => o !== c && o.spec.cw === 0 && Math.abs(o.off - laneOffset(0, c.lane - 1)) < 3.2 && deltaS(c.s - 40, o.s) > -5 && deltaS(c.s - 40, o.s) < 90);
    const pick = () =>
      traffic.cars.find((c) => {
        if (c.spec.cw !== 0 || c.lane < 1 || c.off !== c.toff || c.pendingLane !== null || c.spec.kind !== 'car') return false;
        const u = c.s % seg;
        return u > 60 && u < 220 && clearLeft(c);
      });
    // Traffic keeps moving: wait for a suitable gap if there is none right now.
    let target = pick();
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      target = pick();
    }
    expect(target, 'a traffic car to pass').toBeDefined();
    const car = target!;
    const d = server.game.sim.drives.get(vehicleId)!;
    const off = car.off + car.spec.width / 2 + d.params.halfWidth + 0.3;
    const s0 = wrapS(car.s - 22 * travelDir(0));
    const p = pathPoint(s0, off);
    server.game.sim.placeDrive(vehicleId, p.x, p.z, pathYaw(p, false));
    d.dyn.speed = Math.min(d.params.topSpeed * 0.95, 34);
    d.dyn.gear = d.params.pt.gears.length;
    const money0 = server.game.state.players.get(client.playerId)!.money;
    await drive(client, () => KEY.FORWARD, 4000, () => client.events.some((e) => e.event === 'highway.nearmiss'));
    const nm = client.events.find((e) => e.event === 'highway.nearmiss')?.data as NearMissEvent | undefined;
    expect(nm, 'near miss').toBeDefined();
    expect(nm!.amount).toBe(ECONOMY.highway.nearMissReward);
    expect(nm!.combo).toBe(1);
    expect(nm!.gap).toBeLessThan(ECONOMY.highway.nearMissClearance);
    // Paid out in the next batch.
    const start = Date.now();
    while (server.game.state.players.get(client.playerId)!.money === money0 && Date.now() - start < 4000) await sleep(100);
    expect(server.game.state.players.get(client.playerId)!.money).toBe(money0 + ECONOMY.highway.nearMissReward);
    expect(server.game.highway.comboOf(client.playerId)?.count).toBe(1);

    // Ram a traffic car from behind: crash -> combo reset.
    const victim = traffic.cars.find((c) => c.spec.cw === 0 && c.off === c.toff && (c.s % seg) > 40 && (c.s % seg) < 250)!;
    const q = pathPoint(wrapS(victim.s - (victim.spec.length / 2 + 6)), victim.off);
    server.game.sim.placeDrive(vehicleId, q.x, q.z, pathYaw(q, false));
    d.dyn.speed = 30;
    d.dyn.gear = d.params.pt.gears.length;
    await drive(client, () => KEY.FORWARD, 3000, () => client.events.some((e) => e.event === 'highway.combo'));
    const end = client.events.find((e) => e.event === 'highway.combo')?.data as { reason: string; count: number } | undefined;
    expect(end).toMatchObject({ reason: 'crash', count: 1 });
    expect(server.game.highway.comboOf(client.playerId)).toBeUndefined();
    client.close();
  }, 30_000);

  it('rejects out-of-range input keys but accepts the horn', async () => {
    const { client } = await connectNew(server);
    const c = server.game.sim.chars.get(client.playerId)!;
    client.sendInputs(KEY.HORN, 2);
    await sleep(300);
    expect(c.hornAt).toBeGreaterThan(0);
    const seq = c.lastSeq;
    client.sendInputs(512, 2);
    await sleep(300);
    expect(c.lastSeq).toBe(seq);
    client.close();
  });
});

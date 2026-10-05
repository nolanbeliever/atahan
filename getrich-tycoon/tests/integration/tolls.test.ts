// Bridge tolls, number-plate cameras, Black Market plate gear and the police checkpoints.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { KMH_PER_MS } from '../../shared/drivetrain';
import { KEY } from '../../shared/physics';
import { findShowroom, newShowroomCar } from '../../shared/showrooms';
import { BRIDGES } from '../../shared/strait';
import { ANPR_CAMERAS, TOLL_PLAZAS, TOLL_X, checkpointPlan, type TollEvent } from '../../shared/tolls';
import { newId } from '../../server/ids';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setMoney, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stored car of the player's (made directly: the market's cheap stock runs out over many tests). */
async function ownCar(client: TestClient): Promise<string> {
  const id = newId('veh');
  const uow = server.game.state.begin();
  uow.createVehicle({ ...newShowroomCar('norda_arlo', '#29335c', id), ownerId: client.playerId, status: 'stored', createdAt: Date.now() });
  await uow.commit();
  return id;
}

async function driveCar(client: TestClient): Promise<string> {
  const id = await ownCar(client);
  await client.rpc('vehicle.spawn', { vehicleId: id });
  await client.rpc('vehicle.enter', { vehicleId: id });
  return id;
}

/** Put the car at (x, z) heading `rot` at `kmh` (real) and roll/drive it for a while. */
async function run(client: TestClient, vehicleId: string, x: number, z: number, rot: number, kmh: number, deck = 0, keys = 0, ms = 2500): Promise<void> {
  server.game.sim.placeDrive(vehicleId, x, z, rot, deck);
  const d = server.game.sim.drives.get(vehicleId)!;
  d.dyn.speed = kmh / KMH_PER_MS;
  d.dyn.gear = kmh > 60 ? 4 : 2;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    client.sendInputs(keys, 3);
    await sleep(100);
  }
}

async function setMods(vehicleId: string, mods: Record<string, unknown>): Promise<void> {
  const uow = server.game.state.begin();
  const v = uow.vehicle(vehicleId);
  v.mods = { ...v.mods, ...mods };
  await uow.commit();
}

const events = (c: TestClient, kind?: string) => c.events.filter((e) => e.event === 'toll.event').map((e) => e.data as TollEvent).filter((e) => !kind || e.kind === kind);

describe('bridge tolls', () => {
  it('heading over to the far shore slowly: the arm lifts and $250 is paid; westbound is free', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 10_000);
    const vid = await driveCar(client);
    const p = TOLL_PLAZAS[0]!;
    const before = server.game.state.players.get(client.playerId)!.money;
    await run(client, vid, TOLL_X - 6, p.east[1]!, Math.PI / 2, 25);
    const paid = await client.waitFor<TollEvent>('toll.event', (e) => e.kind === 'toll');
    expect(paid.amount).toBe(-ECONOMY.tolls.fee);
    expect(paid.text).toContain('İyi Yolculuklar');
    expect(server.game.state.players.get(client.playerId)!.money).toBe(before - ECONOMY.tolls.fee);
    await client.waitFor('toll.pass', (d: { evaded: boolean }) => !d.evaded);
    // Back the other way: no charge.
    await run(client, vid, TOLL_X + 6, p.west[1]!, -Math.PI / 2, 25);
    expect(events(client, 'toll')).toHaveLength(1);
    const { events: history } = await client.rpc('toll.history', {});
    expect(history[0]!.kind).toBe('toll');
    client.close();
  }, 30_000);

  it('blasting through the arm is an evasion: a $1,500 fine', async () => {
    const { client } = await connectNew(server);
    const vid = await driveCar(client);
    await setMoney(server, client.playerId, 10_000);
    const p = TOLL_PLAZAS[1]!;
    await run(client, vid, TOLL_X - 14, p.east[0]!, Math.PI / 2, 95, 0, KEY.FORWARD, 1500);
    const fine = await client.waitFor<TollEvent>('toll.event', (e) => e.kind === 'evasion');
    expect(fine.amount).toBe(-ECONOMY.tolls.evasionFine);
    expect(server.game.state.players.get(client.playerId)!.money).toBe(10_000 - ECONOMY.tolls.evasionFine);
    const { transactions } = await client.rpc('transactions', {});
    expect(transactions.some((t) => t.kind === 'toll_fine' && t.amount === -ECONOMY.tolls.evasionFine)).toBe(true);
    client.close();
  }, 30_000);
});

describe('number-plate cameras', () => {
  const cam = ANPR_CAMERAS.find((c) => c.deck > 0)!;
  const b = BRIDGES[cam.n - 1]!;

  it('a car with a theft record gets a star; a fake plate reads clean; a flipped plate is not read', async () => {
    const { client } = await connectNew(server);
    const vid = await driveCar(client);
    await setMods(vid, { hot: true });
    await run(client, vid, cam.x - 12, b.z + 5, Math.PI / 2, 40, b.n);
    const hit = await client.waitFor<TollEvent>('toll.event', (e) => e.kind === 'anpr' && e.stars > 0);
    expect(hit.plate).toBeTruthy();
    expect(server.game.police.starsOf(client.playerId)).toBe(1);
    server.game.police.clearWanted(client.playerId);
    // A fake plate: the camera reads it, finds nothing.
    await setMods(vid, { fakePlate: '06 ZZ 4242' });
    await run(client, vid, cam.x + 12, b.z - 5, -Math.PI / 2, 40, b.n);
    expect(server.game.police.starsOf(client.playerId)).toBe(0);
    // A flipped plate (on the other camera): unreadable.
    const cam2 = ANPR_CAMERAS.find((c) => c.deck > 0 && c.id !== cam.id)!;
    const b2 = BRIDGES[cam2.n - 1]!;
    await setMods(vid, { fakePlate: undefined, plateFlipped: true, flipper: true });
    await run(client, vid, cam2.x - 12, b2.z + 5, Math.PI / 2, 40, b2.n);
    const miss = await client.waitFor<TollEvent>('toll.event', (e) => e.kind === 'anpr' && e.stars === 0);
    expect(miss.text).toContain('okuyamadı');
    expect(server.game.police.starsOf(client.playerId)).toBe(0);
    client.close();
  }, 40_000);

  it('the Black Market fits a plate flipper (P while driving) and a fake plate, only at its door', async () => {
    const { client } = await connectNew(server);
    const vid = await ownCar(client);
    await setMoney(server, client.playerId, 50_000);
    await expect(client.rpc('showroom.plateGear', { vehicleId: vid, item: 'flipper' })).rejects.toThrow(/too_far/);
    const bm = findShowroom('blackmarket')!;
    server.game.sim.teleport(client.playerId, bm.door.x, bm.door.z);
    const r1 = await client.rpc('showroom.plateGear', { vehicleId: vid, item: 'flipper' });
    expect(r1.vehicle.mods.flipper).toBe(true);
    await expect(client.rpc('showroom.plateGear', { vehicleId: vid, item: 'flipper' })).rejects.toThrow(/conflict/);
    const r2 = await client.rpc('showroom.plateGear', { vehicleId: vid, item: 'fake' });
    expect(r2.vehicle.mods.fakePlate).toMatch(/^\d{2} [A-Z]{2} \d{3,4}$/);
    expect(server.game.state.players.get(client.playerId)!.money).toBe(50_000 - ECONOMY.tolls.flipperPrice - ECONOMY.tolls.fakePlatePrice);
    // Again: the fake plate comes off (free).
    const r3 = await client.rpc('showroom.plateGear', { vehicleId: vid, item: 'fake' });
    expect(r3.vehicle.mods.fakePlate).toBeUndefined();
    // P while driving turns the plate away and back.
    await client.rpc('vehicle.spawn', { vehicleId: vid });
    await client.rpc('vehicle.enter', { vehicleId: vid });
    expect((await client.rpc('vehicle.flipPlate', {})).flipped).toBe(true);
    expect(server.game.state.vehicles.get(vid)!.mods.plateFlipped).toBe(true);
    expect((await client.rpc('vehicle.flipPlate', {})).flipped).toBe(false);
    client.close();
  }, 30_000);
});

describe('police checkpoints', () => {
  it('a wanted driver who drives onto a bridge finds a checkpoint at the far end; getting through pays', async () => {
    const { client } = await connectNew(server);
    const vid = await driveCar(client);
    const start = server.game.state.players.get(client.playerId)!.money;
    const b = BRIDGES[1]!;
    server.game.police.raiseHeat(client.playerId, 200);
    // In a pursuit (the police have seen the car): a checkpoint waits at the bridge.
    server.game.police.engageNow(client.playerId);
    // Onto the bridge from the city end, heading east.
    await run(client, vid, b.x0 - 6, b.z + 4, Math.PI / 2, 50, 0, KEY.FORWARD, 2500);
    const cp = await client.waitFor<{ n: number; dir: number }>('police.checkpoint');
    expect(cp.n).toBe(b.n);
    expect(cp.dir).toBe(1);
    const set = server.game.police.checkpointOf(client.playerId)!;
    expect(set.units).toHaveLength(4);
    for (const u of set.units) expect(u.dyn.deck).toBe(b.n);
    // Ram the outer car (no spikes out there) at speed.
    const plan = checkpointPlan(b, 1);
    const outer = set.units.reduce((a, u) => (u.dyn.z > a.dyn.z ? u : a));
    const was = { x: outer.dyn.x, z: outer.dyn.z };
    await run(client, vid, plan.x - 9, outer.dyn.z, Math.PI / 2, 70, b.n, KEY.FORWARD, 2500);
    expect(Math.hypot(outer.dyn.x - was.x, outer.dyn.z - was.z)).toBeGreaterThan(1);
    // Past the line on the deck: through.
    server.game.sim.placeDrive(vid, plan.x + 12, b.z, Math.PI / 2, b.n);
    const through = await client.waitFor<{ reward: number }>('police.breakthrough');
    expect(through.reward).toBe(ECONOMY.tolls.checkpoint.reward);
    await sleep(300);
    expect(server.game.state.players.get(client.playerId)!.money).toBeGreaterThanOrEqual(start + ECONOMY.tolls.checkpoint.reward - ECONOMY.tolls.fee);
    expect(events(client, 'checkpoint').length + events(client, 'breakthrough').length).toBeGreaterThanOrEqual(2);
    client.close();
  }, 40_000);
});

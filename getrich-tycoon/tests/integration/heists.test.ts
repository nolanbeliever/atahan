// Heists over real sockets: E at a target's door (armed, on foot) brings the police straight away;
// the work runs at the door; done, the loot is in the bag until the police are lost, then it is
// dirty money (saved with the player). Busted takes it; walking off ends the job; targets cool down.
// The showroom job: drive the hypercar into the docks.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { HEIST_CAR_SPAWN, HEIST_DROP, findHeist, type HeistView } from '../../shared/heists';
import type { WantedState } from '../../shared/police';
import type { CrimeView } from '../../shared/underworld';
import * as repo from '../../server/db/repo';
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

const H = ECONOMY.heists;

async function armed(client: TestClient): Promise<void> {
  const uow = server.game.state.begin();
  uow.player(client.playerId).inventory.weapon_pistol = 1;
  await uow.commit();
}

async function atDoor(client: TestClient, id: Parameters<typeof findHeist>[0]): Promise<void> {
  const h = findHeist(id)!;
  server.game.sim.teleport(client.playerId, h.stand.x, h.stand.z);
  await sleep(150);
}

/** Lose the police at once (as if hidden for the whole countdown). */
function escape(playerId: string): void {
  const police = server.game.police as unknown as { escaped(pid: string, w: unknown): Promise<void> };
  void police.escaped(playerId, server.game.police.wantedOf(playerId));
}

function job(client: TestClient) {
  return server.game.heists.jobOf(client.playerId) as unknown as { done: number; away: number; phase: string; loot: number; carId?: string; heist: { workSec: number } } | undefined;
}

describe('heists', () => {
  it('needs a gun, feet on the ground and the door', async () => {
    const { client } = await connectNew(server);
    await atDoor(client, 'supermarket');
    expect(await client.rpcRaw('heist.start', { heistId: 'supermarket' })).toMatchObject({ ok: false, code: 'conflict' });
    await armed(client);
    server.game.sim.teleport(client.playerId, 0, 20);
    await sleep(100);
    expect(await client.rpcRaw('heist.start', { heistId: 'supermarket' })).toMatchObject({ ok: false, code: 'too_far' });
    expect(await client.rpcRaw('heist.start', { heistId: 'nope' })).toMatchObject({ ok: false, code: 'bad_request' });
    client.close();
  });

  it('a supermarket job: police at once, the work at the door, the loot dirty once the police are lost', async () => {
    const { client } = await connectNew(server);
    await armed(client);
    await atDoor(client, 'supermarket');
    const h = findHeist('supermarket')!;
    const view = await client.rpc('heist.start', { heistId: 'supermarket' });
    expect(view).toMatchObject({ id: 'supermarket', phase: 'work', atDoor: true });
    await client.waitFor<{ id: string; on: boolean }>('heist.alarm', (a) => a.id === 'supermarket' && a.on);
    const w = await client.waitFor<WantedState>('police.wanted', (x) => x.stars >= h.stars);
    expect(w.stars).toBe(h.stars);
    // The work goes on at the door.
    await sleep(1200);
    expect(job(client)!.done).toBeGreaterThan(0.6);
    // Nearly done: done.
    job(client)!.done = h.workSec - 0.2;
    const done = await client.waitFor<{ loot: number }>('heist.done', () => true, 4000);
    expect(done.loot).toBeGreaterThanOrEqual(h.loot[0]);
    expect(done.loot).toBeLessThanOrEqual(h.loot[1]);
    const bag = await client.waitFor<HeistView>('heist.update', (v) => v?.phase === 'escape');
    expect(bag.loot).toBe(done.loot);
    // A second job on the same target has to wait.
    expect(await client.rpcRaw('heist.start', { heistId: 'supermarket' })).toMatchObject({ ok: false });
    // Lost the police: dirty money, saved.
    const money0 = server.game.state.players.get(client.playerId)!.money;
    escape(client.playerId);
    const cashed = await client.waitFor<{ amount: number }>('heist.cashed', () => true, 4000);
    expect(cashed.amount).toBe(done.loot);
    const crime = await client.waitFor<CrimeView>('crime.update', (c) => c.dirty > 0);
    expect(crime).toMatchObject({ dirty: done.loot, heists: 1, bestHeist: done.loot });
    // Dirty money isn't cash.
    expect(server.game.state.players.get(client.playerId)!.money).toBeGreaterThanOrEqual(money0);
    expect(server.game.state.players.get(client.playerId)!.money).toBeLessThan(money0 + done.loot);
    const saved = (await repo.loadCrime(server.game.state.db, client.playerId)) as { dirty: number };
    expect(saved.dirty).toBe(done.loot);
    expect(server.game.heists.jobOf(client.playerId)).toBeUndefined();
    client.close();
  }, 30_000);

  it('busted with the loot: the police take it', async () => {
    const { client } = await connectNew(server);
    await armed(client);
    await atDoor(client, 'realestate');
    await client.rpc('heist.start', { heistId: 'realestate' });
    job(client)!.done = findHeist('realestate')!.workSec;
    const done = await client.waitFor<{ loot: number }>('heist.done', () => true, 4000);
    const police = server.game.police as unknown as { bust(pid: string, w: unknown, me: unknown): Promise<void> };
    const c = server.game.sim.chars.get(client.playerId)!;
    await police.bust(client.playerId, server.game.police.wantedOf(client.playerId), { x: c.x, z: c.z, rot: 0, vehicleId: null, hl: 0.4, hw: 0.4 });
    const lost = await client.waitFor<{ reason: string; amount: number }>('heist.lost', () => true, 4000);
    expect(lost).toMatchObject({ reason: 'busted', amount: done.loot });
    expect(server.game.crime.view(client.playerId).dirty).toBe(0);
    client.close();
  }, 30_000);

  it('walking off ends the job', async () => {
    const { client } = await connectNew(server);
    await armed(client);
    await atDoor(client, 'office');
    await client.rpc('heist.start', { heistId: 'office' });
    server.game.sim.teleport(client.playerId, 100, 60);
    await sleep(300);
    expect(job(client)!.done).toBeLessThan(1);
    job(client)!.away = H.abortSec - 0.2;
    const lost = await client.waitFor<{ reason: string }>('heist.lost', () => true, 4000);
    expect(lost.reason).toBe('failed');
    expect(server.game.heists.jobOf(client.playerId)).toBeUndefined();
    client.close();
  }, 30_000);

  it('the showroom job: the hypercar waits outside, the docks pay', async () => {
    const { client } = await connectNew(server);
    await armed(client);
    await atDoor(client, 'dealership');
    await client.rpc('heist.start', { heistId: 'dealership' });
    job(client)!.done = findHeist('dealership')!.workSec;
    const drive = await client.waitFor<HeistView>('heist.update', (v) => v?.phase === 'drive', 4000);
    expect(drive.drop).toMatchObject({ x: HEIST_DROP.x, z: HEIST_DROP.z });
    const carId = drive.carId!;
    const car = server.game.state.vehicles.get(carId)!;
    expect(car).toMatchObject({ ownerId: client.playerId, status: 'stolen' });
    // Out through the bollards, in, and into the docks.
    server.game.sim.teleport(client.playerId, HEIST_CAR_SPAWN.x, HEIST_CAR_SPAWN.z + 2.6);
    await sleep(150);
    await client.rpc('vehicle.enter', { vehicleId: carId });
    server.game.sim.placeDrive(carId, HEIST_DROP.x, HEIST_DROP.z, 0);
    const done = await client.waitFor<{ loot: number }>('heist.done', () => true, 4000);
    const h = findHeist('dealership')!;
    expect(done.loot).toBeGreaterThanOrEqual(h.loot[0]);
    expect(server.game.state.vehicles.has(carId)).toBe(false);
    escape(client.playerId);
    const cashed = await client.waitFor<{ amount: number }>('heist.cashed', () => true, 4000);
    expect(cashed.amount).toBe(done.loot);
    client.close();
  }, 30_000);
});

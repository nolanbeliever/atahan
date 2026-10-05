// Police checkpoints over real sockets: the warning, stopping at the line for the papers / boot
// check, "Temiz, geçebilirsin"; the K9 dog barking at goods on you (2 stars, the stop's cars give
// chase); goods in the hidden compartment smelled only 15% of the time; running the stop (2 stars);
// turning back once warned (reported: 1 star, a call).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { KEY } from '../../shared/physics';
import { isCategoryUnlocked } from '../../shared/progression';
import type { StopState } from '../../shared/trafficStops';
import { getModel } from '../../shared/vehicles';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const S = ECONOMY.police.stops;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

async function driveCar(client: TestClient): Promise<string> {
  const { listings } = await client.rpc('market.list', {});
  const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind === 'car').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
  const uow = server.game.state.begin();
  uow.player(client.playerId).money = 50_000;
  await uow.commit();
  await client.rpc('vehicle.spawn', { vehicleId: vehicle.id });
  await client.rpc('vehicle.enter', { vehicleId: vehicle.id });
  return vehicle.id;
}

/** Drive up to the stop at Merkez Cadde (x 0, z -50, along x) from the west and get warned. */
async function approach(client: TestClient, vid: string): Promise<StopState> {
  server.game.sim.placeDrive(vid, -45, -50, Math.PI / 2);
  server.game.sim.drives.get(vid)!.dyn.speed = 6;
  return client.waitFor<StopState>('stop.state', (s) => s.phase === 'warn', 3000);
}

/** Stop at the line and hold the brake until the check is over. */
async function stopAtLine(client: TestClient, vid: string, until: (s: StopState) => boolean, ms = 14_000): Promise<StopState> {
  server.game.sim.placeDrive(vid, -4, -50, Math.PI / 2);
  const end = Date.now() + ms;
  let hit: StopState | undefined;
  while (!hit && Date.now() < end) {
    client.sendInputs(KEY.BRAKE, 3);
    await sleep(100);
    hit = client.events.map((e) => e).filter((e) => e.event === 'stop.state').map((e) => e.data as StopState).find(until);
  }
  expect(hit, 'stop result').toBeDefined();
  return hit!;
}

async function setGoods(id: string, grams: number): Promise<void> {
  const uow = server.game.state.begin();
  const inv = uow.player(id).inventory;
  if (grams > 0) inv.deal_goods = grams;
  else delete inv.deal_goods;
  await uow.commit();
}

describe('police checkpoints', () => {
  it('warned, stopped at the line, the papers and the boot checked, then waved on', async () => {
    const { client } = await connectNew(server);
    const vid = await driveCar(client);
    server.game.stops.open('merkez_cadde', false);
    const list = await client.waitFor<{ id: string }[]>('stop.list', (l) => l.some((s) => s.id === 'merkez_cadde'));
    expect(list.length).toBeGreaterThan(0);
    // Two patrol cars with their lights on, two officers.
    const stop = server.game.stops.get('merkez_cadde')!;
    expect(stop.units).toHaveLength(2);
    expect(stop.officers).toHaveLength(2);
    expect(server.game.stops.cones('merkez_cadde').length).toBeGreaterThan(20);
    const warn = await approach(client, vid);
    expect(warn.name).toBe('Merkez Cadde');
    const check = await stopAtLine(client, vid, (s) => s.phase === 'check');
    expect(check.k9).toBe(false);
    const clear = await stopAtLine(client, vid, (s) => s.phase === 'clear' || s.phase === 'caught');
    expect(clear.phase).toBe('clear');
    expect(clear.text).toContain('Temiz');
    expect(server.game.police.starsOf(client.playerId)).toBe(0);
    client.close();
  }, 40_000);

  it('the K9 dog barks at goods on you: 2 stars and the stop cars give chase; in the hidden compartment it smells them 15% of the time', async () => {
    server.game.stops.closeAll();
    server.game.stops.open('merkez_cadde', true);
    // Goods in the hidden compartment, and the dog having a bad day (above 15%).
    const { client } = await connectNew(server);
    const vid = await driveCar(client);
    const uow = server.game.state.begin();
    const v = uow.vehicle(vid);
    v.mods = { ...v.mods, stash: true, stashGrams: 40 };
    await uow.commit();
    const rng = server.game.ctx.rng;
    server.game.ctx.rng = () => S.k9Stash + 0.05;
    await approach(client, vid);
    const sniff = await stopAtLine(client, vid, (s) => s.phase === 'check');
    expect(sniff.k9).toBe(true);
    // The dog goes round the car, nose down.
    const dog = server.game.stops.get('merkez_cadde')!.dog!;
    const end = Date.now() + 8000;
    while (dog.npc.anim !== 9 && Date.now() < end) {
      client.sendInputs(KEY.BRAKE, 3);
      await sleep(100);
    }
    const passed = await stopAtLine(client, vid, (s) => s.phase === 'clear' || s.phase === 'caught');
    expect(passed.phase).toBe('clear');
    expect(server.game.police.starsOf(client.playerId)).toBe(0);
    server.game.ctx.rng = rng;
    // Now with goods on you (in the open): the dog barks every time.
    client.close();
    const { client: c2 } = await connectNew(server);
    const vid2 = await driveCar(c2);
    await setGoods(c2.playerId, 20);
    await sleep(200);
    await approach(c2, vid2);
    const caught = await stopAtLine(c2, vid2, (s) => s.phase === 'caught' || s.phase === 'clear');
    expect(caught.phase).toBe('caught');
    expect(caught.k9).toBe(true);
    await c2.waitFor('stop.bark', () => true, 2000);
    expect(server.game.police.starsOf(c2.playerId)).toBe(2);
    const w = server.game.police.wantedOf(c2.playerId) as unknown as { engaged: boolean; units: unknown[] };
    expect(w.engaged).toBe(true);
    expect(w.units.length).toBe(2);
    expect(server.game.stops.get('merkez_cadde')!.units).toHaveLength(0);
    c2.close();
  }, 60_000);

  it('running through without stopping is 2 stars; turning back once warned is seen and reported (1 star, a call)', async () => {
    server.game.stops.closeAll();
    server.game.stops.open('otoban_dogu', false);
    // otoban_dogu: x 180, z 50, along x. Through it from the city side.
    const { client } = await connectNew(server);
    const vid = await driveCar(client);
    server.game.sim.placeDrive(vid, 135, 50, Math.PI / 2);
    server.game.sim.drives.get(vid)!.dyn.speed = 8;
    await client.waitFor<StopState>('stop.state', (s) => s.phase === 'warn', 3000);
    server.game.sim.placeDrive(vid, 192, 50, Math.PI / 2);
    server.game.sim.drives.get(vid)!.dyn.speed = 15;
    const ran = await client.waitFor<StopState>('stop.state', (s) => s.phase === 'evaded', 3000);
    expect(ran.text).toContain('2 yıldız');
    expect(server.game.police.starsOf(client.playerId)).toBe(2);
    client.close();
    // A U-turn 40 m short of it.
    const { client: c2 } = await connectNew(server);
    const vid2 = await driveCar(c2);
    server.game.sim.placeDrive(vid2, 125, 50, Math.PI / 2);
    server.game.sim.drives.get(vid2)!.dyn.speed = 8;
    await c2.waitFor<StopState>('stop.state', (s) => s.phase === 'warn', 3000);
    server.game.sim.placeDrive(vid2, 140, 50, Math.PI / 2);
    await sleep(200);
    server.game.sim.placeDrive(vid2, 112, 50, -Math.PI / 2);
    server.game.sim.drives.get(vid2)!.dyn.speed = 10;
    const back = await c2.waitFor<StopState>('stop.state', (s) => s.phase === 'uturn', 3000);
    expect(back.text).toContain('ihbar');
    expect(server.game.police.starsOf(c2.playerId)).toBe(1);
    const w = server.game.police.wantedOf(c2.playerId) as unknown as { engaged: boolean; call: unknown };
    expect(w.engaged).toBe(false);
    expect(w.call).toBeTruthy();
    c2.close();
  }, 40_000);
});

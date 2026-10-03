// Motorcycles over real sockets: a friend on the back shoots while you ride, a flipped wheelie or a
// fast crash throws you off (WASTED without a helmet, 60% less damage with one), and Moto Gear
// sells helmets and visors.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOTO_GEAR } from '../../shared/compounds';
import { DEFAULT_MODS } from '../../shared/customization';
import { KMH_PER_MS } from '../../shared/drivetrain';
import { ECONOMY } from '../../shared/economy.config';
import { crashDamage } from '../../shared/helmets';
import { KEY } from '../../shared/physics';
import { newId } from '../../server/ids';
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

const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

/** A new bike in the player's garage, brought out and ridden. */
async function rideBike(client: TestClient, modelId = 'yamaha_mt09'): Promise<string> {
  const uow = server.game.state.begin();
  const v = uow.createVehicle({
    id: newId('veh'), modelId, ownerId: client.playerId, color: '#1f4fa0', mileage: 10, fuel: 100, condition: { ...PERFECT }, mods: { ...DEFAULT_MODS },
    status: 'stored', purchasePrice: 0, salePrice: null, plotId: null, slot: null, rotation: 0, x: 0, z: 0, serviceUntil: 0, createdAt: Date.now(),
  });
  await uow.commit();
  await client.rpc('vehicle.spawn', { vehicleId: v.id });
  await client.rpc('vehicle.enter', { vehicleId: v.id });
  return v.id;
}

async function give(playerId: string, items: Record<string, number>, money?: number): Promise<void> {
  const uow = server.game.state.begin();
  const p = uow.player(playerId);
  Object.assign(p.inventory, items);
  if (money !== undefined) p.money = money;
  await uow.commit();
}

/** Stand a player beside a vehicle. */
function beside(client: TestClient, vehicleId: string): void {
  const d = server.game.sim.drives.get(vehicleId)!.dyn;
  server.game.sim.teleport(client.playerId, d.x + Math.cos(d.rot) * 1.6, d.z - Math.sin(d.rot) * 1.6);
}

const shotFrom = (c: { x: number; z: number }, yaw: number, n: number) => ['pistol', c.x, 1.5, c.z, yaw, 0, n];

describe('motorcycles', () => {
  it('a friend rides on the back and shoots; the rider can shoot any gun too', async () => {
    const { client: driver } = await connectNew(server);
    const { client: rider } = await connectNew(server);
    const bike = await rideBike(driver);
    beside(rider, bike);
    const r = await rider.rpc('vehicle.ride', { vehicleId: bike });
    expect(r.seat).toBe(0);
    // Only one seat on the back.
    const { client: third } = await connectNew(server);
    beside(third, bike);
    expect(await third.rpcRaw('vehicle.ride', { vehicleId: bike })).toMatchObject({ ok: false, code: 'conflict' });
    await give(rider.playerId, { weapon_pistol: 1, ammo_pistol: 30 });
    await rider.rpc('weapon.equip', { weapon: 'pistol' });
    // The bike rides off (the passenger sends no input of their own) and the passenger shoots
    // backwards from where the bike is now.
    const start = { ...server.game.sim.drives.get(bike)!.dyn };
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) {
      driver.sendInputs(KEY.FORWARD, 3);
      await sleep(100);
    }
    const d = server.game.sim.drives.get(bike)!.dyn;
    expect(Math.hypot(d.x - start.x, d.z - start.z)).toBeGreaterThan(8);
    expect(server.game.combat.fire(rider.playerId, shotFrom(d, Math.PI, 1), Date.now())).toBe(true);
    // Not from where they got on.
    expect(server.game.combat.fire(rider.playerId, shotFrom(start, Math.PI, 2), Date.now() + 1000)).toBe(false);
    expect(server.game.combat.ammoLeft(rider.playerId, 'ammo_pistol')).toBe(29);
    // The rider shoots too, with any gun (one hand on the bars): the shotgun as well as the pistol.
    await give(driver.playerId, { weapon_pistol: 1, ammo_pistol: 5, weapon_shotgun: 1, ammo_shells: 5 });
    await driver.rpc('weapon.equip', { weapon: 'shotgun' });
    expect(server.game.combat.fire(driver.playerId, ['shotgun', d.x, 1.5, d.z, 0, 0, 1], Date.now() + 2000)).toBe(true);
    await driver.rpc('weapon.equip', { weapon: 'pistol' });
    const now = server.game.sim.drives.get(bike)!.dyn;
    expect(server.game.combat.fire(driver.playerId, shotFrom(now, 0, 2), Date.now() + 3000)).toBe(true);
    // The shots are heard: the whole crew is wanted.
    expect(server.game.police.starsOf(driver.playerId)).toBeGreaterThanOrEqual(2);
    expect(server.game.police.starsOf(rider.playerId)).toBe(server.game.police.starsOf(driver.playerId));
    for (const x of [driver, rider, third]) x.close();
  }, 30_000);

  it('a flipped wheelie at speed without a helmet is WASTED; everyone comes off', async () => {
    const { client } = await connectNew(server);
    const bike = await rideBike(client);
    const d = server.game.sim.drives.get(bike)!;
    // Right at the flipping point at 90 km/h, still holding the wheelie key.
    Object.assign(d.dyn, { speed: 90 / KMH_PER_MS, gear: 4, wheelie: ECONOMY.bikes.wheelieFlip - 0.01, wheelieV: 1 });
    client.sendInputs(KEY.FORWARD | KEY.SPRINT, 4);
    const crash = await client.waitFor<{ riders: { id: string; helmet: boolean; damage: number }[]; flipped: boolean }>('moto.crash', () => true, 5000);
    expect(crash.flipped).toBe(true);
    expect(crash.riders[0]).toMatchObject({ id: client.playerId, helmet: false });
    await client.waitFor('combat.wasted', () => true, 5000);
    await sleep(300);
    const c = server.game.sim.chars.get(client.playerId)!;
    expect(c.drivingId).toBeNull();
    expect(server.game.sim.drives.has(bike)).toBe(false);
    client.close();
  }, 30_000);

  it('Moto Gear sells helmets and visors (at the shop); a helmet takes 60% off', async () => {
    const { client } = await connectNew(server);
    await give(client.playerId, {}, 20_000);
    // Away from the shop: no sale.
    expect(await client.rpcRaw('helmet.buy', { kind: 'helmet', id: 'premium' })).toMatchObject({ ok: false, code: 'too_far' });
    server.game.sim.teleport(client.playerId, MOTO_GEAR.door.x, MOTO_GEAR.door.z);
    expect(await client.rpcRaw('helmet.buy', { kind: 'helmet', id: 'astronaut' })).toMatchObject({ ok: false, code: 'bad_request' });
    const a = await client.rpc('helmet.buy', { kind: 'helmet', id: 'premium' });
    expect(a.appearance).toMatchObject({ helmet: 'premium', visor: 'clear' });
    const v = await client.rpc('helmet.buy', { kind: 'visor', id: 'iridium' });
    expect(v.appearance.visor).toBe('iridium');
    expect(server.game.state.players.get(client.playerId)!.money).toBe(20_000 - 3_500 - 400);
    expect(await client.rpcRaw('helmet.buy', { kind: 'helmet', id: 'premium' })).toMatchObject({ ok: false, code: 'conflict' });
    // Can't wear what you don't own; the profile's look keeps the helmet.
    expect(await client.rpcRaw('helmet.wear', { helmet: 'cross', visor: 'clear' })).toMatchObject({ ok: false });
    const w = await client.rpc('helmet.wear', { helmet: 'premium', visor: 'iridium', color: '#c1121f' });
    expect(w.appearance.helmetColor).toBe('#c1121f');
    const look = server.game.state.players.get(client.playerId)!.appearance;
    await client.rpc('appearance.save', { appearance: { skin: look.skin, shirt: look.shirt, pants: look.pants, hair: look.hair } });
    expect(server.game.state.players.get(client.playerId)!.appearance.helmet).toBe('premium');
    // A fast crash with the helmet: hurt, not killed.
    const bike = await rideBike(client, 'ktm_duke390');
    server.game.moto.crash(bike, 90, false);
    const crash = await client.waitFor<{ riders: { id: string; helmet: boolean; damage: number }[] }>('moto.crash', () => true, 5000);
    expect(crash.riders[0]).toMatchObject({ helmet: true, damage: crashDamage(90, true, 100) });
    await sleep(200);
    expect(server.game.combat.healthView(client.playerId).hp).toBe(100 - crashDamage(90, true, 100));
    expect(server.game.sim.chars.get(client.playerId)!.dead).toBeFalsy();
    client.close();
  }, 30_000);
});

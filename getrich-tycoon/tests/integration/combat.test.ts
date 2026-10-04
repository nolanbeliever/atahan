// Guns and fights against a real server: Ammu-Nation, shots and ammo, car damage up to the engine
// blowing, crimes and the police, officers shooting back, WASTED and the hospital.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AMMU_NATION, HOSPITAL } from '../../shared/compounds';
import { ECONOMY } from '../../shared/economy.config';
import { starsFor } from '../../server/game/services/police';
import { isCategoryUnlocked } from '../../shared/progression';
import { VIP_COIN } from '../../shared/rewards';
import { LOCKPICK_ITEM, partItemId } from '../../shared/theft';
import { Anim } from '../../shared/types';
import { getModel } from '../../shared/vehicles';
import { STARTER_ROUNDS, damageLook, weapon, weaponItem, type HealthView, type ShotFx } from '../../shared/weapons';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setMoney, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const C = ECONOMY.combat;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

const money = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;
const inv = (c: TestClient) => server.game.state.players.get(c.playerId)!.inventory;
const heat = (c: TestClient) => (server.game.police as unknown as { wanted: Map<string, { heat: number }> }).wanted.get(c.playerId)?.heat ?? 0;
type Combat = { peds: Map<string, { npc: { id: string; x: number; z: number; anim: number }; deadAt: number; hp: number }>; officers: Map<string, { npc: { id: string; anim: number }; target: string }>; lastShot: Map<string, number> };
const combat = () => server.game.combat as unknown as Combat;

let shotNo = 1;
/** Fire at a point from where the player stands (chest height). */
function fireAt(c: TestClient, gun: string, x: number, y: number, z: number): void {
  const me = server.game.sim.chars.get(c.playerId)!;
  const oy = 1.35;
  const yaw = Math.atan2(x - me.x, z - me.z);
  const pitch = Math.atan2(y - oy, Math.hypot(x - me.x, z - me.z));
  combat().lastShot.delete(c.playerId);
  server.game.combat.fire(c.playerId, [gun, me.x, oy, me.z, yaw, pitch, shotNo++]);
}

async function buyGun(c: TestClient, gun: string): Promise<void> {
  server.game.sim.teleport(c.playerId, AMMU_NATION.door.x, AMMU_NATION.door.z);
  await c.rpc('ammu.buy', { item: weaponItem(weapon(gun)!.id) });
  await c.rpc('weapon.equip', { weapon: weapon(gun)!.id });
}

/** Stand somewhere open, away from people (a quiet corner of the green belt). */
function standClear(c: TestClient): { x: number; z: number } {
  const at = { x: 190, z: 120 };
  server.game.sim.teleport(c.playerId, at.x, at.z);
  return at;
}

describe('Ammu-Nation', () => {
  it('sells guns for cash, premium guns for VIP Coins only, and ammo boxes', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    expect(await client.rpcRaw('ammu.buy', { item: 'weapon_pistol' })).toMatchObject({ ok: false, code: 'too_far' });
    server.game.sim.teleport(client.playerId, AMMU_NATION.door.x, AMMU_NATION.door.z);
    const m0 = money(client);
    await client.rpc('ammu.buy', { item: 'weapon_pistol' });
    expect(money(client)).toBe(m0 - 5_000);
    expect(inv(client).weapon_pistol).toBe(1);
    expect(inv(client).ammo_pistol).toBe(STARTER_ROUNDS);
    expect(await client.rpcRaw('ammu.buy', { item: 'weapon_pistol' })).toMatchObject({ ok: false, code: 'conflict' });
    await client.rpc('ammu.buy', { item: 'ammo_pistol' });
    expect(inv(client).ammo_pistol).toBe(STARTER_ROUNDS + 36);
    // Premium: not for cash.
    expect(await client.rpcRaw('ammu.buy', { item: 'weapon_gold_deagle' })).toMatchObject({ ok: false, code: 'insufficient_funds' });
    const uow = server.game.state.begin();
    uow.player(client.playerId).inventory[VIP_COIN] = 25;
    await uow.commit();
    const m1 = money(client);
    await client.rpc('ammu.buy', { item: 'weapon_gold_deagle' });
    expect(money(client)).toBe(m1);
    expect(inv(client)[VIP_COIN]).toBe(5);
    expect(await client.rpcRaw('ammu.buy', { item: 'weapon_bazooka' })).toMatchObject({ ok: false, code: 'bad_request' });
    // Only guns you own can be drawn.
    expect(await client.rpcRaw('weapon.equip', { weapon: 'minigun' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await client.rpc('weapon.equip', { weapon: 'pistol' })).toEqual({ weapon: 'pistol' });
    expect(server.game.sim.chars.get(client.playerId)!.weapon).toBe(1);
    expect(await client.rpc('weapon.equip', { weapon: null })).toEqual({ weapon: null });
    client.close();
  });
});

describe('shooting', () => {
  it('uses a round per shot (saved), respects the fire rate and needs the gun drawn', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    await buyGun(client, 'pistol');
    const at = standClear(client);
    const left = () => server.game.combat.ammoLeft(client.playerId, 'ammo_pistol');
    const fire = (n: number) => server.game.combat.fire(client.playerId, ['pistol', at.x, 1.35, at.z, 0, 0, n]);
    expect(fire(1)).toBe(true);
    // Too fast for a pistol.
    expect(fire(2)).toBe(false);
    combat().lastShot.delete(client.playerId);
    expect(fire(3)).toBe(true);
    expect(left()).toBe(STARTER_ROUNDS - 2);
    // From far away / a gun not drawn: refused.
    combat().lastShot.delete(client.playerId);
    expect(server.game.combat.fire(client.playerId, ['pistol', at.x + 20, 1.35, at.z, 0, 0, 4])).toBe(false);
    expect(server.game.combat.fire(client.playerId, ['rifle', at.x, 1.35, at.z, 0, 0, 5])).toBe(false);
    await sleep(2300);
    expect(inv(client).ammo_pistol).toBe(STARTER_ROUNDS - 2);
    // Out of ammo.
    const uow = server.game.state.begin();
    uow.player(client.playerId).inventory.ammo_pistol = 0;
    await uow.commit();
    combat().lastShot.delete(client.playerId);
    expect(fire(6)).toBe(false);
    client.close();
  });

  it('damages a car up to an engine blow-out: glass, parts, smoke, explosion, wreck', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 300_000);
    const { listings } = await client.rpc('market.list', {});
    const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
    const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
    await client.rpc('vehicle.spawn', { vehicleId: vehicle.id });
    const v = server.game.state.vehicles.get(vehicle.id)!;
    await buyGun(client, 'rifle');
    const uow = server.game.state.begin();
    uow.player(client.playerId).inventory.ammo_rifle = 200;
    await uow.commit();
    // Stand 8 m from the car's side.
    server.game.sim.teleport(client.playerId, v.x + Math.cos(v.rotation) * 8, v.z - Math.sin(v.rotation) * 8);
    client.events = [];
    fireAt(client, 'rifle', v.x, 0.9, v.z);
    const shot = await client.waitFor<ShotFx>('combat.shot', (s) => s.by === client.playerId);
    expect(shot.hit).toBe('car');
    expect(shot.carId).toBe(vehicle.id);
    const hp1 = server.game.combat.carHpOf(vehicle.id);
    expect(hp1).toBe(C.vehicleHp - weapon('rifle')!.damage);
    expect(damageLook(hp1).glass).toBe(true);
    // Keep shooting until it blows.
    for (let i = 0; i < 10 && server.game.combat.carHpOf(vehicle.id) > 0; i++) fireAt(client, 'rifle', v.x, 0.9, v.z);
    expect(server.game.combat.carHpOf(vehicle.id)).toBe(0);
    await client.waitFor('combat.explosion', () => true, 3000);
    await sleep(200);
    const wreck = server.game.state.vehicles.get(vehicle.id)!;
    expect(wreck.condition.engine).toBe(0);
    expect(wreck.condition.body).toBe(0);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Engine blow-out!');
    // Own car: no crime, but the gunfire is heard and a patrol is called (2 stars, not 3).
    expect(starsFor(heat(client))).toBe(2);
    await client.waitFor<{ title: string }>('notify', (n) => n.title.includes('Silah sesi'));
    client.close();
  });

  it("can't hurt other players or their cars, but shooting at people is 3 stars at once", async () => {
    const { client: a } = await connectNew(server);
    const { client: b } = await connectNew(server);
    await setMoney(server, a.playerId, 100_000);
    await buyGun(a, 'pistol');
    const at = standClear(a);
    server.game.sim.teleport(b.playerId, at.x, at.z + 6);
    fireAt(a, 'pistol', at.x, 1.2, at.z + 6);
    const shot = await a.waitFor<ShotFx>('combat.shot', (s) => s.by === a.playerId && s.hit === 'person');
    expect(shot.hit).toBe('person');
    expect(server.game.combat.healthView(b.playerId).hp).toBe(C.playerHp);
    expect(starsFor(heat(a))).toBeGreaterThanOrEqual(3);
    a.close();
    b.close();
  });

  it('pedestrians go down when shot; a pedestrian is a crime', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    await buyGun(client, 'shotgun');
    const ped = [...combat().peds.values()].find((p) => !p.deadAt)!;
    expect(ped).toBeDefined();
    expect(server.game.sim.npcs.get(ped.npc.id)).toBeDefined();
    // Stand right beside them (they keep walking, so shoot at once).
    server.game.sim.teleport(client.playerId, ped.npc.x + 3, ped.npc.z);
    fireAt(client, 'shotgun', ped.npc.x, 1.1, ped.npc.z);
    expect(ped.deadAt).toBeGreaterThan(0);
    expect(ped.npc.anim).toBe(Anim.Dead);
    expect(starsFor(heat(client))).toBeGreaterThanOrEqual(3);
    client.close();
  });
});

describe('health, officers and WASTED', () => {
  it('officers get out at 3 stars and shoot; at zero health you are WASTED and wake up at the hospital without illegal things', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 100_000);
    const at = standClear(client);
    // Illegal things in the pockets and a stolen car.
    const uow = server.game.state.begin();
    uow.player(client.playerId).inventory[LOCKPICK_ITEM] = 2;
    uow.player(client.playerId).inventory[partItemId('engine', 2, 't')] = 1;
    await uow.commit();
    server.game.police.raiseHeat(client.playerId, 350);
    // Wait for a police car to come close and stop, and an officer to get out.
    const officer = async () => [...combat().officers.values()].find((o) => o.target === client.playerId);
    let found = await officer();
    const until = Date.now() + 12_000;
    while (!found && Date.now() < until) {
      // Bring the nearest unit to the player and stop it.
      for (const u of server.game.police.unitsOf(client.playerId) as readonly { dyn: { x: number; z: number; speed: number } }[]) {
        u.dyn.x = at.x + 10;
        u.dyn.z = at.z;
        u.dyn.speed = 0;
      }
      await sleep(200);
      found = await officer();
    }
    expect(found).toBeDefined();
    expect(found!.npc.id.startsWith('cop_')).toBe(true);
    // Their shots hurt.
    const hit = await client.waitFor<HealthView>('combat.health', (h) => h.hp < C.playerHp, 15_000);
    expect(hit.fromX).toBeDefined();
    // Finish it: WASTED.
    server.game.combat.hurtPlayer(client.playerId, 200, at.x, at.z);
    const wasted = await client.waitFor<{ lost: string[] }>('combat.wasted', () => true, 3000);
    expect(wasted.lost.join(' ')).toContain('Lockpick');
    await sleep(300);
    expect(inv(client)[LOCKPICK_ITEM]).toBeUndefined();
    expect(inv(client)[partItemId('engine', 2, 't')]).toBeUndefined();
    expect(heat(client)).toBe(0);
    // Back on their feet at the hospital, full health.
    await sleep(4700);
    const c = server.game.sim.chars.get(client.playerId)!;
    expect(c.dead).toBe(false);
    expect(Math.hypot(c.x - HOSPITAL.respawn.x, c.z - HOSPITAL.respawn.z)).toBeLessThan(3);
    expect(server.game.combat.healthView(client.playerId).hp).toBe(C.playerHp);
    client.close();
  }, 40_000);

  it('the hospital patches you up for $500; health also comes back on its own', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 10_000);
    server.game.combat.hurtPlayer(client.playerId, 40, 0, 0);
    expect(server.game.combat.healthView(client.playerId).hp).toBe(60);
    expect(await client.rpcRaw('hospital.heal', {})).toMatchObject({ ok: false, code: 'too_far' });
    server.game.sim.teleport(client.playerId, HOSPITAL.respawn.x, HOSPITAL.respawn.z);
    const m0 = money(client);
    const v = await client.rpc('hospital.heal', {});
    expect(v.hp).toBe(C.playerHp);
    expect(money(client)).toBe(m0 - C.healPrice);
    expect(await client.rpcRaw('hospital.heal', {})).toMatchObject({ ok: false, code: 'conflict' });
    // Regeneration after a quiet spell.
    server.game.combat.hurtPlayer(client.playerId, 30, 0, 0);
    const h = (server.game.combat as unknown as { health: Map<string, { hitAt: number }> }).health.get(client.playerId)!;
    h.hitAt = Date.now() - C.regenDelaySec * 1000 - 100;
    await sleep(1500);
    expect(server.game.combat.healthView(client.playerId).hp).toBeGreaterThan(70);
    client.close();
  });
});

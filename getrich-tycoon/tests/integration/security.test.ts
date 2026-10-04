// Security gear over real sockets: fitting the hidden compartment, run-flat tyres and level-3
// armour at Chroma Customs; Z hides the goods; an arrest searches the car (the goods on you always
// found, the compartment one time in ten); armour takes 36 bullets before anything gets through;
// run-flats ride over a spike strip.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isCategoryUnlocked } from '../../shared/progression';
import { KEY } from '../../shared/physics';
import { SECURITY, armorRepairPrice } from '../../shared/security';
import { CATALOG_MODELS, getModel } from '../../shared/vehicles';
import { INTERACTABLES } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { GOODS_ITEM } from '../../server/game/services/telegram';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const RNG = Math.random;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  server.game.ctx.rng = RNG;
  await server?.close();
});

const custom = INTERACTABLES.find((i) => i.kind === 'custom')!;
const money = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;
const goods = (c: TestClient) => server.game.state.players.get(c.playerId)!.inventory[GOODS_ITEM] ?? 0;

/** A car of their own (and money for the gear). */
async function ownCar(client: TestClient): Promise<string> {
  const { listings } = await client.rpc('market.list', {});
  const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
  const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
  const uow = server.game.state.begin();
  const v = uow.vehicle(vehicle.id);
  v.condition = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
  v.fuel = 100;
  uow.player(client.playerId).money = 200_000;
  await uow.commit();
  return vehicle.id;
}

async function fit(client: TestClient, vehicleId: string, item: 'stash' | 'runflat' | 'armor'): Promise<void> {
  server.game.sim.teleport(client.playerId, custom.x, custom.z);
  await sleep(120);
  await client.rpc('security.buy', { vehicleId, item });
}

/** Out of the garage and into the driver's seat. */
async function drive(client: TestClient, vehicleId: string): Promise<void> {
  await client.rpc('vehicle.spawn', { vehicleId });
  const v = server.game.state.vehicles.get(vehicleId)!;
  server.game.sim.teleport(client.playerId, v.x + 2.2, v.z);
  await sleep(120);
  await client.rpc('vehicle.enter', { vehicleId });
}

async function setGoods(c: TestClient, grams: number): Promise<void> {
  const uow = server.game.state.begin();
  uow.player(c.playerId).inventory[GOODS_ITEM] = grams;
  await uow.commit();
}

async function bust(c: TestClient, vehicleId: string | null): Promise<void> {
  server.game.police.addHeat(c.playerId, 150);
  await sleep(150);
  const police = server.game.police as unknown as { bust(pid: string, w: unknown, me: unknown): Promise<void> };
  const ch = server.game.sim.chars.get(c.playerId)!;
  await police.bust(c.playerId, server.game.police.wantedOf(c.playerId), { x: ch.x, z: ch.z, rot: 0, vehicleId, hl: 2, hw: 1 });
  await sleep(300);
}

describe('security gear', () => {
  it('fitted at Chroma Customs: compartment $15k, run-flats $25k, armour $40k (not on a motorcycle)', async () => {
    const { client } = await connectNew(server);
    const id = await ownCar(client);
    expect(await client.rpcRaw('security.buy', { vehicleId: id, item: 'stash' })).toMatchObject({ ok: false, code: 'too_far' });
    await fit(client, id, 'stash');
    expect(money(client)).toBe(200_000 - SECURITY.stashPrice);
    expect(await client.rpcRaw('security.buy', { vehicleId: id, item: 'stash' })).toMatchObject({ ok: false, code: 'conflict' });
    await client.rpc('security.buy', { vehicleId: id, item: 'runflat' });
    await client.rpc('security.buy', { vehicleId: id, item: 'armor' });
    expect(money(client)).toBe(200_000 - SECURITY.stashPrice - SECURITY.runflatPrice - SECURITY.armorPrice);
    expect(server.game.state.vehicles.get(id)!.mods).toMatchObject({ stash: true, runflat: true, armor: true });
    // Nobody else learns about the compartment.
    expect(server.game.state.toPublicVehicle(server.game.state.vehicles.get(id)!).mods.stash).toBeUndefined();
    // A motorcycle: no armour.
    const bikeId = await ownCar(client);
    const uow = server.game.state.begin();
    uow.vehicle(bikeId).modelId = CATALOG_MODELS.find((m) => m.specs.kind === 'bike')!.id;
    await uow.commit();
    expect(await client.rpcRaw('security.buy', { vehicleId: bikeId, item: 'armor' })).toMatchObject({ ok: false, code: 'conflict' });
    client.close();
  }, 30_000);

  it('Z hides the goods; an arrest finds the goods on you, the compartment one time in ten', async () => {
    const { client } = await connectNew(server);
    const id = await ownCar(client);
    await fit(client, id, 'stash');
    await drive(client, id);
    // Nothing to hide yet.
    expect(await client.rpcRaw('security.stash', { vehicleId: id })).toMatchObject({ ok: false, code: 'conflict' });
    await setGoods(client, 30);
    let r = await client.rpc('security.stash', { vehicleId: id });
    expect(r).toMatchObject({ goods: 0, moved: 30 });
    expect(r.vehicle.mods.stashGrams).toBe(30);
    // And back out again, then in again.
    r = await client.rpc('security.stash', { vehicleId: id });
    expect(r).toMatchObject({ goods: 30, moved: -30 });
    await client.rpc('security.stash', { vehicleId: id });
    // 10 g more on you: the search finds those; the compartment holds (rng: not found).
    await setGoods(client, 10);
    server.game.ctx.rng = () => 0.99;
    try {
      await bust(client, id);
    } finally {
      server.game.ctx.rng = RNG;
    }
    expect(goods(client)).toBe(0);
    expect(server.game.state.vehicles.get(id)!.mods.stashGrams).toBe(30);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Zula bulunamadı', 3000);
    client.close();
    // Another arrest, unlucky this time.
    const { client: c2 } = await connectNew(server);
    const id2 = await ownCar(c2);
    await fit(c2, id2, 'stash');
    await drive(c2, id2);
    await setGoods(c2, 20);
    await c2.rpc('security.stash', { vehicleId: id2 });
    server.game.ctx.rng = () => SECURITY.stashFindChance / 2;
    try {
      await bust(c2, id2);
    } finally {
      server.game.ctx.rng = RNG;
    }
    expect(server.game.state.vehicles.get(id2)!.mods.stashGrams).toBe(0);
    await c2.waitFor<{ title: string }>('notify', (n) => n.title === 'GİZLİ ZULA BULUNDU!', 3000);
    c2.close();
  }, 40_000);

  it('armour takes 36 bullets with the glass cracking, then the body takes them; patched up for $120 a %', async () => {
    const { client } = await connectNew(server);
    const id = await ownCar(client);
    await fit(client, id, 'armor');
    await client.rpc('vehicle.spawn', { vehicleId: id });
    const combat = server.game.combat;
    expect(combat.armorOf(id)).toBe(100);
    client.events.length = 0;
    for (let i = 0; i < SECURITY.armorHits - 1; i++) combat.damageCar(id, 24, client.playerId);
    expect(SECURITY.armorHits).toBeGreaterThanOrEqual(30);
    expect(combat.armorOf(id)!).toBeGreaterThan(0);
    expect(combat.carHpOf(id)).toBe(100);
    const ev = await client.waitFor<{ id: string; armor?: number }>('combat.carHp', (e) => e.id === id && (e.armor ?? 100) < 10, 2000);
    expect(ev.armor).toBeGreaterThan(0);
    combat.damageCar(id, 24, client.playerId);
    expect(combat.armorOf(id)).toBe(0);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'ZIRH DELİNDİ!', 2000);
    combat.damageCar(id, 24, client.playerId);
    expect(combat.carHpOf(id)).toBe(76);
    // Patched up.
    const before = money(client);
    await fit(client, id, 'armor');
    expect(money(client)).toBe(before - armorRepairPrice(0));
    expect(armorRepairPrice(0)).toBe(12_000);
    expect(combat.armorOf(id)).toBe(100);
    client.close();
  }, 30_000);

  it('run-flat tyres ride over a spike strip', async () => {
    const { client } = await connectNew(server);
    const id = await ownCar(client);
    await fit(client, id, 'runflat');
    await drive(client, id);
    server.game.sim.placeDrive(id, 50, 60, Math.PI);
    server.game.police.addSpikes({ x: 50, z: 40, rot: Math.PI / 2, half: 4 });
    const t0 = Date.now();
    let held = false;
    client.events.length = 0;
    while (Date.now() - t0 < 8_000 && !held) {
      client.sendInputs(KEY.FORWARD, 3);
      await sleep(100);
      held = client.events.some((e) => e.event === 'notify' && (e.data as { title: string }).title === 'Patlamaz lastikler dayandı!');
    }
    expect(held).toBe(true);
    // On over it, the rear tyres too.
    for (let i = 0; i < 15; i++) {
      client.sendInputs(KEY.FORWARD, 3);
      await sleep(100);
    }
    expect(server.game.sim.drives.get(id)!.dyn.z).toBeLessThan(36);
    expect(server.game.state.vehicles.get(id)!.mods.blown).toBeFalsy();
    client.close();
  }, 30_000);
});

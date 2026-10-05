// The docks at night over real sockets: shut by day; at night the grinder through a container's
// locks (not too quick), the arms crate (Micro-Uzi, sniper, C4, body armour); the trap when somebody
// talked (the radio warning, then 4 stars, barricades, SWAT) and a heavy truck ramming a barricade
// aside; bulk imports: a hypercar to drive out, goods loaded onto a flatbed by the crane and
// unloaded at the depot.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEPOT, DOCK_CONTAINERS, containerDoor, findContainer, gateBarricades, type DocksState } from '../../shared/docks';
import { ECONOMY } from '../../shared/economy.config';
import type { DocksOrders } from '../../shared/protocol';
import { newShowroomCar } from '../../shared/showrooms';
import type { Vehicle } from '../../shared/types';
import { ARMOR_ITEM, C4_ITEM, weaponItem, type HealthView } from '../../shared/weapons';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const D = ECONOMY.docks;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => server.game.docks as any;

function atDoor(client: TestClient, id: string): void {
  const d = containerDoor(findContainer(id)!);
  server.game.sim.teleport(client.playerId, d.stand.x, d.stand.z);
}

async function withRng<T>(v: number, fn: () => Promise<T>): Promise<T> {
  const rng = server.game.ctx.rng;
  server.game.ctx.rng = () => v;
  try {
    return await fn();
  } finally {
    server.game.ctx.rng = rng;
  }
}

/** A flatbed truck of the player's, driven by them at a spot. */
async function truck(client: TestClient, x: number, z: number, rot: number): Promise<string> {
  const v: Vehicle = { ...newShowroomCar('granforge_hauler', '#3a3d42'), id: `veh_t${Math.floor(Math.random() * 1e9)}`, ownerId: client.playerId, status: 'world', x, z, rotation: rot, createdAt: Date.now() };
  const uow = server.game.state.begin();
  uow.createVehicle(v);
  await uow.commit();
  server.game.sim.rebuildDynamic();
  server.game.sim.teleport(client.playerId, x + 2.5, z);
  await sleep(100);
  server.game.sim.startDriving(client.playerId, server.game.state.vehicles.get(v.id)!);
  server.game.sim.placeDrive(v.id, x, z, rot);
  return v.id;
}

describe('the docks at night', () => {
  it('shut by day; at night the grinder opens a container: an arms crate (Uzi, sniper, C4, body armour) you can use', async () => {
    const { client } = await connectNew(server);
    const k = DOCK_CONTAINERS[0]!;
    atDoor(client, k.id);
    svc().hour = () => 13;
    await expect(client.rpc('docks.start', { containerId: k.id })).rejects.toThrow(/23:00/);
    svc().hour = () => 1;
    const st = await withRng(0.9, () => client.rpc('docks.start', { containerId: k.id }));
    expect(st.mode).toBe('cut');
    const state = await client.waitFor<DocksState>('docks.state', (s) => s.containers.some((c) => c.id === k.id && c.cutting));
    expect(state.ambush).toBeNull();
    // Too quick: the bars aren't through.
    await expect(client.rpc('docks.finish', { containerId: k.id })).rejects.toThrow(/kesilmedi/);
    svc().boxes.get(k.id).cut.startedAt -= (D.cutMinSec + 1) * 1000;
    const r = await withRng(0.4, () => client.rpc('docks.finish', { containerId: k.id }));
    expect(r.loot).toBe('arms');
    const inv = server.game.state.players.get(client.playerId)!.inventory;
    expect(inv[weaponItem('uzi')]).toBe(1);
    expect(inv[weaponItem('sniper')]).toBe(1);
    expect(inv[C4_ITEM]).toBe(D.arms.c4);
    expect(inv[ARMOR_ITEM]).toBe(D.arms.body_armor);
    await client.waitFor<DocksState>('docks.state', (s) => s.containers.some((c) => c.id === k.id && c.open && !c.ready));
    await expect(client.rpc('docks.start', { containerId: k.id })).rejects.toThrow(/boşaltılmış/);
    // The vest: armour that takes most of a hit.
    const h = await client.rpc('combat.armor', {});
    expect(h.armor).toBe(100);
    server.game.combat.hurtPlayer(client.playerId, 20, 0, 0);
    const hv = await client.waitFor<HealthView>('combat.health', (x) => (x.armor ?? 0) > 0 && (x.armor ?? 0) < 100);
    expect(hv.armor).toBe(86);
    expect(hv.hp).toBe(ECONOMY.combat.playerHp - 6);
    // C4 at your feet, going off a few seconds later.
    const c4 = await client.rpc('combat.c4', {});
    expect(c4.at - Date.now()).toBeGreaterThan((ECONOMY.combat.c4.fuseSec - 1) * 1000);
    await client.waitFor('combat.c4', () => true);
    expect(server.game.state.players.get(client.playerId)!.inventory[C4_ITEM]).toBe(D.arms.c4 - 1);
    client.close();
  }, 40_000);

  it('somebody talked: the radio warning, then 4 stars, barricades on the gates, SWAT in cover; a heavy truck rams a barricade aside', async () => {
    const { client } = await connectNew(server);
    const k = DOCK_CONTAINERS[1]!;
    atDoor(client, k.id);
    svc().hour = () => 0;
    await withRng(0.05, () => client.rpc('docks.start', { containerId: k.id }));
    const warn = await client.waitFor<{ text: string }>('docks.warn');
    expect(warn.text).toBe('Bölgeye tüm birimler intikal etsin, hedef kapanda.');
    await client.waitFor<{ text: string }>('police.radio', (l) => l.text.includes('hedef kapanda'));
    const sprung = await client.waitFor<DocksState>('docks.state', (s) => !!s.ambush, (D.warnSec + 4) * 1000);
    expect(sprung.ambush!.barricades.length).toBe(gateBarricades().length);
    expect(server.game.police.starsOf(client.playerId)).toBe(4);
    expect((server.game.police.wantedOf(client.playerId) as unknown as { engaged: boolean }).engaged).toBe(true);
    expect([...server.game.sim.npcs.keys()].filter((id) => id.startsWith('cop_dk')).length).toBe(D.swat);
    // The truck into the north gate's blocks.
    const b = gateBarricades().find((x) => x.id.startsWith('north'))!;
    const tid = await truck(client, b.x, b.z + 4.5, Math.PI);
    server.game.sim.drives.get(tid)!.dyn.speed = 14;
    const ram = await client.waitFor<{ id: string }>('docks.ram', () => true, 4000);
    expect(ram.id.startsWith('north')).toBe(true);
    const after = await client.waitFor<DocksState>('docks.state', (s) => !!s.ambush && s.ambush.barricades.length < gateBarricades().length);
    expect(after.ambush!.barricades).not.toContain(ram.id);
    server.game.police.clearWanted(client.playerId);
    svc().endAmbush('test');
    client.close();
  }, 50_000);

  it('bulk imports: the hypercar to drive out; goods loaded onto a flatbed by the crane and unloaded at the depot', async () => {
    const { client } = await connectNew(server);
    const uow = server.game.state.begin();
    uow.player(client.playerId).money = 600_000;
    await uow.commit();
    svc().hour = () => 12;
    await withRng(0.9, () => client.rpc('docks.order', { kind: 'hypercar' }));
    expect(server.game.state.players.get(client.playerId)!.money).toBe(600_000 - D.imports.hypercar);
    await expect(client.rpc('docks.order', { kind: 'arms' })).rejects.toThrow(/bekleyen/);
    for (const o of svc().orders.values()) if (o.playerId === client.playerId) o.arriveAt = Date.now();
    const landed = await client.waitFor<DocksOrders>('docks.orders', (d) => d.orders.some((o) => o.status === 'ready' && !!o.containerId), 4000);
    const order = landed.orders.find((o) => o.status === 'ready')!;
    expect(landed.messages.at(-1)!.text).toContain(order.containerId!);
    // Opened any time of day (it's mine): the hypercar is mine.
    atDoor(client, order.containerId!);
    const before = [...server.game.state.vehicles.values()].filter((v) => v.ownerId === client.playerId).length;
    const opened = await client.rpc('docks.start', { containerId: order.containerId! });
    expect(opened.mode).toBe('open');
    const cars = [...server.game.state.vehicles.values()].filter((v) => v.ownerId === client.playerId);
    expect(cars.length).toBe(before + 1);
    expect(cars.some((v) => v.status === 'world' && ['bugatti_chiron', 'lamborghini_aventador', 'ferrari_sf90'].includes(v.modelId))).toBe(true);
    // Now goods: crane onto the truck, to the depot.
    await withRng(0.9, () => client.rpc('docks.order', { kind: 'goods' }));
    for (const o of svc().orders.values()) if (o.playerId === client.playerId && o.status === 'ship') o.arriveAt = Date.now();
    const g = await client.waitFor<DocksOrders>('docks.orders', (d) => d.orders.some((o) => o.kind === 'goods' && o.status === 'ready'), 4000);
    const go = g.orders.find((o) => o.kind === 'goods' && o.status === 'ready')!;
    atDoor(client, go.containerId!);
    await expect(client.rpc('docks.start', { containerId: go.containerId! })).rejects.toThrow(/kamyon/);
    const k = findContainer(go.containerId!)!;
    const tid = await truck(client, (k.box.minX + k.box.maxX) / 2, k.box.maxZ + 3.5, Math.PI / 2);
    const loaded = await client.rpc('docks.crane', {});
    expect(loaded.orders.find((o) => o.id === go.id)!.status).toBe('loaded');
    await client.waitFor<{ vehicleId: string }[]>('docks.loads', (l) => l.some((x) => x.vehicleId === tid));
    await expect(client.rpc('docks.unload', {})).rejects.toThrow(/Depo/);
    server.game.sim.placeDrive(tid, DEPOT.x, DEPOT.z, 0);
    const grams = server.game.state.players.get(client.playerId)!.inventory.deal_goods ?? 0;
    const done = await client.rpc('docks.unload', {});
    expect(done.orders.find((o) => o.id === go.id)!.status).toBe('done');
    expect(server.game.state.players.get(client.playerId)!.inventory.deal_goods).toBe(grams + D.bulkGrams);
    client.close();
  }, 50_000);
});

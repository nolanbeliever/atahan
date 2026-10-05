// Night burglaries over real sockets: shut in the daytime; at night the door's lock (a snapped pick
// costs a lockpick and raises the security 20%), the room far away, taking the loot, a quiet exit
// (clean money, the goods in the inventory, sold at the Pawn Shop); the safe forced wrongly sets
// the alarm off (2 stars, the police 30 s from the door), and when they get there with you still
// inside they come in: you're out on the pavement in a pursuit with a hot bag.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BURGLARY_TARGETS, LOOT_ITEMS, findTarget, inInteriorZone, layoutOf, roomPoint, type BurglaryResult, type BurglaryState } from '../../shared/burglary';
import { ECONOMY } from '../../shared/economy.config';
import { KEY } from '../../shared/physics';
import { LOCKPICK_ITEM } from '../../shared/theft';
import { findInteractable } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const B = ECONOMY.burglary;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

async function give(id: string, fn: (inv: Record<string, number>) => void, money?: number): Promise<void> {
  const uow = server.game.state.begin();
  const p = uow.player(id);
  fn(p.inventory);
  if (money !== undefined) p.money = money;
  await uow.commit();
}

function at(client: TestClient, x: number, z: number): void {
  server.game.sim.teleport(client.playerId, x, z);
}

/** Pick the door's lock: one miss far off, then the sweet spot (the rng puts it at 90°). */
async function pickDoor(client: TestClient, targetId: string): Promise<void> {
  const t = findTarget(targetId)!;
  at(client, t.stand.x, t.stand.z);
  const rng = server.game.ctx.rng;
  server.game.ctx.rng = () => 0.5;
  const s = await client.rpc('burglary.pick', { targetId });
  server.game.ctx.rng = rng;
  expect(s.mode).toBe('door');
  const miss = await client.rpc('burglary.turn', { sessionId: s.sessionId, angle: 20 });
  expect(miss.opened).toBe(false);
  expect(miss.dir).toBe(1);
  expect(miss.noise).toBeCloseTo(B.breakSecurity, 0);
  await sleep(ECONOMY.theft.tryCooldownMs + 50);
  const open = await client.rpc('burglary.turn', { sessionId: s.sessionId, angle: 90 });
  expect(open.opened).toBe(true);
}

describe('night burglaries', () => {
  it('shut in the daytime; at night: the lock, the room, the loot, a quiet exit with clean money; the Pawn Shop buys the goods', async () => {
    const { client } = await connectNew(server);
    const t = findTarget('daire_gul_apt')!;
    await give(client.playerId, (inv) => (inv[LOCKPICK_ITEM] = 3), 1_000);
    at(client, t.stand.x, t.stand.z);
    server.game.burglary.hour = () => 12;
    await expect(client.rpc('burglary.pick', { targetId: t.id })).rejects.toThrow(/gündüz açık\/korumalı, gece 22:00'den sonra tekrar gel/);
    server.game.burglary.hour = () => 23;
    await pickDoor(client, t.id);
    // One snapped pick: a lockpick less.
    expect(server.game.state.players.get(client.playerId)!.inventory[LOCKPICK_ITEM]).toBe(2);
    expect(server.game.burglary.insideOf(client.playerId)).toBe(t.id);
    const pos = server.game.sim.position(client.playerId)!;
    expect(inInteriorZone(pos.x, pos.z)).toBe(true);
    const st = await client.waitFor<BurglaryState | null>('burglary.state', (s) => !!s && s.targetId === t.id);
    expect(st!.alarm).toBe(false);
    expect(st!.noise).toBeGreaterThanOrEqual(B.breakSecurity - 1);
    // The police can't see in: no stars for being inside.
    expect(server.game.police.starsOf(client.playerId)).toBe(0);
    // The laptop on the table.
    const spot = layoutOf(t).loot.find((l) => l.id === 'table')!;
    const stand = roomPoint(t, spot.stand.x, spot.stand.z);
    at(client, stand.x, stand.z);
    await client.rpc('burglary.take', { lootId: spot.id });
    const got = await client.waitFor<BurglaryState | null>('burglary.state', (s) => !!s && s.taken.includes('table'), 6000);
    expect(got!.bag.items[LOOT_ITEMS.laptop]).toBe(1);
    // Out through the front door: clean.
    const door = roomPoint(t, 0, 0.9);
    at(client, door.x, door.z);
    await client.rpc('burglary.leave', {});
    const r = await client.waitFor<BurglaryResult>('burglary.result');
    expect(r.clean).toBe(true);
    expect(server.game.burglary.insideOf(client.playerId)).toBeNull();
    const out = server.game.sim.position(client.playerId)!;
    expect(Math.hypot(out.x - t.stand.x, out.z - t.stand.z)).toBeLessThan(1);
    const me = server.game.state.players.get(client.playerId)!;
    expect(me.inventory[LOOT_ITEMS.laptop]).toBe(1);
    // Done for a while.
    await expect(client.rpc('burglary.pick', { targetId: t.id })).rejects.toThrow(/daha yeni soyuldu/);
    // The Pawn Shop buys the laptop.
    const pawn = findInteractable('pawn')!;
    at(client, pawn.x, pawn.z);
    const before = me.money;
    const sale = await client.rpc('pawn.sell', { part: LOOT_ITEMS.laptop });
    expect(sale.count).toBe(1);
    expect(sale.amount).toBeGreaterThanOrEqual(B.pawn.loot_laptop[0]);
    expect(sale.amount).toBeLessThanOrEqual(B.pawn.loot_laptop[1]);
    expect(server.game.state.players.get(client.playerId)!.money).toBe(before + sale.amount);
    client.close();
  }, 40_000);

  it('the safe forced wrongly: the alarm (2 stars, police 30 s out); still inside when they come: out on the pavement in a pursuit, the bag hot', async () => {
    const { client } = await connectNew(server);
    const t = findTarget('villa_lale')!;
    await give(client.playerId, (inv) => (inv[LOCKPICK_ITEM] = 2));
    server.game.burglary.hour = () => 2;
    await pickDoor(client, t.id);
    // Something in the bag first: the jewellery on the dresser.
    const dresser = layoutOf(t).loot.find((l) => l.id === 'dresser')!;
    const ds = roomPoint(t, dresser.stand.x, dresser.stand.z);
    at(client, ds.x, ds.z);
    await client.rpc('burglary.take', { lootId: 'dresser' });
    await client.waitFor<BurglaryState | null>('burglary.state', (s) => !!s && s.taken.includes('dresser'), 6000);
    // The safe: three wrong turns.
    const safe = layoutOf(t).loot.find((l) => l.kind === 'safe')!;
    const ss = roomPoint(t, safe.stand.x, safe.stand.z);
    at(client, ss.x, ss.z);
    const rng = server.game.ctx.rng;
    server.game.ctx.rng = () => 0.9;
    const s = await client.rpc('burglary.safe', {});
    server.game.ctx.rng = rng;
    expect(s.mode).toBe('safe');
    expect(s.picks).toBe(B.safeTries);
    let last = null as Awaited<ReturnType<typeof client.rpc<'burglary.turn'>>> | null;
    for (let i = 0; i < B.safeTries; i++) {
      last = await client.rpc('burglary.turn', { sessionId: s.sessionId, angle: 5 });
      await sleep(ECONOMY.theft.tryCooldownMs + 50);
    }
    expect(last!.failed).toBe(true);
    const alarm = await client.waitFor<BurglaryState | null>('burglary.state', (x) => !!x && x.alarm);
    expect(alarm!.cause).toContain('Kasa');
    expect(server.game.police.starsOf(client.playerId)).toBe(2);
    const eta = (alarm!.policeAt! - Date.now()) / 1000;
    expect(eta).toBeGreaterThan(B.policeSec - 3);
    expect(eta).toBeLessThan(B.policeSec + 1);
    const view = await client.waitFor<{ id: string; alarm: boolean }[]>('burglary.targets', (l) => l.some((x) => x.id === t.id && x.alarm));
    expect(view.length).toBe(BURGLARY_TARGETS.length);
    // Inside nobody sees you (no pursuit yet).
    expect((server.game.police.wantedOf(client.playerId) as unknown as { engaged: boolean }).engaged).toBe(false);
    // The police get there with the burglar still inside: they come in.
    (server.game.burglary.job(t.id) as { policeAt: number }).policeAt = Date.now();
    const r = await client.waitFor<BurglaryResult>('burglary.result', () => true, 4000);
    expect(r.clean).toBe(false);
    expect(r.items[LOOT_ITEMS.jewels]).toBeGreaterThan(0);
    expect(server.game.burglary.insideOf(client.playerId)).toBeNull();
    const pos = server.game.sim.position(client.playerId)!;
    expect(Math.hypot(pos.x - t.stand.x, pos.z - t.stand.z)).toBeLessThan(1);
    expect((server.game.police.wantedOf(client.playerId) as unknown as { engaged: boolean }).engaged).toBe(true);
    // The jewellery isn't in the inventory yet (hot until the police are lost).
    expect(server.game.state.players.get(client.playerId)!.inventory[LOOT_ITEMS.jewels] ?? 0).toBe(0);
    server.game.police.clearWanted(client.playerId);
    client.close();
  }, 50_000);

  it('a laser beam broken or running round sets the alarm off; a crew mate walks in through the open door', async () => {
    const { client } = await connectNew(server);
    const { client: mate } = await connectNew(server);
    const t = findTarget('kuyumcu_altinsaray')!;
    await give(client.playerId, (inv) => (inv[LOCKPICK_ITEM] = 2));
    server.game.burglary.hour = () => 1;
    await pickDoor(client, t.id);
    // The mate comes in through the open door.
    at(mate, t.stand.x, t.stand.z);
    const st = await mate.rpc('burglary.enter', { targetId: t.id });
    expect(st.targetId).toBe(t.id);
    expect(server.game.burglary.insideOf(mate.playerId)).toBe(t.id);
    // Running round the shop: the noise climbs.
    const n0 = server.game.burglary.job(t.id)!.noise;
    for (let i = 0; i < 10; i++) {
      client.sendInputs(KEY.FORWARD | KEY.SPRINT, 3, i % 2 ? 0 : Math.PI);
      await sleep(100);
    }
    expect(server.game.burglary.job(t.id)!.noise).toBeGreaterThan(n0 + 5);
    // Into the office doorway while the laser is on.
    const laser = layoutOf(t).lasers[0]!;
    const mid = roomPoint(t, (laser.a.x + laser.b.x) / 2, laser.a.z);
    const end = Date.now() + 6000;
    while (!server.game.burglary.job(t.id)?.alarm && Date.now() < end) {
      at(client, mid.x, mid.z);
      await sleep(100);
    }
    const job = server.game.burglary.job(t.id)!;
    expect(job.alarm).toBe(true);
    expect(job.cause).toMatch(/Lazer|sensör/);
    expect(server.game.police.starsOf(client.playerId)).toBe(2);
    expect(server.game.police.starsOf(mate.playerId)).toBe(2);
    // A walk-in is refused while it rings.
    server.game.police.clearWanted(client.playerId);
    server.game.police.clearWanted(mate.playerId);
    client.close();
    mate.close();
  }, 40_000);
});

// Daily login streak and playtime rewards against a real server: claims pay once, the streak goes on
// or starts over, playtime only counts while the player is active, and the reward coupons work.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayIndex } from '../../shared/missions';
import { KEY } from '../../shared/physics';
import { NEON_SPECIAL_ITEM, NITRO_ITEM, PAWN_BONUS_ITEM, RIM_COUPON, VIP_COIN, type RewardState, type RewardsView } from '../../shared/rewards';
import { SPECIAL_NEON } from '../../shared/customization';
import { ECONOMY } from '../../shared/economy.config';
import { LOCKPICK_ITEM, partItemId, partShare } from '../../shared/theft';
import { getModel } from '../../shared/vehicles';
import { isCategoryUnlocked } from '../../shared/progression';
import { INTERACTABLES } from '../../shared/world';
import * as repo from '../../server/db/repo';
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

const TODAY = () => dayIndex(Date.now());
const money = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;
const inv = (c: TestClient) => server.game.state.players.get(c.playerId)!.inventory;

/** Change a player's reward state on the server (as if earlier days had happened). */
function patchRewards(c: TestClient, patch: Partial<RewardState>): void {
  const svc = server.game.rewards as unknown as { states: Map<string, RewardState> };
  Object.assign(svc.states.get(c.playerId)!, patch);
}

function goTo(client: TestClient, kind: string) {
  const i = INTERACTABLES.find((x) => x.kind === kind)!;
  server.game.sim.teleport(client.playerId, i.x, i.z);
}

describe('daily login streak', () => {
  it('pays day 1 once a day and keeps it in the database', async () => {
    const { client } = await connectNew(server);
    const first = await client.waitFor<RewardsView>('rewards.update');
    expect(first.daily).toMatchObject({ day: 1, claimable: true, reset: false });
    const info = await client.rpc('rewards.info', {});
    expect(info.daily.boxes[0]!.state).toBe('today');
    const m0 = money(client);
    const r = await client.rpc('rewards.daily', {});
    expect(r.day).toBe(1);
    expect(r.reward).toBe('$5,000');
    expect(r.view.daily).toMatchObject({ claimable: false, day: 1 });
    expect(money(client)).toBe(m0 + 5_000);
    const { transactions } = await client.rpc('transactions', {});
    expect(transactions.find((t) => t.kind === 'reward')?.amount).toBe(5_000);
    // Only once a day.
    expect(await client.rpcRaw('rewards.daily', {})).toMatchObject({ ok: false, code: 'conflict' });
    expect(money(client)).toBe(m0 + 5_000);
    // Saved with the payout.
    expect(await repo.loadRewards(server.db, client.playerId)).toMatchObject({ streak: 1, lastClaimDay: TODAY() });
    client.close();
  });

  it('goes on day after day, starts over after a missed day, and gives a legendary car on day 7', async () => {
    const { client } = await connectNew(server);
    await client.waitFor('rewards.update');
    // Claimed day 1 yesterday: today is day 2 (a lockpick set).
    patchRewards(client, { streak: 1, lastClaimDay: TODAY() - 1 });
    const locks = inv(client)[LOCKPICK_ITEM] ?? 0;
    expect((await client.rpc('rewards.daily', {})).day).toBe(2);
    expect(inv(client)[LOCKPICK_ITEM]).toBe(locks + 1);

    // Day 6: three lockpick sets and the special nitro.
    patchRewards(client, { streak: 5, lastClaimDay: TODAY() - 1 });
    expect((await client.rpc('rewards.daily', {})).day).toBe(6);
    expect(inv(client)[LOCKPICK_ITEM]).toBe(locks + 4);
    expect(inv(client)[NITRO_ITEM]).toBe(ECONOMY.rewards.nitroOnDay6);

    // Day 7: a legendary car in the garage, $50,000 and VIP coins.
    patchRewards(client, { streak: 6, lastClaimDay: TODAY() - 1 });
    const cars0 = [...server.game.state.vehicles.values()].filter((v) => v.ownerId === client.playerId).length;
    const m0 = money(client);
    const seven = await client.rpc('rewards.daily', {});
    expect(seven.day).toBe(7);
    expect(money(client)).toBe(m0 + 50_000);
    expect(inv(client)[VIP_COIN]).toBe(ECONOMY.rewards.vipCoinsOnDay7);
    const cars = [...server.game.state.vehicles.values()].filter((v) => v.ownerId === client.playerId);
    expect(cars.length).toBe(cars0 + 1);
    const car = cars.find((v) => v.purchasePrice === 0 && v.status === 'stored')!;
    expect(getModel(car.modelId).tier).toBe('legendary');
    expect(Math.min(...Object.values(car.condition))).toBeGreaterThanOrEqual(92);
    expect(seven.reward).toContain('Efsanevi araç');
    expect(await server.db.query('SELECT id FROM vehicles WHERE id=$1', [car.id])).toHaveLength(1);

    // After day 7 the streak starts over; so does a missed day.
    patchRewards(client, { streak: 7, lastClaimDay: TODAY() - 1 });
    expect((await client.rpc('rewards.info', {})).daily).toMatchObject({ day: 1, claimable: true, reset: false });
    patchRewards(client, { streak: 4, lastClaimDay: TODAY() - 2 });
    const missed = await client.rpc('rewards.info', {});
    expect(missed.daily).toMatchObject({ day: 1, claimable: true, reset: true });
    expect((await client.rpc('rewards.daily', {})).day).toBe(1);
    client.close();
  });
});

describe('playtime rewards', () => {
  it('counts active time only and pays each milestone once', async () => {
    const { client } = await connectNew(server);
    await client.waitFor('rewards.update');
    const svc = server.game.rewards as unknown as { states: Map<string, RewardState> };
    // Not reached yet.
    expect(await client.rpcRaw('rewards.playtime', { minutes: 15 })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await client.rpcRaw('rewards.playtime', { minutes: 7 })).toMatchObject({ ok: false, code: 'bad_request' });

    // Idle (no keys, no camera, no menus for a few minutes): the clock stands still.
    patchRewards(client, { seconds: 899 });
    server.game.sim.chars.get(client.playerId)!.activeAt = Date.now() - 10 * 60_000;
    await sleep(2200);
    expect(svc.states.get(client.playerId)!.seconds).toBe(899);

    // Moving: it runs on, and the player hears about the reward.
    client.events = [];
    const until = Date.now() + 3500;
    while (Date.now() < until && svc.states.get(client.playerId)!.seconds < 900) {
      client.sendInputs(KEY.FORWARD, 6);
      await sleep(200);
    }
    expect(svc.states.get(client.playerId)!.seconds).toBeGreaterThanOrEqual(900);
    const ready = await client.waitFor<RewardsView>('rewards.update', (v) => v.playtime.milestones[0]!.ready);
    expect(ready.playtime.seconds).toBeGreaterThanOrEqual(900);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Ödül hazır!');

    const m0 = money(client);
    const r = await client.rpc('rewards.playtime', { minutes: 15 });
    expect(r.reward).toBe('$2,500');
    expect(money(client)).toBe(m0 + 2_500);
    expect(await client.rpcRaw('rewards.playtime', { minutes: 15 })).toMatchObject({ ok: false, code: 'conflict' });

    // 60 minutes: money and XP.
    patchRewards(client, { seconds: 3600 });
    const xp0 = server.game.state.players.get(client.playerId)!.xp;
    await client.rpc('rewards.playtime', { minutes: 60 });
    expect(server.game.state.players.get(client.playerId)!.xp).toBeGreaterThanOrEqual(xp0 + 200);

    // Three hours: the mega reward needs a choice.
    patchRewards(client, { seconds: 3 * 3600 });
    expect(await client.rpcRaw('rewards.playtime', { minutes: 180 })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await client.rpcRaw('rewards.playtime', { minutes: 180, choice: 'gold' })).toMatchObject({ ok: false, code: 'bad_request' });
    const m1 = money(client);
    const mega = await client.rpc('rewards.playtime', { minutes: 180, choice: 'pawn' });
    expect(money(client)).toBe(m1 + 100_000);
    expect(inv(client)[PAWN_BONUS_ITEM]).toBe(1);
    expect(mega.view.playtime.milestones.find((m) => m.minutes === 180)!.claimed).toBe(true);
    // Never more than three hours a day.
    patchRewards(client, { seconds: 3 * 3600 });
    client.sendInputs(KEY.FORWARD, 6);
    await sleep(1500);
    expect(svc.states.get(client.playerId)!.seconds).toBe(3 * 3600);
    client.close();
    await sleep(200);
    expect(await repo.loadRewards(server.db, client.playerId)).toMatchObject({ day: TODAY(), claimed: [15, 60, 180] });
  });

  it('carries on where it left off after a reconnect', async () => {
    const { client, reg } = await connectNew(server);
    await client.waitFor('rewards.update');
    patchRewards(client, { seconds: 1234, claimed: [15] });
    client.close();
    await sleep(300);
    const again = await new (client.constructor as new (url: string, token: string) => TestClient)(server.url, reg.token).connect();
    const v = await again.waitFor<RewardsView>('rewards.update');
    expect(v.playtime.seconds).toBeGreaterThanOrEqual(1234);
    expect(v.playtime.milestones[0]!.claimed).toBe(true);
    again.close();
  });
});

describe('reward coupons', () => {
  it('Pawn Shop +50% coupon is used up by one sale', async () => {
    const { client } = await connectNew(server);
    await client.waitFor('rewards.update');
    const id = partItemId('engine', 2, 't');
    const uow = server.game.state.begin();
    const p = uow.player(client.playerId);
    p.inventory[id] = 2;
    p.inventory[PAWN_BONUS_ITEM] = 1;
    await uow.commit();
    goTo(client, 'pawn');
    expect(ECONOMY.theft.pawnMin).toBe(ECONOMY.theft.pawnMax);
    const withBonus = await client.rpc('pawn.sell', { part: 'engine' });
    expect(withBonus.count).toBe(2);
    expect(withBonus.amount).toBe(Math.round(ECONOMY.theft.pawnMax * partShare('engine', 't') * 2 * 1.5));
    expect(inv(client)[PAWN_BONUS_ITEM]).toBeUndefined();
    const n = await client.waitFor<{ text: string }>('notify', (d) => d.text.includes('bonus'));
    expect(n.text).toContain('+%50');
    client.close();
  });

  it('Plazma Neon needs the 2-hour reward; the rim & paint coupon pays for wheels and paint', async () => {
    const { client } = await connectNew(server);
    await client.waitFor('rewards.update');
    await setMoney(server, client.playerId, 200_000);
    const { listings } = await client.rpc('market.list', {});
    const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
    const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
    const endService = async () => {
      const fix = server.game.state.begin();
      fix.vehicle(vehicle.id).serviceUntil = 0;
      await fix.commit();
    };
    await endService();
    goTo(client, 'custom');
    expect(await client.rpcRaw('tuning.apply', { vehicleId: vehicle.id, change: {}, legacy: { underglow: SPECIAL_NEON } })).toMatchObject({ ok: false, code: 'forbidden' });
    const give = server.game.state.begin();
    give.player(client.playerId).inventory[NEON_SPECIAL_ITEM] = 1;
    give.player(client.playerId).inventory[RIM_COUPON] = 1;
    await give.commit();
    const m0 = money(client);
    await client.rpc('tuning.apply', { vehicleId: vehicle.id, change: {}, legacy: { underglow: SPECIAL_NEON } });
    expect(server.game.state.vehicles.get(vehicle.id)!.mods.underglow).toBe(SPECIAL_NEON);
    // An unlock, not used up.
    expect(inv(client)[NEON_SPECIAL_ITEM]).toBe(1);
    expect(money(client)).toBe(m0);
    await endService();
    // Wheels and paint for free with the coupon (once).
    await client.rpc('tuning.apply', { vehicleId: vehicle.id, change: { paint: { finish: 'chameleon', color: '#5b2a86', color2: '#1f9e89' }, rim: { design: 'rim_mesh', finish: 'gold' } } });
    expect(money(client)).toBe(m0);
    expect(inv(client)[RIM_COUPON]).toBeUndefined();
    await endService();
    await client.rpc('tuning.apply', { vehicleId: vehicle.id, change: { rim: { design: 'rim_mesh', finish: 'silver' } } });
    expect(money(client)).toBeLessThan(m0);
    client.close();
  });
});

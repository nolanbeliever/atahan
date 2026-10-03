// Driving bonus, missions, reputation unlocks and police pursuits against a real server.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLEYS } from '../../shared/alleys';
import { KMH_PER_MS } from '../../shared/drivetrain';
import { ECONOMY } from '../../shared/economy.config';
import { ECU_COUPON, type MissionView } from '../../shared/missions';
import { KEY } from '../../shared/physics';
import { PF, type BustedEvent, type WantedState } from '../../shared/police';
import { isCategoryUnlocked } from '../../shared/progression';
import { discountedPrice, garageSlots, marketDiscount, spawnSlots } from '../../shared/reputation';
import { marketValue, quickSellPrice } from '../../shared/valuation';
import { getModel } from '../../shared/vehicles';
import { INTERACTABLES } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { driveBonus } from '../../server/game/services/driving';
import { policeFine } from '../../server/game/services/police';
import { connectNew, resetPostgres, setLevel, setMoney, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

async function buyCheapest(client: TestClient): Promise<string> {
  const level = server.game.state.players.get(client.playerId)!.level;
  const pick = async () => {
    const { listings } = await client.rpc('market.list', {});
    // A car: these tests drive it like one (crashes, arrests); motorcycles are covered in moto.test.ts.
    return listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, level) && getModel(x.vehicle.modelId).specs.kind !== 'bike').sort((a, b) => a.askingPrice - b.askingPrice)[0];
  };
  let l = await pick();
  // Earlier tests may have bought the lot empty: restock it now instead of waiting for the refill timer.
  for (let i = 0; !l && i < 10; i++) {
    (server.game.market as unknown as { slotCooldown: Map<number, number> }).slotCooldown.clear();
    await server.game.market.refresh();
    l = await pick();
  }
  if (!l) throw new Error('no vehicle on the market');
  const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: discountedPrice(l.askingPrice, level) });
  const uow = server.game.state.begin();
  const v = uow.vehicle(vehicle.id);
  v.condition = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
  v.fuel = 100;
  await uow.commit();
  return vehicle.id;
}

async function driveNewCar(client: TestClient): Promise<string> {
  const id = await buyCheapest(client);
  await client.rpc('vehicle.spawn', { vehicleId: id });
  await client.rpc('vehicle.enter', { vehicleId: id });
  return id;
}

async function drive(client: TestClient, keys: () => number, ms: number, until?: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (until?.()) return;
    client.sendInputs(keys(), 3);
    await sleep(100);
  }
}

const cash = (client: TestClient) => server.game.state.players.get(client.playerId)!.money;
const missions = (client: TestClient) => {
  const all = client.events.filter((e) => e.event === 'missions.update').map((e) => (e.data as { missions: MissionView[] }).missions);
  return all[all.length - 1] ?? [];
};

describe('reputation unlocks', () => {
  it('grow with the level', () => {
    expect(garageSlots(1)).toBe(ECONOMY.unlocks.garage.base);
    expect(garageSlots(50)).toBeGreaterThan(garageSlots(10));
    expect(spawnSlots(1)).toBe(2);
    expect(spawnSlots(20)).toBeGreaterThan(spawnSlots(1));
    expect(marketDiscount(1)).toBe(0);
    expect(marketDiscount(30)).toBeCloseTo(0.1);
  });

  it('the market charges the reputation discount', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 1_000_000);
    await setLevel(server, client.playerId, 10);
    const { listings } = await client.rpc('market.list', {});
    const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 10)).sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
    // The old (undiscounted) price is refused, the discounted one is charged.
    expect(await client.rpcRaw('market.buy', { listingId: l.id, expectedPrice: l.askingPrice })).toMatchObject({ ok: false, code: 'conflict' });
    const res = await client.rpc('market.buy', { listingId: l.id, expectedPrice: discountedPrice(l.askingPrice, 10) });
    expect(res.price).toBe(discountedPrice(l.askingPrice, 10));
    expect(res.price).toBeLessThan(l.askingPrice);
    // The ledger shows the discounted price (cash can also move from achievement / level rewards).
    const { transactions } = await client.rpc('transactions', {});
    const buy = transactions.find((t) => t.kind === 'market_buy' && t.vehicleId === l.vehicle.id);
    expect(buy?.amount).toBe(-res.price);
    client.close();
  });
});

describe('driving bonus', () => {
  it('pays every 10 s of driving, scaled by the car value; nothing while parked', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 200_000);
    const vehicleId = await driveNewCar(client);
    const d = server.game.sim.drives.get(vehicleId)!;
    // A long straight road through the city (x = 50, heading north to south).
    server.game.sim.placeDrive(vehicleId, 50, -140, 0);
    // Parked for 11 s: no bonus.
    await drive(client, () => KEY.BRAKE, 11_000);
    expect(client.events.some((e) => e.event === 'drive.bonus')).toBe(false);
    // Driving: a bonus arrives.
    await drive(client, () => (d.dyn.z > 120 ? KEY.BRAKE : KEY.FORWARD), 13_000, () => client.events.some((e) => e.event === 'drive.bonus'));
    const bonus = client.events.find((e) => e.event === 'drive.bonus')?.data as { amount: number; value: number } | undefined;
    expect(bonus, 'drive bonus').toBeDefined();
    const v = server.game.state.vehicles.get(vehicleId)!;
    expect(bonus!.amount).toBe(driveBonus(bonus!.value));
    expect(Math.abs(bonus!.value - marketValue(v, server.game.state.trends))).toBeLessThan(v.condition.body > 0 ? 500 : 1e9);
    // The formula: $50 per 10 s at $50k, ~$350 at $300k.
    expect(driveBonus(50_000)).toBe(50);
    expect(driveBonus(300_000)).toBeGreaterThan(330);
    expect(driveBonus(300_000)).toBeLessThan(370);
    client.close();
  }, 40_000);
});

describe('missions', () => {
  it('sends the daily set, pays the timed rush sale and refuses bad starts', async () => {
    const { client } = await connectNew(server);
    await client.waitFor('missions.update');
    const list = missions(client);
    expect(list.map((m) => m.id)).toEqual(expect.arrayContaining(['clean10', 'hold250', 'sell2']));
    expect(list).toHaveLength(ECONOMY.missions.dailyCount);
    expect(await client.rpcRaw('missions.start', { id: 'clean10' })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await client.rpcRaw('missions.start', { id: 'nope' })).toMatchObject({ ok: false, code: 'not_found' });

    await setMoney(server, client.playerId, 500_000);
    const a = await buyCheapest(client);
    const b = await buyCheapest(client);
    // Selling before the clock starts doesn't count.
    const c = await buyCheapest(client);
    const sell = async (id: string) => {
      const expectedPrice = quickSellPrice(server.game.state.vehicles.get(id)!, server.game.state.trends);
      const { price } = await client.rpc('vehicle.quickSell', { vehicleId: id, expectedPrice });
      return price;
    };
    await sell(c);
    await sleep(300);
    expect(missions(client).find((m) => m.id === 'sell2')!.progress).toBe(0);
    const started = await client.rpc('missions.start', { id: 'sell2' });
    expect(started.missions.find((m) => m.id === 'sell2')!.endsAt).toBeGreaterThan(Date.now());
    const money0 = cash(client);
    const p1 = await sell(a);
    const p2 = await sell(b);
    const done = await client.waitFor<{ id: string; reward: string }>('missions.complete', (d) => d.id === 'sell2');
    expect(done.reward).toContain('$5,000');
    await sleep(300);
    // Cash: both sales and the $5,000 reward (achievements may add their own rewards on top).
    expect(cash(client)).toBeGreaterThanOrEqual(money0 + p1 + p2 + 5_000);
    const { transactions } = await client.rpc('transactions', {});
    expect(transactions.filter((t) => t.kind === 'mission').reduce((a, t) => a + t.amount, 0)).toBe(5_000);
    expect(missions(client).find((m) => m.id === 'sell2')!.done).toBe(true);
    expect(await client.rpcRaw('missions.start', { id: 'sell2' })).toMatchObject({ ok: false, code: 'conflict' });
    client.close();
  }, 30_000);

  it('holding 250 km/h for 5 s wins a Stage 1 ECU coupon, and the coupon pays for the remap', async () => {
    const { client } = await connectNew(server);
    await client.waitFor('missions.update');
    await setMoney(server, client.playerId, 200_000);
    const vehicleId = await driveNewCar(client);
    const d = server.game.sim.drives.get(vehicleId)!;
    for (let i = 0; i < 6; i++) {
      d.dyn.speed = 255 / KMH_PER_MS;
      server.game.missions.tickFast(1);
    }
    await client.waitFor<{ id: string }>('missions.complete', (e) => e.id === 'hold250');
    await sleep(300);
    expect(server.game.state.players.get(client.playerId)!.inventory[ECU_COUPON]).toBe(1);
    // At the tuning garage the Stage 1 remap is free with the coupon.
    await client.rpc('vehicle.exit', {});
    const custom = INTERACTABLES.find((i) => i.kind === 'custom')!;
    server.game.sim.teleport(client.playerId, custom.x, custom.z);
    const res = await client.rpc('tuning.apply', { vehicleId, change: { perf: { ecu: 'ecu_stage1' } } });
    expect(res.cost).toBe(0);
    expect(server.game.state.players.get(client.playerId)!.inventory[ECU_COUPON]).toBeUndefined();
    client.close();
  }, 30_000);

  it('ten clean near misses in a row pay $2,500; a crash resets the streak', async () => {
    const { client } = await connectNew(server);
    await client.waitFor('missions.update');
    const m = server.game.missions;
    const progress = () => m.views(client.playerId).find((x) => x.id === 'clean10')!.progress;
    for (let i = 0; i < 6; i++) m.onNearMiss(client.playerId, { kmh: 170, combo: i + 1 });
    expect(progress()).toBe(6);
    m.onCrash(client.playerId);
    expect(progress()).toBe(0);
    const money0 = cash(client);
    for (let i = 0; i < 10; i++) m.onNearMiss(client.playerId, { kmh: 170, combo: i + 1 });
    await client.waitFor<{ id: string }>('missions.complete', (e) => e.id === 'clean10');
    await sleep(300);
    expect(cash(client)).toBe(money0 + 2_500);
    client.close();
  });
});

describe('police', () => {
  it('wanted stars bring pursuit cars; 45 s out of their sight is an escape', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 50_000);
    const vehicleId = await driveNewCar(client);
    server.game.sim.placeDrive(vehicleId, 50, -120, 0);
    server.game.police.addHeat(client.playerId, 250);
    // The cars join one after the other, a few seconds apart (not in a bunch).
    const wanted = await client.waitFor<WantedState>('police.wanted', (w) => w.stars === 3 && w.units === 2, 9000);
    expect(wanted.stars).toBe(3);
    await client.waitSnapshot((s) => (s.po?.length ?? 0) === 2, 5000);
    // 3 stars bring the helicopter too; it spots you from above.
    await client.waitFor<WantedState>('police.wanted', (x) => x.heli === 'seen', 5000);
    // Lose them: the police cars and the helicopter end up far away, the report is old news, and
    // the hidden countdown is nearly over.
    const w = server.game.police.wantedOf(client.playerId)! as unknown as { units: { dyn: { x: number; z: number; speed: number } }[]; hiddenT: number; dispatchUntil: number };
    for (const u of w.units) Object.assign(u.dyn, { x: -150, z: 150, speed: 0 });
    Object.assign(server.game.police.heliOf(client.playerId)!, { x: -150, z: 150, lostT: ECONOMY.police.heli.lostSec + 1 });
    w.dispatchUntil = 0;
    w.hiddenT = ECONOMY.police.sight.hiddenSec - 0.3;
    const money0 = cash(client);
    // ESCAPED: $2,000 for the two police cars, and the wanted level is gone.
    const esc = await client.waitFor<{ reward: number; cars: number }>('police.escaped', () => true, 5000);
    expect(esc.cars).toBe(2);
    expect(esc.reward).toBe(2_000);
    expect(esc.reward).toBe(Math.max(ECONOMY.police.escapeReward, 2 * ECONOMY.police.escapePerCar));
    await sleep(300);
    // (An escape mission in today's set pays on top.)
    expect(cash(client)).toBeGreaterThanOrEqual(money0 + 2_000);
    expect(server.game.police.wantedOf(client.playerId)).toBeUndefined();
    expect(server.game.police.starsOf(client.playerId)).toBe(0);
    client.close();
  }, 30_000);

  it('behind a building the hidden countdown runs; a glimpse does not reset it, 2 s in sight does; lost units search', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 50_000);
    const vehicleId = await driveNewCar(client);
    // West of the bank, facing north; the police car on the far (east) side of the bank.
    server.game.sim.placeDrive(vehicleId, -131, -24, 0);
    server.game.police.addHeat(client.playerId, 150);
    await client.waitFor<WantedState>('police.wanted', (x) => x.stars === 2 && x.units === 1, 9000);
    type U = { dyn: { x: number; z: number; rot: number; speed: number }; parked: boolean; searching: boolean };
    const w = server.game.police.wantedOf(client.playerId)! as unknown as { units: U[]; hiddenT: number; dispatchUntil: number; knows: boolean };
    const u = w.units[0]!;
    const hide = () => Object.assign(u.dyn, { x: -68, z: -24, rot: -Math.PI / 2, speed: 0 });
    const show = () => Object.assign(u.dyn, { x: -131, z: -52, rot: 0, speed: 0 });
    u.parked = true;
    hide();
    w.dispatchUntil = 0;
    w.hiddenT = 0;
    client.events.length = 0;
    // Out of sight: HIDDEN, counting down from 45 s.
    const hidden = await client.waitFor<WantedState>('police.wanted', (x) => x.escapeLeft !== null, 5000);
    expect(hidden.escapeLeft!).toBeGreaterThan(ECONOMY.police.sight.hiddenSec - 3);
    expect(w.knows).toBe(false);
    await sleep(800);
    const before = w.hiddenT;
    expect(before).toBeGreaterThan(0.5);
    // A glimpse (under 2 s): the countdown goes on.
    client.events.length = 0;
    show();
    await client.waitFor<WantedState>('police.wanted', (x) => (x.seen ?? 0) > 0, 3000);
    expect(w.knows).toBe(true);
    await sleep(600);
    hide();
    await sleep(300);
    expect(w.hiddenT).toBeGreaterThan(before + 0.6);
    // Kept in sight for 2 s: spotted, the countdown is gone.
    client.events.length = 0;
    show();
    await client.waitFor<WantedState>('police.wanted', (x) => x.escapeLeft === null, 5000);
    expect(w.hiddenT).toBe(0);
    // Hidden again with the car free to drive: it searches round the last sighting (yellow lights).
    client.events.length = 0;
    hide();
    u.parked = false;
    await client.waitSnapshot((s) => (s.po ?? []).some((p) => (p[6] & PF.SEARCH) !== 0), 5000);
    const st = await client.waitFor<WantedState>('police.wanted', (x) => x.search === true && x.escapeLeft !== null, 5000);
    expect(st.escapeLeft!).toBeGreaterThan(ECONOMY.police.sight.hiddenSec - 5);
    client.close();
  }, 40_000);

  it('a police car diving after you into a back alley hits the bollards and never gets through', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 50_000);
    const vehicleId = await driveNewCar(client);
    // Inside the alley behind Wrench Bros (teleported: a car couldn't get in).
    const alley = ALLEYS.find((a) => a.id === 'wrench')!;
    server.game.sim.placeDrive(vehicleId, 78, alley.c, Math.PI / 2);
    server.game.police.addHeat(client.playerId, 150);
    await client.waitFor<WantedState>('police.wanted', (x) => x.stars === 2 && x.units === 1, 9000);
    type U = { dyn: { x: number; z: number; rot: number; speed: number; gear: number }; followIn: string | null; crashUntil: number };
    const w = server.game.police.wantedOf(client.playerId)! as unknown as { units: U[] };
    const u = w.units[0]!;
    // Right behind the player at 95 km/h, following them in.
    Object.assign(u.dyn, { x: 46, z: alley.c, rot: Math.PI / 2, speed: 95 / KMH_PER_MS, gear: 4 });
    u.followIn = alley.id;
    const crash = await client.waitFor<{ x: number; z: number; kmh: number }>('police.crash', () => true, 4000);
    expect(crash.kmh).toBeGreaterThan(35);
    expect(u.followIn).toBeNull();
    // It never gets past the bollard line, crash or no crash.
    const gate = alley.from + 0.7 - 0.3;
    for (let i = 0; i < 20; i++) {
      expect(u.dyn.x).toBeLessThan(gate);
      await sleep(200);
    }
    client.close();
  }, 30_000);

  it('a police car beside a stopped car for 3 s is an arrest: fine, impound, respawn at a garage', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 120_000);
    const vehicleId = await driveNewCar(client);
    server.game.sim.placeDrive(vehicleId, -50, 60, 0);
    server.game.police.addHeat(client.playerId, 190);
    await client.waitFor<WantedState>('police.wanted', (w) => w.units === 1, 5000);
    const w = server.game.police.wantedOf(client.playerId)!;
    const d = server.game.sim.drives.get(vehicleId)!;
    const money0 = cash(client);
    // Keep the police car parked right beside the player while they sit still.
    const start = Date.now();
    let busted: BustedEvent | undefined;
    while (!busted && Date.now() - start < 9000) {
      const u = w.units[0];
      if (u) Object.assign(u.dyn, { x: d.dyn.x + 2.3, z: d.dyn.z, rot: d.dyn.rot, speed: 0 });
      client.sendInputs(KEY.BRAKE, 3);
      await sleep(100);
      busted = client.events.find((e) => e.event === 'police.busted')?.data as BustedEvent | undefined;
    }
    expect(busted, 'busted').toBeDefined();
    expect(busted!.fine).toBe(policeFine(money0).total);
    expect(busted!.fine).toBe(3_000);
    await sleep(ECONOMY.police.cutsceneSec * 1000 + 1500);
    expect(cash(client)).toBe(money0 - busted!.fine);
    expect(server.game.state.vehicles.get(vehicleId)!.status).toBe('stored');
    expect(server.game.sim.chars.get(client.playerId)!.drivingId).toBeNull();
    const pos = server.game.sim.position(client.playerId)!;
    expect(Math.hypot(pos.x - busted!.respawn.x, pos.z - busted!.respawn.z)).toBeLessThan(3);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'POLİSE YAKALANDIN!');
    client.close();
  }, 40_000);
});


// Telegram dealing over real sockets: order from the supplier, get into the car (the handover),
// take a customer's order by hand (and meet an undercover cop) or through a dead drop; the
// police take the goods when they arrest you.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import type { WantedState } from '../../shared/police';
import { DEALS, dropPrice, findDrop, type DealCar, type DealScene, type TgState } from '../../shared/telegram';
import type { RunningServer } from '../../server/main';
import { GOODS_ITEM } from '../../server/game/services/telegram';
import { connectNew, resetPostgres, setMoney, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const SCENE = ECONOMY.deals.sceneSec;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
  // Quick handovers for the tests.
  ECONOMY.deals.sceneSec = 0.4;
});

afterAll(async () => {
  ECONOMY.deals.sceneSec = SCENE;
  await server?.close();
});

const goods = (c: TestClient) => server.game.state.players.get(c.playerId)!.inventory[GOODS_ITEM] ?? 0;
const cash = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;

async function giveGoods(c: TestClient, grams: number): Promise<void> {
  const uow = server.game.state.begin();
  uow.player(c.playerId).inventory[GOODS_ITEM] = grams;
  await uow.commit();
}

function at(c: TestClient, car: { x: number; z: number }): Promise<void> {
  server.game.sim.teleport(c.playerId, car.x + 2.4, car.z);
  return sleep(150);
}

/** A new order in the channel right away. */
async function newOrder(c: TestClient): Promise<TgState['orders'][number]> {
  const phones = (server.game.deals as unknown as { phones: Map<string, { nextOrderAt: number }> }).phones;
  c.events.length = 0;
  phones.get(c.playerId)!.nextOrderAt = 0;
  const s = await c.waitFor<TgState>('tg.update', (x) => x.orders.some((o) => o.status === 'open'), 4000);
  return s.orders.find((o) => o.status === 'open')!;
}

describe('telegram dealing', () => {
  it('the supplier: a car with a sticker at a location; in the car, $500 for 10 g', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 5_000);
    const s = await client.rpc('tg.order', {});
    expect(s.pickup).not.toBeNull();
    const msg = s.messages.filter((m) => m.chat === 'supplier').at(-1)!;
    expect(msg.car).toMatchObject({ sticker: expect.any(String), colorName: expect.any(String) });
    expect(msg.pin).toBeDefined();
    const cars = await client.waitFor<DealCar[]>('deal.cars', (l) => l.some((c) => c.forId === client.playerId));
    const car = cars.find((c) => c.forId === client.playerId)!;
    expect(car.kind).toBe('supplier');
    // Only one package at a time; get in from up close.
    expect(await client.rpcRaw('tg.order', {})).toMatchObject({ ok: false, code: 'conflict' });
    expect(await client.rpcRaw('tg.enter', { carId: car.id })).toMatchObject({ ok: false, code: 'too_far' });
    await at(client, car);
    const scene = await client.rpc('tg.enter', { carId: car.id });
    expect(scene).toMatchObject({ kind: 'buy', cop: false, grams: DEALS.grams, money: DEALS.buyPrice });
    const done = await client.waitFor<{ kind: string }>('deal.done', () => true, 4000);
    expect(done.kind).toBe('buy');
    await sleep(100);
    expect(cash(client)).toBe(5_000 - DEALS.buyPrice);
    expect(goods(client)).toBe(DEALS.grams);
    expect(server.game.deals.carsOf(client.playerId)).toHaveLength(0);
    client.close();
  }, 20_000);

  it('a customer by hand pays dirty money; an undercover cop brings three stars and takes the goods', async () => {
    const { client } = await connectNew(server);
    const o = await newOrder(client);
    let s = await client.rpc('tg.accept', { orderId: o.id, mode: 'hand' });
    const order = s.orders.find((x) => x.id === o.id)!;
    expect(order.status).toBe('hand');
    let car = server.game.deals.carsOf(client.playerId).find((c) => c.id === order.carId)!;
    (car as { cop: boolean }).cop = false;
    await at(client, car);
    // Nothing to sell yet.
    expect(await client.rpcRaw('tg.enter', { carId: car.id })).toMatchObject({ ok: false, code: 'conflict' });
    await giveGoods(client, 40);
    const scene: DealScene = await client.rpc('tg.enter', { carId: car.id });
    expect(scene).toMatchObject({ kind: 'sell', cop: false, grams: o.grams, money: o.price });
    await client.waitFor('deal.done', () => true, 4000);
    await sleep(100);
    expect(server.game.crime.view(client.playerId).dirty).toBe(o.price);
    expect(goods(client)).toBe(40 - o.grams);
    // The next one is a cop.
    const o2 = await newOrder(client);
    s = await client.rpc('tg.accept', { orderId: o2.id, mode: 'hand' });
    car = server.game.deals.carsOf(client.playerId).find((c) => c.id === s.orders.find((x) => x.id === o2.id)!.carId)!;
    (car as { cop: boolean }).cop = true;
    await at(client, car);
    const sc2 = await client.rpc('tg.enter', { carId: car.id });
    expect(sc2.cop).toBe(true);
    const done = await client.waitFor<{ cop: boolean }>('deal.done', (d) => d.cop, 4000);
    expect(done.cop).toBe(true);
    const w = await client.waitFor<WantedState>('police.wanted', (x) => x.stars >= DEALS.copStars, 4000);
    expect(w.stars).toBe(DEALS.copStars);
    expect(server.game.crime.view(client.playerId).dirty).toBe(o.price);
    client.close();
  }, 30_000);

  it('a dead drop: leave the package, the customer collects and pays a bit less', async () => {
    const { client } = await connectNew(server);
    await giveGoods(client, 20);
    const o = await newOrder(client);
    const s = await client.rpc('tg.accept', { orderId: o.id, mode: 'drop' });
    const drop = findDrop(s.orders.find((x) => x.id === o.id)!.dropId!)!;
    expect(await client.rpcRaw('tg.drop', { orderId: o.id })).toMatchObject({ ok: false, code: 'too_far' });
    server.game.sim.teleport(client.playerId, drop.x, drop.z);
    await sleep(150);
    const after = await client.rpc('tg.drop', { orderId: o.id });
    expect(after.orders.find((x) => x.id === o.id)!.status).toBe('dropped');
    expect(goods(client)).toBe(20 - o.grams);
    // The customer comes by (wound forward).
    const phones = (server.game.deals as unknown as { phones: Map<string, { payAt: Map<string, number> }> }).phones;
    phones.get(client.playerId)!.payAt.set(o.id, 0);
    const paid = await client.waitFor<{ amount: number }>('deal.paid', () => true, 4000);
    expect(paid.amount).toBe(dropPrice(o.price));
    await sleep(100);
    expect(server.game.crime.view(client.playerId).dirty).toBe(dropPrice(o.price));
    client.close();
  }, 30_000);

  it('arrested: the police take the goods', async () => {
    const { client } = await connectNew(server);
    await giveGoods(client, 30);
    server.game.police.addHeat(client.playerId, 150);
    await sleep(200);
    const police = server.game.police as unknown as { bust(pid: string, w: unknown, me: unknown): Promise<void> };
    const c = server.game.sim.chars.get(client.playerId)!;
    await police.bust(client.playerId, server.game.police.wantedOf(client.playerId), { x: c.x, z: c.z, rot: 0, vehicleId: null, hl: 0.4, hw: 0.4 });
    await sleep(400);
    expect(goods(client)).toBe(0);
    client.close();
  }, 20_000);
});

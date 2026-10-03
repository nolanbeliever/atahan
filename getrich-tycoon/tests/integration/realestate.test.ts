// The estate agent over real sockets: buy a business with clean money, pay dirty money into it,
// and every 10 minutes it comes back as clean cash (saved with the player).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { findBusiness } from '../../shared/realestate';
import type { CrimeView } from '../../shared/underworld';
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

const cash = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;

async function giveDirty(playerId: string, amount: number): Promise<void> {
  const uow = server.game.state.begin();
  server.game.crime.edit(uow, playerId, (s) => (s.dirty += amount));
  await server.game.crime.commit(uow);
}

describe('estate agent and laundering', () => {
  it('buy a business, pay dirty money in, get clean money back every 10 minutes', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 1_000_000);
    await sleep(200);
    // Only at the estate agent.
    expect(await client.rpcRaw('realestate.buy', { businessId: 'laundromat' })).toMatchObject({ ok: false, code: 'too_far' });
    const office = INTERACTABLES.find((i) => i.kind === 'realestate')!;
    server.game.sim.teleport(client.playerId, office.x, office.z);
    await sleep(150);
    const biz = findBusiness('laundromat')!;
    let view = await client.rpc('realestate.buy', { businessId: 'laundromat' });
    expect(view.businesses.find((b) => b.id === 'laundromat')?.owned).toBe(true);
    expect(cash(client)).toBe(1_000_000 - biz.price);
    expect(await client.rpcRaw('realestate.buy', { businessId: 'laundromat' })).toMatchObject({ ok: false, code: 'conflict' });
    // Dirty money: only into a business you own, only what you have.
    await giveDirty(client.playerId, 250_000);
    expect(await client.rpcRaw('realestate.deposit', { businessId: 'carwash', amount: 1000 })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await client.rpcRaw('realestate.deposit', { businessId: 'laundromat', amount: 300_000 })).toMatchObject({ ok: false, code: 'insufficient_funds' });
    view = await client.rpc('realestate.deposit', { businessId: 'laundromat', amount: 250_000 });
    expect(view.dirty).toBe(0);
    expect(view.businesses.find((b) => b.id === 'laundromat')).toMatchObject({ pending: 250_000 });
    // Ten minutes later (wound back): $100,000 clean.
    const money0 = cash(client);
    const live = server.game.crime.get(client.playerId).businesses[0]! as { cycleAt: number };
    live.cycleAt -= ECONOMY.laundering.cycleSec * 1000;
    const done = await client.waitFor<{ amount: number }>('crime.laundered', () => true, 5000);
    expect(done.amount).toBe(100_000);
    await sleep(200);
    expect(cash(client)).toBe(money0 + 100_000);
    const after = await client.waitFor<CrimeView>('crime.update', (c) => c.laundered === 100_000);
    expect(after.businesses.find((b) => b.id === 'laundromat')?.pending).toBe(150_000);
    const saved = (await repo.loadCrime(server.game.state.db, client.playerId)) as { businesses: { pending: number }[]; laundered: number };
    expect(saved.laundered).toBe(100_000);
    expect(saved.businesses[0]!.pending).toBe(150_000);
    client.close();
  }, 30_000);
});

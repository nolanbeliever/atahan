// The Sanayi part-time mechanic over real sockets: start a shift at the job board, a customer's car
// goes up on a free lift, do each job at its spot, $1,000 on the spot; the lift is taken meanwhile;
// walking off the estate ends the shift.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { JOB_BOARD, MECH, taskPoint, type MechanicView, type RepairCar } from '../../shared/mechanic';
import { getModel } from '../../shared/vehicles';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, setMoney, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const TASK_SEC = { ...ECONOMY.mechanic.taskSec };

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
  // Quick jobs for the tests.
  Object.assign(ECONOMY.mechanic.taskSec, { engine: 0.3, body: 0.3, tyres: 0.3 });
});

afterAll(async () => {
  Object.assign(ECONOMY.mechanic.taskSec, TASK_SEC);
  await server?.close();
});

const cash = (c: TestClient) => server.game.state.players.get(c.playerId)!.money;

function goTo(c: TestClient, p: { x: number; z: number }): Promise<void> {
  server.game.sim.teleport(c.playerId, p.x, p.z);
  return sleep(150);
}

/** The next customer right away. */
async function nextCar(c: TestClient): Promise<RepairCar> {
  const shift = server.game.mechanic.shiftOf(c.playerId) as { nextAt: number | null };
  c.events.length = 0;
  shift.nextAt = 0;
  const v = await c.waitFor<MechanicView>('mech.update', (x) => !!x.car, 4000);
  return v.car!;
}

describe('the Sanayi mechanic', () => {
  it('a shift: a car on the lift, each job at its spot, $1,000 per car', async () => {
    const { client } = await connectNew(server);
    await setMoney(server, client.playerId, 0);
    // From the job board only.
    expect(await client.rpcRaw('mech.start', {})).toMatchObject({ ok: false, code: 'too_far' });
    await goTo(client, JOB_BOARD);
    const start = await client.rpc('mech.start', {});
    expect(start).toMatchObject({ onDuty: true, car: null, cars: 0 });
    const car = await nextCar(client);
    expect(car.todo.length).toBeGreaterThanOrEqual(2);
    const cars = await client.waitFor<RepairCar[]>('mech.cars', (l) => l.some((x) => x.id === car.id), 2000).catch(() => server.game.mechanic.cars());
    expect(cars.some((x) => x.id === car.id)).toBe(true);
    // The lift is taken for stolen cars meanwhile.
    expect(server.game.theft.bayBusy?.(car.bay)).toBe(true);
    const m = getModel(car.modelId);
    // Not from the job board.
    expect(await client.rpcRaw('mech.work', { task: car.todo[0] })).toMatchObject({ ok: false, code: 'too_far' });
    for (const task of [...car.todo]) {
      await goTo(client, taskPoint(car.bay, task, m.shape.length, m.shape.width));
      const v = await client.rpc('mech.work', { task });
      expect(v.working?.task).toBe(task);
      // One job at a time.
      expect(await client.rpcRaw('mech.work', { task })).toMatchObject({ ok: false, code: 'conflict' });
      await client.waitFor<MechanicView>('mech.update', (x) => !x.working && !(x.car?.todo.includes(task) ?? false), 3000);
    }
    const paid = await client.waitFor<{ amount: number }>('mech.paid', () => true, 3000);
    expect(paid.amount).toBe(MECH.pay);
    await sleep(100);
    expect(cash(client)).toBe(MECH.pay);
    // The car comes down and goes; the next one comes in later.
    await client.waitFor<MechanicView>('mech.update', (x) => x.car === null && x.cars === 1 && x.earned === MECH.pay, 4000);
    expect(server.game.mechanic.cars().filter((x) => x.forId === client.playerId)).toHaveLength(0);
    expect(server.game.theft.bayBusy?.(car.bay)).toBe(false);
    client.close();
  }, 30_000);

  it('walking off a job stops it; leaving the Sanayi ends the shift', async () => {
    const { client } = await connectNew(server);
    await goTo(client, JOB_BOARD);
    await client.rpc('mech.start', {});
    const car = await nextCar(client);
    const m = getModel(car.modelId);
    // A long job this time.
    ECONOMY.mechanic.taskSec.engine = 30;
    try {
      await goTo(client, taskPoint(car.bay, 'engine', m.shape.length, m.shape.width));
      await client.rpc('mech.work', { task: 'engine' });
      await goTo(client, JOB_BOARD);
      const v = await client.waitFor<MechanicView>('mech.update', (x) => !x.working, 3000);
      expect(v.car?.todo).toContain('engine');
    } finally {
      ECONOMY.mechanic.taskSec.engine = 0.3;
    }
    // Off to the city.
    server.game.sim.teleport(client.playerId, 0, 0);
    const end = await client.waitFor<MechanicView>('mech.update', (x) => !x.onDuty, 3000);
    expect(end.car).toBeNull();
    expect(server.game.mechanic.shiftOf(client.playerId)).toBeUndefined();
    expect(server.game.mechanic.cars().some((x) => x.id === car.id)).toBe(false);
    client.close();
  }, 30_000);
});

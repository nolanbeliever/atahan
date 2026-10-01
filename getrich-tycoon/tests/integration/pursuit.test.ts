// Police tracking of a stolen car: the 3-minute countdown after a lockpick, CCTV cameras starting it
// over, the car becoming the thief's when it runs out, and the car seized on an arrest.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CCTV_CAMERAS, cameraYaw, type PursuitView } from '../../shared/cctv';
import { ECONOMY } from '../../shared/economy.config';
import { starsFor } from '../../server/game/services/police';
import { LOCKPICK_ITEM, type StreetCar } from '../../shared/theft';
import { getModel } from '../../shared/vehicles';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const P = ECONOMY.pursuit;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

type Track = { vehicleId: string; left: number; seenBy: string | null; paused: boolean };
const theft = () => server.game.theft as unknown as { sessions: Map<string, { sweet: number }> };
const track = (c: TestClient) => server.game.pursuit.trackOf(c.playerId) as Track | undefined;
const police = () => server.game.police as unknown as { wanted: Map<string, { heat: number; units: unknown[] }>; get(id: string): unknown; bust(id: string, w: unknown, me: unknown): Promise<void>; target(id: string): unknown };

/** Steal a kerbside car (reading the lock's secret from the server, standing in for a good player). */
async function stealCar(client: TestClient): Promise<string> {
  const uow = server.game.state.begin();
  uow.player(client.playerId).inventory[LOCKPICK_ITEM] = 1;
  await uow.commit();
  const { cars } = await client.rpc('street.list', {});
  const car = cars.find((c: StreetCar) => !c.highway && c.alarmUntil === 0)!;
  const side = getModel(car.modelId).shape.width / 2 + 0.8;
  server.game.sim.teleport(client.playerId, car.x + Math.cos(car.rot) * side, car.z - Math.sin(car.rot) * side);
  const { sessionId } = await client.rpc('lockpick.start', { carId: car.id });
  const r = await client.rpc('lockpick.try', { sessionId, angle: theft().sessions.get(client.playerId)!.sweet });
  expect(r.opened).toBe(true);
  return r.vehicleId!;
}

/** Call the police off (no cars around to see the thief). */
function noPolice(client: TestClient): void {
  police().wanted.delete(client.playerId);
}

/** A spot away from every camera's reach. */
function hiddenSpot(): { x: number; z: number } {
  for (const x of [-100, 0, 100]) {
    for (const z of [-100, 0, 100]) {
      if (CCTV_CAMERAS.every((c) => Math.hypot(c.x - x, c.z - z) > c.range + 15)) return { x, z: z + 30 };
    }
  }
  throw new Error('no hidden spot');
}

describe('stolen car tracking', () => {
  it('starts after the lockpick, puts the police on the car, and the car is yours after 3 minutes unseen', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await stealCar(client);
    const first = await client.waitFor<PursuitView>('pursuit.update', (v) => v?.vehicleId === vehicleId);
    expect(first).toMatchObject({ left: P.seconds, total: P.seconds, seenBy: 'lockpick', paused: false });
    expect(starsFor(police().wanted.get(client.playerId)!.heat)).toBeGreaterThanOrEqual(2);
    expect(server.game.sim.chars.get(client.playerId)!.drivingId).toBe(vehicleId);
    // Out of sight, the clock runs down while the thief is in the car.
    const spot = hiddenSpot();
    server.game.sim.placeDrive(vehicleId, spot.x, spot.z, 0);
    noPolice(client);
    await sleep(1200);
    expect(track(client)!.left).toBeLessThan(P.seconds - 0.5);
    expect(track(client)!.left).toBeGreaterThan(P.seconds - 3);
    // Jump to the last second.
    track(client)!.left = 1;
    const result = await client.waitFor<{ outcome: string; vehicleId: string }>('pursuit.result', (r) => r.vehicleId === vehicleId, 5000);
    expect(result.outcome).toBe('success');
    expect(server.game.state.vehicles.get(vehicleId)!.status).toBe('world');
    expect(track(client)).toBeUndefined();
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'CAR STOLEN SUCCESSFULLY!');
    // A normal car now: it can be stored.
    await client.rpc('vehicle.exit', {});
    await client.rpc('vehicle.store', { vehicleId });
    client.close();
  });

  it('a CCTV camera or a police car seeing the car starts the countdown over; out of the car it waits', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await stealCar(client);
    await client.waitFor('pursuit.update');
    const spot = hiddenSpot();
    server.game.sim.placeDrive(vehicleId, spot.x, spot.z, 0);
    noPolice(client);
    track(client)!.left = 60;
    await sleep(600);
    expect(track(client)!.left).toBeLessThan(60);
    // Into a camera's cone.
    const cam = CCTV_CAMERAS[0]!;
    const yaw = cameraYaw(cam, Date.now() + 100);
    server.game.sim.placeDrive(vehicleId, cam.x + Math.sin(yaw) * 10, cam.z + Math.cos(yaw) * 10, 0);
    const seen = await client.waitFor<PursuitView>('pursuit.update', (v) => v?.seenBy === 'camera', 4000);
    expect(seen.left).toBeGreaterThan(P.seconds - 2);
    expect(starsFor(police().wanted.get(client.playerId)!.heat)).toBeGreaterThanOrEqual(2);
    // Back in hiding; out of the car the clock stops.
    server.game.sim.placeDrive(vehicleId, spot.x, spot.z, 0);
    noPolice(client);
    await client.rpc('vehicle.exit', {});
    await client.waitFor<PursuitView>('pursuit.update', (v) => !!v?.paused, 4000);
    const left = track(client)!.left;
    await sleep(1200);
    expect(track(client)!.left).toBe(left);
    client.close();
  });

  it('driving an untracked stolen car past a camera starts a tracking', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await stealCar(client);
    await client.waitFor('pursuit.update');
    // Forget the lockpick's tracking (as if it had ended).
    (server.game.pursuit as unknown as { tracks: Map<string, unknown> }).tracks.delete(client.playerId);
    client.events = [];
    const cam = CCTV_CAMERAS[3]!;
    const yaw = cameraYaw(cam, Date.now() + 100);
    server.game.sim.placeDrive(vehicleId, cam.x + Math.sin(yaw) * 8, cam.z + Math.cos(yaw) * 8, 0);
    const v = await client.waitFor<PursuitView>('pursuit.update', (p) => p?.vehicleId === vehicleId, 4000);
    expect(v.seenBy).toBe('camera');
    client.close();
  });

  it('an arrest seizes the stolen car', async () => {
    const { client } = await connectNew(server);
    const vehicleId = await stealCar(client);
    await client.waitFor('pursuit.update');
    const p = police();
    const w = p.get(client.playerId);
    await p.bust(client.playerId, w, p.target(client.playerId));
    const result = await client.waitFor<{ outcome: string }>('pursuit.result', () => true, ECONOMY.police.cutsceneSec * 1000 + 5000);
    expect(result.outcome).toBe('seized');
    expect(server.game.state.vehicles.has(vehicleId)).toBe(false);
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Araç bağlandı');
    client.close();
  }, 20_000);
});

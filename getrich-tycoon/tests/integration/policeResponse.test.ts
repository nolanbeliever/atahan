// The police response time over real sockets: an offence is reported (radio call, estimated time
// of arrival by stars), the cars set off from the station or a patrol and drive there; gone before
// they get there and the wanted level is called off at an empty, taped-off crime scene with two
// officers combing it; a car that keeps you in sight on the way turns it into a pursuit; crossing
// the tape is 1 star and a stop warning; the police scanner shows the live countdown; 3 stars
// bring a SWAT van and the helicopter.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { PF, POLICE_STATIONS, type CrimeSceneView, type PoliceSnap, type RadioLine, type WantedState } from '../../shared/police';
import { isCategoryUnlocked } from '../../shared/progression';
import { Anim } from '../../shared/types';
import { getModel } from '../../shared/vehicles';
import { INTERACTABLES } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const R = ECONOMY.police.response;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

type U = { id: number; mode: string; swat: boolean; parked: boolean; dyn: { x: number; z: number; rot: number; speed: number } };
type W = { units: U[]; pending: { at: number; station: boolean; swat: boolean; x: number; z: number }[]; call: { x: number; z: number; arriveAt: number; arrivedAt: number | null } | null; engaged: boolean };
const wantedOf = (id: string) => server.game.police.wantedOf(id) as unknown as W | undefined;

/** Let every car waiting to set off go now, and wait for them on the road. */
async function rollOut(id: string, n: number): Promise<U[]> {
  const w = wantedOf(id)!;
  for (const p of w.pending) p.at = 0;
  const until = Date.now() + 5000;
  while (w.units.length < n && Date.now() < until) await sleep(100);
  expect(w.units.length).toBeGreaterThanOrEqual(n);
  return w.units;
}

/** Report a gunshot at (x, z), walk away out of sight, and have the cars get to the scene. */
async function emptyScene(client: TestClient, x: number, z: number): Promise<CrimeSceneView> {
  server.game.sim.teleport(client.playerId, x, z);
  await sleep(300);
  server.game.police.raiseHeat(client.playerId, 150, 'gunshot');
  // Gone: far away behind the buildings.
  server.game.sim.teleport(client.playerId, 120, 125);
  const units = await rollOut(client.playerId, 2);
  units.forEach((u, i) => Object.assign(u.dyn, { x: x + 6 + i * 6, z: z + 3, speed: 0 }));
  // (Scenes still up from before come in on connect too: this one is at x, z.)
  return client.waitFor<CrimeSceneView>('police.scene', (v) => Math.hypot(v.x - x, v.z - z) < 1, (R.scanSec + 4) * 1000);
}

describe('police response time', () => {
  it('an offence is reported, nobody appears at your side: a call with the arrival time by stars, cars from the station', async () => {
    const { client } = await connectNew(server);
    server.game.sim.teleport(client.playerId, 20, -50);
    await sleep(300);
    server.game.police.raiseHeat(client.playerId, 150, 'gunshot');
    // The radio call and the yellow banner's estimate: 2 stars, 30-40 s.
    const call = await client.waitFor<RadioLine>('police.radio', (r) => r.tone === 'call');
    expect(call.text).toContain('Tüm birimlerin dikkatine');
    expect(call.text).toContain('silah sesi ihbarı');
    const [lo, hi] = R.etaSec[2]!;
    expect(call.eta!).toBeGreaterThanOrEqual(lo - 1);
    expect(call.eta!).toBeLessThanOrEqual(hi + 1);
    const ws = await client.waitFor<WantedState>('police.wanted', (x) => !!x.call);
    expect(ws.stars).toBe(2);
    expect(ws.call!.cars).toBe(R.cars[2]);
    expect(ws.call!.arrived).toBe(false);
    expect(ws.call!.eta).toBeUndefined(); // no scanner: no live countdown
    expect(ws.engaged).toBeUndefined();
    // Two cars, setting off from the city station's forecourt when they have to (not yet).
    const w = wantedOf(client.playerId)!;
    expect(w.units).toHaveLength(0);
    expect(w.pending).toHaveLength(2);
    const st = POLICE_STATIONS[0]!;
    for (const p of w.pending) {
      expect(p.station).toBe(true);
      expect(Math.hypot(p.x - st.bay.x, p.z - st.bay.z)).toBeLessThan(1);
    }
    // Nothing near the player meanwhile.
    await sleep(1500);
    const snap = await client.waitSnapshot(() => true, 2000);
    for (const p of snap.po ?? []) expect(Math.hypot(p[1] - 20, p[2] + 50)).toBeGreaterThan(100);
    // When they set off they come out of the station with the siren on and drive there.
    const [u] = await rollOut(client.playerId, 1);
    expect(Math.hypot(u!.dyn.x - st.bay.x, u!.dyn.z - st.bay.z)).toBeLessThan(8);
    expect(u!.mode).toBe('respond');
    const d0 = Math.hypot(u!.dyn.x - 20, u!.dyn.z + 50);
    const s2 = await client.waitSnapshot((s) => (s.po ?? []).some((p) => p[0] === u!.id), 3000);
    expect(s2.po!.find((p) => p[0] === u!.id)![6] & PF.SIREN).toBeTruthy();
    await sleep(3000);
    expect(Math.hypot(u!.dyn.x - 20, u!.dyn.z + 50)).toBeLessThan(d0 - 15);
    client.close();
  }, 30_000);

  it('the police scanner: in a car with it fitted, the live countdown to the police arriving and the units on the map', async () => {
    const { client } = await connectNew(server);
    const { listings } = await client.rpc('market.list', {});
    const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1) && getModel(x.vehicle.modelId).specs.kind === 'car').sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
    const uow = server.game.state.begin();
    uow.player(client.playerId).money = 200_000;
    await uow.commit();
    const { vehicle } = await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
    const custom = INTERACTABLES.find((i) => i.kind === 'custom')!;
    server.game.sim.teleport(client.playerId, custom.x, custom.z);
    await sleep(300);
    const fitted = await client.rpc('security.buy', { vehicleId: vehicle.id, item: 'scanner' });
    expect(fitted.vehicle.mods.scanner).toBe(true);
    await client.rpc('vehicle.spawn', { vehicleId: vehicle.id });
    await client.rpc('vehicle.enter', { vehicleId: vehicle.id });
    server.game.sim.placeDrive(vehicle.id, 50, -20, 0);
    await sleep(300);
    server.game.police.raiseHeat(client.playerId, 150, 'gunshot');
    const ws = await client.waitFor<WantedState>('police.wanted', (x) => x.scanner === true && x.call?.eta !== undefined);
    expect(ws.call!.eta!).toBeGreaterThan(5);
    expect(ws.call!.eta!).toBeLessThanOrEqual(R.etaSec[2]![1] + 1);
    // The units show up on the map once they are on the road, and the countdown runs.
    await rollOut(client.playerId, 1);
    const w2 = await client.waitFor<WantedState>('police.wanted', (x) => (x.call?.units?.length ?? 0) > 0, 3000);
    expect(w2.call!.units![0]).toHaveLength(2);
    client.close();
  }, 30_000);

  it('3 stars: a SWAT van among the cars and the helicopter, there in 15-20 s', async () => {
    const { client } = await connectNew(server);
    server.game.sim.teleport(client.playerId, 100, -60);
    await sleep(300);
    server.game.police.raiseHeat(client.playerId, 250, 'shooting');
    const call = await client.waitFor<RadioLine>('police.radio', (r) => r.tone === 'call');
    expect(call.text).toContain('silahlı çatışma');
    const [lo, hi] = R.etaSec[3]!;
    expect(call.eta!).toBeGreaterThanOrEqual(lo - 1);
    expect(call.eta!).toBeLessThanOrEqual(hi + 1);
    const ws = await client.waitFor<WantedState>('police.wanted', (x) => !!x.call);
    expect(ws.call!.swat).toBe(R.swat[3]);
    expect(ws.call!.heli).toBe(true);
    const units = await rollOut(client.playerId, R.cars[3]!);
    expect(units.filter((u) => u.swat)).toHaveLength(R.swat[3]!);
    const snap = await client.waitSnapshot((s) => (s.po ?? []).some((p) => (p[6] & PF.SWAT) !== 0), 4000);
    expect(snap.po!.some((p) => (p[6] & PF.SWAT) !== 0)).toBe(true);
    // The helicopter takes off to get there with the cars (not overhead at once).
    expect(server.game.police.heliOf(client.playerId)).toBeUndefined();
    client.close();
  }, 30_000);

  it('gone before they get there: they look round, find nobody, call it off and tape the scene off', async () => {
    const { client } = await connectNew(server);
    const money = server.game.state.players.get(client.playerId)!.money;
    const view = await emptyScene(client, 0, -70);
    // Nobody: no stars, no reward, the radio calls it off.
    const ws = await client.waitFor<WantedState>('police.wanted', (x) => x.stars === 0);
    expect(ws.units).toBe(0);
    await client.waitFor<RadioLine>('police.radio', (r) => r.tone === 'clear' && r.text.includes('Olay yeri inceleme'));
    await client.waitFor<{ title: string }>('notify', (n) => n.title === 'Polis seni bulamadı!');
    expect(server.game.police.starsOf(client.playerId)).toBe(0);
    expect(server.game.state.players.get(client.playerId)!.money).toBe(money);
    // The cordon: cones round the scene with the tape, flares, evidence markers inside.
    expect(Math.hypot(view.x, view.z + 70)).toBeLessThan(1);
    expect(view.posts).toHaveLength(ECONOMY.police.scene.posts);
    for (const [px, pz] of view.posts) expect(Math.hypot(px - view.x, pz - view.z)).toBeLessThanOrEqual(ECONOMY.police.scene.radius + 0.01);
    expect(view.flares.length).toBeGreaterThan(0);
    expect(view.evidence.length).toBeGreaterThan(0);
    expect(view.until - Date.now()).toBeGreaterThan((ECONOMY.police.scene.lifeSec - 5) * 1000);
    // Two officers out of the cars, combing it with torches; the cars wait with their lights on (no siren).
    const csi = [...server.game.sim.npcs.values()].filter((n) => n.id.startsWith('csi_'));
    expect(csi).toHaveLength(2);
    const near = (p: PoliceSnap) => Math.hypot(p[1] - view.x, p[2] - view.z) < 25;
    await sleep(300);
    const snap = await client.waitSnapshot((s) => (s.po ?? []).filter(near).length >= 2, 3000);
    for (const p of snap.po!.filter(near)) expect(p[6] & PF.QUIET).toBeTruthy();
    // They go and kneel at the evidence (photographing it).
    const until = Date.now() + 12_000;
    while (!csi.some((n) => n.anim === Anim.Kneel) && Date.now() < until) await sleep(200);
    expect(csi.some((n) => n.anim === Anim.Kneel)).toBe(true);
    client.close();
  }, 40_000);

  it('a car on its way that keeps you in sight turns the call into a pursuit', async () => {
    const { client } = await connectNew(server);
    server.game.sim.teleport(client.playerId, 0, -100);
    await sleep(300);
    server.game.police.raiseHeat(client.playerId, 150, 'carAlarm');
    const [u] = await rollOut(client.playerId, 1);
    // Coming up the street straight at the player, 40 m away.
    Object.assign(u!.dyn, { x: 0, z: -140, rot: 0, speed: 0 });
    u!.parked = true;
    const ws = await client.waitFor<WantedState>('police.wanted', (x) => x.engaged === true, 6000);
    expect(ws.call).toBeUndefined();
    await client.waitFor<RadioLine>('police.radio', (r) => r.tone === 'alert');
    await client.waitFor<{ title: string }>('notify', (n) => n.title === '🚨 POLİS SENİ GÖRDÜ!');
    expect(wantedOf(client.playerId)!.units.every((x) => x.mode === 'chase')).toBe(true);
    client.close();
  }, 30_000);

  it('at a crime scene: watching from outside the tape is fine, crossing it is 1 star and a stop warning; cleared after a while', async () => {
    const { client } = await connectNew(server);
    // (Well away from the scene above: an offence near a taped-off scene brings its officers instead.)
    const view = await emptyScene(client, -100, 150);
    const scene = server.game.police.scenes.get(view.id)!;
    await client.waitFor<WantedState>('police.wanted', (x) => x.stars === 0);
    // A civilian watching from just outside the tape: nothing happens.
    server.game.sim.teleport(client.playerId, view.x - ECONOMY.police.scene.radius - 3, view.z);
    await sleep(1500);
    expect(server.game.police.starsOf(client.playerId)).toBe(0);
    // Under the tape: tampering.
    const cars = scene.units.length;
    client.events.length = 0;
    server.game.sim.teleport(client.playerId, view.x + 0.5, view.z + 0.5);
    const n = await client.waitFor<{ title: string; text: string }>('notify', (x) => x.title.includes('OLAY YERİ İHLALİ'), 3000);
    expect(n.text).toContain('DUR! POLİS!');
    expect(server.game.police.starsOf(client.playerId)).toBe(1);
    expect(wantedOf(client.playerId)!.engaged).toBe(true);
    // The nearest car waits a moment for you to give up (the officers aim at you), then chases.
    expect(scene.units).toHaveLength(cars - 1);
    const chaser = wantedOf(client.playerId)!.units[0]!;
    expect(chaser.parked).toBe(true);
    await sleep(200);
    expect([...server.game.sim.npcs.values()].some((o) => o.id.startsWith('csi_') && o.anim === Anim.Aim)).toBe(true);
    // Run: it comes after you.
    server.game.sim.teleport(client.playerId, view.x - 60, view.z);
    await sleep((ECONOMY.police.scene.warnSec + 0.6) * 1000);
    expect(chaser.parked).toBe(false);
    expect(chaser.mode).toBe('chase');
    server.game.police.clearWanted(client.playerId);
    // Time up: the props go, the officers get in and the cars head back to the station.
    const officers = scene.officers.map((o) => o.npc.id);
    expect(officers.length).toBeGreaterThan(0);
    scene.until = Date.now();
    await client.waitFor<{ id: number }>('police.sceneEnd', (e) => e.id === view.id, 3000);
    for (const id of officers) expect(server.game.sim.npcs.has(id)).toBe(false);
    expect(server.game.police.scenes.get(view.id)).toBeUndefined();
    for (const u of scene.units) expect((u as unknown as U).mode).toBe('return');
    client.close();
  }, 50_000);
});

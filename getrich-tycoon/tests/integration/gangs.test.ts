// Gang territories over real sockets: members hang round the hangouts; a raid starts a turf war
// (BÖLGE SAVAŞI BAŞLADI), waves of gang cars come in and the members jump out; clear them all and the
// zone is the player's; protection money into the bank or the cash box at Emlak Dünyası; the gang
// hits back (BÖLGEN SALDIRI ALTINDA): there in time and beat them off, or the zone is lost.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { findZone, type GangMine, type GangZoneView, type TurfWarView } from '../../shared/gangs';
import { findInteractable } from '../../shared/world';
import type { RunningServer } from '../../server/main';
import { connectNew, resetPostgres, sleep, startServer, type TestClient } from '../helpers/server';

let server: RunningServer;
const G = ECONOMY.gangs;

beforeAll(async () => {
  await resetPostgres();
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => server.game.gangs as any;

/** The cars of the wave pull up at once and every member of it goes down. */
async function clearWave(client: TestClient, zone: 'downtown' | 'sanayi' | 'docks' | 'touge'): Promise<void> {
  const w = svc().wars.get(zone);
  if (!w) return;
  if (w.nextAt !== null) w.nextAt = Date.now();
  await sleep(150);
  for (const c of svc().cars.values()) if (c.war === w) svc().arrive(c);
  for (const id of [...w.members]) svc().hit(id, 999, client.playerId);
  await sleep(200);
}

describe('gang territories', () => {
  it('a raid starts a turf war; clear every wave and the zone is yours; protection money into the bank or the cash box', async () => {
    const { client } = await connectNew(server);
    const z = findZone('downtown')!;
    // Members stand round the hangout.
    await sleep(300);
    expect(server.game.gangs.membersOf('downtown').length).toBe(G.idleMembers);
    server.game.sim.teleport(client.playerId, z.venue.door.x, z.venue.door.z);
    const war = await client.rpc('gang.raid', { zoneId: 'downtown' });
    expect(war.zone).toBe('downtown');
    expect(war.waves).toBe(G.waves.downtown);
    const banner = await client.waitFor<{ text: string }>('gang.banner', (b) => b.text.startsWith('BÖLGE SAVAŞI BAŞLADI'));
    expect(banner.text).toBe('BÖLGE SAVAŞI BAŞLADI: Downtown');
    // The hangout's members fight first; then the waves: cars racing in along the roads.
    for (const id of [...svc().wars.get('downtown').members]) svc().hit(id, 999, client.playerId);
    const cars = await client.waitFor<{ id: string; x: number; z: number }[]>('gang.cars', (l) => l.length > 0, 6000);
    expect(cars.length).toBeGreaterThan(0);
    const w0 = await client.waitFor<TurfWarView | null>('gang.war', (v) => !!v && v.wave === 1 && v.total >= 5, 6000);
    expect(w0!.total).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < G.waves.downtown + 1 && server.game.gangs.ownerOf('downtown') !== client.playerId; i++) await clearWave(client, 'downtown');
    for (let i = 0; i < 40 && server.game.gangs.ownerOf('downtown') !== client.playerId; i++) {
      await clearWave(client, 'downtown');
      await sleep(100);
    }
    expect(server.game.gangs.ownerOf('downtown')).toBe(client.playerId);
    await client.waitFor<{ text: string }>('gang.banner', (b) => b.text.startsWith('BÖLGE ELE GEÇİRİLDİ: Downtown'));
    const zones = await client.waitFor<GangZoneView[]>('gang.zones', (l) => l.some((x) => x.id === 'downtown' && x.owner === client.playerId));
    expect(zones.find((x) => x.id === 'downtown')!.dominance).toBe(100);
    // The gang has cleared out of its hangout.
    await sleep(200);
    expect(server.game.gangs.membersOf('downtown')).toHaveLength(0);
    // Protection money: into the bank.
    const bank0 = server.game.state.players.get(client.playerId)!.bank;
    server.game.gangs.payNow('downtown');
    await client.waitFor<GangMine>('gang.mine', () => server.game.state.players.get(client.playerId)!.bank === bank0 + G.income.downtown, 4000).catch(() => null);
    expect(server.game.state.players.get(client.playerId)!.bank).toBe(bank0 + G.income.downtown);
    // Cash instead: it waits at Emlak Dünyası.
    const mine = await client.rpc('gang.mode', { mode: 'cash' });
    expect(mine.mode).toBe('cash');
    server.game.gangs.payNow('downtown');
    await client.waitFor<GangMine>('gang.mine', (m) => m.cash === G.income.downtown, 4000);
    await expect(client.rpc('gang.collect', {})).rejects.toThrow(/Emlak/);
    const office = findInteractable('realestate')!;
    server.game.sim.teleport(client.playerId, office.x, office.z);
    const money0 = server.game.state.players.get(client.playerId)!.money;
    const got = await client.rpc('gang.collect', {});
    expect(got.amount).toBe(G.income.downtown);
    expect(server.game.state.players.get(client.playerId)!.money).toBe(money0 + G.income.downtown);
    client.close();
  }, 60_000);

  it('the gang hits back: in the zone within 2 minutes and the attack is beaten off; not there in time and the zone is lost', async () => {
    const { client } = await connectNew(server);
    const z = findZone('sanayi')!;
    server.game.sim.teleport(client.playerId, z.venue.door.x, z.venue.door.z);
    await client.rpc('gang.raid', { zoneId: 'sanayi' });
    for (let i = 0; i < 40 && server.game.gangs.ownerOf('sanayi') !== client.playerId; i++) {
      await clearWave(client, 'sanayi');
      await sleep(100);
    }
    expect(server.game.gangs.ownerOf('sanayi')).toBe(client.playerId);
    // Away from the zone when the attack comes.
    server.game.sim.teleport(client.playerId, -100, -100);
    server.game.gangs.attackNow('sanayi');
    const alert = await client.waitFor<{ text: string; until: number } | null>('gang.alert', (a) => !!a, 4000);
    expect(alert!.text).toBe('BÖLGEN SALDIRI ALTINDA: Sanayi - 2 Dakika İçinde Bölgeye Git!');
    expect(alert!.until - Date.now()).toBeGreaterThan((G.attackSec - 3) * 1000);
    // Into the zone: the defence.
    server.game.sim.teleport(client.playerId, 100, 160);
    await client.waitFor<TurfWarView | null>('gang.war', (v) => !!v && v.kind === 'defend', 4000);
    for (let i = 0; i < 40 && svc().wars.get('sanayi'); i++) {
      await clearWave(client, 'sanayi');
      await sleep(100);
    }
    expect(server.game.gangs.ownerOf('sanayi')).toBe(client.playerId);
    await client.waitFor<{ text: string }>('gang.banner', (b) => b.text.startsWith('SALDIRI PÜSKÜRTÜLDÜ'));
    // Next time, not there in time.
    server.game.sim.teleport(client.playerId, -100, -100);
    server.game.gangs.attackNow('sanayi');
    await sleep(300);
    svc().zones.get('sanayi').attackUntil = Date.now() - 1;
    await client.waitFor<{ text: string }>('gang.banner', (b) => b.text === 'BÖLGE KAYBEDİLDİ: Sanayi', 4000);
    expect(server.game.gangs.ownerOf('sanayi')).toBeNull();
    client.close();
  }, 60_000);

  it('shooting a member at the hangout starts a war; running off too far loses it', async () => {
    const { client } = await connectNew(server);
    const z = findZone('touge')!;
    server.game.sim.teleport(client.playerId, z.venue.door.x, z.venue.door.z - 6);
    await sleep(300);
    const m = server.game.gangs.membersOf('touge')[0]!;
    expect(m).toBeDefined();
    svc().hit(m.id, 10, client.playerId);
    await client.waitFor<{ text: string }>('gang.banner', (b) => b.text === 'BÖLGE SAVAŞI BAŞLADI: Touge');
    expect(server.game.gangs.war('touge')).toBeDefined();
    // Far away for too long.
    server.game.sim.teleport(client.playerId, -100, -100);
    await client.waitFor<TurfWarView | null>('gang.war', (v) => !!v && v.leaveAt !== null, 4000);
    svc().wars.get('touge').leaveAt = Date.now() - 1;
    await client.waitFor<{ text: string }>('gang.banner', (b) => b.text === 'SAVAŞ KAYBEDİLDİ: Touge', 4000);
    expect(server.game.gangs.ownerOf('touge')).toBeNull();
    client.close();
  }, 40_000);
});

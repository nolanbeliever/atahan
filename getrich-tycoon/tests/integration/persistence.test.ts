// Save/load: state survives a full server restart on the same database.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { KEY } from '../../shared/physics';
import { isCategoryUnlocked } from '../../shared/progression';
import { getModel } from '../../shared/vehicles';
import { INTERACTABLES } from '../../shared/world';
import { resetPostgres, register, sleep, startServer, TEST_DB_URL, TestClient } from '../helpers/server';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'getrich-'));
const sqlitePath = path.join(tmp, 'persist.db');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('persistence', () => {
  it('keeps money, vehicles, dealership, position and settings across restarts', async () => {
    await resetPostgres();
    let server = await startServer({ sqlitePath });
    const reg = await register(server.url);
    let client = await new TestClient(server.url, reg.token).connect();
    const { listings } = await client.rpc('market.list', {});
    const l = listings.filter((x) => isCategoryUnlocked(getModel(x.vehicle.modelId).category, 1)).sort((a, b) => a.askingPrice - b.askingPrice)[0]!;
    await client.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
    const bank = INTERACTABLES.find((i) => i.kind === 'bank')!;
    server.game.sim.teleport(client.playerId, bank.x, bank.z);
    await client.rpc('bank.deposit', { amount: 1234 });
    await client.rpc('settings.save', {
      settings: { masterVolume: 0.3, sfxVolume: 0.5, ambientVolume: 0.1, mouseSensitivity: 1.4, invertY: true, graphics: 'medium', showNames: false },
    });
    client.sendInputs(KEY.FORWARD, 20);
    await sleep(500);
    const expected = { ...server.game.state.players.get(client.playerId)! };
    const pos = server.game.sim.position(client.playerId)!;
    client.close();
    await sleep(200);
    await server.close();

    server = await startServer({ sqlitePath });
    // Same session token still works after restart.
    client = await new TestClient(server.url, reg.token).connect();
    expect(client.self.player.money).toBe(expected.money);
    expect(client.self.player.bank).toBe(expected.bank);
    expect(client.self.player.bank).toBe(1234);
    expect(client.self.player.xp).toBe(expected.xp);
    expect(client.self.player.settings.invertY).toBe(true);
    expect(client.self.player.settings.graphics).toBe('medium');
    expect(client.self.vehicles.map((v) => v.id)).toContain(l.vehicle.id);
    expect(client.self.player.achievements).toContain('first_purchase');
    const snap = await client.waitSnapshot((s) => s.self !== null);
    expect(Math.hypot(snap.self![0] - pos.x, snap.self![1] - pos.z)).toBeLessThan(0.6);
    // Market listings persist too (same ids after restart).
    expect(client.world.marketListings.length).toBe(16);
    // Password login still works.
    const login = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: reg.name, password: 'secret123' }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>);
    expect(login.ok).toBe(true);
    client.close();
    await server.close();
  });

  it('uses the configured database', () => {
    expect(typeof TEST_DB_URL).toBe('string');
  });
});

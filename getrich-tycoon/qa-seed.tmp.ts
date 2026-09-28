import { createServer } from './server/main';
import { PLOTS, plotEntrance } from './shared/world';
import { register, TestClient, setMoney, setLevel } from './tests/helpers/server';
import { isCategoryUnlocked } from './shared/progression';
import { getModel } from './shared/vehicles';

const server = await createServer({ port: 3201, host: '127.0.0.1', sqlitePath: process.argv[2]!, authRatePerMinute: 10000, env: 'development' });
const names = ['Sunset Autos', 'Velvet Motors', 'Crown Cars', 'Bayside Wheels', 'Prestige Hall', 'MEGA MOTORS'];
for (let i = 0; i < 6; i++) {
  const reg = await register(server.url, `dealer${i + 1}`);
  const c = await new TestClient(server.url, reg.token).connect();
  await setMoney(server, c.playerId, 5_000_000);
  await setLevel(server, c.playerId, 20);
  const plot = PLOTS[i]!;
  const e = plotEntrance(plot);
  server.game.sim.teleport(c.playerId, e.x, e.z);
  await c.rpc('dealership.buy', { plotId: plot.id, name: names[i]! });
  for (let l = 2; l <= i + 1; l++) await c.rpc('dealership.upgrade', {});
  const { listings } = await c.rpc('market.list', {});
  let slot = 0;
  for (const l of listings.slice(0, Math.min(4 + i, 8))) {
    try {
      const r = await c.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice });
      await c.rpc('dealership.place', { vehicleId: r.vehicle.id, slot: slot++, price: Math.round(l.askingPrice * 1.2), rotation: 0 });
    } catch (err) {
      console.log('skip', (err as Error).message);
    }
  }
  await server.game.market.refresh();
  c.close();
}
console.log('SEEDED');
setInterval(() => {}, 1000);

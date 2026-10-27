import { generateWorld } from '../src/shared/world.js';
import { Sim } from '../src/shared/sim.js';
const W = generateWorld(1337);
const sim = new Sim(W, { maxZombies: 0, time: 12 });
const p = sim.addPlayer('p1', 't', { x: 232, y: 0, z: 150 });
const z = sim.spawnZombie(232, 162, 'walker');
const r = sim.spawnZombie(250, 120, 'runner'); // behind a corner
sim.noise(p.x, p.z, 60, 'gun');
const log = [];
for (let f = 0; f < 60 * 15; f++) {
  sim.step(1 / 60);
  for (const e of sim.drain()) if (e.t !== 'groan') log.push(`${(f/60).toFixed(1)} ${e.t} ${e.zid ?? e.id ?? ''}`);
  if (f % 120 === 0) console.log((f / 60).toFixed(0), 'walker', z.state, Math.hypot(z.x - p.x, z.z - p.z).toFixed(1), '| runner', r.state, Math.hypot(r.x - p.x, r.z - p.z).toFixed(1));
}
console.log(log.slice(0, 12).join('\n'));
// melee kill
sim.players.get('p1').x = z.x; sim.players.get('p1').z = z.z - 1.2; for (let i = 0; i < 4; i++) sim.melee('p1', 'crowbar', p.x, 1.6, p.z, 0);
console.log('after melee', z.hp.toFixed(0), z.state, sim.drain().map(e => e.t).join(','));

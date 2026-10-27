import { generateWorld } from '../src/shared/world.js';
import { Sim } from '../src/shared/sim.js';
const W = generateWorld(1337);
const sim = new Sim(W, { maxZombies: 36 });
// stand in the street west of the market, outside the safe zone
const p = sim.addPlayer('p1', 'tester', { x: 232, y: 0, z: 150 });
sim.populate(true);
console.log('initial zombies', sim.zombies.length);
const counts = {};
let hurts = 0, t0 = performance.now();
for (let f = 0; f < 60 * 60; f++) {
  sim.step(1 / 60);
  for (const e of sim.drain()) { counts[e.t] = (counts[e.t] || 0) + 1; if (e.t === 'hurt') hurts++; }
  if (f % 600 === 0) {
    const st = {}; for (const z of sim.zombies) st[z.state] = (st[z.state] || 0) + 1;
    const nearest = Math.min(...sim.zombies.map(z => Math.hypot(z.x - p.x, z.z - p.z)));
    console.log('t', f / 60, 'states', JSON.stringify(st), 'nearest', nearest.toFixed(1));
  }
}
console.log('events', counts, 'avg step ms', ((performance.now() - t0) / 3600).toFixed(3));
// fire test
const z = sim.zombies.find(z => !z.dead);
const hits = sim.fire('p1', 'pistol', p.x, 1.6, p.z, z.x - p.x, 1.2 - 1.6, z.z - p.z);
console.log('fire hits', JSON.stringify(hits), 'zombie hp', z.hp);
// containers
const items = sim.openContainer('p1', W.containers.find(c => c.guaranteed).id);
console.log('armory', JSON.stringify(items));

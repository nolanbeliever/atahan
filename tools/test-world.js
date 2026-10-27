import { generateWorld, buildBlockGeometry } from '../src/shared/world.js';
let t = performance.now();
const W = generateWorld(1337);
console.log('world gen ms', (performance.now() - t).toFixed(0));
console.log({ colliders: W.colliders.length, doors: W.doors.length, containers: W.containers.length, interacts: W.interacts.length, vehicles: W.vehicleSpawns.length, zSpawns: W.zSpawns.length, pois: Object.keys(W.pois) });
let free = 0; for (const b of W.nav.blocked) if (!b) free++;
console.log('nav cells', W.nav.blocked.length, 'free', free);
let tv = 0, maxv = 0, tt = 0;
for (const c of W.cells) {
  t = performance.now();
  const parts = buildBlockGeometry(1337, c);
  tt = Math.max(tt, performance.now() - t);
  let v = 0; for (const p of parts) v += p.pos.length / 3;
  tv += v; maxv = Math.max(maxv, v);
}
console.log('total verts', tv, 'max block verts', maxv, 'max block build ms', tt.toFixed(0));
// path test: start -> hospital
const s = W.pois.start, h = W.pois.hospital;
t = performance.now();
const path = W.nav.findPath(s.x, s.z, h.x, h.z, 20000);
console.log('path', path && path.length, 'ms', (performance.now() - t).toFixed(1), 'start free', W.nav.free(s.x, s.z));
console.log(W.pois);

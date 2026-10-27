// Dead District multiplayer server.
// Authoritative rooms running the shared Sim (zombie AI, loot, doors, vehicles,
// combat resolution) at 30 Hz, broadcasting interest-managed snapshots at 15 Hz.
// Also serves the built client from ../dist so one process can host everything.
//
//   npm install        (in this folder)
//   node server.js     (PORT env var, default 8787)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { generateWorld } from '../src/shared/world.js';
import { Sim } from '../src/shared/sim.js';
import { ITEMS } from '../src/shared/items.js';
import { createStore, handleSaveApi } from './db.js';

const store = await createStore();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST = path.resolve(__dirname, '../dist');
const TICK = 30, SNAP_EVERY = 2, MAX_PLAYERS = 8, SEED = 1337, PROTOCOL = 3;
const ZSTATES = ['idle', 'wander', 'investigate', 'chase', 'search', 'attack', 'stagger', 'dead'];
const ZTYPES = ['walker', 'runner', 'brute'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: true, game: 'dead-district', saves: store.kind, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.clients.size, 0) })); return; }
  if (url.startsWith('/api/save/')) { handleSaveApi(store, req, res, url); return; }
  let file = path.join(DIST, url === '/' ? 'index.html' : url);
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(DIST, 'index.html');
    fs.readFile(file, (e2, data) => {
      if (e2) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Dead District server is running. Build the client (npm run build) to also serve the game here.'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.includes('/assets/') ? 'max-age=31536000, immutable' : 'no-cache' });
      res.end(data);
    });
  });
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map();
let nextId = 1;

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)]; if (!rooms.has(c)) return c; }
}
const clean = (s, n = 16) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, n) || 'Survivor';
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vec = (a) => (Array.isArray(a) && a.length === 3 ? a.map(v => num(v)) : null);
const r2 = (v) => Math.round(v * 100) / 100;

function makeRoom(host, pub) {
  const W = generateWorld(SEED);
  const sim = new Sim(W, { mp: true, maxZombies: 40, time: 18.4, dayLength: 1440, trustPos: process.env.DD_TRUST_CLIENT_POS === '1' });
  const room = { code: code(), host, pub: !!pub, W, sim, clients: new Map(), empty: 0, tick: 0 };
  rooms.set(room.code, room);
  console.log(`[room ${room.code}] created by ${host}`);
  return room;
}

function send(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }

function roomList() {
  return [...rooms.values()].filter(r => r.pub && r.clients.size < MAX_PLAYERS).map(r => ({ code: r.code, host: r.host, players: r.clients.size, max: MAX_PLAYERS, day: r.sim.day }));
}

function snapFor(room, me) {
  const sim = room.sim;
  const z = [];
  const R2 = 140 * 140;
  for (const zz of sim.zombies) {
    if (me && (zz.x - me.x) ** 2 + (zz.z - me.z) ** 2 > R2) continue;
    z.push([zz.id, ZTYPES.indexOf(zz.type), Math.round(zz.x * 100), Math.round(zz.y * 100), Math.round(zz.z * 100), Math.round(zz.yaw * 1000), ZSTATES.indexOf(zz.state), Math.round(Math.max(0, zz.hp) / zz.maxHp * 100), zz.seed, Math.round(zz.speed * 100), Math.round((zz.atk || 0) * 100), Math.round(zz.hitT * 100), zz.dead ? 1 : 0, Math.round((zz.fall || 0) * 1000)]);
  }
  const p = [];
  for (const pl of sim.players.values()) p.push([pl.id, pl.name, r2(pl.x), r2(pl.y), r2(pl.z), r2(pl.yaw), r2(pl.pitch), (pl.crouch ? 1 : 0) | (pl.sprint ? 2 : 0) | (pl.light ? 4 : 0) | (pl.alive ? 8 : 0), pl.veh, Math.round(pl.hp), pl.weapon, pl.anim]);
  const v = sim.vehicles.map(vv => [vv.id, vv.type, r2(vv.x), r2(vv.z), r2(vv.yaw), r2(vv.speed), r2(vv.steer), r2(vv.fuel), Math.round(vv.hp), vv.driver, vv.lights ? 1 : 0, vv.brake ? 1 : 0]);
  return { t: 'snap', tm: r2(sim.time), dy: sim.day, rn: r2(sim.rain), z, p, v };
}

function join(ws, room, name) {
  leave(ws);
  if (room.clients.size >= MAX_PLAYERS) { send(ws, { t: 'err', msg: 'Room is full' }); return; }
  ws.room = room; ws.name = clean(name);
  const st = room.W.pois.start;
  const pl = room.sim.addPlayer(ws.pid, ws.name, { x: st.x + (Math.random() - 0.5) * 6, y: 0, z: st.z + (Math.random() - 0.5) * 4 });
  room.clients.set(ws.pid, ws);
  if (room.clients.size === 1) room.sim.populate(true);
  const W = room.W, sim = room.sim;
  send(ws, {
    t: 'joined', code: room.code, id: ws.pid, seed: SEED, time: sim.time, day: sim.day,
    doors: W.doors.filter(d => d.open !== d.open0).map(d => d.id),
    conts: sim.containers.map((c, i) => (c.gen ? [i, c.items] : null)).filter(Boolean),
    pickups: [...sim.pickups.values()],
    snap: snapFor(room, pl),
  });
  sim.emit({ t: 'joinedp', name: ws.name, pid: ws.pid });
  console.log(`[room ${room.code}] ${ws.name} joined (${room.clients.size})`);
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  room.sim.removePlayer(ws.pid);
  room.clients.delete(ws.pid);
  room.sim.emit({ t: 'leftp', name: ws.name, pid: ws.pid });
  ws.room = null;
  console.log(`[room ${room.code}] ${ws.name} left (${room.clients.size})`);
}

wss.on('connection', (ws) => {
  ws.pid = 'p' + (nextId++);
  ws.msgs = 0; ws.window = Date.now();
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - ws.window > 1000) { ws.window = now; ws.msgs = 0; }
    if (++ws.msgs > 150) return; // flood guard
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = ws.room, sim = room && room.sim, id = ws.pid;
    switch (m.t) {
      case 'hello': if (m.v !== PROTOCOL) send(ws, { t: 'err', msg: 'Client/server version mismatch — reload the page.' }); send(ws, { t: 'rooms', rooms: roomList() }); break;
      case 'list': send(ws, { t: 'rooms', rooms: roomList() }); break;
      case 'create': join(ws, makeRoom(clean(m.name), m.pub), m.name); break;
      case 'join': { const r = rooms.get(String(m.code || '').toUpperCase()); if (!r) send(ws, { t: 'err', msg: 'No session with that code' }); else join(ws, r, m.name); break; }
      case 'ping': send(ws, { t: 'pong', c: m.c }); break;
      default: if (sim) handleGame(ws, room, sim, id, m);
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

function handleGame(ws, room, sim, id, m) {
  switch (m.t) {
    case 'st': {
      const corr = sim.updatePlayer(id, { x: num(m.x), y: num(m.y), z: num(m.z), yaw: num(m.yaw), pitch: num(m.pitch), crouch: !!m.crouch, sprint: !!m.sprint, light: !!m.light, veh: num(m.veh, -1), hp: num(m.hp, 100), weapon: String(m.weapon), anim: num(m.anim) });
      if (corr) send(ws, { t: 'corr', ...corr });
      break;
    }
    case 'fire': { const o = vec(m.o), d = vec(m.d); if (o && d && ITEMS[m.w]) sim.fire(id, m.w, o[0], o[1], o[2], d[0], d[1], d[2]); break; }
    case 'melee': { const o = vec(m.o); if (o) sim.melee(id, ITEMS[m.w] ? m.w : 'fists', o[0], o[1], o[2], num(m.yaw)); break; }
    case 'door': sim.toggleDoor(id, num(m.id, -1)); break;
    case 'open': sim.openContainer(id, num(m.id, -1)); break;
    case 'take': { const it = sim.takeFromContainer(id, num(m.id, -1), num(m.idx, -1), num(m.n, 1)); if (it) sim.emit({ t: 'got', pid: id, id: it.id, n: it.n }); break; }
    case 'put': if (ITEMS[m.item]) sim.putInContainer(id, num(m.id, -1), m.item, Math.max(1, Math.min(999, num(m.n, 1)))); break;
    case 'pick': { const it = sim.takePickup(id, num(m.id, -1)); if (it) sim.emit({ t: 'got', pid: id, id: it.item, n: it.n }); break; }
    case 'drop': if (ITEMS[m.item]) sim.dropItem(id, m.item, Math.max(1, Math.min(999, num(m.n, 1)))); break;
    case 'venter': sim.enterVehicle(id, num(m.id, -1)); break;
    case 'vexit': sim.exitVehicle(id); break;
    case 'vst': sim.vehicleState(id, { id: num(m.id, -1), x: num(m.x), y: num(m.y), z: num(m.z), yaw: num(m.yaw), speed: num(m.speed), steer: num(m.steer), fuel: num(m.fuel), hp: num(m.hp), vx: num(m.vx), vz: num(m.vz), lights: !!m.lights, brake: !!m.brake }); break;
    case 'pump': { const r = sim.usePump(id, num(m.id, -1)); if (r) sim.emit({ t: 'pumped', pid: id, ...r }); break; }
    case 'refuel': sim.refuel(id, num(m.vid, -1), Math.min(10, Math.max(0, num(m.amount)))); break;
    case 'noise': { const p = sim.players.get(id); if (p && Math.hypot(num(m.x) - p.x, num(m.z) - p.z) < 5) sim.noise(p.x, p.z, Math.min(45, num(m.r)), 'player'); break; }
    case 'radio': { const poi = room.W.pois.police; if (!sim.horde) sim.startHorde(poi.x, poi.z, 14 + room.clients.size * 4); break; }
    case 'respawn': { const pos = sim.respawnPlayer(id); if (pos) send(ws, { t: 'corr', ...pos }); break; }
    case 'chat': sim.emit({ t: 'chat', name: ws.name, msg: clean(m.msg, 120) }); break;
  }
}

const PRIVATE = new Set(['got', 'pumped']);
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.clients.size === 0) {
      room.empty += 1 / TICK;
      if (room.empty > 120) { rooms.delete(room.code); console.log(`[room ${room.code}] closed (empty)`); }
      continue;
    }
    room.empty = 0;
    room.tick++;
    room.sim.step(1 / TICK);
    const evs = room.sim.drain();
    for (const ws of room.clients.values()) {
      const mine = evs.filter(e => !PRIVATE.has(e.t) || e.pid === ws.pid);
      if (mine.length) send(ws, { t: 'ev', l: mine });
      if (room.tick % SNAP_EVERY === 0) send(ws, snapFor(room, room.sim.players.get(ws.pid)));
    }
  }
}, 1000 / TICK);

server.listen(PORT, () => console.log(`Dead District server on :${PORT} (ws + http). Serving client from ${fs.existsSync(DIST) ? DIST : '(not built)'}`));

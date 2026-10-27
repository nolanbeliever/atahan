// Two interchangeable sessions with the same API and event stream:
//  - LocalSession: runs the authoritative Sim in this browser (singleplayer, offline)
//  - RemoteSession: talks to the Node WebSocket server (multiplayer); keeps a mirror
//    of server state with interpolation for zombies, players and vehicles.
import { Sim } from '../shared/sim.js';

export const ZSTATES = ['idle', 'wander', 'investigate', 'chase', 'search', 'attack', 'stagger', 'dead'];
export const ZTYPE_IDX = ['walker', 'runner', 'brute'];
export const PROTOCOL = 3;

export class LocalSession {
  constructor(W, opts) {
    this.W = W;
    this.mp = false;
    this.id = 'me';
    this.sim = new Sim(W, { maxZombies: opts.maxZombies, dayLength: opts.dayLength, time: opts.time });
    this.view = this.sim;
  }
  join(name, pos) { this.sim.addPlayer(this.id, name, pos); this.sim.populate(true); }
  step(dt) { this.sim.step(dt); return this.sim.drain(); }
  contItems(id) { const c = this.sim.containers[id]; return c && c.gen ? c.items : null; }
  sendState(st) { this.sim.updatePlayer(this.id, st); }
  fire(w, o, d) { return this.sim.fire(this.id, w, o[0], o[1], o[2], d[0], d[1], d[2]); }
  melee(w, o, yaw) { return this.sim.melee(this.id, w, o[0], o[1], o[2], yaw); }
  door(id) { this.sim.toggleDoor(this.id, id); }
  open(id) { this.sim.openContainer(this.id, id); }
  take(id, idx, n) { const it = this.sim.takeFromContainer(this.id, id, idx, n); if (it) this.sim.emit({ t: 'got', pid: this.id, id: it.id, n: it.n }); }
  put(id, item, n) { this.sim.putInContainer(this.id, id, item, n); }
  pick(id) { const it = this.sim.takePickup(this.id, id); if (it) this.sim.emit({ t: 'got', pid: this.id, id: it.item, n: it.n }); }
  drop(item, n) { this.sim.dropItem(this.id, item, n); }
  venter(id) { this.sim.enterVehicle(this.id, id); }
  vexit() { this.sim.exitVehicle(this.id); }
  vstate(st) { this.sim.vehicleState(this.id, st); }
  pump(iid) { const r = this.sim.usePump(this.id, iid); if (r) this.sim.emit({ t: 'pumped', pid: this.id, ...r }); }
  refuel(vid, amount) { this.sim.refuel(this.id, vid, amount); }
  noise(x, z, r) { this.sim.noise(x, z, r, 'player'); }
  radio(x, z) { this.sim.startHorde(x, z, 18); }
  sleep(toHour) { const s = this.sim; let h = toHour - s.time; if (h < 0) h += 24; s.time = toHour; if (h > 0 && s.time < s.time - h) s.day++; for (const z of s.zombies) if (!z.dead && Math.hypot(z.x - s.players.get(this.id).x, z.z - s.players.get(this.id).z) < 60) { z.target = null; s.setState(z, 'wander'); } }
  chat() {}
  close() {}
  get time() { return this.sim.time; }
}

export class RemoteSession {
  constructor(url) {
    this.url = url;
    this.mp = true;
    this.id = null;
    this.events = [];
    this.view = { zombies: [], players: new Map(), vehicles: [], pickups: new Map(), time: 18, day: 1, rain: 0 };
    this.zmap = new Map();
    this.cont = new Map();
    this.handlers = {};
    this.connected = false;
    this.lastSnap = 0;
    this.ping = 0;
  }
  on(t, f) { this.handlers[t] = f; }
  connect() {
    return new Promise((res, rej) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { rej(e); return; }
      this.ws = ws;
      const to = setTimeout(() => { rej(new Error('Connection timed out')); try { ws.close(); } catch (e) { /* */ } }, 7000);
      ws.onopen = () => { clearTimeout(to); this.connected = true; this.send({ t: 'hello', v: PROTOCOL }); res(); };
      ws.onerror = () => { clearTimeout(to); rej(new Error('Could not reach server')); };
      ws.onclose = () => { this.connected = false; this.events.push({ t: 'disconnected' }); if (this.handlers.close) this.handlers.close(); };
      ws.onmessage = (m) => { let d; try { d = JSON.parse(m.data); } catch (e) { return; } this._msg(d); };
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  _msg(d) {
    switch (d.t) {
      case 'rooms': case 'err': case 'joined': if (this.handlers[d.t]) this.handlers[d.t](d); break;
      case 'snap': this._snap(d); break;
      case 'ev': for (const e of d.l) this._event(e); break;
      case 'corr': this.events.push({ t: 'corr', x: d.x, y: d.y, z: d.z }); break;
      case 'pong': this.ping = performance.now() - d.c; break;
    }
  }
  // initial world state on join
  applyJoin(d, W) {
    this.W = W;
    this.id = d.id;
    for (const id of d.doors) { const dr = W.doors[id]; if (dr) { dr.open = !dr.open; if (dr.col) dr.col.en = !dr.open; for (const c of dr.cells || []) W.nav.sight[c] = dr.open ? 0 : 1; } }
    for (const c of d.conts) this.cont.set(c[0], c[1]);
    for (const p of d.pickups) this.view.pickups.set(p.id, p);
    this.view.time = d.time; this.view.day = d.day;
    this._snap(d.snap);
  }
  _event(e) {
    if (e.t === 'door') {
      const dr = this.W.doors[e.id];
      if (dr) { dr.open = e.open; if (dr.col) dr.col.en = !e.open; for (const c of dr.cells || []) this.W.nav.sight[c] = e.open ? 0 : 1; }
    } else if (e.t === 'cont') this.cont.set(e.id, e.items || []);
    else if (e.t === 'pick+') this.view.pickups.set(e.p.id, e.p);
    else if (e.t === 'pick-') this.view.pickups.delete(e.id);
    else if (e.t === 'zdie') { const z = this.zmap.get(e.id); if (z) { z.dead = true; z.state = 'dead'; z.fall = Math.atan2(e.dx, e.dz); } }
    this.events.push(e);
  }
  _snap(s) {
    const now = performance.now();
    this.lastSnap = now;
    const v = this.view;
    v.time = s.tm; v.day = s.dy; v.rain = s.rn;
    const seen = new Set();
    for (const a of s.z) {
      const id = a[0];
      seen.add(id);
      let z = this.zmap.get(id);
      const x = a[2] / 100, y = a[3] / 100, zz = a[4] / 100;
      if (!z) { z = { id, type: ZTYPE_IDX[a[1]], x, y, z: zz, tx: x, ty: y, tz: zz, yaw: a[5] / 1000, tyaw: a[5] / 1000, dead: false, deadT: 0, hitT: 0 }; this.zmap.set(id, z); }
      z.tx = x; z.ty = y; z.tz = zz; z.tyaw = a[5] / 1000;
      z.state = ZSTATES[a[6]]; z.hpPct = a[7]; z.seed = a[8]; z.speed = a[9] / 100; z.atk = a[10] / 100; z.hitT = a[11] / 100;
      if (a[12]) { z.dead = true; z.state = 'dead'; z.fall = a[13] / 1000; }
    }
    for (const [id, z] of this.zmap) if (!seen.has(id)) { if (!z.dead || ++z.deadT > 60) this.zmap.delete(id); }
    v.zombies = [...this.zmap.values()];
    // players
    const ps = new Set();
    for (const a of s.p) {
      const id = a[0]; ps.add(id);
      let p = v.players.get(id);
      if (!p) { p = { id, name: a[1], x: a[2], y: a[3], z: a[4], yaw: a[5] }; v.players.set(id, p); }
      Object.assign(p, { name: a[1], tx: a[2], ty: a[3], tz: a[4], tyaw: a[5], pitch: a[6], crouch: !!(a[7] & 1), sprint: !!(a[7] & 2), light: !!(a[7] & 4), alive: !!(a[7] & 8), veh: a[8], hp: a[9], weapon: a[10], anim: a[11] });
    }
    for (const id of [...v.players.keys()]) if (!ps.has(id)) v.players.delete(id);
    // vehicles
    for (const a of s.v) {
      let vv = v.vehicles[a[0]];
      if (!vv) { vv = v.vehicles[a[0]] = { id: a[0], type: a[1], x: a[2], z: a[3], y: 0, yaw: a[4], vx: 0, vz: 0, wheel: 0, pitch: 0, roll: 0, rpm: 0, steer: 0 }; }
      Object.assign(vv, { type: a[1], tx: a[2], tz: a[3], tyaw: a[4], speed: a[5], steer: a[6], fuel: a[7], hp: a[8], driver: a[9], lights: !!a[10], brake: !!a[11] });
    }
  }
  step(dt) {
    const k = Math.min(1, dt * 12);
    for (const z of this.view.zombies) {
      z.x += (z.tx - z.x) * k; z.y += (z.ty - z.y) * k; z.z += (z.tz - z.z) * k;
      let d = z.tyaw - z.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; z.yaw += d * k;
    }
    for (const p of this.view.players.values()) {
      if (p.tx === undefined) continue;
      p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.z += (p.tz - p.z) * k;
      let d = p.tyaw - p.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; p.yaw += d * k;
    }
    for (const v of this.view.vehicles) {
      if (!v || v.tx === undefined || v.driver === this.id) continue;
      v.x += (v.tx - v.x) * k; v.z += (v.tz - v.z) * k;
      let d = v.tyaw - v.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; v.yaw += d * k;
      v.wheel += v.speed * dt / 0.36; v.rpm = Math.min(1, Math.abs(v.speed) / 35);
    }
    this.view.time += dt * 24 / 1440;
    if (performance.now() - (this._pingT || 0) > 3000) { this._pingT = performance.now(); this.send({ t: 'ping', c: performance.now() }); }
    const e = this.events; this.events = []; return e;
  }
  contItems(id) { return this.cont.has(id) ? this.cont.get(id) : null; }
  list() { this.send({ t: 'list' }); }
  create(name, isPublic) { this.send({ t: 'create', name, pub: isPublic }); }
  joinRoom(code, name) { this.send({ t: 'join', code, name }); }
  join() {}
  sendState(st) { this.send({ t: 'st', ...st }); }
  fire(w, o, d) { this.send({ t: 'fire', w, o, d }); return null; }
  melee(w, o, yaw) { this.send({ t: 'melee', w, o, yaw }); return null; }
  door(id) { this.send({ t: 'door', id }); }
  open(id) { this.send({ t: 'open', id }); }
  take(id, idx, n) { this.send({ t: 'take', id, idx, n }); }
  put(id, item, n) { this.send({ t: 'put', id, item, n }); }
  pick(id) { this.send({ t: 'pick', id }); }
  drop(item, n) { this.send({ t: 'drop', item, n }); }
  venter(id) { this.send({ t: 'venter', id }); }
  vexit() { this.send({ t: 'vexit' }); }
  vstate(st) { this.send({ t: 'vst', ...st }); }
  pump(iid) { this.send({ t: 'pump', id: iid }); }
  refuel(vid, amount) { this.send({ t: 'refuel', vid, amount }); }
  noise(x, z, r) { this.send({ t: 'noise', x, z, r }); }
  radio() { this.send({ t: 'radio' }); }
  sleep() {}
  chat(msg) { this.send({ t: 'chat', msg }); }
  close() { try { this.ws.close(); } catch (e) { /* */ } }
  get time() { return this.view.time; }
}

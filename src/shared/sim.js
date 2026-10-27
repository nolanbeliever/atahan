// Authoritative game simulation: zombies (AI state machine + A* navigation), shared
// loot containers, doors, pickups, vehicles, time of day and weather. Singleplayer
// runs it in the browser; the multiplayer server runs the same code in Node.
import { RNG, clamp, angleDiff, dist2 } from './util.js';
import { resolveXZ, groundAt, raycast, rayCylinder } from './physics.js';
import { ITEMS, rollLoot } from './items.js';
import { makeVehicle, updateVehicleCollider, VTYPES } from './vehicle.js';

export const ZTYPES = {
  walker: { hp: 70, walk: 0.75, run: 2.1, dmg: 11, sight: 22, hear: 1.0, reach: 1.45, cool: 1.25, scale: 1, stagger: 14 },
  runner: { hp: 45, walk: 0.95, run: 4.5, dmg: 9, sight: 26, hear: 1.2, reach: 1.4, cool: 1.0, scale: 0.97, stagger: 10 },
  brute: { hp: 240, walk: 0.7, run: 2.9, dmg: 28, sight: 18, hear: 0.9, reach: 1.75, cool: 1.8, scale: 1.25, stagger: 55 },
};

const ACTIVE_R = 85, CULL_R = 150;

export class Sim {
  constructor(world, opts = {}) {
    this.W = world;
    this.cs = world.cs;
    this.nav = world.nav;
    this.rng = new RNG((opts.seed || world.seed) ^ 0x5eed);
    this.mp = !!opts.mp;
    this.trustPos = !!opts.trustPos; // dev/testing only: skip movement validation
    this.time = opts.time ?? 18.6; // hours
    this.day = 1;
    this.dayLength = opts.dayLength || 1440; // real seconds per 24h
    this.rain = 0; this.rainTarget = 0; this.weatherT = 120;
    this.maxZombies = opts.maxZombies || 36;
    this.players = new Map();
    this.zombies = [];
    this.zid = 1;
    this.pickups = new Map();
    this.pid = 1;
    this.events = [];
    this.noises = [];
    this.frame = 0;
    this.spawnT = 0;
    this.horde = null;
    this.containers = world.containers.map(() => ({ gen: false, items: null, emptyAt: 0 }));
    this.vehicles = world.vehicleSpawns.map((s, i) => makeVehicle(i, s, this.rng));
    for (const v of this.vehicles) { updateVehicleCollider(v); this.cs.dyn.push(v.col); }
    this.safeZones = world.zones.filter(z => z.kind === 'safe');
    this.clock = 0;
  }

  // ------------------------------------------------------------ helpers
  emit(e) { this.events.push(e); }
  drain() { const e = this.events; this.events = []; return e; }
  isNight() { return this.time < 6 || this.time > 20; }
  darkness() { const t = this.time; if (t > 7 && t < 18.5) return 0; if (t >= 21 || t <= 5) return 1; return t >= 18.5 ? (t - 18.5) / 2.5 : (7 - t) / 2; }
  inSafe(x, z) { for (const s of this.safeZones) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return s; return null; }
  noise(x, z, r, src) { this.noises.push({ x, z, r: Math.min(r, 120), src }); }

  // ------------------------------------------------------------ players
  addPlayer(id, name, pos) {
    const p = { id, name: name || 'Survivor', x: pos.x, y: pos.y || 0, z: pos.z, yaw: 0, pitch: 0, crouch: false, sprint: false, light: false, veh: -1, hp: 100, alive: true, weapon: 'fists', anim: 0, lastFire: 0, lastMelee: 0, t: this.clock };
    this.players.set(id, p);
    return p;
  }
  // server-side respawn at the safehouse (client teleports are otherwise rejected)
  respawnPlayer(id) {
    const p = this.players.get(id);
    if (!p) return null;
    if (p.veh >= 0) this.exitVehicle(id);
    const s = this.W.pois.safebed || this.W.pois.start;
    Object.assign(p, { x: s.x, y: 0, z: s.z, hp: 100, alive: true, t: this.clock });
    return { x: s.x, y: 0, z: s.z };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.veh >= 0) this.exitVehicle(id);
    this.players.delete(id);
    for (const z of this.zombies) if (z.target === id) { z.target = null; if (z.state === 'chase' || z.state === 'attack') this.setState(z, 'search', 6); }
  }
  // Client-reported player state. In multiplayer, reject implausible movement.
  updatePlayer(id, s) {
    const p = this.players.get(id);
    if (!p) return null;
    const dt = Math.max(0.016, this.clock - p.t);
    p.t = this.clock;
    let corr = null;
    if (this.mp && !this.trustPos && p.veh < 0 && s.veh < 0) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d > 9 * dt + 1.5) corr = { x: p.x, y: p.y, z: p.z };
    }
    if (!corr) { p.x = s.x; p.y = s.y; p.z = s.z; }
    p.yaw = s.yaw; p.pitch = s.pitch; p.crouch = !!s.crouch; p.sprint = !!s.sprint; p.light = !!s.light;
    p.weapon = ITEMS[s.weapon] ? s.weapon : 'fists'; p.anim = s.anim | 0; p.hp = clamp(s.hp, 0, 100);
    if (p.hp <= 0 && p.alive) { p.alive = false; this.emit({ t: 'pdead', pid: id }); }
    if (p.hp > 0) p.alive = true;
    return corr;
  }

  // ------------------------------------------------------------ zombies
  spawnZombie(x, z, type, opts = {}) {
    const t = ZTYPES[type];
    const zz = {
      id: this.zid++, type, x, y: 0, z, yaw: this.rng.range(0, Math.PI * 2), hp: t.hp, maxHp: t.hp, state: 'idle', st: this.rng.range(1, 5),
      target: null, lx: x, lz: z, lastSeen: -99, path: null, pi: 0, repath: 0, atk: 0, cool: 0, vx: 0, vz: 0, speed: 0,
      senseT: this.rng.range(0, 0.4), acc: 0, dead: false, deadT: 0, look: this.rng.range(-1, 1), bash: 0, stuck: 0, sx: x, sz: z,
      seed: (this.rng.next() * 1e6) | 0, horde: !!opts.horde, cell: !!opts.cell, hitT: 0, active: true,
    };
    if (opts.state) { zz.state = opts.state; zz.lx = opts.tx; zz.lz = opts.tz; }
    this.zombies.push(zz);
    return zz;
  }

  pickType() { const r = this.rng.next(); return r < 0.08 ? 'brute' : r < 0.3 ? 'runner' : 'walker'; }

  targetPopulation() { return Math.round(this.maxZombies * (this.isNight() ? 1.3 : 1)); }

  populate(initial = false) {
    const players = [...this.players.values()];
    if (!players.length) return;
    let alive = 0;
    for (const z of this.zombies) if (!z.dead && !z.horde) alive++;
    const want = this.targetPopulation() - alive;
    if (want <= 0) return;
    let made = 0;
    for (let tries = 0; tries < 60 && made < Math.min(want, initial ? 999 : 3); tries++) {
      const sp = this.W.zSpawns[(this.rng.next() * this.W.zSpawns.length) | 0];
      let near = Infinity, ok = true;
      for (const p of players) {
        const d = Math.sqrt(dist2(sp.x, sp.z, p.x, p.z));
        near = Math.min(near, d);
        const minD = sp.indoor ? 14 : initial ? 30 : 42;
        if (d < minD) { ok = false; break; }
        if (!sp.indoor && d < 70 && this.nav.los(sp.x, sp.z, p.x, p.z)) { ok = false; break; }
      }
      if (!ok || near > 110) continue;
      if (this.inSafe(sp.x, sp.z) && !sp.cell) continue;
      if (!this.nav.free(sp.x, sp.z)) continue;
      const z = this.spawnZombie(sp.x + this.rng.range(-0.4, 0.4), sp.z + this.rng.range(-0.4, 0.4), this.pickType(), { cell: sp.cell });
      if (!sp.indoor && this.rng.chance(0.5)) { z.state = 'wander'; z.st = 0; }
      made++;
    }
  }

  startHorde(x, z, count = 16) {
    this.horde = { x, z, until: this.clock + 240 };
    let made = 0;
    for (let tries = 0; tries < 200 && made < count; tries++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(45, 75);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!this.nav.free(px, pz)) continue;
      const zz = this.spawnZombie(px, pz, this.rng.chance(0.35) ? 'runner' : this.pickType(), { horde: true, state: 'investigate', tx: x, tz: z });
      zz.path = null;
      made++;
    }
    this.emit({ t: 'horde', x, z });
  }

  setState(z, s, t = 0) { z.state = s; z.st = t; z.path = null; z.repath = 0; }

  step(dt) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.frame++;
    this.time += (dt * 24) / this.dayLength;
    if (this.time >= 24) { this.time -= 24; this.day++; }
    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.weatherT = this.rng.range(150, 400); this.rainTarget = this.rng.chance(0.4) ? this.rng.range(0.4, 1) : 0; }
    this.rain += clamp(this.rainTarget - this.rain, -dt * 0.02, dt * 0.02);

    const players = [];
    for (const p of this.players.values()) if (p.alive) players.push(p);
    // vehicle noise
    for (const v of this.vehicles) if (v.driver !== null && Math.abs(v.speed) > 1) { if (this.frame % 20 === 0) this.noise(v.x, v.z, 28 + Math.abs(v.speed), 'car'); }

    // spatial bins for separation
    const bins = new Map();
    for (const z of this.zombies) {
      if (z.dead) continue;
      const k = ((z.x / 3) | 0) * 1000 + ((z.z / 3) | 0);
      let b = bins.get(k); if (!b) { b = []; bins.set(k, b); } b.push(z);
    }
    this._bins = bins;

    // hearing: every live zombie in range reacts to this frame's noises
    for (const n of this.noises) for (const z of this.zombies) if (!z.dead) this.hear(z, n);

    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.dead) {
        z.deadT += dt;
        if (z.deadT > 40) this.zombies.splice(i, 1);
        continue;
      }
      let nd = Infinity;
      for (const p of this.players.values()) nd = Math.min(nd, dist2(z.x, z.z, p.x, p.z));
      nd = Math.sqrt(nd);
      if (nd > CULL_R && !z.horde) { this.zombies.splice(i, 1); this.emit({ t: 'zgone', id: z.id }); continue; }
      z.active = nd < ACTIVE_R || z.horde;
      if (!z.active) continue;
      const tier = nd < 30 ? 1 : nd < 55 ? 2 : 4;
      z.acc += dt;
      if ((this.frame + z.id) % tier !== 0) continue;
      const zdt = Math.min(z.acc, 0.25);
      z.acc = 0;
      this.updateZombie(z, zdt, players);
    }
    this.noises.length = 0;

    // vehicles hitting zombies
    for (const v of this.vehicles) {
      if (v.driver === null || Math.abs(v.speed) < 3.5) continue;
      const t = VTYPES[v.type];
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      for (const z of this.zombies) {
        if (z.dead) continue;
        const dx = z.x - v.x, dz = z.z - v.z;
        if (dx * dx + dz * dz > 16) continue;
        const lf = dx * fx + dz * fz, lr = dx * fz - dz * fx;
        if (Math.abs(lf) < t.hl + 0.35 && Math.abs(lr) < t.hw + 0.35) {
          const dmg = Math.abs(v.speed) * 9;
          this.damageZombie(z, dmg, v.driver, fx * Math.sign(v.speed), fz * Math.sign(v.speed), 'car');
          z.vx = fx * v.speed * 0.6; z.vz = fz * v.speed * 0.6;
          this.emit({ t: 'vhit', vid: v.id, id: z.id });
        }
      }
    }

    // population
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 2.5; this.populate(false); }
    // container respawn (every ~15 min of real time if nobody is close)
    if (this.frame % 120 === 0) {
      for (let i = 0; i < this.containers.length; i++) {
        const c = this.containers[i];
        if (!c.gen || !c.emptyAt || this.clock - c.emptyAt < 900) continue;
        const wc = this.W.containers[i];
        let close = false;
        for (const p of players) if (dist2(p.x, p.z, wc.x, wc.z) < 900) close = true;
        if (!close) { c.gen = false; c.items = null; c.emptyAt = 0; this.emit({ t: 'cont', id: i, empty: false }); }
      }
    }
    if (this.horde && this.clock > this.horde.until) this.horde = null;
  }

  perceive(z, players) {
    const t = ZTYPES[z.type];
    const dark = this.darkness();
    let best = null, bestD = Infinity;
    for (const p of players) {
      const dx = p.x - z.x, dz = p.z - z.z;
      const d = Math.hypot(dx, dz);
      if (Math.abs(p.y - z.y) > 2.6 && d > 3) continue; // different floor
      let range = t.sight * (1 - 0.45 * dark);
      if (p.light && dark > 0.3) range *= 1.6;
      if (p.crouch) range *= 0.55;
      if (p.veh >= 0) range *= 1.5;
      let seen = false;
      if (d < 2.2) seen = true;
      else if (d < range) {
        const ang = Math.abs(angleDiff(z.yaw, Math.atan2(dx, dz)));
        const fov = z.state === 'chase' ? Math.PI : 1.15;
        if (ang < fov && this.nav.los(z.x, z.z, p.x, p.z)) seen = true;
      }
      if (seen && d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  hear(z, n) {
    if (z.state === 'chase' || z.state === 'attack' || z.state === 'stagger') return;
    const d = Math.sqrt(dist2(n.x, n.z, z.x, z.z));
    if (d > n.r * ZTYPES[z.type].hear) return;
    // muffled through walls
    if (d > n.r * 0.5 && !this.nav.los(z.x, z.z, n.x, n.z)) return;
    this.setState(z, 'investigate');
    const err = Math.min(4, d * 0.1);
    z.lx = n.x + this.rng.range(-err, err); z.lz = n.z + this.rng.range(-err, err);
  }

  updateZombie(z, dt, players) {
    const t = ZTYPES[z.type];
    z.hitT = Math.max(0, z.hitT - dt);
    z.cool = Math.max(0, z.cool - dt);
    // knockback decay
    if (z.vx || z.vz) {
      z.x += z.vx * dt; z.z += z.vz * dt;
      const k = Math.max(0, 1 - dt * 6); z.vx *= k; z.vz *= k;
      if (Math.abs(z.vx) + Math.abs(z.vz) < 0.05) { z.vx = 0; z.vz = 0; }
    }
    if (z.state === 'stagger') {
      z.st -= dt;
      this.collide(z);
      if (z.st <= 0) this.setState(z, z.target != null ? 'chase' : 'search', 6);
      return;
    }
    // senses
    z.senseT -= dt;
    if (z.senseT <= 0) {
      z.senseT = 0.25 + this.rng.next() * 0.2;
      const p = this.perceive(z, players);
      if (p) {
        const wasChasing = z.state === 'chase' || z.state === 'attack';
        z.target = p.id; z.lx = p.x; z.lz = p.z; z.lastSeen = this.clock;
        if (!wasChasing) {
          this.setState(z, 'chase');
          this.emit({ t: 'groan', id: z.id, k: 'alert' });
          for (const o of this.near(z.x, z.z, 12)) if (o !== z && !o.dead && (o.state === 'idle' || o.state === 'wander')) { this.setState(o, 'investigate'); o.lx = p.x; o.lz = p.z; }
        }
      }
    }
    if (this.frame % 400 === z.id % 400 && this.rng.chance(0.4)) this.emit({ t: 'groan', id: z.id, k: 'idle' });

    const tp = z.target != null ? this.players.get(z.target) : null;
    switch (z.state) {
      case 'idle': {
        z.speed = 0; z.st -= dt;
        z.yaw += Math.sin(this.clock * 0.5 + z.seed) * dt * 0.3;
        if (z.st <= 0) { if (this.rng.chance(0.6) && !z.cell) this.setState(z, 'wander'); else z.st = this.rng.range(3, 8); }
        break;
      }
      case 'wander': {
        if (!z.path) {
          const pt = this.nav.randomFree(this.rng, z.x, z.z, 14);
          if (!pt || this.inSafe(pt[0], pt[1])) { this.setState(z, 'idle', this.rng.range(2, 5)); break; }
          z.path = this.nav.findPath(z.x, z.z, pt[0], pt[1], 1500); z.pi = 0;
          if (!z.path || !z.path.length) { this.setState(z, 'idle', this.rng.range(2, 5)); break; }
        }
        if (this.follow(z, t.walk, dt)) this.setState(z, 'idle', this.rng.range(2, 7));
        break;
      }
      case 'investigate': {
        if (!z.path || z.repath <= 0) { z.path = this.nav.findPath(z.x, z.z, z.lx, z.lz, 3000); z.pi = 0; z.repath = 4; }
        z.repath -= dt;
        const sp = z.horde ? t.run * 0.75 : t.walk * 1.5;
        if (!z.path || this.follow(z, sp, dt)) this.setState(z, 'search', this.rng.range(5, 9));
        break;
      }
      case 'search': {
        z.st -= dt;
        if (!z.path) {
          const d = Math.sqrt(dist2(z.x, z.z, z.lx, z.lz));
          const pt = d > 3 ? [z.lx, z.lz] : this.nav.randomFree(this.rng, z.lx, z.lz, 6);
          if (pt) { z.path = this.nav.findPath(z.x, z.z, pt[0], pt[1], 2000); z.pi = 0; }
          if (!z.path) z.path = [];
        }
        if (this.follow(z, t.walk * 1.3, dt)) z.path = null;
        if (z.st <= 0) { z.target = null; this.setState(z, z.horde && this.horde ? 'investigate' : 'idle', 3); if (z.horde && this.horde) { z.lx = this.horde.x; z.lz = this.horde.z; } }
        break;
      }
      case 'chase': {
        if (!tp || !tp.alive) { z.target = null; this.setState(z, 'search', 5); break; }
        if (this.clock - z.lastSeen > 4.5) { this.setState(z, 'search', this.rng.range(6, 10)); break; }
        if (!z.horde && this.inSafe(tp.x, tp.z) && this.inSafe(z.x, z.z)) { z.target = null; this.setState(z, 'wander'); break; }
        const d = Math.hypot(tp.x - z.x, tp.z - z.z);
        const dy = Math.abs(tp.y - z.y);
        if (d < t.reach + 0.2 && dy < 1.4 && z.cool <= 0 && tp.veh < 0) { this.setState(z, 'attack', 0); z.atk = 0; break; }
        const direct = d < 18 && dy < 1.0 && this.nav.walkable(z.x, z.z, tp.x, tp.z);
        if (direct) {
          z.path = null;
          this.moveToward(z, tp.x, tp.z, d < 1.1 ? 0 : t.run, dt);
        } else {
          z.repath -= dt;
          if (!z.path || z.repath <= 0 || z.pi >= z.path.length) { z.path = this.nav.findPath(z.x, z.z, z.lx, z.lz, 4000); z.pi = 0; z.repath = 0.8 + this.rng.next() * 0.4; }
          if (!z.path || this.follow(z, t.run, dt)) { z.speed = 0; z.yaw += angleDiff(z.yaw, Math.atan2(tp.x - z.x, tp.z - z.z)) * Math.min(1, dt * 4); }
        }
        break;
      }
      case 'attack': {
        z.speed = 0;
        z.atk += dt;
        if (tp) z.yaw += angleDiff(z.yaw, Math.atan2(tp.x - z.x, tp.z - z.z)) * Math.min(1, dt * 6);
        if (z.atk >= 0.45 && z.atk - dt < 0.45 && tp && tp.alive) {
          const d = Math.hypot(tp.x - z.x, tp.z - z.z);
          if (d < t.reach + 0.55 && Math.abs(tp.y - z.y) < 1.5 && tp.veh < 0) {
            const bite = this.rng.chance(0.14);
            this.emit({ t: 'hurt', pid: tp.id, dmg: t.dmg * this.rng.range(0.8, 1.2), x: z.x, z: z.z, bite, zid: z.id });
          } else this.emit({ t: 'whiff', id: z.id });
        }
        if (z.atk > 1.0) { z.cool = t.cool; this.setState(z, 'chase'); }
        break;
      }
    }
    this.collide(z);
  }

  near(x, z, r) {
    const out = [];
    const b = this._bins;
    if (!b) return out;
    const r2 = r * r;
    for (let i = Math.floor((x - r) / 3); i <= Math.floor((x + r) / 3); i++) for (let j = Math.floor((z - r) / 3); j <= Math.floor((z + r) / 3); j++) {
      const a = b.get(i * 1000 + j); if (!a) continue;
      for (const o of a) if (dist2(o.x, o.z, x, z) < r2) out.push(o);
    }
    return out;
  }

  // follow path; returns true when finished
  follow(z, speed, dt) {
    if (!z.path || z.pi >= z.path.length) { z.speed = 0; return true; }
    const [tx, tz] = z.path[z.pi];
    const d = Math.hypot(tx - z.x, tz - z.z);
    if (d < 0.6) { z.pi++; if (z.pi >= z.path.length) { z.speed = 0; return true; } }
    this.moveToward(z, tx, tz, speed, dt);
    return false;
  }

  moveToward(z, tx, tz, speed, dt) {
    const want = Math.atan2(tx - z.x, tz - z.z);
    const diff = angleDiff(z.yaw, want);
    z.yaw += clamp(diff, -dt * 5, dt * 5);
    const facing = Math.max(0, Math.cos(diff));
    const sp = speed * (0.25 + 0.75 * facing);
    z.speed += (sp - z.speed) * Math.min(1, dt * 5);
    const ox = z.x, oz = z.z;
    z.x += Math.sin(z.yaw) * z.speed * dt;
    z.z += Math.cos(z.yaw) * z.speed * dt;
    // stuck detection
    z.stuck += dt;
    if (z.stuck > 1.2) {
      const moved = Math.hypot(z.x - z.sx, z.z - z.sz);
      if (moved < 0.35 && speed > 0) { z.path = null; z.repath = 0; z.yaw += this.rng.range(-1.2, 1.2); }
      z.stuck = 0; z.sx = z.x; z.sz = z.z;
    }
    void ox; void oz;
  }

  collide(z) {
    // separation from other zombies and players
    for (const o of this.near(z.x, z.z, 0.8)) {
      if (o === z || o.dead) continue;
      const dx = z.x - o.x, dz = z.z - o.z, d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.7) { const p = (0.7 - d) * 0.5; z.x += (dx / d) * p; z.z += (dz / d) * p; }
    }
    for (const p of this.players.values()) {
      if (p.veh >= 0 || Math.abs(p.y - z.y) > 1.5) continue;
      const dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.75) { const k = 0.75 - d; z.x += (dx / d) * k; z.z += (dz / d) * k; }
    }
    const b = { x: z.x, y: z.y, z: z.z, hitWall: null };
    resolveXZ(this.cs, b, 0.33, 1.7, 0.45);
    z.x = b.x; z.z = b.z;
    z.y = groundAt(this.cs, z.x, z.z, z.y, 0.25, 0.45);
    const w = b.hitWall;
    if (w && w.door && (z.state === 'chase' || z.state === 'investigate')) {
      z.bash += 0.05;
      if (z.bash > 1.6) { z.bash = 0; this.setDoor(w.door - 1, true, 'zombie'); }
    }
  }

  // ------------------------------------------------------------ combat
  damageZombie(z, dmg, pid, dx, dz, part) {
    if (z.dead) return;
    const t = ZTYPES[z.type];
    if (part === 'head') dmg *= 2.5;
    z.hp -= dmg;
    z.hitT = 0.3;
    if (pid != null && this.players.has(pid) && z.state !== 'attack') {
      const p = this.players.get(pid);
      z.target = pid; z.lx = p.x; z.lz = p.z; z.lastSeen = this.clock;
    }
    if (z.hp <= 0) {
      z.dead = true; z.state = 'dead'; z.deadT = 0; z.speed = 0;
      z.fall = Math.atan2(dx, dz);
      this.emit({ t: 'zdie', id: z.id, x: z.x, y: z.y, z: z.z, dx, dz, part, pid });
      if (this.rng.chance(0.18)) {
        const loot = rollLoot('zombie', this.rng);
        for (const it of loot) this.addPickup(it.id, it.n, z.x + this.rng.range(-0.4, 0.4), z.y + 0.05, z.z + this.rng.range(-0.4, 0.4));
      }
      return;
    }
    this.emit({ t: 'zhit', id: z.id, part, dmg: Math.round(dmg), pid, x: z.x, y: z.y, z: z.z });
    if (dmg >= t.stagger) {
      this.setState(z, 'stagger', part === 'car' ? 1.2 : 0.5);
      z.vx = dx * 2.5; z.vz = dz * 2.5;
    } else if (z.state !== 'attack') this.setState(z, 'chase');
  }

  // Hitscan weapon fire. Returns list of hits for effects.
  fire(pid, weapon, ox, oy, oz, dx, dy, dz) {
    const w = ITEMS[weapon];
    const p = this.players.get(pid);
    if (!w || w.type !== 'gun' || !p) return null;
    if (this.mp) {
      if (this.clock - p.lastFire < w.rate * 0.8) return null;
      if (dist2(ox, oz, p.x, p.z) > 9) return null;
    }
    p.lastFire = this.clock;
    const hits = [];
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    for (let k = 0; k < w.pellets; k++) {
      let ex = dx + this.rng.range(-1, 1) * w.spread, ey = dy + this.rng.range(-1, 1) * w.spread, ez = dz + this.rng.range(-1, 1) * w.spread;
      const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
      const wh = raycast(this.cs, ox, oy, oz, ex, ey, ez, w.range);
      let best = wh.d, bz = null, part = 'body';
      for (const z of this.zombies) {
        if (z.dead) continue;
        if (dist2(z.x, z.z, ox, oz) > (w.range + 2) ** 2) continue;
        const sc = ZTYPES[z.type].scale;
        const tz = rayCylinder(ox, oy, oz, ex, ey, ez, z.x, z.z, 0.36 * sc, z.y, z.y + 1.85 * sc);
        if (tz >= 0 && tz < best) {
          best = tz; bz = z;
          const hy = oy + ey * tz - z.y;
          part = hy > 1.52 * sc ? 'head' : hy < 0.85 * sc ? 'legs' : 'body';
        }
      }
      const hx = ox + ex * best, hy = oy + ey * best, hz = oz + ez * best;
      if (bz) {
        const fall = 1 - Math.min(0.6, best / w.range * 0.6);
        this.damageZombie(bz, w.dmg * fall * (part === 'legs' ? 0.7 : 1), pid, ex, ez, part);
        hits.push({ x: hx, y: hy, z: hz, z_: bz.id, part });
      } else if (wh.c) hits.push({ x: hx, y: hy, z: hz, glass: !!wh.c.glass });
      else hits.push({ x: hx, y: hy, z: hz, miss: true });
    }
    this.noise(ox, oz, w.noise, 'gun');
    this.emit({ t: 'shot', pid, w: weapon, ox, oy, oz, hits });
    return hits;
  }

  melee(pid, weapon, ox, oy, oz, yaw) {
    const w = ITEMS[weapon] || ITEMS.fists;
    const p = this.players.get(pid);
    if (!p) return [];
    if (this.mp && this.clock - p.lastMelee < w.rate * 0.75) return [];
    p.lastMelee = this.clock;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const hits = [];
    let n = 0;
    const cands = this.zombies.filter(z => !z.dead && dist2(z.x, z.z, ox, oz) < (w.range + 0.4) ** 2 && Math.abs(z.y - (oy - 1.6)) < 1.4)
      .sort((a, b) => dist2(a.x, a.z, ox, oz) - dist2(b.x, b.z, ox, oz));
    for (const z of cands) {
      const dx = z.x - ox, dz = z.z - oz, d = Math.hypot(dx, dz) || 1;
      if ((dx * fx + dz * fz) / d < 0.55) continue;
      if (!this.nav.los(ox, oz, z.x, z.z) && d > 1.2) continue;
      const head = this.rng.chance(0.2);
      this.damageZombie(z, w.dmg * this.rng.range(0.85, 1.15), pid, fx, fz, head ? 'head' : 'body');
      hits.push({ id: z.id, x: z.x, y: z.y + (head ? 1.6 : 1.2), z: z.z });
      if (++n >= (weapon === 'axe' || weapon === 'bat' ? 2 : 1)) break;
    }
    this.noise(ox, oz, 10, 'melee');
    this.emit({ t: 'melee', pid, w: weapon, hits: hits.length });
    return hits;
  }

  // ------------------------------------------------------------ world interactions
  setDoor(id, open, by) {
    const d = this.W.doors[id];
    if (!d || d.open === open) return;
    d.open = open;
    if (d.col) d.col.en = !open;
    for (const c of d.cells || []) this.nav.sight[c] = open ? 0 : 1;
    this.noise(d.x, d.z, by === 'zombie' ? 14 : 6, 'door');
    this.emit({ t: 'door', id, open, by });
  }
  toggleDoor(pid, id) {
    const d = this.W.doors[id], p = this.players.get(pid);
    if (!d || !p) return;
    if (this.mp && dist2(d.x, d.z, p.x, p.z) > 16) return;
    if (!d.open) {
      // don't close onto a player / zombie
    }
    this.setDoor(id, !d.open, 'player');
  }

  containerItems(id) {
    const c = this.containers[id];
    if (!c) return null;
    if (!c.gen) {
      const wc = this.W.containers[id];
      c.gen = true;
      c.items = rollLoot(wc.table, this.rng, wc.guaranteed);
      wc.guaranteed = null;
      if (!c.items.length) c.emptyAt = this.clock;
    }
    return c.items;
  }
  openContainer(pid, id) {
    const p = this.players.get(pid), wc = this.W.containers[id];
    if (!p || !wc) return null;
    if (this.mp && dist2(wc.x, wc.z, p.x, p.z) > 16) return null;
    const items = this.containerItems(id);
    this.emit({ t: 'cont', id, empty: !items.length, items });
    return items;
  }
  takeFromContainer(pid, id, idx, n) {
    const items = this.containerItems(id);
    const p = this.players.get(pid), wc = this.W.containers[id];
    if (!items || !p || !items[idx]) return null;
    if (this.mp && dist2(wc.x, wc.z, p.x, p.z) > 16) return null;
    const it = items[idx];
    const take = Math.min(it.n, n || it.n);
    it.n -= take;
    if (it.n <= 0) items.splice(idx, 1);
    if (!items.length) this.containers[id].emptyAt = this.clock;
    this.emit({ t: 'cont', id, empty: !items.length, items });
    return { id: it.id, n: take };
  }
  putInContainer(pid, id, item, n) {
    const items = this.containerItems(id);
    if (!items || !ITEMS[item]) return false;
    const ex = items.find(i => i.id === item && ITEMS[item].stack > 1);
    if (ex) ex.n += n; else items.push({ id: item, n });
    this.containers[id].emptyAt = 0;
    this.emit({ t: 'cont', id, empty: false, items });
    return true;
  }

  addPickup(item, n, x, y, z) {
    const p = { id: this.pid++, item, n, x, y, z };
    this.pickups.set(p.id, p);
    this.emit({ t: 'pick+', p });
    return p;
  }
  takePickup(pid, id) {
    const it = this.pickups.get(id), p = this.players.get(pid);
    if (!it || !p) return null;
    if (this.mp && dist2(it.x, it.z, p.x, p.z) > 12) return null;
    this.pickups.delete(id);
    this.emit({ t: 'pick-', id });
    return it;
  }
  dropItem(pid, item, n) {
    const p = this.players.get(pid);
    if (!p || !ITEMS[item]) return null;
    const a = p.yaw;
    return this.addPickup(item, n, p.x + Math.sin(a) * 0.9, p.y + 0.05, p.z + Math.cos(a) * 0.9);
  }

  // ------------------------------------------------------------ vehicles
  enterVehicle(pid, vid) {
    const v = this.vehicles[vid], p = this.players.get(pid);
    if (!v || !p || v.driver !== null || p.veh >= 0) return false;
    if (dist2(v.x, v.z, p.x, p.z) > 36) return false;
    v.driver = pid; p.veh = vid; v.col.en = false;
    this.emit({ t: 'venter', vid, pid });
    return true;
  }
  exitVehicle(pid) {
    const p = this.players.get(pid);
    if (!p || p.veh < 0) return null;
    const v = this.vehicles[p.veh];
    v.driver = null; p.veh = -1; v.vx = 0; v.vz = 0; v.speed = 0; v.brake = false;
    updateVehicleCollider(v); v.col.en = true;
    // find an exit spot beside the car
    const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw), t = VTYPES[v.type];
    let spot = null;
    for (const side of [-1, 1, 0]) {
      const ex = side ? v.x + rx * side * (t.hw + 0.8) : v.x + Math.sin(v.yaw) * -(t.hl + 0.9);
      const ez = side ? v.z + rz * side * (t.hw + 0.8) : v.z + Math.cos(v.yaw) * -(t.hl + 0.9);
      const b = { x: ex, z: ez, y: 0 };
      resolveXZ(this.cs, b, 0.35, 1.7, 0.5);
      if (Math.hypot(b.x - ex, b.z - ez) < 0.25) { spot = { x: b.x, z: b.z }; break; }
    }
    if (!spot) spot = { x: v.x + rx * -(t.hw + 0.8), z: v.z + rz * -(t.hw + 0.8) };
    this.emit({ t: 'vexit', vid: v.id, pid, x: spot.x, z: spot.z });
    return spot;
  }
  vehicleState(pid, s) {
    const p = this.players.get(pid);
    if (!p || p.veh !== s.id) return;
    const v = this.vehicles[s.id];
    if (this.mp) {
      const d = Math.hypot(s.x - v.x, s.z - v.z);
      if (d > 45 * 0.25 + 3) return; // teleport guard
      s.fuel = Math.min(s.fuel, v.fuel + 0.01); // fuel can only go down from the client
    }
    v.x = s.x; v.z = s.z; v.y = s.y || 0; v.yaw = s.yaw; v.speed = s.speed; v.steer = s.steer; v.fuel = s.fuel; v.hp = s.hp;
    v.vx = s.vx ?? v.vx; v.vz = s.vz ?? v.vz; v.lights = !!s.lights; v.brake = !!s.brake;
    p.x = v.x; p.z = v.z; p.y = v.y;
    updateVehicleCollider(v);
  }
  refuel(pid, vid, amount) {
    const v = this.vehicles[vid], p = this.players.get(pid);
    if (!v || !p || dist2(v.x, v.z, p.x, p.z) > 49) return false;
    v.fuel = Math.min(VTYPES[v.type].tank, v.fuel + amount);
    this.emit({ t: 'fuel', vid, fuel: v.fuel });
    return true;
  }
  usePump(pid, iid) {
    const it = this.W.interacts[iid], p = this.players.get(pid);
    if (!it || it.type !== 'pump' || !p) return null;
    if (it.fuel <= 0) return { empty: true };
    // refuel the nearest vehicle within 7 m, else fill a can
    let best = null, bd = 49;
    for (const v of this.vehicles) { const d = dist2(v.x, v.z, it.x, it.z); if (d < bd) { bd = d; best = v; } }
    if (best) {
      const need = VTYPES[best.type].tank - best.fuel;
      const give = Math.min(need, it.fuel);
      it.fuel -= give;
      best.fuel += give;
      this.emit({ t: 'fuel', vid: best.id, fuel: best.fuel, pump: iid, left: it.fuel });
      return { vehicle: best.id, amount: give };
    }
    const give = Math.min(10, it.fuel);
    it.fuel -= give;
    this.emit({ t: 'pump', id: iid, left: it.fuel });
    return { can: true, amount: give };
  }
}

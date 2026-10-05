// Police checkpoints (çevirme noktaları, shared/trafficStops.ts). A few stops are up at a time at
// the bridge approaches, the highway connectors and the main boulevards: cones narrowing the road,
// two patrol cars with their lights flashing, officers with torches waving the traffic down, and at
// some a K9 handler with a sniffer dog.
//
// A driver heading at one gets "ÇEVİRME NOKTASI - YAVAŞLA VE DUR". Stopped at the line, an officer
// walks over to the window and checks the papers and the boot (3-5 s); the dog walks round the car
// sniffing the doors and the boot. Goods on anyone in the car: the dog barks every time (an officer
// alone finds them half the time); goods in the hidden compartment: the dog smells them 15% of the
// time; a stolen car: the papers give it away. Found: 2 stars and the stop's cars give chase.
// Clean: "Temiz, geçebilirsin." Through the stop without being checked (or driving off in the
// middle of it): 2 stars. Turning back once warned: the officers see it (always within 60 m, half
// the time further out) and report it: 1 star, a call.

import { KMH_PER_MS } from '../../../shared/drivetrain';
import { ECONOMY } from '../../../shared/economy.config';
import { STOP_SITES, coneLayout, stopCars, stopFrame, stopHeading, stopPoint, type StopSite, type StopState, type StopView } from '../../../shared/trafficStops';
import { Anim } from '../../../shared/types';
import { angleDiff } from '../../../shared/util';
import { getModel } from '../../../shared/vehicles';
import { createLogger } from '../../logger';
import type { Ctx } from '../context';
import type { NpcEntity } from '../simulation';
import type { PoliceService, Unit } from './police';
import { GOODS_ITEM } from './telegram';

const log = createLogger('stops');
const S = ECONOMY.police.stops;

interface Officer {
  npc: NpcEntity;
  /** Where it stands waving the traffic down, and which way it faces there. */
  post: { x: number; z: number; rot: number };
  hp: number;
  dead: boolean;
  /** Gun out (a stop gone wrong) until then (ms). */
  aimUntil: number;
  aimAt: { x: number; z: number } | null;
}

interface Dog {
  npc: NpcEntity;
  /** Round the car being checked: the points it sniffs at, the one it is heading for. */
  loop: { x: number; z: number; sniff: number }[];
  step: number;
  sniffUntil: number;
  barkUntil: number;
}

interface Check {
  playerId: string;
  vehicleId: string;
  /** Where the car stopped. */
  x: number;
  z: number;
  /** The officer is at the window from (ms; 0 while walking over) and the check is done at (ms). */
  at: number;
  ends: number;
  sec: number;
}

interface Stop {
  site: StopSite;
  view: StopView;
  units: Unit[];
  officers: Officer[];
  dog: Dog | null;
  check: Check | null;
}

/** A driver's dealings with a stop. */
interface Driver {
  stopId: string;
  phase: 'warn' | 'check' | 'done';
  /** Which side of the line they came from, how close they got, how long they've stood still. */
  side: number;
  closest: number;
  still: number;
  sent: string;
  sentAt: number;
}

let npcSeq = 1;

export class TrafficStopService {
  private stops = new Map<string, Stop>();
  private drivers = new Map<string, Driver>();
  /** When the next stop may go up (ms). */
  private nextAt = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
    /** Stops go up by themselves (off in the tests, which put them up where they want). */
    private readonly auto = true,
  ) {
    police.unitSources.push(() => this.allUnits());
    police.officerSources.push({ list: () => this.officerNpcs(), hit: (id, amount) => this.hitOfficer(id, amount) });
  }

  // ---------------------------------------------------------------- setting up

  /** Put a stop up at a site (also used by tests). */
  open(siteId: string, k9: boolean, now = Date.now()): StopView | null {
    const site = STOP_SITES.find((s) => s.id === siteId);
    if (!site || this.stops.has(siteId)) return null;
    const until = now + S.lifeSec * 1000;
    const view: StopView = { id: site.id, name: site.name, x: site.x, z: site.z, axis: site.axis, half: site.half, k9, until };
    const units = stopCars(site.half).map((c) => {
      const p = stopPoint(site, c.along, c.across);
      return this.police.standingUnit(p.x, p.z, stopHeading(site, c.dir));
    });
    // Officers either side of the lane, facing the traffic coming at them.
    const officers: Officer[] = [
      { along: -2.2, across: -(S.lane / 2 + 1.4), face: -1 },
      { along: 2.2, across: S.lane / 2 + 1.4, face: 1 },
    ].map((o) => {
      const p = stopPoint(site, o.along, o.across);
      const rot = stopHeading(site, o.face);
      const npc: NpcEntity = { id: `stp_${npcSeq++}`, x: p.x, z: p.z, rot, anim: Anim.TorchIdle, style: 0 };
      this.ctx.sim.npcs.set(npc.id, npc);
      return { npc, post: { x: p.x, z: p.z, rot }, hp: ECONOMY.combat.officerHp, dead: false, aimUntil: 0, aimAt: null };
    });
    let dog: Dog | null = null;
    if (k9) {
      const h = officers[0]!;
      const p = { x: h.post.x + Math.cos(h.post.rot) * 0.9, z: h.post.z - Math.sin(h.post.rot) * 0.9 };
      const npc: NpcEntity = { id: `k9_${npcSeq++}`, x: p.x, z: p.z, rot: h.post.rot, anim: Anim.Idle, style: 0 };
      this.ctx.sim.npcs.set(npc.id, npc);
      dog = { npc, loop: [], step: 0, sniffUntil: 0, barkUntil: 0 };
    }
    this.stops.set(site.id, { site, view, units, officers, dog, check: null });
    this.broadcast();
    log.info('checkpoint up', { site: site.id, k9 });
    return view;
  }

  private close(stop: Stop): void {
    for (const o of stop.officers) this.ctx.sim.npcs.delete(o.npc.id);
    if (stop.dog) this.ctx.sim.npcs.delete(stop.dog.npc.id);
    this.police.sendHome(stop.units);
    stop.units = [];
    this.stops.delete(stop.site.id);
    for (const [pid, d] of this.drivers) if (d.stopId === stop.site.id) this.drivers.delete(pid);
    this.broadcast();
  }

  /** Pack every stop up (tests). */
  closeAll(): void {
    for (const s of [...this.stops.values()]) this.close(s);
  }

  /** The stops up now. */
  views(): StopView[] {
    return [...this.stops.values()].map((s) => s.view);
  }

  get(id: string): Readonly<Stop> | undefined {
    return this.stops.get(id);
  }

  driverOf(playerId: string): Readonly<Driver> | undefined {
    return this.drivers.get(playerId);
  }

  private broadcast(): void {
    this.ctx.hub.broadcast('stop.list', this.views());
  }

  welcome(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'stop.list', this.views());
  }

  forget(playerId: string): void {
    this.drivers.delete(playerId);
    for (const s of this.stops.values()) if (s.check?.playerId === playerId) this.endCheck(s);
  }

  private allUnits(): Unit[] {
    const out: Unit[] = [];
    for (const s of this.stops.values()) out.push(...s.units);
    return out;
  }

  private officerNpcs(): NpcEntity[] {
    const out: NpcEntity[] = [];
    for (const s of this.stops.values()) for (const o of s.officers) if (!o.dead) out.push(o.npc);
    return out;
  }

  private hitOfficer(id: string, amount: number): boolean {
    for (const s of this.stops.values()) {
      const o = s.officers.find((x) => x.npc.id === id);
      if (!o || o.dead) continue;
      o.hp -= amount;
      if (o.hp <= 0) {
        o.dead = true;
        o.npc.anim = Anim.Dead;
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- tick

  tick(dt: number, now = Date.now()): void {
    // Stops come and go.
    for (const s of [...this.stops.values()]) {
      if (now >= s.view.until) {
        this.close(s);
        this.nextAt = Math.max(this.nextAt, now + S.gapSec * 1000);
      }
    }
    if (this.auto && this.stops.size < S.active && now >= this.nextAt) {
      const free = STOP_SITES.filter((x) => !this.stops.has(x.id));
      const site = free[Math.floor(this.ctx.rng() * free.length)];
      if (site) this.open(site.id, this.ctx.rng() < S.k9Chance, now);
      this.nextAt = now + 8000;
    }
    if (this.stops.size === 0) return;
    // Drivers at the stops.
    const seen = new Set<string>();
    for (const d of this.ctx.sim.drives.values()) {
      seen.add(d.playerId);
      this.watch(d.playerId, d.vehicleId, d.dyn.x, d.dyn.z, d.dyn.rot, d.dyn.speed, d.dyn.slip, d.dyn.deck ?? 0, dt, now);
    }
    for (const [pid, d] of this.drivers) {
      if (seen.has(pid)) continue;
      // Out of the car in the middle of a check: that's running for it too.
      const stop = this.stops.get(d.stopId);
      if (d.phase === 'check' && stop?.check?.playerId === pid) this.evaded(pid, stop, 'Kontrol sırasında araçtan indin!');
      this.drivers.delete(pid);
    }
    for (const s of this.stops.values()) {
      this.tickCheck(s, now);
      this.tickOfficers(s, dt, now);
      if (s.dog) this.tickDog(s, s.dog, dt, now);
    }
  }

  /** One driver against the stops. */
  private watch(playerId: string, vehicleId: string, x: number, z: number, rot: number, speed: number, slip: number, deck: number, dt: number, now: number): void {
    let d = this.drivers.get(playerId);
    const stop = d ? this.stops.get(d.stopId) : undefined;
    if (d && !stop) {
      this.drivers.delete(playerId);
      d = undefined;
    }
    const heading = speed >= 0 ? rot + slip : rot;
    const vx = Math.sin(heading) * speed;
    const vz = Math.cos(heading) * speed;
    if (!d) {
      if (deck !== 0) return;
      for (const s of this.stops.values()) {
        const f = stopFrame(s.site, x, z);
        const vAlong = s.site.axis === 'x' ? vx : vz;
        if (Math.abs(f.across) > s.site.half + 3 || Math.abs(f.along) > S.warnDist || Math.abs(f.along) < 3) continue;
        if (Math.abs(speed) < 1 || f.along * vAlong >= 0) continue;
        d = { stopId: s.site.id, phase: 'warn', side: Math.sign(f.along), closest: Math.abs(f.along), still: 0, sent: '', sentAt: 0 };
        this.drivers.set(playerId, d);
        this.state(playerId, vehicleId, { stopId: s.site.id, name: s.site.name, phase: 'warn', k9: !!s.dog, text: 'ÇEVİRME NOKTASI - YAVAŞLA VE DUR' });
        // A wanted driver: the officers know the car.
        if (this.police.starsOf(playerId) > 0 && !this.police.wantedOf(playerId)?.engaged) {
          this.caught(playerId, vehicleId, s, 'Aranan araç çevirmede! DUR, POLİS!', false);
          return;
        }
        break;
      }
      return;
    }
    const s = stop!;
    const f = stopFrame(s.site, x, z);
    const vAlong = s.site.axis === 'x' ? vx : vz;
    const kmh = Math.abs(speed) * KMH_PER_MS;
    if (d.phase === 'done') {
      if (Math.abs(f.along) > S.warnDist + 15 || Math.abs(f.across) > s.site.half + 10) this.drivers.delete(playerId);
      return;
    }
    d.closest = Math.min(d.closest, Math.abs(f.along));
    if (d.phase === 'warn') {
      // Through the line without being checked.
      if (Math.sign(f.along) !== d.side && Math.abs(f.along) > 6 && Math.abs(f.across) < s.site.half + 4) {
        this.evaded(playerId, s, 'Çevirme noktasını durmadan geçtin!');
        return;
      }
      // Stopped at the line: the check.
      if (Math.abs(f.along) <= S.stopBox && Math.abs(f.across) < s.site.half + 2 && kmh < S.stopKmh) {
        d.still += dt;
        if (d.still >= 0.4 && !s.check) {
          d.phase = 'check';
          const sec = S.checkSec[0] + this.ctx.rng() * (S.checkSec[1] - S.checkSec[0]);
          s.check = { playerId, vehicleId, x, z, at: 0, ends: 0, sec };
          if (s.dog) this.startSniff(s.dog, vehicleId);
          this.state(playerId, vehicleId, { stopId: s.site.id, name: s.site.name, phase: 'check', progress: 0, k9: !!s.dog, text: s.dog ? 'Evrak ve bagaj kontrolü · K9 köpeği aracı kokluyor' : 'Evrak ve bagaj kontrolü' });
        }
        return;
      }
      d.still = 0;
      // Turned back once warned: the officers see it.
      if (Math.abs(f.along) > d.closest + 18 && f.along * vAlong > 0 && Math.sign(f.along) === d.side) {
        d.phase = 'done';
        const spotted = d.closest <= S.uturnSure || this.ctx.rng() < 0.5;
        if (spotted) {
          this.police.raiseHeat(playerId, S.uturnHeat, 'uturn');
          this.state(playerId, vehicleId, { stopId: s.site.id, name: s.site.name, phase: 'uturn', text: 'Nöbetçi polis geri dönüşünü gördü: telsizle ihbar edildin!' });
          log.info('u-turn at a checkpoint', { playerId, stop: s.site.id, closest: Math.round(d.closest) });
        }
        return;
      }
      // Gone off the road / far away.
      if (Math.abs(f.across) > s.site.half + 12 || Math.abs(f.along) > S.warnDist + 25) this.drivers.delete(playerId);
      return;
    }
    // Being checked: the car must stay put.
    const c = s.check;
    if (!c || c.playerId !== playerId) {
      d.phase = 'warn';
      return;
    }
    if (Math.hypot(x - c.x, z - c.z) > 3 || kmh > 9) {
      this.evaded(playerId, s, 'Kontrolün ortasında gaza bastın!');
      return;
    }
    if (c.at > 0) {
      const p = Math.min(1, (now - c.at) / (c.sec * 1000));
      this.state(playerId, vehicleId, { stopId: s.site.id, name: s.site.name, phase: 'check', progress: Math.round(p * 20) / 20, k9: !!s.dog, text: s.dog ? 'Evrak ve bagaj kontrolü · K9 köpeği aracı kokluyor' : 'Evrak ve bagaj kontrolü' });
    }
  }

  /** The check: the officer at the window, then the verdict. */
  private tickCheck(s: Stop, now: number): void {
    const c = s.check;
    if (!c) return;
    if (!this.ctx.sim.drives.has(c.vehicleId)) {
      this.endCheck(s);
      return;
    }
    if (c.at === 0 || now < c.ends) return;
    const v = this.ctx.state.vehicles.get(c.vehicleId);
    const people = this.occupants(c.vehicleId);
    const open = people.some((id) => (this.ctx.state.players.get(id)?.inventory[GOODS_ITEM] ?? 0) > 0);
    const hidden = v?.mods.stashGrams ?? 0;
    let found: string | null = null;
    let bark = false;
    if (v?.status === 'stolen') found = 'Ruhsat sorgusu: araç ÇALINTI kaydında!';
    else if (open && this.ctx.rng() < (s.dog ? S.k9Open : S.officerOpen)) {
      found = s.dog ? 'K9 köpeği havladı: araçta uyuşturucu var!' : 'Polis bagajda ve üstünde malı buldu!';
      bark = !!s.dog;
    } else if (hidden > 0 && s.dog && this.ctx.rng() < S.k9Stash) {
      found = 'K9 köpeği gizli zuladaki kokuyu aldı!';
      bark = true;
    }
    const driver = c.playerId;
    this.endCheck(s);
    const d = this.drivers.get(driver);
    if (d) d.phase = 'done';
    if (bark && s.dog) {
      s.dog.barkUntil = now + 3500;
      this.ctx.hub.broadcast('stop.bark', { x: s.dog.npc.x, z: s.dog.npc.z });
    }
    if (found) {
      this.caught(driver, c.vehicleId, s, found, bark);
      return;
    }
    this.state(driver, c.vehicleId, { stopId: s.site.id, name: s.site.name, phase: 'clear', k9: !!s.dog, text: 'Temiz, geçebilirsin. İyi yolculuklar.' });
    log.info('checkpoint passed', { playerId: driver, stop: s.site.id, k9: !!s.dog, hidden });
  }

  private endCheck(s: Stop): void {
    s.check = null;
    if (s.dog) {
      s.dog.loop = [];
      s.dog.step = 0;
    }
  }

  /** Found out (or a wanted car): 2 stars at least, the stop's cars give chase, guns out. */
  private caught(playerId: string, vehicleId: string, s: Stop, why: string, bark: boolean): void {
    const d = this.drivers.get(playerId);
    if (d) d.phase = 'done';
    const units = s.units;
    s.units = [];
    this.police.engageWith(playerId, units, Math.max(S.caughtHeat, this.heatOf(playerId)), why, 1.5);
    this.aimAt(s, vehicleId);
    this.state(playerId, vehicleId, { stopId: s.site.id, name: s.site.name, phase: 'caught', k9: bark, text: why });
    log.info('caught at a checkpoint', { playerId, stop: s.site.id, why });
  }

  /** Through the stop without being checked: 2 stars, the stop's cars give chase. */
  private evaded(playerId: string, s: Stop, why: string): void {
    const d = this.drivers.get(playerId);
    if (d) d.phase = 'done';
    const c = s.check;
    const vehicleId = c?.playerId === playerId ? c.vehicleId : this.ctx.sim.chars.get(playerId)?.drivingId ?? null;
    if (c?.playerId === playerId) this.endCheck(s);
    const units = s.units;
    s.units = [];
    this.police.engageWith(playerId, units, Math.max(S.caughtHeat, this.heatOf(playerId)), 'Çevirmeden kaçan araç! Tüm ekipler takibe!', 0.8);
    if (vehicleId) this.aimAt(s, vehicleId);
    if (vehicleId) this.state(playerId, vehicleId, { stopId: s.site.id, name: s.site.name, phase: 'evaded', text: `${why} 2 yıldız aranıyorsun.` });
    log.info('checkpoint evaded', { playerId, stop: s.site.id });
  }

  private heatOf(playerId: string): number {
    return (this.police.wantedOf(playerId) as { heat?: number } | undefined)?.heat ?? 0;
  }

  /** Everyone in a car. */
  private occupants(vehicleId: string): string[] {
    const out = new Set<string>();
    const driver = this.ctx.sim.driverOf(vehicleId);
    if (driver) out.add(driver);
    for (const r of this.ctx.sim.ridersOf(vehicleId)) out.add(r.id);
    return [...out];
  }

  /** Tell the driver and everyone riding along (not the same thing twice in a row). */
  private state(playerId: string, vehicleId: string, st: StopState): void {
    const d = this.drivers.get(playerId);
    const key = JSON.stringify(st);
    const now = Date.now();
    if (d) {
      if (d.sent === key || (st.phase === 'check' && st.progress !== 0 && now - d.sentAt < 200)) return;
      d.sent = key;
      d.sentAt = now;
    }
    for (const id of new Set([playerId, ...this.occupants(vehicleId)])) this.ctx.hub.sendTo(id, 'stop.state', st);
  }

  private aimAt(s: Stop, vehicleId: string): void {
    const car = this.ctx.sim.drives.get(vehicleId)?.dyn;
    if (!car) return;
    for (const o of s.officers) {
      if (o.dead) continue;
      o.aimUntil = Date.now() + 6000;
      o.aimAt = { x: car.x, z: car.z };
    }
  }

  // ---------------------------------------------------------------- officers and the dog

  private tickOfficers(s: Stop, dt: number, now: number): void {
    const c = s.check;
    const car = c ? this.ctx.sim.drives.get(c.vehicleId)?.dyn : undefined;
    s.officers.forEach((o, i) => {
      if (o.dead) return;
      const n = o.npc;
      if (now < o.aimUntil && o.aimAt) {
        n.rot += angleDiff(n.rot, Math.atan2(o.aimAt.x - n.x, o.aimAt.z - n.z)) * Math.min(1, dt * 8);
        n.anim = Anim.Aim;
        return;
      }
      // The officer on the driver's side walks over to the window for the check.
      let goal = o.post;
      if (c && car && i === this.checkingOfficer(s, car)) {
        const model = this.ctx.state.vehicles.get(c.vehicleId);
        const hw = model ? getModel(model.modelId).shape.width / 2 : 0.95;
        // The driver's door: the car's left side, a little ahead of the middle.
        goal = { x: car.x + Math.cos(car.rot) * (hw + 0.7) + Math.sin(car.rot) * 0.4, z: car.z - Math.sin(car.rot) * (hw + 0.7) + Math.cos(car.rot) * 0.4, rot: car.rot - Math.PI / 2 };
      }
      const dx = goal.x - n.x;
      const dz = goal.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        const step = Math.min(d, 2.4 * dt);
        n.x += (dx / d) * step;
        n.z += (dz / d) * step;
        n.rot += angleDiff(n.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
        n.anim = Anim.TorchWalk;
        return;
      }
      n.anim = Anim.TorchIdle;
      if (c && car && goal !== o.post) {
        // At the window: face the driver, start the clock.
        n.rot += angleDiff(n.rot, Math.atan2(car.x - n.x, car.z - n.z)) * Math.min(1, dt * 6);
        if (c.at === 0) {
          c.at = now;
          c.ends = now + c.sec * 1000;
        }
        return;
      }
      // Waving the traffic down: the torch swings now and then.
      n.rot += angleDiff(n.rot, o.post.rot + Math.sin(now / 900 + i) * 0.35) * Math.min(1, dt * 3);
    });
  }

  /** The officer nearest the car's driver side does the check. */
  private checkingOfficer(s: Stop, car: { x: number; z: number }): number {
    let best = 0;
    let bestD = Infinity;
    s.officers.forEach((o, i) => {
      if (o.dead) return;
      const d = Math.hypot(o.post.x - car.x, o.post.z - car.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** The dog's round of the car: the front corners, the doors, the boot. */
  private startSniff(dog: Dog, vehicleId: string): void {
    const car = this.ctx.sim.drives.get(vehicleId)?.dyn;
    const v = this.ctx.state.vehicles.get(vehicleId);
    if (!car || !v) return;
    const shape = getModel(v.modelId).shape;
    const hl = shape.length / 2 + 0.55;
    const hw = shape.width / 2 + 0.5;
    const at = (lx: number, lz: number) => ({ x: car.x + Math.cos(car.rot) * lx + Math.sin(car.rot) * lz, z: car.z - Math.sin(car.rot) * lx + Math.cos(car.rot) * lz });
    dog.loop = [
      { ...at(hw, hl * 0.6), sniff: 0.6 },
      { ...at(hw, 0), sniff: 1.1 },
      { ...at(hw * 0.7, -hl), sniff: 1.6 },
      { ...at(-hw * 0.7, -hl), sniff: 1.2 },
      { ...at(-hw, 0), sniff: 1.1 },
      { ...at(-hw, hl * 0.6), sniff: 0.6 },
    ];
    dog.step = 0;
    dog.sniffUntil = 0;
  }

  private tickDog(s: Stop, dog: Dog, dt: number, now: number): void {
    const n = dog.npc;
    if (now < dog.barkUntil) {
      n.anim = Anim.Aim;
      const c = this.ctx.sim.drives.size ? [...this.ctx.sim.drives.values()].reduce((a, b) => (Math.hypot(b.dyn.x - n.x, b.dyn.z - n.z) < Math.hypot(a.dyn.x - n.x, a.dyn.z - n.z) ? b : a)).dyn : null;
      if (c) n.rot += angleDiff(n.rot, Math.atan2(c.x - n.x, c.z - n.z)) * Math.min(1, dt * 8);
      return;
    }
    const handler = s.officers[0]!;
    const target = s.check && dog.loop.length ? dog.loop[dog.step % dog.loop.length]! : null;
    const goal = target ?? { x: handler.npc.x + Math.cos(handler.npc.rot) * 0.9, z: handler.npc.z - Math.sin(handler.npc.rot) * 0.9 };
    const dx = goal.x - n.x;
    const dz = goal.z - n.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.2) {
      const step = Math.min(d, 1.8 * dt);
      n.x += (dx / d) * step;
      n.z += (dz / d) * step;
      n.rot += angleDiff(n.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 7);
      n.anim = Anim.Walk;
      dog.sniffUntil = 0;
      return;
    }
    if (!target) {
      n.rot += angleDiff(n.rot, handler.npc.rot) * Math.min(1, dt * 3);
      n.anim = Anim.Idle;
      return;
    }
    // Nose down at the door / the boot, then on round the car.
    if (dog.sniffUntil === 0) dog.sniffUntil = now + target.sniff * 1000;
    n.anim = Anim.Kneel;
    if (now >= dog.sniffUntil) {
      dog.step++;
      dog.sniffUntil = 0;
    }
  }

  /** Where the cones are (tests). */
  cones(id: string): { x: number; z: number }[] {
    const s = this.stops.get(id);
    if (!s) return [];
    return coneLayout(s.site.half).map(([a, c]) => stopPoint(s.site, a, c));
  }
}

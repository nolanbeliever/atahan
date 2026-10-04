// Heists (shared/heists.ts): E at a target's door starts the job. The police hear straight away
// (the starter and everyone near them get the target's wanted stars), the alarm goes off, and the
// work runs while someone of the crew is at the door. Done: the loot is in the bag ("hot") until
// the police are lost; then it is paid as dirty money (shared/underworld.ts), shared out between
// the crew still around. Busted: the police take it. Wasted or logged off: it is gone.
//
// The showroom job ends differently: the hacked security leaves a hypercar outside the bollards;
// the crew has dropSec to drive it into the docks, where the buyer pays (then lose the police).

import { ECONOMY } from '../../../shared/economy.config';
import { HEISTS, HEIST_CAR_SPAWN, HEIST_DROP, findHeist, rollLoot, type Heist, type HeistId, type HeistView } from '../../../shared/heists';
import { findShowroom, newShowroomCar } from '../../../shared/showrooms';
import type { Vehicle } from '../../../shared/types';
import { modelDisplayName } from '../../../shared/vehicles';
import { ownedWeapons } from '../../../shared/weapons';
import { KMH_PER_MS } from '../../../shared/drivetrain';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import type { CombatService } from './combat';
import type { CrimeService } from './crime';
import type { PoliceService } from './police';
import type { TheftService } from './theft';

const log = createLogger('heists');
const H = ECONOMY.heists;
const HEIST_IDS = HEISTS.map((h) => h.id);

interface Job {
  heist: Heist;
  /** Who started it, and the crew (near them when it started; they share the loot). */
  leader: string;
  crew: Set<string>;
  phase: HeistView['phase'];
  /** Seconds of work done; seconds everyone has been far away. */
  done: number;
  away: number;
  atDoor: boolean;
  loot: number;
  /** Showroom job: the getaway car and when the buyer at the docks gives up (ms). */
  carId?: string;
  dropUntil?: number;
  /** When the first police cars get there (ms). */
  policeAt: number;
}

export class HeistService {
  /** Jobs by every crew member's id (one job object shared). */
  private jobs = new Map<string, Job>();
  /** When each target can be hit again, and when each player may start another (ms). */
  private targetReady = new Map<HeistId, number>();
  private playerReady = new Map<string, number>();
  /** What each player was last sent, and when (to send changes only, at most 4 a second). */
  private sent = new Map<string, { key: string; at: number }>();

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
    combat: CombatService,
    private readonly crime: CrimeService,
    private readonly theft: TheftService,
  ) {
    police.clearedListeners.push((pid) => void this.onCleared(pid));
    police.bustListeners.push((pid) => this.lose(pid, 'busted'));
    police.seizeListeners.push((pid, vehicleId) => {
      const j = this.jobs.get(pid);
      if (j?.carId === vehicleId && j.phase === 'drive') this.fail(j, 'Polis galeri arabasına el koydu.');
    });
    combat.wastedListeners.push((pid) => this.lose(pid, 'wasted'));
    // At the door you're in the doorway's cover.
    combat.coverFns.push((pid) => this.inCover(pid) ? H.cover : 1);
  }

  // ---------------------------------------------------------------- starting

  /** E at a target's door. */
  start(playerId: string, params: unknown): HeistView {
    const p = val.obj(params);
    const heist = findHeist(val.oneOf(p.heistId, 'heist', HEIST_IDS))!;
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead) throw new GameError('conflict', 'Önce ayağa kalk.');
    if (c.drivingId || c.ridingId) throw new GameError('conflict', 'Araçtan in: soygun yaya yapılır.');
    if (Math.hypot(c.x - heist.stand.x, c.z - heist.stand.z) > H.workRadius + 1) throw new GameError('too_far', 'Kapıya yaklaş.');
    if (this.jobs.has(playerId)) throw new GameError('conflict', 'Zaten bir işin var.');
    const player = this.ctx.state.players.get(playerId)!;
    if (ownedWeapons(player.inventory).length === 0) throw new GameError('conflict', 'Silahsız soygun olmaz: önce Ammu-Nation’dan bir silah al.');
    const now = Date.now();
    const ready = this.targetReady.get(heist.id) ?? 0;
    if (now < ready) throw new GameError('rate_limited', `${heist.name} daha yeni soyuldu: ${Math.ceil((ready - now) / 60_000)} dk sonra tekrar dene.`);
    const mine = this.playerReady.get(playerId) ?? 0;
    if (now < mine) throw new GameError('rate_limited', `Ortalık biraz soğusun: ${Math.ceil((mine - now) / 1000)} sn.`);
    // The crew: everyone close by (on foot or in a car) who isn't on another job.
    const crew = new Set<string>([playerId]);
    for (const o of this.ctx.sim.chars.values()) {
      if (o.id === playerId || o.dead || this.jobs.has(o.id)) continue;
      if (Math.hypot(o.x - c.x, o.z - c.z) <= H.crewRadius) crew.add(o.id);
    }
    const response = H.responseSec[heist.stars] ?? 20;
    const job: Job = { heist, leader: playerId, crew, phase: 'work', done: 0, away: 0, atDoor: true, loot: 0, policeAt: now + response * 1000 };
    for (const id of crew) this.jobs.set(id, job);
    this.targetReady.set(heist.id, now + H.cooldownSec * 1000);
    this.playerReady.set(playerId, now + H.playerCooldownSec * 1000);
    // The police know at once; their cars are on the way.
    for (const id of crew) {
      this.police.raiseHeat(id, heist.stars * 100 - 50);
      this.police.holdUnits(id, response);
    }
    this.ctx.hub.broadcast('heist.alarm', { id: heist.id, on: true });
    for (const id of crew) {
      this.ctx.hub.notify(id, { kind: 'warning', title: `🚨 ${heist.title}!`, text: `${heist.name}: alarm çaldı, polis yolda! Kapıda kal: ${heist.task.toLowerCase()} (${heist.workSec} sn).` });
      this.send(id, job, true);
    }
    this.ctx.sim.markInteract(playerId);
    log.info('heist started', { playerId, heist: heist.id, crew: crew.size });
    return this.view(job);
  }

  /** Give the job up (the police still want you). */
  abort(playerId: string): { ok: true } {
    const j = this.jobs.get(playerId);
    if (!j) return { ok: true };
    if (j.phase === 'escape') throw new GameError('conflict', 'Ganimet çantada: polisi atlat!');
    this.fail(j, 'Soygunu bıraktın.');
    return { ok: true };
  }

  /** Working at the door of a job that is on (in the doorway's cover). */
  private inCover(playerId: string): boolean {
    const j = this.jobs.get(playerId);
    const c = this.ctx.sim.chars.get(playerId);
    if (!j || j.phase !== 'work' || !c || c.drivingId) return false;
    return Math.hypot(c.x - j.heist.stand.x, c.z - j.heist.stand.z) <= H.workRadius;
  }

  /** Your job, the targets whose alarms are ringing, and when the others can be hit again. */
  status(playerId: string): { heist: HeistView | null; alarms: HeistId[]; cooldowns: Partial<Record<HeistId, number>> } {
    const j = this.jobs.get(playerId);
    const now = Date.now();
    const cooldowns: Partial<Record<HeistId, number>> = {};
    for (const [id, t] of this.targetReady) if (t > now) cooldowns[id] = Math.ceil((t - now) / 1000);
    return { heist: j ? this.view(j) : null, alarms: this.alarms(), cooldowns };
  }

  private alarms(): HeistId[] {
    return [...new Set([...this.jobs.values()].filter((j) => j.phase !== 'escape').map((j) => j.heist.id))];
  }

  // ---------------------------------------------------------------- the work

  tick(dt: number, now = Date.now()): void {
    for (const j of new Set(this.jobs.values())) {
      if (j.phase === 'work') this.work(j, dt, now);
      else if (j.phase === 'drive') this.drive(j, now);
      for (const id of j.crew) if (this.jobs.get(id) === j) this.send(id, j);
    }
  }

  private work(j: Job, dt: number, now: number): void {
    const h = j.heist;
    let atDoor = false;
    let near = false;
    for (const id of j.crew) {
      const c = this.ctx.sim.chars.get(id);
      if (!c || c.dead || this.jobs.get(id) !== j) continue;
      const d = Math.hypot(c.x - h.stand.x, c.z - h.stand.z);
      if (d <= H.workRadius && !c.drivingId && !c.ridingId) atDoor = true;
      if (d <= H.abortRadius) near = true;
    }
    j.atDoor = atDoor;
    if (atDoor) j.done = Math.min(h.workSec, j.done + dt);
    j.away = near ? 0 : j.away + dt;
    if (j.away >= H.abortSec) {
      this.fail(j, `${h.name}: kapıdan çok uzaklaştınız, iş yarıda kaldı.`);
      return;
    }
    if (j.done < h.workSec) return;
    if (h.id === 'dealership') void this.unlockCar(j, now);
    else this.bag(j, rollLoot(h, this.ctx.rng()));
  }

  /** The loot is in the bag: now get away. */
  private bag(j: Job, loot: number): void {
    j.phase = 'escape';
    j.loot = loot;
    this.ctx.hub.broadcast('heist.alarm', { id: j.heist.id, on: false });
    for (const id of j.crew) {
      if (this.jobs.get(id) !== j) continue;
      this.ctx.hub.sendTo(id, 'heist.done', { id: j.heist.id, title: j.heist.title, loot });
      this.send(id, j, true);
    }
    log.info('heist done', { leader: j.leader, heist: j.heist.id, loot });
    // Somebody already without a wanted level (it can happen with a crew): theirs at once.
    for (const id of j.crew) if (this.jobs.get(id) === j && this.police.starsOf(id) === 0) void this.onCleared(id);
  }

  /** The showroom job: the hypercar is waiting outside the bollards. */
  private async unlockCar(j: Job, now: number): Promise<void> {
    if (j.phase !== 'work') return;
    j.phase = 'drive';
    j.dropUntil = now + H.dropSec * 1000;
    const showroom = findShowroom('hyper')!;
    const modelId = showroom.models[Math.floor(this.ctx.rng() * showroom.models.length)]!;
    const base = newShowroomCar(modelId, '#111111');
    const vehicle: Vehicle = { ...base, id: newId('veh'), ownerId: j.leader, status: 'stolen', fuel: 70, x: HEIST_CAR_SPAWN.x, z: HEIST_CAR_SPAWN.z, rotation: HEIST_CAR_SPAWN.rot, createdAt: now };
    j.carId = vehicle.id;
    try {
      await this.ctx.locks.run([K.vehicle(vehicle.id)], async () => {
        const uow = this.ctx.state.begin();
        uow.createVehicle(vehicle);
        await uow.commit();
      });
    } catch (err) {
      log.error('heist car failed', { error: (err as Error).message });
      this.fail(j, 'Araç hazırlanamadı.');
      return;
    }
    this.theft.touch(vehicle.id);
    this.ctx.hub.broadcast('vehicle.upsert', this.ctx.state.toPublicVehicle(this.ctx.state.vehicles.get(vehicle.id)!));
    this.ctx.sim.rebuildDynamic();
    this.ctx.hub.broadcast('heist.alarm', { id: j.heist.id, on: false });
    for (const id of j.crew) {
      if (this.jobs.get(id) !== j) continue;
      this.ctx.hub.notify(id, { kind: 'success', title: 'İmmobilizer kırıldı!', text: `${modelDisplayName(modelId)} bariyerlerin dışında seni bekliyor. ${Math.round(H.dropSec / 60)} dakika içinde limana (konteyner sahası) teslim et!` });
      this.send(id, j, true);
    }
  }

  /** The showroom car on its way to the docks. */
  private drive(j: Job, now: number): void {
    const car = j.carId ? this.ctx.state.vehicles.get(j.carId) : undefined;
    if (!car) {
      this.fail(j, 'Galeri arabası elden çıktı.');
      return;
    }
    if (now > (j.dropUntil ?? 0)) {
      this.fail(j, 'Alıcı limandan ayrıldı: süre doldu.');
      return;
    }
    if (car.status === 'stolen' && this.ctx.sim.isDriven(car.id)) this.theft.touch(car.id);
    const d = this.ctx.sim.drives.get(car.id);
    const x = d?.dyn.x ?? car.x;
    const z = d?.dyn.z ?? car.z;
    const speed = Math.abs(d?.dyn.speed ?? 0) * KMH_PER_MS;
    if (Math.hypot(x - HEIST_DROP.x, z - HEIST_DROP.z) > HEIST_DROP.radius || speed > 25) return;
    void this.deliver(j, car.id);
  }

  private async deliver(j: Job, carId: string): Promise<void> {
    if (j.phase !== 'drive') return;
    j.phase = 'escape';
    const car = this.ctx.state.vehicles.get(carId);
    try {
      await this.ctx.locks.run([K.vehicle(carId)], async () => {
        const driver = this.ctx.sim.driverOf(carId);
        if (driver) this.ctx.sim.stopDriving(driver);
        for (const r of this.ctx.sim.ridersOf(carId)) this.ctx.sim.stopRiding(r.id);
        const uow = this.ctx.state.begin();
        uow.deleteVehicle(carId);
        await uow.commit();
      });
    } catch (err) {
      log.error('heist delivery failed', { error: (err as Error).message });
    }
    this.ctx.hub.broadcast('vehicle.remove', carId);
    this.ctx.sim.rebuildDynamic();
    this.bag(j, rollLoot(j.heist, this.ctx.rng()));
    log.info('heist car delivered', { leader: j.leader, model: car?.modelId });
  }

  // ---------------------------------------------------------------- endings

  /** The police lost (or never had) this player: their share of the loot is theirs, as dirty money. */
  private async onCleared(playerId: string): Promise<void> {
    const j = this.jobs.get(playerId);
    if (!j || j.phase !== 'escape') return;
    // The crew still on the job share it.
    const crew = [...j.crew].filter((id) => this.jobs.get(id) === j);
    const share = Math.floor(j.loot / Math.max(1, crew.length) / 100) * 100;
    this.jobs.delete(playerId);
    j.crew.delete(playerId);
    j.loot -= share;
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        uow.grantXp(p, H.xp);
        this.crime.edit(uow, playerId, (s) => {
          s.dirty += share;
          s.heists += 1;
          s.bestHeist = Math.max(s.bestHeist, share);
        });
        await this.crime.commit(uow);
      });
      this.ctx.hub.sendTo(playerId, 'heist.cashed', { id: j.heist.id, amount: share, xp: H.xp });
      this.ctx.hub.sendTo(playerId, 'heist.update', null);
      log.info('heist cashed', { playerId, heist: j.heist.id, share });
    } catch (err) {
      log.error('heist payout failed', { playerId, error: (err as Error).message });
    }
  }

  /** Busted (the police take the bag), wasted (it's gone). */
  private lose(playerId: string, reason: 'busted' | 'wasted'): void {
    const j = this.jobs.get(playerId);
    if (!j) return;
    this.jobs.delete(playerId);
    j.crew.delete(playerId);
    const crew = [...j.crew].filter((id) => this.jobs.get(id) === j);
    const amount = j.phase === 'escape' ? Math.floor(j.loot / (crew.length + 1) / 100) * 100 : 0;
    j.loot -= amount;
    const text =
      j.phase === 'escape'
        ? reason === 'busted'
          ? `Polis ganimete el koydu: ${'$' + amount.toLocaleString('en-US')} gitti.`
          : `Yere düştün, çanta gitti: ${'$' + amount.toLocaleString('en-US')}.`
        : reason === 'busted'
          ? 'Soygun sırasında yakalandın.'
          : 'Soygun sırasında vuruldun.';
    this.ctx.hub.sendTo(playerId, 'heist.lost', { id: j.heist.id, amount, reason, text });
    this.ctx.hub.sendTo(playerId, 'heist.update', null);
    if (crew.length === 0) this.end(j);
  }

  /** The job fell through for the whole crew. */
  private fail(j: Job, text: string): void {
    for (const id of j.crew) {
      if (this.jobs.get(id) !== j) continue;
      this.jobs.delete(id);
      this.ctx.hub.sendTo(id, 'heist.lost', { id: j.heist.id, amount: 0, reason: 'failed', text });
      this.ctx.hub.sendTo(id, 'heist.update', null);
    }
    this.end(j);
    log.info('heist failed', { leader: j.leader, heist: j.heist.id, text });
  }

  private end(j: Job): void {
    for (const id of j.crew) if (this.jobs.get(id) === j) this.jobs.delete(id);
    if (!this.alarms().includes(j.heist.id)) this.ctx.hub.broadcast('heist.alarm', { id: j.heist.id, on: false });
  }

  /** Logged off: the loot (their share) is gone. */
  forget(playerId: string): void {
    const j = this.jobs.get(playerId);
    if (!j) return;
    this.jobs.delete(playerId);
    j.crew.delete(playerId);
    if (![...j.crew].some((id) => this.jobs.get(id) === j)) this.end(j);
    this.playerReady.delete(playerId);
    this.sent.delete(playerId);
  }

  /** The job a player is on (tests). */
  jobOf(playerId: string): Readonly<{ heist: Heist; phase: HeistView['phase']; done: number; loot: number; carId?: string; crew: ReadonlySet<string> }> | undefined {
    return this.jobs.get(playerId);
  }

  // ---------------------------------------------------------------- network

  private view(j: Job): HeistView {
    const h = j.heist;
    const v: HeistView = {
      id: h.id,
      title: h.title,
      task: h.task,
      phase: j.phase,
      progress: Math.round((j.done / h.workSec) * 1000) / 1000,
      left: Math.max(0, Math.ceil(h.workSec - j.done)),
      atDoor: j.atDoor,
      loot: j.loot,
    };
    const policeIn = Math.ceil((j.policeAt - Date.now()) / 1000);
    if (j.phase === 'work' && policeIn > 0) v.policeIn = policeIn;
    if (j.phase === 'drive' && j.dropUntil) {
      v.drop = { x: HEIST_DROP.x, z: HEIST_DROP.z, until: j.dropUntil };
      if (j.carId) v.carId = j.carId;
    }
    return v;
  }

  private send(playerId: string, j: Job, force = false): void {
    const view = this.view(j);
    const key = JSON.stringify(view);
    const now = Date.now();
    const last = this.sent.get(playerId);
    if (!force && last && (key === last.key || now - last.at < 250)) return;
    this.sent.set(playerId, { key, at: now });
    this.ctx.hub.sendTo(playerId, 'heist.update', view);
  }
}

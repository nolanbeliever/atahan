// Night burglaries (shared/burglary.ts). From 22:00 to 06:00 (game time) the jewellers, the
// electronics shops, the two villas and a few flats are locked up and empty.
//
// At the front door: the lockpick mini-game (the sweet spot stays here). Every snapped pick costs
// one lockpick from the inventory and the click raises the place's security by 20% (it cools down
// slowly); at 100% the neighbours call the police. Open: you are teleported into the place's room
// (far away from the city; only the people inside it see it) and the door stays open for your crew
// until everyone is out.
//
// Inside, the noise meter (it starts at the security left by the lock): running fills it, walking
// barely, standing still lets it settle; knocking a vase or a chair over adds a lot. Laser beams
// across the doorways (some blink) and motion sensors on the walls (their LEDs go red and green)
// set the alarm off at once, as does a full noise meter, three wrong turns on the safe's dial, or
// still being inside when the owners get back in the morning. The alarm: red flashers, a loud bell,
// 2 stars and the first police car 30 s from the door. Still inside when they get there: they come
// in and you're out on the pavement in front of them.
//
// Loot: the safe's cash ($15,000-$35,000) and jewellery, watches, laptops, phones and tablets (the
// Pawn Shop buys them). Out of the front door without an alarm: clean money in your pocket and the
// goods in your inventory. With the alarm: the bag is hot until the police lose you (then the cash
// is dirty money); busted or wasted, it is gone.

import {
  BURGLARY_TARGETS,
  EXIT_REACH,
  KNOCK_TOUCH,
  LASER_TOUCH,
  LOOT_ITEMS,
  LOOT_REACH,
  burglaryOpen,
  cycleOn,
  findTarget,
  inInteriorZone,
  layoutOf,
  ownersBack,
  roomAt,
  roomEntry,
  roomPoint,
  segDist,
  type BurglaryResult,
  type BurglaryState,
  type BurglaryTarget,
  type BurglaryTargetView,
  type LootItemId,
  type LootSpot,
} from '../../../shared/burglary';
import { ECONOMY } from '../../../shared/economy.config';
import type { LockpickResult } from '../../../shared/protocol';
import { LOCKPICK_ITEM, lockHint, lockTurn, type LockDifficulty } from '../../../shared/theft';
import { formatMoney } from '../../../shared/util';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import type { CombatService } from './combat';
import type { CrimeService } from './crime';
import type { PoliceService } from './police';

const log = createLogger('burglary');
const B = ECONOMY.burglary;
const TARGET_IDS = BURGLARY_TARGETS.map((t) => t.id);

type Bag = { cash: number; items: Partial<Record<LootItemId, number>> };

interface Job {
  target: BurglaryTarget;
  /** Noise meter 0-100 and the floor it settles to (the security the lock left). */
  noise: number;
  floor: number;
  alarm: boolean;
  cause: string | null;
  policeAt: number | null;
  inside: Set<string>;
  taken: Set<string>;
  knocked: Set<string>;
  /** How many of a thing lie on each counter / shelf (rolled when the door opened). */
  qty: Map<string, number>;
  work: Map<string, { lootId: string; until: number; sec: number }>;
  safe: { tries: number; open: boolean; cash: number };
  bags: Map<string, Bag>;
  startedAt: number;
}

interface LockSession {
  id: string;
  playerId: string;
  targetId: string;
  mode: 'door' | 'safe';
  sweet: number;
  tolerance: number;
  expiresAt: number;
  lastTry: number;
}

function addItem(inv: Record<string, number>, id: string, qty: number): void {
  const n = (inv[id] ?? 0) + qty;
  if (n > 0) inv[id] = n;
  else delete inv[id];
}

function bagEmpty(b: Bag | undefined): boolean {
  return !b || (b.cash <= 0 && Object.values(b.items).every((n) => !n));
}

function difficulty(tol: number): LockDifficulty {
  return tol >= 9 ? 'easy' : tol >= 7 ? 'medium' : tol >= 5 ? 'hard' : 'extreme';
}

export class BurglaryService {
  /** Places being robbed right now (by target id). */
  private jobs = new Map<string, Job>();
  /** Who is inside where. */
  private inside = new Map<string, string>();
  private sessions = new Map<string, LockSession>();
  /** Security left by snapped picks (value, when): it cools down. */
  private security = new Map<string, { value: number; at: number }>();
  /** When a place can be done again; a player's next start; the ringing alarms. */
  private readyAt = new Map<string, number>();
  private playerReady = new Map<string, number>();
  private alarmUntil = new Map<string, number>();
  /** Bags out of a place with the alarm going: theirs once the police have lost them. */
  private hot = new Map<string, Bag & { targetId: string }>();
  private sent = new Map<string, { key: string; at: number }>();
  private lastTargets = '';
  /** The game hour (tests set it). */
  hour: () => number = () => -1;
  /** XP and the like after a clean job (missions listen). */
  readonly doneListeners: ((playerId: string, targetId: string, clean: boolean) => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
    combat: CombatService,
    private readonly crime: CrimeService,
  ) {
    // To the police a burglar inside is at the front door, out of sight.
    police.hideouts.push((pid) => {
      const id = this.inside.get(pid);
      const t = id ? findTarget(id) : undefined;
      return t ? { x: t.stand.x, z: t.stand.z } : null;
    });
    police.clearedListeners.push((pid) => void this.cashHot(pid));
    police.bustListeners.push((pid) => this.loseHot(pid, 'Polis çantaya el koydu.'));
    combat.wastedListeners.push((pid) => {
      // Shot inside: the hospital has them now (combat moved them); the bag stays behind.
      this.dropInside(pid);
      this.loseHot(pid, 'Yere düştün, çanta gitti.');
    });
  }

  /** Is it night (22:00-06:00)? The test hook overrides the clock. */
  private night(now: number): boolean {
    const h = this.hour();
    if (h < 0) return burglaryOpen(now);
    return h >= B.fromHour || h < B.toHour;
  }

  private morning(now: number): boolean {
    const h = this.hour();
    if (h < 0) return ownersBack(now);
    return h >= B.ownersHour && h < B.fromHour;
  }

  /** The security a place's lock has left (cooling down). */
  private securityOf(targetId: string, now = Date.now()): number {
    const s = this.security.get(targetId);
    if (!s) return 0;
    const v = s.value - ((now - s.at) / 1000) * B.securityDecay;
    if (v <= 0) {
      this.security.delete(targetId);
      return 0;
    }
    return v;
  }

  private raiseSecurity(targetId: string, by: number, now = Date.now()): number {
    const v = Math.min(100, this.securityOf(targetId, now) + by);
    this.security.set(targetId, { value: v, at: now });
    return v;
  }

  // ---------------------------------------------------------------- views

  views(now = Date.now()): BurglaryTargetView[] {
    return BURGLARY_TARGETS.map((t) => ({
      id: t.id,
      security: Math.round(this.jobs.get(t.id)?.noise ?? this.securityOf(t.id, now)),
      alarm: (this.alarmUntil.get(t.id) ?? 0) > now,
      open: this.jobs.has(t.id),
      readyAt: this.readyAt.get(t.id) ?? 0,
    }));
  }

  private publish(force = false): void {
    const v = this.views();
    // Security creeps down every tick: send when something else changed (or in 5% steps).
    const key = JSON.stringify(v.map((x) => [x.id, Math.round(x.security / 5), x.alarm, x.open, x.readyAt]));
    if (!force && key === this.lastTargets) return;
    this.lastTargets = key;
    this.ctx.hub.broadcast('burglary.targets', v);
  }

  welcome(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'burglary.targets', this.views());
  }

  /** Who is inside where (tests, the minimap). */
  insideOf(playerId: string): string | null {
    return this.inside.get(playerId) ?? null;
  }

  job(targetId: string): Readonly<Job> | undefined {
    return this.jobs.get(targetId);
  }

  private state(job: Job, playerId: string): BurglaryState {
    const w = job.work.get(playerId);
    const bag = job.bags.get(playerId) ?? { cash: 0, items: {} };
    return {
      targetId: job.target.id,
      noise: Math.round(job.noise * 10) / 10,
      alarm: job.alarm,
      cause: job.cause,
      policeAt: job.policeAt,
      taken: [...job.taken],
      knocked: [...job.knocked],
      work: w ? { ...w } : null,
      safe: { tries: job.safe.tries, open: job.safe.open },
      bag: { cash: bag.cash, items: { ...bag.items } },
    };
  }

  private send(job: Job, force = false): void {
    const now = Date.now();
    for (const pid of job.inside) {
      const st = this.state(job, pid);
      const key = JSON.stringify({ ...st, noise: Math.round(st.noise) });
      const last = this.sent.get(pid);
      if (!force && last && (last.key === key || now - last.at < 200)) continue;
      this.sent.set(pid, { key, at: now });
      this.ctx.hub.sendTo(pid, 'burglary.state', st);
    }
  }

  // ---------------------------------------------------------------- the door

  private standing(playerId: string, t: BurglaryTarget, reach: number) {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead) throw new GameError('conflict', 'Önce ayağa kalk.');
    if (c.drivingId || c.ridingId) throw new GameError('conflict', 'Araçtan in: kapıya yaya gidilir.');
    if (Math.hypot(c.x - t.stand.x, c.z - t.stand.z) > reach) throw new GameError('too_far', 'Kapıya yaklaş.');
    return c;
  }

  private checkOpen(playerId: string, t: BurglaryTarget, now: number): void {
    if (!this.night(now)) throw new GameError('conflict', "Bu mekan gündüz açık/korumalı, gece 22:00'den sonra tekrar gel.");
    if (this.police.starsOf(playerId) > 0) throw new GameError('conflict', 'Polis seni arıyor: önce izini kaybettir.');
    if ((this.alarmUntil.get(t.id) ?? 0) > now) throw new GameError('conflict', 'Alarm çalıyor: burası şimdi çok sıcak.');
    if (this.inside.has(playerId)) throw new GameError('conflict', 'Zaten içerdesin.');
  }

  /** Start picking a door's lock (one lockpick in the inventory at least). */
  async pick(playerId: string, params: unknown) {
    const p = val.obj(params);
    const t = findTarget(val.oneOf(p.targetId, 'target', TARGET_IDS))!;
    return this.ctx.locks.run([K.player(playerId), `burglary:${t.id}`], async () => {
      const now = Date.now();
      this.standing(playerId, t, B.pickReach + 0.8);
      this.checkOpen(playerId, t, now);
      if (this.jobs.has(t.id)) throw new GameError('conflict', 'Kapı zaten açık: içeri gir.');
      const ready = this.readyAt.get(t.id) ?? 0;
      if (now < ready) throw new GameError('rate_limited', `${t.name} daha yeni soyuldu: ${Math.ceil((ready - now) / 60_000)} dk sonra tekrar dene.`);
      const mine = this.playerReady.get(playerId) ?? 0;
      if (now < mine) throw new GameError('rate_limited', `Ortalık biraz soğusun: ${Math.ceil((mine - now) / 1000)} sn.`);
      for (const s of this.sessions.values()) if (s.targetId === t.id && s.playerId !== playerId && s.expiresAt > now) throw new GameError('conflict', 'Başka biri bu kilitle uğraşıyor.');
      const player = this.ctx.state.players.get(playerId)!;
      const picks = player.inventory[LOCKPICK_ITEM] ?? 0;
      if (picks < 1) throw new GameError('forbidden', "Maymuncuk lazım: Galeri Bulvarı'ndaki Black Market'tan al.");
      // Every bit of security left by earlier snaps makes the lock a little finer.
      const tolerance = Math.max(2.5, t.tolerance * (1 - this.securityOf(t.id, now) / 250));
      const s: LockSession = { id: newId('bl'), playerId, targetId: t.id, mode: 'door', sweet: 12 + this.ctx.rng() * 156, tolerance, expiresAt: now + B.sessionSec * 1000, lastTry: 0 };
      this.sessions.set(playerId, s);
      this.ctx.sim.markInteract(playerId);
      return { sessionId: s.id, picks, difficulty: difficulty(tolerance), name: t.name, mode: 'door' as const };
    });
  }

  /** Turn the pick (door) or the dial (safe). */
  async turn(playerId: string, params: unknown): Promise<LockpickResult & { noise: number }> {
    const p = val.obj(params);
    const sessionId = val.id(p.sessionId, 'session');
    const angle = val.num(p.angle, 'angle', 0, 180);
    return this.ctx.locks.run([K.player(playerId)], async () => {
      const s = this.sessions.get(playerId);
      const now = Date.now();
      if (!s || s.id !== sessionId) throw new GameError('not_found', 'Elinde açılan bir kilit yok.');
      if (now > s.expiresAt) {
        this.sessions.delete(playerId);
        throw new GameError('conflict', 'Çok oyalandın: kilit kapandı.');
      }
      if (now - s.lastTry < ECONOMY.theft.tryCooldownMs) throw new GameError('rate_limited', 'Yavaş - tek tek çevir.');
      s.lastTry = now;
      const t = findTarget(s.targetId)!;
      return s.mode === 'door' ? this.turnDoor(playerId, s, t, angle, now) : this.turnSafe(playerId, s, t, angle);
    });
  }

  private async turnDoor(playerId: string, s: LockSession, t: BurglaryTarget, angle: number, now: number): Promise<LockpickResult & { noise: number }> {
    this.standing(playerId, t, B.pickReach + 1.2);
    if (!this.night(now)) {
      this.sessions.delete(playerId);
      throw new GameError('conflict', "Sabah oldu: mekan açılıyor. Gece 22:00'den sonra tekrar gel.");
    }
    const turn = lockTurn(angle - s.sweet, s.tolerance);
    const uow = this.ctx.state.begin();
    const player = uow.player(playerId);
    if (turn >= 1) {
      this.sessions.delete(playerId);
      await uow.commit();
      const job = this.openJob(t, now);
      this.goIn(playerId, job);
      log.info('door picked', { playerId, target: t.id });
      return { turn: 1, opened: true, picksLeft: player.inventory[LOCKPICK_ITEM] ?? 0, failed: false, vehicleId: null, dir: 0, band: 0, noise: job.noise };
    }
    // A snapped pick: one lockpick less, and the click puts the neighbourhood on edge.
    addItem(player.inventory, LOCKPICK_ITEM, -1);
    await uow.commit();
    const left = player.inventory[LOCKPICK_ITEM] ?? 0;
    const sec = this.raiseSecurity(t.id, B.breakSecurity, now);
    const hint = lockHint(s.sweet - angle);
    this.publish(true);
    if (sec >= 100) {
      // Too much noise at the door: the neighbours call the police.
      this.sessions.delete(playerId);
      this.ringOutside(t, playerId, 'Komşular tıkırtıyı duydu ve polisi aradı!');
      return { turn, opened: false, picksLeft: left, failed: true, vehicleId: null, ...hint, noise: 100 };
    }
    if (left <= 0) {
      this.sessions.delete(playerId);
      return { turn, opened: false, picksLeft: 0, failed: true, vehicleId: null, ...hint, noise: sec };
    }
    return { turn, opened: false, picksLeft: left, failed: false, vehicleId: null, ...hint, noise: sec };
  }

  private async turnSafe(playerId: string, s: LockSession, t: BurglaryTarget, angle: number): Promise<LockpickResult & { noise: number }> {
    const job = this.jobs.get(t.id);
    if (!job || this.inside.get(playerId) !== t.id || job.safe.open) {
      this.sessions.delete(playerId);
      throw new GameError('not_found', 'Kasa artık yok.');
    }
    this.atLoot(playerId, t, this.safeSpot(t));
    const turn = lockTurn(angle - s.sweet, s.tolerance);
    if (turn >= 1) {
      this.sessions.delete(playerId);
      job.safe.open = true;
      job.taken.add('safe');
      const bag = this.bagOf(job, playerId);
      bag.cash += job.safe.cash;
      this.ctx.hub.notify(playerId, { kind: 'success', title: 'Kasa açıldı!', text: `${formatMoney(job.safe.cash)} nakit çantada. Şimdi sessizce çık.` });
      this.send(job, true);
      return { turn: 1, opened: true, picksLeft: job.safe.tries, failed: false, vehicleId: null, dir: 0, band: 0, noise: job.noise };
    }
    // A wrong turn: the bolts clank. Out of tries: the safe's own alarm.
    job.safe.tries--;
    job.noise = Math.min(100, job.noise + B.safeNoise);
    const hint = lockHint(s.sweet - angle);
    if (job.safe.tries <= 0) {
      this.sessions.delete(playerId);
      this.ring(job, 'Kasa yanlış zorlandı: kasanın alarmı çaldı!');
      return { turn, opened: false, picksLeft: 0, failed: true, vehicleId: null, ...hint, noise: 100 };
    }
    if (job.noise >= 100) this.ring(job, 'Kasayı zorlarken çok gürültü yaptın!');
    this.send(job, true);
    return { turn, opened: false, picksLeft: job.safe.tries, failed: false, vehicleId: null, ...hint, noise: job.noise };
  }

  cancel(playerId: string, params: unknown): { ok: true } {
    const p = val.obj(params);
    const sessionId = val.id(p.sessionId, 'session');
    const s = this.sessions.get(playerId);
    if (s && s.id === sessionId) this.sessions.delete(playerId);
    return { ok: true };
  }

  /** Walk in through a door someone of your crew has opened. */
  async enter(playerId: string, params: unknown): Promise<BurglaryState> {
    const p = val.obj(params);
    const t = findTarget(val.oneOf(p.targetId, 'target', TARGET_IDS))!;
    return this.ctx.locks.run([K.player(playerId), `burglary:${t.id}`], async () => {
      const now = Date.now();
      this.standing(playerId, t, B.pickReach + 0.8);
      const job = this.jobs.get(t.id);
      if (!job) throw new GameError('conflict', 'Kapı kilitli: önce maymuncukla aç.');
      if (job.alarm) throw new GameError('conflict', 'Alarm çalıyor: içeri girme!');
      this.checkOpen(playerId, t, now);
      this.goIn(playerId, job);
      return this.state(job, playerId);
    });
  }

  private openJob(t: BurglaryTarget, now: number): Job {
    const existing = this.jobs.get(t.id);
    if (existing) return existing;
    const l = layoutOf(t);
    const qty = new Map<string, number>();
    for (const spot of l.loot) {
      if (spot.kind === 'safe') continue;
      const [lo, hi] = B.qty[spot.kind];
      qty.set(spot.id, lo + Math.floor(this.ctx.rng() * (hi - lo + 1)));
    }
    const floor = this.securityOf(t.id, now);
    const job: Job = {
      target: t,
      noise: floor,
      floor,
      alarm: false,
      cause: null,
      policeAt: null,
      inside: new Set(),
      taken: new Set(),
      knocked: new Set(),
      qty,
      work: new Map(),
      safe: { tries: B.safeTries, open: false, cash: Math.round((t.cash[0] + this.ctx.rng() * (t.cash[1] - t.cash[0])) / 100) * 100 },
      bags: new Map(),
      startedAt: now,
    };
    this.jobs.set(t.id, job);
    this.security.delete(t.id);
    return job;
  }

  private goIn(playerId: string, job: Job): void {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c) return;
    const e = roomEntry(job.target);
    this.ctx.sim.teleport(playerId, e.x, e.z);
    c.rot = e.rot;
    this.inside.set(playerId, job.target.id);
    job.inside.add(playerId);
    this.playerReady.set(playerId, Date.now() + B.playerCooldownSec * 1000);
    this.send(job, true);
    this.publish(true);
  }

  // ---------------------------------------------------------------- inside

  private bagOf(job: Job, playerId: string): Bag {
    let b = job.bags.get(playerId);
    if (!b) {
      b = { cash: 0, items: {} };
      job.bags.set(playerId, b);
    }
    return b;
  }

  private safeSpot(t: BurglaryTarget): LootSpot {
    return layoutOf(t).loot.find((l) => l.kind === 'safe')!;
  }

  private jobOf(playerId: string): Job {
    const id = this.inside.get(playerId);
    const job = id ? this.jobs.get(id) : undefined;
    if (!job) throw new GameError('conflict', 'İçeride değilsin.');
    return job;
  }

  private atLoot(playerId: string, t: BurglaryTarget, spot: LootSpot): void {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c) throw new GameError('conflict', 'İçeride değilsin.');
    const s = roomPoint(t, spot.stand.x, spot.stand.z);
    const at = roomPoint(t, spot.x, spot.z);
    if (Math.hypot(c.x - s.x, c.z - s.z) > 1.3 && Math.hypot(c.x - at.x, c.z - at.z) > LOOT_REACH) throw new GameError('too_far', 'Biraz daha yaklaş.');
  }

  /** Start cracking the safe (the dial mini-game). */
  safe(playerId: string) {
    const job = this.jobOf(playerId);
    const t = job.target;
    if (job.safe.open) throw new GameError('conflict', 'Kasa zaten boş.');
    if (job.safe.tries <= 0 || job.alarm) throw new GameError('conflict', 'Kasa kilitlendi: alarm çalıyor!');
    this.atLoot(playerId, t, this.safeSpot(t));
    for (const s of this.sessions.values()) if (s.targetId === t.id && s.mode === 'safe' && s.playerId !== playerId) throw new GameError('conflict', 'Kasayla başkası uğraşıyor.');
    const tolerance = Math.max(3, t.tolerance + 1);
    const s: LockSession = { id: newId('bs'), playerId, targetId: t.id, mode: 'safe', sweet: 12 + this.ctx.rng() * 156, tolerance, expiresAt: Date.now() + B.sessionSec * 1000, lastTry: 0 };
    this.sessions.set(playerId, s);
    this.ctx.sim.markInteract(playerId);
    return { sessionId: s.id, picks: job.safe.tries, difficulty: difficulty(tolerance), name: `${t.name} · Kasa`, mode: 'safe' as const };
  }

  /** Take something off a counter / shelf (a few seconds standing there). */
  take(playerId: string, params: unknown): BurglaryState {
    const p = val.obj(params);
    const lootId = val.str(p.lootId, 'loot', 40);
    const job = this.jobOf(playerId);
    const spot = layoutOf(job.target).loot.find((l) => l.id === lootId);
    if (!spot || spot.kind === 'safe') throw new GameError('not_found', 'Orada alınacak bir şey yok.');
    if (job.taken.has(spot.id)) throw new GameError('conflict', 'Orası boş.');
    if (job.work.has(playerId)) throw new GameError('conflict', 'Elin dolu.');
    for (const w of job.work.values()) if (w.lootId === spot.id) throw new GameError('conflict', 'Onu başkası alıyor.');
    this.atLoot(playerId, job.target, spot);
    const sec = B.takeSec[spot.kind];
    job.work.set(playerId, { lootId: spot.id, until: Date.now() + sec * 1000, sec });
    this.ctx.sim.markInteract(playerId);
    this.send(job, true);
    return this.state(job, playerId);
  }

  /** Out through the front door. */
  async leave(playerId: string): Promise<{ ok: true }> {
    const job = this.jobOf(playerId);
    const c = this.ctx.sim.chars.get(playerId);
    const door = roomPoint(job.target, 0, 0);
    if (!c || Math.hypot(c.x - door.x, c.z - door.z) > EXIT_REACH + 0.6) throw new GameError('too_far', 'Çıkış kapısına git.');
    await this.goOut(playerId, job, false);
    return { ok: true };
  }

  /** Back out on the pavement; the bag is settled. */
  private async goOut(playerId: string, job: Job, police: boolean): Promise<void> {
    const t = job.target;
    this.inside.delete(playerId);
    job.inside.delete(playerId);
    job.work.delete(playerId);
    this.sent.delete(playerId);
    const s = this.sessions.get(playerId);
    if (s?.targetId === t.id) this.sessions.delete(playerId);
    const c = this.ctx.sim.chars.get(playerId);
    if (c) {
      this.ctx.sim.teleport(playerId, t.stand.x, t.stand.z);
      // Facing away from the door.
      c.rot = t.stand.rot + Math.PI;
    }
    this.ctx.hub.sendTo(playerId, 'burglary.state', null);
    const bag = job.bags.get(playerId);
    job.bags.delete(playerId);
    if (job.inside.size === 0) this.endJob(job);
    else this.send(job, true);
    this.publish(true);
    if (bagEmpty(bag)) {
      this.ctx.hub.sendTo(playerId, 'burglary.result', { targetId: t.id, cash: 0, items: {}, clean: !job.alarm, text: police ? 'Polis içeri girdi: eli boş çıktın!' : 'Eli boş çıktın.' });
      return;
    }
    if (!job.alarm) await this.pay(playerId, t, bag!);
    else {
      // With the alarm going: the bag is hot until the police lose you.
      this.hot.set(playerId, { ...bag!, targetId: t.id });
      const r: BurglaryResult = { targetId: t.id, cash: bag!.cash, items: bag!.items, clean: false, text: police ? 'POLİS İÇERİ GİRDİ! Çantayla kaç: polisi atlatana kadar ganimet sıcak.' : 'Alarm çalıyor: polisi atlatana kadar çanta sıcak (nakit kara para olur).' };
      this.ctx.hub.sendTo(playerId, 'burglary.result', r);
    }
  }

  /** Clean job: the cash is in your pocket, the goods in your inventory. */
  private async pay(playerId: string, t: BurglaryTarget, bag: Bag): Promise<void> {
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        if (bag.cash > 0) uow.credit(p, bag.cash, 'burglary', `Gece soygunu: ${t.name}`);
        for (const [id, n] of Object.entries(bag.items)) if (n) addItem(p.inventory, id, n);
        uow.grantXp(p, B.xp);
        await uow.commit();
      });
      const r: BurglaryResult = { targetId: t.id, cash: bag.cash, items: bag.items, clean: true, text: `Sessizce çıktın: ${formatMoney(bag.cash)} temiz para cebinde${Object.keys(bag.items).length ? ', mallar envanterde (Pawn Shop alır)' : ''}.` };
      this.ctx.hub.sendTo(playerId, 'burglary.result', r);
      for (const l of this.doneListeners) l(playerId, t.id, true);
      log.info('burglary clean', { playerId, target: t.id, cash: bag.cash });
    } catch (err) {
      log.error('burglary payout failed', { playerId, error: (err as Error).message });
    }
  }

  /** Lost the police: the hot bag is yours (the cash as dirty money). */
  private async cashHot(playerId: string): Promise<void> {
    const bag = this.hot.get(playerId);
    if (!bag) return;
    this.hot.delete(playerId);
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        for (const [id, n] of Object.entries(bag.items)) if (n) addItem(p.inventory, id, n);
        uow.grantXp(p, B.xp);
        this.crime.edit(uow, playerId, (s) => {
          s.dirty += bag.cash;
        });
        await this.crime.commit(uow);
      });
      this.ctx.hub.sendTo(playerId, 'burglary.cashed', { cash: bag.cash, ok: true, text: `Polisi atlattın: ${formatMoney(bag.cash)} kara para, mallar envanterde.` });
      for (const l of this.doneListeners) l(playerId, bag.targetId, false);
    } catch (err) {
      log.error('burglary hot payout failed', { playerId, error: (err as Error).message });
    }
  }

  private loseHot(playerId: string, text: string): void {
    const bag = this.hot.get(playerId);
    if (!bag) return;
    this.hot.delete(playerId);
    this.ctx.hub.sendTo(playerId, 'burglary.cashed', { cash: bag.cash, ok: false, text });
  }

  /** Someone inside without walking out (shot, logged off): out of the room, no bag. */
  private dropInside(playerId: string): void {
    const id = this.inside.get(playerId);
    const job = id ? this.jobs.get(id) : undefined;
    this.inside.delete(playerId);
    this.sessions.delete(playerId);
    this.sent.delete(playerId);
    if (!job) return;
    job.inside.delete(playerId);
    job.work.delete(playerId);
    job.bags.delete(playerId);
    this.ctx.hub.sendTo(playerId, 'burglary.state', null);
    if (job.inside.size === 0) this.endJob(job);
    this.publish(true);
  }

  private endJob(job: Job): void {
    const now = Date.now();
    this.jobs.delete(job.target.id);
    // Hit: closed for a while (the loot is back by the next night). Nothing taken: soon again.
    const hit = job.taken.size > 0 || job.alarm;
    this.readyAt.set(job.target.id, now + (hit ? B.cooldownSec : 45) * 1000);
    if (!hit && job.noise > 0) this.security.set(job.target.id, { value: job.noise, at: now });
  }

  // ---------------------------------------------------------------- the alarm

  /** The alarm goes off inside: everyone in there is wanted (2 stars), the police are 30 s out. */
  private ring(job: Job, cause: string): void {
    if (job.alarm) return;
    const now = Date.now();
    job.alarm = true;
    job.cause = cause;
    job.noise = 100;
    for (const pid of job.inside) {
      this.police.raiseHeat(pid, B.alarmHeat, 'burglary', B.policeSec);
      this.ctx.hub.notify(pid, { kind: 'warning', title: '🚨 ALARM ÇALDI!', text: `${cause} Polis ${B.policeSec} sn içinde kapıda: çantayı al ve kaç!` });
    }
    const first = [...job.inside][0];
    job.policeAt = (first && this.police.arrivalOf(first, now)) || now + B.policeSec * 1000;
    this.alarmUntil.set(job.target.id, job.policeAt + 60_000);
    // Any lock in progress in there is dropped (the safe locks itself).
    for (const [pid, s] of this.sessions) if (s.targetId === job.target.id && s.mode === 'safe') this.sessions.delete(pid);
    this.ctx.hub.broadcast('burglary.targets', this.views(now));
    this.lastTargets = '';
    this.send(job, true);
    log.info('burglary alarm', { target: job.target.id, cause });
  }

  /** The neighbours heard the picks snapping: the police come to the door (the picker is wanted). */
  private ringOutside(t: BurglaryTarget, playerId: string, cause: string): void {
    const now = Date.now();
    this.police.raiseHeat(playerId, B.alarmHeat, 'burglary', B.policeSec);
    this.alarmUntil.set(t.id, now + (B.policeSec + 60) * 1000);
    this.ctx.hub.notify(playerId, { kind: 'warning', title: '🚨 POLİS ARANDI!', text: `${cause} ${B.policeSec} sn içinde burada olurlar.` });
    this.security.set(t.id, { value: 60, at: now });
    this.readyAt.set(t.id, now + B.cooldownSec * 1000);
    this.publish(true);
  }

  // ---------------------------------------------------------------- upkeep

  forget(playerId: string): void {
    const id = this.inside.get(playerId);
    const t = id ? findTarget(id) : undefined;
    // Logged off inside: back on the pavement (the position is saved after this), bag lost.
    if (t) {
      this.dropInside(playerId);
      this.ctx.sim.teleport(playerId, t.stand.x, t.stand.z);
    }
    this.sessions.delete(playerId);
    this.hot.delete(playerId);
    this.sent.delete(playerId);
  }

  /** A saved position in a room (from an old session): out on the pavement in front of it. */
  static spawnOutside(x: number, z: number): { x: number; z: number } | null {
    if (!inInteriorZone(x, z)) return null;
    const t = roomAt(x, z) ?? BURGLARY_TARGETS[0]!;
    return { x: t.stand.x, z: t.stand.z };
  }

  tick(dt: number, now: number): void {
    for (const job of [...this.jobs.values()]) this.tickJob(job, dt, now);
    for (const [id, until] of this.alarmUntil) if (until <= now) this.alarmUntil.delete(id);
    for (const [pid, s] of this.sessions) if (now > s.expiresAt + 5000) this.sessions.delete(pid);
    this.publish();
  }

  private tickJob(job: Job, dt: number, now: number): void {
    const t = job.target;
    const l = layoutOf(t);
    let changed = false;
    for (const pid of [...job.inside]) {
      const c = this.ctx.sim.chars.get(pid);
      if (!c || c.dead) {
        this.dropInside(pid);
        continue;
      }
      // Local position in the room.
      const lx = c.x - t.room.x;
      const lz = c.z - t.room.z;
      const moving = c.gait > 0 && now - c.lastInputAt < 300;
      const running = moving && c.gait === 2;
      // The noise meter: running is loud, walking quiet, standing still lets it settle.
      if (running) job.noise += B.runNoise * dt;
      else if (moving) job.noise += B.walkNoise * dt;
      else job.noise = Math.max(job.floor, job.noise - B.quietDecay * dt);
      for (const k of l.knock) {
        if (job.knocked.has(k.id) || Math.hypot(lx - k.x, lz - k.z) > KNOCK_TOUCH) continue;
        job.knocked.add(k.id);
        job.noise += B.knockNoise * (running ? 1.5 : 1);
        changed = true;
      }
      if (!job.alarm) {
        for (const ls of l.lasers) if (cycleOn(ls, now) && segDist(lx, lz, ls.a, ls.b) < LASER_TOUCH) this.ring(job, 'Lazer ışınını kestin!');
        for (const m of l.sensors) if (moving && cycleOn(m, now) && Math.hypot(lx - m.x, lz - m.z) < m.r) this.ring(job, 'Hareket sensörü seni gördü!');
      }
      // Taking something: stay there till it's in the bag.
      const w = job.work.get(pid);
      if (w) {
        const spot = l.loot.find((x) => x.id === w.lootId)!;
        if (Math.hypot(lx - spot.stand.x, lz - spot.stand.z) > 1.7 || job.taken.has(spot.id)) {
          job.work.delete(pid);
          changed = true;
        } else if (now >= w.until) {
          job.work.delete(pid);
          job.taken.add(spot.id);
          const item = LOOT_ITEMS[spot.kind as keyof typeof LOOT_ITEMS];
          const bag = this.bagOf(job, pid);
          bag.items[item] = (bag.items[item] ?? 0) + (job.qty.get(spot.id) ?? 1);
          changed = true;
        }
      }
    }
    if (job.inside.size === 0) return;
    job.noise = Math.min(100, job.noise);
    if (!job.alarm && job.noise >= 100) this.ring(job, 'Çok gürültü yaptın: komşular uyandı!');
    if (!job.alarm && this.morning(now)) this.ring(job, 'Sabah oldu: sahibi geri döndü!');
    // The police at the door with someone still inside: they come in.
    if (job.alarm && job.policeAt !== null && now >= job.policeAt) {
      for (const pid of [...job.inside]) {
        void this.goOut(pid, job, true);
        this.police.engageNow(pid);
      }
      return;
    }
    this.send(job, changed);
  }
}

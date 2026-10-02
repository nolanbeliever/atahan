// Drag strip: two lanes, a Christmas tree (three reds, then green after a random delay), false
// starts, and a $250 entry per racer with the $500 pool going to the winner. Race a bot now, or
// wait for another player. Cars run on the normal (tuned) physics; the bot is matched to your car.

import { CATALOG_MODELS, getModel, modelDisplayName, type VehicleModel } from '../../../shared/vehicles';
import { DRAG_STRIP } from '../../../shared/highway';
import { DRAG_TIMING, type DragBotSnap, type DragInfo, type DragQueueEntry, type DragRaceView, type DragRacer, type DragResult } from '../../../shared/drag';
import { ECONOMY } from '../../../shared/economy.config';
import { emptyTuning, findPart, PERF_SLOTS, type PerfSlot, type VehicleTuning } from '../../../shared/modificationsData';
import { KEY, newVehicleDyn, stepVehicle, vehicleParams, type CollisionWorld, type VehicleDyn, type VehicleParams } from '../../../shared/physics';
import { KMH_PER_MS } from '../../../shared/drivetrain';
import { calculateVehicleStats, dropInvalidParts } from '../../../shared/tuningSystem';
import type { Vehicle, VehicleCondition } from '../../../shared/types';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { randomPersonName } from '../generator';

const log = createLogger('drag');

const PERFECT: VehicleCondition = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
const EMPTY_WORLD: CollisionWorld = { boxes: [], circles: [], dynamic: [], vehicles: [] };
const BOT_PACKAGES: string[][] = [[], ['ecu_stage1', 'intake_cai', 'exh_catback'], ['exh_downpipe', 'ecu_stage2', 'intake_cai', 'ic_fmic', 'tire_semislick']];
const BOT_COLORS = ['#d7263d', '#f7b32b', '#1b998b', '#2e294e', '#f4f4f2', '#111418', '#3a86ff', '#8338ec'];

interface Runner {
  racer: DragRacer;
  vehicleId: string | null;
  params: VehicleParams;
  model: VehicleModel;
  /** Bot state (humans are simulated by the normal input pipeline). */
  bot: { dyn: VehicleDyn; reaction: number; jump: boolean } | null;
  laneX: number;
  lastZ: number;
  lastT: number;
  launchAt: number | null;
  done: boolean;
}

interface Race {
  view: DragRaceView;
  runners: Runner[];
  createdAt: number;
  redAt: number;
  greenAt: number;
  finishedAt: number | null;
  settled: boolean;
}

/** Physics-only quarter-mile time from a standing start (used to match the bot to your car). */
export function simulateEt(params: VehicleParams): number {
  const dyn: VehicleDyn = newVehicleDyn(0, 0, Math.PI);
  const dist = DRAG_STRIP.startZ - DRAG_STRIP.finishZ;
  const dt = 1 / 30;
  for (let t = 0; t < 30; t += dt) {
    const z0 = dyn.z;
    stepVehicle(dyn, { keys: KEY.FORWARD, dt }, params, EMPTY_WORLD);
    if (-dyn.z >= dist) return t + dt * ((dist + z0) / Math.max(1e-6, z0 - dyn.z));
  }
  return 30;
}

function tuningFor(model: VehicleModel, ids: string[]): VehicleTuning | null {
  if (ids.length === 0) return null;
  const t = emptyTuning();
  for (const id of ids) {
    const part = findPart(id);
    if (part && PERF_SLOTS.includes(part.slot as PerfSlot)) t.perf[part.slot as PerfSlot] = id;
  }
  return dropInvalidParts(model, t);
}

const BOT_POOL: { model: VehicleModel; tuning: VehicleTuning | null; et: number }[] = [];
function botPool() {
  if (BOT_POOL.length > 0) return BOT_POOL;
  for (const model of CATALOG_MODELS) {
    for (const pkg of BOT_PACKAGES) {
      const tuning = tuningFor(model, pkg);
      const mods = { paint: null, wheels: 'stock', tint: 'none', bodyKit: 'none', headlights: 'stock', accessory: 'none', tuning: tuning ?? undefined };
      BOT_POOL.push({ model, tuning, et: simulateEt(vehicleParams(model, PERFECT, 100, mods)) });
    }
  }
  return BOT_POOL;
}

export class DragService {
  private queue: DragQueueEntry[] = [];
  private race: Race | null = null;
  private starting = false;
  /** A result changed since the last update was sent. */
  private dirty = false;
  private lastBroadcastLights = -1;

  constructor(private readonly ctx: Ctx) {}

  info(): DragInfo {
    const now = Date.now();
    this.queue = this.queue.filter((q) => now - q.since < ECONOMY.drag.queueTimeoutSec * 1000 && this.ctx.hub.isOnline(q.playerId));
    return { queue: [...this.queue], race: this.race?.view ?? null, entry: ECONOMY.drag.entryFee, prize: ECONOMY.drag.prize };
  }

  /** Is the player lined up for (or running) a race? */
  isRacing(playerId: string): boolean {
    return !!this.race && !this.race.settled && this.race.runners.some((r) => r.racer.playerId === playerId);
  }

  private requireRacer(playerId: string): Vehicle {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c?.drivingId) throw new GameError('conflict', 'Drive your car to the drag strip first.');
    if (!this.ctx.sim.isNearInteractable(playerId, 'drag')) throw new GameError('too_far', 'Line up at the drag strip first.');
    const v = this.ctx.state.vehicles.get(c.drivingId);
    if (!v || v.ownerId !== playerId || v.status === 'testdrive') throw new GameError('forbidden', 'You can only race your own car.');
    const p = this.ctx.state.players.get(playerId)!;
    if (p.money < ECONOMY.drag.entryFee) throw new GameError('insufficient_funds', `The entry fee is $${ECONOMY.drag.entryFee} (cash).`);
    return v;
  }

  async join(playerId: string, params: unknown): Promise<DragInfo> {
    const mode = val.oneOf(val.obj(params).mode, 'mode', ['bot', 'player'] as const);
    const v = this.requireRacer(playerId);
    if (this.starting) throw new GameError('conflict', 'The strip is busy - wait for the current race to finish.');
    if (this.race && !this.race.settled) {
      if (this.isRacing(playerId)) throw new GameError('conflict', 'You are already in a race.');
      throw new GameError('conflict', 'The strip is busy - wait for the current race to finish.');
    }
    this.info();
    this.queue = this.queue.filter((q) => q.playerId !== playerId);
    if (mode === 'bot') {
      await this.start([{ playerId, vehicle: v }]);
      return this.info();
    }
    return this.pair(playerId, v);
  }

  private async pair(playerId: string, v: Vehicle): Promise<DragInfo> {
    const opponent = this.queue.find((q) => q.playerId !== playerId);
    if (opponent) {
      const oc = this.ctx.sim.chars.get(opponent.playerId);
      const ov = oc?.drivingId ? this.ctx.state.vehicles.get(oc.drivingId) : undefined;
      if (ov && ov.ownerId === opponent.playerId && this.ctx.sim.isNearInteractable(opponent.playerId, 'drag')) {
        this.queue = this.queue.filter((q) => q.playerId !== opponent.playerId);
        await this.start([
          { playerId: opponent.playerId, vehicle: ov },
          { playerId, vehicle: v },
        ]);
        return this.info();
      }
      this.queue = this.queue.filter((q) => q.playerId !== opponent.playerId);
    }
    const p = this.ctx.state.players.get(playerId)!;
    this.queue.push({ playerId, name: p.name, modelId: v.modelId, since: Date.now() });
    this.broadcastInfo();
    return this.info();
  }

  leave(playerId: string): DragInfo {
    this.queue = this.queue.filter((q) => q.playerId !== playerId);
    this.broadcastInfo();
    return this.info();
  }

  private broadcastInfo(): void {
    for (const q of this.queue) this.ctx.hub.sendTo(q.playerId, 'drag.update', this.race?.view ?? null);
  }

  private racerFor(lane: 0 | 1, name: string, playerId: string | null, model: VehicleModel, tuning: VehicleTuning | null, color: string, bot: boolean): DragRacer {
    const stats = calculateVehicleStats(model, tuning);
    return { lane, playerId, name, modelId: model.id, color, tuning, bot, zeroTo100: stats.accel, topSpeedKmh: stats.topSpeed, hp: stats.hp, result: null };
  }

  private async start(humans: { playerId: string; vehicle: Vehicle }[]): Promise<void> {
    this.starting = true;
    try {
      const ids = humans.map((h) => h.playerId);
      await this.ctx.locks.run(ids.map((id) => K.player(id)), async () => {
        const uow = this.ctx.state.begin();
        for (const h of humans) uow.debit(uow.player(h.playerId), ECONOMY.drag.entryFee, 'drag_entry', `Drag strip entry: ${modelDisplayName(h.vehicle.modelId)}`, h.vehicle.id);
        await uow.commit();
      });
      await this.clearStrip();
      this.launch(humans);
    } finally {
      this.starting = false;
    }
  }

  /** Cars left parked on the strip are towed back to their owners' garages. */
  private async clearStrip(): Promise<void> {
    const d = DRAG_STRIP;
    const parked = [...this.ctx.state.vehicles.values()].filter(
      (v) => v.status === 'world' && !this.ctx.sim.isDriven(v.id) && v.x > d.wallX[0] && v.x < d.wallX[1] && v.z > d.wallZ[0] && v.z < d.wallZ[1] + 4,
    );
    for (const v of parked) {
      const owner = v.ownerId;
      await this.ctx.locks.run([K.vehicle(v.id), ...(owner ? [K.player(owner)] : [])], async () => {
        const live = this.ctx.state.vehicles.get(v.id);
        if (!live || live.status !== 'world' || this.ctx.sim.isDriven(v.id)) return;
        const uow = this.ctx.state.begin();
        uow.vehicle(v.id).status = 'stored';
        if (owner) uow.notify(owner, { kind: 'info', title: 'Towed', text: `Your ${modelDisplayName(v.modelId)} was parked on the drag strip and has been towed to your garage.` }, true, (id) => this.ctx.hub.isOnline(id));
        await uow.commit();
      });
    }
    if (parked.length > 0) this.ctx.sim.rebuildDynamic();
  }

  private launch(humans: { playerId: string; vehicle: Vehicle }[]): void {
    const now = Date.now();
    const runners: Runner[] = [];
    humans.forEach((h, i) => {
      const lane = i as 0 | 1;
      const model = getModel(h.vehicle.modelId);
      const p = this.ctx.state.players.get(h.playerId)!;
      const racer = this.racerFor(lane, p.name, h.playerId, model, h.vehicle.mods.tuning ?? null, h.vehicle.color, false);
      const params = vehicleParams(model, h.vehicle.condition, h.vehicle.fuel, h.vehicle.mods);
      runners.push({ racer, vehicleId: h.vehicle.id, params, model, bot: null, laneX: DRAG_STRIP.laneX[lane], lastZ: 0, lastT: now, launchAt: null, done: false });
    });
    if (humans.length === 1) {
      const target = simulateEt(runners[0]!.params);
      const pool = botPool();
      // A close match: a car within a few percent of yours, sometimes a touch quicker or slower.
      const close = pool.filter((b) => Math.abs(b.et / target - 1) < 0.045);
      const pick = close.length > 0 ? close[Math.floor(this.ctx.rng() * close.length)]! : pool.reduce((a, b) => (Math.abs(b.et - target) < Math.abs(a.et - target) ? b : a));
      const color = BOT_COLORS[Math.floor(this.ctx.rng() * BOT_COLORS.length)]!;
      const racer = this.racerFor(1, `${randomPersonName(this.ctx.rng).split(' ')[0]} (Bot)`, null, pick.model, pick.tuning, color, true);
      const mods = { paint: null, wheels: 'stock', tint: 'none', bodyKit: 'none', headlights: 'stock', accessory: 'none', tuning: pick.tuning ?? undefined };
      const params = vehicleParams(pick.model, PERFECT, 100, mods);
      const laneX = DRAG_STRIP.laneX[1];
      const dyn: VehicleDyn = newVehicleDyn(laneX, DRAG_STRIP.startZ + pick.model.shape.length / 2, DRAG_STRIP.yaw);
      const reaction = 0.16 + this.ctx.rng() * 0.3;
      runners.push({ racer, vehicleId: null, params, model: pick.model, bot: { dyn, reaction, jump: this.ctx.rng() < 0.03 }, laneX, lastZ: dyn.z, lastT: now, launchAt: null, done: false });
    }
    const t = DRAG_TIMING;
    const redAt = now + t.staging * 1000;
    // Red 1, 2, 3 one step apart, then green after a random delay (no anticipating it).
    const greenAt = redAt + 2 * t.redStep * 1000 + (t.greenDelay[0] + this.ctx.rng() * (t.greenDelay[1] - t.greenDelay[0])) * 1000;
    const race: Race = {
      view: {
        id: newId('drag'),
        phase: 'staging',
        lights: 0,
        greenAt: null,
        racers: runners.map((r) => r.racer),
        winner: null,
        entry: ECONOMY.drag.entryFee,
        pool: ECONOMY.drag.prize,
      },
      runners,
      createdAt: now,
      redAt,
      greenAt,
      finishedAt: null,
      settled: false,
    };
    // Line the cars up at the start and hold them there while staging.
    for (const r of runners) {
      if (!r.vehicleId) continue;
      const z = DRAG_STRIP.startZ + r.model.shape.length / 2;
      this.ctx.sim.placeDrive(r.vehicleId, r.laneX, z, DRAG_STRIP.yaw);
      const d = this.ctx.sim.drives.get(r.vehicleId);
      if (d) d.hold = true;
      r.lastZ = z;
    }
    this.race = race;
    this.lastBroadcastLights = -1;
    this.syncBots();
    this.publish();
    log.info('drag race started', { id: race.view.id, racers: runners.map((r) => r.racer.name) });
  }

  private publish(): void {
    if (!this.race) return;
    const view = this.race.view;
    // Racers and everyone near the strip see the race.
    for (const [id, c] of this.ctx.sim.chars) {
      const racing = view.racers.some((r) => r.playerId === id);
      if (racing || Math.hypot(c.x - DRAG_STRIP.stage.x, c.z - (DRAG_STRIP.startZ + DRAG_STRIP.finishZ) / 2) < 320) this.ctx.hub.sendTo(id, 'drag.update', view);
    }
  }

  private syncBots(): void {
    const bots = this.race?.runners.filter((r) => r.bot) ?? [];
    this.ctx.sim.setExtraObstacles('drag', bots.map((r) => ({ id: `drag-bot-${r.racer.lane}`, modelId: r.model.id, x: r.bot!.dyn.x, z: r.bot!.dyn.z, rot: r.bot!.dyn.rot })));
  }

  /** Front bumper position along the strip and the speedometer reading of a runner. */
  private sample(r: Runner): { x: number; z: number; speed: number; present: boolean } {
    if (r.bot) return { x: r.bot.dyn.x, z: r.bot.dyn.z - r.model.shape.length / 2, speed: r.bot.dyn.speed, present: true };
    const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
    if (!d || d.playerId !== r.racer.playerId) return { x: 0, z: 0, speed: 0, present: false };
    return { x: d.dyn.x, z: d.dyn.z + (Math.cos(d.dyn.rot) * r.model.shape.length) / 2, speed: d.dyn.speed, present: true };
  }

  private setResult(r: Runner, result: DragResult): void {
    r.racer.result = result;
    r.done = true;
    this.dirty = true;
  }

  tick(dt: number): void {
    const race = this.race;
    if (!race) return;
    const now = Date.now();
    const view = race.view;
    if (race.settled) {
      if (race.finishedAt && now - race.finishedAt > DRAG_TIMING.results * 1000) {
        this.race = null;
        this.ctx.sim.setExtraObstacles('drag', []);
        for (const [id] of this.ctx.sim.chars) this.ctx.hub.sendTo(id, 'drag.update', null);
      }
      return;
    }
    // Lights.
    let lights = 0;
    if (now >= race.greenAt) lights = 4;
    else if (now >= race.redAt) lights = Math.min(3, 1 + Math.floor((now - race.redAt) / (DRAG_TIMING.redStep * 1000)));
    if (view.phase === 'staging' && now >= race.redAt) {
      view.phase = 'countdown';
      for (const r of race.runners) {
        const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
        if (d) d.hold = false;
      }
    }
    if (lights === 4 && view.phase !== 'racing') {
      view.phase = 'racing';
      view.greenAt = race.greenAt;
    }
    view.lights = lights;

    const startLine = DRAG_STRIP.startZ;
    const finish = DRAG_STRIP.finishZ;
    for (const r of race.runners) {
      if (r.done) continue;
      // The bot drives itself: brakes held until its reaction time after green (or a jump start).
      if (r.bot) {
        const go = r.bot.jump ? now >= race.greenAt - 250 : now >= race.greenAt + r.bot.reaction * 1000;
        const keys = go ? KEY.FORWARD : KEY.BRAKE;
        let left = dt;
        while (left > 1e-6) {
          const step = Math.min(1 / 30, left);
          stepVehicle(r.bot.dyn, { keys, dt: step }, r.params, EMPTY_WORLD);
          r.bot.dyn.x = r.laneX;
          r.bot.dyn.rot = DRAG_STRIP.yaw;
          left -= step;
        }
      }
      const s = this.sample(r);
      if (!s.present) {
        this.setResult(r, { outcome: 'dnf', reaction: null, et: null, total: null, trapKmh: null });
        continue;
      }
      const front = s.z;
      if (view.phase !== 'racing') {
        if (view.phase === 'countdown' && front < startLine - DRAG_TIMING.falseStartDist) {
          this.setResult(r, { outcome: 'false_start', reaction: (now - race.greenAt) / 1000, et: null, total: null, trapKmh: null });
        }
        r.lastZ = front;
        r.lastT = now;
        continue;
      }
      if (Math.abs(s.x - r.laneX) > DRAG_TIMING.laneTolerance) {
        this.setResult(r, { outcome: 'dq', reaction: null, et: null, total: null, trapKmh: null });
        continue;
      }
      if (r.launchAt === null && front < startLine - 0.3) {
        // Interpolate the moment it broke the beam.
        const f = (r.lastZ - (startLine - 0.3)) / Math.max(1e-6, r.lastZ - front);
        r.launchAt = r.lastT + (now - r.lastT) * Math.min(1, Math.max(0, f));
      }
      if (front <= finish && r.lastZ > finish) {
        const f = (r.lastZ - finish) / Math.max(1e-6, r.lastZ - front);
        const at = r.lastT + (now - r.lastT) * f;
        const launch = r.launchAt ?? race.greenAt;
        const reaction = Math.max(0, (launch - race.greenAt) / 1000);
        const et = (at - launch) / 1000;
        this.setResult(r, {
          outcome: 'finished',
          reaction: Math.round(reaction * 1000) / 1000,
          et: Math.round(et * 1000) / 1000,
          total: Math.round((at - race.greenAt)) / 1000,
          trapKmh: Math.round(Math.abs(s.speed) * KMH_PER_MS),
        });
      } else if (now - race.greenAt > DRAG_TIMING.timeout * 1000) {
        this.setResult(r, { outcome: 'dnf', reaction: null, et: null, total: null, trapKmh: null });
      }
      r.lastZ = front;
      r.lastT = now;
    }
    this.syncBots();

    // Everyone done (or a clean finisher against a fouled opponent) -> settle.
    const allDone = race.runners.every((r) => r.done);
    if (allDone) this.settle(race);
    if (lights !== this.lastBroadcastLights || allDone || this.dirty) {
      this.lastBroadcastLights = lights;
      this.dirty = false;
      this.publish();
    }
  }

  /** Bot positions for snapshots (players near the strip see the bot drive). */
  botSnapshot(): { id: string; cars: DragBotSnap[] } | null {
    const race = this.race;
    if (!race) return null;
    const cars: DragBotSnap[] = race.runners.filter((r) => r.bot).map((r) => [r.racer.lane, Math.round(r.bot!.dyn.z * 100) / 100, Math.round(r.bot!.dyn.speed * 100) / 100]);
    return cars.length > 0 ? { id: race.view.id, cars } : null;
  }

  /** Decide the winner and pay the pool (entries were taken at the start). */
  private settle(race: Race): void {
    race.settled = true;
    race.finishedAt = Date.now();
    race.view.phase = 'finished';
    const finishers = race.runners.filter((r) => r.racer.result?.outcome === 'finished');
    finishers.sort((a, b) => a.racer.result!.total! - b.racer.result!.total!);
    const best = finishers[0];
    const tie = finishers.length > 1 && Math.abs(finishers[1]!.racer.result!.total! - best!.racer.result!.total!) < 0.0005;
    race.view.winner = best && !tie ? best.racer.lane : null;
    for (const r of race.runners) {
      if (!r.vehicleId) continue;
      const d = this.ctx.sim.drives.get(r.vehicleId);
      if (d) d.hold = false;
    }
    const humans = race.runners.filter((r) => r.racer.playerId);
    void this.ctx.locks
      .run(humans.map((r) => K.player(r.racer.playerId!)), async () => {
        const uow = this.ctx.state.begin();
        for (const r of humans) {
          const pid = r.racer.playerId!;
          if (!this.ctx.state.players.has(pid)) continue;
          const p = uow.player(pid);
          if (tie && r.racer.result?.outcome === 'finished') {
            uow.credit(p, ECONOMY.drag.entryFee, 'drag_refund', 'Drag race tie - entry refunded');
          } else if (race.view.winner === r.racer.lane) {
            uow.credit(p, ECONOMY.drag.prize, 'drag_win', `Won a drag race (${r.racer.result!.total!.toFixed(3)} s)`);
            uow.grantXp(p, ECONOMY.drag.xpWin);
          } else uow.grantXp(p, ECONOMY.drag.xpRace);
        }
        await uow.commit();
      })
      .catch((err) => log.error('drag payout failed', { error: (err as Error).message }));
    log.info('drag race finished', { id: race.view.id, winner: race.view.winner, results: race.runners.map((r) => r.racer.result) });
  }

  /** A player left: drop them from the queue (an active race marks them DNF on the next tick). */
  forget(playerId: string): void {
    this.queue = this.queue.filter((q) => q.playerId !== playerId);
  }
}

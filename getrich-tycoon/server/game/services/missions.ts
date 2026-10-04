// Daily missions: progress from game events (near misses, crashes, speed, sales, drag wins,
// police escapes, distance), automatic rewards, a timed "rush sale" mission the player starts from
// the missions panel. State is one JSON document per player (player_missions table).

import { KMH_PER_MS } from '../../../shared/drivetrain';
import { ECONOMY } from '../../../shared/economy.config';
import {
  dayIndex,
  findMission,
  missionViews,
  newMissionState,
  normalizeMissionState,
  rewardLabel,
  type MissionDef,
  type MissionProgress,
  type MissionState,
  type MissionView,
} from '../../../shared/missions';
import type { Transaction } from '../../../shared/types';
import * as repo from '../../db/repo';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';

const log = createLogger('missions');

const SALE_KINDS = new Set(['quick_sell', 'customer_sale', 'player_sale', 'auction_sale']);

export class MissionService {
  private states = new Map<string, MissionState>();
  private dirty = new Set<string>();
  /** Seconds spent at or above a hold_speed mission's speed (per player). */
  private holding = new Map<string, number>();
  /** Last crash seen per player (DriveState.crashAt). */
  private crashes = new Map<string, number>();

  constructor(private readonly ctx: Ctx) {}

  /** Load a player's missions when they connect. */
  async load(playerId: string): Promise<void> {
    const now = Date.now();
    let raw: unknown = null;
    try {
      raw = await repo.loadMissions(this.ctx.state.db, playerId);
    } catch (err) {
      log.error('loading missions failed', { playerId, error: (err as Error).message });
    }
    this.states.set(playerId, normalizeMissionState(raw, playerId, now));
    this.send(playerId);
  }

  async forget(playerId: string): Promise<void> {
    await this.save(playerId);
    this.states.delete(playerId);
    this.holding.delete(playerId);
    this.crashes.delete(playerId);
  }

  private state(playerId: string, now = Date.now()): MissionState | null {
    let s = this.states.get(playerId);
    if (!s) return null;
    if (s.day !== dayIndex(now)) {
      s = newMissionState(playerId, now);
      this.states.set(playerId, s);
      this.dirty.add(playerId);
      this.send(playerId);
    }
    return s;
  }

  views(playerId: string): MissionView[] {
    const s = this.state(playerId);
    return s ? missionViews(s) : [];
  }

  private send(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'missions.update', { missions: this.views(playerId) });
  }

  list(playerId: string): { missions: MissionView[] } {
    return { missions: this.views(playerId) };
  }

  /** Start a timed mission (the clock runs from now). */
  async start(playerId: string, params: unknown): Promise<{ missions: MissionView[] }> {
    const id = val.id(val.obj(params).id, 'mission');
    const now = Date.now();
    const s = this.state(playerId, now);
    const m = s?.list.find((x) => x.id === id);
    const def = findMission(id);
    if (!s || !m || !def) throw new GameError('not_found', 'That mission is not available today.');
    if (!def.timeLimitSec) throw new GameError('bad_request', 'This mission has no timer - it runs all day.');
    if (m.done) throw new GameError('conflict', 'Already completed today.');
    if (m.startedAt !== null) throw new GameError('conflict', 'The clock is already running.');
    if (now < m.cooldownUntil) throw new GameError('conflict', `Try again in ${Math.ceil((m.cooldownUntil - now) / 1000)} s.`);
    m.startedAt = now;
    m.progress = 0;
    this.dirty.add(playerId);
    await this.save(playerId);
    this.send(playerId);
    return this.list(playerId);
  }

  // ---------------------------------------------------------------- events

  private each(playerId: string, kind: MissionDef['kind'], fn: (m: MissionProgress, def: MissionDef) => number | null): void {
    const s = this.state(playerId);
    if (!s) return;
    let changed = false;
    for (const m of s.list) {
      const def = findMission(m.id);
      if (!def || def.kind !== kind || m.done) continue;
      const next = fn(m, def);
      if (next === null || next === m.progress) continue;
      m.progress = Math.max(0, next);
      changed = true;
      if (m.progress >= def.target) void this.complete(playerId, m, def);
    }
    if (changed) {
      this.dirty.add(playerId);
      this.send(playerId);
    }
  }

  onNearMiss(playerId: string, e: { kmh: number; combo: number }): void {
    this.each(playerId, 'nearmiss_clean', (m) => m.progress + 1);
    this.each(playerId, 'nearmiss_fast', (m, def) => (e.kmh >= (def.param ?? 0) ? m.progress + 1 : null));
    this.each(playerId, 'combo', (m) => Math.max(m.progress, e.combo));
  }

  /** A crash ends a clean near-miss streak. */
  onCrash(playerId: string): void {
    this.each(playerId, 'nearmiss_clean', () => 0);
  }

  onEscape(playerId: string): void {
    this.each(playerId, 'escape_police', (m) => m.progress + 1);
  }

  onDistance(playerId: string, metres: number): void {
    const km = metres * ECONOMY.world.mileageScale;
    if (km <= 0) return;
    this.each(playerId, 'drive_km', (m) => Math.round((m.progress + km) * 1000) / 1000);
  }

  onTransactions(txs: readonly Transaction[]): void {
    const now = Date.now();
    for (const t of txs) {
      if (SALE_KINDS.has(t.kind) && t.amount > 0) {
        this.each(t.playerId, 'sell_timed', (m, def) => (m.startedAt !== null && now <= m.startedAt + (def.timeLimitSec ?? 0) * 1000 ? m.progress + 1 : null));
      } else if (t.kind === 'drag_win') this.each(t.playerId, 'drag_win', (m) => m.progress + 1);
    }
  }

  /** Every simulation tick: speed holds, crashes. */
  tickFast(dt: number): void {
    for (const d of this.ctx.sim.drives.values()) {
      const s = this.states.get(d.playerId);
      if (!s) continue;
      if (d.crashAt > (this.crashes.get(d.playerId) ?? 0)) {
        this.crashes.set(d.playerId, d.crashAt);
        this.onCrash(d.playerId);
      }
      const kmh = Math.abs(d.dyn.speed) * KMH_PER_MS;
      const hold = s.list.find((m) => !m.done && findMission(m.id)?.kind === 'hold_speed');
      if (!hold) continue;
      const def = findMission(hold.id)!;
      const t = kmh >= (def.param ?? Infinity) ? (this.holding.get(d.playerId) ?? 0) + dt : 0;
      this.holding.set(d.playerId, t);
      const whole = Math.min(def.target, Math.floor(t));
      if (whole !== hold.progress && (whole > hold.progress || whole === 0)) this.each(d.playerId, 'hold_speed', () => whole);
    }
  }

  /** Once a second: timed missions that ran out, day changes, saving. */
  async tick(now = Date.now()): Promise<void> {
    for (const [playerId] of this.states) {
      const s = this.state(playerId, now);
      if (!s) continue;
      for (const m of s.list) {
        const def = findMission(m.id);
        if (!def?.timeLimitSec || m.done || m.startedAt === null) continue;
        if (now > m.startedAt + def.timeLimitSec * 1000) {
          m.startedAt = null;
          m.progress = 0;
          m.cooldownUntil = now + ECONOMY.missions.timedCooldownSec * 1000;
          this.dirty.add(playerId);
          this.ctx.hub.notify(playerId, { kind: 'warning', title: "Time's up", text: `${def.title}: the clock ran out. You can try again in ${Math.round(ECONOMY.missions.timedCooldownSec / 60)} minutes.` });
          this.send(playerId);
        }
      }
    }
    for (const id of [...this.dirty]) await this.save(id);
  }

  private async save(playerId: string): Promise<void> {
    const s = this.states.get(playerId);
    if (!s || !this.dirty.has(playerId)) return;
    this.dirty.delete(playerId);
    try {
      await repo.saveMissions(this.ctx.state.db, playerId, s, Date.now());
    } catch (err) {
      this.dirty.add(playerId);
      log.error('saving missions failed', { playerId, error: (err as Error).message });
    }
  }

  /** Mark done (saved first, so a reward can never be paid twice), then pay the reward. */
  private async complete(playerId: string, m: MissionProgress, def: MissionDef): Promise<void> {
    if (m.done) return;
    m.done = true;
    m.startedAt = null;
    this.dirty.add(playerId);
    await this.save(playerId);
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        const r = def.reward;
        if (r.money) uow.credit(p, r.money, 'mission', `Mission complete: ${def.title}`);
        if (r.xp) uow.grantXp(p, r.xp);
        if (r.item) p.inventory[r.item.id] = (p.inventory[r.item.id] ?? 0) + r.item.qty;
        await uow.commit();
      });
      this.ctx.hub.sendTo(playerId, 'missions.complete', { id: def.id, title: def.title, reward: rewardLabel(def.reward) });
      this.send(playerId);
    } catch (err) {
      log.error('mission reward failed', { playerId, mission: def.id, error: (err as Error).message });
    }
  }
}

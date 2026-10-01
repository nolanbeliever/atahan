// Daily login streak and playtime milestones (see shared/rewards.ts for the rules).
//
// The state is one JSON document per player (player_rewards). Playtime counts once a second while the
// player is online and active (pressed a key, turned the camera or used a menu in the last couple of
// minutes, or rides along in a moving car), up to three hours a day. A claim and its payout are written in one transaction, so a reward is never paid twice.

import { ECONOMY } from '../../../shared/economy.config';
import { DEFAULT_MODS } from '../../../shared/customization';
import { modelsOfTier } from '../../../shared/rareMarket';
import {
  DAILY_REWARDS,
  PLAYTIME_CAP_SEC,
  PLAYTIME_MILESTONES,
  bundleLabel,
  nextDailyDay,
  normalizeRewardState,
  rewardsView,
  rollPlaytimeDay,
  type MegaChoice,
  type RewardBundle,
  type RewardItem,
  type RewardState,
  type RewardsView,
} from '../../../shared/rewards';
import { dayIndex } from '../../../shared/missions';
import type { Vehicle } from '../../../shared/types';
import { mulberry32 } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import * as repo from '../../db/repo';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { generateCondition } from '../generator';
import type { UnitOfWork } from '../state';

const log = createLogger('rewards');
const SAVE_EVERY_MS = 30_000;
const SYNC_EVERY_MS = 30_000;

export class RewardService {
  private states = new Map<string, RewardState>();
  private lastSaved = new Map<string, number>();
  private lastSync = new Map<string, number>();
  private lastTick = Date.now();

  constructor(private readonly ctx: Ctx) {}

  async load(playerId: string): Promise<void> {
    const now = Date.now();
    let raw: unknown = null;
    try {
      raw = await repo.loadRewards(this.ctx.state.db, playerId);
    } catch (err) {
      log.error('loading rewards failed', { playerId, error: (err as Error).message });
    }
    this.states.set(playerId, normalizeRewardState(raw, now));
    this.lastSaved.set(playerId, now);
    this.send(playerId);
  }

  async forget(playerId: string): Promise<void> {
    await this.save(playerId);
    this.states.delete(playerId);
    this.lastSaved.delete(playerId);
    this.lastSync.delete(playerId);
  }

  private state(playerId: string, now = Date.now()): RewardState {
    const s = this.states.get(playerId);
    if (!s) throw new GameError('conflict', 'Rewards are still loading.');
    if (rollPlaytimeDay(s, now)) this.send(playerId);
    return s;
  }

  view(playerId: string): RewardsView {
    return rewardsView(this.state(playerId), Date.now());
  }

  private send(playerId: string): void {
    const s = this.states.get(playerId);
    if (!s) return;
    this.lastSync.set(playerId, Date.now());
    this.ctx.hub.sendTo(playerId, 'rewards.update', rewardsView(s, Date.now()));
  }

  private async save(playerId: string): Promise<void> {
    const s = this.states.get(playerId);
    if (!s) return;
    try {
      await repo.saveRewards(this.ctx.state.db, playerId, s, Date.now());
      this.lastSaved.set(playerId, Date.now());
    } catch (err) {
      log.error('saving rewards failed', { playerId, error: (err as Error).message });
    }
  }

  /** Once a second: count active playtime, tell players when a milestone is ready, save now and then. */
  async tick(now = Date.now()): Promise<void> {
    const dt = Math.min(5, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    for (const [playerId, s] of this.states) {
      if (rollPlaytimeDay(s, now)) this.send(playerId);
      const c = this.ctx.sim.chars.get(playerId);
      if (!c || !this.ctx.hub.isOnline(playerId)) continue;
      // Active: pressed a key, moved the camera or used a menu lately, or rides along in a moving car.
      const carried = c.ridingId ? this.ctx.sim.drives.get(c.ridingId) : undefined;
      const active = now - c.activeAt < ECONOMY.rewards.activeTimeoutSec * 1000 || Math.abs(carried?.dyn.speed ?? 0) > 1;
      if (active && s.seconds < PLAYTIME_CAP_SEC) {
        const before = s.seconds;
        s.seconds = Math.min(PLAYTIME_CAP_SEC, s.seconds + dt);
        const reached = PLAYTIME_MILESTONES.find((m) => before < m.minutes * 60 && s.seconds >= m.minutes * 60);
        if (reached) {
          this.ctx.hub.notify(playerId, { kind: 'achievement', title: 'Ödül hazır!', text: `${reached.minutes} dakika oynadın: ${reached.title}. Hediye kutusuna tıkla.` });
          this.send(playerId);
        }
      }
      if (now - (this.lastSync.get(playerId) ?? 0) > SYNC_EVERY_MS) this.send(playerId);
      if (now - (this.lastSaved.get(playerId) ?? 0) > SAVE_EVERY_MS) await this.save(playerId);
    }
  }

  // ---------------------------------------------------------------- claims

  /** Today's box of the 7-day streak. */
  async claimDaily(playerId: string): Promise<{ day: number; reward: string; view: RewardsView }> {
    return this.ctx.locks.run([K.player(playerId)], async () => {
      const now = Date.now();
      const s = this.state(playerId, now);
      const day = nextDailyDay(s, now);
      if (day === null) throw new GameError('conflict', 'Bugünün ödülünü zaten aldın. Yarın tekrar gel!');
      const def = DAILY_REWARDS[day - 1]!;
      const next: RewardState = { ...s, streak: day, lastClaimDay: dayIndex(now) };
      const uow = this.ctx.state.begin();
      const carName = this.pay(uow, playerId, def.reward, [], `Günlük ödül: ${day}. gün`);
      uow.setRewardState(playerId, next);
      await uow.commit();
      this.states.set(playerId, next);
      this.lastSaved.set(playerId, now);
      // The client shows the reward itself (confetti and a banner).
      const label = bundleLabel(def.reward) + (carName ? ` (${carName})` : '');
      if (def.reward.legendaryCar && carName) {
        const name = this.ctx.state.players.get(playerId)?.name ?? 'Someone';
        this.ctx.hub.systemChat(`${name} won a legendary ${carName} with a 7-day login streak!`);
      }
      this.send(playerId);
      return { day, reward: label, view: this.view(playerId) };
    });
  }

  /** A playtime milestone (the 3-hour one needs the extra chosen). */
  async claimPlaytime(playerId: string, params: unknown): Promise<{ minutes: number; reward: string; view: RewardsView }> {
    const p = val.obj(params);
    const minutes = val.int(p.minutes, 'milestone', 1, 1000);
    const choice = p.choice === undefined || p.choice === null ? null : val.oneOf(p.choice, 'choice', ['pawn', 'rims'] as const);
    return this.ctx.locks.run([K.player(playerId)], async () => {
      const now = Date.now();
      const s = this.state(playerId, now);
      const m = PLAYTIME_MILESTONES.find((x) => x.minutes === minutes);
      if (!m) throw new GameError('bad_request', 'No such milestone.');
      if (s.claimed.includes(minutes)) throw new GameError('conflict', 'Bu ödülü bugün zaten aldın.');
      if (s.seconds < minutes * 60) throw new GameError('conflict', `${minutes} dakika oynamadan alınamaz.`);
      let extra: RewardItem[] = [];
      if (m.choice) {
        if (!choice) throw new GameError('bad_request', 'Choose your mega reward.');
        extra = m.choice[choice as MegaChoice].items;
      }
      const next: RewardState = { ...s, claimed: [...s.claimed, minutes] };
      const uow = this.ctx.state.begin();
      this.pay(uow, playerId, m.reward, extra, `Oynama ödülü: ${minutes} dk`);
      uow.setRewardState(playerId, next);
      await uow.commit();
      this.states.set(playerId, next);
      this.lastSaved.set(playerId, now);
      const label = bundleLabel(m.reward, extra);
      this.send(playerId);
      return { minutes, reward: label, view: this.view(playerId) };
    });
  }

  /** Pay a reward into a unit of work; returns the name of a car given, if any. */
  private pay(uow: UnitOfWork, playerId: string, r: RewardBundle, extra: RewardItem[], note: string): string | null {
    const p = uow.player(playerId);
    if (r.money) uow.credit(p, r.money, 'reward', note);
    if (r.xp) uow.grantXp(p, r.xp);
    for (const it of [...(r.items ?? []), ...extra]) p.inventory[it.id] = (p.inventory[it.id] ?? 0) + it.qty;
    if (!r.legendaryCar) return null;
    const v = this.legendaryCar(playerId, uow.now);
    uow.createVehicle(v);
    return modelDisplayName(v.modelId);
  }

  /** A legendary car from the Rare Dealer's pool, nearly new, waiting in the garage. */
  private legendaryCar(playerId: string, now: number): Vehicle {
    const rng = mulberry32((now ^ playerId.length * 2654435761) >>> 0);
    const pool = modelsOfTier('legendary').filter((m) => m.specs.kind !== 'bike');
    const model = pool[Math.floor(rng() * pool.length)]!;
    const condition = generateCondition(rng, 97);
    for (const k of Object.keys(condition) as (keyof typeof condition)[]) condition[k] = Math.max(92, condition[k]);
    return {
      id: newId('veh'),
      modelId: model.id,
      ownerId: playerId,
      color: model.colors[Math.floor(rng() * model.colors.length)]!,
      mileage: Math.round(500 + rng() * 4_000),
      fuel: 100,
      condition,
      mods: { ...DEFAULT_MODS },
      status: 'stored',
      purchasePrice: 0,
      salePrice: null,
      plotId: null,
      slot: null,
      rotation: 0,
      x: 0,
      z: 0,
      serviceUntil: 0,
      createdAt: now,
    };
  }
}

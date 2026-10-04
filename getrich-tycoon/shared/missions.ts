// Missions: a daily set (the same for a player all day, new at 00:00 UTC) of short goals with
// automatic rewards - cash, XP or items such as a free Stage 1 ECU remap coupon. Pure data and
// helpers shared by the server (progress, rewards) and the client (the missions panel).

import { ECONOMY } from './economy.config';

export type MissionKind =
  /** N near misses in a row without crashing. */
  | 'nearmiss_clean'
  /** Hold at least `param` km/h for `target` seconds. */
  | 'hold_speed'
  /** Sell `target` vehicles within `timeLimitSec` after starting the mission. */
  | 'sell_timed'
  /** Drive `target` km (odometer). */
  | 'drive_km'
  /** Escape a police pursuit `target` times. */
  | 'escape_police'
  /** Win `target` drag races. */
  | 'drag_win'
  /** `target` near misses at `param` km/h or more. */
  | 'nearmiss_fast'
  /** Reach a combo of `target` near misses. */
  | 'combo';

export interface MissionReward {
  money?: number;
  xp?: number;
  item?: { id: string; qty: number; label: string };
}

export interface MissionDef {
  id: string;
  kind: MissionKind;
  title: string;
  description: string;
  target: number;
  param?: number;
  /** Timed missions must be started and finished within this many seconds. */
  timeLimitSec?: number;
  reward: MissionReward;
  /** Always part of the daily set. */
  core?: boolean;
}

/** Inventory item: the next Stage 1 ECU remap is free. */
export const ECU_COUPON = 'coupon_ecu_stage1';

export const MISSIONS: MissionDef[] = [
  { id: 'clean10', kind: 'nearmiss_clean', title: 'Clean Sweep', description: 'Make 10 near misses on the highway without crashing.', target: 10, reward: { money: 2_500 }, core: true },
  {
    id: 'hold250',
    kind: 'hold_speed',
    title: 'Flat Out',
    description: 'Reach 250 km/h and hold it for 5 seconds.',
    target: 5,
    param: 250,
    reward: { item: { id: ECU_COUPON, qty: 1, label: 'Stage 1 ECU coupon' } },
    core: true,
  },
  { id: 'sell2', kind: 'sell_timed', title: 'Rush Sale', description: 'Sell 2 vehicles within 120 seconds.', target: 2, timeLimitSec: 120, reward: { money: 5_000, xp: 100 }, core: true },
  { id: 'drive20', kind: 'drive_km', title: 'Road Trip', description: 'Drive 20 km.', target: 20, reward: { money: 1_000, xp: 30 } },
  { id: 'escape1', kind: 'escape_police', title: 'Getaway Driver', description: 'Escape a police pursuit.', target: 1, reward: { money: 2_000, xp: 60 } },
  { id: 'drag1', kind: 'drag_win', title: 'Christmas Tree', description: 'Win a drag race.', target: 1, reward: { money: 1_500, xp: 40 } },
  { id: 'fast5', kind: 'nearmiss_fast', title: 'Hair-Raiser', description: 'Make 5 near misses above 200 km/h.', target: 5, param: 200, reward: { money: 2_000, xp: 50 } },
  { id: 'combo20', kind: 'combo', title: 'Unstoppable', description: 'Build a combo of 20 near misses.', target: 20, reward: { money: 6_000, xp: 120 } },
];

const INDEX = new Map(MISSIONS.map((m) => [m.id, m]));

export function findMission(id: string): MissionDef | undefined {
  return INDEX.get(id);
}

export const DAY_MS = 86_400_000;

export function dayIndex(now: number): number {
  return Math.floor(now / DAY_MS);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The day's missions for a player: the core ones plus a few picked for them. */
export function dailyMissionIds(playerId: string, day: number): string[] {
  const core = MISSIONS.filter((m) => m.core).map((m) => m.id);
  const extra = MISSIONS.filter((m) => !m.core).map((m) => m.id);
  const want = Math.max(0, ECONOMY.missions.dailyCount - core.length);
  const picked: string[] = [];
  let h = hash(`${playerId}:${day}`);
  while (picked.length < want && extra.length > 0) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    picked.push(extra.splice(h % extra.length, 1)[0]!);
  }
  return [...core, ...picked];
}

export interface MissionProgress {
  id: string;
  progress: number;
  done: boolean;
  /** Timed missions: when the clock started (null = not started). */
  startedAt: number | null;
  /** Timed missions: can't be restarted before this time (after running out of time). */
  cooldownUntil: number;
}

export interface MissionState {
  day: number;
  list: MissionProgress[];
}

/** A fresh daily state for a player. */
export function newMissionState(playerId: string, now: number): MissionState {
  const day = dayIndex(now);
  return { day, list: dailyMissionIds(playerId, day).map((id) => ({ id, progress: 0, done: false, startedAt: null, cooldownUntil: 0 })) };
}

/** Parse stored state; a stale or broken one is replaced by today's. */
export function normalizeMissionState(raw: unknown, playerId: string, now: number): MissionState {
  const day = dayIndex(now);
  if (!raw || typeof raw !== 'object') return newMissionState(playerId, now);
  const r = raw as Partial<MissionState>;
  if (r.day !== day || !Array.isArray(r.list)) return newMissionState(playerId, now);
  const fresh = newMissionState(playerId, now);
  for (const m of fresh.list) {
    const old = r.list.find((x) => x && x.id === m.id);
    if (!old) continue;
    m.progress = typeof old.progress === 'number' && Number.isFinite(old.progress) ? Math.max(0, old.progress) : 0;
    m.done = old.done === true;
    m.startedAt = typeof old.startedAt === 'number' ? old.startedAt : null;
    m.cooldownUntil = typeof old.cooldownUntil === 'number' ? old.cooldownUntil : 0;
  }
  return fresh;
}

/** What the client shows for one mission. */
export interface MissionView extends MissionProgress {
  def: MissionDef;
  /** Timed missions: when the time runs out (null when not running). */
  endsAt: number | null;
}

export function missionViews(state: MissionState): MissionView[] {
  return state.list.flatMap((p) => {
    const def = findMission(p.id);
    if (!def) return [];
    const endsAt = def.timeLimitSec && p.startedAt !== null && !p.done ? p.startedAt + def.timeLimitSec * 1000 : null;
    return [{ ...p, def, endsAt }];
  });
}

export function rewardLabel(r: MissionReward): string {
  const parts: string[] = [];
  if (r.money) parts.push(`$${r.money.toLocaleString('en-US')}`);
  if (r.xp) parts.push(`${r.xp} XP`);
  if (r.item) parts.push(r.item.qty > 1 ? `${r.item.qty}x ${r.item.label}` : r.item.label);
  return parts.join(' + ');
}

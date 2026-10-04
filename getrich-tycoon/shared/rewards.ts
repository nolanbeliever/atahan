// Daily login and playtime rewards (the "come back every day, stay a while" engine):
//
//  - A 7-day login streak: one box a day, claimed in order. Missing a day starts the streak again
//    from day 1; after day 7 it starts over.
//  - Playtime milestones: active minutes played today (15, 30, 60, 120, 180) each pay once a day.
//
// Days are the same as the daily missions' (shared/missions.ts dayIndex). The server keeps the state
// in the database (player_rewards) and pays the rewards; this module is the pure rules, shared with
// the client for the panels.

import { ECONOMY } from './economy.config';
import { dayIndex, ECU_COUPON } from './missions';
import { LOCKPICK_ITEM } from './theft';

const R = ECONOMY.rewards;

/** Reward items (inventory ids). */
export const NITRO_ITEM = 'nitro_shot';
export const VIP_COIN = 'vip_coin';
export const PAWN_BONUS_ITEM = 'pawn_bonus_50';
export const NEON_SPECIAL_ITEM = 'neon_special';
export const RIM_COUPON = 'coupon_rims_wrap';
export const LOCKPICK = LOCKPICK_ITEM;
export const ECU_COUPON_ITEM = ECU_COUPON;

export interface RewardItem {
  id: string;
  qty: number;
}

export interface RewardBundle {
  money?: number;
  xp?: number;
  items?: RewardItem[];
  /** A free legendary car (from the Rare Dealer's legendary pool). */
  legendaryCar?: boolean;
}

export interface DailyRewardDef {
  day: number;
  title: string;
  reward: RewardBundle;
}

export const DAILY_REWARDS: DailyRewardDef[] = [
  { day: 1, title: '$5,000', reward: { money: 5_000 } },
  { day: 2, title: 'Lockpick & Testere Seti', reward: { items: [{ id: LOCKPICK, qty: 1 }] } },
  { day: 3, title: '$15,000', reward: { money: 15_000 } },
  { day: 4, title: 'Stage 1 ECU kuponu', reward: { items: [{ id: ECU_COUPON_ITEM, qty: 1 }] } },
  { day: 5, title: '$30,000', reward: { money: 30_000 } },
  { day: 6, title: '3x Lockpick + Special Nitro', reward: { items: [{ id: LOCKPICK, qty: 3 }, { id: NITRO_ITEM, qty: R.nitroOnDay6 }] } },
  { day: 7, title: 'Efsanevi araç + $50,000', reward: { money: 50_000, legendaryCar: true, items: [{ id: VIP_COIN, qty: R.vipCoinsOnDay7 }] } },
];

/** The 3-hour milestone lets the player pick one of two extras. */
export type MegaChoice = 'pawn' | 'rims';

export interface PlaytimeMilestone {
  minutes: number;
  title: string;
  reward: RewardBundle;
  /** Extra the player chooses when claiming (the 3-hour mega reward). */
  choice?: Record<MegaChoice, { title: string; items: RewardItem[] }>;
}

export const PLAYTIME_MILESTONES: PlaytimeMilestone[] = [
  { minutes: 15, title: '$2,500', reward: { money: 2_500 } },
  { minutes: 30, title: 'Lockpick Seti', reward: { items: [{ id: LOCKPICK, qty: 1 }] } },
  { minutes: 60, title: '$15,000 + 200 XP', reward: { money: 15_000, xp: 200 } },
  { minutes: 120, title: '$35,000 + Plazma Neon', reward: { money: 35_000, items: [{ id: NEON_SPECIAL_ITEM, qty: 1 }] } },
  {
    minutes: 180,
    title: '$100,000 + Mega ödül',
    reward: { money: 100_000, items: [{ id: VIP_COIN, qty: R.vipCoinsOnMega }] },
    choice: {
      pawn: { title: 'Pawn Shop +%50 satış', items: [{ id: PAWN_BONUS_ITEM, qty: 1 }] },
      rims: { title: 'Nadir Jant & Boya Seti', items: [{ id: RIM_COUPON, qty: 1 }] },
    },
  },
];

/** Most playtime that counts in a day (s). */
export const PLAYTIME_CAP_SEC = Math.max(...PLAYTIME_MILESTONES.map((m) => m.minutes)) * 60;

/** Labels for reward items (inventory, panels). */
export const REWARD_ITEM_LABELS: Record<string, string> = {
  [NITRO_ITEM]: 'Special Nitro',
  [VIP_COIN]: 'VIP Coin',
  [PAWN_BONUS_ITEM]: 'Pawn Shop +%50 satış kuponu',
  [NEON_SPECIAL_ITEM]: 'Plazma Neon (özel underglow)',
  [RIM_COUPON]: 'Nadir Jant & Boya Seti kuponu',
  [LOCKPICK]: 'Lockpick & Testere Seti',
  [ECU_COUPON_ITEM]: 'Stage 1 ECU kuponu',
};

// ------------------------------------------------------------------ state

export interface RewardState {
  /** Day number (1-7) of the last box claimed, 0 before the first. */
  streak: number;
  /** dayIndex of the last daily claim (-1 never). */
  lastClaimDay: number;
  /** dayIndex the playtime counts for. */
  day: number;
  /** Active seconds played that day. */
  seconds: number;
  /** Milestones (minutes) claimed that day. */
  claimed: number[];
}

export function newRewardState(now: number): RewardState {
  return { streak: 0, lastClaimDay: -1, day: dayIndex(now), seconds: 0, claimed: [] };
}

/** A saved state, checked and rolled over to today (playtime starts again each day). */
export function normalizeRewardState(raw: unknown, now: number): RewardState {
  const s = newRewardState(now);
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<RewardState>;
    if (Number.isInteger(r.streak) && r.streak! >= 0 && r.streak! <= 7) s.streak = r.streak!;
    if (Number.isInteger(r.lastClaimDay)) s.lastClaimDay = r.lastClaimDay!;
    if (r.day === s.day) {
      if (typeof r.seconds === 'number' && Number.isFinite(r.seconds)) s.seconds = Math.max(0, Math.min(PLAYTIME_CAP_SEC, r.seconds));
      if (Array.isArray(r.claimed)) s.claimed = r.claimed.filter((m) => PLAYTIME_MILESTONES.some((x) => x.minutes === m));
    }
  }
  return s;
}

/** Start a new playtime day when the date changes. Returns true when it did. */
export function rollPlaytimeDay(s: RewardState, now: number): boolean {
  const today = dayIndex(now);
  if (s.day === today) return false;
  s.day = today;
  s.seconds = 0;
  s.claimed = [];
  return true;
}

/** The box that can be claimed today (1-7), or null when today's is already taken. */
export function nextDailyDay(s: RewardState, now: number): number | null {
  const today = dayIndex(now);
  if (s.lastClaimDay === today) return null;
  // Claimed yesterday: the streak goes on (after day 7 it starts over). Otherwise back to day 1.
  return s.lastClaimDay === today - 1 ? (s.streak % 7) + 1 : 1;
}

export type BoxState = 'claimed' | 'today' | 'locked';

export interface DailyView {
  /** Box to claim today, or the one claimed today. */
  day: number;
  claimable: boolean;
  /** Boxes of the current streak: claimed, today's, still to come. */
  boxes: { day: number; title: string; state: BoxState }[];
  /** A missed day reset the streak (the player had one going). */
  reset: boolean;
}

export function dailyView(s: RewardState, now: number): DailyView {
  const next = nextDailyDay(s, now);
  const day = next ?? s.streak;
  const claimedUpTo = next === null ? s.streak : next - 1;
  return {
    day,
    claimable: next !== null,
    boxes: DAILY_REWARDS.map((d) => ({
      day: d.day,
      title: d.title,
      state: d.day <= claimedUpTo ? 'claimed' : d.day === next ? 'today' : 'locked',
    })),
    reset: next === 1 && s.streak > 0 && s.streak < 7 && s.lastClaimDay >= 0,
  };
}

export interface PlaytimeView {
  seconds: number;
  cap: number;
  milestones: { minutes: number; title: string; claimed: boolean; ready: boolean; choice: boolean }[];
}

export function playtimeView(s: RewardState): PlaytimeView {
  return {
    seconds: Math.floor(s.seconds),
    cap: PLAYTIME_CAP_SEC,
    milestones: PLAYTIME_MILESTONES.map((m) => ({
      minutes: m.minutes,
      title: m.title,
      claimed: s.claimed.includes(m.minutes),
      ready: !s.claimed.includes(m.minutes) && s.seconds >= m.minutes * 60,
      choice: !!m.choice,
    })),
  };
}

export interface RewardsView {
  daily: DailyView;
  playtime: PlaytimeView;
  /** Server clock (ms) and when the reward day ends. */
  serverTime: number;
  dayEndsAt: number;
}

export function rewardsView(s: RewardState, now: number): RewardsView {
  return { daily: dailyView(s, now), playtime: playtimeView(s), serverTime: now, dayEndsAt: (dayIndex(now) + 1) * 86_400_000 };
}

/** Seconds of play until the next milestone that isn't reached yet (null when all are). */
export function secondsToNextMilestone(seconds: number, claimed: readonly number[]): number | null {
  const next = PLAYTIME_MILESTONES.find((m) => !claimed.includes(m.minutes) && seconds < m.minutes * 60);
  return next ? next.minutes * 60 - seconds : null;
}

/** Short text for a reward bundle (notifications). */
export function bundleLabel(b: RewardBundle, extra: RewardItem[] = []): string {
  const parts: string[] = [];
  if (b.money) parts.push(`$${b.money.toLocaleString('en-US')}`);
  if (b.xp) parts.push(`${b.xp} XP`);
  for (const it of [...(b.items ?? []), ...extra]) parts.push(`${it.qty > 1 ? `${it.qty}x ` : ''}${REWARD_ITEM_LABELS[it.id] ?? it.id}`);
  if (b.legendaryCar) parts.push('Efsanevi araç');
  return parts.join(' + ');
}

// Daily login streak and playtime milestone rules (shared/rewards.ts).

import { describe, expect, it } from 'vitest';
import { dayIndex } from '../../shared/missions';
import {
  DAILY_REWARDS,
  PLAYTIME_CAP_SEC,
  PLAYTIME_MILESTONES,
  bundleLabel,
  dailyView,
  newRewardState,
  nextDailyDay,
  normalizeRewardState,
  playtimeView,
  rewardsView,
  rollPlaytimeDay,
  secondsToNextMilestone,
  type RewardState,
} from '../../shared/rewards';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const TODAY = dayIndex(NOW);

function state(patch: Partial<RewardState> = {}): RewardState {
  return { ...newRewardState(NOW), ...patch };
}

describe('reward tables', () => {
  it('match the 7-day streak and the playtime milestones', () => {
    expect(DAILY_REWARDS.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(DAILY_REWARDS.map((d) => d.reward.money ?? 0)).toEqual([5_000, 0, 15_000, 0, 30_000, 0, 50_000]);
    expect(DAILY_REWARDS[1]!.reward.items).toEqual([{ id: 'lockpick_set', qty: 1 }]);
    expect(DAILY_REWARDS[3]!.reward.items).toEqual([{ id: 'coupon_ecu_stage1', qty: 1 }]);
    expect(DAILY_REWARDS[5]!.reward.items!.find((i) => i.id === 'lockpick_set')?.qty).toBe(3);
    expect(DAILY_REWARDS[5]!.reward.items!.some((i) => i.id === 'nitro_shot')).toBe(true);
    expect(DAILY_REWARDS[6]!.reward.legendaryCar).toBe(true);
    expect(PLAYTIME_MILESTONES.map((m) => m.minutes)).toEqual([15, 30, 60, 120, 180]);
    expect(PLAYTIME_MILESTONES.map((m) => m.reward.money ?? 0)).toEqual([2_500, 0, 15_000, 35_000, 100_000]);
    expect(PLAYTIME_MILESTONES[2]!.reward.xp).toBe(200);
    expect(PLAYTIME_MILESTONES[4]!.choice).toBeDefined();
    expect(PLAYTIME_CAP_SEC).toBe(3 * 3600);
  });
});

describe('daily streak', () => {
  it('starts on day 1 and moves on one box a day', () => {
    expect(nextDailyDay(state(), NOW)).toBe(1);
    expect(nextDailyDay(state({ streak: 1, lastClaimDay: TODAY }), NOW)).toBeNull();
    expect(nextDailyDay(state({ streak: 3, lastClaimDay: TODAY - 1 }), NOW)).toBe(4);
    expect(nextDailyDay(state({ streak: 6, lastClaimDay: TODAY - 1 }), NOW)).toBe(7);
  });

  it('starts over after day 7 and when a day is missed', () => {
    expect(nextDailyDay(state({ streak: 7, lastClaimDay: TODAY - 1 }), NOW)).toBe(1);
    expect(nextDailyDay(state({ streak: 4, lastClaimDay: TODAY - 2 }), NOW)).toBe(1);
    const v = dailyView(state({ streak: 4, lastClaimDay: TODAY - 2 }), NOW);
    expect(v.reset).toBe(true);
    expect(v.boxes.map((b) => b.state)).toEqual(['today', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked']);
    // A finished week is not a missed day.
    expect(dailyView(state({ streak: 7, lastClaimDay: TODAY - 1 }), NOW).reset).toBe(false);
    expect(dailyView(state(), NOW).reset).toBe(false);
  });

  it('shows claimed, today and locked boxes', () => {
    const open = dailyView(state({ streak: 2, lastClaimDay: TODAY - 1 }), NOW);
    expect(open.claimable).toBe(true);
    expect(open.day).toBe(3);
    expect(open.boxes.map((b) => b.state)).toEqual(['claimed', 'claimed', 'today', 'locked', 'locked', 'locked', 'locked']);
    const done = dailyView(state({ streak: 3, lastClaimDay: TODAY }), NOW);
    expect(done.claimable).toBe(false);
    expect(done.day).toBe(3);
    expect(done.boxes.map((b) => b.state)).toEqual(['claimed', 'claimed', 'claimed', 'locked', 'locked', 'locked', 'locked']);
  });
});

describe('playtime', () => {
  it('starts again every day and keeps the streak', () => {
    const s = state({ streak: 2, lastClaimDay: TODAY, seconds: 4000, claimed: [15, 30] });
    expect(rollPlaytimeDay(s, NOW)).toBe(false);
    expect(rollPlaytimeDay(s, NOW + DAY)).toBe(true);
    expect(s).toMatchObject({ streak: 2, lastClaimDay: TODAY, day: TODAY + 1, seconds: 0, claimed: [] });
  });

  it('loads saved state safely', () => {
    expect(normalizeRewardState(null, NOW)).toEqual(newRewardState(NOW));
    expect(normalizeRewardState('junk', NOW)).toEqual(newRewardState(NOW));
    const saved = { streak: 5, lastClaimDay: TODAY - 1, day: TODAY, seconds: 99_999, claimed: [15, 17, 60] };
    expect(normalizeRewardState(saved, NOW)).toEqual({ streak: 5, lastClaimDay: TODAY - 1, day: TODAY, seconds: PLAYTIME_CAP_SEC, claimed: [15, 60] });
    // Yesterday's playtime does not carry over; the streak does.
    expect(normalizeRewardState({ ...saved, day: TODAY - 1 }, NOW)).toMatchObject({ streak: 5, seconds: 0, claimed: [] });
    expect(normalizeRewardState({ streak: 99, lastClaimDay: 'x' }, NOW)).toMatchObject({ streak: 0, lastClaimDay: -1 });
  });

  it('counts down to the next milestone', () => {
    expect(secondsToNextMilestone(0, [])).toBe(900);
    expect(secondsToNextMilestone(1000, [])).toBe(800);
    // Reached but not claimed: the next one after it.
    expect(secondsToNextMilestone(1000, [15])).toBe(800);
    expect(secondsToNextMilestone(4000, [15, 30, 60])).toBe(7200 - 4000);
    expect(secondsToNextMilestone(PLAYTIME_CAP_SEC, [])).toBeNull();
    const v = playtimeView(state({ seconds: 1900, claimed: [15] }));
    expect(v.milestones.map((m) => [m.minutes, m.claimed, m.ready])).toEqual([
      [15, true, false],
      [30, false, true],
      [60, false, false],
      [120, false, false],
      [180, false, false],
    ]);
  });

  it('describes rewards and the end of the day', () => {
    expect(bundleLabel({ money: 15_000, xp: 200 })).toBe('$15,000 + 200 XP');
    expect(bundleLabel({ items: [{ id: 'lockpick_set', qty: 3 }] })).toBe('3x Lockpick & Testere Seti');
    expect(bundleLabel({ money: 50_000, legendaryCar: true })).toBe('$50,000 + Efsanevi araç');
    const v = rewardsView(state(), NOW);
    expect(v.dayEndsAt).toBe((TODAY + 1) * DAY);
    expect(v.dayEndsAt).toBeGreaterThan(NOW);
  });
});

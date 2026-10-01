// Day/night and weather, missions, reputation unlocks, the driving bonus and police rules (pure
// functions shared by the server and the client).

import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import { DAY_LENGTH_MS, gameHour, nightFactor, rainAt, sunsetFactor, surfaceGrip, wetnessAt, WEATHER_SLOT_MS } from '../../shared/environment';
import { MISSIONS, dailyMissionIds, dayIndex, missionViews, newMissionState, normalizeMissionState, rewardLabel } from '../../shared/missions';
import { discountedPrice, garageSlots, marketDiscount, reputationUnlocks, spawnSlots } from '../../shared/reputation';
import { optionLevel } from '../../shared/customization';
import { driveBonus } from '../../server/game/services/driving';
import { policeFine, starsFor } from '../../server/game/services/police';

describe('day and night', () => {
  it('a full day lasts 10 minutes', () => {
    expect(DAY_LENGTH_MS).toBe(600_000);
    expect(gameHour(0)).toBe(0);
    expect(gameHour(DAY_LENGTH_MS / 2)).toBeCloseTo(12, 6);
    expect(gameHour(DAY_LENGTH_MS * 3 + DAY_LENGTH_MS / 4)).toBeCloseTo(6, 6);
  });

  it('night falls in the evening, sunset glows orange before it', () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(23)).toBe(1);
    expect(nightFactor(3)).toBe(1);
    expect(nightFactor(19)).toBeGreaterThan(0);
    expect(nightFactor(19)).toBeLessThan(1);
    expect(sunsetFactor(12)).toBe(0);
    expect(sunsetFactor(18.2)).toBeGreaterThan(0.9);
    expect(sunsetFactor(23)).toBe(0);
  });
});

describe('weather', () => {
  it('rain comes in spells, the same for everyone, and makes the roads 20% less grippy', () => {
    let rainy = 0;
    const slots = 400;
    for (let i = 0; i < slots; i++) {
      const t = i * WEATHER_SLOT_MS + WEATHER_SLOT_MS / 2;
      const r = rainAt(t);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      if (r > 0) rainy++;
      expect(rainAt(t)).toBe(r); // deterministic
      const grip = surfaceGrip(t);
      expect(grip).toBeGreaterThanOrEqual(0.8);
      expect(grip).toBeLessThanOrEqual(1);
      if (wetnessAt(t) === 0) expect(grip).toBe(1);
    }
    // About 30% of the time.
    expect(rainy / slots).toBeGreaterThan(0.18);
    expect(rainy / slots).toBeLessThan(0.42);
    // Somewhere it pours: grip down to 80%.
    let min = 1;
    for (let i = 0; i < slots; i++) min = Math.min(min, surfaceGrip(i * WEATHER_SLOT_MS + WEATHER_SLOT_MS / 2));
    expect(min).toBeCloseTo(0.8, 2);
  });

  it('roads stay wet for a while after the rain stops', () => {
    // Find the end of a rainy spell.
    let t = WEATHER_SLOT_MS / 2;
    while (!(rainAt(t) > 0.5 && rainAt(t + WEATHER_SLOT_MS) === 0)) t += WEATHER_SLOT_MS;
    const after = t + WEATHER_SLOT_MS / 2 + 30_000;
    expect(rainAt(after)).toBe(0);
    expect(wetnessAt(after)).toBeGreaterThan(0);
  });
});

describe('missions', () => {
  it('the three headline missions are always in the daily set', () => {
    for (const player of ['a', 'b', 'player_123']) {
      const ids = dailyMissionIds(player, 20_000);
      expect(ids).toEqual(expect.arrayContaining(['clean10', 'hold250', 'sell2']));
      expect(ids.length).toBe(ECONOMY.missions.dailyCount);
      expect(new Set(ids).size).toBe(ids.length);
      // Same player, same day: the same set.
      expect(dailyMissionIds(player, 20_000)).toEqual(ids);
    }
  });

  it('rewards match the brief', () => {
    const m = (id: string) => MISSIONS.find((x) => x.id === id)!;
    expect(m('clean10').target).toBe(10);
    expect(m('clean10').reward.money).toBe(2_500);
    expect(m('hold250').param).toBe(250);
    expect(m('hold250').target).toBe(5);
    expect(m('hold250').reward.item?.id).toBe('coupon_ecu_stage1');
    expect(m('sell2').timeLimitSec).toBe(120);
    expect(m('sell2').reward).toEqual({ money: 5_000, xp: 100 });
    expect(rewardLabel(m('sell2').reward)).toBe('$5,000 + 100 XP');
  });

  it('stored progress survives the day and resets the next', () => {
    const now = Date.UTC(2026, 9, 1, 12);
    const s = newMissionState('p1', now);
    s.list[0]!.progress = 4;
    s.list[1]!.done = true;
    const back = normalizeMissionState(JSON.parse(JSON.stringify(s)), 'p1', now + 3_600_000);
    expect(back.list[0]!.progress).toBe(4);
    expect(back.list[1]!.done).toBe(true);
    const tomorrow = normalizeMissionState(s, 'p1', now + 86_400_000);
    expect(tomorrow.day).toBe(dayIndex(now) + 1);
    expect(tomorrow.list.every((m) => m.progress === 0 && !m.done)).toBe(true);
    expect(normalizeMissionState('garbage', 'p1', now).list.length).toBe(ECONOMY.missions.dailyCount);
  });

  it('a started timed mission shows when it runs out', () => {
    const now = Date.UTC(2026, 9, 1, 12);
    const s = newMissionState('p1', now);
    const sell = s.list.find((m) => m.id === 'sell2')!;
    sell.startedAt = now;
    const view = missionViews(s).find((v) => v.id === 'sell2')!;
    expect(view.endsAt).toBe(now + 120_000);
  });
});

describe('reputation unlocks', () => {
  it('higher levels give a bigger garage, more cars out and market discounts', () => {
    expect(garageSlots(1)).toBe(ECONOMY.unlocks.garage.base);
    expect(garageSlots(10)).toBeGreaterThan(garageSlots(1));
    expect(garageSlots(1000)).toBe(ECONOMY.unlocks.garage.max);
    expect(spawnSlots(1)).toBe(2);
    expect(spawnSlots(8)).toBe(3);
    expect(spawnSlots(18)).toBe(4);
    expect(marketDiscount(1)).toBe(0);
    expect(marketDiscount(30)).toBeCloseTo(0.1);
    expect(discountedPrice(10_000, 10)).toBe(9_600);
    const list = reputationUnlocks();
    expect(list.map((u) => u.level)).toEqual([...list.map((u) => u.level)].sort((a, b) => a - b));
    expect(list.some((u) => /underglow/i.test(u.title))).toBe(true);
  });

  it('underglow neon unlocks by level', () => {
    expect(optionLevel('ug_none')).toBe(0);
    expect(optionLevel('ug_blue')).toBe(ECONOMY.unlocks.underglowLevel);
    expect(optionLevel('ug_rainbow')).toBe(ECONOMY.unlocks.rainbowUnderglowLevel);
    expect(optionLevel('tint_dark')).toBe(0);
  });
});

describe('driving bonus', () => {
  it('pays every 10 s by car value: $50 for a $50k car, about $350 for a $300k G 63 / M8', () => {
    expect(driveBonus(50_000)).toBe(50);
    expect(driveBonus(300_000)).toBeGreaterThanOrEqual(330);
    expect(driveBonus(300_000)).toBeLessThanOrEqual(370);
    expect(driveBonus(10_000)).toBeGreaterThanOrEqual(ECONOMY.driving.minAmount);
    expect(driveBonus(150_000)).toBeGreaterThan(driveBonus(100_000));
  });
});

describe('police', () => {
  it('heat becomes 1-5 stars; arrests cost 10% of cash, at least $1,500', () => {
    expect(starsFor(0)).toBe(0);
    expect(starsFor(40)).toBe(1);
    expect(starsFor(150)).toBe(2);
    expect(starsFor(10_000)).toBe(5);
    expect(policeFine(100_000)).toBe(10_000);
    expect(policeFine(5_000)).toBe(1_500);
    expect(policeFine(900)).toBe(900);
    expect(policeFine(0)).toBe(0);
  });
});

// Highway traffic streaming, time of day, the near-miss HUD, and the drag strip panel / tree.

import { expect, test } from '@playwright/test';
import type { DragRaceView } from '../../shared/drag';
import type { NearMissEvent } from '../../shared/protocol';
import { collectErrors, registerAndEnter } from './helpers';

interface GameHandle {
  traffic: { cars: Map<number, unknown> };
  night: number;
  renderer: { setTime: (h: number) => number };
  store: { playerId: string };
  ui: {
    open: (n: string) => void;
    closeAll: () => void;
    nearMiss: { nearMiss: (e: NearMissEvent) => void; ended: (r: 'crash' | 'expired', c: number, e: number) => void };
    dragHud: { set: (r: DragRaceView | null, me: string | null) => void };
  };
}

test('highway traffic, night lights, near-miss combo HUD and the drag strip', async ({ page }) => {
  const errors = collectErrors(page);
  await registerAndEnter(page);

  // Traffic on the ring highway streams in (cars, trucks, coaches, semis).
  await page.waitForFunction(() => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.traffic.cars.size > 40, null, { timeout: 30_000 });

  // Night falls: the renderer reports it and street lights switch on.
  const night = await page.evaluate(() => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.renderer.setTime(23));
  expect(night).toBe(1);
  await page.evaluate(() => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.renderer.setTime(12));

  // Near miss: popup with the cash and the combo meter.
  await page.evaluate(() =>
    (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.ui.nearMiss.nearMiss({ amount: 200, xp: 10, mult: 2, combo: 3, comboMoney: 400, comboXp: 20, gap: 0.62, kind: 'semi', capped: false }),
  );
  await expect(page.getByTestId('nearmiss-pop')).toContainText('NEAR MISS');
  await expect(page.getByTestId('nearmiss-pop')).toContainText('MAKAS');
  await expect(page.getByTestId('nearmiss-pop')).toContainText('+$200');
  await expect(page.getByTestId('combo')).toContainText('x2');
  await expect(page.getByTestId('combo-money')).toContainText('$400');
  await page.evaluate(() => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.ui.nearMiss.ended('crash', 3, 400));
  await expect(page.getByTestId('nearmiss-pop')).toContainText('CRASH');
  await expect(page.getByTestId('combo')).toBeHidden();

  // The drag strip panel asks for a car at the staging lane.
  await page.evaluate(() => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.ui.open('drag'));
  await expect(page.getByTestId('drag-need-car')).toBeVisible();
  await page.getByTestId('panel-close').click();

  // Christmas tree: reds, then green; a false start lights the foul lamp.
  const me = await page.evaluate(() => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.store.playerId);
  const race = (lights: number, foul: boolean): DragRaceView => ({
    id: 'drag_test',
    phase: lights === 4 ? 'racing' : 'countdown',
    lights,
    greenAt: lights === 4 ? Date.now() : null,
    racers: [
      { lane: 0, playerId: me, name: 'me', modelId: 'norda_pixi', color: '#fff', tuning: null, bot: false, zeroTo100: 9.8, topSpeedKmh: 195, hp: 90, result: foul ? { outcome: 'false_start', reaction: -0.4, et: null, total: null, trapKmh: null } : null },
      { lane: 1, playerId: null, name: 'Bot', modelId: 'norda_arlo', color: '#f00', tuning: null, bot: true, zeroTo100: 9.4, topSpeedKmh: 205, hp: 110, result: null },
    ],
    winner: null,
    entry: 250,
    pool: 500,
  });
  await page.evaluate(([r, id]) => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.ui.dragHud.set(r as DragRaceView, id as string), [race(2, false), me] as const);
  await expect(page.getByTestId('drag-tree')).toBeVisible();
  await expect(page.getByTestId('tree-0-0')).toHaveClass(/on/);
  await expect(page.getByTestId('tree-0-1')).toHaveClass(/on/);
  await expect(page.getByTestId('tree-0-2')).not.toHaveClass(/on/);
  await page.evaluate(([r, id]) => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.ui.dragHud.set(r as DragRaceView, id as string), [race(4, false), me] as const);
  await expect(page.getByTestId('tree-0-3')).toHaveClass(/on/);
  await expect(page.getByTestId('drag-status')).toHaveText('GO!');
  await page.evaluate(([r, id]) => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.ui.dragHud.set(r as DragRaceView, id as string), [race(3, true), me] as const);
  await expect(page.getByTestId('tree-0-4')).toHaveClass(/on/);
  await expect(page.getByTestId('drag-status')).toHaveText('FALSE START!');
  await page.evaluate(() => (window as unknown as { __getrich: { game: GameHandle } }).__getrich.game.ui.dragHud.set(null, null));

  // Horn (H) is a normal input key.
  await page.keyboard.down('KeyH');
  await page.waitForTimeout(200);
  await page.keyboard.up('KeyH');
  expect(errors).toEqual([]);
});

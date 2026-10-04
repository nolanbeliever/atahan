// Car theft in the browser: the Black Market tab (stock, countdown, buying a set), the set in the
// garage, the parked cars on the street, the lockpick mini-game screen, and the Pawn Shop.

import { expect, test } from '@playwright/test';
import { collectErrors, registerAndEnter } from './helpers';

interface TheftState {
  streetCars: { id: string; highway: boolean }[];
  lockpicks: number;
}

type Win = { __getrich: { state: () => TheftState; game: { ui: { open: (n: string, a?: unknown) => void; current: { name: string } | null }; theft: { count: number } } } };

test('Black Market sells a lockpick set; parked cars, the lockpick screen and the Pawn Shop are there', async ({ page }) => {
  const errors = collectErrors(page);
  await registerAndEnter(page);

  // Parked cars to break into are drawn in the city and on the highway shoulder.
  await page.waitForFunction(() => (window as unknown as Win).__getrich.state().streetCars.length >= 12, null, { timeout: 30_000 });
  const cars = await page.evaluate(() => (window as unknown as Win).__getrich.state().streetCars);
  expect(cars.some((c) => c.highway)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__getrich.game.theft.count)).toBe(cars.length);

  // Black Market tab: stock of five with a restock countdown, then buy a set.
  await page.getByTestId('dock-market').click();
  await page.getByTestId('market-tab-black').click();
  await expect(page.getByTestId('black-market')).toBeVisible();
  await expect(page.getByTestId('bm-stock')).toContainText('/ 5');
  await expect(page.getByTestId('bm-timer')).toContainText(/\d\d:\d\d/);
  await expect(page.getByTestId('bm-owned')).toContainText('You own 0');
  await page.getByTestId('bm-buy').click();
  await expect(page.getByTestId('bm-owned')).toContainText('You own 1');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__getrich.state().lockpicks)).toBe(1);
  await page.getByTestId('panel-close').click();

  // The set is in the garage's parts inventory.
  await page.getByTestId('dock-inventory').click();
  await page.getByText('Parts inventory').click();
  await expect(page.getByTestId('inv-lockpicks')).toHaveText('1');
  await page.getByTestId('panel-close').click();

  // The Black Market is also in the Esc menu.
  await page.locator('#game-root canvas').focus();
  await page.keyboard.press('Escape');
  await page.getByTestId('menu-blackmarket').click();
  await expect(page.getByTestId('black-market')).toBeVisible();
  await page.getByTestId('panel-close').click();

  // The lockpick screen draws and turns; a lock that isn't there is refused and the screen closes.
  await page.evaluate(() => (window as unknown as Win).__getrich.game.ui.open('lockpick', { sessionId: 'lp_none', carId: 'sc_none', modelId: 'norda_pixi', difficulty: 'easy', picks: 3 }));
  await expect(page.getByTestId('lockpick-canvas')).toBeVisible();
  await page.keyboard.press('KeyW');
  await expect(page.getByTestId('toast').last()).toContainText('No lock in progress', { timeout: 15_000 });
  await expect(page.getByTestId('lockpick')).toBeHidden({ timeout: 30_000 });

  // Pawn Shop: nothing to sell yet.
  await page.evaluate(() => (window as unknown as Win).__getrich.game.ui.open('pawn'));
  await expect(page.getByTestId('pawn-empty')).toBeVisible();
  await expect(page.getByTestId('pawn-sell-all')).toBeDisabled();
  await page.getByTestId('panel-close').click();

  expect(errors.filter((e) => !/favicon|ERR_|404/.test(e))).toEqual([]);
});

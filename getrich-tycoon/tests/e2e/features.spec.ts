// The newer features in the browser: the daily reward panel opening on the first visit and paying
// day 1, the gift box countdown, the health bar, Ammu-Nation's catalogue (buying needs you there),
// a gun key without a gun, the Moto Gear helmet shop and the Marketplace sell tab.

import { expect, test } from '@playwright/test';
import { collectErrors, moneyText, registerAndEnter, state } from './helpers';

type Win = { __getrich: { game: { ui: { open: (n: string, a?: unknown) => void } } } };

test('daily reward, gift box, health bar, Ammu-Nation catalogue and the sell tab', async ({ page }) => {
  const errors = collectErrors(page);
  await registerAndEnter(page, undefined, { autoRewards: true });

  // First visit of the day: the rewards panel opens by itself with the 7-day streak.
  await expect(page.getByTestId('rw-box')).toHaveCount(7, { timeout: 30_000 });
  await expect(page.locator('[data-testid=rw-box][data-day="1"]')).toHaveAttribute('data-state', 'today');
  await expect(page.locator('[data-testid=rw-box][data-day="7"]')).toHaveAttribute('data-state', 'locked');
  await expect(page.getByTestId('rw-mile')).toHaveCount(5);
  const before = (await state(page)).money!;
  await page.getByTestId('rw-claim-daily').click();
  await expect(page.getByTestId('reward-banner')).toContainText('1. GÜN ÖDÜLÜ TOPLANDI', { timeout: 15_000 });
  await expect.poll(async () => (await state(page)).money, { timeout: 15_000 }).toBe(before + 5_000);
  await expect(page.locator('[data-testid=rw-box][data-day="1"]')).toHaveAttribute('data-state', 'claimed');
  await page.getByTestId('panel-close').click();
  await expect(page.getByTestId('hud-money')).toHaveText(moneyText(before + 5_000));

  // The gift box counts down to the 15-minute reward.
  await expect(page.getByTestId('gift-hud')).toContainText('Sonraki Ödül');
  await expect(page.getByTestId('gift-hud')).toContainText(/1[45]:\d\d/);

  // Full health.
  await expect(page.getByTestId('hp-text')).toHaveText('100');

  // A gun key without a gun says where to get one.
  await page.locator('#game-root canvas').focus();
  await page.keyboard.press('Digit1');
  await expect(page.getByTestId('toast').last()).toContainText('Ammu-Nation', { timeout: 15_000 });

  // Ammu-Nation's catalogue; buying needs you at the shop.
  await page.evaluate(() => (window as unknown as Win).__getrich.game.ui.open('ammu'));
  await expect(page.getByTestId('gun-card')).toHaveCount(6);
  await expect(page.locator('[data-gun=pistol]')).toContainText('$5,000');
  await expect(page.locator('[data-gun=shotgun]')).toContainText('$18,000');
  await expect(page.locator('[data-gun=rifle]')).toContainText('$45,000');
  await expect(page.locator('[data-gun=minigun]')).toContainText('VIP Coin');
  await expect(page.locator('[data-gun=minigun] [data-testid=buy-gun]')).toBeDisabled();
  await page.locator('[data-gun=pistol] [data-testid=buy-gun]').click();
  await expect(page.getByTestId('toast').last()).toContainText('Ammu-Nation', { timeout: 15_000 });
  expect((await state(page)).money).toBe(before + 5_000);
  await page.getByTestId('panel-close').click();

  // Moto Gear: four helmets and four visors, no helmet worn yet.
  await page.evaluate(() => (window as unknown as Win).__getrich.game.ui.open('motogear'));
  await expect(page.getByTestId('helmet-card')).toHaveCount(4);
  await expect(page.getByTestId('visor-row')).toHaveCount(4);
  await expect(page.locator('[data-helmet=premium]')).toContainText('$3,500');
  await expect(page.getByTestId('helmet-status')).toContainText('Kask yok');
  await page.getByTestId('panel-close').click();

  // Marketplace: the sell tab.
  await page.getByTestId('dock-market').click();
  await page.getByTestId('market-tab-sell').click();
  await expect(page.getByText('Satılık araçların')).toBeVisible();
  await page.getByTestId('panel-close').click();

  expect(errors).toEqual([]);
});

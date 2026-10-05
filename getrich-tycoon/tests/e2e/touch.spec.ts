// Touch controls on an iPad-sized screen, driven by real touch events (Chrome DevTools Protocol),
// which the browser turns into the same pointer events Safari on iPad produces.

import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { isCategoryUnlocked } from '../../shared/progression';
import { getModel } from '../../shared/vehicles';
import { collectErrors, registerAndEnter, state } from './helpers';

test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

interface Point {
  x: number;
  y: number;
}

/** Put a finger down, slide it to `to` and keep it there for `holdMs`. */
async function touchDrag(page: Page, cdp: CDPSession, from: Point, to: Point, holdMs: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function center(page: Page, testId: string): Promise<Point> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('iPad touch controls: stick, camera drag, taps, chat and driving', async ({ page }) => {
  const errors = collectErrors(page);
  await registerAndEnter(page);
  const cdp = await page.context().newCDPSession(page);

  // Touch UI is detected automatically (coarse pointer) and keyboard hints are hidden.
  await expect(page.getByTestId('touch-stick')).toBeVisible();
  await expect(page.getByTestId('touch-action')).toBeVisible();
  expect(await page.evaluate(() => document.body.classList.contains('touch'))).toBe(true);
  await expect(page.locator('.help-hint')).toBeHidden();

  // Stick pushed up = walk forward (server-reconciled position changes).
  const stick = await center(page, 'touch-stick');
  const before = (await state(page)).position;
  await touchDrag(page, cdp, stick, { x: stick.x, y: stick.y - 55 }, 3500);
  await page.waitForTimeout(800);
  const after = (await state(page)).position;
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);

  // One finger dragged across the 3D view turns the camera.
  const yaw0 = (await page.evaluate(() => (window as unknown as { __getrich: { state: () => { yaw: number } } }).__getrich.state().yaw));
  await touchDrag(page, cdp, { x: 760, y: 360 }, { x: 560, y: 360 }, 300);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __getrich: { state: () => { yaw: number } } }).__getrich.state().yaw))
    .not.toBeCloseTo(yaw0, 2);

  // Dock buttons and panel close buttons respond to taps.
  await page.getByTestId('dock-market').tap();
  await expect(page.getByTestId('panel-market')).toBeVisible();
  await page.getByTestId('panel-close').tap();
  // At 1-2 FPS a tap can land in the middle of a long frame; tap again if the panel is still open.
  await expect
    .poll(async () => {
      if (await page.getByTestId('panel-market').isVisible()) await page.getByTestId('panel-close').tap({ timeout: 5_000 }).catch(() => undefined);
      return page.getByTestId('panel-market').isVisible();
    }, { timeout: 30_000 })
    .toBe(false);

  // Chat without a hardware keyboard: dock button + Send button.
  await page.getByTestId('dock-chat').tap();
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await page.getByTestId('chat-input').fill('hello from an ipad');
  await page.getByTestId('chat-send').tap();
  await expect(page.getByTestId('chat-log')).toContainText('hello from an ipad');
  await expect(page.getByTestId('chat-input')).toBeHidden();

  // Get a car (not a motorcycle: its hold button is WHEELIE), then drive it with the touch controls only.
  const listing = (await state(page)).marketListings
    .filter((l) => isCategoryUnlocked(getModel(l.modelId).category, 1) && getModel(l.modelId).specs.kind !== 'bike')
    .sort((x, y) => x.price - y.price)[0]!;
  await page.evaluate(async (l) => {
    const net = (window as unknown as { __getrich: { game: { net: { rpc: (m: string, p: unknown) => Promise<unknown> } } } }).__getrich.game.net;
    await net.rpc('market.buy', { listingId: l.id, expectedPrice: l.price });
  }, listing);
  await page.getByTestId('dock-inventory').tap();
  await page.locator(`[data-vehicle="${listing.vehicleId}"]`).getByTestId('inv-spawn').tap();
  await expect.poll(async () => (await state(page)).publicVehicles.find((v) => v.id === listing.vehicleId)?.status).toBe('world');
  await expect(page.getByTestId('prompt')).toContainText('Drive', { timeout: 60_000 });
  await expect(page.getByTestId('touch-action')).toHaveClass(/ready/);
  await page.getByTestId('touch-action').tap();
  await expect.poll(async () => (await state(page)).driving, { timeout: 60_000 }).toBe(listing.vehicleId);
  await expect(page.getByTestId('touch-hold')).toHaveText('BRAKE');

  const start = (await state(page)).position;
  // Software rendering runs the game in slow motion: keep the stick forward until the car has moved
  // (or pulled back to reverse out if it was parked against a bench).
  let end = start;
  for (const dy of [-60, -60, 60]) {
    await touchDrag(page, cdp, stick, { x: stick.x, y: stick.y + dy }, 6000);
    await page.waitForTimeout(500);
    end = (await state(page)).position;
    if (Math.hypot(end.x - start.x, end.z - start.z) > 1) break;
  }
  expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(1);

  // Tapping the prompt works too: it exits the vehicle.
  await page.getByTestId('prompt').tap();
  await expect.poll(async () => (await state(page)).driving, { timeout: 60_000 }).toBeNull();
  await expect(page.getByTestId('touch-hold')).toHaveText('RUN');
  expect(errors).toEqual([]);
});

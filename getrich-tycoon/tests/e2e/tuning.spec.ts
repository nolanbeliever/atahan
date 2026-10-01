// Tuning garage (browsed remotely: live stats, dyno) and the Rare Dealer (countdown, pictures, purchase).

import { expect, test } from '@playwright/test';
import { isCategoryUnlocked } from '../../shared/progression';
import { calculateVehicleStats } from '../../shared/tuningSystem';
import type { Vehicle } from '../../shared/types';
import { getModel } from '../../shared/vehicles';
import { collectErrors, registerAndEnter, state } from './helpers';

type Rpc = (m: string, p: unknown) => Promise<unknown>;

test('tuning garage previews parts, stats and the dyno; the Rare Dealer sells rotating stock', async ({ page }) => {
  const errors = collectErrors(page);
  await registerAndEnter(page);

  // A car to work on.
  // (Prefer one without performance parts: NPC cars sometimes come pre-tuned.)
  const stock = new Set(
    await page.evaluate(() =>
      (window as unknown as { __getrich: { game: { store: { marketListings: { id: string; vehicle: Vehicle }[] } } } }).__getrich.game.store.marketListings
        .filter((l) => !Object.values(l.vehicle.mods.tuning?.perf ?? {}).some(Boolean))
        .map((l) => l.id),
    ),
  );
  const listing = (await state(page)).marketListings
    .filter((l) => isCategoryUnlocked(getModel(l.modelId).category, 1) && getModel(l.modelId).specs.aspiration !== 'electric')
    .sort((x, y) => Number(stock.has(y.id)) - Number(stock.has(x.id)) || x.price - y.price)[0]!;
  const bought = await page.evaluate(async (l) => {
    const net = (window as unknown as { __getrich: { game: { net: { rpc: Rpc } } } }).__getrich.game.net;
    return ((await net.rpc('market.buy', { listingId: l.id, expectedPrice: l.price })) as { vehicle: Vehicle }).vehicle;
  }, listing);

  // Open the garage remotely.
  await page.evaluate(() => (window as unknown as { __getrich: { game: { ui: { open: (n: string) => void } } } }).__getrich.game.ui.open('custom'));
  await expect(page.getByTestId('garage-stats')).toBeVisible();
  const hp = page.getByTestId('stat-hp');
  // NPC cars sometimes come with parts fitted already: the garage starts from the car's own build.
  const stockHp = calculateVehicleStats(getModel(listing.modelId), bought.mods.tuning).hp;
  await expect(hp).toContainText(`${stockHp} hp`);

  // Stage 2 pulls in its downpipe and raises the power figure.
  await page.getByTestId('part-ecu_stage2').click();
  await expect(page.getByTestId('part-exh_downpipe')).toHaveClass(/active/);
  await expect(hp).toContainText('+');
  await expect(page.getByTestId('garage-apply')).toContainText('Install - $');
  // Browsing remotely: installing needs a visit to Chroma Customs.
  await expect(page.getByTestId('garage-apply')).toBeDisabled();

  // Paint with the colour picker / HEX field.
  await page.getByTestId('garage-tab-paint').click();
  await page.getByTestId('paint-finish-matte').click();
  await page.getByTestId('paint-hex').fill('#12ab34');
  await expect(page.getByTestId('paint-picker')).toHaveValue('#12ab34');

  // Wheels & stance.
  await page.getByTestId('garage-tab-wheels').click();
  await page.getByTestId('rim-rim_mesh').click();
  await expect(page.getByTestId('rim-rim_mesh')).toHaveClass(/active/);
  await expect(page.getByTestId('stance-drop')).toBeDisabled(); // stock suspension

  // Dyno: chart and a live pull.
  await page.getByTestId('garage-tab-dyno').click();
  await expect(page.getByTestId('dyno-chart')).toBeVisible();
  await expect(page.getByTestId('dyno-peak-hp')).not.toContainText(`${stockHp} hp`);
  await page.getByTestId('dyno-run').click();
  await expect(page.getByTestId('dyno-readout')).not.toHaveText('0 rpm · 0 hp · 0 Nm', { timeout: 10_000 });
  await page.getByTestId('panel-close').click();

  // Rare Dealer: countdown, six offers with pictures.
  await page.getByTestId('dock-market').click();
  await page.getByTestId('market-tab-rare').click();
  const timer = page.getByTestId('rare-timer');
  await expect(timer).toHaveText(/Timer: 0[0-2]:\d\d|Restocking/);
  const offers = page.getByTestId('rare-offer');
  await expect(offers).toHaveCount(6);
  await expect(offers.first().locator('img')).toHaveAttribute('src', /^(data:image|\/cars\/)/, { timeout: 30_000 });
  const t1 = await timer.textContent();
  await page.waitForTimeout(2100);
  expect(await timer.textContent()).not.toBe(t1);

  // Buy the cheapest affordable offer (if the stock has one).
  const buyable = page.locator('[data-testid="rare-buy"]:not([disabled])');
  if ((await buyable.count()) > 0) {
    const btns = await buyable.all();
    let best = btns[0]!;
    let bestPrice = Infinity;
    for (const b of btns) {
      const price = Number((await b.textContent())!.replace(/[^0-9]/g, ''));
      if (price < bestPrice) {
        bestPrice = price;
        best = b;
      }
    }
    const offerId = await best.getAttribute('data-offer');
    await best.click();
    await expect(page.locator(`[data-testid="rare-offer"]:has([data-offer="${offerId}"])`)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('rare-dealer')).toContainText('Sold to');
    expect((await state(page)).vehicles.length).toBeGreaterThanOrEqual(2);
  }
  expect(errors).toEqual([]);
});

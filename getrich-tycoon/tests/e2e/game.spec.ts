// Browser end-to-end tests against the production build in Chromium.

import { expect, test } from '@playwright/test';
import { findAchievement, isCategoryUnlocked } from '../../shared/progression';
import { getModel } from '../../shared/vehicles';
import { GAME_URL, hold, moneyText, newPlayer, registerAndEnter, state, collectErrors, uniqueName } from './helpers';

const FIRST_BUY = findAchievement('first_purchase')!.reward;

test.describe.configure({ mode: 'serial' });

test('1. server starts and reports healthy', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(['sqlite', 'postgres']).toContain(body.db);
});

test('2-3. client loads in Chrome and the player connects', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(GAME_URL);
  await expect(page.getByTestId('auth-name')).toBeVisible();
  await expect(page).toHaveTitle('GetRich Tycoon');
  await registerAndEnter(page);
  const s = await state(page);
  expect(s.connected).toBe(true);
  expect(s.money).toBe(25_000);
  expect(s.marketListings.length).toBe(16);
  await expect(page.locator('#game-root canvas')).toBeVisible();
  await expect(page.getByTestId('hud-money')).toHaveText(moneyText(25_000));
  expect(errors).toEqual([]);
});

test('4-9, 13-14. move, buy, inventory, list, reject invalid, save/load', async ({ page }) => {
  const errors = collectErrors(page);
  await registerAndEnter(page);

  // 4. Movement (server-authoritative; position is reconciled from server snapshots)
  const before = (await state(page)).position;
  await hold(page, 'KeyW', 4000);
  await page.waitForTimeout(800);
  const after = (await state(page)).position;
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);

  // 5. Marketplace opens
  await page.getByTestId('dock-market').click();
  await expect(page.getByTestId('panel-market')).toBeVisible();
  await expect(page.getByTestId('market-buy').first()).toBeVisible();

  // 6. Buy the cheapest unlocked vehicle through the UI
  const listings = (await state(page)).marketListings.sort((a, b) => a.price - b.price);
  const enabled = page.locator('[data-testid=market-buy]:not([disabled])');
  const count = await enabled.count();
  expect(count).toBeGreaterThan(0);
  let chosen: { id: string; price: number; vehicleId: string } | undefined;
  for (const l of listings) {
    const btn = page.locator(`[data-testid=market-buy][data-listing="${l.id}"]:not([disabled])`);
    if ((await btn.count()) > 0) {
      chosen = l;
      await btn.click();
      break;
    }
  }
  expect(chosen).toBeTruthy();

  // 7. Money changes correctly (price + first-purchase achievement reward)
  const expectedMoney = 25_000 - chosen!.price + FIRST_BUY;
  await expect(page.getByTestId('hud-money')).toHaveText(moneyText(expectedMoney));
  expect((await state(page)).money).toBe(expectedMoney);

  // 8. Vehicle appears in inventory
  await page.getByTestId('panel-close').click();
  await page.getByTestId('dock-inventory').click();
  await expect(page.getByTestId('panel-inventory')).toBeVisible();
  const card = page.locator(`[data-vehicle="${chosen!.vehicleId}"]`);
  await expect(card).toBeVisible();

  // 9. Vehicle can be listed for sale (classifieds)
  await card.getByTestId('inv-list').click();
  // The UI suggests a price slightly above market value; the server caps asking prices at 2.5x value.
  const suggested = Number(await card.getByTestId('list-price').inputValue());
  expect(suggested).toBeGreaterThan(0);
  await card.getByTestId('list-confirm').click();
  await expect.poll(async () => (await state(page)).vehicles.find((v) => v.id === chosen!.vehicleId)?.status).toBe('listed');
  const listed = (await state(page)).vehicles.find((v) => v.id === chosen!.vehicleId)!;
  expect(listed.salePrice).toBe(suggested);
  const moneyAfterFee = (await state(page)).money!;
  expect(moneyAfterFee).toBe(expectedMoney - 150);
  await page.getByTestId('panel-close').click();

  // 13. Invalid transactions are rejected by the server and money is unchanged
  const results = await page.evaluate(async () => {
    const net = (window as unknown as { __getrich: { game: { net: { rpc: (m: string, p: unknown) => Promise<unknown> } } } }).__getrich.game.net;
    const out: string[] = [];
    for (const [m, p] of [
      ['market.buy', { listingId: 'lst_fake', expectedPrice: 1 }],
      ['bank.deposit', { amount: -1000 }],
      ['vehicle.list', { vehicleId: 'veh_notmine', price: 5000 }],
      ['dealership.upgrade', {}],
      ['market.buy', { listingId: '../../etc', expectedPrice: 'free' }],
    ] as const) {
      try {
        await net.rpc(m, p);
        out.push('accepted');
      } catch (e) {
        out.push((e as { code?: string }).code ?? 'error');
      }
    }
    return out;
  });
  expect(results).not.toContain('accepted');
  expect((await state(page)).money).toBe(moneyAfterFee);

  // 14. Save/load: reload the page, progress is restored from the server database
  await page.goto(GAME_URL);
  await page.waitForFunction(() => {
    const g = (window as unknown as { __getrich?: { state: () => { snapshots: number } } }).__getrich;
    return !!g && g.state().snapshots > 2;
  }, null, { timeout: 90_000, polling: 250 });
  const reloaded = await state(page);
  expect(reloaded.money).toBe(moneyAfterFee);
  expect(reloaded.vehicles.find((v) => v.id === chosen!.vehicleId)?.status).toBe('listed');
  await expect(page.getByTestId('hud-money')).toHaveText(moneyText(moneyAfterFee));
  expect(errors).toEqual([]);
});

test('10-12. two browser clients: connect, see each other, and synchronize', async ({ browser }) => {
  // Client A connects and enters the world
  const a = await newPlayer(browser, uniqueName('alice'));
  const aId = (await state(a.page)).playerId;
  // Client B connects
  const b = await newPlayer(browser, uniqueName('bob'));
  const bId = (await state(b.page)).playerId;

  // 11. They see each other
  await expect.poll(async () => (await state(b.page)).visiblePlayers, { timeout: 30_000 }).toContain(aId);
  await expect.poll(async () => (await state(a.page)).visiblePlayers, { timeout: 30_000 }).toContain(bId);

  // Client A moves; B observes A's position change through the server
  const seenBefore = await b.page.evaluate((id) => {
    const g = (window as unknown as { __getrich: { game: { entities: { players: Map<string, { buffer: { latest?: { x: number; z: number } } }> } } } }).__getrich.game;
    const l = g.entities.players.get(id)?.buffer.latest;
    return l ? { x: l.x, z: l.z } : null;
  }, aId);
  expect(seenBefore).not.toBeNull();
  await hold(a.page, 'KeyW', 4000);
  await expect
    .poll(
      async () =>
        b.page.evaluate(
          ([id, x0, z0]) => {
            const g = (window as unknown as { __getrich: { game: { entities: { players: Map<string, { buffer: { latest?: { x: number; z: number } } }> } } } }).__getrich.game;
            const l = g.entities.players.get(id as string)?.buffer.latest;
            return l ? Math.hypot(l.x - (x0 as number), l.z - (z0 as number)) : 0;
          },
          [aId, seenBefore!.x, seenBefore!.z] as const,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0.5);

  // 12. Client A buys a vehicle; client B sees the listing disappear from the market
  const listing = (await state(a.page)).marketListings
    .filter((l) => isCategoryUnlocked(getModel(l.modelId).category, 1))
    .sort((x, y) => x.price - y.price)[0]!;
  const bought = await a.page.evaluate(async (l) => {
    const net = (window as unknown as { __getrich: { game: { net: { rpc: (m: string, p: unknown) => Promise<{ price: number }> } } } }).__getrich.game.net;
    try {
      return await net.rpc('market.buy', { listingId: l.id, expectedPrice: l.price });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, listing);
  if ('price' in bought) {
    await expect.poll(async () => (await state(b.page)).marketListings.some((l) => l.id === listing.id), { timeout: 30_000 }).toBe(false);
    // A lists it; B sees it in the player listings via the Marketplace UI
    await a.page.evaluate(async (vehicleId) => {
      const net = (window as unknown as { __getrich: { game: { net: { rpc: (m: string, p: unknown) => Promise<unknown> } } } }).__getrich.game.net;
      await net.rpc('vehicle.list', { vehicleId, price: 1_234 });
    }, listing.vehicleId);
    await b.page.getByTestId('dock-market').click();
    await b.page.getByTestId('market-tab-players').click();
    await expect(b.page.locator(`[data-vehicle="${listing.vehicleId}"]`)).toBeVisible();
    await expect(b.page.locator(`[data-vehicle="${listing.vehicleId}"]`)).toContainText('$1,234');
  } else {
    throw new Error(`purchase failed: ${JSON.stringify(bought)}`);
  }

  // Chat synchronizes
  await a.page.keyboard.press('Enter');
  await a.page.getByTestId('chat-input').fill('hello from alice');
  await a.page.getByTestId('chat-input').press('Enter');
  await expect(b.page.getByTestId('chat-log')).toContainText('hello from alice');

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.page.context().close();
  await b.page.context().close();
});

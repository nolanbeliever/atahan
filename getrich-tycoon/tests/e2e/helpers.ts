import { expect, type Browser, type Page } from '@playwright/test';

export const GAME_URL = '/?gfx=low';

export interface DebugState {
  playerId: string;
  connected: boolean;
  snapshots: number;
  position: { x: number; z: number; rot: number };
  driving: string | null;
  money: number | null;
  bank: number | null;
  level: number | null;
  vehicles: { id: string; modelId: string; status: string; salePrice: number | null }[];
  otherPlayers: string[];
  visiblePlayers: string[];
  marketListings: { id: string; price: number; modelId: string; vehicleId: string }[];
  publicVehicles: { id: string; ownerId: string | null; status: string; salePrice: number | null }[];
  fps: number;
}

export function uniqueName(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 16);
}

export async function state(page: Page): Promise<DebugState> {
  return page.evaluate(() => (window as unknown as { __getrich: { state: () => DebugState } }).__getrich.state());
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

export async function registerAndEnter(page: Page, name = uniqueName('e2e')): Promise<string> {
  await page.goto(GAME_URL);
  await expect(page.getByTestId('auth-name')).toBeVisible();
  await page.getByTestId('auth-name').fill(name);
  await page.getByTestId('auth-password').fill('secret123');
  await page.getByTestId('auth-submit').click();
  await page.waitForFunction(() => {
    const g = (window as unknown as { __getrich?: { state: () => { connected: boolean; snapshots: number } } }).__getrich;
    return !!g && g.state().connected && g.state().snapshots > 2;
  }, null, { timeout: 90_000, polling: 250 });
  return name;
}

export async function newPlayer(browser: Browser, name?: string): Promise<{ page: Page; name: string; errors: string[] }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const n = await registerAndEnter(page, name);
  return { page, name: n, errors };
}

/** Hold a key for a duration (movement is simulated client-side at a fixed rate). */
export async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.locator('#game-root canvas').focus().catch(() => undefined);
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

export function moneyText(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

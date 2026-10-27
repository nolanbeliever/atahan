// Headless smoke test: boot the game, start singleplayer, capture errors + screenshots.
// Usage: node tools/smoke.cjs [url] [--mobile]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv.find(a => a.startsWith('http')) || 'http://localhost:4173/';
  const mobile = process.argv.includes('--mobile');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(800);
  const sfx = mobile ? '-m' : '';
  await page.screenshot({ path: `tools/shots/menu${sfx}.png` });
  const t0 = Date.now();
  await page.click('#btnNew');
  await page.waitForFunction(() => window.__dd.game && window.__dd.game.running, null, { timeout: 120000 });
  console.log('load ms', Date.now() - t0);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `tools/shots/start${sfx}.png` });
  const info = await page.evaluate(() => { const g = window.__dd.game; return { fps: g.fps, info: g.renderInfo, blocks: g.world.blocks.size, zombies: g.session.view.zombies.length, zviews: g.zviews.size, pos: [g.player.body.x, g.player.body.y, g.player.body.z], time: g.session.time }; });
  console.log(JSON.stringify(info));
  console.log(errs.slice(0, 30).join('\n'));
  await browser.close();
})();

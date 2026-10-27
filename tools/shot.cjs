// Screenshot helper: starts singleplayer, then runs scripted camera poses.
// Usage: node tools/shot.cjs <name> '<js run in page per pose>' ...
const { chromium } = require('playwright');
(async () => {
  const args = process.argv.slice(2);
  const mobile = args.includes('--mobile');
  const poses = args.filter(a => !a.startsWith('--'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:4173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('#btnNew');
  await page.waitForFunction(() => window.__dd.game && window.__dd.game.running, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < poses.length; i += 2) {
    const name = poses[i], js = poses[i + 1];
    const out = await page.evaluate(js);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `tools/shots/${name}.png` });
    if (out !== undefined) console.log(name, JSON.stringify(out));
  }
  console.log(errs.slice(0, 20).join('\n'));
  await browser.close();
})();

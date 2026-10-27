// Cloud save end-to-end: device A plays + saves, device B enters A's code and continues.
const { chromium } = require('playwright');
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const dev = async () => { const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.goto('http://localhost:8787/'); await p.evaluate(() => localStorage.setItem('dd_settings', JSON.stringify({ preset: 'low' }))); await p.reload(); return p; };
  const a = await dev();
  await a.waitForTimeout(1500);
  const codeA = await a.evaluate(() => document.getElementById('cloudCode').textContent);
  await a.click('#btnNew');
  await a.waitForFunction(() => window.__dd.game && window.__dd.game.running, null, { timeout: 120000 });
  const savedA = await a.evaluate(async () => {
    const g = window.__dd.game, p = g.player;
    p.inv.add('m4', 1); p.inv.add('medkit', 2); p.hp = 63;
    g.session.sim.time = 9.5; g.session.sim.day = 4;
    g.autosave(true);
    await new Promise(r => setTimeout(r, 1500));
    return { status: g.cloud.status, code: g.cloud.code };
  });
  ok('device A saves to the cloud', savedA.status === 'online' && savedA.code === codeA, JSON.stringify(savedA));
  const health = await a.evaluate(() => fetch('/health').then(r => r.json()));
  ok('server reports postgres storage', health.saves === 'postgres', JSON.stringify(health));

  const b = await dev();
  await b.waitForTimeout(1000);
  const codeB0 = await b.evaluate(() => document.getElementById('cloudCode').textContent);
  ok('device B gets its own code', codeB0 !== codeA, codeB0);
  await b.click('#btnSettings');
  await b.click('.tabs button[data-tab="game"]');
  await b.fill('#cloudInput', codeA.toLowerCase());
  await b.click('#cloudUse');
  await b.waitForTimeout(2000);
  const msg = await b.evaluate(() => document.getElementById('cloudStatus').textContent);
  ok('device B finds A\'s save by code', /day 4/.test(msg), msg);
  await b.click('#settingsBack');
  const cont = await b.evaluate(() => !document.getElementById('btnContinue').classList.contains('hidden'));
  ok('Continue appears on device B', cont);
  await b.click('#btnContinue');
  await b.waitForFunction(() => window.__dd.game && window.__dd.game.running, null, { timeout: 120000 });
  const state = await b.evaluate(() => { const g = window.__dd.game; return { m4: g.player.inv.has('m4'), medkits: g.player.inv.count('medkit'), hp: Math.round(g.player.hp), day: g.session.view.day }; });
  ok('device B continues A\'s game', state.m4 && state.medkits === 2 && state.hp === 63 && state.day === 4, JSON.stringify(state));
  ok('no page errors', a.errs.length + b.errs.length === 0, [...a.errs, ...b.errs].join(' | '));
  await browser.close();
})();

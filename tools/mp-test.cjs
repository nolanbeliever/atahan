// Multiplayer test: two browser clients against the real Node server.
// Start the server first: node server/server.js  (serves dist/ on :8787)
const { chromium } = require('playwright');
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const page = await ctx.newPage();
    page.errs = [];
    page.on('pageerror', e => page.errs.push(e.message));
    await page.goto('http://localhost:8787/');
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('dd_settings', JSON.stringify({ preset: 'low' })); });
    await page.reload();
    await page.click('#btnMP');
    await page.fill('#mp-name', name);
    await page.click('#mp-connect');
    await page.waitForSelector('#mp-lobby:not(.hidden)', { timeout: 10000 });
    return page;
  };
  const a = await mk('Alice');
  await a.click('#mp-create');
  await a.waitForFunction(() => window.__dd.game && window.__dd.game.running, null, { timeout: 120000 });
  const code = await a.evaluate(() => window.__dd.game.roomCode);
  ok('host creates room', /^[A-Z0-9]{5}$/.test(code || ''), code);

  const b = await mk('Bob');
  await b.click('#mp-refresh');
  await b.waitForTimeout(800);
  const listed = await b.evaluate(() => document.getElementById('mp-rooms').textContent);
  ok('room appears in session browser', listed.includes(code), listed.slice(0, 80));
  await b.fill('#mp-code', code);
  await b.click('#mp-join');
  await b.waitForFunction(() => window.__dd.game && window.__dd.game.running, null, { timeout: 120000 });
  await b.waitForTimeout(2500);

  const seen = await Promise.all([a, b].map(p => p.evaluate(() => { const g = window.__dd.game; return { me: g.session.id, players: [...g.session.view.players.values()].map(p => p.name), zombies: g.session.view.zombies.length, views: g.pviews.size }; })));
  ok('both clients see both players', seen[0].players.length === 2 && seen[1].players.length === 2, JSON.stringify(seen));
  ok('remote player avatar rendered', seen[0].views === 1 && seen[1].views === 1);

  // movement sync: Bob walks, Alice sees him move
  const bobStart = await a.evaluate(() => { const g = window.__dd.game; const o = [...g.session.view.players.values()].find(p => p.name === 'Bob'); return [o.x, o.z]; });
  await b.evaluate(() => { const g = window.__dd.game; g.player.yaw = Math.PI / 2; g.input.keys.add('up'); });
  await b.waitForTimeout(6000);
  await b.evaluate(() => window.__dd.game.input.keys.delete('up'));
  await a.waitForTimeout(800);
  const bobEnd = await a.evaluate(() => { const g = window.__dd.game; const o = [...g.session.view.players.values()].find(p => p.name === 'Bob'); return [o.x, o.z]; });
  const moved = Math.hypot(bobEnd[0] - bobStart[0], bobEnd[1] - bobStart[1]);
  ok('player movement synchronised', moved > 0.5, `${moved.toFixed(1)} m`);

  // shared world: Alice opens a door, Bob sees it open
  const door = await a.evaluate(async () => {
    const g = window.__dd.game; const d = g.W.doors.find(d => Math.hypot(d.x - g.player.body.x, d.z - g.player.body.z) < 60 && !d.open);
    g.player.spawn(d.x + d.dz * 1.0 + d.dx * 0.8, d.y0, d.z + d.dx * 1.0 + d.dz * 0.8, 0);
    await new Promise(r => setTimeout(r, 600));
    g.session.door(d.id);
    await new Promise(r => setTimeout(r, 800));
    return { id: d.id, open: d.open };
  });
  await b.waitForTimeout(800);
  const bobDoor = await b.evaluate((id) => window.__dd.game.W.doors[id].open, door.id);
  ok('door state shared', door.open && bobDoor, JSON.stringify(door));

  // shared loot: Alice empties a container, Bob sees it empty
  const lootA = await a.evaluate(async () => {
    const g = window.__dd.game, p = g.player;
    const c = g.W.containers.find(c => c.name === 'Armory locker');
    p.spawn(c.x, 0, c.z + 1.0, 0);
    await new Promise(r => setTimeout(r, 800));
    g.session.open(c.id);
    await new Promise(r => setTimeout(r, 1000));
    const items = g.session.contItems(c.id) || [];
    for (let i = items.length - 1; i >= 0; i--) g.session.take(c.id, i, items[i].n);
    await new Promise(r => setTimeout(r, 1200));
    return { id: c.id, took: items.map(i => i.id), hasPistol: p.inv.has('pistol') };
  });
  await b.waitForTimeout(600);
  const lootB = await b.evaluate((id) => window.__dd.game.session.contItems(id), lootA.id);
  ok('server-side loot granted to the taker', lootA.hasPistol, JSON.stringify(lootA));
  ok('container emptied for the other player', Array.isArray(lootB) && lootB.length === 0, JSON.stringify(lootB));

  // shared zombies: same ids/positions on both clients
  const zs = await Promise.all([a, b].map(p => p.evaluate(() => window.__dd.game.session.view.zombies.filter(z => !z.dead).map(z => [z.id, Math.round(z.x), Math.round(z.z)]))));
  const common = zs[0].filter(z => zs[1].some(w => w[0] === z[0]));
  ok('zombies are shared server entities', common.length > 0, `${zs[0].length}/${zs[1].length} visible, ${common.length} common`);

  // server-validated combat: Alice shoots a zombie the server spawned next to her
  const shot = await a.evaluate(async () => {
    const g = window.__dd.game, p = g.player;
    let z = null;
    // walk out to the street and make noise so a zombie comes into the open
    p.spawn(232, 0, 150, 0);
    for (let i = 0; i < 150 && !z; i++) {
      if (i % 10 === 0) g.session.noise(p.body.x, p.body.z, 40);
      z = g.session.view.zombies.find(z => !z.dead && Math.hypot(z.x - p.body.x, z.z - p.body.z) < 25 && g.W.nav.los(p.body.x, p.body.z, z.x, z.z));
      if (!z) await new Promise(r => setTimeout(r, 200));
    }
    if (!z) return { none: true };
    p.equip('pistol'); p.inv.mag.pistol = 12;
    const k0 = g.stats.kills;
    const log = []; const oe = g.onEvent.bind(g); g.onEvent = (e) => { if (['shot', 'zhit', 'zdie', 'corr'].includes(e.t)) log.push(e.t === 'shot' ? 'shot:' + JSON.stringify(e.hits.map(h => h.z_ !== undefined ? 'Z' + h.z_ : h.miss ? 'miss' : 'wall')) : e.t); oe(e); };
    window.__shotlog = log;
    for (let i = 0; i < 24 && !z.dead; i++) {
      const eye = [p.body.x, p.body.y + 1.6, p.body.z];
      g.session.fire('pistol', eye, [z.x - eye[0], z.y + 1.2 - eye[1], z.z - eye[2]]);
      await new Promise(r => setTimeout(r, 300));
    }
    return { dead: z.dead, kills: g.stats.kills - k0, id: z.id, d: Math.round(Math.hypot(z.x - p.body.x, z.z - p.body.z)), log: log.slice(0, 8), pos: [Math.round(p.body.x), Math.round(p.body.z)] };
  });
  ok('server resolves hits and kills', shot.dead === true, JSON.stringify(shot));
  if (shot.id) { const bz = await b.evaluate((id) => { const z = window.__dd.game.session.zmap.get(id); return z ? z.dead : 'not-visible'; }, shot.id); ok('kill replicated to other client', bz === true || bz === 'not-visible', String(bz)); }

  // disconnect handling
  await b.close();
  await a.waitForTimeout(1500);
  const after = await a.evaluate(() => window.__dd.game.session.view.players.size);
  ok('disconnect removes player', after === 1, String(after));
  ok('no page errors', a.errs.length === 0, a.errs.slice(0, 3).join(' | '));
  await browser.close();
})();

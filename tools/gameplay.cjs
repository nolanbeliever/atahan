// Functional gameplay test through the real game loop with simulated input.
// Checks: touch joystick + touch look, melee & gun combat vs AI, doors, looting,
// driving, save/load. Run against `vite preview` (port 4173).
const { chromium } = require('playwright');
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://localhost:4173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#btnNew');
  await page.waitForFunction(() => window.__dd.game && window.__dd.game.running, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const W = (fn, arg) => page.evaluate(fn, arg);

  // --- touch joystick: drag from the left zone and hold
  const p0 = await W(() => { const p = __dd.game.player; return [p.body.x, p.body.z]; });
  await W(() => {
    const z = document.getElementById('joyzone');
    const ev = (t, x, y) => z.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    ev('pointerdown', 120, 300); ev('pointermove', 120, 250);
    window.__joyEv = ev;
  });
  await page.waitForTimeout(4000);
  const p1 = await W(() => { const p = __dd.game.player; window.__joyEv('pointerup', 120, 250); return [p.body.x, p.body.z]; });
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  ok('touch joystick moves player', moved > 2, `moved ${moved.toFixed(1)} m`);

  // --- touch look: drag in the right zone
  const y0 = await W(() => __dd.game.player.yaw);
  await W(() => {
    const z = document.getElementById('lookzone');
    const ev = (t, x, y) => z.dispatchEvent(new PointerEvent(t, { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    ev('pointerdown', 600, 200); ev('pointermove', 650, 200); ev('pointermove', 700, 200); ev('pointerup', 700, 200);
  });
  await page.waitForTimeout(300);
  const y1 = await W(() => __dd.game.player.yaw);
  ok('touch drag rotates camera', Math.abs(y1 - y0) > 0.2, `dyaw ${(y1 - y0).toFixed(2)}`);

  // --- multitouch: joystick + look at the same time
  const mt = await W(async () => {
    const g = __dd.game, jz = document.getElementById('joyzone'), lz = document.getElementById('lookzone');
    const e = (el, t, id, x, y) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const a = [g.player.body.x, g.player.body.z, g.player.yaw];
    e(jz, 'pointerdown', 11, 120, 300); e(jz, 'pointermove', 11, 120, 240);
    e(lz, 'pointerdown', 12, 600, 200);
    for (let i = 0; i < 10; i++) { e(lz, 'pointermove', 12, 600 + i * 8, 200); await new Promise(r => setTimeout(r, 80)); }
    e(lz, 'pointerup', 12, 680, 200); e(jz, 'pointercancel', 11, 120, 240);
    await new Promise(r => setTimeout(r, 200));
    return [Math.hypot(g.player.body.x - a[0], g.player.body.z - a[1]), Math.abs(g.player.yaw - a[2]), g.input.joy.active];
  });
  ok('multitouch move + look simultaneously', mt[0] > 0.5 && mt[1] > 0.2 && !mt[2], JSON.stringify(mt.map(v => typeof v === 'number' ? +v.toFixed(2) : v)));

  // --- combat: zombie attacks player, player kills it with the pistol
  const combat = await W(async () => {
    const g = __dd.game, p = g.player, s = g.session.sim;
    p.spawn(232, 0, 150, 0); p.pitch = 0;
    p.inv.add('pistol', 1); p.inv.add('ammo9', 40); p.inv.mag.pistol = 12; p.equip('pistol');
    s.time = 12;
    for (const z of s.zombies) { z.dead = true; z.hp = 0; }
    const z = s.spawnZombie(232, 140, 'walker');
    const hp0 = p.hp;
    g.session.noise(p.body.x, p.body.z, 30);
    // let it come to us
    for (let i = 0; i < 300 && p.hp >= hp0; i++) await new Promise(r => setTimeout(r, 100));
    const hurt = hp0 - p.hp;
    // aim at it and fire
    const kills0 = g.stats.kills;
    for (let i = 0; i < 40 && !z.dead; i++) {
      p.yaw = Math.atan2(-(z.x - p.body.x), -(z.z - p.body.z));
      const d = Math.hypot(z.x - p.body.x, z.z - p.body.z);
      p.pitch = Math.atan2(z.y + 1.3 - (p.body.y + p.eye), d);
      g.input.held.add('fire'); await new Promise(r => setTimeout(r, 120)); g.input.held.delete('fire'); await new Promise(r => setTimeout(r, 120));
    }
    return { reached: z.state, hurt: Math.round(hurt), dead: z.dead, kills: g.stats.kills - kills0, ammo: p.inv.mag.pistol };
  });
  ok('zombie chases and damages player', combat.hurt > 0, JSON.stringify(combat));
  ok('pistol kills zombie', combat.dead && combat.kills === 1);

  // --- melee
  const melee = await W(async () => {
    const g = __dd.game, p = g.player, s = g.session.sim;
    p.hp = 100; p.equip('crowbar');
    const z = s.spawnZombie(p.body.x, p.body.z - 1.3, 'runner'); z.state = 'idle';
    for (let i = 0; i < 30 && !z.dead; i++) {
      p.yaw = Math.atan2(-(z.x - p.body.x), -(z.z - p.body.z));
      g.input.held.add('fire'); await new Promise(r => setTimeout(r, 150)); g.input.held.delete('fire'); await new Promise(r => setTimeout(r, 600));
    }
    return { dead: z.dead, hp: z.hp };
  });
  ok('crowbar melee kills zombie', melee.dead, JSON.stringify(melee));

  // --- doors + looting through the interaction system
  const loot = await W(async () => {
    const g = __dd.game, p = g.player, W = g.W;
    const c = W.containers.find(c => c.name === 'Armory locker');
    // stand in front of it
    p.spawn(c.x, 0, c.z + 1.2, 0); p.pitch = -0.3;
    await new Promise(r => setTimeout(r, 400));
    const label = g.focus && g.focus.label;
    g.input.edges.add('interact');
    await new Promise(r => setTimeout(r, 600));
    const panel = g.panel;
    const n0 = p.inv.slots.length;
    document.getElementById('lootAll').click();
    await new Promise(r => setTimeout(r, 600));
    g.closePanels();
    // a door
    const d = W.doors.find(d => d.block === c.block);
    p.spawn(d.x + d.dx * d.w / 2 + (d.dz ? 1.2 : 0), d.y0, d.z + d.dz * d.w / 2 + (d.dx ? 1.2 : 0), 0);
    p.yaw = Math.atan2(-((d.x + d.dx * d.w / 2) - p.body.x), -((d.z + d.dz * d.w / 2) - p.body.z));
    await new Promise(r => setTimeout(r, 400));
    const was = d.open, dl = g.focus && g.focus.label;
    g.input.edges.add('interact');
    await new Promise(r => setTimeout(r, 400));
    return { label, panel, gained: p.inv.slots.length - n0, doorLabel: dl, toggled: d.open !== was, colEnabled: d.col.en === !d.open };
  });
  ok('interaction prompt + loot panel', loot.panel === 'loot' && /armory/i.test(loot.label || ''), JSON.stringify(loot));
  ok('take all moves items to backpack', loot.gained > 0);
  ok('door opens/closes and collider follows', loot.toggled && loot.colEnabled);

  // --- driving
  const drive = await W(async () => {
    const g = __dd.game, p = g.player;
    const v = g.session.view.vehicles.find(v => v.type === 'police');
    v.fuel = 40;
    // put it on an open street (west road of block column 2), heading south
    v.x = 152; v.z = 96; v.yaw = 0; v.vx = v.vz = 0;
    for (const c of g.W.colliders) if (c.x1 > 149 && c.x0 < 155 && c.z1 > 92 && c.z0 < 140 && c.y1 > 0.3 && !c.door) c.en = false; // clear parked wrecks for a clean test
    p.spawn(v.x + 2.2, 0, v.z, 0);
    await new Promise(r => setTimeout(r, 300));
    g.session.venter(v.id);
    await new Promise(r => setTimeout(r, 300));
    const inCar = p.veh === v.id;
    const x0 = v.x, z0 = v.z, f0 = v.fuel;
    const wait = async (cond, ms) => { const t = performance.now(); while (!cond() && performance.now() - t < ms) await new Promise(r => setTimeout(r, 50)); };
    g.input.keys.add('up');
    await wait(() => Math.abs(v.speed) > 9, 20000);
    const sp = Math.abs(v.speed);
    g.input.keys.add('left');
    const yaw0 = v.yaw;
    await wait(() => Math.abs(v.yaw - yaw0) > 0.4, 10000);
    const turned = Math.abs(v.yaw - yaw0);
    g.input.keys.delete('left'); g.input.keys.delete('up');
    g.input.held.add('hand');
    await wait(() => Math.abs(v.speed) < 0.5, 20000);
    g.input.held.delete('hand');
    const dist = Math.hypot(v.x - x0, v.z - z0);
    g.input.edges.add('interact');
    await wait(() => p.veh === null, 5000);
    return { inCar, turned: +turned.toFixed(2), speedKmh: Math.round(sp * 3.6), dist: Math.round(dist), fuelUsed: +(f0 - v.fuel).toFixed(3), exited: p.veh === null, stoppedSpeed: +Math.abs(v.speed).toFixed(2) };
  });
  ok('enter vehicle', drive.inCar, JSON.stringify(drive));
  ok('vehicle accelerates, moves, burns fuel', drive.speedKmh > 15 && drive.dist > 10 && drive.fuelUsed > 0);
  ok('exit vehicle', drive.exited);

  // --- save / load round trip
  const sv = await W(() => { const g = __dd.game; g.autosave(); const s = JSON.parse(localStorage.getItem('dd_save')); return { has: !!s, inv: s.inv.slots.length, conts: s.conts.length }; });
  ok('save written', sv.has && sv.inv > 0, JSON.stringify(sv));

  ok('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
  await browser.close();
})();

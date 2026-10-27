// In-page probe: ground brightness over time, then with bump mapping removed.
(async () => {
  const g = __dd.game;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  const gl = g.renderer.getContext();
  const out = [];
  const px = () => { g.frame(performance.now()); const b = new Uint8Array(4); gl.readPixels(640, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return b[0] + b[1] + b[2]; };
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    out.push([px(), g.indoor ? 'in' : 'out', g.world.blocks.size, g.pool.filter(p => p.l.visible).length]);
  }
  const a = g.mats.get('asphalt');
  const bm = a.bumpMap; a.bumpMap = null; a.needsUpdate = true;
  await new Promise(r => setTimeout(r, 300));
  out.push(['noBump', px()]);
  a.bumpMap = bm; a.bumpScale = 0.05; a.needsUpdate = true;
  await new Promise(r => setTimeout(r, 300));
  out.push(['bump0.05', px()]);
  return out;
})()

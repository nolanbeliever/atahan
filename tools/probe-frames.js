// In-page probe: ground brightness over successive frames at noon.
(() => {
  const g = __dd.game;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  const gl = g.renderer.getContext();
  const out = [];
  let t = performance.now();
  for (let i = 0; i < 30; i++) {
    t += 16;
    g.frame(t);
    const b = new Uint8Array(4); gl.readPixels(640, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    out.push(b[0] + b[1] + b[2]);
  }
  const s = g.sky.sun;
  return { out, sun: [s.position.x, s.position.y, s.position.z].map(v => v.toFixed(1)), tgt: [s.target.position.x, s.target.position.z], cast: s.castShadow, map: !!s.shadow.map, mapSize: s.shadow.mapSize.x, int: s.intensity };
})()

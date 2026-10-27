// In-page probe: which block / mesh darkens the ground when it casts shadows?
(() => {
  const g = __dd.game;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  const gl = g.renderer.getContext();
  const px = () => { let v; for (let i = 0; i < 2; i++) { g.frame(performance.now()); const b = new Uint8Array(4); gl.readPixels(640, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); v = b[0] + b[1] + b[2]; } return v; };
  const out = { base: px() };
  const keyOf = (m) => { for (const [k, v] of g.mats.cache) if (v === m) return k; return m.type; };
  for (const [id, b] of g.world.blocks) {
    const ms = []; b.group.traverse(o => { if (o.isMesh && o.castShadow) { ms.push(o); o.castShadow = false; } });
    const v = px();
    for (const m of ms) m.castShadow = true;
    if (v !== out.base) {
      out['block' + id] = v;
      for (const m of ms) { m.castShadow = false; const w = px(); m.castShadow = true; if (w !== out.base) out['b' + id + ':' + keyOf(m.material) + (m.isInstancedMesh ? ':inst' : '') + ':' + m.geometry.attributes.position.count] = w; }
    }
  }
  return out;
})()

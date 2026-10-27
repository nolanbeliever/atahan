// In-page probe: which material group darkens the ground pixel when it casts shadows?
(() => {
  const g = __dd.game;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  const gl = g.renderer.getContext();
  const meshes = [];
  g.world.root.traverse(o => { if (o.isMesh && o.castShadow) meshes.push(o); });
  const keyOf = (m) => { for (const [k, v] of g.mats.cache) if (v === m.material) return k; return m.isInstancedMesh ? 'inst' : 'other'; };
  const keys = [...new Set(meshes.map(keyOf))];
  const px = () => { g.frame(performance.now()); const b = new Uint8Array(4); gl.readPixels(640, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return b[0] + b[1] + b[2]; };
  const out = { base: px() };
  for (const k of keys) { for (const m of meshes) m.castShadow = keyOf(m) !== k; out[k] = px(); }
  for (const m of meshes) m.castShadow = true;
  return out;
})()

// In-page probe: hide scene meshes one by one at eye level; report which one lights the ground.
(() => {
  const g = __dd.game;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  g.frame(performance.now());
  g.renderer.autoClear = true;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 36;
  const cx = cv.getContext('2d');
  const avg = () => {
    g.renderer.render(g.scene, g.camera);
    cx.drawImage(g.renderer.domElement, 0, 0, 64, 36);
    const d = cx.getImageData(16, 24, 32, 10).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return Math.round(s / (d.length / 4));
  };
  const out = { base: avg() };
  const keyOf = (m) => { for (const [k, v] of g.mats.cache) if (v === m) return k; return m.type; };
  const all = []; g.scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible) all.push(o); });
  out.n = all.length;
  for (const o of all) {
    o.visible = false;
    const v = avg();
    o.visible = true;
    if (Math.abs(v - out.base) > 20) out[(o.isMesh ? keyOf(o.material) : o.type) + '#' + o.id + (o.isInstancedMesh ? ':inst' : '') + ':' + (o.geometry.attributes.position ? o.geometry.attributes.position.count : 0)] = v;
  }
  return out;
})()

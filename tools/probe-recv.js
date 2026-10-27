(() => {
  const g = __dd.game, s = g.sky.sun;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  const gl = g.renderer.getContext();
  let t = performance.now();
  const px = () => { let v = 0; for (let i = 0; i < 3; i++) { t += 16; g.frame(t); const b = new Uint8Array(4); gl.readPixels(640, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); v = b[0] + b[1] + b[2]; } return v; };
  const out = { base: px() };
  const zs = []; g.scene.traverse(o => { if (o.isSkinnedMesh) zs.push(o); });
  for (const z of zs) z.castShadow = false; out.noSkinned = px(); for (const z of zs) z.castShadow = true;
  const others = []; g.scene.traverse(o => { if (o.isMesh && o.castShadow && !zs.includes(o)) { let p = o, inWorld = false; while (p) { if (p === g.world.root) inWorld = true; p = p.parent; } if (!inWorld) others.push(o.type + ':' + (o.geometry && o.geometry.type)); } });
  out.otherCasters = others.slice(0, 20);
  s.castShadow = false; out.sunNoShadow = px(); s.castShadow = true;
  out.nSkinned = zs.length;
  return out;
})()

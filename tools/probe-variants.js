// In-page probe: ground brightness under different shadow settings.
(() => {
  const THREE_SIDES = { front: 0, back: 1, double: 2 };
  const g = __dd.game, s = g.sky.sun;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  const gl = g.renderer.getContext();
  let t = performance.now();
  const px = () => { let v = 0; for (let i = 0; i < 3; i++) { t += 16; g.frame(t); const b = new Uint8Array(4); gl.readPixels(640, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); v = b[0] + b[1] + b[2]; } return v; };
  const mats = []; g.world.root.traverse(o => { if (o.isMesh && !mats.includes(o.material)) mats.push(o.material); });
  const out = { base: px() };
  s.shadow.bias = -0.005; out.bias005 = px(); s.shadow.bias = -0.0004;
  s.shadow.normalBias = 0.3; out.nb03 = px(); s.shadow.normalBias = 0.04;
  for (const m of mats) m.shadowSide = THREE_SIDES.back; out.sideBack = px();
  for (const m of mats) m.shadowSide = THREE_SIDES.front; out.sideFront = px();
  for (const m of mats) m.shadowSide = null; out.sideNull = px();
  g.renderer.shadowMap.type = 0; for (const m of mats) m.needsUpdate = true; out.basic = px();
  g.renderer.shadowMap.type = 1; for (const m of mats) m.needsUpdate = true; out.pcf = px();
  g.renderer.shadowMap.type = 2; for (const m of mats) m.needsUpdate = true; out.pcfsoft = px();
  s.shadow.camera.far = 400; s.shadow.camera.updateProjectionMatrix(); out.far400 = px();
  out.nmats = mats.length;
  out.cam = [g.camera.position.x.toFixed(1), g.camera.position.y.toFixed(2), g.camera.position.z.toFixed(1)];
  return out;
})()

// In-page probe: does the bloom composer / viewmodel pass cause the dark ground?
(() => {
  const g = __dd.game;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  const gl = g.renderer.getContext();
  const px = () => { let v; for (let i = 0; i < 3; i++) { g.frame(performance.now()); const b = new Uint8Array(4); gl.readPixels(640, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); v = b[0] + b[1] + b[2]; } return v; };
  const out = { base: px(), composer: !!g.composer };
  const c = g.composer; g.composer = null; out.noComposer = px(); g.composer = c;
  out.back = px();
  const vis = g.player.vm.group.visible; g.player.vm.group.visible = false; g.player.vm.group.visible = vis;
  const lvm = g.player.vm; const saved = lvm.group; lvm.group = { visible: false }; out.noVM = px(); lvm.group = saved;
  return out;
})()

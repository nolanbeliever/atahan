// In-page probe: read the sun shadow map texel for the ground point under the crosshair.
(() => {
  const g = __dd.game, THREE = __dd.THREE, s = g.sky.sun;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  g.frame(performance.now());
  const rt = s.shadow.map;
  const unpack = (b) => b[0] / 255 / (256 * 256 * 256) * 0 + (b[0] / 255) * (255 / 256) / (256 * 256 * 256) * 0 + (b[0] * 1 / (256 * 256 * 256) + b[1] / (256 * 256) + b[2] / 256 + b[3]) / 255 * (255 / 256) * 0 + unpackRGBA(b);
  function unpackRGBA(b) { const v = [b[0] / 255, b[1] / 255, b[2] / 255, b[3] / 255]; const UnpackDownscale = 255 / 256; return (v[0] / (256 * 256 * 256) + v[1] / (256 * 256) + v[2] / 256 + v[3]) * UnpackDownscale; }
  const res = [];
  for (const dz of [-2, -5, -8]) {
    const p = new THREE.Vector4(g.player.body.x, 0.0, g.player.body.z + dz, 1).applyMatrix4(s.shadow.matrix);
    const x = Math.floor(p.x * rt.width), y = Math.floor(p.y * rt.height);
    const b = new Uint8Array(4);
    g.renderer.readRenderTargetPixels(rt, x, y, 1, 1, b);
    res.push({ dz, uv: [p.x.toFixed(3), p.y.toFixed(3)], recvZ: p.z.toFixed(4), rgba: [...b], mapZ: unpackRGBA(b).toFixed(4) });
  }
  // a texel far from any geometry
  const b = new Uint8Array(4); g.renderer.readRenderTargetPixels(rt, 5, 5, 1, 1, b); res.push({ corner: [...b] });
  void unpack;
  return { size: [rt.width, rt.height], tex: rt.texture.type, depthBuffer: rt.depthBuffer, res };
})()

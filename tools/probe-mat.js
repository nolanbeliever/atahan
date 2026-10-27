// In-page probe: isolate the ground mesh's shading.
(() => {
  const g = __dd.game, THREE = __dd.THREE;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.renderer.setAnimationLoop(null);
  const gl = g.renderer.getContext();
  const px = () => { let v; for (let i = 0; i < 2; i++) { g.frame(performance.now()); const b = new Uint8Array(4); gl.readPixels(640, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); v = b[0] + b[1] + b[2]; } return v; };
  const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, -(570 / 360 - 1)), g.camera);
  const objs = []; g.world.root.traverse(x => { if (x.isMesh) objs.push(x); });
  const hit = rc.intersectObjects(objs, false)[0];
  const m = hit.object, orig = m.material;
  const out = { base: px(), lights: [] };
  m.receiveShadow = false; out.noRecv = px(); m.receiveShadow = true;
  m.material = new THREE.MeshStandardMaterial({ color: 0x808080 }); out.plainStd = px();
  m.material = new THREE.MeshLambertMaterial({ color: 0x808080 }); out.lambert = px();
  m.material = new THREE.MeshBasicMaterial({ color: 0x808080 }); out.basic = px();
  m.material = orig;
  // hide pool lights / spot lights
  for (const p of g.pool) p.l.visible = false; const sp = g.player.flash.visible; g.player.flash.visible = false; g.headlight.visible = false;
  g.pool.forEach(p => { p.l.intensity = 0; });
  const save = g.updateLights; g.updateLights = () => {};
  out.noPointLights = px();
  g.updateLights = save; g.player.flash.visible = sp; g.headlight.visible = true;
  g.scene.traverse(o => { if (o.isLight) out.lights.push(`${o.type} i=${o.intensity.toFixed ? o.intensity.toFixed(2) : o.intensity} v=${o.visible} cs=${o.castShadow}`); });
  out.mesh = { geoVerts: m.geometry.attributes.position.count, normal0: [...m.geometry.attributes.normal.array.slice(0, 3)], col0: [...m.geometry.attributes.color.array.slice(0, 3)] };
  return out;
})()

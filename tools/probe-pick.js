(() => {
  const g = __dd.game, THREE = __dd.THREE;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.frame(performance.now() + 16);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0, -(570 / 360 - 1)), g.camera);
  const objs = []; g.scene.traverse(x => { if (x.isMesh && x.visible) objs.push(x); });
  const hits = rc.intersectObjects(objs, false).slice(0, 4);
  const keyOf = (m) => { for (const [k, v] of g.mats.cache) if (v === m) return k; return m.type + ':' + (m.color ? m.color.getHexString() : ''); };
  return hits.map(h => ({ d: h.distance.toFixed(2), p: h.point.toArray().map(v => v.toFixed(2)), mat: keyOf(h.object.material), recv: h.object.receiveShadow, col: h.face && h.object.geometry.attributes.color ? [0,1,2].map(i => h.object.geometry.attributes.color.array[h.face.a * 3 + i].toFixed(2)) : null, n: h.face && h.face.normal.toArray() }));
})()

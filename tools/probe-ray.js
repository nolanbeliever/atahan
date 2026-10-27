// In-page probe: what mesh lies between the ground in front of the player and the sun?
(() => {
  const g = __dd.game, s = g.sky.sun, THREE = __dd.THREE;
  g.session.sim.time = 12; g.player.pitch = -0.3;
  g.frame(performance.now() + 16);
  const o = new THREE.Vector3(g.player.body.x, 0.05, g.player.body.z - 5);
  const dir = s.position.clone().sub(s.target.position).normalize();
  const rc = new THREE.Raycaster(o, dir, 0, 300);
  const objs = []; g.scene.traverse(x => { if ((x.isMesh || x.isInstancedMesh) && x.castShadow && x.visible) objs.push(x); });
  const hits = rc.intersectObjects(objs, false).slice(0, 5);
  const keyOf = (m) => { for (const [k, v] of g.mats.cache) if (v === m) return k; return m.type + (m.name || ''); };
  return { dir: dir.toArray().map(v => v.toFixed(2)), n: objs.length, hits: hits.map(h => ({ d: h.distance.toFixed(2), p: h.point.toArray().map(v => v.toFixed(1)), mat: keyOf(h.object.material), inst: !!h.object.isInstancedMesh, parent: h.object.parent && h.object.parent.type, skinned: !!h.object.isSkinnedMesh })) };
})()

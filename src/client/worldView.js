// Streams city blocks in and out around the player. Geometry for each block is built
// in a Web Worker (falls back to the main thread), uploaded as merged meshes per
// material, and disposed from the GPU when the player moves away.
import * as THREE from 'three';
import { buildBlockGeometry, SIZE } from '../shared/world.js';
import { vehicleGeometry, propGeometries } from './models.js';
import { hash2 } from '../shared/util.js';

const NO_SHADOW = new Set(['glass', 'glassBlue', 'paint', 'paintY', 'blood', 'stain', 'puddle', 'crack', 'patch', 'rug', 'bodybag', 'glassShards', 'helipad', 'lamp', 'lampCool', 'emRed', 'emBlue', 'fence']);
const CAR_KINDS = ['car', 'police', 'van', 'truck', 'bus', 'ambulance'];

export class WorldView {
  constructor(scene, W, mats, settings) {
    this.scene = scene; this.W = W; this.mats = mats; this.settings = settings;
    this.blocks = new Map();
    this.pending = new Map();
    this.timer = 0;
    this.root = new THREE.Group(); scene.add(this.root);
    this.props = propGeometries();
    this.vgeo = {};
    this.propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1, map: mats.get('solid').map });
    this.carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.45 });
    this.headOn = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 2 });
    this.headOff = new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.6 });
    this.leafMat = this.propMat;
    this.doorMeshes = new Map();
    this.lightSpots = [];
    this.inflight = 0;
    try {
      this.worker = new Worker(new URL('./blockWorker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._onBlock(e.data.id, e.data.parts);
      this.worker.onerror = () => { this.worker = null; };
    } catch (e) { this.worker = null; }
    this._doorGeo = new Map();
    this._skyline();
  }

  _skyline() {
    // ground beyond the wall + silhouettes of the rest of the city
    const g = new THREE.PlaneGeometry(2400, 2400);
    g.rotateX(-Math.PI / 2);
    const gm = this.mats.get('dirt').clone(); gm.vertexColors = false; gm.color = new THREE.Color(0x5a5048);
    gm.map = gm.map.clone(); gm.map.repeat.set(200, 200); gm.map.needsUpdate = true;
    // Kept well below street level (and pushed back in depth) so it can never z-fight
    // with the city ground at grazing eye-level angles; the quarantine wall hides the gap.
    gm.polygonOffset = true; gm.polygonOffsetFactor = 4; gm.polygonOffsetUnits = 8;
    const ground = new THREE.Mesh(g, gm);
    ground.position.set(SIZE / 2, -0.6, SIZE / 2);
    ground.receiveShadow = false;
    this.scene.add(ground);
    const n = 140;
    const bg = new THREE.BoxGeometry(1, 1, 1); bg.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 1, map: this.mats.get('concrete').map });
    const im = new THREE.InstancedMesh(bg, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = SIZE / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash2(i, 3) * 0.04;
      const r = SIZE * 0.72 + hash2(i, 7) * 160;
      p.set(c + Math.cos(a) * r, 0, c + Math.sin(a) * r);
      s.set(20 + hash2(i, 1) * 35, 12 + hash2(i, 2) * (hash2(i, 9) < 0.15 ? 90 : 40), 20 + hash2(i, 5) * 35);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      m.compose(p, q, s); im.setMatrixAt(i, m);
      im.setColorAt(i, new THREE.Color().setHSL(0.08, 0.05, 0.18 + hash2(i, 11) * 0.12));
    }
    this.scene.add(im);
    this.skyline = im;
  }

  cellDist(c, x, z) {
    const dx = Math.max(c.x0 - x, 0, x - c.x1), dz = Math.max(c.z0 - z, 0, z - c.z1);
    return Math.hypot(dx, dz);
  }

  update(dt, px, pz, camPos) {
    this.timer -= dt;
    const g = this.settings.gfx;
    if (this.timer <= 0) {
      this.timer = 0.3;
      const want = [];
      for (const c of this.W.cells) {
        const d = this.cellDist(c, px, pz);
        if (d < g.loadRadius && !this.blocks.has(c.id) && !this.pending.has(c.id)) want.push([d, c]);
        if (d > g.loadRadius + 45 && this.blocks.has(c.id)) this._unload(c.id);
      }
      want.sort((a, b) => a[0] - b[0]);
      for (const [, c] of want) {
        if (this.inflight >= 2) break;
        this._request(c);
      }
    }
    // LOD: interior detail only near the camera
    for (const b of this.blocks.values()) {
      const d = this.cellDist(b.cell, camPos.x, camPos.z);
      b.lod1.visible = d < g.detailDist;
      b.group.visible = d < g.drawDist + 40;
    }
    // door animation
    for (const [id, dm] of this.doorMeshes) {
      const d = this.W.doors[id];
      const target = dm.base + (d.open ? dm.swing * Math.PI * 0.48 : 0);
      dm.pivot.rotation.y += (target - dm.pivot.rotation.y) * Math.min(1, dt * 8);
    }
  }

  // Blocks the caller until the given cells are built (used at start so the player
  // never spawns into an empty world).
  loadNowAround(px, pz, r) {
    for (const c of this.W.cells) if (this.cellDist(c, px, pz) < r && !this.blocks.has(c.id)) this._onBlock(c.id, buildBlockGeometry(this.W.seed, c));
  }
  allNearLoaded(px, pz, r) {
    for (const c of this.W.cells) if (this.cellDist(c, px, pz) < r && !this.blocks.has(c.id)) return false;
    return true;
  }

  _request(c) {
    this.pending.set(c.id, true);
    this.inflight++;
    if (this.worker) this.worker.postMessage({ seed: this.W.seed, cell: { id: c.id, i: c.i, j: c.j } });
    else setTimeout(() => this._onBlock(c.id, buildBlockGeometry(this.W.seed, c)), 0);
  }

  _onBlock(id, parts) {
    if (this.pending.has(id)) { this.pending.delete(id); this.inflight = Math.max(0, this.inflight - 1); }
    if (this.blocks.has(id)) return;
    const cell = this.W.cells[id];
    const group = new THREE.Group(), lod1 = new THREE.Group();
    group.add(lod1);
    const geos = [];
    const shadows = this.settings.gfx.shadows;
    for (const p of parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(p.col, 3));
      g.setIndex(new THREE.BufferAttribute(p.idx, 1));
      g.computeBoundingSphere();
      geos.push(g);
      const mesh = new THREE.Mesh(g, this.mats.get(p.mat));
      const ns = NO_SHADOW.has(p.mat) || p.mat.startsWith('sign:');
      mesh.castShadow = shadows && !ns && p.lod === 0;
      mesh.receiveShadow = shadows && p.mat !== 'glass' && p.mat !== 'glassBlue';
      if (p.mat === 'glass' || p.mat === 'glassBlue') mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      (p.lod ? lod1 : group).add(mesh);
    }
    const inst = this._instances(cell, group, shadows);
    const doors = this._doors(id, group);
    this.root.add(group);
    this.blocks.set(id, { cell, group, lod1, geos, inst, doors });
  }

  _instances(cell, group, shadows) {
    const byKey = new Map();
    for (const it of cell.instances) {
      let key = it.kind;
      if (CAR_KINDS.includes(it.kind)) key = it.kind + (it.wreck ? ':w' : '');
      if (it.kind === 'tree' && it.dead) key = 'treeDead';
      let a = byKey.get(key); if (!a) { a = []; byKey.set(key, a); } a.push(it);
      if (it.kind === 'lamp') { const hk = it.off ? 'lampHeadOff' : 'lampHead'; let h = byKey.get(hk); if (!h) { h = []; byKey.set(hk, h); } h.push(it); }
    }
    const out = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    for (const [key, list] of byKey) {
      let geo, mat = this.propMat;
      const [kind, w] = key.split(':');
      if (CAR_KINDS.includes(kind)) {
        const gk = key;
        if (!this.vgeo[gk]) this.vgeo[gk] = vehicleGeometry(kind, { flat: !!w });
        geo = this.vgeo[gk]; mat = this.carMat;
      } else if (key === 'lampHead') { geo = this.props.lampHead; mat = this.headOn; }
      else if (key === 'lampHeadOff') { geo = this.props.lampHead; mat = this.headOff; }
      else geo = this.props[key];
      if (!geo) continue;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        const r = hash2(Math.floor(it.x * 10), Math.floor(it.z * 10));
        e.set(w ? (r - 0.5) * 0.06 : 0, it.ry, w ? (r - 0.5) * 0.08 : 0);
        q.setFromEuler(e); s.setScalar(it.s || 1); p.set(it.x, it.y, it.z);
        m.compose(p, q, s); im.setMatrixAt(i, m);
        col.setHex(it.col ?? 0xffffff);
        if (w) col.multiplyScalar(0.45).lerp(new THREE.Color(0x3a2a20), 0.4);
        im.setColorAt(i, col);
      });
      im.castShadow = shadows && key !== 'bag' && key !== 'debris' && !key.startsWith('lampHead');
      im.receiveShadow = shadows;
      im.computeBoundingSphere();
      group.add(im);
      out.push(im);
    }
    return out;
  }

  _doorGeometry(w, h, kind) {
    const k = `${w}|${h}|${kind}`;
    let g = this._doorGeo.get(k);
    if (g) return g;
    const parts = [];
    const add = (bw, bh, bd, x, y, z, c) => { const b = new THREE.BoxGeometry(bw, bh, bd); b.translate(x, y, z); const n = b.attributes.position.count; const cc = new THREE.Color(c); const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } b.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(b); };
    if (kind === 'glassdoor') {
      add(w - 0.04, 0.12, 0.05, w / 2, 0.06, 0, 0x2a2a2a); add(w - 0.04, 0.12, 0.05, w / 2, h - 0.06, 0, 0x2a2a2a);
      add(0.08, h, 0.05, 0.04, h / 2, 0, 0x2a2a2a); add(0.08, h, 0.05, w - 0.06, h / 2, 0, 0x2a2a2a);
      add(w - 0.2, h - 0.25, 0.015, w / 2, h / 2, 0, 0x9ab0b8);
    } else {
      const c = kind === 'metal' ? 0x6a7078 : 0x8a6a4a;
      add(w - 0.04, h - 0.02, 0.05, w / 2, h / 2, 0, c);
      add(w * 0.7, h * 0.3, 0.02, w / 2, h * 0.7, 0.03, kind === 'metal' ? 0x5a6068 : 0x7a5a3a);
      add(w * 0.7, h * 0.3, 0.02, w / 2, h * 0.3, 0.03, kind === 'metal' ? 0x5a6068 : 0x7a5a3a);
      add(0.04, 0.04, 0.16, w - 0.12, h * 0.48, 0, 0xb0a890);
    }
    g = mergeBoxes(parts);
    this._doorGeo.set(k, g);
    return g;
  }

  _doors(blockId, group) {
    const list = [];
    const wood = this.mats.get('wood');
    for (const d of this.W.doors) {
      if (d.block !== blockId) continue;
      const pivot = new THREE.Group();
      pivot.position.set(d.x, d.y0, d.z);
      const base = Math.atan2(-d.dz, d.dx);
      const mat = d.kind === 'glassdoor' ? this.propMat : d.kind === 'metal' ? this.propMat : wood;
      const mesh = new THREE.Mesh(this._doorGeometry(d.w, d.h, d.kind), mat);
      mesh.castShadow = this.settings.gfx.shadows; mesh.receiveShadow = this.settings.gfx.shadows;
      pivot.add(mesh);
      pivot.rotation.y = base + (d.open ? d.swing * Math.PI * 0.48 : 0);
      group.add(pivot);
      this.doorMeshes.set(d.id, { pivot, base, swing: d.swing });
      list.push(d.id);
    }
    return list;
  }

  _unload(id) {
    const b = this.blocks.get(id);
    if (!b) return;
    this.root.remove(b.group);
    for (const g of b.geos) g.dispose();
    for (const im of b.inst) im.dispose();
    for (const d of b.doors) this.doorMeshes.delete(d);
    this.blocks.delete(id);
  }

  // light spots from loaded blocks near a position
  lightsNear(x, z, r) {
    const out = [];
    const r2 = r * r;
    for (const b of this.blocks.values()) {
      if (this.cellDist(b.cell, x, z) > r) continue;
      for (const l of b.cell.lights) { const d = (l.x - x) ** 2 + (l.z - z) ** 2; if (d < r2) out.push([d, l]); }
    }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }

  setNight(dark) {
    this.headOn.emissiveIntensity = 0.2 + dark * 2.4;
  }

  dispose() {
    for (const id of [...this.blocks.keys()]) this._unload(id);
    if (this.worker) this.worker.terminate();
  }
}

function mergeBoxes(parts) {
  let n = 0, ni = 0;
  for (const p of parts) { n += p.attributes.position.count; ni += p.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3), idx = new Uint16Array(ni);
  let o = 0, oi = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); uv.set(p.attributes.uv.array, o * 2); col.set(p.attributes.color.array, o * 3);
    const ix = p.index.array; for (let i = 0; i < ix.length; i++) idx[oi + i] = ix[i] + o;
    o += p.attributes.position.count; oi += ix.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

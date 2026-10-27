// Minimal OBJ(+MTL) -> GLB converter used to ship user-supplied models compactly.
// Indexed geometry, one primitive per material; textures embedded as JPEG/PNG.
// Usage: node tools/obj2glb.mjs in.obj out.glb [--tex mat=color.jpg[,normal.jpg[,mr.jpg]] ...] [--rough 0.5] [--metal 0.5]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const [inObj, outGlb] = args;
const texMap = {};
let rough = 0.6, metal = 0.4;
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--tex') { const [m, files] = args[++i].split('='); texMap[m] = files.split(','); }
  if (args[i] === '--rough') rough = parseFloat(args[++i]);
  if (args[i] === '--metal') metal = parseFloat(args[++i]);
}
const text = fs.readFileSync(inObj, 'utf8');
const dir = path.dirname(inObj);
const V = [], VT = [], VN = [];
const mats = new Map(); // name -> {key->index, pos, nor, uv, idx}
let cur = null;
const mtl = {};
const getMat = (n) => { if (!mats.has(n)) mats.set(n, { keys: new Map(), pos: [], nor: [], uv: [], idx: [] }); return mats.get(n); };
for (const line of text.split('\n')) {
  const p = line.trim().split(/\s+/);
  switch (p[0]) {
    case 'v': V.push([+p[1], +p[2], +p[3]]); break;
    case 'vt': VT.push([+p[1], +p[2]]); break;
    case 'vn': VN.push([+p[1], +p[2], +p[3]]); break;
    case 'usemtl': cur = getMat(p[1]); break;
    case 'mtllib': { const f = path.join(dir, line.trim().slice(7)); if (fs.existsSync(f)) parseMtl(fs.readFileSync(f, 'utf8')); break; }
    case 'f': {
      if (!cur) cur = getMat('default');
      const ids = p.slice(1).map((tok) => {
        let k = cur.keys.get(tok);
        if (k === undefined) {
          const [a, b, c] = tok.split('/').map(x => (x ? parseInt(x, 10) : 0));
          const vi = a < 0 ? V.length + a : a - 1, ti = b < 0 ? VT.length + b : b - 1, ni = c < 0 ? VN.length + c : c - 1;
          k = cur.pos.length / 3;
          cur.pos.push(...V[vi]);
          cur.uv.push(...(ti >= 0 && VT[ti] ? [VT[ti][0], 1 - VT[ti][1]] : [0, 0]));
          cur.nor.push(...(ni >= 0 && VN[ni] ? VN[ni] : [0, 1, 0]));
          cur.keys.set(tok, k);
        }
        return k;
      });
      for (let i = 1; i < ids.length - 1; i++) cur.idx.push(ids[0], ids[i], ids[i + 1]);
      break;
    }
  }
}
function parseMtl(s) {
  let m = null;
  for (const line of s.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'newmtl') { m = mtl[p[1]] = { kd: [0.8, 0.8, 0.8] }; }
    else if (m && p[0] === 'Kd') m.kd = [+p[1], +p[2], +p[3]];
    else if (m && p[0] === 'Ns') m.ns = +p[1];
  }
}

// ---- build GLB
const bufs = []; let off = 0;
const bufferViews = [], accessors = [], images = [], textures = [], materials = [], primitives = [];
function addBuf(data, target) {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const pad = (4 - (b.length % 4)) % 4;
  bufs.push(b, Buffer.alloc(pad));
  bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) });
  off += b.length + pad;
  return bufferViews.length - 1;
}
function addAcc(arr, type, comp, target, minmax) {
  const bv = addBuf(arr, target);
  const n = { VEC3: 3, VEC2: 2, SCALAR: 1 }[type];
  const a = { bufferView: bv, componentType: comp, count: arr.length / n, type };
  if (minmax) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); }
    a.min = mn; a.max = mx;
  }
  accessors.push(a);
  return accessors.length - 1;
}
function addImage(file) {
  const data = fs.readFileSync(file);
  const bv = addBuf(new Uint8Array(data));
  images.push({ bufferView: bv, mimeType: file.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  textures.push({ source: images.length - 1 });
  return textures.length - 1;
}
let tverts = 0, ttris = 0;
for (const [name, m] of mats) {
  if (!m.idx.length) continue;
  const n = m.pos.length / 3;
  const pos = addAcc(new Float32Array(m.pos), 'VEC3', 5126, 34962, true);
  const nor = addAcc(new Float32Array(m.nor), 'VEC3', 5126, 34962);
  const uv = addAcc(new Float32Array(m.uv), 'VEC2', 5126, 34962);
  const idx = addAcc(n > 65535 ? new Uint32Array(m.idx) : new Uint16Array(m.idx), 'SCALAR', n > 65535 ? 5125 : 5123, 34963);
  const md = mtl[name] || { kd: [0.8, 0.8, 0.8] };
  const mat = { name, pbrMetallicRoughness: { baseColorFactor: [...md.kd, 1], metallicFactor: metal, roughnessFactor: rough } };
  const tx = texMap[name] || texMap['*'];
  if (tx) {
    if (tx[0]) { mat.pbrMetallicRoughness.baseColorTexture = { index: addImage(tx[0]) }; mat.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1]; }
    if (tx[1]) mat.normalTexture = { index: addImage(tx[1]) };
    if (tx[2]) { mat.pbrMetallicRoughness.metallicRoughnessTexture = { index: addImage(tx[2]) }; mat.pbrMetallicRoughness.metallicFactor = 1; mat.pbrMetallicRoughness.roughnessFactor = 1; }
  }
  materials.push(mat);
  primitives.push({ attributes: { POSITION: pos, NORMAL: nor, TEXCOORD_0: uv }, indices: idx, material: materials.length - 1 });
  tverts += n; ttris += m.idx.length / 3;
}
const bin = Buffer.concat(bufs);
const json = {
  asset: { version: '2.0', generator: 'dead-district obj2glb' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: path.basename(inObj, '.obj') }],
  meshes: [{ primitives }], materials, accessors, bufferViews, buffers: [{ byteLength: bin.length }],
  ...(images.length ? { images, textures, samplers: [{ magFilter: 9729, minFilter: 9987 }] } : {}),
};
if (textures.length) for (const t of textures) t.sampler = 0;
let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
fs.writeFileSync(outGlb, Buffer.concat([header, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]));
console.log(`${outGlb}: ${mats.size} materials, ${tverts} verts, ${ttris} tris, ${(fs.statSync(outGlb).size / 1e6).toFixed(2)} MB`);

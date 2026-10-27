// Geometry + collider recorder. Produces plain typed arrays grouped by material and
// LOD layer so the city can be generated headless (server) or turned into GPU
// meshes lazily (client). Every box is axis-aligned; UVs are in metres and each
// material decides its own texture tiling.

const WHITE = [1, 1, 1];
const colCache = new Map();
export function toRGB(c) {
  if (c == null) return WHITE;
  if (Array.isArray(c)) return c;
  let v = colCache.get(c);
  if (!v) { v = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]; colCache.set(c, v); }
  return v;
}

class Layer {
  constructor(mat, lod) { this.mat = mat; this.lod = lod; this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
}

export class Builder {
  constructor({ colliders, geo = true, blockId = 0 }) {
    this.colliders = colliders; // shared world collider array (or null)
    this.geo = geo;
    this.blockId = blockId;
    this.layers = new Map();
    this.instances = []; // {kind,x,y,z,ry,s,col}
    this.lights = []; // {x,y,z,type}
  }

  layer(mat, lod) {
    const k = mat + '|' + lod;
    let l = this.layers.get(k);
    if (!l) { l = new Layer(mat, lod); this.layers.set(k, l); }
    return l;
  }

  collider(x0, y0, z0, x1, y1, z1, extra) {
    if (!this.colliders) return null;
    const c = { x0, y0, z0, x1, y1, z1, en: true, b: this.blockId };
    if (extra) Object.assign(c, extra);
    this.colliders.push(c);
    return c;
  }

  // Raw quad: 4 points CCW seen from the front, n normal, uvs flat [u0,v0,...]
  _quad(L, p, n, uv, col) {
    const base = L.count;
    for (let i = 0; i < 4; i++) {
      L.pos.push(p[i][0], p[i][1], p[i][2]);
      L.nor.push(n[0], n[1], n[2]);
      L.uv.push(uv[i * 2], uv[i * 2 + 1]);
      L.col.push(col[0], col[1], col[2]);
    }
    L.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Axis aligned box. o: {col, lod, c(ollide)=true, f:{face:mat|{m,lod,col}}, skip:[faces], uvo:[u,v], uvs, glass, door, walk}
  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    let col = null;
    if (o.c !== false) col = this.collider(x0, y0, z0, x1, y1, z1, o.cx);
    if (!this.geo || o.invisible) return col;
    const lod = o.lod || 0;
    const c = toRGB(o.col);
    const s = o.uvs || 1, uo = o.uvo ? o.uvo[0] : 0, vo = o.uvo ? o.uvo[1] : 0;
    const skip = o.skip || (y0 <= 0.001 ? NY : null);
    const faces = o.f;
    for (let fi = 0; fi < 6; fi++) {
      const fn = FACE_NAMES[fi];
      if (skip && skip.includes(fn)) continue;
      let m = mat, fl = lod, fc = c;
      if (faces && faces[fn] !== undefined) {
        const fv = faces[fn];
        if (fv === null) continue;
        if (typeof fv === 'string') m = fv;
        else { m = fv.m || mat; if (fv.lod !== undefined) fl = fv.lod; if (fv.col !== undefined) fc = toRGB(fv.col); }
      }
      const L = this.layer(m, fl);
      let p, n, uv;
      switch (fi) {
        case 0: p = [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]; n = PX;
          uv = [-z1, y0, -z0, y0, -z0, y1, -z1, y1]; break;
        case 1: p = [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]; n = NXv;
          uv = [z0, y0, z1, y0, z1, y1, z0, y1]; break;
        case 2: p = [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]; n = PY;
          uv = [x0, -z1, x1, -z1, x1, -z0, x0, -z0]; break;
        case 3: p = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]; n = NYv;
          uv = [x0, z0, x1, z0, x1, z1, x0, z1]; break;
        case 4: p = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]; n = PZ;
          uv = [x0, y0, x1, y0, x1, y1, x0, y1]; break;
        default: p = [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]; n = NZ;
          uv = [-x1, y0, -x0, y0, -x0, y1, -x1, y1];
      }
      if (s !== 1 || uo || vo) for (let i = 0; i < 8; i += 2) { uv[i] = uv[i] * s + uo; uv[i + 1] = uv[i + 1] * s + vo; }
      this._quad(L, p, n, uv, fc);
    }
    return col;
  }

  // Generic quad with computed normal; planar metre UVs unless o.uv given.
  quad(p0, p1, p2, p3, mat, o = {}) {
    if (!this.geo) return;
    const n = normal(p0, p1, p2);
    const uv = o.uv || planarUV([p0, p1, p2, p3], n, o.uvs || 1);
    this._quad(this.layer(mat, o.lod || 0), [p0, p1, p2, p3], n, uv, toRGB(o.col));
  }

  tri(p0, p1, p2, mat, o = {}) {
    if (!this.geo) return;
    const L = this.layer(mat, o.lod || 0);
    const n = normal(p0, p1, p2);
    const uv = planarUV([p0, p1, p2], n, o.uvs || 1);
    const c = toRGB(o.col);
    const base = L.count;
    for (const [i, p] of [p0, p1, p2].entries()) {
      L.pos.push(p[0], p[1], p[2]); L.nor.push(n[0], n[1], n[2]); L.uv.push(uv[i * 2], uv[i * 2 + 1]); L.col.push(c[0], c[1], c[2]);
    }
    L.idx.push(base, base + 1, base + 2);
  }

  // Horizontal plane facing up. o.unit -> 0..1 uvs (times o.ur)
  hplane(x0, z0, x1, z1, y, mat, o = {}) {
    if (!this.geo) return;
    let uv;
    if (o.unit) { const [ru, rv] = o.ur || [1, 1]; uv = [0, 0, ru, 0, ru, rv, 0, rv]; if (o.rot) uv = [0, rv, 0, 0, ru, 0, ru, rv]; }
    else uv = [x0, -z1, x1, -z1, x1, -z0, x0, -z0];
    this._quad(this.layer(mat, o.lod || 0), [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], PY, uv, toRGB(o.col));
  }

  // Vertical sign/decal quad with 0..1 UVs. facing: 'px','nx','pz','nz'. (cx,cz) centre on the wall plane.
  sign(cx, cy, cz, w, h, facing, mat, o = {}) {
    if (!this.geo) return;
    const hw = w / 2, hh = h / 2;
    let p, n;
    if (facing === 'pz') { p = [[cx - hw, cy - hh, cz], [cx + hw, cy - hh, cz], [cx + hw, cy + hh, cz], [cx - hw, cy + hh, cz]]; n = PZ; }
    else if (facing === 'nz') { p = [[cx + hw, cy - hh, cz], [cx - hw, cy - hh, cz], [cx - hw, cy + hh, cz], [cx + hw, cy + hh, cz]]; n = NZ; }
    else if (facing === 'px') { p = [[cx, cy - hh, cz + hw], [cx, cy - hh, cz - hw], [cx, cy + hh, cz - hw], [cx, cy + hh, cz + hw]]; n = PX; }
    else { p = [[cx, cy - hh, cz - hw], [cx, cy - hh, cz + hw], [cx, cy + hh, cz + hw], [cx, cy + hh, cz - hw]]; n = NXv; }
    const uv = o.uv || [0, 0, 1, 0, 1, 1, 0, 1];
    this._quad(this.layer(mat, o.lod || 0), p, n, uv, toRGB(o.col));
  }

  // Vertical cylinder (smooth sides, optional top cap). Collider = AABB.
  cyl(cx, y0, cz, r, h, seg, mat, o = {}) {
    if (o.c !== false) this.collider(cx - r, y0, cz - r, cx + r, y0 + h, cz + r);
    if (!this.geo) return;
    const L = this.layer(mat, o.lod || 0);
    const c = toRGB(o.col);
    const r1 = o.r1 !== undefined ? o.r1 : r;
    const base = L.count;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      L.pos.push(cx + ca * r, y0, cz + sa * r, cx + ca * r1, y0 + h, cz + sa * r1);
      L.nor.push(ca, 0, sa, ca, 0, sa);
      const u = (i / seg) * Math.PI * 2 * r;
      L.uv.push(u, y0, u, y0 + h);
      L.col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      L.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (o.cap !== false) {
      const cb = L.count, yt = y0 + h;
      L.pos.push(cx, yt, cz); L.nor.push(0, 1, 0); L.uv.push(cx, cz); L.col.push(c[0], c[1], c[2]);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        L.pos.push(cx + Math.cos(a) * r1, yt, cz + Math.sin(a) * r1); L.nor.push(0, 1, 0);
        L.uv.push(cx + Math.cos(a) * r1, cz + Math.sin(a) * r1); L.col.push(c[0], c[1], c[2]);
      }
      for (let i = 0; i < seg; i++) L.idx.push(cb, cb + 2 + i, cb + 1 + i);
    }
  }

  inst(kind, x, y, z, ry = 0, s = 1, col = 0xffffff, extra) {
    const it = { kind, x, y, z, ry, s, col };
    if (extra) Object.assign(it, extra);
    this.instances.push(it);
  }

  light(x, y, z, type) { this.lights.push({ x, y, z, type }); }

  // Pack layers into typed arrays.
  finish() {
    const out = [];
    for (const L of this.layers.values()) {
      if (!L.idx.length) continue;
      const n = L.count;
      out.push({
        mat: L.mat, lod: L.lod,
        pos: new Float32Array(L.pos), nor: new Float32Array(L.nor), uv: new Float32Array(L.uv), col: new Float32Array(L.col),
        idx: n > 65535 ? new Uint32Array(L.idx) : new Uint16Array(L.idx),
      });
    }
    this.layers.clear();
    return out;
  }
}

const FACE_NAMES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const NY = ['ny'];
const PX = [1, 0, 0], NXv = [-1, 0, 0], PY = [0, 1, 0], NYv = [0, -1, 0], PZ = [0, 0, 1], NZ = [0, 0, -1];

function normal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function planarUV(pts, n, s) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const uv = [];
  for (const p of pts) {
    if (ay >= ax && ay >= az) uv.push(p[0] * s, p[2] * s);
    else if (ax >= az) uv.push(p[2] * s, p[1] * s);
    else uv.push(p[0] * s, p[1] * s);
  }
  return uv;
}

// Transform wrapper: buildings are authored in local coordinates (front facing +z)
// and placed in the world with a 90-degree rotation + translation. Boxes stay
// axis aligned, so collision and navigation stay simple.

const FACE_N = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] };
function faceFromVec(x, z) {
  if (x > 0.5) return 'px'; if (x < -0.5) return 'nx'; if (z > 0.5) return 'pz'; return 'nz';
}

export class Xf {
  constructor(B, W, ox = 0, oz = 0, rot = 0) {
    this.B = B; this.W = W; this.ox = ox; this.oz = oz; this.rot = ((rot % 4) + 4) % 4;
    this.c = [1, 0, -1, 0][this.rot];
    this.s = [0, 1, 0, -1][this.rot];
    this.faceMap = {};
    for (const k in FACE_N) { const [x, z] = this.dir(FACE_N[k][0], FACE_N[k][1]); this.faceMap[k] = faceFromVec(x, z); }
    this.faceMap.py = 'py'; this.faceMap.ny = 'ny';
  }
  // compose: child transform placed at local (x,z) with extra rotation
  sub(x, z, rot = 0) {
    const [wx, wz] = this.p(x, z);
    return new Xf(this.B, this.W, wx, wz, this.rot + rot);
  }
  dir(x, z) { return [x * this.c + z * this.s, -x * this.s + z * this.c]; }
  p(x, z) { const [a, b] = this.dir(x, z); return [a + this.ox, b + this.oz]; }
  get yaw() { return this.rot * Math.PI / 2; }
  mapFaces(f) {
    if (!f) return f;
    const o = {};
    for (const k in f) o[this.faceMap[k]] = f[k];
    return o;
  }
  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const [ax, az] = this.p(x0, z0), [bx, bz] = this.p(x1, z1);
    if (this.rot) {
      o = Object.assign({}, o);
      if (o.f) o.f = this.mapFaces(o.f);
      if (o.skip) o.skip = o.skip.map(k => this.faceMap[k]);
    }
    return this.B.box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), mat, o);
  }
  hplane(x0, z0, x1, z1, y, mat, o = {}) {
    const [ax, az] = this.p(x0, z0), [bx, bz] = this.p(x1, z1);
    if (o.unit && (this.rot & 1)) o = Object.assign({}, o, { rot: true, ur: o.ur ? [o.ur[1], o.ur[0]] : undefined });
    this.B.hplane(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), y, mat, o);
  }
  sign(cx, cy, cz, w, h, facing, mat, o) {
    const [x, z] = this.p(cx, cz);
    this.B.sign(x, cy, z, w, h, this.faceMap[facing], mat, o);
  }
  cyl(cx, y0, cz, r, h, seg, mat, o) { const [x, z] = this.p(cx, cz); this.B.cyl(x, y0, z, r, h, seg, mat, o); }
  quad(a, b, c, d, mat, o) { this.B.quad(this.p3(a), this.p3(b), this.p3(c), this.p3(d), mat, o); }
  tri(a, b, c, mat, o) { this.B.tri(this.p3(a), this.p3(b), this.p3(c), mat, o); }
  p3(v) { const [x, z] = this.p(v[0], v[2]); return [x, v[1], z]; }
  inst(kind, x, y, z, ry = 0, s = 1, col, extra) { const [a, b] = this.p(x, z); this.B.inst(kind, a, y, b, ry + this.yaw, s, col, extra); }
  light(x, y, z, type) { const [a, b] = this.p(x, z); this.B.light(a, y, b, type); }
  rect(x0, z0, x1, z1) {
    const [ax, az] = this.p(x0, z0), [bx, bz] = this.p(x1, z1);
    return { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) };
  }

  // ---- registrations into the world description ----
  // Door panel: hinge at local (hx,hz); closed panel runs along local axis ('x'|'z') with sign sg for width w.
  door(hx, hz, axis, sg, w, h, y0 = 0, o = {}) {
    const [x, z] = this.p(hx, hz);
    const ld = axis === 'x' ? [sg, 0] : [0, sg];
    const [dx, dz] = this.dir(ld[0], ld[1]);
    const W = this.W;
    const id = W.doors.length;
    const ex = x + dx * w, ez = z + dz * w, t = 0.06;
    const col = this.B.collider(Math.min(x, ex) - (dx ? 0 : t), y0, Math.min(z, ez) - (dz ? 0 : t), Math.max(x, ex) + (dx ? 0 : t), y0 + h, Math.max(z, ez) + (dz ? 0 : t), { door: id + 1 });
    const d = { id, x, z, dx, dz, w, h, y0, open: !!o.open, open0: !!o.open, col, swing: o.swing || 1, kind: o.kind || 'wood', block: this.B.blockId };
    if (col) col.en = !d.open;
    W.doors.push(d);
    return d;
  }
  container(x, y, z, kind, name, table) {
    const [a, b] = this.p(x, z);
    const W = this.W;
    const c = { id: W.containers.length, x: a, y, z: b, kind, name, table: table || kind, block: this.B.blockId };
    W.containers.push(c);
    return c;
  }
  poi(name, x, z, extra) { const [a, b] = this.p(x, z); this.W.pois[name] = Object.assign({ x: a, z: b }, extra); }
  interact(type, x, y, z, extra) {
    const [a, b] = this.p(x, z);
    const it = Object.assign({ id: this.W.interacts.length, type, x: a, y, z: b }, extra);
    this.W.interacts.push(it);
    return it;
  }
  vehicle(type, x, z, yaw, extra) {
    const [a, b] = this.p(x, z);
    this.W.vehicleSpawns.push(Object.assign({ type, x: a, z: b, yaw: yaw + this.yaw }, extra));
  }
  zone(kind, x0, z0, x1, z1, extra) { this.W.zones.push(Object.assign({ kind }, this.rect(x0, z0, x1, z1), extra)); }
}

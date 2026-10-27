// Spatial hash of axis-aligned collider boxes + character movement + raycasts.
// Shared by client (player, vehicle) and server (zombies, validation).

const CELL = 8, OFF = 64;

export class ColliderSet {
  constructor(list) {
    this.list = list;
    this.cells = new Map();
    this.stamp = new Uint32Array(0);
    this.cur = 0;
    this.out = [];
    this.dyn = []; // dynamic colliders (vehicles) checked always
  }
  key(cx, cz) { return (cx + OFF) * 4096 + (cz + OFF); }
  build() {
    this.cells.clear();
    for (let i = 0; i < this.list.length; i++) this._insert(i);
    this.stamp = new Uint32Array(this.list.length + 1024);
  }
  _insert(i) {
    const c = this.list[i];
    const cx0 = Math.floor(c.x0 / CELL), cx1 = Math.floor(c.x1 / CELL);
    const cz0 = Math.floor(c.z0 / CELL), cz1 = Math.floor(c.z1 / CELL);
    for (let x = cx0; x <= cx1; x++) for (let z = cz0; z <= cz1; z++) {
      const k = this.key(x, z);
      let a = this.cells.get(k);
      if (!a) { a = []; this.cells.set(k, a); }
      a.push(i);
    }
  }
  // Returns colliders overlapping the square (x±r, z±r). Array reused between calls.
  near(x, z, r) {
    const out = this.out; out.length = 0;
    if (++this.cur > 4e9) { this.cur = 1; this.stamp.fill(0); }
    const s = this.cur, L = this.list;
    const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL), cz1 = Math.floor((z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const a = this.cells.get(this.key(cx, cz));
      if (!a) continue;
      for (let j = 0; j < a.length; j++) {
        const i = a[j];
        if (this.stamp[i] === s) continue;
        this.stamp[i] = s;
        const c = L[i];
        if (!c.en || c.x1 < x - r || c.x0 > x + r || c.z1 < z - r || c.z0 > z + r) continue;
        out.push(c);
      }
    }
    for (const c of this.dyn) {
      if (!c.en || c.x1 < x - r || c.x0 > x + r || c.z1 < z - r || c.z0 > z + r) continue;
      out.push(c);
    }
    return out;
  }
}

// Push a circle (radius r) at height range [y, y+h] out of all boxes it touches.
// Boxes whose top is below y+step are treated as floor (stepped onto), not walls.
export function resolveXZ(cs, b, r, h, step, filter) {
  for (let pass = 0; pass < 3; pass++) {
    const near = cs.near(b.x, b.z, r + 0.05);
    let moved = false;
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (c.y1 <= b.y + step || c.y0 >= b.y + h) continue;
      if (filter && !filter(c)) continue;
      const px = b.x < c.x0 ? c.x0 : b.x > c.x1 ? c.x1 : b.x;
      const pz = b.z < c.z0 ? c.z0 : b.z > c.z1 ? c.z1 : b.z;
      let dx = b.x - px, dz = b.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), push = r - d;
        b.x += (dx / d) * push; b.z += (dz / d) * push;
      } else {
        // centre inside the box: leave along the shallowest axis
        const l = b.x - c.x0, rr = c.x1 - b.x, t = b.z - c.z0, bb = c.z1 - b.z;
        const m = Math.min(l, rr, t, bb);
        if (m === l) b.x = c.x0 - r; else if (m === rr) b.x = c.x1 + r;
        else if (m === t) b.z = c.z0 - r; else b.z = c.z1 + r;
      }
      moved = true;
      b.hitWall = c;
    }
    if (!moved) break;
  }
}

// Highest walkable surface under the circle that is not above y+step.
export function groundAt(cs, x, z, y, r, step) {
  let g = 0;
  const near = cs.near(x, z, r);
  for (let i = 0; i < near.length; i++) {
    const c = near[i];
    if (c.y1 > y + step + 1e-4 || c.y1 <= g) continue;
    if (c.noFloor) continue;
    const px = x < c.x0 ? c.x0 : x > c.x1 ? c.x1 : x;
    const pz = z < c.z0 ? c.z0 : z > c.z1 ? c.z1 : z;
    const dx = x - px, dz = z - pz;
    if (dx * dx + dz * dz < r * r * 0.5) g = c.y1;
  }
  return g;
}

export function ceilingAt(cs, x, z, y, r) {
  let ce = Infinity;
  const near = cs.near(x, z, r);
  for (const c of near) {
    if (c.y0 < y - 0.01 || c.y0 >= ce) continue;
    const px = x < c.x0 ? c.x0 : x > c.x1 ? c.x1 : x;
    const pz = z < c.z0 ? c.z0 : z > c.z1 ? c.z1 : z;
    if ((x - px) ** 2 + (z - pz) ** 2 < r * r * 0.5) ce = c.y0;
  }
  return ce;
}

const GRAV = 22;
// Moves a character body {x,y,z,vy,onGround}. wish = desired horizontal velocity (m/s).
export function stepBody(cs, b, wx, wz, dt, r, h, step = 0.55) {
  const mx = wx * dt, mz = wz * dt;
  const n = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (r * 0.6)));
  b.hitWall = null;
  for (let i = 0; i < n; i++) { b.x += mx / n; b.z += mz / n; resolveXZ(cs, b, r, h, step); }
  const g = groundAt(cs, b.x, b.z, b.y, r, step);
  if (b.vy > 0 || b.y > g + 0.001) {
    if (b.onGround && b.vy <= 0 && b.y - g < 0.6) { b.y = g; b.vy = 0; return; }
    const oy = b.y;
    b.vy -= GRAV * dt;
    b.y += b.vy * dt;
    if (b.vy > 0) {
      const ce = ceilingAt(cs, b.x, b.z, oy + h, r);
      if (b.y + h > ce) { b.y = ce - h; b.vy = 0; }
    }
    if (b.y <= g) { b.landV = b.vy; b.y = g; b.vy = 0; b.onGround = true; }
    else b.onGround = false;
  } else {
    b.y = g; b.vy = 0; b.onGround = true;
  }
}

// Is there room to stand (height h) at the body position?
export function headroom(cs, x, z, y, r, h) {
  for (const c of cs.near(x, z, r)) {
    if (c.y0 >= y + h || c.y1 <= y + 0.6) continue;
    const px = Math.max(c.x0, Math.min(x, c.x1)), pz = Math.max(c.z0, Math.min(z, c.z1));
    if ((x - px) ** 2 + (z - pz) ** 2 < r * r) return false;
  }
  return true;
}

// Ray vs boxes. Returns distance to first hit (or maxD) and the box hit.
export function raycast(cs, ox, oy, oz, dx, dy, dz, maxD, skipGlass = false) {
  let best = maxD, hit = null;
  const step = 6;
  const seen = new Set();
  for (let t = 0; t < best + step; t += step) {
    const x = ox + dx * t, z = oz + dz * t;
    const near = cs.near(x, z, step * 0.75);
    for (const c of near) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (skipGlass && c.glass) continue;
      const d = rayBox(ox, oy, oz, dx, dy, dz, c);
      if (d >= 0 && d < best) { best = d; hit = c; }
    }
    if (hit && t > best) break;
  }
  return { d: best, c: hit };
}

export function rayBox(ox, oy, oz, dx, dy, dz, c) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [c.x0, c.y0, c.z0], hi = [c.x1, c.y1, c.z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return -1; continue; }
    let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Ray vs vertical cylinder (x,z centre, y0..y1, radius). Returns t or -1.
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
  const fx = ox - cx, fz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = (-b - s) / (2 * a);
  if (t < 0) t = (-b + s) / (2 * a);
  if (t < 0) return -1;
  const y = oy + dy * t;
  if (y < y0 || y > y1) return -1;
  return t;
}

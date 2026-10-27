// Ground-level navigation grid (1 m cells) with A* pathfinding, path smoothing and
// line-of-sight, rasterised from the collider set. Zombies only walk at ground level.

export class NavGrid {
  constructor(minX, minZ, maxX, maxZ, cell = 1) {
    this.cell = cell;
    this.ox = minX; this.oz = minZ;
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n); // movement
    this.sight = new Uint8Array(n);   // opaque (walls, closed doors)
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.vis = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.run = 0;
    this.heap = new Int32Array(n);
  }
  idx(x, z) {
    const cx = Math.floor((x - this.ox) / this.cell), cz = Math.floor((z - this.oz) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return -1;
    return cz * this.w + cx;
  }
  cx(i) { return this.ox + ((i % this.w) + 0.5) * this.cell; }
  cz(i) { return this.oz + (Math.floor(i / this.w) + 0.5) * this.cell; }

  rasterBox(arr, x0, z0, x1, z1, v) {
    const c = this.cell;
    const ax = Math.max(0, Math.floor((x0 - this.ox) / c)), bx = Math.min(this.w - 1, Math.floor((x1 - this.ox) / c));
    const az = Math.max(0, Math.floor((z0 - this.oz) / c)), bz = Math.min(this.h - 1, Math.floor((z1 - this.oz) / c));
    const cells = [];
    for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
      // test cell centre against the (inflated) box
      const px = this.ox + (x + 0.5) * c, pz = this.oz + (z + 0.5) * c;
      if (px < x0 || px > x1 || pz < z0 || pz > z1) continue;
      const i = z * this.w + x;
      if (v === undefined) cells.push(i); else arr[i] = v;
    }
    return cells;
  }

  build(colliders) {
    const inf = 0.3;
    for (const c of colliders) {
      if (c.door) continue;
      if (c.y0 < 1.0 && c.y1 > 0.45) this.rasterBox(this.blocked, c.x0 - inf, c.z0 - inf, c.x1 + inf, c.z1 + inf, 1);
      if (!c.glass && c.y0 < 1.4 && c.y1 > 1.6) this.rasterBox(this.sight, c.x0 - 0.05, c.z0 - 0.05, c.x1 + 0.05, c.z1 + 0.05, 1);
    }
  }

  // Door cells toggled in the sight grid when doors open/close.
  doorCells(c) { return this.rasterBox(null, c.x0 - 0.05, c.z0 - 0.05, c.x1 + 0.05, c.z1 + 0.05); }

  free(x, z) { const i = this.idx(x, z); return i >= 0 && !this.blocked[i]; }

  nearestFree(x, z, maxR = 6) {
    if (this.free(x, z)) return [x, z];
    for (let r = 1; r <= maxR; r++) {
      for (let a = 0; a < 8 * r; a++) {
        const t = (a / (8 * r)) * Math.PI * 2;
        const px = x + Math.cos(t) * r * this.cell, pz = z + Math.sin(t) * r * this.cell;
        if (this.free(px, pz)) return [px, pz];
      }
    }
    return null;
  }

  // Grid walk along a segment; arr = blocked or sight grid.
  lineClear(arr, x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const n = Math.ceil(len / (this.cell * 0.45));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const k = this.idx(x0 + dx * t, z0 + dz * t);
      if (k < 0 || arr[k]) return false;
    }
    return true;
  }
  los(x0, z0, x1, z1) { return this.lineClear(this.sight, x0, z0, x1, z1); }
  walkable(x0, z0, x1, z1) { return this.lineClear(this.blocked, x0, z0, x1, z1); }

  // A*; returns waypoint list [[x,z],...] (smoothed) or null. Partial path to the
  // closest reached cell if the goal is unreachable.
  findPath(sx, sz, tx, tz, maxNodes = 5000) {
    let s = this.idx(sx, sz);
    if (s < 0) return null;
    if (this.blocked[s]) { const nf = this.nearestFree(sx, sz, 3); if (!nf) return null; s = this.idx(nf[0], nf[1]); }
    let t = this.idx(tx, tz);
    if (t < 0) return null;
    if (this.blocked[t]) { const nf = this.nearestFree(tx, tz, 4); if (!nf) return null; t = this.idx(nf[0], nf[1]); }
    const W = this.w, run = ++this.run;
    const g = this.g, f = this.f, from = this.from, vis = this.vis, closed = this.closed, heap = this.heap;
    const tX = t % W, tZ = (t / W) | 0;
    const hfun = (i) => { const dx = Math.abs((i % W) - tX), dz = Math.abs(((i / W) | 0) - tZ); return dx + dz - 0.586 * Math.min(dx, dz); };
    let hn = 0;
    const push = (i) => { let k = hn++; heap[k] = i; while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[i]) break; heap[k] = heap[p]; heap[p] = i; k = p; } };
    const pop = () => {
      const top = heap[0]; const last = heap[--hn]; let k = 0;
      if (hn > 0) {
        heap[0] = last;
        for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hn && f[heap[l]] < f[heap[m]]) m = l; if (r < hn && f[heap[r]] < f[heap[m]]) m = r; if (m === k) break; const tmp = heap[k]; heap[k] = heap[m]; heap[m] = tmp; k = m; }
      }
      return top;
    };
    g[s] = 0; f[s] = hfun(s); vis[s] = run; from[s] = -1; push(s);
    let best = s, bestH = f[s], exp = 0, found = false;
    const H = this.h, B = this.blocked;
    while (hn > 0 && exp < maxNodes) {
      const cur = pop();
      if (closed[cur] === run) continue;
      closed[cur] = run; exp++;
      if (cur === t) { found = true; break; }
      const hc = f[cur] - g[cur];
      if (hc < bestH) { bestH = hc; best = cur; }
      const cxi = cur % W, czi = (cur / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cxi + DX[d], nz = czi + DZ[d];
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const ni = nz * W + nx;
        if (B[ni] || closed[ni] === run) continue;
        if (d >= 4 && (B[czi * W + nx] || B[nz * W + cxi])) continue; // no corner cutting
        const ng = g[cur] + (d >= 4 ? 1.414 : 1);
        if (vis[ni] === run && ng >= g[ni]) continue;
        vis[ni] = run; g[ni] = ng; f[ni] = ng + hfun(ni); from[ni] = cur; push(ni);
      }
    }
    const end = found ? t : best;
    const cells = [];
    for (let i = end; i !== -1; i = from[i]) cells.push(i);
    cells.reverse();
    // smooth: greedy farthest visible
    const pts = [];
    let ax = sx, az = sz, k = 0;
    while (k < cells.length - 1) {
      let j = cells.length - 1;
      for (; j > k + 1; j--) if (this.walkable(ax, az, this.cx(cells[j]), this.cz(cells[j]))) break;
      ax = this.cx(cells[j]); az = this.cz(cells[j]);
      pts.push([ax, az]);
      k = j;
    }
    if (found && pts.length) pts[pts.length - 1] = [tx, tz];
    return pts;
  }

  randomFree(rng, x, z, rad, tries = 12) {
    for (let i = 0; i < tries; i++) {
      const a = rng.next() * Math.PI * 2, r = rad * (0.3 + 0.7 * rng.next());
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.free(px, pz)) return [px, pz];
    }
    return null;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

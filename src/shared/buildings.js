// Procedural modular architecture. All functions work in building-local coordinates:
// footprint [0,L] x [0,D], front facade at z = D (+z). Walls are built with real
// openings (windows, doors, storefronts) so interiors are genuinely explorable.
import * as P from './props.js';

export const WT = 0.3; // exterior wall thickness
export const IT = 0.12; // interior partition thickness
const RUN = 0.3, STEPS = 16; // stair step run / count per flight

// ---------------------------------------------------------------- walls
export function wall(X, axis, a0, a1, b0, b1, y0, y1, ops, m) {
  ops = (ops || []).slice().sort((p, q) => p.a - q.a);
  const bigP = axis === 'x' ? 'pz' : 'px', bigN = axis === 'x' ? 'nz' : 'nx';
  const f = {};
  if (m.out === 'p') { f[bigP] = { m: m.ext, col: m.extCol }; f[bigN] = { m: m.int, col: m.intCol }; }
  else if (m.out === 'n') { f[bigN] = { m: m.ext, col: m.extCol }; f[bigP] = { m: m.int, col: m.intCol }; }
  else { f[bigP] = { m: m.int, col: m.intCol }; f[bigN] = { m: m.int2 || m.int, col: m.intCol2 !== undefined ? m.intCol2 : m.intCol }; }
  const base = m.out ? m.ext : m.int, baseCol = m.out ? m.extCol : m.intCol;
  const opt = { f, col: baseCol, lod: m.lod || 0 };
  const mk = (s0, s1, ya, yb) => axis === 'x' ? X.box(s0, ya, b0, s1, yb, b1, base, opt) : X.box(b0, ya, s0, b1, yb, s1, base, opt);
  let cur = a0;
  for (const op of ops) {
    const s0 = Math.max(a0, op.a - op.w / 2), s1 = Math.min(a1, op.a + op.w / 2);
    if (s0 > cur + 0.001) mk(cur, s0, y0, y1);
    if (op.b > 0.001) mk(s0, s1, y0, y0 + op.b);
    if (y0 + op.t < y1 - 0.001) mk(s0, s1, y0 + op.t, y1);
    fillOpening(X, axis, s0, s1, b0, b1, y0 + op.b, y0 + op.t, op, m);
    cur = Math.max(cur, s1);
  }
  if (cur < a1 - 0.001) mk(cur, a1, y0, y1);
}

function wbox(X, axis, s0, s1, b0, b1, ya, yb, mat, o) {
  return axis === 'x' ? X.box(s0, ya, b0, s1, yb, b1, mat, o) : X.box(b0, ya, s0, b1, yb, s1, mat, o);
}

function fillOpening(X, axis, s0, s1, b0, b1, yb, yt, op, m) {
  const mid = (b0 + b1) / 2;
  const glass = m.glass || 'glass';
  const outB = m.out === 'p' ? b1 : m.out === 'n' ? b0 : null;
  const og = outB === null ? 0 : (m.out === 'p' ? 1 : -1);
  const fr = { c: false, col: m.frameCol || 0x2a2a2a };
  if (op.k === 'win' || op.k === 'shop') {
    const st = op.st || 'glass';
    const t = 0.06;
    wbox(X, axis, s0, s0 + t, mid - 0.04, mid + 0.04, yb, yt, 'frame', fr);
    wbox(X, axis, s1 - t, s1, mid - 0.04, mid + 0.04, yb, yt, 'frame', fr);
    wbox(X, axis, s0, s1, mid - 0.04, mid + 0.04, yt - t, yt, 'frame', fr);
    wbox(X, axis, s0, s1, mid - 0.04, mid + 0.04, yb, yb + t, 'frame', fr);
    if (op.k === 'win' && st !== 'broken') wbox(X, axis, (s0 + s1) / 2 - 0.025, (s0 + s1) / 2 + 0.025, mid - 0.035, mid + 0.035, yb, yt, 'frame', fr);
    if (op.k === 'shop' && s1 - s0 > 3) for (let a = s0 + 2.2; a < s1 - 1; a += 2.2) wbox(X, axis, a - 0.04, a + 0.04, mid - 0.05, mid + 0.05, yb, yt, 'frame', fr);
    if (st === 'glass') wbox(X, axis, s0 + t, s1 - t, mid - 0.01, mid + 0.01, yb + t, yt - t, glass, { cx: { glass: true } });
    else {
      if (op.k === 'win' || st === 'boarded') wbox(X, axis, s0, s1, mid - 0.05, mid + 0.05, yb, yt, 'solid', { invisible: true, cx: { glass: true } });
      // shards
      const sh = (a, b, h) => {
        if (axis === 'x') X.tri([a, yb + t, mid], [b, yb + t, mid], [a, yb + t + h, mid], glass, { lod: 1 });
        else X.tri([mid, yb + t, a], [mid, yb + t, b], [mid, yb + t + h, a], glass, { lod: 1 });
      };
      if (st === 'broken') { sh(s0 + t, s0 + 0.5, 0.45); sh(s1 - t, s1 - 0.35, 0.3); }
    }
    if (st === 'boarded' && outB !== null) {
      const n = 4;
      for (let i = 0; i < n; i++) {
        const y = yb + 0.1 + i * (yt - yb - 0.2) / (n - 1) - 0.1;
        wbox(X, axis, s0 - 0.12, s1 + 0.12, outB + og * 0.005, outB + og * 0.045, y, y + 0.2, 'wood', { c: false, col: i % 2 ? 0x8a6a48 : 0x76583a });
      }
    }
    if (op.k === 'win' && outB !== null) wbox(X, axis, s0 - 0.06, s1 + 0.06, outB - og * 0.02, outB + og * 0.09, yb - 0.07, yb, 'concrete', { c: false, col: 0xb0aca0 });
  }
}

// interior partition with doorway gaps [{a,w}]
export function partition(X, axis, pos, a0, a1, y0, y1, gaps, m) {
  const ops = (gaps || []).map(g => ({ a: g.a, w: g.w || 1.5, b: 0, t: g.t || 2.3, k: 'open' }));
  wall(X, axis, a0, a1, pos - IT / 2, pos + IT / 2, y0, y1, ops, { int: m.int, intCol: m.intCol, int2: m.int2, intCol2: m.intCol2 });
}

// subtract rectangles from a rect list
function subtract(rects, h) {
  const out = [];
  for (const r of rects) {
    if (h.x1 <= r.x0 || h.x0 >= r.x1 || h.z1 <= r.z0 || h.z0 >= r.z1) { out.push(r); continue; }
    if (h.z0 > r.z0) out.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: h.z0 });
    if (h.z1 < r.z1) out.push({ x0: r.x0, z0: h.z1, x1: r.x1, z1: r.z1 });
    const z0 = Math.max(r.z0, h.z0), z1 = Math.min(r.z1, h.z1);
    if (h.x0 > r.x0) out.push({ x0: r.x0, z0, x1: h.x0, z1 });
    if (h.x1 < r.x1) out.push({ x0: h.x1, z0, x1: r.x1, z1 });
  }
  return out;
}

export function slab(X, rect, y, th, holes, top, bottom, o = {}) {
  let rs = [rect];
  for (const h of holes || []) rs = subtract(rs, h);
  for (const r of rs) X.box(r.x0, y - th, r.z0, r.x1, y, r.z1, top, { f: { py: { m: top, col: o.topCol }, ny: { m: bottom, col: o.botCol } }, col: o.edgeCol || 0x9a9a96 });
}

// Switchback stair core. Lane A (z in [sz, sz+1.6]) climbs +x on even flights, lane B
// (z in [sz+1.75, sz+3.35]) climbs -x on odd flights. Landings at both ends.
// Returns hole rect for each level 1..levels.
export function stairCore(X, sx, sz, fh, levels, mat = 'concrete', col = 0xa8a49c) {
  const rise = fh / STEPS, len = STEPS * RUN;
  const laneA = [sz, sz + 1.6], laneB = [sz + 1.75, sz + 3.35];
  const holes = [];
  for (let k = 0; k < levels; k++) {
    const y = k * fh;
    const lane = k % 2 === 0 ? laneA : laneB;
    for (let i = 0; i < STEPS; i++) {
      const top = y + (i + 1) * rise;
      const xa = k % 2 === 0 ? sx + i * RUN : sx + len - (i + 1) * RUN;
      X.box(xa, Math.max(y, top - 0.6), lane[0], xa + RUN, top, lane[1], mat, { col, f: { py: { m: 'concrete', col: 0x8a8680 } } });
    }
    // divider wall between lanes (rail height on top level)
    X.box(sx + 0.3, y, sz + 1.6, sx + len - 0.3, y + fh - 0.25, sz + 1.75, 'wallInt', { col: 0xb0aaa0 });
    // outer guard rail along lane B
    X.box(sx, y + (k % 2 ? 0 : 0), sz + 3.35, sx + len, y + 1.05, sz + 3.42, 'metal', { col: 0x404448 });
    holes.push({ x0: sx, x1: sx + len, z0: lane[0], z1: lane[1] });
  }
  // rails around the top hole on the roof
  const topY = levels * fh, last = holes[holes.length - 1];
  X.box(sx, topY, sz + 1.6, sx + len, topY + 1.05, sz + 1.75, 'metal', { col: 0x404448 });
  if ((levels - 1) % 2 === 0) X.box(sx - 0.08, topY, last.z0, sx, topY + 1.05, last.z1, 'metal', { col: 0x404448 });
  else { X.box(sx, topY, sz + 3.35, sx + len, topY + 1.05, sz + 3.42, 'metal', { col: 0x404448 }); X.box(sx + len, topY, last.z0, sx + len + 0.08, topY + 1.05, last.z1, 'metal', { col: 0x404448 }); }
  return holes;
}

function bayCenters(len, bw) {
  const n = Math.max(1, Math.round(len / bw));
  const w = len / n, out = [];
  for (let i = 0; i < n; i++) out.push(w * (i + 0.5));
  return { n, w, c: out };
}

function winState(rng, k, boardBias = 0) {
  const r = rng.next();
  if (r < 0.18 + (k === 0 ? 0.25 + boardBias : 0)) return 'boarded';
  if (r < 0.5 + (k === 0 ? 0.15 : 0)) return 'broken';
  return 'glass';
}

function spawn(X, x, z, indoor = true) { const [a, b] = X.p(x, z); X.W.zSpawns.push({ x: a, z: b, indoor }); }

// Generic perimeter bands / cornice / parapet + roof clutter
function roofline(X, L, D, H, o, rng) {
  const cc = o.trimCol || 0xb4b0a6;
  const pr = 0.14;
  X.box(-pr, H - 0.4, -pr, L + pr, H, 0, 'concrete', { c: false, col: cc });
  X.box(-pr, H - 0.4, D, L + pr, H, D + pr, 'concrete', { c: false, col: cc });
  X.box(-pr, H - 0.4, 0, 0, H, D, 'concrete', { c: false, col: cc });
  X.box(L, H - 0.4, 0, L + pr, H, D, 'concrete', { c: false, col: cc });
  const ph = o.parapet === undefined ? 0.9 : o.parapet;
  if (ph > 0) {
    const m = o.ext, col = o.extCol;
    X.box(0, H, 0, L, H + ph, WT, m, { col });
    X.box(0, H, D - WT, L, H + ph, D, m, { col });
    X.box(0, H, WT, WT, H + ph, D - WT, m, { col });
    X.box(L - WT, H, WT, L, H + ph, D - WT, m, { col });
    X.box(-0.05, H + ph, -0.05, L + 0.05, H + ph + 0.08, WT + 0.05, 'concrete', { c: false, col: cc });
    X.box(-0.05, H + ph, D - WT - 0.05, L + 0.05, H + ph + 0.08, D + 0.05, 'concrete', { c: false, col: cc });
    X.box(-0.05, H + ph, WT, WT + 0.05, H + ph + 0.08, D - WT, 'concrete', { c: false, col: cc });
    X.box(L - WT - 0.05, H + ph, WT, L + 0.05, H + ph + 0.08, D - WT, 'concrete', { c: false, col: cc });
  }
  if (!rng || o.noClutter) return;
  const n = 1 + Math.floor(L * D / 160);
  for (let i = 0; i < n; i++) {
    const w = rng.range(1.2, 2.4), d = rng.range(1, 1.8);
    const x = rng.range(WT + 1, L - WT - 1 - w), z = rng.range(WT + 1, D - WT - 1 - d);
    if (o.avoid && x < o.avoid.x1 && x + w > o.avoid.x0 && z < o.avoid.z1 && z + d > o.avoid.z0) continue;
    X.box(x, H, z, x + w, H + rng.range(0.8, 1.4), z + d, 'metal', { col: rng.pick([0x9a9c9e, 0x8a8c88, 0xa8a49a]) });
    X.box(x + 0.2, H + 0.05, z - 0.02, x + w - 0.2, H + 0.7, z, 'frame', { c: false, col: 0x303030 });
  }
  for (let i = 0; i < 3; i++) {
    const x = rng.range(WT + 1, L - 2), z = rng.range(WT + 1, D - 2);
    if (o.avoid && x < o.avoid.x1 + 0.5 && x > o.avoid.x0 - 0.5 && z < o.avoid.z1 + 0.5 && z > o.avoid.z0 - 0.5) continue;
    X.cyl(x, H, z, 0.18, 0.9, 8, 'metal', { col: 0x7a7c7e });
  }
  if (o.waterTower && L > 20) {
    const tx = L - 5, tz = D / 2;
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) X.box(tx + lx - 0.08, H, tz + lz - 0.08, tx + lx + 0.08, H + 3, tz + lz + 0.08, 'wood', { col: 0x4a3a2a });
    X.cyl(tx, H + 3, tz, 1.7, 3.2, 14, 'woodDark', { col: 0x6a5038 });
    X.cyl(tx, H + 6.2, tz, 1.75, 0.9, 14, 'metal', { col: 0x4a4a48, r1: 0.1 });
  }
}

function bands(X, L, D, fh, floors, col) {
  for (let k = 1; k < floors; k++) {
    const y = k * fh;
    X.box(-0.06, y - 0.18, -0.06, L + 0.06, y + 0.04, 0, 'concrete', { c: false, col });
    X.box(-0.06, y - 0.18, D, L + 0.06, y + 0.04, D + 0.06, 'concrete', { c: false, col });
    X.box(-0.06, y - 0.18, 0, 0, y + 0.04, D, 'concrete', { c: false, col });
    X.box(L, y - 0.18, 0, L + 0.06, y + 0.04, D, 'concrete', { c: false, col });
  }
}

// ---------------------------------------------------------------- corridor building
// Apartments, hospital, police station and offices share this plan: stair hall at the
// west end, a central corridor, rooms either side, stairs to every floor and the roof.
export function corridorBuilding(X, o, rng) {
  const { L, D, floors } = o;
  const fh = o.fh || 3.2;
  const H = floors * fh;
  const mExt = { ext: o.ext, extCol: o.extCol, int: o.int || 'wallInt', intCol: o.intCol || 0xd8d0c0, glass: o.glass, frameCol: o.frameCol };
  const bx = bayCenters(L, o.bay || 3.6), bz = bayCenters(D, o.bay || 3.6);
  const hallBays = Math.ceil((7.8 + WT) / bx.w);
  const hallEnd = hallBays * bx.w;
  const zc0 = D / 2 - 1.2, zc1 = D / 2 + 1.2;
  const sx = WT + 1.3, sz = WT;
  const doorA = hallEnd / 2 + 0.6;
  const winW = o.winW || 1.4, winH = o.winH || 1.45, sill = o.sill || 0.85;
  // rooms along x
  const rb = o.roomBays || 2;
  const roomsX = [];
  for (let i = hallBays; i < bx.n; i += rb) roomsX.push([i * bx.w, Math.min(bx.n, i + rb) * bx.w]);
  if (roomsX.length > 1 && roomsX[roomsX.length - 1][1] - roomsX[roomsX.length - 1][0] < bx.w * 1.5) { const last = roomsX.pop(); roomsX[roomsX.length - 1][1] = last[1]; }
  const holes = stairCore(X, sx, sz, fh, floors);
  const rect = { x0: WT, z0: WT, x1: L - WT, z1: D - WT };
  X.box(WT, 0, WT, L - WT, 0.04, D - WT, o.floorMat || 'tile', { c: false, col: o.floorCol });

  for (let k = 0; k < floors; k++) {
    const y = k * fh, yt = (k + 1) * fh;
    const ground = k === 0;
    // exterior walls
    const front = [], back = [], west = [], east = [];
    for (let i = 0; i < bx.n; i++) {
      const a = bx.c[i];
      if (ground && Math.abs(a - doorA) < winW / 2 + 1.0) { /* door bay */ }
      else {
        const balcony = o.balconies && !ground && i >= hallBays && (i - hallBays) % rb === 0 && rng.chance(0.75);
        if (balcony) {
          front.push({ a, w: 1.2, b: 0, t: 2.3, k: 'open' });
          X.box(a - 1.5, y - 0.18, D, a + 1.5, y, D + 1.3, 'concrete', { col: 0xa09a90 });
          X.box(a - 1.5, y, D + 1.24, a + 1.5, y + 1.0, D + 1.3, 'metal', { col: 0x3a3a3a });
          X.box(a - 1.5, y, D, a - 1.44, y + 1.0, D + 1.24, 'metal', { col: 0x3a3a3a });
          X.box(a + 1.44, y, D, a + 1.5, y + 1.0, D + 1.24, 'metal', { col: 0x3a3a3a });
          if (rng.chance(0.4)) X.box(a + 0.4, y, D + 0.3, a + 1.2, y + 0.5, D + 1.1, 'solid', { col: rng.pick([0x6a5a4a, 0x3a5a3a]), c: false, lod: 1 });
        } else front.push({ a, w: winW, b: sill, t: sill + winH, k: 'win', st: winState(rng, k) });
      }
      if (!(i < hallBays && a > sx - 1.4 && a < sx + 6.2 && k > 0)) back.push({ a, w: winW, b: sill, t: sill + winH, k: 'win', st: winState(rng, k) });
    }
    for (let i = 0; i < bz.n; i++) {
      const a = bz.c[i];
      if (Math.abs(a - zc0) < 1 || Math.abs(a - zc1) < 1) continue;
      if (a < sz + 3.6) { east.push({ a, w: winW, b: sill, t: sill + winH, k: 'win', st: winState(rng, k) }); continue; }
      west.push({ a, w: winW, b: sill, t: sill + winH, k: 'win', st: winState(rng, k) });
      east.push({ a, w: winW, b: sill, t: sill + winH, k: 'win', st: winState(rng, k) });
    }
    if (ground) {
      front.push({ a: doorA, w: 1.6, b: 0, t: 2.4, k: 'door' });
      if (o.backDoor) east.push({ a: D / 2, w: 1.6, b: 0, t: 2.4, k: 'door' });
    }
    wall(X, 'x', 0, L, D - WT, D, y, yt, front, { ...mExt, out: 'p' });
    wall(X, 'x', 0, L, 0, WT, y, yt, back, { ...mExt, out: 'n' });
    wall(X, 'z', WT, D - WT, 0, WT, y, yt, west, { ...mExt, out: 'n' });
    wall(X, 'z', WT, D - WT, L - WT, L, y, yt, east, { ...mExt, out: 'p' });
    // slab above (floor of next level or roof)
    const isRoof = k === floors - 1;
    slab(X, rect, yt, 0.25, [holes[k]], isRoof ? 'roofTar' : (o.floorMat || 'tile'), 'wallInt', { topCol: isRoof ? 0xffffff : o.floorCol, botCol: 0xd8d4cc });
    // corridor walls + room partitions
    const iy1 = yt - 0.25;
    const m = { int: o.int || 'wallInt', intCol: o.intCol || 0xd8d0c0, int2: o.corrInt, intCol2: o.corrCol };
    const gapsN = [], gapsS = [];
    roomsX.forEach(([a0, a1], ri) => {
      gapsN.push({ a: a0 + 1.1, w: 1.5 }); gapsS.push({ a: a0 + 1.1, w: 1.5 });
      void ri;
    });
    partition(X, 'x', zc0, hallEnd, L - WT, y, iy1, gapsN, { int: m.int, intCol: m.intCol, int2: m.int2, intCol2: m.intCol2 });
    partition(X, 'x', zc1, hallEnd, L - WT, y, iy1, gapsS, { int: m.int2 || m.int, intCol: m.intCol2 !== undefined ? m.intCol2 : m.intCol, int2: m.int, intCol2: m.intCol });
    for (const [a0] of roomsX) {
      partition(X, 'z', a0, WT, zc0, y, iy1, [], m);
      partition(X, 'z', a0, zc1, D - WT, y, iy1, [], m);
    }
    // room doors
    roomsX.forEach(([a0, a1], ri) => {
      for (const side of ['N', 'S']) {
        if (rng.chance(o.doorChance === undefined ? 0.55 : o.doorChance)) {
          const zz = side === 'N' ? zc0 : zc1;
          X.door(a0 + 0.35, zz, 'x', 1, 1.5, 2.25, y, { open: rng.chance(0.35), swing: side === 'N' ? -1 : 1 });
        }
        const room = side === 'N'
          ? { X: X.sub(a0 + IT / 2, WT, 0), w: a1 - a0 - IT, d: zc0 - WT - IT / 2 }
          : { X: X.sub(a1 - IT / 2, D - WT, 2), w: a1 - a0 - IT, d: D - WT - zc1 - IT / 2 };
        room.level = k; room.y = y; room.side = side; room.index = ri; room.doorX = side === 'N' ? 1.1 - IT / 2 : room.w - 1.1 + IT / 2;
        if (o.room) o.room(room, rng);
        if (ground && rng.chance(o.spawnChance || 0.5)) spawn(room.X, room.w / 2, room.d / 2);
      }
    });
    // corridor + hall dressing
    X.light(hallEnd + (L - hallEnd) / 2, yt - 0.4, D / 2, 'fluoro');
    X.light(hallEnd / 2, yt - 0.4, D / 2 + 2, 'fluoro');
    X.box(hallEnd + 2, yt - 0.3, D / 2 - 0.15, hallEnd + 3.2, yt - 0.25, D / 2 + 0.15, 'lampCool', { c: false, lod: 1 });
    X.box(L - 4, yt - 0.3, D / 2 - 0.15, L - 2.8, yt - 0.25, D / 2 + 0.15, 'lampCool', { c: false, lod: 1 });
    if (o.hall) o.hall({ X, x0: WT, z0: sz + 3.6, x1: hallEnd, z1: D - WT, level: k, y }, rng);
    if (ground) { spawn(X, hallEnd + 3, D / 2); if (rng.chance(0.5)) spawn(X, L - 3, D / 2); }
    // debris in corridors
    for (let i = 0; i < 2; i++) if (rng.chance(0.6)) P.decal(X, rng.range(hallEnd, L - 2), rng.range(zc0 + 0.6, zc1 - 0.6), rng.range(0.8, 1.8), rng.range(0.8, 1.8), rng.chance(0.5) ? 'blood' : 'stain', y + 0.05);
    if (rng.chance(0.4)) P.chair(X, rng.range(hallEnd + 1, L - 2), D / 2 + rng.range(-0.6, 0.6), rng.int(0, 3), y, 0x404040, true);
  }
  // front door + canopy
  X.door(doorA - 0.8, D - WT / 2, 'x', 1, 1.6, 2.4, 0, { open: rng.chance(0.3), swing: -1, kind: o.doorKind || 'wood' });
  X.box(doorA - 1.6, 2.7, D, doorA + 1.6, 2.85, D + 1.4, 'concrete', { col: 0x8a8680 });
  X.light(doorA, 2.6, D + 0.8, 'porch');
  bands(X, L, D, fh, floors, o.trimCol || 0xb4b0a6);
  roofline(X, L, D, H, { ...mExt, trimCol: o.trimCol, avoid: { x0: sx - 1.5, x1: sx + 6.3, z0: 0, z1: sz + 3.6 }, waterTower: o.waterTower }, rng);
  if (o.sign) {
    X.box(doorA - o.sign.w / 2 - 0.1, H - 1.5, D, doorA + o.sign.w / 2 + 0.1, H - 0.45, D + 0.12, 'metal', { c: false, col: 0x2a2a2a });
    X.sign(doorA, H - 0.97, D + 0.13, o.sign.w, 0.95, 'pz', o.sign.mat);
  }
  return { doorA, hallEnd, H, roomsX, zc0, zc1 };
}

// ---------------------------------------------------------------- room furnishers
export function furnishApartment(R, rng) {
  const { X, w, d, y, doorX } = R;
  const dz = d; // door wall at z = d
  P.bed(X, w - 0.9, 1.4, 0, y, rng);
  P.wardrobe(X, w - 0.35, 3.4, 3, y);
  P.kitchen(X, 1.6, 0.35, 2.0, 0, y);
  P.table(X, 1.8, 2.4, 1.2, 0.8, 0, y);
  P.chair(X, 1.3, 2.4, 1, y, 0x6a4a2a, rng.chance(0.3));
  P.chair(X, 2.3, 2.4, 3, y, 0x6a4a2a, rng.chance(0.3));
  if (w > 6 && d > 4.5) { P.sofa(X, w / 2 + 0.3, dz - 1.0, 2, y, rng.pick([0x5a4a3a, 0x3a4a5a, 0x6a3a3a])); P.tv(X, w / 2 + 0.3, dz - 2.6, 0, y); }
  else P.bookshelf(X, w / 2, 0.25, 0, y, rng);
  P.decal(X, w / 2, d / 2, 2.2, 1.6, 'rug', y + 0.05);
  if (rng.chance(0.4)) P.decal(X, rng.range(1, w - 1), rng.range(1, d - 1), 1.2, 1.2, 'blood', y + 0.06);
  void doorX;
}

export function furnishWard(R, rng) {
  const { X, w, d, y } = R;
  const n = Math.max(1, Math.floor((w - 1) / 2.1));
  for (let i = 0; i < n; i++) P.hospitalBed(X, 1.4 + i * 2.1, 1.2, 0, y);
  P.lockers(X, w - 0.4, d - 2.2, 2, 3, y, 0xd0d4d8, 'medical', 'Medical cabinet');
  if (rng.chance(0.5)) P.decal(X, rng.range(1, w - 1), rng.range(1.5, d - 1), 1.4, 1.4, 'blood', y + 0.06);
}

export function furnishExam(R, rng) {
  const { X, w, d, y } = R;
  P.hospitalBed(X, w / 2, 1.4, 1, y);
  P.desk(X, w - 1.2, d - 1.8, 2, y, rng, 'medical');
  P.lockers(X, 0.4, 2.0, 2, 1, y, 0xe0e4e8, 'medical', 'Medicine cabinet');
}

export function furnishPharmacy(R, rng) {
  const { X, w, d, y } = R;
  P.shelf(X, w / 2, 0.4, w - 1.2, 0, y, rng, 'pharmacy', 'Pharmacy shelf');
  P.shelf(X, w / 2, d / 2, w - 2.5, 0, y, rng, 'pharmacy', 'Pharmacy shelf', 1.5);
}

export function furnishOffice(R, rng) {
  const { X, w, d, y } = R;
  const n = Math.max(1, Math.floor((w - 1) / 2.4));
  for (let i = 0; i < n; i++) P.desk(X, 1.4 + i * 2.4, 1.2, 0, y, rng);
  P.bookshelf(X, w - 0.3, d / 2, 3, y, rng);
  if (rng.chance(0.5)) P.lockers(X, 0.3, d - 2.2, 2, 1, y, 0x6a6a64, 'office', 'Filing cabinet');
}

// ---------------------------------------------------------------- house
export function house(X, rng, o = {}) {
  const L = 11, D = 9, fh = 2.9;
  const ext = rng.pick(['siding', 'brick', 'plaster']);
  const extCol = ext === 'brick' ? rng.pick([0xffffff, 0xd8c8b8, 0xc0b0a0]) : rng.pick([0xe8e0d0, 0xc8d4d8, 0xd8c8a8, 0xb8c8b0, 0xd0b8b0]);
  const m = { ext, extCol, int: 'wallInt', intCol: rng.pick([0xe0d8c8, 0xd0d8d0, 0xd8ccc0]) };
  X.box(WT, 0, WT, L - WT, 0.04, D - WT, 'floorWood', { c: false });
  const W = (a, s) => ({ a, w: 1.3, b: 0.9, t: 2.2, k: 'win', st: winState(rng, 0, s || 0) });
  wall(X, 'x', 0, L, D - WT, D, 0, fh, [W(2.2), { a: 4.6, w: 1.5, b: 0, t: 2.25, k: 'door' }, W(8.2)], { ...m, out: 'p' });
  wall(X, 'x', 0, L, 0, WT, 0, fh, [W(2.0), { a: 4.8, w: 1.5, b: 0, t: 2.25, k: 'door' }, W(8.5)], { ...m, out: 'n' });
  wall(X, 'z', WT, D - WT, 0, WT, 0, fh, [W(2.5), W(6.5)], { ...m, out: 'n' });
  wall(X, 'z', WT, D - WT, L - WT, L, 0, fh, [W(2.5), W(6.5)], { ...m, out: 'p' });
  partition(X, 'z', 6.2, WT, D - WT, 0, fh, [{ a: 2.4 }, { a: 6.6 }], m);
  partition(X, 'x', 4.4, WT, 6.2, 0, fh, [{ a: 3.0 }], m);
  partition(X, 'x', 4.4, 6.2, L - WT, 0, fh, [{ a: 7.6 }], m);
  X.door(3.85, D - WT / 2, 'x', 1, 1.5, 2.25, 0, { open: rng.chance(0.3), swing: -1 });
  X.door(4.05, WT / 2, 'x', 1, 1.5, 2.25, 0, { open: rng.chance(0.3), swing: 1 });
  // ceiling (blocks access to the attic) + gable roof
  X.box(0, fh, 0, L, fh + 0.12, D, 'wallInt', { f: { ny: { m: 'wallInt', col: 0xe0dcd4 }, py: { m: 'roofTar' } }, col: 0xd0ccc4 });
  const rh = 2.3, ov = 0.5, roofCol = rng.pick([0x5a4a44, 0x4a4e58, 0x6a4a3a, 0x3e4440]);
  const y0 = fh + 0.12;
  X.quad([-ov, y0 - 0.25, D + ov], [L + ov, y0 - 0.25, D + ov], [L + ov, y0 + rh, D / 2], [-ov, y0 + rh, D / 2], 'shingle', { col: roofCol });
  X.quad([L + ov, y0 - 0.25, -ov], [-ov, y0 - 0.25, -ov], [-ov, y0 + rh, D / 2], [L + ov, y0 + rh, D / 2], 'shingle', { col: roofCol });
  X.quad([-ov, y0 + rh - 0.01, D / 2], [L + ov, y0 + rh - 0.01, D / 2], [L + ov, y0 - 0.26, D + ov], [-ov, y0 - 0.26, D + ov], 'woodDark', { col: 0x5a4a3a });
  X.quad([L + ov, y0 + rh - 0.01, D / 2], [-ov, y0 + rh - 0.01, D / 2], [-ov, y0 - 0.26, -ov], [L + ov, y0 - 0.26, -ov], 'woodDark', { col: 0x5a4a3a });
  X.tri([0, y0, D], [0, y0 + rh, D / 2], [0, y0, 0], ext, { col: extCol });
  X.tri([L, y0, 0], [L, y0 + rh, D / 2], [L, y0, D], ext, { col: extCol });
  X.box(8, y0, 2, 8.8, y0 + rh + 0.8, 2.8, 'brick', { col: 0xa08070, c: false });
  // porch
  X.box(2.8, 0, D, 6.4, 0.18, D + 1.6, 'wood', { col: 0x7a6a5a });
  X.box(2.8, 2.5, D, 6.4, 2.62, D + 1.7, 'woodDark', { col: 0x6a5a4a, c: false });
  for (const px of [2.9, 6.3]) X.box(px - 0.06, 0, D + 1.5, px + 0.06, 2.5, D + 1.62, 'wood', { col: 0xe0dcd0 });
  X.light(4.6, 2.4, D + 0.9, 'porch');
  // rooms: living (front-left), kitchen (back-left), bedroom (front-right), bath/back (back-right)
  P.sofa(X, 2.6, 7.4, 2, 0, rng.pick([0x5a4a3a, 0x4a5a6a, 0x6a5a3a]));
  P.tv(X, 2.6, 4.9, 0, 0);
  P.decal(X, 2.8, 6.2, 2.4, 1.8, 'rug', 0.05);
  P.kitchen(X, 1.8, 0.65, 2.0, 0, 0);
  P.table(X, 3.4, 2.8, 1.2, 0.8, 0, 0);
  P.chair(X, 2.9, 2.8, 1, 0, 0x6a4a2a, rng.chance(0.4));
  P.bed(X, 9.6, 6.6, 3, 0, rng);
  P.wardrobe(X, 10.3, 5.2, 3, 0);
  P.bookshelf(X, 8.6, 0.55, 0, 0, rng);
  P.lockers(X, 7.0, 0.6, 1, 0, 0, 0xe8e8e8, 'medical', 'Bathroom cabinet');
  if (rng.chance(0.5)) P.decal(X, rng.range(1, 9), rng.range(1, 8), 1.3, 1.3, 'blood', 0.06);
  spawn(X, rng.chance(0.5) ? 3 : 8.5, rng.chance(0.5) ? 2.5 : 6.5);
  X.light(3, fh - 0.3, 6.5, 'room');
  void o;
  return { L, D };
}

// ---------------------------------------------------------------- shop row
const SHOPS = [
  { name: 'PHARMACY', col: '#1e7a3c', table: 'pharmacy' },
  { name: 'DINER', col: '#a8261e', table: 'kitchen' },
  { name: 'CORNER STORE', col: '#204a8a', table: 'shop' },
  { name: 'PAWN SHOP', col: '#8a6a10', table: 'pawn' },
  { name: 'HARDWARE', col: '#c05a10', table: 'tools' },
  { name: 'LIQUOR', col: '#5a2a7a', table: 'drinks' },
  { name: 'BAKERY', col: '#9a5a3a', table: 'food' },
  { name: 'GUNS & AMMO', col: '#3a3a3a', table: 'pawn' },
  { name: 'CLINIC', col: '#2a7a8a', table: 'medical' },
  { name: 'LAUNDRY', col: '#3a6a9a', table: 'general' },
];

export function shopRow(X, n, rng, forced) {
  const sw = 9, D = 12, h = 4.4, L = n * sw;
  const ext = rng.pick(['brick', 'plaster', 'brickDark']);
  const extCol = ext === 'plaster' ? rng.pick([0xd8c8a8, 0xc8b8a8, 0xb8c0b8]) : 0xffffff;
  const m = { ext, extCol, int: 'wallInt', intCol: 0xd0c8b8 };
  X.box(WT, 0, WT, L - WT, 0.04, D - WT, 'tileCheck', { c: false });
  const front = [], back = [];
  const types = [];
  for (let i = 0; i < n; i++) {
    const t = forced && forced[i] ? SHOPS.find(s => s.name === forced[i]) : rng.pick(SHOPS);
    types.push(t);
    const x0 = i * sw;
    front.push({ a: x0 + 2.5, w: 3.6, b: 0.45, t: 3.2, k: 'shop', st: rng.chance(0.45) ? 'broken' : rng.chance(0.3) ? 'boarded' : 'glass' });
    front.push({ a: x0 + 5.6, w: 1.6, b: 0, t: 2.5, k: 'door' });
    front.push({ a: x0 + 7.6, w: 1.6, b: 0.9, t: 2.4, k: 'win', st: winState(rng, 0) });
    back.push({ a: x0 + 2, w: 1.5, b: 0, t: 2.3, k: 'door' });
    back.push({ a: x0 + 6, w: 1.0, b: 1.4, t: 2.2, k: 'win', st: winState(rng, 0) });
  }
  wall(X, 'x', 0, L, D - WT, D, 0, h, front, { ...m, out: 'p' });
  wall(X, 'x', 0, L, 0, WT, 0, h, back, { ...m, out: 'n' });
  wall(X, 'z', WT, D - WT, 0, WT, 0, h, [], { ...m, out: 'n' });
  wall(X, 'z', WT, D - WT, L - WT, L, 0, h, [], { ...m, out: 'p' });
  X.box(0, h, 0, L, h + 0.25, D, 'roofTar', { f: { ny: { m: 'wallInt', col: 0xc8c4bc } } });
  // false front
  X.box(0, h + 0.25, D - WT, L, h + 1.6, D, ext, { col: extCol });
  X.box(0, h + 0.25, 0, L, h + 0.8, WT, ext, { col: extCol });
  X.box(0, h + 0.25, WT, WT, h + 0.8, D - WT, ext, { col: extCol });
  X.box(L - WT, h + 0.25, WT, L, h + 0.8, D - WT, ext, { col: extCol });
  X.box(-0.1, h + 1.6, D - WT - 0.1, L + 0.1, h + 1.75, D + 0.15, 'concrete', { c: false, col: 0xb0aca4 });
  for (let i = 0; i < n; i++) {
    const x0 = i * sw, t = types[i];
    if (i > 0) partition(X, 'z', x0, WT, D - WT, 0, h, [], m);
    partition(X, 'x', 3.2, x0 + 0.1, x0 + sw - 0.1, 0, h, [{ a: x0 + 6.5, w: 1.5 }], m);
    X.door(x0 + 4.8, D - WT / 2, 'x', 1, 1.6, 2.5, 0, { open: rng.chance(0.4), swing: -1, kind: 'glassdoor' });
    X.door(x0 + 1.25, WT / 2, 'x', 1, 1.5, 2.3, 0, { open: rng.chance(0.2), swing: 1, kind: 'metal' });
    // sign + awning
    X.sign(x0 + sw / 2, h + 0.9, D + 0.02, sw - 1.2, 0.9, 'pz', 'sign:' + t.name + ':' + t.col);
    const awCol = rng.pick([0x8a2a2a, 0x2a5a3a, 0x2a3a6a, 0x6a5a2a, 0x5a5a5a]);
    if (rng.chance(0.7)) {
      X.quad([x0 + 0.5, 3.4, D + 1.5], [x0 + sw - 0.5, 3.4, D + 1.5], [x0 + sw - 0.5, 4.0, D], [x0 + 0.5, 4.0, D], 'tarp', { col: awCol });
      X.quad([x0 + sw - 0.5, 3.4, D + 1.5], [x0 + 0.5, 3.4, D + 1.5], [x0 + 0.5, 4.0, D], [x0 + sw - 0.5, 4.0, D], 'tarp', { col: awCol });
    }
    // interior
    const S = X.sub(x0, 0, 0);
    S.light(sw / 2, h - 0.4, 7, 'fluoro');
    S.box(2, h - 0.3, 7, 3.2, h - 0.25, 7.3, 'lampCool', { c: false, lod: 1 });
    if (t.name === 'DINER') {
      P.counter(S, 4.5, 4.6, 6, 0, 0, 0x8a3a2a);
      for (let k = 0; k < 4; k++) { P.table(S, 1.6, 6 + k * 1.5, 1.0, 0.7, 0, 0, 0xc8c0b0); }
      P.kitchen(S, 6.5, 3.65, 2.0, 0, 0);
    } else if (t.name === 'LAUNDRY') {
      for (let k = 0; k < 5; k++) S.box(1 + k * 1.4, 0, 3.4, 2.2 + k * 1.4, 1.0, 4.2, 'metal', { col: 0xe0e0e0, lod: 1 });
      P.bench(S, 4.5, 8, 0);
    } else {
      P.counter(S, 6.6, 9.6, 2.4, 1, 0);
      P.shelf(S, 3.2, 5.2, 4.5, 0, 0, rng, t.table, t.name === 'PHARMACY' ? 'Pharmacy shelf' : 'Shelf');
      P.shelf(S, 3.2, 7.7, 4.5, 0, 0, rng, t.table, 'Shelf', 1.4);
      P.shelf(S, 0.5, 6.5, 3.5, 1, 0, rng, t.table, 'Wall shelf');
    }
    // back room
    P.crate(S, 4.0, 1.2, 0, 0.9, rng.chance(0.6), rng);
    P.shelf(S, 6.5, 0.7, 3, 0, 0, rng, t.table, 'Storage shelf');
    if (rng.chance(0.5)) P.decal(S, rng.range(1.5, 7), rng.range(4, 10), 1.6, 1.6, 'blood', 0.06);
    spawn(S, 4.5, 6.5);
    // awnings collide nothing; posters
    if (rng.chance(0.5)) S.sign(rng.range(1, 3.5), 3.75, D + 0.02, 0.8, 0.5, 'pz', 'poster', { lod: 1 });
  }
  return { L, D, types };
}

// ---------------------------------------------------------------- supermarket
export function supermarket(X, rng) {
  const L = 40, D = 28, h = 5.5;
  const m = { ext: 'concrete', extCol: 0xd8d0c0, int: 'wallInt', intCol: 0xe0dcd0, frameCol: 0x405060 };
  X.box(WT, 0, WT, L - WT, 0.04, D - WT, 'tileCheck', { c: false, col: 0xe8e8e8 });
  const front = [];
  for (let a = 3; a < L - 3; a += 5.2) {
    if (Math.abs(a - 13.4) < 2 || Math.abs(a - 28.9) < 2) front.push({ a, w: 2.6, b: 0, t: 2.7, k: 'open' });
    else front.push({ a, w: 4.4, b: 0.5, t: 3.6, k: 'shop', st: rng.chance(0.45) ? 'broken' : 'glass' });
  }
  wall(X, 'x', 0, L, D - WT, D, 0, h, front, { ...m, out: 'p' });
  wall(X, 'x', 0, L, 0, WT, 0, h, [{ a: 6, w: 3.6, b: 0, t: 3.5, k: 'open' }, { a: 34, w: 1.6, b: 0, t: 2.4, k: 'door' }], { ...m, out: 'n' });
  wall(X, 'z', WT, D - WT, 0, WT, 0, h, [], { ...m, out: 'n' });
  wall(X, 'z', WT, D - WT, L - WT, L, 0, h, [], { ...m, out: 'p' });
  X.door(33.2, WT / 2, 'x', 1, 1.6, 2.4, 0, { swing: 1, kind: 'metal' });
  X.box(0, h, 0, L, h + 0.3, D, 'roofTar', { f: { ny: { m: 'wallInt', col: 0xc8c8c4 } } });
  roofline(X, L, D, h + 0.3, { ext: 'concrete', extCol: 0xd8d0c0, parapet: 1.2 }, rng);
  // sign band + canopy
  X.box(4, h + 0.6, D, 36, h + 2.4, D + 0.3, 'metal', { c: false, col: 0x2a3a5a });
  X.sign(20, h + 1.5, D + 0.31, 26, 1.5, 'pz', 'sign:SUPERMARKET:#c82a1e');
  X.box(-0.2, 3.8, D, L + 0.2, 4.1, D + 3, 'concrete', { col: 0xc8c4bc });
  for (let a = 2; a < L; a += 9) X.box(a - 0.15, 0, D + 2.7, a + 0.15, 3.8, D + 3, 'metal', { col: 0x8a8c90 });
  // pillars
  for (let x = 10; x < L - 2; x += 10) for (let z = 8; z < D - 2; z += 11) X.box(x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25, 'concrete', { col: 0xd0ccc4 });
  // backroom
  partition(X, 'x', 6, WT, L - WT, 0, h, [{ a: 8, w: 2.6, t: 2.8 }, { a: 30, w: 1.6 }], m);
  for (let i = 0; i < 4; i++) P.crate(X, 3 + i * 1.3, 1.2, 0, 1, i % 2 === 0, rng);
  P.shelf(X, 20, 0.7, 8, 0, 0, rng, 'food', 'Storage rack', 2.2);
  P.shelf(X, 28, 3.0, 6, 0, 0, rng, 'drinks', 'Storage rack', 2.2);
  // aisles
  for (let i = 0; i < 7; i++) {
    const ax = 5 + i * 4.2;
    const tab = rng.pick(['food', 'food', 'drinks', 'general', 'medical']);
    P.shelf(X, ax, 13.5, 7, 1, 0, rng, tab, 'Aisle shelf');
  }
  P.cooler(X, L - 0.8, 15, 14, 3);
  for (let i = 0; i < 4; i++) P.counter(X, 7 + i * 5, 22.5, 2.4, 1, 0, 0x4a4a4a);
  for (let i = 0; i < 6; i++) if (rng.chance(0.6)) P.decal(X, rng.range(3, 37), rng.range(8, 26), rng.range(1, 2), rng.range(1, 2), rng.chance(0.4) ? 'blood' : 'stain', 0.05);
  for (let x = 6; x < L; x += 9) for (let z = 10; z < D; z += 8) { X.light(x, h - 0.4, z, 'fluoro'); X.box(x - 0.8, h - 0.3, z - 0.12, x + 0.8, h - 0.25, z + 0.12, 'lampCool', { c: false, lod: 1 }); }
  for (let i = 0; i < 5; i++) spawn(X, rng.range(4, 36), rng.range(9, 25));
  return { L, D };
}

// ---------------------------------------------------------------- warehouse
export function warehouse(X, rng, L = 40, D = 24) {
  const h = 8;
  const col = rng.pick([0x8a9aa8, 0xa89a7a, 0x7a8a7a, 0x9a8a8a]);
  const m = { ext: 'corrugated', extCol: col, int: 'corrugated', intCol: 0xa0a0a0 };
  X.box(WT, 0, WT, L - WT, 0.04, D - WT, 'concreteDark', { c: false });
  const hi = (a) => ({ a, w: 3, b: 5.6, t: 6.8, k: 'win', st: rng.chance(0.5) ? 'broken' : 'glass' });
  const front = [{ a: 8, w: 5, b: 0, t: 4.8, k: 'open' }, { a: 20, w: 5, b: 0, t: 4.8, k: 'open' }, hi(28), { a: 34, w: 1.6, b: 0, t: 2.4, k: 'door' }];
  wall(X, 'x', 0, L, D - WT, D, 0, h, front, { ...m, out: 'p' });
  wall(X, 'x', 0, L, 0, WT, 0, h, [hi(8), hi(16), hi(24), hi(32)], { ...m, out: 'n' });
  wall(X, 'z', WT, D - WT, 0, WT, 0, h, [hi(6), hi(D - 6)], { ...m, out: 'n' });
  wall(X, 'z', WT, D - WT, L - WT, L, 0, h, [{ a: D / 2, w: 1.6, b: 0, t: 2.4, k: 'door' }], { ...m, out: 'p' });
  X.door(33.2, D - WT / 2, 'x', 1, 1.6, 2.4, 0, { swing: -1, kind: 'metal' });
  X.door(L - WT / 2, D / 2 - 0.8, 'z', 1, 1.6, 2.4, 0, { swing: 1, kind: 'metal', open: true });
  // half-open rolling doors
  for (const a of [8, 20]) X.box(a - 2.5, 3.2, D - WT, a + 2.5, 4.8, D - 0.1, 'corrugated', { col: 0x6a6a6a, c: false });
  X.box(-0.2, h, -0.2, L + 0.2, h + 0.3, D + 0.2, 'corrugated', { col: 0x6a6a6a, f: { ny: { m: 'corrugated', col: 0x8a8a8a } } });
  for (let x = 4; x < L; x += 6) X.box(x - 0.1, h - 0.6, WT, x + 0.1, h, D - WT, 'metal', { col: 0x4a4a4a, c: false, lod: 1 });
  // racks
  for (let i = 0; i < 3; i++) {
    const z = 4 + i * 4.2;
    for (let x = 4; x < L - 8; x += 7.5) {
      const P2 = X.sub(x + 3, z, 0);
      for (const lx of [-3, 3]) P2.box(lx - 0.06, 0, -0.55, lx + 0.06, 5.2, 0.55, 'metal', { col: 0x2a4a8a, c: false });
      P2.box(-3, 0, -0.55, 3, 5.2, 0.55, 'solid', { invisible: true });
      for (const y of [1.6, 3.2, 4.8]) P2.box(-3, y, -0.55, 3, y + 0.1, 0.55, 'metal', { col: 0xc06020, c: false });
      for (const y of [0, 1.7, 3.3]) for (let k = -2; k <= 2; k += 2) if (rng.chance(0.65)) P2.box(k - 0.6, y, -0.5, k + 0.6, y + rng.range(0.8, 1.3), 0.5, 'crate', { col: rng.pick([0xc8b898, 0xb8a888, 0xa8c0d0]), c: false, lod: 1 });
      if (rng.chance(0.6)) P2.container(0, 1, 0.8, 'shelf', 'Pallet rack', rng.pick(['tools', 'crate', 'food']));
    }
  }
  // office corner
  partition(X, 'x', D - 7, L - 9, L - WT, 0, 3, [{ a: L - 5 }], m);
  partition(X, 'z', L - 9, D - 7, D - WT, 0, 3, [], m);
  X.box(L - 9, 3, D - 7, L - WT, 3.15, D - WT, 'concrete', { col: 0x8a8a8a });
  P.desk(X, L - 5, D - 3, 0, 0, rng, 'office');
  P.lockers(X, L - 1, D - 4, 2, 3, 0, 0x6a6a6a, 'tools', 'Tool locker');
  for (let i = 0; i < 4; i++) P.crate(X, rng.range(3, L - 12), rng.range(16, D - 3), 0, rng.range(0.8, 1.2), rng.chance(0.5), rng);
  for (let i = 0; i < 4; i++) P.barrel(X, rng.range(2, L - 10), rng.range(15, D - 2));
  for (let x = 8; x < L; x += 12) X.light(x, h - 1, D / 2, 'fluoro');
  for (let i = 0; i < 3; i++) spawn(X, rng.range(4, 30), rng.range(15, 21));
  return { L, D };
}

// Ramp: smooth visual slope, stepped colliders (walkable), rising along +x from x0 to x1.
export function ramp(X, x0, x1, z0, z1, y0, y1, dirNeg = false) {
  const n = Math.ceil((y1 - y0) / 0.14);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const top = y0 + (y1 - y0) * t1;
    const a = dirNeg ? x1 - (x1 - x0) * t1 : x0 + (x1 - x0) * t0;
    const b = dirNeg ? x1 - (x1 - x0) * t0 : x0 + (x1 - x0) * t1;
    X.box(a, Math.max(y0, top - 0.5), z0, b, top, z1, 'solid', { invisible: true });
  }
  const ya = dirNeg ? y1 : y0, yb = dirNeg ? y0 : y1;
  X.quad([x0, ya + 0.02, z1], [x1, yb + 0.02, z1], [x1, yb + 0.02, z0], [x0, ya + 0.02, z0], 'concreteDark', {});
  X.quad([x1, yb - 0.3, z0], [x0, ya - 0.3, z0], [x0, ya - 0.3, z1], [x1, yb - 0.3, z1], 'concrete', { col: 0x9a9a94 });
}

// ---------------------------------------------------------------- parking garage
export function garage(X, rng) {
  const L = 44, D = 32, fh = 3.2, levels = 2;
  X.box(0, 0, 0, L, 0.03, D, 'concreteDark', { c: false });
  const sx = 1.6, sz = 0.3;
  const holes = stairCore(X, sx, sz, fh, levels, 'concrete');
  // stair enclosure
  X.box(0, 0, 0, sx + 6.3, levels * fh + 2.6, 0.3, 'concrete', { col: 0xb8b4aa });
  X.box(0, 0, 0.3, 0.3, levels * fh + 2.6, 3.9, 'concrete', { col: 0xb8b4aa });
  X.box(sx + 6.0, 0, 0.3, sx + 6.3, levels * fh + 2.6, 2.0, 'concrete', { col: 0xb8b4aa });
  X.box(0, levels * fh + 2.6, 0, sx + 6.3, levels * fh + 2.8, 3.9, 'concrete', { col: 0xb8b4aa, c: false });
  // ramps on the east side: ground->1 goes +x... ramp lanes z in [D-7, D-1]
  const rz0 = D - 7.5, rz1 = D - 1.5;
  ramp(X, 14, 34, rz0, rz1, 0, fh);
  ramp(X, 14, 34, rz0 - 6.5, rz0 - 0.5, fh, 2 * fh, true);
  for (let k = 1; k <= levels; k++) {
    const y = k * fh;
    const hole = k === 1 ? { x0: 14, x1: 34, z0: rz0, z1: rz1 } : { x0: 14, x1: 34, z0: rz0 - 6.5, z1: rz0 - 0.5 };
    slab(X, { x0: 0, z0: 0, x1: L, z1: D }, y, 0.3, [holes[k - 1], hole, { x0: 0, x1: sx + 6.3, z0: 0, z1: 0.3 }, { x0: 0, x1: 0.3, z0: 0.3, z1: 3.9 }], 'concreteDark', 'concrete', { botCol: 0xb0aca4 });
    // parapets with gaps for stairs
    X.box(sx + 6.3, y, 0, L, y + 1.1, 0.3, 'concrete', { col: 0xc8c4ba });
    X.box(0, y, D - 0.3, L, y + 1.1, D, 'concrete', { col: 0xc8c4ba });
    X.box(0, y, 3.9, 0.3, y + 1.1, D - 0.3, 'concrete', { col: 0xc8c4ba });
    X.box(L - 0.3, y, 0.3, L, y + 1.1, D - 0.3, 'concrete', { col: 0xc8c4ba });
    X.box(sx + 6.3, y + 1.1, -0.05, L, y + 1.3, 0.05, 'metal', { c: false, col: 0x5a5a5a });
    // hole guard rails
    X.box(14, y, hole.z0 - 0.08, 34, y + 1.0, hole.z0, 'metal', { col: 0xc8a020 });
    X.box(14, y, hole.z1, 34, y + 1.0, hole.z1 + 0.08, 'metal', { col: 0xc8a020 });
    if (k === 1) X.box(13.92, y, rz0, 14, y + 1.0, rz1, 'metal', { col: 0xc8a020 });
    else X.box(34, y, hole.z0, 34.08, y + 1.0, hole.z1, 'metal', { col: 0xc8a020 });
    for (let i = 0; i < 8; i++) {
      const cx = 8 + i * 4.4;
      if (rng.chance(0.45)) P.car(X, cx, y, 9.5, Math.PI / 2 + rng.range(-0.1, 0.1), carColor(rng), rng.chance(0.4) ? 1 : 0);
      X.hplane(cx - 2.15, 6.5, cx - 2.05, 12.5, y + 0.01, 'paint', {});
    }
    X.light(L / 2, y - 0.4, D / 2, 'fluoro');
    if (k === levels) { for (const [lx, lz] of [[8, 14], [38, 14], [24, 4]]) X.inst('lamp', lx, y, lz, 0, 1); }
  }
  // columns
  for (let x = 8; x < L; x += 8) for (let z = 5; z < D; z += 9) {
    if (x > 13 && x < 35 && z > rz0 - 7 && z < rz1 + 0.5) continue;
    X.box(x - 0.3, 0, z - 0.3, x + 0.3, levels * fh, z + 0.3, 'concrete', { col: 0xc0bcb2 });
  }
  // ground parapets with entry gap (front = +z)
  X.box(0, 0, D - 0.3, 10, 1.0, D, 'concrete', { col: 0xc8c4ba });
  X.box(36, 0, D - 0.3, L, 1.0, D, 'concrete', { col: 0xc8c4ba });
  X.box(L - 0.3, 0, 0.3, L, 1.0, D - 0.3, 'concrete', { col: 0xc8c4ba });
  X.box(sx + 6.3, 0, 0, L, 1.0, 0.3, 'concrete', { col: 0xc8c4ba });
  X.box(0, 0, 3.9, 0.3, 1.0, D - 0.3, 'concrete', { col: 0xc8c4ba });
  for (let i = 0; i < 8; i++) if (rng.chance(0.5)) P.car(X, 8 + i * 4.4, 0, 9.5, Math.PI / 2, carColor(rng), rng.chance(0.3) ? 1 : 0);
  X.sign(L / 2 - 6, 2.6, D + 0.02, 6, 1.2, 'pz', 'sign:PARKING:#1a4a9a');
  for (let i = 0; i < 4; i++) spawn(X, rng.range(5, 40), rng.range(10, 18), false);
  return { L, D };
}

export function carColor(rng) {
  return rng.pick([0x8a1a1a, 0x1a3a6a, 0xd0d0d0, 0x2a2a2a, 0x4a5a3a, 0x7a6a4a, 0x5a5a62, 0xa89a6a, 0x2a4a4a, 0xe0e0d8]);
}

// ---------------------------------------------------------------- petrol station
export function petrolStation(X, rng) {
  // canopy over pumps; local area [0,30]x[0,28], shop at back
  const cx0 = 4, cx1 = 24, cz0 = 14, cz1 = 25;
  for (const [x, z] of [[cx0 + 1, cz0 + 1], [cx1 - 1, cz0 + 1], [cx0 + 1, cz1 - 1], [cx1 - 1, cz1 - 1]]) X.box(x - 0.3, 0, z - 0.3, x + 0.3, 5, z + 0.3, 'metal', { col: 0xd8d8d8 });
  X.box(cx0, 5, cz0, cx1, 5.7, cz1, 'metal', { col: 0xe8e8e0, f: { ny: { m: 'metal', col: 0xc8c8c0 } } });
  X.box(cx0 - 0.05, 5.1, cz1, cx1 + 0.05, 5.6, cz1 + 0.06, 'metal', { c: false, col: 0xc81e1e });
  X.box(cx0 - 0.05, 5.1, cz0 - 0.06, cx1 + 0.05, 5.6, cz0, 'metal', { c: false, col: 0xc81e1e });
  X.sign((cx0 + cx1) / 2, 5.35, cz1 + 0.07, 8, 0.5, 'pz', 'sign:FUEL:#c81e1e');
  for (let x = cx0 + 3; x < cx1; x += 6) for (let z = cz0 + 3.5; z < cz1; z += 4) {
    X.box(x - 1.5, 5.0, z - 0.3, x + 1.5, 5.02, z + 0.3, 'lampCool', { c: false });
    X.light(x, 4.8, z, 'canopy');
  }
  const pumps = [];
  for (const px of [cx0 + 6, cx1 - 6]) {
    X.box(px - 2, 0, (cz0 + cz1) / 2 - 0.6, px + 2, 0.18, (cz0 + cz1) / 2 + 0.6, 'concrete', { col: 0xb8b4aa });
    for (const dz of [-1.1, 1.1]) {
      const z = (cz0 + cz1) / 2;
      X.box(px + dz - 0.35, 0.18, z - 0.3, px + dz + 0.35, 1.7, z + 0.3, 'metal', { col: 0xd8d8d0 });
      X.box(px + dz - 0.36, 1.2, z - 0.31, px + dz + 0.36, 1.6, z + 0.31, 'metal', { c: false, col: 0xc81e1e });
      pumps.push(X.interact('pump', px + dz, 1, z + 0.6, { fuel: 60, name: 'Fuel pump' }));
    }
  }
  // kiosk
  const K = X.sub(5, 2, 0);
  const L = 14, D = 8, h = 3.6;
  const m = { ext: 'plaster', extCol: 0xe0dcd0, int: 'wallInt', intCol: 0xe0e0d8 };
  K.box(WT, 0, WT, L - WT, 0.04, D - WT, 'tileCheck', { c: false });
  wall(K, 'x', 0, L, D - WT, D, 0, h, [{ a: 3, w: 3.6, b: 0.5, t: 2.9, k: 'shop', st: 'broken' }, { a: 7, w: 1.6, b: 0, t: 2.5, k: 'door' }, { a: 11, w: 3.6, b: 0.5, t: 2.9, k: 'shop', st: rng.chance(0.5) ? 'broken' : 'glass' }], { ...m, out: 'p' });
  wall(K, 'x', 0, L, 0, WT, 0, h, [{ a: 11, w: 1.5, b: 0, t: 2.3, k: 'door' }], { ...m, out: 'n' });
  wall(K, 'z', WT, D - WT, 0, WT, 0, h, [], { ...m, out: 'n' });
  wall(K, 'z', WT, D - WT, L - WT, L, 0, h, [], { ...m, out: 'p' });
  K.box(-0.3, h, -0.3, L + 0.3, h + 0.5, D + 0.3, 'metal', { col: 0xc81e1e, f: { ny: { m: 'wallInt', col: 0xd0d0d0 }, py: { m: 'roofTar' } } });
  K.door(6.2, D - WT / 2, 'x', 1, 1.6, 2.5, 0, { open: true, swing: -1, kind: 'glassdoor' });
  K.door(10.25, WT / 2, 'x', 1, 1.5, 2.3, 0, { swing: 1, kind: 'metal' });
  K.sign(L / 2, h + 0.25, D + 0.31, 10, 0.45, 'pz', 'sign:GAS & SNACKS:#1a1a1a');
  P.counter(K, 11.5, 4.5, 2.6, 1, 0);
  P.shelf(K, 4, 4.2, 4.5, 0, 0, rng, 'food', 'Snack shelf');
  P.shelf(K, 4, 2.0, 4.5, 0, 0, rng, 'general', 'Shelf');
  P.cooler(K, 0.75, 4, 6, 1);
  K.container(13.2, 0.6, 1.2, 'crate', 'Jerry can rack', 'fuel');
  K.box(12.6, 0, 0.5, 13.6, 0.8, 1.6, 'rust', { col: 0xa82a1a, lod: 1 });
  K.light(L / 2, h - 0.4, D / 2, 'fluoro');
  spawn(K, 7, 4);
  // price pylon
  X.box(27, 0, 26, 27.6, 6.5, 26.6, 'metal', { col: 0x8a8a8a });
  X.box(25.8, 6.5, 26.1, 28.8, 9, 26.5, 'metal', { col: 0xc81e1e });
  X.sign(27.3, 7.75, 26.51, 2.8, 2.3, 'pz', 'sign:FUEL 4.99:#c81e1e');
  // fuel tanker wreck
  X.box(26, 0, 6, 28.5, 3.2, 9, 'metal', { col: 0xc8c8c8 });
  X.box(25.9, 0.9, 9.5, 28.6, 3.3, 19.5, 'solid', { invisible: true });
  for (let z = 10; z < 19.5; z += 0.5) {
    const a = 1.25;
    X.box(27.25 - a, 1.0 + 0.0, z, 27.25 + a, 3.2, z + 0.5, 'metal', { col: 0xb8bcc0, c: false, lod: 0 });
  }
  return { pumps };
}

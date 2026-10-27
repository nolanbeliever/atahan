// Furniture and street props. Each function takes a transform X, a centre (x,z) and
// a quarter-turn rotation r; geometry is authored around the origin, front = +z.
// Interior details use LOD 1 so they can be hidden at distance.

const D = { lod: 1 };
const L1 = (o) => Object.assign({ lod: 1 }, o);

export function bed(X, x, z, r = 0, y = 0, rng) {
  const P = X.sub(x, z, r);
  const blanket = rng ? rng.pick([0x5a6e8a, 0x7a4a3c, 0x6b6b4a, 0x8a8a90, 0x3d4f5a]) : 0x5a6e8a;
  P.box(-0.5, y, -1, 0.5, y + 0.35, 1, 'wood', L1({ col: 0x8a6a4a }));
  P.box(-0.47, y + 0.35, -0.97, 0.47, y + 0.52, 0.97, 'fabric', L1({ col: 0xb8b0a0, c: false }));
  P.box(-0.48, y + 0.52, -0.3, 0.48, y + 0.56, 0.98, 'fabric', L1({ col: blanket, c: false }));
  P.box(-0.35, y + 0.52, -0.95, 0.35, y + 0.64, -0.6, 'fabric', L1({ col: 0xd0ccc0, c: false }));
  P.box(-0.5, y, -1.06, 0.5, y + 1.0, -0.98, 'wood', L1({ col: 0x6a4a30 }));
}

export function hospitalBed(X, x, z, r = 0, y = 0) {
  const P = X.sub(x, z, r);
  P.box(-0.48, y + 0.45, -1, 0.48, y + 0.6, 1, 'metal', L1({ col: 0xc8ccd0 }));
  P.box(-0.45, y + 0.6, -0.95, 0.45, y + 0.72, 0.95, 'fabric', L1({ col: 0xc6d6d8, c: false }));
  for (const sx of [-0.42, 0.42]) for (const sz of [-0.9, 0.9]) P.box(sx - 0.03, y, sz - 0.03, sx + 0.03, y + 0.45, sz + 0.03, 'metal', L1({ c: false }));
  P.box(-0.48, y + 0.6, -1.02, 0.48, y + 1.1, -0.96, 'metal', L1({ col: 0xb0b6bc, c: false }));
  P.box(0.48, y + 0.72, -0.5, 0.51, y + 0.95, 0.5, 'metal', L1({ c: false }));
  // IV stand
  P.cyl(0.75, y, -0.8, 0.02, 1.8, 5, 'metal', L1({ c: false }));
  P.box(0.68, y + 1.55, -0.85, 0.82, y + 1.75, -0.78, 'glass', L1({ c: false }));
  P.box(-0.48, y, -1, 0.48, y + 0.72, 1, 'solid', { c: true, invisible: true });
}

export function table(X, x, z, w = 1.2, d = 0.8, r = 0, y = 0, col = 0x7a5a3a) {
  const P = X.sub(x, z, r);
  P.box(-w / 2, y + 0.72, -d / 2, w / 2, y + 0.77, d / 2, 'wood', L1({ col, c: false }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(sx * (w / 2 - 0.06) - 0.03, y, sz * (d / 2 - 0.06) - 0.03, sx * (w / 2 - 0.06) + 0.03, y + 0.72, sz * (d / 2 - 0.06) + 0.03, 'wood', L1({ col, c: false }));
  P.box(-w / 2, y, -d / 2, w / 2, y + 0.77, d / 2, 'solid', { invisible: true });
}

export function chair(X, x, z, r = 0, y = 0, col = 0x6a4a2a, fallen = false) {
  const P = X.sub(x, z, r);
  if (fallen) {
    P.box(-0.22, y, -0.25, 0.22, y + 0.05, 0.2, 'wood', L1({ col, c: false }));
    P.box(-0.22, y, 0.2, 0.22, y + 0.45, 0.25, 'wood', L1({ col, c: false }));
    return;
  }
  P.box(-0.22, y + 0.42, -0.22, 0.22, y + 0.47, 0.22, 'wood', L1({ col, c: false }));
  P.box(-0.22, y + 0.47, -0.24, 0.22, y + 0.95, -0.2, 'wood', L1({ col, c: false }));
  for (const sx of [-0.19, 0.19]) for (const sz of [-0.19, 0.19]) P.box(sx - 0.02, y, sz - 0.02, sx + 0.02, y + 0.42, sz + 0.02, 'wood', L1({ col, c: false }));
}

export function sofa(X, x, z, r = 0, y = 0, col = 0x5a4a3a) {
  const P = X.sub(x, z, r);
  P.box(-1, y, -0.45, 1, y + 0.42, 0.45, 'fabric', L1({ col }));
  P.box(-1, y + 0.42, -0.45, 1, y + 0.85, -0.25, 'fabric', L1({ col, c: false }));
  P.box(-1, y + 0.42, -0.45, -0.85, y + 0.62, 0.45, 'fabric', L1({ col, c: false }));
  P.box(0.85, y + 0.42, -0.45, 1, y + 0.62, 0.45, 'fabric', L1({ col, c: false }));
}

export function wardrobe(X, x, z, r = 0, y = 0) {
  const P = X.sub(x, z, r);
  P.box(-0.5, y, -0.3, 0.5, y + 2.0, 0.3, 'wood', L1({ col: 0x7a5a40 }));
  P.box(-0.01, y + 0.1, 0.3, 0.01, y + 1.9, 0.31, 'woodDark', L1({ c: false }));
  P.container(0, y + 1, 0.35, 'wardrobe', 'Wardrobe');
}

export function kitchen(X, x, z, len = 2.4, r = 0, y = 0) {
  const P = X.sub(x, z, r);
  P.box(-len / 2, y, -0.3, len / 2, y + 0.88, 0.3, 'wood', L1({ col: 0xc8c0b0 }));
  P.box(-len / 2, y + 0.88, -0.32, len / 2, y + 0.92, 0.32, 'concrete', L1({ col: 0x6a6660, c: false }));
  P.box(-len / 2, y + 1.5, -0.3, len / 2, y + 2.1, 0.05, 'wood', L1({ col: 0xc8c0b0, c: false }));
  P.box(len / 2, y, -0.35, len / 2 + 0.75, y + 1.8, 0.35, 'metal', L1({ col: 0xe0e0dc }));
  P.container(len / 2 + 0.37, y + 1, 0.4, 'fridge', 'Fridge', 'kitchen');
  P.container(-len / 4, y + 0.6, 0.35, 'cabinet', 'Kitchen cabinet', 'kitchen');
}

export function desk(X, x, z, r = 0, y = 0, rng, loot = 'office') {
  const P = X.sub(x, z, r);
  P.box(-0.7, y + 0.72, -0.35, 0.7, y + 0.76, 0.35, 'wood', L1({ col: 0x5a4a3a, c: false }));
  P.box(-0.7, y, -0.35, -0.3, y + 0.72, 0.35, 'wood', L1({ col: 0x4a3a2a, c: false }));
  P.box(0.66, y, -0.35, 0.7, y + 0.72, 0.35, 'wood', L1({ col: 0x4a3a2a, c: false }));
  P.box(-0.7, y, -0.35, 0.7, y + 0.76, 0.35, 'solid', { invisible: true });
  P.box(-0.25, y + 0.76, -0.25, 0.25, y + 1.1, -0.2, 'solid', L1({ col: 0x202224, c: false }));
  P.box(0.2, y + 0.76, 0, 0.45, y + 0.78, 0.2, 'solid', L1({ col: 0xe8e4d8, c: false }));
  chair(X.sub(x, z, r), 0, 0.65, 2, y, 0x303030, rng ? rng.chance(0.3) : false);
  P.container(-0.5, y + 0.5, 0.4, 'desk', 'Desk', loot);
}

export function lockers(X, x, z, n = 3, r = 0, y = 0, col = 0x5a6a78, table = 'locker', name = 'Locker') {
  const P = X.sub(x, z, r);
  const w = 0.5;
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * w;
    P.box(lx - w / 2 + 0.01, y, -0.25, lx + w / 2 - 0.01, y + 1.9, 0.25, 'metal', L1({ col }));
    P.box(lx - 0.15, y + 1.6, 0.25, lx + 0.15, y + 1.7, 0.26, 'frame', L1({ c: false }));
  }
  P.container(0, y + 1, 0.35, 'locker', name, table);
}

export function shelf(X, x, z, len = 3, r = 0, y = 0, rng, table = 'shop', name = 'Shelf', h = 1.8) {
  const P = X.sub(x, z, r);
  const n = Math.max(2, Math.round(h / 0.45));
  P.box(-len / 2, y, -0.3, len / 2, y + h, 0.3, 'metal', { invisible: true });
  P.box(-len / 2, y, -0.04, len / 2, y + h, 0.04, 'metal', L1({ col: 0x8a8c90, c: false }));
  for (const sx of [-len / 2, len / 2 - 0.05]) P.box(sx, y, -0.3, sx + 0.05, y + h, 0.3, 'metal', L1({ col: 0x6a6c70, c: false }));
  for (let k = 0; k < n; k++) {
    const sy = y + 0.12 + k * (h - 0.2) / (n - 1);
    P.box(-len / 2, sy, -0.3, len / 2, sy + 0.03, 0.3, 'metal', L1({ col: 0x9a9ca0, c: false }));
    if (!rng || k === n - 1) continue;
    // goods, many missing (looted)
    for (let gx = -len / 2 + 0.1; gx < len / 2 - 0.2; gx += 0.22) {
      if (rng.chance(0.55)) continue;
      const gh = rng.range(0.12, 0.3), side = rng.chance(0.5) ? 1 : -1;
      const col = rng.pick([0xb03a2e, 0x2e6eb0, 0xd8c040, 0x3a8a4a, 0xe0e0e0, 0x8a4ab0, 0xd07a2a]);
      P.box(gx, sy + 0.03, side * 0.06, gx + 0.16, sy + 0.03 + gh, side * 0.26, 'solid', L1({ col, c: false }));
    }
  }
  P.container(0, y + 1, 0.4, 'shelf', name, table);
}

export function counter(X, x, z, len = 2.5, r = 0, y = 0, col = 0x6a5040) {
  const P = X.sub(x, z, r);
  P.box(-len / 2, y, -0.35, len / 2, y + 1.0, 0.35, 'wood', L1({ col }));
  P.box(-len / 2 - 0.02, y + 1.0, -0.38, len / 2 + 0.02, y + 1.04, 0.38, 'concrete', L1({ col: 0x9a948a, c: false }));
  P.box(0.4, y + 1.04, -0.2, 0.8, y + 1.25, 0.15, 'solid', L1({ col: 0x2a2a2a, c: false }));
}

export function crate(X, x, z, y = 0, s = 1, loot = true, rng) {
  X.box(x - 0.5 * s, y, z - 0.5 * s, x + 0.5 * s, y + s, z + 0.5 * s, 'crate', { lod: 1, col: rng ? rng.pick([0xffffff, 0xd8d0c0, 0xb8b0a0]) : 0xffffff });
  if (loot) X.container(x, y + s * 0.5, z, 'crate', 'Supply crate', 'crate');
}

export function barrel(X, x, z, y = 0, col = 0x7a3a28) {
  X.cyl(x, y, z, 0.3, 0.9, 10, 'rust', { col, lod: 1 });
}

export function dumpster(X, x, z, r = 0, rng) {
  const P = X.sub(x, z, r);
  const col = rng ? rng.pick([0x2f5a3a, 0x2a3e5a, 0x5a3a2a, 0x4a4a48]) : 0x2f5a3a;
  P.box(-1, 0, -0.6, 1, 1.25, 0.6, 'rust', { col });
  P.box(-1.02, 1.25, -0.62, 1.02, 1.3, 0.1, 'rust', { col: 0x2a2a2a, c: false });
  P.box(-1.05, 1.0, -0.62, 1.05, 1.08, 0.62, 'rust', { col, c: false });
  P.container(0, 1, 0.7, 'dumpster', 'Dumpster', 'trash');
}

export function bench(X, x, z, r = 0) {
  const P = X.sub(x, z, r);
  for (let i = 0; i < 3; i++) P.box(-0.9, 0.42, -0.2 + i * 0.14, 0.9, 0.46, -0.1 + i * 0.14, 'wood', { col: 0x6a4a30, c: false });
  P.box(-0.9, 0.5, -0.24, 0.9, 0.85, -0.2, 'wood', { col: 0x6a4a30, c: false });
  for (const sx of [-0.75, 0.75]) P.box(sx - 0.03, 0, -0.22, sx + 0.03, 0.46, 0.2, 'metal', { col: 0x2a2a2a, c: false });
  P.box(-0.9, 0, -0.24, 0.9, 0.5, 0.2, 'solid', { invisible: true });
}

export function sandbags(X, x0, z0, x1, z1, h = 1.0) {
  // axis aligned wall of sandbags
  const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const len = along ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const rows = Math.round(h / 0.25);
  for (let k = 0; k < rows; k++) {
    const off = (k % 2) * 0.3;
    for (let a = -off; a < len - 0.1; a += 0.6) {
      const s0 = Math.max(0, a), s1 = Math.min(len, a + 0.58);
      const y = k * 0.25;
      const col = 0x8a7a58 - ((k * 7 + Math.floor(a * 3)) % 3) * 0x050505;
      if (along) { const xa = Math.min(x0, x1); X.box(xa + s0, y, z0 - 0.3, xa + s1, y + 0.24, z0 + 0.3, 'sandbag', { col, c: false }); }
      else { const za = Math.min(z0, z1); X.box(x0 - 0.3, y, za + s0, x0 + 0.3, y + 0.24, za + s1, 'sandbag', { col, c: false }); }
    }
  }
  if (along) X.box(Math.min(x0, x1), 0, z0 - 0.3, Math.max(x0, x1), h, z0 + 0.3, 'solid', { invisible: true });
  else X.box(x0 - 0.3, 0, Math.min(z0, z1), x0 + 0.3, h, Math.max(z0, z1), 'solid', { invisible: true });
}

export function jersey(X, x, z, along = true, len = 3) {
  if (along) {
    X.box(x - len / 2, 0, z - 0.3, x + len / 2, 0.3, z + 0.3, 'concrete', { col: 0xb8b4a8 });
    X.box(x - len / 2, 0.3, z - 0.12, x + len / 2, 0.85, z + 0.12, 'concrete', { col: 0xb8b4a8 });
  } else {
    X.box(x - 0.3, 0, z - len / 2, x + 0.3, 0.3, z + len / 2, 'concrete', { col: 0xb8b4a8 });
    X.box(x - 0.12, 0.3, z - len / 2, x + 0.12, 0.85, z + len / 2, 'concrete', { col: 0xb8b4a8 });
  }
}

export function fence(X, x0, z0, x1, z1, h = 2.2, gaps = []) {
  const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const a0 = along ? Math.min(x0, x1) : Math.min(z0, z1), a1 = along ? Math.max(x0, x1) : Math.max(z0, z1);
  const segs = [];
  let cur = a0;
  for (const g of gaps.sort((p, q) => p[0] - q[0])) { if (g[0] > cur) segs.push([cur, g[0]]); cur = g[1]; }
  if (cur < a1) segs.push([cur, a1]);
  for (const [s0, s1] of segs) {
    if (along) X.box(s0, 0, z0 - 0.02, s1, h, z0 + 0.02, 'fence', {});
    else X.box(x0 - 0.02, 0, s0, x0 + 0.02, h, s1, 'fence', {});
    for (let p = s0; p <= s1 + 0.01; p += 3) {
      const q = Math.min(p, s1);
      if (along) X.box(q - 0.04, 0, z0 - 0.04, q + 0.04, h + 0.1, z0 + 0.04, 'metal', { col: 0x6a6a6a, c: false });
      else X.box(x0 - 0.04, 0, q - 0.04, x0 + 0.04, h + 0.1, q + 0.04, 'metal', { col: 0x6a6a6a, c: false });
    }
  }
}

export function woodBarricade(X, x, z, along = true, len = 2.4) {
  const P = along ? X.sub(x, z, 0) : X.sub(x, z, 1);
  P.box(-len / 2, 0, -0.1, -len / 2 + 0.12, 1.4, 0.1, 'wood', { col: 0x6a5038, c: false });
  P.box(len / 2 - 0.12, 0, -0.1, len / 2, 1.4, 0.1, 'wood', { col: 0x6a5038, c: false });
  // diagonal planks via quads
  const pl = (y0, y1, zf, col) => {
    P.quad([-len / 2, y0, zf], [len / 2, y1, zf], [len / 2, y1 + 0.22, zf], [-len / 2, y0 + 0.22, zf], 'wood', { col });
    P.quad([len / 2, y1, zf - 0.04], [-len / 2, y0, zf - 0.04], [-len / 2, y0 + 0.22, zf - 0.04], [len / 2, y1 + 0.22, zf - 0.04], 'wood', { col });
  };
  pl(0.2, 1.0, 0.12, 0x8a6a48); pl(1.0, 0.25, 0.17, 0x7a5a3a);
  P.box(-len / 2, 0, -0.15, len / 2, 1.3, 0.2, 'solid', { invisible: true });
}

export function tent(X, x, z, r = 0, rng) {
  const P = X.sub(x, z, r);
  const w = 2.2, l = 3.4, h = 2.1;
  P.tri([-w, 0, -l], [0, h, -l], [w, 0, -l], 'tarp', { col: 0x5a6a48 });
  P.quad([-w, 0, l], [-w, 0, -l], [0, h, -l], [0, h, l], 'tarp', { col: 0x5a6a48 });
  P.quad([w, 0, -l], [w, 0, l], [0, h, l], [0, h, -l], 'tarp', { col: 0x56664a });
  P.quad([0, h, l], [-w, 0, l], [-w, 0, -l], [0, h, -l], 'tarp', { col: 0x404a38 }); // inner faces
  P.quad([0, h, -l], [w, 0, -l], [w, 0, l], [0, h, l], 'tarp', { col: 0x404a38 });
  P.box(-w, 0, -l - 0.05, w, 1.2, -l, 'solid', { invisible: true });
  P.box(-w - 0.1, 0, -l, -w + 0.4, 1.2, l, 'solid', { invisible: true });
  P.box(w - 0.4, 0, -l, w + 0.1, 1.2, l, 'solid', { invisible: true });
  P.box(-0.9, 0, -l + 0.2, 0.9, 0.5, -l + 1.1, 'crate', { col: 0x9a9a7a, lod: 1 });
  P.container(0, 0.5, -l + 1.3, 'crate', 'Relief supplies', rng && rng.chance(0.5) ? 'medical' : 'food');
  // cots
  for (const sx of [-1.1, 1.1]) P.box(sx - 0.35, 0.3, -1, sx + 0.35, 0.42, 1.6, 'fabric', { col: 0x6a7058, lod: 1, c: false });
}

export function shippingContainer(X, x, z, y, r, col) {
  const P = X.sub(x, z, r);
  P.box(-3.05, y, -1.22, 3.05, y + 2.6, 1.22, 'corrugated', { col });
  P.box(3.05, y + 0.1, -1.15, 3.1, y + 2.5, 1.15, 'rust', { col: 0x5a3a2a, c: false });
}

export function rubble(X, x, z, n, rng, spread = 1.5) {
  for (let i = 0; i < n; i++) {
    const px = x + rng.range(-spread, spread), pz = z + rng.range(-spread, spread), s = rng.range(0.1, 0.45);
    X.box(px - s, 0, pz - s * 0.7, px + s, s * rng.range(0.4, 1.1), pz + s * 0.7, rng.chance(0.5) ? 'concrete' : 'brick', { col: rng.pick([0x9a948a, 0x7a7068, 0xa89880]), c: false, lod: 1 });
  }
}

export function decal(X, x, z, w, d, mat, y = 0.012) { X.hplane(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y, mat, { unit: true }); }

export function tv(X, x, z, r = 0, y = 0) {
  const P = X.sub(x, z, r);
  P.box(-0.6, y, -0.25, 0.6, y + 0.5, 0.25, 'wood', L1({ col: 0x3a2a20 }));
  P.box(-0.5, y + 0.5, -0.05, 0.5, y + 1.1, 0.02, 'solid', L1({ col: 0x101012, c: false }));
}

export function bookshelf(X, x, z, r = 0, y = 0, rng) {
  const P = X.sub(x, z, r);
  P.box(-0.6, y, -0.18, 0.6, y + 1.9, 0.18, 'wood', L1({ col: 0x5a4030 }));
  if (rng) for (let k = 0; k < 4; k++) for (let i = 0; i < 5; i++) if (rng.chance(0.6)) {
    const bx = -0.55 + i * 0.22;
    P.box(bx, y + 0.1 + k * 0.45, 0.18, bx + 0.18, y + 0.42 + k * 0.45, 0.2, 'solid', L1({ c: false, col: rng.pick([0x7a2a2a, 0x2a4a6a, 0x4a6a3a, 0x8a7a5a]) }));
  }
}

export function cooler(X, x, z, len, r = 0) {
  const P = X.sub(x, z, r);
  P.box(-len / 2, 0, -0.45, len / 2, 2.1, 0.4, 'metal', L1({ col: 0xc8ccd0 }));
  P.box(-len / 2 + 0.05, 0.2, 0.4, len / 2 - 0.05, 1.95, 0.43, 'glass', L1({ c: false }));
  P.box(-len / 2 + 0.05, 1.95, 0.38, len / 2 - 0.05, 2.0, 0.42, 'lampCool', L1({ c: false }));
  P.container(0, 1, 0.5, 'cooler', 'Drinks cooler', 'drinks');
}

export function cellBlock(X, x0, z0, x1, y, depth) {
  // row of bars on the z0 line from x0 to x1 with open door gaps every 3m
  for (let x = x0; x < x1 - 0.05; x += 0.15) X.box(x, y, z0 - 0.02, x + 0.03, y + 2.6, z0 + 0.02, 'metal', { col: 0x3a3c40, c: false, lod: 1 });
  X.box(x0, y + 2.5, z0 - 0.05, x1, y + 2.6, z0 + 0.05, 'metal', { col: 0x3a3c40, c: false, lod: 1 });
  X.box(x0, y, z0 - 0.06, x1, y + 2.6, z0 + 0.06, 'solid', { invisible: true, cx: { glass: true } });
  void depth;
}

// Parked / wrecked vehicle prop (instanced on the client) with an AABB collider.
export const VEH_DIMS = { car: [0.95, 2.25, 1.45], police: [0.95, 2.35, 1.6], van: [1.0, 2.5, 2.1], truck: [1.25, 3.6, 3.0], bus: [1.3, 5.6, 3.1], ambulance: [1.1, 2.9, 2.6] };
export function car(X, x, y, z, ry, col, wreck = 0, kind = 'car') {
  X.inst(kind, x, y, z, ry, 1, col, { wreck });
  const a = ry + X.yaw, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const [hw, hl, h] = VEH_DIMS[kind] || VEH_DIMS.car;
  const k = c > 0.2 && s > 0.2 ? 0.82 : 1;
  const ex = (hw * c + hl * s) * k, ez = (hw * s + hl * c) * k;
  const [wx, wz] = X.p(x, z);
  X.B.collider(wx - ex, y, wz - ez, wx + ex, y + h, wz + ez);
}

// City layout. The whole district is described deterministically from a seed.
// Pass 1 (generateWorld) records colliders, doors, loot containers, instances,
// lights and spawn points for every block - cheap enough for the server too.
// Pass 2 (buildBlockGeometry) re-runs a single block with geometry enabled; the
// client calls it lazily when the player approaches that block.
import { Builder } from './builder.js';
import { Xf } from './xf.js';
import { RNG, hash2 } from './util.js';
import { ColliderSet } from './physics.js';
import { NavGrid } from './nav.js';
import * as P from './props.js';
import * as BL from './buildings.js';

export const N = 5, PITCH = 72, ROAD = 16, LOT = PITCH - ROAD;
export const SIZE = N * PITCH + ROAD;

// MAP[j][i]
export const MAP = [
  ['house', 'house', 'apt', 'shops', 'industry'],
  ['house', 'shops', 'apt', 'garage', 'industry'],
  ['park', 'hospital', 'police', 'market', 'warehouse'],
  ['house', 'apt', 'petrol', 'office', 'shops'],
  ['house', 'house', 'shops', 'apt', 'industry'],
];

export const BLOCK_NAMES = {
  house: 'Residential', apt: 'Apartments', shops: 'Shops', industry: 'Industrial yard', garage: 'Parking garage',
  park: 'Relief camp park', hospital: 'St. Mercy Hospital', police: 'Police Station (Safehouse)', market: 'Supermarket',
  warehouse: 'Warehouses', petrol: 'Petrol station', office: 'Offices',
};

function newRegistry(seed) {
  return { seed, colliders: [], doors: [], containers: [], interacts: [], vehicleSpawns: [], zSpawns: [], pois: {}, zones: [], cells: [] };
}

export function generateWorld(seed = 1337) {
  const W = newRegistry(seed);
  W.size = SIZE;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const id = j * (N + 1) + i;
    const B = new Builder({ colliders: W.colliders, geo: false, blockId: id });
    buildCell(B, W, i, j, seed);
    W.cells.push({ id, i, j, x0: i * PITCH, z0: j * PITCH, x1: i * PITCH + (i < N ? PITCH : ROAD), z1: j * PITCH + (j < N ? PITCH : ROAD), instances: B.instances, lights: B.lights, type: i < N && j < N ? MAP[j][i] : 'road' });
  }
  W.cs = new ColliderSet(W.colliders);
  W.cs.build();
  W.nav = new NavGrid(-6, -6, SIZE + 6, SIZE + 6, 1);
  W.nav.build(W.colliders);
  for (const d of W.doors) {
    d.cells = W.nav.doorCells(d.col);
    if (!d.open) for (const c of d.cells) W.nav.sight[c] = 1;
  }
  return W;
}

// Geometry for one block (client only). Registrations go to a throwaway registry.
export function buildBlockGeometry(seed, cell) {
  const tmp = newRegistry(seed);
  const B = new Builder({ colliders: null, geo: true, blockId: cell.id });
  buildCell(B, tmp, cell.i, cell.j, seed);
  return B.finish();
}

export function cellAt(x, z) {
  const i = Math.max(0, Math.min(N, Math.floor(x / PITCH))), j = Math.max(0, Math.min(N, Math.floor(z / PITCH)));
  return j * (N + 1) + i;
}

export function districtName(x, z) {
  const i = Math.floor((x - ROAD) / PITCH), j = Math.floor((z - ROAD) / PITCH);
  const lx = x - ROAD - i * PITCH, lz = z - ROAD - j * PITCH;
  if (i < 0 || j < 0 || i >= N || j >= N || lx > LOT || lz > LOT) return 'Street';
  return BLOCK_NAMES[MAP[j][i]];
}

function buildCell(B, W, i, j, seed) {
  const rng = new RNG(Math.floor(hash2(i * 7 + 3, j * 13 + 5) * 1e9) ^ seed);
  const X = new Xf(B, W, 0, 0, 0);
  roads(X, i, j, rng);
  if (i < N && j < N) {
    const L = X.sub(i * PITCH + ROAD, j * PITCH + ROAD, 0);
    const type = MAP[j][i];
    LOTS[type](L, rng, i, j);
  }
  boundary(X, i, j, rng);
}

// Place a building footprint [rx0,rx1]x[rz0,rz1] (lot coords) with its front facing a side.
function facing(X, side, rx0, rz0, rx1, rz1) {
  if (side === 'S') return X.sub(rx0, rz0, 0);
  if (side === 'N') return X.sub(rx1, rz1, 2);
  if (side === 'E') return X.sub(rx0, rz1, 1);
  return X.sub(rx1, rz0, 3);
}

// ---------------------------------------------------------------- roads
function roads(X, i, j, rng) {
  const x0 = i * PITCH, z0 = j * PITCH, R = ROAD;
  const swH = 0.15;
  const sw = (ax, az, bx, bz) => X.box(ax, 0, az, bx, swH, bz, 'sidewalk', { f: { px: 'concrete', nx: 'concrete', pz: 'concrete', nz: 'concrete' }, col: 0xffffff });
  X.hplane(x0, z0, x0 + R, z0 + R, 0, 'asphalt');
  for (const [a, b] of [[0, 0], [13, 0], [0, 13], [13, 13]]) sw(x0 + a, z0 + b, x0 + a + 3, z0 + b + 3);
  const hasW = j < N, hasN = i < N;
  if (hasW) { // road running along z on the west of the lot
    X.hplane(x0 + 3, z0 + R, x0 + 13, z0 + PITCH, 0, 'asphalt');
    sw(x0, z0 + R, x0 + 3, z0 + PITCH); sw(x0 + 13, z0 + R, x0 + 16, z0 + PITCH);
    for (let z = z0 + R + 4; z < z0 + PITCH - 4; z += 6) X.hplane(x0 + 7.92, z, x0 + 8.08, z + 3, 0.012, 'paintY');
    X.hplane(x0 + 3.3, z0 + R + 3, x0 + 3.42, z0 + PITCH - 3, 0.012, 'paint');
    X.hplane(x0 + 12.58, z0 + R + 3, x0 + 12.7, z0 + PITCH - 3, 0.012, 'paint');
    for (const zc of [z0 + R, z0 + PITCH - 3]) for (let x = x0 + 3.5; x < x0 + 12.6; x += 1.1) X.hplane(x, zc + 0.2, x + 0.55, zc + 2.8, 0.013, 'paint');
    streetLife(X, 'z', x0, z0 + R, z0 + PITCH, rng);
  }
  if (hasN) { // road running along x on the north of the lot
    X.hplane(x0 + R, z0 + 3, x0 + PITCH, z0 + 13, 0, 'asphalt');
    sw(x0 + R, z0, x0 + PITCH, z0 + 3); sw(x0 + R, z0 + 13, x0 + PITCH, z0 + 16);
    for (let x = x0 + R + 4; x < x0 + PITCH - 4; x += 6) X.hplane(x, z0 + 7.92, x + 3, z0 + 8.08, 0.012, 'paintY');
    X.hplane(x0 + R + 3, z0 + 3.3, x0 + PITCH - 3, z0 + 3.42, 0.012, 'paint');
    X.hplane(x0 + R + 3, z0 + 12.58, x0 + PITCH - 3, z0 + 12.7, 0.012, 'paint');
    for (const xc of [x0 + R, x0 + PITCH - 3]) for (let z = z0 + 3.5; z < z0 + 12.6; z += 1.1) X.hplane(xc + 0.2, z, xc + 2.8, z + 0.55, 0.013, 'paint');
    streetLife(X, 'x', z0, x0 + R, x0 + PITCH, rng);
  }
  // traffic light on one corner
  if (rng.chance(0.7) && hasW && hasN) { X.inst('tlight', x0 + 14.5, swH, z0 + 14.5, Math.PI * 1.25, 1); colAt(X, x0 + 14.5, z0 + 14.5, 0.15, 4.5); }
  for (let k = 0; k < 2; k++) if (rng.chance(0.5)) P.decal(X, x0 + rng.range(4, 12), z0 + rng.range(4, 12), rng.range(1.5, 3), rng.range(1.5, 3), rng.pick(['crack', 'puddle', 'stain']), 0.011 + k * 0.001);
}

function colAt(X, x, z, r, h) { const [a, b] = X.p(x, z); X.B.collider(a - r, 0, b - r, a + r, h, b + r); }

// Props along a road. axis 'z': road along z with corridor starting at c0 (x).
function streetLife(X, axis, c0, a0, a1, rng) {
  const pt = (across, along) => axis === 'z' ? [c0 + across, along] : [along, c0 + across];
  const ryAlong = axis === 'z' ? 0 : Math.PI / 2;
  // street lamps alternating sides
  let side = rng.chance(0.5);
  for (let a = a0 + 8; a < a1 - 4; a += 22) {
    const across = side ? 2.3 : 13.7;
    const [x, z] = pt(across, a);
    const ry = axis === 'z' ? (side ? Math.PI / 2 : -Math.PI / 2) : (side ? 0 : Math.PI);
    const broken = rng.chance(0.3);
    X.inst('lamp', x, 0.15, z, ry, 1, 0xffffff, { off: broken ? 1 : 0 });
    colAt(X, x, z, 0.14, 7);
    const [lx, lz] = pt(side ? 3.9 : 12.1, a);
    if (!broken) X.light(lx, 7.1, lz, 'street');
    side = !side;
  }
  // parked / crashed vehicles
  const nCars = rng.int(1, 4);
  for (let k = 0; k < nCars; k++) {
    const a = rng.range(a0 + 6, a1 - 7);
    const r = rng.next();
    const kind = rng.chance(0.12) ? 'truck' : rng.chance(0.1) ? 'van' : rng.chance(0.06) ? 'bus' : 'car';
    let across, ry;
    if (r < 0.6) { across = rng.chance(0.5) ? 4.4 : 11.6; ry = ryAlong + (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.08, 0.08); }
    else { across = rng.range(6, 10); ry = ryAlong + rng.range(-0.7, 0.7) + (rng.chance(0.5) ? Math.PI : 0); }
    if (kind === 'bus' || kind === 'truck') { across = rng.chance(0.5) ? 4.6 : 11.4; ry = ryAlong + (rng.chance(0.5) ? 0 : Math.PI); }
    const [x, z] = pt(across, a);
    P.car(X, x, 0, z, ry, BL.carColor(rng), rng.chance(0.45) ? 1 : 0, kind);
    if (rng.chance(0.4)) P.decal(X, x + rng.range(-2, 2), z + rng.range(-2, 2), 2.5, 2.5, rng.chance(0.5) ? 'glassShards' : 'stain', 0.013);
  }
  // sidewalk clutter
  for (let k = 0; k < 5; k++) {
    const a = rng.range(a0 + 3, a1 - 3), across = rng.chance(0.5) ? rng.range(0.6, 2.4) : rng.range(13.6, 15.4);
    const [x, z] = pt(across, a);
    const r = rng.next();
    if (r < 0.35) { for (let b = 0; b < rng.int(2, 5); b++) X.inst('bag', x + rng.range(-0.6, 0.6), 0.15, z + rng.range(-0.6, 0.6), rng.range(0, 6), rng.range(0.8, 1.2)); }
    else if (r < 0.5) { X.cyl(x, 0.15, z, 0.16, 0.7, 8, 'metal', { col: 0xb02020 }); }
    else if (r < 0.62) { X.inst('trashcan', x, 0.15, z, rng.range(0, 6), 1); colAt(X, x, z, 0.3, 1.0); }
    else if (r < 0.72) { const [px, pz] = pt(across < 8 ? 1.0 : 15.0, a); P.bench(X, px, pz, axis === 'z' ? (across < 8 ? 1 : 3) : (across < 8 ? 0 : 2)); }
    else if (r < 0.8) { P.decal(X, x, z, 1.8, 1.8, 'blood', 0.16); }
    else if (r < 0.9) { X.inst('sign', x, 0.15, z, ryAlong + (rng.chance(0.5) ? 0 : Math.PI), 1, 0xffffff, { v: rng.int(0, 3) }); colAt(X, x, z, 0.06, 2.6); }
    else { P.decal(X, x, z, 2.5, 2.5, 'puddle', 0.16); }
  }
  // road damage & stains
  for (let k = 0; k < 4; k++) {
    const a = rng.range(a0 + 3, a1 - 3), across = rng.range(4, 12);
    const [x, z] = pt(across, a);
    P.decal(X, x, z, rng.range(2, 5), rng.range(2, 5), rng.pick(['crack', 'crack', 'puddle', 'puddle', 'stain', 'blood', 'patch']), 0.014 + k * 0.0005);
  }
  if (rng.chance(0.35)) {
    const a = rng.range(a0 + 10, a1 - 10);
    const [x, z] = pt(8, a);
    if (axis === 'z') P.woodBarricade(X, x, z, true, 3); else P.woodBarricade(X, x, z, false, 3);
  }
  for (let k = 0; k < 3; k++) {
    const a = rng.range(a0 + 4, a1 - 4), across = rng.range(1, 15);
    const [x, z] = pt(across, a);
    X.inst('debris', x, across < 3 || across > 13 ? 0.15 : 0, z, rng.range(0, 6), rng.range(0.6, 1.3));
  }
  // walking zombie spawn points on the street
  for (let k = 0; k < 3; k++) { const [x, z] = pt(rng.range(4, 12), rng.range(a0 + 4, a1 - 4)); X.W.zSpawns.push({ x, z, indoor: false }); }
}

// Quarantine wall around the district (cells on the outer edge).
function boundary(X, i, j, rng) {
  const wall = (ax, az, bx, bz) => {
    X.box(ax, 0, az, bx, 4.2, bz, 'concrete', { col: 0xa8a49a });
    const along = bx - ax > bz - az;
    if (along) X.box(ax, 4.2, (az + bz) / 2 - 0.03, bx, 6.5, (az + bz) / 2 + 0.03, 'fence', { c: false });
    else X.box((ax + bx) / 2 - 0.03, 4.2, az, (ax + bx) / 2 + 0.03, 6.5, bz, 'fence', { c: false });
  };
  const x0 = i * PITCH, z0 = j * PITCH, w = i < N ? PITCH : ROAD, h = j < N ? PITCH : ROAD;
  if (i === 0) wall(-1.4, z0 - (j === 0 ? 1.4 : 0), -0.4, z0 + h + (j === N ? 1.4 : 0));
  if (i === N) wall(SIZE + 0.4, z0 - (j === 0 ? 1.4 : 0), SIZE + 1.4, z0 + h + (j === N ? 1.4 : 0));
  if (j === 0) wall(x0, -1.4, x0 + w, -0.4);
  if (j === N) wall(x0, SIZE + 0.4, x0 + w, SIZE + 1.4);
  // checkpoint dressing where a road meets the wall
  const cp = (x, z, along) => {
    P.jersey(X, x, z, along, 3); if (rng.chance(0.6)) P.sandbags(X, along ? x - 4 : x, along ? z : z - 4, along ? x - 1.5 : x, along ? z : z - 1.5, 1.0);
    X.light(x, 6, z, 'flood');
  };
  if (i === 0) cp(8, z0 + 8, false);
  if (j === 0) cp(x0 + 8, 2, true);
  if (i === N) cp(SIZE - 8, z0 + 8, false);
  if (j === N) cp(x0 + 8, SIZE - 2, true);
}

// ---------------------------------------------------------------- lots
function ground(X, mat, col) { X.hplane(0, 0, LOT, LOT, 0.003, mat, { col }); }

function tree(X, x, z, rng, s) { const sc = s || rng.range(0.8, 1.3); X.inst('tree', x, 0, z, rng.range(0, 6), sc, 0xffffff, { dead: rng.chance(0.35) ? 1 : 0 }); colAt(X, x, z, 0.22 * sc, 4); }

const LOTS = {
  house(X, rng) {
    ground(X, 'grass');
    const spots = [['N', 8, 5], ['N', 36, 5], ['S', 8, 42], ['S', 36, 42]];
    for (const [side, rx, rz] of spots) {
      const H = facing(X, side, rx, rz, rx + 11, rz + 9);
      BL.house(H, rng);
      const north = side === 'N';
      const sx0 = rx - 7, sz0 = north ? 0 : 28, sz1 = north ? 28 : 56;
      // driveway + car
      const dx = rx + 13.5;
      X.hplane(dx - 1.6, north ? 0 : 33, dx + 1.6, north ? 23 : 56, 0.006, 'concrete', { col: 0xa8a49c });
      if (rng.chance(0.65)) {
        if (rng.chance(0.4)) X.vehicle(rng.chance(0.5) ? 'pickup' : 'sedan', dx, north ? 7 : 49, north ? Math.PI : 0, {});
        else P.car(X, dx, 0, north ? 7 : 49, north ? 0 : Math.PI, BL.carColor(rng), rng.chance(0.3) ? 1 : 0);
      }
      // path to the door
      X.hplane(rx + 4.6 - 0.7, north ? 0 : 52.6, rx + 6.2 - 0.7, north ? 3.4 : 56, 0.006, 'concrete', { col: 0xb0aca4 });
      // picket fence between plots + back
      const fz = north ? 27.6 : 28.4;
      fenceLow(X, sx0 + 0.5, fz, sx0 + 27.5, fz);
      if (sx0 + 28 < 55) fenceLow(X, sx0 + 28, sz0 + 1, sx0 + 28, sz1 - 1, true);
      tree(X, rx + rng.range(1, 10), north ? rng.range(17, 25) : rng.range(31, 39), rng);
      if (rng.chance(0.6)) tree(X, rx - rng.range(3, 6), north ? rng.range(3, 25) : rng.range(31, 53), rng);
      // shed
      const shx = rx + 8.5, shz = north ? 22 : 31;
      X.box(shx, 0, shz, shx + 3, 2.4, shz + 2.5, 'woodDark', { col: 0x7a6048 });
      X.box(shx - 0.2, 2.4, shz - 0.2, shx + 3.2, 2.55, shz + 2.7, 'corrugated', { col: 0x6a6a6a, c: false });
      X.container(shx + 1.5, 1, north ? shz - 0.3 : shz + 2.8, 'shed', 'Garden shed', 'tools');
      X.inst('trashcan', rx - 1, 0, north ? 3 : 53, 0, 1); colAt(X, rx - 1, north ? 3 : 53, 0.3, 1);
    }
  },

  apt(X, rng) {
    ground(X, 'dirt');
    X.hplane(4, 16, 52, 40, 0.005, 'grass');
    const ext = rng.pick(['brick', 'brick', 'plaster', 'brickDark']);
    const extCol = ext === 'plaster' ? rng.pick([0xd8c8a8, 0xc8b8a0, 0xb8b8b0, 0xc8a890]) : rng.pick([0xffffff, 0xe0d0c0, 0xc8b8a8]);
    for (const side of ['N', 'S']) {
      const floors = rng.int(4, 6);
      const A = side === 'N' ? facing(X, 'N', 8, 0, 48, 14) : facing(X, 'S', 8, 42, 48, 56);
      BL.corridorBuilding(A, {
        L: 40, D: 14, floors, ext: side === 'N' ? ext : rng.pick(['brick', 'plaster', 'concrete']), extCol: side === 'N' ? extCol : rng.pick([0xffffff, 0xd8ccb8, 0xc0c4c0]),
        floorMat: 'floorWood', int: 'wallInt', intCol: rng.pick([0xd8d0c0, 0xc8d0c8, 0xd0c4b8]), corrInt: 'wallInt', corrCol: 0xb8b0a0,
        balconies: true, waterTower: floors >= 5 && rng.chance(0.6), room: BL.furnishApartment,
        hall: (h) => { if (h.level === 0) { P.lockers(h.X, h.x0 + 1, h.z0 + 1.2, 4, 1, 0, 0x8a7a5a, 'general', 'Mailboxes'); } },
      }, rng);
    }
    // courtyard
    for (let k = 0; k < 6; k++) tree(X, rng.range(6, 50), rng.range(18, 38), rng);
    P.bench(X, 20, 28, 0); P.bench(X, 36, 28, 2);
    P.dumpster(X, 2.5, 20, 1, rng); P.dumpster(X, 53.5, 36, 3, rng);
    X.box(24, 0, 24, 32, 0.25, 32, 'sidewalk', {}); // playground pad
    X.inst('swing', 28, 0.25, 28, 0, 1); colAt(X, 28, 28, 1.6, 2.5);
    for (let k = 0; k < 4; k++) X.inst('bag', rng.range(1, 6), 0, rng.range(16, 40), rng.range(0, 6), 1);
    if (rng.chance(0.6)) P.car(X, 4, 0, 30, 0.1, BL.carColor(rng), 1);
    for (let k = 0; k < 3; k++) X.W.zSpawns.push({ x: X.p(rng.range(6, 50), 0)[0], z: X.p(0, rng.range(18, 38))[1], indoor: false });
  },

  shops(X, rng) {
    ground(X, 'concreteDark');
    const n = BL.shopRow(facing(X, 'N', 5.5, 0, 50.5, 12), 5, rng);
    BL.shopRow(facing(X, 'S', 5.5, 44, 50.5, 56), 5, rng);
    void n;
    // service yard
    for (let k = 0; k < 4; k++) P.dumpster(X, 8 + k * 12, 14, 0, rng);
    for (let k = 0; k < 4; k++) P.dumpster(X, 14 + k * 11, 42, 2, rng);
    if (rng.chance(0.6)) P.car(X, 28, 0, 28, Math.PI / 2 + 0.2, BL.carColor(rng), rng.chance(0.5) ? 1 : 0);
    if (rng.chance(0.5)) P.car(X, 15, 0, 25, Math.PI / 2, BL.carColor(rng), 0, 'van');
    for (let k = 0; k < 6; k++) X.inst('bag', rng.range(4, 52), 0, rng.chance(0.5) ? rng.range(13, 16) : rng.range(40, 43), rng.range(0, 6), 1);
    for (let k = 0; k < 3; k++) P.crate(X, rng.range(5, 50), rng.range(18, 38), 0, 1, rng.chance(0.5), rng);
    P.rubble(X, 40, 30, 8, rng, 2);
    X.light(28, 4, 15, 'flood');
  },

  office(X, rng) {
    ground(X, 'concreteDark');
    const O = facing(X, 'S', 10, 30, 46, 46);
    BL.corridorBuilding(O, {
      L: 36, D: 16, floors: rng.int(3, 4), ext: 'concrete', extCol: 0xc8c4bc, glass: 'glassBlue', winW: 2.6, winH: 2.0, sill: 0.7,
      floorMat: 'carpet', floorCol: 0x8a8a90, roomBays: 2, room: BL.furnishOffice, trimCol: 0x9a9a9a, frameCol: 0x5a6070,
      sign: { w: 6, mat: 'sign:OFFICES:#2a3a5a' },
    }, rng);
    // plaza
    X.hplane(4, 4, 52, 28, 0.006, 'sidewalk');
    X.cyl(28, 0, 16, 3.2, 0.6, 20, 'concrete', { col: 0xb8b4ac });
    X.cyl(28, 0.6, 16, 0.4, 1.6, 10, 'concrete', { col: 0xa8a49c });
    P.decal(X, 28, 16, 5.8, 5.8, 'puddle', 0.62);
    for (const [bx, bz, r] of [[18, 10, 0], [38, 10, 0], [18, 22, 2], [38, 22, 2]]) P.bench(X, bx, bz, r);
    for (const [tx, tz] of [[8, 8], [48, 8], [8, 24], [48, 24]]) tree(X, tx, tz, rng);
    P.car(X, 52, 0, 40, 0, BL.carColor(rng), 1);
    X.vehicle('sedan', 4, 40, 0, {});
    for (let k = 0; k < 3; k++) X.W.zSpawns.push({ x: X.p(rng.range(6, 50), 0)[0], z: X.p(0, rng.range(6, 26))[1], indoor: false });
  },

  hospital(X, rng) {
    ground(X, 'concreteDark');
    const Hx = facing(X, 'N', 4, 2, 52, 22);
    const roomFn = (R, r) => {
      const t = R.level === 0
        ? (R.side === 'N' ? ['exam', 'pharmacy', 'exam', 'ward'] : ['ward', 'ward', 'office', 'exam'])[R.index % 4]
        : (R.side === 'N' ? ['ward', 'office', 'ward', 'ward'] : ['ward', 'exam', 'ward', 'office'])[R.index % 4];
      ({ exam: BL.furnishExam, pharmacy: BL.furnishPharmacy, ward: BL.furnishWard, office: BL.furnishOffice })[t](R, r);
      if (t === 'pharmacy') { const [x, z] = R.X.p(R.w / 2, R.d / 2); X.W.pois.pharmacy = { x, z }; }
    };
    const info = BL.corridorBuilding(Hx, {
      L: 48, D: 20, floors: 2, fh: 3.6, ext: 'plaster', extCol: 0xe8e4dc, int: 'wallInt', intCol: 0xd8e4e4, floorMat: 'tile', corrInt: 'tile', corrCol: 0xc8d8d8,
      winW: 1.8, winH: 1.6, room: roomFn, roomBays: 2, trimCol: 0xa8b8c0, doorKind: 'glassdoor', backDoor: true,
      sign: { w: 10, mat: 'sign:ST. MERCY HOSPITAL:#c81e1e' },
      hall: (h) => { if (h.level === 0) { P.counter(h.X, h.x0 + 4, h.z0 + 3.5, 4, 0, 0, 0xd0d8d8); P.desk(h.X, h.x0 + 4, h.z0 + 2.2, 2, 0, rng, 'medical'); } },
    }, rng);
    Hx.hplane(20, 6, 30, 16, info.H + 0.02, 'helipad', { unit: true });
    X.W.pois.hospital = { x: X.p(28, 0)[0], z: X.p(0, 12)[1] };
    // relief camp behind
    for (let k = 0; k < 3; k++) P.tent(X, 10 + k * 9, 36, 0, rng);
    P.sandbags(X, 4, 26, 30, 26, 1.0);
    P.car(X, 40, 0, 32, 0, 0xe8e8e8, 0, 'ambulance');
    P.car(X, 46, 0, 32, 0.15, 0xe8e8e8, 1, 'ambulance');
    X.vehicle('van', 43, 46, Math.PI / 2, {});
    for (let k = 0; k < 6; k++) P.decal(X, rng.range(6, 50), rng.range(26, 54), 2.2, 1.0, 'bodybag', 0.008 + k * 0.0003);
    P.woodBarricade(X, 34, 26, true, 3);
    for (let k = 0; k < 4; k++) P.crate(X, rng.range(36, 52), rng.range(40, 54), 0, 1, true, rng);
    X.light(28, 5, 30, 'flood');
    for (let k = 0; k < 4; k++) X.W.zSpawns.push({ x: X.p(rng.range(6, 50), 0)[0], z: X.p(0, rng.range(28, 52))[1], indoor: false });
  },

  police(X, rng) {
    ground(X, 'asphalt');
    const Px = facing(X, 'N', 13, 4, 43, 22);
    const roomFn = (R, r) => {
      const { X: RX, w, d, y } = R;
      const key = R.side + R.index;
      if (key === 'N0') { // armory
        P.lockers(RX, 1.2, 0.6, 3, 0, y, 0x3a4a3a, 'weapons', 'Armory locker');
        P.lockers(RX, w - 1.2, 0.6, 3, 0, y, 0x3a4a3a, 'ammo', 'Ammo locker');
        P.crate(RX, w / 2, 1.0, y, 0.9, true, r);
        const c = RX.W.containers[RX.W.containers.length - 1]; c.table = 'ammo';
        RX.W.containers.find(cc => cc.name === 'Armory locker' && cc.block === RX.B.blockId).guaranteed = ['pistol', 'ammo9'];
      } else if (key === 'N1') { // dispatch
        P.desk(RX, w / 2, 1.2, 0, y, r, 'office');
        RX.box(w / 2 - 0.6, y + 0.76, 0.9, w / 2 + 0.2, y + 1.05, 1.3, 'metal', { col: 0x2a2e2a, c: false, lod: 1 });
        RX.interact('radio', w / 2 - 0.2, y + 1.0, 1.6, { name: 'Emergency radio' });
        const [x, z] = RX.p(w / 2, 2); X.W.pois.radio = { x, z };
        P.desk(RX, w / 2 + 2.4, 1.2, 0, y, r, 'office');
        P.bookshelf(RX, 0.3, d / 2, 1, y, r);
      } else if (key === 'S0') { // holding cells
        P.cellBlock(RX, 0.2, d - 2.2, w - 0.2, y, 2);
        P.bed(RX, 1.5, 1.2, 1, y, r);
        const [x, z] = RX.p(w - 1.5, 1.5); X.W.zSpawns.push({ x, z, indoor: true, cell: true });
      } else { // break room = safehouse
        P.bed(RX, w - 1.0, 1.3, 0, y, r);
        RX.interact('bed', w - 1.0, y + 0.6, 2.4, { name: 'Safehouse cot' });
        const [x, z] = RX.p(w - 1, 3); X.W.pois.safebed = { x, z };
        P.kitchen(RX, 1.6, 0.35, 2.0, 0, y);
        P.table(RX, 2.2, 2.6, 1.4, 0.9, 0, y);
        P.sofa(RX, w / 2, d - 1.2, 2, y, 0x3a3a4a);
        P.lockers(RX, w - 0.4, d - 2.0, 2, 3, y, 0x4a4a54, 'police', 'Officer locker');
      }
    };
    const info = BL.corridorBuilding(Px, {
      L: 30, D: 18, floors: 1, fh: 3.6, ext: 'brickDark', extCol: 0xffffff, int: 'wallInt', intCol: 0xc8ccc8, floorMat: 'tileCheck', floorCol: 0xb8bcc0,
      room: roomFn, roomBays: 2, doorChance: 1, spawnChance: 0, trimCol: 0x8a8a8a,
      sign: { w: 6, mat: 'sign:POLICE:#1a3a8a' },
      hall: (h) => { P.counter(h.X, h.x0 + 4.5, h.z0 + 3, 4, 0, 0, 0x4a4a4a); P.desk(h.X, h.x0 + 3.5, h.z0 + 1.8, 2, 0, rng, 'police'); },
    }, rng);
    // radio mast on roof
    Px.cyl(26, info.H, 5, 0.12, 9, 6, 'metal', { col: 0xb8b8b8 });
    Px.light(26, info.H + 9, 5, 'beacon');
    for (const lx of [3, 27]) { Px.box(lx - 0.4, info.H + 0.9, 17.5, lx + 0.4, info.H + 1.15, 17.8, 'emRed', { c: false }); Px.light(lx, info.H + 1.3, 18.2, 'emergency'); }
    // compound (behind = lot south side), safe zone
    P.sandbags(X, 2, 28, 22, 28, 1.25); P.sandbags(X, 34, 28, 54, 28, 1.25);
    P.sandbags(X, 2, 28, 2, 54, 1.25); P.sandbags(X, 54, 28, 54, 54, 1.25);
    P.sandbags(X, 2, 54, 22, 54, 1.25); P.sandbags(X, 34, 54, 54, 54, 1.25);
    P.jersey(X, 28, 28.5, true, 3); P.jersey(X, 28, 53.5, true, 3);
    X.zone('safe', 0, 0, 56, 56, { name: 'Police Station' });
    for (let k = 0; k < 2; k++) P.tent(X, 10 + k * 9, 42, 0, rng);
    P.car(X, 40, 0, 38, 0.05, 0xf0f0f0, 0, 'police');
    P.car(X, 45, 0, 38, -0.05, 0xf0f0f0, 1, 'police');
    X.vehicle('police', 47, 48, -Math.PI / 2, {});
    X.vehicle('sedan', 8, 32, Math.PI / 2, {});
    // watchtower
    for (const [lx, lz] of [[4, 50], [6.4, 50], [4, 52.4], [6.4, 52.4]]) X.box(lx - 0.1, 0, lz - 0.1, lx + 0.1, 4, lz + 0.1, 'wood', { col: 0x5a4a3a });
    X.box(3.7, 4, 49.7, 6.7, 4.2, 52.7, 'wood', { col: 0x6a5a48 });
    X.light(5.2, 5.2, 51.2, 'flood');
    X.light(28, 4.5, 30, 'flood');
    X.light(28, 4, 50, 'flood');
    for (let k = 0; k < 4; k++) P.crate(X, rng.range(34, 52), rng.range(46, 52), 0, 1, k < 2, rng);
    X.inst('generator', 24, 0, 46, 0, 1); colAt(X, 24, 46, 1.0, 1.4);
    X.W.pois.police = { x: X.p(28, 0)[0], z: X.p(0, 40)[1] };
    X.W.pois.start = { x: X.p(30, 0)[0], z: X.p(0, 36)[1] };
  },

  market(X, rng) {
    ground(X, 'asphalt');
    BL.supermarket(facing(X, 'S', 8, 2, 48, 30), rng);
    X.W.pois.market = { x: X.p(28, 0)[0], z: X.p(0, 16)[1] };
    for (let r = 0; r < 2; r++) for (let k = 0; k < 9; k++) {
      const x = 6 + k * 5, z = 37 + r * 11;
      X.hplane(x - 0.06, z - 2.5, x + 0.06, z + 2.5, 0.01, 'paint');
      if (rng.chance(0.3)) P.car(X, x + 2.5, 0, z, rng.range(-0.1, 0.1) + (rng.chance(0.5) ? Math.PI : 0), BL.carColor(rng), rng.chance(0.4) ? 1 : 0);
    }
    X.vehicle('sedan', 30.5, 48, 0.05, {});
    for (let k = 0; k < 7; k++) X.inst('cart', rng.range(4, 52), 0, rng.range(33, 54), rng.range(0, 6), 1);
    for (const [lx, lz] of [[14, 42.5], [42, 42.5]]) { X.inst('lamp', lx, 0, lz, 0, 1); colAt(X, lx, lz, 0.14, 7); X.light(lx, 7.1, lz + 1.6, 'street'); }
    for (let k = 0; k < 5; k++) X.W.zSpawns.push({ x: X.p(rng.range(6, 50), 0)[0], z: X.p(0, rng.range(34, 54))[1], indoor: false });
  },

  petrol(X, rng) {
    ground(X, 'concreteDark');
    const PS = X.sub(13, 28, 0);
    BL.petrolStation(PS, rng);
    X.W.pois.petrol = { x: X.p(27, 0)[0], z: X.p(0, 47)[1] };
    // jerry can rack guarantees a fuel can
    const rack = X.W.containers.filter(c => c.name === 'Jerry can rack').pop();
    if (rack) rack.guaranteed = ['fuelcan'];
    BL.shopRow(facing(X, 'N', 10, 0, 46, 12), 4, rng, ['DINER', 'CLINIC', 'LIQUOR', 'HARDWARE']);
    X.vehicle('pickup', 20, 50, Math.PI / 2 + 0.1, {});
    P.car(X, 4, 0, 40, 0.3, BL.carColor(rng), 1, 'truck');
    for (let k = 0; k < 3; k++) X.W.zSpawns.push({ x: X.p(rng.range(6, 50), 0)[0], z: X.p(0, rng.range(16, 26))[1], indoor: false });
  },

  garage(X, rng) {
    ground(X, 'concreteDark');
    BL.garage(facing(X, 'S', 6, 22, 50, 54), rng);
    BL.shopRow(facing(X, 'N', 10, 0, 46, 12), 4, rng);
    X.vehicle('van', 30, 17, Math.PI / 2, {});
    P.car(X, 8, 0, 17, Math.PI / 2, 0xc8a020, 1, 'bus');
  },

  industry(X, rng) {
    ground(X, 'dirt');
    BL.warehouse(facing(X, 'W', 30, 4, 52, 40), rng, 36, 22);
    // container yard
    const cols = [0x8a3a2a, 0x2a5a8a, 0x3a6a3a, 0x8a7a2a, 0x6a6a6a, 0x9a5a2a];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 2; k++) {
      const x = 8 + k * 8, z = 8 + r * 4;
      P.shippingContainer(X, x, z, 0, 0, rng.pick(cols));
      if (rng.chance(0.5)) P.shippingContainer(X, x, z, 2.6, 0, rng.pick(cols));
    }
    P.fence(X, 2, 2, 26, 2, 2.4); P.fence(X, 2, 2, 2, 24, 2.4); P.fence(X, 2, 24, 26, 24, 2.4, [[8, 13]]);
    for (const [tx, tz] of [[10, 34], [18, 34]]) { X.cyl(tx, 0, tz, 3, 9, 18, 'metal', { col: 0xc8c8c4 }); X.cyl(tx, 9, tz, 3.05, 0.8, 18, 'metal', { col: 0xa8a8a4, r1: 0.4 }); }
    X.box(12, 0, 44, 16, 1.2, 50, 'concrete', { col: 0x8a8a84 });
    X.cyl(14, 1.2, 47, 0.9, 16, 12, 'brick', { col: 0x9a5a4a, r1: 0.7 });
    for (let k = 0; k < 6; k++) P.barrel(X, rng.range(4, 26), rng.range(28, 52), 0, rng.pick([0x7a3a28, 0x2a4a7a, 0x4a6a3a]));
    for (let k = 0; k < 4; k++) P.crate(X, rng.range(4, 26), rng.range(40, 54), 0, 1, rng.chance(0.5), rng);
    P.car(X, 22, 0, 46, 0.1, BL.carColor(rng), 0, 'truck');
    X.light(14, 6, 26, 'flood');
  },

  warehouse(X, rng) {
    ground(X, 'dirt');
    BL.warehouse(facing(X, 'S', 4, 2, 48, 28), rng, 44, 26);
    for (let k = 0; k < 3; k++) P.car(X, 10 + k * 12, 0, 40, rng.range(-0.15, 0.15), BL.carColor(rng), rng.chance(0.4) ? 1 : 0, 'truck');
    P.fence(X, 1, 52, 55, 52, 2.4, [[24, 32]]);
    for (let k = 0; k < 8; k++) X.inst('pallet', rng.range(4, 52), 0, rng.range(32, 50), rng.range(0, 3), 1);
    for (let k = 0; k < 4; k++) P.crate(X, rng.range(4, 52), rng.range(32, 50), 0, 1, rng.chance(0.5), rng);
    X.light(28, 6, 34, 'flood');
    for (let k = 0; k < 3; k++) X.W.zSpawns.push({ x: X.p(rng.range(6, 50), 0)[0], z: X.p(0, rng.range(32, 50))[1], indoor: false });
  },

  park(X, rng) {
    ground(X, 'grass');
    X.hplane(26, 0, 30, 56, 0.006, 'sidewalk');
    X.hplane(0, 26, 56, 30, 0.007, 'sidewalk');
    for (let k = 0; k < 22; k++) {
      const x = rng.range(3, 53), z = rng.range(3, 53);
      if (Math.abs(x - 28) < 4 || Math.abs(z - 28) < 4) continue;
      if (x > 30 && z > 30) continue;
      tree(X, x, z, rng, rng.range(0.9, 1.5));
    }
    // gazebo
    X.cyl(14, 0, 14, 4, 0.3, 12, 'wood', { col: 0x8a7a6a });
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; X.box(14 + Math.cos(a) * 3.6 - 0.1, 0.3, 14 + Math.sin(a) * 3.6 - 0.1, 14 + Math.cos(a) * 3.6 + 0.1, 3, 14 + Math.sin(a) * 3.6 + 0.1, 'wood', { col: 0xe8e0d0 }); }
    X.cyl(14, 3, 14, 4.4, 1.4, 12, 'shingle', { col: 0x5a4a44, r1: 0.2, c: false });
    for (const [bx, bz, r] of [[22, 24, 0], [34, 24, 0], [22, 32, 2]]) P.bench(X, bx, bz, r);
    // FEMA relief camp
    for (let k = 0; k < 3; k++) for (let r = 0; r < 2; r++) P.tent(X, 35 + k * 7, 36 + r * 9, 0, rng);
    P.fence(X, 31, 31, 55, 31, 2.2, [[40, 44]]);
    P.fence(X, 31, 31, 31, 55, 2.2);
    P.car(X, 50, 0, 52, Math.PI / 2, 0x4a5a3a, 0, 'truck');
    P.sandbags(X, 32, 33, 38, 33, 1.0);
    X.light(43, 5, 40, 'flood');
    X.W.pois.camp = { x: X.p(42, 0)[0], z: X.p(0, 42)[1] };
    for (let k = 0; k < 4; k++) X.W.zSpawns.push({ x: X.p(rng.range(6, 50), 0)[0], z: X.p(0, rng.range(6, 50))[1], indoor: false });
  },
};

function fenceLow(X, x0, z0, x1, z1) {
  const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  if (along) {
    X.box(Math.min(x0, x1), 0.25, z0 - 0.03, Math.max(x0, x1), 0.35, z0 + 0.03, 'wood', { col: 0xe0dcd0, c: false });
    X.box(Math.min(x0, x1), 0.7, z0 - 0.03, Math.max(x0, x1), 0.8, z0 + 0.03, 'wood', { col: 0xe0dcd0, c: false });
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 0.35) X.box(x, 0, z0 - 0.02, x + 0.1, 1.0, z0 + 0.02, 'wood', { col: 0xe8e4d8, c: false });
    X.box(Math.min(x0, x1), 0, z0 - 0.05, Math.max(x0, x1), 1.0, z0 + 0.05, 'solid', { invisible: true });
  } else {
    X.box(x0 - 0.03, 0.25, Math.min(z0, z1), x0 + 0.03, 0.35, Math.max(z0, z1), 'wood', { col: 0xe0dcd0, c: false });
    X.box(x0 - 0.03, 0.7, Math.min(z0, z1), x0 + 0.03, 0.8, Math.max(z0, z1), 'wood', { col: 0xe0dcd0, c: false });
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z += 0.35) X.box(x0 - 0.02, 0, z, x0 + 0.02, 1.0, z + 0.1, 'wood', { col: 0xe8e4d8, c: false });
    X.box(x0 - 0.05, 0, Math.min(z0, z1), x0 + 0.05, 1.0, Math.max(z0, z1), 'solid', { invisible: true });
  }
}

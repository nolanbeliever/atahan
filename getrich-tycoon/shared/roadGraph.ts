// The road network as a graph of junctions (police routes and where police cars join a chase): the
// city grid, the two bridges, the far shore's VIP Otoban, boulevard, docks and the touge.

import { DOCKS_ROAD, TOUGE_NODES } from './farShore';
import { BRIDGES, VIP_X } from './strait';

/** A junction of the road network. */
export interface NavNode {
  x: number;
  z: number;
}

const CITY_LINES = [-150, -50, 50, 150];
/** Where the touge leaves the VIP Otoban (the first point of TOUGE_NODES is just east of it). */
const TOUGE_Z = -236;
const VIP_STOPS = [-240, TOUGE_Z, -50, 40, 130, 200, 240];
const DOCKS_X = (DOCKS_ROAD.minX + DOCKS_ROAD.maxX) / 2;

/** Road junctions. */
export const NAV_NODES: NavNode[] = (() => {
  const out: NavNode[] = [];
  for (const x of CITY_LINES) for (const z of CITY_LINES) out.push({ x, z });
  // The South Bridge leaves the city's east road between two junctions.
  out.push({ x: 150, z: 130 });
  // The VIP Otoban: its ends, the touge, the bridge landings, the boulevard and the docks gate.
  for (const z of VIP_STOPS) out.push({ x: VIP_X, z });
  // The boulevard: the docks road junction and the touge's foot at its east end.
  out.push({ x: DOCKS_X, z: 40 }, { x: 1030, z: 40 });
  // The docks: where the road comes into the yard, a lane in the middle, the west gate.
  out.push({ x: DOCKS_X, z: 155 }, { x: DOCKS_X, z: 214 }, { x: 728, z: 200 }, { x: 790, z: 214 }, { x: 960, z: 214 });
  // Along the touge (every ~10 m: straight lines between them stay on the road).
  for (const p of TOUGE_NODES) out.push(p);
  return out;
})();

const nodeIndex = (x: number, z: number) => NAV_NODES.findIndex((n) => n.x === x && n.z === z);

/** Roads between junctions (both ways). `bridge` marks a bridge crossing. */
export const NAV_EDGES: { a: number; b: number; bridge?: number }[] = (() => {
  const out: { a: number; b: number; bridge?: number }[] = [];
  const add = (ax: number, az: number, bx: number, bz: number, bridge?: number) => {
    const a = nodeIndex(ax, az);
    const b = nodeIndex(bx, bz);
    if (a < 0 || b < 0) throw new Error(`nav edge ${ax},${az} - ${bx},${bz}`);
    out.push(bridge ? { a, b, bridge } : { a, b });
  };
  for (const x of CITY_LINES) {
    for (let i = 0; i < 3; i++) {
      add(CITY_LINES[i]!, x, CITY_LINES[i + 1]!, x);
      // The east road (x = 150) has the South Bridge junction between z = 50 and z = 150.
      if (x === 150 && i === 1) {
        add(150, 50, 150, 130);
        add(150, 130, 150, 150);
      } else add(x, CITY_LINES[i]!, x, CITY_LINES[i + 1]!);
    }
  }
  for (const b of BRIDGES) add(150, b.z, VIP_X, b.z, b.n);
  for (let i = 0; i < VIP_STOPS.length - 1; i++) add(VIP_X, VIP_STOPS[i]!, VIP_X, VIP_STOPS[i + 1]!);
  add(VIP_X, 40, DOCKS_X, 40);
  add(DOCKS_X, 40, 1030, 40);
  add(DOCKS_X, 40, DOCKS_X, 155);
  add(DOCKS_X, 155, DOCKS_X, 214);
  add(VIP_X, 200, 728, 200);
  add(728, 200, 790, 214);
  add(790, 214, DOCKS_X, 214);
  add(DOCKS_X, 214, 960, 214);
  // The touge, from the VIP Otoban to the boulevard.
  const t = TOUGE_NODES;
  add(VIP_X, TOUGE_Z, t[0]!.x, t[0]!.z);
  for (let i = 1; i < t.length; i++) add(t[i - 1]!.x, t[i - 1]!.z, t[i]!.x, t[i]!.z);
  add(t[t.length - 1]!.x, t[t.length - 1]!.z, 1030, 40);
  return out;
})();

/** Points along the roads (not the bridges) every `step` metres, with the road's direction: where
 *  police cars can join a chase. */
export function navRoadPoints(step = 10): { x: number; z: number; rot: number }[] {
  const out: { x: number; z: number; rot: number }[] = [];
  for (const e of NAV_EDGES) {
    if (e.bridge) continue;
    const a = NAV_NODES[e.a]!;
    const b = NAV_NODES[e.b]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const rot = Math.atan2(b.x - a.x, b.z - a.z);
    for (let d = 0; d <= len; d += step) out.push({ x: a.x + ((b.x - a.x) * d) / len, z: a.z + ((b.z - a.z) * d) / len, rot });
  }
  return out;
}

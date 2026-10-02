// The GetRich city layout. Shared so the server can run collisions/proximity
// checks and the client can build the same city in 3D.
//
// Coordinates: metres. +x = east, +z = south, y = up. A yaw of 0 faces +z.

import { FAR_BOXES, FAR_CIRCLES, HILL_TREES } from './farShore';
import { AMMU_NATION, HOSPITAL, MOTO_GEAR } from './compounds';
import { HITMAN_ALLEY } from './hitman';
import { dealershipLevel } from './economy.config';
import { DRAG_BOXES, DRAG_STRIP, JUNCTIONS, highwayCircles } from './highway';
import { SANAYI, SANAYI_BOXES, SANAYI_CIRCLES } from './theft';

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export const ROAD_WIDTH = 12;
export const SIDEWALK = 3;
export const ROAD_LINES = [-150, -50, 50, 150] as const;
export const BLOCK_CENTERS = [-100, 0, 100] as const;
/** Half-size of the usable interior of a city block (inside the sidewalk). */
export const BLOCK_HALF = 50 - ROAD_WIDTH / 2 - SIDEWALK; // 41
/** Half size of the city (the outer road ends at 156; the green belt and the highway lie beyond). */
export const CITY_HALF = 158;
/** Characters and vehicles cannot leave this square (the highway's outer guardrail is inside it). */
export const WORLD_BOUNDS = 262;

export type ZoneId =
  | 'dealers_west'
  | 'dealers_east'
  | 'market'
  | 'bank'
  | 'spawn'
  | 'auction'
  | 'custom'
  | 'wash_fuel'
  | 'repair_parts'
  | 'sanayi';

export interface Zone {
  id: ZoneId;
  name: string;
  cx: number;
  cz: number;
  color: string;
}

export const ZONES: Zone[] = [
  { id: 'dealers_west', name: 'Dealership Row West', cx: -100, cz: -100, color: '#3a7bd5' },
  { id: 'dealers_east', name: 'Dealership Row East', cx: 0, cz: -100, color: '#3a7bd5' },
  { id: 'market', name: 'Used Vehicle Market', cx: 100, cz: -100, color: '#f4a261' },
  { id: 'bank', name: 'GetRich Bank', cx: -100, cz: 0, color: '#2a9d8f' },
  { id: 'spawn', name: 'Fortune Plaza', cx: 0, cz: 0, color: '#6ab04c' },
  { id: 'auction', name: 'Hammerfall Auction House', cx: 100, cz: 0, color: '#9b5de5' },
  { id: 'custom', name: 'Chroma Custom Garage', cx: -100, cz: 100, color: '#f15bb5' },
  { id: 'wash_fuel', name: 'Car Wash & Fuel', cx: 0, cz: 100, color: '#00bbf9' },
  { id: 'repair_parts', name: 'Wrench Bros Repair & Parts', cx: 100, cz: 100, color: '#e76f51' },
  { id: 'sanayi', name: 'Sanayi Industrial Estate', cx: (SANAYI.yard.minX + SANAYI.yard.maxX) / 2, cz: (SANAYI.yard.minZ + SANAYI.yard.maxZ) / 2, color: '#8d6e63' },
];

export type InteractKind = 'market' | 'auction' | 'repair' | 'parts' | 'wash' | 'fuel' | 'bank' | 'custom' | 'plot' | 'drag' | 'pawn' | 'sanayi' | 'ammu' | 'hospital' | 'motogear' | 'hitman';

export interface Interactable {
  id: string;
  kind: InteractKind;
  x: number;
  z: number;
  radius: number;
  label: string;
  plotId?: string;
}

export interface Building {
  id: string;
  box: AABB;
  height: number;
  color: string;
  kind: 'service' | 'office' | 'glass' | 'canopy' | 'wall';
  /** Door / sign side */
  facing: 'north' | 'south' | 'east' | 'west';
  sign?: string;
  signColor?: string;
}

function box(minX: number, maxX: number, minZ: number, maxZ: number): AABB {
  return { minX, maxX, minZ, maxZ };
}

// ----------------------------------------------------------------------------
// Service buildings
// ----------------------------------------------------------------------------

export const BUILDINGS: Building[] = [
  // Used vehicle market office (north side of the market lot)
  { id: 'market_office', box: box(82, 118, -141, -129), height: 6, color: '#f4a261', kind: 'office', facing: 'south', sign: 'USED VEHICLE MARKET', signColor: '#f4a261' },
  // Bank (north half of the bank block)
  { id: 'bank', box: box(-126, -74, -38, -10), height: 12, color: '#d8e2dc', kind: 'service', facing: 'south', sign: 'GETRICH BANK', signColor: '#2a9d8f' },
  // Auction house
  { id: 'auction_house', box: box(76, 124, -40, -12), height: 11, color: '#3c096c', kind: 'service', facing: 'south', sign: 'HAMMERFALL AUCTIONS', signColor: '#c77dff' },
  // Customization garage
  { id: 'custom_garage', box: box(-130, -84, 62, 86), height: 8, color: '#2b2d42', kind: 'service', facing: 'south', sign: 'CHROMA CUSTOMS', signColor: '#f15bb5' },
  // Car wash side walls (drive-through tunnel along z)
  { id: 'wash_wall_w', box: box(-34, -32, 64, 90), height: 5, color: '#caf0f8', kind: 'wall', facing: 'south' },
  { id: 'wash_wall_e', box: box(-20, -18, 64, 90), height: 5, color: '#caf0f8', kind: 'wall', facing: 'south', sign: 'SPARKLE WASH', signColor: '#00bbf9' },
  // Fuel station shop
  { id: 'fuel_shop', box: box(14, 38, 118, 136), height: 5, color: '#f1faee', kind: 'office', facing: 'north', sign: 'FUEL & SNACKS', signColor: '#ef233c' },
  // Repair garage
  { id: 'repair_garage', box: box(64, 110, 62, 88), height: 9, color: '#6c757d', kind: 'service', facing: 'south', sign: 'WRENCH BROS REPAIR', signColor: '#e76f51' },
  // Parts shop
  { id: 'parts_shop', box: box(116, 138, 62, 82), height: 6, color: '#e9c46a', kind: 'office', facing: 'south', sign: 'PARTS DEPOT', signColor: '#264653' },
  // Out in the green belt: the hospital (north) and the Ammu-Nation gun shop (east).
  { id: 'hospital', box: HOSPITAL.box, height: 14, color: '#eef2f6', kind: 'service', facing: 'south', sign: 'GETRICH GENERAL HOSPITAL', signColor: '#e63946' },
  { id: 'ammu_nation', box: AMMU_NATION.box, height: 7, color: '#3d405b', kind: 'office', facing: 'west', sign: 'AMMU-NATION', signColor: '#e63946' },
  { id: 'moto_gear', box: MOTO_GEAR.box, height: 6, color: '#22252b', kind: 'office', facing: 'south', sign: 'MOTO GEAR · KASK', signColor: '#ff7a1a' },
  // The brick wall that closes the alley between Wrench Bros and the Parts Depot (hitman contact).
  { id: 'hitman_wall', box: HITMAN_ALLEY.wall, height: 4.5, color: '#5b3a32', kind: 'wall', facing: 'north' },
];

/** Decorative/structural circular obstacles. */
export const STATIC_CIRCLES: Circle[] = [
  // Fountain in Fortune Plaza
  { x: 0, z: 0, r: 5.5 },
  // Fuel pump islands
  { x: 18, z: 96, r: 1.2 },
  { x: 34, z: 96, r: 1.2 },
  // Highway: barrier ends, bridge piers and embankments, belt trees, the drag strip's tree.
  ...highwayCircles(),
  // Sanayi lift posts.
  ...SANAYI_CIRCLES,
  // Far shore: crane legs, flood-light towers, the trees on the touge's hill.
  ...FAR_CIRCLES,
  ...HILL_TREES.map((t) => ({ x: t.x, z: t.z, r: 0.5 })),
];

export const INTERACTABLES: Interactable[] = [
  { id: 'market', kind: 'market', x: 100, z: -126, radius: 7, label: 'Browse the Used Vehicle Market' },
  { id: 'bank', kind: 'bank', x: -100, z: -7, radius: 7, label: 'Enter GetRich Bank' },
  { id: 'auction', kind: 'auction', x: 100, z: -9, radius: 7, label: 'Enter Hammerfall Auction House' },
  { id: 'custom', kind: 'custom', x: -107, z: 89, radius: 8, label: 'Enter Chroma Customs' },
  { id: 'wash', kind: 'wash', x: -26, z: 93, radius: 8, label: 'Use Sparkle Wash' },
  { id: 'fuel', kind: 'fuel', x: 26, z: 100, radius: 10, label: 'Refuel vehicles' },
  { id: 'repair', kind: 'repair', x: 87, z: 91, radius: 8, label: 'Enter Wrench Bros Repair' },
  { id: 'parts', kind: 'parts', x: 127, z: 85, radius: 6, label: 'Enter Parts Depot' },
  { id: 'drag', kind: 'drag', x: DRAG_STRIP.stage.x, z: DRAG_STRIP.stage.z, radius: DRAG_STRIP.stage.radius, label: 'Drag Strip - race for $500' },
  { id: 'pawn', kind: 'pawn', x: SANAYI.pawn.minX - 2.5, z: (SANAYI.pawn.minZ + SANAYI.pawn.maxZ) / 2, radius: 5, label: 'Enter the Pawn Shop' },
  { id: 'sanayi', kind: 'sanayi', x: SANAYI.hall.minX + 4, z: SANAYI.hall.minZ + 4, radius: 4, label: 'Sanayi garage office' },
  { id: 'ammu', kind: 'ammu', x: AMMU_NATION.door.x, z: AMMU_NATION.door.z, radius: 4.5, label: 'Enter Ammu-Nation' },
  { id: 'hospital', kind: 'hospital', x: HOSPITAL.respawn.x, z: HOSPITAL.respawn.z - 3, radius: 4.5, label: 'Hospital · Hastane' },
  { id: 'motogear', kind: 'motogear', x: MOTO_GEAR.door.x, z: MOTO_GEAR.door.z, radius: 4.5, label: 'Moto Gear · Kask Mağazası' },
  { id: 'hitman', kind: 'hitman', x: HITMAN_ALLEY.contact.x, z: HITMAN_ALLEY.contact.z - 1.6, radius: 3.2, label: 'Görev Al' },
];

export const SERVICE_INTERACT_SLACK = 6;

// ----------------------------------------------------------------------------
// Used vehicle market lot
// ----------------------------------------------------------------------------

export interface SlotPos {
  x: number;
  z: number;
  rot: number;
}

export const MARKET_LOT_SLOTS: SlotPos[] = (() => {
  const slots: SlotPos[] = [];
  const rows = [-117, -104, -91, -78];
  const cols = [74, 91, 109, 126];
  for (const z of rows) for (const x of cols) slots.push({ x, z, rot: 0 });
  return slots;
})();

// ----------------------------------------------------------------------------
// Dealership plots
// ----------------------------------------------------------------------------

export const PLOT_HALF = 19;
export const MAX_SLOTS = 12;

export interface Plot {
  id: string;
  index: number;
  cx: number;
  cz: number;
  /** Yaw of the plot: local +z (front) faces the road. */
  rot: number;
}

export const PLOTS: Plot[] = (() => {
  const plots: Plot[] = [];
  let index = 0;
  for (const bx of [-100, 0]) {
    for (const oz of [-20.5, 20.5]) {
      for (const ox of [-20.5, 20.5]) {
        index++;
        plots.push({ id: `plot_${index}`, index, cx: bx + ox, cz: -100 + oz, rot: oz < 0 ? Math.PI : 0 });
      }
    }
  }
  return plots;
})();

const PLOT_INDEX = new Map(PLOTS.map((p) => [p.id, p]));

export function findPlot(id: string | null | undefined): Plot | undefined {
  return id ? PLOT_INDEX.get(id) : undefined;
}

/** Transform a plot-local point into world coordinates. */
export function plotToWorld(plot: Plot, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(plot.rot);
  const s = Math.sin(plot.rot);
  return { x: plot.cx + lx * c + lz * s, z: plot.cz - lx * s + lz * c };
}

/** Local slot layout (index order = fill order). */
const LOCAL_SLOTS: { x: number; z: number }[] = [
  { x: -13.5, z: 12.5 },
  { x: -4.5, z: 12.5 },
  { x: 4.5, z: 12.5 },
  { x: 13.5, z: 12.5 },
  { x: -4.5, z: 4.5 },
  { x: 4.5, z: 4.5 },
  { x: -13.5, z: 4.5 },
  { x: 13.5, z: 4.5 },
  { x: -4.5, z: -3.5 },
  { x: 4.5, z: -3.5 },
  { x: -13.5, z: -3.5 },
  { x: 13.5, z: -3.5 },
];

export function plotSlot(plot: Plot, slot: number): SlotPos {
  const l = LOCAL_SLOTS[Math.max(0, Math.min(MAX_SLOTS - 1, slot))]!;
  const p = plotToWorld(plot, l.x, l.z);
  return { x: p.x, z: p.z, rot: plot.rot };
}

export function plotSlotCount(level: number): number {
  return level <= 0 ? 0 : dealershipLevel(level).slots;
}

/** Entrance point in front of the plot (on the plot's road side). */
export function plotEntrance(plot: Plot): { x: number; z: number } {
  return plotToWorld(plot, 0, PLOT_HALF - 1);
}

/** Sidewalk point outside the plot entrance (used by NPC customers). */
export function plotSidewalk(plot: Plot, offsetX = 0): { x: number; z: number } {
  return plotToWorld(plot, offsetX, PLOT_HALF + 2.2);
}

export interface PlotStructure {
  box: AABB;
  height: number;
  kind: 'office' | 'showroom' | 'bay' | 'luxury' | 'mega';
}

/** Local-space building boxes for a dealership level (level 0 = empty plot). */
export function plotStructuresLocal(level: number): PlotStructure[] {
  switch (level) {
    case 0:
      return [];
    case 1:
      return [{ box: box(-4, 4, -18, -12), height: 3.2, kind: 'office' }];
    case 2:
      return [{ box: box(-7, 7, -18, -11), height: 3.8, kind: 'office' }];
    case 3:
      return [{ box: box(-14, 14, -18.5, -9.5), height: 5.5, kind: 'showroom' }];
    case 4:
      return [
        { box: box(-16, 6, -18.5, -9.5), height: 5.5, kind: 'showroom' },
        { box: box(8, 17, -18.5, -9.5), height: 5, kind: 'bay' },
      ];
    case 5:
      return [
        { box: box(-16, 6, -18.5, -8.5), height: 6.5, kind: 'luxury' },
        { box: box(8, 17, -18.5, -9.5), height: 5, kind: 'bay' },
      ];
    default:
      return [{ box: box(-17.5, 17.5, -18.5, -8.5), height: 9, kind: 'mega' }];
  }
}

function transformBox(plot: Plot, b: AABB): AABB {
  const pts = [
    plotToWorld(plot, b.minX, b.minZ),
    plotToWorld(plot, b.maxX, b.minZ),
    plotToWorld(plot, b.minX, b.maxZ),
    plotToWorld(plot, b.maxX, b.maxZ),
  ];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  };
}

export function plotStructuresWorld(plot: Plot, level: number): (PlotStructure & { local: AABB })[] {
  return plotStructuresLocal(level).map((s) => ({ ...s, local: s.box, box: transformBox(plot, s.box) }));
}

export function isInsidePlot(plot: Plot, x: number, z: number, margin = 0): boolean {
  return Math.abs(x - plot.cx) <= PLOT_HALF + margin && Math.abs(z - plot.cz) <= PLOT_HALF + margin;
}

// ----------------------------------------------------------------------------
// Roads, spawn, parking
// ----------------------------------------------------------------------------

export interface RoadRect extends AABB {
  dir: 'ns' | 'ew';
}

export const ROADS: RoadRect[] = (() => {
  const roads: RoadRect[] = [];
  const ext = ROAD_LINES[ROAD_LINES.length - 1]! + ROAD_WIDTH / 2;
  for (const l of ROAD_LINES) {
    roads.push({ minX: l - ROAD_WIDTH / 2, maxX: l + ROAD_WIDTH / 2, minZ: -ext, maxZ: ext, dir: 'ns' });
    roads.push({ minX: -ext, maxX: ext, minZ: l - ROAD_WIDTH / 2, maxZ: l + ROAD_WIDTH / 2, dir: 'ew' });
  }
  return roads;
})();

export const PARKING_LOTS: (AABB & { rows: number })[] = [
  { minX: -136, maxX: -64, minZ: 6, maxZ: 38, rows: 2 },
  { minX: -136, maxX: -64, minZ: 100, maxZ: 136, rows: 2 },
];

export function spawnPoint(seed: number): { x: number; z: number; rot: number } {
  const a = (seed % 360) * (Math.PI / 180);
  const r = 11 + (seed % 5);
  return { x: Math.sin(a) * r, z: Math.cos(a) * r, rot: a };
}

/** Points on sidewalks from which NPC customers appear. */
export function isOnRoad(x: number, z: number): boolean {
  return ROADS.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}

/**
 * City street lamps: on the sidewalks along every road (1.5 m outside the kerb), facing the road,
 * one every 24 m on each side. Never at a crossing (a lamp at the corner of a junction would stand
 * on the cross road), in a junction's connector or in the Sanayi driveway. [x, z, arm direction]:
 * ±1 arm along x, ±2 arm along z.
 */
export const CITY_LAMPS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  const edge = ROAD_WIDTH / 2 + 1.5;
  // A lamp at this distance along a road would stand in a crossing road.
  const clearOfRoads = (v: number) => ROAD_LINES.every((k) => Math.abs(k - v) > ROAD_WIDTH / 2 + 3.5);
  const outer = ROAD_LINES[ROAD_LINES.length - 1]!;
  const gapAt = (along: number, side: 'n' | 's' | 'e' | 'w') => {
    for (const j of JUNCTIONS) {
      const onSide = side === 'n' ? j.cityZ < -outer : side === 's' ? j.cityZ > outer : side === 'e' ? j.cityX > outer : j.cityX < -outer;
      const at = side === 'n' || side === 's' ? j.cityX : j.cityZ;
      if (onSide && Math.abs(along - at) < ROAD_WIDTH / 2 + 2.5) return true;
    }
    if (side === 's' && Math.abs(along - SANAYI.entry.x) < SANAYI.entry.width / 2 + 1.5) return true;
    return false;
  };
  for (const l of ROAD_LINES) {
    for (let s = -150; s <= 150; s += 24) {
      for (const [x, z, dir] of [
        [l - edge, s, 1],
        [l + edge, s + 12, -1],
        [s, l - edge, 2],
        [s + 12, l + edge, -2],
      ] as [number, number, number][]) {
        const along = Math.abs(dir) === 1 ? z : x;
        if (!clearOfRoads(along) || Math.abs(along) > outer + 3) continue;
        // The outer side of the outer roads: no lamps where a connector or the Sanayi driveway leaves.
        if (l === outer && dir === -2 && gapAt(x, 's')) continue;
        if (l === -outer && dir === 2 && gapAt(x, 'n')) continue;
        if (l === outer && dir === -1 && gapAt(z, 'e')) continue;
        if (l === -outer && dir === 1 && gapAt(z, 'w')) continue;
        out.push([x, z, dir]);
      }
    }
  }
  return out;
})();

/** All static colliders (buildings) - dealership buildings are added dynamically. */
export const STATIC_BOXES: AABB[] = [...BUILDINGS.map((b) => b.box), ...DRAG_BOXES, ...SANAYI_BOXES, ...FAR_BOXES];

export function findInteractable(id: string): Interactable | undefined {
  return INTERACTABLES.find((i) => i.id === id);
}

export function zoneAt(x: number, z: number): Zone | undefined {
  return ZONES.find((zn) => Math.abs(x - zn.cx) <= 50 && Math.abs(z - zn.cz) <= 50);
}

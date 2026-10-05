// Night burglaries (Gece Soygunu): from 22:00 to 06:00 (game time) the doors of the jewellers, the
// electronics shops, two villas in the green belt and a few flats are locked and empty. Pick the
// lock at the door (the lockpick mini-game: every snapped pick costs one lockpick from the
// inventory and the click raises the place's security by 20%), and you are inside: a room of its
// own far away from the city (only the people inside it ever see it), with the loot glowing on the
// counters and shelves, a safe to crack, laser beams across the doorways and motion sensors that
// blink on and off. Running, knocking a vase over or a wrong turn on the safe's dial fills the
// noise meter; full noise, a beam broken or a sensor catching you on the move and the alarm goes
// off (2 stars, the first police car 30 s away). Walk out quietly and the cash is clean.
//
// Pure data and helpers shared by the server (authoritative) and the client (3D, prompts, HUD).
// No imports from world.ts (physics.ts reads the room walls from here).

import { ECONOMY } from './economy.config';
import { gameHour } from './environment';

const B = ECONOMY.burglary;

export type BurglaryKind = 'jeweler' | 'electronics' | 'villa' | 'flat';

/** What the loot is. Cash comes out of the safes; the rest goes into the inventory. */
export type LootKind = 'safe' | 'jewels' | 'watches' | 'laptop' | 'electronics';

/** Inventory items (the Pawn Shop buys them). */
export const LOOT_ITEMS = {
  jewels: 'loot_jewels',
  watches: 'loot_watch',
  laptop: 'loot_laptop',
  electronics: 'loot_electronics',
} as const satisfies Record<Exclude<LootKind, 'safe'>, string>;

export type LootItemId = (typeof LOOT_ITEMS)[keyof typeof LOOT_ITEMS];

export const LOOT_ITEM_IDS: readonly LootItemId[] = Object.values(LOOT_ITEMS);

export const LOOT_LABELS: Record<LootItemId, { tr: string; en: string; icon: string }> = {
  loot_jewels: { tr: 'Mücevher (yüzük, kolye)', en: 'Jewellery', icon: '💍' },
  loot_watch: { tr: 'Lüks Kol Saati', en: 'Luxury watch', icon: '⌚' },
  loot_laptop: { tr: 'Laptop', en: 'Laptop', icon: '💻' },
  loot_electronics: { tr: 'Telefon & Tablet', en: 'Phones & tablets', icon: '📱' },
};

export function isLootItem(id: string): id is LootItemId {
  return (LOOT_ITEM_IDS as readonly string[]).includes(id);
}

/** What the Pawn Shop pays for one (the low and high end; luck decides). */
export function lootPawnRange(id: LootItemId): [number, number] {
  return B.pawn[id];
}

// ------------------------------------------------------------------ the night window

/** Burglaries are on between these game hours (22:00 to 06:00). */
export function burglaryOpen(serverTime: number): boolean {
  const h = gameHour(serverTime);
  return h >= B.fromHour || h < B.toHour;
}

/** Morning: the owners are back (an alarm for anyone still inside). */
export function ownersBack(serverTime: number): boolean {
  const h = gameHour(serverTime);
  return h >= B.ownersHour && h < B.fromHour;
}

/** Game hours to the next 22:00 (for "come back later"). */
export function hoursToNight(serverTime: number): number {
  const h = gameHour(serverTime);
  return burglaryOpen(serverTime) ? 0 : B.fromHour - h;
}

// ------------------------------------------------------------------ rooms

/** Rooms are built far away from the city, south of everything (no one outside ever sees them). */
export const INTERIOR_ZONE = { minX: -400, maxX: 400, minZ: -3400, maxZ: -2700 };

export function inInteriorZone(x: number, z: number): boolean {
  return x > INTERIOR_ZONE.minX && x < INTERIOR_ZONE.maxX && z > INTERIOR_ZONE.minZ && z < INTERIOR_ZONE.maxZ;
}

/** A box in room coordinates: x across (-W/2..W/2), z from the front door (0) to the back wall (D). */
export interface LocalBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** How tall it is (for the 3D). */
  h: number;
  look: 'counter' | 'shelf' | 'wall' | 'sofa' | 'table' | 'bed' | 'desk' | 'safe' | 'wardrobe' | 'tv';
}

export interface LootSpot {
  id: string;
  kind: LootKind;
  /** Where it is (on the counter / shelf) and where you stand to take it. */
  x: number;
  z: number;
  y: number;
  stand: { x: number; z: number };
}

/** A laser beam across a doorway at waist height: on the whole time, or blinking. */
export interface Laser {
  id: string;
  a: { x: number; z: number };
  b: { x: number; z: number };
  /** Blinking (s): on for `on` of every `period`, starting at `phase`. Period 0: always on. */
  period: number;
  on: number;
  phase: number;
}

/** A motion sensor up on the wall: it watches a circle on the floor while its LED is red. */
export interface MotionSensor {
  id: string;
  x: number;
  z: number;
  r: number;
  period: number;
  on: number;
  phase: number;
}

/** Things that go over with a crash if you walk into them (a vase, a chair, a box of stock). */
export interface Knockable {
  id: string;
  x: number;
  z: number;
  look: 'vase' | 'chair' | 'box' | 'lamp' | 'bottles' | 'plant';
}

export interface RoomLayout {
  kind: BurglaryKind;
  /** Inner size (m), ceiling height. */
  w: number;
  d: number;
  h: number;
  floor: string;
  wall: string;
  boxes: LocalBox[];
  loot: LootSpot[];
  lasers: Laser[];
  sensors: MotionSensor[];
  knock: Knockable[];
}

const box = (x0: number, x1: number, z0: number, z1: number, h: number, look: LocalBox['look']): LocalBox => ({ x0, x1, z0, z1, h, look });
const loot = (id: string, kind: LootKind, x: number, z: number, y: number, sx: number, sz: number): LootSpot => ({ id, kind, x, z, y, stand: { x: sx, z: sz } });

export const LAYOUTS: Record<BurglaryKind, RoomLayout> = {
  // A jeweller: glass counters down both sides and an island in the middle, the back office
  // through a doorway with a blinking laser, the safe against its back wall.
  jeweler: {
    kind: 'jeweler',
    w: 14,
    d: 11,
    h: 3.4,
    floor: '#e9e2d0',
    wall: '#3b2a1e',
    boxes: [
      box(-6.6, -5.4, 2, 8, 1.05, 'counter'),
      box(5.4, 6.6, 2, 8, 1.05, 'counter'),
      box(-1.2, 1.2, 4.2, 5.4, 1.05, 'counter'),
      // The partition between the shop and the back office (a doorway in the middle).
      box(-7, -1.2, 8.5, 8.75, 3.4, 'wall'),
      box(1.2, 7, 8.5, 8.75, 3.4, 'wall'),
      box(3.9, 5.1, 10.1, 10.95, 1.3, 'safe'),
      box(-5.6, -2.6, 10.1, 10.9, 0.78, 'desk'),
    ],
    loot: [
      loot('case_l1', 'jewels', -6, 3.4, 1.12, -4.75, 3.4),
      loot('case_l2', 'watches', -6, 6.6, 1.12, -4.75, 6.6),
      loot('case_r1', 'watches', 6, 3.4, 1.12, 4.75, 3.4),
      loot('case_r2', 'jewels', 6, 6.6, 1.12, 4.75, 6.6),
      loot('case_c', 'jewels', 0, 4.8, 1.12, 0, 3.55),
      loot('safe', 'safe', 4.5, 10.5, 0.9, 4.5, 9.45),
      loot('office', 'laptop', -4.1, 10.5, 0.84, -4.1, 9.5),
    ],
    lasers: [{ id: 'office_door', a: { x: -1.2, z: 8.62 }, b: { x: 1.2, z: 8.62 }, period: 3.8, on: 2.2, phase: 0 }],
    sensors: [{ id: 'shop', x: 0, z: 7.1, r: 2.3, period: 6, on: 2.4, phase: 1 }],
    knock: [
      { id: 'plant', x: -3.4, z: 1.4, look: 'plant' },
      { id: 'vase', x: 2.1, z: 4.8, look: 'vase' },
      { id: 'chair', x: 2.6, z: 9.7, look: 'chair' },
    ],
  },
  // An electronics shop: three rows of shelves, motion sensors over the aisles, the storeroom at
  // the back (through a gap with a laser) with the takings in a safe.
  electronics: {
    kind: 'electronics',
    w: 16,
    d: 12,
    h: 3.6,
    floor: '#d7dde4',
    wall: '#26313d',
    boxes: [
      box(-5, -4, 2.4, 8, 1.9, 'shelf'),
      box(-0.5, 0.5, 2.4, 8, 1.9, 'shelf'),
      box(4, 5, 2.4, 8, 1.9, 'shelf'),
      // The storeroom wall (a gap at the east end with a laser across it).
      box(-8, 5.5, 9.3, 9.55, 3.6, 'wall'),
      box(-7.6, -6.4, 11, 11.95, 1.3, 'safe'),
      box(1, 4.5, 11.2, 11.95, 1.6, 'shelf'),
    ],
    loot: [
      loot('shelf_a1', 'electronics', -3.9, 3.4, 1.2, -3.1, 3.4),
      loot('shelf_a2', 'laptop', -3.9, 7, 1.2, -3.1, 7),
      loot('shelf_b1', 'electronics', 0.6, 5.2, 1.2, 1.4, 5.2),
      loot('shelf_c1', 'laptop', 3.9, 3.4, 1.2, 3.1, 3.4),
      loot('shelf_c2', 'electronics', 3.9, 7, 1.2, 3.1, 7),
      loot('store', 'electronics', 2.75, 11.15, 1.25, 2.75, 10.4),
      loot('safe', 'safe', -7, 11.4, 0.9, -7, 10.3),
    ],
    lasers: [{ id: 'store_gap', a: { x: 5.5, z: 9.42 }, b: { x: 8, z: 9.42 }, period: 3.4, on: 1.9, phase: 0.6 }],
    sensors: [
      { id: 'aisle_l', x: -2.25, z: 5.2, r: 1.9, period: 5, on: 2, phase: 0 },
      { id: 'aisle_r', x: 2.25, z: 5.2, r: 1.9, period: 5, on: 2, phase: 2.5 },
    ],
    knock: [
      { id: 'box1', x: -6.4, z: 1.6, look: 'box' },
      { id: 'box2', x: 6.6, z: 6.2, look: 'box' },
      { id: 'box3', x: -2.25, z: 1.9, look: 'box' },
    ],
  },
  // A villa: a big living room, the bedroom through a doorway with a laser, the safe behind the
  // bedroom door, the study's laptop in the corner.
  villa: {
    kind: 'villa',
    w: 18,
    d: 14,
    h: 3.8,
    floor: '#bfa27a',
    wall: '#f1ece2',
    boxes: [
      box(-6.2, -2.2, 3, 4, 0.85, 'sofa'),
      box(-5, -3.2, 5.2, 6.2, 0.45, 'table'),
      box(-9, -8.5, 3.5, 8.5, 0.6, 'tv'),
      box(-8.9, -6.1, 11.6, 13.4, 0.78, 'desk'),
      // The bedroom wall (x 1) with a doorway between z 6 and 8.4.
      box(1, 1.25, 0, 6, 3.8, 'wall'),
      box(1, 1.25, 8.4, 14, 3.8, 'wall'),
      box(5, 8.6, 8.3, 12.4, 0.6, 'bed'),
      box(4, 4.8, 11.6, 12.4, 0.55, 'table'),
      box(2.2, 4, 13.2, 14, 1, 'wardrobe'),
      box(8.3, 9, 1.4, 2.6, 1.3, 'safe'),
    ],
    loot: [
      loot('tv', 'electronics', -8.75, 6, 0.72, -7.9, 6),
      loot('study', 'laptop', -7.5, 12.1, 0.84, -7.5, 11),
      loot('dresser', 'jewels', 3.1, 13.6, 1.08, 3.1, 12.6),
      loot('bedside', 'watches', 4.4, 12, 0.62, 4.4, 11),
      loot('safe', 'safe', 8.65, 2, 0.9, 7.7, 2),
    ],
    lasers: [{ id: 'bedroom_door', a: { x: 1.12, z: 6 }, b: { x: 1.12, z: 8.4 }, period: 3.6, on: 2, phase: 1.2 }],
    sensors: [
      { id: 'living', x: -3, z: 9.2, r: 2.4, period: 6.5, on: 2.6, phase: 0 },
      { id: 'hall', x: 5.2, z: 4.6, r: 2.1, period: 5.5, on: 2.2, phase: 3 },
    ],
    knock: [
      { id: 'vase', x: -1, z: 2.4, look: 'vase' },
      { id: 'lamp', x: -4.1, z: 7.4, look: 'lamp' },
      { id: 'chair', x: 6.2, z: 6.6, look: 'chair' },
    ],
  },
  // A flat: a small living room with a bed in the corner, the savings in a little safe in the
  // wardrobe. One motion sensor, no lasers.
  flat: {
    kind: 'flat',
    w: 12,
    d: 10,
    h: 3,
    floor: '#a98b6b',
    wall: '#c9c1b2',
    boxes: [
      box(-5.6, -3, 6, 7, 0.85, 'sofa'),
      box(1, 3, 3, 4.4, 0.75, 'table'),
      box(2.6, 5.6, 6.6, 9.6, 0.55, 'bed'),
      box(-6, -5, 1, 3.2, 2.1, 'wardrobe'),
      box(4.8, 6, 1.4, 3.2, 1, 'wardrobe'),
    ],
    loot: [
      loot('table', 'laptop', 2, 3.7, 0.82, 2, 2.45),
      loot('dresser', 'jewels', 5.4, 2.3, 1.06, 4.2, 2.3),
      loot('sofa', 'electronics', -4.3, 6.5, 0.9, -4.3, 5.4),
      loot('safe', 'safe', -5.5, 2.1, 0.6, -4.4, 2.1),
    ],
    lasers: [],
    sensors: [{ id: 'room', x: 0.4, z: 6.3, r: 1.8, period: 5.5, on: 2, phase: 0.5 }],
    knock: [
      { id: 'bottles', x: -0.6, z: 4.6, look: 'bottles' },
      { id: 'chair', x: -1.2, z: 3.1, look: 'chair' },
      { id: 'plant', x: 4.2, z: 0.9, look: 'plant' },
    ],
  },
};

// ------------------------------------------------------------------ the places

export interface BurglaryTarget {
  id: string;
  name: string;
  kind: BurglaryKind;
  /** Where you stand at the front door (outside), facing it (rot), and the door itself. */
  stand: { x: number; z: number; rot: number };
  door: { x: number; z: number };
  /** The lock: sweet-spot tolerance (degrees either side). */
  tolerance: number;
  /** Cash in the safe ($). */
  cash: [number, number];
  /** Where its room is (origin = the middle of the front door, inside). */
  room: { x: number; z: number };
}

/** Standing on the pavement in front of a door on a building face: the door at (x, z) on a wall facing `facing`. */
function front(x: number, z: number, facing: 'north' | 'south' | 'east' | 'west'): Pick<BurglaryTarget, 'stand' | 'door'> {
  // North is -z, south +z (as for the buildings' sign sides).
  const [dx, dz] = facing === 'north' ? [0, -1] : facing === 'south' ? [0, 1] : facing === 'east' ? [1, 0] : [-1, 0];
  return { door: { x, z }, stand: { x: x + dx * 1.3, z: z + dz * 1.3, rot: Math.atan2(-dx, -dz) } };
}

/** Room slots: a row of rooms 70 m apart. */
function slot(i: number): { x: number; z: number } {
  return { x: -300 + (i % 8) * 70, z: -3300 + Math.floor(i / 8) * 70 };
}

const TARGETS_RAW: Omit<BurglaryTarget, 'room'>[] = [
  { id: 'kuyumcu_altinsaray', name: 'Kuyumcu Altınsaray', kind: 'jeweler', ...front(88, 141, 'south'), tolerance: 5, cash: [24_000, 35_000] },
  { id: 'saat_galerisi', name: 'Saat Galerisi Zaman', kind: 'jeweler', ...front(128, 141, 'south'), tolerance: 5, cash: [22_000, 33_000] },
  { id: 'tekno_dunya', name: 'Tekno Dünya Elektronik', kind: 'electronics', ...front(114, 41, 'south'), tolerance: 7, cash: [15_000, 24_000] },
  { id: 'medya_elektronik', name: 'Medya Elektronik', kind: 'electronics', ...front(-59, 87.5, 'east'), tolerance: 7, cash: [15_000, 24_000] },
  { id: 'villa_lale', name: 'Villa Lale', kind: 'villa', ...front(-20, 172, 'north'), tolerance: 4.5, cash: [22_000, 35_000] },
  { id: 'villa_manolya', name: 'Villa Manolya', kind: 'villa', ...front(27, 172, 'north'), tolerance: 4.5, cash: [20_000, 35_000] },
  { id: 'daire_gul_apt', name: 'Gül Apartmanı Daire 4', kind: 'flat', ...front(69, 141, 'south'), tolerance: 9, cash: [15_000, 20_000] },
  { id: 'daire_mese_apt', name: 'Meşe Apartmanı Daire 2', kind: 'flat', ...front(70, 41, 'south'), tolerance: 9, cash: [15_000, 21_000] },
];

export const BURGLARY_TARGETS: BurglaryTarget[] = TARGETS_RAW.map((t, i) => ({ ...t, room: slot(i) }));

export function findTarget(id: string): BurglaryTarget | undefined {
  return BURGLARY_TARGETS.find((t) => t.id === id);
}

export const KIND_LABEL: Record<BurglaryKind, string> = { jeweler: 'Kuyumcu', electronics: 'Elektronik Mağazası', villa: 'Villa', flat: 'Daire' };

// ------------------------------------------------------------------ world <-> room

export function layoutOf(t: BurglaryTarget): RoomLayout {
  return LAYOUTS[t.kind];
}

/** A point in a target's room, in world coordinates. */
export function roomPoint(t: BurglaryTarget, x: number, z: number): { x: number; z: number } {
  return { x: t.room.x + x, z: t.room.z + z };
}

/** Where you appear inside (just past the front door, facing in) and where the way out is. */
export function roomEntry(t: BurglaryTarget): { x: number; z: number; rot: number } {
  return { ...roomPoint(t, 0, 1.1), rot: 0 };
}

/** The target whose room a world point is in. */
export function roomAt(x: number, z: number): BurglaryTarget | undefined {
  if (!inInteriorZone(x, z)) return undefined;
  return BURGLARY_TARGETS.find((t) => {
    const l = layoutOf(t);
    return x > t.room.x - l.w / 2 - 1 && x < t.room.x + l.w / 2 + 1 && z > t.room.z - 1 && z < t.room.z + l.d + 1;
  });
}

/** Wall thickness of the rooms. */
const WALL = 0.4;

/** The colliders of one room in world coordinates (the four walls and the furniture). */
export function roomBoxes(t: BurglaryTarget): { minX: number; maxX: number; minZ: number; maxZ: number }[] {
  const l = layoutOf(t);
  const ox = t.room.x;
  const oz = t.room.z;
  const hw = l.w / 2;
  return [
    { minX: ox - hw - WALL, maxX: ox + hw + WALL, minZ: oz - WALL, maxZ: oz },
    { minX: ox - hw - WALL, maxX: ox + hw + WALL, minZ: oz + l.d, maxZ: oz + l.d + WALL },
    { minX: ox - hw - WALL, maxX: ox - hw, minZ: oz, maxZ: oz + l.d },
    { minX: ox + hw, maxX: ox + hw + WALL, minZ: oz, maxZ: oz + l.d },
    ...l.boxes.map((b) => ({ minX: ox + b.x0, maxX: ox + b.x1, minZ: oz + b.z0, maxZ: oz + b.z1 })),
  ];
}

/** Every room's colliders (only looked at inside the interior zone). */
export const INTERIOR_BOXES = BURGLARY_TARGETS.flatMap(roomBoxes);

// ------------------------------------------------------------------ sensors

/** Is a blinking laser / sensor on at this time (ms, server clock)? */
export function cycleOn(c: { period: number; on: number; phase: number }, serverTime: number): boolean {
  if (c.period <= 0) return true;
  const t = (serverTime / 1000 + c.phase) % c.period;
  return t < c.on;
}

/** Distance from a point to a segment. */
export function segDist(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + dx * k), pz - (a.z + dz * k));
}

/** A laser beam is broken by a body this close to it. */
export const LASER_TOUCH = 0.42;
/** A knockable goes over when you come this close. */
export const KNOCK_TOUCH = 0.7;
/** Reach to take loot / use the way out. */
export const LOOT_REACH = 1.5;
export const EXIT_REACH = 1.8;

// ------------------------------------------------------------------ what is sent

export interface BurglaryTargetView {
  id: string;
  /** Security / noise left over from the lock (0-100). */
  security: number;
  /** The alarm is ringing at the building (flashers and siren outside). */
  alarm: boolean;
  /** Someone is inside right now (the door is open). */
  open: boolean;
  /** Hit not long ago: closed until then (ms). */
  readyAt: number;
}

export interface BurglaryState {
  targetId: string;
  /** Noise meter 0-100 (100: alarm). */
  noise: number;
  alarm: boolean;
  /** Why the alarm went off. */
  cause: string | null;
  /** When the first police car is there (ms; null: not called). */
  policeAt: number | null;
  /** Loot taken (everyone's), and what went over. */
  taken: string[];
  knocked: string[];
  /** Taking something right now: which, and when it's done (ms). */
  work: { lootId: string; until: number; sec: number } | null;
  /** The safe: tries left, open. */
  safe: { tries: number; open: boolean };
  /** In my bag so far. */
  bag: { cash: number; items: Partial<Record<LootItemId, number>> };
}

/** The result of taking the bag out. */
export interface BurglaryResult {
  targetId: string;
  cash: number;
  items: Partial<Record<LootItemId, number>>;
  /** Out quietly (clean money, straight into the pocket) or with the alarm (hot until the police are lost). */
  clean: boolean;
  text: string;
}

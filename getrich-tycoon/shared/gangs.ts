// Gang territories (Çete Bölgeleri): four parts of the map belong to street gangs, each in its own
// colour on the minimap and the full map with a dominance bar: the Sanayi (Sanayi Kurtları, grey
// green), the docks (Liman Baronları, blue), Downtown (Kızıl Eller, red) and the touge (Dağ
// Akrepleri, yellow). A zone you take turns purple, your colour.
//
// A turf war starts when you shoot up a shop in a gang's zone, shoot one of its members hanging
// round their hangout, or raid the hangout itself (E at its door): "BÖLGE SAVAŞI BAŞLADI". Two or
// three waves come for you, gang cars and bikes racing in along the roads and armed members
// jumping out; clear every wave and the zone is yours (100%). It pays protection money every 10
// minutes (into the bank, or in cash kept for you at Emlak Dünyası), and every 30-45 minutes the
// gang hits back: "BÖLGEN SALDIRI ALTINDA" - get there within 2 minutes and beat them off, or the
// zone is lost and the money stops.
//
// Pure data and helpers shared by the server and the client. No imports from world.ts (it lists
// the hangouts as buildings).

import { ECONOMY } from './economy.config';

const G = ECONOMY.gangs;

export type GangZoneId = 'sanayi' | 'docks' | 'downtown' | 'touge';

/** The player's colour on the map once a zone is theirs. */
export const PLAYER_ZONE_COLOR = '#a855f7';

export interface GangZone {
  id: GangZoneId;
  /** The zone's name (banners, the map). */
  name: string;
  gang: string;
  color: string;
  /** The zone on the map. */
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The hangout: a small building with its door (raid it), where the members stand about. */
  venue: { name: string; box: { minX: number; maxX: number; minZ: number; maxZ: number }; door: { x: number; z: number; rot: number }; facing: 'north' | 'south' | 'east' | 'west' };
  /** Roads the gang's cars come in along (polylines; they stop at the last point and the members get out). */
  lanes: { x: number; z: number }[][];
  /** Protection money every 10 minutes ($) and the number of waves to take it. */
  income: number;
  waves: number;
  /** Which car / bike models the gang drives. */
  car: string;
  bike: string;
}

/** A small building (the hangout) with its door in the middle of one face. */
function venue(name: string, x: number, z: number, w: number, d: number, facing: GangZone['venue']['facing']): GangZone['venue'] {
  const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
  const door =
    facing === 'north'
      ? { x, z: box.minZ - 1.3, rot: 0 }
      : facing === 'south'
        ? { x, z: box.maxZ + 1.3, rot: Math.PI }
        : facing === 'east'
          ? { x: box.maxX + 1.3, z, rot: -Math.PI / 2 }
          : { x: box.minX - 1.3, z, rot: Math.PI / 2 };
  return { name, box, door, facing };
}

const p = (x: number, z: number) => ({ x, z });

export const GANG_ZONES: GangZone[] = [
  {
    id: 'sanayi',
    name: 'Sanayi',
    gang: 'Sanayi Kurtları',
    color: '#7fa37a',
    box: { minX: 40, maxX: 170, minZ: 150, maxZ: 222 },
    venue: venue('Kurtlar Kahvesi', 66, 209, 10, 6.4, 'north'),
    lanes: [
      [p(-30, 150), p(60, 150), p(60, 186)],
      [p(150, 60), p(150, 150), p(128, 163)],
      [p(20, 150), p(100, 150), p(100, 164)],
    ],
    income: G.income.sanayi,
    waves: G.waves.sanayi,
    car: 'norda_arlo',
    bike: 'yamaha_mt09',
  },
  {
    id: 'docks',
    name: 'Liman (Docks)',
    gang: 'Liman Baronları',
    color: '#3b82f6',
    box: { minX: 722, maxX: 1052, minZ: 150, maxZ: 262 },
    venue: venue('Baronlar Deposu', 744, 248, 10, 6.4, 'north'),
    lanes: [
      [p(875, 70), p(875, 160), p(875, 188)],
      [p(700, 200), p(730, 200), p(730, 236), p(748, 236)],
      [p(875, 70), p(875, 160), p(930, 186)],
    ],
    income: G.income.docks,
    waves: G.waves.docks,
    car: 'granforge_ridgeback',
    bike: 'ktm_duke390',
  },
  {
    id: 'downtown',
    name: 'Downtown',
    gang: 'Kızıl Eller',
    color: '#ef4444',
    box: { minX: -62, maxX: 62, minZ: -62, maxZ: 62 },
    venue: venue('Kızıl Kulüp', 30, 30, 10, 6.4, 'north'),
    lanes: [
      [p(130, 50), p(36, 50)],
      [p(-70, 50), p(22, 50)],
      [p(50, -60), p(50, 22)],
    ],
    income: G.income.downtown,
    waves: G.waves.downtown,
    car: 'apexon_strix',
    bike: 'yamaha_mt09',
  },
  {
    id: 'touge',
    name: 'Touge',
    gang: 'Dağ Akrepleri',
    color: '#facc15',
    box: { minX: 714, maxX: 1040, minZ: -262, maxZ: -128 },
    venue: venue('Akrep Garajı', 790, -252, 10, 6.4, 'south'),
    lanes: [
      [p(700, -150), p(700, -236), p(778, -236)],
      [p(846, -236), p(804, -236)],
    ],
    income: G.income.touge,
    waves: G.waves.touge,
    car: 'velora_serene',
    bike: 'yamaha_tracer7',
  },
];

export function findZone(id: string): GangZone | undefined {
  return GANG_ZONES.find((z) => z.id === id);
}

/** The zone a point is in. */
export function zoneOf(x: number, z: number): GangZone | undefined {
  return GANG_ZONES.find((g) => x >= g.box.minX && x <= g.box.maxX && z >= g.box.minZ && z <= g.box.maxZ);
}

/** Distance from a point to a zone (0 inside). */
export function distToZone(g: GangZone, x: number, z: number): number {
  const dx = Math.max(g.box.minX - x, 0, x - g.box.maxX);
  const dz = Math.max(g.box.minZ - z, 0, z - g.box.maxZ);
  return Math.hypot(dx, dz);
}

/** The hangouts as buildings (world.ts adds them to the city). */
export const GANG_VENUE_BOXES = GANG_ZONES.map((g) => ({ id: `gang_${g.id}`, box: g.venue.box, facing: g.venue.facing, sign: g.venue.name.toUpperCase(), color: g.color }));

/** Where the members stand round the hangout (idle). */
export function hangoutSpots(g: GangZone): { x: number; z: number; rot: number }[] {
  const d = g.venue.door;
  const fx = Math.sin(d.rot + Math.PI);
  const fz = Math.cos(d.rot + Math.PI);
  // In front of the door, facing out (towards the street).
  return [-2.4, 0, 2.4].map((s, i) => ({ x: d.x + fx * (2.2 + (i % 2) * 1.2) + Math.cos(d.rot) * s, z: d.z + fz * (2.2 + (i % 2) * 1.2) - Math.sin(d.rot) * s, rot: d.rot + Math.PI }));
}

/** Cars and bikes in a wave (by wave index; the last entry repeats). */
export function waveMix(wave: number): { cars: number; bikes: number } {
  const w = G.waveMix[Math.min(wave, G.waveMix.length - 1)]!;
  return { cars: w[0], bikes: w[1] };
}

/** How many armed members a wave brings (two a car, one a bike). */
export function waveSize(wave: number): number {
  const m = waveMix(wave);
  return m.cars * 2 + m.bikes;
}

// ------------------------------------------------------------------ what is sent

export interface GangZoneView {
  id: GangZoneId;
  /** The player who holds it (null: the gang's). */
  owner: string | null;
  ownerName: string | null;
  /** The holder's dominance 0-100 (a war in progress: how far the attacker has got; under attack: falling). */
  dominance: number;
  /** A turf war going on here. */
  war: boolean;
  /** The gang is hitting back: the owner must get there by then (ms). */
  attackUntil: number | null;
}

export interface TurfWarView {
  zone: GangZoneId;
  /** 'war': taking it; 'defend': beating off a retaliation. */
  kind: 'war' | 'defend';
  wave: number;
  waves: number;
  /** Members of this wave still up, and in it at all. */
  left: number;
  total: number;
  /** Next wave on its way (ms), between waves. */
  nextAt: number | null;
  /** Out of the zone: lost at this time (ms). */
  leaveAt: number | null;
  /** The last thing that happened (banner). */
  text: string;
}

export interface GangCarView {
  id: string;
  zone: GangZoneId;
  modelId: string;
  color: string;
  x: number;
  z: number;
  rot: number;
  speed: number;
}

/** The player's own gang business: zones held, the cash box at Emlak Dünyası, how it pays. */
export interface GangMine {
  zones: GangZoneId[];
  cash: number;
  mode: 'bank' | 'cash';
  /** When the next protection money comes (ms). */
  nextIncomeAt: number | null;
}

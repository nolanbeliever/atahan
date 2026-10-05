// Heists (Soygunlar): seven targets, each with a door where the job is done. Press E at the door:
// the police hear about it straight away (the wanted level jumps), and you have to stay at the door
// while the safe is drilled or the system hacked (1-2 minutes; step away to fight and the work
// stops). Done: the loot ($20,000-$80,000) is in the bag, but it is only yours once you have lost
// the police (busted: they take it; wasted: it is gone). Then it is dirty money (Kara Para).
//
// Police cars can't get at the doors: the jeweller, the office, the supermarket and the estate
// agent are robbed through their back doors in the bike-only back alleys, and the bank, the casino
// and the hypercar showroom have security forecourts ringed with steel bollards (bikes get through
// the gaps). The officers come on foot. The showroom job is a car heist: once the security is
// hacked a hypercar is waiting outside the bollards; drive it to the docks to collect.

import { ECONOMY } from './economy.config';
import { ALLEYS, BOLLARD_R, alleyPoint } from './alleys';
import type { AABB, Building, Circle } from './world';

export type HeistId = 'bank' | 'casino' | 'jeweler' | 'office' | 'supermarket' | 'realestate' | 'dealership';

export interface Heist {
  id: HeistId;
  /** The target, and the headline when it starts. */
  name: string;
  title: string;
  /** What is going on at the door while you wait. */
  task: string;
  /** Laptop (hack) or drill (safe). */
  tool: 'laptop' | 'drill';
  /** Where you stand to do the job, facing the door (`rot`), and the door itself on the wall. */
  stand: { x: number; z: number; rot: number };
  door: { x: number; z: number };
  /** Height of the floor at the door (the raised courtyard in the Wrench Bros alley). */
  floor: number;
  /** Seconds of work, wanted stars straight away, the loot range. */
  workSec: number;
  stars: number;
  loot: [number, number];
}

const H = ECONOMY.heists;

/** A back door on an alley wall: along the alley, on which wall. */
function backDoor(alleyId: string, along: number, side: -1 | 1): { stand: Heist['stand']; door: Heist['door']; floor: number } {
  const a = ALLEYS.find((x) => x.id === alleyId)!;
  const stand = alleyPoint(a, along, side * (2.5 - 1.25));
  const door = alleyPoint(a, along, side * 2.5);
  // Facing the wall.
  const rot = Math.atan2(door.x - stand.x, door.z - stand.z);
  const s = a.stairs;
  const floor = s && along > s.top && along < s.down ? s.rise : 0;
  return { stand: { ...stand, rot }, door, floor };
}

/** The casino on the far shore, north of the boulevard past the classic-car showroom. */
export const CASINO_BOX: AABB = { minX: 946, maxX: 1034, minZ: -26, maxZ: 14 };

export const HEISTS: Heist[] = [
  {
    id: 'bank',
    name: 'GetRich Bankası',
    title: 'BANKA SOYGUNU',
    task: 'Kasa dairesinin kapısı deliniyor',
    tool: 'drill',
    stand: { x: -127.3, z: -24, rot: Math.PI / 2 },
    door: { x: -126, z: -24 },
    floor: 0,
    ...H.targets.bank,
  },
  {
    id: 'casino',
    name: 'Golden Palace Casino',
    title: 'KUMARHANE SOYGUNU',
    task: 'Kasa dairesinin güvenlik sistemi hackleniyor',
    tool: 'laptop',
    stand: { x: 990, z: 15.3, rot: Math.PI },
    door: { x: 990, z: 14 },
    floor: 0,
    ...H.targets.casino,
  },
  { id: 'jeweler', name: 'Kuyumcu Altınsaray', title: 'KUYUMCU SOYGUNU', task: 'Arka kapıdaki kasa deliniyor', tool: 'drill', ...backDoor('wrench', 88, 1), ...H.targets.jeweler },
  { id: 'office', name: 'Atlas Ofis Plaza', title: 'OFİS SOYGUNU', task: 'Muhasebe sunucusu hackleniyor', tool: 'laptop', ...backDoor('wrench', 100, -1), ...H.targets.office },
  { id: 'supermarket', name: 'Mega Market 7/24', title: 'MARKET SOYGUNU', task: 'Günlük hasılat kasası açılıyor', tool: 'drill', ...backDoor('auction', 93, 1), ...H.targets.supermarket },
  { id: 'realestate', name: 'Emlak Dünyası', title: 'EMLAKÇI SOYGUNU', task: 'Kapora kasası açılıyor', tool: 'drill', ...backDoor('chroma', 68, 1), ...H.targets.realestate },
  {
    id: 'dealership',
    name: 'Hyper Garage · Galeri',
    title: 'GALERİ SOYGUNU',
    task: 'Galerinin immobilizer sistemi hackleniyor',
    tool: 'laptop',
    stand: { x: 850, z: -11.3, rot: 0 },
    door: { x: 850, z: -10 },
    floor: 0,
    ...H.targets.dealership,
  },
];

export function findHeist(id: string): Heist | undefined {
  return HEISTS.find((h) => h.id === id);
}

/** The getaway car of the showroom job waits here, and is delivered here (the docks). */
export const HEIST_CAR_SPAWN = { x: 850, z: -27, rot: Math.PI / 2 };
export const HEIST_DROP = { x: 875, z: 166, radius: 9 };

// ---------------------------------------------------------------- security forecourts

/** A forecourt in front of a door: a rectangle against the building, bollards along its three open sides. */
interface Forecourt {
  box: AABB;
  /** The side against the building. */
  wall: 'north' | 'south' | 'east' | 'west';
}

const FORECOURTS: Forecourt[] = [
  { box: { minX: -137, maxX: -126, minZ: -33, maxZ: -15 }, wall: 'east' },
  { box: { minX: 975, maxX: 1005, minZ: 14, maxZ: 26 }, wall: 'north' },
  { box: { minX: 838, maxX: 862, minZ: -21, maxZ: -10 }, wall: 'south' },
];

/** Bollard spacing along a forecourt line (centre to centre): gaps of about 1.36 m. */
const SPACING = 1.6;

/** The open sides of a forecourt as segments. */
function forecourtLines(f: Forecourt): [number, number, number, number][] {
  const { minX, maxX, minZ, maxZ } = f.box;
  const all: Record<Forecourt['wall'], [number, number, number, number]> = {
    north: [minX, minZ, maxX, minZ],
    south: [minX, maxZ, maxX, maxZ],
    west: [minX, minZ, minX, maxZ],
    east: [maxX, minZ, maxX, maxZ],
  };
  return (Object.keys(all) as Forecourt['wall'][]).filter((k) => k !== f.wall).map((k) => all[k]);
}

/** The steel bollards round the forecourts (solid for everyone). */
export const SECURITY_BOLLARDS: Circle[] = FORECOURTS.flatMap((f) =>
  forecourtLines(f).flatMap(([x0, z0, x1, z1]) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(len / SPACING);
    return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, r: BOLLARD_R }));
  }),
);

/** Invisible gates along the bollard lines that only cars meet (bikes and ATVs get through the gaps). */
export const SECURITY_GATES: AABB[] = FORECOURTS.flatMap((f) =>
  forecourtLines(f).map(([x0, z0, x1, z1]) => ({ minX: Math.min(x0, x1) - 0.3, maxX: Math.max(x0, x1) + 0.3, minZ: Math.min(z0, z1) - 0.3, maxZ: Math.max(z0, z1) + 0.3 })),
);

/** The forecourts themselves (police cars stay out; the renderer paves them). */
export const SECURITY_FORECOURTS: readonly AABB[] = FORECOURTS.map((f) => f.box);

/** The casino building (drawn and solid like the city's other buildings). */
export const CASINO_BUILDING: Building = {
  id: 'casino',
  box: CASINO_BOX,
  height: 20,
  color: '#2b0f3a',
  kind: 'service',
  facing: 'south',
  sign: 'GOLDEN PALACE CASINO',
  signColor: '#ffc53d',
};

// ---------------------------------------------------------------- what the client is told

/** The player's heist as it stands. */
export interface HeistView {
  id: HeistId;
  title: string;
  task: string;
  /** work: at the door; drive: take the getaway car to the docks; escape: loot in the bag, lose the police. */
  phase: 'work' | 'drive' | 'escape';
  /** Share of the work done (0-1) and seconds of work left. */
  progress: number;
  left: number;
  /** Someone of the crew is at the door (the work goes on). */
  atDoor: boolean;
  /** The loot in the bag (escape phase). */
  loot: number;
  /** Seconds until the first police cars get there (while they're on the way). */
  policeIn?: number;
  /** Showroom job: the drop and when the buyer leaves (ms). */
  drop?: { x: number; z: number; until: number };
  carId?: string;
}

/** Roll the loot of a job: within the target's range, to the nearest $100. */
export function rollLoot(h: Heist, rand: number): number {
  const [lo, hi] = h.loot;
  return Math.round((lo + (hi - lo) * Math.max(0, Math.min(1, rand))) / 100) * 100;
}

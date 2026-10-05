// The docks at night (Liman): containers to cut open, bulk imports, and the police trap.
//
// Between 23:00 and 05:00 six containers standing on their own in the yard's lanes can be robbed:
// a green lamp on the door (red by day, or once done). E at the door: the angle grinder (hold to
// cut, let go before the blade overheats) through the locking bars, the heavy doors swing open and
// what's inside is yours: a hypercar, an arms crate (Micro-Uzi, sniper rifle, C4, body armour) or
// bulk goods.
//
// On the phone, "Toplu İthalat (Bulk Logistics)": $100,000+ orders that come in by ship; the
// container number and where it stands arrive on Telegram. A hypercar or an arms crate is opened on
// the spot; bulk goods have to be loaded onto your own flatbed truck by the gantry crane and hauled
// to your depot.
//
// A cut or an order has a 25% chance that somebody talked: 5 s after the radio says "Bölgeye tüm
// birimler intikal etsin, hedef kapanda" the floodlights come on, the sirens wail, SWAT vans and
// barricades shut the gates, 4 stars at once, the helicopter, SWAT officers in cover among the
// containers. Out by hypercar, or ram the barricades with the truck.

import { ECONOMY } from './economy.config';
import { gameHour } from './environment';
import { DOCKS, DOCKS_GATE, DOCKS_ROAD, LIGHT_TOWERS } from './farShore';

const D = ECONOMY.docks;

export type ContainerLoot = 'car' | 'arms' | 'goods';

export interface DockContainer {
  id: string;
  /** Footprint (a 40 ft box lying along x), and which end the doors are (+1: east). */
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  doorSide: 1 | -1;
  color: string;
}

/** A 12 x 2.5 m container lying along x with its doors at one end. */
function c(id: string, x0: number, z0: number, doorSide: 1 | -1, color: string): DockContainer {
  return { id, box: { minX: x0, maxX: x0 + 12.2, minZ: z0, maxZ: z0 + 2.5 }, doorSide, color };
}

export const DOCK_CONTAINERS: DockContainer[] = [
  c('MSKU-101', 742, 177, 1, '#b5452f'),
  c('TGHU-214', 800, 206, 1, '#2f6db5'),
  c('CMAU-305', 960, 177, -1, '#3c8a4a'),
  c('HLXU-422', 1000, 206, -1, '#c7902e'),
  c('MSCU-517', 820, 233, 1, '#7b3fa0'),
  c('OOLU-608', 940, 233, -1, '#a63a5c'),
];

export function findContainer(id: string): DockContainer | undefined {
  return DOCK_CONTAINERS.find((k) => k.id === id);
}

/** Where you stand at the doors (outside, facing them), and the middle of the doorway. */
export function containerDoor(k: DockContainer): { x: number; z: number; rot: number; stand: { x: number; z: number } } {
  const x = k.doorSide > 0 ? k.box.maxX : k.box.minX;
  const z = (k.box.minZ + k.box.maxZ) / 2;
  return { x, z, rot: k.doorSide > 0 ? -Math.PI / 2 : Math.PI / 2, stand: { x: x + k.doorSide * 1.4, z } };
}

/** Where the hypercar inside rolls out to (just outside the doors, nose out). */
export function containerCarSpot(k: DockContainer): { x: number; z: number; rot: number } {
  const d = containerDoor(k);
  return { x: d.x + k.doorSide * 4.2, z: d.z, rot: k.doorSide > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

/** The containers' colliders (all six stay solid; an open one's doors stand aside). */
export const DOCK_CONTAINER_BOXES = DOCK_CONTAINERS.map((k) => k.box);

// ------------------------------------------------------------------ the night window

/** Containers can be cut open between 23:00 and 05:00 (game time). */
export function docksOpen(serverTime: number, hour = gameHour(serverTime)): boolean {
  return hour >= D.fromHour || hour < D.toHour;
}

// ------------------------------------------------------------------ bulk imports

export type ImportId = 'hypercar' | 'arms' | 'goods';

export interface ImportDef {
  id: ImportId;
  name: string;
  price: number;
  /** What's in the container. */
  loot: ContainerLoot;
  text: string;
}

export const IMPORTS: ImportDef[] = [
  { id: 'hypercar', name: 'Hiper Araç (gri ithalat)', price: D.imports.hypercar, loot: 'car', text: 'Kayıtsız bir hiper araç, konteynerde seni bekler: kapıyı aç, sür çık.' },
  { id: 'arms', name: 'Silah Sandığı', price: D.imports.arms, loot: 'arms', text: 'Micro-Uzi, keskin nişancı tüfeği, C4 ve çelik yelek; mühimmatıyla.' },
  { id: 'goods', name: `Toplu Mal (${D.bulkGrams} gr)`, price: D.imports.goods, loot: 'goods', text: 'Kamyonunla (Hauler) vinçle yükle, deponuna götür.' },
];

export function findImport(id: string): ImportDef | undefined {
  return IMPORTS.find((i) => i.id === id);
}

/** Hypercars that come in containers. */
export const HYPERCARS = ['bugatti_chiron', 'lamborghini_aventador', 'ferrari_sf90'] as const;

/** Flatbeds: trucks the crane can load a container onto. */
export const FLATBED_MODELS = ['granforge_hauler'] as const;

export function isFlatbed(modelId: string): boolean {
  return (FLATBED_MODELS as readonly string[]).includes(modelId);
}

/** Where bulk goods are unloaded (your depot: the Sanayi yard's loading bay). */
export const DEPOT = { x: 140, z: 205, radius: 9, name: 'Depo · Sanayi yükleme rampası' };

// ------------------------------------------------------------------ the trap

/** The gates the police shut in an ambush: the west gate and where the docks road comes in. */
export const AMBUSH_GATES = [
  { id: 'west', name: 'Batı kapısı', x: (DOCKS_GATE.minX + DOCKS_GATE.maxX) / 2 + 2, z: (DOCKS_GATE.minZ + DOCKS_GATE.maxZ) / 2, axis: 'z' as const, half: (DOCKS_GATE.maxZ - DOCKS_GATE.minZ) / 2 },
  { id: 'north', name: 'Kuzey kapısı', x: (DOCKS_ROAD.minX + DOCKS_ROAD.maxX) / 2, z: DOCKS.minZ + 2, axis: 'x' as const, half: (DOCKS_ROAD.maxX - DOCKS_ROAD.minX) / 2 },
];

/** A barricade: concrete blocks across a gate (each one can be rammed aside). */
export interface Barricade {
  id: string;
  x: number;
  z: number;
  /** Lies across the road: along x or z. */
  axis: 'x' | 'z';
  len: number;
}

/** The blocks across each gate (2 m long each, end to end). */
export function gateBarricades(): Barricade[] {
  const out: Barricade[] = [];
  for (const g of AMBUSH_GATES) {
    const n = Math.ceil((g.half * 2) / 2.2);
    for (let i = 0; i < n; i++) {
      const off = -g.half + 1.1 + i * 2.2;
      out.push({ id: `${g.id}_${i}`, x: g.axis === 'x' ? g.x + off : g.x, z: g.axis === 'z' ? g.z + off : g.z, axis: g.axis === 'x' ? 'x' : 'z', len: 2 });
    }
  }
  return out;
}

/** The yard's floodlight towers (blazing white when the trap is sprung). */
export const LIGHT_TOWERS_FOR_TRAP = LIGHT_TOWERS;

/** Cover spots for the SWAT officers: beside the container stacks, round the yard's lanes. */
export const SWAT_COVER: { x: number; z: number }[] = [
  { x: 770, z: 196 },
  { x: 836, z: 196 },
  { x: 916, z: 196 },
  { x: 976, z: 196 },
  { x: 770, z: 204 },
  { x: 836, z: 224 },
  { x: 916, z: 224 },
  { x: 976, z: 204 },
  { x: 760, z: 232 },
  { x: 1000, z: 232 },
];

// ------------------------------------------------------------------ what is sent

export interface ContainerView {
  id: string;
  /** Green: can be cut open now. */
  ready: boolean;
  /** Doors open (done until the next night), being cut (sparks), an order waiting for someone. */
  open: boolean;
  cutting: boolean;
  orderFor: string | null;
}

export interface DocksState {
  containers: ContainerView[];
  /** The trap is sprung: floodlights, sirens, barricades (ids left standing), until (ms). */
  ambush: { until: number; barricades: string[]; playerId: string } | null;
}

/** My import orders. */
export interface ImportOrderView {
  id: string;
  kind: ImportId;
  name: string;
  /** 'ship': on its way; 'ready': in its container; 'loaded': on my truck; 'done'. */
  status: 'ship' | 'ready' | 'loaded' | 'done';
  containerId: string | null;
  arriveAt: number;
}

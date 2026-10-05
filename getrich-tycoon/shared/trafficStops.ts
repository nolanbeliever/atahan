// Police checkpoints (çevirme noktaları): at the bridge approaches, the highway connectors and the
// main boulevards the police set up a stop now and then. Cones narrow the road to one lane through
// the stop, two patrol cars stand at the sides with their lights flashing, officers with torches
// wave the traffic down, and at some of them a K9 handler waits with a sniffer dog. The logic is in
// server/game/services/trafficStops.ts; values in ECONOMY.police.stops.

import { ECONOMY } from './economy.config';

export const STOPS = ECONOMY.police.stops;

/** Where a stop can be set up: the road's centre, which way it runs and how wide it is (half, m). */
export interface StopSite {
  id: string;
  name: string;
  x: number;
  z: number;
  /** The road runs along x or along z. */
  axis: 'x' | 'z';
  half: number;
}

export const STOP_SITES: StopSite[] = [
  { id: 'kuzey_giris', name: 'Kuzey Köprüsü girişi', x: 122, z: -50, axis: 'x', half: 6 },
  { id: 'guney_giris', name: 'Güney Köprüsü girişi', x: 150, z: 104, axis: 'z', half: 6 },
  { id: 'kuzey_cikis', name: 'Kuzey Köprüsü çıkışı', x: 677, z: -50, axis: 'x', half: 13 },
  { id: 'guney_cikis', name: 'Güney Köprüsü çıkışı', x: 677, z: 130, axis: 'x', half: 13 },
  { id: 'otoban_kuzey', name: 'Otoban kuzey bağlantısı', x: 50, z: -180, axis: 'z', half: 6 },
  { id: 'otoban_dogu', name: 'Otoban doğu bağlantısı', x: 180, z: 50, axis: 'x', half: 6 },
  { id: 'otoban_guney', name: 'Otoban güney bağlantısı', x: -50, z: 182, axis: 'z', half: 6 },
  { id: 'merkez_cadde', name: 'Merkez Cadde', x: 0, z: -50, axis: 'x', half: 6 },
  { id: 'galeri_bulvari', name: 'Galeri Bulvarı', x: 860, z: 40, axis: 'x', half: 7 },
];

export function findStopSite(id: string): StopSite | undefined {
  return STOP_SITES.find((s) => s.id === id);
}

/** A stop that is up now (everyone sees it). */
export interface StopView {
  id: string;
  name: string;
  x: number;
  z: number;
  axis: 'x' | 'z';
  half: number;
  /** A K9 handler and sniffer dog at this one. */
  k9: boolean;
  /** Packed up at (server ms). */
  until: number;
}

/** What a driver at a stop sees (police.stop events). */
export interface StopState {
  stopId: string;
  name: string;
  phase: 'warn' | 'check' | 'clear' | 'caught' | 'evaded' | 'uturn';
  /** The check's progress (0-1) and whether a dog is sniffing the car. */
  progress?: number;
  k9?: boolean;
  text?: string;
}

/** A point along / across a site's road (along: metres from the stop line, across: from the centre). */
export function stopPoint(s: { x: number; z: number; axis: 'x' | 'z' }, along: number, across: number): { x: number; z: number } {
  return s.axis === 'x' ? { x: s.x + along, z: s.z + across } : { x: s.x + across, z: s.z + along };
}

/** A position in a site's frame: how far along the road from the stop line and how far across. */
export function stopFrame(s: { x: number; z: number; axis: 'x' | 'z' }, x: number, z: number): { along: number; across: number } {
  return s.axis === 'x' ? { along: x - s.x, across: z - s.z } : { along: z - s.z, across: x - s.x };
}

/** Heading (rot: 0 = +z) of a car driving along the road, `dir` +1 / -1. */
export function stopHeading(s: { axis: 'x' | 'z' }, dir: number): number {
  return s.axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
}

/**
 * The cones: from the full width of the road `funnel` m out on both sides, narrowing to a lane of
 * `lane` m through the stop. Returned as [along, across] in the site's frame.
 */
export function coneLayout(half: number): [number, number][] {
  const out: [number, number][] = [];
  const lane = STOPS.lane / 2;
  const funnel = STOPS.funnel;
  for (const dir of [-1, 1]) {
    for (let a = 8; a <= funnel; a += 3.2) {
      const t = Math.min(1, (a - 8) / (funnel - 8));
      const w = lane + (half - 0.6 - lane) * t;
      for (const side of [-1, 1]) out.push([dir * a, side * w]);
    }
  }
  for (const a of [-4.5, -1.5, 1.5, 4.5]) for (const side of [-1, 1]) out.push([a, side * lane]);
  return out;
}

/** The two patrol cars: at the side of the road just before and after the stop line. */
export function stopCars(half: number): { along: number; across: number; dir: number }[] {
  const off = half <= 7 ? half + 1.8 : half - 2.5;
  return [
    { along: -6.5, across: off, dir: 1 },
    { along: 6.5, across: -off, dir: -1 },
  ];
}

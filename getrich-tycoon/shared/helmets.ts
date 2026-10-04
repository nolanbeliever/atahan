// Motorcycle helmets: the Moto Gear shop sells four shells and four visors. A helmet is worn on
// motorcycles and quads (riding or on the back): it takes 60% off crash damage and saves you from
// a fatal crash; without one, coming off fast is WASTED.

import { ECONOMY } from './economy.config';

export type HelmetId = 'sport' | 'premium' | 'cross' | 'custom';
export type VisorId = 'clear' | 'dark' | 'iridium' | 'gold';

export interface HelmetDef {
  id: HelmetId;
  name: string;
  price: number;
  description: string;
}

export interface VisorDef {
  id: VisorId;
  name: string;
  price: number;
  /** Visor colour and how see-through / shiny it is. */
  color: string;
  opacity: number;
  metal: number;
}

export const HELMETS: HelmetDef[] = [
  { id: 'sport', name: 'Full-Face Sport', price: 1_200, description: 'Aero shell with a rear spoiler. Light and quiet at speed.' },
  { id: 'premium', name: 'Premium Full-Face (Shoei / Arai style)', price: 3_500, description: 'Hand-laid composite shell, rounder and roomier, vents everywhere.' },
  { id: 'cross', name: 'Motocross', price: 1_500, description: 'Peak, long chin bar and goggles: made for dirt.' },
  { id: 'custom', name: 'Custom Bubble Visor', price: 2_500, description: 'Retro shell with racing stripes and a big bubble visor.' },
];

export const VISORS: VisorDef[] = [
  { id: 'clear', name: 'Clear', price: 0, color: '#cfe3f2', opacity: 0.28, metal: 0.1 },
  { id: 'dark', name: 'Dark Tint', price: 150, color: '#0c0d10', opacity: 0.85, metal: 0.4 },
  { id: 'iridium', name: 'Iridium (rainbow)', price: 400, color: '#5a3fd1', opacity: 0.9, metal: 0.9 },
  { id: 'gold', name: 'Gold Mirror', price: 600, color: '#d9a92b', opacity: 0.92, metal: 0.95 },
];

/** Helmet paint colours on offer. */
export const HELMET_COLORS = ['#e9e9e4', '#111215', '#c1121f', '#1f4fa0', '#f05a14', '#d9b235', '#2a9d8f'];

export interface CrashEvent {
  x: number;
  z: number;
  /** Who came off and how badly (0-1 of their health). */
  riders: { id: string; helmet: boolean; damage: number }[];
  kmh: number;
  flipped: boolean;
}

export const helmetItem = (id: HelmetId): string => `helmet_${id}`;
export const visorItem = (id: VisorId): string => `visor_${id}`;

export function helmet(id: string | null | undefined): HelmetDef | undefined {
  return HELMETS.find((h) => h.id === id);
}

export function visor(id: string | null | undefined): VisorDef | undefined {
  return VISORS.find((v) => v.id === id);
}

/** Visors you have: the clear one comes with every helmet. */
export function ownedVisors(inv: Record<string, number>): VisorDef[] {
  return VISORS.filter((v) => v.id === 'clear' || (inv[visorItem(v.id)] ?? 0) > 0);
}

export function ownedHelmets(inv: Record<string, number>): HelmetDef[] {
  return HELMETS.filter((h) => (inv[helmetItem(h.id)] ?? 0) > 0);
}

/**
 * Damage to a rider who comes off (crash speed in km/h): nothing below `safeKmh`, then rising with
 * speed. Without a helmet a crash at `fatalKmh` or more is fatal (all health); a helmet takes
 * `helmetCut` (60%) off.
 */
export function crashDamage(kmh: number, helmeted: boolean, hp: number): number {
  const c = ECONOMY.bikes;
  if (kmh < c.safeKmh) return 0;
  if (!helmeted && kmh >= c.fatalKmh) return hp;
  const raw = Math.round(c.crashBase + (kmh - c.safeKmh) * c.crashPerKmh);
  return Math.min(hp, helmeted ? Math.round(raw * (1 - c.helmetCut)) : raw);
}

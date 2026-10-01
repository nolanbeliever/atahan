// Number plates: every car has its own registration in the Turkish style ("34 GR 1234"); at Chroma
// Customs a player can press a custom plate with their own text.

import { ECONOMY } from './economy.config';
import type { VehicleMods } from './types';

export const PLATE_MAX = 11;
const CITY_CODES = ['34', '06', '35', '16', '07', '01', '41', '42', '27', '55'];
const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';
/** Words a plate may not show (kept short: plates are seen by everyone). */
const BLOCKED = ['AMK', 'AQ', 'OC', 'SIK', 'GOT', 'PIC', 'FUCK', 'SHIT', 'NAZI', 'KKK', 'PKK', 'ISID', 'ISIS'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The registration a car comes with (stable for its id). */
export function defaultPlate(vehicleId: string): string {
  const h = hash(vehicleId);
  const city = CITY_CODES[h % CITY_CODES.length]!;
  const a = LETTERS[(h >>> 4) % LETTERS.length]!;
  const b = LETTERS[(h >>> 9) % LETTERS.length]!;
  const n = 100 + ((h >>> 14) % 9900);
  return `${city} ${a}${b} ${n}`;
}

/** Plate text a car shows. */
export function plateText(vehicleId: string, mods: VehicleMods): string {
  return mods.plate ?? defaultPlate(vehicleId);
}

/** Tidy up typed plate text: capitals (Turkish letters mapped), single spaces. */
export function normalizePlate(raw: string): string {
  const map: Record<string, string> = { İ: 'I', I: 'I', Ş: 'S', Ğ: 'G', Ü: 'U', Ö: 'O', Ç: 'C' };
  return raw
    .toLocaleUpperCase('tr-TR')
    .replace(/[İIŞĞÜÖÇ]/g, (c) => map[c] ?? c)
    .replace(/[^A-Z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Why a plate text can't be used, or null when it can. */
export function plateProblem(text: string): string | null {
  if (text.length < 2) return 'A plate needs at least 2 characters.';
  if (text.length > PLATE_MAX) return `A plate has at most ${PLATE_MAX} characters.`;
  if (!/[A-Z0-9]/.test(text)) return 'Use letters or digits.';
  const bare = text.replace(/[^A-Z0-9]/g, '');
  if (BLOCKED.some((w) => bare.includes(w))) return 'That plate is not allowed.';
  return null;
}

export const PLATE_PRICE = (): number => ECONOMY.plates.price;

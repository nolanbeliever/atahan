// Customization catalog (original, procedurally rendered options).

import { normalizeTuning } from './tuningSystem';
import type { VehicleMods } from './types';

export interface CustomOption {
  id: string;
  label: string;
  price: number;
  /** Colour or style parameter used by the renderer. */
  value: string;
}

/** Classic one-click customization slots (the tuning garage lives in modificationsData.ts). */
export type ModSlot = Exclude<keyof VehicleMods, 'tuning'>;

export const PAINTS: CustomOption[] = [
  { id: 'paint_midnight', label: 'Midnight Black', price: 900, value: '#0b0b0f' },
  { id: 'paint_pearl', label: 'Pearl White', price: 1100, value: '#f4f1ea' },
  { id: 'paint_racing', label: 'Racing Red', price: 1000, value: '#c1121f' },
  { id: 'paint_ocean', label: 'Ocean Blue', price: 1000, value: '#1768ac' },
  { id: 'paint_lime', label: 'Toxic Lime', price: 1200, value: '#9ef01a' },
  { id: 'paint_sunset', label: 'Sunset Orange', price: 1100, value: '#ff7d00' },
  { id: 'paint_royal', label: 'Royal Purple', price: 1300, value: '#6a00f4' },
  { id: 'paint_gold', label: 'Liquid Gold', price: 2400, value: '#d4a017' },
  { id: 'paint_mint', label: 'Mint Cream', price: 1000, value: '#98e2c6' },
  { id: 'paint_graphite', label: 'Graphite', price: 900, value: '#4a4e57' },
];

export const WHEELS: CustomOption[] = [
  { id: 'wheel_stock', label: 'Stock Steel', price: 0, value: 'stock' },
  { id: 'wheel_sport', label: 'Sport 5-Spoke', price: 1400, value: 'sport' },
  { id: 'wheel_chrome', label: 'Chrome Mesh', price: 2200, value: 'chrome' },
  { id: 'wheel_black', label: 'Blackout Alloy', price: 1600, value: 'black' },
  { id: 'wheel_gold', label: 'Gold Forged', price: 3200, value: 'gold' },
];

export const TINTS: CustomOption[] = [
  { id: 'tint_none', label: 'Clear', price: 0, value: '0.25' },
  { id: 'tint_light', label: 'Light Tint', price: 250, value: '0.5' },
  { id: 'tint_dark', label: 'Dark Tint', price: 400, value: '0.75' },
  { id: 'tint_limo', label: 'Limo Tint', price: 550, value: '0.92' },
];

export const BODY_KITS: CustomOption[] = [
  { id: 'kit_none', label: 'Stock Body', price: 0, value: 'none' },
  { id: 'kit_lip', label: 'Front Lip & Skirts', price: 1500, value: 'lip' },
  { id: 'kit_spoiler', label: 'Rear Wing', price: 1800, value: 'spoiler' },
  { id: 'kit_full', label: 'Full Aero Kit', price: 4200, value: 'full' },
];

export const HEADLIGHTS: CustomOption[] = [
  { id: 'lights_halogen', label: 'Halogen', price: 0, value: '#fff4d6' },
  { id: 'lights_xenon', label: 'Xenon Blue', price: 600, value: '#cfe8ff' },
  { id: 'lights_amber', label: 'Amber Retro', price: 450, value: '#ffb347' },
  { id: 'lights_neon', label: 'Neon Green', price: 800, value: '#7dff9b' },
];

export const ACCESSORIES: CustomOption[] = [
  { id: 'acc_none', label: 'None', price: 0, value: 'none' },
  { id: 'acc_roofrack', label: 'Roof Rack', price: 500, value: 'roofrack' },
  { id: 'acc_bullbar', label: 'Bull Bar', price: 700, value: 'bullbar' },
  { id: 'acc_stripes', label: 'Racing Stripes', price: 650, value: 'stripes' },
  { id: 'acc_lightbar', label: 'LED Light Bar', price: 900, value: 'lightbar' },
];

export const MOD_CATALOG: Record<ModSlot, CustomOption[]> = {
  paint: PAINTS,
  wheels: WHEELS,
  tint: TINTS,
  bodyKit: BODY_KITS,
  headlights: HEADLIGHTS,
  accessory: ACCESSORIES,
};

export const MOD_SLOT_LABELS: Record<ModSlot, string> = {
  paint: 'Paint',
  wheels: 'Wheels',
  tint: 'Window Tint',
  bodyKit: 'Body Kit',
  headlights: 'Headlights',
  accessory: 'Accessory',
};

export const DEFAULT_MODS: VehicleMods = {
  paint: null,
  wheels: 'wheel_stock',
  tint: 'tint_none',
  bodyKit: 'kit_none',
  headlights: 'lights_halogen',
  accessory: 'acc_none',
};

const OPTION_INDEX = new Map<string, CustomOption>();
for (const list of Object.values(MOD_CATALOG)) for (const o of list) OPTION_INDEX.set(o.id, o);

export function findOption(id: string | null | undefined): CustomOption | undefined {
  return id ? OPTION_INDEX.get(id) : undefined;
}

export function isValidModOption(slot: ModSlot, id: string | null): boolean {
  if (slot === 'paint' && id === null) return true;
  if (id === null) return false;
  return MOD_CATALOG[slot].some((o) => o.id === id);
}

/** Total catalogue value of the installed modifications. */
export function modsValue(mods: VehicleMods): number {
  let total = 0;
  for (const slot of Object.keys(MOD_CATALOG) as ModSlot[]) {
    const opt = findOption(mods[slot]);
    if (opt) total += opt.price;
  }
  return total;
}

export function vehicleColor(color: string, mods: VehicleMods): string {
  return mods.tuning?.paint?.color ?? findOption(mods.paint)?.value ?? color;
}

/** Clean up stored/untrusted mods: fills missing slots and drops unknown options. */
export function normalizeMods(raw: unknown): VehicleMods {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: VehicleMods = { ...DEFAULT_MODS };
  for (const slot of Object.keys(MOD_CATALOG) as ModSlot[]) {
    const v = r[slot];
    if ((typeof v === 'string' || v === null) && isValidModOption(slot, v)) (out as unknown as Record<string, string | null>)[slot] = v;
  }
  if (r.tuning) out.tuning = normalizeTuning(r.tuning);
  return out;
}

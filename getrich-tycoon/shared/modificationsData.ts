// Tuning & modding catalogue: performance parts, body parts, paint finishes, wheels and stance.
//
// Every part has
//   - effects: how it changes the car (fractions are relative: hp 0.15 = +15% power),
//   - value:   how much it adds to the resale value, as a share of the car's stock value
//              (additive; a full Stage 3 build lands at roughly +50% to +100%, i.e. 150-200% of stock),
//   - cost:    price = base + model base price * max(rate, value * PRICE_PER_VALUE).
//              PRICE_PER_VALUE > 1 means no part adds more resale value than it costs, so
//              buy -> tune -> sell to the wholesaler or at auction always loses money. Profit comes
//              from selling a well-built car to the right customer.
// All numbers are data: tweak them here, the tuning system (tuningSystem.ts) only reads them.

export type PerfSlot = 'ecu' | 'intake' | 'induction' | 'intercooler' | 'internals' | 'camshaft' | 'fuel' | 'exhaust' | 'suspension' | 'tires' | 'brakes';
export type BodySlot = 'frontBumper' | 'rearBumper' | 'sideSkirts' | 'hood' | 'wing';
export type PaintFinish = 'gloss' | 'metallic' | 'matte' | 'chameleon';
export type RimFinish = 'silver' | 'gunmetal' | 'black' | 'bronze' | 'gold' | 'chrome' | 'white';
export type InductionKit = 'single' | 'twin' | 'twinscroll' | 'bigturbo' | 'supercharger';
export type ExhaustType = 'stock' | 'catback' | 'varex' | 'downpipe' | 'straight';

export const PERF_SLOTS: readonly PerfSlot[] = ['ecu', 'intake', 'induction', 'intercooler', 'internals', 'camshaft', 'fuel', 'exhaust', 'suspension', 'tires', 'brakes'];
export const BODY_SLOTS: readonly BodySlot[] = ['frontBumper', 'rearBumper', 'sideSkirts', 'hood', 'wing'];
export const PAINT_FINISHES: readonly PaintFinish[] = ['gloss', 'metallic', 'matte', 'chameleon'];
export const RIM_FINISHES: readonly RimFinish[] = ['silver', 'gunmetal', 'black', 'bronze', 'gold', 'chrome', 'white'];

/** Installed modifications of one vehicle (stored in `vehicle.mods.tuning`). */
export interface VehicleTuning {
  /** Installed part id per slot; a missing slot means the factory part. */
  perf: Partial<Record<PerfSlot, string>>;
  body: Partial<Record<BodySlot, string>>;
  /** Custom paint; null keeps the factory (or legacy) colour. `color2` is the flip colour of chameleon paint. */
  paint: { finish: PaintFinish; color: string; color2?: string } | null;
  /** Aftermarket wheels; null keeps the factory wheels. */
  rim: { design: string; finish: RimFinish } | null;
  /** Negative camber in degrees (0 = straight). */
  camber: number;
  /** Suspension drop in centimetres. */
  drop: number;
}

export function emptyTuning(): VehicleTuning {
  return { perf: {}, body: {}, paint: null, rim: null, camber: 0, drop: 0 };
}

export interface PartEffects {
  /** Relative power / torque gain (0.15 = +15%). */
  hp?: number;
  torque?: number;
  /** Relative top speed change. */
  topSpeed?: number;
  /** Relative launch / acceleration improvement (0.05 = 5% quicker). */
  accel?: number;
  handling?: number;
  /** Relative braking deceleration gain (shorter stopping distance). */
  braking?: number;
  /** Tyre grip: less wheelspin, quicker launches, shorter stops. */
  grip?: number;
  /** Extra rev limit (rpm). */
  redline?: number;
  /** Weight change (kg). */
  weight?: number;
  /** Engine stress multiplier (wear while driving); < 1 makes the engine tougher. */
  stress?: number;
}

export interface Requirement {
  slot: PerfSlot;
  /** Any of these part ids satisfies the requirement. */
  any: string[];
  label: string;
}

export interface TuningPart {
  id: string;
  slot: PerfSlot | BodySlot;
  name: string;
  description: string;
  /** 1 street, 2 sport, 3 race, 4 pro: badge colour in the garage. */
  level: 1 | 2 | 3 | 4;
  effects: PartEffects;
  value: number;
  cost: { base: number; rate: number };
  installSec: number;
  requires?: Requirement[];
  /** Restrict to powertrains / vehicle kinds (default: everything). */
  only?: { powertrain?: ('ice' | 'electric')[]; kind?: ('car' | 'bike')[]; forced?: boolean };
  induction?: InductionKit;
  exhaust?: ExhaustType;
  /** Chance (0-1) of pops & bangs on a throttle lift at high revs. */
  pops?: number;
  suspension?: { defaultDrop: number; maxDrop: number; maxCamber: number };
}

/** Price per unit of added resale value. Must stay above 1 (see the header). */
export const PRICE_PER_VALUE = 1.25;

const ICE = { powertrain: ['ice' as const] };
const ICE_CAR = { powertrain: ['ice' as const], kind: ['car' as const] };
const CAR = { kind: ['car' as const] };
const ALL_KITS = ['ind_single', 'ind_twin', 'ind_twinscroll', 'ind_bigturbo', 'ind_super'];

export const PERFORMANCE_PARTS: TuningPart[] = [
  // ---------------------------------------------------------------- ECU tuning (stages)
  {
    id: 'ecu_stage1', slot: 'ecu', name: 'Stage 1 - ECU Remap', level: 1,
    description: 'Software only: more boost/timing (or unlocked motor power on EVs). +15% hp, +10% top speed.',
    effects: { hp: 0.15, torque: 0.18, topSpeed: 0.1, stress: 1.1 }, value: 0.06, cost: { base: 450, rate: 0 }, installSec: 6, pops: 0.1,
  },
  {
    id: 'ecu_stage2', slot: 'ecu', name: 'Stage 2 - Downpipe + Tune', level: 2,
    description: 'Aggressive map for a free-flowing exhaust. +30% hp, +20% top speed. Needs a downpipe or straight pipe.',
    effects: { hp: 0.3, torque: 0.35, topSpeed: 0.2, stress: 1.3 }, value: 0.14, cost: { base: 900, rate: 0 }, installSec: 10, pops: 0.2,
    requires: [{ slot: 'exhaust', any: ['exh_downpipe', 'exh_straight'], label: 'Downpipe or Straight Pipe exhaust' }],
    only: ICE,
  },
  {
    id: 'ecu_stage3', slot: 'ecu', name: 'Stage 3 - Big Turbo Build', level: 4,
    description: 'Custom map for a big turbo, custom fueling and forged pistons. +60% hp, +40% top speed.',
    effects: { hp: 0.6, torque: 0.65, topSpeed: 0.4, stress: 1.6 }, value: 0.28, cost: { base: 2400, rate: 0 }, installSec: 18, pops: 0.35,
    requires: [
      { slot: 'induction', any: ALL_KITS, label: 'Turbo or supercharger kit' },
      { slot: 'internals', any: ['int_forged'], label: 'Forged pistons & rods' },
      { slot: 'fuel', any: ['fuel_hpfp'], label: 'Big injectors & HPFP' },
    ],
    only: ICE_CAR,
  },

  // ---------------------------------------------------------------- intake
  {
    id: 'intake_cai', slot: 'intake', name: 'Cold Air Intake', level: 1,
    description: 'Open cone filter with a heat shield. +5% acceleration and a loud induction sound.',
    effects: { hp: 0.03, accel: 0.05 }, value: 0.02, cost: { base: 350, rate: 0 }, installSec: 4, only: ICE,
  },

  // ---------------------------------------------------------------- forced induction
  {
    id: 'ind_single', slot: 'induction', name: 'Single Turbo Kit', level: 2, induction: 'single',
    description: 'One mid-size turbocharger. Strong mid-range once it spools.',
    effects: { weight: 18, topSpeed: 0.03, stress: 1.15 }, value: 0.1, cost: { base: 2600, rate: 0 }, installSec: 14, only: ICE_CAR, pops: 0.05,
  },
  {
    id: 'ind_twin', slot: 'induction', name: 'Twin Turbo Kit', level: 3, induction: 'twin',
    description: 'Two smaller turbos: less lag, big top end.',
    effects: { weight: 28, topSpeed: 0.04, stress: 1.2 }, value: 0.14, cost: { base: 4200, rate: 0 }, installSec: 18, only: ICE_CAR, pops: 0.05,
  },
  {
    id: 'ind_twinscroll', slot: 'induction', name: 'Twin-Scroll Turbo', level: 3, induction: 'twinscroll',
    description: 'Divided turbine housing for the quickest spool of any turbo.',
    effects: { weight: 20, topSpeed: 0.03, accel: 0.03, stress: 1.15 }, value: 0.12, cost: { base: 3400, rate: 0 }, installSec: 16, only: ICE_CAR, pops: 0.05,
  },
  {
    id: 'ind_bigturbo', slot: 'induction', name: 'Big Single Turbo', level: 4, induction: 'bigturbo',
    description: 'Huge turbo: lazy below 4000 rpm, brutal above. The heart of a Stage 3 build.',
    effects: { weight: 24, topSpeed: 0.05, accel: -0.02, stress: 1.3 }, value: 0.18, cost: { base: 5200, rate: 0 }, installSec: 20, only: ICE_CAR, pops: 0.1,
  },
  {
    id: 'ind_super', slot: 'induction', name: 'Supercharger Kit', level: 3, induction: 'supercharger',
    description: 'Belt-driven blower: instant torque from idle and that whine.',
    effects: { weight: 22, topSpeed: 0.02, accel: 0.04, stress: 1.15 }, value: 0.12, cost: { base: 4400, rate: 0 }, installSec: 16, only: ICE_CAR,
  },

  // ---------------------------------------------------------------- intercooler
  {
    id: 'ic_fmic', slot: 'intercooler', name: 'Front-Mount Intercooler', level: 2,
    description: 'Bigger core keeps intake air cool: consistent power pull after pull.',
    effects: { hp: 0.03, weight: 6 }, value: 0.03, cost: { base: 950, rate: 0 }, installSec: 8, only: { ...ICE_CAR, forced: true },
  },
  {
    id: 'ic_race', slot: 'intercooler', name: 'Race Intercooler (water-to-air)', level: 3,
    description: 'Water-to-air cooling with a separate radiator. No heat soak, ever.',
    effects: { hp: 0.05, weight: 9 }, value: 0.05, cost: { base: 1900, rate: 0 }, installSec: 12, only: { ...ICE_CAR, forced: true },
  },

  // ---------------------------------------------------------------- engine internals
  {
    id: 'int_forged', slot: 'internals', name: 'Forged Pistons & Rods', level: 3,
    description: 'Forged internals: a higher rev limit and an engine that survives big boost.',
    effects: { hp: 0.02, redline: 700, stress: 0.55 }, value: 0.08, cost: { base: 3600, rate: 0 }, installSec: 22, only: ICE,
  },
  {
    id: 'cam_stage1', slot: 'camshaft', name: 'Performance Camshafts', level: 2,
    description: 'More lift and duration: power moves up the rev range.',
    effects: { hp: 0.05, torque: -0.02, redline: 300 }, value: 0.03, cost: { base: 1200, rate: 0 }, installSec: 12, only: ICE,
  },
  {
    id: 'cam_race', slot: 'camshaft', name: 'Race Camshafts', level: 3,
    description: 'Aggressive profile: lumpy idle, screaming top end.',
    effects: { hp: 0.09, torque: -0.04, redline: 500, stress: 1.05 }, value: 0.05, cost: { base: 2300, rate: 0 }, installSec: 14, only: ICE,
  },
  {
    id: 'fuel_hpfp', slot: 'fuel', name: 'Big Injectors & HPFP', level: 2,
    description: 'High-pressure fuel pump and larger injectors: the fuel headroom big power needs.',
    effects: { hp: 0.04, torque: 0.03 }, value: 0.04, cost: { base: 1400, rate: 0 }, installSec: 10, only: ICE,
  },

  // ---------------------------------------------------------------- exhaust
  {
    id: 'exh_catback', slot: 'exhaust', name: 'Cat-Back Exhaust', level: 1, exhaust: 'catback',
    description: 'Freer-flowing rear section: deeper tone, a few crackles.',
    effects: { hp: 0.03, weight: -6 }, value: 0.02, cost: { base: 900, rate: 0 }, installSec: 6, only: ICE, pops: 0.15,
  },
  {
    id: 'exh_varex', slot: 'exhaust', name: 'Valved Exhaust (Varex-style)', level: 2, exhaust: 'varex',
    description: 'Valves stay shut at low revs and open up above 4000 rpm. Quiet or loud, your call.',
    effects: { hp: 0.04, weight: -4 }, value: 0.04, cost: { base: 1800, rate: 0 }, installSec: 8, only: ICE, pops: 0.25,
  },
  {
    id: 'exh_downpipe', slot: 'exhaust', name: 'Downpipe', level: 2, exhaust: 'downpipe',
    description: 'Replaces the restrictive first section: more turbo noise, more power. Enables Stage 2.',
    effects: { hp: 0.06, torque: 0.05 }, value: 0.03, cost: { base: 850, rate: 0 }, installSec: 8, only: ICE, pops: 0.35,
  },
  {
    id: 'exh_straight', slot: 'exhaust', name: 'Straight Pipe', level: 3, exhaust: 'straight',
    description: 'No mufflers, no cats. Maximum noise, maximum pops and bangs. Enables Stage 2.',
    effects: { hp: 0.08, torque: 0.04, weight: -12 }, value: 0.02, cost: { base: 700, rate: 0.01 }, installSec: 6, only: ICE, pops: 0.6,
  },

  // ---------------------------------------------------------------- chassis
  {
    id: 'susp_sport', slot: 'suspension', name: 'Sport Springs & Dampers', level: 1,
    description: 'Stiffer and 3 cm lower. Handling +12%.',
    effects: { handling: 0.12 }, value: 0.02, cost: { base: 750, rate: 0 }, installSec: 8,
    suspension: { defaultDrop: 3, maxDrop: 4, maxCamber: 2.5 },
  },
  {
    id: 'susp_coilover', slot: 'suspension', name: 'Coilover Kit', level: 3,
    description: 'Fully adjustable height, damping and camber. Handling +25%.',
    effects: { handling: 0.25 }, value: 0.05, cost: { base: 1900, rate: 0 }, installSec: 12,
    suspension: { defaultDrop: 4, maxDrop: 9, maxCamber: 7 },
  },
  {
    id: 'tire_semislick', slot: 'tires', name: 'Semi-Slick Tyres', level: 2,
    description: 'Track-day rubber that is still road legal: quicker 0-100, less wheelspin.',
    effects: { grip: 0.15, handling: 0.06, braking: 0.06, accel: 0.03 }, value: 0.02, cost: { base: 650, rate: 0 }, installSec: 5,
  },
  {
    id: 'tire_slick', slot: 'tires', name: 'Racing Slicks', level: 4,
    description: 'Pure grip: the best launches and stopping distances money can buy.',
    effects: { grip: 0.3, handling: 0.12, braking: 0.12, accel: 0.05, topSpeed: -0.01 }, value: 0.02, cost: { base: 1200, rate: 0.004 }, installSec: 5,
  },
  {
    id: 'brake_bbk', slot: 'brakes', name: 'Big Brake Kit (Brembo-style 6-piston)', level: 2,
    description: 'Bigger discs and six-piston calipers: shorter stops, no fade.',
    effects: { braking: 0.15, weight: 4 }, value: 0.03, cost: { base: 1500, rate: 0 }, installSec: 8,
  },
  {
    id: 'brake_ccb', slot: 'brakes', name: 'Carbon Ceramic Brakes', level: 4,
    description: 'Carbon ceramic discs: huge stopping power and less unsprung weight.',
    effects: { braking: 0.25, handling: 0.02, weight: -15 }, value: 0.06, cost: { base: 4600, rate: 0 }, installSec: 10,
  },
];

export const BODY_PARTS: TuningPart[] = [
  { id: 'fb_sport', slot: 'frontBumper', name: 'Sport Front Bumper', level: 1, description: 'Bigger intakes and a sharper chin.', effects: {}, value: 0.01, cost: { base: 600, rate: 0 }, installSec: 5, only: CAR },
  { id: 'fb_aero', slot: 'frontBumper', name: 'Aero Splitter Bumper', level: 2, description: 'Front splitter for real downforce.', effects: { handling: 0.02 }, value: 0.02, cost: { base: 1200, rate: 0 }, installSec: 6, only: CAR },
  { id: 'fb_carbon', slot: 'frontBumper', name: 'Carbon Front Lip', level: 3, description: 'Exposed carbon lip and canards.', effects: { handling: 0.02, weight: -3 }, value: 0.02, cost: { base: 1500, rate: 0 }, installSec: 5, only: CAR },
  { id: 'rb_sport', slot: 'rearBumper', name: 'Sport Rear Bumper', level: 1, description: 'Sculpted rear with a lower valance.', effects: {}, value: 0.01, cost: { base: 550, rate: 0 }, installSec: 5, only: CAR },
  { id: 'rb_diffuser', slot: 'rearBumper', name: 'Carbon Diffuser', level: 3, description: 'Race diffuser with vertical strakes.', effects: { handling: 0.02, weight: -2 }, value: 0.02, cost: { base: 1400, rate: 0 }, installSec: 6, only: CAR },
  { id: 'ss_sport', slot: 'sideSkirts', name: 'Side Skirts', level: 1, description: 'Lower, wider-looking sills.', effects: {}, value: 0.01, cost: { base: 450, rate: 0 }, installSec: 4, only: CAR },
  { id: 'ss_carbon', slot: 'sideSkirts', name: 'Carbon Side Skirts', level: 3, description: 'Carbon sill extensions with winglets.', effects: { weight: -2 }, value: 0.015, cost: { base: 1100, rate: 0 }, installSec: 5, only: CAR },
  { id: 'hood_vented', slot: 'hood', name: 'Vented Hood', level: 2, description: 'Heat extractor vents keep the engine bay cool.', effects: { hp: 0.01 }, value: 0.01, cost: { base: 700, rate: 0 }, installSec: 5, only: CAR },
  { id: 'hood_carbon', slot: 'hood', name: 'Carbon Fiber Hood', level: 3, description: 'Exposed carbon weave, 12 kg lighter than steel.', effects: { weight: -12, handling: 0.01 }, value: 0.03, cost: { base: 2200, rate: 0 }, installSec: 6, only: CAR },
  { id: 'wing_ducktail', slot: 'wing', name: 'Ducktail Spoiler', level: 1, description: 'Subtle kick on the trunk lid.', effects: { handling: 0.02 }, value: 0.01, cost: { base: 500, rate: 0 }, installSec: 4, only: CAR },
  { id: 'wing_gt', slot: 'wing', name: 'GT Wing', level: 2, description: 'Pedestal wing: grip in fast corners, a little drag.', effects: { handling: 0.06, topSpeed: -0.02 }, value: 0.02, cost: { base: 1600, rate: 0 }, installSec: 6, only: CAR },
  { id: 'wing_swan', slot: 'wing', name: 'Swan-Neck Race Wing', level: 4, description: 'Top-mounted race wing: maximum downforce.', effects: { handling: 0.08, topSpeed: -0.025 }, value: 0.03, cost: { base: 2400, rate: 0 }, installSec: 7, only: CAR },
];

export interface PaintFinishDef {
  id: PaintFinish;
  name: string;
  description: string;
  value: number;
  cost: { base: number; rate: number };
  /** Preset colours (chameleon presets are colour pairs). */
  palette: { name: string; color: string; color2?: string }[];
}

export const PAINT_FINISH_DEFS: Record<PaintFinish, PaintFinishDef> = {
  gloss: {
    id: 'gloss', name: 'Gloss', description: 'Deep solid colour under a clear coat.', value: 0, cost: { base: 900, rate: 0.01 },
    palette: [
      { name: 'Race Red', color: '#c1121f' }, { name: 'Alpine White', color: '#f2f2ee' }, { name: 'Jet Black', color: '#0b0b0f' },
      { name: 'Estoril Blue', color: '#1b58b8' }, { name: 'Sunset Orange', color: '#ff6d00' }, { name: 'Speed Yellow', color: '#ffd60a' },
      { name: 'British Green', color: '#0f5132' },
    ],
  },
  metallic: {
    id: 'metallic', name: 'Metallic', description: 'Metal flake that sparkles in the sun.', value: 0.02, cost: { base: 1400, rate: 0.015 },
    palette: [
      { name: 'Silverstone', color: '#a7adb5' }, { name: 'Midnight Blue', color: '#1b2b50' }, { name: 'Graphite Pearl', color: '#4b4f58' },
      { name: 'Royal Purple', color: '#5a2d91' }, { name: 'Champagne', color: '#b89f7a' }, { name: 'Deep Teal', color: '#0d5c63' },
      { name: 'Candy Red', color: '#8a0f1f' },
    ],
  },
  matte: {
    id: 'matte', name: 'Matte', description: 'Flat satin finish: stealthy and hard to keep clean.', value: 0.03, cost: { base: 2200, rate: 0.02 },
    palette: [
      { name: 'Matte Black', color: '#222327' }, { name: 'Battleship Grey', color: '#6c7075' }, { name: 'Frozen Blue', color: '#3f5a7a' },
      { name: 'Army Green', color: '#58663c' }, { name: 'Frozen White', color: '#e7e4dc' }, { name: 'Frozen Red', color: '#7f1d2b' },
    ],
  },
  chameleon: {
    id: 'chameleon', name: 'Chameleon', description: 'Colour-shift pigment: it changes colour with the viewing angle.', value: 0.06, cost: { base: 4000, rate: 0.03 },
    palette: [
      { name: 'Purple / Green', color: '#5b2a86', color2: '#1f9e89' },
      { name: 'Blue / Gold', color: '#1b3a9e', color2: '#d4a017' },
      { name: 'Teal / Violet', color: '#0f6d6d', color2: '#7a2d9c' },
      { name: 'Red / Gold', color: '#9b1d20', color2: '#e0a100' },
      { name: 'Indigo / Magenta', color: '#2e1760', color2: '#b31986' },
    ],
  },
};

export interface RimDesignDef {
  id: string;
  name: string;
  /** Rim design in the shared rims model (client/public/assets/models/vehicles/rims.glb, node rim_<style>). */
  style: 'mesh' | 'sixspoke' | 'turbofan' | 'multi' | 'deepdish';
  value: number;
  cost: { base: number; rate: number };
}

export const RIM_DESIGNS: RimDesignDef[] = [
  { id: 'rim_mesh', name: 'Mesh (BBS-style)', style: 'mesh', value: 0.03, cost: { base: 2200, rate: 0.005 } },
  { id: 'rim_sixspoke', name: '6-Spoke (Rays-style)', style: 'sixspoke', value: 0.03, cost: { base: 2400, rate: 0.005 } },
  { id: 'rim_turbofan', name: 'Turbofan (Rotiform-style)', style: 'turbofan', value: 0.025, cost: { base: 2000, rate: 0.005 } },
  { id: 'rim_multi', name: 'Multi-Spoke', style: 'multi', value: 0.02, cost: { base: 1500, rate: 0.004 } },
  { id: 'rim_deepdish', name: 'Deep-Dish 5-Spoke', style: 'deepdish', value: 0.02, cost: { base: 1700, rate: 0.004 } },
];

export const RIM_FINISH_DEFS: Record<RimFinish, { name: string; color: string; metal: number; rough: number }> = {
  silver: { name: 'Silver', color: '#c9ced4', metal: 0.85, rough: 0.25 },
  gunmetal: { name: 'Gunmetal', color: '#4a4f57', metal: 0.8, rough: 0.3 },
  black: { name: 'Gloss Black', color: '#16171a', metal: 0.5, rough: 0.25 },
  bronze: { name: 'Bronze', color: '#8c6a3f', metal: 0.85, rough: 0.3 },
  gold: { name: 'Gold', color: '#d4a017', metal: 1, rough: 0.2 },
  chrome: { name: 'Chrome', color: '#f2f5f8', metal: 1, rough: 0.07 },
  white: { name: 'White', color: '#eceeea', metal: 0.2, rough: 0.35 },
};

/** Changing only the finish of installed wheels. */
export const RIM_REFINISH_COST = 300;
/** Wheel alignment when camber or ride height changes. */
export const ALIGNMENT_COST = 150;

/** Stance limits without aftermarket suspension. */
export const STOCK_SUSPENSION = { defaultDrop: 0, maxDrop: 0, maxCamber: 1.5 };

export const SLOT_LABELS: Record<PerfSlot | BodySlot, string> = {
  ecu: 'ECU Tuning (Stages)',
  intake: 'Air Intake',
  induction: 'Forced Induction',
  intercooler: 'Intercooler',
  internals: 'Engine Internals',
  camshaft: 'Camshafts',
  fuel: 'Fuel System',
  exhaust: 'Exhaust',
  suspension: 'Suspension',
  tires: 'Tyres',
  brakes: 'Brakes',
  frontBumper: 'Front Bumper',
  rearBumper: 'Rear Bumper',
  sideSkirts: 'Side Skirts',
  hood: 'Hood',
  wing: 'Spoiler / Wing',
};

/** Groups for the garage UI. */
export const PERF_GROUPS: { title: string; slots: PerfSlot[] }[] = [
  { title: 'Engine & Software', slots: ['ecu', 'intake', 'induction', 'intercooler'] },
  { title: 'Engine Internals', slots: ['internals', 'camshaft', 'fuel'] },
  { title: 'Exhaust & Sound', slots: ['exhaust'] },
  { title: 'Chassis & Handling', slots: ['suspension', 'tires', 'brakes'] },
];

export const ALL_PARTS: TuningPart[] = [...PERFORMANCE_PARTS, ...BODY_PARTS];
const PART_INDEX = new Map(ALL_PARTS.map((p) => [p.id, p]));
const RIM_INDEX = new Map(RIM_DESIGNS.map((r) => [r.id, r]));

export function findPart(id: string | null | undefined): TuningPart | undefined {
  return id ? PART_INDEX.get(id) : undefined;
}

export function findRimDesign(id: string | null | undefined): RimDesignDef | undefined {
  return id ? RIM_INDEX.get(id) : undefined;
}

export function partsForSlot(slot: PerfSlot | BodySlot): TuningPart[] {
  return ALL_PARTS.filter((p) => p.slot === slot);
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

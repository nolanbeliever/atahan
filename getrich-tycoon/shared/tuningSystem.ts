// Tuning & Modding Engine: pure functions that turn a vehicle model plus its installed
// modifications into performance figures, a dyno curve, physics multipliers, prices and resale
// value. Shared by the server (authoritative) and the client (garage previews, dyno, HUD).

import {
  ALIGNMENT_COST,
  BODY_SLOTS,
  HEX_COLOR,
  PAINT_FINISHES,
  PAINT_FINISH_DEFS,
  PERF_SLOTS,
  PRICE_PER_VALUE,
  RIM_FINISHES,
  RIM_REFINISH_COST,
  SLOT_LABELS,
  STOCK_SUSPENSION,
  emptyTuning,
  findPart,
  findRimDesign,
  type BodySlot,
  type ExhaustType,
  type InductionKit,
  type PaintFinish,
  type PerfSlot,
  type RimFinish,
  type TuningPart,
  type VehicleTuning,
} from './modificationsData';
import { clamp } from './util';
import type { Aspiration, VehicleModel } from './vehicles';

// ---------------------------------------------------------------------------------------------
// Normalisation and rules
// ---------------------------------------------------------------------------------------------

const round1 = (x: number) => Math.round(x * 10) / 10;
const half = (x: number) => Math.round(x * 2) / 2;

/** Parse stored/untrusted tuning data into a clean object (unknown ids and bad values are dropped). */
export function normalizeTuning(raw: unknown): VehicleTuning {
  const t = emptyTuning();
  if (!raw || typeof raw !== 'object') return t;
  const r = raw as Record<string, unknown>;
  const perf = (r.perf && typeof r.perf === 'object' ? r.perf : {}) as Record<string, unknown>;
  for (const slot of PERF_SLOTS) {
    const p = findPart(typeof perf[slot] === 'string' ? (perf[slot] as string) : null);
    if (p && p.slot === slot) t.perf[slot] = p.id;
  }
  const body = (r.body && typeof r.body === 'object' ? r.body : {}) as Record<string, unknown>;
  for (const slot of BODY_SLOTS) {
    const p = findPart(typeof body[slot] === 'string' ? (body[slot] as string) : null);
    if (p && p.slot === slot) t.body[slot] = p.id;
  }
  const paint = r.paint as Record<string, unknown> | null | undefined;
  if (paint && typeof paint === 'object' && PAINT_FINISHES.includes(paint.finish as PaintFinish) && typeof paint.color === 'string' && HEX_COLOR.test(paint.color)) {
    t.paint = { finish: paint.finish as PaintFinish, color: paint.color.toLowerCase() };
    if (paint.finish === 'chameleon') {
      t.paint.color2 = typeof paint.color2 === 'string' && HEX_COLOR.test(paint.color2) ? paint.color2.toLowerCase() : t.paint.color;
    }
  }
  const rim = r.rim as Record<string, unknown> | null | undefined;
  if (rim && typeof rim === 'object' && findRimDesign(rim.design as string) && RIM_FINISHES.includes(rim.finish as RimFinish)) {
    t.rim = { design: rim.design as string, finish: rim.finish as RimFinish };
  }
  t.camber = typeof r.camber === 'number' && Number.isFinite(r.camber) ? clamp(half(r.camber), 0, 10) : 0;
  t.drop = typeof r.drop === 'number' && Number.isFinite(r.drop) ? clamp(half(r.drop), 0, 12) : 0;
  return t;
}

export function isElectric(model: VehicleModel): boolean {
  return model.specs.aspiration === 'electric';
}

export function isBike(model: VehicleModel): boolean {
  return model.specs.kind === 'bike';
}

/** Turbo/supercharged from the factory or with a kit installed. */
export function isForcedInduction(model: VehicleModel, tuning: VehicleTuning): boolean {
  const a = model.specs.aspiration;
  return a === 'turbo' || a === 'twin_turbo' || a === 'supercharged' || !!tuning.perf.induction;
}

/** Why a part can't be fitted to this vehicle at all (powertrain, body type), or null. */
export function partBlocked(model: VehicleModel, part: TuningPart, tuning?: VehicleTuning): string | null {
  const only = part.only;
  if (!only) return null;
  const pt = isElectric(model) ? 'electric' : 'ice';
  if (only.powertrain && !only.powertrain.includes(pt)) return pt === 'electric' ? 'Not for electric vehicles' : 'Electric vehicles only';
  if (only.kind && !only.kind.includes(model.specs.kind)) return model.specs.kind === 'bike' ? 'Not available for motorcycles' : 'Motorcycles only';
  if (only.forced && tuning && !isForcedInduction(model, tuning)) return 'Needs a turbo or supercharger';
  return null;
}

export function suspensionLimits(tuning: VehicleTuning): { defaultDrop: number; maxDrop: number; maxCamber: number } {
  return findPart(tuning.perf.suspension)?.suspension ?? STOCK_SUSPENSION;
}

/** Problems with a set of modifications (missing prerequisites, parts that don't fit). Empty = valid. */
export function tuningIssues(model: VehicleModel, tuning: VehicleTuning): string[] {
  const issues: string[] = [];
  const installed = [...Object.values(tuning.perf), ...Object.values(tuning.body)];
  for (const id of installed) {
    const part = findPart(id);
    if (!part) continue;
    const blocked = partBlocked(model, part, tuning);
    if (blocked) issues.push(`${part.name}: ${blocked.toLowerCase()}.`);
    for (const req of part.requires ?? []) {
      const have = tuning.perf[req.slot];
      if (!have || !req.any.includes(have)) issues.push(`${part.name} needs: ${req.label}.`);
    }
  }
  if (isBike(model) && (tuning.rim || tuning.camber > 0 || tuning.drop > 0)) issues.push('Motorcycles have no wheel or stance options.');
  const lim = suspensionLimits(tuning);
  if (tuning.drop > lim.maxDrop + 1e-9) issues.push(`Your suspension allows at most ${lim.maxDrop} cm of drop.`);
  if (tuning.camber > lim.maxCamber + 1e-9) issues.push(`Your suspension allows at most -${lim.maxCamber}° camber.`);
  return issues;
}

/** Remove parts that don't fit or miss a prerequisite, until the build is valid. */
export function dropInvalidParts(model: VehicleModel, tuning: VehicleTuning): VehicleTuning {
  const t = normalizeTuning(tuning);
  for (let pass = 0; pass < 6; pass++) {
    let removed = false;
    for (const group of [t.perf, t.body] as Record<string, string | undefined>[]) {
      for (const [slot, id] of Object.entries(group)) {
        const part = findPart(id);
        const missing = part?.requires?.some((r) => !r.any.includes(t.perf[r.slot] ?? ''));
        if (!part || partBlocked(model, part, t) || missing) {
          delete group[slot];
          removed = true;
        }
      }
    }
    if (!removed) break;
  }
  const lim = suspensionLimits(t);
  t.drop = Math.min(t.drop, lim.maxDrop);
  t.camber = Math.min(t.camber, lim.maxCamber);
  return t;
}

// ---------------------------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------------------------

interface InductionTraits {
  hp: number;
  tq: number;
  /** Rpm (fraction of redline) where full torque arrives. */
  spool: number;
  /** Torque available just off idle (fraction of peak). */
  low: number;
}

/** Gains relative to a naturally aspirated engine. */
const KIT_TRAITS: Record<InductionKit, InductionTraits> = {
  single: { hp: 1.3, tq: 1.4, spool: 0.4, low: 0.42 },
  twin: { hp: 1.38, tq: 1.45, spool: 0.33, low: 0.45 },
  twinscroll: { hp: 1.34, tq: 1.45, spool: 0.29, low: 0.5 },
  bigturbo: { hp: 1.45, tq: 1.5, spool: 0.52, low: 0.34 },
  supercharger: { hp: 1.28, tq: 1.42, spool: 0.22, low: 0.8 },
};

const FACTORY_TRAITS: Record<Aspiration, InductionTraits> = {
  na: { hp: 1, tq: 1, spool: 0.6, low: 0.7 },
  turbo: { hp: 1.25, tq: 1.35, spool: 0.3, low: 0.5 },
  twin_turbo: { hp: 1.32, tq: 1.42, spool: 0.27, low: 0.52 },
  supercharged: { hp: 1.25, tq: 1.38, spool: 0.2, low: 0.8 },
  electric: { hp: 1, tq: 1, spool: 0, low: 1 },
};

/** Launch traction: hp per tonne the driven wheels can put down on stock tyres. */
const TRACTION: Record<'fwd' | 'rwd' | 'awd' | 'bike', number> = { fwd: 170, rwd: 225, awd: 430, bike: 480 };

export interface SoundProfile {
  exhaust: ExhaustType;
  /** Induction noise: 'na', a kit, or the factory set-up. */
  induction: 'na' | 'electric' | InductionKit | 'factory_turbo' | 'factory_super';
  intake: boolean;
  /** 0 stock, 1 performance, 2 race camshafts. */
  cams: 0 | 1 | 2;
  /** Chance of pops & bangs on a throttle lift (0-1). */
  pops: number;
  cylinders: number;
  electric: boolean;
  bike: boolean;
}

export interface VehicleStats {
  hp: number;
  /** Nm */
  torque: number;
  /** km/h */
  topSpeed: number;
  /** 0-100 km/h, seconds */
  accel: number;
  /** 0-100 index */
  handling: number;
  /** Raw handling multiplier over the model's stock handling (physics). */
  handlingMult: number;
  /** 100-0 km/h stopping distance in metres. */
  braking: number;
  /** Share of the power the tyres can put down at launch (0-100). */
  grip: number;
  /** Launch wheelspin (0-100). */
  wheelspin: number;
  redline: number;
  weight: number;
  /** hp per tonne. */
  powerToWeight: number;
  /** Power left after three back-to-back pulls (0-1): the intercooler story. */
  heatSoak: number;
  /** Engine wear multiplier while driving (1 = stock). */
  stress: number;
  /** Suspension drop (cm) and negative camber (deg) actually applied. */
  drop: number;
  camber: number;
  sound: SoundProfile;
  /** Torque curve shape inputs for the dyno. */
  curve: { spool: number; low: number; electric: boolean };
}

function installedParts(tuning: VehicleTuning): TuningPart[] {
  const out: TuningPart[] = [];
  for (const id of [...Object.values(tuning.perf), ...Object.values(tuning.body)]) {
    const p = findPart(id);
    if (p) out.push(p);
  }
  return out;
}

function tractionPenalty(hp: number, weight: number, capacity: number): { penalty: number; excess: number } {
  const demand = hp / (weight / 1000);
  const excess = Math.max(0, demand / capacity - 1);
  return { penalty: Math.min(1.6, 1 + 0.3 * excess), excess };
}

/** A complete build can at most double the stock power, and add 45% top speed. */
export const MAX_POWER_GAIN = 2;
export const MAX_TOP_SPEED_GAIN = 1.45;

const statsCache = new Map<string, VehicleStats>();

/**
 * Performance figures of `baseCar` with `installedMods`. Pure and deterministic.
 * ECU stage gains multiply with the induction kit; the remaining bolt-ons add up.
 */
export function calculateVehicleStats(baseCar: VehicleModel, installedMods: VehicleTuning | null | undefined): VehicleStats {
  const tuning = installedMods ?? emptyTuning();
  const key = `${baseCar.id}|${JSON.stringify(tuning)}`;
  const cached = statsCache.get(key);
  if (cached) return cached;

  const s = baseCar.specs;
  const electric = isElectric(baseCar);
  const bike = isBike(baseCar);
  // Parts that can't be fitted (e.g. stale data) are ignored rather than trusted.
  const parts = installedParts(tuning).filter((p) => !partBlocked(baseCar, p));
  const ecu = parts.find((p) => p.slot === 'ecu');
  const kitPart = parts.find((p) => p.slot === 'induction');
  const kit = kitPart?.induction;
  const factory = FACTORY_TRAITS[s.aspiration];

  let hpAdd = 0;
  let tqAdd = 0;
  let top = 0;
  let accel = 0;
  let handling = 0;
  let braking = 0;
  let grip = 0;
  let redline = 0;
  let weight = 0;
  let stress = 1;
  let pops = 0;
  for (const p of parts) {
    const e = p.effects;
    if (p !== ecu) {
      hpAdd += e.hp ?? 0;
      tqAdd += e.torque ?? 0;
      top += e.topSpeed ?? 0;
    }
    accel += e.accel ?? 0;
    handling += e.handling ?? 0;
    braking += e.braking ?? 0;
    grip += e.grip ?? 0;
    redline += e.redline ?? 0;
    weight += (e.weight ?? 0) * (bike ? 0.3 : 1);
    stress *= e.stress ?? 1;
    pops += p.pops ?? 0;
  }

  let indHp = 1;
  let indTq = 1;
  let traits = factory;
  if (kit) {
    const k = KIT_TRAITS[kit];
    indHp = Math.max(1.06, k.hp / factory.hp);
    indTq = Math.max(1.06, k.tq / factory.tq);
    traits = k;
  }
  const hp = Math.round(s.hp * Math.min(MAX_POWER_GAIN, (1 + (ecu?.effects.hp ?? 0)) * indHp * (1 + hpAdd)));
  const torque = Math.round(s.torque * Math.min(MAX_POWER_GAIN + 0.1, Math.max(0.8, (1 + (ecu?.effects.torque ?? 0)) * indTq * (1 + tqAdd))));
  const mass = Math.max(s.weight * 0.8, s.weight + weight);
  const topSpeed = Math.round(s.topSpeed * clamp((1 + (ecu?.effects.topSpeed ?? 0)) * (1 + top), 0.9, MAX_TOP_SPEED_GAIN));

  // Stance: a little camber and drop help, extreme stance hurts grip.
  const lim = bike ? { maxDrop: 0, maxCamber: 0 } : suspensionLimits(tuning);
  const drop = Math.min(tuning.drop, lim.maxDrop);
  const camber = Math.min(tuning.camber, lim.maxCamber);
  const stanceHandling = (1 + 0.015 * Math.min(camber, 2.5) - 0.03 * Math.max(0, camber - 3.5)) * (1 + 0.006 * Math.min(drop, 5) - 0.012 * Math.max(0, drop - 7));
  const stanceBraking = 1 - 0.025 * Math.max(0, camber - 3.5);

  const capacity = TRACTION[bike ? 'bike' : s.drive];
  const stockTraction = tractionPenalty(s.hp, s.weight, capacity);
  const tunedTraction = tractionPenalty(hp, mass, capacity * (1 + grip));
  const powerRatio = s.hp / s.weight / (hp / mass);
  const accelTime = Math.max(1.8, s.accel * Math.pow(powerRatio, 0.7) * (tunedTraction.penalty / stockTraction.penalty) / (1 + accel));

  const handlingMult = clamp((1 + handling) * stanceHandling, 0.7, 1.7);
  const baseDecel = 8 + (baseCar.perf.brake - 8) * 0.45;
  const decel = baseDecel * clamp((1 + braking) * (1 + grip * 0.5) * stanceBraking, 0.7, 1.7);

  let heatSoak = 0.99;
  if (electric) heatSoak = 0.96;
  else if (isForcedInduction(baseCar, tuning)) {
    const ic = tuning.perf.intercooler;
    if (ic === 'ic_race') heatSoak = 0.995;
    else if (ic === 'ic_fmic') heatSoak = 0.975;
    else heatSoak = kit ? 0.86 : 0.95 - 0.02 * (ecu ? ecu.level : 0);
  }

  const exhaustPart = findPart(tuning.perf.exhaust);
  const cam = tuning.perf.camshaft;
  const stats: VehicleStats = {
    hp,
    torque,
    topSpeed,
    accel: round1(accelTime),
    handling: Math.min(100, Math.round(62 * baseCar.perf.handling * handlingMult)),
    handlingMult,
    braking: round1((27.78 * 27.78) / (2 * decel)),
    grip: Math.round(100 * Math.min(1, 1 / (1 + tunedTraction.excess))),
    wheelspin: Math.round((100 * tunedTraction.excess) / (1 + tunedTraction.excess)),
    redline: electric ? s.redline : s.redline + redline,
    weight: Math.round(mass),
    powerToWeight: Math.round(hp / (mass / 1000)),
    heatSoak,
    stress: Math.max(0.5, Math.round(stress * 100) / 100),
    drop,
    camber,
    sound: {
      exhaust: electric ? 'stock' : exhaustPart?.exhaust ?? 'stock',
      induction: electric ? 'electric' : kit ?? (s.aspiration === 'turbo' || s.aspiration === 'twin_turbo' ? 'factory_turbo' : s.aspiration === 'supercharged' ? 'factory_super' : 'na'),
      intake: !!tuning.perf.intake,
      cams: cam === 'cam_race' ? 2 : cam === 'cam_stage1' ? 1 : 0,
      pops: electric ? 0 : Math.min(0.9, pops),
      cylinders: s.cylinders,
      electric,
      bike,
    },
    curve: {
      spool: electric ? 0 : Math.min(0.75, traits.spool + (cam === 'cam_race' ? 0.08 : cam === 'cam_stage1' ? 0.04 : 0)),
      low: electric ? 1 : Math.max(0.25, traits.low - (cam === 'cam_race' ? 0.1 : cam === 'cam_stage1' ? 0.05 : 0)),
      electric,
    },
  };
  if (statsCache.size > 400) statsCache.clear();
  statsCache.set(key, stats);
  return stats;
}

export function stockStats(model: VehicleModel): VehicleStats {
  return calculateVehicleStats(model, null);
}

/** Tuning stored in a vehicle's mods (older vehicles have none). */
export function tuningOf(mods: { tuning?: VehicleTuning | null } | null | undefined): VehicleTuning {
  return mods?.tuning ?? emptyTuning();
}

/**
 * Multipliers for the game-scale physics (see physics.vehicleParams). The game world is small, so
 * physics speeds are compressed; tuning scales them by the same ratios as the real figures.
 */
export function performanceFactors(model: VehicleModel, tuning: VehicleTuning | null | undefined): { topSpeed: number; accel: number; brake: number; grip: number } {
  if (!tuning) return { topSpeed: 1, accel: 1, brake: 1, grip: 1 };
  const stock = stockStats(model);
  const t = calculateVehicleStats(model, tuning);
  return {
    topSpeed: clamp(t.topSpeed / stock.topSpeed, 0.85, MAX_TOP_SPEED_GAIN),
    accel: clamp((stock.accel / t.accel) * Math.sqrt(t.heatSoak / stock.heatSoak), 0.7, 2.2),
    brake: clamp(stock.braking / t.braking, 0.7, 1.7),
    grip: clamp(t.handlingMult / stock.handlingMult, 0.7, 1.7),
  };
}

/** Speedometer scale: physics m/s -> the km/h shown to players, so top speed matches the spec. */
export function speedDisplayScale(model: VehicleModel): number {
  return model.specs.topSpeed / (model.perf.topSpeed * 3.6);
}

// ---------------------------------------------------------------------------------------------
// Dyno
// ---------------------------------------------------------------------------------------------

export interface DynoCurve {
  rpm: number[];
  hp: number[];
  torque: number[];
  peakHp: number;
  peakHpRpm: number;
  peakTorque: number;
  peakTorqueRpm: number;
  idle: number;
  redline: number;
}

const HP_PER_NM_RPM = 1 / 7121; // hp = Nm * rpm / 7121

function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Power and torque against rpm, consistent with the peak figures of `stats`. */
export function dynoCurve(stats: VehicleStats, samples = 60): DynoCurve {
  const red = stats.redline;
  const idle = stats.curve.electric ? 0 : Math.round(Math.min(1000, red * 0.13) / 50) * 50;
  const target = stats.hp / (stats.torque * HP_PER_NM_RPM); // rpm at which peak torque would make peak power
  const rpm: number[] = [];
  for (let i = 0; i < samples; i++) rpm.push(Math.round(idle + ((red - idle) * i) / (samples - 1)));

  let shape: (r: number) => number;
  if (stats.curve.electric) {
    const base = clamp(target, red * 0.15, red * 0.85);
    shape = (r) => (r <= base ? 1 : (base / r) * (r > red * 0.9 ? 1 - ((r - red * 0.9) / (red * 0.1)) * 0.08 : 1));
  } else {
    // Full boost has to arrive before the rpm where the headline torque makes the headline power.
    const spoolRpm = Math.max(idle + 400, Math.min(stats.curve.spool * red, target * 0.92));
    const low = stats.curve.low;
    const make = (plateauEnd: number, fEnd = 0.74) => (r: number) => {
      if (r <= spoolRpm) return low + (1 - low) * smooth((r - idle) / (spoolRpm - idle));
      if (r <= plateauEnd) return 1;
      return 1 - ((1 - fEnd) * (r - plateauEnd)) / Math.max(1, red - plateauEnd);
    };
    const peakPower = (f: (r: number) => number) => {
      let m = 0;
      for (let k = 0; k <= 120; k++) {
        const r = idle + ((red - idle) * k) / 120;
        m = Math.max(m, f(r) * r);
      }
      return m;
    };
    if (peakPower(make(spoolRpm)) > target) {
      // Torque-heavy engine with a high rev limit (diesel-like): torque has to fall off faster.
      let lo = 0.1;
      let hi = 0.74;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (peakPower(make(spoolRpm, mid)) < target) lo = mid;
        else hi = mid;
      }
      shape = make(spoolRpm, (lo + hi) / 2);
    } else {
      let lo = spoolRpm;
      let hi = red;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (peakPower(make(mid)) < target) lo = mid;
        else hi = mid;
      }
      shape = make((lo + hi) / 2);
    }
  }
  let torque = rpm.map((r) => stats.torque * shape(r));
  let hp = torque.map((t, i) => t * rpm[i]! * HP_PER_NM_RPM);
  // Pin the peak power exactly to the headline figure.
  const k = stats.hp / Math.max(1, ...hp);
  torque = torque.map((t) => t * k);
  hp = hp.map((p) => p * k);
  let hi = 0;
  let ti = 0;
  for (let i = 0; i < rpm.length; i++) {
    if (hp[i]! > hp[hi]!) hi = i;
    if (torque[i]! > torque[ti]!) ti = i;
  }
  return {
    rpm,
    hp: hp.map((x) => Math.round(x)),
    torque: torque.map((x) => Math.round(x)),
    peakHp: Math.round(hp[hi]!),
    peakHpRpm: rpm[hi]!,
    peakTorque: Math.round(torque[ti]!),
    peakTorqueRpm: rpm[ti]!,
    idle,
    redline: red,
  };
}

// ---------------------------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------------------------

/** Maximum resale bonus from tuning (1.0 = the car can be worth up to 200% of stock). */
export const MAX_TUNING_VALUE_BONUS = 1.0;

const priced = (model: VehicleModel, value: number, cost: { base: number; rate: number }) =>
  Math.round((cost.base + model.basePrice * Math.max(cost.rate, value * PRICE_PER_VALUE)) / 10) * 10;

export function partPrice(model: VehicleModel, part: TuningPart): number {
  return priced(model, part.value, part.cost);
}

export function paintPrice(model: VehicleModel, finish: PaintFinish): number {
  const f = PAINT_FINISH_DEFS[finish];
  return priced(model, f.value, f.cost);
}

export function rimPrice(model: VehicleModel, designId: string): number {
  const r = findRimDesign(designId);
  return r ? priced(model, r.value, r.cost) : 0;
}

/** Resale bonus (share of stock value) of everything installed, capped. */
export function tuningValueBonus(model: VehicleModel, tuning: VehicleTuning | null | undefined): number {
  if (!tuning) return 0;
  let bonus = 0;
  for (const p of installedParts(tuning)) if (!partBlocked(model, p)) bonus += p.value;
  if (tuning.paint) bonus += PAINT_FINISH_DEFS[tuning.paint.finish].value;
  if (tuning.rim) bonus += findRimDesign(tuning.rim.design)?.value ?? 0;
  return Math.min(MAX_TUNING_VALUE_BONUS, bonus);
}

/** Resale value multiplier (1 = stock). */
export function resaleMultiplier(model: VehicleModel, tuning: VehicleTuning | null | undefined): number {
  return 1 + tuningValueBonus(model, tuning);
}

/** Requested changes. `undefined` = leave as is; `null` = back to factory. */
export interface TuningChange {
  perf?: Partial<Record<PerfSlot, string | null>>;
  body?: Partial<Record<BodySlot, string | null>>;
  paint?: { finish: PaintFinish; color: string; color2?: string } | null;
  rim?: { design: string; finish: RimFinish } | null;
  camber?: number;
  drop?: number;
}

export interface TuningQuoteLine {
  label: string;
  cost: number;
  seconds: number;
}

export interface TuningQuote {
  next: VehicleTuning;
  lines: TuningQuoteLine[];
  total: number;
  /** Workshop time (parts are fitted in parallel bays). */
  seconds: number;
  /** Empty when the build is valid. */
  issues: string[];
  changed: boolean;
}

/** Price and validate a set of changes. The server charges exactly `total`. */
export function quoteTuning(model: VehicleModel, current: VehicleTuning, change: TuningChange): TuningQuote {
  const next: VehicleTuning = normalizeTuning(current);
  const lines: TuningQuoteLine[] = [];
  const issues: string[] = [];
  let changed = false;

  const applyPart = (slot: PerfSlot | BodySlot, id: string | null, into: Record<string, string | undefined>) => {
    const have = into[slot] ?? null;
    if (have === id) return;
    changed = true;
    if (id === null) {
      delete into[slot];
      lines.push({ label: `${SLOT_LABELS[slot]}: back to stock`, cost: 0, seconds: 3 });
      return;
    }
    const part = findPart(id);
    if (!part || part.slot !== slot) {
      issues.push(`Unknown part for ${SLOT_LABELS[slot]}.`);
      return;
    }
    into[slot] = id;
    lines.push({ label: part.name, cost: partPrice(model, part), seconds: part.installSec });
  };

  const prevSuspension = next.perf.suspension ?? null;
  for (const slot of PERF_SLOTS) {
    const id = change.perf?.[slot];
    if (id !== undefined) applyPart(slot, id, next.perf as Record<string, string | undefined>);
  }
  for (const slot of BODY_SLOTS) {
    const id = change.body?.[slot];
    if (id !== undefined) applyPart(slot, id, next.body as Record<string, string | undefined>);
  }

  if (change.paint !== undefined) {
    const p = change.paint;
    if (p === null) {
      if (next.paint) {
        next.paint = null;
        changed = true;
        lines.push({ label: 'Factory paint', cost: paintPrice(model, 'gloss'), seconds: 8 });
      }
    } else if (!PAINT_FINISHES.includes(p.finish) || !HEX_COLOR.test(p.color) || (p.color2 !== undefined && !HEX_COLOR.test(p.color2))) {
      issues.push('Invalid paint colour.');
    } else {
      const want = normalizeTuning({ paint: p }).paint!;
      const same = next.paint && next.paint.finish === want.finish && next.paint.color === want.color && (next.paint.color2 ?? '') === (want.color2 ?? '');
      if (!same) {
        next.paint = want;
        changed = true;
        lines.push({ label: `${PAINT_FINISH_DEFS[want.finish].name} paint ${want.color}${want.color2 ? ` / ${want.color2}` : ''}`, cost: paintPrice(model, want.finish), seconds: 10 });
      }
    }
  }

  if (change.rim !== undefined) {
    const r = change.rim;
    if (r === null) {
      if (next.rim) {
        next.rim = null;
        changed = true;
        lines.push({ label: 'Factory wheels', cost: 0, seconds: 4 });
      }
    } else if (!findRimDesign(r.design) || !RIM_FINISHES.includes(r.finish)) {
      issues.push('Invalid wheel choice.');
    } else if (!next.rim || next.rim.design !== r.design) {
      next.rim = { design: r.design, finish: r.finish };
      changed = true;
      lines.push({ label: `${findRimDesign(r.design)!.name} wheels`, cost: rimPrice(model, r.design), seconds: 6 });
    } else if (next.rim.finish !== r.finish) {
      next.rim = { design: r.design, finish: r.finish };
      changed = true;
      lines.push({ label: 'Wheel refinish', cost: RIM_REFINISH_COST, seconds: 5 });
    }
  }

  // Suspension swaps reset the ride height to the new part's default unless a drop was requested.
  const lim = suspensionLimits(next);
  const suspensionChanged = (next.perf.suspension ?? null) !== prevSuspension;
  let drop = change.drop !== undefined ? change.drop : suspensionChanged ? lim.defaultDrop : next.drop;
  let camber = change.camber !== undefined ? change.camber : next.camber;
  if (!Number.isFinite(drop) || !Number.isFinite(camber)) issues.push('Invalid stance settings.');
  drop = clamp(half(Number.isFinite(drop) ? drop : 0), 0, 12);
  camber = clamp(half(Number.isFinite(camber) ? camber : 0), 0, 10);
  if (suspensionChanged) {
    // A swapped suspension can't hold settings beyond its range: clamp silently.
    drop = Math.min(drop, lim.maxDrop);
    camber = Math.min(camber, lim.maxCamber);
  }
  if (drop !== next.drop || camber !== next.camber) {
    const manual = change.drop !== undefined || change.camber !== undefined;
    next.drop = drop;
    next.camber = camber;
    changed = true;
    if (manual && !suspensionChanged) lines.push({ label: `Alignment (drop ${drop} cm, camber -${camber}°)`, cost: ALIGNMENT_COST, seconds: 4 });
  }

  issues.push(...tuningIssues(model, next));
  const total = lines.reduce((sum, l) => sum + l.cost, 0);
  const seconds = lines.length ? Math.min(40, Math.max(...lines.map((l) => l.seconds)) + (lines.length - 1) * 1.5) : 0;
  return { next, lines, total, seconds: round1(seconds), issues: [...new Set(issues)], changed };
}

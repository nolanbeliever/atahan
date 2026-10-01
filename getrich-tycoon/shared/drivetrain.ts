// Realistic longitudinal vehicle dynamics: engine torque curve, turbo spool, gearbox with
// automatic shifting, clutch slip at launch, traction limit with weight transfer, aerodynamic
// drag (grows with the square of speed), rolling resistance, engine braking and brakes with ABS.
//
// Shared by the physics step (physics.ts), the performance figures in the garage (0-100,
// 100-200, 200-300, top speed, braking, quarter mile) and the drag strip, so the numbers a player
// reads are exactly what the car does on the road.
//
// Units: everything in here is real-world SI (m, s, kg, N). The game world is drawn smaller than
// the speedometer suggests: 1 game m/s shows as SPEED_SCALE real m/s (see KMH_PER_MS). Positions
// and lateral dynamics stay in game units (physics.ts); speeds convert at the boundary.
//
// Calibration: every catalogue car is tuned once so that the simulation reproduces its factory
// 0-100 km/h time and top speed (see `calibrate`). Tuning parts then change power, torque, weight,
// grip and aero, and the simulation shows what that does - nothing is scaled by hand.

import { ECONOMY } from './economy.config';
import { findPart, type VehicleTuning } from './modificationsData';
import { dynoCurve, rawVehicleStats, type VehicleStats } from './tuningSystem';
import { clamp } from './util';
import type { BodyStyle, VehicleModel } from './vehicles';

/** Real m/s per game m/s. */
export const SPEED_SCALE = 2.1;
/** Speedometer km/h per game m/s. */
export const KMH_PER_MS = 3.6 * SPEED_SCALE;
export const G = 9.81;
const RHO = 1.225;
const RPM_PER_RADS = 60 / (2 * Math.PI);
/** Standing quarter mile in metres. */
export const QUARTER_MILE = 402.34;

export interface TurboSpec {
  /** Peak boost on the gauge (psi). */
  maxPsi: number;
  /** How fast boost builds (1/s). */
  spool: number;
  /** Share of the torque that needs boost (lost while the turbo is still spooling). */
  share: number;
  /** Rpm where boost starts to build and where it is fully there. */
  onRpm: number;
  fullRpm: number;
  supercharger: boolean;
}

export interface Powertrain {
  mass: number;
  electric: boolean;
  bike: boolean;
  idle: number;
  redline: number;
  /** Crank torque (Nm) sampled every `rpmStep` rpm from `rpm0`. */
  tq: number[];
  rpm0: number;
  rpmStep: number;
  /** Overall ratios (gearbox x final drive), first gear first. */
  gears: number[];
  reverse: number;
  wheelR: number;
  /** Driveline efficiency (including the calibration factor). */
  eff: number;
  /** Launch traction multiplier (calibration). */
  traction: number;
  /** Drag area Cd x A (m^2) and rolling resistance coefficient. */
  cdA: number;
  crr: number;
  drive: 'fwd' | 'rwd' | 'awd';
  /** Share of the weight on the driven wheels during a hard launch (weight transfer included). */
  driven: number;
  /** Tyre friction coefficient (dry). */
  mu: number;
  /** Deceleration the brakes can produce (g) before the tyres give up. */
  brakeG: number;
  abs: boolean;
  shiftTime: number;
  /** Electronic top speed limit (real m/s); Infinity when there is none. */
  limiter: number;
  turbo: TurboSpec | null;
  launchRpm: number;
  /** Engine braking torque at the redline (Nm at the crank). */
  engineBrake: number;
  /** Extra tyre grip from aero at 80 m/s (fraction). */
  downforce: number;
  /** Lateral grip coefficient (dry): tyres, suspension, aero parts. */
  latGrip: number;
  gearbox: string;
  /** Lock-to-lock steering wheel rotation (degrees) for the cockpit view. */
  wheelTurns: number;
}

/** The part of the vehicle state the drivetrain owns (physics.VehicleDyn extends it). */
export interface DriveState {
  /** Signed speed along the heading, game m/s. */
  speed: number;
  rpm: number;
  /** -1 reverse, 1..n forward gears. */
  gear: number;
  /** Seconds left in the current gear change (drive is interrupted on upshifts). */
  shift: number;
  /** Turbo boost 0-1 (x maxPsi on the gauge). */
  boost: number;
  /** Throttle and brake pedal positions 0-1 (they move smoothly, not instantly). */
  thr: number;
  brk: number;
  /** Seconds of nitrous left (a shot burns down once fired). */
  nitro?: number;
}

export interface DriveInput {
  /** Accelerator (0-1) and brake pedal (0-1) the driver asks for. */
  throttle: number;
  brake: number;
  /** Reverse gear requested (only engages when nearly stopped). */
  reverse: boolean;
  handbrake: boolean;
  /** Surface grip (1 dry, 0.8 wet). */
  grip: number;
  /** No fuel: the engine makes no power. */
  noFuel?: boolean;
}

export interface DriveOut {
  /** Longitudinal acceleration this step (real m/s^2). */
  accel: number;
  /** Wheelspin 0-1. */
  wheelspin: number;
  abs: boolean;
  /** Wheels locked under braking (no ABS): steering stops working. */
  locked: boolean;
  /** Up (+1) or down (-1) shift this step. */
  shifted: number;
  /** Rev limiter or speed limiter cutting power. */
  limiting: boolean;
  /** A nitrous shot is burning. */
  nitro?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Building a powertrain from the catalogue
// ---------------------------------------------------------------------------------------------

/** Typical drag area (Cd x A, m^2) per body style. */
const CD_BASE: Record<BodyStyle, number> = {
  hatch: 0.66,
  sedan: 0.62,
  wagon: 0.66,
  coupe: 0.6,
  suv: 0.95,
  pickup: 1.1,
  van: 1.05,
  classic: 0.85,
  bike: 0.5,
};

interface GearboxSpec {
  n: number;
  shift: number;
  label: string;
  /** First gear's top speed as a share of the car's top speed. */
  first: number;
}

function gearboxFor(m: VehicleModel): GearboxSpec {
  const s = m.specs;
  if (s.aspiration === 'electric') return { n: 1, shift: 0, label: 'Single-speed (electric)', first: 1 };
  if (s.kind === 'bike') return { n: 6, shift: 0.07, label: '6-speed with quickshifter', first: 0.33 };
  if (m.year < 1970) return { n: 4, shift: 0.55, label: '4-speed manual', first: 0.34 };
  if (m.year < 2000) return { n: 5, shift: 0.42, label: '5-speed manual', first: 0.3 };
  if (m.category === 'sports' && m.shape.style === 'coupe') return { n: 7, shift: 0.1, label: '7-speed dual-clutch', first: 0.22 };
  if (m.year >= 2015 && (m.category === 'luxury' || m.category === 'sports' || m.category === 'suv')) return { n: 8, shift: 0.16, label: '8-speed automatic', first: 0.2 };
  if (m.category === 'truck' || m.category === 'utility') return { n: 6, shift: 0.34, label: '6-speed automatic', first: 0.25 };
  return { n: 6, shift: 0.24, label: '6-speed automatic', first: 0.25 };
}

/** Base tyre friction per category (road tyres). */
function baseMu(m: VehicleModel): number {
  if (m.specs.kind === 'bike') return 1.0;
  switch (m.category) {
    case 'sports':
      return 1.08;
    case 'luxury':
      return 1.0;
    case 'classic':
      return 0.85;
    case 'truck':
    case 'utility':
      return 0.9;
    default:
      return 0.96;
  }
}

/** Static weight on the front axle. */
function frontShare(m: VehicleModel): number {
  if (m.specs.kind === 'bike') return 0.48;
  if (m.specs.drive === 'fwd') return 0.61;
  if (m.category === 'sports' && m.shape.style === 'coupe') return 0.45;
  return 0.52;
}

/** Aero effect of body parts: drag area multiplier and downforce. */
function aeroParts(tuning: VehicleTuning | null | undefined): { drag: number; downforce: number } {
  let drag = 1;
  let downforce = 0;
  const b = tuning?.body ?? {};
  switch (b.wing) {
    case 'wing_ducktail':
      downforce += 0.03;
      break;
    case 'wing_gt':
      drag *= 1.035;
      downforce += 0.08;
      break;
    case 'wing_swan':
      drag *= 1.05;
      downforce += 0.13;
      break;
  }
  if (b.frontBumper === 'fb_aero') {
    drag *= 1.01;
    downforce += 0.03;
  } else if (b.frontBumper === 'fb_carbon') downforce += 0.02;
  if (b.rearBumper === 'rb_diffuser') downforce += 0.03;
  return { drag, downforce };
}

function turboFor(m: VehicleModel, raw: VehicleStats, tuning: VehicleTuning | null | undefined): TurboSpec | null {
  const kit = findPart(tuning?.perf.induction)?.induction;
  const a = m.specs.aspiration;
  if (a === 'electric' || (!kit && a === 'na')) return null;
  const ecu = findPart(tuning?.perf.ecu);
  const stageBoost = ecu ? [0, 3, 6, 10][ecu.level === 4 ? 3 : ecu.level] ?? 0 : 0;
  const red = raw.redline;
  const onRpm = Math.max(1200, raw.curve.spool * red * 0.45);
  const fullRpm = Math.max(onRpm + 500, raw.curve.spool * red);
  let t: Omit<TurboSpec, 'onRpm' | 'fullRpm'>;
  switch (kit ?? a) {
    case 'supercharged':
    case 'supercharger':
      t = { maxPsi: 10, spool: 14, share: 0.15, supercharger: true };
      break;
    case 'single':
      t = { maxPsi: 19, spool: 2.4, share: 0.34, supercharger: false };
      break;
    case 'twin':
      t = { maxPsi: 21, spool: 3.2, share: 0.32, supercharger: false };
      break;
    case 'twinscroll':
      t = { maxPsi: 19, spool: 4.2, share: 0.3, supercharger: false };
      break;
    case 'bigturbo':
      t = { maxPsi: 30, spool: 1.5, share: 0.42, supercharger: false };
      break;
    case 'twin_turbo':
      t = { maxPsi: 17, spool: 3.4, share: 0.3, supercharger: false };
      break;
    default:
      t = { maxPsi: 15, spool: 2.8, share: 0.3, supercharger: false };
  }
  return { ...t, maxPsi: t.maxPsi + (t.supercharger ? stageBoost / 2 : stageBoost), onRpm, fullRpm };
}

/** Crank torque (Nm) at an rpm, from the dyno curve samples. */
export function torqueAt(pt: Powertrain, rpm: number): number {
  const f = (rpm - pt.rpm0) / pt.rpmStep;
  if (f <= 0) return pt.tq[0]!;
  const i = Math.floor(f);
  if (i >= pt.tq.length - 1) return pt.tq[pt.tq.length - 1]!;
  const a = pt.tq[i]!;
  return a + (pt.tq[i + 1]! - a) * (f - i);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Boost the turbo can make at this rpm with the throttle wide open (0-1). */
export function spoolAt(t: TurboSpec, rpm: number): number {
  return t.supercharger ? 0.35 + 0.65 * smoothstep(0, t.fullRpm, rpm) : smoothstep(t.onRpm, t.fullRpm, rpm);
}

interface Calibration {
  /** Driveline efficiency factor (power-limited launches) and launch traction factor. */
  k: number;
  trac: number;
  cdA: number;
  limiter: number;
  gears: number[];
  reverse: number;
}

const calibrations = new Map<string, Calibration>();
const powertrains = new Map<string, Powertrain>();

export function tuningKey(t: VehicleTuning | null | undefined): string {
  return t ? JSON.stringify({ p: t.perf, b: t.body, c: t.camber, d: t.drop }) : '';
}

/** Powertrain of a model with installed tuning (cached; pure). */
export function powertrainFor(model: VehicleModel, tuning?: VehicleTuning | null): Powertrain {
  const key = `${model.id}|${tuningKey(tuning)}`;
  let pt = powertrains.get(key);
  if (!pt) {
    const cal = calibrate(model);
    pt = assemble(model, tuning ?? null, cal);
    if (powertrains.size > 600) powertrains.clear();
    powertrains.set(key, pt);
  }
  return pt;
}

/** Everything but the calibrated numbers, for a model and its parts. */
function assemble(model: VehicleModel, tuning: VehicleTuning | null, cal: Calibration): Powertrain {
  const raw = rawVehicleStats(model, tuning);
  const stock = tuning ? rawVehicleStats(model, null) : raw;
  const curve = dynoCurve(raw, 64);
  const bike = model.specs.kind === 'bike';
  const electric = model.specs.aspiration === 'electric';
  const gb = gearboxFor(model);
  const aero = aeroParts(tuning);
  const tyreParts = (findPart(tuning?.perf.tires)?.effects.grip ?? 0) * 0.8;
  const mu = baseMu(model) * (1 + tyreParts);
  const f = frontShare(model);
  const h = bike ? 0.36 : 0.2;
  const drive = model.specs.drive;
  const driven = bike ? 0.95 : drive === 'awd' ? 1 : drive === 'fwd' ? f / (1 + h * mu) : Math.min(0.95, (1 - f) / (1 - h * mu));
  // Brakes: catalogue braking figure, improved by brake parts / tyres (from the parts' stats).
  const brakeBase = 0.9 + (model.perf.brake - 11) * 0.035;
  const brakeParts = stock.braking / Math.max(1, raw.braking);
  const peakTq = Math.max(...curve.torque);
  const torqueTable = curve.torque.map((t) => t);
  const launchRpm = electric ? 0 : clamp(curve.peakTorqueRpm * 0.85, curve.idle + 900, raw.redline * 0.55);
  const stockLimited = Number.isFinite(cal.limiter);
  const limiterGain = clamp(raw.topSpeed / Math.max(1, stock.topSpeed), 1, 1.45);
  return {
    mass: raw.weight + (bike ? 80 : 75),
    electric,
    bike,
    idle: curve.idle || 0,
    redline: raw.redline,
    tq: torqueTable,
    rpm0: curve.rpm[0]!,
    rpmStep: (curve.rpm[curve.rpm.length - 1]! - curve.rpm[0]!) / (curve.rpm.length - 1),
    gears: cal.gears,
    reverse: cal.reverse,
    wheelR: model.shape.wheelRadius,
    eff: (electric ? 0.92 : bike ? 0.9 : drive === 'awd' ? 0.85 : 0.88) * cal.k * (1 + (raw.launchGain - 1) * 0.5),
    traction: cal.trac * raw.launchGain,
    cdA: cal.cdA * aero.drag,
    crr: bike ? 0.015 : model.category === 'truck' || model.shape.style === 'suv' ? 0.014 : 0.012,
    drive,
    driven,
    mu,
    brakeG: brakeBase * brakeParts,
    abs: bike ? model.year >= 2010 : model.year >= 1990,
    shiftTime: gb.shift,
    limiter: stockLimited ? cal.limiter * limiterGain : Infinity,
    turbo: turboFor(model, raw, tuning),
    launchRpm,
    engineBrake: peakTq * (electric ? 0.22 : 0.16),
    downforce: aero.downforce + (model.category === 'sports' ? 0.03 : 0),
    latGrip: 0.9 * model.perf.handling * raw.handlingMult * (1 + tyreParts * 0.25),
    gearbox: gb.label,
    wheelTurns: bike ? 60 : model.category === 'sports' ? 520 : model.category === 'truck' || model.category === 'utility' ? 1000 : model.year < 1975 ? 1080 : 900,
  };
}

/** Largest wheel force the engine can make at a real speed, over all gears (full throttle and boost). */
function maxDriveForce(pt: Powertrain, v: number): number {
  let best = 0;
  for (const r of pt.gears) {
    const rpm = (v / pt.wheelR) * RPM_PER_RADS * r;
    if (rpm > pt.redline * 1.001) continue;
    const f = (torqueAt(pt, Math.max(rpm, pt.idle)) * r * pt.eff) / pt.wheelR;
    if (f > best) best = f;
  }
  return best;
}

function resistance(pt: Powertrain, v: number): number {
  return 0.5 * RHO * pt.cdA * v * v + pt.crr * pt.mass * G;
}

/**
 * Tune a stock model so the simulation reproduces its factory figures: gear ratios from the top
 * speed, the drag area so power and drag balance at the top speed (or a speed limiter when the car
 * is electronically limited), and a small driveline/traction factor for the 0-100 time.
 */
function calibrate(model: VehicleModel): Calibration {
  const hit = calibrations.get(model.id);
  if (hit) return hit;
  const raw = rawVehicleStats(model, null);
  const curve = dynoCurve(raw, 64);
  const gb = gearboxFor(model);
  const vTop = model.specs.topSpeed / 3.6;
  const r = model.shape.wheelRadius;
  const electric = model.specs.aspiration === 'electric';
  const rpmTop = electric ? raw.redline * 0.96 : Math.min(raw.redline * 0.97, curve.peakHpRpm * 1.06);
  const top = ((rpmTop / RPM_PER_RADS) * r) / vTop;
  const gears: number[] = [];
  if (gb.n === 1) gears.push(top);
  else {
    const first = top / gb.first;
    for (let i = 0; i < gb.n; i++) gears.push(first * Math.pow(top / first, i / (gb.n - 1)));
  }
  const cal: Calibration = { k: 1, trac: 1, cdA: CD_BASE[model.shape.style], limiter: Infinity, gears, reverse: gears[0]! * 1.05 };
  const base = CD_BASE[model.shape.style];
  const cdMin = base * 0.7;
  const cdMax = base * 1.45;
  const solveCd = () => {
    const pt = assemble(model, null, cal);
    const cd = (2 * (maxDriveForce(pt, vTop) - pt.crr * pt.mass * G)) / (RHO * vTop * vTop);
    cal.limiter = Infinity;
    if (electric || !(cd <= cdMax)) {
      // More power than the top speed needs: the car is electronically limited.
      cal.cdA = clamp(Number.isFinite(cd) ? cd : cdMax, cdMin, cdMax);
      cal.limiter = vTop;
    } else cal.cdA = Math.max(cdMin, cd);
  };
  const t100 = () => simulateRun(assemble(model, null, cal), { stopAt: 100 / 3.6, maxT: 40 }).t100;
  /** Bisect one factor in [lo, hi] (a bigger factor = a quicker car) so the 0-100 time matches. */
  const fit = (set: (x: number) => void, lo: number, hi: number): boolean => {
    const target = model.specs.accel;
    set(hi);
    if (t100() > target) return false;
    set(lo);
    if (t100() < target) return false;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      set(mid);
      if (t100() > target) lo = mid;
      else hi = mid;
    }
    set((lo + hi) / 2);
    return true;
  };
  solveCd();
  for (let pass = 0; pass < 2; pass++) {
    // Launches are mostly about traction; only when tyres alone can't explain the factory time
    // does the driveline factor move (a little).
    cal.k = 1;
    if (!fit((x) => (cal.trac = x), 0.75, 1.8)) {
      cal.trac = clamp(cal.trac, 0.75, 1.8);
      const quick = (cal.trac = 1.8) && t100() > model.specs.accel;
      if (quick) fit((x) => (cal.k = x), 1, 1.35) || (cal.k = 1.35);
      else {
        cal.trac = 0.75;
        fit((x) => (cal.k = x), 0.6, 1) || (cal.k = 0.6);
      }
    }
    solveCd();
  }
  calibrations.set(model.id, cal);
  return cal;
}

// ---------------------------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------------------------

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/** Gear ratio in use. */
export function gearRatio(pt: Powertrain, gear: number): number {
  return gear < 0 ? pt.reverse : pt.gears[clamp(gear, 1, pt.gears.length) - 1]!;
}

/** Maximum reverse speed (real m/s). */
const REVERSE_LIMIT = 10.5;

/**
 * Share of the tyres' grip the brakes can use under ABS: better brakes (bigger discs, better
 * modulation) get closer to the limit; worn brakes and extreme camber stay further from it.
 */
export function absEfficiency(pt: Powertrain): number {
  return 0.88 + 0.1 * clamp((pt.brakeG - 0.8) / 0.4, 0, 1);
}

/**
 * Advance the drivetrain by `dt` seconds: pedals, gearbox, engine, turbo, traction, drag, brakes.
 * Mutates `st` (speed in game m/s) and returns what happened.
 */
export function driveStep(pt: Powertrain, st: DriveState, inp: DriveInput, dt: number, out: DriveOut = { accel: 0, wheelspin: 0, abs: false, locked: false, shifted: 0, limiting: false, nitro: false }): DriveOut {
  const v0 = st.speed * SPEED_SCALE;
  let v = v0;
  out.shifted = 0;
  out.abs = false;
  out.locked = false;
  out.wheelspin = 0;
  out.limiting = false;
  // Pedals move quickly but not instantly (progressive throttle and brakes).
  st.thr = approach(st.thr, inp.noFuel ? 0 : inp.throttle, dt * (inp.throttle > st.thr ? 5 : 9));
  st.brk = approach(st.brk, inp.brake, dt * (inp.brake > st.brk ? 5.5 : 10));

  // Gear selection: reverse engages only when (nearly) stopped, drive likewise.
  if (inp.reverse) {
    if (st.gear !== -1 && v < 0.6) {
      st.gear = -1;
      st.shift = 0;
    }
  } else if (st.gear < 1 && v > -0.6 && inp.throttle > 0) {
    st.gear = 1;
    st.shift = 0;
  }
  if (st.gear === 0) st.gear = 1;
  st.shift = Math.max(0, st.shift - dt);
  const n = pt.gears.length;
  const wheelRpm = (Math.abs(v) / pt.wheelR) * RPM_PER_RADS;
  if (st.gear >= 1 && st.shift === 0 && n > 1) {
    const rpmNow = wheelRpm * gearRatio(pt, st.gear);
    // Short-shift when cruising, rev it out when the throttle is floored.
    const up = pt.redline * (0.55 + 0.41 * st.thr);
    const down = pt.redline * (0.26 + 0.3 * st.thr);
    if (rpmNow > up && st.gear < n) {
      st.gear++;
      st.shift = pt.shiftTime;
      out.shifted = 1;
    } else if (st.gear > 1 && rpmNow < down && wheelRpm * gearRatio(pt, st.gear - 1) < pt.redline * 0.88) {
      // Downshifts are rev-matched: no break in drive.
      st.gear--;
      out.shifted = -1;
    }
  }
  const ratio = gearRatio(pt, st.gear);
  const engRpm = wheelRpm * ratio;

  // Engine speed: follows the wheels, with a slipping clutch at launch.
  let target = pt.electric ? engRpm : Math.max(pt.idle, engRpm);
  if (!pt.electric && st.thr > 0.05 && engRpm < pt.launchRpm) target = Math.max(target, pt.idle + (pt.launchRpm - pt.idle) * Math.min(1, st.thr * 1.3));
  st.rpm += (target - st.rpm) * Math.min(1, dt * (st.shift > 0 ? 14 : 20));
  st.rpm = Math.min(st.rpm, pt.redline * 1.02);

  // Turbo boost builds with rpm and throttle, drops at once when the throttle closes.
  const t = pt.turbo;
  if (t) {
    const want = st.thr > 0.2 ? spoolAt(t, st.rpm) * st.thr : 0;
    st.boost = approach(st.boost, want, dt * (want > st.boost ? t.spool : 6));
  }

  // Nitrous: while a shot lasts the engine makes more torque and runs past its speed limiter.
  const nos = (st.nitro ?? 0) > 0;
  if (nos) st.nitro = Math.max(0, st.nitro! - dt);
  out.nitro = nos;

  const forward = st.gear >= 1;
  const overRev = engRpm >= pt.redline;
  const overSpeed = forward ? v >= pt.limiter * (nos ? 1 + ECONOMY.nitro.limiter : 1) : -v >= REVERSE_LIMIT;
  out.limiting = st.thr > 0.05 && (overRev || overSpeed);
  let drive = 0;
  // Drive is interrupted while an upshift is in progress.
  if (st.thr > 0 && !out.limiting && st.shift === 0) {
    let tq = torqueAt(pt, Math.max(st.rpm, pt.idle)) * st.thr;
    if (t) tq *= 1 - t.share * Math.max(0, spoolAt(t, st.rpm) - st.boost);
    if (nos) tq *= 1 + ECONOMY.nitro.torque;
    drive = (tq * ratio * pt.eff) / pt.wheelR;
  }

  // Traction: the driven tyres can only push so hard (less in the wet, more with downforce).
  const vr = v / 80;
  const muEff = pt.mu * inp.grip * (1 + pt.downforce * vr * vr);
  const tracMax = muEff * pt.mass * G * pt.driven * pt.traction;
  if (drive > tracMax) {
    out.wheelspin = Math.min(1, (drive - tracMax) / tracMax);
    drive = tracMax * (1 - 0.08 * out.wheelspin);
  }

  // Resistances: drag grows with the square of speed; engine braking off throttle.
  let resist = 0.5 * RHO * pt.cdA * v * v + pt.crr * pt.mass * G;
  if (st.thr < 0.05 && st.shift === 0 && Math.abs(v) > 1) resist += (pt.engineBrake * (0.3 + (0.7 * st.rpm) / pt.redline) * ratio * pt.eff) / pt.wheelR;

  // Brakes, with ABS (or locked wheels without it). The handbrake locks the rear wheels.
  const tyreMax = muEff * pt.mass * G;
  let brake = st.brk * pt.brakeG * G * pt.mass;
  if (brake > tyreMax) {
    if (pt.abs) {
      brake = tyreMax * absEfficiency(pt);
      out.abs = true;
    } else {
      brake = tyreMax * 0.78;
      out.locked = true;
    }
  }
  if (inp.handbrake) brake = Math.min(tyreMax, brake + tyreMax * 0.4);
  resist += brake;

  v += ((forward ? drive : -drive) / pt.mass) * dt;
  const dv = (resist / pt.mass) * dt;
  if (Math.abs(v) <= dv) v = 0;
  else v -= Math.sign(v) * dv;
  st.speed = v / SPEED_SCALE;
  out.accel = (v - v0) / dt;
  return out;
}

export function newDriveState(): DriveState {
  return { speed: 0, rpm: 0, gear: 1, shift: 0, boost: 0, thr: 0, brk: 0 };
}

// ---------------------------------------------------------------------------------------------
// Performance figures
// ---------------------------------------------------------------------------------------------

export interface RunResult {
  t100: number;
  t200: number | null;
  t300: number | null;
  quarter: number;
  /** Speed at the end of the quarter mile (km/h). */
  trap: number;
  /** Time and trap speed over a given distance (real metres), if asked for. */
  dist?: { time: number; trap: number } | null;
}

/**
 * Full-throttle standing start (launch control: boost built, clutch at the launch rpm). Stops at
 * `stopAt` (real m/s) or when the car can't accelerate any more.
 */
export function simulateRun(pt: Powertrain, opts: { stopAt?: number; maxT?: number; distance?: number; grip?: number } = {}): RunResult {
  const st: DriveState = { speed: 0, rpm: pt.launchRpm || pt.idle, gear: 1, shift: 0, boost: pt.turbo ? spoolAt(pt.turbo, pt.launchRpm) : 0, thr: 1, brk: 0 };
  const dt = 1 / 240;
  const inp: DriveInput = { throttle: 1, brake: 0, reverse: false, handbrake: false, grip: opts.grip ?? 1 };
  const out: DriveOut = { accel: 0, wheelspin: 0, abs: false, locked: false, shifted: 0, limiting: false };
  const res: RunResult = { t100: 99, t200: null, t300: null, quarter: 99, trap: 0 };
  const marks = [100 / 3.6, 200 / 3.6, 300 / 3.6];
  const times: (number | null)[] = [null, null, null];
  let t = 0;
  let d = 0;
  let still = 0;
  const maxT = opts.maxT ?? 90;
  let distDone = !opts.distance;
  if (opts.distance) res.dist = null;
  while (t < maxT) {
    const v0 = st.speed * SPEED_SCALE;
    driveStep(pt, st, inp, dt, out);
    const v1 = st.speed * SPEED_SCALE;
    const d0 = d;
    d += ((v0 + v1) / 2) * dt;
    for (let i = 0; i < 3; i++) {
      if (times[i] === null && v1 >= marks[i]!) times[i] = t + (dt * (marks[i]! - v0)) / Math.max(1e-6, v1 - v0);
    }
    if (res.quarter === 99 && d >= QUARTER_MILE) {
      res.quarter = t + (dt * (QUARTER_MILE - d0)) / Math.max(1e-6, d - d0);
      res.trap = v1 * 3.6;
    }
    if (!distDone && d >= opts.distance!) {
      res.dist = { time: t + (dt * (opts.distance! - d0)) / Math.max(1e-6, d - d0), trap: v1 * 3.6 };
      distDone = true;
    }
    t += dt;
    if (opts.stopAt !== undefined && v1 >= opts.stopAt && distDone) break;
    // Top speed reached (or limiter): nothing more to measure.
    still = v1 - v0 < 0.02 * dt ? still + dt : 0;
    if (still > 1.5 && res.quarter !== 99 && distDone) break;
  }
  res.t100 = times[0] ?? 99;
  res.t200 = times[1] !== null && times[0] !== null ? times[1] - times[0] : null;
  res.t300 = times[2] !== null && times[1] !== null ? times[2] - times[1] : null;
  return res;
}

/** Top speed (real m/s): where drag and rolling resistance eat all the power, or a limiter. */
export function topSpeedOf(pt: Powertrain): number {
  let v = 5;
  while (v < 160) {
    const next = v + 0.1;
    if (next > pt.limiter) return pt.limiter;
    if (maxDriveForce(pt, next) <= resistance(pt, next)) break;
    v = next;
  }
  // Out of revs in top gear?
  const revLimited = ((pt.redline / RPM_PER_RADS) * pt.wheelR) / pt.gears[pt.gears.length - 1]!;
  return Math.min(v, revLimited, pt.limiter);
}

export interface PerfFigures {
  t100: number;
  /** 100-200 km/h (seconds); a car that can't get there shows 99. */
  t200: number;
  /** 200-300 km/h, null when the car can't reach 300. */
  t300: number | null;
  topKmh: number;
  /** 100-0 km/h stopping distance (m). */
  brake100: number;
  quarter: number;
  trap: number;
  gearbox: string;
  boostPsi: number;
}

const figuresCache = new Map<string, PerfFigures>();

/** Measured performance of a model with its parts (cached). */
export function performanceFigures(model: VehicleModel, tuning?: VehicleTuning | null): PerfFigures {
  const key = `${model.id}|${tuningKey(tuning)}`;
  const hit = figuresCache.get(key);
  if (hit) return hit;
  const pt = powertrainFor(model, tuning);
  const run = simulateRun(pt, { maxT: 75 });
  const top = topSpeedOf(pt);
  const decel = Math.min(pt.brakeG, pt.mu * (pt.abs ? absEfficiency(pt) : 0.78)) * G;
  const f: PerfFigures = {
    t100: run.t100,
    t200: run.t200 ?? 99,
    t300: run.t300,
    topKmh: top * 3.6,
    brake100: (27.78 * 27.78) / (2 * decel),
    quarter: run.quarter,
    trap: run.trap,
    gearbox: pt.gearbox,
    boostPsi: pt.turbo ? Math.round(pt.turbo.maxPsi) : 0,
  };
  if (figuresCache.size > 400) figuresCache.clear();
  figuresCache.set(key, f);
  return f;
}

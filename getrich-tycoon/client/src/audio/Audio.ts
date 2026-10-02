// Lightweight WebAudio sound system. All sounds are synthesized (no assets).
// The engine voice follows the drivetrain simulation (real rpm, gear changes, turbo boost) and the
// vehicle's tuning (see tuningSystem.SoundProfile): exhaust type, induction (turbo whistle, blow-off
// valve with compressor flutter on Stage 2/3 builds, supercharger whine), open-filter intake roar,
// cams, and pops & bangs on upshifts and throttle lifts with a valved or straight-through exhaust.
// Also: tyre screech, police sirens, car alarms, rain, and the lockpick / workshop tools.

import type { ExhaustType } from '../../../shared/modificationsData';
import type { SoundProfile } from '../../../shared/tuningSystem';

export interface EngineInput {
  driving: boolean;
  /** Physics speed (m/s) and top speed (used when no rpm is given). */
  speed: number;
  topSpeed: number;
  throttle: boolean;
  profile: SoundProfile | null;
  redline: number;
  dt: number;
  /** From the drivetrain simulation: engine rpm, gear, turbo boost (0-1), throttle pedal (0-1). */
  rpm?: number;
  gear?: number;
  boost?: number;
  pedal?: number;
  /** A gear change happened this frame: +1 upshift, -1 downshift. */
  shifted?: number;
  /** ECU stage 0-3 (Stage 2/3 turbo builds flutter on lift). */
  stage?: number;
  /** Tyres: wheelspin (0-1+), sliding sideways, locked under braking. */
  wheelspin?: number;
  sliding?: boolean;
  locked?: boolean;
}

/** How each exhaust sounds: volume, brightness, distortion and rasp. */
const EXHAUST_SOUND: Record<ExhaustType, { gain: number; cutoff: number; rpmCut: number; drive: number; rasp: number }> = {
  stock: { gain: 0.09, cutoff: 420, rpmCut: 0.08, drive: 1.5, rasp: 0.1 },
  catback: { gain: 0.12, cutoff: 620, rpmCut: 0.12, drive: 3, rasp: 0.22 },
  varex: { gain: 0.14, cutoff: 900, rpmCut: 0.14, drive: 3.5, rasp: 0.28 },
  downpipe: { gain: 0.13, cutoff: 800, rpmCut: 0.15, drive: 4, rasp: 0.32 },
  straight: { gain: 0.17, cutoff: 1300, rpmCut: 0.22, drive: 8, rasp: 0.5 },
  // Motorcycle systems: a high, sharp race tone; a deep, loose V-twin style bark; a deep bass boom.
  akrapovic: { gain: 0.16, cutoff: 1800, rpmCut: 0.26, drive: 6, rasp: 0.42 },
  vance: { gain: 0.17, cutoff: 700, rpmCut: 0.12, drive: 7, rasp: 0.55 },
  scproject: { gain: 0.18, cutoff: 520, rpmCut: 0.1, drive: 9, rasp: 0.35 },
};

/** Aftermarket motorcycle systems pop on every downshift and throttle lift. */
const BIKE_PIPES = new Set<ExhaustType>(['akrapovic', 'vance', 'scproject']);

function distortionCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 512;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export type Sfx =
  | 'click'
  | 'purchase'
  | 'notify'
  | 'error'
  | 'levelup'
  | 'coin'
  | 'door'
  | 'outbid'
  | 'nearmiss'
  | 'crash'
  | 'treeRed'
  | 'treeGreen'
  | 'foul'
  | 'pick'
  | 'strain'
  | 'snap'
  | 'unlock'
  | 'ratchet'
  | 'clunk'
  | 'lift'
  | 'reward'
  | 'nitro'
  | 'air'
  | 'empty'
  | 'hit'
  | 'wasted';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambientBus!: GainNode;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private engineShaper: WaveShaperNode | null = null;
  private shaperDrive = 2;
  private raspOsc: OscillatorNode | null = null;
  private raspGain: GainNode | null = null;
  private lumpGain: GainNode | null = null;
  private lumpLfo: OscillatorNode | null = null;
  private lumpDepth: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private intakeFilter: BiquadFilterNode | null = null;
  private intakeGain: GainNode | null = null;
  private turboFilter: BiquadFilterNode | null = null;
  private turboGain: GainNode | null = null;
  private whistle: OscillatorNode | null = null;
  private whistleGain: GainNode | null = null;
  private whine: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private rpm = 800;
  private boost = 0;
  private lastThrottle = false;
  private lastGear = 0;
  private screechFilter: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenLfo: OscillatorNode | null = null;
  private rotorGain: GainNode | null = null;
  private rotorLfo: OscillatorNode | null = null;
  private rainGain: GainNode | null = null;
  private dyno: { rpm: number; throttle: boolean; profile: SoundProfile; redline: number } | null = null;
  /** Called when the exhaust pops (to flash flames on the car). */
  onPop: ((strength: number) => void) | null = null;
  private hornTimer = 0;
  volumes = { master: 0.8, sfx: 0.9, ambient: 0.5 };

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambientBus = ctx.createGain();
    this.ambientBus.connect(this.master);
    this.applyVolumes();
    this.startAmbient();
    this.startEngine();
  }

  setVolumes(master: number, sfx: number, ambient: number): void {
    this.volumes = { master, sfx, ambient };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.ambientBus.gain.value = this.volumes.ambient * 0.5;
  }

  private startAmbient(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(lp).connect(g).connect(this.ambientBus);
    src.start();
  }

  private startEngine(): void {
    const ctx = this.ctx!;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineShaper = ctx.createWaveShaper();
    this.engineShaper.curve = distortionCurve(2);
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 20;
    this.raspOsc = ctx.createOscillator();
    this.raspOsc.type = 'sawtooth';
    this.raspOsc.frequency.value = 80;
    this.raspGain = ctx.createGain();
    this.raspGain.gain.value = 0.15;
    // Lumpy idle (race cams) modulates the engine volume.
    this.lumpGain = ctx.createGain();
    this.lumpGain.gain.value = 1;
    this.lumpLfo = ctx.createOscillator();
    this.lumpLfo.frequency.value = 4;
    this.lumpDepth = ctx.createGain();
    this.lumpDepth.gain.value = 0;
    this.lumpLfo.connect(this.lumpDepth).connect(this.lumpGain.gain);
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.engineOsc.connect(this.engineShaper);
    this.engineOsc2.connect(g2).connect(this.engineShaper);
    this.raspOsc.connect(this.raspGain).connect(this.engineShaper);
    this.engineShaper.connect(this.engineFilter).connect(this.lumpGain).connect(this.engineGain).connect(this.sfxBus);

    // Shared noise source for intake roar, turbo whoosh, blow-off valve and backfires.
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = 500;
    this.intakeFilter.Q.value = 1.2;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    noise.connect(this.intakeFilter).connect(this.intakeGain).connect(this.sfxBus);
    this.turboFilter = ctx.createBiquadFilter();
    this.turboFilter.type = 'bandpass';
    this.turboFilter.frequency.value = 3000;
    this.turboFilter.Q.value = 6;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    noise.connect(this.turboFilter).connect(this.turboGain).connect(this.sfxBus);
    noise.start();
    // Turbo whistle, supercharger whine and electric motor whine.
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistle.frequency.value = 2000;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain).connect(this.sfxBus);
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whine.frequency.value = 800;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.sfxBus);
    // Tyre screech: narrow band noise, wobbling a little.
    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 1150;
    this.screechFilter.Q.value = 5;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    noise.connect(this.screechFilter).connect(this.screechGain).connect(this.sfxBus);
    // Police siren: a wailing two-tone (an LFO sweeps the pitch).
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'sawtooth';
    this.sirenOsc.frequency.value = 900;
    this.sirenLfo = ctx.createOscillator();
    this.sirenLfo.type = 'triangle';
    this.sirenLfo.frequency.value = 0.55;
    const sweep = ctx.createGain();
    sweep.gain.value = 320;
    this.sirenLfo.connect(sweep).connect(this.sirenOsc.frequency);
    const sirenLp = ctx.createBiquadFilter();
    sirenLp.type = 'lowpass';
    sirenLp.frequency.value = 2200;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(sirenLp).connect(this.sirenGain).connect(this.sfxBus);
    // Helicopter rotor: low rumble chopped by the blade pass ("whop-whop").
    const rotorLp = ctx.createBiquadFilter();
    rotorLp.type = 'lowpass';
    rotorLp.frequency.value = 240;
    const chop = ctx.createGain();
    chop.gain.value = 0.55;
    this.rotorLfo = ctx.createOscillator();
    this.rotorLfo.type = 'square';
    this.rotorLfo.frequency.value = 11;
    const depth = ctx.createGain();
    depth.gain.value = 0.45;
    this.rotorLfo.connect(depth).connect(chop.gain);
    this.rotorGain = ctx.createGain();
    this.rotorGain.gain.value = 0;
    noise.connect(rotorLp).connect(chop).connect(this.rotorGain).connect(this.sfxBus);
    this.rotorLfo.start();
    // Rain: bright hiss on the ambient bus.
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 2400;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    noise.connect(rainHp).connect(this.rainGain).connect(this.ambientBus);
    for (const o of [this.engineOsc, this.engineOsc2, this.raspOsc, this.lumpLfo, this.whistle, this.whine, this.sirenOsc, this.sirenLfo]) o.start();
  }

  /** Police siren loudness from the distance to the nearest police car with lights on (m). */
  siren(distance: number): void {
    if (!this.ctx || !this.sirenGain) return;
    const k = Number.isFinite(distance) ? Math.max(0, 1 - distance / 140) : 0;
    this.sirenGain.gain.setTargetAtTime(0.06 * k * k, this.ctx.currentTime, 0.15);
  }

  /** Helicopter rotor loudness from the distance to the nearest helicopter (m). */
  rotor(distance: number): void {
    if (!this.ctx || !this.rotorGain) return;
    const k = Number.isFinite(distance) ? Math.max(0, 1 - distance / 260) : 0;
    this.rotorGain.gain.setTargetAtTime(0.5 * k * k, this.ctx.currentTime, 0.2);
  }

  /** Rain intensity 0-1. */
  rain(amount: number): void {
    if (!this.ctx || !this.rainGain) return;
    this.rainGain.gain.setTargetAtTime(0.16 * Math.max(0, Math.min(1, amount)), this.ctx.currentTime, 0.6);
  }

  /** Drive the engine synth from the dyno screen (null = back to normal driving). */
  setDyno(d: { rpm: number; throttle: boolean; profile: SoundProfile; redline: number } | null): void {
    this.dyno = d;
  }

  /** Update engine sound each frame. */
  engine(e: EngineInput): void {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const dyno = this.dyno;
    const profile = dyno?.profile ?? e.profile;
    const active = !!dyno || e.driving;
    const redline = dyno?.redline ?? e.redline;
    const idle = Math.min(1000, redline * 0.13);
    const throttle = dyno ? dyno.throttle : e.throttle;
    let rpm: number;
    if (dyno) rpm = dyno.rpm;
    else if (e.driving && e.rpm !== undefined) {
      // Straight from the drivetrain simulation (it shifts, slips the clutch and hits the limiter).
      this.rpm += (Math.max(idle * 0.9, e.rpm) - this.rpm) * Math.min(1, e.dt * 25);
      rpm = this.rpm;
    } else {
      // Six-speed gearbox: rpm climbs through each gear, drops at the shift.
      const frac = Math.min(1, Math.abs(e.speed) / Math.max(1, e.topSpeed));
      let target = idle;
      if (profile?.electric) target = frac * redline;
      else if (frac > 0.01) {
        const gears = 6;
        let g = 1;
        while (g < gears && frac > Math.pow(g / gears, 0.8)) g++;
        const lo = g === 1 ? 0 : Math.pow((g - 1) / gears, 0.8);
        const hi = Math.pow(g / gears, 0.8);
        target = idle + (redline - idle) * (0.32 + 0.68 * ((frac - lo) / (hi - lo)));
      } else if (throttle) target = redline * 0.55;
      this.rpm += (target - this.rpm) * Math.min(1, e.dt * (throttle ? 7 : 4));
      rpm = this.rpm;
    }
    if (!Number.isFinite(rpm)) rpm = idle;
    this.rpm = rpm;
    const cyl = Math.max(1, profile?.cylinders ?? 4);
    const fire = (rpm / 60) * (cyl / 2);
    const exhaust = profile?.exhaust ?? 'stock';
    const x = EXHAUST_SOUND[exhaust];
    const valvesOpen = exhaust !== 'varex' || rpm > 4000;
    const loud = valvesOpen ? x.gain : EXHAUST_SOUND.catback.gain * 0.8;
    const electric = !!profile?.electric;

    this.engineOsc.frequency.setTargetAtTime(Math.max(20, fire), t, 0.03);
    this.engineOsc2!.frequency.setTargetAtTime(Math.max(10, fire / 2), t, 0.03);
    this.raspOsc!.frequency.setTargetAtTime(Math.max(30, fire * 2.01), t, 0.03);
    this.raspGain!.gain.setTargetAtTime(x.rasp * (throttle ? 1 : 0.5), t, 0.05);
    if (this.shaperDrive !== x.drive) {
      this.shaperDrive = x.drive;
      this.engineShaper!.curve = distortionCurve(x.drive);
    }
    this.engineFilter.frequency.setTargetAtTime((valvesOpen ? x.cutoff : 650) + rpm * x.rpmCut + (throttle ? 250 : 0), t, 0.06);
    this.engineGain.gain.setTargetAtTime(active && !electric ? loud * (throttle ? 1.25 : 0.8) : 0, t, 0.12);
    const cams = profile?.cams ?? 0;
    this.lumpLfo!.frequency.setTargetAtTime(Math.max(2, rpm / 220), t, 0.1);
    this.lumpDepth!.gain.setTargetAtTime(active && rpm < idle * 1.6 ? cams * 0.35 : 0, t, 0.2);

    // Intake roar on throttle (loud with an open cold air intake).
    this.intakeFilter!.frequency.setTargetAtTime(300 + rpm * 0.08, t, 0.08);
    const pedal = e.pedal ?? (throttle ? 1 : 0);
    this.intakeFilter!.Q.value = profile?.intake ? 0.8 : 1.2;
    this.intakeGain!.gain.setTargetAtTime(active && pedal > 0.05 && !electric ? (profile?.intake ? 0.13 : 0.025) * pedal * (0.25 + rpm / redline) : 0, t, 0.06);

    // Boost: turbos spool with rpm under load, superchargers whine with rpm.
    const ind = profile?.induction ?? 'na';
    const turbo = ind === 'single' || ind === 'twin' || ind === 'twinscroll' || ind === 'bigturbo' || ind === 'factory_turbo';
    const spoolAt = ind === 'bigturbo' ? 0.5 : ind === 'twinscroll' ? 0.28 : 0.35;
    const prevBoost = this.boost;
    if (!dyno && e.driving && e.boost !== undefined) this.boost = turbo ? e.boost : 0;
    else {
      const boostTarget = active && turbo && throttle ? Math.max(0, Math.min(1, (rpm / redline - spoolAt * 0.6) / 0.4)) : 0;
      this.boost += (boostTarget - this.boost) * Math.min(1, e.dt * (boostTarget > this.boost ? 3 : 8));
    }
    const kitLoud = ind === 'factory_turbo' ? 0.4 : 1;
    this.turboGain!.gain.setTargetAtTime(this.boost * 0.05 * kitLoud, t, 0.05);
    this.whistle!.frequency.setTargetAtTime(1800 + this.boost * 3800, t, 0.05);
    this.whistleGain!.gain.setTargetAtTime(this.boost * 0.018 * kitLoud, t, 0.05);
    const blower = ind === 'supercharger' || ind === 'factory_super';
    if (electric) {
      this.whine!.frequency.setTargetAtTime(200 + Math.abs(e.speed) * 60 + (dyno ? rpm * 0.3 : 0), t, 0.05);
      this.whineGain!.gain.setTargetAtTime(active ? 0.03 + (throttle ? 0.03 : 0) : 0, t, 0.1);
    } else {
      this.whine!.frequency.setTargetAtTime(rpm * 0.42, t, 0.05);
      this.whineGain!.gain.setTargetAtTime(active && blower ? (ind === 'supercharger' ? 0.03 : 0.012) * (0.4 + rpm / redline) : 0, t, 0.08);
    }

    // Throttle lift or upshift: the blow-off valve vents (Stage 2/3 and kit turbos flutter:
    // "stu-tu-tu"); a valved / straight-through exhaust pops and bangs.
    const lifted = this.lastThrottle && !throttle;
    this.lastThrottle = throttle;
    const gear = e.gear ?? 0;
    const upshift = (e.shifted ?? 0) > 0 || (e.gear !== undefined && this.lastGear > 0 && gear > this.lastGear);
    const downshift = e.gear !== undefined && gear > 0 && this.lastGear > gear;
    this.lastGear = gear;
    const big = (e.stage ?? 0) >= 2 || (turbo && ind !== 'factory_turbo');
    if (active && (lifted || upshift) && turbo && prevBoost > 0.35) {
      if (big) this.flutter(prevBoost);
      else this.blowOff(prevBoost);
    }
    const bikePipe = BIKE_PIPES.has(exhaust);
    const loudPipe = exhaust === 'varex' || exhaust === 'straight' || exhaust === 'downpipe' || bikePipe;
    const popChance = profile ? (bikePipe ? 0.85 : loudPipe ? Math.max(profile.pops, upshift ? 0.8 : 0.6) : profile.pops) : 0;
    if (active && !electric && profile && (lifted || (upshift && loudPipe) || (downshift && bikePipe)) && rpm > redline * 0.4 && Math.random() < popChance) {
      const strength = Math.min(1, popChance * (exhaust === 'straight' || exhaust === 'scproject' ? 1.2 : 1));
      this.backfire(strength);
      this.onPop?.(strength);
    }

    // Tyres: screech when spinning, sliding or locked.
    const slip = active && !dyno ? Math.min(1, Math.max((e.wheelspin ?? 0) * 0.8, e.sliding ? 0.75 : 0, e.locked ? 0.9 : 0)) : 0;
    this.screechFilter!.frequency.setTargetAtTime(1000 + Math.sin(t * 13) * 120 + slip * 300, t, 0.05);
    this.screechGain!.gain.setTargetAtTime(Math.abs(e.speed) > 1 || (e.wheelspin ?? 0) > 0.3 ? slip * 0.1 : 0, t, 0.05);

    // Occasional distant horn for city ambience.
    this.hornTimer -= e.dt;
    if (this.hornTimer <= 0) {
      this.hornTimer = 18 + Math.random() * 30;
      if (Math.random() < 0.6) this.tone([392, 392], 0.18, 'square', 0.025, this.ambientBus);
    }
  }

  /** Current engine speed (for the HUD / dyno needle). */
  get engineRpm(): number {
    return this.rpm;
  }

  private burst(start: number, dur: number, type: BiquadFilterType, freq: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(start, Math.random());
    src.stop(start + dur + 0.02);
  }

  private blowOff(boost: number): void {
    if (!this.ctx) return;
    this.burst(this.ctx.currentTime, 0.35, 'highpass', 2500, 0.08 * boost);
  }

  /** Blow-off valve with compressor surge: a few quick "tu-tu-tu" chirps. */
  private flutter(boost: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    this.burst(at, 0.28, 'highpass', 2200, 0.07 * boost);
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.burst(at + 0.02 + i * 0.038, 0.03, 'bandpass', 1500 + Math.random() * 400, (0.11 - i * 0.015) * boost);
  }

  /** A string of pops and bangs. */
  private backfire(strength: number): void {
    if (!this.ctx) return;
    const n = 1 + Math.floor(Math.random() * (2 + strength * 5));
    let at = this.ctx.currentTime + 0.03;
    for (let i = 0; i < n; i++) {
      this.burst(at, 0.07, 'bandpass', 700 + Math.random() * 900, 0.16 + strength * 0.14);
      this.burst(at, 0.1, 'lowpass', 160, 0.2 + strength * 0.2);
      at += 0.04 + Math.random() * 0.12;
    }
  }

  private tone(freqs: number[], dur: number, type: OscillatorType, vol: number, bus?: GainNode, gap = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    let start = ctx.currentTime;
    for (const f of freqs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(bus ?? this.sfxBus);
      o.start(start);
      o.stop(start + dur + 0.05);
      start += gap || dur * 0.6;
    }
  }

  play(s: Sfx): void {
    switch (s) {
      case 'click':
        return this.tone([880], 0.06, 'sine', 0.08);
      case 'coin':
        return this.tone([1318, 1760], 0.12, 'square', 0.05, undefined, 0.07);
      case 'purchase':
        return this.tone([523, 659, 784, 1047], 0.22, 'triangle', 0.14, undefined, 0.08);
      case 'notify':
        return this.tone([740, 988], 0.16, 'sine', 0.1, undefined, 0.1);
      case 'error':
        return this.tone([220, 185], 0.18, 'sawtooth', 0.06, undefined, 0.12);
      case 'levelup':
        return this.tone([523, 659, 784, 1047, 1319], 0.3, 'triangle', 0.14, undefined, 0.09);
      case 'door':
        return this.tone([180, 140], 0.12, 'triangle', 0.1, undefined, 0.08);
      case 'outbid':
        return this.tone([660, 440], 0.2, 'square', 0.05, undefined, 0.12);
      case 'nearmiss':
        if (this.ctx && this.noiseBuf) this.burst(this.ctx.currentTime, 0.28, 'bandpass', 1400, 0.22);
        return this.tone([1568, 2093], 0.14, 'triangle', 0.09, undefined, 0.06);
      case 'crash':
        if (this.ctx && this.noiseBuf) this.burst(this.ctx.currentTime, 0.45, 'lowpass', 260, 0.5);
        return this.tone([196, 147], 0.25, 'sawtooth', 0.05, undefined, 0.1);
      case 'treeRed':
        return this.tone([880], 0.12, 'square', 0.05);
      case 'treeGreen':
        return this.tone([1760], 0.3, 'square', 0.07);
      case 'foul':
        return this.tone([330, 262], 0.3, 'sawtooth', 0.07, undefined, 0.15);
      // Lockpick: a pin tick, the pick straining in the cylinder, a snapped pick, the lock giving.
      case 'pick':
        if (this.ctx && this.noiseBuf) this.burst(this.ctx.currentTime, 0.03, 'bandpass', 5200, 0.12);
        return this.tone([3200], 0.025, 'square', 0.02);
      case 'strain':
        if (this.ctx && this.noiseBuf) for (let i = 0; i < 7; i++) this.burst(this.ctx.currentTime + i * 0.085, 0.06, 'bandpass', 2400 + i * 260, 0.05 + i * 0.012);
        return this.tone([620, 660, 700, 760], 0.12, 'sawtooth', 0.018, undefined, 0.15);
      case 'snap':
        if (this.ctx && this.noiseBuf) this.burst(this.ctx.currentTime, 0.09, 'highpass', 3800, 0.4);
        return this.tone([2637, 1760], 0.07, 'square', 0.05, undefined, 0.03);
      case 'unlock':
        if (this.ctx && this.noiseBuf) {
          this.burst(this.ctx.currentTime, 0.08, 'bandpass', 900, 0.3);
          this.burst(this.ctx.currentTime + 0.16, 0.12, 'lowpass', 500, 0.35);
        }
        return this.tone([1047, 1568], 0.12, 'triangle', 0.06, undefined, 0.16);
      // Workshop: a ratchet spinning a bolt out, a part coming off, the lift's hydraulics.
      case 'ratchet':
        if (this.ctx && this.noiseBuf) for (let i = 0; i < 6; i++) this.burst(this.ctx.currentTime + i * 0.055, 0.025, 'bandpass', 3000 + (i % 2) * 600, 0.14);
        return;
      case 'clunk':
        if (this.ctx && this.noiseBuf) {
          this.burst(this.ctx.currentTime, 0.18, 'lowpass', 300, 0.45);
          this.burst(this.ctx.currentTime + 0.02, 0.1, 'bandpass', 1800, 0.12);
        }
        return this.tone([110, 82], 0.2, 'triangle', 0.1, undefined, 0.08);
      case 'reward':
        // A cash register, coins and a fanfare.
        if (this.ctx && this.noiseBuf) for (let i = 0; i < 8; i++) this.burst(this.ctx.currentTime + i * 0.06, 0.05, 'bandpass', 4200 + (i % 3) * 700, 0.1);
        return this.tone([784, 988, 1175, 1568, 1976], 0.28, 'triangle', 0.13, undefined, 0.07);
      case 'empty':
        return this.tone([1800], 0.03, 'square', 0.04);
      case 'hit':
        if (!this.ctx || !this.noiseBuf) return;
        this.burst(this.ctx.currentTime, 0.12, 'lowpass', 600, 0.25);
        return this.tone([180, 120], 0.08, 'sine', 0.12);
      case 'wasted':
        return this.tone([392, 330, 262, 196], 0.45, 'triangle', 0.12, undefined, 0.22);
      case 'nitro': {
        // A hiss as the solenoid opens, then the roar of the shot.
        if (!this.ctx || !this.noiseBuf) return;
        const t = this.ctx.currentTime;
        this.burst(t, 0.25, 'highpass', 5200, 0.12);
        this.burst(t + 0.08, 1.6, 'bandpass', 900, 0.16);
        this.burst(t + 0.1, 2.4, 'lowpass', 320, 0.12);
        return;
      }
      case 'air':
        // Air bags venting / filling.
        if (!this.ctx || !this.noiseBuf) return;
        this.burst(this.ctx.currentTime, 0.7, 'highpass', 3800, 0.09);
        this.burst(this.ctx.currentTime + 0.05, 0.5, 'bandpass', 1600, 0.05);
        return;
      case 'lift': {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(70, t);
        o.frequency.linearRampToValueAtTime(96, t + 2.6);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 420;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.07, t + 0.15);
        g.gain.setValueAtTime(0.07, t + 2.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
        o.connect(f).connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 3.05);
        return;
      }
    }
  }

  /** A gunshot (volume 0-1 for distance). */
  shot(kind: 'pistol' | 'shotgun' | 'rifle' | 'deagle' | 'rpg' | 'minigun', volume: number): void {
    if (!this.ctx || !this.noiseBuf || volume <= 0.02) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, volume);
    switch (kind) {
      case 'pistol':
        this.burst(t, 0.09, 'highpass', 1800, 0.32 * v);
        this.burst(t, 0.16, 'lowpass', 700, 0.36 * v);
        return;
      case 'deagle':
        this.burst(t, 0.12, 'highpass', 1400, 0.4 * v);
        this.burst(t, 0.3, 'lowpass', 450, 0.55 * v);
        return;
      case 'shotgun':
        this.burst(t, 0.12, 'highpass', 1100, 0.38 * v);
        this.burst(t, 0.42, 'lowpass', 380, 0.62 * v);
        return;
      case 'rifle':
        this.burst(t, 0.07, 'highpass', 2200, 0.3 * v);
        this.burst(t, 0.12, 'lowpass', 900, 0.3 * v);
        return;
      case 'minigun':
        this.burst(t, 0.05, 'bandpass', 1600, 0.22 * v);
        this.burst(t, 0.06, 'lowpass', 600, 0.22 * v);
        return;
      case 'rpg':
        this.burst(t, 0.6, 'bandpass', 900, 0.3 * v);
        this.burst(t + 0.05, 0.9, 'lowpass', 300, 0.25 * v);
        return;
    }
  }

  /** An explosion. */
  boom(volume: number): void {
    if (!this.ctx || !this.noiseBuf || volume <= 0.02) return;
    const t = this.ctx.currentTime;
    this.burst(t, 1.6, 'lowpass', 220, 0.9 * volume);
    this.burst(t, 0.5, 'bandpass', 700, 0.5 * volume);
    this.burst(t + 0.1, 2.2, 'lowpass', 120, 0.6 * volume);
  }

  private alarmNodes: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode; pulse: GainNode } | null = null;

  /** Car alarm loudness from the distance to the nearest sounding alarm (m; Infinity = none). */
  alarm(distance: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const k = Number.isFinite(distance) ? Math.max(0, 1 - distance / 110) : 0;
    if (k > 0 && !this.alarmNodes) {
      // Two tones swapping five times a second, chopped on and off.
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1050;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 2.5;
      const depth = ctx.createGain();
      depth.gain.value = 260;
      lfo.connect(depth).connect(osc.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2600;
      const pulse = ctx.createGain();
      pulse.gain.value = 1;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(f).connect(pulse).connect(gain).connect(this.sfxBus);
      osc.start();
      lfo.start();
      this.alarmNodes = { osc, lfo, gain, pulse };
    }
    if (!this.alarmNodes) return;
    this.alarmNodes.gain.gain.setTargetAtTime(0.045 * k * k, ctx.currentTime, 0.08);
    if (k === 0 && this.alarmNodes.gain.gain.value < 0.0005) {
      this.alarmNodes.osc.stop();
      this.alarmNodes.lfo.stop();
      this.alarmNodes = null;
    }
  }

  private hornNodes: { osc: OscillatorNode[]; gain: GainNode } | null = null;

  /** Car horn: sounds while held. */
  horn(on: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (on && !this.hornNodes) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.13, t + 0.02);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2400;
      f.connect(gain).connect(this.sfxBus);
      const osc = [415, 520].map((hz) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz;
        o.connect(f);
        o.start(t);
        return o;
      });
      this.hornNodes = { osc, gain };
    } else if (!on && this.hornNodes) {
      const { osc, gain } = this.hornNodes;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.06);
      for (const o of osc) o.stop(t + 0.08);
      this.hornNodes = null;
    }
  }
}

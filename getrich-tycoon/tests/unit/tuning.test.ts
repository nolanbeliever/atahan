import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../shared/economy.config';
import {
  ALL_PARTS,
  PAINT_FINISHES,
  PAINT_FINISH_DEFS,
  PERFORMANCE_PARTS,
  RIM_DESIGNS,
  emptyTuning,
  findPart,
  type VehicleTuning,
} from '../../shared/modificationsData';
import { vehicleParams } from '../../shared/physics';
import {
  MAX_TUNING_VALUE_BONUS,
  calculateVehicleStats,
  dropInvalidParts,
  dynoCurve,
  normalizeTuning,
  paintPrice,
  partBlocked,
  partPrice,
  quoteTuning,
  resaleMultiplier,
  rimPrice,
  speedDisplayScale,
  stockStats,
  rawVehicleStats,
  tuningIssues,
} from '../../shared/tuningSystem';
import { DEFAULT_MODS } from '../../shared/customization';
import { marketValue, rarityFactor } from '../../shared/valuation';
import { VEHICLE_MODELS, getModel } from '../../shared/vehicles';

const tune = (perf: VehicleTuning['perf'], extra: Partial<VehicleTuning> = {}): VehicleTuning => ({ ...emptyTuning(), perf, ...extra });
const STAGE3: VehicleTuning['perf'] = { ecu: 'ecu_stage3', induction: 'ind_bigturbo', internals: 'int_forged', fuel: 'fuel_hpfp' };
const FULL: VehicleTuning['perf'] = {
  ...STAGE3,
  intercooler: 'ic_race',
  exhaust: 'exh_straight',
  intake: 'intake_cai',
  camshaft: 'cam_race',
  suspension: 'susp_coilover',
  tires: 'tire_slick',
  brakes: 'brake_ccb',
};
const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

describe('calculateVehicleStats', () => {
  it('returns the factory figures for a stock vehicle', () => {
    for (const m of VEHICLE_MODELS) {
      const s = calculateVehicleStats(m, null);
      expect(s.hp, m.id).toBe(m.specs.hp);
      expect(s.torque, m.id).toBe(m.specs.torque);
      expect(s.topSpeed, m.id).toBe(m.specs.topSpeed);
      expect(s.accel, m.id).toBeCloseTo(m.specs.accel, 1);
      expect(s.redline).toBe(m.specs.redline);
      expect(s.handling).toBeGreaterThan(40);
      expect(s.handling).toBeLessThanOrEqual(100);
      expect(s.braking).toBeGreaterThan(30);
      // Classics have drum brakes and no ABS.
      expect(s.braking).toBeLessThan(m.category === 'classic' ? 65 : 50);
    }
  });

  it('applies the ECU stage gains (+15/+30/+60% hp, +10/+20/+40% top speed)', () => {
    const m = getModel('bmw_m3_g80');
    const s1 = calculateVehicleStats(m, tune({ ecu: 'ecu_stage1' }));
    expect(s1.hp).toBe(Math.round(m.specs.hp * 1.15));
    // The remap's headline figure raises the limit; the drivetrain decides what the car reaches.
    expect(rawVehicleStats(m, tune({ ecu: 'ecu_stage1' })).topSpeed).toBe(Math.round(m.specs.topSpeed * 1.1));
    expect(s1.topSpeed).toBeGreaterThan(stockStats(m).topSpeed);
    // Stage 2 also needs its downpipe (+6% hp of its own).
    const s2 = calculateVehicleStats(m, tune({ ecu: 'ecu_stage2', exhaust: 'exh_downpipe' }));
    expect(s2.hp).toBe(Math.round(m.specs.hp * 1.3 * 1.06));
    expect(rawVehicleStats(m, tune({ ecu: 'ecu_stage2', exhaust: 'exh_downpipe' })).topSpeed).toBe(Math.round(m.specs.topSpeed * 1.2));
    expect(s2.topSpeed).toBeGreaterThan(s1.topSpeed);
    const s3 = calculateVehicleStats(m, tune(STAGE3));
    expect(s3.hp).toBeGreaterThanOrEqual(Math.round(m.specs.hp * 1.6));
    expect(s3.topSpeed).toBeGreaterThan(s2.topSpeed);
    // More power buys less and less top speed: drag grows with the square of speed.
    expect(s3.topSpeed / stockStats(m).topSpeed).toBeLessThan(Math.cbrt(s3.hp / m.specs.hp) + 0.08);
    // A 510 hp rear-drive car is traction-limited off the line: more power shows from 100 km/h up.
    expect(s1.accel).toBeLessThanOrEqual(stockStats(m).accel);
    expect(s1.accel200).toBeLessThan(stockStats(m).accel200);
    expect(s3.accel200).toBeLessThan(s1.accel200);
    expect(s3.quarter).toBeLessThan(s1.quarter);
  });

  it('caps a complete build at double the stock power', () => {
    for (const m of VEHICLE_MODELS) {
      const s = calculateVehicleStats(m, dropInvalidParts(m, tune(FULL)));
      expect(s.hp).toBeLessThanOrEqual(m.specs.hp * 2 + 1);
      expect(s.topSpeed).toBeLessThanOrEqual(m.specs.topSpeed * 1.45 + 1);
      expect(s.accel).toBeGreaterThanOrEqual(1.8);
    }
  });

  it('models each part category', () => {
    const m = getModel('norda_arlo');
    const stock = stockStats(m);
    // Cold air intake: about 5% quicker plus a little power.
    expect(calculateVehicleStats(m, tune({ intake: 'intake_cai' })).accel).toBeLessThan(stock.accel * 0.96);
    // Coilovers: +25% handling; sport springs +12%.
    expect(calculateVehicleStats(m, tune({ suspension: 'susp_coilover' })).handlingMult).toBeCloseTo(1.25, 5);
    expect(calculateVehicleStats(m, tune({ suspension: 'susp_sport' })).handlingMult).toBeCloseTo(1.12, 5);
    // Brakes and tyres shorten stops; slicks beat semi-slicks.
    const bbk = calculateVehicleStats(m, tune({ brakes: 'brake_bbk' })).braking;
    const ccb = calculateVehicleStats(m, tune({ brakes: 'brake_ccb' })).braking;
    expect(bbk).toBeLessThan(stock.braking);
    expect(ccb).toBeLessThan(bbk);
    const semi = calculateVehicleStats(m, tune({ tires: 'tire_semislick' }));
    const slick = calculateVehicleStats(m, tune({ tires: 'tire_slick' }));
    expect(semi.accel).toBeLessThan(stock.accel);
    expect(slick.accel).toBeLessThan(semi.accel);
    // Forged internals raise the rev limit and cut engine stress.
    expect(calculateVehicleStats(m, tune({ internals: 'int_forged' })).redline).toBe(m.specs.redline + 700);
    const hot = calculateVehicleStats(m, tune(STAGE3));
    const noForged = calculateVehicleStats(m, tune({ ecu: 'ecu_stage2', exhaust: 'exh_downpipe', induction: 'ind_bigturbo' }));
    expect(noForged.stress).toBeGreaterThan(hot.stress);
    // Turbo kits on a naturally aspirated engine: big gains, heat soak without an intercooler.
    const kit = calculateVehicleStats(m, tune({ induction: 'ind_single' }));
    expect(kit.hp).toBeGreaterThan(stock.hp * 1.25);
    expect(kit.heatSoak).toBeLessThan(0.9);
    expect(calculateVehicleStats(m, tune({ induction: 'ind_single', intercooler: 'ic_race' })).heatSoak).toBeGreaterThan(0.99);
    // Superchargers bring torque from idle; big turbos arrive late.
    expect(calculateVehicleStats(m, tune({ induction: 'ind_super' })).curve.low).toBeGreaterThan(calculateVehicleStats(m, tune({ induction: 'ind_bigturbo' })).curve.low);
  });

  it('launch traction limits big power on stock tyres', () => {
    const m = getModel('apexon_vanta');
    const power = calculateVehicleStats(m, tune({ ecu: 'ecu_stage1' }));
    expect(power.wheelspin).toBeGreaterThan(stockStats(m).wheelspin);
    const grip = calculateVehicleStats(m, tune({ ecu: 'ecu_stage1', tires: 'tire_slick' }));
    expect(grip.wheelspin).toBeLessThan(power.wheelspin);
    expect(grip.grip).toBeGreaterThan(power.grip);
  });

  it('extreme stance costs grip, a little camber helps', () => {
    const m = getModel('norda_arlo');
    const base = tune({ suspension: 'susp_coilover' });
    const mild = calculateVehicleStats(m, { ...base, camber: 2, drop: 4 });
    const wild = calculateVehicleStats(m, { ...base, camber: 7, drop: 9 });
    const flat = calculateVehicleStats(m, base);
    expect(mild.handlingMult).toBeGreaterThan(flat.handlingMult);
    expect(wild.handlingMult).toBeLessThan(mild.handlingMult);
    expect(wild.braking).toBeGreaterThan(mild.braking);
  });

  it('exhausts change the sound and the pops & bangs rate', () => {
    const m = getModel('norda_arlo');
    const pops = ['exh_catback', 'exh_varex', 'exh_downpipe', 'exh_straight'].map((id) => calculateVehicleStats(m, tune({ exhaust: id })).sound);
    expect(stockStats(m).sound.exhaust).toBe('stock');
    expect(pops.map((p) => p.exhaust)).toEqual(['catback', 'varex', 'downpipe', 'straight']);
    for (let i = 1; i < pops.length; i++) expect(pops[i]!.pops).toBeGreaterThan(pops[i - 1]!.pops);
    expect(calculateVehicleStats(m, tune({ exhaust: 'exh_straight', ecu: 'ecu_stage2' })).sound.pops).toBeGreaterThan(pops[3]!.pops);
    expect(calculateVehicleStats(getModel('bmw_i7_g70'), null).sound.electric).toBe(true);
  });
});

describe('fitment rules', () => {
  it('electric vehicles only take software, chassis and body parts', () => {
    const ev = getModel('bmw_i7_g70');
    expect(partBlocked(ev, findPart('ecu_stage1')!)).toBeNull();
    for (const id of ['ecu_stage2', 'ecu_stage3', 'intake_cai', 'ind_single', 'int_forged', 'exh_straight']) expect(partBlocked(ev, findPart(id)!), id).not.toBeNull();
    for (const id of ['susp_coilover', 'tire_slick', 'brake_ccb', 'wing_gt']) expect(partBlocked(ev, findPart(id)!), id).toBeNull();
  });

  it('motorcycles take no body kits, turbo kits or stance', () => {
    const bike = getModel('bmw_gs_moto');
    for (const id of ['wing_gt', 'hood_carbon', 'ind_single', 'ecu_stage3', 'ic_fmic']) expect(partBlocked(bike, findPart(id)!), id).not.toBeNull();
    expect(partBlocked(bike, findPart('exh_straight')!)).toBeNull();
    expect(tuningIssues(bike, { ...emptyTuning(), camber: 1 })).not.toEqual([]);
  });

  it('checks prerequisites and intercoolers need boost', () => {
    const m = getModel('norda_arlo');
    expect(tuningIssues(m, tune({ ecu: 'ecu_stage2' })).join()).toMatch(/Downpipe/);
    expect(tuningIssues(m, tune({ ecu: 'ecu_stage2', exhaust: 'exh_catback' }))).not.toEqual([]);
    expect(tuningIssues(m, tune({ ecu: 'ecu_stage2', exhaust: 'exh_straight' }))).toEqual([]);
    expect(tuningIssues(m, tune({ ecu: 'ecu_stage3' })).length).toBeGreaterThanOrEqual(3);
    expect(tuningIssues(m, tune(STAGE3))).toEqual([]);
    expect(tuningIssues(m, tune({ intercooler: 'ic_fmic' }))).not.toEqual([]);
    expect(tuningIssues(getModel('velora_serene'), tune({ intercooler: 'ic_fmic' }))).toEqual([]);
    expect(dropInvalidParts(m, tune({ ecu: 'ecu_stage3', exhaust: 'exh_catback' })).perf).toEqual({ exhaust: 'exh_catback' });
  });
});

describe('quoteTuning', () => {
  const m = getModel('velora_serene');

  it('prices parts, paint, wheels and alignment and rejects invalid builds', () => {
    const q = quoteTuning(m, emptyTuning(), {
      perf: { ecu: 'ecu_stage1', exhaust: 'exh_catback' },
      body: { wing: 'wing_gt' },
      paint: { finish: 'metallic', color: '#1B2B50' },
      rim: { design: 'rim_mesh', finish: 'gold' },
    });
    expect(q.issues).toEqual([]);
    const expected = partPrice(m, findPart('ecu_stage1')!) + partPrice(m, findPart('exh_catback')!) + partPrice(m, findPart('wing_gt')!) + paintPrice(m, 'metallic') + rimPrice(m, 'rim_mesh');
    expect(q.total).toBe(expected);
    expect(q.next.paint).toEqual({ finish: 'metallic', color: '#1b2b50' });
    expect(q.seconds).toBeGreaterThan(0);
    // Same finish, other colour: repaint. Same wheels, other finish: refinish only.
    const q2 = quoteTuning(m, q.next, { rim: { design: 'rim_mesh', finish: 'black' } });
    expect(q2.total).toBe(300);
    expect(quoteTuning(m, q.next, {}).changed).toBe(false);
    expect(quoteTuning(m, emptyTuning(), { paint: { finish: 'gloss', color: 'red' } }).issues).not.toEqual([]);
    expect(quoteTuning(m, emptyTuning(), { perf: { ecu: 'ecu_stage2' } }).issues).not.toEqual([]);
    expect(quoteTuning(m, emptyTuning(), { perf: { ecu: 'exh_catback' } }).issues).not.toEqual([]);
  });

  it('handles stance limits per suspension', () => {
    expect(quoteTuning(m, emptyTuning(), { drop: 3 }).issues.join()).toMatch(/drop/);
    const coil = quoteTuning(m, emptyTuning(), { perf: { suspension: 'susp_coilover' } });
    expect(coil.next.drop).toBe(4); // default ride height of the kit
    const slammed = quoteTuning(m, coil.next, { drop: 8.5, camber: 6 });
    expect(slammed.issues).toEqual([]);
    expect(slammed.total).toBe(150);
    // Back to stock suspension: settings are clamped, not rejected.
    const back = quoteTuning(m, slammed.next, { perf: { suspension: null } });
    expect(back.issues).toEqual([]);
    expect(back.next.drop).toBe(0);
    expect(back.next.camber).toBe(1.5);
  });

  it('normalizes untrusted data', () => {
    const t = normalizeTuning({ perf: { ecu: 'ecu_stage9', exhaust: 'exh_varex', intake: 'wing_gt' }, body: { wing: 'wing_swan' }, paint: { finish: 'gold', color: '#fff' }, camber: 99, drop: -3, extra: 1 });
    expect(t).toEqual({ perf: { exhaust: 'exh_varex' }, body: { wing: 'wing_swan' }, paint: null, rim: null, camber: 10, drop: 0 });
    expect(normalizeTuning('nope')).toEqual(emptyTuning());
  });
});

describe('dyno', () => {
  it('curves match the headline figures', () => {
    for (const m of VEHICLE_MODELS) {
      for (const t of [null, dropInvalidParts(m, tune(FULL))]) {
        const s = calculateVehicleStats(m, t);
        const c = dynoCurve(s);
        expect(c.peakHp, m.id).toBeCloseTo(s.hp, -1);
        expect(Math.abs(c.peakTorque - s.torque) / s.torque, m.id).toBeLessThan(0.25);
        for (let i = 1; i < c.rpm.length; i++) expect(c.rpm[i]!).toBeGreaterThan(c.rpm[i - 1]!);
        expect(Math.min(...c.hp, ...c.torque)).toBeGreaterThanOrEqual(0);
        expect(c.redline).toBe(s.redline);
      }
    }
  });

  it('turbos make torque low down, cams move power up the rev range', () => {
    const m = getModel('norda_arlo');
    const na = dynoCurve(stockStats(m));
    const cams = dynoCurve(calculateVehicleStats(m, tune({ camshaft: 'cam_race' })));
    expect(cams.peakHpRpm).toBeGreaterThanOrEqual(na.peakHpRpm);
    const turbo = dynoCurve(calculateVehicleStats(getModel('velora_serene'), null));
    expect(turbo.peakTorqueRpm / turbo.redline).toBeLessThan(na.peakTorqueRpm / na.redline);
  });
});

describe('physics and economy', () => {
  it('tuning parts change the simulated car: more power, better brakes, more grip', () => {
    const m = getModel('velora_serene');
    const stock = vehicleParams(m, PERFECT, 100, { ...DEFAULT_MODS });
    const tuned = vehicleParams(m, PERFECT, 100, { ...DEFAULT_MODS, tuning: tune({ ecu: 'ecu_stage1', suspension: 'susp_coilover', brakes: 'brake_bbk' }) });
    expect(tuned.topSpeed).toBeGreaterThan(stock.topSpeed);
    expect(tuned.pt.brakeG).toBeGreaterThan(stock.pt.brakeG);
    expect(tuned.pt.latGrip / stock.pt.latGrip).toBeCloseTo(1.25, 2);
    const s0 = calculateVehicleStats(m, null);
    const s1 = calculateVehicleStats(m, tune({ ecu: 'ecu_stage1', suspension: 'susp_coilover', brakes: 'brake_bbk' }));
    expect(s1.accel).toBeLessThan(s0.accel);
    expect(s1.braking).toBeLessThan(s0.braking);
    // The stock car's figures are its factory figures; the speedometer uses one scale for all cars.
    expect(s0.accel).toBeCloseTo(m.specs.accel, 1);
    expect(s0.topSpeed).toBeCloseTo(m.specs.topSpeed, -1);
    expect(speedDisplayScale(m)).toBe(2.1);
  });

  it('a full Stage 3 build is worth 150-200% of the stock car', () => {
    for (const m of VEHICLE_MODELS.filter((x) => x.specs.aspiration !== 'electric' && x.specs.kind === 'car')) {
      const mult = resaleMultiplier(m, tune({ ...FULL }));
      expect(mult, m.id).toBeGreaterThanOrEqual(1.5);
      expect(mult, m.id).toBeLessThanOrEqual(2);
      const v = { modelId: m.id, condition: PERFECT, mileage: 0, mods: { ...DEFAULT_MODS } };
      const tuned = marketValue({ ...v, mods: { ...DEFAULT_MODS, tuning: tune(FULL) } });
      expect(tuned / marketValue(v)).toBeCloseTo(mult, 2);
    }
    // Everything at once still caps at 2x.
    const all = tune(FULL, { paint: { finish: 'chameleon', color: '#111111', color2: '#222222' }, rim: { design: 'rim_mesh', finish: 'gold' }, body: { frontBumper: 'fb_carbon', rearBumper: 'rb_diffuser', sideSkirts: 'ss_carbon', hood: 'hood_carbon', wing: 'wing_swan' } });
    expect(resaleMultiplier(getModel('norda_arlo'), all)).toBe(1 + MAX_TUNING_VALUE_BONUS);
  });

  it('is arbitrage-free: no part adds more resale value than it costs, even at an auction in a hot market', () => {
    const hotDemand = ECONOMY.demand.max;
    const auctionNet = Math.max(...ECONOMY.auction.npcMaxBidRate) * (1 - ECONOMY.fees.auctionFeeRate);
    const instant = Math.max(auctionNet, ECONOMY.fees.quickSellRate);
    for (const m of VEHICLE_MODELS) {
      const maxBase = m.basePrice * rarityFactor(m) * hotDemand;
      const check = (label: string, value: number, price: number) => expect(price, `${m.id} ${label}`).toBeGreaterThan(value * maxBase * instant);
      for (const p of ALL_PARTS) check(p.id, p.value, partPrice(m, p));
      for (const f of PAINT_FINISHES) check(f, PAINT_FINISH_DEFS[f].value, paintPrice(m, f));
      for (const r of RIM_DESIGNS) check(r.id, r.value, rimPrice(m, r.id));
    }
  });

  it('every part has sane data', () => {
    const ids = new Set(ALL_PARTS.map((p) => p.id));
    expect(ids.size).toBe(ALL_PARTS.length);
    for (const p of PERFORMANCE_PARTS) {
      expect(p.value).toBeGreaterThan(0);
      expect(p.installSec).toBeGreaterThan(0);
      for (const r of p.requires ?? []) for (const id of r.any) expect(findPart(id)?.slot, `${p.id} -> ${id}`).toBe(r.slot);
    }
  });
});

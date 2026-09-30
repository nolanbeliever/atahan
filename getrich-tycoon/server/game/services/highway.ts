// No Hesi highway: near misses at speed pay cash + XP with a combo multiplier; a crash resets the
// combo. Also makes traffic move over for a fast car behind it (or for the horn / a flash).

import { ECONOMY } from '../../../shared/economy.config';
import { CARRIAGEWAY_EDGE, deltaS, projectToHighway, travelDir } from '../../../shared/highway';
import type { NearMissEvent } from '../../../shared/protocol';
import { obbDistance } from '../../../shared/obb';
import { vehicleBox, type DynamicBox } from '../../../shared/physics';
import { trafficBoxes, trafficPose } from '../../../shared/traffic';
import { KMH_PER_MS } from '../../../shared/drivetrain';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';
import type { DriveState } from '../simulation';

const log = createLogger('highway');

interface Combo {
  count: number;
  money: number;
  xp: number;
  startedAt: number;
  lastAt: number;
}

interface Pass {
  /** Which side of the traffic car the player started on (-1 behind, 1 ahead). */
  startSide: number;
  minGap: number;
  maxKmh: number;
  startedAt: number;
}

interface Pending {
  money: number;
  xp: number;
  count: number;
}

const HOUR = 3600_000;

export function comboMultiplier(count: number): number {
  for (const t of ECONOMY.highway.comboTiers) if (count >= t.from) return t.mult;
  return 1;
}

export class HighwayService {
  private combos = new Map<string, Combo>();
  private passes = new Map<string, Map<number, Pass>>();
  /** Last award per (player, traffic car), so one car can't be farmed. */
  private awarded = new Map<string, Map<number, number>>();
  private pending = new Map<string, Pending>();
  private hourly = new Map<string, { start: number; money: number }>();
  private boxes: DynamicBox[] = [];
  /** Other services (police heat, missions) hear about every near miss. */
  readonly listeners: ((playerId: string, e: { gap: number; kmh: number; kind: string }) => void)[] = [];

  constructor(private readonly ctx: Ctx) {}

  /** Run every simulation tick. */
  tick(now: number): void {
    for (const [playerId] of this.combos) {
      const c = this.ctx.sim.chars.get(playerId);
      if (!c?.drivingId) this.endCombo(playerId, 'expired');
    }
    for (const d of this.ctx.sim.drives.values()) {
      this.checkCombo(d, now);
      this.detect(d, now);
      this.yieldFor(d, now);
    }
  }

  private checkCombo(d: DriveState, now: number): void {
    const combo = this.combos.get(d.playerId);
    if (!combo) return;
    if (d.crashAt > combo.startedAt) {
      this.endCombo(d.playerId, 'crash');
      this.passes.delete(d.playerId);
    } else if (now - combo.lastAt > ECONOMY.highway.comboWindowSec * 1000) this.endCombo(d.playerId, 'expired');
  }

  private endCombo(playerId: string, reason: 'crash' | 'expired'): void {
    const combo = this.combos.get(playerId);
    if (!combo) return;
    this.combos.delete(playerId);
    this.ctx.hub.sendTo(playerId, 'highway.combo', { reason, count: combo.count, earned: combo.money });
  }

  /** The player left the car or the game: their combo is over. */
  forget(playerId: string): void {
    this.endCombo(playerId, 'expired');
    this.passes.delete(playerId);
    this.awarded.delete(playerId);
  }

  private detect(d: DriveState, now: number): void {
    const hp = projectToHighway(d.dyn.x, d.dyn.z);
    const passes = this.passes.get(d.playerId);
    if (Math.abs(hp.offset) > CARRIAGEWAY_EDGE + 1) {
      if (passes) passes.clear();
      return;
    }
    if (!this.ctx.state.vehicles.get(d.vehicleId)) return;
    const kmh = Math.abs(d.dyn.speed) * KMH_PER_MS;
    let map = passes;
    if (!map) this.passes.set(d.playerId, (map = new Map()));
    const cfg = ECONOMY.highway;
    const traffic = this.ctx.sim.traffic;
    const me = vehicleBox(d.vehicleId, d.dyn.x, d.dyn.z, d.dyn.rot, d.params.halfLength, d.params.halfWidth);
    for (const car of traffic.cars) {
      const ds = deltaS(car.s, hp.s);
      if (ds > 30 || ds < -30) {
        map.delete(car.spec.id);
        continue;
      }
      // Alongside: the two bodies overlap along this car's direction of travel.
      const pose = trafficPose(car.spec.cw, car.s, car.off);
      const along = Math.abs(Math.sin(d.dyn.rot) * Math.sin(pose.yaw) + Math.cos(d.dyn.rot) * Math.cos(pose.yaw));
      const across = Math.sqrt(Math.max(0, 1 - along * along));
      const halfLon = d.params.halfLength * along + d.params.halfWidth * across;
      const rel = ds * travelDir(car.spec.cw);
      const overlapping = Math.abs(rel) < car.spec.length / 2 + halfLon + 0.3;
      let gap = Infinity;
      if (overlapping) {
        // Exact clearance between the car's box and the traffic body (each segment of a truck).
        this.boxes.length = 0;
        for (const b of trafficBoxes(car.spec, car.s, car.off, car.v, this.boxes)) gap = Math.min(gap, obbDistance(me, b));
      }
      const pass = map.get(car.spec.id);
      if (overlapping && gap < 3) {
        if (!pass) map.set(car.spec.id, { startSide: Math.sign(rel) || -1, minGap: gap, maxKmh: kmh, startedAt: now });
        else {
          pass.minGap = Math.min(pass.minGap, gap);
          pass.maxKmh = Math.max(pass.maxKmh, kmh);
        }
        continue;
      }
      if (!pass) continue;
      map.delete(car.spec.id);
      const passed = Math.sign(rel) !== pass.startSide;
      // Any contact (gap 0) or crash during the pass spoils it.
      const clean = d.crashAt < pass.startedAt && pass.minGap > 0.005;
      if (!passed || !clean || pass.minGap > cfg.nearMissClearance || pass.maxKmh < cfg.nearMissMinKmh) continue;
      let awarded = this.awarded.get(d.playerId);
      if (!awarded) this.awarded.set(d.playerId, (awarded = new Map()));
      if (now - (awarded.get(car.spec.id) ?? 0) < 4000) continue;
      awarded.set(car.spec.id, now);
      this.award(d.playerId, now, pass.minGap, car.spec.kind, pass.maxKmh);
    }
  }

  private award(playerId: string, now: number, gap: number, kind: string, kmh: number): void {
    const cfg = ECONOMY.highway;
    let combo = this.combos.get(playerId);
    if (!combo) this.combos.set(playerId, (combo = { count: 0, money: 0, xp: 0, startedAt: now, lastAt: now }));
    combo.count++;
    combo.lastAt = now;
    const mult = comboMultiplier(combo.count);
    const close = gap <= cfg.nearMissCloseClearance;
    let amount = Math.round(cfg.nearMissReward * mult * (close ? cfg.closeBonus : 1));
    const xp = Math.round(cfg.nearMissXp * mult * (close ? cfg.closeBonus : 1));
    let hour = this.hourly.get(playerId);
    if (!hour || now - hour.start > HOUR) this.hourly.set(playerId, (hour = { start: now, money: 0 }));
    const capped = hour.money + amount > cfg.hourlyCap;
    if (capped) amount = Math.max(0, cfg.hourlyCap - hour.money);
    hour.money += amount;
    combo.money += amount;
    combo.xp += xp;
    const p = this.pending.get(playerId) ?? { money: 0, xp: 0, count: 0 };
    p.money += amount;
    p.xp += xp;
    p.count++;
    this.pending.set(playerId, p);
    const ev: NearMissEvent = { amount, xp, mult, combo: combo.count, comboMoney: combo.money, comboXp: combo.xp, gap: Math.max(0, Math.round(gap * 100) / 100), kind, capped, close };
    this.ctx.hub.sendTo(playerId, 'highway.nearmiss', ev);
    for (const l of this.listeners) l(playerId, { gap, kmh, kind });
  }

  /** Traffic moves over for a fast car closing in from behind, or for the horn / a flash. */
  private yieldFor(d: DriveState, now: number): void {
    if (d.dyn.speed < 8) return;
    const c = this.ctx.sim.chars.get(d.playerId);
    const honked = !!c && now - c.hornAt < 1500;
    const ahead = this.ctx.sim.traffic.carAhead(d.dyn.x, d.dyn.z, d.dyn.rot, d.params.halfWidth, honked ? 75 : 40);
    if (!ahead) return;
    const closing = d.dyn.speed * ahead.along - ahead.car.v;
    if (honked || (ahead.car.spec.polite && closing > 5 && ahead.gap < 45)) this.ctx.sim.traffic.requestYield(ahead.car);
  }

  /** Pay out near-miss cash and XP (batched once a second). */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = [...this.pending];
    this.pending.clear();
    for (const [playerId, p] of batch) {
      if (!this.ctx.state.players.has(playerId)) continue;
      try {
        await this.ctx.locks.run([K.player(playerId)], async () => {
          const uow = this.ctx.state.begin();
          const rec = uow.player(playerId);
          if (p.money > 0) uow.credit(rec, Math.round(p.money), 'near_miss', `${p.count} near miss${p.count === 1 ? '' : 'es'} on the highway`);
          uow.grantXp(rec, p.xp);
          await uow.commit();
        });
      } catch (err) {
        log.error('near-miss payout failed', { playerId, error: (err as Error).message });
      }
    }
  }

  /** For tests. */
  comboOf(playerId: string): Readonly<Combo> | undefined {
    return this.combos.get(playerId);
  }
}

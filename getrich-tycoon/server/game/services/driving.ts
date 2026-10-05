// Passive income while driving: every 10 seconds of real driving the driver earns cash that scales
// with the market value of the car (a $50k car pays $50, a $300k car about $350). Parked or
// crawling cars earn nothing: the car has to average at least ECONOMY.driving.minAvgKmh.

import { KMH_PER_MS } from '../../../shared/drivetrain';
import { ECONOMY } from '../../../shared/economy.config';
import { marketValue } from '../../../shared/valuation';
import { modelDisplayName } from '../../../shared/vehicles';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';

const log = createLogger('driving');

/** Cash for one interval of driving a car worth `value`. */
export function driveBonus(value: number): number {
  const c = ECONOMY.driving;
  return Math.max(c.minAmount, Math.round(c.perTenSecondsAt50k * Math.pow(Math.max(0, value) / 50_000, c.exponent)));
}

interface Stint {
  vehicleId: string;
  seconds: number;
  distance: number;
  x: number;
  z: number;
  at: number;
}

export class DrivingService {
  private stints = new Map<string, Stint>();
  /** Metres driven (world) since the last call, per player - read by the missions. */
  readonly listeners: ((playerId: string, metres: number) => void)[] = [];

  constructor(private readonly ctx: Ctx) {}

  /** Run once a second. */
  async tick(now = Date.now()): Promise<void> {
    const cfg = ECONOMY.driving;
    const payouts: { playerId: string; vehicleId: string }[] = [];
    const active = new Set<string>();
    for (const d of this.ctx.sim.drives.values()) {
      active.add(d.playerId);
      let s = this.stints.get(d.playerId);
      if (!s || s.vehicleId !== d.vehicleId) {
        this.stints.set(d.playerId, { vehicleId: d.vehicleId, seconds: 0, distance: 0, x: d.dyn.x, z: d.dyn.z, at: now });
        continue;
      }
      const step = Math.hypot(d.dyn.x - s.x, d.dyn.z - s.z);
      s.x = d.dyn.x;
      s.z = d.dyn.z;
      // Held cars (drag staging, arrests) don't earn.
      if (d.hold) {
        s.seconds = 0;
        s.distance = 0;
        s.at = now;
        continue;
      }
      s.distance += step;
      for (const l of this.listeners) l(d.playerId, step);
      s.seconds = (now - s.at) / 1000;
      if (s.seconds >= cfg.everySec) {
        const avgKmh = (s.distance / s.seconds) * KMH_PER_MS;
        if (avgKmh >= cfg.minAvgKmh) payouts.push({ playerId: d.playerId, vehicleId: d.vehicleId });
        s.seconds = 0;
        s.distance = 0;
        s.at = now;
      }
    }
    for (const id of [...this.stints.keys()]) if (!active.has(id)) this.stints.delete(id);
    for (const p of payouts) await this.pay(p.playerId, p.vehicleId);
  }

  private async pay(playerId: string, vehicleId: string): Promise<void> {
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        const v = this.ctx.state.vehicles.get(vehicleId);
        // A showroom's test-drive car is not yours: it earns nothing.
        if (!v || v.ownerId !== playerId || v.status === 'testdrive' || !this.ctx.state.players.has(playerId)) return;
        const value = marketValue(v, this.ctx.state.trends);
        const amount = driveBonus(value);
        const uow = this.ctx.state.begin();
        uow.credit(uow.player(playerId), amount, 'drive_bonus', `Driving bonus: ${modelDisplayName(v.modelId)}`, vehicleId);
        await uow.commit();
        this.ctx.hub.sendTo(playerId, 'drive.bonus', { amount, value });
      });
    } catch (err) {
      log.error('driving bonus failed', { playerId, error: (err as Error).message });
    }
  }

  forget(playerId: string): void {
    this.stints.delete(playerId);
  }
}

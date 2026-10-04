// Category demand drift (controlled market volatility with mean reversion).

import { ECONOMY } from '../../../shared/economy.config';
import { VEHICLE_CATEGORIES, type CategoryTrends } from '../../../shared/types';
import { clamp } from '../../../shared/util';
import type { Ctx } from '../context';

export class TrendsService {
  constructor(private readonly ctx: Ctx) {}

  next(current: CategoryTrends): CategoryTrends {
    const d = ECONOMY.demand;
    const out = { ...current };
    for (const c of VEHICLE_CATEGORIES) {
      const v = current[c] ?? 1;
      const drift = (this.ctx.rng() * 2 - 1) * d.volatility;
      const revert = (1 - v) * d.meanReversion;
      out[c] = Math.round(clamp(v + drift + revert, d.min, d.max) * 1000) / 1000;
    }
    return out;
  }

  async update(): Promise<void> {
    const uow = this.ctx.state.begin();
    uow.setTrends(this.next(this.ctx.state.trends));
    await uow.commit();
    this.ctx.hub.broadcast('trends', this.ctx.state.trends);
  }
}

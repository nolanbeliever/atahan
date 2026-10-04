// Speed radars on the bridges: a car passing under a gantry has its speed measured; the driver
// (and passengers) see it with their best and the server record. A personal best is saved.

import { KMH_PER_MS } from '../../../shared/drivetrain';
import type { RadarFlash } from '../../../shared/protocol';
import { RADARS, bridgeByN } from '../../../shared/strait';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';

const log = createLogger('radar');

/** Slower than this is not worth a flash. */
const MIN_KMH = 40;

export class RadarService {
  /** Where each driven vehicle was last tick (x and deck). */
  private last = new Map<string, { x: number; deck: number }>();

  constructor(private readonly ctx: Ctx) {}

  tick(): void {
    const seen = new Set<string>();
    for (const d of this.ctx.sim.drives.values()) {
      seen.add(d.vehicleId);
      const deck = d.dyn.deck ?? 0;
      const prev = this.last.get(d.vehicleId);
      this.last.set(d.vehicleId, { x: d.dyn.x, deck });
      if (!prev || !deck || prev.deck !== deck || prev.x === d.dyn.x) continue;
      for (const r of RADARS) {
        if (r.n !== deck || (prev.x - r.x) * (d.dyn.x - r.x) > 0) continue;
        const kmh = Math.round(Math.abs(d.dyn.speed) * KMH_PER_MS);
        if (kmh >= MIN_KMH) void this.flash(d.playerId, d.vehicleId, r.id, deck, kmh);
      }
    }
    for (const id of this.last.keys()) if (!seen.has(id)) this.last.delete(id);
  }

  /** The fastest pass anyone has made (players in memory). */
  record(): { name: string; kmh: number } | null {
    let best: { name: string; kmh: number } | null = null;
    for (const p of this.ctx.state.players.values()) {
      const kmh = p.stats.radarBest ?? 0;
      if (kmh > 0 && (!best || kmh > best.kmh)) best = { name: p.name, kmh };
    }
    return best;
  }

  private async flash(playerId: string, vehicleId: string, radar: string, deck: number, kmh: number): Promise<void> {
    let best = kmh;
    let newBest = false;
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        const live = this.ctx.state.players.get(playerId);
        if (!live) return;
        const before = live.stats.radarBest ?? 0;
        best = Math.max(before, kmh);
        if (kmh <= before) return;
        newBest = true;
        const uow = this.ctx.state.begin();
        const p = uow.player(playerId);
        p.stats = { ...p.stats, radarBest: kmh };
        await uow.commit();
      });
    } catch (err) {
      log.warn('radar best not saved', { playerId, err: String(err) });
    }
    const flash: RadarFlash = { radar, bridge: bridgeByN(deck)?.name ?? '', kmh, best, newBest, record: this.record() };
    this.ctx.hub.sendTo(playerId, 'radar.flash', flash);
    for (const r of this.ctx.sim.ridersOf(vehicleId)) this.ctx.hub.sendTo(r.id, 'radar.flash', flash);
  }
}

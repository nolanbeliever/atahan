// Tuning garage (at Chroma Customs): performance parts, body parts, paint finishes, wheels and
// stance. Prices, prerequisites and effects come from the shared tuning system; the server only
// accepts what `quoteTuning` accepts and charges exactly its total.

import { MOD_CATALOG, findOption, isValidModOption } from '../../../shared/customization';
import { ECONOMY } from '../../../shared/economy.config';
import { BODY_SLOTS, PAINT_FINISHES, PERF_SLOTS, RIM_FINISHES, type BodySlot, type PerfSlot } from '../../../shared/modificationsData';
import { quoteTuning, tuningOf, type TuningChange } from '../../../shared/tuningSystem';
import type { Vehicle, VehicleMods } from '../../../shared/types';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireIdle, requireNear, requireOwned } from '../guards';

const log = createLogger('tuning');

type LegacySlot = 'tint' | 'headlights' | 'accessory';
const LEGACY_SLOTS: readonly LegacySlot[] = ['tint', 'headlights', 'accessory'];

function partId(v: unknown, what: string): string | null {
  if (v === null) return null;
  return val.id(v, what);
}

function hex(v: unknown, what: string): string {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new GameError('bad_request', `Invalid ${what}.`);
  return v.toLowerCase();
}

/** Strictly parse an untrusted TuningChange. */
export function parseTuningChange(raw: unknown): TuningChange {
  const c = val.obj(raw ?? {});
  const out: TuningChange = {};
  for (const key of Object.keys(c)) {
    if (!['perf', 'body', 'paint', 'rim', 'camber', 'drop'].includes(key)) throw new GameError('bad_request', 'Invalid tuning request.');
  }
  if (c.perf !== undefined) {
    const perf = val.obj(c.perf);
    out.perf = {};
    for (const [slot, id] of Object.entries(perf)) {
      if (!PERF_SLOTS.includes(slot as PerfSlot)) throw new GameError('bad_request', 'Invalid part slot.');
      out.perf[slot as PerfSlot] = partId(id, 'part');
    }
  }
  if (c.body !== undefined) {
    const body = val.obj(c.body);
    out.body = {};
    for (const [slot, id] of Object.entries(body)) {
      if (!BODY_SLOTS.includes(slot as BodySlot)) throw new GameError('bad_request', 'Invalid body slot.');
      out.body[slot as BodySlot] = partId(id, 'part');
    }
  }
  if (c.paint !== undefined) {
    if (c.paint === null) out.paint = null;
    else {
      const p = val.obj(c.paint);
      out.paint = { finish: val.oneOf(p.finish, 'paint finish', PAINT_FINISHES), color: hex(p.color, 'paint colour') };
      if (p.color2 !== undefined) out.paint.color2 = hex(p.color2, 'second paint colour');
    }
  }
  if (c.rim !== undefined) {
    if (c.rim === null) out.rim = null;
    else {
      const r = val.obj(c.rim);
      out.rim = { design: val.id(r.design, 'wheel design'), finish: val.oneOf(r.finish, 'wheel finish', RIM_FINISHES) };
    }
  }
  if (c.camber !== undefined) out.camber = val.num(c.camber, 'camber', 0, 10);
  if (c.drop !== undefined) out.drop = val.num(c.drop, 'ride height', 0, 12);
  return out;
}

function parseLegacy(raw: unknown): Partial<Pick<VehicleMods, LegacySlot>> {
  if (raw === undefined || raw === null) return {};
  const l = val.obj(raw);
  const out: Partial<Pick<VehicleMods, LegacySlot>> = {};
  for (const [slot, id] of Object.entries(l)) {
    if (!LEGACY_SLOTS.includes(slot as LegacySlot) || typeof id !== 'string' || !isValidModOption(slot as LegacySlot, id)) {
      throw new GameError('bad_request', 'Invalid customization.');
    }
    out[slot as LegacySlot] = id;
  }
  return out;
}

export class TuningService {
  private timers = new Set<NodeJS.Timeout>();

  constructor(private readonly ctx: Ctx) {}

  async apply(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const change = parseTuningChange(p.change);
    const legacy = parseLegacy(p.legacy);
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      requireNear(this.ctx, playerId, 'custom');
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh);
      const model = getModel(veh.modelId);
      const quote = quoteTuning(model, tuningOf(veh.mods), change);
      if (quote.issues.length) throw new GameError('bad_request', quote.issues[0]!);

      let legacyCost = 0;
      let legacyChanged = 0;
      for (const slot of LEGACY_SLOTS) {
        const next = legacy[slot];
        if (next === undefined || next === veh.mods[slot]) continue;
        legacyCost += findOption(next)?.price ?? 0;
        veh.mods[slot] = next;
        legacyChanged++;
      }
      if (!quote.changed && legacyChanged === 0) throw new GameError('bad_request', 'Nothing to change.');

      const total = quote.total + legacyCost;
      if (total > 0) uow.debit(player, total, 'tuning', `Tuning garage: ${modelDisplayName(veh.modelId)}`, veh.id);
      veh.mods.tuning = quote.next;
      // Custom paint, aftermarket wheels and body parts replace the classic one-click options.
      if (change.paint && quote.next.paint) veh.mods.paint = null;
      if (change.rim && quote.next.rim) veh.mods.wheels = MOD_CATALOG.wheels[0]!.id;
      if (change.body && Object.values(change.body).some((id) => id !== null)) veh.mods.bodyKit = MOD_CATALOG.bodyKit[0]!.id;
      veh.purchasePrice += total;
      player.stats.spentOnCustomization += total;
      const seconds = Math.max(quote.seconds, legacyChanged ? 3 : 0);
      if (seconds > 0) veh.serviceUntil = uow.now + Math.round(seconds * 1000);
      uow.grantXp(player, ECONOMY.tuning.xpPerPart * Math.min(10, quote.lines.length + legacyChanged));
      uow.checkAchievements(player);
      await uow.commit();
      this.ctx.sim.markInteract(playerId);
      const live = this.ctx.state.vehicles.get(vehicleId)!;
      this.scheduleDone(playerId, live, seconds);
      log.info('tuning', { playerId, vehicleId, cost: total, lines: quote.lines.map((l) => l.label) });
      return { vehicle: live, cost: total, seconds };
    });
  }

  private scheduleDone(playerId: string, veh: Vehicle, seconds: number): void {
    if (seconds <= 0) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.ctx.hub.notify(playerId, { kind: 'success', title: 'Build complete', text: `Your ${modelDisplayName(veh.modelId)} is ready to drive.` });
    }, Math.round(seconds * 1000));
    t.unref?.();
    this.timers.add(t);
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

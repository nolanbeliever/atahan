// Repair garage, car wash, fuel station, customization garage and parts depot.

import { MOD_CATALOG, optionLevel, findOption, isValidModOption, type ModSlot } from '../../../shared/customization';
import { ECONOMY, dealershipLevel } from '../../../shared/economy.config';
import { REPAIR_PARTS, type RepairPart, type Vehicle } from '../../../shared/types';
import { fuelCost, kitForPart, repairQuote } from '../../../shared/valuation';
import { clamp } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import { findPlot, isInsidePlot } from '../../../shared/world';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireIdle, requireNear, requireOwned } from '../guards';
import type { VehicleService } from './vehicles';

const log = createLogger('garage');

export class GarageService {
  private repairTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly ctx: Ctx,
    private readonly vehicles: VehicleService,
  ) {}

  /** Labour discount if the player is at their own dealership with a repair bay. */
  private repairLocation(playerId: string): { discount: number } {
    if (this.ctx.sim.isNearInteractable(playerId, 'repair')) return { discount: 0 };
    const d = this.ctx.state.dealershipOf(playerId);
    const pos = this.ctx.sim.position(playerId);
    if (d && pos) {
      const cfg = dealershipLevel(d.level);
      const plot = findPlot(d.plotId);
      if (cfg.repairDiscount > 0 && plot && isInsidePlot(plot, pos.x, pos.z, 6)) return { discount: cfg.repairDiscount };
    }
    throw new GameError('too_far', 'You need to be at the Repair Garage (or your dealership repair bay).');
  }

  async repair(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const useKits = val.bool(p.useKits, 'useKits');
    if (!Array.isArray(p.parts) || p.parts.length === 0 || p.parts.length > REPAIR_PARTS.length) throw new GameError('bad_request', 'Choose parts to repair.');
    const parts = [...new Set(p.parts.map((x) => val.oneOf(x, 'part', REPAIR_PARTS)))] as RepairPart[];
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const { discount } = this.repairLocation(playerId);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh);
      const quote = repairQuote(veh, parts, { inventory: player.inventory, useKits, laborDiscount: discount });
      const work = quote.lines.filter((l) => l.points > 0);
      if (work.length === 0) throw new GameError('bad_request', 'Those parts are already in perfect condition.');
      uow.debit(player, quote.total, 'repair', `Repaired ${work.map((l) => l.part).join(', ')} on ${modelDisplayName(veh.modelId)}`, veh.id);
      for (const line of work) {
        veh.condition[line.part] = line.target;
        if (line.kitApplied) {
          const kit = kitForPart(line.part)!;
          const qty = (player.inventory[kit.id] ?? 0) - 1;
          if (qty > 0) player.inventory[kit.id] = qty;
          else delete player.inventory[kit.id];
        }
      }
      veh.purchasePrice += quote.total;
      veh.serviceUntil = uow.now + Math.round(quote.seconds * 1000);
      player.stats.spentOnRepairs += quote.total;
      uow.grantXp(player, ECONOMY.xp.repairPerPart * work.length);
      uow.checkAchievements(player);
      await uow.commit();
      this.ctx.sim.markInteract(playerId);
      this.scheduleDone(playerId, veh, quote.seconds, 'Repair complete');
      log.info('repair', { playerId, vehicleId, cost: quote.total, parts: work.map((l) => l.part) });
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)!, cost: quote.total, seconds: quote.seconds };
    });
  }

  private scheduleDone(playerId: string, veh: Vehicle, seconds: number, title: string): void {
    const t = setTimeout(() => {
      this.repairTimers.delete(t);
      this.ctx.hub.notify(playerId, { kind: 'success', title, text: `Your ${modelDisplayName(veh.modelId)} is ready.` });
    }, Math.round(seconds * 1000));
    t.unref?.();
    this.repairTimers.add(t);
  }

  async wash(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const tierId = val.oneOf(p.tier, 'tier', ECONOMY.wash.tiers.map((t) => t.id));
    const tier = ECONOMY.wash.tiers.find((t) => t.id === tierId)!;
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      requireNear(this.ctx, playerId, 'wash');
      const driving = this.ctx.sim.driverOf(vehicleId) === playerId;
      if (driving) await this.vehicles.flushDrive(vehicleId, false);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh, { allowDriving: driving });
      if (veh.condition.cleanliness >= tier.cleanTo && (tier.interiorBonus === 0 || veh.condition.interior >= 100)) {
        throw new GameError('bad_request', 'That vehicle is already clean.');
      }
      uow.debit(player, tier.price, 'wash', `${tier.label}: ${modelDisplayName(veh.modelId)}`, veh.id);
      veh.condition.cleanliness = Math.max(veh.condition.cleanliness, tier.cleanTo);
      veh.condition.interior = clamp(veh.condition.interior + tier.interiorBonus, 0, 100);
      veh.purchasePrice += tier.price;
      if (!driving) veh.serviceUntil = uow.now + tier.seconds * 1000;
      uow.grantXp(player, ECONOMY.xp.wash);
      uow.checkAchievements(player);
      await uow.commit();
      this.ctx.sim.markInteract(playerId);
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)!, cost: tier.price };
    });
  }

  async refuel(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      requireNear(this.ctx, playerId, 'fuel');
      const driving = this.ctx.sim.driverOf(vehicleId) === playerId;
      if (driving) await this.vehicles.flushDrive(vehicleId, false);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh, { allowDriving: driving, allowedStatus: ['stored', 'world', 'displayed'] });
      const cost = fuelCost(veh.fuel);
      if (cost <= 0) throw new GameError('bad_request', 'The tank is already full.');
      uow.debit(player, cost, 'fuel', `Fuel: ${modelDisplayName(veh.modelId)}`, veh.id);
      veh.fuel = 100;
      await uow.commit();
      const live = this.ctx.state.vehicles.get(vehicleId)!;
      this.ctx.sim.refreshParams(live);
      return { vehicle: live, cost };
    });
  }

  async customize(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const modsIn = val.obj(p.mods);
    const slots = Object.keys(modsIn) as ModSlot[];
    if (slots.length === 0 || slots.some((s) => !Object.hasOwn(MOD_CATALOG, s))) throw new GameError('bad_request', 'Invalid customization.');
    for (const s of slots) {
      const option = modsIn[s];
      if (option !== null && typeof option !== 'string') throw new GameError('bad_request', 'Invalid customization.');
      if (!isValidModOption(s, option as string | null)) throw new GameError('bad_request', `Invalid ${s} option.`);
    }
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      requireNear(this.ctx, playerId, 'custom');
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh);
      let cost = 0;
      let changed = 0;
      for (const s of slots) {
        const next = modsIn[s] as string | null;
        if (veh.mods[s] === next) continue;
        const need = optionLevel(next);
        if (player.level < need) throw new GameError('forbidden', `${findOption(next)?.label ?? 'That option'} unlocks at level ${need}.`);
        cost += findOption(next)?.price ?? 0;
        (veh.mods as unknown as Record<string, string | null>)[s] = next;
        changed++;
      }
      if (changed === 0) throw new GameError('bad_request', 'Nothing to change.');
      if (cost > 0) uow.debit(player, cost, 'customize', `Customized ${modelDisplayName(veh.modelId)}`, veh.id);
      veh.purchasePrice += cost;
      player.stats.spentOnCustomization += cost;
      uow.grantXp(player, ECONOMY.xp.customize * changed);
      uow.checkAchievements(player);
      await uow.commit();
      this.ctx.sim.markInteract(playerId);
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)!, cost };
    });
  }

  async buyParts(playerId: string, params: unknown) {
    const p = val.obj(params);
    const itemId = val.oneOf(p.itemId, 'item', ECONOMY.parts.map((k) => k.id));
    const qty = val.int(p.qty, 'quantity', 1, 10);
    const item = ECONOMY.parts.find((k) => k.id === itemId)!;
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'parts');
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const have = player.inventory[itemId] ?? 0;
      if (have + qty > 99) throw new GameError('conflict', 'You cannot carry more of that item.');
      const cost = item.price * qty;
      uow.debit(player, cost, 'parts', `${qty}x ${item.label}`);
      player.inventory[itemId] = have + qty;
      await uow.commit();
      this.ctx.sim.markInteract(playerId);
      return { inventory: this.ctx.state.players.get(playerId)!.inventory, cost };
    });
  }

  dispose(): void {
    for (const t of this.repairTimers) clearTimeout(t);
    this.repairTimers.clear();
  }
}

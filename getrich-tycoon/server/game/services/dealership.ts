// Dealership ownership, upgrades and vehicle display slots.

import { ECONOMY, MAX_DEALERSHIP_LEVEL, dealershipLevel } from '../../../shared/economy.config';
import { sanitizeText } from '../../../shared/protocol';
import { findPlot, plotSlot, plotSlotCount } from '../../../shared/world';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireIdle, requireNearPlot, requireOwned } from '../guards';
import { maxAskingPrice } from './sales';

const log = createLogger('dealership');

function cleanName(raw: unknown): string {
  const name = sanitizeText(val.str(raw, 'name', 100), ECONOMY.dealership.nameMaxLength);
  if (name.length < 3) throw new GameError('bad_request', 'Dealership name must be at least 3 characters.');
  if (!/^[\p{L}\p{N} '&.\-!]+$/u.test(name)) throw new GameError('bad_request', 'Dealership name contains invalid characters.');
  return name;
}

export class DealershipService {
  constructor(private readonly ctx: Ctx) {}

  async buy(playerId: string, params: unknown) {
    const p = val.obj(params);
    const plotId = val.id(p.plotId, 'plot');
    const name = cleanName(p.name);
    const plot = findPlot(plotId);
    if (!plot) throw new GameError('not_found', 'Unknown plot.');
    return this.ctx.locks.run([K.player(playerId), K.plot(plotId)], async () => {
      if (this.ctx.state.dealerships.has(plotId)) throw new GameError('conflict', 'That plot is already owned.');
      requireNearPlot(this.ctx, playerId, plotId);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      if (player.dealershipPlotId) throw new GameError('conflict', 'You already own a dealership.');
      const lvl = dealershipLevel(1);
      uow.debit(player, lvl.price, 'dealership_buy', `Bought dealership plot ${plot.index}`);
      player.dealershipPlotId = plotId;
      uow.setDealership({ plotId, ownerId: playerId, ownerName: player.name, name, level: 1, createdAt: uow.now });
      uow.grantXp(player, ECONOMY.xp.dealershipUpgrade);
      uow.checkAchievements(player);
      await uow.commit();
      this.ctx.sim.rebuildStatic();
      this.ctx.hub.systemChat(`${player.name} opened a new dealership: "${name}"!`);
      log.info('dealership bought', { playerId, plotId });
      return { dealership: this.ctx.state.dealerships.get(plotId)! };
    });
  }

  async upgrade(playerId: string) {
    const plotId = this.ctx.state.players.get(playerId)?.dealershipPlotId;
    if (!plotId) throw new GameError('conflict', "You don't own a dealership yet.");
    return this.ctx.locks.run([K.player(playerId), K.plot(plotId)], async () => {
      requireNearPlot(this.ctx, playerId, plotId);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const d = uow.dealership(plotId);
      if (d.ownerId !== playerId) throw new GameError('forbidden', 'Not your dealership.');
      if (d.level >= MAX_DEALERSHIP_LEVEL) throw new GameError('conflict', 'Your dealership is already fully upgraded.');
      const next = dealershipLevel(d.level + 1);
      if (player.level < next.minPlayerLevel) throw new GameError('forbidden', `Requires player level ${next.minPlayerLevel}.`);
      uow.debit(player, next.price, 'dealership_upgrade', `Upgraded dealership to ${next.name}`);
      d.level = next.level;
      uow.grantXp(player, ECONOMY.xp.dealershipUpgrade);
      uow.checkAchievements(player);
      await uow.commit();
      this.ctx.sim.rebuildStatic();
      this.ctx.hub.systemChat(`${player.name}'s dealership "${d.name}" was upgraded to ${next.name}!`);
      log.info('dealership upgraded', { playerId, level: d.level });
      return { dealership: this.ctx.state.dealerships.get(plotId)! };
    });
  }

  async rename(playerId: string, params: unknown) {
    const p = val.obj(params);
    const name = cleanName(p.name);
    const plotId = this.ctx.state.players.get(playerId)?.dealershipPlotId;
    if (!plotId) throw new GameError('conflict', "You don't own a dealership yet.");
    return this.ctx.locks.run([K.plot(plotId)], async () => {
      const uow = this.ctx.state.begin();
      const d = uow.dealership(plotId);
      if (d.ownerId !== playerId) throw new GameError('forbidden', 'Not your dealership.');
      d.name = name;
      await uow.commit();
      return { dealership: this.ctx.state.dealerships.get(plotId)! };
    });
  }

  async place(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const slot = val.int(p.slot, 'slot', 0, 11);
    const price = p.price === null ? null : val.price(p.price);
    const rotation = val.num(p.rotation, 'rotation', -Math.PI * 2, Math.PI * 2);
    const plotId = this.ctx.state.players.get(playerId)?.dealershipPlotId;
    if (!plotId) throw new GameError('conflict', "You don't own a dealership yet.");
    const plot = findPlot(plotId)!;
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId), K.plot(plotId)], async () => {
      requireNearPlot(this.ctx, playerId, plotId);
      const d = this.ctx.state.dealerships.get(plotId)!;
      if (slot >= plotSlotCount(d.level)) throw new GameError('bad_request', 'That display slot is not available at your dealership level.');
      for (const other of this.ctx.state.vehicles.values()) {
        if (other.plotId === plotId && other.slot === slot && other.id !== vehicleId) throw new GameError('conflict', 'That slot is occupied.');
      }
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh, { allowedStatus: ['stored', 'world', 'displayed'] });
      if (price !== null) {
        const max = maxAskingPrice(this.ctx, veh);
        if (price > max) throw new GameError('bad_request', `Asking price is too high (max $${max.toLocaleString('en-US')}).`);
      }
      const pos = plotSlot(plot, slot);
      veh.status = 'displayed';
      veh.plotId = plotId;
      veh.slot = slot;
      veh.salePrice = price;
      veh.x = pos.x;
      veh.z = pos.z;
      veh.rotation = rotation;
      await uow.commit();
      this.ctx.sim.rebuildDynamic();
      this.ctx.sim.markInteract(playerId);
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)! };
    });
  }

  async remove(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      if (veh.status !== 'displayed') throw new GameError('conflict', 'That vehicle is not on display.');
      veh.status = 'stored';
      veh.plotId = null;
      veh.slot = null;
      veh.salePrice = null;
      await uow.commit();
      this.ctx.sim.rebuildDynamic();
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)! };
    });
  }

  async setPrice(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const price = p.price === null ? null : val.price(p.price);
    const rotation = p.rotation === undefined ? undefined : val.num(p.rotation, 'rotation', -Math.PI * 2, Math.PI * 2);
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      if (veh.status !== 'displayed' && veh.status !== 'listed') throw new GameError('conflict', 'That vehicle is not on display or listed.');
      if (price === null && veh.status === 'listed') throw new GameError('bad_request', 'Classified listings need a price. Unlist it instead.');
      if (price !== null) {
        const max = maxAskingPrice(this.ctx, veh);
        if (price > max) throw new GameError('bad_request', `Asking price is too high (max $${max.toLocaleString('en-US')}).`);
      }
      veh.salePrice = price;
      if (rotation !== undefined && veh.status === 'displayed') veh.rotation = rotation;
      await uow.commit();
      this.ctx.sim.rebuildDynamic();
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)! };
    });
  }
}

// Owned vehicle management: classifieds, quick sale, spawning, driving.

import { ECONOMY } from '../../../shared/economy.config';
import { CHAR_RADIUS, resolveCircle, vehicleCircles } from '../../../shared/physics';
import { calculateVehicleStats } from '../../../shared/tuningSystem';
import { quickSellPrice } from '../../../shared/valuation';
import { clamp } from '../../../shared/util';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireIdle, requireOwned, requireVehicle } from '../guards';
import { assertAskingPrice, settleSale } from './sales';

const log = createLogger('vehicles');
const MAX_SPAWNED = 2;
const ENTER_RADIUS = 5;

export class VehicleService {
  constructor(private readonly ctx: Ctx) {}

  async listClassifieds(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const price = val.price(p.price);
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh, { allowedStatus: ['stored', 'world'] });
      assertAskingPrice(this.ctx, veh, price);
      uow.debit(player, ECONOMY.fees.classifiedListingFee, 'listing_fee', `Classifieds listing: ${modelDisplayName(veh.modelId)}`, veh.id);
      veh.status = 'listed';
      veh.salePrice = price;
      await uow.commit();
      log.info('vehicle listed', { playerId, vehicleId, price });
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)! };
    });
  }

  async unlist(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      if (veh.status !== 'listed') throw new GameError('conflict', 'That vehicle is not listed.');
      veh.status = 'stored';
      veh.salePrice = null;
      await uow.commit();
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)! };
    });
  }

  async quickSell(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const expected = val.int(p.expectedPrice, 'price', 0, ECONOMY.limits.maxPrice);
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh, { allowedStatus: ['stored', 'world', 'displayed'] });
      const price = quickSellPrice(veh, this.ctx.state.trends);
      if (Math.abs(price - expected) > Math.max(5, price * 0.002)) {
        throw new GameError('conflict', `Market moved: the wholesaler now offers $${price.toLocaleString('en-US')}.`);
      }
      settleSale(this.ctx, uow, player, veh, price, { feeRate: 0, kind: 'quick_sell', buyerId: null, buyerName: 'a wholesaler' });
      uow.deleteVehicle(veh.id);
      uow.checkAchievements(player);
      await uow.commit();
      log.info('quick sell', { playerId, vehicleId, price });
      return { price };
    });
  }

  /** Bring an owned vehicle next to the player. */
  async spawn(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh, { allowedStatus: ['stored', 'world'] });
      const pos = this.ctx.sim.position(playerId);
      if (!pos) throw new GameError('conflict', 'You are not in the world.');
      if (this.ctx.sim.chars.get(playerId)?.drivingId) throw new GameError('conflict', 'Exit your vehicle first.');
      const spawned = this.ctx.state.vehiclesOf(playerId).filter((x) => x.status === 'world' && x.id !== vehicleId);
      if (spawned.length >= MAX_SPAWNED) throw new GameError('conflict', `You can have at most ${MAX_SPAWNED} vehicles out. Store one first.`);
      const spot = this.findSpawnSpot(pos.x, pos.z, pos.rot, veh.modelId, vehicleId);
      veh.status = 'world';
      veh.x = spot.x;
      veh.z = spot.z;
      veh.rotation = spot.rot;
      await uow.commit();
      this.ctx.sim.rebuildDynamic();
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)! };
    });
  }

  private findSpawnSpot(x: number, z: number, rot: number, modelId: string, selfId: string) {
    const model = getModel(modelId);
    const world = this.ctx.sim.collisionWorld;
    const hl = model.shape.length / 2;
    const hw = model.shape.width / 2;
    for (const dist of [4, 6.5, 9]) {
      for (let i = 0; i < 8; i++) {
        const a = rot + Math.PI / 2 + (i * Math.PI) / 4;
        const cx = x + Math.sin(a) * dist;
        const cz = z + Math.cos(a) * dist;
        const circles = vehicleCircles(cx, cz, rot, hl, hw);
        const blocked = circles.some((c) => resolveCircle(c.x, c.z, c.r, world, selfId).hit);
        // Leave room for the player to stand.
        const tooClose = Math.hypot(cx - x, cz - z) < hl + CHAR_RADIUS;
        if (!blocked && !tooClose) return { x: cx, z: cz, rot };
      }
    }
    throw new GameError('conflict', 'No room to park a vehicle here. Move to an open area (e.g. a road or parking lot).');
  }

  async store(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      requireOwned(veh, player);
      requireIdle(this.ctx, veh, { allowedStatus: ['world'] });
      veh.status = 'stored';
      await uow.commit();
      this.ctx.sim.rebuildDynamic();
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)! };
    });
  }

  async enter(playerId: string, params: unknown) {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const veh = requireVehicle(this.ctx, vehicleId);
      const player = this.ctx.state.players.get(playerId)!;
      requireOwned(veh, player);
      requireIdle(this.ctx, veh, { allowedStatus: ['world'] });
      const c = this.ctx.sim.chars.get(playerId);
      if (!c) throw new GameError('conflict', 'You are not in the world.');
      if (c.drivingId) throw new GameError('conflict', 'You are already driving.');
      if (Math.hypot(c.x - veh.x, c.z - veh.z) > ENTER_RADIUS + getModel(veh.modelId).shape.length / 2) {
        throw new GameError('too_far', 'Get closer to the vehicle.');
      }
      this.ctx.sim.startDriving(playerId, veh);
      this.ctx.hub.broadcast('vehicle.upsert', this.ctx.state.toPublicVehicle(veh));
      return { vehicleId };
    });
  }

  async exit(playerId: string) {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c?.drivingId) throw new GameError('conflict', 'You are not driving.');
    const vehicleId = c.drivingId;
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      await this.flushDrive(vehicleId, true);
      const pos = this.ctx.sim.stopDriving(playerId) ?? { x: c.x, z: c.z };
      const veh = this.ctx.state.vehicles.get(vehicleId);
      if (veh) this.ctx.hub.broadcast('vehicle.upsert', this.ctx.state.toPublicVehicle(veh));
      this.ctx.sim.rebuildDynamic();
      return pos;
    });
  }

  /**
   * Persist accumulated driving (mileage, fuel, dirt, collision damage, position).
   * Must be called while holding the vehicle lock (and the player lock when `withPlayer`).
   */
  async flushDrive(vehicleId: string, withPlayer: boolean): Promise<void> {
    const flush = this.ctx.sim.takeFlush(vehicleId);
    if (!flush) return;
    const live = this.ctx.state.vehicles.get(vehicleId);
    if (!live) return;
    const uow = this.ctx.state.begin();
    const veh = uow.vehicle(vehicleId);
    const km = flush.distance * ECONOMY.world.mileageScale;
    veh.mileage = Math.round((veh.mileage + km) * 10) / 10;
    veh.fuel = clamp(veh.fuel - km * ECONOMY.fuel.consumptionPerKm, 0, 100);
    veh.condition.cleanliness = clamp(veh.condition.cleanliness - km * ECONOMY.world.dirtPerKm, 0, 100);
    if (flush.damage > 0) {
      veh.condition.body = Math.round(clamp(veh.condition.body - flush.damage, 0, 100));
    }
    // Tuned engines wear while driven (forged internals keep it in check). Conditions are whole
    // numbers, so the fractional part is applied with matching probability.
    const stress = calculateVehicleStats(getModel(veh.modelId), veh.mods.tuning).stress;
    if (km > 0 && stress > 1) {
      const wear = km * ECONOMY.tuning.engineWearPerKm * (stress - 1);
      const whole = Math.floor(wear) + (this.ctx.rng() < wear - Math.floor(wear) ? 1 : 0);
      if (whole > 0) veh.condition.engine = clamp(veh.condition.engine - whole, 0, 100);
    }
    veh.x = flush.dyn.x;
    veh.z = flush.dyn.z;
    veh.rotation = flush.dyn.rot;
    if (withPlayer && veh.ownerId && km > 0) {
      const owner = uow.player(veh.ownerId);
      owner.stats.distanceDriven = Math.round((owner.stats.distanceDriven + km) * 100) / 100;
      uow.checkAchievements(owner);
    }
    await uow.commit();
    this.ctx.sim.refreshParams(this.ctx.state.vehicles.get(vehicleId)!);
  }
}

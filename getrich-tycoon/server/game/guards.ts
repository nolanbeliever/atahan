// Common validation guards used by services.

import { ECONOMY } from '../../shared/economy.config';
import type { Vehicle } from '../../shared/types';
import { findPlot, isInsidePlot, type InteractKind } from '../../shared/world';
import { GameError } from '../errors';
import type { Ctx } from './context';
import type { PlayerRecord } from './records';

const PLACE_LABEL: Record<InteractKind, string> = {
  market: 'the Used Vehicle Market',
  auction: 'the Auction House',
  repair: 'the Repair Garage',
  parts: 'the Parts Depot',
  wash: 'the Car Wash',
  fuel: 'the Fuel Station',
  bank: 'the Bank',
  custom: 'the Customization Garage',
  plot: 'your dealership',
  drag: 'the Drag Strip',
  pawn: 'the Pawn Shop',
  sanayi: 'the Sanayi garage',
  ammu: 'Ammu-Nation',
  hospital: 'the hospital',
  motogear: 'Moto Gear (the helmet shop beside the hospital)',
  hitman: 'the contact in the alley',
  showroom: 'the showroom (Galeri Bulvarı, across the bridges)',
  realestate: 'Emlak Dünyası (the estate agent on the Chroma corner)',
};

export function requireNear(ctx: Ctx, playerId: string, kind: InteractKind): void {
  if (!ctx.sim.isNearInteractable(playerId, kind)) throw new GameError('too_far', `You need to be at ${PLACE_LABEL[kind]}.`);
}

export function requireNearPlot(ctx: Ctx, playerId: string, plotId: string): void {
  const plot = findPlot(plotId);
  const pos = ctx.sim.position(playerId);
  if (!plot || !pos) throw new GameError('too_far', 'You need to be at the dealership.');
  if (!isInsidePlot(plot, pos.x, pos.z, ECONOMY.dealership.manageRadius - 19)) {
    throw new GameError('too_far', 'You need to be at the dealership lot.');
  }
}

export function requireOwned(v: Vehicle, player: PlayerRecord): void {
  if (v.ownerId !== player.id) throw new GameError('forbidden', "You don't own that vehicle.");
}

/** The vehicle must be idle: not driven, not in the shop, not consigned. */
export function requireIdle(ctx: Ctx, v: Vehicle, opts: { allowDriving?: boolean; allowedStatus?: Vehicle['status'][] } = {}): void {
  if (!opts.allowDriving && ctx.sim.isDriven(v.id)) throw new GameError('conflict', 'Exit the vehicle first.');
  if (v.serviceUntil > Date.now()) throw new GameError('conflict', 'That vehicle is still being serviced.');
  const allowed = opts.allowedStatus ?? ['stored', 'world', 'displayed'];
  if (!allowed.includes(v.status)) {
    const why: Record<string, string> = {
      listed: 'That vehicle is listed on the classifieds. Unlist it first.',
      auction: 'That vehicle is at auction.',
      displayed: 'Remove that vehicle from your display first.',
      world: 'Store that vehicle first.',
      stored: 'That vehicle is in storage.',
      market: 'That vehicle is not yours.',
      stolen: "That car is stolen: it can't be sold or stored. Strip it at the Sanayi.",
      testdrive: "That's the showroom's test-drive car: it goes back when the drive ends.",
    };
    throw new GameError('conflict', why[v.status] ?? 'That vehicle is busy.');
  }
}

export function requireVehicle(ctx: Ctx, vehicleId: string): Vehicle {
  const v = ctx.state.vehicles.get(vehicleId);
  if (!v) throw new GameError('not_found', 'Vehicle not found.');
  return v;
}

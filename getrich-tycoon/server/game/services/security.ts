// Security gear at Chroma Customs (shared/security.ts): fit a hidden compartment, run-flat tyres or
// level-3 armour to one of your cars (or patch up worn armour), and Z in the car: hide the goods you
// carry in the compartment, or take them back out. The police search (an arrest) is in telegram.ts,
// the armour and the tyres in combat.ts and police.ts.

import { SECURITY, SECURITY_DEFS, SECURITY_ITEMS, armorRepairPrice } from '../../../shared/security';
import type { Vehicle } from '../../../shared/types';
import { getModel, modelDisplayName } from '../../../shared/vehicles';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireNear } from '../guards';
import type { CombatService } from './combat';
import { GOODS_ITEM, type DealService } from './telegram';

const log = createLogger('security');

export class SecurityService {
  constructor(
    private readonly ctx: Ctx,
    private readonly combat: CombatService,
    private readonly deals: DealService,
  ) {}

  /** Fit a piece of gear (or, for armour that's already on, patch it up). */
  async buy(playerId: string, params: unknown): Promise<{ vehicle: Vehicle }> {
    const p = val.obj(params);
    const vehicleId = val.id(p.vehicleId, 'vehicle');
    const item = val.oneOf(p.item, 'item', SECURITY_ITEMS);
    const def = SECURITY_DEFS[item];
    return this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      requireNear(this.ctx, playerId, 'custom');
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      if (veh.ownerId !== playerId) throw new GameError('forbidden', "You don't own that vehicle.");
      if (veh.mods.strip || !['stored', 'world'].includes(veh.status)) throw new GameError('conflict', 'Bu araca şu an takılamaz.');
      if (def.carsOnly && getModel(veh.modelId).specs.kind === 'bike') throw new GameError('conflict', 'Motosiklete ve ATV\'ye zırh takılamaz.');
      const name = modelDisplayName(veh.modelId);
      let repaired = false;
      if (veh.mods[item]) {
        const armor = item === 'armor' ? this.combat.armorOf(vehicleId) ?? 100 : 100;
        if (item !== 'armor' || armor >= 100) throw new GameError('conflict', `${def.name} zaten takılı.`);
        uow.debit(player, armorRepairPrice(armor), 'security', `Zırh onarımı: ${name}`, veh.id);
        repaired = true;
      } else {
        uow.debit(player, def.price, 'security', `${def.name}: ${name}`, veh.id);
        veh.mods = { ...veh.mods, [item]: true };
      }
      await uow.commit();
      const live = this.ctx.state.vehicles.get(vehicleId)!;
      if (item === 'armor') this.combat.resetArmor(vehicleId);
      // Armour weighs: the car drives a little heavier.
      if (this.ctx.sim.isDriven(vehicleId)) this.ctx.sim.refreshParams(live);
      log.info(repaired ? 'armour repaired' : 'security gear fitted', { playerId, vehicleId, item });
      return { vehicle: live };
    });
  }

  /** Z in (or right by) the car: the goods you carry into the hidden compartment, or back out. */
  async stash(playerId: string, params: unknown): Promise<{ vehicle: Vehicle; goods: number; moved: number }> {
    const vehicleId = val.id(val.obj(params).vehicleId, 'vehicle');
    const out = await this.ctx.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const veh = uow.vehicle(vehicleId);
      if (veh.ownerId !== playerId) throw new GameError('forbidden', "You don't own that vehicle.");
      if (!veh.mods.stash) throw new GameError('conflict', 'Bu araçta gizli zula yok (Chroma Customs · Güvenlik).');
      const c = this.ctx.sim.chars.get(playerId);
      const inside = c?.drivingId === vehicleId || c?.ridingId === vehicleId;
      const d = this.ctx.sim.drives.get(vehicleId);
      const pos = d ? { x: d.dyn.x, z: d.dyn.z } : veh.status === 'world' ? { x: veh.x, z: veh.z } : null;
      const near = !!c && !!pos && Math.hypot(c.x - pos.x, c.z - pos.z) <= getModel(veh.modelId).shape.length / 2 + 2;
      if (!inside && !near) throw new GameError('too_far', 'Zula için aracın içinde ya da yanında ol.');
      const goods = player.inventory[GOODS_ITEM] ?? 0;
      const hidden = veh.mods.stashGrams ?? 0;
      let moved = 0;
      if (goods > 0) {
        moved = Math.min(goods, SECURITY.stashCapacity - hidden);
        if (moved <= 0) throw new GameError('conflict', `Zula dolu (${SECURITY.stashCapacity} gr).`);
      } else if (hidden > 0) {
        moved = -hidden;
      } else throw new GameError('conflict', 'Üzerinde de zulada da mal yok.');
      const left = goods - moved;
      if (left > 0) player.inventory[GOODS_ITEM] = left;
      else delete player.inventory[GOODS_ITEM];
      veh.mods = { ...veh.mods, stashGrams: hidden + moved };
      await uow.commit();
      return { vehicle: this.ctx.state.vehicles.get(vehicleId)!, goods: left, moved };
    });
    this.deals.send(playerId);
    return out;
  }
}

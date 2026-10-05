// Motorcycles and quads: the Moto Gear helmet shop, wearing a helmet, and coming off a bike. A
// flipped wheelie or a hard hit throws the rider and the pillion off; the crash hurts (a helmet
// takes 60% off, and without one a fast crash is WASTED).

import { ECONOMY } from '../../../shared/economy.config';
import { HELMETS, HELMET_COLORS, VISORS, crashDamage, helmet, helmetItem, visor, visorItem, type CrashEvent, type HelmetId, type VisorId } from '../../../shared/helmets';
import type { Appearance } from '../../../shared/types';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireNear } from '../guards';
import type { CombatService } from './combat';
import type { VehicleService } from './vehicles';

const log = createLogger('moto');

export class MotoService {
  constructor(
    private readonly ctx: Ctx,
    private readonly combat: CombatService,
    private readonly vehicles: VehicleService,
  ) {
    ctx.sim.bikeCrashListeners.push((vehicleId, kmh, flipped) => this.crash(vehicleId, kmh, flipped));
  }

  /** Buy a helmet shell or a visor at Moto Gear; a new helmet goes straight on. */
  async buy(playerId: string, params: unknown): Promise<{ appearance: Appearance }> {
    const p = val.obj(params);
    const kind = val.oneOf(p.kind, 'kind', ['helmet', 'visor'] as const);
    const id = kind === 'helmet' ? val.oneOf(p.id, 'helmet', HELMETS.map((h) => h.id)) : val.oneOf(p.id, 'visor', VISORS.map((v) => v.id));
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'motogear');
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const inv = player.inventory;
      if (kind === 'helmet') {
        const h = helmet(id)!;
        if ((inv[helmetItem(h.id)] ?? 0) > 0) throw new GameError('conflict', 'You already own that helmet.');
        uow.debit(player, h.price, 'moto_gear', `Moto Gear: ${h.name} helmet`);
        inv[helmetItem(h.id)] = 1;
        player.appearance = { ...player.appearance, helmet: h.id, visor: player.appearance.visor ?? 'clear', helmetColor: player.appearance.helmetColor ?? HELMET_COLORS[0] };
        uow.notify(playerId, { kind: 'success', title: `${h.name} helmet`, text: 'It goes on whenever you ride a motorcycle or a quad: 60% less crash damage, and it can save your life.' });
      } else {
        const v = visor(id)!;
        if (v.id === 'clear' || (inv[visorItem(v.id)] ?? 0) > 0) throw new GameError('conflict', 'You already have that visor.');
        uow.debit(player, v.price, 'moto_gear', `Moto Gear: ${v.name} visor`);
        inv[visorItem(v.id)] = 1;
        if (player.appearance.helmet) player.appearance = { ...player.appearance, visor: v.id };
      }
      await uow.commit();
      return { appearance: this.ctx.state.players.get(playerId)!.appearance };
    });
  }

  /** Put on one of your helmets with a visor and colour (or none). */
  async wear(playerId: string, params: unknown): Promise<{ appearance: Appearance }> {
    const p = val.obj(params);
    const h: HelmetId | null = p.helmet === null ? null : val.oneOf(p.helmet, 'helmet', HELMETS.map((x) => x.id));
    const v: VisorId = val.oneOf(p.visor ?? 'clear', 'visor', VISORS.map((x) => x.id));
    const color = val.oneOf(p.color ?? HELMET_COLORS[0], 'color', HELMET_COLORS);
    return this.ctx.locks.run([K.player(playerId)], async () => {
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const inv = player.inventory;
      if (h && (inv[helmetItem(h)] ?? 0) < 1) throw new GameError('not_found', 'You do not own that helmet. Moto Gear (beside the hospital) sells them.');
      if (v !== 'clear' && (inv[visorItem(v)] ?? 0) < 1) throw new GameError('not_found', 'You do not own that visor.');
      player.appearance = { ...player.appearance, helmet: h, visor: v, helmetColor: color };
      await uow.commit();
      return { appearance: this.ctx.state.players.get(playerId)!.appearance };
    });
  }

  /** Wearing a helmet (on a bike it is always on). */
  helmeted(playerId: string): boolean {
    return !!helmet(this.ctx.state.players.get(playerId)?.appearance.helmet);
  }

  /** A bike went down: everyone on it comes off and gets hurt. */
  crash(vehicleId: string, kmh: number, flipped: boolean): void {
    const sim = this.ctx.sim;
    const d = sim.drives.get(vehicleId);
    if (!d) return;
    const now = Date.now();
    // One crash per hit (contact can last a few steps).
    if (now - (d.bikeCrashAt ?? 0) < 1500) return;
    d.bikeCrashAt = now;
    const driver = sim.driverOf(vehicleId);
    const ids = [...(driver ? [driver] : []), ...sim.ridersOf(vehicleId).map((r) => r.id)];
    const { x, z } = d.dyn;
    const riders: CrashEvent['riders'] = [];
    // Thrown off only above the safe speed (a nudge at a walk keeps you on).
    if (kmh < ECONOMY.bikes.safeKmh && !flipped) return;
    // The bike stops (brakes held) and everyone gets off (the passengers with the driver).
    d.hold = true;
    if (driver) {
      void this.vehicles.exit(driver).catch((err: unknown) => {
        log.warn('crash exit failed', { vehicleId, err: String(err) });
        sim.stopDriving(driver);
      });
    }
    for (const id of ids) {
      const helmeted = this.helmeted(id);
      const hp = this.combat.healthView(id).hp;
      const damage = crashDamage(kmh, helmeted, hp);
      riders.push({ id, helmet: helmeted, damage });
      if (damage > 0) this.combat.hurtPlayer(id, damage, x, z, now);
      this.ctx.hub.notify(id, helmeted
        ? { kind: 'warning', title: 'KAZA! Kask hayat kurtardı', text: `${Math.round(kmh)} km/s düştün. Kask hasarı %60 azalttı (-${damage} can).` }
        : damage >= hp && damage > 0
          ? { kind: 'error', title: 'KASKSIZ KAZA', text: `${Math.round(kmh)} km/s kasksız düştün. Moto Gear'dan (hastanenin yanında) bir kask al!` }
          : { kind: 'warning', title: 'KAZA!', text: `${Math.round(kmh)} km/s düştün (-${damage} can). Kask takarsan hasar %60 azalır.` });
    }
    const ev: CrashEvent = { x, z, riders, kmh: Math.round(kmh), flipped };
    this.ctx.hub.broadcast('moto.crash', ev);
    log.info('bike crash', { vehicleId, kmh: Math.round(kmh), flipped, riders: riders.length });
  }
}

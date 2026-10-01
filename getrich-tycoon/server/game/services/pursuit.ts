// Police tracking of a freshly stolen car ("VEHICLE STOLEN - POLICE TRACKING 03:00").
//
// Picking a lock, or driving a stolen car into a CCTV camera's cone, starts a 3-minute countdown and
// puts the police on the car (2 stars). Every time a camera or a police car sees the car again the
// countdown starts over. It only runs while the thief is in the car. When it runs out the car is
// theirs for good ("CAR STOLEN SUCCESSFULLY!"); arrested on the way, the car is seized and goes back
// to its owner (see PoliceService.release).

import { CCTV_CAMERAS, cameraSees, type PursuitOutcome, type PursuitView } from '../../../shared/cctv';
import { ECONOMY } from '../../../shared/economy.config';
import { modelDisplayName } from '../../../shared/vehicles';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';
import type { PoliceService } from './police';

const log = createLogger('pursuit');
const P = ECONOMY.pursuit;

interface Track {
  vehicleId: string;
  modelId: string;
  left: number;
  paused: boolean;
  seenAt: number;
  seenBy: PursuitView['seenBy'];
  sentAt: number;
  sentKey: string;
  finishing: boolean;
}

export class PursuitService {
  private tracks = new Map<string, Track>();

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
  ) {
    police.seizeListeners.push((playerId, vehicleId) => {
      const t = this.tracks.get(playerId);
      if (t && t.vehicleId === vehicleId) this.end(playerId, 'seized');
    });
  }

  /** The tracking of a player (tests, debugging). */
  trackOf(playerId: string): Readonly<Track> | undefined {
    return this.tracks.get(playerId);
  }

  /** Start (or restart) tracking a stolen car: a lockpick, or a camera saw it. */
  start(playerId: string, vehicleId: string, by: 'lockpick' | 'camera', now = Date.now()): void {
    const v = this.ctx.state.vehicles.get(vehicleId);
    if (!v || v.status !== 'stolen' || v.ownerId !== playerId) return;
    this.tracks.set(playerId, { vehicleId, modelId: v.modelId, left: P.seconds, paused: false, seenAt: now, seenBy: by, sentAt: 0, sentKey: '', finishing: false });
    this.police.raiseHeat(playerId, P.heat);
    this.send(playerId, true);
  }

  forget(playerId: string): void {
    this.tracks.delete(playerId);
  }

  /** Every simulation tick: cameras, police sight, the countdown. */
  tick(dt: number, now = Date.now()): void {
    // Stolen cars driven into a camera's view start a tracking.
    for (const c of this.ctx.sim.chars.values()) {
      if (!c.drivingId || this.tracks.get(c.id)?.vehicleId === c.drivingId) continue;
      const v = this.ctx.state.vehicles.get(c.drivingId);
      if (!v || v.status !== 'stolen' || v.mods.strip) continue;
      const d = this.ctx.sim.drives.get(c.drivingId);
      if (d && CCTV_CAMERAS.some((cam) => cameraSees(cam, d.dyn.x, d.dyn.z, now))) this.start(c.id, c.drivingId, 'camera', now);
    }
    for (const [playerId, t] of this.tracks) {
      if (t.finishing) continue;
      const v = this.ctx.state.vehicles.get(t.vehicleId);
      // Papers, the lift, scrapped, recovered: the tracking is over.
      if (!v || v.status !== 'stolen' || v.mods.strip || v.ownerId !== playerId || !this.ctx.hub.isOnline(playerId)) {
        this.end(playerId, 'ended');
        continue;
      }
      const c = this.ctx.sim.chars.get(playerId);
      const inCar = !!c && c.drivingId === t.vehicleId;
      t.paused = !inCar;
      if (inCar) {
        const d = this.ctx.sim.drives.get(t.vehicleId)!;
        const cam = CCTV_CAMERAS.some((cam) => cameraSees(cam, d.dyn.x, d.dyn.z, now));
        const cop = !cam && this.police.nearestUnit(playerId, d.dyn.x, d.dyn.z) < P.policeSight;
        if (cam || cop) {
          if (now - t.seenAt > 1500 || t.left < P.seconds - 2) {
            t.seenBy = cam ? 'camera' : 'police';
            t.seenAt = now;
          }
          t.left = P.seconds;
          if (cam) this.police.raiseHeat(playerId, P.heat);
        } else {
          t.left = Math.max(0, t.left - dt);
        }
        if (t.left <= 0) {
          t.finishing = true;
          void this.success(playerId, t);
          continue;
        }
      }
      this.send(playerId);
    }
  }

  /** Unseen for three minutes: the car is the thief's own now. */
  private async success(playerId: string, t: Track): Promise<void> {
    try {
      await this.ctx.locks.run([K.player(playerId), K.vehicle(t.vehicleId)], async () => {
        const live = this.ctx.state.vehicles.get(t.vehicleId);
        if (!live || live.status !== 'stolen' || live.ownerId !== playerId) return this.end(playerId, 'ended');
        const owned = this.ctx.state.vehiclesOf(playerId).filter((v) => v.status !== 'stolen').length;
        if (owned >= ECONOMY.player.maxOwnedVehicles) {
          this.ctx.hub.notify(playerId, { kind: 'warning', title: 'Garaj dolu', text: `Polis izini kaybetti ama garajında yer yok: ${modelDisplayName(live.modelId)} çalıntı olarak kaldı. Sanayi'de parçala ya da yer açıp evrak çıkar.` });
          return this.end(playerId, 'garage_full');
        }
        const uow = this.ctx.state.begin();
        const veh = uow.vehicle(t.vehicleId);
        veh.status = 'world';
        uow.grantXp(uow.player(playerId), P.xp);
        uow.notify(playerId, { kind: 'success', title: 'CAR STOLEN SUCCESSFULLY!', text: `Araç Tamamen Senindir: ${modelDisplayName(veh.modelId)}. Garajına koyabilir ya da Marketplace'te satabilirsin.` });
        await uow.commit();
        log.info('stolen car kept', { playerId, vehicleId: t.vehicleId });
        this.end(playerId, 'success');
      });
    } catch (err) {
      log.error('pursuit success failed', { playerId, error: (err as Error).message });
      this.end(playerId, 'ended');
    }
  }

  private end(playerId: string, outcome: PursuitOutcome): void {
    const t = this.tracks.get(playerId);
    if (!t) return;
    this.tracks.delete(playerId);
    this.ctx.hub.sendTo(playerId, 'pursuit.update', null);
    this.ctx.hub.sendTo(playerId, 'pursuit.result', { outcome, vehicleId: t.vehicleId, modelId: t.modelId });
  }

  private send(playerId: string, force = false): void {
    const t = this.tracks.get(playerId);
    if (!t) return;
    const now = Date.now();
    const key = `${Math.ceil(t.left)}|${t.paused}|${t.seenAt}`;
    if (!force && key === t.sentKey && now - t.sentAt < 2000) return;
    t.sentKey = key;
    t.sentAt = now;
    const view: PursuitView = { vehicleId: t.vehicleId, modelId: t.modelId, left: t.left, total: P.seconds, paused: t.paused, seenAt: t.seenAt, seenBy: t.seenBy };
    this.ctx.hub.sendTo(playerId, 'pursuit.update', view);
  }
}

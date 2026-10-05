// Bridge tolls and number-plate cameras (shared/tolls.ts), and the "Geçiş Geçmişi / Ceza Bildirimi"
// history every player keeps for the session.
//
//   * Every tick each driven car's move is checked against the toll line (eastbound, on the ground,
//     across the plaza) and the camera lines (either way, on the camera's level).
//   * Toll: at or under the speed limit the arm lifts and $250 is paid (cash, then the bank); faster,
//     or without the money, it is an evasion: a $1,500 fine (cash, then the bank, never below zero).
//   * ANPR: a readable real plate on a car with a theft record, a stolen car or the car of someone the
//     police want adds a star (the crew shares it). A flipped plate isn't read; a fake one reads clean.
//     The same camera doesn't read the same car again for a while.
//   * The police checkpoints (police.ts) report into the same history.

import { KMH_PER_MS } from '../../../shared/drivetrain';
import { ECONOMY } from '../../../shared/economy.config';
import { plateText } from '../../../shared/plates';
import {
  TOLL_HISTORY_MAX,
  anprCrossed,
  crossesTollEast,
  plateRead,
  tollOutcome,
  tollPlazaAt,
  type AnprCamera,
  type TollEvent,
} from '../../../shared/tolls';
import { newId } from '../../ids';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';
import type { PoliceService } from './police';

const log = createLogger('tolls');

/** Take up to `amount` from the cash, then the bank (never below zero). */
function charge(p: { money: number; bank: number }, amount: number): { cash: number; bank: number } {
  const cash = Math.max(0, Math.min(p.money, amount));
  const bank = Math.max(0, Math.min(p.bank, amount - cash));
  return { cash, bank };
}

export class TollService {
  /** Where each driven car was last tick (x, z, level). */
  private prev = new Map<string, { x: number; z: number; deck: number }>();
  private history = new Map<string, TollEvent[]>();
  /** camera:vehicle -> when it was last read. */
  private reads = new Map<string, number>();
  private busy = new Set<string>();

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
  ) {
    police.checkpointListeners.push((playerId, e) =>
      this.record(playerId, {
        kind: e.kind,
        place: e.name,
        amount: e.reward,
        plate: null,
        modelId: null,
        stars: 0,
        text: e.kind === 'checkpoint' ? 'POLİS KONTROL NOKTASI: barikatı yar veya kaç!' : `Barikat yarıldı! +$${e.reward.toLocaleString('en-US')}`,
      }),
    );
  }

  /** Every tick: check each driven car's move against the toll and camera lines. */
  tick(now = Date.now()): void {
    const seen = new Set<string>();
    for (const d of this.ctx.sim.drives.values()) {
      const deck = d.dyn.deck ?? 0;
      const p = this.prev.get(d.vehicleId);
      this.prev.set(d.vehicleId, { x: d.dyn.x, z: d.dyn.z, deck });
      seen.add(d.vehicleId);
      // A teleport (or a jump across the map) is not a pass.
      if (!p || p.deck !== deck || Math.hypot(d.dyn.x - p.x, d.dyn.z - p.z) > 20) continue;
      if (deck === 0 && crossesTollEast(p.x, d.dyn.x) && tollPlazaAt(d.dyn.x, d.dyn.z)) void this.toll(d.playerId, d.vehicleId, Math.abs(d.dyn.speed) * KMH_PER_MS, d.dyn.x, d.dyn.z);
      const cam = anprCrossed(p.x, d.dyn.x, d.dyn.z, deck);
      if (cam) this.anpr(d.playerId, d.vehicleId, cam, now);
    }
    for (const id of [...this.prev.keys()]) if (!seen.has(id)) this.prev.delete(id);
    if (this.reads.size > 2000) for (const [k, t] of this.reads) if (now - t > ECONOMY.tolls.anprCooldownSec * 1000) this.reads.delete(k);
  }

  private async toll(playerId: string, vehicleId: string, kmh: number, x: number, z: number): Promise<void> {
    const key = `${playerId}:${vehicleId}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    const cfg = ECONOMY.tolls;
    const plaza = tollPlazaAt(x, z);
    const place = plaza?.name.split(' · ')[0] ?? 'Köprü';
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        const live = this.ctx.state.vehicles.get(vehicleId);
        if (!live || !this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        const player = uow.player(playerId);
        let outcome = tollOutcome(kmh);
        if (outcome === 'paid' && player.money + player.bank < cfg.fee) outcome = 'evaded';
        const amount = outcome === 'paid' ? cfg.fee : cfg.evasionFine;
        const took = charge(player, amount);
        const total = took.cash + took.bank;
        const label = outcome === 'paid' ? `Köprü geçişi: ${place}` : `Kaçak geçiş cezası: ${place}`;
        if (took.cash > 0) uow.debit(player, took.cash, outcome === 'paid' ? 'toll' : 'toll_fine', label, vehicleId);
        if (took.bank > 0) {
          player.bank -= took.bank;
          uow.log(player, outcome === 'paid' ? 'toll' : 'toll_fine', -took.bank, `${label} (bank)`);
        }
        await uow.commit();
        const plate = plateText(live.id, live.mods);
        this.record(playerId, {
          kind: outcome === 'paid' ? 'toll' : 'evasion',
          place,
          amount: -total,
          plate,
          modelId: live.modelId,
          stars: 0,
          text: outcome === 'paid' ? `İyi Yolculuklar - $${cfg.fee}` : `KAÇAK GEÇİŞ! Ceza: $${cfg.evasionFine.toLocaleString('en-US')}`,
        });
        this.ctx.hub.broadcast('toll.pass', { n: plaza?.n ?? 0, z, evaded: outcome === 'evaded' });
        log.info('toll', { playerId, place, outcome, kmh: Math.round(kmh), paid: total });
      });
    } catch (err) {
      log.error('toll failed', { playerId, error: (err as Error).message });
    } finally {
      this.busy.delete(key);
    }
  }

  /** A camera reads the plate of a car passing under it. */
  private anpr(playerId: string, vehicleId: string, cam: AnprCamera, now: number): void {
    const key = `${cam.id}:${vehicleId}`;
    if (now - (this.reads.get(key) ?? 0) < ECONOMY.tolls.anprCooldownSec * 1000) return;
    this.reads.set(key, now);
    const v = this.ctx.state.vehicles.get(vehicleId);
    if (!v) return;
    const read = plateRead(v.mods);
    const flagged = !!v.mods.hot || v.status === 'stolen' || this.police.starsOf(playerId) > 0;
    if (read === 'none') {
      if (flagged) this.record(playerId, { kind: 'anpr', place: cam.name, amount: 0, plate: null, modelId: v.modelId, stars: 0, text: 'Kamera plakayı okuyamadı (çevrik plaka).' });
      return;
    }
    if (read === 'fake' || !flagged) return;
    this.police.addHeat(playerId, ECONOMY.tolls.anprHeat, 'anpr');
    const plate = plateText(v.id, v.mods);
    const why = v.mods.hot ? 'çalıntı kaydı' : v.status === 'stolen' ? 'çalıntı araç' : 'aranan araç';
    this.ctx.hub.broadcast('anpr.flash', { id: cam.id });
    for (const p of [playerId, ...this.ctx.sim.ridersOf(vehicleId).map((r) => r.id)]) {
      this.record(p, { kind: 'anpr', place: cam.name, amount: 0, plate, modelId: v.modelId, stars: 1, text: `PLAKA OKUNDU: ${plate} · ${why} · +1 yıldız` });
    }
    log.info('anpr hit', { playerId, camera: cam.id, model: v.modelId, why });
  }

  private record(playerId: string, e: Omit<TollEvent, 'id' | 'at'>): void {
    const ev: TollEvent = { id: newId('tev'), at: Date.now(), ...e };
    const list = this.history.get(playerId) ?? [];
    list.unshift(ev);
    if (list.length > TOLL_HISTORY_MAX) list.length = TOLL_HISTORY_MAX;
    this.history.set(playerId, list);
    this.ctx.hub.sendTo(playerId, 'toll.event', ev);
  }

  /** The player's toll, fine and camera history (newest first). */
  list(playerId: string): { events: TollEvent[] } {
    return { events: this.history.get(playerId) ?? [] };
  }

  forget(playerId: string): void {
    for (const k of [...this.busy]) if (k.startsWith(`${playerId}:`)) this.busy.delete(k);
  }
}

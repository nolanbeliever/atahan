// Emlak Dünyası (shared/realestate.ts): buy legal businesses with clean money, pay dirty money into
// them, and every 10 minutes each turns up to $100,000 of it into clean cash. The cycles run on
// while the owner is away and are paid the next time they're online.

import { ECONOMY } from '../../../shared/economy.config';
import { BUSINESS_IDS, findBusiness, launder } from '../../../shared/realestate';
import { crimeView, type CrimeView } from '../../../shared/underworld';
import { formatMoney } from '../../../shared/util';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireNear } from '../guards';
import type { CrimeService } from './crime';

const log = createLogger('realestate');

export class RealEstateService {
  constructor(
    private readonly ctx: Ctx,
    private readonly crime: CrimeService,
  ) {}

  /** Buy a business (clean money). */
  async buy(playerId: string, params: unknown): Promise<CrimeView> {
    const p = val.obj(params);
    const biz = findBusiness(val.oneOf(p.businessId, 'business', BUSINESS_IDS))!;
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'realestate');
      if (this.crime.get(playerId).businesses.some((b) => b.id === biz.id)) throw new GameError('conflict', 'Bu işletme zaten senin.');
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      uow.debit(player, biz.price, 'business_buy', `İşletme: ${biz.name}`);
      const now = uow.now;
      this.crime.edit(uow, playerId, (s) => s.businesses.push({ id: biz.id, boughtAt: now, pending: 0, cycleAt: now }));
      uow.notify(playerId, { kind: 'success', title: `${biz.emoji} ${biz.name} senin!`, text: `Kara parayı buraya yatır: her ${ECONOMY.laundering.cycleSec / 60} dakikada ${formatMoney(ECONOMY.laundering.perCycle)} temiz para olur.` });
      await this.crime.commit(uow);
      log.info('business bought', { playerId, business: biz.id });
      return this.crime.view(playerId);
    });
  }

  /** Pay dirty money into a business you own. */
  async deposit(playerId: string, params: unknown): Promise<CrimeView> {
    const p = val.obj(params);
    const biz = findBusiness(val.oneOf(p.businessId, 'business', BUSINESS_IDS))!;
    const amount = val.int(p.amount, 'amount', 1, 1_000_000_000);
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'realestate');
      const state = this.crime.get(playerId);
      if (!state.businesses.some((b) => b.id === biz.id)) throw new GameError('forbidden', 'Önce bu işletmeyi satın al.');
      if (amount > state.dirty) throw new GameError('insufficient_funds', `Bu kadar kara paran yok (${formatMoney(state.dirty)}).`);
      const uow = this.ctx.state.begin();
      const player = uow.player(playerId);
      const now = uow.now;
      let clean = 0;
      this.crime.edit(uow, playerId, (s) => {
        const b = s.businesses.find((x) => x.id === biz.id)!;
        // Settle the cycles that already ran; an idle business starts a fresh cycle now.
        clean = launder(b, now);
        if (b.pending === 0) b.cycleAt = now;
        b.pending += amount;
        s.dirty -= amount;
        s.laundered += clean;
      });
      if (clean > 0) uow.credit(player, clean, 'laundering', `Aklandı: ${biz.name}`);
      await this.crime.commit(uow);
      log.info('dirty money paid in', { playerId, business: biz.id, amount });
      return this.crime.view(playerId);
    });
  }

  /** Every few seconds: run the laundry for everyone online. */
  async tick(now = Date.now()): Promise<void> {
    for (const playerId of this.ctx.state.players.keys()) {
      if (!this.ctx.hub.isOnline(playerId)) continue;
      let state;
      try {
        state = this.crime.get(playerId);
      } catch {
        continue;
      }
      const ms = ECONOMY.laundering.cycleSec * 1000;
      if (!state.businesses.some((b) => now - b.cycleAt >= ms)) continue;
      await this.ctx.locks
        .run([K.player(playerId)], async () => {
          const uow = this.ctx.state.begin();
          const player = uow.player(playerId);
          const done: { name: string; emoji: string; clean: number }[] = [];
          this.crime.edit(uow, playerId, (s) => {
            for (const b of s.businesses) {
              const clean = launder(b, now);
              if (clean > 0) {
                const biz = findBusiness(b.id)!;
                done.push({ name: biz.name, emoji: biz.emoji, clean });
                s.laundered += clean;
              }
            }
          });
          const total = done.reduce((t, d) => t + d.clean, 0);
          if (total > 0) {
            uow.credit(player, total, 'laundering', `Kara para aklandı: ${done.map((d) => d.name).join(', ')}`);
            uow.notify(playerId, { kind: 'success', title: '🧼 Kara para aklandı!', text: `${done.map((d) => `${d.emoji} ${d.name}: ${formatMoney(d.clean)}`).join(' · ')} → temiz para olarak kasana geçti.` });
          }
          await this.crime.commit(uow);
          if (total > 0) {
            this.ctx.hub.sendTo(playerId, 'crime.laundered', { amount: total });
            log.info('laundered', { playerId, total });
          }
        })
        .catch((err) => log.error('laundering failed', { playerId, error: (err as Error).message }));
    }
  }

  view(playerId: string): CrimeView {
    return crimeView(this.crime.get(playerId));
  }
}

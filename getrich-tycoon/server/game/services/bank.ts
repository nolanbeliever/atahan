// GetRich Bank: deposits, withdrawals and interest.

import { ECONOMY } from '../../../shared/economy.config';
import { GameError } from '../../errors';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import { requireNear } from '../guards';

export class BankService {
  constructor(private readonly ctx: Ctx) {}

  async deposit(playerId: string, params: unknown) {
    const amount = val.int(val.obj(params).amount, 'amount', 1, ECONOMY.limits.maxBankTransfer);
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'bank');
      const uow = this.ctx.state.begin();
      const p = uow.player(playerId);
      if (p.money < amount) throw new GameError('insufficient_funds', 'Not enough cash to deposit.');
      p.money -= amount;
      p.bank += amount;
      uow.log(p, 'bank_deposit', -amount, `Deposited $${amount.toLocaleString('en-US')}`);
      await uow.commit();
      this.ctx.sim.markInteract(playerId);
      const live = this.ctx.state.players.get(playerId)!;
      return { money: live.money, bank: live.bank };
    });
  }

  async withdraw(playerId: string, params: unknown) {
    const amount = val.int(val.obj(params).amount, 'amount', 1, ECONOMY.limits.maxBankTransfer);
    return this.ctx.locks.run([K.player(playerId)], async () => {
      requireNear(this.ctx, playerId, 'bank');
      const uow = this.ctx.state.begin();
      const p = uow.player(playerId);
      if (p.bank < amount) throw new GameError('insufficient_funds', 'Not enough money in the bank.');
      p.bank -= amount;
      p.money = Math.min(ECONOMY.player.maxMoney, p.money + amount);
      uow.log(p, 'bank_withdraw', amount, `Withdrew $${amount.toLocaleString('en-US')}`);
      await uow.commit();
      this.ctx.sim.markInteract(playerId);
      const live = this.ctx.state.players.get(playerId)!;
      return { money: live.money, bank: live.bank };
    });
  }

  /** Pay accrued interest (called periodically for online players and on login). */
  async payInterest(playerId: string, maxIntervals = 24): Promise<void> {
    const cfg = ECONOMY.bank;
    const intervalMs = cfg.payoutIntervalSec * 1000;
    const live = this.ctx.state.players.get(playerId);
    if (!live) return;
    const now = Date.now();
    const intervals = Math.floor((now - live.lastInterestAt) / intervalMs);
    if (intervals < 1) return;
    await this.ctx.locks.run([K.player(playerId)], async () => {
      const uow = this.ctx.state.begin();
      const p = uow.player(playerId);
      let paid = 0;
      for (let i = 0; i < Math.min(intervals, maxIntervals); i++) {
        const interest = Math.min(cfg.maxInterestPerPayout, Math.floor(p.bank * cfg.interestRate));
        p.bank += interest;
        paid += interest;
      }
      p.lastInterestAt += intervals * intervalMs;
      if (paid > 0) {
        uow.log(p, 'bank_interest', paid, `Interest on savings`);
        uow.notify(playerId, { kind: 'money', title: 'Interest paid', text: `GetRich Bank paid you $${paid.toLocaleString('en-US')} in interest.` });
      }
      await uow.commit();
    });
  }
}

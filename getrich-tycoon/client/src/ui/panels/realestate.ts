// Emlak Dünyası: buy legal businesses with clean money and launder dirty money through them
// (every business turns up to $100,000 of it into clean cash every 10 minutes).

import { ECONOMY } from '../../../../shared/economy.config';
import { BUSINESSES, type BusinessId } from '../../../../shared/realestate';
import { formatMoney } from '../../../../shared/util';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { mmss } from '../RewardsHud';

const L = ECONOMY.laundering;

export class RealEstatePanel extends Panel {
  readonly name = 'realestate';
  override size = 'wide' as const;
  private timer: number | null = null;
  /** The cycle clocks on the owned businesses' cards (updated in place every second). */
  private clocks: { text: HTMLElement; bar: HTMLElement; nextAt: number; pending: number }[] = [];

  title() {
    return 'Emlak Dünyası · Ticari İşletmeler';
  }
  override subtitle() {
    return 'Yasal işletme al, kara parayı içinden geçir: temiz para olarak geri gelsin';
  }
  iconSvg() {
    return ICONS.store;
  }

  override init(): void {
    this.listen(this.store.on('crime', () => this.refresh()));
    this.listen(this.store.on('me', () => this.refresh()));
    void this.net
      .rpc('crime.info', {})
      .then((c) => this.store.setCrime(c))
      .catch((err) => this.ui.error(err));
    // The cycle clocks tick in place (the buttons stay put).
    this.timer = window.setInterval(() => this.tickClocks(), 1000);
    this.listen(() => {
      if (this.timer) clearInterval(this.timer);
    });
  }

  renderBody(): Child {
    const c = this.store.crime;
    const money = this.store.me?.money ?? 0;
    if (!c) return h('div', { class: 'empty' }, 'Yükleniyor…');
    const owned = c.businesses.filter((b) => b.owned);
    const pending = owned.reduce((t, b) => t + b.pending, 0);
    const now = this.store.serverNow();
    this.clocks = [];
    return h(
      'div',
      { 'data-testid': 'realestate-panel' },
      h(
        'div',
        { class: 'toll-sum re-sum' },
        h('div', null, h('div', { class: 'tiny muted' }, 'Kara para (elinde)'), h('div', { class: 'mono dirty-money', 'data-testid': 're-dirty' }, formatMoney(c.dirty))),
        h('div', null, h('div', { class: 'tiny muted' }, 'Aklanmayı bekleyen'), h('div', { class: 'mono' }, formatMoney(pending))),
        h('div', null, h('div', { class: 'tiny muted' }, 'Aklama hızı'), h('div', { class: 'mono' }, `${formatMoney(owned.length * L.perCycle)} / ${L.cycleSec / 60} dk`)),
        h('div', null, h('div', { class: 'tiny muted' }, 'Toplam aklanan'), h('div', { class: 'mono green' }, formatMoney(c.laundered))),
      ),
      h(
        'div',
        { class: 're-grid' },
        BUSINESSES.map((b) => {
          const v = c.businesses.find((x) => x.id === b.id)!;
          const next = v.nextAt ? Math.max(0, (v.nextAt - now) / 1000) : 0;
          const clock = h('div', { class: 'tiny' }, this.clockText(v.pending, next));
          const fill = h('div', { style: { width: `${v.pending > 0 ? Math.round((1 - next / L.cycleSec) * 100) : 0}%` } });
          if (v.owned && v.nextAt) this.clocks.push({ text: clock, bar: fill, nextAt: v.nextAt, pending: v.pending });
          return h(
            'div',
            { class: `re-card ${v.owned ? 'owned' : ''}`, 'data-testid': `re-${b.id}` },
            h('div', { class: 're-emoji' }, b.emoji),
            h('div', { class: 're-name' }, b.name),
            h('div', { class: 'tiny muted' }, `${b.district} · ${b.text}`),
            v.owned
              ? h(
                  'div',
                  { class: 're-own' },
                  clock,
                  h('div', { class: 're-bar' }, fill),
                  h(
                    'div',
                    { class: 'row', style: { gap: '6px', marginTop: '6px', flexWrap: 'wrap' } },
                    [50_000, 100_000].map((amt) =>
                      h('button', { class: 'btn small', disabled: this.busy || c.dirty <= 0, onclick: () => void this.deposit(b.id, Math.min(amt, c.dirty)) }, `+${formatMoney(amt)}`),
                    ),
                    h('button', { class: 'btn small primary', disabled: this.busy || c.dirty <= 0, 'data-testid': `re-deposit-${b.id}`, onclick: () => void this.deposit(b.id, c.dirty) }, 'Hepsini yatır'),
                  ),
                )
              : h(
                  'button',
                  { class: 'btn primary', disabled: this.busy || money < b.price, 'data-testid': `re-buy-${b.id}`, onclick: () => void this.buy(b.id) },
                  `Satın al · ${formatMoney(b.price)}`,
                ),
          );
        }),
      ),
      h(
        'div',
        { class: 'tiny muted', style: { marginTop: '10px', lineHeight: '1.5' } },
        `Soygun ve satıştan gelen kara para harcanamaz. Bir işletmeye yatır: her işletme her ${L.cycleSec / 60} dakikada ${formatMoney(L.perCycle)} kara parayı temiz paraya çevirip kasana koyar. ` +
          'Ne kadar çok işletmen varsa o kadar hızlı aklarsın. Sen oyunda yokken de döngüler işler; döndüğünde ödenir.',
      ),
    );
  }

  private clockText(pending: number, next: number): string {
    return pending > 0 ? `İçeride ${formatMoney(pending)} kara para · sonraki ${formatMoney(Math.min(pending, L.perCycle))} → ${mmss(next)}` : 'Boşta: kara para yatır, 10 dk sonra temiz gelsin.';
  }

  private tickClocks(): void {
    const now = this.store.serverNow();
    for (const c of this.clocks) {
      const next = Math.max(0, (c.nextAt - now) / 1000);
      c.text.textContent = this.clockText(c.pending, next);
      c.bar.style.width = `${c.pending > 0 ? Math.round((1 - next / L.cycleSec) * 100) : 0}%`;
    }
  }

  private async buy(id: BusinessId): Promise<void> {
    await this.act(
      () => this.net.rpc('realestate.buy', { businessId: id }),
      (c) => {
        this.store.setCrime(c);
        this.game.audio.play('purchase');
      },
    );
  }

  private async deposit(id: BusinessId, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.act(
      () => this.net.rpc('realestate.deposit', { businessId: id, amount }),
      (c) => {
        this.store.setCrime(c);
        this.game.audio.play('coin');
      },
    );
  }
}

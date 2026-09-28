// Hammerfall Auction House.

import { ECONOMY } from '../../../../shared/economy.config';
import type { Auction } from '../../../../shared/types';
import { marketValue } from '../../../../shared/valuation';
import { formatMoney } from '../../../../shared/util';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { field, moneyInput, vehicleCard, vehicleTitle } from '../widgets';

export function minNextBid(a: Pick<Auction, 'currentBid' | 'startingBid'>): number {
  const cfg = ECONOMY.auction;
  if (a.currentBid === null) return a.startingBid;
  return a.currentBid + Math.max(cfg.minIncrement, Math.ceil((a.currentBid * cfg.minIncrementRate) / 10) * 10);
}

function countdown(ms: number): string {
  if (ms <= 0) return 'Ending...';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export class AuctionsPanel extends Panel {
  readonly name = 'auctions';
  private bids = new Map<string, number>();
  private timer: number | null = null;
  private create = { vehicleId: '', startingBid: 0, duration: ECONOMY.auction.defaultDurationSec };

  title() {
    return 'Hammerfall Auctions';
  }
  override subtitle() {
    return 'Bids are held in escrow and refunded if you are outbid';
  }
  iconSvg() {
    return ICONS.gavel;
  }

  override init(): void {
    void this.game.refreshAuctions();
    this.timer = window.setInterval(() => {
      for (const el of this.bodyEl.querySelectorAll<HTMLElement>('[data-ends]')) el.textContent = countdown(Number(el.dataset.ends) - Date.now());
    }, 500);
  }

  override dispose(): void {
    if (this.timer) window.clearInterval(this.timer);
    super.dispose();
  }

  renderBody(): Child {
    const auctions = this.game.auctions;
    const me = this.store.playerId;
    const list = auctions.length
      ? h(
          'div',
          { class: 'card-grid' },
          auctions.map((a) => {
            const min = minNextBid(a);
            const bid = Math.max(min, this.bids.get(a.id) ?? min);
            const input = moneyInput(bid, (n) => this.bids.set(a.id, n));
            const leading = a.currentBidderId === me;
            const mine = a.sellerId === me;
            return vehicleCard(a.vehicle, this.store.trends, {
              price: a.currentBid ?? a.startingBid,
              priceLabel: a.currentBid ? `Current bid (${a.bidCount})` : 'Starting bid',
              badges: [
                h('span', { class: 'pill purple' }, `Ends in `, h('span', { 'data-ends': String(a.endsAt) }, countdown(a.endsAt - Date.now()))),
                h('span', { class: 'pill' }, `Seller: ${a.sellerName}`),
                leading ? h('span', { class: 'pill green' }, 'You are winning') : a.currentBidderName ? h('span', { class: 'pill' }, `Top: ${a.currentBidderName}`) : null,
              ],
              actions: mine
                ? h('span', { class: 'pill gold' }, 'Your auction')
                : leading
                  ? null
                  : [
                      input,
                      h(
                        'button',
                        {
                          class: 'btn small primary',
                          disabled: this.busy,
                          onclick: () =>
                            void this.act(
                              () => this.net.rpc('auction.bid', { auctionId: a.id, amount: this.bids.get(a.id) ?? min }),
                              () => {
                                this.bids.delete(a.id);
                                this.ui.success('Bid placed', `You bid on the ${vehicleTitle(a.vehicle).name}.`);
                                void this.game.refreshAuctions();
                              },
                            ),
                        },
                        'Place bid',
                      ),
                    ],
            });
          }),
        )
      : h('div', { class: 'empty' }, 'No active auctions right now.');
    return [h('div', { class: 'section-title' }, 'Live auctions'), list, this.renderCreate()];
  }

  private renderCreate(): Child {
    const here = this.game.nearKind('auction');
    const vehicles = this.store.myVehicles().filter((v) => (v.status === 'stored' || v.status === 'world') && this.game.driving !== v.id && v.serviceUntil <= Date.now());
    const sel = vehicles.find((v) => v.id === this.create.vehicleId);
    const value = sel ? marketValue(sel, this.store.trends) : 0;
    if (sel && !this.create.startingBid) this.create.startingBid = Math.round((value * 0.6) / 50) * 50;
    const vehSel = h(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          this.create.vehicleId = (e.target as HTMLSelectElement).value;
          this.create.startingBid = 0;
          this.refresh();
        },
      },
      h('option', { value: '' }, vehicles.length ? 'Choose a vehicle...' : 'No eligible vehicles'),
      vehicles.map((v) => h('option', { value: v.id, selected: v.id === this.create.vehicleId }, vehicleTitle(v).name)),
    );
    const durSel = h(
      'select',
      { class: 'input', onchange: (e: Event) => (this.create.duration = Number((e.target as HTMLSelectElement).value)) },
      [60, 180, 300, 600, 900].map((s) => h('option', { value: String(s), selected: s === this.create.duration }, `${s / 60} min`)),
    );
    const start = moneyInput(this.create.startingBid, (n) => (this.create.startingBid = n));
    const [lo, hi] = ECONOMY.auction.startingBidRange;
    return h(
      'div',
      { class: 'col', style: { marginTop: '18px' } },
      h('div', { class: 'section-title' }, 'Consign a vehicle'),
      here ? null : h('div', { class: 'pill gold', style: { alignSelf: 'flex-start' } }, 'Visit the Auction House to consign vehicles.'),
      h('div', { class: 'filters' }, field('Vehicle', vehSel), field('Starting bid', start), field('Duration', durSel), h('div')),
      sel ? h('div', { class: 'tiny muted' }, `Value ${formatMoney(value)}. Starting bid must be ${formatMoney(value * lo)} - ${formatMoney(value * hi)}. Fee ${formatMoney(ECONOMY.fees.auctionListingFee)} + ${Math.round(ECONOMY.fees.auctionFeeRate * 100)}% of the final price.`) : null,
      h(
        'button',
        {
          class: 'btn gold',
          style: { alignSelf: 'flex-start' },
          disabled: !here || !sel || this.busy,
          onclick: () =>
            void this.act(
              () => this.net.rpc('auction.create', { vehicleId: this.create.vehicleId, startingBid: this.create.startingBid, durationSec: this.create.duration }),
              () => {
                this.ui.success('Auction started!', 'Other players can now bid.');
                this.create = { vehicleId: '', startingBid: 0, duration: ECONOMY.auction.defaultDurationSec };
                void this.game.refreshAuctions();
              },
            ),
        },
        'Start auction',
      ),
    );
  }
}

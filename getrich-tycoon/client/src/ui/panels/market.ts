// Marketplace, vehicle inspection & negotiation, player listing purchase.

import { ECONOMY } from '../../../../shared/economy.config';
import { isCategoryUnlocked } from '../../../../shared/progression';
import type { MarketListing, NegotiationState, PlayerListing, Vehicle, VehicleCategory } from '../../../../shared/types';
import { VEHICLE_CATEGORIES } from '../../../../shared/types';
import { findOption, MOD_SLOT_LABELS, type ModSlot } from '../../../../shared/customization';
import { marketValue } from '../../../../shared/valuation';
import { formatKm, formatMoney } from '../../../../shared/util';
import { CATEGORY_LABELS, getModel } from '../../../../shared/vehicles';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { conditionRows, dealBadge, field, swatch, vehicleCard, vehicleTitle } from '../widgets';

const PERSONALITY_COLOR: Record<string, string> = { friendly: 'green', stubborn: 'red', desperate: 'blue', shrewd: 'gold', collector: 'purple' };

function lockedPill(v: Vehicle, level: number): Child {
  const cat = getModel(v.modelId).category;
  if (isCategoryUnlocked(cat, level)) return null;
  return h('span', { class: 'pill red' }, `Unlocks at level ${ECONOMY.categoryUnlockLevel[cat]}`);
}

type SortKey = 'price_asc' | 'price_desc' | 'value' | 'condition' | 'mileage' | 'deal';

export class MarketPanel extends Panel {
  readonly name = 'market';
  private tab: 'npc' | 'players' = (this.arg.tab as 'npc' | 'players') ?? 'npc';
  private category: VehicleCategory | 'all' = 'all';
  private maxPrice = 0;
  private sort: SortKey = 'price_asc';
  private playerListings: PlayerListing[] = [];
  private loading = true;

  title() {
    return 'Marketplace';
  }
  override subtitle() {
    return 'Browse used vehicles from NPC sellers and other players';
  }
  iconSvg() {
    return ICONS.market;
  }

  override init(): void {
    void this.load();
    this.listen(this.store.on('market', () => this.refresh()));
    this.listen(this.store.on('listingsChanged', () => void this.load()));
    this.listen(this.store.on('trends', () => this.refresh()));
  }

  private async load(): Promise<void> {
    try {
      const r = await this.net.rpc('market.list', {});
      this.playerListings = r.playerListings;
      this.store.setMarket(r.listings);
    } catch (err) {
      this.ui.error(err);
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  private filterSort<T>(items: T[], veh: (t: T) => Vehicle, price: (t: T) => number): T[] {
    const trends = this.store.trends;
    const out = items.filter((it) => {
      const m = getModel(veh(it).modelId);
      if (this.category !== 'all' && m.category !== this.category) return false;
      if (this.maxPrice > 0 && price(it) > this.maxPrice) return false;
      return true;
    });
    const avg = (v: Vehicle) => Object.values(v.condition).reduce((a, b) => a + b, 0);
    const cmp: Record<SortKey, (a: T, b: T) => number> = {
      price_asc: (a, b) => price(a) - price(b),
      price_desc: (a, b) => price(b) - price(a),
      value: (a, b) => marketValue(veh(b), trends) - marketValue(veh(a), trends),
      condition: (a, b) => avg(veh(b)) - avg(veh(a)),
      mileage: (a, b) => veh(a).mileage - veh(b).mileage,
      deal: (a, b) => price(a) / marketValue(veh(a), trends) - price(b) / marketValue(veh(b), trends),
    };
    return out.sort(cmp[this.sort]);
  }

  renderBody(): Child {
    const level = this.store.me?.level ?? 1;
    const trends = this.store.trends;
    const tabs = h(
      'div',
      { class: 'subtabs' },
      h('button', { class: this.tab === 'npc' ? 'active' : '', 'data-testid': 'market-tab-npc', onclick: () => ((this.tab = 'npc'), this.refresh()) }, `Used Market (${this.store.marketListings.length})`),
      h('button', { class: this.tab === 'players' ? 'active' : '', 'data-testid': 'market-tab-players', onclick: () => ((this.tab = 'players'), this.refresh()) }, `Player Listings (${this.playerListings.length})`),
    );
    const catSel = h(
      'select',
      { class: 'input', onchange: (e: Event) => ((this.category = (e.target as HTMLSelectElement).value as VehicleCategory | 'all'), this.refresh()) },
      h('option', { value: 'all' }, 'All categories'),
      VEHICLE_CATEGORIES.map((c) => h('option', { value: c, selected: this.category === c }, `${CATEGORY_LABELS[c]}${isCategoryUnlocked(c, level) ? '' : ` (lvl ${ECONOMY.categoryUnlockLevel[c]})`}`)),
    );
    const maxInput = h('input', { class: 'input', type: 'number', min: '0', step: '1000', placeholder: 'No limit', value: this.maxPrice ? String(this.maxPrice) : '' });
    maxInput.addEventListener('change', () => {
      this.maxPrice = Math.max(0, Number(maxInput.value) || 0);
      this.refresh();
    });
    const sortSel = h(
      'select',
      { class: 'input', onchange: (e: Event) => ((this.sort = (e.target as HTMLSelectElement).value as SortKey), this.refresh()) },
      (
        [
          ['price_asc', 'Price: low to high'],
          ['price_desc', 'Price: high to low'],
          ['deal', 'Best deal first'],
          ['value', 'Highest value'],
          ['condition', 'Best condition'],
          ['mileage', 'Lowest mileage'],
        ] as const
      ).map(([k, l]) => h('option', { value: k, selected: this.sort === k }, l)),
    );
    const trendRow = h(
      'div',
      { class: 'row wrap', style: { gap: '6px', marginBottom: '14px' } },
      h('span', { class: 'tiny muted', style: { fontWeight: '800' } }, 'MARKET DEMAND:'),
      VEHICLE_CATEGORIES.map((c) => {
        const t = trends[c];
        const cls = t >= 1.05 ? 'green' : t <= 0.95 ? 'red' : '';
        return h('span', { class: `pill ${cls}` }, `${CATEGORY_LABELS[c]} ${t >= 1 ? '+' : ''}${Math.round((t - 1) * 100)}%`);
      }),
    );
    const filters = h('div', { class: 'filters' }, field('Category', catSel), field('Max price', maxInput), field('Sort by', sortSel), h('div'));

    let list: Child;
    if (this.tab === 'npc') {
      const items = this.filterSort(this.store.marketListings, (l) => l.vehicle, (l) => l.askingPrice);
      list = items.length
        ? h(
            'div',
            { class: 'card-grid' },
            items.map((l) =>
              vehicleCard(l.vehicle, trends, {
                price: l.askingPrice,
                priceLabel: 'Asking',
                badges: [h('span', { class: `pill ${PERSONALITY_COLOR[l.personality] ?? ''}` }, `${l.sellerName} - ${l.personality}`), lockedPill(l.vehicle, level)],
                actions: [
                  h('button', { class: 'btn small', 'data-testid': 'market-inspect', onclick: () => this.ui.open('inspect', { listingId: l.id }) }, 'Inspect & negotiate'),
                  h(
                    'button',
                    {
                      class: 'btn small primary',
                      'data-testid': 'market-buy',
                      'data-listing': l.id,
                      disabled: this.busy || !isCategoryUnlocked(getModel(l.vehicle.modelId).category, level),
                      onclick: () => void this.buy(l),
                    },
                    `Buy ${formatMoney(l.askingPrice)}`,
                  ),
                ],
              }),
            ),
          )
        : h('div', { class: 'empty' }, 'No vehicles match your filters.');
    } else {
      const items = this.filterSort(this.playerListings, (l) => l.vehicle, (l) => l.price);
      list = this.loading
        ? h('div', { class: 'empty' }, 'Loading listings...')
        : items.length
          ? h(
              'div',
              { class: 'card-grid' },
              items.map((l) =>
                vehicleCard(l.vehicle, trends, {
                  price: l.price,
                  badges: [
                    h('span', { class: 'pill blue' }, `Seller: ${l.sellerName}`),
                    h('span', { class: 'pill' }, l.location === 'dealership' ? 'At dealership' : 'Classifieds'),
                    lockedPill(l.vehicle, level),
                  ],
                  actions:
                    l.sellerId === this.store.playerId
                      ? h('span', { class: 'pill gold' }, 'Your listing')
                      : h('button', { class: 'btn small primary', 'data-testid': 'player-buy', disabled: this.busy, onclick: () => void this.buyPlayer(l) }, `Buy ${formatMoney(l.price)}`),
                }),
              ),
            )
          : h('div', { class: 'empty' }, 'No player listings yet. List your own vehicles from the Garage or your dealership!');
    }
    return [tabs, trendRow, filters, list];
  }

  private async buy(l: MarketListing): Promise<void> {
    await this.act(
      () => this.net.rpc('market.buy', { listingId: l.id, expectedPrice: l.askingPrice }),
      (r) => {
        this.game.audio.play('purchase');
        this.ui.success('Vehicle purchased!', `${vehicleTitle(r.vehicle).name} is now in your garage (press I).`);
      },
    );
  }

  private async buyPlayer(l: PlayerListing): Promise<void> {
    await this.act(
      () => this.net.rpc('market.buyPlayer', { vehicleId: l.vehicle.id, expectedPrice: l.price }),
      (r) => {
        this.game.audio.play('purchase');
        this.ui.success('Vehicle purchased!', `${vehicleTitle(r.vehicle).name} bought from ${l.sellerName}.`);
        void this.load();
      },
    );
  }
}

// ---------------------------------------------------------------------------

export function modsList(v: Vehicle): Child {
  const items = (Object.keys(MOD_SLOT_LABELS) as ModSlot[])
    .map((s) => ({ s, o: findOption(v.mods[s]) }))
    .filter((x) => x.o && x.o.price > 0);
  if (items.length === 0) return h('span', { class: 'muted small' }, 'Stock - no modifications');
  return h('div', { class: 'row wrap', style: { gap: '6px' } }, items.map((x) => h('span', { class: 'pill purple' }, `${MOD_SLOT_LABELS[x.s]}: ${x.o!.label}`)));
}

export function vehicleDetails(v: Vehicle, trends = undefined as Parameters<typeof marketValue>[1]): Child {
  const m = getModel(v.modelId);
  const t = vehicleTitle(v);
  return h(
    'div',
    { class: 'col' },
    h('div', { class: 'row' }, swatch(v), h('div', null, h('div', { class: 'vname', style: { fontSize: '20px', fontWeight: '900' } }, t.name), h('div', { class: 'muted small' }, t.meta))),
    h('div', { class: 'muted small' }, m.description),
    h(
      'div',
      { class: 'stat-grid' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Mileage'), h('div', { class: 'v' }, formatKm(v.mileage))),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Fuel'), h('div', { class: 'v' }, `${Math.round(v.fuel)}%`)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Est. value'), h('div', { class: 'v money' }, formatMoney(marketValue(v, trends)))),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Top speed'), h('div', { class: 'v' }, `${Math.round(m.perf.topSpeed * 3.6)} km/h`)),
    ),
    h('div', { class: 'section-title' }, 'Condition report'),
    conditionRows(v.condition),
    h('div', { class: 'section-title' }, 'Modifications'),
    modsList(v),
  );
}

export class InspectPanel extends Panel {
  readonly name = 'inspect';
  override size = 'wide' as const;
  private nego: NegotiationState | null = null;
  private offer = 0;

  private get listing(): MarketListing | undefined {
    return this.store.marketListings.find((l) => l.id === this.arg.listingId);
  }
  title() {
    return 'Vehicle Inspection';
  }
  override subtitle() {
    const l = this.listing;
    return l ? `Sold by ${l.sellerName}` : 'Listing no longer available';
  }
  iconSvg() {
    return ICONS.tag;
  }

  override init(): void {
    this.listen(this.store.on('market', () => this.refresh()));
  }

  renderBody(): Child {
    const l = this.listing;
    if (!l) return h('div', { class: 'empty' }, 'This vehicle has just been sold or the listing expired.');
    const v = l.vehicle;
    const value = marketValue(v, this.store.trends);
    if (!this.offer) this.offer = Math.round((this.nego?.counterOffer ?? l.askingPrice) * 0.85 / 50) * 50;
    const price = this.nego && this.nego.status === 'open' ? this.nego.counterOffer : l.askingPrice;
    const level = this.store.me?.level ?? 1;
    const unlocked = isCategoryUnlocked(getModel(v.modelId).category, level);

    const negoBox = this.nego
      ? this.renderNegotiation(this.nego)
      : h(
          'div',
          { class: 'seller' },
          h('div', { class: 'row between' }, h('div', { class: 'vname' }, l.sellerName), h('span', { class: `pill ${PERSONALITY_COLOR[l.personality] ?? ''}` }, l.personality)),
          h('div', { class: 'bubble' }, 'Want to make me an offer?'),
          h('div', { class: 'muted small', style: { marginTop: '10px' } }, 'Different sellers negotiate differently. Lowball offers annoy them - if they lose patience the full price stands.'),
          h('button', { class: 'btn accent block', style: { marginTop: '12px' }, 'data-testid': 'start-negotiation', disabled: this.busy || !unlocked, onclick: () => void this.startNegotiation() }, 'Start negotiating'),
        );

    return h(
      'div',
      { class: 'nego' },
      vehicleDetails(v, this.store.trends),
      h(
        'div',
        { class: 'col' },
        h(
          'div',
          { class: 'stat' },
          h('div', { class: 'k' }, this.nego?.status === 'open' ? 'Current price (seller counter)' : 'Asking price'),
          h('div', { class: 'row between' }, h('div', { class: 'v money', style: { fontSize: '30px' } }, formatMoney(price)), dealBadge(price, value)),
          h('div', { class: 'tiny muted' }, `Market value ${formatMoney(value)} - you have ${formatMoney(this.store.me?.money ?? 0)}`),
        ),
        unlocked ? null : h('div', { class: 'pill red' }, `This category unlocks at level ${ECONOMY.categoryUnlockLevel[getModel(v.modelId).category]}`),
        negoBox,
      ),
    );
  }

  private renderNegotiation(n: NegotiationState): Child {
    const pat = Math.round(n.patience * 5);
    const input = h('input', { class: 'input mono', type: 'number', step: '50', min: '1', value: String(this.offer), 'data-testid': 'offer-input' });
    input.addEventListener('input', () => (this.offer = Math.round(Number(input.value) || 0)));
    const statusText: Record<string, string> = { accepted: 'Deal accepted!', rejected: 'Seller stopped negotiating', walked: 'You walked away' };
    return h(
      'div',
      { class: 'seller' },
      h('div', { class: 'row between' }, h('div', { class: 'vname' }, this.listing?.sellerName ?? 'Seller'), h('span', { class: `pill ${PERSONALITY_COLOR[n.personality] ?? ''}` }, n.personality)),
      h('div', { class: 'bubble', 'data-testid': 'seller-message' }, n.message),
      h('div', { class: 'tiny muted', style: { marginTop: '10px' } }, 'Seller patience'),
      h('div', { class: 'patience' }, [0, 1, 2, 3, 4].map((i) => h('i', { class: i < pat ? '' : 'off' }))),
      n.lastOffer ? h('div', { class: 'small muted', style: { marginTop: '8px' } }, `Your last offer: ${formatMoney(n.lastOffer)} - Round ${n.round}`) : null,
      n.status === 'open'
        ? h(
            'div',
            { class: 'col', style: { marginTop: '12px' } },
            field('Your offer', input),
            h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn accent grow', 'data-testid': 'make-offer', disabled: this.busy, onclick: () => void this.makeOffer() }, 'Make offer'),
              h('button', { class: 'btn primary grow', disabled: this.busy, onclick: () => ((this.offer = n.counterOffer), void this.makeOffer()) }, `Accept ${formatMoney(n.counterOffer)}`),
            ),
          )
        : h('div', { class: `pill ${n.status === 'accepted' ? 'green' : 'red'}`, style: { marginTop: '12px' } }, statusText[n.status] ?? n.status),
    );
  }

  override renderFoot(): Child {
    const l = this.listing;
    if (!l) return h('button', { class: 'btn', onclick: () => this.ui.closeAll() }, 'Close');
    const price = this.nego && this.nego.status === 'open' ? this.nego.counterOffer : l.askingPrice;
    const unlocked = isCategoryUnlocked(getModel(l.vehicle.modelId).category, this.store.me?.level ?? 1);
    return [
      h('button', { class: 'btn ghost', onclick: () => this.ui.closeAll() }, 'Walk away'),
      h('button', { class: 'btn', onclick: () => this.ui.open('market') }, 'Back to market'),
      h('button', { class: 'btn primary', 'data-testid': 'inspect-buy', disabled: this.busy || !unlocked, onclick: () => void this.buy(price) }, `Buy now for ${formatMoney(price)}`),
    ];
  }

  private async startNegotiation(): Promise<void> {
    const l = this.listing;
    if (!l) return;
    await this.act(
      () => this.net.rpc('market.negotiate', { listingId: l.id }),
      (n) => {
        this.nego = n;
        this.offer = Math.round((n.counterOffer * 0.85) / 50) * 50;
      },
    );
  }

  private async makeOffer(): Promise<void> {
    const l = this.listing;
    if (!l) return;
    await this.act(
      () => this.net.rpc('market.offer', { listingId: l.id, offer: this.offer }),
      (r) => {
        this.nego = r.state;
        if (r.vehicle) {
          this.game.audio.play('purchase');
          this.ui.success('Deal!', `You bought the ${vehicleTitle(r.vehicle).name} for ${formatMoney(r.price ?? 0)}.`);
          setTimeout(() => this.ui.open('inventory'), 900);
        }
      },
    );
  }

  private async buy(price: number): Promise<void> {
    const l = this.listing;
    if (!l) return;
    await this.act(
      () => this.net.rpc('market.buy', { listingId: l.id, expectedPrice: price }),
      (r) => {
        this.game.audio.play('purchase');
        this.ui.success('Vehicle purchased!', `${vehicleTitle(r.vehicle).name} is now in your garage.`);
        this.ui.open('inventory');
      },
    );
  }
}

// ---------------------------------------------------------------------------

export class PlayerListingPanel extends Panel {
  readonly name = 'playerListing';
  override size = 'medium' as const;

  private get vehicle() {
    return this.store.vehicles.get(this.arg.vehicleId as string);
  }
  title() {
    return 'Vehicle For Sale';
  }
  override subtitle() {
    const v = this.vehicle;
    return v ? `Offered by ${v.ownerName ?? 'a dealer'}` : '';
  }
  iconSvg() {
    return ICONS.tag;
  }
  override init(): void {
    this.listen(this.store.on('vehicle', () => this.refresh()));
    this.listen(this.store.on('vehicleRemoved', () => this.refresh()));
  }
  renderBody(): Child {
    const v = this.vehicle;
    if (!v || v.salePrice === null) return h('div', { class: 'empty' }, 'This vehicle is no longer for sale.');
    const value = marketValue(v, this.store.trends);
    return [
      vehicleDetails(v, this.store.trends),
      h('div', { class: 'summary' }, h('div', null, h('div', { class: 'tiny muted' }, 'Price'), h('div', { class: 'money', style: { fontSize: '26px' } }, formatMoney(v.salePrice))), dealBadge(v.salePrice, value)),
    ];
  }
  override renderFoot(): Child {
    const v = this.vehicle;
    if (!v || v.salePrice === null) return h('button', { class: 'btn', onclick: () => this.ui.closeAll() }, 'Close');
    return [
      h('button', { class: 'btn ghost', onclick: () => this.ui.closeAll() }, 'Cancel'),
      h(
        'button',
        {
          class: 'btn primary',
          disabled: this.busy || v.ownerId === this.store.playerId,
          onclick: () =>
            void this.act(
              () => this.net.rpc('market.buyPlayer', { vehicleId: v.id, expectedPrice: v.salePrice! }),
              () => {
                this.game.audio.play('purchase');
                this.ui.success('Vehicle purchased!', 'It is now in your garage.');
                this.ui.closeAll();
              },
            ),
        },
        v.ownerId === this.store.playerId ? 'Your vehicle' : `Buy for ${formatMoney(v.salePrice)}`,
      ),
    ];
  }
}

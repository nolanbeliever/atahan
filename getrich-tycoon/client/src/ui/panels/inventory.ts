// Garage / inventory: owned vehicles and parts.

import { ECONOMY } from '../../../../shared/economy.config';
import type { Vehicle } from '../../../../shared/types';
import { marketValue, quickSellPrice } from '../../../../shared/valuation';
import { formatMoney } from '../../../../shared/util';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { moneyInput, statusPill, vehicleCard, vehicleTitle } from '../widgets';
import { LOCKPICK_ITEM, stripPart } from '../../../../shared/theft';
import { moneyRange, strippedParts } from './theft';

export class InventoryPanel extends Panel {
  readonly name = 'inventory';
  private tab: 'vehicles' | 'parts' = 'vehicles';
  private listing: { id: string; price: number } | null = null;
  private confirmSell: string | null = null;

  title() {
    return 'Garage';
  }
  override subtitle() {
    const n = this.store.myVehicles().filter((v) => v.status !== 'stolen').length;
    return `${n} / ${ECONOMY.player.maxOwnedVehicles} vehicles owned`;
  }
  iconSvg() {
    return ICONS.garage;
  }

  renderBody(): Child {
    const tabs = h(
      'div',
      { class: 'subtabs' },
      h('button', { class: this.tab === 'vehicles' ? 'active' : '', onclick: () => ((this.tab = 'vehicles'), this.refresh()) }, 'Vehicles'),
      h('button', { class: this.tab === 'parts' ? 'active' : '', onclick: () => ((this.tab = 'parts'), this.refresh()) }, 'Parts inventory'),
    );
    return [tabs, this.tab === 'vehicles' ? this.renderVehicles() : this.renderParts()];
  }

  private renderParts(): Child {
    const inv = this.store.me?.inventory ?? {};
    const rows = ECONOMY.parts.map((k) =>
      h('tr', null, h('td', null, k.label), h('td', { class: 'muted' }, k.description), h('td', { class: 'mono' }, String(inv[k.id] ?? 0))),
    );
    const sets = inv[LOCKPICK_ITEM] ?? 0;
    const stolen = strippedParts(inv);
    return h(
      'div',
      { class: 'col' },
      h('div', { class: 'muted small' }, 'Parts kits reduce the parts cost of a repair job at the Repair Garage. Buy them at the Parts Depot.'),
      h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Kit'), h('th', null, 'Use'), h('th', null, 'Owned'))), h('tbody', null, rows)),
      h('div', { class: 'section-title', style: { marginTop: '10px' } }, 'Kaçak · Under the counter'),
      h(
        'table',
        { class: 'table', 'data-testid': 'inv-theft' },
        h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', null, 'Use'), h('th', null, 'Owned'))),
        h(
          'tbody',
          null,
          h('tr', null, h('td', null, 'Lockpick & Testere Seti'), h('td', { class: 'muted' }, 'Pick a parked car\u2019s lock (3 picks). Black Market.'), h('td', { class: 'mono', 'data-testid': 'inv-lockpicks' }, String(sets))),
          stolen.map((r) =>
            h('tr', { 'data-part': r.part }, h('td', null, `Sökülmüş Parça: ${stripPart(r.part)!.labelTr}`), h('td', { class: 'muted' }, `Pawn Shop pays ${moneyRange(r.min, r.max)}`), h('td', { class: 'mono' }, String(r.count))),
          ),
        ),
      ),
      stolen.length ? h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => this.ui.open('map') }, 'Find the Pawn Shop ($ on the map)')) : null,
    );
  }

  private renderVehicles(): Child {
    const vehicles = this.store.myVehicles();
    if (vehicles.length === 0) {
      return h(
        'div',
        { class: 'empty' },
        h('div', { style: { fontSize: '16px', fontWeight: '800', marginBottom: '6px' } }, 'Your garage is empty'),
        'Open the Marketplace (B) or visit the Used Vehicle Market to buy your first car.',
        h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: () => this.ui.open('market') }, 'Open Marketplace')),
      );
    }
    const trends = this.store.trends;
    return h(
      'div',
      { class: 'card-grid', 'data-testid': 'inventory-list' },
      vehicles.map((v) => {
        const value = marketValue(v, trends);
        const profit = value - v.purchasePrice;
        return vehicleCard(v, trends, {
          badges: [statusPill(v), h('span', { class: `pill ${profit >= 0 ? 'green' : 'red'}` }, `Invested ${formatMoney(v.purchasePrice)}`)],
          extra: this.listing?.id === v.id ? this.renderListForm(v) : this.confirmSell === v.id ? this.renderSellConfirm(v) : null,
          actions: this.actionsFor(v),
        });
      }),
    );
  }

  private actionsFor(v: Vehicle): Child {
    const busy = this.busy;
    const inService = v.serviceUntil > Date.now();
    const b = (label: string, onclick: () => void, cls = '', testid?: string) => h('button', { class: `btn small ${cls}`, disabled: busy || inService, onclick, 'data-testid': testid }, label);
    const out: Child[] = [];
    const driving = this.game.driving === v.id;
    if (v.status === 'stored') {
      out.push(b('Take out & drive', () => void this.spawn(v), 'accent', 'inv-spawn'));
      out.push(b('List for sale', () => ((this.listing = { id: v.id, price: Math.round((marketValue(v, this.store.trends) * 1.08) / 50) * 50 }), (this.confirmSell = null), this.refresh()), 'primary', 'inv-list'));
      if (this.store.myDealership()) out.push(b('Display at dealership', () => this.ui.open('dealership', { vehicleId: v.id })));
    } else if (v.status === 'world') {
      if (!driving) out.push(b('Bring here', () => void this.spawn(v), 'accent'));
      if (!driving) out.push(b('Store', () => void this.act(() => this.net.rpc('vehicle.store', { vehicleId: v.id }))));
      if (!driving) out.push(b('List for sale', () => ((this.listing = { id: v.id, price: Math.round((marketValue(v, this.store.trends) * 1.08) / 50) * 50 }), this.refresh()), 'primary', 'inv-list'));
    } else if (v.status === 'listed') {
      out.push(b('Unlist', () => void this.act(() => this.net.rpc('vehicle.unlist', { vehicleId: v.id }), () => this.ui.success('Listing removed')), '', 'inv-unlist'));
    } else if (v.status === 'displayed') {
      out.push(b('Manage display', () => this.ui.open('dealership')));
    } else if (v.status === 'stolen') {
      out.push(h('span', { class: 'tiny muted' }, v.mods.strip ? 'On a Sanayi lift: walk to the markers and strip it.' : 'Stolen: drive it to the Sanayi (🔧 on the map) and put it on a lift.'));
    }
    if ((v.status === 'stored' || v.status === 'world' || v.status === 'displayed') && !driving) {
      out.push(b('Quick sell', () => ((this.confirmSell = v.id), (this.listing = null), this.refresh()), 'danger'));
    }
    return out;
  }

  private renderListForm(v: Vehicle): Child {
    const input = moneyInput(this.listing!.price, (n) => (this.listing!.price = n));
    input.setAttribute('data-testid', 'list-price');
    const value = marketValue(v, this.store.trends);
    return h(
      'div',
      { class: 'col', style: { gap: '8px', padding: '10px', borderRadius: '10px', background: 'rgba(0,0,0,0.25)' } },
      h('div', { class: 'tiny muted' }, `Classifieds listing. Market value ${formatMoney(value)}. Fee ${formatMoney(ECONOMY.fees.classifiedListingFee)} + ${Math.round(ECONOMY.fees.saleFeeRate * 100)}% commission on sale.`),
      input,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn small ghost', onclick: () => ((this.listing = null), this.refresh()) }, 'Cancel'),
        h(
          'button',
          {
            class: 'btn small primary grow',
            'data-testid': 'list-confirm',
            disabled: this.busy,
            onclick: () =>
              void this.act(
                () => this.net.rpc('vehicle.list', { vehicleId: v.id, price: this.listing!.price }),
                () => {
                  this.ui.success('Listed for sale', `${vehicleTitle(v).name} is now on the classifieds.`);
                  this.listing = null;
                },
              ),
          },
          'Confirm listing',
        ),
      ),
    );
  }

  private renderSellConfirm(v: Vehicle): Child {
    const price = quickSellPrice(v, this.store.trends);
    return h(
      'div',
      { class: 'col', style: { gap: '8px', padding: '10px', borderRadius: '10px', background: 'rgba(255,92,122,0.1)' } },
      h('div', { class: 'small' }, `A wholesaler offers ${formatMoney(price)} (${Math.round(ECONOMY.fees.quickSellRate * 100)}% of value) right now.`),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn small ghost', onclick: () => ((this.confirmSell = null), this.refresh()) }, 'Cancel'),
        h(
          'button',
          {
            class: 'btn small danger grow',
            disabled: this.busy,
            onclick: () =>
              void this.act(
                () => this.net.rpc('vehicle.quickSell', { vehicleId: v.id, expectedPrice: price }),
                (r) => {
                  this.ui.success('Sold to wholesaler', `Received ${formatMoney(r.price)}.`);
                  this.confirmSell = null;
                },
              ),
          },
          `Sell for ${formatMoney(price)}`,
        ),
      ),
    );
  }

  private async spawn(v: Vehicle): Promise<void> {
    await this.act(
      () => this.net.rpc('vehicle.spawn', { vehicleId: v.id }),
      () => {
        this.ui.success('Vehicle ready', `Your ${vehicleTitle(v).name} is parked next to you. Walk up and press E to drive.`);
        this.ui.closeAll();
      },
    );
  }
}

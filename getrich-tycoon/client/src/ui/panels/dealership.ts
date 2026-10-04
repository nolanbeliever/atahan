// Dealership management and plot purchase.

import { ECONOMY, MAX_DEALERSHIP_LEVEL, dealershipLevel } from '../../../../shared/economy.config';
import type { Vehicle } from '../../../../shared/types';
import { marketValue } from '../../../../shared/valuation';
import { formatMoney } from '../../../../shared/util';
import { PLOTS, findPlot, plotSlotCount } from '../../../../shared/world';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { field, moneyInput, swatch, vehicleTitle } from '../widgets';

export class DealershipPanel extends Panel {
  readonly name = 'dealership';
  private placing: { slot: number; vehicleId: string; price: number } | null = null;
  private prices = new Map<string, number>();
  private newName = '';

  title() {
    return this.store.myDealership()?.name ?? 'Dealership';
  }
  override subtitle() {
    const d = this.store.myDealership();
    return d ? `${dealershipLevel(d.level).name} - Level ${d.level} / ${MAX_DEALERSHIP_LEVEL}` : 'You do not own a dealership yet';
  }
  iconSvg() {
    return ICONS.store;
  }

  override init(): void {
    this.listen(this.store.on('dealerships', () => this.refresh()));
    const pre = this.arg.vehicleId as string | undefined;
    if (pre) this.placing = { slot: this.firstFreeSlot(), vehicleId: pre, price: 0 };
  }

  private slotVehicles(): Map<number, Vehicle> {
    const d = this.store.myDealership();
    const out = new Map<number, Vehicle>();
    if (!d) return out;
    for (const v of this.store.myVehicles()) if (v.status === 'displayed' && v.plotId === d.plotId && v.slot !== null) out.set(v.slot, v);
    return out;
  }

  private firstFreeSlot(): number {
    const d = this.store.myDealership();
    if (!d) return 0;
    const used = this.slotVehicles();
    for (let i = 0; i < plotSlotCount(d.level); i++) if (!used.has(i)) return i;
    return 0;
  }

  renderBody(): Child {
    const d = this.store.myDealership();
    if (!d) {
      const free = PLOTS.filter((p) => !this.store.dealerships.has(p.id)).length;
      return h(
        'div',
        { class: 'col' },
        h('div', { class: 'empty' }, h('div', { style: { fontSize: '16px', fontWeight: '800', marginBottom: '6px' } }, 'Open your own dealership'), `Walk to Dealership Row (north of Fortune Plaza) and press E at a FOR SALE sign. ${free} of ${PLOTS.length} plots are available. A plot costs ${formatMoney(dealershipLevel(1).price)}.`),
        h('div', { class: 'section-title' }, 'Why own a dealership?'),
        h('div', { class: 'muted small', style: { lineHeight: '1.6' } }, 'Display vehicles with your own prices. NPC customers walk in, browse and buy - even while you are offline. Upgrades add display slots, attract more customers, let you charge a premium and unlock a repair bay with discounted repairs.'),
        this.levelTable(0),
      );
    }
    const near = this.game.nearOwnDealership();
    const slots = this.slotVehicles();
    const count = plotSlotCount(d.level);
    const cells: Child[] = [];
    for (let i = 0; i < 12; i++) {
      const v = slots.get(i);
      if (i >= count) {
        cells.push(h('div', { class: 'slot locked' }, h('div', { class: 'sn' }, `SLOT ${i + 1}`), 'Upgrade to unlock'));
      } else if (v) {
        cells.push(this.filledSlot(i, v, near));
      } else {
        cells.push(
          h(
            'div',
            { class: 'slot' },
            h('div', { class: 'sn' }, `SLOT ${i + 1}`),
            h('div', { class: 'muted' }, 'Empty'),
            h('button', { class: 'btn small', disabled: !near || this.busy, 'data-testid': 'slot-place', onclick: () => ((this.placing = { slot: i, vehicleId: '', price: 0 }), this.refresh()) }, 'Place vehicle'),
          ),
        );
      }
    }
    const nameInput = h('input', { class: 'input', maxlength: String(ECONOMY.dealership.nameMaxLength), value: this.newName || d.name });
    nameInput.addEventListener('input', () => (this.newName = nameInput.value));
    return h(
      'div',
      { class: 'col' },
      near ? null : h('div', { class: 'pill gold', style: { alignSelf: 'flex-start' } }, 'Visit your dealership lot to place vehicles or upgrade. Prices can be changed from anywhere.'),
      h(
        'div',
        { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Display slots'), h('div', { class: 'v' }, `${slots.size} / ${count}`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Customer traffic'), h('div', { class: 'v' }, `x${dealershipLevel(d.level).customerRate.toFixed(2)}`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Price premium'), h('div', { class: 'v' }, `+${Math.round(dealershipLevel(d.level).premium * 100)}%`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Reputation'), h('div', { class: 'v gold-text' }, String(this.store.me?.reputation ?? 0))),
      ),
      this.placing ? this.renderPlacing(d.level) : null,
      h('div', { class: 'section-title' }, 'Display floor'),
      h('div', { class: 'slot-grid' }, cells),
      h('div', { class: 'section-title' }, 'Upgrades'),
      this.upgradeCard(d.level, near),
      h('div', { class: 'section-title' }, 'Rename'),
      h('div', { class: 'row' }, nameInput, h('button', { class: 'btn', disabled: this.busy, onclick: () => void this.act(() => this.net.rpc('dealership.rename', { name: this.newName || d.name }), () => this.ui.success('Dealership renamed')) }, 'Save name')),
    );
  }

  private filledSlot(i: number, v: Vehicle, near: boolean): Child {
    const t = vehicleTitle(v);
    const price = this.prices.get(v.id) ?? v.salePrice ?? Math.round(marketValue(v, this.store.trends) * 1.1);
    const input = moneyInput(price, (n) => this.prices.set(v.id, n));
    return h(
      'div',
      { class: 'slot filled' },
      h('div', { class: 'row between' }, h('div', { class: 'sn' }, `SLOT ${i + 1}`), swatch(v)),
      h('div', { style: { fontWeight: '800' } }, t.name),
      h('div', { class: 'tiny muted' }, `Value ${formatMoney(marketValue(v, this.store.trends))}`),
      input,
      h(
        'div',
        { class: 'row wrap', style: { gap: '4px' } },
        h('button', { class: 'btn small primary', disabled: this.busy, onclick: () => void this.act(() => this.net.rpc('dealership.price', { vehicleId: v.id, price: this.prices.get(v.id) ?? price }), () => this.ui.success('Price updated')) }, v.salePrice ? 'Update' : 'Sell'),
        h('button', { class: 'btn small', title: 'Rotate', disabled: this.busy, onclick: () => void this.act(() => this.net.rpc('dealership.price', { vehicleId: v.id, price: v.salePrice, rotation: ((v.rotation + Math.PI / 4 + Math.PI) % (Math.PI * 2)) - Math.PI })) }, '⟳'),
        v.salePrice ? h('button', { class: 'btn small', disabled: this.busy, onclick: () => void this.act(() => this.net.rpc('dealership.price', { vehicleId: v.id, price: null })) }, 'Not for sale') : null,
        h('button', { class: 'btn small danger', disabled: !near || this.busy, onclick: () => void this.act(() => this.net.rpc('dealership.remove', { vehicleId: v.id })) }, 'Remove'),
      ),
    );
  }

  private renderPlacing(level: number): Child {
    const p = this.placing!;
    const candidates = this.store.myVehicles().filter((v) => (v.status === 'stored' || v.status === 'world') && v.serviceUntil <= Date.now() && this.game.driving !== v.id);
    const selected = candidates.find((v) => v.id === p.vehicleId) ?? null;
    if (selected && !p.price) p.price = Math.round((marketValue(selected, this.store.trends) * 1.1) / 50) * 50;
    const slotSel = h(
      'select',
      { class: 'input', onchange: (e: Event) => (p.slot = Number((e.target as HTMLSelectElement).value)) },
      Array.from({ length: plotSlotCount(level) }, (_, i) => i)
        .filter((i) => !this.slotVehicles().has(i))
        .map((i) => h('option', { value: String(i), selected: i === p.slot }, `Slot ${i + 1}`)),
    );
    const vehSel = h(
      'select',
      {
        class: 'input',
        'data-testid': 'place-vehicle',
        onchange: (e: Event) => {
          p.vehicleId = (e.target as HTMLSelectElement).value;
          p.price = 0;
          this.refresh();
        },
      },
      h('option', { value: '' }, candidates.length ? 'Choose a vehicle...' : 'No vehicles available'),
      candidates.map((v) => h('option', { value: v.id, selected: v.id === p.vehicleId }, `${vehicleTitle(v).name} (${formatMoney(marketValue(v, this.store.trends))})`)),
    );
    const priceIn = moneyInput(p.price, (n) => (p.price = n));
    return h(
      'div',
      { class: 'stat', style: { display: 'grid', gap: '10px' } },
      h('div', { class: 'k' }, 'Place a vehicle on display'),
      h('div', { class: 'filters', style: { marginBottom: '0' } }, field('Vehicle', vehSel), field('Slot', slotSel), field('Asking price', priceIn), h('div')),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => ((this.placing = null), this.refresh()) }, 'Cancel'),
        h(
          'button',
          {
            class: 'btn primary',
            disabled: !selected || this.busy,
            'data-testid': 'place-confirm',
            onclick: () =>
              void this.act(
                () => this.net.rpc('dealership.place', { vehicleId: p.vehicleId, slot: p.slot, price: p.price > 0 ? p.price : null, rotation: 0 }),
                () => {
                  this.ui.success('Vehicle on display', 'Customers can now see it on your lot.');
                  this.placing = null;
                },
              ),
          },
          'Place on display',
        ),
      ),
    );
  }

  private upgradeCard(level: number, near: boolean): Child {
    if (level >= MAX_DEALERSHIP_LEVEL) return h('div', { class: 'pill gold' }, 'Fully upgraded - you run a Mega Dealership!');
    const next = dealershipLevel(level + 1);
    const me = this.store.me!;
    const canLevel = me.level >= next.minPlayerLevel;
    const canPay = me.money >= next.price;
    return h(
      'div',
      { class: 'stat', style: { display: 'grid', gap: '8px' } },
      h('div', { class: 'row between' }, h('div', null, h('div', { class: 'k' }, `Next: Level ${next.level}`), h('div', { class: 'v' }, next.name)), h('div', { class: 'money', style: { fontSize: '22px' } }, formatMoney(next.price))),
      h(
        'div',
        { class: 'row wrap', style: { gap: '6px' } },
        h('span', { class: 'pill' }, `${next.slots} display slots`),
        h('span', { class: 'pill' }, `Traffic x${next.customerRate.toFixed(2)}`),
        h('span', { class: 'pill' }, `+${Math.round(next.premium * 100)}% price premium`),
        next.repairDiscount > 0 ? h('span', { class: 'pill green' }, `Repair bay: -${Math.round(next.repairDiscount * 100)}% labour`) : null,
        h('span', { class: `pill ${canLevel ? 'green' : 'red'}` }, `Requires player level ${next.minPlayerLevel}`),
      ),
      h(
        'button',
        { class: 'btn gold', disabled: !near || !canLevel || !canPay || this.busy, 'data-testid': 'dealership-upgrade', onclick: () => void this.act(() => this.net.rpc('dealership.upgrade', {}), () => this.ui.success('Dealership upgraded!', next.name)) },
        !near ? 'Visit your lot to upgrade' : !canLevel ? `Reach level ${next.minPlayerLevel}` : !canPay ? 'Not enough cash' : `Upgrade to ${next.name}`,
      ),
    );
  }

  private levelTable(current: number): Child {
    return h(
      'table',
      { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Level'), h('th', null, 'Name'), h('th', null, 'Price'), h('th', null, 'Slots'), h('th', null, 'Req. level'))),
      h(
        'tbody',
        null,
        ECONOMY.dealership.levels.map((l) =>
          h('tr', { class: l.level === current ? 'me' : '' }, h('td', null, String(l.level)), h('td', null, l.name), h('td', { class: 'money' }, formatMoney(l.price)), h('td', null, String(l.slots)), h('td', null, String(l.minPlayerLevel))),
        ),
      ),
    );
  }
}

export class PlotPanel extends Panel {
  readonly name = 'plot';
  override size = 'narrow' as const;
  private dealershipName = '';

  title() {
    const p = findPlot(this.arg.plotId as string);
    return `Dealership Plot ${p?.index ?? ''}`;
  }
  override subtitle() {
    return 'Dealership Row';
  }
  iconSvg() {
    return ICONS.store;
  }

  renderBody(): Child {
    const plotId = this.arg.plotId as string;
    const owner = this.store.dealerships.get(plotId);
    if (owner) return h('div', { class: 'empty' }, `This plot belongs to ${owner.ownerName}.`);
    if (this.store.myDealership()) return h('div', { class: 'empty' }, 'You already own a dealership. Each player can own one (and upgrade it).');
    const price = dealershipLevel(1).price;
    if (!this.dealershipName) this.dealershipName = `${this.store.me?.name ?? 'My'} Motors`.slice(0, ECONOMY.dealership.nameMaxLength);
    const input = h('input', { class: 'input', maxlength: String(ECONOMY.dealership.nameMaxLength), value: this.dealershipName, 'data-testid': 'plot-name' });
    input.addEventListener('input', () => (this.dealershipName = input.value));
    return h(
      'div',
      { class: 'col' },
      h('div', { class: 'muted small', style: { lineHeight: '1.6' } }, `Buy this plot to open a ${dealershipLevel(1).name} with ${dealershipLevel(1).slots} display slots. You can upgrade it later.`),
      field('Dealership name', input),
      h('div', { class: 'summary' }, h('div', null, 'Price'), h('div', { class: 'money', style: { fontSize: '24px' } }, formatMoney(price))),
    );
  }

  override renderFoot(): Child {
    const plotId = this.arg.plotId as string;
    if (this.store.dealerships.get(plotId) || this.store.myDealership()) return h('button', { class: 'btn', onclick: () => this.ui.closeAll() }, 'Close');
    return [
      h('button', { class: 'btn ghost', onclick: () => this.ui.closeAll() }, 'Cancel'),
      h(
        'button',
        {
          class: 'btn primary',
          disabled: this.busy,
          'data-testid': 'plot-buy',
          onclick: () =>
            void this.act(
              () => this.net.rpc('dealership.buy', { plotId, name: this.dealershipName }),
              () => {
                this.game.audio.play('levelup');
                this.ui.success('Congratulations!', 'You opened your own dealership.');
                this.ui.open('dealership');
              },
            ),
        },
        `Buy for ${formatMoney(dealershipLevel(1).price)}`,
      ),
    ];
  }
}

// Location services: repair garage, car wash, fuel, parts depot, bank (customization: garage.ts).

import { ECONOMY, dealershipLevel } from '../../../../shared/economy.config';
import { REPAIR_PARTS, type RepairPart, type Vehicle } from '../../../../shared/types';
import { fuelCost, marketValue, repairQuote } from '../../../../shared/valuation';
import { formatMoney } from '../../../../shared/util';
import type { InteractKind } from '../../../../shared/world';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { PART_LABELS, bar, condColor, field, statusPill, vehicleSelect, vehicleTitle } from '../widgets';

abstract class ServicePanel extends Panel {
  protected selected: string | null = (this.arg.vehicleId as string | undefined) ?? null;
  abstract kind: InteractKind;

  protected eligible(allowDriving = false): Vehicle[] {
    return this.store
      .myVehicles()
      .filter((v) => (v.status === 'stored' || v.status === 'world' || v.status === 'displayed') && (allowDriving || this.game.driving !== v.id));
  }

  protected here(): boolean {
    return this.game.nearKind(this.kind);
  }

  protected notHere(): Child {
    return h('div', { class: 'pill gold', style: { alignSelf: 'flex-start', marginBottom: '10px' } }, 'You are browsing remotely - visit this location to use the service.');
  }

  protected current(allowDriving = false): Vehicle | undefined {
    const list = this.eligible(allowDriving);
    const v = list.find((x) => x.id === this.selected) ?? list[0];
    if (v) this.selected = v.id;
    return v;
  }

  protected picker(allowDriving = false, describe?: (v: Vehicle) => string): Child {
    return [h('div', { class: 'section-title' }, 'Choose a vehicle'), vehicleSelect(this.eligible(allowDriving), this.selected, (id) => ((this.selected = id), this.refresh()), describe)];
  }
}

// ---------------------------------------------------------------------------

export class RepairPanel extends ServicePanel {
  readonly name = 'repair';
  kind: InteractKind = 'repair';
  private parts = new Set<RepairPart>();
  private useKits = true;
  private initialized = '';

  title() {
    return 'Wrench Bros Repair';
  }
  override subtitle() {
    return 'Mechanical and body repairs - pay once, the car comes back at 100%';
  }
  iconSvg() {
    return ICONS.wrench;
  }

  private discount(): number {
    if (this.game.nearKind('repair')) return 0;
    const d = this.store.myDealership();
    return d && this.game.nearOwnDealership() ? dealershipLevel(d.level).repairDiscount : 0;
  }

  renderBody(): Child {
    const v = this.current();
    if (!v) return h('div', { class: 'empty' }, 'You have no vehicles that can be repaired right now.');
    if (this.initialized !== v.id) {
      this.initialized = v.id;
      this.parts = new Set(REPAIR_PARTS.filter((p) => v.condition[p] < 100));
    }
    const discount = this.discount();
    const inv = this.store.me?.inventory ?? {};
    const quote = repairQuote(v, [...this.parts], { inventory: inv, useKits: this.useKits, laborDiscount: discount });
    const full = repairQuote(v, REPAIR_PARTS, { inventory: inv, useKits: this.useKits, laborDiscount: discount });
    const rows = REPAIR_PARTS.map((p) => {
      const line = full.lines.find((l) => l.part === p)!;
      const on = this.parts.has(p) && line.points > 0;
      const cb = h('input', { type: 'checkbox', checked: on, disabled: line.points === 0 });
      const toggle = () => {
        if (line.points === 0) return;
        if (this.parts.has(p)) this.parts.delete(p);
        else this.parts.add(p);
        this.refresh();
      };
      return h(
        'div',
        { class: `repair-row${on ? '' : ' off'}`, onclick: toggle, 'data-testid': `repair-${p}` },
        cb,
        h('div', null, h('div', { style: { fontWeight: '800' } }, PART_LABELS[p]), line.kitApplied ? h('span', { class: 'pill green', style: { marginTop: '3px' } }, 'kit') : null),
        h('div', null, bar(line.current), h('div', { class: 'from-to', style: { marginTop: '4px' } }, 'CURRENT ', h('span', { style: { color: condColor(line.current) } }, `${line.current}%`), ' -> NEW ', h('span', { style: { color: '#2ee59d' } }, `${line.target}%`))),
        h('div', { class: 'mono small muted' }, line.points ? `${line.seconds.toFixed(0)}s` : '-'),
        h('div', { class: 'money', style: { textAlign: 'right' } }, line.points ? formatMoney(line.cost) : 'OK'),
      );
    });
    const kitsOwned = ECONOMY.parts.reduce((s, k) => s + (inv[k.id] ?? 0), 0);
    const kitToggle = h('input', { type: 'checkbox', checked: this.useKits, onchange: () => ((this.useKits = !this.useKits), this.refresh()) });
    return [
      this.here() || discount > 0 ? null : this.notHere(),
      this.picker(false, (x) => `${Math.round(REPAIR_PARTS.reduce((s, p) => s + x.condition[p], 0) / REPAIR_PARTS.length)}% avg - ${x.serviceUntil > Date.now() ? 'in service' : 'ready'}`),
      h('div', { class: 'section-title' }, `Repair ${vehicleTitle(v).name}`),
      v.serviceUntil > Date.now() ? h('div', { class: 'pill gold', style: { marginBottom: '10px' } }, 'This vehicle is currently in the shop.') : null,
      discount > 0 ? h('div', { class: 'pill green', style: { marginBottom: '10px' } }, `Repair bay discount: -${Math.round(discount * 100)}% labour`) : null,
      rows,
      h('label', { class: 'switch' }, h('span', null, `Use parts kits from inventory (${kitsOwned} owned)`), kitToggle),
      h(
        'div',
        { class: 'summary' },
        h('div', null, h('div', { class: 'tiny muted' }, 'Market value'), h('div', { style: { fontWeight: '800' } }, `${formatMoney(quote.valueBefore)}  ->  `, h('span', { class: 'money' }, formatMoney(quote.valueAfter)))),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'tiny muted' }, `Total (${quote.seconds.toFixed(0)}s)`), h('div', { class: 'money', style: { fontSize: '24px' } }, formatMoney(quote.total))),
      ),
    ];
  }

  override renderFoot(): Child {
    const v = this.current();
    if (!v) return h('button', { class: 'btn', onclick: () => this.ui.closeAll() }, 'Close');
    const quote = repairQuote(v, [...this.parts], { inventory: this.store.me?.inventory ?? {}, useKits: this.useKits, laborDiscount: this.discount() });
    return [
      h('button', { class: 'btn ghost', onclick: () => this.ui.closeAll() }, 'Close'),
      h(
        'button',
        {
          class: 'btn primary',
          'data-testid': 'repair-confirm',
          disabled: this.busy || quote.total === 0 || v.serviceUntil > Date.now(),
          onclick: () =>
            void this.act(
              () => this.net.rpc('repair.start', { vehicleId: v.id, parts: [...this.parts], useKits: this.useKits }),
              (r) => {
                this.initialized = '';
                this.ui.success('Repair started', `${formatMoney(r.cost)} - ready in ${Math.round(r.seconds)}s.`);
              },
            ),
        },
        `Repair for ${formatMoney(quote.total)}`,
      ),
    ];
  }
}

// ---------------------------------------------------------------------------

export class WashPanel extends ServicePanel {
  readonly name = 'wash';
  kind: InteractKind = 'wash';
  title() {
    return 'Sparkle Wash';
  }
  override subtitle() {
    return 'Clean vehicles sell for more';
  }
  iconSvg() {
    return ICONS.drop;
  }
  renderBody(): Child {
    const v = this.current(true);
    if (!v) return h('div', { class: 'empty' }, 'No vehicles available.');
    return [
      this.here() ? null : this.notHere(),
      this.picker(true, (x) => `${Math.round(x.condition.cleanliness)}% clean`),
      h('div', { class: 'section-title' }, `${vehicleTitle(v).name} - currently ${Math.round(v.condition.cleanliness)}% clean`),
      h('div', { style: { marginBottom: '14px' } }, bar(v.condition.cleanliness)),
      h(
        'div',
        { class: 'card-grid' },
        ECONOMY.wash.tiers.map((t) => {
          const after = { ...v, condition: { ...v.condition, cleanliness: Math.max(v.condition.cleanliness, t.cleanTo), interior: Math.min(100, v.condition.interior + t.interiorBonus) } };
          return h(
            'div',
            { class: 'vcard' },
            h('div', { class: 'vname' }, t.label),
            h('div', { class: 'muted small' }, `Cleanliness to ${t.cleanTo}%${t.interiorBonus ? `, interior +${t.interiorBonus}` : ''}`),
            h('div', { class: 'small' }, 'Value after: ', h('span', { class: 'money' }, formatMoney(marketValue(after, this.store.trends)))),
            h('div', { class: 'price' }, formatMoney(t.price)),
            h(
              'button',
              {
                class: 'btn primary',
                'data-testid': `wash-${t.id}`,
                disabled: this.busy || v.serviceUntil > Date.now(),
                onclick: () => void this.act(() => this.net.rpc('wash.start', { vehicleId: v.id, tier: t.id }), () => this.ui.success('Squeaky clean!', `${vehicleTitle(v).name} washed.`)),
              },
              `Wash - ${formatMoney(t.price)}`,
            ),
          );
        }),
      ),
    ];
  }
}

// ---------------------------------------------------------------------------

export class FuelPanel extends ServicePanel {
  readonly name = 'fuel';
  kind: InteractKind = 'fuel';
  override size = 'medium' as const;
  title() {
    return 'Fuel Station';
  }
  override subtitle() {
    return `${formatMoney(ECONOMY.fuel.pricePerPercent * 10)} per 10% of tank`;
  }
  iconSvg() {
    return ICONS.fuel;
  }
  renderBody(): Child {
    const list = this.eligible(true);
    if (list.length === 0) return h('div', { class: 'empty' }, 'No vehicles to refuel.');
    return [
      this.here() ? null : this.notHere(),
      h(
        'div',
        { class: 'col' },
        list.map((v) => {
          const cost = fuelCost(v.fuel);
          return h(
            'div',
            { class: 'repair-row', style: { gridTemplateColumns: '1fr 160px 110px', cursor: 'default' } },
            h('div', null, h('div', { style: { fontWeight: '800' } }, vehicleTitle(v).name), statusPill(v)),
            h('div', null, bar(v.fuel, v.fuel < 20 ? '#ff5c7a' : '#4f8cff'), h('div', { class: 'tiny muted', style: { marginTop: '4px' } }, `${Math.round(v.fuel)}% fuel`)),
            h(
              'button',
              { class: 'btn small primary', disabled: this.busy || cost === 0, onclick: () => void this.act(() => this.net.rpc('fuel.refill', { vehicleId: v.id }), (r) => this.ui.success('Tank full', `Paid ${formatMoney(r.cost)}`)) },
              cost ? `Fill ${formatMoney(cost)}` : 'Full',
            ),
          );
        }),
      ),
    ];
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export class PartsPanel extends Panel {
  readonly name = 'parts';
  override size = 'medium' as const;
  private qty = new Map<string, number>();
  title() {
    return 'Parts Depot';
  }
  override subtitle() {
    return `Kits cover up to ${ECONOMY.repair.kitCoverageMultiplier}x their price in repair parts`;
  }
  iconSvg() {
    return ICONS.box;
  }
  renderBody(): Child {
    const inv = this.store.me?.inventory ?? {};
    const here = this.game.nearKind('parts');
    return [
      here ? null : h('div', { class: 'pill gold', style: { marginBottom: '10px' } }, 'Visit the Parts Depot to buy.'),
      h(
        'div',
        { class: 'col' },
        ECONOMY.parts.map((k) => {
          const q = this.qty.get(k.id) ?? 1;
          const sel = h('select', { class: 'input', style: { width: '80px' }, onchange: (e: Event) => this.qty.set(k.id, Number((e.target as HTMLSelectElement).value)) }, [1, 2, 3, 5, 10].map((n) => h('option', { value: String(n), selected: n === q }, `x${n}`)));
          return h(
            'div',
            { class: 'repair-row', style: { gridTemplateColumns: '1fr 90px 80px 130px', cursor: 'default' } },
            h('div', null, h('div', { style: { fontWeight: '800' } }, k.label), h('div', { class: 'tiny muted' }, `${k.description} Owned: ${inv[k.id] ?? 0}`)),
            h('div', { class: 'money' }, formatMoney(k.price)),
            sel,
            h('button', { class: 'btn small primary', disabled: this.busy || !here, onclick: () => void this.act(() => this.net.rpc('parts.buy', { itemId: k.id, qty: this.qty.get(k.id) ?? 1 }), (r) => this.ui.success('Parts purchased', `Paid ${formatMoney(r.cost)}`)) }, 'Buy'),
          );
        }),
      ),
    ];
  }
}

// ---------------------------------------------------------------------------

export class BankPanel extends Panel {
  readonly name = 'bank';
  override size = 'narrow' as const;
  private amount = 1000;
  title() {
    return 'GetRich Bank';
  }
  override subtitle() {
    return `${(ECONOMY.bank.interestRate * 100).toFixed(1)}% interest every ${ECONOMY.bank.payoutIntervalSec / 60} minutes`;
  }
  iconSvg() {
    return ICONS.bank;
  }
  renderBody(): Child {
    const me = this.store.me!;
    const here = this.game.nearKind('bank');
    const input = h('input', { class: 'input mono', type: 'number', min: '1', step: '100', value: String(this.amount), 'data-testid': 'bank-amount' });
    input.addEventListener('input', () => (this.amount = Math.max(0, Math.round(Number(input.value) || 0))));
    const quick = (label: string, n: number) => h('button', { class: 'btn small', onclick: () => ((this.amount = n), this.refresh()) }, label);
    return h(
      'div',
      { class: 'col' },
      here ? null : h('div', { class: 'pill gold' }, 'Visit the bank to make transfers.'),
      h(
        'div',
        { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Cash'), h('div', { class: 'v money' }, formatMoney(me.money))),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Savings'), h('div', { class: 'v', style: { color: '#8db4ff' } }, formatMoney(me.bank))),
      ),
      h('div', { class: 'muted small' }, 'Purchases are paid in cash. Savings earn interest (capped per payout) and are safe from impulse buys.'),
      field('Amount', input),
      h('div', { class: 'row wrap' }, quick('$1k', 1000), quick('$10k', 10_000), quick('All cash', me.money), quick('All savings', me.bank)),
    );
  }
  override renderFoot(): Child {
    const here = this.game.nearKind('bank');
    return [
      h('button', { class: 'btn', disabled: this.busy || !here, 'data-testid': 'bank-withdraw', onclick: () => void this.act(() => this.net.rpc('bank.withdraw', { amount: this.amount }), () => this.ui.success('Withdrawal complete')) }, 'Withdraw'),
      h('button', { class: 'btn primary', disabled: this.busy || !here, 'data-testid': 'bank-deposit', onclick: () => void this.act(() => this.net.rpc('bank.deposit', { amount: this.amount }), () => this.ui.success('Deposit complete')) }, 'Deposit'),
    ];
  }
}

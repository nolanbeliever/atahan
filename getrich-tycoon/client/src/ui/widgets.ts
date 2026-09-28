// Reusable UI building blocks.

import { REPAIR_PARTS, type Vehicle, type VehicleCondition } from '../../../shared/types';
import { vehicleColor } from '../../../shared/customization';
import { averageCondition, marketValue } from '../../../shared/valuation';
import type { CategoryTrends } from '../../../shared/types';
import { formatKm, formatMoney } from '../../../shared/util';
import { CATEGORY_LABELS, getModel } from '../../../shared/vehicles';
import { h, type Child } from './dom';

export const PART_LABELS: Record<string, string> = {
  engine: 'Engine',
  transmission: 'Transmission',
  brakes: 'Brakes',
  tires: 'Tires',
  body: 'Body',
  interior: 'Interior',
  cleanliness: 'Cleanliness',
};

export function condColor(v: number): string {
  if (v >= 75) return '#2ee59d';
  if (v >= 45) return '#ffc53d';
  return '#ff5c7a';
}

export function bar(value: number, color = condColor(value)): HTMLElement {
  return h('div', { class: 'bar' }, h('div', { style: { width: `${Math.max(0, Math.min(100, value))}%`, background: color } }));
}

export function conditionRows(c: VehicleCondition, compact = false): HTMLElement {
  const keys = compact ? (['engine', 'body', 'cleanliness'] as const) : ([...REPAIR_PARTS, 'cleanliness'] as const);
  return h(
    'div',
    { class: 'col', style: { gap: '5px' } },
    keys.map((k) => h('div', { class: 'cond-row' }, h('span', null, PART_LABELS[k]!), bar(c[k]), h('span', { class: 'mono' }, String(Math.round(c[k]))))),
  );
}

export function swatch(v: Pick<Vehicle, 'color' | 'mods'>): HTMLElement {
  return h('div', { class: 'swatch', style: { background: vehicleColor(v.color, v.mods) } });
}

export function vehicleTitle(v: Pick<Vehicle, 'modelId'>): { name: string; meta: string } {
  const m = getModel(v.modelId);
  return { name: `${m.brand} ${m.name}`, meta: `${m.year} - ${CATEGORY_LABELS[m.category]}` };
}

/** Deal quality indicator comparing price to market value. */
export function dealBadge(price: number, value: number): HTMLElement {
  const r = price / Math.max(1, value);
  if (r <= 0.9) return h('span', { class: 'pill green deal' }, 'Great deal');
  if (r <= 1.0) return h('span', { class: 'pill blue deal' }, 'Fair price');
  if (r <= 1.12) return h('span', { class: 'pill gold deal' }, 'Slightly high');
  return h('span', { class: 'pill red deal' }, 'Overpriced');
}

export function vehicleCard(v: Vehicle, trends: CategoryTrends, opts: { price?: number; priceLabel?: string; extra?: Child; actions?: Child; badges?: Child } = {}): HTMLElement {
  const t = vehicleTitle(v);
  const value = marketValue(v, trends);
  return h(
    'div',
    { class: 'vcard', 'data-vehicle': v.id },
    h('div', { class: 'row' }, swatch(v), h('div', { class: 'grow' }, h('div', { class: 'vname' }, t.name), h('div', { class: 'vmeta' }, t.meta, ' - ', formatKm(v.mileage)))),
    opts.badges ? h('div', { class: 'row wrap', style: { gap: '6px' } }, opts.badges) : null,
    conditionRows(v.condition, true),
    h(
      'div',
      { class: 'row between' },
      opts.price !== undefined
        ? h('div', null, h('div', { class: 'tiny muted' }, opts.priceLabel ?? 'Price'), h('div', { class: 'price' }, formatMoney(opts.price)))
        : h('div', null, h('div', { class: 'tiny muted' }, 'Est. value'), h('div', { class: 'price' }, formatMoney(value))),
      opts.price !== undefined ? h('div', { style: { textAlign: 'right' } }, h('div', { class: 'tiny muted' }, `Value ${formatMoney(value)}`), dealBadge(opts.price, value)) : null,
    ),
    opts.extra ?? null,
    opts.actions ? h('div', { class: 'actions' }, opts.actions) : null,
  );
}

export function statusPill(v: Vehicle, serviceNow = Date.now()): HTMLElement {
  if (v.serviceUntil > serviceNow) return h('span', { class: 'pill gold' }, 'In service');
  switch (v.status) {
    case 'stored':
      return h('span', { class: 'pill' }, 'In storage');
    case 'world':
      return h('span', { class: 'pill blue' }, 'Parked in city');
    case 'displayed':
      return h('span', { class: 'pill green' }, v.salePrice ? `On display - ${formatMoney(v.salePrice)}` : 'On display');
    case 'listed':
      return h('span', { class: 'pill purple' }, `Classifieds - ${formatMoney(v.salePrice ?? 0)}`);
    case 'auction':
      return h('span', { class: 'pill purple' }, 'At auction');
    default:
      return h('span', { class: 'pill' }, v.status);
  }
}

export function avgCond(v: Vehicle): number {
  return Math.round(averageCondition(v.condition));
}

export function moneyInput(value: number, onChange?: (n: number) => void): HTMLInputElement {
  const input = h('input', { class: 'input mono', type: 'number', min: '0', step: '50', value: String(Math.round(value)) });
  if (onChange) input.addEventListener('input', () => onChange(Math.round(Number(input.value) || 0)));
  return input;
}

export function field(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, label, control);
}

export function vehicleSelect(vehicles: Vehicle[], selected: string | null, onSelect: (id: string) => void, describe?: (v: Vehicle) => string): HTMLElement {
  if (vehicles.length === 0) return h('div', { class: 'empty' }, 'No eligible vehicles.');
  return h(
    'div',
    { class: 'card-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' } },
    vehicles.map((v) => {
      const t = vehicleTitle(v);
      return h(
        'div',
        { class: `vcard${v.id === selected ? ' selected' : ''}`, style: { cursor: 'pointer', gap: '6px' }, onclick: () => onSelect(v.id), 'data-select-vehicle': v.id },
        h('div', { class: 'row' }, swatch(v), h('div', { class: 'grow' }, h('div', { class: 'vname', style: { fontSize: '14px' } }, t.name), h('div', { class: 'vmeta' }, describe ? describe(v) : `${avgCond(v)}% condition`))),
      );
    }),
  );
}

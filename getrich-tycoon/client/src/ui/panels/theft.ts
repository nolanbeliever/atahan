// The theft side of town: the Black Market tab of the Marketplace (lockpick sets, shared stock with a
// restock timer), the Pawn Shop (sell stripped parts) and the Sanayi garage office (how it works,
// who is on which lift).

import { ECONOMY } from '../../../../shared/economy.config';
import {
  LIFT_BAYS,
  LOCKPICK_ITEM,
  STRIP_PARTS,
  parsePartItem,
  partsFor,
  pawnPrice,
  removedParts,
  stripPart,
  inSanayiYard,
  papersPrice,
  type BlackMarketInfo,
  type StripPart,
} from '../../../../shared/theft';
import type { Vehicle } from '../../../../shared/types';
import { formatMoney } from '../../../../shared/util';
import { marketValue } from '../../../../shared/valuation';
import { getModel, modelDisplayName } from '../../../../shared/vehicles';
import type { Store } from '../../state/Store';
import { h, icon, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';

const T = ECONOMY.theft;
const TIER_LABELS = ['Economy car', 'Mid-range car', 'Premium car', 'Exotic car'];

/** A Pawn Shop price, or a range when it can vary. */
export function moneyRange(min: number, max: number): string {
  const a = Math.round(min);
  const b = Math.round(max);
  return a === b ? formatMoney(a) : `${formatMoney(a)}-${formatMoney(b)}`;
}

function mmss(ms: number): string {
  const left = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
}

/** Restock countdown text for the Black Market. */
export function blackMarketTimerText(info: BlackMarketInfo, serverNow: number): string {
  const left = info.restockAt - serverNow;
  if (left <= 0) return 'Restocking...';
  return info.stock >= info.max ? `Full · refill check ${mmss(left)}` : `New stock in ${mmss(left)}`;
}

/** Display name of an inventory item from the theft side (lockpick sets, stripped parts). */
export function theftItemLabel(id: string): string | null {
  if (id === LOCKPICK_ITEM) return 'Lockpick & Testere Seti';
  const p = parsePartItem(id);
  if (!p) return null;
  const def = stripPart(p.part)!;
  return `Sökülmüş Parça: ${def.labelTr}`;
}

/** Stripped parts in an inventory, grouped by part (all tiers together). */
export function strippedParts(inv: Record<string, number>): { part: StripPart; count: number; min: number; max: number; items: { id: string; tier: number; qty: number }[] }[] {
  const by = new Map<StripPart, { part: StripPart; count: number; min: number; max: number; items: { id: string; tier: number; qty: number }[] }>();
  for (const [id, qty] of Object.entries(inv)) {
    const p = parsePartItem(id);
    if (!p || qty <= 0) continue;
    const row = by.get(p.part) ?? { part: p.part, count: 0, min: 0, max: 0, items: [] };
    row.count += qty;
    row.min += pawnPrice(p.part, p.tier, 0, p.profile) * qty;
    row.max += pawnPrice(p.part, p.tier, 1, p.profile) * qty;
    row.items.push({ id, tier: p.tier, qty });
    by.set(p.part, row);
  }
  return STRIP_PARTS.map((d) => by.get(d.id)).filter((r): r is NonNullable<typeof r> => !!r);
}

/** A drawing of the set: a pick and a hacksaw. */
function setPicture(): HTMLElement {
  const el = h('div', { class: 'bm-pic' });
  el.innerHTML = `<svg viewBox="0 0 200 110" aria-hidden="true">
    <defs><linearGradient id="bm-steel" x1="0" x2="1"><stop offset="0" stop-color="#9aa3ad"/><stop offset="0.5" stop-color="#e9edf1"/><stop offset="1" stop-color="#8a939c"/></linearGradient></defs>
    <rect x="8" y="10" width="184" height="90" rx="12" fill="#14161b" stroke="#2c3038"/>
    <path d="M30 76 h70" stroke="url(#bm-steel)" stroke-width="4" stroke-linecap="round"/>
    <path d="M100 76 l10 -8 l4 4 l6 -6" fill="none" stroke="url(#bm-steel)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="18" y="70" width="18" height="12" rx="4" fill="#c0392b"/>
    <path d="M30 56 h80" stroke="url(#bm-steel)" stroke-width="3" stroke-linecap="round"/>
    <path d="M110 56 l8 -3" stroke="url(#bm-steel)" stroke-width="3" stroke-linecap="round"/>
    <rect x="18" y="50" width="18" height="12" rx="4" fill="#2d3436"/>
    <path d="M128 30 h48 v40 h-48" fill="none" stroke="#c9cdd2" stroke-width="4" stroke-linejoin="round"/>
    <path d="M128 70 h48" stroke="#d6dade" stroke-width="2"/>
    <path d="M128 70 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4" fill="none" stroke="#b6bcc2" stroke-width="1.5"/>
    <rect x="118" y="24" width="16" height="22" rx="5" fill="#e67e22"/>
  </svg>`;
  return el;
}

/** The Black Market tab: the set, its price, the shared stock and the restock countdown. */
export function blackMarketView(ctx: { store: Store; busy: boolean }, onBuy: () => void): { el: HTMLElement; timer: HTMLElement } {
  const s = ctx.store.blackMarket;
  const timer = h('div', { class: 'bm-timer mono', 'data-testid': 'bm-timer' }, s ? blackMarketTimerText(s, ctx.store.serverNow()) : '--:--');
  const head = h(
    'div',
    { class: 'rare-head' },
    h('div', null, h('div', { class: 'bm-title' }, 'Black Market'), h('div', { class: 'tiny muted' }, `Ask no questions. ${T.stockMax} sets per ${T.restockSec / 60} minutes for the whole city.`)),
    timer,
  );
  if (!s) return { el: h('div', { 'data-testid': 'black-market' }, head, h('div', { class: 'empty' }, 'Knocking on the back door...')), timer };
  const money = ctx.store.me?.money ?? 0;
  const owned = ctx.store.lockpicks();
  const pips = h(
    'div',
    { class: 'bm-pips', title: `${s.stock} of ${s.max} in stock` },
    Array.from({ length: s.max }, (_, i) => h('span', { class: i < s.stock ? 'on' : '' })),
  );
  const soldOut = s.stock <= 0;
  const card = h(
    'div',
    { class: 'bm-card', 'data-testid': 'bm-item' },
    setPicture(),
    h(
      'div',
      { class: 'col', style: { gap: '8px', flex: '1' } },
      h('div', { class: 'vname' }, 'Lockpick & Testere Seti'),
      h('div', { class: 'tiny muted' }, `${T.picks} picks (3 HAK) and a hacksaw. One set per car: three snapped picks and the alarm goes off - the police come with 2 stars.`),
      h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'tiny muted', style: { fontWeight: '800' } }, 'STOCK'), pips, h('span', { class: 'mono', 'data-testid': 'bm-stock' }, `${s.stock} / ${s.max}`)),
      h('div', { class: 'row wrap', style: { gap: '6px' } }, h('span', { class: `pill ${owned > 0 ? 'green' : ''}`, 'data-testid': 'bm-owned' }, `You own ${owned}`), soldOut ? h('span', { class: 'pill red' }, 'Sold out') : null),
      h(
        'div',
        { class: 'row between', style: { alignItems: 'flex-end' } },
        h('div', { class: 'price' }, formatMoney(s.price)),
        h(
          'button',
          {
            class: 'btn small danger',
            'data-testid': 'bm-buy',
            disabled: ctx.busy || soldOut || money < s.price,
            title: soldOut ? 'Sold out' : money < s.price ? 'Not enough cash' : '',
            onclick: onBuy,
          },
          soldOut ? 'Sold out' : `Buy ${formatMoney(s.price)}`,
        ),
      ),
    ),
  );
  const steps = h(
    'ol',
    { class: 'bm-steps' },
    h('li', null, 'Find a parked car on a city street or a broken-down one on the highway shoulder.'),
    h('li', null, h('b', null, 'Lockpick Et (E)'), ': set the pick angle (mouse / A-D), turn it (W / Space / click). Wrong angle: the pick strains and snaps, then a green zone and an arrow on the dial show where the right angle is.'),
    h('li', null, 'Drive it to the ', h('b', null, 'Sanayi'), ' (south of the city, wrench icon on the map) and line it up between a lift’s posts: ', h('b', null, 'Aracı Lifte Kaldır (F)'), '.'),
    h('li', null, 'Walk to the glowing markers round the car and strip the parts (E). At the front, open the ', h('b', null, 'engine bay'), ': engine block, gearbox, turbo, ECU, radiator, alternator, battery.'),
    h('li', null, 'Sell the parts at the ', h('b', null, 'Pawn Shop'), ` next door: ${moneyRange(T.pawnMin, T.pawnMax)} for a whole car (araç başı); each part fetches its share.`),
  );
  return { el: h('div', { class: 'black-market', 'data-testid': 'black-market' }, head, card, steps), timer };
}

// ------------------------------------------------------------------ Pawn Shop

export class PawnPanel extends Panel {
  readonly name = 'pawn';
  override size = 'medium' as const;

  title() {
    return 'Pawn Shop';
  }
  override subtitle() {
    return 'Rehin Dükkanı - cash for parts, no paperwork';
  }
  iconSvg() {
    return ICONS.coins;
  }

  renderBody(): Child {
    const inv = this.store.me?.inventory ?? {};
    const rows = strippedParts(inv);
    if (rows.length === 0) {
      return h(
        'div',
        { class: 'empty', 'data-testid': 'pawn-empty' },
        h('div', { style: { fontSize: '16px', fontWeight: '800', marginBottom: '6px' } }, 'Nothing to sell'),
        `Strip a stolen car at the Sanayi next door: all the parts of one car fetch ${moneyRange(T.pawnMin, T.pawnMax)} here.`,
      );
    }
    const total = rows.reduce((a, r) => ({ min: a.min + r.min, max: a.max + r.max, n: a.n + r.count }), { min: 0, max: 0, n: 0 });
    return h(
      'div',
      { class: 'col' },
      h('div', { class: 'muted small' }, `A whole car’s parts fetch ${moneyRange(T.pawnMin, T.pawnMax)} (araç başı); each part is worth its share of that, the engine block most, the mirrors least.`),
      h(
        'table',
        { class: 'table', 'data-testid': 'pawn-list' },
        h('thead', null, h('tr', null, h('th', null, 'Sökülmüş Parça'), h('th', null, 'Qty'), h('th', null, 'Pays'), h('th', null, ''))),
        h(
          'tbody',
          null,
          rows.map((r) => {
            const def = stripPart(r.part)!;
            return h(
              'tr',
              { 'data-part': r.part },
              h('td', null, h('div', { style: { fontWeight: '700' } }, def.labelTr), h('div', { class: 'tiny muted' }, `${def.label} · ${r.items.map((i) => `${i.qty}× ${TIER_LABELS[i.tier]}`).join(', ')}`)),
              h('td', { class: 'mono' }, String(r.count)),
              h('td', { class: 'mono' }, moneyRange(r.min, r.max)),
              h('td', null, h('button', { class: 'btn small', disabled: this.busy, 'data-testid': 'pawn-sell-part', onclick: () => void this.sell(r.part) }, 'Sat')),
            );
          }),
        ),
      ),
      h('div', { class: 'row between' }, h('div', { class: 'muted small' }, `${total.n} part${total.n === 1 ? '' : 's'}`), h('div', { class: 'mono' }, moneyRange(total.min, total.max))),
    );
  }

  override renderFoot(): Child {
    const any = strippedParts(this.store.me?.inventory ?? {}).length > 0;
    return [
      h('button', { class: 'btn ghost', onclick: () => this.ui.closeAll() }, 'Leave'),
      h('button', { class: 'btn primary', disabled: this.busy || !any, 'data-testid': 'pawn-sell-all', onclick: () => void this.sell() }, 'Hepsini Sat (sell all)'),
    ];
  }

  private async sell(part?: StripPart): Promise<void> {
    await this.act(
      () => this.net.rpc('pawn.sell', part ? { part } : {}),
      () => this.game.audio.play('purchase'),
    );
  }
}

// ------------------------------------------------------------------ Sanayi garage office

export class SanayiPanel extends Panel {
  readonly name = 'sanayi';
  override size = 'medium' as const;

  title() {
    return 'Sanayi Garage';
  }
  override subtitle() {
    return 'Izgara Garajı - lifts, tools, no questions';
  }
  iconSvg() {
    return ICONS.lift;
  }

  override init(): void {
    this.listen(this.store.on('vehicles', () => this.refresh()));
    this.listen(this.store.on('vehicle', () => this.refresh()));
    this.listen(this.store.on('vehicleRemoved', () => this.refresh()));
  }

  private lifted(): (Vehicle & { ownerName?: string | null })[] {
    const all = new Map<string, Vehicle & { ownerName?: string | null }>();
    for (const v of this.store.vehicles.values()) if (v.mods.strip) all.set(v.id, v);
    for (const v of this.store.myVehicles()) if (v.mods.strip) all.set(v.id, v);
    return [...all.values()];
  }

  renderBody(): Child {
    const me = this.store.playerId;
    const lifted = this.lifted();
    const mine = this.store.myVehicles().filter((v) => v.status === 'stolen' && !v.mods.strip);
    const bays = LIFT_BAYS.map((_b, i) => {
      const v = lifted.find((x) => x.mods.strip?.bay === i);
      if (!v) return h('div', { class: 'bay-card free' }, h('div', { class: 'bay-n' }, `LIFT ${i + 1}`), h('div', null, 'Free'), h('div', { class: 'tiny muted' }, 'Drive a stolen car between the posts and press F.'));
      const parts = partsFor(getModel(v.modelId));
      const off = removedParts(v.mods).length;
      const own = v.ownerId === me;
      return h(
        'div',
        { class: `bay-card ${own ? 'mine' : ''}`, 'data-testid': 'sanayi-bay' },
        h('div', { class: 'bay-n' }, `LIFT ${i + 1}`),
        h('div', { style: { fontWeight: '800' } }, modelDisplayName(v.modelId)),
        h('div', { class: 'tiny muted' }, own ? 'Your car' : `${v.ownerName ?? 'Someone'}’s car`),
        h('div', { class: 'bar' }, h('div', { style: { width: `${Math.round((off / parts.length) * 100)}%`, background: '#ffc53d' } })),
        h('div', { class: 'tiny' }, `${off} / ${parts.length} parts off`),
        own
          ? h(
              'div',
              { class: 'row wrap', style: { gap: '4px' } },
              parts.map((p) => h('span', { class: `pill ${removedParts(v.mods).includes(p) ? 'green' : ''}` }, stripPart(p)!.labelTr)),
            )
          : null,
      );
    });
    return h(
      'div',
      { class: 'col' },
      h('div', { class: 'bay-grid' }, bays),
      mine.length
        ? h('div', { class: 'pill gold', style: { alignSelf: 'flex-start' } }, `Your stolen car${mine.length > 1 ? 's' : ''}: ${mine.map((v) => modelDisplayName(v.modelId)).join(', ')} - drive it onto a free lift`)
        : null,
      this.renderPapers(mine),
      h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Part'), h('th', null, 'Work'), h('th', null, 'Where'))),
        h(
          'tbody',
          null,
          STRIP_PARTS.map((p) =>
            h(
              'tr',
              null,
              h('td', null, h('div', { style: { fontWeight: '700' } }, p.labelTr), h('div', { class: 'tiny muted' }, p.label)),
              h('td', { class: 'mono' }, `${p.seconds}s`),
              h('td', { class: 'tiny muted' }, WHERE[p.id]),
            ),
          ),
        ),
      ),
      h('div', { class: 'muted small' }, `Stolen cars left alone for ${T.abandonSec / 60} minutes are recovered by the police; cars left on a lift for ${T.liftIdleSec / 60} minutes go for scrap. Strip every part and the shell is scrapped for you.`),
    );
  }

  /** Forged papers: make a stolen car parked in the yard your own (then keep it or sell it). */
  private renderPapers(mine: Vehicle[]): Child {
    const trends = this.store.trends;
    return h(
      'div',
      { class: 'col', style: { gap: '6px' } },
      h('div', { class: 'section-title' }, 'Sahte Evrak · Forged papers'),
      h('div', { class: 'tiny muted' }, `Parçalamak istemiyor musun? Çalıntı arabayı Sanayi bahçesine park et, arabadan in, evrakını çıkar: araç tamamen senin olur, garajına koyabilir ya da Marketplace'te ilana çıkarabilirsin. Ücret: değerinin %${Math.round(T.papersRate * 100)}'i (en az ${formatMoney(T.papersMin)}).`),
      mine.length === 0
        ? h('div', { class: 'tiny muted' }, 'Bahçede çalıntı araban yok.')
        : mine.map((v) => {
            const price = papersPrice(marketValue(v, trends));
            const here = inSanayiYard(v.x, v.z);
            const driving = this.game.driving === v.id;
            return h(
              'div',
              { class: 'row between papers-row', 'data-testid': 'papers-row' },
              h('div', null, h('div', { style: { fontWeight: '800' } }, modelDisplayName(v.modelId)), h('div', { class: 'tiny muted' }, `Değeri ~${formatMoney(marketValue(v, trends))}`)),
              h(
                'button',
                {
                  class: 'btn small primary',
                  disabled: this.busy || !here || driving,
                  title: !here ? 'Önce arabayı Sanayi bahçesine getir.' : driving ? 'Önce arabadan in.' : '',
                  'data-testid': 'papers-buy',
                  onclick: () =>
                    void this.act(
                      () => this.net.rpc('sanayi.papers', { vehicleId: v.id }),
                      (r) => {
                        this.game.audio.play('purchase');
                        this.ui.toast({ kind: 'success', title: 'ARAÇ TAMAMEN SENİN!', text: `${modelDisplayName(r.vehicle.modelId)} - evrak ücreti ${formatMoney(r.price)}. Marketplace > İlan Ver'den satabilirsin.` });
                      },
                    ),
                },
                !here ? 'Bahçeye getir' : driving ? 'Arabadan in' : `Evrak çıkar (${formatMoney(price)})`,
              ),
            );
          }),
    );
  }

  override renderFoot(): Child {
    return [h('button', { class: 'btn ghost', onclick: () => this.ui.closeAll() }, 'Close'), h('button', { class: 'btn primary', onclick: () => this.ui.open('pawn') }, icon(ICONS.coins), 'Pawn Shop')];
  }
}

const WHERE: Record<StripPart, string> = {
  mirrors: 'Driver side, by the mirror',
  doors: 'Driver side, by the door',
  steering: 'Passenger side, front',
  seats: 'Passenger side, rear',
  exhaust: 'Behind the car',
  engine: 'Engine bay (front)',
  gearbox: 'Engine bay (front)',
  turbo: 'Engine bay - turbo / supercharged cars',
  ecu: 'Engine bay (front)',
  radiator: 'Engine bay (front)',
  alternator: 'Engine bay - not on electric cars',
  battery: 'Engine bay (front)',
};

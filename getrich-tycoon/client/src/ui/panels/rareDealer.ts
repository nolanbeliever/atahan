// Rare Dealer tab of the Marketplace: the rotating special stock with its countdown, odds and
// vehicle pictures (a photo when the model has one, otherwise a 3D render).

import { ECONOMY } from '../../../../shared/economy.config';
import { isCategoryUnlocked } from '../../../../shared/progression';
import { TIER_COLORS, TIER_LABELS, appearanceChance, tierChance, type RareMarketState, type RareOffer } from '../../../../shared/rareMarket';
import { calculateVehicleStats, tuningOf } from '../../../../shared/tuningSystem';
import { formatKm, formatMoney } from '../../../../shared/util';
import { marketValue } from '../../../../shared/valuation';
import { findPart } from '../../../../shared/modificationsData';
import { getModel } from '../../../../shared/vehicles';
import { getStudio } from '../../render/Studio';
import type { Store } from '../../state/Store';
import { h } from '../dom';
import { avgCond, dealBadge } from '../widgets';

export function rareTimerText(s: RareMarketState, serverNow: number): string {
  const left = Math.max(0, Math.ceil((s.endsAt - serverNow) / 1000));
  const m = Math.floor(left / 60);
  const sec = left % 60;
  return left > 0 ? `Timer: ${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : 'Restocking...';
}

/** Picture of an offer: its photo if it has one, else a 3D studio render (made one per frame). */
function picture(offer: RareOffer): HTMLElement {
  const model = getModel(offer.vehicle.modelId);
  const img = h('img', { class: 'rare-img', alt: `${model.brand} ${model.name}`, loading: 'lazy' });
  const render = () =>
    requestAnimationFrame(() => {
      const studio = getStudio();
      if (studio) void studio.snapshot(offer.vehicle).then((url) => (img.src = url));
    });
  if (model.image) {
    img.addEventListener('error', render, { once: true });
    img.src = model.image;
  } else render();
  return h('div', { class: 'rare-pic', style: { borderColor: TIER_COLORS[offer.tier] } }, img);
}

function tunedLabel(offer: RareOffer): string | null {
  const perf = tuningOf(offer.vehicle.mods).perf;
  const parts = Object.values(perf).filter(Boolean);
  if (!parts.length) return null;
  const ecu = findPart(perf.ecu);
  return ecu ? `Tuned: ${ecu.name.split(' - ')[0]} + ${parts.length - 1} parts` : `Tuned: ${parts.length} parts`;
}

export function rareDealerView(
  ctx: { store: Store; busy: boolean },
  onBuy: (offerId: string, price: number) => void,
): { el: HTMLElement; timer: HTMLElement } {
  const s = ctx.store.rare;
  const timer = h('div', { class: 'rare-timer mono', 'data-testid': 'rare-timer' }, s ? rareTimerText(s, ctx.store.serverNow()) : 'Timer: --:--');
  const odds = h(
    'div',
    { class: 'row wrap rare-odds' },
    h('span', { class: 'tiny muted', style: { fontWeight: '800' } }, 'ODDS PER OFFER:'),
    h('span', { class: 'pill', style: { color: TIER_COLORS.common } }, `Common / Uncommon ${Math.round((tierChance('common') + tierChance('uncommon')) * 100)}%`),
    h('span', { class: 'pill', style: { color: TIER_COLORS.rare } }, `Rare / Epic ${Math.round((tierChance('rare') + tierChance('epic')) * 100)}%`),
    h('span', { class: 'pill', style: { color: TIER_COLORS.legendary } }, `Legendary ${Math.round(tierChance('legendary') * 100)}%`),
  );
  const head = h(
    'div',
    { class: 'rare-head' },
    h('div', null, h('div', { class: 'rare-title' }, 'Rare Dealer'), h('div', { class: 'tiny muted' }, `${ECONOMY.rareMarket.slots} special offers. The whole stock changes every ${ECONOMY.rareMarket.rotationSec / 60} minutes for everyone.`)),
    timer,
  );
  if (!s) return { el: h('div', null, head, odds, h('div', { class: 'empty' }, 'Loading stock...')), timer };

  const me = ctx.store.me;
  const level = me?.level ?? 1;
  const money = me?.money ?? 0;
  const expired = ctx.store.serverNow() >= s.endsAt;
  const cards = s.offers.map((o) => {
    const model = getModel(o.vehicle.modelId);
    const stats = calculateVehicleStats(model, o.vehicle.mods.tuning);
    const value = marketValue(o.vehicle, ctx.store.trends);
    const locked = !isCategoryUnlocked(model.category, level);
    const tuned = tunedLabel(o);
    const legendary = o.tier === 'legendary';
    let action: HTMLElement;
    if (o.soldTo) action = h('span', { class: 'pill red' }, `Sold to ${o.soldTo}`);
    else if (locked) action = h('span', { class: 'pill red' }, `Unlocks at level ${ECONOMY.categoryUnlockLevel[model.category]}`);
    else
      action = h(
        'button',
        {
          class: `btn small ${legendary ? 'gold-btn' : 'primary'}`,
          'data-testid': 'rare-buy',
          'data-offer': o.id,
          disabled: ctx.busy || expired || money < o.price,
          title: money < o.price ? 'Not enough cash' : '',
          onclick: () => onBuy(o.id, o.price),
        },
        `Buy ${formatMoney(o.price)}`,
      );
    return h(
      'div',
      { class: `rare-card tier-${o.tier}${o.soldTo ? ' sold' : ''}`, 'data-testid': 'rare-offer', 'data-model': model.id, 'data-tier': o.tier },
      picture(o),
      h('div', { class: 'rare-tier', style: { background: TIER_COLORS[o.tier] } }, TIER_LABELS[o.tier]),
      h('div', { class: 'vname' }, `${model.brand} ${model.name}`),
      h('div', { class: 'vmeta' }, `${model.year} · ${formatKm(o.vehicle.mileage)} · ${avgCond(o.vehicle)}% condition`),
      h('div', { class: 'rare-specs mono' }, `${stats.hp} hp · ${stats.torque} Nm · 0-100 ${stats.accel}s · ${stats.topSpeed} km/h`),
      h(
        'div',
        { class: 'row wrap', style: { gap: '6px' } },
        tuned ? h('span', { class: 'pill purple' }, tuned) : null,
        legendary ? h('span', { class: 'pill gold' }, `Drop chance ${(appearanceChance(model.id) * 100).toFixed(1)}% / rotation`) : null,
        dealBadge(o.price, value),
      ),
      h('div', { class: 'row between', style: { alignItems: 'flex-end' } }, h('div', null, h('div', { class: 'tiny muted' }, `Value ${formatMoney(value)}`), h('div', { class: 'price' }, formatMoney(o.price))), action),
    );
  });
  return { el: h('div', { 'data-testid': 'rare-dealer' }, head, odds, h('div', { class: 'card-grid rare-grid' }, cards)), timer };
}

// Ammu-Nation (guns for cash, premium guns for VIP Coins, ammo boxes) and the hospital front desk.

import { ECONOMY } from '../../../../shared/economy.config';
import { VIP_COIN } from '../../../../shared/rewards';
import { formatMoney } from '../../../../shared/util';
import { AMMO, WEAPONS, ammoDef, weaponItem, type WeaponDef } from '../../../../shared/weapons';
import { h, icon, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';

const C = ECONOMY.combat;

/** A little picture of each gun (our own SVG). */
const GUN_SVG: Record<string, string> = {
  pistol: '<svg viewBox="0 0 64 32"><path fill="currentColor" d="M6 8h40l4 4v4H24l-4 12h-9l3-12H6z"/></svg>',
  shotgun: '<svg viewBox="0 0 64 32"><path fill="currentColor" d="M2 12h44v5H2zM40 12l14-4 8 2-2 8-12 2-6-3z"/><rect x="18" y="17" width="12" height="4" fill="currentColor"/></svg>',
  rifle: '<svg viewBox="0 0 64 32"><path fill="currentColor" d="M2 11h40v6H2zM42 10h10l10 4v6l-14 2-4-6zM22 17h6l-2 12h-6z"/></svg>',
  gold_deagle: '<svg viewBox="0 0 64 32"><path fill="currentColor" d="M4 7h44l5 4v6H26l-5 13H10l4-13H4z"/></svg>',
  laser_rpg: '<svg viewBox="0 0 64 32"><rect x="4" y="11" width="50" height="9" rx="2" fill="currentColor"/><path fill="currentColor" d="M54 9l8 2v10l-8 2zM22 20h6v8h-6z"/></svg>',
  minigun: '<svg viewBox="0 0 64 32"><rect x="2" y="8" width="44" height="3" fill="currentColor"/><rect x="2" y="13" width="44" height="3" fill="currentColor"/><rect x="2" y="18" width="44" height="3" fill="currentColor"/><rect x="40" y="6" width="18" height="18" rx="3" fill="currentColor"/></svg>',
};

function gunIcon(w: WeaponDef): HTMLElement {
  const el = h('div', { class: 'gun-pic', style: { color: w.vip !== null ? '#ffd35a' : '#cfd6e4' } });
  el.innerHTML = GUN_SVG[w.id] ?? '';
  return el;
}

export class AmmuPanel extends Panel {
  readonly name = 'ammu';
  override size = 'wide' as const;

  title() {
    return 'Ammu-Nation';
  }
  override subtitle() {
    const coins = this.store.me?.inventory[VIP_COIN] ?? 0;
    return `Guns, ammo, no questions · VIP Coins: ${coins}`;
  }
  iconSvg() {
    return ICONS.mask;
  }

  renderBody(): Child {
    const inv = this.store.me?.inventory ?? {};
    const money = this.store.me?.money ?? 0;
    const coins = inv[VIP_COIN] ?? 0;
    const cards = WEAPONS.map((w) => {
      const owned = (inv[weaponItem(w.id)] ?? 0) > 0;
      const ammo = inv[w.ammo] ?? 0;
      const box = ammoDef(w.ammo)!;
      const premium = w.vip !== null;
      const afford = premium ? coins >= w.vip! : money >= w.price!;
      return h(
        'div',
        { class: `gun-card${premium ? ' premium' : ''}${owned ? ' owned' : ''}`, 'data-testid': 'gun-card', 'data-gun': w.id },
        h('div', { class: 'row between' }, h('div', { class: 'gun-name' }, w.name), h('span', { class: 'pill' }, `${w.slot}`)),
        gunIcon(w),
        h('div', { class: 'tiny muted' }, w.description),
        h(
          'div',
          { class: 'gun-stats tiny' },
          h('span', null, `DMG ${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ''}${w.blast ? ` · blast ${w.blast.damage}` : ''}`),
          h('span', null, `${w.rate}/s${w.auto ? ' auto' : ''}`),
          h('span', null, `${w.range} m`),
        ),
        owned
          ? h('div', { class: 'row between' }, h('span', { class: 'pill green' }, `Owned · ${ammo} rounds`), h('button', { class: 'btn small', disabled: this.busy || money < box.price, 'data-testid': 'buy-ammo', 'data-ammo': box.id, onclick: () => void this.buy(box.id) }, `+${box.rounds} (${formatMoney(box.price)})`))
          : h(
              'button',
              { class: `btn small ${premium ? 'gold' : 'primary'}`, disabled: this.busy || !afford, 'data-testid': 'buy-gun', onclick: () => void this.buy(weaponItem(w.id)) },
              premium ? `${w.vip} VIP Coin` : formatMoney(w.price!),
            ),
      );
    });
    return h(
      'div',
      { class: 'col' },
      h('div', { class: 'tiny muted' }, 'Draw a gun with its number key (1-6), aim with the mouse, left click to fire, Q to put it away. Shooting at people brings 3 police stars at once; from 3 stars officers get out and shoot back. Other players and their cars are safe: no PvP in the city.'),
      h('div', { class: 'gun-grid' }, cards),
      h('div', { class: 'tiny muted' }, `Premium guns are paid with VIP Coins only: 10 for a 7-day login streak, 5 for each 3-hour playtime reward. There is no real-money shop.`),
      h('div', { class: 'section-title' }, 'Ammo boxes'),
      h(
        'table',
        { class: 'table' },
        h('tbody', null, AMMO.map((a) => h('tr', null, h('td', null, a.name), h('td', { class: 'muted' }, WEAPONS.find((w) => w.id === a.weapon)!.name), h('td', { class: 'mono' }, `${a.rounds} rds`), h('td', { class: 'mono' }, formatMoney(a.price)), h('td', { class: 'mono' }, String(inv[a.id] ?? 0))))),
      ),
    );
  }

  private async buy(item: string): Promise<void> {
    await this.act(
      () => this.net.rpc('ammu.buy', { item }),
      () => this.game.audio.play('purchase'),
    );
  }
}

export class HospitalPanel extends Panel {
  readonly name = 'hospital';
  override size = 'narrow' as const;

  title() {
    return 'GetRich General Hospital';
  }
  override subtitle() {
    return 'Hastane · patched up while you wait';
  }
  iconSvg() {
    return ICONS.user;
  }

  override init(): void {
    this.listen(this.store.on('health', () => this.refresh()));
  }

  renderBody(): Child {
    const hp = this.store.health?.hp ?? C.playerHp;
    return h(
      'div',
      { class: 'col' },
      h('div', { class: 'row between' }, h('div', null, 'Health'), h('div', { class: 'mono', 'data-testid': 'hospital-hp' }, `${hp} / ${C.playerHp}`)),
      h('div', { class: 'bar' }, h('div', { style: { width: `${(hp / C.playerHp) * 100}%`, background: hp < 35 ? '#ff5c7a' : '#2ee59d' } })),
      h('div', { class: 'tiny muted' }, `Health also comes back by itself out of a fight. If it hits zero you are WASTED and wake up here: the police take your lockpick sets, stripped parts and stolen cars.`),
      h('button', { class: 'btn primary', disabled: this.busy || hp >= C.playerHp, 'data-testid': 'hospital-heal', onclick: () => void this.act(() => this.net.rpc('hospital.heal', {}), (v) => this.store.setHealth(v)) }, icon(ICONS.user), `Patch me up (${formatMoney(C.healPrice)})`),
    );
  }
}

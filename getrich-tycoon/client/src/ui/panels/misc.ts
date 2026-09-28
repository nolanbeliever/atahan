// Main menu, map, settings and profile.

import { ACHIEVEMENTS, levelProgress } from '../../../../shared/progression';
import type { Appearance, LeaderboardEntry, PlayerSettings, Transaction } from '../../../../shared/types';
import { formatMoney } from '../../../../shared/util';
import { INTERACTABLES, ZONES } from '../../../../shared/world';
import { logoutRequest, session } from '../../net/api';
import { h, icon, type Child } from '../dom';
import { ICONS } from '../icons';
import { drawMap, INTERACT_COLORS } from '../Minimap';
import { Panel } from '../Panel';
import type { PanelName } from './index';

export class MenuPanel extends Panel {
  readonly name = 'menu';
  override size = 'medium' as const;
  title() {
    return 'GetRich Tycoon';
  }
  override subtitle() {
    return `Signed in as ${this.store.me?.name ?? ''}`;
  }
  iconSvg() {
    return ICONS.menu;
  }
  renderBody(): Child {
    const item = (label: string, svg: string, panel: PanelName, hk: string) =>
      h('button', { onclick: () => this.ui.open(panel), 'data-testid': `menu-${panel}` }, icon(svg), label, h('span', { class: 'hk' }, hk));
    return h(
      'div',
      { class: 'menu' },
      item('Marketplace', ICONS.market, 'market', 'B'),
      item('Garage', ICONS.garage, 'inventory', 'I'),
      item('Dealership', ICONS.store, 'dealership', 'J'),
      item('Auctions', ICONS.gavel, 'auctions', 'K'),
      item('Map', ICONS.map, 'map', 'M'),
      item('Profile', ICONS.user, 'profile', 'O'),
      item('Bank', ICONS.bank, 'bank', ''),
      item('Repair', ICONS.wrench, 'repair', ''),
      item('Settings', ICONS.gear, 'settings', ''),
    );
  }
  override renderFoot(): Child {
    return [
      h(
        'button',
        {
          class: 'btn ghost',
          onclick: async () => {
            const t = session.get();
            if (t) await logoutRequest(t);
            session.clear();
            location.reload();
          },
        },
        icon(ICONS.logout),
        'Log out',
      ),
      h('button', { class: 'btn primary', onclick: () => this.ui.closeAll() }, 'Resume'),
    ];
  }
}

export class MapPanel extends Panel {
  readonly name = 'map';
  private canvas = document.createElement('canvas');
  private timer: number | null = null;
  title() {
    return 'City Map';
  }
  override subtitle() {
    return 'GetRich City';
  }
  iconSvg() {
    return ICONS.map;
  }
  override init(): void {
    this.canvas.width = 720;
    this.canvas.height = 720;
    const draw = () => drawMap(this.canvas.getContext('2d')!, 720, this.game, 0, 0, 170, null);
    draw();
    this.timer = window.setInterval(draw, 250);
  }
  override dispose(): void {
    if (this.timer) window.clearInterval(this.timer);
    super.dispose();
  }
  renderBody(): Child {
    const labels: Record<string, string> = { market: 'Used Market', auction: 'Auctions', repair: 'Repair', parts: 'Parts', wash: 'Car Wash', fuel: 'Fuel', bank: 'Bank', custom: 'Customs' };
    return h(
      'div',
      { class: 'map-wrap' },
      this.canvas,
      h(
        'div',
        { class: 'legend' },
        h('div', { class: 'section-title' }, 'Districts'),
        ZONES.map((z) => h('div', null, h('i', { style: { background: z.color } }), z.name)),
        h('div', { class: 'section-title' }, 'Services'),
        INTERACTABLES.map((i) => h('div', null, h('i', { style: { background: INTERACT_COLORS[i.kind] ?? '#fff', borderRadius: '50%' } }), labels[i.kind] ?? i.kind)),
        h('div', { class: 'section-title' }, 'Markers'),
        h('div', null, h('i', { style: { background: '#2ee59d' } }), 'You'),
        h('div', null, h('i', { style: { background: '#4f8cff', borderRadius: '50%' } }), 'Other players'),
        h('div', null, h('i', { style: { background: '#ffc53d' } }), 'Your vehicles / dealership'),
        h('div', null, h('i', { style: { background: '#ffd166' } }), 'Customers'),
      ),
    );
  }
}

export class SettingsPanel extends Panel {
  readonly name = 'settings';
  override size = 'narrow' as const;
  private s: PlayerSettings = { ...this.ui.game.store.me!.settings };
  title() {
    return 'Settings';
  }
  iconSvg() {
    return ICONS.gear;
  }
  override onStoreChange(): void {}
  renderBody(): Child {
    const slider = (label: string, key: 'masterVolume' | 'sfxVolume' | 'ambientVolume' | 'mouseSensitivity', min: number, max: number) => {
      const input = h('input', { class: 'range', type: 'range', min: String(min), max: String(max), step: '0.05', value: String(this.s[key]) });
      input.addEventListener('input', () => {
        this.s[key] = Number(input.value);
        this.game.applySettings(this.s);
      });
      return h('label', { class: 'field' }, `${label}`, input);
    };
    const toggle = (label: string, key: 'invertY' | 'showNames') => {
      const cb = h('input', { type: 'checkbox', checked: this.s[key] });
      cb.addEventListener('change', () => {
        this.s[key] = cb.checked;
        this.game.applySettings(this.s);
      });
      return h('label', { class: 'switch' }, label, cb);
    };
    const gfx = h(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          this.s.graphics = (e.target as HTMLSelectElement).value as PlayerSettings['graphics'];
          this.game.applySettings(this.s);
        },
      },
      (['low', 'medium', 'high'] as const).map((q) => h('option', { value: q, selected: this.s.graphics === q }, q[0]!.toUpperCase() + q.slice(1))),
    );
    return h(
      'div',
      { class: 'col' },
      slider('Master volume', 'masterVolume', 0, 1),
      slider('Effects volume', 'sfxVolume', 0, 1),
      slider('Ambient volume', 'ambientVolume', 0, 1),
      slider('Mouse sensitivity', 'mouseSensitivity', 0.2, 3),
      toggle('Invert mouse Y', 'invertY'),
      toggle('Show name tags', 'showNames'),
      h('label', { class: 'field' }, 'Graphics quality', gfx),
      h('div', { class: 'tiny muted' }, `Current FPS: ${this.game.fps}`),
    );
  }
  override renderFoot(): Child {
    return h('button', { class: 'btn primary', disabled: this.busy, onclick: () => void this.act(() => this.net.rpc('settings.save', { settings: this.s }), () => this.ui.success('Settings saved')) }, 'Save settings');
  }
}

const APPEARANCE: Record<keyof Appearance, string[]> = {
  skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a5694f'],
  shirt: ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8338ec', '#ffbe0b', '#06d6a0', '#ef476f', '#118ab2', '#073b4c'],
  pants: ['#1d3557', '#2b2d42', '#3d405b', '#495057', '#6c584c', '#264653'],
  hair: ['#1b1b1b', '#4a2c2a', '#8d5524', '#d4a373', '#e9c46a', '#7f5539', '#b5838d'],
};

export class ProfilePanel extends Panel {
  readonly name = 'profile';
  private tab: 'stats' | 'achievements' | 'leaderboard' | 'history' | 'appearance' = 'stats';
  private leaderboard: LeaderboardEntry[] = [];
  private history: Transaction[] = [];
  private look: Appearance = { ...this.ui.game.store.me!.appearance };

  title() {
    return this.store.me?.name ?? 'Profile';
  }
  override subtitle() {
    const me = this.store.me;
    return me ? `Level ${me.level} - Reputation ${me.reputation} - Member since ${new Date(me.createdAt).toLocaleDateString()}` : '';
  }
  iconSvg() {
    return ICONS.user;
  }
  private async load(): Promise<void> {
    try {
      if (this.tab === 'leaderboard') this.leaderboard = (await this.net.rpc('leaderboard', {})).entries;
      if (this.tab === 'history') this.history = (await this.net.rpc('transactions', {})).transactions;
    } catch (err) {
      this.ui.error(err);
    }
    this.refresh();
  }
  private setTab(t: ProfilePanel['tab']): void {
    this.tab = t;
    this.refresh();
    void this.load();
  }
  renderBody(): Child {
    const me = this.store.me!;
    const tabs = h(
      'div',
      { class: 'subtabs' },
      (['stats', 'achievements', 'leaderboard', 'history', 'appearance'] as const).map((t) => h('button', { class: this.tab === t ? 'active' : '', onclick: () => this.setTab(t) }, t[0]!.toUpperCase() + t.slice(1))),
    );
    let content: Child = null;
    if (this.tab === 'stats') {
      const s = me.stats;
      const p = levelProgress(me.xp);
      const stat = (k: string, v: string, cls = '') => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v));
      content = h(
        'div',
        { class: 'stat-grid' },
        stat('Cash', formatMoney(me.money), 'money'),
        stat('Savings', formatMoney(me.bank)),
        stat('Level', `${me.level} (${Math.round(p.fraction * 100)}%)`),
        stat('Total XP', me.xp.toLocaleString()),
        stat('Vehicles bought', String(s.vehiclesBought)),
        stat('Vehicles sold', String(s.vehiclesSold)),
        stat('Revenue', formatMoney(s.totalRevenue)),
        stat('Total profit', formatMoney(s.totalProfit), s.totalProfit >= 0 ? 'money' : 'neg'),
        stat('Best flip', formatMoney(s.bestFlipProfit)),
        stat('Spent on repairs', formatMoney(s.spentOnRepairs)),
        stat('Spent on customs', formatMoney(s.spentOnCustomization)),
        stat('Customers served', String(s.customersServed)),
        stat('Negotiations won', String(s.negotiationsWon)),
        stat('Auctions won / sold', `${s.auctionsWon} / ${s.auctionsSold}`),
        stat('Distance driven', `${s.distanceDriven.toFixed(1)} km`),
        stat('Achievements', `${me.achievements.length} / ${ACHIEVEMENTS.length}`),
      );
    } else if (this.tab === 'achievements') {
      content = h(
        'div',
        { class: 'card-grid' },
        ACHIEVEMENTS.map((a) => {
          const done = me.achievements.includes(a.id);
          return h('div', { class: `achv${done ? '' : ' locked'}` }, h('div', { class: 'ai' }, done ? '★' : '?'), h('div', null, h('div', { style: { fontWeight: '800' } }, a.title), h('div', { class: 'tiny muted' }, `${a.description} Reward ${formatMoney(a.reward)}`)));
        }),
      );
    } else if (this.tab === 'leaderboard') {
      content = h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Player'), h('th', null, 'Level'), h('th', null, 'Net worth'), h('th', null, 'Sold'))),
        h(
          'tbody',
          null,
          this.leaderboard.map((e, i) =>
            h('tr', { class: e.id === this.store.playerId ? 'me' : '' }, h('td', null, String(i + 1)), h('td', null, e.name), h('td', null, String(e.level)), h('td', { class: 'money' }, formatMoney(e.netWorth)), h('td', null, String(e.vehiclesSold))),
          ),
        ),
      );
    } else if (this.tab === 'history') {
      content = this.history.length
        ? h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Type'), h('th', null, 'Details'), h('th', null, 'Amount'))),
            h(
              'tbody',
              null,
              this.history.map((t) =>
                h('tr', null, h('td', { class: 'tiny muted' }, new Date(t.createdAt).toLocaleTimeString()), h('td', null, t.kind.replace(/_/g, ' ')), h('td', { class: 'small' }, t.note), h('td', { class: t.amount >= 0 ? 'money' : 'neg', style: { fontWeight: '800' } }, `${t.amount >= 0 ? '+' : ''}${formatMoney(t.amount)}`)),
              ),
            ),
          )
        : h('div', { class: 'empty' }, 'No transactions yet.');
    } else {
      content = h(
        'div',
        { class: 'col' },
        (Object.keys(APPEARANCE) as (keyof Appearance)[]).map((k) =>
          h(
            'div',
            null,
            h('div', { class: 'section-title' }, k),
            h('div', { class: 'opt-grid' }, APPEARANCE[k].map((c) => h('button', { class: `opt${this.look[k] === c ? ' active' : ''}`, onclick: () => ((this.look[k] = c), this.refresh()) }, h('span', { class: 'sw', style: { background: c } })))),
          ),
        ),
        h('button', { class: 'btn primary', style: { alignSelf: 'flex-start' }, disabled: this.busy, onclick: () => void this.act(() => this.net.rpc('appearance.save', { appearance: this.look }), () => this.ui.success('Looking sharp!')) }, 'Save appearance'),
      );
    }
    return [tabs, content];
  }
}

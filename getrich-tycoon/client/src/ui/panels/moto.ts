// Moto Gear (beside the hospital): helmet shells and visors, and which helmet you wear on a bike.

import { HELMETS, HELMET_COLORS, VISORS, helmet, helmetItem, ownedHelmets, ownedVisors, visorItem, type HelmetDef, type VisorDef } from '../../../../shared/helmets';
import { formatMoney } from '../../../../shared/util';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';

/** A helmet drawn in the shell colour with the visor in its tint (our own SVG). */
function helmetPic(def: HelmetDef, v: VisorDef, color: string): HTMLElement {
  const el = h('div', { class: 'helmet-pic' });
  const cross = def.id === 'cross';
  const bubble = def.id === 'custom';
  el.innerHTML = `<svg viewBox="0 0 64 48">
    <path d="M10 32c0-15 10-24 23-24s21 9 21 20v8H30l-5 6H14c-2 0-4-2-4-4z" fill="${color}" stroke="#0b0d12" stroke-width="2"/>
    ${cross ? '<path d="M24 8l30 4-4 6-26-4z" fill="' + color + '" stroke="#0b0d12" stroke-width="2"/>' : ''}
    ${def.id === 'sport' ? '<path d="M10 20l-6-2 3 8z" fill="' + color + '" stroke="#0b0d12" stroke-width="2"/>' : ''}
    ${bubble ? '<path d="M36 18h3v18h-3zM31 17h3v19h-3z" fill="#16181d"/>' : ''}
    <path d="${cross ? 'M34 21h18v8H34z' : bubble ? 'M30 16c10-2 22 2 24 10v6H30z' : 'M32 18c10-1 20 3 22 9v3H32z'}" fill="${v.color}" fill-opacity="${Math.max(0.35, v.opacity)}" stroke="#0b0d12" stroke-width="1.5"/>
    ${v.id === 'iridium' ? '<path d="M34 22h18" stroke="#46d9ff" stroke-width="2"/><path d="M34 25h18" stroke="#c45bff" stroke-width="2"/>' : ''}
  </svg>`;
  return el;
}

export class MotoGearPanel extends Panel {
  readonly name = 'motogear';
  override size = 'wide' as const;
  /** The colour picked for the helmet you wear. */
  private color: string | null = null;

  title() {
    return 'Moto Gear · Kask Mağazası';
  }
  override subtitle() {
    return 'Helmets and visors for motorcycles and quads';
  }
  iconSvg() {
    return ICONS.helmet;
  }

  renderBody(): Child {
    const me = this.store.me;
    const inv = me?.inventory ?? {};
    const money = me?.money ?? 0;
    const look = me?.appearance;
    const worn = helmet(look?.helmet);
    const wornVisor = VISORS.find((v) => v.id === look?.visor) ?? VISORS[0]!;
    const color = this.color ?? look?.helmetColor ?? HELMET_COLORS[0]!;
    const shells = HELMETS.map((def) => {
      const owned = (inv[helmetItem(def.id)] ?? 0) > 0;
      const wearing = worn?.id === def.id;
      return h(
        'div',
        { class: `gun-card${owned ? ' owned' : ''}`, 'data-testid': 'helmet-card', 'data-helmet': def.id },
        h('div', { class: 'gun-name' }, def.name),
        helmetPic(def, wornVisor, color),
        h('div', { class: 'tiny muted' }, def.description),
        owned
          ? h('button', { class: `btn small ${wearing ? '' : 'primary'}`, disabled: this.busy || wearing, 'data-testid': 'wear-helmet', onclick: () => void this.wear(def.id, wornVisor.id, color) }, wearing ? 'Takılı · Worn' : 'Tak · Wear')
          : h('button', { class: 'btn small primary', disabled: this.busy || money < def.price, 'data-testid': 'buy-helmet', onclick: () => void this.buy('helmet', def.id) }, formatMoney(def.price)),
      );
    });
    const visors = VISORS.map((v) => {
      const owned = v.id === 'clear' || (inv[visorItem(v.id)] ?? 0) > 0;
      const on = worn && wornVisor.id === v.id;
      return h(
        'div',
        { class: 'visor-row', 'data-testid': 'visor-row', 'data-visor': v.id },
        h('span', { class: 'visor-sw', style: { background: v.id === 'iridium' ? 'linear-gradient(90deg,#46d9ff,#c45bff,#ffcf4a)' : v.color, opacity: String(Math.max(0.5, v.opacity)) } }),
        h('span', { class: 'grow' }, v.name),
        owned
          ? h('button', { class: 'btn small', disabled: this.busy || !worn || on, onclick: () => worn && void this.wear(worn.id, v.id, color) }, on ? 'Takılı' : 'Tak')
          : h('button', { class: 'btn small primary', disabled: this.busy || money < v.price, 'data-testid': 'buy-visor', onclick: () => void this.buy('visor', v.id) }, formatMoney(v.price)),
      );
    });
    const colors = HELMET_COLORS.map((c) =>
      h('button', { class: `opt${c === color ? ' active' : ''}`, disabled: this.busy, onclick: () => ((this.color = c), worn ? void this.wear(worn.id, wornVisor.id, c) : this.refresh()) }, h('span', { class: 'sw', style: { background: c } })),
    );
    return h(
      'div',
      { class: 'col' },
      h(
        'div',
        { class: `moto-callout ${worn ? 'green' : 'red'}`, 'data-testid': 'helmet-status' },
        worn
          ? `${worn.name} · ${wornVisor.name} vizör. Motora ve ATV'ye binince otomatik takılır: kaza hasarı %60 azalır.`
          : 'Kask yok! Hızlı giderken motordan düşersen canın sıfırlanır (WASTED). Kask takarsan hasar %60 azalır.',
      ),
      h('div', { class: 'gun-grid' }, shells),
      h('div', { class: 'section-title' }, 'Vizörler · Visors'),
      h('div', { class: 'col' }, visors),
      h('div', { class: 'section-title' }, 'Kask rengi · Paint'),
      h('div', { class: 'opt-grid' }, colors),
      worn ? h('button', { class: 'btn small', disabled: this.busy, onclick: () => void this.wear(null, wornVisor.id, color) }, 'Kaskı çıkar · Take it off') : null,
      h('div', { class: 'tiny muted' }, `Sahip olduğun kasklar: ${ownedHelmets(inv).map((x) => x.name).join(', ') || 'yok'} · vizörler: ${ownedVisors(inv).map((x) => x.name).join(', ')}`),
    );
  }

  private async buy(kind: 'helmet' | 'visor', id: string): Promise<void> {
    await this.act(
      () => this.net.rpc('helmet.buy', { kind, id }),
      () => this.game.audio.play('purchase'),
    );
  }

  private async wear(helmetId: string | null, visorId: string, color: string): Promise<void> {
    await this.act(
      () => this.net.rpc('helmet.wear', { helmet: helmetId as never, visor: visorId as never, color }),
      () => this.game.audio.play('click'),
    );
  }
}

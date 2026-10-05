// The hitman contract card under the wanted stars: what the job is, how far the place is, the
// drive-by hit count and the clock.

import type { ContractView } from '../../../shared/hitman';
import { h } from './dom';
import { mmss } from './RewardsHud';

export class HitmanHud {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private text: HTMLElement;
  private dist: HTMLElement;
  private clock: HTMLElement;
  private hits: HTMLElement;
  private view: ContractView | null = null;

  constructor() {
    this.title = h('div', { class: 'hm-title', 'data-testid': 'contract-title' });
    this.text = h('div', { class: 'hm-text' });
    this.dist = h('span', { class: 'hm-dist' });
    this.clock = h('span', { class: 'hm-clock', 'data-testid': 'contract-clock' });
    this.hits = h('div', { class: 'hm-hits', 'data-testid': 'contract-hits' });
    this.el = h(
      'div',
      { class: 'hitman-hud', 'data-testid': 'contract-hud' },
      h('div', { class: 'hm-icon' }, '🎯'),
      h('div', { class: 'hm-body' }, h('div', { class: 'hm-kicker' }, 'TETİKÇİ İŞİ · ', this.clock, ' · ', this.dist), this.title, this.hits, this.text),
    );
  }

  set(v: ContractView | null): void {
    this.view = v;
    this.el.classList.toggle('show', !!v);
    if (!v) return;
    this.title.textContent = v.title;
    this.text.textContent = v.text;
    this.hits.style.display = v.need ? '' : 'none';
    if (v.need) {
      this.hits.replaceChildren(...Array.from({ length: v.need }, (_, i) => h('span', { class: i < (v.hits ?? 0) ? 'on' : '' })), h('b', null, ` ${v.hits ?? 0}/${v.need} isabet`));
    }
  }

  /** Per frame: the clock and how far away the target area is. */
  update(now: number, x: number, z: number): void {
    const v = this.view;
    if (!v) return;
    this.clock.textContent = mmss(Math.max(0, (v.expiresAt - now) / 1000));
    const d = Math.hypot(v.x - x, v.z - z) - v.radius;
    this.dist.textContent = d <= 0 ? 'ALANDASIN' : `${Math.round(d)} m`;
    this.el.classList.toggle('inside', d <= 0);
  }
}

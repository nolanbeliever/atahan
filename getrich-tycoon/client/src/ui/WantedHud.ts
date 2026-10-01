// Wanted level HUD: 1-5 stars (flashing red / blue while police are chasing), the escape countdown,
// the arrest meter, and the full-screen BUSTED / ESCAPED banners.

import type { BustedEvent, WantedState } from '../../../shared/police';
import { formatMoney } from '../../../shared/util';
import { clear, h } from './dom';

export class WantedHud {
  readonly el: HTMLElement;
  readonly banner: HTMLElement;
  private stars: HTMLElement[] = [];
  private status: HTMLElement;
  private bustFill: HTMLElement;
  private bust: HTMLElement;
  private state: WantedState = { stars: 0, units: 0, escapeLeft: null, bust: 0 };
  private bannerTimer: number | null = null;

  constructor() {
    const row = h('div', { class: 'wanted-stars' });
    for (let i = 0; i < 5; i++) {
      const s = h('span', { class: 'wstar' }, '★');
      this.stars.push(s);
      row.append(s);
    }
    this.status = h('div', { class: 'wanted-status' });
    this.bustFill = h('div');
    this.bust = h('div', { class: 'wanted-bust' }, h('span', null, 'ARREST'), h('div', { class: 'wanted-bust-bar' }, this.bustFill));
    this.el = h('div', { class: 'wanted', 'data-testid': 'wanted' }, row, this.status, this.bust);
    this.banner = h('div', { class: 'big-banner', 'data-testid': 'police-banner' });
  }

  get wanted(): WantedState {
    return this.state;
  }

  set(s: WantedState): void {
    this.state = s;
    this.el.classList.toggle('show', s.stars > 0 || s.bust > 0);
    this.el.classList.toggle('pursuit', s.units > 0);
    this.stars.forEach((el, i) => el.classList.toggle('on', i < s.stars));
    if (s.units > 0 && s.escapeLeft !== null) this.status.textContent = `LOSE THEM · ${Math.ceil(s.escapeLeft)}s`;
    else if (s.units > 0) this.status.textContent = `POLICE PURSUIT · ${s.units} unit${s.units === 1 ? '' : 's'}`;
    else if (s.stars > 0) this.status.textContent = s.stars >= 2 ? 'POLICE ON THE WAY' : 'WANTED · drive carefully';
    else this.status.textContent = '';
    this.bust.classList.toggle('show', s.bust > 0 && s.bust < 1);
    this.bustFill.style.width = `${Math.round(Math.min(1, s.bust) * 100)}%`;
  }

  busted(e: BustedEvent): void {
    this.set({ stars: 0, units: 0, escapeLeft: null, bust: 0 });
    this.show(
      'busted',
      [
        h('div', { class: 'bb-title' }, 'BUSTED!'),
        h('div', { class: 'bb-text' }, `Aracınız bağlandı ve ${formatMoney(e.fine)} ceza kesildi`),
        h('div', { class: 'bb-sub' }, `Your car was impounded and a ${formatMoney(e.fine)} fine was deducted.`),
      ],
      e.cutsceneMs,
    );
  }

  escaped(reward: number, xp: number): void {
    this.set({ stars: 0, units: 0, escapeLeft: null, bust: 0 });
    this.show('escaped', [h('div', { class: 'bb-title' }, 'ESCAPED!'), h('div', { class: 'bb-text' }, `+${formatMoney(reward)} & ${xp} XP`), h('div', { class: 'bb-sub' }, 'You lost the police.')], 3600);
  }

  /** A mission completed: a short banner. */
  mission(title: string, reward: string): void {
    this.show('mission', [h('div', { class: 'bb-kicker' }, 'MISSION COMPLETE · GÖREV TAMAMLANDI'), h('div', { class: 'bb-title' }, title), h('div', { class: 'bb-text' }, reward)], 3200);
  }

  /** The stolen car is the player's for good. */
  stolenOk(model: string): void {
    this.show('stolen-ok', [h('div', { class: 'bb-kicker' }, model.toUpperCase()), h('div', { class: 'bb-title' }, 'CAR STOLEN SUCCESSFULLY!'), h('div', { class: 'bb-text' }, '(Araç Tamamen Senindir)'), h('div', { class: 'bb-sub' }, 'Keep it, store it or sell it on the Marketplace.')], 4200);
  }

  private show(kind: string, children: HTMLElement[], ms: number): void {
    clear(this.banner);
    this.banner.append(h('div', { class: 'bb-card' }, ...children));
    this.banner.className = `big-banner ${kind}`;
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), ms);
  }
}

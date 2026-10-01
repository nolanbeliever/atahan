// The gift box on the HUD: a live countdown to the next playtime reward ("Sonraki Ödül: 04:52"); it
// glows and bounces when a reward is waiting. A click collects a ready playtime reward on the spot
// (confetti and coins) or opens the rewards panel (the daily streak, the 3-hour mega reward choice).

import { PLAYTIME_CAP_SEC, type RewardsView } from '../../../shared/rewards';
import { h } from './dom';

export function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const hh = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0 ? `${hh}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const GIFT_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#ff5c7a" d="M3 10h18v4H3z"/><path fill="#ff7a90" d="M4 14h16v7H4z"/><path fill="#ffd35a" d="M11 10h2v11h-2z"/><path fill="none" stroke="#ffd35a" stroke-width="2" stroke-linecap="round" d="M12 10c-1-3-5-5-6-2.5S9 10 12 10zm0 0c1-3 5-5 6-2.5S15 10 12 10z"/></svg>`;

export class RewardsHud {
  readonly el: HTMLElement;
  private icon: HTMLElement;
  private title: HTMLElement;
  private time: HTMLElement;
  private view: RewardsView | null = null;
  private at = 0;
  /** Seconds the client has seen the player active since the last server update. */
  private extra = 0;
  onClick: (() => void) | null = null;

  constructor() {
    this.icon = h('div', { class: 'gift-icon' });
    this.icon.innerHTML = GIFT_SVG;
    this.title = h('div', { class: 'gift-title' }, 'Sonraki Ödül');
    this.time = h('div', { class: 'gift-time mono' }, '--:--');
    this.el = h('button', { class: 'gift-hud', 'data-testid': 'gift-hud', title: 'Ödüller (günlük seri ve oynama süresi)', onclick: () => this.onClick?.() }, this.icon, h('div', { class: 'gift-text' }, this.title, this.time));
  }

  set(view: RewardsView): void {
    this.view = view;
    this.at = Date.now();
    this.extra = 0;
    this.render();
  }

  /** Estimated active seconds today (the server's count plus what we've seen since). */
  seconds(): number {
    return Math.min(PLAYTIME_CAP_SEC, (this.view?.playtime.seconds ?? 0) + this.extra);
  }

  /** Something ready to collect: a playtime milestone or today's daily box (as the server counts it:
   *  it sends an update the moment a milestone is reached). */
  ready(): { daily: boolean; milestone: number | null } {
    const v = this.view;
    if (!v) return { daily: false, milestone: null };
    const m = v.playtime.milestones.find((x) => x.ready);
    return { daily: v.daily.claimable, milestone: m ? m.minutes : null };
  }

  /** Per frame: count active time (the player is doing something) and redraw. */
  update(dt: number, active: boolean): void {
    if (!this.view) return;
    if (active) this.extra += dt;
    this.render();
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    const r = this.ready();
    const glow = r.daily || r.milestone !== null;
    this.el.classList.toggle('ready', glow);
    if (r.milestone !== null) {
      this.title.textContent = `${r.milestone} dk ödülü`;
      this.time.textContent = 'ÖDÜLÜ TOPLA!';
    } else if (r.daily) {
      this.title.textContent = 'Günlük ödül';
      this.time.textContent = 'ÖDÜLÜ TOPLA!';
    } else {
      // Until the server confirms a milestone the clock stays at 00:00.
      const done = v.playtime.milestones.filter((m) => m.claimed || m.ready).map((m) => m.minutes);
      const waiting = v.playtime.milestones.find((m) => !done.includes(m.minutes));
      const next = waiting ? Math.max(0, waiting.minutes * 60 - this.seconds()) : null;
      this.title.textContent = next === null ? 'Bugünkü ödüller tamam' : 'Sonraki Ödül';
      this.time.textContent = next === null ? `Yarın: ${mmss((v.dayEndsAt - (v.serverTime + (Date.now() - this.at))) / 1000)}` : mmss(next);
    }
  }
}
